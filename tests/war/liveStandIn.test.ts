import { beforeAll, describe, expect, it } from 'vitest';
import { helpUnitId } from '../../relay/protocol';
import { Battle } from '../../src/sim/battle/battle';
import { recordInput, type StampedOrder } from '../../src/sim/battle/live';
import { S, TAG, type BattleInput } from '../../src/sim/battle/types';
import type { Command, CommandResult } from '../../src/sim/commands';
import type { SaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { LIVE_ALLOW_MAX, type LiveCall } from '../../src/sim/systems/raids';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import { liveWorld, sendAgainst } from './liveTown';

/**
 * M39, the record of a live battle the city still hosts (a defender whose page was reloaded, or a
 * crash restored from an autosave made in the middle of one). The hosted part has taken its damage
 * already; the room's record is the same battle with the orders and helpers the page lost, so the city
 * keeps the battle it has and finishes it with what it lacks. It must end exactly as a city that hosted
 * the whole battle live without interruption: a civic structure wrecked in the hosted part is wrecked
 * once, and its repair clock runs on.
 */

let input: BattleInput;
let samSave: SaveFile;

const load = (save: SaveFile): Sim => {
  const sim = Sim.fromSave(save);
  sim.testMode = true;
  return sim;
};
const hb = (sim: Sim) => sim.state.war!.battle!;
const order = (
  seq: number,
  step: number,
  side: 0 | 1,
  kind: string,
  rest: Partial<StampedOrder> = {},
): StampedOrder => ({ seq, step, side, kind, ...rest });
const live = (sim: Sim, allow: number, orders: StampedOrder[] = []) =>
  sim.dispatch({ type: 'battleLive', id: input.id, allow, orders } as Command);
const civicIds = (i: BattleInput): Set<number> => {
  const out = new Set<number>();
  for (let k = 0; k < i.layout.structs.length / S.stride; k++)
    if ((i.layout.structs[k * S.stride + S.tags]! & TAG.civic) !== 0)
      out.add(i.layout.structs[k * S.stride + S.id]!);
  return out;
};

/** What the room stamped: two orders early, one more at the frontier a page lost, and its late ones. */
let early: StampedOrder[];
let late: StampedOrder[];
let log: StampedOrder[];
/** The step of the first civic structure the battle wrecks, and the frontier a page that was lost had heard of. */
let wreckAt = 0;
let frontier = 0;
let ends = 0;

beforeAll(() => {
  const { ada, sam } = liveWorld();
  const sent = sendAgainst(ada.sim, 2);
  const call: LiveCall = { id: `exp-test-${sent.id}`, from: 1, force: sent.force };
  samSave = sam.sim.save();
  input = (load(samSave).query({ type: 'liveBattle', call }) as { input: BattleInput }).input;
  const mil: number[] = [];
  for (let k = 0; k < input.layout.structs.length / S.stride; k++)
    if ((input.layout.structs[k * S.stride + S.tags]! & TAG.military) !== 0) mil.push(k);
  early = [
    order(1, 32, 1, 'guard', {
      units: input.layout.defenders.slice(0, 2).map((u) => u.id),
      target: mil[0]!,
    }),
    order(2, 64, 0, 'hold', { units: [input.attacker.units[0]!.id] }),
    order(3, 128, 0, 'free'),
  ];
  // Where the battle, with what was ordered early, first wrecks a civic structure.
  const civic = civicIds(input);
  const probe = new Battle(recordInput(input, early));
  while (!probe.outcome && probe.step < 5_000 && !wreckAt)
    for (const e of probe.tick(Infinity))
      if (e.k === 'destroyed' && civic.has(e.s) && !wreckAt) wreckAt = probe.step;
  while (!probe.outcome && probe.step < 5_000) probe.tick(Infinity);
  ends = probe.step;
  // The page was lost a little after the wreck; the orders it missed are stamped at that frontier and after.
  frontier = wreckAt + 8;
  late = [order(4, frontier, 0, 'hold'), order(5, frontier + 10, 0, 'free')];
  log = [...early, ...late];
}, 240_000);

/** The room's frontier moves ahead of the hosted battle by 32 steps, up to `stop`; the orders it has stamped by then arrive. */
function hostTo(sim: Sim, stop: number, orders: StampedOrder[]): void {
  const r = sim.dispatch({ type: 'battleResolve', input: structuredClone(input), mode: 'live', from: 1 });
  if (!r.ok) throw new Error(r.reason);
  for (let t = 0; t < 4_000 && hb(sim).step < stop; t++) {
    const allow = Math.min(hb(sim).step + 32, stop);
    live(
      sim,
      allow,
      orders.filter((o) => o.step < stop),
    );
    sim.step();
  }
  if (hb(sim).step !== stop) throw new Error(`the hosted battle stands at ${hb(sim).step}, not ${stop}`);
}

/** A page that is lost holds the hosted battle at the frontier it heard of while time passes. */
const STALL = 5 * TICKS_PER_HOUR;

/** A city with its hosted battle stopped at a frontier and its page gone for a while (possibly saved and loaded). */
function hosting(stop: number, restore: boolean, orders = log): Sim {
  let sim = load(samSave);
  hostTo(sim, stop, orders);
  if (restore) sim = load(sim.save());
  for (let t = 0; t < STALL; t++) sim.step();
  return sim;
}

/** Everything a finished battle left in the city that a repair clock or a report could tell apart. */
function left(sim: Sim, clocks = true) {
  const w = sim.state.war!;
  const r = w.reports!.at(-1)!;
  const end = sim.events.filter((e) => e.kind === 'battleEnded').at(-1)!;
  return {
    over: w.battle === undefined,
    reports: w.reports!.length,
    end: end.info,
    report: {
      outcome: r.outcome,
      collapsed: r.collapsed,
      burning: r.burning,
      civics: r.civics,
      craters: r.craters,
      lost: r.lost,
      theirLost: r.theirLost,
      homeless: r.homeless,
      worth: r.worth ?? 0,
    },
    civics: [...sim.state.civics.values()]
      .filter((c) => c.damage > 0 || c.wrecked)
      .map((c) => ({ id: c.id, damage: clocks ? c.damage : 0, wrecked: !!c.wrecked })),
    notices: sim.events.filter((e) => e.kind === 'civicDamaged').map((e) => e.id),
    units: [...w.units.values()].map((u) => [u.id, u.hp]),
    taken: w.taken,
  };
}

/** The city goes on hosting: the room's whole log arrives and the battle runs out tick by tick, as it would have. */
function finishLive(sim: Sim, all: StampedOrder[]): number {
  expect(live(sim, LIVE_ALLOW_MAX, all).ok).toBe(true);
  let n = 0;
  while (w(sim).battle && n < 5_000) {
    sim.step();
    n++;
  }
  expect(w(sim).battle).toBeUndefined();
  return n;
}
const w = (sim: Sim) => sim.state.war!;

/** The room's record reaches the city that hosts the battle (the page that did is gone). */
function takeRecord(sim: Sim, all: StampedOrder[], over: Partial<BattleInput> = {}): CommandResult {
  const record = { ...recordInput(input, all), ...over };
  return sim.dispatch({ type: 'battleResolve', input: record, mode: 'instant', from: 1 });
}

describe('M39: the record of a live battle the city still hosts', () => {
  it('the world is what the cases below need', () => {
    expect(wreckAt).toBeGreaterThan(40);
    // The battle runs on well past the wreck, and the orders that were lost come after it.
    expect(ends).toBeGreaterThan(frontier + 20);
    // Orders that change the end: the record's hash is not that of the battle without them.
    const without = Battle.run(recordInput(input, early)).hash();
    expect(Battle.run(recordInput(input, log)).hash()).not.toBe(without);
  });

  // (`null`: the frontier a lost page heard of, which is known only once the world is built.)
  // (A structure damaged only after the record comes is damaged at once in the city that takes it, and
  // along the ticks in the one that hosts it all: its repair clock may differ by the hours that fall between.)
  for (const [what, stop, restore, exact] of [
    ['a page that was reloaded: the sim that hosted it, a wreck taken in the hosted part', null, false, true],
    ['the same city saved and loaded again after the wreck', null, true, true],
    ['a crash restored from an autosave made before the wreck (the damage had begun)', 200, true, false],
  ] as const) {
    it(`ends as a city that hosted it all would: ${what}`, () => {
      const stopAt = stop ?? frontier;
      const control = hosting(stopAt, restore);
      const lost = hosting(stopAt, restore);
      // What the hosted part had done by now.
      const civic = civicIds(input);
      const hurt = hb(lost).report.civics.filter((c) => civic.has(c.id));
      expect(hurt.length).toBeGreaterThan(0);
      if (stopAt === frontier) expect(hurt.some((c) => c.wrecked)).toBe(true);
      else expect(hurt.every((c) => !c.wrecked)).toBe(true);
      // The repair clocks have been running since the hosted part damaged them.
      for (const c of hurt) expect(lost.state.civics.get(c.id)!.damage).toBeGreaterThan(0);
      const days = finishLive(control, log);
      const r = takeRecord(lost, log);
      expect(r.ok).toBe(true);
      expect(w(lost).battle).toBeUndefined();
      for (let t = 0; t < days; t++) lost.step();
      // Exactly the battle's end, the report, the repair clocks, the units' scars: nothing taken twice.
      expect(left(lost, exact)).toEqual(left(control, exact));
      if (!exact)
        for (const c of left(control).civics) {
          const mine = lost.state.civics.get(c.id)!.damage;
          expect(Math.abs(mine - c.damage)).toBeLessThanOrEqual(1);
        }
      expect(r.ok && r.info).toMatchObject({ standIn: 'continued' });
      // The battle ended as the record's plain run does.
      const end = lost.events.filter((e) => e.kind === 'battleEnded').at(-1)!;
      expect(end.info!.hash).toBe(Battle.run(recordInput(input, log)).hash());
      expect(w(lost).taken!.filter((k) => k === `1:${input.id}`)).toHaveLength(1);
      // Told again, it is the city’s already.
      expect(takeRecord(lost, log).ok).toBe(false);
    });
  }

  it('a structure wrecked in the hosted part keeps its repair clock when the record comes', () => {
    const sim = hosting(frontier, false);
    const civic = civicIds(input);
    const wrecked = hb(sim).report.civics.find((c) => c.wrecked && civic.has(c.id))!;
    expect(wrecked).toBeDefined();
    const before = sim.state.civics.get(wrecked.id)!.damage;
    const notified = sim.events.filter((e) => e.kind === 'civicDamaged' && e.id === wrecked.id).length;
    expect(before).toBeGreaterThan(0);
    // (A few hours of its repair have passed: that is what a restarted clock would undo.)
    expect(takeRecord(sim, log).ok).toBe(true);
    expect(sim.state.civics.get(wrecked.id)!.damage).toBeLessThanOrEqual(before);
    expect(sim.events.filter((e) => e.kind === 'civicDamaged' && e.id === wrecked.id)).toHaveLength(notified);
    // And the report has the structure once, as wrecked.
    expect(
      w(sim)
        .reports!.at(-1)!
        .civics.filter((c) => c.id === wrecked.id),
    ).toEqual([wrecked]);
  });

  it('finishes the hosted battle when the record adds nothing the city lacks', () => {
    const control = hosting(frontier, true);
    const lost = hosting(frontier, true);
    // The page had every order the room stamped: the record has nothing it lacks.
    const same = early;
    const days = finishLive(control, same);
    expect(takeRecord(lost, same).ok).toBe(true);
    for (let t = 0; t < days; t++) lost.step();
    expect(left(lost)).toEqual(left(control));
  });

  it('takes an ally’s help the record has and the city lacks, at the step it joins', () => {
    const help = order(6, frontier + 4, 1, 'help', {
      helper: {
        owner: 3,
        name: 'Kitburg',
        color: 2,
        side: 1,
        units: [0, 1].map((k) => ({ id: helpUnitId(3, k), kind: 'tank', hp: 1 })),
        arrive: frontier + 12,
      },
    });
    const all = [...log, help];
    // Fought with the help, the battle is not the one without it.
    expect(Battle.run(recordInput(input, all)).hash()).not.toBe(Battle.run(recordInput(input, log)).hash());
    const control = hosting(frontier, true);
    const lost = hosting(frontier, true);
    const days = finishLive(control, all);
    const r = takeRecord(lost, all);
    expect(r.ok).toBe(true);
    for (let t = 0; t < days; t++) lost.step();
    expect(left(lost)).toEqual(left(control));
    expect(r.ok && r.info).toMatchObject({ standIn: 'continued', helpers: 1 });
    expect(left(lost).end!.hash).toBe(Battle.run(recordInput(input, all)).hash());
  });

  describe('a record that is not the hosted battle goes on the old way (the record stands in), and says why', () => {
    const replaced = (r: CommandResult): string | undefined =>
      r.ok && r.info?.standIn === 'replaced' ? String(r.info.why) : undefined;

    it('an input that differs beyond its orders and helpers', () => {
      const sim = hosting(frontier, false);
      const r = takeRecord(sim, log, { seed: `${input.seed}-other` });
      expect(r.ok).toBe(true);
      expect(replaced(r)).toMatch(/not the battle/);
      expect(w(sim).battle).toBeUndefined();
      // The record's battle was fought, whole.
      const end = sim.events.filter((e) => e.kind === 'battleEnded').at(-1)!;
      expect(end.info!.hash).toBe(
        Battle.run({ ...recordInput(input, log), seed: `${input.seed}-other` }).hash(),
      );
    });

    it('an order the hosted battle lacks at a step it has passed', () => {
      const sim = hosting(frontier, false);
      const r = takeRecord(sim, [...log, order(7, 40, 1, 'hold')]);
      expect(replaced(r)).toMatch(/passed/);
      expect(w(sim).battle).toBeUndefined();
    });

    it('a helper the hosted battle lacks at a step it has passed', () => {
      const sim = hosting(frontier, false);
      const r = takeRecord(sim, [
        ...log,
        order(7, 40, 1, 'help', {
          helper: {
            owner: 3,
            name: 'Kitburg',
            color: 2,
            side: 1,
            units: [{ id: helpUnitId(3, 0), kind: 'tank', hp: 1 }],
            arrive: 60,
          },
        }),
      ]);
      expect(replaced(r)).toMatch(/passed/);
      expect(w(sim).battle).toBeUndefined();
    });

    it('orders the hosted battle took that the record does not have in its place', () => {
      const sim = hosting(frontier, false);
      // The record opens with another order than the one the city took first.
      const other = [order(1, 32, 1, 'hold'), ...log.slice(1)];
      const r = takeRecord(sim, other);
      expect(replaced(r)).toMatch(/orders/);
      expect(w(sim).battle).toBeUndefined();
    });

    it('helpers the hosted battle took that the record does not have in its place', () => {
      const ally = (name: string) =>
        order(4, 130, 1, 'help', {
          helper: {
            owner: 3,
            name,
            color: 2,
            side: 1,
            units: [{ id: helpUnitId(3, 0), kind: 'tank', hp: 1 }],
            arrive: 150,
          },
        });
      const sim = hosting(140, false, [...early, ally('Kitburg')]);
      expect(hb(sim).input.helpers).toHaveLength(1);
      // The room's record has another ally in that place: not the battle the city has been fighting.
      const r = takeRecord(sim, [...early, ally('Otherton')]);
      expect(replaced(r)).toMatch(/helpers/);
      expect(w(sim).battle).toBeUndefined();
    });

    it('a record with fewer orders than the city took', () => {
      const sim = hosting(frontier, false);
      const r = takeRecord(sim, early.slice(0, 1));
      expect(replaced(r)).toMatch(/orders/);
      expect(w(sim).battle).toBeUndefined();
    });
  });

  it('a record for a battle the city does not host is taken as ever', () => {
    const sim = load(samSave);
    const r = takeRecord(sim, log);
    expect(r.ok).toBe(true);
    expect(r.ok && r.info?.standIn).toBeUndefined();
    expect(w(sim).battle).toBeUndefined();
    expect(left(sim).end!.hash).toBe(Battle.run(recordInput(input, log)).hash());
  });
});
