import { describe, expect, it } from 'vitest';
import { MemoryStore, type Conn, type Room } from '../room';
import {
  MODEL_LIMITS,
  MODEL_PART,
  MODEL_PARTS,
  PROTOCOL_VERSION,
  cleanModelPart,
  parseClientMsg,
  type RoomMsg,
} from '../protocol';
import { FakeClock, makeRoom } from './harness';

/**
 * Players' own models through a shared city's room (M46): a page asks by hash, the first page to
 * answer sends parts the room passes only to those waiting, within each player's share, and keeps
 * nothing. Custom buildings off: nobody is asked. Pages older than protocol 9 are kept out.
 */

interface Raw {
  conn: Conn;
  got: RoomMsg[];
  closed: string | null;
  say(m: object): void;
}

function raw(room: Room): Raw {
  const r: Raw = {
    got: [],
    closed: null,
    conn: null as unknown as Conn,
    say: (m) => room.message(r.conn, JSON.stringify(m)),
  };
  r.conn = { send: (m) => r.got.push(m), close: (_c, reason) => (r.closed = reason || 'closed') };
  room.open(r.conn);
  return r;
}

const hello = (name: string, extra: Record<string, unknown> = {}) => ({
  t: 'hello',
  v: PROTOCOL_VERSION,
  name,
  color: 0,
  ...extra,
});

const HASH = '0123456789abcdef';
const HASH2 = 'fedcba9876543210';

/** A room with its host (Ada) and two friends in it. */
function room3() {
  const clock = new FakeClock();
  const room = makeRoom('MODELS', new MemoryStore(), clock, {});
  const ada = raw(room);
  ada.say(hello('Ada', { create: { cityName: 'Floodby' } }));
  ada.say({
    t: 'snap',
    meta: { id: 'up', tick: 1000, seq: -1, eventHash: 0, parts: 1, cityName: 'Floodby', population: 0 },
    part: 0,
    data: 'AAAA',
  });
  const bo = raw(room);
  bo.say(hello('Bo'));
  const cy = raw(room);
  cy.say(hello('Cy'));
  const id = (r: Raw) => (r.got.find((m) => m.t === 'welcome') as Extract<RoomMsg, { t: 'welcome' }>).you;
  return { clock, room, ada, bo, cy, ids: { ada: id(ada), bo: id(bo), cy: id(cy) } };
}

const of = <T extends RoomMsg['t']>(r: Raw, t: T) =>
  r.got.filter((m): m is Extract<RoomMsg, { t: T }> => m.t === t);
const waiting = (room: Room) => (room as unknown as { models: Map<string, unknown> }).models.size;
const part = (hash: string, i: number, parts: number, data = 'QUJD', extra = {}) => ({
  t: 'mpart',
  hash,
  part: i,
  parts,
  data,
  ...extra,
});

describe('players’ models through a room (M46)', () => {
  it('asks the others once and passes the first answer to whoever waits, keeping nothing', () => {
    const { room, ada, bo, cy, ids } = room3();
    bo.say({ t: 'mneed', hash: HASH });
    expect(of(ada, 'mneed')).toEqual([{ t: 'mneed', from: ids.bo, hash: HASH }]);
    expect(of(cy, 'mneed')).toHaveLength(1);
    expect(of(bo, 'mneed')).toHaveLength(0);
    // Cy lacks it too: on the list, and nobody is asked again.
    cy.say({ t: 'mneed', hash: HASH });
    expect(of(ada, 'mneed')).toHaveLength(1);
    // Ada answers first; Cy's answer (it has it after all) is ignored.
    ada.say(part(HASH, 0, 2, 'QUJD', { name: 'Clock pavilion', target: { kind: 'landmark', size: 2 } }));
    bo.say(part(HASH, 0, 2, 'WFla'));
    ada.say(part(HASH, 1, 2, 'REVG'));
    for (const r of [bo, cy]) {
      const got = of(r, 'mpart');
      expect(got.map((m) => [m.from, m.part, m.data])).toEqual([
        [ids.ada, 0, 'QUJD'],
        [ids.ada, 1, 'REVG'],
      ]);
      expect(got[0]).toMatchObject({ name: 'Clock pavilion', target: { kind: 'landmark', size: 2 } });
    }
    expect(of(ada, 'mpart')).toHaveLength(0);
    // Done: the room holds nothing of it.
    expect(waiting(room)).toBe(0);
    // A part for a model nobody asked for goes nowhere.
    ada.say(part(HASH2, 0, 1));
    expect(of(bo, 'mpart')).toHaveLength(2);
  });

  it('takes only parts within the caps, from players, as base64', () => {
    expect(cleanModelPart({ hash: HASH, part: 0, parts: 1, data: 'QUJD' })).not.toBeNull();
    expect(cleanModelPart({ hash: 'nothex!!nothex!!', part: 0, parts: 1, data: 'QUJD' })).toBeNull();
    expect(cleanModelPart({ hash: HASH, part: 1, parts: 1, data: 'QUJD' })).toBeNull();
    expect(cleanModelPart({ hash: HASH, part: 0, parts: MODEL_PARTS + 1, data: 'QUJD' })).toBeNull();
    expect(cleanModelPart({ hash: HASH, part: 0, parts: 1, data: 'A'.repeat(MODEL_PART + 4) })).toBeNull();
    expect(cleanModelPart({ hash: HASH, part: 0, parts: 1, data: '<script>' })).toBeNull();
    // A name is cleaned like a city's; a target the room can't read is dropped (the page checks it again).
    const p = cleanModelPart({
      hash: HASH,
      part: 0,
      parts: 1,
      data: 'QUJD',
      name: '  Big\u0000  tower  ',
      target: { kind: 'look', def: '../../etc' },
    })!;
    expect(p.name).toBe('Big tower');
    expect(p.target).toBeUndefined();
    // A 1 MB model fits in the parts allowed.
    expect(MODEL_PARTS * MODEL_PART).toBeGreaterThan(Math.ceil((1_048_576 * 4) / 3));
    expect(parseClientMsg(JSON.stringify({ t: 'mneed', hash: 'ABC' }))).toBeNull();
  });

  it('asks nobody while the host has custom buildings off, and orders the rule into every sim', () => {
    const { ada, bo, cy } = room3();
    ada.say({ t: 'rules', customBuildings: false });
    const ev = ada.got.flatMap((m) => (m.t === 'ev' ? m.list : []));
    expect(ev.some((e) => e.ev.kind === 'rules' && e.ev.rules.customBuildings === false)).toBe(true);
    bo.say({ t: 'mneed', hash: HASH });
    expect(of(ada, 'mneed')).toHaveLength(0);
    expect(of(cy, 'mneed')).toHaveLength(0);
    // Only the host sets it.
    bo.say({ t: 'rules', customBuildings: true });
    bo.say({ t: 'mneed', hash: HASH });
    expect(of(ada, 'mneed')).toHaveLength(0);
    // On again: absent from the rules, as in a room made before.
    ada.say({ t: 'rules', customBuildings: true });
    const room = of(ada, 'room').at(-1)!.room;
    expect('customBuildings' in room.rules).toBe(false);
    bo.say({ t: 'mneed', hash: HASH2 });
    expect(of(ada, 'mneed')).toHaveLength(1);
  });

  it('holds each player to a share of asks and of bytes, and asks again what nobody answered', () => {
    const { clock, room, ada, bo } = room3();
    for (let i = 0; i < 30; i++) bo.say({ t: 'mneed', hash: i.toString(16).padStart(16, 'a') });
    // A burst of ten asks, then a trickle.
    expect(of(ada, 'mneed').length).toBeLessThanOrEqual(11);
    expect(of(ada, 'mneed').length).toBeGreaterThanOrEqual(10);
    // Unanswered for half a minute: asked again.
    clock.t += 31_000;
    const before = of(ada, 'mneed').length;
    bo.say({ t: 'mneed', hash: 'a'.repeat(16) });
    expect(of(ada, 'mneed').length).toBe(before + 1);
    // Bytes: a player sending far past its share in a minute stops the transfer.
    const big = 'A'.repeat(MODEL_PART);
    const asks = Math.ceil(MODEL_LIMITS.charsPerMinute / 2 / MODEL_PART / MODEL_PARTS) + 2;
    let passed = 0;
    for (let k = 0; k < asks; k++) {
      clock.t += 7_000;
      const hash = (0x100 + k).toString(16).padStart(16, 'b');
      bo.say({ t: 'mneed', hash });
      for (let i = 0; i < MODEL_PARTS; i++) ada.say(part(hash, i, MODEL_PARTS, big));
      passed = of(bo, 'mpart').length;
    }
    expect(passed).toBeLessThan(asks * MODEL_PARTS);
    expect(waiting(room)).toBeLessThanOrEqual(MODEL_LIMITS.waiting);
  });

  it('forgets a player who leaves, and keeps pages before protocol 9 out with plain words', () => {
    const { room, ada, bo } = room3();
    bo.say({ t: 'mneed', hash: HASH });
    expect(waiting(room)).toBe(1);
    room.closed(bo.conn);
    expect(waiting(room)).toBe(0);
    ada.say(part(HASH, 0, 1));
    const old = raw(room);
    old.say(hello('Old', { v: PROTOCOL_VERSION - 1 }));
    expect(of(old, 'error')[0]?.text).toMatch(/different version of Citybloom: reload to update/);
  });
});
