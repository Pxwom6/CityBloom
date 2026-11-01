import { beforeAll, describe, expect, it } from 'vitest';
import { ATOM, type AtomStage } from '../../src/data/atom';
import { TIER_KEYS } from '../../src/data/research';
import { WAR } from '../../src/data/war';
import { checkCommand, PAGE_ONLY } from '../../src/sim/commandCheck';
import { COMMAND_TYPES, type Command } from '../../src/sim/commands';
import { roomRefusal, type SharedRules } from '../../src/sim/rules';
import type { Sim } from '../../src/sim/sim';
import { partHashes } from '../../src/sim/sync';
import {
  atomHour,
  atomOf,
  atomStage,
  atomSummary,
  atomLock,
  atomKeeps,
  nuclearRunning,
} from '../../src/sim/systems/atom';
import { fightingWith } from '../../src/sim/systems/diplomacy';
import { allTiersDone } from '../../src/sim/systems/research';
import { materialBill, unitBill } from '../../src/sim/systems/war';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { UNIT } from '../../src/data/war';
import { clone, dip, friendTakesPlace, rivals, setTreasury, treaty, why } from './economyHelpers';
import { labTown, ok } from './researchTown';

/**
 * M40, step 2: fuel, the bomb and the preparation of a launch (docs/plans/M40-design.md, calls 1 and
 * 5 to 7). The whole race once through the real clock, from all 24 tiers to a bomb fired at a computer
 * neighbour; then the pieces one at a time, an hour per `atomHour` call on a town whose crews are set
 * by hand: the money to the dollar, every wait and its reason, the fair clock, each loss rule, each
 * refusal, the host's launch in a shared city, and a save and load in the middle of each step.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;
const PLANT = 'enrichment';
const SILO = 'atomsilo';

/** The neighbours go dark (a blackout of the city's making, for ever): no raids and no spies to spoil a long run. */
function dark(sim: Sim): void {
  for (const n of rivals(sim)) n.rival!.blackout = { from: 0, until: 1e9 };
}

/** A civic building of a kind. */
const civic = (sim: Sim, def: string) => [...sim.state.civics.values()].find((c) => c.def === def)!;

/** A war with this rival, declared and open (total unless said). */
function openWar(sim: Sim, id: number, scale: 'war' | 'total' = 'total'): void {
  ok(sim, { type: 'declareWar', neighbour: id, scale, reason: 'The race' });
  const war = dip(sim).wars.find((w) => w.with === id)!;
  sim.advance(Math.max(0, war.opens - sim.state.tick) + 1);
  expect(fightingWith(sim, id)?.scale).toBe(scale);
}

/** Both race buildings at full crew and power, as the hour's rate reads them. */
function crews(sim: Sim, staff = 1, powered = 1): void {
  for (const def of [PLANT, SILO]) {
    const c = civic(sim, def);
    if (!c) continue;
    c.staff = staff;
    c.powered = powered;
  }
}

/** `n` hours of the race, an hour a call. */
function hours(sim: Sim, n: number): void {
  for (let k = 0; k < n; k++) atomHour(sim);
}

/** Records what the city spends by ledger line (for the instalments and the launch). */
function spyOnSpending(sim: Sim): Record<string, number[]> {
  const spent: Record<string, number[]> = {};
  const spend = sim.spend.bind(sim);
  sim.spend = (amount: number, category: string) => {
    (spent[category] ??= []).push(amount);
    spend(amount, category);
  };
  return spent;
}

const events = (sim: Sim, kind: string) => sim.events.filter((e) => e.kind === kind);

/**
 * A war town with all 24 tiers done, rich, with a nuclear plant running, the enrichment plant and the
 * atom silo both finished, and a total war open with the first rival. Built once; each test plays a
 * copy of it from a save.
 */
let base: Sim;
let ids: { nuclear: number; plant: number; silo: number; rival: number; ally: number; free: number };

beforeAll(() => {
  const { sim, place } = labTown(0, { length: 800, streets: 7 });
  dark(sim);
  const nuclear = place('nuclear');
  sim.advance(M);
  ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
  ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
  const plant = place(PLANT);
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic: plant });
  const silo = place(SILO);
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic: silo });
  // The crews are posted over the next days. The rules turn the bomb off meanwhile, so the finished
  // plant doesn't begin making fuel: the base town has not begun the race.
  sim.state.region.rules = { war: true, scale: 'total', supers: true };
  sim.advance(3 * M);
  // The first rival is the one at war with the city; its ally joins in a smaller war; the third has no quarrel.
  const [rival, ally, free] = rivals(sim);
  openWar(sim, rival!.id);
  delete sim.state.region.rules;
  expect(sim.state.war!.atom).toBeUndefined();
  base = sim;
  ids = { nuclear, plant, silo, rival: rival!.id, ally: ally!.id, free: free!.id };
}, 180_000);

/** A copy of the base town at a stage of the race, crews at full strength. */
function at(stage: AtomStage): Sim {
  const sim = clone(base);
  // Before the silo is built the city has none (the stage follows the buildings).
  if (stage === 'none' || stage === 'plant' || stage === 'enriching') sim.removeCivic(civic(sim, SILO).id);
  ok(sim, { type: 'cheat', cheat: 'atom', stage, to: ids.rival });
  crews(sim);
  return sim;
}

/** Every reason the silo isn't working: the bomb's build and a preparation wait for it. */
const SILO_WAITS: { name: string; cause: (sim: Sim) => void; cure: (sim: Sim) => void; words: RegExp }[] = [
  {
    name: 'a silo short of workers',
    cause: (sim) => (civic(sim, SILO).staff = 0.1),
    cure: (sim) => (civic(sim, SILO).staff = 1),
    words: /atom silo needs workers/,
  },
  {
    name: 'a silo without power',
    cause: (sim) => (civic(sim, SILO).powered = 0.2),
    cure: (sim) => (civic(sim, SILO).powered = 1),
    words: /atom silo needs power/,
  },
  {
    name: 'a silo closed by damage',
    cause: (sim) => (civic(sim, SILO).damage = 6),
    cure: (sim) => (civic(sim, SILO).damage = 0),
    words: /atom silo is closed for repairs/,
  },
  {
    name: 'a blackout',
    cause: (sim) => (sim.state.war!.blackout = { by: 2, from: 0, until: 1e9 }),
    cure: (sim) => delete sim.state.war!.blackout,
    words: /blackout has the atom silo dark/,
  },
  {
    name: 'the rules turned off mid-race',
    cause: (sim) => (sim.state.region.rules = { war: true, scale: 'total', supers: true }),
    cure: (sim) => delete sim.state.region.rules,
    words: /region’s rules turn the atom bomb off/,
  },
  {
    name: 'no funding',
    cause: (sim) => ok(sim, { type: 'setFunding', dept: 'defence', pct: 0 }),
    cure: (sim) => ok(sim, { type: 'setFunding', dept: 'defence', pct: 100 }),
    words: /Defence funding is too low to run the silo/,
  },
];

describe('M40: the race through the real clock', () => {
  it('runs from all 24 tiers through plant, fuel, silo, bomb and preparation to a bomb fired at a computer neighbour', () => {
    const { sim, place } = labTown(0, { length: 800, streets: 7 });
    dark(sim);
    const nuclear = place('nuclear');
    sim.advance(M);
    expect(nuclearRunning(sim)).toBe(true);
    ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
    ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
    expect(allTiersDone(sim)).toBe(true);
    // The most the plant, silo and forces can be funded: a rate of 1.25 (the race is the same work, sooner).
    ok(sim, { type: 'setFunding', dept: 'defence', pct: 150 });
    const target = rivals(sim)[0]!;
    openWar(sim, target.id);
    const spent = spyOnSpending(sim);
    const lowest = { treasury: sim.state.treasury };
    const advance = (months: number, until: () => boolean, limit = 80) => {
      for (let k = 0; k < limit && !until(); k++) {
        sim.advance(months * M);
        lowest.treasury = Math.min(lowest.treasury, sim.state.treasury);
      }
      expect(until(), 'the step finished in time').toBe(true);
    };
    const stage = () => atomStage(sim);
    const a = () => sim.state.war!.atom;

    // Nothing started: no state, and nothing asked of the city.
    expect(stage()).toBe('none');
    expect(a()).toBeUndefined();
    // The plant goes up over its three stages, and starts making fuel the day it is online and crewed.
    const plant = place(PLANT);
    expect(stage()).toBe('plant');
    advance(1, () => !sim.state.civics.get(plant)!.build);
    advance(1, () => (a()?.fuel ?? 0) > 0, 10);
    expect(stage()).toBe('enriching');
    // The silo goes up beside the fuel, and the fuel goes on to a full load.
    const silo = place(SILO);
    expect(stage()).toBe('silo');
    advance(1, () => !sim.state.civics.get(silo)!.build);
    expect(stage()).toBe('silo');
    expect(sim.state.civics.get(silo)!.staff ?? 0).toBeGreaterThan(0.25);
    advance(3, () => a()!.fuel >= ATOM.fuel.hours, 40);
    expect(a()!.fuel).toBe(ATOM.fuel.hours);
    expect(events(sim, 'fuelFull')).toHaveLength(1);
    expect(stage()).toBe('silo');

    // The bomb: the first instalment now, twelve in all, ready after 720 hours of the silo's work.
    const built = ok(sim, { type: 'buildBomb' });
    expect(built.cost).toBeGreaterThan(ATOM.bomb.instalment.money);
    expect(stage()).toBe('bomb');
    advance(1, () => !!a()!.have, 60);
    expect(spent.atomBomb).toEqual(Array(12).fill(ATOM.bomb.instalment.money));
    expect(events(sim, 'bombReady')).toHaveLength(1);
    expect(a()!.first, 'first in a city of its own').toBe(true);
    expect(stage()).toBe('ready');

    // A launch: $1.2M, then the preparation, and the bomb leaves for the neighbour it was aimed at.
    ok(sim, { type: 'launchBomb', to: target.id });
    expect(spent.atomLaunch).toEqual([ATOM.launch.cost]);
    expect(stage()).toBe('preparing');
    advance(1, () => !!a()!.fired, 40);
    expect(a()!.fired).toMatchObject({ to: target.id, name: target.name });
    expect(a()!.have).toBeUndefined();
    expect(a()!.prep).toBeUndefined();
    expect(events(sim, 'bombFired')).toHaveLength(1);
    expect(stage()).toBe('flying');
    // The money never ran out: the race was paid for as it went.
    expect(lowest.treasury).toBeGreaterThan(0);
    // One bomb ever: nothing more can be made, aimed or built.
    expect(atomLock(sim, PLANT)).toMatch(/used its atom bomb/);
    expect(why(sim, { type: 'buildBomb' })).toMatch(/used its atom bomb/);
    // The flight is on the city's own clock: a game day after it left the bomb lands on the neighbour
    // (step 3's landing; its record is tested in atomStrike.test.ts), and the city is not its target.
    expect(a()!.inbound).toBeUndefined();
    const fired = a()!.fired!;
    const popBefore = () => target.population;
    sim.advance(fired.tick + ATOM.flight.hours * H - 1 - sim.state.tick);
    const pre = popBefore();
    expect(a()!.fired!.landed).toBeUndefined();
    sim.advance(1);
    expect(a()!.fired!.landed).toBe(true);
    expect(target.population).toBe(Math.round(pre * ATOM.record.keep));
    expect(target.rival!.relation).toBe(-100);
    expect(stage()).toBe('spent');
    expect(nuclear).toBeGreaterThan(0);
  }, 300_000);
});

describe('M40: fuel', () => {
  it('grows an hour at the crew’s rate and costs the same for every unit made, only while it works', () => {
    const sim = at('plant');
    const a = atomOf(sim);
    expect(a.fuel).toBe(0);
    hours(sim, 10);
    expect(a.fuel).toBe(10);
    const line = () => sim.state.economy.month.enrichment ?? 0;
    expect(line()).toBe(-10 * ATOM.fuel.cost);
    // Half the crew and four fifths of the power: 0.4 an hour, and a bill for 0.4 of the hour's price.
    const plant = civic(sim, PLANT);
    plant.staff = 0.5;
    plant.powered = 0.8;
    hours(sim, 10);
    expect(a.fuel).toBeCloseTo(14, 6);
    expect(line()).toBe(-Math.round(14 * ATOM.fuel.cost));
    // Funded to 150 %, the plant is a quarter faster and the unit of fuel costs what it did.
    plant.staff = 1;
    plant.powered = 1;
    ok(sim, { type: 'setFunding', dept: 'defence', pct: 150 });
    const before = { fuel: a.fuel, line: line() };
    hours(sim, 4);
    expect(a.fuel - before.fuel).toBeCloseTo(5, 6);
    expect(before.line - line()).toBeCloseTo(5 * ATOM.fuel.cost, -1);
  });

  it('is a full load for $2.3M whatever the crew, then stops, and the event is told once', () => {
    const sim = at('plant');
    const a = atomOf(sim);
    hours(sim, ATOM.fuel.hours - 1);
    expect(a.fuel).toBe(ATOM.fuel.hours - 1);
    hours(sim, 1);
    expect(a.fuel).toBe(ATOM.fuel.hours);
    expect(sim.state.economy.month.enrichment).toBe(-ATOM.fuel.hours * ATOM.fuel.cost);
    expect(events(sim, 'fuelFull')).toHaveLength(1);
    // A full load makes no more and asks no more.
    hours(sim, 50);
    expect(a.fuel).toBe(ATOM.fuel.hours);
    expect(sim.state.economy.month.enrichment).toBe(-ATOM.fuel.hours * ATOM.fuel.cost);
    expect(events(sim, 'fuelFull')).toHaveLength(1);
    expect(atomSummary(sim)).toMatchObject({ fuel: 1, fuelWait: null, stage: 'enriching' });
  });

  // The fuel gained and the dollars charged are the same count: a crew that works at a rate which isn't
  // a whole number of thousandths a hour still pays exactly the price of a full load.
  for (const [staff, powered] of [
    [0.3333, 1],
    [0.6171, 1],
    [1, 0.771],
    [0.26, 0.55],
  ] as const)
    it(`is a full load for $2.3M at a crew's rate of ${Math.round(staff * powered * 10000) / 10000}, to the dollar`, () => {
      const sim = at('plant');
      const plant = civic(sim, PLANT);
      plant.staff = staff;
      plant.powered = powered;
      const a = atomOf(sim);
      let calls = 0;
      while (a.fuel < ATOM.fuel.hours && calls < 10_000) {
        atomHour(sim);
        calls++;
      }
      expect(a.fuel).toBe(ATOM.fuel.hours);
      expect(sim.state.economy.month.enrichment).toBe(-ATOM.fuel.hours * ATOM.fuel.cost);
      // Nothing is left owing in the carry.
      expect(sim.state.economy.carry.enrichment ?? 0).toBe(0);
      // And it takes about as long as the rate says.
      expect(calls).toBeGreaterThan(ATOM.fuel.hours / (staff * powered) - 5);
      expect(calls).toBeLessThan(ATOM.fuel.hours / (staff * powered) + 5);
    });

  /** Every reason fuel waits: the way to bring it about, the way to put it right, and the words. */
  const WAITS: {
    name: string;
    cause: (sim: Sim) => void;
    cure: (sim: Sim) => void;
    words: RegExp;
  }[] = [
    {
      name: 'a short treasury',
      cause: (sim) => setTreasury(sim, 1000),
      cure: (sim) => setTreasury(sim, 5_000_000),
      words: /treasury can’t pay for the fuel/,
    },
    {
      name: 'a plant short of workers',
      cause: (sim) => (civic(sim, PLANT).staff = 0.1),
      cure: (sim) => (civic(sim, PLANT).staff = 1),
      words: /enrichment plant needs workers/,
    },
    {
      name: 'a plant without power',
      cause: (sim) => (civic(sim, PLANT).powered = 0.2),
      cure: (sim) => (civic(sim, PLANT).powered = 1),
      words: /enrichment plant needs power/,
    },
    {
      name: 'a plant closed by damage',
      cause: (sim) => (civic(sim, PLANT).damage = 6),
      cure: (sim) => (civic(sim, PLANT).damage = 0),
      words: /closed for repairs/,
    },
    {
      name: 'a plant under water',
      cause: (sim) => (civic(sim, PLANT).flooded = true),
      cure: (sim) => (civic(sim, PLANT).flooded = false),
      words: /plant is flooded/,
    },
    {
      name: 'no nuclear plant running',
      cause: (sim) => (civic(sim, 'nuclear').damage = 6),
      cure: (sim) => (civic(sim, 'nuclear').damage = 0),
      words: /No nuclear power plant is running/,
    },
    {
      name: 'a blackout',
      cause: (sim) => (sim.state.war!.blackout = { by: 2, from: 0, until: 1e9 }),
      cure: (sim) => delete sim.state.war!.blackout,
      words: /blackout has the enrichment plant dark/,
    },
    {
      name: 'the rules turned off mid-race',
      cause: (sim) => (sim.state.region.rules = { war: true, scale: 'total', supers: true }),
      cure: (sim) => delete sim.state.region.rules,
      words: /region’s rules turn the atom bomb off/,
    },
    {
      name: 'no funding',
      cause: (sim) => ok(sim, { type: 'setFunding', dept: 'defence', pct: 0 }),
      cure: (sim) => ok(sim, { type: 'setFunding', dept: 'defence', pct: 100 }),
      words: /funding is too low/,
    },
  ];

  for (const w of WAITS)
    it(`waits for ${w.name}, says why, keeps what it made and goes on when it is put right`, () => {
      const sim = at('enriching');
      const a = atomOf(sim);
      hours(sim, 3);
      const fuel = a.fuel;
      const line = sim.state.economy.month.enrichment;
      const carry = sim.state.economy.carry.enrichment;
      w.cause(sim);
      hours(sim, 6);
      expect(a.fuel, 'no fuel while it waits').toBe(fuel);
      expect(sim.state.economy.month.enrichment, 'no charge while it waits').toBe(line);
      expect(sim.state.economy.carry.enrichment).toBe(carry);
      expect(atomSummary(sim)!.fuelWait).toMatch(w.words);
      expect(atomSummary(sim)!.fuel).toBeCloseTo(fuel / ATOM.fuel.hours, 3);
      w.cure(sim);
      expect(atomSummary(sim)!.fuelWait).toBeNull();
      hours(sim, 2);
      expect(a.fuel).toBe(fuel + 2);
    });

  it('is left alone in a city that has not begun: no state made, nothing booked, nothing changed', () => {
    // No plant at all: a war city goes through a hundred hours of the race with nothing different.
    const plain = clone(base);
    for (const c of [...plain.state.civics.values()])
      if (c.def === PLANT || c.def === SILO) plain.removeCivic(c.id);
    const twin = clone(plain);
    hours(plain, 100);
    expect(plain.state.war!.atom).toBeUndefined();
    expect(partHashes(plain)).toEqual(partHashes(twin));
    // A plant that is not working (no crew) makes no state either, and books nothing.
    const idle = clone(base);
    civic(idle, PLANT).staff = 0;
    const idleTwin = clone(idle);
    hours(idle, 100);
    expect(idle.state.war!.atom).toBeUndefined();
    expect(partHashes(idle)).toEqual(partHashes(idleTwin));
    // And so does a plant that works in a city whose rules have turned the bomb off.
    const off = clone(base);
    crews(off);
    off.state.region.rules = { war: true, scale: 'total', supers: true };
    hours(off, 100);
    expect(off.state.war!.atom).toBeUndefined();
    // Working, it begins: the state is made by the first hour of fuel.
    const on = clone(base);
    crews(on);
    expect(on.state.war!.atom).toBeUndefined();
    atomHour(on);
    expect(on.state.war!.atom).toEqual({ fuel: 1, boom: 0, stopped: 0 });
    // None of it draws from a random stream.
    expect(on.state.war!.rng).toEqual(base.state.war!.rng);
  });
});

describe('M40: the bomb’s build', () => {
  it('pays the first instalment at once, the money booked to its line and the materials from the stores first', () => {
    const sim = at('silo');
    const w = sim.state.war!;
    w.stock = { goods: 30, ore: 500, oil: 0, munitions: 7 };
    const spent = spyOnSpending(sim);
    const treasury = sim.state.treasury;
    const inst = ATOM.bomb.instalment;
    const price = WAR.materials.importPrice;
    // 30 goods and no oil in the stores: the missing 20 goods and all 167 oil are bought in.
    const imports = 20 * price.goods + inst.oil * price.oil;
    const preview = sim.preview({ type: 'buildBomb' });
    expect(preview).toMatchObject({ ok: true, cost: inst.money + imports });
    expect(w.atom!.bomb).toBeUndefined();
    ok(sim, { type: 'buildBomb' });
    expect(spent.atomBomb).toEqual([inst.money]);
    expect(spent.warImports).toEqual([imports]);
    expect(treasury - sim.state.treasury).toBe(inst.money + imports);
    expect(w.stock).toEqual({ goods: 0, ore: 300, oil: 0, munitions: 7 });
    expect(w.atom!.bomb).toEqual({ done: 0, paid: 1 });
    expect(atomStage(sim)).toBe('bomb');
    expect(atomSummary(sim)!.bomb).toEqual({ done: 0, paid: 1, of: 12, wait: null });
  });

  it('is twelve instalments, one every 60 hours, $7.8M and the materials over 720 hours, then the bomb is ready', () => {
    const sim = at('silo');
    const w = sim.state.war!;
    w.stock = { goods: 30, ore: 500, oil: 0, munitions: 0 };
    ok(sim, { type: 'buildBomb' });
    const spent = spyOnSpending(sim);
    const a = w.atom!;
    // No instalment falls due before 60 hours are done; the next is paid the hour the 60th is.
    hours(sim, 59);
    expect(a.bomb).toEqual({ done: 59, paid: 1 });
    hours(sim, 1);
    expect(a.bomb).toEqual({ done: 60, paid: 1 });
    expect(spent.atomBomb ?? []).toEqual([]);
    atomHour(sim);
    expect(a.bomb).toEqual({ done: 61, paid: 2 });
    expect(spent.atomBomb).toEqual([ATOM.bomb.instalment.money]);
    hours(sim, 720 - 61 - 1);
    expect(a.bomb).toEqual({ done: 719, paid: 12 });
    expect(a.have).toBeUndefined();
    atomHour(sim);
    expect(a.bomb).toBeUndefined();
    expect(a.have).toBe(true);
    expect(atomStage(sim)).toBe('ready');
    expect(events(sim, 'bombReady')).toHaveLength(1);
    // Eleven more instalments after the first, and every material bought in once the stores run out.
    expect(spent.atomBomb).toHaveLength(11);
    const total = sim.state.economy.month;
    expect(-(total.atomBomb ?? 0) - 0).toBeGreaterThanOrEqual(11 * ATOM.bomb.instalment.money);
    const inst = ATOM.bomb.instalment;
    const price = WAR.materials.importPrice;
    // The stores held 30 goods and 500 ore once: of 12 times the bill, the rest was bought in.
    const need = { goods: 12 * inst.goods, ore: 12 * inst.ore, oil: 12 * inst.oil };
    const bought = (need.goods - 30) * price.goods + (need.ore - 500) * price.ore + need.oil * price.oil;
    const firstOnly = 20 * price.goods + inst.oil * price.oil;
    expect(spent.warImports.reduce((x, y) => x + y, 0) + firstOnly).toBe(bought);
    // Nothing more is made or asked once it is built.
    const treasury = sim.state.treasury;
    hours(sim, 100);
    expect(sim.state.treasury).toBe(treasury);
    expect(a.have).toBe(true);
  });

  it('waits at the boundary when an instalment can’t be paid, says so once, and goes on when it can', () => {
    const sim = at('silo');
    ok(sim, { type: 'buildBomb' });
    const a = atomOf(sim);
    hours(sim, 60);
    expect(a.bomb!.done).toBe(60);
    const spent = spyOnSpending(sim);
    setTreasury(sim, 100);
    hours(sim, 10);
    expect(a.bomb).toEqual({ done: 60, paid: 1, waiting: true });
    expect(spent.atomBomb).toBeUndefined();
    expect(events(sim, 'bombWaiting')).toHaveLength(1);
    expect(atomSummary(sim)!.bomb!.wait).toMatch(/treasury can’t pay the next instalment/);
    setTreasury(sim, 5_000_000);
    hours(sim, 1);
    expect(a.bomb).toEqual({ done: 61, paid: 2 });
    expect(spent.atomBomb).toEqual([ATOM.bomb.instalment.money]);
    expect(events(sim, 'bombWaiting')).toHaveLength(1);
    expect(atomSummary(sim)!.bomb!.wait).toBeNull();
  });

  it('never goes past the hours its instalments have paid for, even at a quarter faster', () => {
    const sim = at('silo');
    ok(sim, { type: 'setFunding', dept: 'defence', pct: 150 });
    ok(sim, { type: 'buildBomb' });
    const a = atomOf(sim);
    let calls = 0;
    while (a.bomb && calls < 700) {
      atomHour(sim);
      calls++;
      if (a.bomb) expect(a.bomb.done).toBeLessThanOrEqual(a.bomb.paid * ATOM.bomb.every);
    }
    expect(a.have).toBe(true);
    // 720 hours at 1.25 an hour: 576 hours of work, no hour lost to waiting at a boundary.
    expect(calls).toBe(576);
  });

  // A rate that doesn't divide the 60 hours between instalments crosses a boundary part-way through
  // an hour: the hours stop at it until the instalment is paid, and the rest of that hour goes on past
  // it (no work is lost to the boundary).
  for (const staff of [0.7, 0.45, 0.333])
    it(`stops at each boundary and loses no work to it at a crew of ${staff}`, () => {
      const sim = at('silo');
      civic(sim, SILO).staff = staff;
      ok(sim, { type: 'buildBomb' });
      const spent = spyOnSpending(sim);
      const a = atomOf(sim);
      let calls = 0;
      while (a.bomb && calls < 5_000) {
        atomHour(sim);
        calls++;
        if (a.bomb) expect(a.bomb.done).toBeLessThanOrEqual(a.bomb.paid * ATOM.bomb.every);
      }
      expect(a.have).toBe(true);
      expect(spent.atomBomb).toHaveLength(11);
      // The work is `staff` an hour, all of it counted: 720 of it takes 720 / staff hours, to the hour.
      expect(calls).toBe(Math.ceil(ATOM.bomb.hours / staff - 1e-9));
    });

  it('pays no instalment while the silo has no funding, and says why', () => {
    const sim = at('silo');
    ok(sim, { type: 'buildBomb' });
    const a = atomOf(sim);
    hours(sim, 60);
    expect(a.bomb).toEqual({ done: 60, paid: 1 });
    const spent = spyOnSpending(sim);
    const treasury = sim.state.treasury;
    ok(sim, { type: 'setFunding', dept: 'defence', pct: 0 });
    expect(atomSummary(sim)!.bomb!.wait).toBe('Defence funding is too low to run the silo');
    hours(sim, 20);
    // The instalment is due, but it isn't paid for hours that cannot go by.
    expect(a.bomb).toEqual({ done: 60, paid: 1 });
    expect(spent.atomBomb).toBeUndefined();
    expect(spent.warImports).toBeUndefined();
    expect(sim.state.treasury).toBe(treasury);
    ok(sim, { type: 'setFunding', dept: 'defence', pct: 100 });
    expect(atomSummary(sim)!.bomb!.wait).toBeNull();
    hours(sim, 1);
    expect(a.bomb).toEqual({ done: 61, paid: 2 });
    expect(spent.atomBomb).toEqual([ATOM.bomb.instalment.money]);
  });

  for (const w of SILO_WAITS)
    it(`waits for ${w.name}, keeping the hours and the instalments paid`, () => {
      const sim = at('bomb');
      const a = atomOf(sim);
      const was = { ...a.bomb! };
      const spent = spyOnSpending(sim);
      w.cause(sim);
      hours(sim, 80);
      expect(a.bomb).toEqual(was);
      expect(spent.atomBomb).toBeUndefined();
      expect(atomSummary(sim)!.bomb!.wait).toMatch(w.words);
      w.cure(sim);
      hours(sim, 5);
      expect(a.bomb!.done).toBe(was.done + 5);
    });

  it('can be stopped: the instalments paid stay spent, and starting again pays the first once more', () => {
    const sim = at('silo');
    ok(sim, { type: 'buildBomb' });
    hours(sim, 130);
    const a = atomOf(sim);
    expect(a.bomb!.paid).toBe(3);
    const treasury = sim.state.treasury;
    expect(sim.preview({ type: 'cancelBomb' })).toMatchObject({ ok: true, cost: 0 });
    ok(sim, { type: 'cancelBomb' });
    expect(a.bomb).toBeUndefined();
    expect(sim.state.treasury).toBe(treasury);
    expect(atomStage(sim)).toBe('silo');
    expect(why(sim, { type: 'cancelBomb' })).toBe('No bomb is being built');
    ok(sim, { type: 'buildBomb' });
    expect(a.bomb).toEqual({ done: 0, paid: 1 });
    expect(sim.state.treasury).toBeLessThan(treasury);
  });

  it('is refused in plain words', () => {
    const asked = (sim: Sim) => why(sim, { type: 'buildBomb' });
    // Not a war city.
    const peace = clone(base);
    delete peace.state.war;
    expect(asked(peace)).toBe('War is off in this city');
    // Fuel short of a full load.
    const half = at('enriching');
    expect(asked(half)).toBe('The bomb needs a full load of fuel (50 % made)');
    const none = at('plant');
    expect(asked(none)).toBe('The bomb needs a full load of fuel (0 % made)');
    // The rules.
    const off = at('silo');
    off.state.region.rules = { war: true, scale: 'total', supers: true };
    expect(asked(off)).toBe('Your region’s rules turn the atom bomb off');
    const nobody = at('silo');
    nobody.state.options.rivals = false;
    expect(asked(nobody)).toBe('The atom bomb needs rival neighbours or a region whose rules allow it');
    // A scenario.
    const scenario = at('silo');
    scenario.state.scenario = {} as never;
    expect(asked(scenario)).toBe('The atom bomb is not part of a scenario');
    // The silo: missing, going up, short of workers.
    const nosilo = at('silo');
    nosilo.removeCivic(civic(nosilo, SILO).id);
    expect(asked(nosilo)).toBe('The city has no atom silo');
    const building = at('silo');
    civic(building, SILO).build = { stage: 0, months: 0, waiting: false };
    expect(asked(building)).toBe('The atom silo is still going up');
    const crewless = at('silo');
    civic(crewless, SILO).staff = 0;
    expect(asked(crewless)).toBe('The atom silo needs workers');
    const unfunded = at('silo');
    ok(unfunded, { type: 'setFunding', dept: 'defence', pct: 0 });
    expect(asked(unfunded)).toBe('Defence funding is too low to run the silo');
    // Money.
    const poor = at('silo');
    setTreasury(poor, 100_000);
    expect(asked(poor)).toMatch(/^Not enough money for the first instalment: \$\d/);
    // Already building, already built, used.
    const building2 = at('bomb');
    expect(asked(building2)).toBe('The bomb is already being built');
    const ready = at('ready');
    expect(asked(ready)).toBe('The city has an atom bomb already');
    const spent = at('spent');
    expect(asked(spent)).toMatch(/used its atom bomb/);
    // A dry run of a refused command is refused alike and changes nothing.
    expect(poor.preview({ type: 'buildBomb' }).ok).toBe(false);
    expect(poor.state.war!.atom?.bomb).toBeUndefined();
  });
});

function launchTo(to: number): Command {
  return { type: 'launchBomb', to };
}

describe('M40: a launch', () => {
  const launch = launchTo;

  it('costs $1.2M, is prepared over 288 hours at the silo’s rate and then leaves for a computer neighbour in an open total war', () => {
    const sim = at('ready');
    const spent = spyOnSpending(sim);
    const treasury = sim.state.treasury;
    expect(sim.preview(launch(ids.rival))).toMatchObject({ ok: true, cost: ATOM.launch.cost });
    expect(sim.state.war!.atom!.prep).toBeUndefined();
    ok(sim, launch(ids.rival));
    const a = atomOf(sim);
    expect(treasury - sim.state.treasury).toBe(ATOM.launch.cost);
    expect(spent.atomLaunch).toEqual([ATOM.launch.cost]);
    expect(a.prep).toEqual({ done: 0, to: ids.rival });
    expect(atomStage(sim)).toBe('preparing');
    expect(atomSummary(sim)!.launch).toMatchObject({
      done: 0,
      to: ids.rival,
      ready: false,
      wait: null,
      held: null,
    });
    hours(sim, ATOM.launch.prepHours - 1);
    expect(a.prep!.done).toBe(ATOM.launch.prepHours - 1);
    expect(a.fired).toBeUndefined();
    hours(sim, 1);
    // It has left: the bomb is gone from the silo, the flight is the next step's.
    const target = sim.state.region.neighbours.find((n) => n.id === ids.rival)!;
    expect(a.fired).toEqual({ tick: sim.state.tick, to: ids.rival, name: target.name });
    expect(a.have).toBeUndefined();
    expect(a.prep).toBeUndefined();
    expect(events(sim, 'bombFired')).toEqual([
      expect.objectContaining({ kind: 'bombFired', id: ids.rival, info: { to: target.name } }),
    ]);
    expect(atomStage(sim)).toBe('flying');
    expect(atomSummary(sim)!.fired).toEqual({ tick: sim.state.tick, to: ids.rival, name: target.name });
    expect(a.inbound).toBeUndefined();
    // A bomb used is used: no second launch, no second bomb.
    expect(why(sim, launch(ids.rival))).toMatch(/used its atom bomb/);
    expect(why(sim, { type: 'buildBomb' })).toMatch(/used its atom bomb/);
    // A bomb that leaves is not a bomb held.
    expect(events(sim, 'launchHeld')).toHaveLength(0);
    hours(sim, 100);
    expect(a.fired!.to).toBe(ids.rival);
    expect(spent.atomLaunch).toHaveLength(1);
  });

  it('starts over when damage closes the silo, whatever it had done, and carries on once it is open again', () => {
    const sim = at('ready');
    ok(sim, launch(ids.rival));
    const a = atomOf(sim);
    hours(sim, 100);
    expect(a.prep!.done).toBe(100);
    civic(sim, SILO).damage = 6;
    hours(sim, 1);
    expect(a.prep!.done).toBe(0);
    expect(a.have).toBe(true);
    hours(sim, 20);
    expect(a.prep!.done).toBe(0);
    civic(sim, SILO).damage = 0;
    hours(sim, 7);
    expect(a.prep!.done).toBe(7);
    // A prepared bomb is set back too.
    a.prep!.done = ATOM.launch.prepHours;
    civic(sim, SILO).flooded = true;
    hours(sim, 1);
    expect(a.prep!.done).toBe(0);
  });

  for (const w of SILO_WAITS)
    it(`holds its count for ${w.name} rather than starting over (damage excepted)`, () => {
      const sim = at('ready');
      ok(sim, launch(ids.rival));
      const a = atomOf(sim);
      hours(sim, 40);
      w.cause(sim);
      if (w.name !== 'a silo closed by damage') {
        hours(sim, 30);
        expect(a.prep!.done).toBe(40);
        expect(atomSummary(sim)!.launch!.wait).toMatch(w.words);
        w.cure(sim);
        hours(sim, 5);
        expect(a.prep!.done).toBe(45);
      } else {
        // Damage closing the silo is the one wait that sets the preparation back.
        hours(sim, 1);
        expect(a.prep!.done).toBe(0);
        expect(atomSummary(sim)!.launch!.wait).toMatch(w.words);
      }
    });

  it('waits as long as it likes once prepared: no war open at the end leaves it ready, not fired, and sending it again fires', () => {
    const sim = at('ready');
    ok(sim, launch(ids.rival));
    // A ceasefire pauses the total war before the preparation ends.
    treaty(sim, ids.rival, [{ k: 'ceasefire', hours: 720 }]);
    expect(fightingWith(sim, ids.rival)).toBeUndefined();
    const a = atomOf(sim);
    hours(sim, ATOM.launch.prepHours + 50);
    expect(a.prep).toEqual({ done: ATOM.launch.prepHours, to: ids.rival });
    expect(a.fired).toBeUndefined();
    expect(a.have).toBe(true);
    expect(atomStage(sim)).toBe('preparing');
    expect(atomSummary(sim)!.launch).toMatchObject({ done: 1, ready: true, wait: null });
    expect(why(sim, launch(ids.rival))).toMatch(/war with .* is paused/);
    // The city is told the prepared bomb is held, once, and why; the Bomb tab says the same.
    const target = sim.state.region.neighbours.find((n) => n.id === ids.rival)!;
    expect(events(sim, 'launchHeld')).toEqual([
      expect.objectContaining({
        kind: 'launchHeld',
        id: ids.rival,
        info: { to: target.name, why: expect.stringMatching(/is paused \(a ceasefire or a surrender\)/) },
      }),
    ]);
    expect(atomSummary(sim)!.launch!.held).toMatch(/is paused \(a ceasefire or a surrender\)/);
    // The war is open again: it does not go off by itself, however long it waits (and nothing holds it).
    dip(sim).pacts = dip(sim).pacts.filter((p) => p.term.k !== 'ceasefire');
    expect(fightingWith(sim, ids.rival)?.scale).toBe('total');
    expect(atomSummary(sim)!.launch).toMatchObject({ ready: true, held: null });
    hours(sim, 2_000);
    expect(events(sim, 'launchHeld')).toHaveLength(1);
    expect(a.fired).toBeUndefined();
    expect(a.prep!.done).toBe(ATOM.launch.prepHours);
    // The city sends it again, for nothing: it leaves at once.
    const treasury = sim.state.treasury;
    expect(sim.preview(launch(ids.rival))).toMatchObject({ ok: true, cost: 0 });
    ok(sim, launch(ids.rival));
    expect(sim.state.treasury).toBe(treasury);
    expect(a.fired).toMatchObject({ to: ids.rival });
    expect(a.prep).toBeUndefined();
  });

  it('tells the city a launch is held when its war ended before the preparation did, and a call-off clears it', () => {
    const sim = at('ready');
    ok(sim, launch(ids.rival));
    hours(sim, 100);
    // A ceasefire in the middle: the summary already says the bomb could not leave now.
    treaty(sim, ids.rival, [{ k: 'ceasefire', hours: 720 }]);
    expect(atomSummary(sim)!.launch).toMatchObject({
      ready: false,
      held: expect.stringMatching(/is paused/),
    });
    expect(events(sim, 'launchHeld')).toHaveLength(0);
    hours(sim, ATOM.launch.prepHours);
    expect(events(sim, 'launchHeld')).toHaveLength(1);
    ok(sim, { type: 'cancelLaunch' });
    expect(atomSummary(sim)!.launch).toBeNull();
  });

  it('can be sent again at another neighbour in a total war', () => {
    const sim = at('ready');
    ok(sim, launch(ids.rival));
    treaty(sim, ids.rival, [{ k: 'ceasefire', hours: 720 }]);
    const a = atomOf(sim);
    hours(sim, ATOM.launch.prepHours);
    expect(a.fired).toBeUndefined();
    openWar(sim, ids.free);
    // (Real hours went by in the war's warning: the prepared bomb still waits.)
    expect(a.prep!.done).toBe(ATOM.launch.prepHours);
    ok(sim, launch(ids.free));
    expect(a.fired!.to).toBe(ids.free);
  });

  it('is called off for half its price, and the bomb stays in the silo', () => {
    const sim = at('ready');
    const spent = spyOnSpending(sim);
    ok(sim, launch(ids.rival));
    hours(sim, 30);
    const treasury = sim.state.treasury;
    const refund = ATOM.launch.cost * ATOM.launch.refund;
    expect(sim.preview({ type: 'cancelLaunch' })).toMatchObject({ ok: true, cost: -refund });
    const month = sim.state.economy.month.refunds ?? 0;
    ok(sim, { type: 'cancelLaunch' });
    expect(sim.state.treasury - treasury).toBe(refund);
    expect(sim.state.economy.month.refunds).toBe(month + refund);
    const a = atomOf(sim);
    expect(a.prep).toBeUndefined();
    expect(a.have).toBe(true);
    expect(atomStage(sim)).toBe('ready');
    expect(why(sim, { type: 'cancelLaunch' })).toBe('No launch is being prepared');
    // The same half comes back from a launch fully prepared; launching again pays the price again.
    ok(sim, launch(ids.rival));
    treaty(sim, ids.rival, [{ k: 'ceasefire', hours: 720 }]);
    hours(sim, ATOM.launch.prepHours);
    expect(a.prep!.done).toBe(ATOM.launch.prepHours);
    const before = sim.state.treasury;
    ok(sim, { type: 'cancelLaunch' });
    expect(sim.state.treasury - before).toBe(refund);
    expect(spent.atomLaunch).toEqual([ATOM.launch.cost, ATOM.launch.cost]);
  });

  it('is aimed at a friend’s city only with the region’s say: put to the room, prepared until it keeps it', () => {
    const sim = at('ready');
    friendTakesPlace(sim);
    const friend = sim.state.region.neighbours.find((n) => n.player)!;
    ok(sim, {
      type: 'friendWar',
      room: 3,
      slot: 2,
      by: 'them',
      scale: 'total',
      reason: 'The race',
      state: 'open',
      score: 0,
      battles: 0,
    });
    expect(fightingWith(sim, friend.id)?.scale).toBe('total');
    ok(sim, launch(friend.id));
    const a = atomOf(sim);
    expect(a.prep).toEqual({ done: 0, to: friend.id });
    hours(sim, ATOM.launch.prepHours + 100);
    expect(a.prep!.done).toBe(ATOM.launch.prepHours);
    // The preparation done, the bomb is put to the room (the page asks for it by `friendOpsWaiting`) and
    // not fired here: it leaves the sim only when the room keeps the strike (`missionResult`).
    expect(a.fired).toBeUndefined();
    expect(a.have).toBe(true);
    expect(a.prep!.send).toMatchObject({ slot: 2 });
    expect(atomStage(sim)).toBe('preparing');
    expect(events(sim, 'bombFired')).toHaveLength(0);
    expect(events(sim, 'strikeSent')).toHaveLength(1);
    expect(events(sim, 'launchHeld')).toHaveLength(0);
    expect(atomSummary(sim)!.launch).toMatchObject({
      ready: true,
      held: expect.stringMatching(/with the region’s room/),
    });
    // Sending it again or calling it off waits for the room's word.
    expect(why(sim, launch(friend.id))).toMatch(/with the region’s room/);
    expect(why(sim, { type: 'cancelLaunch' })).toMatch(/with the region’s room/);
    expect(a.fired).toBeUndefined();
  });

  it('is refused in plain words', () => {
    const asked = (sim: Sim, to = ids.rival) => why(sim, launch(to));
    const peace = clone(base);
    delete peace.state.war;
    expect(asked(peace)).toBe('War is off in this city');
    expect(asked(at('silo'))).toBe('The city has no atom bomb: build one first');
    expect(asked(at('bomb'))).toBe('The bomb isn’t finished yet');
    const off = at('ready');
    off.state.region.rules = { war: true, scale: 'total', supers: true };
    expect(asked(off)).toBe('Your region’s rules turn the atom bomb off');
    // A region that turned superweapons off turns the bomb off with them.
    const noSupers = at('ready');
    noSupers.state.region.rules = { war: true, scale: 'total', bomb: true } as never;
    expect(asked(noSupers)).toBe('Your region’s rules turn the atom bomb off');
    const scenario = at('ready');
    scenario.state.scenario = {} as never;
    expect(asked(scenario)).toBe('The atom bomb is not part of a scenario');
    const crewless = at('ready');
    civic(crewless, SILO).staff = 0;
    expect(asked(crewless)).toBe('The atom silo needs workers');
    const unfunded = at('ready');
    ok(unfunded, { type: 'setFunding', dept: 'defence', pct: 0 });
    expect(asked(unfunded)).toBe('Defence funding is too low to run the silo');
    expect(asked(at('ready'), 99_999)).toBe('No such neighbour');
    // Not at war with that neighbour, at war but not total, a war not yet open, a ceasefire.
    const ready = at('ready');
    const free = ready.state.region.neighbours.find((n) => n.id === ids.free)!;
    const ally = ready.state.region.neighbours.find((n) => n.id === ids.ally)!;
    expect(asked(ready, ids.free)).toBe(`The bomb needs a total war with ${free.name}: you are not at war`);
    // (The first rival's ally joined it in a war of the smaller kind.)
    expect(fightingWith(ready, ids.ally)?.scale).toBe('war');
    expect(asked(ready, ids.ally)).toBe(
      `Only a total war can use the bomb: your war with ${ally.name} is not a total war`,
    );
    const declared = at('ready');
    ok(declared, { type: 'declareWar', neighbour: ids.free, scale: 'total', reason: 'x' });
    expect(asked(declared, ids.free)).toBe(`The war with ${free.name} hasn’t opened yet`);
    const truce = at('ready');
    treaty(truce, ids.rival, [{ k: 'ceasefire', hours: 720 }]);
    expect(asked(truce)).toMatch(/is paused \(a ceasefire or a surrender\): the bomb waits/);
    // The city neutral, a vassal; the target the city's vassal.
    const neutral = at('ready');
    dip(neutral).neutral = { since: 0 };
    expect(asked(neutral)).toBe('A neutral city doesn’t launch bombs');
    const vassal = at('ready');
    dip(vassal).vassal = { overlord: ids.free, since: 0 };
    expect(asked(vassal)).toBe('A vassal can’t launch the bomb');
    const holder = at('ready');
    const held = holder.state.region.neighbours.find((n) => n.id === ids.rival)!;
    held.rival!.vassal = { since: 0 };
    expect(asked(holder)).toBe(`${held.name} is your vassal`);
    // The price, and a launch already under way.
    const poor = at('ready');
    setTreasury(poor, 100_000);
    expect(asked(poor)).toBe('Not enough money: $1,200,000 to prepare a launch');
    const going = at('ready');
    ok(going, launch(ids.rival));
    expect(asked(going)).toBe('A launch is already being prepared');
    // A refusal changes nothing, and a dry run of one is refused alike.
    expect(poor.state.war!.atom!.prep).toBeUndefined();
    expect(poor.preview(launch(ids.rival)).ok).toBe(false);
  });
});

describe('M40: what is lost, and what is kept', () => {
  it('loses half the fuel with a finished plant destroyed, and the plant after that makes no more', () => {
    const sim = at('silo');
    const a = atomOf(sim);
    a.fuel = ATOM.fuel.hours / 2;
    sim.removeCivic(civic(sim, PLANT).id);
    expect(a.fuel).toBe(ATOM.fuel.hours / 4);
    expect(events(sim, 'atomLost')).toEqual([
      expect.objectContaining({ kind: 'atomLost', info: { what: 'fuel' } }),
    ]);
    hours(sim, 100);
    expect(a.fuel).toBe(ATOM.fuel.hours / 4);
    // The silo stands, so the stage is the silo's; the fuel is kept for a new plant.
    expect(atomStage(sim)).toBe('silo');
    expect(atomSummary(sim)!.fuelWait).toBe('The city has no enrichment plant');
  });

  it('halves nothing for a plant that never held fuel, or one still going up', () => {
    const empty = at('plant');
    empty.removeCivic(civic(empty, PLANT).id);
    expect(atomOf(empty).fuel).toBe(0);
    expect(events(empty, 'atomLost')).toHaveLength(0);
    const sim = at('enriching');
    civic(sim, PLANT).build = { stage: 0, months: 0, waiting: false };
    sim.removeCivic(civic(sim, PLANT).id);
    expect(atomOf(sim).fuel).toBe(ATOM.fuel.hours / 2);
  });

  for (const stage of ['bomb', 'ready', 'preparing'] as const)
    it(`loses the bomb and the launch with the silo destroyed (stage ${stage}), and keeps the fuel`, () => {
      const sim = at(stage);
      const a = atomOf(sim);
      sim.removeCivic(civic(sim, SILO).id);
      expect(a.bomb).toBeUndefined();
      expect(a.have).toBeUndefined();
      expect(a.prep).toBeUndefined();
      expect(a.fuel).toBe(ATOM.fuel.hours);
      expect(events(sim, 'atomLost')).toEqual([
        expect.objectContaining({ kind: 'atomLost', info: { what: 'bomb' } }),
      ]);
      expect(atomStage(sim)).toBe('enriching');
      // Nothing is left to go on with: no silo, so no progress and nothing to start.
      hours(sim, 50);
      expect(a.bomb).toBeUndefined();
      expect(why(sim, { type: 'buildBomb' })).toBe('The city has no atom silo');
    });

  it('only pauses fuel, the bomb and the preparation when damage closes a building, and restarts the preparation', () => {
    const sim = at('bomb');
    const a = atomOf(sim);
    const was = { ...a.bomb! };
    civic(sim, SILO).damage = 8;
    hours(sim, 30);
    expect(a.bomb).toEqual(was);
    expect(a.have).toBeUndefined();
    expect(events(sim, 'atomLost')).toHaveLength(0);
    const ready = at('ready');
    civic(ready, SILO).damage = 8;
    hours(ready, 30);
    expect(atomOf(ready).have).toBe(true);
    const fuel = at('enriching');
    civic(fuel, PLANT).damage = 8;
    hours(fuel, 30);
    expect(atomOf(fuel).fuel).toBe(ATOM.fuel.hours / 2);
    expect(atomStage(fuel)).toBe('enriching');
    const prep = at('preparing');
    expect(atomOf(prep).prep!.done).toBeGreaterThan(0);
    civic(prep, SILO).damage = 8;
    hours(prep, 1);
    expect(atomOf(prep).prep).toEqual({ done: 0, to: ids.rival });
    expect(atomOf(prep).have).toBe(true);
  });

  it('refuses to bulldoze a plant that holds fuel, or a silo that holds a build, a bomb or a launch', () => {
    const bulldoze = (sim: Sim, def: string) =>
      sim.preview({ type: 'bulldoze', target: { kind: 'civic', id: civic(sim, def).id } });
    // Empty, they come down (and pay nothing back).
    const empty = at('silo');
    atomOf(empty).fuel = 0;
    expect(bulldoze(empty, PLANT)).toMatchObject({ ok: true });
    expect(bulldoze(empty, SILO)).toMatchObject({ ok: true });
    expect(atomKeeps(empty, civic(empty, PLANT))).toBeNull();
    // The plant holding fuel.
    const fueled = at('enriching');
    expect(bulldoze(fueled, PLANT)).toEqual({
      ok: false,
      reason: 'The enrichment plant holds the city’s fuel: it can’t be knocked down',
    });
    expect(why(fueled, { type: 'bulldoze', target: { kind: 'civic', id: civic(fueled, PLANT).id } })).toMatch(
      /holds the city’s fuel/,
    );
    expect(civic(fueled, PLANT)).toBeDefined();
    // The silo: a build, a bomb, a launch.
    expect(bulldoze(at('bomb'), SILO)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/building the bomb/),
    });
    expect(bulldoze(at('ready'), SILO)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/holds an atom bomb/),
    });
    expect(bulldoze(at('preparing'), SILO)).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/preparing a launch/),
    });
    // The silo of a full tank and nothing else may go; the plant may not.
    expect(bulldoze(at('silo'), SILO)).toMatchObject({ ok: true });
    expect(bulldoze(at('silo'), PLANT)).toMatchObject({ ok: false });
    // Once the bomb has left, nothing is held.
    const gone = at('flying');
    expect(bulldoze(gone, PLANT)).toMatchObject({ ok: true });
    expect(bulldoze(gone, SILO)).toMatchObject({ ok: true });
  });

  describe('undo and redo', () => {
    /**
     * The base town with the given buildings of the race taken down and put up again by the player
     * (finished by the cheat), so that each is an edit to undo, the last of them the newest.
     */
    function putUpAgain(...defs: string[]): Sim {
      const sim = clone(base);
      const poses = defs.map((def) => {
        const c = civic(sim, def);
        return { def, x: c.x, z: c.z, angle: c.angle, side: c.side };
      });
      for (const def of defs) sim.removeCivic(civic(sim, def).id);
      for (const pose of poses) {
        const id = ok(sim, { type: 'placeBuilding', ...pose }).created![0]!;
        ok(sim, { type: 'cheat', cheat: 'finishStages', civic: id });
      }
      crews(sim);
      expect(sim.history.undo).toHaveLength(defs.length);
      return sim;
    }

    it('refuses to undo the placing of a silo that holds a build, a bomb or a launch, changing nothing', () => {
      for (const [stage, words] of [
        ['bomb', /building the bomb/],
        ['ready', /holds an atom bomb/],
        ['preparing', /preparing a launch/],
      ] as const) {
        const sim = putUpAgain(PLANT, SILO);
        ok(sim, { type: 'cheat', cheat: 'atom', stage, to: ids.rival });
        const was = JSON.stringify(sim.state.war!.atom);
        const treasury = sim.state.treasury;
        const silo = civic(sim, SILO).id;
        const r = sim.dispatch({ type: 'undo' });
        expect(r.ok, stage).toBe(false);
        if (!r.ok) expect(r.reason, stage).toMatch(words);
        // Nothing moved: the silo stands, the race and the money are as they were, and it is still the newest edit.
        expect(sim.state.civics.has(silo), stage).toBe(true);
        expect(JSON.stringify(sim.state.war!.atom), stage).toBe(was);
        expect(sim.state.treasury, stage).toBe(treasury);
        expect(sim.history.undo, stage).toHaveLength(2);
        expect(atomStage(sim), stage).toBe(stage);
        // The race can still be carried on from here: the bomb is not lost to a stray undo.
        expect(atomSummary(sim)!.have || !!atomSummary(sim)!.bomb).toBe(true);
      }
    });

    it('undoes the placing of a silo that holds nothing, and then the plant is the newest edit', () => {
      const sim = putUpAgain(PLANT, SILO);
      ok(sim, { type: 'cheat', cheat: 'atom', stage: 'silo' });
      const silo = civic(sim, SILO).id;
      ok(sim, { type: 'undo' });
      expect(sim.state.civics.has(silo)).toBe(false);
      expect(atomStage(sim)).toBe('enriching');
      // The plant holds the fuel, so the newest edit left is not one to undo.
      expect(why(sim, { type: 'undo' })).toMatch(/holds the city’s fuel/);
    });

    it('refuses to undo the placing of a plant that holds fuel, and undoes one that holds none', () => {
      const sim = putUpAgain(PLANT);
      ok(sim, { type: 'cheat', cheat: 'atom', stage: 'enriching' });
      const fuel = atomOf(sim).fuel;
      expect(fuel).toBeGreaterThan(0);
      const treasury = sim.state.treasury;
      const plant = civic(sim, PLANT).id;
      expect(why(sim, { type: 'undo' })).toMatch(
        /^Can't undo the .*: The enrichment plant holds the city’s fuel/,
      );
      expect(sim.state.civics.has(plant)).toBe(true);
      expect(atomOf(sim).fuel).toBe(fuel);
      expect(sim.state.treasury).toBe(treasury);
      // A plant that has made nothing yet comes away as any placement does (its fuel was never there to halve).
      const bare = putUpAgain(PLANT);
      const bareId = civic(bare, PLANT).id;
      ok(bare, { type: 'undo' });
      expect(bare.state.civics.has(bareId)).toBe(false);
      expect(bare.state.war!.atom).toBeUndefined();
    });

    it('refuses to redo the bulldozing of a plant that has made fuel since it was undone', () => {
      const sim = clone(base);
      const plant = civic(sim, PLANT).id;
      ok(sim, { type: 'bulldoze', target: { kind: 'civic', id: plant } });
      expect(sim.state.civics.has(plant)).toBe(false);
      ok(sim, { type: 'undo' });
      expect(sim.state.civics.has(plant)).toBe(true);
      ok(sim, { type: 'cheat', cheat: 'atom', stage: 'enriching' });
      const fuel = atomOf(sim).fuel;
      expect(why(sim, { type: 'redo' })).toMatch(/The enrichment plant holds the city’s fuel/);
      expect(sim.state.civics.has(plant)).toBe(true);
      expect(atomOf(sim).fuel).toBe(fuel);
      expect(sim.history.redo).toHaveLength(1);
    });
  });

  it('allows one bomb, ever: once fired, no more fuel, no second bomb, no second launch', () => {
    const sim = at('flying');
    const a = atomOf(sim);
    a.fuel = 500;
    hours(sim, 100);
    expect(a.fuel).toBe(500);
    expect(atomStage(sim)).toBe('flying');
    sim.advance(24 * H + 1);
    expect(atomStage(sim)).toBe('spent');
    for (const cmd of [
      { type: 'buildBomb' },
      launchTo(ids.rival),
      { type: 'cancelBomb' },
      { type: 'cancelLaunch' },
    ] as Command[])
      expect(why(sim, cmd), cmd.type).toBeTruthy();
    expect(why(sim, { type: 'buildBomb' })).toMatch(/used its atom bomb/);
    for (const def of [PLANT, SILO]) expect(atomLock(sim, def)).toMatch(/used its atom bomb/);
    // (Even with the fuel full and a silo to hold it.)
    a.fuel = ATOM.fuel.hours;
    expect(why(sim, { type: 'buildBomb' })).toMatch(/used its atom bomb/);
  });
});

describe('M40: the host alone launches in a shared city', () => {
  const rules: SharedRules = {
    host: 1,
    spendLimit: null,
    roles: true,
    perms: { 2: ['war', 'defence', 'money'], 3: ['defence'], 4: ['war'] },
  };

  it('turns a guest’s launch away in the room and in the sim, whatever roles the host gave', () => {
    const cmd = launchTo(ids.rival);
    expect(roomRefusal(rules, 2, cmd)).toBe('Only the host can launch the atom bomb');
    expect(roomRefusal(rules, 4, cmd)).toBe('Only the host can launch the atom bomb');
    expect(roomRefusal(rules, 3, cmd)).toBe('Only the host can launch the atom bomb');
    expect(roomRefusal(rules, 1, cmd)).toBeNull();
    expect(roomRefusal(null, 0, cmd)).toBeNull();
    const sim = at('ready');
    sim.shared = true;
    sim.rules = rules;
    expect(sim.dispatch(cmd, 2)).toMatchObject({
      ok: false,
      reason: 'Only the host can launch the atom bomb',
    });
    expect(sim.state.war!.atom!.prep).toBeUndefined();
    // The host's goes ahead.
    expect(sim.dispatch(cmd, 1).ok).toBe(true);
    expect(sim.state.war!.atom!.prep).toEqual({ done: 0, to: ids.rival });
  });

  it('leaves the bomb’s other commands to the roles: defence builds it, waging war calls a launch off', () => {
    const sim = at('silo');
    sim.shared = true;
    sim.rules = rules;
    expect(sim.dispatch({ type: 'buildBomb' }, 4)).toMatchObject({
      ok: false,
      reason: "The host hasn't let you spend on defence",
    });
    expect(sim.dispatch({ type: 'buildBomb' }, 3).ok).toBe(true);
    expect(sim.dispatch({ type: 'cancelBomb' }, 4)).toMatchObject({
      ok: false,
      reason: "The host hasn't let you spend on defence",
    });
    expect(sim.dispatch({ type: 'cancelBomb' }, 3).ok).toBe(true);
    // A launch the host prepared can be called off by whoever may wage war, not by those who may not.
    const ready = at('ready');
    ready.shared = true;
    ready.rules = rules;
    expect(ready.dispatch(launchTo(ids.rival), 1).ok).toBe(true);
    expect(ready.dispatch({ type: 'cancelLaunch' }, 3)).toMatchObject({
      ok: false,
      reason: "The host hasn't let you wage war",
    });
    expect(ready.dispatch({ type: 'cancelLaunch' }, 4).ok).toBe(true);
  });
});

describe('M40: the fair clock', () => {
  it('holds fuel, the bomb’s build and a preparation at the region’s cap, as it holds research, and they go on when it moves', () => {
    const phases: { stage: AtomStage; read: (sim: Sim) => number }[] = [
      { stage: 'enriching', read: (sim) => atomOf(sim).fuel },
      { stage: 'bomb', read: (sim) => atomOf(sim).bomb!.done },
      { stage: 'preparing', read: (sim) => atomOf(sim).prep!.done },
    ];
    const sim = at('silo');
    for (const { stage, read } of phases) {
      ok(sim, { type: 'cheat', cheat: 'atom', stage, to: ids.rival });
      crews(sim);
      const w = sim.state.war!;
      const start = read(sim);
      // The region has seen the city play to here: ten hours more are allowed.
      ok(sim, { type: 'warClock', cap: w.clock + 10 });
      sim.advance(3 * 24 * H);
      const held = read(sim);
      expect(held - start, `${stage} moved while allowed`).toBeGreaterThan(0);
      expect(held - start, `${stage} moved no further than ten hours’ work`).toBeLessThanOrEqual(
        10 * 1.25 + 1e-9,
      );
      // The city sits at the cap: a day more, and nothing has moved.
      sim.advance(24 * H);
      expect(read(sim), `${stage} held`).toBe(held);
      expect(sim.events.some((e) => e.kind === 'clockHeld')).toBe(true);
      // The cap moves on: the work goes on.
      ok(sim, { type: 'warClock', cap: null });
      sim.advance(6 * H);
      expect(read(sim), `${stage} went on`).toBeGreaterThan(held);
    }
  });
});

describe('M40: saving and loading in the middle of each step', () => {
  /** A city and its twin from a save: equal parts, and equal again after the same days. */
  function equalAfterLoad(sim: Sim, days: number, moved: (sim: Sim) => number) {
    const twin = clone(sim);
    expect(partHashes(twin)).toEqual(partHashes(sim));
    const before = moved(sim);
    sim.advance(days * M);
    twin.advance(days * M);
    expect(moved(sim), 'the step moved').not.toBe(before);
    expect(partHashes(twin)).toEqual(partHashes(sim));
  }

  it('mid-fuel', () => {
    const sim = at('enriching');
    sim.advance(5 * H);
    equalAfterLoad(sim, 2, (s) => atomOf(s).fuel);
  });

  it('mid-bomb', () => {
    const sim = at('silo');
    ok(sim, { type: 'buildBomb' });
    sim.advance(3 * 24 * H);
    expect(atomOf(sim).bomb!.paid).toBeGreaterThan(1);
    equalAfterLoad(sim, 2, (s) => atomOf(s).bomb!.done);
  });

  it('mid-preparation', () => {
    const sim = at('ready');
    ok(sim, launchTo(ids.rival));
    sim.advance(2 * 24 * H);
    equalAfterLoad(sim, 2, (s) => atomOf(s).prep!.done);
  });
});

describe('M40: the test cheat', () => {
  it('stands the race at each stage, its waits skipped, and the stage that follows is the one asked for', () => {
    for (const stage of [
      'plant',
      'enriching',
      'silo',
      'bomb',
      'ready',
      'preparing',
      'flying',
      'spent',
    ] as const) {
      const sim = at(stage);
      expect(atomStage(sim), stage).toBe(stage);
    }
    const a = (stage: AtomStage) => atomOf(at(stage));
    expect(a('plant').fuel).toBe(0);
    expect(a('enriching').fuel).toBe(ATOM.fuel.hours / 2);
    expect(a('silo').fuel).toBe(ATOM.fuel.hours);
    expect(a('bomb').bomb).toEqual({ done: ATOM.bomb.hours / 2, paid: 7 });
    expect(a('ready').have).toBe(true);
    expect(a('preparing')).toMatchObject({
      have: true,
      prep: { done: ATOM.launch.prepHours / 2, to: ids.rival },
    });
    expect(a('flying').fired).toMatchObject({ to: ids.rival });
    expect(a('flying').have).toBeUndefined();
    // A step back forgets the steps after it.
    const sim = at('preparing');
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'enriching' });
    expect(atomOf(sim)).toMatchObject({ fuel: ATOM.fuel.hours / 2 });
    expect(atomOf(sim).have).toBeUndefined();
    expect(atomOf(sim).prep).toBeUndefined();
  });

  it('finishes the buildings it needs, completes the research from the plant stage on, and leaves the rules, war and money alone', () => {
    const sim = clone(base);
    sim.state.war!.research!.done = [];
    sim.state.war!.research!.queue = [];
    civic(sim, PLANT).build = { stage: 1, months: 1, waiting: false };
    civic(sim, SILO).build = { stage: 1, months: 1, waiting: false };
    const money = sim.state.treasury;
    // Stage `none` forgets the race and leaves the research gate as it was.
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'none' });
    expect(allTiersDone(sim)).toBe(false);
    expect(sim.state.war!.atom).toBeUndefined();
    // The plant stage is past the gate: every tier is done, the plant is left going up.
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'plant' });
    expect(allTiersDone(sim)).toBe(true);
    expect(civic(sim, PLANT).build).toBeDefined();
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'enriching' });
    expect(civic(sim, PLANT).build).toBeUndefined();
    expect(civic(sim, SILO).build).toBeDefined();
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'bomb' });
    expect(civic(sim, SILO).build).toBeUndefined();
    expect(sim.state.treasury).toBe(money);
    expect(sim.state.region.rules).toBeUndefined();
  });

  it('refuses in plain words, changing nothing', () => {
    const refused = (sim: Sim, stage: AtomStage, to?: number) =>
      why(sim, { type: 'cheat', cheat: 'atom', stage, ...(to !== undefined ? { to } : {}) });
    const none = clone(base);
    none.state.war!.research!.done = [];
    const doneBefore = JSON.stringify(none.state.war!.research);
    for (const c of [...none.state.civics.values()])
      if (c.def === PLANT || c.def === SILO) none.removeCivic(c.id);
    expect(refused(none, 'plant')).toBe('Place the enrichment plant first');
    expect(refused(none, 'enriching')).toBe('Place the enrichment plant first');
    expect(JSON.stringify(none.state.war!.research), 'a refusal does not skip the research gate').toBe(
      doneBefore,
    );
    expect(none.state.war!.atom).toBeUndefined();
    // A silo is needed from the silo stage on; an unknown neighbour can't be aimed at.
    const noSilo = clone(base);
    noSilo.removeCivic(civic(noSilo, SILO).id);
    expect(refused(noSilo, 'plant')).toBeNull();
    expect(refused(noSilo, 'bomb')).toBe('Place the atom silo first');
    expect(refused(clone(base), 'preparing', 99_999)).toBe('No neighbour to aim at');
    // Test mode only; and not in a city at peace.
    const live = clone(base);
    live.testMode = false;
    expect(refused(live, 'ready')).toBe('Test mode only');
    const peace = clone(base);
    delete peace.state.war;
    expect(refused(peace, 'ready')).toBe('War is off in this city');
    // A dry run changes nothing.
    const dry = clone(base);
    expect(dry.preview({ type: 'cheat', cheat: 'atom', stage: 'ready' }).ok).toBe(true);
    expect(dry.state.war!.atom).toBeUndefined();
  });
});

describe('M40: the commands, wherever the lockstep tests list them', () => {
  const KINDS = ['buildBomb', 'cancelBomb', 'launchBomb', 'cancelLaunch'] as const;

  it('are in the command list, checked for another player’s hand, and none is page-only', () => {
    for (const k of KINDS) {
      expect(COMMAND_TYPES, k).toContain(k);
      expect(PAGE_ONLY.has(k), k).toBe(false);
    }
    expect(checkCommand({ type: 'launchBomb', to: 2 })).toEqual({ cmd: { type: 'launchBomb', to: 2 } });
    // Nothing unknown rides along.
    expect(checkCommand({ type: 'buildBomb', extra: 'x', to: 3 })).toEqual({ cmd: { type: 'buildBomb' } });
    expect(checkCommand({ type: 'cancelLaunch', junk: [] })).toEqual({ cmd: { type: 'cancelLaunch' } });
    for (const bad of [undefined, null, 'x', -1, 1.5, 1e10, [], {}, true, '__proto__'])
      expect(checkCommand({ type: 'launchBomb', to: bad }), String(bad)).toHaveProperty('problem');
  });

  it('are needs of the roles: defence for the build, war for the launch (the host’s), nothing for a lone player', () => {
    const rules: SharedRules = { host: 1, spendLimit: null, roles: true, perms: { 2: ['money'] } };
    for (const k of ['buildBomb', 'cancelBomb'] as const)
      expect(roomRefusal(rules, 2, { type: k }), k).toBe("The host hasn't let you spend on defence");
    expect(roomRefusal(rules, 2, { type: 'cancelLaunch' })).toBe("The host hasn't let you wage war");
    for (const k of KINDS)
      expect(
        roomRefusal(rules, 1, k === 'launchBomb' ? launchTo(1) : ({ type: k } as Command)),
        k,
      ).toBeNull();
  });
});

describe('M40: the bill shared with the units', () => {
  it('is the unit’s materials code: a unit’s bill is its price and the materials’ bill, as before', () => {
    const sim = clone(base);
    sim.state.war!.stock = { goods: 10, ore: 20, oil: 5, munitions: 3 };
    for (const kind of ['infantry', 'tank', 'windupbot'] as const) {
      const def = UNIT.get(kind)!;
      expect(unitBill(sim, kind), kind).toEqual({ money: def.cost, ...materialBill(sim, def) });
    }
    const bill = materialBill(sim, { goods: 25, ore: 20, oil: 40 });
    expect(bill.take).toEqual({ goods: 10, ore: 20, oil: 5, munitions: 0 });
    expect(bill.short).toEqual({ goods: 15, ore: 0, oil: 35, munitions: 0 });
    expect(bill.imports).toBe(15 * WAR.materials.importPrice.goods + 35 * WAR.materials.importPrice.oil);
  });
});
