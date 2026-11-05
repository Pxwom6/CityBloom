import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ATOM, raceSlowWhy, spanWords } from '../../src/data/atom';
import { INTEL, SABOTAGE_TARGETS } from '../../src/data/intel';
import { TIER_KEYS } from '../../src/data/research';
import { checkCommand } from '../../src/sim/commandCheck';
import type { Command } from '../../src/sim/commands';
import type { Sim } from '../../src/sim/sim';
import { regionReport, type RegionUpdate } from '../../src/sim/systems/region';
import {
  atomHour,
  atomOf,
  fuelBlock,
  inTheRace,
  plantSabotageText,
  plantTarget,
  sabotagePlant,
} from '../../src/sim/systems/atom';
import { counterIntel, intelMonth } from '../../src/sim/systems/intel';
import { checkOpInput, friendOpsWaiting, OP_TAKEN } from '../../src/sim/systems/regionOps';
import { fightingWith } from '../../src/sim/systems/diplomacy';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { plantStrikeWords, raceMark, sabotageChoices } from '../../src/ui/warView';
import { civicOnline } from '../../src/sim/world/civic';
import { clone, rivals, toMonthStart } from './economyHelpers';
import { labTown, ok, refusal } from './researchTown';

/**
 * M40, step 7, spies and the race (docs/plans/M40-design.md, call 18; the plan's test 3, sim half): a
 * target of their own for saboteurs, the atom bomb's works. A plant or silo still going up is set
 * back 120 war hours, a finished plant loses 120 hours of fuel and a finished silo 120 hours of the
 * bomb's build, and either is closed 12 hours; the city's counter-intelligence is 150 higher while a
 * plant stands; a computer neighbour's saboteur goes for the plant in a city that races, on the one
 * draw it always made. (The room's refusal is relay/tests/regionAtomOps.test.ts; a computer
 * neighbour's race, which the city's spies and forces put back, is atomRival.test.ts.)
 */

vi.setConfig({ testTimeout: 120_000 });

const M = TICKS_PER_MONTH;
const PLANT = 'enrichment';
const SILO = 'atomsilo';

const civic = (sim: Sim, def: string) => [...sim.state.civics.values()].find((c) => c.def === def)!;
/** The race's facts, made if the city has set none yet. */
const atom = (sim: Sim) => atomOf(sim);
const results = (sim: Sim) => sim.state.war!.intel!.results;

/** The plant and silo are crewed and powered: they work at the full rate. */
function crewed(sim: Sim): void {
  for (const def of [PLANT, SILO]) {
    const c = civic(sim, def);
    if (!c.build) {
      c.staff = 1;
      c.powered = 1;
    }
  }
}

/** Closed by a strike: reopen it (the repair crews' hours are not what these tests are about). */
function repaired(sim: Sim): void {
  for (const c of sim.state.civics.values()) c.damage = 0;
}

/** Brookside (slot 2) takes the first computer neighbour's place in a region at war. */
function friendUpdate(): RegionUpdate {
  const none = { power: 0, water: 0, garbage: 0 };
  return {
    cities: [
      {
        slot: 2,
        name: 'Brookside',
        mayor: 'Sam',
        color: 1,
        population: 5_000,
        kind: 'suburb',
        offers: { buy: { ...none }, sell: { ...none } },
        workers: 0,
        jobs: 0,
        shoppers: 0,
        online: true,
        raid: 'open',
        tiers: [0, 2, 0, 0, 1, 0],
        counter: 250,
      },
    ],
    contracts: [],
    project: null,
    rules: { war: true, scale: 'total', supers: true },
  };
}

/** A command that must be refused and leave the city exactly as it was. */
function harmless(sim: Sim, cmd: Command): string {
  const before = sim.hash();
  const r = sim.dispatch(cmd);
  expect(r.ok, JSON.stringify(cmd)).toBe(false);
  expect(sim.hash()).toBe(before);
  return r.ok ? '' : r.reason;
}

// The town, three ways: before the race (`plain`), the plant going up (`going`) and the plant and
// the silo finished (`race`). All have the same weapons lab and spy agency, a total war open with the
// first rival, every research tier and a nuclear plant running.
let plain: Sim;
let going: Sim;
let race: Sim;
let rival: number;

beforeAll(() => {
  const { sim, place } = labTown(1, { length: 800, streets: 7 });
  place('nuclear');
  sim.advance(M);
  ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
  ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
  place('spyagency');
  const first = rivals(sim)[0]!;
  ok(sim, { type: 'declareWar', neighbour: first.id, scale: 'total', reason: 'The race' });
  const war = sim.state.war!.diplomacy!.wars.find((w) => w.with === first.id)!;
  sim.advance(Math.max(0, war.opens - sim.state.tick) + 1);
  sim.advance(M);
  expect(fightingWith(sim, first.id)?.scale).toBe('total');
  rival = first.id;
  plain = clone(sim);
  const plant = place(PLANT);
  going = clone(sim);
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic: plant });
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place(SILO) });
  sim.advance(M);
  race = sim;
}, 300_000);

describe('M40 spies: what a saboteur does to the race’s works', () => {
  it('a plant going up is put back 120 war hours: its stage clock moves, and its stage ends 5 game days later', () => {
    const struck = clone(going);
    const control = clone(going);
    const p = civic(struck, PLANT);
    expect(p.build?.clock, 'a war project counts the war clock').toBeDefined();
    const before = p.build!.clock!;
    const strike = sabotagePlant(struck)!;
    expect(strike).toMatchObject({ what: 'build', hours: ATOM.spy.setBack });
    expect(p.build!.clock).toBe(before + 120);
    // An unfinished building is not closed, and nothing else of the race moves.
    expect(p.damage).toBe(0);
    expect(atom(struck)?.fuel ?? 0).toBe(0);
    // The stage is five game days later (months here are game days) in a real run of months.
    const monthsToStage = (sim: Sim) => {
      for (let k = 1; k <= 30; k++) {
        toMonthStart(sim);
        if (civic(sim, PLANT).build?.stage === 1) return k;
      }
      throw new Error('the stage never ended');
    };
    const late = monthsToStage(struck);
    const on = monthsToStage(control);
    expect(late - on).toBe(5);
    expect(plantSabotageText(strike, 'Gravelford')).toBe(
      'Saboteurs from Gravelford put the enrichment plant back 5 days',
    );
  });

  it('a finished plant loses 120 hours of fuel and is closed for 12 hours, and makes none meanwhile', () => {
    const sim = clone(race);
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'enriching' });
    crewed(sim);
    const fuel = atom(sim).fuel;
    expect(fuel).toBe(ATOM.fuel.hours / 2);
    expect(fuelBlock(sim)).toBeNull();
    const strike = sabotagePlant(sim)!;
    const c = civic(sim, PLANT);
    expect(strike).toMatchObject({ what: 'fuel', hours: 120 });
    expect(atom(sim).fuel).toBe(fuel - 120);
    // Closed (repair crews can shorten it), so no fuel is made until it is back.
    expect(c.damage).toBeGreaterThan(0);
    expect(c.damage).toBeLessThanOrEqual(ATOM.spy.closed);
    expect(civicOnline(c)).toBe(false);
    expect(fuelBlock(sim)).toBe('The enrichment plant is closed for repairs');
    atomHour(sim);
    expect(atom(sim).fuel, 'closed: nothing made').toBe(fuel - 120);
    repaired(sim);
    atomHour(sim);
    expect(atom(sim).fuel, 'open again: fuel is made').toBeGreaterThan(fuel - 120);
    expect(plantSabotageText(strike, 'Gravelford')).toBe(
      'Saboteurs from Gravelford spoiled 5 days of fuel and closed the enrichment plant for 12 hours',
    );
  });

  it('fuel never goes below nothing, and a plant with none is only closed', () => {
    const sim = clone(race);
    crewed(sim);
    atom(sim).fuel = 50;
    expect(sabotagePlant(sim)).toMatchObject({ what: 'fuel', hours: 50 });
    expect(atom(sim).fuel).toBe(0);
    repaired(sim);
    expect(sabotagePlant(sim)).toMatchObject({ what: 'fuel', hours: 0 });
    expect(atom(sim).fuel).toBe(0);
    expect(civicOnline(civic(sim, PLANT))).toBe(false);
    expect(plantSabotageText(sabotagePlant(sim)!, 'Gravelford')).toBe(
      'Saboteurs from Gravelford closed the enrichment plant for 12 hours',
    );
  });

  it('a silo building the bomb loses 120 hours of it, never an instalment already paid for', () => {
    const sim = clone(race);
    crewed(sim);
    atom(sim).fuel = ATOM.fuel.hours;
    // 300 hours in, six instalments paid (the next is due at 360).
    atom(sim).bomb = { done: 300, paid: 6, waiting: true };
    const strike = sabotagePlant(sim)!;
    expect(strike).toMatchObject({ what: 'bomb', hours: 120, civic: civic(sim, SILO) });
    expect(atom(sim).bomb).toEqual({ done: 180, paid: 6 });
    expect(civicOnline(civic(sim, SILO))).toBe(false);
    // The hours are done again without paying twice: no instalment before 360 again.
    repaired(sim);
    const money = sim.state.treasury;
    for (let h = 0; h < 150; h++) atomHour(sim);
    expect(atom(sim).bomb!.done).toBeGreaterThan(300);
    expect(atom(sim).bomb!.done).toBeLessThan(360);
    expect(atom(sim).bomb!.paid).toBe(6);
    expect(sim.state.treasury).toBe(money);
    for (let h = 0; h < 60 && atom(sim).bomb!.paid === 6; h++) atomHour(sim);
    expect(atom(sim).bomb!.paid).toBe(7);
    expect(sim.state.treasury).toBeLessThan(money);
    // Near the start there is less to lose, and the count stops at nothing.
    atom(sim).bomb = { done: 50, paid: 1 };
    repaired(sim);
    expect(sabotagePlant(sim)).toMatchObject({ what: 'bomb', hours: 50 });
    expect(atom(sim).bomb).toEqual({ done: 0, paid: 1 });
    repaired(sim);
    expect(plantSabotageText(sabotagePlant(sim)!, 'Gravelford')).toBe(
      'Saboteurs from Gravelford closed the atom silo for 12 hours',
    );
  });

  it('a silo holding a bomb is closed, and a launch being prepared starts again', () => {
    const sim = clone(race);
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'preparing' });
    crewed(sim);
    expect(atom(sim).prep!.done).toBe(ATOM.launch.prepHours / 2);
    expect(plantTarget(sim)).toBe(civic(sim, SILO));
    expect(sabotagePlant(sim)).toMatchObject({ what: 'closed', hours: 0 });
    atomHour(sim);
    expect(atom(sim).prep!.done, 'back to the start').toBe(0);
    expect(atom(sim).have, 'the bomb is still there').toBe(true);
  });

  it('goes for the silo once the bomb is under way, the plant before it, nothing once the bomb has left', () => {
    const sim = clone(race);
    expect(plantTarget(sim)).toBe(civic(sim, PLANT));
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'bomb' });
    expect(plantTarget(sim)).toBe(civic(sim, SILO));
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'ready' });
    expect(plantTarget(sim)).toBe(civic(sim, SILO));
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'spent' });
    expect(plantTarget(sim)).toBeUndefined();
    expect(inTheRace(sim)).toBe(false);
    // A plant going up is a target too; a city with neither has nothing to strike and changes not at all.
    expect(plantTarget(going)).toBe(civic(going, PLANT));
    const hash = plain.hash();
    expect(inTheRace(plain)).toBe(false);
    expect(sabotagePlant(plain)).toBeNull();
    expect(plain.hash()).toBe(hash);
  });
});

describe('M40 spies: the three ways in', () => {
  it('a computer neighbour’s saboteur strikes the plant in a city that races, and only there', () => {
    const sim = clone(race);
    crewed(sim);
    atom(sim).fuel = 600;
    const score = fightingWith(sim, rival)!.score;
    // Each spy has dice of its own: send them until one gets through.
    let struck = false;
    for (let k = 0; k < 120 && !struck; k++) {
      const seen = sim.events.length;
      ok(sim, { type: 'cheat', cheat: 'spyIn', neighbour: rival, op: 'sabotage', target: 'plant' });
      struck = sim.events.slice(seen).some((e) => e.kind === 'sabotaged');
      if (!struck) expect(atom(sim).fuel, 'a spy caught or turned back harms nothing').toBe(600);
    }
    expect(struck, 'a spy got through in 120').toBe(true);
    expect(atom(sim).fuel).toBe(480);
    expect(civicOnline(civic(sim, PLANT))).toBe(false);
    expect(results(sim).at(-1)).toMatchObject({
      text: expect.stringMatching(
        /^Saboteurs from .+ spoiled 5 days of fuel and closed the enrichment plant/,
      ),
      tone: 'bad',
    });
    // It counts against them in the war, as any sabotage that works.
    expect(fightingWith(sim, rival)!.score).toBeLessThan(score);
    // A city outside the race has nothing there to strike: the same spies change nothing at all.
    const quiet = clone(plain);
    for (let k = 0; k < 20; k++)
      ok(quiet, { type: 'cheat', cheat: 'spyIn', neighbour: rival, op: 'sabotage', target: 'plant' });
    expect(quiet.events.some((e) => e.kind === 'sabotaged')).toBe(false);
    for (const c of quiet.state.civics.values()) expect(c.damage).toBe(0);
  });

  it('a friend’s saboteur, as its region decided it: the same strike, taken once; late, only a notice', () => {
    const sim = clone(race);
    ok(sim, { type: 'regionUpdate', update: friendUpdate() });
    crewed(sim);
    atom(sim).fuel = 600;
    const resolve = (o: Partial<Extract<Command, { type: 'opResolve' }>> = {}): Command => ({
      type: 'opResolve',
      from: 2,
      id: 'op-12345678-77',
      op: 'sabotage',
      outcome: 'success',
      target: 'plant',
      late: false,
      ...o,
    });
    // Forged targets are not operations.
    for (const bad of [resolve({ target: 'gate' as never }), resolve({ target: 'Plant' as never })])
      harmless(sim, bad);
    ok(sim, resolve({ id: 'op-12345678-1', late: true }));
    expect(atom(sim).fuel, 'late').toBe(600);
    expect(results(sim).at(-1)!.text).toMatch(/while you were away/);
    ok(sim, resolve());
    expect(atom(sim).fuel).toBe(480);
    expect(civicOnline(civic(sim, PLANT))).toBe(false);
    expect(results(sim).at(-1)!.text).toBe(
      'Saboteurs from Brookside spoiled 5 days of fuel and closed the enrichment plant for 12 hours',
    );
    expect(sim.events.some((e) => e.kind === 'sabotaged' && e.id === civic(sim, PLANT).id)).toBe(true);
    expect(harmless(sim, resolve())).toBe(OP_TAKEN);
    expect(atom(sim).fuel).toBe(480);
    // Caught: logged where it was caught.
    ok(sim, resolve({ id: 'op-12345678-2', outcome: 'caught' }));
    expect(results(sim).at(-1)).toMatchObject({
      text: 'Your agents caught a spy from Brookside at the atom bomb works',
      tone: 'good',
    });
    // A city outside the race: nothing to strike, said so.
    const bare = clone(plain);
    ok(bare, { type: 'regionUpdate', update: friendUpdate() });
    const civics = bare.state.civics.size;
    ok(bare, resolve());
    expect(results(bare).at(-1)!.text).toBe('Saboteurs from Brookside found nothing to strike');
    expect(bare.state.civics.size).toBe(civics);
  });

  it('the city’s own agent is sent for the plant only where a race can be slowed', () => {
    const sim = clone(race);
    const n = rivals(sim).find((x) => x.id !== rival)!;
    const send = (target: string): Command =>
      ({ type: 'spyMission', neighbour: n.id, op: 'sabotage', target }) as Command;
    // Nothing racing there.
    expect(refusal(sim, send('plant'))).toBe(`${n.name} isn’t racing for the atom bomb`);
    // A neighbour at the stages of a race can be slowed; one that has its bomb, or has used it, cannot.
    ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: n.id, stage: 'silo' });
    harmless(sim, send('gate'));
    const id = ok(sim, send('plant')).created![0]!;
    expect(sim.state.war!.intel!.missions.find((m) => m.id === id)).toMatchObject({
      op: 'sabotage',
      target: 'plant',
    });
    ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: n.id, stage: 'ready' });
    expect(refusal(sim, send('plant'))).toBe(
      `${n.name} has finished its atom bomb: there is nothing left to slow`,
    );
    ok(sim, { type: 'cheat', cheat: 'rivalBomb', neighbour: n.id, stage: 'spent' });
    expect(refusal(sim, send('plant'))).toBe(`${n.name} has used its atom bomb`);
    // Power and depot are as they were.
    expect(refusal(sim, { type: 'spyMission', neighbour: n.id, op: 'sabotage' })).toBe(
      'Choose what to sabotage: its power or its depot',
    );
  });

  it('a friend’s city is a target only when its last report showed a race (step 9’s report)', () => {
    const sim = clone(race);
    ok(sim, { type: 'regionUpdate', update: friendUpdate() });
    const friend = sim.state.region.neighbours.find((n) => n.player?.slot === 2)!;
    const send: Command = { type: 'spyMission', neighbour: friend.id, op: 'sabotage', target: 'plant' };
    expect(refusal(sim, send)).toBe('Brookside isn’t racing for the atom bomb');
    friend.player!.atom = { stage: 8 };
    expect(refusal(sim, send), 'its bomb is spent').toBe('Brookside isn’t racing for the atom bomb');
    friend.player!.atom = { stage: 3 };
    const id = ok(sim, send).created![0]!;
    // It goes there like any mission to a friend, and waits for the region with its target.
    for (let t = 0; t < 40 && sim.state.war!.intel!.missions.find((m) => m.id === id)!.state === 'out'; t++)
      sim.advance(60);
    expect(friendOpsWaiting(sim)).toMatchObject([{ mission: id, slot: 2, op: 'sabotage', target: 'plant' }]);
  });
});

describe('M40 spies: the words and the checks', () => {
  it('plant is a target every check reads', () => {
    expect(SABOTAGE_TARGETS).toEqual(['power', 'depot', 'plant']);
    const sabotage = (target: unknown) => ({ type: 'spyMission', neighbour: 1, op: 'sabotage', target });
    expect(checkCommand(sabotage('plant'))).toEqual({ cmd: sabotage('plant') });
    expect(checkCommand(sabotage('power'))).toEqual({ cmd: sabotage('power') });
    for (const bad of ['gate', 'Plant', '', null, 7])
      expect(checkCommand(sabotage(bad))).toHaveProperty('problem');
    const op = (target: unknown, kind = 'sabotage') => ({
      from: 2,
      id: 'op-1-2',
      op: kind,
      outcome: 'success',
      target,
      late: false,
    });
    expect(checkOpInput(op('plant'))).toBeNull();
    expect(checkOpInput(op('gate'))).not.toBeNull();
    // A target only goes with a sabotage.
    expect(checkOpInput(op('plant', 'reveal'))).not.toBeNull();
    expect(checkOpInput(op(undefined, 'reveal'))).toBeNull();
  });

  it('is told in a plain voice', () => {
    expect(spanWords(120)).toBe('5 days');
    expect(spanWords(24)).toBe('1 day');
    expect(spanWords(12)).toBe('12 hours');
    const sim = clone(race);
    crewed(sim);
    atom(sim).bomb = { done: 300, paid: 6 };
    delete atom(sim).have;
    const words = [
      plantSabotageText(sabotagePlant(sim)!, 'Gravelford'),
      plantSabotageText(sabotagePlant(clone(going))!, 'Gravelford'),
    ].join(' ');
    expect(words).toMatch(/undid 5 days of work on the bomb and closed the atom silo for 12 hours/);
    expect(words).not.toMatch(/casualt|killed|dead|victim|death/i);
  });

  it('says a sliver of an hour and a day short of a day as they are, never "0 hours" or "24 hours"', () => {
    expect(spanWords(0.3)).toBe('under an hour');
    expect(spanWords(0.49)).toBe('under an hour');
    expect(spanWords(0.5)).toBe('1 hour');
    expect(spanWords(1.4)).toBe('1 hour');
    expect(spanWords(1.6)).toBe('2 hours');
    expect(spanWords(23.4)).toBe('23 hours');
    expect(spanWords(23.6)).toBe('1 day');
    expect(spanWords(35)).toBe('1 day');
    expect(spanWords(0)).toBe('0 hours');
    // No hour a text can read as nothing.
    for (let h = 0.01; h < 60; h += 0.07) expect(spanWords(h), String(h)).not.toMatch(/^(0|24) hours?$/);
    const sim = clone(race);
    crewed(sim);
    atom(sim).fuel = 0.3;
    const strike = sabotagePlant(sim)!;
    expect(strike.hours).toBe(0.3);
    expect(plantSabotageText(strike, 'Gravelford')).toBe(
      'Saboteurs from Gravelford spoiled under an hour of fuel and closed the enrichment plant for 12 hours',
    );
  });
});

describe('M40 spies: the Intelligence menu', () => {
  const rival = (stage?: string, vassal = false) => ({
    name: 'Gravelford',
    rival: { ...(stage ? { bomb: { stage } } : {}), ...(vassal ? { vassal: { since: 0 } } : {}) },
  });
  const plant = (n: Parameters<typeof sabotageChoices>[0]) =>
    sabotageChoices(n).find((c) => c.value === 'plant')!;

  it('always lists the atom bomb works; where there is no race to slow it is greyed out with the sim’s reason', () => {
    for (const n of [rival(), rival('ready'), rival('spent'), rival('silo', true), undefined]) {
      const choices = sabotageChoices(n);
      expect(choices.map((c) => c.value)).toEqual(['power', 'depot', 'plant']);
      expect(choices.slice(0, 2).every((c) => c.why === null)).toBe(true);
      expect(plant(n).why, JSON.stringify(n)).not.toBeNull();
      if (n) expect(plant(n).why).toBe(raceSlowWhy(n));
    }
    expect(plant(rival()).label).toBe('atom bomb works (no race to slow)');
    expect(plant(rival('ready')).label).toBe('atom bomb works (its bomb is finished)');
    expect(plant(rival('spent')).label).toBe('atom bomb works (its bomb is used)');
    expect(plant(rival('silo', true)).label, 'a fallen town’s race is over').toBe(
      'atom bomb works (no race to slow)',
    );
  });

  it('is on offer, in plain label, where a race can be slowed: a rival at its stages, a friend at stages 1 to 6', () => {
    for (const stage of ['enriching', 'silo', 'bomb', 'preparing']) {
      expect(plant(rival(stage)), stage).toEqual({
        value: 'plant',
        label: 'atom bomb works',
        why: raceSlowWhy(rival(stage)) as null,
      });
      expect(raceMark(rival(stage))).toBe(' (racing for the atom bomb)');
    }
    for (const atom of [1, 4, 6]) {
      const friend = { name: 'Brookside', player: { atom: { stage: atom } } };
      expect(plant(friend).why, `stage ${atom}`).toBeNull();
    }
    for (const friend of [
      { name: 'Brookside', player: {} },
      { name: 'Brookside', player: { atom: { stage: 7 } } },
      { name: 'Brookside', player: { atom: { stage: 8 } } },
    ])
      expect(plant(friend).why).toBe('Brookside isn’t racing for the atom bomb');
    expect(raceMark(rival())).toBe('');
    expect(raceMark(rival('ready'))).toBe('');
    expect(plantStrikeWords()).toBe(
      'A strike puts its race back 5 days and closes the plant or silo for 12 hours.',
    );
  });
});

describe('M40 spies: the guards at the gate', () => {
  it('counter-intelligence is 150 higher while a plant stands, in the sim and in the region’s report', () => {
    const none = counterIntel(plain);
    expect(counterIntel(going)).toBe(none + ATOM.spy.guard);
    expect(counterIntel(race)).toBe(none + ATOM.spy.guard);
    expect(regionReport(plain).counter).toBe(none);
    expect(regionReport(race).counter).toBe(none + 150);
    // Still bounded (750).
    expect(counterIntel(race)).toBeLessThanOrEqual(INTEL.counter.max);
    // A computer neighbour’s war adds its own term on top, as it did.
    expect(counterIntel(race, rival)).toBe(Math.min(INTEL.counter.max, none + 150 + INTEL.counter.atWar));
  });
});

describe('M40 spies: the dice are where they were', () => {
  it('a computer spy takes the plant in the power’s place in a racing city, and every other roll is the same', () => {
    // Two copies of the one town at the same moment, one with the plant put down (going up: that is in
    // the race too) and one without, a war open: the months' spies, side by side.
    const spies = (sim: Sim) => {
      const w = sim.state.war!;
      for (let m = 0; m < 240; m++) {
        sim.state.tick += M;
        intelMonth(sim);
      }
      return (w.intel?.theirs ?? []).map(({ from, op, target, arrive }) => ({ from, op, target, arrive }));
    };
    const outside = spies(clone(plain));
    const inside = spies(clone(going));
    expect(outside.length).toBeGreaterThan(20);
    expect(inside.length, 'one spy a month at most, the same months').toBe(outside.length);
    const sabotage = outside.filter((s) => s.op === 'sabotage');
    expect(sabotage.length, 'a war: saboteurs').toBeGreaterThan(8);
    // Same who, what and when; only the target's meaning changes, and only in the race.
    inside.forEach((s, k) => {
      const o = outside[k]!;
      expect([s.from, s.op, s.arrive]).toEqual([o.from, o.op, o.arrive]);
      if (o.op !== 'sabotage') expect(s.target).toBeUndefined();
      else expect(s.target).toBe(o.target === 'power' ? 'plant' : 'depot');
    });
    expect(new Set(outside.filter((s) => s.target).map((s) => s.target))).toEqual(
      new Set(['power', 'depot']),
    );
    expect(new Set(inside.filter((s) => s.target).map((s) => s.target))).toEqual(new Set(['plant', 'depot']));
  });
});
