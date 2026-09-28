import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { SCENARIO, SCENARIOS, type ScenarioDef } from '../../src/data/scenarios';
import { Sim } from '../../src/sim/sim';
import { scenarioSummary } from '../../src/sim/systems/scenario';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { buildTown, newSim, serveTown } from '../helpers';

/** A scenario for these tests only (registered like the real ones). */
function register(def: Partial<ScenarioDef> & { id: string }): ScenarioDef {
  const full: ScenarioDef = {
    name: def.id,
    blurb: '',
    brief: '',
    save: '',
    months: 6,
    stars: [
      { months: 2, label: 'Within 2 months' },
      { goal: { measure: 'treasury', min: 1_000_000, label: '$1M' }, label: 'A million in the bank' },
    ],
    goals: [],
    limits: [],
    disasters: false,
    elections: false,
    hints: [],
    ...def,
  };
  if (!SCENARIO.has(def.id)) {
    SCENARIOS.push(full);
    SCENARIO.set(def.id, full);
  }
  return full;
}

function town(seed: string) {
  const sim = newSim({ seed });
  buildTown(sim);
  serveTown(sim);
  sim.advance(TICKS_PER_MONTH);
  return sim;
}

/** Run to just past the next month's close. */
function nextMonth(sim: Sim) {
  sim.advance(TICKS_PER_MONTH - ((sim.state.tick + 420) % TICKS_PER_MONTH) + 2);
}

describe('scenarios (M18)', () => {
  it('enforce their limits: forbidden buildings, zones, loans and tax rates', () => {
    register({
      id: 'test-limits',
      limits: [
        { kind: 'noCivic', defs: ['landfill'], label: 'Landfills are not allowed' },
        { kind: 'noZone', zone: 'I', label: 'Industry zoning is not allowed' },
        { kind: 'noLoans', label: 'Loans are not allowed' },
        { kind: 'maxTax', rate: 10, label: 'Taxes above 10 % are not allowed' },
      ],
      goals: [{ measure: 'population', min: 1e9, label: 'never' }],
    });
    const sim = town('sc1');
    expect(sim.dispatch({ type: 'startScenario', id: 'test-limits' }).ok).toBe(true);
    expect(sim.dispatch({ type: 'startScenario', id: 'test-limits' }).ok).toBe(false);
    const civic = sim.preview({ type: 'placeBuilding', def: 'landfill', x: 0, z: 0, angle: 0, side: 1 });
    expect(civic).toMatchObject({ ok: false, reason: 'Landfills are not allowed in this scenario' });
    const brush = { kind: 'brush' as const, points: [{ x: 100, z: 900 }], radius: 20 };
    expect(sim.dispatch({ type: 'zone', zone: 'I', area: brush })).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: 'zone', zone: 'none', area: brush }).ok).toBe(true);
    expect(sim.dispatch({ type: 'takeLoan', amount: 25_000 })).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: 'setTax', zone: 'R', wealth: 0, rate: 11 })).toMatchObject({ ok: false });
    expect(sim.dispatch({ type: 'setTax', zone: 'R', wealth: 0, rate: 10 }).ok).toBe(true);
  });

  it('are won when every goal holds at a month close, with stars for the rules met', () => {
    register({
      id: 'test-win',
      goals: [
        { measure: 'population', min: 1, label: 'Anyone' },
        { measure: 'treasury', min: 200_000, hold: 2, label: '$200k for two months' },
      ],
    });
    const sim = town('sc2');
    sim.dispatch({ type: 'startScenario', id: 'test-win' });
    nextMonth(sim);
    expect(sim.state.scenario).toMatchObject({ status: 'playing', held: [1, 0] });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
    nextMonth(sim);
    expect(sim.state.scenario).toMatchObject({ status: 'playing', held: [2, 1] });
    nextMonth(sim);
    // Won in the third month: no time star, but the million in the bank earns one.
    expect(sim.state.scenario).toMatchObject({ status: 'won', stars: 2 });
    const sum = scenarioSummary(sim)!;
    expect(sum.goals.map((g) => g.met)).toEqual([true, true]);
    expect(sum.monthsTaken).toBeCloseTo(3, 0);
    // The city plays on afterwards.
    sim.advance(TICKS_PER_MONTH);
    expect(sim.state.scenario!.status).toBe('won');
  });

  it('are lost when time runs out, or when the city goes bankrupt', () => {
    register({ id: 'test-lose', months: 2, goals: [{ measure: 'population', min: 1e9, label: 'never' }] });
    const sim = town('sc3');
    sim.dispatch({ type: 'startScenario', id: 'test-lose' });
    // Two months from the start, time runs out at the next month close.
    nextMonth(sim);
    nextMonth(sim);
    expect(sim.state.scenario!.status).toBe('playing');
    expect(scenarioSummary(sim)!.monthsLeft).toBeLessThan(1);
    nextMonth(sim);
    expect(sim.state.scenario).toMatchObject({ status: 'lost', reason: 'time' });
    expect(scenarioSummary(sim)!.monthsLeft).toBe(0);
    const broke = town('sc4');
    broke.dispatch({ type: 'startScenario', id: 'test-lose' });
    broke.state.economy.bankrupt = true;
    broke.advance(1);
    expect(broke.state.scenario).toMatchObject({ status: 'lost', reason: 'bankrupt' });
  });

  it('survive save and load exactly, and older saves load with no scenario and play on', () => {
    register({ id: 'test-save', goals: [{ measure: 'population', min: 1e9, label: 'never' }] });
    const sim = town('sc5');
    sim.dispatch({ type: 'startScenario', id: 'test-save' });
    nextMonth(sim);
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.hash()).toBe(sim.hash());
    sim.advance(2 * TICKS_PER_MONTH);
    loaded.advance(2 * TICKS_PER_MONTH);
    expect(loaded.state.scenario).toEqual(sim.state.scenario);
    expect(loaded.hash()).toBe(sim.hash());
    const old = Sim.fromSave(decodeSave(readFileSync('Saves/Ashton.citybloom')));
    expect(old.state.scenario).toBeNull();
    old.testMode = true;
    old.advance(TICKS_PER_MONTH);
  });
});
