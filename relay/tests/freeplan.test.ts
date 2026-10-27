import { randomBytes } from 'node:crypto';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MemoryStore, ROOM_LIMITS, type Conn, type Room } from '../room';
import {
  MemoryRegionStore,
  REGION_LIMITS,
  RegionRoom,
  parseRegionMsg,
  type RegionConn,
  type RegionRoomMsg,
} from '../region';
import { PROTOCOL_VERSION, parseClientMsg, type RoomMsg } from '../protocol';
import { Signal } from '../signal';
import { startRelay } from '../local';
import { RegionHost, RoomHost, SignalHost, route, type HostSocket, type SocketTag } from '../objects';
import { SqlStore, type Sql } from '../sqlStore';
import { loopbackPair, webSocketLink, type Link } from '../../src/net/link';
import { encodeSnapshot } from '../../src/net/snapshot';
import type { SharedSnapshot } from '../../src/sim/protocol';
import type { Stamped } from '../../src/sim/lockstep';
import { FakeClock, loopTo, makeRoom, player, stopAll, until } from './harness';
import { DAY_MS } from '../limits';
import { RegionLink } from '../../src/net/regionLink';
import { Sim } from '../../src/sim/sim';
import { regionReport } from '../../src/sim/systems/region';
import type { SaveFile } from '../../src/sim/save';
import type { SharedMessage } from '../../src/client/simClient';

/**
 * F8: keeping within Cloudflare's free plan under abuse. One person with a script mustn't be able to
 * use up the account's daily rows, requests or memory: every object is rate limited, events are
 * written in batches, snapshots are capped, rooms and regions expire, a code nobody hosts stores
 * nothing, and each object stops writing at a daily budget. Time is a fake clock throughout.
 */

// ---------------------------------------------------------------- helpers

const hello = (name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name, color: 0, ...extra });
const create = { create: { cityName: 'Floodby' } };
const tax = (rate: number) => ({ type: 'setTax', zone: 'R', wealth: 'all', rate });

interface Raw {
  conn: Conn;
  got: RoomMsg[];
  closed: string | null;
  say(m: object | string): void;
}

/** A connection to a room that keeps what it's sent. */
function raw(room: Room, mayCreate?: boolean): Raw {
  const r: Raw = {
    got: [],
    closed: null,
    conn: null as unknown as Conn,
    say: (m) => room.message(r.conn, typeof m === 'string' ? m : JSON.stringify(m)),
  };
  r.conn = {
    send: (m) => r.got.push(m),
    close: (_code, reason) => (r.closed = reason || 'closed'),
    ...(mayCreate === undefined ? {} : { mayCreate }),
  };
  room.open(r.conn);
  return r;
}

const welcome = (r: Raw) => r.got.find((m) => m.t === 'welcome') as Extract<RoomMsg, { t: 'welcome' }>;
const events = (r: Raw) => r.got.flatMap((m) => (m.t === 'ev' ? m.list : []));

/** A room with a city in it (a one-part upload), its host keeping time at normal speed. */
function openRoom(code: string, store: MemoryStore, env: { now(): number; later?: FakeClock['later'] }) {
  const room = makeRoom(code, store, env, {});
  const host = raw(room);
  host.say(hello('Ada', create));
  host.say({
    t: 'snap',
    meta: { id: 'up', tick: 1000, seq: -1, eventHash: 0, parts: 1, cityName: 'Floodby', population: 0 },
    part: 0,
    data: 'AAAA',
  });
  const w = welcome(host);
  return { room, host, me: { id: w.you, secret: w.secret } };
}

/** How many snapshots a room is holding parts of. */
function inFlight(room: Room): number {
  const inc = (room as unknown as { incoming: unknown }).incoming;
  return inc instanceof Map ? inc.size : inc ? 1 : 0;
}

interface RawRegion {
  conn: RegionConn;
  got: RegionRoomMsg[];
  closed: string | null;
  say(m: object): void;
}

function rawRegion(region: RegionRoom, mayCreate?: boolean): RawRegion {
  const r: RawRegion = {
    got: [],
    closed: null,
    conn: null as unknown as RegionConn,
    say: (m) => region.message(r.conn, JSON.stringify(m)),
  };
  r.conn = {
    send: (m) => r.got.push(m),
    close: (_code, reason) => (r.closed = reason || 'closed'),
    ...(mayCreate === undefined ? {} : { mayCreate }),
  };
  region.open(r.conn);
  return r;
}

const rhello = (mayor: string, extra: Record<string, unknown> = {}) => ({
  t: 'rhello',
  v: PROTOCOL_VERSION,
  mayor,
  color: 0,
  city: `${mayor}ton`,
  ...extra,
});
const report = (sell = 0, population = 100, city = 'Adaton') => ({
  t: 'report',
  city,
  report: {
    population,
    kind: 'suburb',
    workers: 10,
    jobs: 10,
    shoppers: 5,
    offers: { buy: { power: 0, water: 0, garbage: 0 }, sell: { power: sell, water: 0, garbage: 0 } },
    deals: [],
    projectBuilt: false,
  },
});

/** A region with Ada's city in it. */
function openRegion(code: string, clock: FakeClock, store = new MemoryRegionStore()) {
  const region = new RegionRoom(code, 'local', store, clock);
  const ada = rawRegion(region);
  ada.say(rhello('Ada', { create: { name: 'Vale' } }));
  const w = ada.got.find((m) => m.t === 'rwelcome') as Extract<RegionRoomMsg, { t: 'rwelcome' }>;
  return { region, store, ada, slot: w.slot, secret: w.secret };
}

/** Node's SQLite standing in for a Durable Object's: rows written as the platform counts them. */
async function sqlite() {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:');
  const total = () => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  let written = 0;
  const sql: Sql = {
    exec<T>(query: string, ...bindings: unknown[]) {
      const before = total();
      const stmt = db.prepare(query);
      const args = bindings as (string | number | null)[];
      const rows = (/^\s*select/i.test(query) ? stmt.all(...args) : (stmt.run(...args), [])) as T[];
      const rowsWritten = total() - before;
      written += rowsWritten;
      return { toArray: () => rows, rowsWritten };
    },
  };
  const tables = () =>
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (r) => r.name,
    );
  return { sql, tables, written: () => written };
}

interface FakeSocket extends HostSocket {
  got: Record<string, unknown>[];
  closed: string | null;
  tags: string[];
}

/** A Durable Object's sockets, for the objects' logic run outside Cloudflare. */
function fakeSockets() {
  const list: FakeSocket[] = [];
  return {
    list,
    sockets: (tag?: string) => list.filter((s) => !s.closed && (tag === undefined || s.tags.includes(tag))),
    open(tags: string[] = []): FakeSocket {
      let t: SocketTag | null = null;
      const s: FakeSocket = {
        got: [],
        closed: null,
        tags,
        send: (text) => s.got.push(JSON.parse(text) as Record<string, unknown>),
        close: (_c, reason) => (s.closed = reason || 'closed'),
        tag: () => t,
        setTag: (v) => (t = v),
      };
      list.push(s);
      return s;
    },
  };
}

async function listen(
  link: Link,
): Promise<{ link: Link; got: Record<string, unknown>[]; closed: () => boolean }> {
  const got: Record<string, unknown>[] = [];
  let closed = false;
  link.onmessage = (t) => {
    if (t !== 'pong') got.push(JSON.parse(t) as Record<string, unknown>);
  };
  link.onclose = () => (closed = true);
  return { link, got, closed: () => closed };
}

// ---------------------------------------------------------------- rooms

describe('F8: a room keeps within the free plan', () => {
  it('a flood of commands writes a few rows, and every command is either ordered and kept or turned down', () => {
    const clock = new FakeClock();
    const store = new MemoryStore();
    const { host, me } = openRoom('2CMDSX', store, clock);
    const before = store.rowsWritten;
    // Fifteen commands a second for a minute (the general limit lets them through; commands have
    // their own).
    for (let i = 0; i < 900; i++) {
      clock.advance(1000 / 15);
      host.say({ t: 'cmd', ref: i + 1, cmd: tax((i % 10) / 100) });
    }
    clock.advance(60_000);
    const ordered = events(host).flatMap((e) =>
      e.ev.kind === 'cmd' && e.ev.by === me.id ? [e.ev.ref!] : [],
    );
    const refused = host.got.filter((m) => m.t === 'refused') as Extract<RoomMsg, { t: 'refused' }>[];
    expect(new Set([...ordered, ...refused.map((r) => r.ref)]).size).toBe(900);
    expect(ordered.length + refused.length).toBe(900);
    for (const r of refused) expect(r.reason).toBe('Slow down a little');
    expect(ordered.length).toBeGreaterThan(8 * 60);
    expect(host.closed).toBeNull();
    // One row per command until now (over 500 here); now a row per batch and the odd record.
    const rows = store.rowsWritten - before;
    console.log(`[F8] ${ordered.length} commands in a minute: ${rows} rows written`);
    expect(rows).toBeLessThanOrEqual(15);

    // Everyone leaves; the room comes back from its store with every command it ordered.
    host.say({ t: 'bye' });
    const again = makeRoom('2CMDSX', store, clock, {});
    const back = raw(again);
    back.say(hello('Ada', { rejoin: { ...me, seq: -1 } }));
    expect(welcome(back).join).toBe('events');
    expect(events(back).flatMap((e) => (e.ev.kind === 'cmd' ? [e.ev.ref] : []))).toEqual(ordered);
  });

  it('never hands out a sequence number twice, even when unwritten events are lost with the object', () => {
    const clock = new FakeClock();
    const store = new MemoryStore();
    const { host, me } = openRoom('3GQNEW', store, clock);
    for (let i = 0; i < 5; i++) {
      host.say({ t: 'cmd', ref: i + 1, cmd: tax(i / 100) });
      clock.advance(100);
    }
    const seen = events(host).map((e) => e.seq);
    // The object goes (a deploy, a crash): its memory is lost, with whatever it hadn't written.
    const kept = new Set(store.loadEvents().map((e) => e.seq));
    const lost = seen.filter((s) => !kept.has(s));
    // Here all five were still waiting for their batch.
    expect(lost).toHaveLength(5);
    const again = makeRoom('3GQNEW', store, clock, {});
    const back = raw(again);
    back.say(hello('Ada', { rejoin: { ...me, seq: Math.max(...seen) } }));
    // A player who saw events the room no longer has catches up from a snapshot, not from the gap.
    expect(welcome(back).join).toBe(lost.length ? 'snapshot' : 'events');
    back.say({ t: 'cmd', ref: 99, cmd: tax(0.2) });
    const fresh = events(back).find((e) => e.ev.kind === 'cmd' && e.ev.ref === 99)!;
    expect(fresh.seq).toBeGreaterThan(Math.max(...seen));
  });

  it('a paused room writes its events within two seconds and leaves no timer running, so it can sleep', () => {
    const clock = new FakeClock();
    const store = new MemoryStore();
    const { host } = openRoom('4PAUSE', store, clock);
    host.say({ t: 'speed', speed: 0 });
    host.say({ t: 'cmd', ref: 1, cmd: tax(0.1) });
    const seq = events(host).at(-1)!.seq;
    clock.advance(2000);
    expect(store.events.map((e) => e.seq)).toContain(seq);
    expect(clock.pending).toBe(0);
    // Running, an event waits at most half a minute for its batch.
    host.say({ t: 'speed', speed: 1 });
    host.say({ t: 'cmd', ref: 2, cmd: tax(0.2) });
    const seq2 = events(host).at(-1)!.seq;
    clock.advance(30_000);
    expect(store.events.map((e) => e.seq)).toContain(seq2);
    expect(clock.pending).toBe(0);
  });

  it('turns away snapshots over the cap, and holds at most one in flight', () => {
    const snap = (parts: number, part = 0, id = 'a') =>
      JSON.stringify({
        t: 'snap',
        meta: { id, tick: 0, seq: -1, eventHash: 0, parts, cityName: 'X', population: 0 },
        part,
        data: 'AAAA',
      });
    expect(parseClientMsg(snap(40, 39))).not.toBeNull();
    expect(parseClientMsg(snap(41))).toBeNull();
    const save = (parts: number) => JSON.stringify({ t: 'save', id: 'x', part: 0, parts, data: 'AAAA' });
    expect(parseRegionMsg(save(40))).not.toBeNull();
    expect(parseRegionMsg(save(41))).toBeNull();

    // The host starts uploading one snapshot, then another: only the newest is held.
    const room = makeRoom('5SNAPS', new MemoryStore(), new FakeClock(), {});
    const host = raw(room);
    host.say(hello('Ada', create));
    host.say(snap(3, 0, 'a'));
    host.say(snap(3, 1, 'b'));
    host.say(snap(3, 0, 'c'));
    expect(inFlight(room)).toBeLessThanOrEqual(1);
    // An uploader who goes leaves nothing behind.
    host.say({ t: 'bye' });
    expect(inFlight(room)).toBe(0);

    // A city too big to share says so in words (its parts would be refused).
    const junk = randomBytes(9_000_000).toString('base64');
    const big = {
      save: { meta: { tick: 0, cityName: 'Bigby', population: 0 }, junk },
      history: [],
      seq: -1,
      eventHash: 0,
    };
    expect(() => encodeSnapshot(big as unknown as SharedSnapshot, 'x')).toThrow(/too big to share/);
  }, 60_000);

  it('expires when nobody has come back for a long while', () => {
    const clock = new FakeClock();
    const { room, host } = openRoom('6QUXET', new MemoryStore(), clock);
    expect(room.expiresAt()).toBeNull();
    clock.advance(5000);
    host.say({ t: 'bye' });
    expect(room.expiresAt()).toBe(clock.now() + ROOM_LIMITS.ttl);
    expect(ROOM_LIMITS.ttl).toBe(60 * 86_400_000);
  });

  it('stops ordering commands at its daily row budget, still passes chat, and takes them again the next day', () => {
    const clock = new FakeClock();
    const store = new MemoryStore();
    // Without a timer every event is written at once: the worst case for rows.
    const { host } = openRoom('7BUDGT', store, { now: clock.now });
    let limited: Extract<RoomMsg, { t: 'refused' }> | undefined;
    for (let i = 0; i < 6000 && !limited; i++) {
      clock.advance(130);
      host.say({ t: 'cmd', ref: i + 1, cmd: tax((i % 10) / 100) });
      const last = host.got.at(-1)!;
      if (last.t === 'refused' && /limit/.test(last.reason)) limited = last;
    }
    expect(ROOM_LIMITS.dailyRows).toBe(5000);
    expect(limited?.reason).toBe("This room has reached today's limit; back tomorrow (UTC)");
    expect(store.rowsWritten).toBeGreaterThanOrEqual(5000);
    expect(store.rowsWritten).toBeLessThan(5010);
    // Chat still passes.
    host.say({ t: 'chat', text: 'see you tomorrow' });
    expect(host.got.some((m) => m.t === 'chat' && m.text === 'see you tomorrow')).toBe(true);
    // The next UTC day, commands are ordered again.
    clock.advance(86_400_000 - (clock.now() % 86_400_000) + 1000);
    host.say({ t: 'cmd', ref: 99_999, cmd: tax(0.1) });
    expect(events(host).some((e) => e.ev.kind === 'cmd' && e.ev.ref === 99_999)).toBe(true);
  }, 60_000);

  it('holds a bounded number of connections, dropping the oldest that never said hello', () => {
    const room = makeRoom('8CQNNS', new MemoryStore(), new FakeClock(), {});
    const all = Array.from({ length: 40 }, () => raw(room));
    expect(room.connections).toBeLessThanOrEqual(ROOM_LIMITS.maxConns);
    expect(all[0]!.closed).not.toBeNull();
    expect(all.at(-1)!.closed).toBeNull();
  });
});

// ---------------------------------------------------------------- regions

describe('F8: a region keeps within the free plan', () => {
  it('a flood of reports writes almost nothing and closes the connection', () => {
    const clock = new FakeClock();
    const { store, ada } = openRegion('2RFXQD', clock);
    const before = store.rowsWritten;
    for (let i = 0; i < 1000; i++) {
      clock.advance(60);
      ada.say(report());
    }
    expect(ada.closed).not.toBeNull();
    expect(store.rowsWritten - before).toBeLessThanOrEqual(3);
  });

  it('writes changing offers at a measured pace, and the last one is never lost', () => {
    const clock = new FakeClock();
    const { region, store, ada } = openRegion('3RPACE', clock);
    const before = store.rowsWritten;
    for (let i = 1; i <= 60; i++) {
      clock.advance(1000);
      ada.say(report(i));
    }
    expect(ada.closed).toBeNull();
    const rows = store.rowsWritten - before;
    console.log(`[F8] a city changing its offers every second for a minute: ${rows} rows written`);
    expect(rows).toBeLessThanOrEqual(8);
    region.closed(ada.conn);
    clock.advance(60_000);
    expect(store.meta!.cities[0]!.report!.offers.sell.power).toBe(60);
  });

  it('takes one hello per connection, and a city coming back unchanged writes nothing', () => {
    const clock = new FakeClock();
    const { region, store, ada, slot, secret } = openRegion('4RHEYQ', clock);
    const before = store.rowsWritten;
    for (let i = 0; i < 100; i++) ada.say(rhello('Ada', { rejoin: { slot, secret } }));
    expect(store.rowsWritten - before).toBeLessThanOrEqual(1);
    region.closed(ada.conn);
    const quiet = store.rowsWritten;
    for (let i = 0; i < 50; i++) {
      clock.advance(1000);
      const c = rawRegion(region);
      c.say(rhello('Ada', { rejoin: { slot, secret } }));
      region.closed(c.conn);
    }
    expect(store.rowsWritten - quiet).toBe(0);
  });

  it('pays in every contribution, writing them in a few rows', () => {
    const clock = new FakeClock();
    const { region, store, ada } = openRegion('5RGZVE', clock);
    const before = store.rowsWritten;
    for (let i = 0; i < 100; i++) {
      clock.advance(1000);
      ada.say({ t: 'contribute', amount: 1 });
    }
    expect(region.view().project.total).toBe(100);
    const rows = store.rowsWritten - before;
    expect(rows).toBeLessThanOrEqual(10);
    region.closed(ada.conn);
    clock.advance(60_000);
    expect(store.meta!.project.total).toBe(100);
  });

  it('keeps a city save at most every ten minutes, and serves visits only after a hello, slowly', () => {
    const clock = new FakeClock();
    const { region, store, ada } = openRegion('6RSAVE', clock);
    const before = store.rowsWritten;
    for (let i = 0; i < 100; i++) {
      clock.advance(1000);
      ada.say({ t: 'save', id: `s${i}`, part: 0, parts: 1, data: `DATA${i}` });
    }
    expect(store.rowsWritten - before).toBeLessThanOrEqual(3);
    expect(store.loadCity(1)).toEqual(['DATA0']);

    const stranger = rawRegion(region);
    stranger.say({ t: 'visit', slot: 1 });
    expect(stranger.got.some((m) => m.t === 'citysave')).toBe(false);
    const visitor = rawRegion(region);
    visitor.say(rhello('Vi', { visitor: true }));
    for (let i = 0; i < 10; i++) visitor.say({ t: 'visit', slot: 1 });
    expect(visitor.got.filter((m) => m.t === 'citysave').length).toBeLessThanOrEqual(2);
  });

  it('keeps the save a city sends as its player leaves, once a connection, whatever the pace (M35)', () => {
    const clock = new FakeClock();
    const { region, store, ada } = openRegion('6RLAST', clock);
    clock.advance(1000);
    ada.say({ t: 'save', id: 's0', part: 0, parts: 1, data: 'FIRST' });
    clock.advance(1000);
    ada.say({ t: 'save', id: 's1', part: 0, parts: 1, data: 'SOON' });
    expect(store.loadCity(1)).toEqual(['FIRST']);
    ada.say({ t: 'save', id: 's2', part: 0, parts: 1, data: 'LEAVING', last: true });
    expect(store.loadCity(1)).toEqual(['LEAVING']);
    // Only once: another "last" save on the same connection waits its turn like any other.
    clock.advance(1000);
    ada.say({ t: 'save', id: 's3', part: 0, parts: 1, data: 'AGAIN', last: true });
    expect(store.loadCity(1)).toEqual(['LEAVING']);
    region.closed(ada.conn);
  });

  it('keeps a city’s battles a few at once, then one every few minutes, and says each is kept (M35)', () => {
    const clock = new FakeClock();
    const store = new MemoryRegionStore();
    // The pace alone (the day's limit on raids a city takes, M36, has a test of its own).
    const region = new RegionRoom('6RWARS', 'local', store, clock, { raidsPerDay: 99 });
    const ada = rawRegion(region);
    ada.say(rhello('Ada', { create: { name: 'Vale', rules: { war: true, scale: 'skirmish' } } }));
    const sam = rawRegion(region);
    sam.say(rhello('Sam'));
    ada.say(report(0, 5_000, 'Adaton'));
    sam.say(report(0, 5_000, 'Samton'));
    const before = store.rowsWritten;
    for (let i = 0; i < 40; i++) {
      clock.advance(1000);
      ada.say({ t: 'battle', to: 2, id: `b${i}`, part: 0, parts: 1, data: `DATA${i}` });
    }
    const kept = ada.got.filter((m) => m.t === 'battleKept');
    expect(kept.length).toBeLessThanOrEqual(REGION_LIMITS.battleBurst);
    expect(store.rowsWritten - before).toBeLessThanOrEqual(REGION_LIMITS.battleBurst * 3);
    // One sent again (its acknowledgement lost) is acknowledged again, and not kept twice.
    ada.say({ t: 'battle', to: 2, id: 'b0', part: 0, parts: 1, data: 'DATA0' });
    expect(ada.got.filter((m) => m.t === 'battleKept' && m.id === 'b0')).toHaveLength(2);
    // Sam, playing, got each one kept as it came.
    expect(sam.got.filter((m) => m.t === 'battle')).toHaveLength(kept.length);
    // Ten minutes on, another is kept.
    clock.advance(10 * 60_000);
    ada.say({ t: 'battle', to: 2, id: 'later', part: 0, parts: 1, data: 'LATER' });
    expect(ada.got.some((m) => m.t === 'battleKept' && m.id === 'later')).toBe(true);
    // A force on its way is told to its target only, where war is on.
    ada.say({ t: 'forceOut', to: 2, units: 7, hours: 6 });
    expect(sam.got.filter((m) => m.t === 'incoming')).toEqual([
      { t: 'incoming', from: 1, units: 7, hours: 6 },
    ]);
    expect(ada.got.some((m) => m.t === 'incoming')).toBe(false);
    region.closed(ada.conn);
    region.closed(sam.conn);
  });

  it('holds a friend raided all night while its player is away to the day’s raids, each marked away (M36)', () => {
    const clock = new FakeClock();
    const store = new MemoryRegionStore();
    const region = new RegionRoom('6RNITE', 'local', store, clock);
    const ada = rawRegion(region);
    ada.say(rhello('Ada', { create: { name: 'Vale', rules: { war: true, scale: 'skirmish' } } }));
    const sam = rawRegion(region);
    sam.say(rhello('Sam'));
    const welcome = sam.got.find((m) => m.t === 'rwelcome') as Extract<RegionRoomMsg, { t: 'rwelcome' }>;
    // Both cities tell the region about themselves (no shield: neither is new or neutral).
    ada.say(report(0, 5_000, 'Adaton'));
    sam.say(report(0, 5_000, 'Samton'));
    // Sam goes to bed at nine in the evening (UTC); Ada raids every twenty minutes until nine.
    clock.advance((Math.ceil(clock.t / DAY_MS) * DAY_MS - clock.t) % DAY_MS);
    clock.advance(21 * 3600_000);
    region.closed(sam.conn);
    for (let i = 0; i < 36; i++) {
      clock.advance(20 * 60_000);
      ada.say({ t: 'battle', to: 2, id: `night${i}`, part: 0, parts: 1, data: `DATA${i}`, away: true });
    }
    // Three before midnight, three after: the rest turned away, and Ada's page told why.
    const kept = ada.got.filter((m) => m.t === 'battleKept');
    const refused = ada.got.filter((m) => m.t === 'battleRefused');
    expect(kept).toHaveLength(2 * REGION_LIMITS.raidsPerDay);
    expect(refused).toHaveLength(36 - 2 * REGION_LIMITS.raidsPerDay);
    expect(refused[0]).toMatchObject({ reason: expect.stringContaining('Samton') });
    // The region says so to every city, before anyone sends another.
    const views = ada.got.filter((m) => m.t === 'region') as Extract<RegionRoomMsg, { t: 'region' }>[];
    expect(views.at(-1)!.region.cities.find((c) => c.slot === 2)!.raidsLeft).toBe(0);
    // Sam comes back in the morning: every raid of the night comes, marked as made while away.
    const back = rawRegion(region);
    back.say(rhello('Sam', { rejoin: { slot: 2, secret: welcome.secret } }));
    const battles = back.got.filter((m) => m.t === 'battle') as Extract<RegionRoomMsg, { t: 'battle' }>[];
    expect(battles).toHaveLength(2 * REGION_LIMITS.raidsPerDay);
    for (const b of battles) expect(b).toMatchObject({ late: true, away: true });
    // A new day: the region allows raids again.
    clock.advance(DAY_MS);
    ada.say({ t: 'battle', to: 2, id: 'nextday', part: 0, parts: 1, data: 'NEXT', away: false });
    expect(ada.got.some((m) => m.t === 'battleKept' && m.id === 'nextday')).toBe(true);
    // Sam, here now, gets it as it comes: not made while away.
    const live = back.got.filter((m) => m.t === 'battle' && m.id === 'nextday');
    expect(live[0]).toMatchObject({ late: false, away: false });
    region.closed(ada.conn);
    region.closed(back.conn);
  });

  it('turns away a raid on a neutral friend, a newcomer that hasn’t struck first, or from an unknown city (M36)', () => {
    const clock = new FakeClock();
    const region = new RegionRoom('6RSHLD', 'local', new MemoryRegionStore(), clock);
    const ada = rawRegion(region);
    ada.say(rhello('Ada', { create: { name: 'Vale', rules: { war: true, scale: 'skirmish' } } }));
    const sam = rawRegion(region);
    sam.say(rhello('Sam'));
    const raid = (from: RawRegion, to: number, id: string, away = false) => {
      clock.advance(10 * 60_000);
      from.say({ t: 'battle', to, id, part: 0, parts: 1, data: id, ...(away ? { away: true } : {}) });
      return from.got.findLast((m) => (m.t === 'battleKept' || m.t === 'battleRefused') && m.id === id);
    };
    // Sam hasn't told the region about its city: nothing can be fought against it yet.
    ada.say(report(0, 5_000, 'Adaton'));
    expect(raid(ada, 2, 'early')).toMatchObject({ t: 'battleRefused' });
    // Neutral, as its own report says.
    const shielded = (shield: string) => ({
      ...report(0, 5_000, 'Samton'),
      report: { ...report().report, shield },
    });
    sam.say(shielded('neutral'));
    expect(raid(ada, 2, 'n1')).toMatchObject({
      t: 'battleRefused',
      reason: expect.stringContaining('neutral'),
    });
    // A newcomer: refused, until it has raided Ada; then Ada may answer.
    sam.say(shielded('new'));
    expect(raid(ada, 2, 'n2')).toMatchObject({
      t: 'battleRefused',
      reason: expect.stringContaining('young'),
    });
    expect(raid(sam, 1, 'samfirst')).toMatchObject({ t: 'battleKept' });
    expect(raid(ada, 2, 'answer')).toMatchObject({ t: 'battleKept' });
    // A day later the window has closed.
    clock.advance(DAY_MS);
    expect(raid(ada, 2, 'late')).toMatchObject({ t: 'battleRefused' });
    // Fought as if Sam were here, but Sam has left: fought again at half strength.
    sam.say(report(0, 5_000, 'Samton'));
    region.closed(sam.conn);
    expect(raid(ada, 2, 'full')).toMatchObject({ t: 'battleRefused', again: true });
    expect(raid(ada, 2, 'full', true)).toMatchObject({ t: 'battleKept' });
    region.closed(ada.conn);
  });

  it('answers every battle, refusing rather than dropping or evicting one, and knows a resend by its sender (M36)', () => {
    const clock = new FakeClock();
    const store = new MemoryRegionStore();
    const region = new RegionRoom('6RANSW', 'local', store, clock, { raidsPerDay: 99 });
    const ada = rawRegion(region);
    ada.say(rhello('Ada', { create: { name: 'Vale', rules: { war: true, scale: 'skirmish' } } }));
    const sam = rawRegion(region);
    sam.say(rhello('Sam'));
    const cleo = rawRegion(region);
    cleo.say(rhello('Cleo'));
    const samWelcome = sam.got.find((m) => m.t === 'rwelcome') as Extract<RegionRoomMsg, { t: 'rwelcome' }>;
    ada.say(report(0, 5_000, 'Adaton'));
    sam.say(report(0, 5_000, 'Samton'));
    cleo.say(report(0, 5_000, 'Cleoton'));
    const answer = (from: RawRegion, id: string) =>
      from.got.findLast((m) => (m.t === 'battleKept' || m.t === 'battleRefused') && m.id === id);
    const raid = (from: RawRegion, to: number, id: string, gap = 10 * 60_000, away = false) => {
      clock.advance(gap);
      from.say({ t: 'battle', to, id, part: 0, parts: 1, data: id, ...(away ? { away: true } : {}) });
      return answer(from, id);
    };
    // Two cities' battles may share an id: each is kept, and Sam gets both.
    expect(raid(ada, 2, 'same')).toMatchObject({ t: 'battleKept' });
    expect(raid(cleo, 2, 'same')).toMatchObject({ t: 'battleKept' });
    expect(sam.got.filter((m) => m.t === 'battle' && m.id === 'same')).toHaveLength(2);
    // Sam has seen Ada's: Ada's sent again is acknowledged, not delivered again.
    sam.say({ t: 'battleSeen', id: 'same', from: 1 });
    raid(ada, 2, 'same');
    expect(ada.got.filter((m) => m.t === 'battleKept' && m.id === 'same')).toHaveLength(2);
    expect(sam.got.filter((m) => m.t === 'battle' && m.id === 'same')).toHaveLength(2);
    // The pace: a few at once, then "later" (the force waits), never silence.
    for (const id of ['p1', 'p2', 'p3']) raid(cleo, 1, id, 1000);
    expect(raid(cleo, 1, 'p4', 1000)).toMatchObject({ t: 'battleRefused', later: REGION_LIMITS.battleEvery });
    // Sam away: the region keeps eight battles for it at most; the ninth is refused, not one evicted.
    region.closed(sam.conn);
    const kept: string[] = [];
    for (let i = 0; kept.length < 8 && i < 20; i++)
      if (raid(ada, 2, `q${i}`, 10 * 60_000, true)?.t === 'battleKept') kept.push(`q${i}`);
    expect(raid(ada, 2, 'q-over', 10 * 60_000, true)).toMatchObject({
      t: 'battleRefused',
      reason: expect.stringContaining('waiting'),
    });
    const back = rawRegion(region);
    back.say(rhello('Sam', { rejoin: { slot: 2, secret: samWelcome.secret } }));
    const waiting = back.got.filter((m) => m.t === 'battle').map((m) => (m as { id: string }).id);
    expect(waiting).toEqual(expect.arrayContaining(kept.slice(-6)));
    expect(waiting).toHaveLength(8);
    // A neutral city raids no one.
    ada.say({ ...report(0, 5_000, 'Adaton'), report: { ...report().report, shield: 'neutral' } });
    expect(raid(ada, 3, 'neutral')).toMatchObject({
      t: 'battleRefused',
      reason: expect.stringContaining('Adaton'),
    });
    // War off: told so.
    ada.say(report(0, 5_000, 'Adaton'));
    ada.say({ t: 'rrules', rules: { war: false, scale: 'skirmish' } });
    expect(raid(cleo, 1, 'off')).toMatchObject({
      t: 'battleRefused',
      reason: expect.stringContaining('War is off'),
    });
    // But a battle the region already holds, sent again (its word lost), is still answered kept:
    // its target takes it, so its sender must too.
    expect(raid(ada, 2, kept.at(-1)!, 10 * 60_000, true)).toMatchObject({ t: 'battleKept' });
    for (const c of [ada, back, cleo]) region.closed(c.conn);
  });

  it('in a region on one player\u2019s computer, turns away raids on a player who isn\u2019t there (M36)', () => {
    const clock = new FakeClock();
    const region = new RegionRoom('ARPEER', 'p2p', new MemoryRegionStore(), clock);
    const ada = rawRegion(region);
    ada.say(rhello('Ada', { create: { name: 'Vale', rules: { war: true, scale: 'skirmish' } } }));
    const sam = rawRegion(region);
    sam.say(rhello('Sam'));
    ada.say(report(0, 5_000, 'Adaton'));
    sam.say(report(0, 5_000, 'Samton'));
    region.closed(sam.conn);
    ada.say({ t: 'battle', to: 2, id: 'gone', part: 0, parts: 1, data: 'X', away: true });
    expect(ada.got.findLast((m) => m.t === 'battleRefused')).toMatchObject({
      id: 'gone',
      reason: expect.stringContaining('isn’t here'),
    });
    region.closed(ada.conn);
  });

  it('keeps the leaving save once, even sent again under the same name (M35)', () => {
    const clock = new FakeClock();
    const { region, store, ada } = openRegion('6RLST2', clock);
    clock.advance(1000);
    ada.say({ t: 'save', id: 's0', part: 0, parts: 1, data: 'FIRST' });
    ada.say({ t: 'save', id: 's1', part: 0, parts: 1, data: 'LEAVING', last: true });
    expect(store.loadCity(1)).toEqual(['LEAVING']);
    const rows = store.rowsWritten;
    for (let i = 0; i < 10; i++)
      ada.say({ t: 'save', id: 's1', part: 0, parts: 1, data: `AGAIN${i}`, last: true });
    expect(store.loadCity(1)).toEqual(['LEAVING']);
    expect(store.rowsWritten).toBe(rows);
    region.closed(ada.conn);
  });

  it('expires when no city has come back for a long while', () => {
    const clock = new FakeClock();
    const { region, ada } = openRegion('7RQUET', clock);
    expect(region.expiresAt()).toBeNull();
    region.closed(ada.conn);
    expect(region.expiresAt()).not.toBeNull();
    expect(region.expiresAt()!).toBeLessThanOrEqual(clock.now() + REGION_LIMITS.ttl);
    expect(region.expiresAt()!).toBeGreaterThan(clock.now() + REGION_LIMITS.ttl - 10 * 60_000);
  });

  it('an honest hour of four cities writes about a hundred rows', () => {
    const clock = new FakeClock();
    const store = new MemoryRegionStore();
    const region = new RegionRoom('9HQNST', 'local', store, clock);
    const names = ['Ada', 'Sam', 'Kit', 'Lee'];
    const cities = names.map((mayor, i) => {
      const c = rawRegion(region);
      c.say(rhello(mayor, i ? {} : { create: { name: 'Vale' } }));
      return c;
    });
    const before = store.rowsWritten;
    // Each city reports every half minute (its people change every time, its offers every ten
    // minutes) and sends a save for visitors every five, as `RegionLink` does.
    for (let s = 0; s < 3600; s += 30)
      cities.forEach((c, i) => {
        clock.advance(30_000 / cities.length);
        c.say(report(10 * Math.floor(s / 600) + i, 1000 + s + i, `${names[i]}ton`));
        if (s % 300 === 0) c.say({ t: 'save', id: `${i}-${s}`, part: 0, parts: 1, data: 'SAVE' });
      });
    const rows = store.rowsWritten - before;
    console.log(`[F8] an hour of four cities in a region: ${rows} rows written`);
    expect(rows).toBeLessThanOrEqual(150);
    for (const c of cities) expect(c.closed).toBeNull();
  });

  it('stops storing at its daily row budget', () => {
    const clock = new FakeClock();
    const store = new MemoryRegionStore();
    const region = new RegionRoom('8RBUDG', 'local', store, { now: clock.now }, { dailyRows: 20 });
    const ada = rawRegion(region);
    ada.say(rhello('Ada', { create: { name: 'Vale' } }));
    for (let i = 0; i < 400; i++) {
      clock.advance(31_000);
      ada.say(report(i));
    }
    expect(REGION_LIMITS.dailyRows).toBe(3000);
    expect(store.rowsWritten).toBeLessThanOrEqual(21);
    // New cities are turned away for the day.
    const late = rawRegion(region);
    late.say(rhello('Lee'));
    expect(late.got.find((m) => m.t === 'error')).toMatchObject({
      text: "This region has reached today's limit; back tomorrow (UTC)",
    });
  });
});

// ---------------------------------------------------------------- signalling

describe('F8: signalling', () => {
  it('closes a peer that floods it (the local relay)', () => {
    const clock = new FakeClock();
    const sig = new Signal(clock);
    const out: string[] = [];
    const host = sig.open((t) => out.push(t));
    let closed = false;
    const peer = sig.open(
      () => undefined,
      () => (closed = true),
    );
    for (let i = 0; i < 1000 && !closed; i++) {
      clock.advance(1);
      sig.message(peer, JSON.stringify({ t: 'to', to: host.id, data: 'x' }));
    }
    expect(closed).toBe(true);
    expect(out.filter((t) => t.includes('"from"')).length).toBeLessThan(150);
  });

  it('closes a peer that floods it, and keeps nothing in storage (the online object)', () => {
    const clock = new FakeClock();
    const s = fakeSockets();
    const hub = new SignalHost(s.sockets, clock.now);
    const join = () => {
      const id = hub.newId();
      const ws = s.open([String(id)]);
      hub.joined(ws, id);
      return { ws, id };
    };
    const host = join();
    hub.message(host.ws, JSON.stringify({ t: 'host' }));
    const guest = join();
    expect(guest.id).not.toBe(host.id);
    expect(guest.ws.got[0]).toMatchObject({ t: 'you', id: guest.id, host: host.id });
    for (let i = 0; i < 1000 && !guest.ws.closed; i++) {
      clock.advance(1);
      hub.message(guest.ws, JSON.stringify({ t: 'to', to: host.id, data: 'x' }));
    }
    expect(guest.ws.closed).not.toBeNull();
    expect(host.ws.got.filter((m) => m.t === 'from').length).toBeLessThan(150);
  });
});

// ---------------------------------------------------------------- nothing stored for nobody

describe('F8: a code nobody hosts stores nothing', () => {
  it('routes rooms and regions by a digit, signalling by a letter, and creates only when asked', () => {
    expect(route('/room/2ABCDE', '')).toEqual({ kind: 'room', code: '2ABCDE', create: false });
    expect(route('/region/2ABCDE', '?create=1')).toEqual({ kind: 'region', code: '2ABCDE', create: true });
    expect(route('/signal/ABCDEF', '')).toEqual({ kind: 'signal', code: 'ABCDEF', create: false });
    expect(route('/room/ABCDEF', '')).toBeNull();
    expect(route('/region/ABCDEF', '')).toBeNull();
    expect(route('/signal/2ABCDE', '')).toBeNull();
    expect(route('/room/2ABCD', '')).toBeNull();
  });

  it('a room: no tables, no rows, for a hello or a create nobody asked for; waking a hosted one writes nothing', async () => {
    const db = await sqlite();
    const clock = new FakeClock();
    const s = fakeSockets();
    let host = new RoomHost(db.sql, s.sockets, clock);
    const probe = s.open();
    host.accept(probe, '2NQBDY', false);
    host.message(probe, hello('Lee'));
    expect(probe.got[0]).toMatchObject({ t: 'error', code: 'no-room' });
    const sneaky = s.open();
    host.accept(sneaky, '2NQBDY', false);
    host.message(sneaky, hello('Lee', create));
    expect(sneaky.got[0]).toMatchObject({ t: 'error' });
    host.closed(probe);
    host.closed(sneaky);
    expect(db.tables()).toEqual([]);
    expect(db.written()).toBe(0);
    expect(host.alarm(clock.now())).toBeNull();

    // Hosted (a socket opened with ?create=1): now it keeps the room.
    const ada = s.open();
    host.accept(ada, '2NQBDY', true);
    host.message(ada, hello('Ada', create));
    expect(ada.got[0]).toMatchObject({ t: 'welcome', join: 'upload' });
    expect(db.tables().length).toBeGreaterThan(0);
    // The object sleeps and wakes (a fresh instance, the sockets still open): nothing is written.
    const written = db.written();
    host = new RoomHost(db.sql, s.sockets, clock);
    host.message(ada, JSON.stringify({ t: 'chat', text: 'still here' }));
    expect(ada.got.at(-1)).toMatchObject({ t: 'chat', text: 'still here' });
    expect(db.written()).toBe(written);

    // Everyone goes; once the room has expired, the alarm forgets it.
    host.closed(ada);
    ada.closed = 'gone';
    const at = host.alarm(clock.now());
    expect(typeof at).toBe('number');
    clock.advance(ROOM_LIMITS.ttl + 1000);
    expect(host.alarm(clock.now())).toBe('forget');
    expect(db.tables()).toEqual([]);
    const late = s.open();
    host.accept(late, '2NQBDY', false);
    host.message(late, hello('Ada'));
    expect(late.got[0]).toMatchObject({ t: 'error', code: 'no-room' });
  });

  it('a region: no tables, no rows, for a hello nobody hosts', async () => {
    const db = await sqlite();
    const clock = new FakeClock();
    const s = fakeSockets();
    const host = new RegionHost(db.sql, s.sockets, clock);
    const probe = s.open();
    host.accept(probe, '2NQREG', false);
    host.message(probe, JSON.stringify(rhello('Lee')));
    expect(probe.got[0]).toMatchObject({ t: 'error', code: 'no-region' });
    host.message(probe, JSON.stringify({ t: 'visit', slot: 1 }));
    const sneaky = s.open();
    host.accept(sneaky, '2NQREG', false);
    host.message(sneaky, JSON.stringify(rhello('Lee', { create: { name: 'Vale' } })));
    expect(sneaky.got[0]).toMatchObject({ t: 'error' });
    expect(db.tables()).toEqual([]);
    expect(db.written()).toBe(0);
    const ada = s.open();
    host.accept(ada, '2NQREG', true);
    host.message(ada, JSON.stringify(rhello('Ada', { create: { name: 'Vale' } })));
    expect(ada.got.find((m) => m.t === 'rwelcome')).toMatchObject({ slot: 1 });
    expect(db.tables().length).toBeGreaterThan(0);
  });

  it('the in-memory store counts rows as SQLite does', async () => {
    const db = await sqlite();
    const sqlStore = new SqlStore(db.sql);
    const mem = new MemoryStore();
    const ev = (seq: number): Stamped => ({
      tick: seq,
      seq,
      ev: { kind: 'settle', taker: 1, reason: 'snapshot' },
    });
    const meta = { info: {}, players: [], nextPlayer: 1, seq: 0, allowed: 0, kicked: [], snapshotSeq: null };
    const snap = (seq: number, parts: number) => ({
      meta: { id: 's', tick: 0, seq, eventHash: 0, parts, cityName: 'X', population: 0 },
      parts: Array.from({ length: parts }, (_, i) => `P${i}`),
    });
    for (const store of [sqlStore, mem]) {
      store.saveMeta(meta as never);
      store.appendEvents([ev(0), ev(1)]);
      store.appendEvents([ev(2), ev(3), ev(4)]);
      store.saveSnapshot(snap(3, 3));
      store.appendEvents([ev(5)]);
      store.saveSnapshot(snap(5, 2));
      store.saveMeta(meta as never);
    }
    expect(mem.rowsWritten).toBe(db.written());
    expect(sqlStore.rowsWritten).toBe(db.written());
    expect(sqlStore.loadEvents().map((e) => e.seq)).toEqual([]);
    expect(sqlStore.loadSnapshot()!.parts).toEqual(['P0', 'P1']);
  });
});

// ---------------------------------------------------------------- the local relay

describe('F8: the local relay', () => {
  it('as players run it: makes rooms only when asked, by the right kind of code', async () => {
    const relay = await startRelay(0, null, { strict: true });
    try {
      const url = `ws://127.0.0.1:${relay.port}`;
      const wrongKind = await listen(await webSocketLink(`${url}/room/ABCDEF`));
      await until(() => wrongKind.closed(), 5000, 'the close');
      const unasked = await listen(await webSocketLink(`${url}/room/2ABCDE`));
      unasked.link.send(hello('Ada', create));
      await until(() => unasked.got.length > 0, 5000, 'an answer');
      expect(unasked.got[0]).toMatchObject({ t: 'error' });
      const asked = await listen(await webSocketLink(`${url}/room/2ABCDE?create=1`));
      asked.link.send(hello('Ada', create));
      await until(() => asked.got.length > 0, 5000, 'an answer');
      expect(asked.got[0]).toMatchObject({ t: 'welcome' });
      asked.link.close();
    } finally {
      await relay.close();
    }
  });

  it('forgets idle rooms, regions and signalling, and their files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'citybloom-relay-'));
    const relay = await startRelay(0, dir, { ttl: 1000 });
    try {
      const url = `ws://127.0.0.1:${relay.port}`;
      const ada = await listen(await webSocketLink(`${url}/room/2QUETA`));
      ada.link.send(hello('Ada', create));
      ada.link.send(
        JSON.stringify({
          t: 'snap',
          meta: { id: 'up', tick: 0, seq: -1, eventHash: 0, parts: 1, cityName: 'X', population: 0 },
          part: 0,
          data: 'AAAA',
        }),
      );
      await until(() => readdirSync(dir).length > 0, 5000, 'the room file');
      const sig = await listen(await webSocketLink(`${url}/signal/QUETAB`));
      await until(() => sig.got.length > 0, 5000, 'signalling');
      const reg = await listen(await webSocketLink(`${url}/region/2QUETB`));
      reg.link.send(JSON.stringify(rhello('Ada', { create: { name: 'Vale' } })));
      await until(() => reg.got.length > 0, 5000, 'the region');
      const probe = await listen(await webSocketLink(`${url}/room/2NQBDX`));
      probe.link.send(hello('Lee'));
      await until(() => probe.closed(), 5000, 'the probe turned away');
      for (const c of [ada, sig, reg]) c.link.close();
      await until(() => relay.signals.size === 0, 5000, 'signalling to empty');
      await until(() => !relay.rooms.has('2NQBDX'), 5000, 'the probed code to be forgotten');
      await until(() => relay.rooms.get('2QUETA')?.online === 0, 5000, 'the room to empty');
      relay.sweep(Date.now());
      expect(relay.rooms.has('2QUETA')).toBe(true);
      relay.sweep(Date.now() + 5000);
      expect(relay.rooms.size).toBe(0);
      expect(relay.regions.size).toBe(0);
      expect(existsSync(join(dir, '2QUETA.json'))).toBe(false);
    } finally {
      await relay.close();
    }
  });
});

describe('F8: a city too big to share', () => {
  /** A snapshot past the cap (8 MB gzipped): random text doesn't pack. */
  const bigSave = () =>
    ({
      meta: { tick: 0, cityName: 'Bigby', population: 0 },
      junk: randomBytes(9_000_000).toString('base64'),
    }) as unknown as SaveFile;

  it('a host is told so in words, not left waiting for a room that never opens', async () => {
    const room = makeRoom('6BIGBY');
    const ada = player('Ada', loopTo(room), Sim.create({ seed: 'bigby' }), { create: { cityName: 'Bigby' } });
    // The upload a city past the cap would make, posted on a later turn as the worker posts it.
    ada.driver.share = () =>
      void setTimeout(() =>
        (ada.driver as unknown as { emit(m: SharedMessage): void }).emit({
          type: 'snapshot',
          tick: 0,
          reason: 'upload',
          snapshot: { save: bigSave(), history: [], seq: -1, eventHash: 0 },
        }),
      );
    try {
      await expect(ada.session.start()).rejects.toThrow(/too big to share/);
      expect(ada.session.state).toBe('closed');
    } finally {
      stopAll([ada]);
    }
  }, 60_000);

  it('a region still hears how the city stands, without its save for visitors', async () => {
    const region = new RegionRoom('6BIGRG', 'local', new MemoryRegionStore(), {
      now: () => performance.now(),
    });
    const sim = Sim.create({ seed: 'bigrg', cityName: 'Bigby' });
    const link = new RegionLink(
      {
        command: async (cmd) => sim.dispatch(cmd),
        report: async () => regionReport(sim),
        save: async () => bigSave(),
        cityName: () => sim.state.cityName,
      },
      async () => {
        const [mine, theirs] = loopbackPair();
        const conn = { send: (m: unknown) => theirs.send(JSON.stringify(m)), close: () => theirs.close() };
        region.open(conn);
        theirs.onmessage = (t) => region.message(conn, t);
        theirs.onclose = () => region.closed(conn);
        return mine;
      },
      { mayor: 'Ada', color: 0, create: { name: 'Vale' } },
    );
    try {
      await link.start();
      await expect(link.reportNow(true)).resolves.toBeUndefined();
      expect(link.state).toBe('in');
      await until(() => !!region.view().cities[0]?.report, 5000, 'the report');
      expect(region.view().cities[0].visitable).toBe(false);
    } finally {
      link.leave();
    }
  }, 60_000);
});
