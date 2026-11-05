import { describe, expect, it } from 'vitest';
import {
  MemoryRegionStore,
  RegionRoom,
  parseRegionMsg,
  type RegionConn,
  type RegionRoomMsg,
  type RegionView,
} from '../region';
import { PROTOCOL_VERSION } from '../protocol';
import { DAY_MS } from '../limits';
import { FakeClock } from './harness';

/**
 * M40, step 7: a saboteur's target of its own, the atom bomb's works (docs/plans/M40-design.md, call
 * 18). The room reads the target (`plant`) and turns it away, in plain words and without closing the
 * connection, against a city whose report shows no race to slow. (The report's race field, the
 * protocol gate and the room's notices come in step 9; until the report reader carries the field no
 * city can be aimed at, which these tests only rely on for the "no race" half.)
 */

interface Raw {
  got: RegionRoomMsg[];
  conn: RegionConn;
  say(m: object): void;
  closed: string | null;
}

function raw(region: RegionRoom): Raw {
  const r: Raw = {
    got: [],
    closed: null,
    conn: null as unknown as RegionConn,
    say: (m) => region.message(r.conn, JSON.stringify(m)),
  };
  r.conn = { send: (m) => r.got.push(m), close: (_c, reason) => (r.closed = reason || 'closed') };
  region.open(r.conn);
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

/** A war city's report: its research tiers (land, air, sea, defence, intel, logistics) and guard. */
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

const last = <T extends RegionRoomMsg['t']>(r: Raw, t: T) =>
  r.got.filter((m) => m.t === t).at(-1) as Extract<RegionRoomMsg, { t: T }> | undefined;
const all = <T extends RegionRoomMsg['t']>(r: Raw, t: T) =>
  r.got.filter((m) => m.t === t) as Extract<RegionRoomMsg, { t: T }>[];

/** A region at war with Ada's and Sam's cities, each reported; the room's dice give `dice.r`. */
function region() {
  const clock = new FakeClock();
  clock.advance(((Math.ceil(clock.t / DAY_MS) * DAY_MS - clock.t) % DAY_MS) + 12 * 3600_000);
  const dice = { r: 0 };
  const room = new RegionRoom(
    '7ATOMR',
    'local',
    new MemoryRegionStore(),
    { now: clock.now, roll: () => dice.r },
    {},
  );
  const ada = raw(room);
  ada.say(hello('Ada', { create: { name: 'Vale', rules: { war: true, scale: 'total', supers: true } } }));
  const sam = raw(room);
  sam.say(hello('Sam'));
  ada.say(report('Adaton'));
  sam.say(report('Samton'));
  const view = (r: Raw): RegionView => last(r, 'region')!.region;
  /** Sam's city as the room holds it: tests reach in to give its report the race a later step reads. */
  const reportOf = (slot: number) =>
    (
      room as unknown as { meta: { cities: { slot: number; report: { atom?: { stage: number } } }[] } }
    ).meta.cities.find((c) => c.slot === slot)!.report;
  return { clock, dice, room, ada, sam, view, reportOf };
}

const sabotage = (id: string, target: unknown) => ({ t: 'op', to: 2, id, op: 'sabotage', target });

describe('M40: the atom bomb’s works as a saboteur’s target', () => {
  it('reads the target, and only with a sabotage', () => {
    const ok = { t: 'op', to: 2, id: 'op-1a2b3c4d-9', op: 'sabotage', target: 'plant' };
    expect(parseRegionMsg(JSON.stringify(ok))).toEqual(ok);
    // Not a target without a sabotage; not a target the room does not know.
    expect(parseRegionMsg(JSON.stringify({ ...ok, op: 'reveal' }))).toBeNull();
    expect(parseRegionMsg(JSON.stringify({ ...ok, target: 'gate' }))).toBeNull();
    expect(parseRegionMsg(JSON.stringify({ ...ok, target: 'Plant' }))).toBeNull();
    // The old two are as they were.
    for (const target of ['power', 'depot'])
      expect(parseRegionMsg(JSON.stringify({ ...ok, target }))).toEqual({ ...ok, target });
  });

  it('turns it away in words against a city whose report shows no race, and keeps the connection', () => {
    const { ada, sam, dice, clock, view } = region();
    dice.r = 0;
    ada.say(sabotage('plant-1', 'plant'));
    expect(last(ada, 'opRefused')).toMatchObject({
      t: 'opRefused',
      id: 'plant-1',
      reason: 'Samton isn’t racing for the atom bomb',
    });
    expect(all(ada, 'opKept')).toHaveLength(0);
    expect(ada.closed, 'the sender stays').toBeNull();
    expect(sam.closed).toBeNull();
    // Nothing was decided: no verdict kept, no day counted, nothing waiting for Sam.
    expect(all(sam, 'opOn')).toHaveLength(0);
    expect(view(ada).cities.find((c) => c.slot === 2)).toMatchObject({ opsLeft: 4 });
    // Asked again, the same answer (a refusal is not a verdict); and the old targets still work.
    clock.advance(60_000);
    ada.say(sabotage('plant-1', 'plant'));
    expect(all(ada, 'opRefused').map((m) => m.reason)).toEqual([
      'Samton isn’t racing for the atom bomb',
      'Samton isn’t racing for the atom bomb',
    ]);
    ada.say(sabotage('power-1', 'power'));
    expect(last(ada, 'opKept')).toMatchObject({ id: 'power-1', outcome: 'success' });
  });

  it('keeps it, with its target, once the target’s report shows a race to slow', () => {
    const { ada, sam, dice, reportOf, view } = region();
    dice.r = 0;
    const racing = (stage: number) => {
      reportOf(2).atom = { stage };
    };
    // The bomb used, or finished past the last stage that can be slowed: nothing to strike.
    racing(8);
    ada.say(sabotage('plant-1', 'plant'));
    expect(last(ada, 'opRefused')?.reason).toBe('Samton isn’t racing for the atom bomb');
    racing(3);
    ada.say(sabotage('plant-2', 'plant'));
    expect(last(ada, 'opKept')).toMatchObject({ id: 'plant-2', outcome: 'success' });
    // Sam hears of it with its target; the sim there chooses what to strike.
    expect(last(sam, 'opOn')).toMatchObject({
      from: 1,
      id: 'plant-2',
      op: 'sabotage',
      target: 'plant',
      outcome: 'success',
      late: false,
    });
    // It counts as the day's saboteur like any other.
    ada.say(sabotage('plant-3', 'plant'));
    expect(last(ada, 'opRefused')?.reason).toBe(
      'Samton has had a saboteur today: no more until midnight (UTC)',
    );
    expect(view(ada).cities.find((c) => c.slot === 2)).toMatchObject({ opsLeft: 3 });
  });

  it('is turned away first by the rules that always applied: war, neutral cities, an absent player', () => {
    const { ada, sam, room, reportOf } = region();
    sam.say(report('Samton', { shield: 'neutral' }));
    reportOf(2).atom = { stage: 3 };
    ada.say(sabotage('n-1', 'plant'));
    expect(last(ada, 'opRefused')?.reason).toBe('Samton is neutral: spies may only look there');
    sam.say(report('Samton'));
    reportOf(2).atom = { stage: 3 };
    room.closed(sam.conn);
    ada.say(sabotage('away-1', 'plant'));
    expect(last(ada, 'opRefused')?.reason).toBe('Samton’s player isn’t here: saboteurs wait for them');
  });
});
