import { describe, expect, it } from 'vitest';
import {
  MAX_CITIES,
  MemoryRegionStore,
  REGION_LIMITS,
  RegionRoom,
  parseRegionMsg,
  type RegionConn,
  type RegionLimits,
  type RegionRoomMsg,
} from '../region';
import { LIVE, MIN_REGION_PROTOCOL, PROTOCOL_VERSION } from '../protocol';
import { DAY_MS } from '../limits';
import { RegionHost, type HostSocket, type SocketTag } from '../objects';
import type { Sql } from '../sqlStore';
import { FakeClock } from './harness';

/**
 * M39, step 2: the region room's live battles (protocol 6, design call 3), with fake pages and a
 * fake clock. The room keeps a battle between two players in memory, paces it by the slower page,
 * stamps both players' orders at the frontier, hands a silent combatant over, and writes once, when
 * the battle ends. It reads no battle: inputs and orders are opaque to it.
 */

interface Raw {
  got: RegionRoomMsg[];
  conn: RegionConn;
  say(m: object): void;
  closed: string | null;
}

function raw(room: RegionRoom): Raw {
  const r: Raw = {
    got: [],
    closed: null,
    conn: null as unknown as RegionConn,
    say: (m) => room.message(r.conn, JSON.stringify(m)),
  };
  r.conn = { send: (m) => r.got.push(m), close: (_c, reason) => (r.closed = reason || 'closed') };
  room.open(r.conn);
  return r;
}

const hello = (mayor: string, extra: Record<string, unknown> = {}) => ({
  t: 'rhello',
  v: PROTOCOL_VERSION,
  mayor,
  color: 0,
  city: `${mayor}ton`,
  ...extra,
});

const report = (city: string, extra: Record<string, unknown> = {}) => ({
  t: 'report',
  city,
  report: {
    population: 5_000,
    kind: 'suburb',
    workers: 10,
    jobs: 10,
    shoppers: 5,
    offers: { buy: { power: 0, water: 0, garbage: 0 }, sell: { power: 0, water: 0, garbage: 0 } },
    deals: [],
    projectBuilt: false,
    tiers: [0, 0, 0, 0, 2, 0],
    counter: 250,
    clock: 100,
    ...extra,
  },
});

type Msg<T extends RegionRoomMsg['t']> = Extract<RegionRoomMsg, { t: T }>;
const all = <T extends RegionRoomMsg['t']>(r: Raw, t: T) => r.got.filter((m) => m.t === t) as Msg<T>[];
const last = <T extends RegionRoomMsg['t']>(r: Raw, t: T) => all(r, t).at(-1);
const LIVE_TYPES = ['bcall', 'bliveoff', 'bstart', 'ballow', 'bend', 'blivenow', 'breplaydata'];
const live = (r: Raw) => r.got.filter((m) => LIVE_TYPES.includes(m.t));
const notices = (r: Raw) => all(r, 'notice').map((n) => n.text);

/** A fast pager's limits: a test sends far more than two messages a second. */
const BUSY: Partial<RegionLimits> = { rate: 1_000, burst: 100_000 };

interface World {
  clock: FakeClock;
  store: MemoryRegionStore;
  room: RegionRoom;
  ada: Raw;
  sam: Raw;
  kit?: Raw;
  lou?: Raw;
  secrets: Record<string, string>;
  /** Ada starts a live battle against Sam (city 2) and Sam answers; both are in it. */
  fight(id?: string, input?: string): void;
}

/**
 * A region at war (superweapons on) with Ada's city (slot 1) and Sam's (2), and Kit's and Lou's
 * (3, 4) if `cities` is four, each reported. `kind` is where the room runs.
 */
function world(
  opts: { cities?: 2 | 4; kind?: 'local' | 'p2p'; limits?: Partial<RegionLimits>; supers?: boolean } = {},
): World {
  const clock = new FakeClock();
  // Midday UTC, so a test's day doesn't end under it.
  clock.advance(((Math.ceil(clock.t / DAY_MS) * DAY_MS - clock.t) % DAY_MS) + 12 * 3600_000);
  const store = new MemoryRegionStore();
  const room = new RegionRoom('7LIVE1', opts.kind ?? 'local', store, { now: clock.now }, opts.limits ?? {});
  const ada = raw(room);
  ada.say(
    hello('Ada', {
      create: { name: 'Vale', rules: { war: true, scale: 'skirmish', supers: opts.supers ?? true } },
    }),
  );
  const sam = raw(room);
  sam.say(hello('Sam'));
  const secrets: Record<string, string> = {
    Ada: last(ada, 'rwelcome')!.secret,
    Sam: last(sam, 'rwelcome')!.secret,
  };
  ada.say(report('Adaton'));
  sam.say(report('Samton'));
  let kit: Raw | undefined;
  let lou: Raw | undefined;
  if (opts.cities === 4) {
    kit = raw(room);
    kit.say(hello('Kit'));
    kit.say(report('Kitton'));
    lou = raw(room);
    lou.say(hello('Lou'));
    lou.say(report('Louton'));
    secrets.Kit = last(kit, 'rwelcome')!.secret;
    secrets.Lou = last(lou, 'rwelcome')!.secret;
  }
  const w: World = {
    clock,
    store,
    room,
    ada,
    sam,
    ...(kit ? { kit } : {}),
    ...(lou ? { lou } : {}),
    secrets,
    fight(id = 'L1', input = 'INPUT-A') {
      ada.say(call(id));
      sam.say({ t: 'binput', id, part: 0, parts: 1, data: input });
    },
  };
  return w;
}

const FORCE = { name: 'Adaton', units: [1, 2, 3], stance: 'bold' };
const call = (id: string, to = 2, extra: Record<string, unknown> = {}) => ({
  t: 'blive',
  to,
  id,
  force: FORCE,
  ...extra,
});
const step = (id: string, n: number, orders?: object[]) => ({
  t: 'bstep',
  id,
  step: n,
  ...(orders ? { orders } : {}),
});

describe('M39: the region room’s live battles', () => {
  it('reads only sensible live messages', () => {
    const ok = [
      { t: 'blive', to: 2, id: 'exp-1a2b-7', force: { units: [1, 2] } },
      { t: 'blive', to: 2, id: 'exp-1a2b-7', force: { units: [1] }, super: true },
      { t: 'binput', id: 'exp-1', part: 0, parts: 1, data: 'abc' },
      { t: 'bdecline', id: 'exp-1' },
      { t: 'bstep', id: 'exp-1', step: 0 },
      {
        t: 'bstep',
        id: 'exp-1',
        step: 12,
        orders: [
          { kind: 'focus', target: 4 },
          { kind: 'hold', units: [1, 2] },
        ],
      },
      // A unit's id may be negative (M39 step 3): the defender's `focus` on a drone a sky fortress
      // carries (the drones are −1000, −1001…), and orders naming such units.
      {
        t: 'bstep',
        id: 'exp-1',
        step: 12,
        orders: [
          { kind: 'focus', target: -1000 },
          { kind: 'hold', units: [-1001, 3, -1e6] },
          { kind: 'focus', target: 1e6 },
        ],
      },
      { t: 'bdone', id: 'exp-1', step: 700, hash: '0123456789abcdef' },
      { t: 'bjoin', id: 'exp-1' },
      { t: 'bwatch', id: 'exp-1' },
      { t: 'bwatch', id: 'exp-1', from: 3 },
      { t: 'bunwatch', id: 'exp-1' },
      { t: 'breplay', id: 'exp-1', from: 1 },
    ];
    for (const m of ok) expect(parseRegionMsg(JSON.stringify(m)), JSON.stringify(m)).toEqual(m);
    // An empty list of orders is no orders.
    expect(parseRegionMsg(JSON.stringify({ t: 'bstep', id: 'x', step: 1, orders: [] }))).toEqual({
      t: 'bstep',
      id: 'x',
      step: 1,
    });
    // An order's other keys are dropped, not passed on (the room stamps its own).
    expect(
      parseRegionMsg(
        JSON.stringify({
          t: 'bstep',
          id: 'x',
          step: 1,
          orders: [{ kind: 'free', step: 9, side: 1, seq: 3 }],
        }),
      ),
    ).toEqual({ t: 'bstep', id: 'x', step: 1, orders: [{ kind: 'free' }] });
    const deep = (n: number): object => (n ? { a: deep(n - 1) } : {});
    const bad: object[] = [
      { t: 'blive', to: 0, id: 'x', force: {} },
      { t: 'blive', to: 2, id: 'has spaces', force: {} },
      { t: 'blive', to: 2, id: 'x', force: [] },
      { t: 'blive', to: 2, id: 'x', force: 'units' },
      { t: 'blive', to: 2, id: 'x' },
      { t: 'blive', to: 2, id: 'x', force: { pad: 'x'.repeat(LIVE.forceChars) } },
      { t: 'blive', to: 2, id: 'x', force: deep(40) },
      { t: 'binput', id: 'x', part: 0, parts: LIVE.inputParts + 1, data: 'a' },
      { t: 'binput', id: 'x', part: 1, parts: 1, data: 'a' },
      { t: 'binput', id: 'x', part: 0, parts: 1, data: 5 },
      { t: 'bstep', id: 'x', step: -1 },
      { t: 'bstep', id: 'x', step: 1.5 },
      { t: 'bstep', id: 'x', step: 2e6 },
      {
        t: 'bstep',
        id: 'x',
        step: 1,
        orders: Array.from({ length: LIVE.perMessage + 1 }, () => ({ kind: 'hold' })),
      },
      { t: 'bstep', id: 'x', step: 1, orders: [{ kind: 'Focus' }] },
      { t: 'bstep', id: 'x', step: 1, orders: [{ kind: 'focus', target: -1e6 - 1 }] },
      { t: 'bstep', id: 'x', step: 1, orders: [{ kind: 'focus', target: 1e6 + 1 }] },
      { t: 'bstep', id: 'x', step: 1, orders: [{ kind: 'hold', units: [-1e6 - 1] }] },
      { t: 'bstep', id: 'x', step: 1, orders: [{ kind: 'focus', target: 1.5 }] },
      { t: 'bstep', id: 'x', step: 1, orders: [{ kind: 'hold', units: [1, 'a'] }] },
      {
        t: 'bstep',
        id: 'x',
        step: 1,
        orders: [{ kind: 'hold', units: Array.from({ length: LIVE.units + 1 }, (_, i) => i) }],
      },
      { t: 'bstep', id: 'x', step: 1, orders: 'hold' },
      { t: 'bdone', id: 'x', step: 5, hash: 'has spaces' },
      { t: 'bdone', id: 'x', step: 5 },
      { t: 'bjoin' },
      { t: 'bwatch', id: 'x', from: 0 },
    ];
    for (const m of bad) expect(parseRegionMsg(JSON.stringify(m)), JSON.stringify(m).slice(0, 80)).toBeNull();
  });

  it('runs a live battle from the call to the end, and writes nothing while it runs', () => {
    const w = world({ cities: 4 });
    const { ada, sam, kit, lou, store, room, clock } = w;
    const rows = store.rowsWritten;
    ada.say(call('L1'));
    // The defender is called with the attacker's force, as sent.
    expect(all(sam, 'bcall')).toEqual([{ t: 'bcall', id: 'L1', from: 1, force: FORCE }]);
    expect(live(ada)).toHaveLength(0);
    sam.say({ t: 'binput', id: 'L1', part: 0, parts: 1, data: 'INPUT-A' });
    // Both are in it, each told its side, the input, the frontier and what's stamped so far.
    const starts = (r: Raw) => all(r, 'bstart');
    expect(starts(ada)).toEqual([
      {
        t: 'bstart',
        id: 'L1',
        role: 'attacker',
        attacker: 1,
        defender: 2,
        input: ['INPUT-A'],
        allow: LIVE.lead,
        orders: [],
        handed: [],
      },
    ]);
    expect(starts(sam)[0]).toMatchObject({ role: 'defender', allow: LIVE.lead });
    // The others hear that it's on, to watch, and nothing else.
    expect(all(kit!, 'blivenow')).toEqual([{ t: 'blivenow', id: 'L1', from: 1, to: 2 }]);
    expect(all(lou!, 'blivenow')).toHaveLength(1);
    expect(all(ada, 'blivenow')).toHaveLength(0);
    expect(starts(kit!)).toHaveLength(0);
    // The raid is counted in the target's day.
    expect(room.view().cities.find((c) => c.slot === 2)!.raidsLeft).toBe(REGION_LIMITS.raidsPerDay - 1);
    // Both pages run; each says how far. The frontier follows the slower by the lead.
    clock.advance(500);
    ada.say(step('L1', 20));
    expect(last(ada, 'ballow')).toBeUndefined(); // Sam hasn't moved: the frontier stays
    sam.say(step('L1', 10));
    expect(last(ada, 'ballow')).toEqual({ t: 'ballow', id: 'L1', allow: 10 + LIVE.lead });
    expect(last(sam, 'ballow')).toEqual({ t: 'ballow', id: 'L1', allow: 10 + LIVE.lead });
    expect(all(kit!, 'ballow')).toHaveLength(0);
    // Nothing was written while it ran.
    expect(store.rowsWritten).toBe(rows);
    // Both reach the end, agreeing.
    clock.advance(500);
    ada.say({ t: 'bdone', id: 'L1', step: 700, hash: 'cafe0123cafe0123' });
    expect(all(sam, 'bend')).toHaveLength(0);
    sam.say({ t: 'bdone', id: 'L1', step: 700, hash: 'cafe0123cafe0123' });
    const end = { t: 'bend', id: 'L1', from: 1, to: 2, step: 700, hash: 'cafe0123cafe0123', agree: true };
    for (const r of [ada, sam, kit!, lou!]) expect(all(r, 'bend')).toEqual([end]);
    // It's kept for replays, and written now (the record's row and the region's).
    expect(store.rowsWritten).toBeGreaterThan(rows);
    expect(store.rowsWritten - rows).toBeLessThanOrEqual(4);
    // Sam was here at the end: nothing is kept for it as a pending battle.
    const pending = (
      room as unknown as { meta: { cities: { slot: number; pending?: unknown[] }[] } }
    ).meta.cities.find((c) => c.slot === 2)!.pending;
    expect(pending).toBeUndefined();
    // Any city may ask for the record: the input and the orders stamped in it.
    kit!.say({ t: 'breplay', id: 'L1' });
    expect(last(kit!, 'breplaydata')).toEqual({
      t: 'breplaydata',
      id: 'L1',
      from: 1,
      to: 2,
      record: {
        v: 1,
        id: 'L1',
        from: 1,
        to: 2,
        input: ['INPUT-A'],
        orders: [],
        end: { step: 700, hash: 'cafe0123cafe0123', agree: true },
      },
    });
    // And it's over: a late step is answered that the region has no such battle.
    ada.say(step('L1', 701));
    expect(last(ada, 'bliveoff')).toMatchObject({ id: 'L1', gone: true });
  });

  it('stamps both players’ orders at the frontier, in the order they came, and sends them to everyone', () => {
    const w = world({ cities: 4 });
    const { ada, sam, kit, clock } = w;
    w.fight();
    kit!.say({ t: 'bwatch', id: 'L1' });
    clock.advance(500);
    ada.say(step('L1', 0));
    sam.say(step('L1', 0, [{ kind: 'guard', target: 7 }]));
    // Stamped at the frontier (32), the defender's side is 1, seq counts from 1.
    const first: object = { kind: 'guard', target: 7, seq: 1, step: 32, side: 1 };
    for (const r of [ada, sam, kit!])
      expect(last(r, 'ballow')).toEqual({ t: 'ballow', id: 'L1', allow: 32, ords: [first] });
    // The attacker answers in the same moment: the next seq, the same step, side 0.
    ada.say(step('L1', 0, [{ kind: 'focus', units: [1, 2], target: 3 }, { kind: 'hold' }]));
    const second: object[] = [
      { kind: 'focus', units: [1, 2], target: 3, seq: 2, step: 32, side: 0 },
      { kind: 'hold', seq: 3, step: 32, side: 0 },
    ];
    for (const r of [ada, sam, kit!])
      expect(last(r, 'ballow')).toEqual({ t: 'ballow', id: 'L1', allow: 32, ords: second });
    // The frontier moves on; an order now is stamped at the new frontier, never an old one.
    clock.advance(500);
    ada.say(step('L1', 20));
    sam.say(step('L1', 20, [{ kind: 'free' }]));
    expect(last(sam, 'ballow')).toEqual({
      t: 'ballow',
      id: 'L1',
      allow: 52,
      ords: [{ kind: 'free', seq: 4, step: 32, side: 1 }],
    });
    // (stamped before the same message moved the frontier: every page is still below 32 or at it)
    clock.advance(500);
    ada.say(step('L1', 40, [{ kind: 'withdraw' }]));
    expect(last(ada, 'ballow')).toEqual({
      t: 'ballow',
      id: 'L1',
      allow: 52,
      ords: [{ kind: 'withdraw', seq: 5, step: 52, side: 0 }],
    });
    // The log a late joiner gets is what was stamped, in order.
    kit!.say({ t: 'bunwatch', id: 'L1' });
    const lou = w.lou!;
    lou.say({ t: 'bwatch', id: 'L1' });
    expect(last(lou, 'bstart')!.orders.map((o) => o.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(last(lou, 'bstart')!.orders.map((o) => `${o.side}${o.kind}@${o.step}`)).toEqual([
      '1guard@32',
      '0focus@32',
      '0hold@32',
      '1free@32',
      '0withdraw@52',
    ]);
  });

  it('paces a battle by its slower page: the frontier is its step plus the lead, and never moves back', () => {
    const w = world();
    const { ada, sam, clock } = w;
    w.fight();
    const allows = (r: Raw) => all(r, 'ballow').map((m) => m.allow);
    const send = (r: Raw, n: number) => {
      clock.advance(500);
      r.say(step('L1', n));
    };
    send(ada, 30); // the page can't run past the frontier: its claim is held to it
    send(sam, 5);
    expect(allows(ada)).toEqual([5 + LIVE.lead]);
    send(sam, 5); // nothing new: nothing sent
    send(sam, 3); // a page's step doesn't go back, nor the frontier
    expect(allows(ada)).toEqual([5 + LIVE.lead]);
    send(sam, 9);
    send(ada, 37); // now the slower is Sam at 9
    expect(allows(ada)).toEqual([37, 41]);
    // However far the faster page claims to be, the frontier is the slower's plus the lead.
    send(ada, 41);
    send(ada, 41);
    expect(Math.max(...allows(sam))).toBe(9 + LIVE.lead);
    send(sam, 41);
    expect(allows(sam).at(-1)).toBe(41 + LIVE.lead);
    // Every message to both pages: the same frontier at the same time.
    expect(allows(ada)).toEqual(allows(sam));
    // Increasing, always.
    const seen = allows(sam);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
  });

  it('hands a silent defender over to the battle’s judgement after ten seconds, refuses its orders, and paces by the other', () => {
    const w = world();
    const { ada, sam, clock } = w;
    w.fight();
    clock.advance(500);
    ada.say(step('L1', 10));
    sam.say(step('L1', 10));
    expect(last(ada, 'ballow')!.allow).toBe(42);
    // Sam says nothing; Ada plays on. Before ten seconds nothing happens.
    clock.advance(LIVE.silent - 1_000);
    ada.say(step('L1', 30));
    expect(all(ada, 'ballow').filter((m) => m.ords)).toHaveLength(0);
    clock.advance(1_000);
    // (any message reaches the room, Ada's step among them)
    ada.say(step('L1', 31));
    // Samton's side is handed over: a `free` for side 1 at the frontier (42), to every page in it; and
    // pacing is Ada's alone, so the same message moves the frontier with her step (30).
    const freed = all(ada, 'ballow').filter((m) => m.ords);
    expect(freed).toHaveLength(1);
    expect(freed[0]).toEqual({
      t: 'ballow',
      id: 'L1',
      allow: 30 + LIVE.lead,
      ords: [{ kind: 'free', seq: 1, step: 42, side: 1 }],
    });
    expect(all(sam, 'ballow').filter((m) => m.ords)).toHaveLength(1);
    expect(notices(ada)).toContain('Samton’s forces fight on their own now');
    clock.advance(500);
    ada.say(step('L1', 40));
    expect(last(ada, 'ballow')!.allow).toBe(40 + LIVE.lead);
    // A handed-over page's orders are refused (it's told why), though it may be only slow.
    const stamped = all(ada, 'ballow').length;
    sam.say(step('L1', 12, [{ kind: 'guard', target: 3 }]));
    expect(notices(sam).at(-1)).toMatch(/fighting on their own/);
    expect(all(ada, 'ballow').flatMap((m) => m.ords ?? [])).toHaveLength(1);
    // Its steps count for pacing again while it's heard (the frontier holds, it never moves back)...
    clock.advance(500);
    ada.say(step('L1', 60));
    expect(all(ada, 'ballow').length).toBe(stamped);
    // ...but not once it has gone quiet again.
    clock.advance(LIVE.silent);
    ada.say(step('L1', 70));
    expect(last(ada, 'ballow')!.allow).toBe(70 + LIVE.lead);
    // Sam comes back (`bjoin`): the whole battle from its input and every order, and command again.
    sam.say({ t: 'bjoin', id: 'L1' });
    const again = last(sam, 'bstart')!;
    expect(again).toMatchObject({ role: 'defender', input: ['INPUT-A'], handed: [] });
    expect(again.allow).toBe(70 + LIVE.lead);
    expect(again.orders).toEqual([{ kind: 'free', seq: 1, step: 42, side: 1 }]);
    expect(notices(ada)).toContain('Samton is back in command');
    // Its orders stamp again, at the frontier.
    clock.advance(500);
    sam.say(step('L1', 5, [{ kind: 'focus', target: 2 }]));
    expect(
      all(ada, 'ballow')
        .flatMap((m) => m.ords ?? [])
        .at(-1),
    ).toEqual({
      kind: 'focus',
      target: 2,
      seq: 2,
      step: 70 + LIVE.lead,
      side: 0 + 1,
    });
    // It is at step 5 again: the frontier holds until it has caught up (it never moves back).
    expect(last(ada, 'ballow')!.allow).toBe(70 + LIVE.lead);
  });

  it('hands a combatant over at once when its connection closes, and hands it back when it joins again', () => {
    const w = world();
    const { ada, sam, room, clock, secrets } = w;
    w.fight();
    clock.advance(500);
    ada.say(step('L1', 8));
    sam.say(step('L1', 8));
    room.closed(sam.conn);
    // No waiting for ten seconds: its units are free at the frontier, and Ada is told.
    expect(last(ada, 'ballow')).toEqual({
      t: 'ballow',
      id: 'L1',
      allow: 40,
      ords: [{ kind: 'free', seq: 1, step: 40, side: 1 }],
    });
    clock.advance(500);
    ada.say(step('L1', 20));
    expect(last(ada, 'ballow')!.allow).toBe(20 + LIVE.lead);
    // A new connection for the same city: the welcome names the battle on, `bjoin` brings it back.
    const back = raw(room);
    back.say(hello('Sam', { rejoin: { slot: 2, secret: secrets.Sam } }));
    expect(all(back, 'blivenow')).toEqual([{ t: 'blivenow', id: 'L1', from: 1, to: 2 }]);
    back.say({ t: 'bjoin', id: 'L1' });
    expect(last(back, 'bstart')).toMatchObject({
      role: 'defender',
      input: ['INPUT-A'],
      handed: [],
      orders: [{ kind: 'free', side: 1 }],
    });
    expect(notices(ada)).toContain('Samton is back in command');
  });

  it('hands a side over only once: a flood from a combatant is dropped, and a torrent closes it and hands it over', () => {
    const w = world();
    const { ada, sam, clock } = w;
    w.fight();
    clock.advance(500);
    sam.say(step('L1', 5));
    // Two messages a second, a burst of sixty: the rest of a flood is dropped, a torrent closes the link.
    for (let i = 0; i < 200 && !sam.closed; i++) sam.say(step('L1', 5));
    expect(sam.closed).toBe('rate');
    const freed = all(ada, 'ballow').flatMap((m) => m.ords ?? []);
    expect(freed).toEqual([{ kind: 'free', seq: 1, step: LIVE.lead, side: 1 }]);
  });

  it('ends a battle when one page has finished and the other was left behind, and says so', () => {
    const w = world();
    const { ada, sam, clock } = w;
    w.fight();
    clock.advance(500);
    ada.say(step('L1', 20));
    sam.say(step('L1', 20));
    ada.say({ t: 'bdone', id: 'L1', step: 700, hash: 'aaaa' });
    // Sam hasn't finished: it's waited for, for a while.
    expect(all(sam, 'bend')).toHaveLength(0);
    clock.advance(LIVE.silent - 1);
    ada.say('ping' as unknown as object); // a ping (as the page sends) reaches the room
    sam.say(step('L1', 100));
    clock.advance(LIVE.silent);
    // Sam goes silent: handed over, and the battle ends with Ada's word alone.
    w.room.message(ada.conn, 'ping');
    expect(all(sam, 'bend')).toEqual([
      { t: 'bend', id: 'L1', from: 1, to: 2, step: 700, hash: 'aaaa', agree: true, solo: true },
    ]);
  });

  it('says when the two pages disagree: the defender’s hash stands', () => {
    const w = world();
    const { ada, sam } = w;
    w.fight();
    ada.say({ t: 'bdone', id: 'L1', step: 700, hash: 'aaaa' });
    sam.say({ t: 'bdone', id: 'L1', step: 700, hash: 'bbbb' });
    expect(last(ada, 'bend')).toEqual({
      t: 'bend',
      id: 'L1',
      from: 1,
      to: 2,
      step: 700,
      hash: 'bbbb',
      agree: false,
    });
    // The same hash at another step is no agreement either.
    const w2 = world();
    w2.fight('L2');
    w2.ada.say({ t: 'bdone', id: 'L2', step: 700, hash: 'cccc' });
    w2.sam.say({ t: 'bdone', id: 'L2', step: 701, hash: 'cccc' });
    expect(last(w2.ada, 'bend')).toMatchObject({ agree: false, step: 701 });
  });

  it('calls off a call the defender doesn’t answer in twenty seconds, and the old way is open', () => {
    const w = world({ cities: 4 });
    const { ada, sam, kit, clock, room } = w;
    const raidsLeft = () => room.view().cities.find((c) => c.slot === 2)!.raidsLeft;
    const before = raidsLeft();
    ada.say(call('L5'));
    expect(all(sam, 'bcall')).toHaveLength(1);
    clock.advance(LIVE.call - 1_000);
    kit!.say(report('Kitton'));
    expect(live(ada)).toHaveLength(0);
    clock.advance(1_000);
    kit!.say(report('Kitton'));
    expect(last(ada, 'bliveoff')).toEqual({ t: 'bliveoff', id: 'L5', why: 'Samton’s player didn’t answer' });
    expect(last(sam, 'bliveoff')).toMatchObject({ id: 'L5' });
    // Nothing was counted: the old way takes the pace and the raid, once.
    expect(raidsLeft()).toBe(before);
    // Sam's late answer is told the call is over, and starts nothing.
    sam.say({ t: 'binput', id: 'L5', part: 0, parts: 1, data: 'LATE' });
    expect(all(sam, 'bliveoff')).toHaveLength(2);
    expect(live(ada).filter((m) => m.t === 'bstart')).toHaveLength(0);
    ada.say({ t: 'battle', to: 2, id: 'L5', part: 0, parts: 1, data: 'X' });
    expect(last(ada, 'battleKept')).toEqual({ t: 'battleKept', id: 'L5' });
    expect(raidsLeft()).toBe(before! - 1);
    expect(last(sam, 'battle')).toMatchObject({ id: 'L5', from: 1, late: false });
    expect(last(sam, 'battle')).not.toHaveProperty('live');
  });

  it('a defender who declines sends the attacker the old way, charging nothing', () => {
    const w = world();
    const { ada, sam, room } = w;
    ada.say(call('D1'));
    sam.say({ t: 'bdecline', id: 'D1' });
    expect(last(ada, 'bliveoff')).toEqual({
      t: 'bliveoff',
      id: 'D1',
      why: 'Samton would rather not fight live',
    });
    expect(room.view().cities.find((c) => c.slot === 2)!.raidsLeft).toBe(REGION_LIMITS.raidsPerDay);
    ada.say({ t: 'battle', to: 2, id: 'D1', part: 0, parts: 1, data: 'X' });
    expect(last(ada, 'battleKept')?.id).toBe('D1');
  });

  it('a call to a city that isn’t here is turned off at once, and the old way takes the same id once', () => {
    const w = world();
    const { ada, sam, room } = w;
    const raidsLeft = () => room.view().cities.find((c) => c.slot === 2)!.raidsLeft;
    room.closed(sam.conn);
    ada.say(call('A1'));
    // At once, with the reason, and the old way (no `refused`).
    expect(last(ada, 'bliveoff')).toEqual({ t: 'bliveoff', id: 'A1', why: 'Samton’s player isn’t here' });
    expect(raidsLeft()).toBe(REGION_LIMITS.raidsPerDay);
    // The old way: an absent player's raid is fought at half strength, once: `again` first.
    ada.say({ t: 'battle', to: 2, id: 'A1', part: 0, parts: 1, data: 'X' });
    expect(last(ada, 'battleRefused')).toMatchObject({ id: 'A1', again: true });
    ada.say({ t: 'battle', to: 2, id: 'A1', part: 0, parts: 1, data: 'X', away: true });
    expect(last(ada, 'battleKept')?.id).toBe('A1');
    expect(raidsLeft()).toBe(REGION_LIMITS.raidsPerDay - 1);
    // Asked again after that (the page is retrying): the old way has it already.
    ada.say(call('A1'));
    expect(last(ada, 'bliveoff')).toEqual({ t: 'bliveoff', id: 'A1', why: 'That battle is kept already' });
    expect(raidsLeft()).toBe(REGION_LIMITS.raidsPerDay - 1);
  });

  it('a call turned off takes nothing from the pace: the old way gets the one battle the region allows at once', () => {
    const w = world({ limits: { battleBurst: 1, raidsPerDay: 100 } });
    const { ada, sam, room } = w;
    room.closed(sam.conn);
    ada.say(call('T1'));
    expect(last(ada, 'bliveoff')).toMatchObject({ id: 'T1' });
    expect(last(ada, 'bliveoff')).not.toHaveProperty('refused');
    ada.say({ t: 'battle', to: 2, id: 'T1', part: 0, parts: 1, data: 'X', away: true });
    expect(last(ada, 'battleKept')?.id).toBe('T1');
    // That was the one: the next waits, live or not.
    ada.say(call('T2'));
    expect(last(ada, 'bliveoff')).toMatchObject({
      id: 'T2',
      refused: true,
      later: REGION_LIMITS.battleEvery,
    });
    // And a live battle that did begin took the pace as much as a battle does.
    const w2 = world({ limits: { battleBurst: 1, raidsPerDay: 100 } });
    w2.fight('T3');
    w2.ada.say({ t: 'battle', to: 2, id: 'T4', part: 0, parts: 1, data: 'X' });
    expect(last(w2.ada, 'battleRefused')).toMatchObject({ id: 'T4', later: REGION_LIMITS.battleEvery });
  });

  it('in a peer-to-peer region, a call to an absent player is refused as a battle would be', () => {
    const w = world({ kind: 'p2p' });
    w.room.closed(w.sam.conn);
    w.ada.say(call('P1'));
    const answer = last(w.ada, 'bliveoff')!;
    expect(answer).toMatchObject({ id: 'P1', refused: true });
    w.ada.say({ t: 'battle', to: 2, id: 'P1', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleRefused')!.reason).toBe(answer.why);
    // With the player here, the same room runs the battle live.
    const w2 = world({ kind: 'p2p' });
    w2.fight();
    expect(all(w2.sam, 'bstart')).toHaveLength(1);
  });

  it('gives a live call the refusals a battle gets, and says the old way is no use', () => {
    // War off.
    const off = world();
    off.ada.say({ t: 'rrules', rules: { war: false, scale: 'skirmish' } });
    off.ada.say(call('R1'));
    expect(last(off.ada, 'bliveoff')).toMatchObject({ why: 'War is off in this region', refused: true });
    // A neutral target, a newcomer, a superweapon with the rules against it, and the day's raids.
    const w = world({ supers: false });
    w.sam.say(report('Samton', { shield: 'neutral' }));
    w.ada.say(call('R2'));
    expect(last(w.ada, 'bliveoff')).toEqual({
      t: 'bliveoff',
      id: 'R2',
      why: 'Samton is neutral',
      refused: true,
    });
    w.ada.say({ t: 'battle', to: 2, id: 'R2', part: 0, parts: 1, data: 'X' });
    expect(last(w.ada, 'battleRefused')!.reason).toBe('Samton is neutral');
    w.sam.say(report('Samton', { shield: 'new' }));
    w.ada.say(call('R3'));
    expect(last(w.ada, 'bliveoff')).toMatchObject({
      refused: true,
      why: 'Samton is too young or small to raid, unless it strikes first',
    });
    w.sam.say(report('Samton'));
    w.ada.say(call('R4', 2, { super: true }));
    expect(last(w.ada, 'bliveoff')).toMatchObject({
      refused: true,
      why: 'The region’s rules turn superweapons off',
    });
    // Three battles in a day (the burst is three, too): the fourth is the day's.
    const w3 = world({ limits: { battleBurst: 10 } });
    for (let k = 0; k < 3; k++) {
      w3.fight(`day-${k}`);
      w3.ada.say({ t: 'bdone', id: `day-${k}`, step: 9, hash: 'ab' });
      w3.sam.say({ t: 'bdone', id: `day-${k}`, step: 9, hash: 'ab' });
    }
    w3.ada.say(call('day-3'));
    expect(last(w3.ada, 'bliveoff')).toMatchObject({
      refused: true,
      why: `Samton has been raided ${REGION_LIMITS.raidsPerDay} times today: the region allows no more until midnight (UTC)`,
    });
    // The pace: three at once, then one every five minutes (`later`).
    const w4 = world({ limits: { raidsPerDay: 100 } });
    for (let k = 0; k < 3; k++) {
      w4.fight(`pace-${k}`);
      w4.ada.say({ t: 'bdone', id: `pace-${k}`, step: 9, hash: 'ab' });
      w4.sam.say({ t: 'bdone', id: `pace-${k}`, step: 9, hash: 'ab' });
    }
    w4.ada.say(call('pace-3'));
    expect(last(w4.ada, 'bliveoff')).toEqual({
      t: 'bliveoff',
      id: 'pace-3',
      why: 'The region takes a few battles at a time',
      refused: true,
      later: REGION_LIMITS.battleEvery,
    });
    expect(w4.store.rowsWritten).toBeGreaterThan(0);
  });

  it('counts the pace and the raid once the battle starts, and makes the checks again when the input comes', () => {
    const w = world();
    const { ada, sam, room } = w;
    ada.say(call('C1'));
    // The war is switched off while the call waits: the battle doesn't begin, and the old way won't either.
    ada.say({ t: 'rrules', rules: { war: false, scale: 'skirmish' } });
    sam.say({ t: 'binput', id: 'C1', part: 0, parts: 1, data: 'INPUT' });
    expect(last(ada, 'bliveoff')).toMatchObject({
      id: 'C1',
      why: 'War is off in this region',
      refused: true,
    });
    expect(last(sam, 'bliveoff')).toMatchObject({ id: 'C1', why: 'War is off in this region' });
    expect(all(sam, 'bstart')).toHaveLength(0);
    expect(room.view().cities.find((c) => c.slot === 2)!.raidsLeft).toBeUndefined();
  });

  it('takes a live battle’s input in parts, as a battle comes', () => {
    const w = world();
    const { ada, sam } = w;
    ada.say(call('M1'));
    sam.say({ t: 'binput', id: 'M1', part: 1, parts: 3, data: 'B' });
    sam.say({ t: 'binput', id: 'M1', part: 0, parts: 3, data: 'A' });
    expect(all(ada, 'bstart')).toHaveLength(0);
    sam.say({ t: 'binput', id: 'M1', part: 2, parts: 3, data: 'C' });
    expect(last(ada, 'bstart')!.input).toEqual(['A', 'B', 'C']);
    expect(last(sam, 'bstart')!.input).toEqual(['A', 'B', 'C']);
  });

  it('keeps one live battle a city at a time, and runs two in a region of four', () => {
    const w = world({ cities: 4 });
    const { ada, sam, kit, lou } = w;
    w.fight('L1');
    // Neither combatant is called again, as attacker or defender.
    kit!.say(call('K1', 1));
    expect(last(kit!, 'bliveoff')).toEqual({
      t: 'bliveoff',
      id: 'K1',
      why: 'Adaton is in a live battle already',
    });
    ada.say(call('L2', 3));
    expect(last(ada, 'bliveoff')).toEqual({
      t: 'bliveoff',
      id: 'L2',
      why: 'Adaton is in a live battle already',
    });
    kit!.say(call('K2', 2));
    expect(last(kit!, 'bliveoff')).toEqual({
      t: 'bliveoff',
      id: 'K2',
      why: 'Samton is in a live battle already',
    });
    // The other two may fight at the same time.
    kit!.say(call('K3', 4));
    expect(all(lou!, 'bcall')).toHaveLength(1);
    lou!.say({ t: 'binput', id: 'K3', part: 0, parts: 1, data: 'INPUT-B' });
    expect(all(kit!, 'bstart')).toHaveLength(1);
    // Each is told of the other's, to watch; a combatant's messages are its battle's alone.
    expect(all(kit!, 'blivenow')).toEqual([{ t: 'blivenow', id: 'L1', from: 1, to: 2 }]);
    expect(all(ada, 'blivenow')).toEqual([{ t: 'blivenow', id: 'K3', from: 3, to: 4 }]);
    kit!.say(step('K3', 4, [{ kind: 'hold' }]));
    expect(all(sam, 'ballow').flatMap((m) => m.ords ?? [])).toHaveLength(0);
    expect(all(lou!, 'ballow').flatMap((m) => m.ords ?? [])).toHaveLength(1);
    // Ada can't send Kit's id: its steps for a battle it isn't in are answered that there is none.
    ada.say(step('K3', 9));
    expect(last(ada, 'bliveoff')).toMatchObject({ id: 'K3', gone: true });
  });

  it('a live battle that was called and ended before the old way is tried: the same id is acknowledged, never counted twice', () => {
    const w = world();
    const { ada, sam, room } = w;
    w.fight('E1');
    ada.say({ t: 'bdone', id: 'E1', step: 9, hash: 'ab' });
    sam.say({ t: 'bdone', id: 'E1', step: 9, hash: 'ab' });
    const left = room.view().cities.find((c) => c.slot === 2)!.raidsLeft;
    expect(left).toBe(REGION_LIMITS.raidsPerDay - 1);
    // The attacker's page, not knowing, sends it the old way: acknowledged, not kept, not counted.
    ada.say({ t: 'battle', to: 2, id: 'E1', part: 0, parts: 1, data: 'X' });
    expect(last(ada, 'battleKept')).toEqual({ t: 'battleKept', id: 'E1' });
    expect(room.view().cities.find((c) => c.slot === 2)!.raidsLeft).toBe(left);
    expect(all(sam, 'battle')).toHaveLength(0);
    // And a live call for it again answers with its end.
    ada.say(call('E1'));
    expect(last(ada, 'bend')).toMatchObject({ id: 'E1', step: 9, agree: true });
    expect(last(ada, 'breplaydata')!.record.id).toBe('E1');
    // While one runs, the old way is no use.
    w.fight('E2');
    ada.say({ t: 'battle', to: 2, id: 'E2', part: 0, parts: 1, data: 'X' });
    expect(last(ada, 'battleRefused')).toEqual({
      t: 'battleRefused',
      id: 'E2',
      reason: 'That battle is being fought live',
    });
  });

  it('abandons a battle nobody has spoken in for a minute, and keeps its record for the defender who isn’t here', () => {
    const w = world({ cities: 4 });
    const { ada, sam, kit, room, store, clock, secrets } = w;
    w.fight();
    clock.advance(500);
    ada.say(step('L1', 12, [{ kind: 'focus', target: 2 }]));
    sam.say(step('L1', 12, [{ kind: 'guard', target: 5 }]));
    room.closed(sam.conn);
    // Nobody speaks for a minute: the next message that reaches the room finds the battle abandoned.
    clock.advance(LIVE.abandon - 1);
    kit!.say(report('Kitton'));
    expect(all(ada, 'bend')).toHaveLength(0);
    clock.advance(1);
    kit!.say(report('Kitton'));
    const end = { t: 'bend', id: 'L1', from: 1, to: 2, step: 12, hash: '', agree: false, abandoned: true };
    for (const r of [ada, kit!]) expect(all(r, 'bend')).toEqual([end]);
    // Sam wasn't here: the record waits for it as a pending battle, with a place kept in its row.
    const meta = (
      room as unknown as {
        meta: { cities: { slot: number; pending?: { id: string; live?: true; k: number }[] }[] };
      }
    ).meta;
    const pending = meta.cities.find((c) => c.slot === 2)!.pending!;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ id: 'L1', live: true });
    expect(store.battles.get(`2:${pending[0]!.k}`)).toBeDefined();
    // Sam comes back: the battle comes with the welcome, marked as live, its record whole.
    const back = raw(room);
    back.say(hello('Sam', { rejoin: { slot: 2, secret: secrets.Sam } }));
    const b = all(back, 'battle');
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ from: 1, id: 'L1', late: true, live: true, part: 0, parts: 1 });
    const record = JSON.parse(b[0]!.data) as {
      v: number;
      input: string[];
      orders: { side: number; kind: string }[];
      end: object;
    };
    expect(record.v).toBe(1);
    expect(record.input).toEqual(['INPUT-A']);
    // (Sam's page closed: handed over then; Ada said nothing for ten seconds: handed over too.)
    expect(record.orders.map((o) => `${o.side}${o.kind}`)).toEqual(['0focus', '1guard', '1free', '0free']);
    expect(record.end).toEqual({ step: 12, hash: '', agree: false, abandoned: true });
    // A battle seen is forgotten as ever; the replay stays.
    back.say({ t: 'battleSeen', id: 'L1', from: 1 });
    expect(meta.cities.find((c) => c.slot === 2)!.pending).toBeUndefined();
    kit!.say({ t: 'breplay', id: 'L1' });
    expect(last(kit!, 'breplaydata')!.record.end.abandoned).toBe(true);
  });

  it('asks a defender who reloaded in the middle of a call again, and keeps a live record for a page that can fight live', () => {
    const w = world();
    const { ada, sam, room, secrets, clock } = w;
    ada.say(call('Z1'));
    // Its page reloaded: the new connection comes before the old one is seen to go, and is asked too.
    const back = raw(room);
    clock.advance(500);
    back.say(hello('Sam', { rejoin: { slot: 2, secret: secrets.Sam } }));
    expect(all(back, 'bcall')).toEqual([{ t: 'bcall', id: 'Z1', from: 1, force: FORCE }]);
    back.say({ t: 'binput', id: 'Z1', part: 0, parts: 1, data: 'IN' });
    expect(all(ada, 'bstart')).toHaveLength(1);
    // The battle ends while Sam is away: kept for a page that speaks live battles, and only for one.
    room.closed(back.conn);
    room.closed(sam.conn);
    ada.say({ t: 'bdone', id: 'Z1', step: 1, hash: 'ab' });
    expect(last(ada, 'bend')).toMatchObject({ id: 'Z1', solo: true });
    const meta = (room as unknown as { meta: { cities: { slot: number; pending?: { id: string }[] }[] } })
      .meta;
    expect(meta.cities.find((c) => c.slot === 2)!.pending?.map((p) => p.id)).toEqual(['Z1']);
    const old = raw(room);
    old.say({ ...hello('Sam', { rejoin: { slot: 2, secret: secrets.Sam } }), v: MIN_REGION_PROTOCOL });
    expect(all(old, 'battle')).toHaveLength(0);
    const fresh = raw(room);
    fresh.say(hello('Sam', { rejoin: { slot: 2, secret: secrets.Sam } }));
    expect(all(fresh, 'battle').map((m) => [m.id, m.live])).toEqual([['Z1', true]]);
  });

  it('owes an attacker who wasn’t here at the end its end and the record, on its next welcome', () => {
    const w = world({ cities: 4 });
    const { ada, sam, room, clock, secrets } = w;
    w.fight();
    clock.advance(500);
    sam.say(step('L1', 15, [{ kind: 'hold' }]));
    room.closed(ada.conn);
    // Ada's gone (handed over at once); Sam finishes the battle alone.
    sam.say({ t: 'bdone', id: 'L1', step: 700, hash: 'abcd' });
    expect(last(sam, 'bend')).toMatchObject({ id: 'L1', step: 700, solo: true, agree: true });
    // Sam saw it end: nothing is kept for it as a pending battle, the same id is known.
    sam.say({ t: 'battle', to: 1, id: 'L1', part: 0, parts: 1, data: 'X' });
    // (a battle to its own attacker: the room's checks come first)
    const back = raw(room);
    back.say(hello('Ada', { rejoin: { slot: 1, secret: secrets.Ada } }));
    expect(all(back, 'bend')).toEqual([
      { t: 'bend', id: 'L1', from: 1, to: 2, step: 700, hash: 'abcd', agree: true, solo: true },
    ]);
    const rec = last(back, 'breplaydata')!.record;
    expect(rec.orders.map((o) => `${o.side}${o.kind}`)).toEqual(['1hold', '0free']);
    // Owed once: the next welcome brings nothing.
    const again = raw(room);
    again.say(hello('Ada', { rejoin: { slot: 1, secret: secrets.Ada } }));
    expect(all(again, 'bend')).toHaveLength(0);
    // And a `bjoin` for a battle that's over brings its end.
    again.say({ t: 'bjoin', id: 'L1' });
    expect(all(again, 'bend')).toHaveLength(1);
  });

  it('lets any city watch: the input and the orders so far, then the pace and the end; and stop', () => {
    const w = world({ cities: 4 });
    const { ada, sam, kit, lou, clock } = w;
    w.fight();
    clock.advance(500);
    sam.say(step('L1', 0, [{ kind: 'guard', target: 3 }]));
    kit!.say({ t: 'bwatch', id: 'L1' });
    lou!.say({ t: 'bwatch', id: 'L1', from: 1 });
    expect(last(kit!, 'bstart')).toEqual({
      t: 'bstart',
      id: 'L1',
      role: 'watcher',
      attacker: 1,
      defender: 2,
      input: ['INPUT-A'],
      allow: 32,
      orders: [{ kind: 'guard', target: 3, seq: 1, step: 32, side: 1 }],
      handed: [],
    });
    clock.advance(500);
    ada.say(step('L1', 4));
    sam.say(step('L1', 4));
    expect(last(kit!, 'ballow')).toEqual({ t: 'ballow', id: 'L1', allow: 36 });
    expect(last(lou!, 'ballow')).toEqual({ t: 'ballow', id: 'L1', allow: 36 });
    // A watcher's own orders and steps do nothing.
    kit!.say(step('L1', 99, [{ kind: 'hold' }]));
    expect(last(kit!, 'bliveoff')).toMatchObject({ gone: true });
    expect(all(ada, 'ballow').flatMap((m) => m.ords ?? [])).toHaveLength(1);
    lou!.say({ t: 'bunwatch', id: 'L1' });
    clock.advance(500);
    ada.say(step('L1', 8));
    sam.say(step('L1', 8));
    expect(last(kit!, 'ballow')!.allow).toBe(40);
    expect(last(lou!, 'ballow')!.allow).toBe(36);
    ada.say({ t: 'bdone', id: 'L1', step: 9, hash: 'ab' });
    sam.say({ t: 'bdone', id: 'L1', step: 9, hash: 'ab' });
    expect(all(kit!, 'bend')).toHaveLength(1);
    // Lou stopped watching but is a city of the region: it hears the end like all of them.
    expect(all(lou!, 'bend')).toHaveLength(1);
    // A watcher who is late finds a finished battle, and is shown it as a replay.
    kit!.say({ t: 'bwatch', id: 'L1' });
    expect(all(kit!, 'bend')).toHaveLength(2);
    expect(last(kit!, 'breplaydata')!.record.orders).toHaveLength(1);
    // A watch for no battle is a notice.
    kit!.say({ t: 'bwatch', id: 'nope' });
    expect(notices(kit!).at(-1)).toBe('That battle isn’t on any more');
    // A visitor (no city) can't watch.
    const visitor = raw(w.room);
    visitor.say({ ...hello('Vic'), visitor: true });
    visitor.say({ t: 'bwatch', id: 'L1' });
    expect(live(visitor)).toHaveLength(0);
  });

  it('keeps the last twenty finished battles for replays, counted in the day’s rows, and tells a page which', () => {
    const w = world({ limits: { raidsPerDay: 1000, battleBurst: 1000, dailyRows: 100_000 } });
    const { ada, sam, store, room, kit } = w;
    const rows = store.rowsWritten;
    for (let k = 0; k < LIVE.replays + 3; k++) {
      w.fight(`r-${k}`, `IN-${k}`);
      ada.say({ t: 'bdone', id: `r-${k}`, step: k, hash: `h${k}` });
      sam.say({ t: 'bdone', id: `r-${k}`, step: k, hash: `h${k}` });
    }
    // Rows written for each (the record, the region's own): about two apiece.
    expect(store.rowsWritten - rows).toBeGreaterThanOrEqual(LIVE.replays + 3);
    expect(store.rowsWritten - rows).toBeLessThanOrEqual(3 * (LIVE.replays + 3));
    // Only twenty rows are kept, the newest.
    expect(store.battles.size).toBe(LIVE.replays);
    const late = raw(room);
    late.say(hello('Kit'));
    const welcome = last(late, 'rwelcome')!;
    expect(welcome.replays!.map((r) => r.id)).toEqual(
      Array.from({ length: LIVE.replays }, (_, i) => `r-${i + 3}`),
    );
    expect(welcome.replays![0]).toMatchObject({ from: 1, to: 2, step: 3, hash: 'h3', agree: true });
    late.say(report('Kitton'));
    late.say({ t: 'breplay', id: 'r-5' });
    expect(last(late, 'breplaydata')!.record.input).toEqual(['IN-5']);
    // One the region no longer keeps is answered at once, so the page stops waiting (M39 step 7 review).
    late.say({ t: 'breplay', id: 'r-2', from: 1 });
    expect(last(late, 'breplaygone')).toEqual({ t: 'breplaygone', id: 'r-2', from: 1 });
    late.say({ t: 'breplay', id: 'never-fought' });
    expect(last(late, 'breplaygone')).toEqual({ t: 'breplaygone', id: 'never-fought' });
    expect(kit).toBeUndefined();
  });

  it('says a battle’s end was not stored when the day’s rows had gone, so no page offers a replay of it', () => {
    const w = world({ limits: { raidsPerDay: 1000, battleBurst: 1000, dailyRows: 200 } });
    const { ada, sam, store } = w;
    // A battle begun within the allowance; then the day’s rows are spent by other writes before it ends.
    w.fight('N1', 'IN-N1');
    for (let k = 0; k < 400; k++) store.saveBattle(40, 0, ['burn']);
    ada.say({ t: 'bdone', id: 'N1', step: 9, hash: 'ab' });
    sam.say({ t: 'bdone', id: 'N1', step: 9, hash: 'ab' });
    // Both combatants are told how it ended, and that the region did not keep it.
    for (const r of [ada, sam]) {
      expect(last(r, 'bend')).toEqual({
        t: 'bend',
        id: 'N1',
        from: 1,
        to: 2,
        step: 9,
        hash: 'ab',
        agree: true,
        kept: false,
      });
    }
    // Asking for the battle is answered at once, with no record (none was written).
    const kept = [...store.battles.keys()].filter((k) => k.startsWith(`${MAX_CITIES + 1}:`));
    expect(kept).toEqual([]);
    ada.say({ t: 'breplay', id: 'N1', from: 1 });
    expect(last(ada, 'breplaygone')).toEqual({ t: 'breplaygone', id: 'N1', from: 1 });
    expect(last(ada, 'breplaydata')).toBeUndefined();
  });

  it('keeps a region’s replays across a restart, in the same rows', () => {
    const w = world();
    w.fight('K1', 'IN-K');
    w.ada.say({ t: 'bdone', id: 'K1', step: 5, hash: 'ab' });
    w.sam.say({ t: 'bdone', id: 'K1', step: 5, hash: 'ab' });
    const room2 = new RegionRoom('7LIVE1', 'local', w.store, { now: w.clock.now });
    const a2 = raw(room2);
    a2.say(hello('Ada', { rejoin: { slot: 1, secret: w.secrets.Ada } }));
    expect(last(a2, 'rwelcome')!.replays).toHaveLength(1);
    a2.say({ t: 'breplay', id: 'K1' });
    expect(last(a2, 'breplaydata')!.record.input).toEqual(['IN-K']);
  });

  it('turns live battles away from a region that has used its day’s rows', () => {
    const w = world();
    // The same record, over a day with no rows left.
    const room2 = new RegionRoom('7LIVE1', 'local', w.store, { now: w.clock.now }, { dailyRows: 1 });
    const a2 = raw(room2);
    a2.say(hello('Ada', { rejoin: { slot: 1, secret: w.secrets.Ada } }));
    const s2 = raw(room2);
    s2.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    a2.say(report('Adaton'));
    s2.say(report('Samton'));
    a2.say(call('B1'));
    expect(last(a2, 'bliveoff')).toMatchObject({
      id: 'B1',
      refused: true,
      why: expect.stringContaining('limit'),
    });
  });

  it('stops a battle’s orders at its cap, a side’s at four a step, and still hands a side over past it', () => {
    const w = world({ limits: BUSY });
    const { ada, sam, clock } = w;
    w.fight();
    // Four a step for a side: the fifth isn't stamped, and the player is told.
    ada.say(step('L1', 0));
    sam.say(step('L1', 0));
    sam.say(step('L1', 0, [{ kind: 'hold' }, { kind: 'hold' }, { kind: 'hold' }, { kind: 'hold' }]));
    sam.say(step('L1', 0, [{ kind: 'hold' }]));
    expect(all(ada, 'ballow').flatMap((m) => m.ords ?? [])).toHaveLength(4);
    expect(notices(sam).at(-1)).toBe('Too many orders at once: give the rest in a moment');
    // Attackers fill the log: the frontier moves with each round of steps.
    let n = 0;
    for (let i = 1; i <= 200 && !notices(ada).some((t) => t.includes('no more orders')); i++) {
      clock.advance(100);
      sam.say(step('L1', i));
      ada.say(
        step(
          'L1',
          i,
          Array.from({ length: LIVE.perMessage }, () => ({ kind: 'hold' })),
        ),
      );
      n = all(sam, 'ballow').flatMap((m) => m.ords ?? []).length;
    }
    expect(notices(ada).at(-1)).toBe('This battle takes no more orders');
    // The log holds the cap less what was kept for handovers.
    expect(n).toBe(LIVE.maxOrders - LIVE.reserve);
    // A handover still stamps in the places kept for it, and never past the cap the sim takes.
    for (let k = 0; k < 40; k++) {
      sam.say({ t: 'bjoin', id: 'L1' });
      ada.say({ t: 'bjoin', id: 'L1' });
      clock.advance(LIVE.silent);
      w.room.message(k % 2 ? ada.conn : sam.conn, 'ping'); // the other is left behind
    }
    const ords = all(ada, 'ballow').flatMap((m) => m.ords ?? []);
    expect(ords.length).toBe(LIVE.maxOrders);
    expect(ords.slice(LIVE.maxOrders - LIVE.reserve).every((o) => o.kind === 'free')).toBe(true);
    // Its seq are 1, 2, 3...: no gaps, no repeats.
    expect(ords.map((o) => o.seq)).toEqual(ords.map((_, i) => i + 1));
    // The record has what the sim will take: no more than the cap.
    ada.say({ t: 'bdone', id: 'L1', step: 9, hash: 'ab' });
    sam.say({ t: 'bdone', id: 'L1', step: 9, hash: 'ab' });
    ada.say({ t: 'breplay', id: 'L1' });
    expect(last(ada, 'breplaydata')!.record.orders).toHaveLength(LIVE.maxOrders);
  });

  it('a page on protocol 5 gets no call, no announcement and no end; one asking for live battles is told it can’t', () => {
    const clock = new FakeClock();
    const room = new RegionRoom('7OLDV5', 'local', new MemoryRegionStore(), { now: clock.now });
    const ada = raw(room);
    ada.say(hello('Ada', { create: { name: 'Vale', rules: { war: true, scale: 'skirmish' } } }));
    const sam = raw(room);
    sam.say({ ...hello('Sam'), v: MIN_REGION_PROTOCOL });
    const kit = raw(room);
    kit.say(hello('Kit'));
    const lou = raw(room);
    lou.say({ ...hello('Lou'), v: MIN_REGION_PROTOCOL });
    for (const [r, n] of [
      [ada, 'Adaton'],
      [sam, 'Samton'],
      [kit, 'Kitton'],
      [lou, 'Louton'],
    ] as [Raw, string][])
      r.say(report(n));
    expect(last(sam, 'rwelcome')).not.toHaveProperty('replays');
    // A call to a city on protocol 5 falls back to the old way at once.
    ada.say(call('V1', 2));
    expect(last(ada, 'bliveoff')).toEqual({
      t: 'bliveoff',
      id: 'V1',
      why: 'Samton’s page is an older version, which can’t fight live',
    });
    expect(live(sam)).toHaveLength(0);
    // The old way works for it as it always did.
    ada.say({ t: 'battle', to: 2, id: 'V1', part: 0, parts: 1, data: 'X' });
    expect(last(ada, 'battleKept')?.id).toBe('V1');
    expect(last(sam, 'battle')).toMatchObject({ id: 'V1', late: false });
    // A live battle between two others: protocol 5 pages hear of none of it.
    kit.say(call('V2', 1));
    ada.say({ t: 'binput', id: 'V2', part: 0, parts: 1, data: 'IN' });
    expect(all(kit, 'bstart')).toHaveLength(1);
    kit.say(step('V2', 4, [{ kind: 'hold' }]));
    ada.say({ t: 'bdone', id: 'V2', step: 9, hash: 'ab' });
    kit.say({ t: 'bdone', id: 'V2', step: 9, hash: 'ab' });
    expect(all(ada, 'bend')).toHaveLength(1);
    expect(live(sam)).toHaveLength(0);
    expect(live(lou)).toHaveLength(0);
    // Asking a live battle of the room as a protocol 5 page: no battle is made.
    lou.say(call('V3', 2));
    expect(last(lou, 'bliveoff')).toMatchObject({ id: 'V3', why: 'Live battles need a newer Citybloom' });
    lou.say({ t: 'bwatch', id: 'V2' });
    expect(live(lou).filter((m) => m.t !== 'bliveoff')).toHaveLength(0);
    // Newer than the room is turned away, as is older than the last.
    for (const v of [PROTOCOL_VERSION + 1, MIN_REGION_PROTOCOL - 1]) {
      const r = raw(room);
      r.say({ ...hello('Zed'), v });
      expect(last(r, 'error')).toMatchObject({ code: 'version' });
    }
  });

  it('remembers a socket’s protocol through a Durable Object’s hibernation', () => {
    const w = world();
    const { store, clock, secrets } = w;
    const room2 = new RegionRoom('7LIVE1', 'local', store, { now: clock.now });
    const mk = () => {
      const r: Raw = {
        got: [],
        closed: null,
        conn: null as unknown as RegionConn,
        say: (m) => room2.message(r.conn, JSON.stringify(m)),
      };
      r.conn = { send: (m) => r.got.push(m), close: () => undefined };
      return r;
    };
    const a = mk();
    const s = mk();
    room2.reattach(a.conn, 1, { v: PROTOCOL_VERSION });
    room2.reattach(s.conn, 2, { v: MIN_REGION_PROTOCOL });
    a.say(report('Adaton'));
    s.say(report('Samton'));
    a.say(call('H1'));
    expect(last(a, 'bliveoff')).toMatchObject({
      why: 'Samton’s page is an older version, which can’t fight live',
    });
    // A tag from before this version says nothing: the current protocol.
    const s2 = mk();
    room2.reattach(s2.conn, 2);
    void secrets;
    a.say(call('H2'));
    expect(all(s2, 'bcall')).toHaveLength(1);
  });

  it('ends nothing and costs nothing when a call’s attacker goes before the defender answers', () => {
    const w = world();
    const { ada, sam, room } = w;
    ada.say(call('G1'));
    room.closed(ada.conn);
    expect(last(sam, 'bliveoff')).toEqual({ t: 'bliveoff', id: 'G1', why: 'The attacker left' });
    expect(room.view().cities.find((c) => c.slot === 2)!.raidsLeft).toBe(REGION_LIMITS.raidsPerDay);
    // The defender's answer to a call that's gone is told so, and nothing begins.
    sam.say({ t: 'binput', id: 'G1', part: 0, parts: 1, data: 'IN' });
    expect(all(sam, 'bliveoff')).toHaveLength(2);
    expect(all(sam, 'bstart')).toHaveLength(0);
  });

  it('keeps a place for a live battle among the battles kept for its target', () => {
    const w = world({ cities: 4, limits: { raidsPerDay: 100, battleBurst: 100 } });
    const { ada, sam, kit, lou, room } = w;
    // Seven battles wait for Sam (it's away); the eighth is a live one.
    room.closed(sam.conn);
    for (let k = 0; k < 7; k++) {
      const from = [ada, kit!, lou!][k % 3]!;
      from.say({ t: 'battle', to: 2, id: `w-${k}`, part: 0, parts: 1, data: 'X', away: true });
      expect(last(from, 'battleKept')?.id).toBe(`w-${k}`);
    }
    const back = raw(room);
    back.say(hello('Sam', { rejoin: { slot: 2, secret: w.secrets.Sam } }));
    // Sam is here (and has seen none): with seven waiting, a live battle takes the eighth place.
    ada.say(call('live-1'));
    expect(all(back, 'bcall')).toHaveLength(1);
    // So no other battle gets that place while it runs.
    kit!.say({ t: 'battle', to: 2, id: 'w-8', part: 0, parts: 1, data: 'X' });
    expect(last(kit!, 'battleRefused')!.reason).toContain('raids waiting for its player');
    back.say({ t: 'binput', id: 'live-1', part: 0, parts: 1, data: 'IN' });
    expect(all(ada, 'bstart')).toHaveLength(1);
    // Sam leaves mid-battle and the abandoned battle is kept for it: the eighth place.
    room.closed(back.conn);
    w.clock.advance(LIVE.abandon);
    kit!.say(report('Kitton'));
    const meta = (room as unknown as { meta: { cities: { slot: number; pending?: unknown[] }[] } }).meta;
    expect(meta.cities.find((c) => c.slot === 2)!.pending).toHaveLength(8);
  });

  it('answers an unknown battle’s steps, joins and finishes that the region has no such battle', () => {
    const w = world();
    const { ada, sam } = w;
    for (const m of [
      step('nope', 1),
      { t: 'bdone', id: 'nope', step: 1, hash: 'ab' },
      { t: 'bjoin', id: 'nope' },
    ]) {
      ada.say(m);
      expect(last(ada, 'bliveoff')).toEqual({
        t: 'bliveoff',
        id: 'nope',
        why: 'The region has no such battle now',
        gone: true,
      });
    }
    // A defender's input for a call never made is told the call is over.
    sam.say({ t: 'binput', id: 'nope', part: 0, parts: 1, data: 'IN' });
    expect(last(sam, 'bliveoff')).toMatchObject({ why: 'That call is over' });
  });

  it('runs on a clock that only the room’s `now` gives it: no timers', () => {
    const w = world();
    w.fight();
    // The room made no timer for the battle: a fake clock with no timers pending stands still.
    w.ada.say(step('L1', 3));
    expect(w.clock.pending).toBe(0);
  });
});

/** Node's SQLite standing in for a Durable Object's, rows written as the platform counts them. */
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
  return { sql, written: () => written };
}

interface Socket extends HostSocket {
  got: Record<string, unknown>[];
}

describe('M39: the region room as a Durable Object', () => {
  it('writes a battle’s record once at its end, keeps it in rows a restart reads, and forgets a battle running through a hibernation', async () => {
    const db = await sqlite();
    const clock = new FakeClock();
    clock.advance(((Math.ceil(clock.t / DAY_MS) * DAY_MS - clock.t) % DAY_MS) + 12 * 3600_000);
    const sockets: Socket[] = [];
    const open = (): Socket => {
      let tag: SocketTag | null = null;
      const s: Socket = {
        got: [],
        send: (t) => s.got.push(JSON.parse(t) as Record<string, unknown>),
        close: () => undefined,
        tag: () => tag,
        setTag: (v) => (tag = v),
      };
      sockets.push(s);
      return s;
    };
    let host = new RegionHost(db.sql, () => sockets, { now: clock.now });
    const join = (mayor: string, create: boolean, v: number = PROTOCOL_VERSION) => {
      const ws = open();
      host.accept(ws, '2LIVEDO', create);
      host.message(
        ws,
        JSON.stringify({
          ...hello(
            mayor,
            create ? { create: { name: 'Vale', rules: { war: true, scale: 'skirmish' } } } : {},
          ),
          v,
        }),
      );
      host.message(ws, JSON.stringify(report(`${mayor}ton`)));
      return ws;
    };
    const say = (ws: Socket, m: object) => host.message(ws, JSON.stringify(m));
    const kinds = (ws: Socket, t: string) => ws.got.filter((m) => m.t === t);
    const ada = join('Ada', true);
    const sam = join('Sam', false);
    const old = join('Old', false, MIN_REGION_PROTOCOL);
    // The page's protocol is on its socket, to survive a hibernation.
    expect(ada.tag()).toMatchObject({ slot: 1, v: PROTOCOL_VERSION });
    expect(old.tag()).toMatchObject({ slot: 3, v: MIN_REGION_PROTOCOL });
    // A battle runs: no rows while it does, a few when it ends.
    say(ada, call('DO1'));
    expect(kinds(sam, 'bcall')).toHaveLength(1);
    const rows = db.written();
    say(sam, { t: 'binput', id: 'DO1', part: 0, parts: 1, data: 'INPUT-DO' });
    for (let k = 1; k <= 5; k++) {
      clock.advance(500);
      say(ada, step('DO1', k * 3, k === 2 ? [{ kind: 'focus', target: 1 }] : undefined));
      say(sam, step('DO1', k * 3));
    }
    expect(db.written()).toBe(rows);
    say(ada, { t: 'bdone', id: 'DO1', step: 300, hash: 'f00d' });
    say(sam, { t: 'bdone', id: 'DO1', step: 300, hash: 'f00d' });
    const used = db.written() - rows;
    console.log(`[M39] a live battle's end writes ${used} rows (its record, and the region's)`);
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(3);
    // Another battle begins, and the object hibernates (a new host from the same storage and sockets).
    say(ada, call('DO2'));
    say(sam, { t: 'binput', id: 'DO2', part: 0, parts: 1, data: 'INPUT-DO2' });
    expect(kinds(ada, 'bstart')).toHaveLength(2);
    host = new RegionHost(db.sql, () => sockets, { now: clock.now });
    // The sockets are as they were: the pages' protocols too. A battle in memory is gone: its pages
    // are told, and go on with what they have.
    say(ada, step('DO2', 4));
    expect(kinds(ada, 'bliveoff').at(-1)).toMatchObject({ id: 'DO2', gone: true });
    // The finished one is in the rows still: a replay, and the list in a welcome.
    say(old, { t: 'breplay', id: 'DO1' });
    expect(kinds(old, 'breplaydata')).toHaveLength(0);
    say(sam, { t: 'breplay', id: 'DO1' });
    const data = kinds(sam, 'breplaydata').at(-1) as { record: LiveRecordLike };
    expect(data.record.input).toEqual(['INPUT-DO']);
    expect(data.record.orders).toEqual([{ kind: 'focus', target: 1, seq: 1, step: 32 + 3 * 1, side: 0 }]);
    // A page on protocol 5 stayed on protocol 5: a call to it falls back.
    say(ada, call('DO3', 3));
    expect(kinds(ada, 'bliveoff').at(-1)).toMatchObject({
      id: 'DO3',
      why: expect.stringContaining('older version'),
    });
  });
});

interface LiveRecordLike {
  input: string[];
  orders: object[];
}
