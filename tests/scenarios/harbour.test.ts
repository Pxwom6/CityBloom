import { describe, expect, it } from 'vitest';
import { SCENARIO } from '../../src/data/scenarios';
import type { Sim } from '../../src/sim/sim';
import { capacity } from '../../src/sim/systems/region';
import { goalValue } from '../../src/sim/systems/scenario';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { placeAlong } from '../helpers';
import { openScenario, playOut } from './harness';

const def = SCENARIO.get('harbour')!;
const [powered, shipped] = def.goals as [(typeof def.goals)[0], (typeof def.goals)[0]];

/** Buy what the town is short of (and a margin) from the neighbour that sells power. */
function powerDeal(sim: Sim): number {
  const u = sim.state.utilityStats.power;
  const seller = sim.state.region.neighbours.find((n) => capacity(sim, n, 'power', 'buy') > 0)!;
  const amount = Math.min(capacity(sim, seller, 'power', 'buy'), Math.ceil((u.demand - u.supply) * 1.3 + 50));
  expect(
    sim.dispatch({ type: 'setDeal', neighbour: seller.id, resource: 'power', direction: 'buy', amount }),
  ).toMatchObject({ ok: true });
  return amount;
}

/** A seaport on the shore street the town was left with. */
function seaport(sim: Sim): number {
  const shore = [...sim.state.net.segments.values()]
    .filter((s) => s.type === 'street')
    .sort((a, b) => sim.net.curve(b.id).pointAt(0).x - sim.net.curve(a.id).pointAt(0).x);
  for (const s of shore.slice(0, 6)) {
    try {
      return placeAlong(sim, 'seaport', s.id);
    } catch {
      /* no deep water behind this one */
    }
  }
  throw new Error('nowhere for the seaport');
}

function months(sim: Sim, n: number): string {
  const rows: string[] = [];
  for (let m = 0; m < n && sim.state.scenario?.status === 'playing'; m++) {
    sim.advance(TICKS_PER_MONTH);
    rows.push(`${goalValue(sim, powered)} % powered, ${goalValue(sim, shipped)} shipped`);
  }
  return rows.join(' | ');
}

describe('scenario: Harbour Lights (M23)', () => {
  it('opens short of power, with neighbours to trade with and no fossil plants allowed', () => {
    const sim = openScenario('harbour');
    expect(sim.state.region.neighbours).toHaveLength(3);
    expect(goalValue(sim, powered)).toBeLessThan(99);
    expect(
      sim.dispatch({ type: 'placeBuilding', def: 'coal', x: 500, z: 500, angle: 0, side: 1 }),
    ).toMatchObject({
      ok: false,
    });
    expect(playOut(sim)).toMatchObject({ status: 'lost', reason: 'time' });
  });

  it('is won with a power deal and a seaport', () => {
    const sim = openScenario('harbour');
    const mw = powerDeal(sim);
    seaport(sim);
    console.log(`[harbour] deal ${mw} MW and a seaport: ${months(sim, 6)}`);
    expect(sim.state.scenario).toMatchObject({ status: 'won' });
    console.log(`[harbour] won with ${sim.state.scenario!.stars} stars`);
  });

  it('is not won by the power deal alone: nothing goes by sea', () => {
    const sim = openScenario('harbour');
    powerDeal(sim);
    console.log(`[harbour] deal only: ${months(sim, 3)}`);
    expect(playOut(sim)).toMatchObject({ status: 'lost', reason: 'time' });
  });

  it('is not won by the seaport alone: the town stays short of power', () => {
    const sim = openScenario('harbour');
    seaport(sim);
    console.log(`[harbour] seaport only: ${months(sim, 3)}`);
    expect(playOut(sim)).toMatchObject({ status: 'lost', reason: 'time' });
  });
});
