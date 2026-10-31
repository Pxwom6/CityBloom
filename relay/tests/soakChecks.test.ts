import { describe, expect, it } from 'vitest';
import { Checks, notCoveredByLength, required, type Before } from '../../scripts/lib/soak/checks';
import { parseArgs } from '../../scripts/dev/regionsoak';
import type { BattleLog, SoakOptions } from '../../scripts/lib/soak/types';

/**
 * The war soak's judges, tried on their own (M39 step 10's review): a soak that cannot fail proves
 * nothing, and the long one takes hours. Each test hands `Checks` a stand-in soak and the commands a
 * city's sim was asked to apply, as the real soak does, and asks what it makes of them: a battle or a
 * report applied twice is a failure unless a restore from an older save between the two lost the
 * first; a treaty one city skipped, a pact one sim lacks, a force that vanished and a battle that
 * waits in the room for a city that is here are failures too.
 */

type Fail = { kind: string; text: string };

/** A stand-in for the soak: what `Checks` reads of it. */
function world(players: unknown[] = []) {
  let t = 0;
  let tickets = 0;
  const fails: Fail[] = [];
  const notes: string[] = [];
  const covered: string[] = [];
  const room = {
    meta: { friends: { queue: {}, pacts: [], vassals: [], wars: [] }, history: [] as unknown[] },
    store: { battles: new Map() },
  };
  const w = {
    now: () => t,
    ticket: () => ++tickets,
    covered: (k: string) => void covered.push(k),
    note: (s: string) => void notes.push(s),
    fail: (kind: string, text: string) => void fails.push({ kind, text }),
    room,
    players,
    bySlot: (slot: number) => (players as { slot: number }[]).find((p) => p.slot === slot),
    player: (name: string) => (players as { name: string }[]).find((p) => p.name === name),
    opts: {},
  };
  const checks = new Checks(w as never);
  return { w, checks, fails, notes, covered, room, at: (ms: number) => void (t = ms), ticket: w.ticket };
}

/** A player as the checks see one: a city's sim with just what they read, and the restores it has had. */
function player(name: string, slot: number, over: Record<string, unknown> = {}) {
  return {
    name,
    slot,
    restores: [] as { n: number; fromN: number }[],
    page: {},
    up: false,
    upSince: 0,
    sim: {
      state: {
        war: {
          taken: [] as string[],
          expeditions: [] as unknown[],
          diplomacy: { pacts: [] as unknown[], subjects: [] as unknown[], wars: [] as unknown[] },
          reports: [] as unknown[],
        },
        economy: { month: {} as Record<string, number> },
        region: { neighbours: [] as unknown[] },
      },
    },
    ...over,
  };
}

const resolve = (id: string, mode = 'live') =>
  ({ type: 'battleResolve', mode, from: 1, input: { id } }) as never;
const report = (expedition: number) => ({ type: 'battleReport', expedition }) as never;
const OK = { ok: true } as never;

describe('M39 step 10 review: a battle or a report taken twice', () => {
  it('fails a second take though the city was restored once, long before (the restore must lie between the two)', () => {
    const { checks, fails, ticket } = world();
    // Sam came back from a save early in the run, as every player does in a long one.
    const sam = player('Sam', 2);
    const early = ticket();
    sam.restores.push({ n: ticket(), fromN: early });
    checks.applied(sam as never, 1, resolve('exp-a-5'), OK);
    checks.applied(sam as never, 1, resolve('exp-a-5'), OK);
    checks.applied(sam as never, 1, report(5), OK);
    checks.applied(sam as never, 1, report(5), OK);
    expect(fails.map((f) => f.kind).sort()).toEqual(['applied-twice', 'reported-twice']);
  });

  it('excuses a second take when a restore from an older save lay between the two, and says so', () => {
    const { checks, fails, notes, ticket } = world();
    const sam = player('Sam', 2);
    const saved = ticket(); // an autosave
    checks.applied(sam as never, 1, resolve('exp-a-5'), OK);
    checks.applied(sam as never, 1, report(5), OK);
    // A crash: the city came back from the autosave made before it took either.
    sam.restores.push({ n: ticket(), fromN: saved });
    checks.applied(sam as never, 2, resolve('exp-a-5'), OK);
    checks.applied(sam as never, 2, report(5), OK);
    expect(fails).toEqual([]);
    expect(notes.filter((n) => /older than the first/.test(n))).toHaveLength(2);
    expect(checks.rewinds).toBe(2);
  });

  it('fails it when the restore was from a save made after the first take (a reload saves first)', () => {
    const { checks, fails, ticket } = world();
    const sam = player('Sam', 2);
    checks.applied(sam as never, 1, resolve('exp-a-5'), OK);
    const saved = ticket();
    sam.restores.push({ n: ticket(), fromN: saved });
    checks.applied(sam as never, 2, resolve('exp-a-5'), OK);
    expect(fails.map((f) => f.kind)).toEqual(['applied-twice']);
  });

  it('counts a third take from the second, not from the first', () => {
    const { checks, fails, ticket } = world();
    const sam = player('Sam', 2);
    const saved = ticket();
    checks.applied(sam as never, 1, resolve('exp-a-5'), OK);
    sam.restores.push({ n: ticket(), fromN: saved });
    checks.applied(sam as never, 2, resolve('exp-a-5'), OK); // excused: the first was lost
    checks.applied(sam as never, 2, resolve('exp-a-5'), OK); // no restore since the second
    expect(fails.map((f) => f.kind)).toEqual(['applied-twice']);
  });

  it('lets a record stand in for the battle a city hosts only if its player was disturbed in it or the city was loaded again since, and fails it otherwise', () => {
    const { checks, fails, at, ticket } = world();
    const sam = player('Sam', 2);
    const log = {
      id: 'exp-a-5',
      attacker: 1,
      defender: 2,
      disturbed: [],
      views: new Map(),
    } as unknown as BattleLog;
    checks.battles.set(log.id, log);
    at(1_000);
    checks.applied(sam as never, 1, resolve('exp-a-5'), OK);
    at(40_000);
    // No one was disturbed: the city took the record of a battle it was hosting, and nothing explains it.
    checks.applied(sam as never, 1, resolve('exp-a-5', 'instant'), OK, 'exp-a-5');
    expect(fails.map((f) => f.kind)).toEqual(['applied-twice']);
    expect(checks.standIns).toBe(0);
    // Disturbed in it: allowed, and counted.
    fails.length = 0;
    log.disturbed.push({ name: 'Sam', what: 'reloads the page', at: 20_000 });
    at(41_000);
    checks.applied(sam as never, 1, resolve('exp-a-5', 'instant'), OK, 'exp-a-5');
    expect(fails).toEqual([]);
    expect(checks.standIns).toBe(1);
    // Not disturbed in that battle, but the city crashed and came back after it began hosting it: the
    // restore took the end of the hosted battle with it, and the record finishes it.
    fails.length = 0;
    const kit = player('Kit', 3);
    const log2 = {
      id: 'exp-b-6',
      attacker: 1,
      defender: 3,
      disturbed: [],
      views: new Map(),
    } as unknown as BattleLog;
    checks.battles.set(log2.id, log2);
    checks.applied(kit as never, 1, resolve('exp-b-6'), OK);
    const saved = ticket();
    kit.restores.push({ n: ticket(), fromN: saved });
    checks.applied(kit as never, 2, resolve('exp-b-6', 'instant'), OK, 'exp-b-6');
    expect(fails).toEqual([]);
    expect(checks.standIns).toBe(2);
  });

  it('fails a record that took what the hosted part of the same battle had taken already', () => {
    const { checks, fails, at } = world();
    const sam = player('Sam', 2);
    const log = {
      id: 'exp-a-5',
      attacker: 1,
      defender: 2,
      disturbed: [{ name: 'Sam', what: 'crashed', at: 1 }],
      views: new Map(),
    } as unknown as BattleLog;
    checks.battles.set(log.id, log);
    at(1_000);
    checks.applied(sam as never, 1, resolve('exp-a-5'), OK);
    // The hosted part had brought down buildings 7 and 8 and wrecked civic structure 3; the record
    // (the battle's report in the city now) brings down 8 again and wrecks 3 again.
    sam.sim.state.war.reports.push({ collapsed: [8, 9], civics: [{ id: 3, wrecked: true }] });
    const was: Before = { lines: {}, pacts: 0, hosted: { id: 'exp-a-5', collapsed: [7, 8], wrecked: [3] } };
    at(40_000);
    checks.applied(sam as never, 1, resolve('exp-a-5', 'instant'), OK, 'exp-a-5', was);
    expect(fails.map((f) => f.kind)).toEqual(['damage-doubled']);
    expect(checks.standInDamage[0]).toMatchObject({ buildings: 1, wrecked: 1 });
  });
});

describe('M39 step 10 review: treaties', () => {
  const treaty = (id: string, slot: number, side: 'a' | 'b', terms: unknown[]) =>
    ({ type: 'friendTreaty', id, slot, side, terms }) as never;

  it('fails a treaty a city said yes to and did not write down, and reparations that did not reach its ledger', () => {
    const { checks, fails } = world();
    const sam = player('Sam', 2);
    // Said yes, but the city's list of what it has taken lacks it.
    checks.applied(sam as never, 1, treaty('p1-x', 1, 'b', [{ k: 'peace' }]), OK, undefined, {
      lines: {},
      pacts: 0,
    });
    expect(fails.map((f) => f.kind)).toEqual(['treaty-not-applied']);
    fails.length = 0;
    // Written down, but nothing was booked: side b pays what a's terms say the other ('them') pays.
    sam.sim.state.war.taken.push('1:treaty:p2-x');
    checks.applied(
      sam as never,
      1,
      treaty('p2-x', 1, 'b', [{ k: 'reparations', payer: 'them', amount: 1500 }]),
      OK,
      undefined,
      { lines: {}, pacts: 0 },
    );
    expect(fails.map((f) => f.kind)).toEqual(['treaty-money']);
    // Booked as the terms say (side b pays what a's terms call 'them'; the other side receives it).
    fails.length = 0;
    sam.sim.state.war.taken.push('1:treaty:p3-x');
    sam.sim.state.economy.month.reparationsOut = -1500;
    checks.applied(
      sam as never,
      1,
      treaty('p3-x', 1, 'b', [{ k: 'reparations', payer: 'them', amount: 1500 }]),
      OK,
      undefined,
      { lines: {}, pacts: 0 },
    );
    expect(fails).toEqual([]);
    const kit = player('Kit', 1);
    kit.sim.state.war.taken.push('2:treaty:p3-x');
    kit.sim.state.economy.month.reparationsIn = 1500;
    checks.applied(
      kit as never,
      1,
      treaty('p3-x', 2, 'a', [{ k: 'reparations', payer: 'them', amount: 1500 }]),
      OK,
      undefined,
      { lines: {}, pacts: 0 },
    );
    expect(fails).toEqual([]);
  });

  it('fails a tribute that made no pact', () => {
    const { checks, fails } = world();
    const sam = player('Sam', 2);
    sam.sim.state.war.taken.push('1:treaty:p4-x');
    checks.applied(
      sam as never,
      1,
      treaty('p4-x', 1, 'b', [{ k: 'tribute', payer: 'us', amount: 100, months: 3 }]),
      OK,
      undefined,
      { lines: {}, pacts: 0 },
    );
    expect(fails.map((f) => f.kind)).toEqual(['treaty-money']);
  });

  it('asks at the end whether both cities applied every treaty and the room has no treaty waiting for a city that is here', () => {
    const sam = player('Sam', 2);
    const kit = player('Kit', 1);
    const { checks, fails, room, at } = world([kit, sam]);
    // The room signed p5-x between Kit and Sam: only Kit applied it (Sam's sim skipped it).
    kit.sim.state.war.taken.push('2:treaty:p5-x');
    at(10_000);
    checks.applied(kit as never, 1, treaty('p5-x', 2, 'a', [{ k: 'peace' }]), OK, undefined, {
      lines: {},
      pacts: 0,
    });
    room.meta.history.push({ id: 1, kind: 'treaty', text: 'Kit and Sam sign a treaty' });
    room.meta.friends.queue = { 2: [{ id: 'p5-x', a: 1, b: 2, terms: [], at: 10_000 }] } as never;
    checks.finish();
    expect(fails.map((f) => f.kind)).toEqual(['treaty-one-sided', 'treaty-one-sided']);
    expect(fails[0]!.text).toMatch(/never applied by Sam/);
    expect(fails[1]!.text).toMatch(/still waits for Sam/);
  });

  it('counts a treaty the room signed that no city ever applied nor left in a queue', () => {
    const { checks, fails, room } = world([player('Sam', 2), player('Kit', 1)]);
    room.meta.history.push({ id: 1, kind: 'treaty', text: 'Kit and Sam sign a treaty' });
    checks.finish();
    expect(fails.map((f) => f.kind)).toEqual(['treaty-one-sided']);
    expect(fails[0]!.text).toMatch(/signed 1 treaties and only 0/);
  });
});

describe('M39 step 10 review: the region against each city’s own sim', () => {
  const upPlayer = (name: string, slot: number, pacts: unknown[], roomView: unknown[]) =>
    player(name, slot, {
      up: true,
      upSince: 0,
      page: {
        fw: {
          view: () => ({ wars: [], pacts: roomView, vassals: [], history: [], incoming: [], outgoing: [] }),
        },
      },
      sim: {
        state: {
          war: { diplomacy: { pacts, subjects: [], wars: [] }, taken: [], expeditions: [], reports: [] },
          economy: { month: {} },
          region: { neighbours: [{ id: 11, player: { slot: slot === 1 ? 2 : 1 } }] },
        },
      },
    });

  it('fails a pact the room keeps and the city’s sim lacks, though the page lists it', () => {
    const roomPacts = [{ id: 4, kind: 'alliance', a: 1, b: 2 }];
    const kit = upPlayer('Kit', 1, [{ room: 4, term: { k: 'alliance' }, with: 11 }], roomPacts);
    const sam = upPlayer('Sam', 2, [], roomPacts); // the page was told; the sim dropped it
    const { checks, fails, room, at } = world([kit, sam]);
    room.meta.friends.pacts = roomPacts as never;
    // A difference counts only once it has stood for 25 s.
    for (const ms of [30_000, 40_000, 70_000]) {
      at(ms);
      (checks as unknown as { consistency(): void }).consistency();
    }
    expect(fails.map((f) => f.kind)).toEqual(['region']);
    expect(fails[0]!.text).toMatch(/Sam's city holds pacts \[\], the room \[4:alliance:1\]/);
  });

  it('is content when every city mirrors what the room keeps', () => {
    const roomPacts = [{ id: 4, kind: 'alliance', a: 1, b: 2 }];
    const kit = upPlayer('Kit', 1, [{ room: 4, term: { k: 'alliance' }, with: 11 }], roomPacts);
    const sam = upPlayer('Sam', 2, [{ room: 4, term: { k: 'alliance' }, with: 11 }], roomPacts);
    const { checks, fails, room, at } = world([kit, sam]);
    room.meta.friends.pacts = roomPacts as never;
    for (const ms of [30_000, 40_000, 70_000]) {
      at(ms);
      (checks as unknown as { consistency(): void }).consistency();
    }
    expect(fails).toEqual([]);
  });
});

describe('M39 step 10 review: a battle or a force the end finds unfinished', () => {
  const log = (
    id: string,
    over: Partial<BattleLog> = {},
    room: Record<string, unknown> = { agree: true },
  ) => {
    const mine = { hash: 'h', step: 50 };
    const state = { ended: true, desync: false, hashes: { mine, room } };
    return {
      id,
      attacker: 1,
      defender: 2,
      attackerName: 'Kit',
      defenderName: 'Sam',
      began: 0,
      lastSeen: 0,
      views: new Map([
        [1, { slot: 1, role: 'attacker', state, seen: 0 }],
        [2, { slot: 2, role: 'defender', state, seen: 0 }],
      ]),
      disturbed: [],
      orders: { attacker: 0, defender: 0 },
      helpedBy: [],
      ...over,
    } as unknown as BattleLog;
  };

  it('fails a battle its defender never took even when the defender was disturbed in it (it is back and here)', () => {
    const { checks, fails } = world([player('Kit', 1), player('Sam', 2)]);
    const b = log('exp-a-5', { disturbed: [{ name: 'Sam', what: 'crashed', at: 5 }] });
    checks.battles.set(b.id, b);
    checks.finish();
    expect(fails.map((f) => f.kind)).toEqual(['not-applied']);
  });

  it('excuses it only for a battle the room ended with no one finishing it, and says so', () => {
    const { checks, fails, notes } = world([player('Kit', 1), player('Sam', 2)]);
    const b = log('exp-a-5', {}, { agree: false, abandoned: true });
    // (The judge notes that nobody finished it; the disturbance explains it.)
    b.disturbed.push({ name: 'Sam', what: 'left', at: 5 });
    checks.battles.set(b.id, b);
    checks.finish();
    expect(fails).toEqual([]);
    expect(checks.excused).toHaveLength(1);
    expect(notes.some((n) => /excused: .*no one finishing/.test(n))).toBe(true);
  });

  it('is content when the defender took it', () => {
    const sam = player('Sam', 2);
    const { checks, fails, at } = world([player('Kit', 1), sam]);
    const b = log('exp-a-5');
    checks.battles.set(b.id, b);
    at(1);
    checks.applied(sam as never, 1, resolve('exp-a-5'), OK);
    checks.finish();
    expect(fails).toEqual([]);
  });

  it('fails a force that vanished with neither a report nor a recall, and one that is fighting though its battle is over', () => {
    const kit = player('Kit', 1);
    const sam = player('Sam', 2);
    const { checks, fails, at } = world([kit, sam]);
    at(5_000);
    checks.applied(sam as never, 1, resolve('exp-x-8'), OK);
    checks.applied(kit as never, 1, { type: 'sendForce' } as never, { ok: true, created: [7] } as never);
    checks.applied(kit as never, 1, { type: 'sendForce' } as never, { ok: true, created: [8] } as never);
    checks.applied(kit as never, 1, { type: 'sendForce' } as never, { ok: true, created: [9] } as never);
    checks.applied(kit as never, 1, report(9), OK);
    // 8 is still fighting, and its live battle (exp-x-8) is over; 9 was reported and has gone home; 7 is gone, unreported.
    kit.sim.state.war.expeditions.push({ id: 8, state: 'fighting' });
    const b = log('exp-x-8');
    checks.battles.set(b.id, b);
    checks.finish();
    expect(fails.map((f) => `${f.kind}: ${/force (\d+)/.exec(f.text)?.[1]}`).sort()).toEqual([
      'not-reported: 7',
      'not-reported: 8',
    ]);
  });

  it('leaves a force that is still on its way, or whose city came back from a save older than its sending', () => {
    const kit = player('Kit', 1);
    const { checks, fails, ticket } = world([kit, player('Sam', 2)]);
    const saved = ticket();
    checks.applied(kit as never, 1, { type: 'sendForce' } as never, { ok: true, created: [7] } as never);
    checks.applied(kit as never, 1, { type: 'sendForce' } as never, { ok: true, created: [8] } as never);
    kit.sim.state.war.expeditions.push({ id: 7, state: 'out' });
    kit.restores.push({ n: ticket(), fromN: saved });
    checks.finish();
    expect(fails).toEqual([]);
    expect(checks.excused).toHaveLength(1);
  });

  it('fails a battle row kept in the room for a city that is here', () => {
    const sam = player('Sam', 2);
    const { checks, fails, room, at } = world([sam]);
    (checks as unknown as { rowAt: Map<string, number> }).rowAt.set('2:0', 1_000);
    room.store.battles.set('2:0', ['x']);
    room.store.battles.set('5:0', ['replay']); // a replay, not a battle for a city
    at(200_000);
    checks.finish();
    expect(fails.map((f) => f.kind)).toEqual(['unclaimed-battle']);
  });
});

describe('M39 step 10 review: what a run must have covered', () => {
  const o = (minutes: number, over: Partial<SoakOptions> = {}): SoakOptions => ({
    minutes,
    mode: 'virtual',
    seed: 's',
    speed: 1,
    fairClock: false,
    disturb: true,
    story: 'full',
    log: () => undefined,
    ...over,
  });

  it('asks a long run for a disturbed battle and a handover, a crash run for a crash', () => {
    const keys = (x: SoakOptions) => required(x).map(([k]) => k);
    expect(keys(o(120))).toEqual(expect.arrayContaining(['disturbedBattles', 'handovers']));
    expect(keys(o(30))).not.toContain('handovers');
    expect(keys(o(30, { crash: true }))).toContain('crashes');
    expect(keys(o(30))).not.toContain('crashes');
  });

  it('says what a short run cannot have covered, and nothing of a full-length one', () => {
    expect(notCoveredByLength(o(5)).join(' ')).toMatch(/treaty.*conquest.*dues/);
    expect(notCoveredByLength(o(15)).join(' ')).toMatch(/conquest/);
    expect(notCoveredByLength(o(120))).toEqual([]);
    expect(notCoveredByLength(o(3, { story: 'short' }))).toEqual([]);
  });
});

describe('M39 step 10 review: the command line', () => {
  it('reads the minutes after any flag, not only after a value flag', () => {
    expect(parseArgs(['--virtual', '40']).minutes).toBe(40);
    expect(parseArgs(['--crash', '110']).minutes).toBe(110);
    expect(parseArgs(['25', '--virtual']).minutes).toBe(25);
    expect(parseArgs(['--minutes', '90']).minutes).toBe(90);
    expect(parseArgs([]).minutes).toBeUndefined();
  });

  it('takes the number after a value flag as its value', () => {
    const a = parseArgs(['--seed', '7', '--speed', '2', '--virtual', '30']);
    expect(a.minutes).toBe(30);
    expect(a.values.get('seed')).toBe('7');
    expect(a.values.get('speed')).toBe('2');
    expect(a.flags.has('virtual')).toBe(true);
    expect(parseArgs(['--seed', '7']).minutes).toBeUndefined();
  });
});
