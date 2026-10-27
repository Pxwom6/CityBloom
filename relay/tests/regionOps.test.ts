import { describe, expect, it } from 'vitest';
import {
  MAX_PENDING_OPS,
  MemoryRegionStore,
  REGION_LIMITS,
  RegionRoom,
  parseRegionMsg,
  type RegionConn,
  type RegionRoomMsg,
  type RegionView,
} from '../region';
import { PROTOCOL_VERSION } from '../protocol';
import { DAY_MS } from '../limits';
import { spyOdds, spyOutcome } from '../../src/data/intel';
import { FakeClock } from './harness';

/**
 * M37, step 9: the region room decides operations between friends' cities (design call 14): spies'
 * looks, sabotage and thefts, and the blackout tower; and it counts battles that bring a
 * superweapon. Its dice are its own (fixed here through the env), each sender's verdicts are
 * remembered, and operations are kept for their targets like battles, in the region's record.
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

/**
 * A region at war (superweapons on unless `supers` is false) with Ada's and Sam's cities, each
 * reported; the room's dice give `dice.r` (change it between operations).
 */
function region(opts: { supers?: boolean; limits?: Record<string, number> } = {}) {
  const clock = new FakeClock();
  // Midday UTC, so a test's day doesn't end under it.
  clock.advance(((Math.ceil(clock.t / DAY_MS) * DAY_MS - clock.t) % DAY_MS) + 12 * 3600_000);
  const dice = { r: 0, rolls: 0 };
  const store = new MemoryRegionStore();
  const room = new RegionRoom(
    '7OPSRM',
    'local',
    store,
    {
      now: clock.now,
      roll: () => {
        dice.rolls++;
        return dice.r;
      },
    },
    opts.limits ?? {},
  );
  const ada = raw(room);
  ada.say(
    hello('Ada', {
      create: {
        name: 'Vale',
        rules: { war: true, scale: 'skirmish', ...(opts.supers === false ? {} : { supers: true }) },
      },
    }),
  );
  const sam = raw(room);
  sam.say(hello('Sam'));
  const samWelcome = last(sam, 'rwelcome')!;
  ada.say(report('Adaton'));
  sam.say(report('Samton'));
  const view = (r: Raw): RegionView => last(r, 'region')!.region;
  const city = (slot: number) => view(ada).cities.find((c) => c.slot === slot)!;
  return { clock, dice, store, room, ada, sam, samSecret: samWelcome.secret, view, city };
}

const op = (id: string, o: string, extra: Record<string, unknown> = {}) => ({
  t: 'op',
  to: 2,
  id,
  op: o,
  ...extra,
});

describe('M37: the region decides operations between friends', () => {
  it('reads only sensible operation messages', () => {
    const ok = { t: 'op', to: 2, id: 'op-1a2b3c4d-9', op: 'reveal' };
    expect(parseRegionMsg(JSON.stringify(ok))).toEqual(ok);
    expect(parseRegionMsg(JSON.stringify({ ...ok, op: 'sabotage', target: 'depot' }))).toEqual({
      ...ok,
      op: 'sabotage',
      target: 'depot',
    });
    expect(parseRegionMsg(JSON.stringify({ ...ok, op: 'steal', branch: 'air' }))).toEqual({
      ...ok,
      op: 'steal',
      branch: 'air',
    });
    for (const bad of [
      { ...ok, to: 0 },
      { ...ok, id: 'has spaces' },
      { ...ok, op: 'nuke' },
      { ...ok, op: 'sabotage' },
      { ...ok, op: 'sabotage', target: 'school' },
      { ...ok, op: 'steal' },
      { ...ok, op: 'steal', branch: 'magic' },
      { ...ok, target: 'power' },
      { ...ok, branch: 'air' },
    ])
      expect(parseRegionMsg(JSON.stringify(bad)), JSON.stringify(bad)).toBeNull();
    expect(parseRegionMsg(JSON.stringify({ t: 'opSeen', id: 'op-1', from: 2 }))).toEqual({
      t: 'opSeen',
      id: 'op-1',
      from: 2,
    });
    expect(parseRegionMsg(JSON.stringify({ t: 'opSeen', id: 'op-1' }))).toBeNull();
    // A report's war fields are checked when there.
    const r = report('Adaton').report;
    for (const bad of [{ tiers: [0, 0, 0] }, { tiers: [0, 0, 0, 0, 5, 0] }, { counter: 2000 }, { clock: -1 }])
      expect(parseRegionMsg(JSON.stringify({ t: 'report', city: 'A', report: { ...r, ...bad } }))).toBeNull();
    // A force's superweapon is one.
    expect(
      parseRegionMsg(JSON.stringify({ t: 'forceOut', to: 2, units: 3, hours: 4, super: 'tank' })),
    ).toBeNull();
    expect(
      parseRegionMsg(
        JSON.stringify({ t: 'forceOut', to: 2, units: 3, hours: 4, super: 'windupbot', gate: true }),
      ),
    ).toEqual({ t: 'forceOut', to: 2, units: 3, hours: 4, super: 'windupbot', gate: true });
  });

  it('rolls a spy with its own dice and the shared odds, and tells the target', () => {
    const { ada, sam, dice } = region();
    // A look round at intel tier 2 against counter 250: 750 succeed, 137 are caught (design call 11).
    const odds = spyOdds('reveal', 2, 250, false, false);
    expect(odds).toEqual({ success: 750, caught: 137 });
    for (const [k, r] of [0, 749, 750, 862, 863, 999].entries()) {
      dice.r = r;
      ada.say(op(`look-${k}`, 'reveal'));
      // Three at once, then one every two minutes (the sender's pace).
      const answer = ada.got.filter((m) => m.t === 'opKept' || m.t === 'opRefused').at(-1) as
        Extract<RegionRoomMsg, { t: 'opKept' | 'opRefused' }> | undefined;
      expect(answer?.id).toBe(`look-${k}`);
      if (answer?.t === 'opKept') expect(answer.outcome).toBe(spyOutcome(r, odds));
      // Each one past the burst waits its turn.
      if (answer?.t === 'opRefused') {
        expect(answer.later).toBe(REGION_LIMITS.opEvery);
        break;
      }
    }
    const kept = all(ada, 'opKept');
    expect(kept.map((m) => m.outcome)).toEqual(['success', 'success', 'failed']);
    // Sam, playing, hears of those that did something there (a quiet failure leaves no trace).
    expect(all(sam, 'opOn').map((m) => [m.id, m.outcome, m.late])).toEqual([
      ['look-0', 'success', false],
      ['look-1', 'success', false],
    ]);
  });

  it('gives an operation sent again the same answer, and counts it once', () => {
    const { ada, dice, city, clock } = region();
    dice.r = 999;
    ada.say(op('again', 'reveal'));
    expect(last(ada, 'opKept')).toEqual({ t: 'opKept', id: 'again', outcome: 'caught' });
    const left = city(2).opsLeft;
    expect(left).toBe(REGION_LIMITS.opsPerDay - 1);
    // Its answer lost: sent again with other dice, the region remembers.
    dice.r = 0;
    clock.advance(5 * 60_000);
    ada.say(op('again', 'reveal'));
    expect(all(ada, 'opKept').map((m) => m.outcome)).toEqual(['caught', 'caught']);
    expect(city(2).opsLeft).toBe(left);
    // The same id for something else is turned away.
    ada.say(op('again', 'steal', { branch: 'air' }));
    expect(last(ada, 'opRefused')).toMatchObject({ id: 'again', reason: expect.stringContaining('already') });
  });

  it('a caught spy is a notice to the whole region, and lets the target answer a newcomer', () => {
    const { ada, sam, dice, city, clock } = region();
    // Samton is a newcomer: friends may only look and steal there, unless it struck first.
    sam.say(report('Samton', { shield: 'new' }));
    ada.say(op('sab-1', 'sabotage', { target: 'power' }));
    expect(last(ada, 'opRefused')).toMatchObject({
      id: 'sab-1',
      reason: 'Samton is too young or small for that, unless it strikes first',
    });
    // Sam's spy is caught in Adaton: every city hears, and Adaton may answer.
    dice.r = 999;
    sam.say({ t: 'op', to: 1, id: 'sam-look', op: 'reveal' });
    expect(last(sam, 'opKept')).toMatchObject({ id: 'sam-look', outcome: 'caught' });
    for (const r of [ada, sam])
      expect(r.got).toContainEqual({ t: 'notice', text: 'A spy from Samton was caught in Adaton' });
    expect(city(1).raidedBy).toEqual([2]);
    dice.r = 0;
    clock.advance(60_000);
    ada.say(op('sab-2', 'sabotage', { target: 'power' }));
    expect(last(ada, 'opKept')).toMatchObject({ id: 'sab-2', outcome: 'success' });
    expect(last(sam, 'opOn')).toMatchObject({
      from: 1,
      id: 'sab-2',
      op: 'sabotage',
      target: 'power',
      late: false,
    });
  });

  it('turns a neutral city’s saboteurs away, and saboteurs from a neutral one', () => {
    const { ada, sam } = region();
    sam.say(report('Samton', { shield: 'neutral' }));
    ada.say(op('n-1', 'sabotage', { target: 'depot' }));
    expect(last(ada, 'opRefused')?.reason).toBe('Samton is neutral: spies may only look there');
    ada.say(op('n-2', 'reveal'));
    expect(last(ada, 'opKept')?.id).toBe('n-2');
    sam.say({ t: 'op', to: 1, id: 'n-3', op: 'steal', branch: 'land' });
    expect(last(sam, 'opRefused')?.reason).toBe('Samton is neutral: its spies only look');
  });

  it('keeps looks and thefts for an absent friend, refuses saboteurs and blackouts, and delivers late', () => {
    const { room, ada, sam, samSecret, clock } = region();
    // Samton is further on in Air research than Adaton.
    sam.say(report('Samton', { tiers: [0, 2, 0, 0, 1, 0] }));
    room.closed(sam.conn);
    ada.say(op('away-1', 'sabotage', { target: 'power' }));
    expect(last(ada, 'opRefused')?.reason).toBe('Samton’s player isn’t here: saboteurs wait for them');
    ada.say(op('away-2', 'blackout'));
    expect(last(ada, 'opRefused')?.reason).toBe('Samton’s player isn’t here: superweapons wait for them');
    ada.say(op('away-3', 'reveal'));
    ada.say(op('away-4', 'steal', { branch: 'air' }));
    // A theft takes points of the tier Adaton lacks next: Air 1.
    expect(all(ada, 'opKept')).toEqual([
      { t: 'opKept', id: 'away-3', outcome: 'success' },
      { t: 'opKept', id: 'away-4', outcome: 'success', stole: 'air1' },
    ]);
    // Not where Samton is no further on.
    clock.advance(5 * 60_000);
    ada.say(op('away-5', 'steal', { branch: 'land' }));
    expect(last(ada, 'opRefused')?.reason).toBe('Samton is no further than you in Land research');
    // Sam comes back: both come, late (they bring only a notice).
    const back = raw(room);
    back.say(hello('Sam', { rejoin: { slot: 2, secret: samSecret } }));
    expect(all(back, 'opOn').map((m) => [m.id, m.op, m.late])).toEqual([
      ['away-3', 'reveal', true],
      ['away-4', 'steal', true],
    ]);
    // Seen: forgotten, and not offered again.
    back.say({ t: 'opSeen', id: 'away-3', from: 1 });
    back.say({ t: 'opSeen', id: 'away-4', from: 1 });
    const again = raw(room);
    again.say(hello('Sam', { rejoin: { slot: 2, secret: samSecret } }));
    expect(all(again, 'opOn')).toHaveLength(0);
  });

  it('holds a friend to four spies and one saboteur a day, and keeps eight waiting at most', () => {
    const { room, ada, sam, clock, city } = region();
    const send = (id: string, o: string, extra: Record<string, unknown> = {}) => {
      clock.advance(REGION_LIMITS.opEvery);
      ada.say(op(id, o, extra));
      return ada.got.at(-1)!.t === 'region'
        ? ada.got.filter((m) => m.t !== 'region').at(-1)!
        : ada.got.at(-1)!;
    };
    expect(send('d1-s1', 'sabotage', { target: 'power' })).toMatchObject({ t: 'opKept' });
    expect(send('d1-s2', 'sabotage', { target: 'depot' })).toMatchObject({
      t: 'opRefused',
      reason: 'Samton has had a saboteur today: no more until midnight (UTC)',
    });
    for (const k of [2, 3, 4]) expect(send(`d1-r${k}`, 'reveal')).toMatchObject({ t: 'opKept' });
    expect(send('d1-r5', 'reveal')).toMatchObject({
      t: 'opRefused',
      reason: 'Samton has had four spies today: no more until midnight (UTC)',
    });
    expect(city(2).opsLeft).toBe(0);
    // Sam goes; a new day, then another: four more wait for Sam, then no more.
    room.closed(sam.conn);
    clock.advance(DAY_MS);
    for (const k of [1, 2, 3, 4]) expect(send(`d2-r${k}`, 'reveal')).toMatchObject({ t: 'opKept' });
    clock.advance(DAY_MS);
    expect(send('d3-r1', 'reveal')).toMatchObject({
      t: 'opRefused',
      reason: `Samton has ${MAX_PENDING_OPS} operations waiting for its player: no more until it takes them`,
    });
  });

  it('a blackout needs superweapons on, and is the target’s superweapon and one of its raids for the day', () => {
    const off = region({ supers: false });
    off.ada.say(op('bo-1', 'blackout'));
    expect(last(off.ada, 'opRefused')?.reason).toBe('The region’s rules turn superweapons off');

    const { ada, sam, city, clock } = region();
    const raids = city(2).raidsLeft!;
    ada.say(op('bo-1', 'blackout'));
    expect(last(ada, 'opKept')).toEqual({ t: 'opKept', id: 'bo-1', outcome: 'success' });
    expect(last(sam, 'opOn')).toEqual({
      t: 'opOn',
      from: 1,
      id: 'bo-1',
      op: 'blackout',
      outcome: 'success',
      late: false,
    });
    expect(city(2).supersLeft).toBe(0);
    expect(city(2).raidsLeft).toBe(raids - 1);
    // Struck: Samton may answer.
    expect(city(2).raidedBy).toEqual([1]);
    clock.advance(5 * 60_000);
    ada.say(op('bo-2', 'blackout'));
    expect(last(ada, 'opRefused')?.reason).toBe(
      'Samton has taken a superweapon today: no more until midnight (UTC)',
    );
    // Nor a superweapon's battle the same day.
    ada.say({ t: 'battle', to: 2, id: 'robot-1', part: 0, parts: 1, data: 'X', super: true });
    expect(last(ada, 'battleRefused')).toMatchObject({
      id: 'robot-1',
      reason: 'Samton has taken a superweapon today: no more until midnight (UTC)',
    });
  });

  it('counts a battle that brings a superweapon, refuses it without its target’s player, and flags it', () => {
    const off = region({ supers: false });
    off.ada.say({ t: 'battle', to: 2, id: 'robot-0', part: 0, parts: 1, data: 'X', super: true });
    expect(last(off.ada, 'battleRefused')?.reason).toBe('The region’s rules turn superweapons off');

    const { room, ada, sam, samSecret, city } = region();
    ada.say({ t: 'battle', to: 2, id: 'robot-1', part: 0, parts: 1, data: 'X', super: true });
    expect(last(ada, 'battleKept')?.id).toBe('robot-1');
    expect(last(sam, 'battle')).toMatchObject({ id: 'robot-1', super: true, late: false });
    expect(city(2).supersLeft).toBe(0);
    // An ordinary raid is still one of the day's three.
    ada.say({ t: 'battle', to: 2, id: 'raid-1', part: 0, parts: 1, data: 'Y' });
    expect(last(ada, 'battleKept')?.id).toBe('raid-1');
    expect(last(sam, 'battle')).not.toHaveProperty('super');
    // The flag waits with the battle for a player who left before seeing it.
    room.closed(sam.conn);
    const back = raw(room);
    back.say(hello('Sam', { rejoin: { slot: 2, secret: samSecret } }));
    expect(all(back, 'battle').map((m) => [m.id, m.super ?? false])).toEqual([
      ['robot-1', true],
      ['raid-1', false],
    ]);
    // A superweapon never strikes an absent friend: refused, with no half-strength fight again.
    room.closed(back.conn);
    const next = region();
    next.room.closed(next.sam.conn);
    next.ada.say({
      t: 'battle',
      to: 2,
      id: 'robot-2',
      part: 0,
      parts: 1,
      data: 'X',
      super: true,
      away: true,
    });
    const refused = last(next.ada, 'battleRefused')!;
    expect(refused.reason).toBe('Samton’s player isn’t here: superweapons wait for them');
    expect(refused.again).toBeUndefined();
  });

  it('passes a force’s superweapon and the gate on to its target', () => {
    const { ada, sam } = region();
    ada.say({ t: 'forceOut', to: 2, units: 1, hours: 12, super: 'windupbot' });
    ada.say({ t: 'forceOut', to: 2, units: 5, hours: 1, gate: true });
    expect(all(sam, 'incoming')).toEqual([
      { t: 'incoming', from: 1, units: 1, hours: 12, super: 'windupbot' },
      { t: 'incoming', from: 1, units: 5, hours: 1, gate: true },
    ]);
  });

  it('keeps operations in its record, a row each, and remembers verdicts across a restart', () => {
    const { store, ada, dice, clock } = region();
    const before = store.rowsWritten;
    for (let k = 0; k < 3; k++) {
      dice.r = k === 1 ? 999 : 0;
      clock.advance(REGION_LIMITS.opEvery);
      ada.say(op(`rows-${k}`, 'reveal'));
    }
    expect(all(ada, 'opKept')).toHaveLength(3);
    // The region's record only (no battle or save rows): one write each.
    expect(store.rowsWritten - before).toBeLessThanOrEqual(3);
    expect(store.battles.size).toBe(0);
    // A new object over the same store: the same answer for an operation sent again.
    const clock2 = new FakeClock();
    clock2.t = clock.t;
    const room2 = new RegionRoom('7OPSRM', 'local', store, { now: clock2.now, roll: () => 0 });
    const a2 = raw(room2);
    const secret = (ada.got.find((m) => m.t === 'rwelcome') as Extract<RegionRoomMsg, { t: 'rwelcome' }>)
      .secret;
    a2.say(hello('Ada', { rejoin: { slot: 1, secret } }));
    a2.say(op('rows-1', 'reveal'));
    expect(last(a2, 'opKept')).toEqual({ t: 'opKept', id: 'rows-1', outcome: 'caught' });
  });

  it('turns away an older page', () => {
    const clock = new FakeClock();
    const room = new RegionRoom('7OLDPG', 'local', new MemoryRegionStore(), clock);
    const r = raw(room);
    r.say({ ...hello('Ada', { create: { name: 'Vale' } }), v: 4 });
    expect(r.got[0]).toMatchObject({ t: 'error', code: 'version' });
    expect(r.closed).toBe('version');
  });
});
