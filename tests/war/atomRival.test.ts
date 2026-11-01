import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ATOM, RIVAL_BOMB, atomEventText, atomStageNo, raceSlowWhy } from '../../src/data/atom';
import { DOME, TIER_KEYS } from '../../src/data/research';
import { WAR_DIFFICULTY } from '../../src/data/warEconomy';
import type { Command } from '../../src/sim/commands';
import { checkInvariants } from '../../src/sim/invariants';
import type { Sim } from '../../src/sim/sim';
import { atomHour, atomInbound, atomOf, atomSummary } from '../../src/sim/systems/atom';
import {
  rivalAhead,
  rivalBombDue,
  rivalBombHour,
  rivalBombMonth,
  rivalDesperate,
  rivalRaces,
  setBackRival,
} from '../../src/sim/systems/atomRival';
import { fightingWith, isPariah, reputationOf, warWith } from '../../src/sim/systems/diplomacy';
import { agentsFree } from '../../src/sim/systems/intel';
import { bombStopped } from '../../src/sim/systems/supers';
import { warDifficulty } from '../../src/sim/systems/warEconomy';
import { TICKS_PER_HOUR, TICKS_PER_MONTH, TICKS_PER_YEAR } from '../../src/sim/time';
import { BState } from '../../src/sim/world/buildings';
import { newSim } from '../helpers';
import { clone, rivals, treaty } from './economyHelpers';
import { labTown, ok } from './researchTown';

/**
 * M40, step 7, a computer neighbour's race (docs/plans/M40-design.md, call 19; the plan's tests 3 and
 * 9, sim half): Hard only, after game year 20, on dice of its own; stages on the war clock that the
 * city's spies and forces put back; a finished bomb that waits for a war it is losing badly, a launch
 * prepared in the open that the dome can stop, and the neighbours' feeling for the one that fires.
 */

vi.setConfig({ testTimeout: 120_000 });

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;
const Y20 = RIVAL_BOMB.years * TICKS_PER_YEAR;
const PLANT = 'enrichment';
const SILO = 'atomsilo';

const civic = (sim: Sim, def: string) => [...sim.state.civics.values()].find((c) => c.def === def)!;
const events = (sim: Sim, kind: string) => sim.events.filter((e) => e.kind === kind);
const diplomacyNotes = (sim: Sim, what: string) =>
  events(sim, 'diplomacy').filter((e) => e.info?.what === what);
const atomLines = (sim: Sim) => sim.state.chronicle.events.filter((e) => e.kind === 'atom');
const clock = (sim: Sim) => sim.state.war!.clock;

/** A computer neighbour, big enough and advanced enough to race, with a fixed character. */
function eligible(sim: Sim, k = 0) {
  const n = rivals(sim)[k]!;
  n.population = 50_000;
  n.rival!.tech = 4;
  n.rival!.personality = 'aggressive';
  return n;
}

/** The rivals' hour on the war clock, `n` times (the war clock is moved by hand: no town to run). */
function hours(sim: Sim, n: number): void {
  for (let k = 0; k < n; k++) {
    sim.state.war!.clock++;
    rivalBombHour(sim);
  }
}

/** Runs `fn` with the start's chance and the city's age bar set for the test, and puts them back. */
function sure<T>(fn: () => T, opts: { chance?: number; years?: number } = {}): T {
  const bars = { chance: RIVAL_BOMB.chance, years: RIVAL_BOMB.years };
  Object.assign(RIVAL_BOMB, { chance: opts.chance ?? 1, years: opts.years ?? bars.years });
  try {
    return fn();
  } finally {
    Object.assign(RIVAL_BOMB, bars);
  }
}

/** A cheap war city (no town) at a difficulty, old enough to race, with an eligible rival. */
function plainCity(difficulty: 'easy' | 'normal' | 'hard', age = Y20): Sim {
  const sim = newSim({ rivals: true, disasters: false, difficulty });
  for (const n of rivals(sim)) n.rival!.allies = [];
  eligible(sim);
  sim.state.tick = age;
  return sim;
}

describe('M40 rivals: the lever', () => {
  it('Hard has it; Easy and Normal have no such key at all, so Normal is the war it was', () => {
    expect(WAR_DIFFICULTY.hard.bomb).toBe(true);
    expect('bomb' in WAR_DIFFICULTY.easy).toBe(false);
    expect('bomb' in WAR_DIFFICULTY.normal).toBe(false);
    expect(warDifficulty(plainCity('hard')).bomb).toBe(true);
    expect(warDifficulty(plainCity('normal')).bomb).toBeUndefined();
    expect(warDifficulty(plainCity('easy')).bomb).toBeUndefined();
  });

  it('Easy and Normal leave no trace over 240 game months, however sure the chance and ready the rival', () => {
    for (const difficulty of ['easy', 'normal'] as const) {
      const sim = plainCity(difficulty);
      const control = clone(sim);
      sure(() => {
        for (let m = 0; m < 240; m++) {
          sim.state.tick = Y20 + m * M;
          rivalBombMonth(sim);
          if (m % 6 === 0) hours(sim, 24);
        }
      });
      // (The war clock moved with the hours, so give the control the same.)
      control.state.tick = sim.state.tick;
      control.state.war!.clock = clock(sim);
      expect(
        rivals(sim).some((n) => n.rival!.bomb),
        difficulty,
      ).toBe(false);
      expect(events(sim, 'rivalBomb'), difficulty).toHaveLength(0);
      expect(atomLines(sim)).toHaveLength(0);
      expect(sim.hash(), difficulty).toBe(control.hash());
    }
  });

  it('Hard never starts before game year 20, and does start after it', () => {
    const sim = plainCity('hard', 0);
    // Every month of the first twenty years, however sure the chance.
    sure(
      () => {
        for (let m = 0; m < 240; m++) {
          sim.state.tick = m * M;
          rivalBombMonth(sim);
        }
      },
      { years: 20 },
    );
    expect(rivals(sim).some((n) => n.rival!.bomb)).toBe(false);
    // Then, on the natural chance (1.5 % a month times its character), a start comes in time.
    let began = -1;
    for (let m = 0; m < 600 && began < 0; m++) {
      sim.state.tick = Y20 + m * M;
      rivalBombMonth(sim);
      if (rivals(sim).some((n) => n.rival!.bomb)) began = m;
    }
    expect(began, 'a start within fifty game years of year 20').toBeGreaterThanOrEqual(0);
    const n = rivals(sim)[0]!;
    expect(n.rival!.bomb).toEqual({ stage: 'enriching', at: clock(sim), delay: 0 });
  });
});

describe('M40 rivals: who may start', () => {
  it('needs the rules, a city of its own age, tech 4, 40,000 residents, no scenario and no vassal', () => {
    const starts = (prepare: (sim: Sim) => void): boolean => {
      const sim = plainCity('hard');
      prepare(sim);
      sure(() => rivalBombMonth(sim));
      return rivals(sim).some((n) => n.rival!.bomb);
    };
    expect(
      starts(() => undefined),
      'the control',
    ).toBe(true);
    expect(starts((s) => void (rivals(s)[0]!.rival!.tech = 3))).toBe(false);
    expect(starts((s) => void (rivals(s)[0]!.population = RIVAL_BOMB.population - 1))).toBe(false);
    expect(starts((s) => void (rivals(s)[0]!.rival!.vassal = { since: 0 }))).toBe(false);
    expect(
      starts((s) => void (s.state.tick = Y20 - 1)),
      'a day short of twenty years',
    ).toBe(false);
    // A region whose rules do not turn the bomb on, or a scenario's city.
    expect(starts((s) => void (s.state.region.rules = { war: true, scale: 'total', supers: true }))).toBe(
      false,
    );
    expect(
      starts((s) => void (s.state.region.rules = { war: true, scale: 'total', supers: true, bomb: true })),
    ).toBe(true);
    expect(starts((s) => void (s.state.scenario = { id: 'holdline' } as never))).toBe(false);
    // And not at all without war.
    expect(starts((s) => void delete s.state.war)).toBe(false);
  });

  it('one at a time, in id order; the next may begin once the first has used its bomb', () => {
    const sim = plainCity('hard');
    eligible(sim, 1);
    eligible(sim, 2);
    sure(() => {
      rivalBombMonth(sim);
      expect(rivals(sim).map((n) => n.rival!.bomb?.stage)).toEqual(['enriching', undefined, undefined]);
      sim.state.tick += M;
      rivalBombMonth(sim);
      expect(rivals(sim).map((n) => n.rival!.bomb?.stage)).toEqual(['enriching', undefined, undefined]);
      // The first goes on, and fires: the second may begin.
      rivals(sim)[0]!.rival!.bomb!.stage = 'spent';
      sim.state.tick += M;
      rivalBombMonth(sim);
      expect(rivals(sim).map((n) => n.rival!.bomb?.stage)).toEqual(['spent', 'enriching', undefined]);
    });
  });

  it('rolls on dice of its own: no random stream of the sim moves', () => {
    const sim = plainCity('hard');
    const streams = () => Object.values(sim.rng).map((r) => r.getState());
    const before = streams();
    sure(
      () => {
        for (let m = 0; m < 300; m++) {
          sim.state.tick = Y20 + m * M;
          rivalBombMonth(sim);
          hours(sim, 24);
        }
      },
      { chance: 0.05 },
    );
    expect(rivals(sim)[0]!.rival!.bomb, 'a race ran').toBeDefined();
    expect(streams()).toEqual(before);
  });
});

describe('M40 rivals: the stages', () => {
  it('fuel 1,500, the silo 500, the bomb 800 war hours: each told as an event, a notice and a chronicle line', () => {
    const sim = plainCity('hard');
    const n = rivals(sim)[0]!;
    sure(() => rivalBombMonth(sim));
    const begun = clock(sim);
    expect(n.rival!.bomb).toEqual({ stage: 'enriching', at: begun, delay: 0 });
    expect(rivalBombDue(n)).toBe(begun + 1_500);
    const told = events(sim, 'rivalBomb');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      id: n.id,
      info: {
        name: n.name,
        stage: atomStageNo('enriching'),
        text: `${n.name} has begun enriching fuel for an atom bomb.`,
      },
    });
    expect(atomLines(sim).map((e) => atomEventText(e.ref))).toEqual([
      `${n.name} began enriching fuel for an atom bomb`,
    ]);
    hours(sim, 1_499);
    expect(n.rival!.bomb!.stage).toBe('enriching');
    hours(sim, 1);
    expect(n.rival!.bomb).toEqual({ stage: 'silo', at: begun + 1_500, delay: 0 });
    hours(sim, 499);
    expect(n.rival!.bomb!.stage).toBe('silo');
    hours(sim, 1);
    expect(n.rival!.bomb!.stage).toBe('bomb');
    hours(sim, 799);
    expect(n.rival!.bomb!.stage).toBe('bomb');
    hours(sim, 1);
    expect(n.rival!.bomb).toEqual({ stage: 'ready', at: begun + 2_800, delay: 0 });
    expect(events(sim, 'rivalBomb').map((e) => [e.info!.stage, e.info!.text])).toEqual([
      [2, `${n.name} has begun enriching fuel for an atom bomb.`],
      [3, `${n.name} has begun building an atom silo.`],
      [4, `${n.name} is building the atom bomb.`],
      [5, `${n.name} has the atom bomb.`],
    ]);
    expect(atomLines(sim).map((e) => atomEventText(e.ref))).toEqual([
      `${n.name} began enriching fuel for an atom bomb`,
      `${n.name} began building an atom silo`,
      `${n.name} began building an atom bomb`,
      `${n.name} finished an atom bomb`,
    ]);
    // A bomb waits for its war for as long as it likes, and has no date.
    hours(sim, 5_000);
    expect(n.rival!.bomb!.stage).toBe('ready');
    expect(rivalBombDue(n)).toBeNull();
    expect(events(sim, 'rivalBomb')).toHaveLength(4);
    expect(rivalAhead(sim)).toBe(true);
  });

  it('in a region the room keeps the record: events and notices, but no line in the city’s chronicle', () => {
    const sim = plainCity('hard');
    sim.state.region.rules = { war: true, scale: 'total', supers: true, bomb: true };
    sure(() => rivalBombMonth(sim));
    hours(sim, 1_500);
    expect(events(sim, 'rivalBomb')).toHaveLength(2);
    expect(atomLines(sim)).toHaveLength(0);
  });

  it('holds while the rules turn the bomb off: the hours it cannot work are not served', () => {
    const sim = plainCity('hard');
    const n = rivals(sim)[0]!;
    sure(() => rivalBombMonth(sim));
    hours(sim, 1_000);
    const keep = { ...n.rival!.bomb! };
    const due = rivalBombDue(n)!;
    sim.state.region.rules = { war: true, scale: 'total', supers: true };
    hours(sim, 2_000);
    expect(n.rival!.bomb, 'rules off: held, an hour at a time').toEqual({ ...keep, delay: 2_000 });
    expect(rivalBombDue(n)).toBe(due + 2_000);
    sim.state.region.rules = { war: true, scale: 'total', supers: true, bomb: true };
    // What was left when it stopped is what is left now: 500 hours of fuel, not "long overdue".
    hours(sim, 499);
    expect(n.rival!.bomb!.stage).toBe('enriching');
    hours(sim, 1);
    expect(n.rival!.bomb!.stage).toBe('silo');
  });

  it('a conquered town’s race is over: it counts for nothing at once and is cleared with the next hour', () => {
    const sim = plainCity('hard');
    const [a, b] = [rivals(sim)[0]!, rivals(sim)[1]!];
    eligible(sim, 1);
    sure(() => rivalBombMonth(sim));
    hours(sim, 1_600);
    expect(a.rival!.bomb!.stage).toBe('silo');
    expect(raceSlowWhy(a)).toBeNull();
    expect(rivalRaces(sim)).toHaveLength(1);
    a.rival!.vassal = { since: sim.state.tick };
    // At once: not listed, not a target, not a reason for the others to wait.
    expect(rivalRaces(sim)).toEqual([]);
    expect(raceSlowWhy(a)).toBe(`${a.name} isn’t racing for the atom bomb`);
    expect(setBackRival(sim, a, 120)).toBe(0);
    expect(a.rival!.bomb!.delay).toBe(0);
    sure(() => rivalBombMonth(sim));
    expect(b.rival!.bomb?.stage, 'another neighbour may begin').toBe('enriching');
    // The next war hour ends it, once, and tells the city.
    hours(sim, 1);
    expect(a.rival!.bomb).toBeUndefined();
    expect(diplomacyNotes(sim, 'rivalFallen')).toMatchObject([
      { id: a.id, info: { text: `${a.name}’s race for the atom bomb ends with its fall`, tone: 'good' } },
    ]);
    hours(sim, 100);
    expect(diplomacyNotes(sim, 'rivalFallen')).toHaveLength(1);
    // Freed again, it has no race to go on with.
    delete a.rival!.vassal;
    hours(sim, 2_000);
    expect(a.rival!.bomb).toBeUndefined();
    expect(() => checkInvariants(sim)).not.toThrow();
  });

  it('a conquered town’s finished bomb is gone with it, and one it has used stays on record', () => {
    const sim = plainCity('hard');
    const n = rivals(sim)[0]!;
    n.rival!.bomb = { stage: 'ready', at: 0, delay: 0 };
    expect(rivalAhead(sim)).toBe(true);
    n.rival!.vassal = { since: 0 };
    expect(rivalAhead(sim), 'a fallen town’s bomb is not ahead of the city').toBe(false);
    hours(sim, 1);
    expect(n.rival!.bomb).toBeUndefined();
    n.rival!.bomb = { stage: 'spent', at: 0, delay: 0 };
    hours(sim, 10);
    expect(n.rival!.bomb).toMatchObject({ stage: 'spent' });
    expect(rivalAhead(sim), 'it did use the bomb first').toBe(true);
    expect(raceSlowWhy(n)).toBe(`${n.name} has used its atom bomb`);
  });

  it('a blackout holds it an hour at a time, and the clock the region holds holds it', () => {
    const sim = plainCity('hard');
    const n = rivals(sim)[0]!;
    sure(() => rivalBombMonth(sim));
    const due = rivalBombDue(n)!;
    n.rival!.blackout = { from: clock(sim), until: clock(sim) + 100 };
    hours(sim, 100);
    expect(n.rival!.bomb!.delay).toBe(99);
    expect(rivalBombDue(n)).toBe(due + 99);
    // A bomb waiting for its war has no date to put back.
    n.rival!.bomb = { stage: 'ready', at: 0, delay: 0 };
    n.rival!.blackout = { from: clock(sim), until: clock(sim) + 100 };
    hours(sim, 50);
    expect(n.rival!.bomb).toEqual({ stage: 'ready', at: 0, delay: 0 });
  });
});

// The town: a war city at Hard with every tier researched, a spy agency, a dome and a plant and silo,
// a total war open with the first rival.
let base: Sim;
let foe: number;
let other: number;

beforeAll(() => {
  const { sim, place } = labTown(1, { length: 800, streets: 7 });
  sim.state.options.difficulty = 'hard';
  place('nuclear');
  sim.advance(M);
  ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
  ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
  place('spyagency');
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place('domeshield') });
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place(PLANT) });
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place(SILO) });
  const [first, second] = rivals(sim);
  for (const n of rivals(sim)) n.rival!.allies = [];
  ok(sim, { type: 'declareWar', neighbour: first!.id, scale: 'total', reason: 'The race' });
  const war = warWith(sim, first!.id)!;
  sim.advance(Math.max(0, war.opens - sim.state.tick) + 1);
  sim.advance(M);
  expect(fightingWith(sim, first!.id)?.scale).toBe('total');
  foe = first!.id;
  other = second!.id;
  base = sim;
}, 300_000);

/** A copy of the town with the first rival's bomb ready, and the war going as the test wants. */
function readyTown(score = 0): Sim {
  const sim = clone(base);
  ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: foe, stage: 'ready' });
  warWith(sim, foe)!.score = score;
  return sim;
}

const rival = (sim: Sim) => rivals(sim).find((n) => n.id === foe)!;
const stage = (sim: Sim) => rival(sim).rival!.bomb?.stage;

/** The dome at full strength, crewed and powered, in its usual mode. */
function domeUp(sim: Sim): void {
  const c = civic(sim, 'domeshield');
  c.staff = 1;
  c.powered = 1;
  const d = sim.state.war!.supers!.dome ?? (sim.state.war!.supers!.dome = { hours: 0, mode: 'all' });
  d.hours = DOME.chargeHours;
  d.mode = 'all';
  delete d.down;
  delete d.reserve;
  delete d.raised;
}

describe('M40 rivals: spies and forces put the race back', () => {
  it('a sabotage that gets through adds 120 war hours to its stage, and so to its date', () => {
    const sim = clone(base);
    expect(agentsFree(sim), 'the agency is crewed').toBeGreaterThan(0);
    ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: other, stage: 'enriching' });
    const n = rivals(sim).find((x) => x.id === other)!;
    const due = rivalBombDue(n)!;
    expect(due).toBe(clock(sim) + 1_500);
    // Agents are sent until one gets through (each mission has dice of its own).
    const w = sim.state.war!;
    let landed = false;
    for (let k = 0; k < 40 && !landed; k++) {
      for (let t = 0; t < 4 * 24 && agentsFree(sim) <= 0; t++) sim.advance(H);
      const id = ok(sim, { type: 'spyMission', neighbour: other, op: 'sabotage', target: 'plant' })
        .created![0]!;
      const m = () => w.intel!.missions.find((x) => x.id === id);
      const arrive = m()!.arrive;
      while (w.clock < arrive) sim.advance(H);
      landed = m()?.outcome === 'success';
      for (let t = 0; t < 30 && m(); t++) sim.advance(H);
    }
    expect(landed, 'a sabotage got through in 40').toBe(true);
    expect(n.rival!.bomb!.delay).toBe(ATOM.spy.setBack);
    expect(rivalBombDue(n)).toBe(due + 120);
    expect(
      w.intel!.results.find((r) => r.text.endsWith('atom bomb works: its race is put back 5 days')),
    ).toMatchObject({ with: other, tone: 'good' });
  });

  it('a won expedition adds 240; a lost one adds nothing; a bomb waiting for its war has nothing to slow', () => {
    const sim = clone(base);
    ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: other, stage: 'bomb' });
    const n = rivals(sim).find((x) => x.id === other)!;
    const due = rivalBombDue(n)!;
    let next = 900;
    const fight = (outcome: 'raided' | 'repelled' | 'withdrew'): void => {
      const id = next++;
      const w = sim.state.war!;
      w.expeditions = [
        ...(w.expeditions ?? []),
        {
          id,
          units: [],
          to: other,
          name: n.name,
          route: 'highway',
          target: 'military',
          stance: 'bold',
          depart: sim.state.tick,
          arrive: sim.state.tick,
          home: sim.state.tick,
          state: 'fighting',
        },
      ];
      ok(sim, {
        type: 'battleReport',
        expedition: id,
        result: {
          outcome,
          units: [],
          theirLost: 0,
          theirStrength: 6,
          defencesLost: 0,
          destroyed: 0,
          damaged: 0,
          objectives: { aimed: 2, down: outcome === 'raided' ? 1 : 0 },
          hash: 'x',
        },
      });
    };
    fight('repelled');
    fight('withdrew');
    expect(rivalBombDue(n)).toBe(due);
    fight('raided');
    expect(rivalBombDue(n)).toBe(due + ATOM.spy.expedition);
    expect(ATOM.spy.expedition).toBe(240);
    expect(sim.state.war!.intel!.results.at(-1)).toMatchObject({
      text: `The raid put ${n.name}’s atom bomb race back 10 days`,
      tone: 'good',
    });
    // Without a race there is nothing to put back, and no line in the log.
    const quiet = clone(base);
    const q = rivals(quiet).find((x) => x.id === other)!;
    const before = JSON.stringify(q.rival);
    expect(setBackRival(quiet, q, 240)).toBe(0);
    expect(JSON.stringify(q.rival)).toBe(before);
    // A bomb that is ready has nothing to slow.
    ok(quiet, { type: 'cheat', cheat: 'rivalBomb', neighbour: other, stage: 'ready' });
    expect(setBackRival(quiet, q, 240)).toBe(0);
    expect(q.rival!.bomb!.delay).toBe(0);
  });

  it('a launch being prepared starts again', () => {
    const sim = readyTown(60);
    hours(sim, 1);
    expect(stage(sim)).toBe('preparing');
    hours(sim, 100);
    const n = rival(sim);
    expect(setBackRival(sim, n, 120)).toBe(100);
    expect(n.rival!.bomb).toEqual({ stage: 'preparing', at: clock(sim), delay: 0 });
    expect(rivalBombDue(n)).toBe(clock(sim) + RIVAL_BOMB.prep);
  });
});

describe('M40 rivals: the launch', () => {
  it('waits for a total war it is losing badly: no war, a smaller war, a ceasefire or a better score keep it ready', () => {
    const idle = (prepare: (s: Sim) => void, score = 50): void => {
      const sim = readyTown(score);
      prepare(sim);
      hours(sim, 400);
      expect(stage(sim)).toBe('ready');
      expect(events(sim, 'diplomacy').filter((e) => e.info?.what === 'rivalDesperate')).toHaveLength(0);
    };
    // Losing, but not badly enough yet.
    idle(() => undefined, RIVAL_BOMB.desperate - 0.1);
    // Winning.
    idle(() => undefined, -50);
    // A war that is not a total war.
    idle((s) => void (warWith(s, foe)!.scale = 'war'));
    // A ceasefire pauses the war.
    idle((s) => treaty(s, foe, [{ k: 'ceasefire', hours: 720 }]));
    // No war with it at all: the other rival's bomb, with the war on the first.
    const sim = clone(base);
    ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: other, stage: 'ready' });
    warWith(sim, foe)!.score = 90;
    hours(sim, 400);
    expect(rivals(sim).find((n) => n.id === other)!.rival!.bomb!.stage).toBe('ready');
    expect(
      rivalDesperate(
        sim,
        rivals(sim).find((n) => n.id === other)!,
      ),
    ).toBe(false);
  });

  it('prepares for ten game days when desperate, and the city is told in plain words, once', () => {
    const sim = readyTown(RIVAL_BOMB.desperate);
    const n = rival(sim);
    expect(rivalDesperate(sim, n)).toBe(true);
    hours(sim, 1);
    expect(stage(sim)).toBe('preparing');
    const told = diplomacyNotes(sim, 'rivalDesperate');
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({
      id: n.id,
      info: { text: `${n.name} is desperate and has the bomb. Offer peace.`, tone: 'bad' },
    });
    expect(RIVAL_BOMB.prep).toBe(240);
    expect(rivalRaces(sim)).toEqual([
      { id: n.id, name: n.name, stage: atomStageNo('preparing'), launchIn: 240 },
    ]);
    hours(sim, 100);
    expect(atomSummary(sim)!.rivals[0]).toMatchObject({ stage: 6, launchIn: 140 });
    expect(diplomacyNotes(sim, 'rivalDesperate'), 'told once, not every hour').toHaveLength(1);
    expect(atomOf(sim).inbound).toBeUndefined();
    hours(sim, 139);
    expect(stage(sim)).toBe('preparing');
    expect(atomOf(sim).inbound).toBeUndefined();
  });

  it('peace calls it off: a ceasefire, a war turned round, and then the preparation starts from nothing', () => {
    const sim = readyTown(60);
    hours(sim, 150);
    expect(stage(sim)).toBe('preparing');
    // The war turns round.
    warWith(sim, foe)!.score = 10;
    hours(sim, 1);
    expect(stage(sim)).toBe('ready');
    expect(diplomacyNotes(sim, 'rivalStandDown')).toHaveLength(1);
    // Losing again: ten days from now, not from before.
    warWith(sim, foe)!.score = 60;
    hours(sim, 1);
    expect(stage(sim)).toBe('preparing');
    expect(rivalBombDue(rival(sim))).toBe(clock(sim) + 240);
    hours(sim, 100);
    // A ceasefire (the peace the card asked for).
    treaty(sim, foe, [{ k: 'ceasefire', hours: 720 }]);
    hours(sim, 1);
    expect(stage(sim)).toBe('ready');
    hours(sim, 1_000);
    expect(stage(sim), 'a ceasefire keeps the bomb at home').toBe('ready');
    expect(atomOf(sim).inbound).toBeUndefined();
    expect(diplomacyNotes(sim, 'rivalDesperate')).toHaveLength(2);
  });

  it('a launch being prepared is held while the rules are off, and the rest of it is owed on resume', () => {
    const sim = readyTown(60);
    hours(sim, 1);
    expect(stage(sim)).toBe('preparing');
    hours(sim, 100);
    const n = rival(sim);
    const start = n.rival!.bomb!.at;
    expect(sim.state.region.rules).toBeUndefined();
    sim.state.region.rules = { war: true, scale: 'total', supers: true };
    hours(sim, 600);
    expect(stage(sim)).toBe('preparing');
    expect(n.rival!.bomb).toMatchObject({ at: start, delay: 600 });
    expect(atomOf(sim).inbound).toBeUndefined();
    delete sim.state.region.rules;
    // 140 hours of the ten days were still to come: it does not leave in the first hour back.
    hours(sim, 139);
    expect(stage(sim)).toBe('preparing');
    expect(atomOf(sim).inbound).toBeUndefined();
    expect(diplomacyNotes(sim, 'rivalDesperate'), 'told at the start, not again').toHaveLength(1);
    hours(sim, 1);
    expect(stage(sim)).toBe('spent');
    expect(atomOf(sim).inbound).toMatchObject({ from: n.id });
  });

  it('a launch put back counts what was served, not the hours it was held', () => {
    const sim = readyTown(60);
    hours(sim, 1);
    hours(sim, 100);
    const n = rival(sim);
    n.rival!.blackout = { from: clock(sim), until: clock(sim) + 51 };
    hours(sim, 50);
    expect(n.rival!.bomb!.delay).toBe(50);
    expect(setBackRival(sim, n, 120), '100 served, 50 held').toBe(100);
    expect(n.rival!.bomb).toMatchObject({ at: clock(sim), delay: 0 });
  });

  it('fires once, at the city, a game day out: the siren, one bomb in the air at a time', () => {
    const sim = readyTown(60);
    hours(sim, 1);
    expect(stage(sim)).toBe('preparing');
    hours(sim, 239);
    expect(stage(sim)).toBe('preparing');
    hours(sim, 1);
    const n = rival(sim);
    expect(stage(sim)).toBe('spent');
    const a = atomOf(sim);
    expect(a.inbound).toMatchObject({ from: n.id, name: n.name });
    expect(a.inbound!.arrive - a.inbound!.warn).toBeGreaterThanOrEqual(ATOM.flight.hours * H);
    // The warning is the city's own, on the next tick.
    sim.step();
    expect(events(sim, 'bombWarning')).toHaveLength(1);
    expect(events(sim, 'bombWarning')[0]).toMatchObject({ id: n.id, info: { from: n.name } });
    // Once only.
    hours(sim, 5_000);
    expect(stage(sim)).toBe('spent');
    expect(atomOf(sim).inbound).toBe(a.inbound);
    expect(rivalBombDue(n)).toBeNull();
    // It did not make the city a pariah, and the city's word is as it was.
    expect(isPariah(sim)).toBe(false);
    expect(reputationOf(sim)).toBe(reputationOf(base));

    // Another bomb already on its way: it waits, an hour at a time, and goes when the air is clear.
    const busy = readyTown(60);
    hours(busy, 1);
    expect(atomInbound(busy, { id: other, name: 'Elsewhere' }, 24)).toBeNull();
    hours(busy, 400);
    expect(stage(busy)).toBe('preparing');
    delete atomOf(busy).inbound;
    hours(busy, 1);
    expect(stage(busy)).toBe('spent');
    expect(atomOf(busy).inbound!.from).toBe(foe);
  });

  it('the dome stops it as any bomb: the city is as it was, and the dome is down for a long while', () => {
    const sim = readyTown(60);
    domeUp(sim);
    hours(sim, 241);
    expect(stage(sim)).toBe('spent');
    expect(bombStopped(sim)).toBe(true);
    const rubble = () => [...sim.state.buildings.values()].filter((b) => b.state === BState.Rubble).length;
    const before = rubble();
    const population = sim.state.totals.population;
    // The flight is a game day on the city's own clock.
    for (let h = 0; h < 30 && !events(sim, 'bombStopped').length; h++) {
      sim.advance(H);
      // (The dome is kept charged and crewed until it stops the bomb; then it is left alone.)
      if (!events(sim, 'bombStopped').length) domeUp(sim);
    }
    expect(events(sim, 'bombStopped'), 'stopped').toHaveLength(1);
    expect(events(sim, 'bombLanded')).toHaveLength(0);
    expect(atomOf(sim).stopped).toBe(1);
    expect(atomOf(sim).inbound).toBeUndefined();
    expect(atomOf(sim).impact).toBeUndefined();
    expect(rubble()).toBe(before);
    expect(sim.state.totals.population).toBeGreaterThanOrEqual(population * 0.9);
    expect(sim.state.war!.supers!.dome!.down).toBeLessThanOrEqual(ATOM.dome.down);
    expect(sim.state.war!.supers!.dome!.down).toBeGreaterThan(ATOM.dome.down - 3);
    expect(atomLines(sim).map((e) => atomEventText(e.ref))).toContain(
      `The dome stopped an atom bomb from ${rival(sim).name}`,
    );
  });

  it('without the dome it lands: a blast, the same as any other bomb', () => {
    const sim = readyTown(60);
    domeUp(sim);
    sim.state.war!.supers!.dome!.mode = 'off';
    hours(sim, 241);
    for (let h = 0; h < 30 && !events(sim, 'bombLanded').length; h++) sim.advance(H);
    expect(events(sim, 'bombLanded')).toHaveLength(1);
    expect(atomOf(sim).impact).toBeDefined();
    expect(atomOf(sim).stopped).toBe(0);
    expect(events(sim, 'bombStopped')).toHaveLength(0);
    // (The slices and the fallout are the strike's, tested in atomImpact and atomFallout.)
  });

  it('its allies turn from it, in both directions, and the city’s own standing is untouched', () => {
    const sim = readyTown(60);
    const [a, b, c] = rivals(sim);
    a!.rival!.allies = [b!.id];
    b!.rival!.allies = [a!.id, c!.id];
    c!.rival!.allies = [b!.id];
    const feelings = rivals(sim).map((n) => n.rival!.relation);
    hours(sim, 241);
    expect(stage(sim)).toBe('spent');
    expect(a!.rival!.allies).toEqual([]);
    expect(b!.rival!.allies, 'its ally is no one’s ally of it, the others’ ties are theirs').toEqual([c!.id]);
    expect(c!.rival!.allies).toEqual([b!.id]);
    expect(diplomacyNotes(sim, 'rivalShunned')).toMatchObject([
      { id: a!.id, info: { text: `${a!.name}’s allies turn from it over the atom bomb`, tone: 'good' } },
    ]);
    // What the neighbours feel for the city is not changed by someone else’s bomb.
    expect(rivals(sim).map((n) => n.rival!.relation)).toEqual(feelings);
    expect(isPariah(sim)).toBe(false);
  });
});

describe('M40 rivals: the city’s own race against theirs', () => {
  /** The city’s own bomb is a few hours from done, the silo crewed. */
  function nearlyDone(sim: Sim): void {
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'bomb' });
    // Two hours from done, every instalment paid.
    atomOf(sim).bomb = { done: ATOM.bomb.hours - 2, paid: ATOM.bomb.hours / ATOM.bomb.every };
    for (const def of [PLANT, SILO]) {
      civic(sim, def).staff = 1;
      civic(sim, def).powered = 1;
    }
  }

  it('first in a city of its own is set unless a computer neighbour finished its bomb first', () => {
    const alone = clone(base);
    nearlyDone(alone);
    for (let h = 0; h < 10 && !atomOf(alone).have; h++) atomHour(alone);
    expect(atomOf(alone).have).toBe(true);
    expect(atomOf(alone).first).toBe(true);

    const behind = clone(base);
    ok(behind, { type: 'cheat', cheat: 'rivalBomb', neighbour: other, stage: 'ready' });
    nearlyDone(behind);
    for (let h = 0; h < 10 && !atomOf(behind).have; h++) atomHour(behind);
    expect(atomOf(behind).have).toBe(true);
    expect(atomOf(behind).first, 'a neighbour was first').toBeUndefined();

    // A neighbour that finishes after the city does not take it back.
    const ahead = clone(base);
    ok(ahead, { type: 'cheat', cheat: 'rivalBomb', neighbour: other, stage: 'bomb', hours: 799 });
    nearlyDone(ahead);
    for (let h = 0; h < 10 && !atomOf(ahead).have; h++) atomHour(ahead);
    expect(atomOf(ahead).first).toBe(true);
    hours(ahead, 2);
    expect(rivals(ahead).find((n) => n.id === other)!.rival!.bomb!.stage).toBe('ready');
    expect(atomOf(ahead).first).toBe(true);
  });
});

describe('M40 rivals: the cheat, the summary and the real clock', () => {
  it('rivalBomb sets facts only, one race at a time, in test mode', () => {
    const sim = clone(base);
    const n = rival(sim);
    const hash = sim.hash();
    const refuse = (cmd: Command): string => {
      const r = sim.dispatch(cmd);
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.reason;
    };
    expect(refuse({ type: 'cheat', cheat: 'rivalBomb', neighbour: 99, stage: 'silo' })).toBe('No such rival');
    expect(refuse({ type: 'cheat', cheat: 'rivalBomb', neighbour: foe, stage: 'plant' as never })).toBe(
      'No such stage',
    );
    expect(refuse({ type: 'cheat', cheat: 'rivalBomb', neighbour: foe, stage: 'silo', hours: -1 })).toBe(
      'Invalid hours',
    );
    expect(sim.hash()).toBe(hash);
    ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: foe, stage: 'silo', hours: 40 });
    expect(n.rival!.bomb).toEqual({ stage: 'silo', at: clock(sim) - 40, delay: 0 });
    expect(events(sim, 'rivalBomb'), 'no announcement from a cheat').toHaveLength(0);
    expect(refuse({ type: 'cheat', cheat: 'rivalBomb', neighbour: other, stage: 'bomb' })).toMatch(
      /is racing already$/,
    );
    ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: foe, stage: 'none' });
    expect(n.rival!.bomb).toBeUndefined();
    sim.testMode = false;
    expect(refuse({ type: 'cheat', cheat: 'rivalBomb', neighbour: foe, stage: 'silo' })).toBe(
      'Test mode only',
    );
  });

  it('the summary lists the races for the region map', () => {
    const sim = clone(base);
    expect(atomSummary(sim)!.rivals).toEqual([]);
    ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: other, stage: 'bomb' });
    const n = rivals(sim).find((x) => x.id === other)!;
    expect(atomSummary(sim)!.rivals).toEqual([
      { id: other, name: n.name, stage: atomStageNo('bomb'), launchIn: null },
    ]);
  });

  it('is wired to the real clock: the hour moves a race on, the month starts one', () => {
    const sim = clone(base);
    ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: other, stage: 'enriching', hours: 1_498 });
    const n = rivals(sim).find((x) => x.id === other)!;
    sim.advance(4 * H);
    expect(n.rival!.bomb!.stage, 'the war clock’s hours run it').toBe('silo');
    expect(events(sim, 'rivalBomb')).toHaveLength(1);
    // The month start rolls (the age bar and the chance are set for the test; the town is far younger).
    const fresh = clone(base);
    fresh.state.region.neighbours.forEach((x) => x.rival && (x.rival.tech = 4));
    for (const x of rivals(fresh)) x.population = 50_000;
    sure(
      () => {
        fresh.advance(2 * M);
        expect(rivals(fresh).filter((x) => x.rival!.bomb)).toHaveLength(1);
        expect(events(fresh, 'rivalBomb').length).toBeGreaterThanOrEqual(1);
      },
      { years: 0 },
    );
    // The same town on Normal starts nothing, however sure.
    const calm = clone(base);
    calm.state.options.difficulty = 'normal';
    for (const x of rivals(calm)) {
      x.population = 50_000;
      x.rival!.tech = 4;
    }
    sure(() => calm.advance(2 * M), { years: 0 });
    expect(rivals(calm).some((x) => x.rival!.bomb)).toBe(false);
  });
});
