import { describe, expect, it } from 'vitest';
import { SCENARIO } from '../../src/data/scenarios';
import type { Sim } from '../../src/sim/sim';
import { goalValue } from '../../src/sim/systems/scenario';
import { weatherSummary } from '../../src/sim/systems/weather';
import { dateOf, MONTH_NAMES, TICKS_PER_HOUR } from '../../src/sim/time';
import { placeAlong } from '../helpers';
import { openScenario, playOut } from './harness';

const def = SCENARIO.get('winter')!;
const [powered, commute] = def.goals as [(typeof def.goals)[0], (typeof def.goals)[0]];

/** Place a civic building beside the street nearest `dx` metres east of the highway's link. */
function placeNear(sim: Sim, civic: string, dx: number): number {
  const hw = sim.state.net.nodes.get(sim.state.highway.connect)!;
  const streets = [...sim.state.net.segments.values()]
    .filter((s) => s.type === 'street')
    .sort(
      (a, b) =>
        Math.abs(sim.net.curve(a.id).pointAt(0).x - hw.x - dx) -
          Math.abs(sim.net.curve(b.id).pointAt(0).x - hw.x - dx) || a.id - b.id,
    );
  for (const s of streets) {
    try {
      return placeAlong(sim, civic, s.id);
    } catch {
      /* no room by this one */
    }
  }
  throw new Error(`nowhere for ${civic}`);
}

/** Each month to the end: power demand, the goals' values and how much of the roads is snowy. */
function months(sim: Sim, n: number) {
  const out: { month: string; demand: number; powered: number; commute: number; snowy: number }[] = [];
  for (let m = 0; m < n && sim.state.scenario?.status === 'playing'; m++) {
    const month = MONTH_NAMES[dateOf(sim.state.tick + 60).month]!;
    let demand = 0;
    let snowy = 0;
    for (let h = 0; h < 24; h++) {
      sim.advance(TICKS_PER_HOUR);
      demand += sim.state.utilityStats.power.demand / 24;
      snowy += weatherSummary(sim).roadsSnowy / 24;
    }
    out.push({ month, demand, powered: goalValue(sim, powered), commute: goalValue(sim, commute), snowy });
  }
  return out;
}

const show = (rows: ReturnType<typeof months>) =>
  rows
    .map(
      (r) =>
        `${r.month} ${Math.round(r.demand)} MW ${r.powered} % ${r.commute.toFixed(2)} min ${Math.round(r.snowy * 100)} % snowy`,
    )
    .join(' | ');

describe('scenario: Long Winter (M22)', () => {
  it('opens in November with power for October: heating pushes demand up through the winter', () => {
    const sim = openScenario('winter');
    expect(dateOf(sim.state.tick).month).toBe(10);
    expect(sim.state.weather.climate).toBe('alpine');
    const supply = sim.state.utilityStats.power.supply;
    const rows = months(sim, 5);
    console.log(`[winter] left alone (supply ${supply} MW): ${show(rows)}`);
    const peak = Math.max(...rows.map((r) => r.demand));
    // Winter's heating needs well over what the town built for the autumn…
    expect(peak).toBeGreaterThan(supply * 1.08);
    // …and without more power, homes go dark.
    expect(Math.min(...rows.map((r) => r.powered))).toBeLessThan(95);
    // Snow lies on every road and commutes slow down.
    expect(Math.max(...rows.map((r) => r.snowy))).toBeGreaterThan(0.9);
    expect(Math.max(...rows.map((r) => r.commute))).toBeGreaterThan(rows[0]!.commute * 1.1);
    expect(playOut(sim)).toMatchObject({ status: 'lost', reason: 'time' });
  });

  it('is won with more power and a public works depot', () => {
    const sim = openScenario('winter');
    placeNear(sim, 'coal', 800);
    placeNear(sim, 'works', 360);
    const rows = months(sim, 5);
    console.log(`[winter] coal plant and depot: ${show(rows)}`);
    expect(sim.state.scenario).toMatchObject({ status: 'won' });
    console.log(`[winter] won with ${sim.state.scenario!.stars} stars`);
  });

  it('is not won by more power alone: snow slows every commute', () => {
    const sim = openScenario('winter');
    placeNear(sim, 'coal', 800);
    const rows = months(sim, 5);
    console.log(`[winter] coal plant only: ${show(rows)}`);
    expect(Math.min(...rows.map((r) => r.powered))).toBeGreaterThanOrEqual(99);
    expect(playOut(sim)).toMatchObject({ status: 'lost', reason: 'time' });
  });

  it('is not won by ploughs alone: the heating outruns the power', () => {
    const sim = openScenario('winter');
    placeNear(sim, 'works', 360);
    const rows = months(sim, 5);
    console.log(`[winter] depot only: ${show(rows)}`);
    expect(Math.max(...rows.map((r) => r.snowy))).toBeLessThan(0.8);
    expect(playOut(sim)).toMatchObject({ status: 'lost', reason: 'time' });
  });

  it('is lost by a neglectful one', () => {
    expect(playOut(openScenario('winter'))).toMatchObject({ status: 'lost', reason: 'time' });
  });
});
