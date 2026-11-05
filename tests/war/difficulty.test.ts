import { describe, expect, it } from 'vitest';
import { DIFFICULTY, type Difficulty } from '../../src/data/economy';
import { DIPLOMACY } from '../../src/data/diplomacy';
import { PERSONALITY, PERSONALITY_IDS } from '../../src/data/war';
import { RAIDS } from '../../src/data/battle';
import { WAR_DIFFICULTY, WEARINESS } from '../../src/data/warEconomy';
import { Sim } from '../../src/sim/sim';
import { scoreIntel, tributeDemand, weigh } from '../../src/sim/systems/diplomacy';
import { raidChance } from '../../src/sim/systems/raids';
import { weariness } from '../../src/sim/systems/weariness';
import { aggressionOf } from '../../src/sim/systems/warEconomy';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { newSim } from '../helpers';
import { addUnit, dip, ok, rate, rivals } from './economyHelpers';

/**
 * M38 step 8: the difficulty levers (`WAR_DIFFICULTY`). Normal is the war as milestones 34 to 37
 * made it (the M36 golden runs it); Easy keeps rivals smaller, quieter and milder, Hard larger,
 * busier and stiffer. The same city is made at each difficulty and compared, in direction and
 * rough size.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;
const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];

/** The same war city at a difficulty (rivals, no buildings, a good treasury). */
function city(difficulty: Difficulty): Sim {
  const sim = newSim({ rivals: true, disasters: false, difficulty });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
  for (const n of rivals(sim)) n.rival!.allies = [];
  return sim;
}
const all = <T>(f: (d: Difficulty) => T): Record<Difficulty, T> =>
  Object.fromEntries(LEVELS.map((d) => [d, f(d)])) as Record<Difficulty, T>;

describe('M38: the difficulty levers', () => {
  it('are one at Normal, milder at Easy and sterner at Hard, in every column', () => {
    const { easy, normal, hard } = WAR_DIFFICULTY;
    expect(normal).toEqual({ arming: 1, raids: 1, aggression: 0, terms: 1, weariness: 1 });
    for (const k of ['arming', 'raids', 'aggression', 'terms', 'weariness'] as const) {
      expect(easy[k], k).toBeLessThanOrEqual(normal[k]);
      expect(normal[k], k).toBeLessThanOrEqual(hard[k]);
    }
    expect(easy).toMatchObject({ arming: 0.7, raids: 0.6, terms: 0.7, weariness: 0.7 });
    expect(hard).toMatchObject({ arming: 1.3, raids: 1.4, aggression: 0.1, terms: 1.4, weariness: 1.3 });
  });

  it('rivals arm to 0.7 and 1.3 times the forces and defences, at the start and as months go by', () => {
    const sims = all(city);
    const at = (d: Difficulty) => rivals(sims[d]).map((n) => ({ f: n.rival!.forces, d: n.rival!.defences }));
    const start = all(at);
    for (let i = 0; i < start.normal.length; i++) {
      for (const k of ['f', 'd'] as const) {
        const base = start.normal[i]![k];
        expect(start.easy[i]![k]).toBeCloseTo(base * 0.7, 0);
        expect(start.hard[i]![k]).toBeCloseTo(base * 1.3, 0);
      }
    }
    for (const d of LEVELS) sims[d].advance(24 * M);
    const later = all(at);
    for (let i = 0; i < later.normal.length; i++) {
      for (const k of ['f', 'd'] as const) {
        const base = later.normal[i]![k];
        expect(base).toBeGreaterThan(5);
        expect(later.easy[i]![k] / base).toBeGreaterThan(0.64);
        expect(later.easy[i]![k] / base).toBeLessThan(0.76);
        expect(later.hard[i]![k] / base).toBeGreaterThan(1.24);
        expect(later.hard[i]![k] / base).toBeLessThan(1.36);
      }
    }
  });

  it('raids come 0.6 and 1.4 times as often, and Hard’s neighbours are more aggressive on top', () => {
    const sim = city('normal');
    const n = rivals(sim)[0]!;
    for (const p of PERSONALITY_IDS) {
      n.rival!.personality = p;
      n.rival!.forces = 40;
      n.rival!.relation = 0;
      const a = PERSONALITY[p].aggression;
      const chance = (d: Difficulty) => {
        sim.state.options.difficulty = d;
        return raidChance(sim, n.rival!, 10, false, 1);
      };
      const normal = chance('normal');
      // Normal is the old formula, to the last bit.
      expect(normal).toBe((a * Math.min(RAIDS.ratioCap, 40 / 10)) / RAIDS.perHour);
      expect(chance('easy') / normal).toBeCloseTo(0.6, 9);
      expect(chance('hard') / normal).toBeCloseTo(1.4 * ((a + 0.1) / a), 9);
      expect(aggressionOf(sim, p)).toBeCloseTo(a + 0.1, 9);
    }
  });

  /** Raids that reached a city in a declared war of `days` days with a hostile neighbour. */
  function raidsIn(d: Difficulty, days: number): number {
    const sim = city(d);
    const foe = rivals(sim)[0]!;
    foe.rival!.personality = 'aggressive';
    foe.rival!.relation = -50;
    ok(sim, { type: 'declareWar', neighbour: foe.id, scale: 'war', reason: 'Our border' });
    sim.advance(13 * H);
    let raids = 0;
    for (let t = 0; t < days * 24; t++) {
      sim.events = [];
      sim.advance(H);
      raids += sim.events.filter((e) => e.kind === 'battleStarted').length;
    }
    return raids;
  }

  it('a war of forty days brings about 0.6 to 0.8 times the raids on Easy and 1.3 to 1.6 times on Hard', () => {
    const counts = all((d) => raidsIn(d, 40));
    expect(counts.normal).toBeGreaterThan(20);
    // (Easy's neighbour is also smaller and Hard's larger, so the raids it can mount differ a little more than the lever.)
    expect(counts.easy / counts.normal).toBeGreaterThan(0.5);
    expect(counts.easy / counts.normal).toBeLessThan(0.85);
    expect(counts.hard / counts.normal).toBeGreaterThan(1.2);
    expect(counts.hard / counts.normal).toBeLessThan(1.7);
  });

  it('weariness rises 0.7 and 1.3 times as fast', () => {
    const worn = (d: Difficulty) => {
      const sim = city(d);
      for (const n of rivals(sim)) n.rival!.forces = 0.5;
      const foe = rivals(sim)[0]!;
      ok(sim, { type: 'declareWar', neighbour: foe.id, scale: 'war', reason: 'Our border' });
      sim.advance(13 * H);
      const before = weariness(sim);
      for (let t = 0; t < 100; t++) {
        for (const n of rivals(sim)) n.rival!.forces = 0.5;
        sim.advance(H);
      }
      return weariness(sim) - before;
    };
    const w = all(worn);
    expect(w.normal).toBeCloseTo(WEARINESS.perHour * 100, 3);
    expect(w.easy / w.normal).toBeCloseTo(0.7, 2);
    expect(w.hard / w.normal).toBeCloseTo(1.3, 2);
  });

  it('computer neighbours demand tribute 0.7 and 1.4 times as large', () => {
    const demand = all((d) => {
      const sim = city(d);
      sim.state.economy.history.push({ month: 0, lines: { taxR1: 40_000 }, treasury: 0 });
      return tributeDemand(sim, DIPLOMACY.defaults.tributeShare);
    });
    expect(demand.normal).toBe(6_000);
    expect(demand.easy).toBe(4_200);
    expect(demand.hard).toBe(8_400);
    // The floor stays: a poor city still owes something.
    const poor = city('easy');
    expect(tributeDemand(poor, 0.1)).toBe(500);
  });

  it('a city that capitulates is imposed the tribute of its difficulty', () => {
    const imposed = all((d) => {
      const sim = city(d);
      sim.state.economy.history.push({ month: 0, lines: { taxR1: 40_000 }, treasury: 0 });
      const foe = rivals(sim)[0]!;
      foe.rival!.personality = 'honourable';
      ok(sim, { type: 'declareWar', neighbour: foe.id, scale: 'war', reason: 'Our border' });
      sim.advance(13 * H);
      dip(sim).wars[0]!.score = -61;
      scoreIntel(sim, foe.id, -1);
      const pact = dip(sim).pacts.find((p) => p.term.k === 'tribute');
      return pact && pact.term.k === 'tribute' ? pact.term.amount : 0;
    });
    expect(imposed.normal).toBe(6_000);
    expect(imposed.easy).toBe(4_200);
    expect(imposed.hard).toBe(8_400);
  });

  it('hard neighbours want peace a little less (their aggression counts in what they’ll sign)', () => {
    const value = all((d) => {
      const sim = city(d);
      const n = rivals(sim)[0]!;
      return {
        pact: weigh(sim, n, [{ k: 'nonAggression', months: 12 }]),
        peace: weigh(sim, n, [{ k: 'ceasefire', hours: 24 }]),
      };
    });
    expect(value.easy.pact).toBeCloseTo(value.normal.pact, 9);
    expect(value.hard.pact).toBeCloseTo(value.normal.pact - 1.5, 9);
    expect(value.hard.peace).toBeCloseTo(value.normal.peace - 0.6, 9);
  });

  it('the forces’ upkeep follows the difficulty once, through the upkeep scale the services share', () => {
    const upkeep = all((d) => {
      const sim = city(d);
      addUnit(sim, 'tank');
      addUnit(sim, 'tank');
      return -rate(sim, 'forces');
    });
    expect(upkeep.normal).toBeGreaterThan(0);
    expect(upkeep.easy / upkeep.normal).toBeCloseTo(DIFFICULTY.easy.upkeep, 9);
    expect(upkeep.hard / upkeep.normal).toBeCloseTo(DIFFICULTY.hard.upkeep, 9);
  });
});
