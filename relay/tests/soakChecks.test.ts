import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Battle } from '../../src/sim/battle/battle';
import type { BattleInput } from '../../src/sim/battle/types';
import { Checks, notCoveredByLength, required, type Before } from '../../scripts/lib/soak/checks';
import { ATOM_ACT, atomStartMinute } from '../../scripts/lib/soak/types';
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
    const was: Before = {
      lines: {},
      pacts: 0,
      hosted: { id: 'exp-a-5', collapsed: [7, 8], wrecked: [3], clocks: { 3: 90 } },
    };
    at(40_000);
    checks.applied(sam as never, 1, resolve('exp-a-5', 'instant'), OK, 'exp-a-5', was);
    expect(fails.map((f) => f.kind)).toEqual(['damage-doubled']);
    expect(checks.standInDamage[0]).toMatchObject({ buildings: 1, wrecked: 1 });
    // It was the fallback (the sim said nothing, as an older one): counted as the record taking its place.
    expect(checks.standInsReplaced).toHaveLength(1);
    expect(checks.standInsContinued).toBe(0);
  });

  describe('a record that finishes the hosted battle (the sim says so)', () => {
    const continued = { ok: true, cost: 0, info: { standIn: 'continued', orders: 2, helpers: 0 } } as never;
    const setup = () => {
      const w = world();
      const sam = player('Sam', 2);
      const log = {
        id: 'exp-a-5',
        attacker: 1,
        defender: 2,
        disturbed: [{ name: 'Sam', what: 'reloads the page', at: 1 }],
        views: new Map(),
      } as unknown as BattleLog;
      w.checks.battles.set(log.id, log);
      w.at(1_000);
      w.checks.applied(sam as never, 1, resolve('exp-a-5'), OK);
      w.at(40_000);
      return { ...w, sam };
    };
    const was = (clock: number): Before => ({
      lines: {},
      pacts: 0,
      hosted: { id: 'exp-a-5', collapsed: [7], wrecked: [3], clocks: { 3: clock } },
    });

    it('is counted, and what the hosted part took is not taken twice: its report is the battle’s whole', () => {
      const { checks, fails, sam } = setup();
      // The report the finished battle ends with holds the hosted part's entries (it is the same report).
      sam.sim.state.war.reports.push({ collapsed: [7, 9], civics: [{ id: 3, wrecked: true }] });
      (sam.sim.state as unknown as { civics: Map<number, { damage: number }> }).civics = new Map([
        [3, { damage: 88 }],
      ]);
      checks.applied(sam as never, 1, resolve('exp-a-5', 'instant'), continued, 'exp-a-5', was(90));
      expect(fails).toEqual([]);
      expect(checks.standIns).toBe(1);
      expect(checks.standInsContinued).toBe(1);
      expect(checks.standInsReplaced).toEqual([]);
      expect(checks.standInDamage[0]).toMatchObject({ buildings: 0, wrecked: 0 });
    });

    it('fails when a structure the hosted part wrecked has its repair clock begun again', () => {
      const { checks, fails, sam } = setup();
      sam.sim.state.war.reports.push({ collapsed: [7], civics: [{ id: 3, wrecked: true }] });
      (sam.sim.state as unknown as { civics: Map<number, { damage: number }> }).civics = new Map([
        [3, { damage: 96 }],
      ]);
      checks.applied(sam as never, 1, resolve('exp-a-5', 'instant'), continued, 'exp-a-5', was(90));
      expect(fails.map((f) => f.kind)).toEqual(['damage-doubled']);
    });

    // A real battle (one kept from M36): the city's own end is set beside the record played whole.
    const kept = (
      JSON.parse(readFileSync('tests/fixtures/war/battle-v2.json', 'utf8')) as { input: BattleInput }[]
    )[0]!.input;
    const endOf = (step: number, hash: string) => [
      { kind: 'battleEnded', id: 1, info: { live: 'exp-a-5', step, hash } },
    ];
    const finish = (events: unknown[]) => {
      const { checks, fails, sam } = setup();
      sam.sim.state.war.reports.push({ collapsed: [7], civics: [{ id: 3, wrecked: true }] });
      (sam.sim.state as unknown as { civics: Map<number, { damage: number }> }).civics = new Map([
        [3, { damage: 88 }],
      ]);
      (sam.sim as unknown as { events: unknown[] }).events = events;
      const cmd = {
        type: 'battleResolve',
        mode: 'instant',
        from: 1,
        input: { ...kept, id: 'exp-a-5' },
      } as never;
      checks.applied(sam as never, 1, cmd, continued, 'exp-a-5', was(90));
      return { checks, fails };
    };

    it('sets the city’s end beside the record played whole: the same step and hash pass', () => {
      const whole = Battle.run(structuredClone({ ...kept, id: 'exp-a-5' })).result();
      const { checks, fails } = finish(endOf(whole.steps, whole.hash));
      expect(fails).toEqual([]);
      expect(checks.standInsHashed).toBe(1);
    });

    it('fails a city that finished the battle somewhere else than the record played whole does', () => {
      const whole = Battle.run(structuredClone({ ...kept, id: 'exp-a-5' })).result();
      const { checks, fails } = finish(endOf(whole.steps, `${whole.hash}-x`));
      expect(fails.map((f) => f.kind)).toEqual(['desync']);
      expect(checks.standInsHashed).toBe(1);
    });

    it('counts a record that was not the same battle as the fallback, with the sim’s reason', () => {
      const { checks, fails, notes, sam } = setup();
      sam.sim.state.war.reports.push({ collapsed: [], civics: [] });
      const replaced = {
        ok: true,
        cost: 0,
        info: { standIn: 'replaced', why: 'it is not the battle the city hosts' },
      } as never;
      checks.applied(sam as never, 1, resolve('exp-a-5', 'instant'), replaced, 'exp-a-5');
      expect(fails).toEqual([]);
      expect(checks.standInsReplaced).toEqual([
        { id: 'exp-a-5', player: 'Sam', why: 'it is not the battle the city hosts' },
      ]);
      expect(notes.some((n) => /not the battle the city hosts/.test(n))).toBe(true);
    });
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
    // (The room's verdict carries the step and hash it was given, as a page's state shows them: the two runs here.)
    room: Record<string, unknown> = { agree: true, step: 50, hash: 'h' },
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

describe('M39 late-return fix: a disturbance explains a battle with one verdict, not two runs that differ', () => {
  type Mine = { step: number; hash: string } | null;
  /** A battle as both pages showed it, and the room's verdict on it. */
  const battle = (
    id: string,
    runs: { att: Mine; def: Mine },
    room: Record<string, unknown>,
    over: Partial<BattleLog> & { desync?: boolean } = {},
  ) => {
    const view = (slot: number, role: string, mine: Mine) => ({
      slot,
      role,
      seen: 0,
      state: { ended: !!mine, desync: !!over.desync, hashes: { mine, room } },
    });
    return {
      id,
      attacker: 1,
      defender: 2,
      attackerName: 'Sam',
      defenderName: 'Ada',
      began: 0,
      lastSeen: 0,
      views: new Map([
        [1, view(1, 'attacker', runs.att)],
        [2, view(2, 'defender', runs.def)],
      ]),
      disturbed: [{ name: 'Sam', what: 'outage', at: 5 }],
      orders: { attacker: 0, defender: 0 },
      helpedBy: [],
      ...over,
    } as unknown as BattleLog;
  };
  const judged = (b: BattleLog) => {
    const ada = player('Ada', 2);
    const { checks, fails, notes, at } = world([player('Sam', 1), ada]);
    checks.battles.set(b.id, b);
    at(1);
    checks.applied(ada as never, 1, resolve(b.id), OK);
    checks.finish();
    return { fails, notes, b };
  };
  const ada = { step: 491, hash: '5d35edfd2823486b' };

  it('explains a solo end that both runs agree with, and says so', () => {
    const { fails, notes } = judged(
      battle('exp-a-1', { att: ada, def: ada }, { ...ada, agree: true, solo: true }),
    );
    expect(fails).toEqual([]);
    expect(notes.some((n) => /explained: only one city finished it/.test(n))).toBe(true);
  });

  it('fails a solo end whose two runs ended at different steps, though a player was disturbed in it (the soak’s exp-ce747761-818)', () => {
    const { fails } = judged(
      battle(
        'exp-a-2',
        { att: { step: 1502, hash: '0553db3af1d9ba85' }, def: ada },
        { ...ada, agree: true, solo: true },
      ),
    );
    expect(fails.map((f) => f.kind)).toEqual(['desync']);
    expect(fails[0]!.text).toMatch(
      /the two runs ended differently \(Sam step 1502 0553db3af1d9ba85, Ada step 491/,
    );
    expect(fails[0]!.text).toMatch(/Sam's run ended at step 1502 .*not where the room's verdict has it/);
  });

  it('fails a run that is not the room’s verdict though the other never finished', () => {
    const { fails } = judged(
      battle(
        'exp-a-3',
        { att: { step: 1502, hash: 'beef' }, def: null },
        { ...ada, agree: true, solo: true },
      ),
    );
    expect(fails.map((f) => f.kind)).toEqual(['desync']);
    expect(fails[0]!.text).toMatch(/Sam's run ended at step 1502/);
  });

  it('still excuses a run that never finished (a crash lost the page), and says so', () => {
    const { fails, notes } = judged(
      battle('exp-a-4', { att: null, def: ada }, { ...ada, agree: true, solo: true }),
    );
    expect(fails).toEqual([]);
    expect(notes.some((n) => /explained: only one city finished it; Sam's run did not end/.test(n))).toBe(
      true,
    );
  });

  it('fails a page that logged a difference in a solo end, whose agreement is the room’s own', () => {
    const { fails } = judged(
      battle('exp-a-5', { att: ada, def: ada }, { ...ada, agree: true, solo: true }, { desync: true }),
    );
    expect(fails.map((f) => f.kind)).toEqual(['desync']);
    expect(fails[0]!.text).toMatch(/logged that the runs ended differently/);
  });

  it('explains the difference pages log in a battle nobody finished, but not runs that ended apart', () => {
    const room = { step: 600, hash: '', agree: false, abandoned: true };
    const same = judged(battle('exp-a-6', { att: ada, def: ada }, room, { desync: true }));
    expect(same.fails).toEqual([]);
    const apart = judged(
      battle('exp-a-7', { att: { step: 700, hash: 'aa' }, def: ada }, room, { desync: true }),
    );
    expect(apart.fails.map((f) => f.kind)).toEqual(['desync']);
    expect(apart.fails[0]!.text).toMatch(/the two runs ended differently/);
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

describe('M40 step 13: the atom bomb between friends', () => {
  /**
   * Four cities as the judges read them: Ada (1) fired her one bomb at Sam (2), whose city took the strike and was
   * hit; Kit (3) and Lou (4) look on. The room's record holds the marks, the winter 2-1 chills the other three,
   * and each city has what it should. A test spoils one thing and asks what the judges make of it.
   */
  function atomWorld() {
    const neighbours = (of: number[]) => of.map((slot) => ({ id: 10 + slot, player: { slot } }));
    /** A city as the atom judges read it: a stand-in player whose sim state has the bomb's facts too. */
    type AtomPlayer = Omit<ReturnType<typeof player>, 'sim'> & {
      gen?: number;
      sim: {
        state: {
          war: {
            atom: Record<string, unknown>;
            diplomacy: Record<string, unknown>;
          };
          weather: { winters: { id: string }[] };
          fallout: { seen: Record<number, number> };
        };
      };
    };
    const city = (name: string, slot: number, others: number[], atom: object, extra: object = {}) =>
      player(name, slot, {
        up: true,
        upSince: 0,
        sim: {
          state: {
            war: {
              taken: [] as string[],
              expeditions: [],
              diplomacy: { pacts: [], subjects: [], wars: [] },
              reports: [],
              atom,
              ...extra,
            },
            economy: { month: {} },
            region: { neighbours: neighbours(others) },
            weather: { winters: [] as { id: string }[] },
            fallout: { seen: {} as Record<number, number> },
          },
        },
      }) as unknown as AtomPlayer;
    const ada = city(
      'Ada',
      1,
      [2, 3, 4],
      { fuel: 0, boom: 0, stopped: 0, fired: { slot: 2, to: 12, tick: 1 }, first: true },
      {
        diplomacy: { pacts: [], subjects: [], wars: [], pariah: { tick: 1 }, reputation: 80 },
      },
    );
    const sam = city('Sam', 2, [1, 3, 4], {
      fuel: 0,
      boom: 1,
      stopped: 0,
      struck: [1],
      impact: { done: 1, fled: 0, x: 0, z: 0 },
    });
    const kit = city('Kit', 3, [1, 2, 4], { fuel: 0, boom: 0, stopped: 0 });
    const lou = city('Lou', 4, [1, 2, 3], { fuel: 0, boom: 0, stopped: 0 });
    for (const p of [ada, kit, lou]) p.sim.state.weather.winters.push({ id: '2-1' });
    sam.sim.state.weather.winters.push({ id: 'self:1' });
    const wd = world([ada, sam, kit, lou]);
    // (The stand-in cities cannot be saved and loaded: the round trip is tried apart, below.)
    wd.checks.roundTrip = () => ({ before: 'a1', after: 'a1' });
    const meta = wd.room.meta as unknown as Record<string, unknown>;
    meta.atoms = [
      { slot: 1, name: 'Adaville', kind: 'ready', at: 1, first: true },
      { slot: 1, name: 'Adaville', kind: 'fired', at: 2, to: 2 },
      { slot: 2, name: 'Samford', kind: 'boom', at: 3 },
    ];
    meta.winters = [{ id: '2-1', at: 3, slots: [1, 3, 4] }];
    meta.cities = [
      { slot: 1, atom: { hit: 0, boom: 0, stopped: 0, used: true } },
      { slot: 2, atom: { hit: 1, boom: 1, stopped: 0, struck: 1 }, ops: [] },
      { slot: 3, atom: { hit: 0, boom: 0, stopped: 0 } },
      { slot: 4, atom: { hit: 0, boom: 0, stopped: 0 } },
    ];
    (meta.friends as { pariahs?: Record<number, number> }).pariahs = { 1: 2 };
    const strikeOp = {
      type: 'opResolve',
      from: 1,
      id: 'ao-1',
      op: 'atom',
      outcome: 'success',
      late: false,
    } as never;
    const winter = { type: 'friendWinter', id: '2-1' } as never;
    /** What the soak saw happen, in order: the region keeps the strike, Ada fires, Sam takes it and is hit, the others chill. */
    const play = () => {
      (wd.checks as unknown as { atomHarvest(): void }).atomHarvest();
      wd.checks.events(ada as never, [{ kind: 'bombFired', id: 12 }]);
      wd.checks.applied(sam as never, 1, strikeOp, OK);
      wd.checks.events(sam as never, [{ kind: 'bombLanded', id: 11 }]);
      for (const p of [ada, kit, lou]) wd.checks.applied(p as never, 1, winter, OK);
    };
    return { ...wd, ada, sam, kit, lou, meta, strikeOp, winter, play };
  }
  const kinds = (fails: Fail[]) => fails.map((f) => f.kind);

  it('is content when the strike was kept once, fired once, taken once, landed, and every other city has the winter once', () => {
    const g = atomWorld();
    g.play();
    g.checks.atomEnd();
    expect(g.fails).toEqual([]);
    expect(g.covered).toEqual(
      expect.arrayContaining(['strikesKept', 'strikesTaken', 'bombsLanded', 'wintersTaken']),
    );
    expect(g.covered.filter((k) => k === 'wintersTaken')).toHaveLength(3);
    const s = g.checks.strikes.get('1>2')!;
    expect(s).toMatchObject({ taken: 1, fired: 1, landed: 1, phase: 'landed' });
  });

  describe('a strike taken or fired twice, or a bomb landed twice', () => {
    it('fails the target’s second take, the firer’s second firing and a second landing', () => {
      const g = atomWorld();
      g.play();
      g.checks.applied(g.sam as never, 1, g.strikeOp, OK);
      g.checks.events(g.ada as never, [{ kind: 'bombFired', id: 12 }]);
      g.checks.events(g.sam as never, [{ kind: 'bombLanded', id: 11 }]);
      expect(kinds(g.fails)).toEqual(['strike-twice', 'strike-twice', 'strike-twice']);
      expect(g.fails[0]!.text).toMatch(/Sam's city took Ada's atom strike 2 times/);
      expect(g.fails[1]!.text).toMatch(/Ada's city fired its atom bomb at Sam 2 times/);
      expect(g.fails[2]!.text).toMatch(/Ada's atom bomb landed on Sam's city 2 times/);
    });

    it('excuses each when a restore from an older save lay between the two, and says so', () => {
      const g = atomWorld();
      g.play();
      // Sam crashed and came back from an autosave made before it took the strike, and was warned and hit again.
      const saved = 0;
      g.sam.restores.push({ n: g.ticket(), fromN: saved });
      g.ada.restores.push({ n: g.ticket(), fromN: saved });
      g.checks.applied(g.sam as never, 2, g.strikeOp, OK);
      g.checks.events(g.sam as never, [{ kind: 'bombLanded', id: 11 }]);
      g.checks.events(g.ada as never, [{ kind: 'bombFired', id: 12 }]);
      expect(g.fails).toEqual([]);
      expect(g.checks.rewinds).toBe(3);
    });
  });

  describe('a strike the region kept that one of the two cities never had', () => {
    it('fails a target that never took it, and a firer that never fired', () => {
      const g = atomWorld();
      (g.checks as unknown as { atomHarvest(): void }).atomHarvest();
      g.checks.atomEnd();
      expect(kinds(g.fails)).toContain('strike-lost');
      const texts = g.fails.filter((f) => f.kind === 'strike-lost').map((f) => f.text);
      expect(texts.some((t) => /Ada's city never fired its bomb/.test(t))).toBe(true);
      expect(texts.some((t) => /Sam's city never took it/.test(t))).toBe(true);
    });

    it('excuses them for a city that came back from a save older than the keeping, and says so', () => {
      const g = atomWorld();
      const saved = g.ticket();
      (g.checks as unknown as { atomHarvest(): void }).atomHarvest();
      for (const p of [g.ada, g.sam]) p.restores.push({ n: g.ticket(), fromN: saved });
      g.checks.atomEnd();
      expect(g.fails.filter((f) => f.kind === 'strike-lost')).toEqual([]);
      expect(g.checks.excused.length).toBeGreaterThanOrEqual(2);
    });

    it('fails a target that took the strike and has no bomb anywhere (not in the air, not landed, not stopped)', () => {
      const g = atomWorld();
      g.play();
      const atom = g.sam.sim.state.war.atom as Record<string, unknown>;
      delete atom.impact;
      atom.boom = 0;
      g.checks.atomEnd();
      expect(g.fails.map((f) => f.text).join('\n')).toMatch(
        /Sam's city took the strike from Ada and the bomb is nowhere/,
      );
    });

    it('fails a firer whose city no longer holds that it fired, and a target that holds the strike twice', () => {
      const g = atomWorld();
      g.play();
      delete (g.ada.sim.state.war.atom as Record<string, unknown>).fired;
      (g.sam.sim.state.war.atom as { struck: number[] }).struck = [1, 1];
      g.checks.atomEnd();
      const texts = g.fails.map((f) => f.text).join('\n');
      expect(texts).toMatch(/Ada's city fired its bomb at Sam and no longer holds it/);
      expect(texts).toMatch(/Sam's city took the strike from Ada and holds 2 strikes from Ada/);
      // (The strike is named once, by its firer and target: never "Ada's city fired Ada's atom strike".)
      expect(texts).not.toMatch(/(city|Ada|Sam) (fired|took) (Ada|Sam)'s atom strike/);
    });

    it('fails an operation the region still holds for a target that is here', () => {
      const g = atomWorld();
      g.play();
      (g.meta.cities as { slot: number; ops?: unknown[] }[])[1]!.ops = [{ id: 'ao-1' }];
      g.checks.atomEnd();
      expect(kinds(g.fails)).toEqual(['strike-unseen']);
    });
  });

  describe('the winters', () => {
    it('fails a city that never had the winter the region began for it, and a city that has it twice', () => {
      const g = atomWorld();
      g.play();
      g.kit.sim.state.weather.winters.length = 0;
      g.lou.sim.state.weather.winters.push({ id: '2-1' });
      g.checks.atomEnd();
      expect(kinds(g.fails)).toEqual(['winter-missing', 'winter-twice']);
      expect(g.fails[0]!.text).toMatch(/Kit's city never had the nuclear winter 2-1/);
      expect(g.fails[1]!.text).toMatch(/Lou's city has the nuclear winter 2-1 2 times, not 1/);
    });

    it('fails a bomb that landed with no winter in the region, a winter that misses a city, and a target without its own', () => {
      const g = atomWorld();
      g.play();
      g.meta.winters = [{ id: '2-1', at: 3, slots: [1, 3] }];
      g.sam.sim.state.weather.winters.length = 0;
      g.checks.atomEnd();
      const texts = g.fails.map((f) => `${f.kind}: ${f.text}`).join('\n');
      expect(texts).toMatch(/winter-reach: the region's winter 2-1 chills cities \[1,3\]/);
      expect(texts).toMatch(
        /winter-missing: 1 atom bombs landed on Sam and its own city has 0 winters of its own/,
      );
      expect(texts).toMatch(/winter-twice: Lou's city has the nuclear winter 2-1 1 times, not 0/);
      g.fails.length = 0;
      g.meta.winters = [];
      g.checks.atomEnd();
      expect(g.fails.map((f) => f.text).join('\n')).toMatch(
        /1 atom bombs landed on Sam and the region began 0/,
      );
    });

    it('fails a landing that began two winters in the room (the bomb counted twice), and passes the honest world', () => {
      const g = atomWorld();
      g.play();
      g.checks.atomEnd();
      expect(g.fails).toEqual([]);
      // The room began a second winter for the one bomb that fell on Sam (it lands again in the city that came back
      // from a crash, and the room took the second report for a second bomb); the other cities have it too.
      g.meta.winters = [
        { id: '2-1', at: 3, slots: [1, 3, 4] },
        { id: '2-2', at: 9, slots: [1, 3, 4] },
      ];
      for (const p of [g.ada, g.kit, g.lou]) p.sim.state.weather.winters.push({ id: '2-2' });
      g.checks.atomEnd();
      expect(kinds(g.fails)).toEqual(['winter-twice']);
      expect(g.fails[0]!.text).toBe(
        'the region began 2 nuclear winters (2-1, 2-2) for the bombs that fell on Sam, when 1 atom strike landed on it (a landing begins one winter)',
      );
    });

    it('allows one more winter for a city whose own bomb fell on a computer neighbour (the room’s rival), and no more', () => {
      const g = atomWorld();
      g.play();
      // Sam's own bomb fell on a computer neighbour: the room begins a winter for that landing too.
      g.meta.winters = [
        { id: '2-1', at: 3, slots: [1, 3, 4] },
        { id: '2-2', at: 9, slots: [1, 3, 4] },
      ];
      (g.meta.cities as { slot: number; atom: Record<string, unknown> }[])[1]!.atom.rival = true;
      for (const p of [g.ada, g.kit, g.lou]) p.sim.state.weather.winters.push({ id: '2-2' });
      g.checks.atomEnd();
      expect(g.fails).toEqual([]);
      (g.meta.winters as { id: string; at: number; slots: number[] }[]).push({
        id: '2-3',
        at: 12,
        slots: [1, 3, 4],
      });
      for (const p of [g.ada, g.kit, g.lou]) p.sim.state.weather.winters.push({ id: '2-3' });
      g.checks.atomEnd();
      expect(kinds(g.fails)).toEqual(['winter-twice']);
      expect(g.fails[0]!.text).toMatch(
        /began 3 nuclear winters \(2-1, 2-2, 2-3\).*and its own bomb fell on a computer neighbour/,
      );
    });

    it('fails a second fresh application of the same winter, unless a restore lay between', () => {
      const g = atomWorld();
      g.play();
      g.checks.applied(g.kit as never, 1, g.winter, OK);
      expect(kinds(g.fails)).toEqual(['winter-twice']);
      expect(g.fails[0]!.text).toMatch(/Kit's city began the nuclear winter 2-1 2 times/);
      g.fails.length = 0;
      // Told again, the sim only says it has it: not an application.
      g.checks.applied(g.lou as never, 1, g.winter, { ok: true, info: { already: 1 } } as never);
      expect(g.fails).toEqual([]);
      // Lou crashed and came back from a save older than the first time, and was given the winter again.
      g.lou.restores.push({ n: g.ticket(), fromN: 0 });
      g.checks.applied(g.lou as never, 2, g.winter, OK);
      expect(g.fails).toEqual([]);
    });
  });

  describe('a friend’s cloud', () => {
    const cloud = (from: number, total: number, deposited: number) =>
      [
        { type: 'friendFallout', from, total, base: 0 } as never,
        { ok: true, info: { deposited } } as never,
      ] as const;

    it('fails a cloud that puts air on the map for a total at or below the most it was given', () => {
      const g = atomWorld();
      g.play();
      g.checks.applied(g.kit as never, 1, ...cloud(2, 40, 1.5));
      g.checks.applied(g.kit as never, 1, ...cloud(2, 60, 0.9));
      // A total it has had before, or a lower one, adds nothing: air on the map for it is a second cloud.
      g.checks.applied(g.kit as never, 1, ...cloud(2, 60, 0.4));
      g.checks.applied(g.kit as never, 1, ...cloud(2, 20, 0.3));
      expect(kinds(g.fails)).toEqual(['fallout-twice', 'fallout-twice']);
      expect(g.fails[0]!.text).toMatch(/of 60 with 60 already taken in/);
      expect(g.covered.filter((k) => k === 'falloutIn')).toHaveLength(4);
    });

    it('is content with a total heard again that adds nothing, and with a first sight that is only a baseline', () => {
      const g = atomWorld();
      g.play();
      g.checks.applied(g.kit as never, 1, ...cloud(2, 40, 0));
      g.checks.applied(g.kit as never, 1, ...cloud(2, 40, 0));
      g.checks.applied(g.kit as never, 1, ...cloud(2, 55, 1.2));
      expect(g.fails).toEqual([]);
    });

    it('excuses air put on again after a restore from an older save forgot the mark', () => {
      const g = atomWorld();
      g.play();
      g.checks.applied(g.kit as never, 1, ...cloud(2, 40, 1.5));
      g.kit.restores.push({ n: g.ticket(), fromN: 0 });
      g.checks.applied(g.kit as never, 2, ...cloud(2, 40, 1.5));
      expect(g.fails).toEqual([]);
      expect(g.checks.rewinds).toBe(1);
    });

    it('fails a cloud thicker than the bombs on record could make, in a city and in the room’s copy of a report', () => {
      const g = atomWorld();
      g.play();
      // One bomb is on record (Sam's): a cloud can be 700 at most.
      g.checks.applied(g.kit as never, 1, ...cloud(2, 701, 0));
      expect(kinds(g.fails)).toEqual(['fallout-bound']);
      g.fails.length = 0;
      (g.meta.cities as unknown as { report?: object }[])[1]!.report = {
        atom: { plume: [{ slot: 3, total: 900 }] },
      };
      (g.checks as unknown as { atomHarvest(): void }).atomHarvest();
      expect(kinds(g.fails)).toEqual(['fallout-bound']);
      expect(g.fails[0]!.text).toMatch(/the room holds a cloud of 900 from city 2 over city 3/);
    });

    it('fails a city whose mark of what it has taken in goes down, though a reload may start it again', () => {
      const g = atomWorld();
      const second = () => (g.checks as unknown as { atomWatch(): void }).atomWatch();
      g.kit.sim.state.fallout.seen[2] = 40;
      second();
      g.kit.sim.state.fallout.seen[2] = 12;
      second();
      expect(kinds(g.fails)).toEqual(['fallout-regress']);
      // A city loaded again is a new generation: its mark begins from what its save held.
      g.fails.length = 0;
      (g.kit as { gen?: number }).gen = 1;
      second();
      expect(g.fails).toEqual([]);
    });
  });

  describe('the pariah and the record', () => {
    it('fails a firer the region does not hold a pariah, and a city that is none in its own sim', () => {
      const g = atomWorld();
      g.play();
      (g.meta.friends as { pariahs?: Record<number, number> }).pariahs = {};
      delete (g.ada.sim.state.war.diplomacy as Record<string, unknown>).pariah;
      g.checks.atomEnd();
      expect(kinds(g.fails)).toEqual(['pariah', 'pariah']);
      expect(g.fails[0]!.text).toMatch(/^Ada fired its bomb at Sam and the region does not hold it a pariah/);
      expect(g.fails[1]!.text).toMatch(
        /^Ada's city fired its bomb at Sam and is not a pariah with a reputation of 80/,
      );
    });

    it('fails a record with a bomb fired or ready twice, no mark for the strike, or the first finisher on the wrong mark', () => {
      const g = atomWorld();
      g.play();
      const atoms = g.meta.atoms as {
        slot: number;
        name: string;
        kind: string;
        at: number;
        to?: number;
        first?: true;
      }[];
      atoms.push({ slot: 1, name: 'Adaville', kind: 'fired', at: 4, to: 2 });
      g.checks.atomEnd();
      expect(g.fails.map((f) => f.text).join('\n')).toMatch(
        /Adaville.*fired.*|Ada as having fired it 2 times/,
      );
      g.fails.length = 0;
      g.meta.atoms = [{ slot: 1, name: 'Adaville', kind: 'ready', at: 1 }];
      g.checks.atomEnd();
      expect(g.fails.map((f) => f.text).join('\n')).toMatch(
        /the first finisher of the bomb should be Adaville/,
      );
      expect(g.fails.map((f) => f.text).join('\n')).toMatch(/its record has 0 marks that Ada fired/);
      expect(g.fails.map((f) => f.text).join('\n')).toMatch(/no mark that it fell on Sam/);
    });

    it('fails a record that writes down the one landing on a city twice, and a landing on a city no strike landed on', () => {
      const g = atomWorld();
      g.play();
      g.checks.atomEnd();
      expect(g.fails).toEqual([]);
      // (A city that came back from a crash was hit again, and the room took the second report for a second bomb.)
      (g.meta.atoms as { slot: number; name: string; kind: string; at: number }[]).push({
        slot: 2,
        name: 'Samford',
        kind: 'boom',
        at: 9,
      });
      g.checks.atomEnd();
      expect(kinds(g.fails)).toEqual(['atoms-record']);
      expect(g.fails[0]!.text).toBe(
        "the region's record of the bomb has 2 marks that a bomb fell on Sam, when 1 atom strike landed on it (a landing is one mark, however often the city lands it again)",
      );
      g.fails.length = 0;
      (g.meta.atoms as { slot: number; name: string; kind: string; at: number }[]).push({
        slot: 3,
        name: 'Kitford',
        kind: 'boom',
        at: 10,
      });
      g.checks.atomEnd();
      expect(g.fails.map((f) => f.text).filter((t) => /fell on Kit,/.test(t))).toEqual([
        "the region's record of the bomb has 1 mark that a bomb fell on Kit, when 0 atom strikes landed on it (a landing is one mark, however often the city lands it again)",
      ]);
    });

    it('fails a first finisher whose city was never given the word', () => {
      const g = atomWorld();
      g.play();
      delete (g.ada.sim.state.war.atom as Record<string, unknown>).first;
      g.checks.atomEnd();
      expect(g.fails.map((f) => f.text).join('\n')).toMatch(
        /finished the bomb first and its city does not hold the word/,
      );
    });

    it('fails a page that keeps another record than the room, or a city with other winters than the room began, when it stands', () => {
      const g = atomWorld();
      const atoms = [{ slot: 1, name: 'Adaville', kind: 'ready', at: 1, first: true }];
      for (const p of [g.ada, g.sam, g.kit, g.lou]) {
        (p as unknown as { page: object }).page = {
          fw: { view: () => ({ wars: [], pacts: [], vassals: [], history: [], incoming: [], outgoing: [] }) },
          atom: { atoms },
        };
      }
      const consistent = () => (g.checks as unknown as { consistency(): void }).consistency();
      for (const ms of [30_000, 40_000, 70_000]) {
        g.at(ms);
        consistent();
      }
      const texts = g.fails.map((f) => f.text);
      expect(
        texts.some((t) =>
          /Ada's page keeps the bomb's record \["1:ready"\], the room \["1:ready","1:fired","2:boom"\]/.test(
            t,
          ),
        ),
      ).toBe(true);
      // Kit's city has the winter and the room began it for it: no difference; Ada's lacks nothing either.
      expect(texts.some((t) => /nuclear winters/.test(t))).toBe(false);
      g.kit.sim.state.weather.winters.length = 0;
      for (const ms of [100_000, 110_000, 140_000]) {
        g.at(ms);
        consistent();
      }
      expect(
        g.fails
          .map((f) => f.text)
          .some((t) => /Kit's city has the nuclear winters \[\], the room began \[2-1\]/.test(t)),
      ).toBe(true);
    });
  });

  describe('a city saved and loaded again', () => {
    it('fails a city that hashes otherwise after its save is loaded again, once a bomb has been in the region', () => {
      const g = atomWorld();
      g.play();
      g.checks.roundTrip = (sim) =>
        (sim as unknown) === g.sam.sim ? { before: 'a1', after: 'b2' } : { before: 'a1', after: 'a1' };
      g.checks.atomEnd();
      expect(kinds(g.fails)).toEqual(['atom-roundtrip']);
      expect(g.fails[0]!.text).toMatch(
        /Sam's city, saved and loaded again after the bomb, hashes b2 where it hashes a1/,
      );
    });

    it('asks nothing of the cities when no bomb was kept', () => {
      const g = atomWorld();
      // (No bomb was kept: the room holds no record of one either, so no landing is written down for a strike nobody followed.)
      g.meta.atoms = [];
      g.meta.winters = [];
      let asked = 0;
      g.checks.roundTrip = () => ((asked += 1), { before: 'a', after: 'b' });
      g.checks.atomEnd();
      expect(asked).toBe(0);
      expect(g.fails).toEqual([]);
    });
  });

  describe('the run’s own time and coverage', () => {
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

    it('asks a run with room for the atom act to have played it, a longer one to have played it twice, and no short story to', () => {
      const keys = (x: SoakOptions) => required(x).map(([k]) => k);
      expect(keys(o(ATOM_ACT.needs - 1))).not.toContain('strikesKept');
      expect(keys(o(ATOM_ACT.needs))).toEqual(
        expect.arrayContaining(['bombsReady', 'strikesKept', 'strikesTaken', 'bombsLanded', 'wintersTaken']),
      );
      expect(
        required(o(ATOM_ACT.needs))
          .filter(([k]) => k === 'strikesKept')
          .map(([, n]) => n),
      ).toEqual([1]);
      expect(
        required(o(ATOM_ACT.second))
          .filter(([k]) => k === 'strikesKept')
          .map(([, n]) => n),
      ).toEqual([1, 2]);
      expect(keys(o(ATOM_ACT.second))).toContain('atomDisturbed');
      expect(keys(o(ATOM_ACT.second, { disturb: false }))).not.toContain('atomDisturbed');
      expect(keys(o(120, { story: 'short' }))).not.toContain('strikesKept');
    });

    it('says what a run too short for the bomb cannot have covered', () => {
      expect(notCoveredByLength(o(30)).join(' ')).toMatch(/atom bomb.*60 minutes/);
      expect(notCoveredByLength(o(60)).join(' ')).toMatch(/second atom strike \(110 minutes\)/);
      expect(notCoveredByLength(o(120))).toEqual([]);
    });

    it('begins the act late, after the M39 acts, and early enough for a long run to have two', () => {
      expect(atomStartMinute(15)).toBe(ATOM_ACT.earliest);
      expect(atomStartMinute(120)).toBe(60);
      // The second act of a hundred-minute run still has its half hour.
      expect(atomStartMinute(ATOM_ACT.second) + 2 * ATOM_ACT.minutes).toBeLessThanOrEqual(
        ATOM_ACT.second + 20,
      );
    });
  });
});
