import { describe, expect, it } from 'vitest';
import { RIDGE } from '../../scripts/lib/ridgeMap';
import { CIVIC } from '../../src/data/civic';
import type { Sim } from '../../src/sim/sim';
import { placeAlong } from '../helpers';
import { openScenario, playOut } from './harness';

const hz = RIDGE.highwayZ;
/** The road from the end of the town's avenue, through the saddle, to the far side of the valley. */
const PASS = [
  { x: RIDGE.shelf.x - 30, z: hz },
  { x: 1400, z: hz },
];

function put(sim: Sim, def: string, near?: (x: number) => number): number | null {
  let ids = [...sim.state.net.segments.values()].filter((g) => g.type === 'street').map((g) => g.id);
  if (near)
    ids = ids.sort((a, b) => near(sim.net.curve(a).pointAt(0).x) - near(sim.net.curve(b).pointAt(0).x));
  for (const id of ids)
    try {
      return placeAlong(sim, def, id);
    } catch {
      /* next street */
    }
  return null;
}

/**
 * A mayor who keeps power, water and sewage ahead of demand (new plants go `near` somewhere, septic
 * tanks `drain` somewhere else, away from the pumps).
 */
function keepUp(sim: Sim, near?: (x: number) => number, drain = near): void {
  const u = sim.state.utilityStats;
  const wind = CIVIC.get('wind')!.output!.power!;
  for (let k = 0; k < 6 && u.power.demand > u.power.supply * 0.8; k++) {
    if (!put(sim, 'wind', near)) break;
    u.power.supply += wind;
  }
  if (u.water.demand > u.water.supply * 0.8) put(sim, 'pump', near);
  if (u.sewage.demand > u.sewage.supply * 0.8) put(sim, 'septic', drain);
}

/** Lower the saddle along the line of the road, a pass at a time, until a street fits through. */
function cutThePass(sim: Sim): number {
  let spent = 0;
  const steep = () => {
    const r = sim.preview({ type: 'buildRoad', road: 'street', points: PASS });
    return !r.ok && /steep|cutting/i.test(r.reason);
  };
  for (let k = 0; k < 40 && steep(); k++)
    for (let x = 620; x <= 880; x += 30) {
      const r = sim.dispatch({ type: 'terraform', mode: 'lower', points: [{ x, z: hz }], radius: 48 });
      if (r.ok) spent += r.cost;
    }
  return spent;
}

describe('scenario: Over the Ridge (M24)', () => {
  it('opens on a custom map with the shelf full and the ridge too steep for a road', () => {
    const sim = openScenario('terraces');
    expect(sim.state.map?.name).toBe('Ridgeholm Hills');
    expect(sim.state.weather.seasons).toBe(false);
    expect(sim.preview({ type: 'buildRoad', road: 'street', points: PASS })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/Too steep/),
    });
    console.log(`[terraces] opens with ${sim.state.totals.population} residents, $${sim.state.treasury}`);
  });

  it('is not won on the shelf alone, however well it is run', () => {
    const sim = openScenario('terraces');
    const end = playOut(sim, () => keepUp(sim));
    console.log(`[terraces] shelf only: ${sim.state.totals.population} residents at the end`);
    expect(end).toMatchObject({ status: 'lost', reason: 'time' });
  });

  it('is won by cutting a pass through the ridge and building in the valley', () => {
    const sim = openScenario('terraces');
    const earth = cutThePass(sim);
    const road = sim.dispatch({ type: 'buildRoad', road: 'street', points: PASS });
    expect(road.ok, road.ok ? '' : road.reason).toBe(true);
    // A first quarter in the valley: streets across the road, zoned; services and utilities by the river.
    for (let x = 1000; x <= 1400; x += 100)
      sim.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x, z: hz - 300 },
          { x, z: hz + 300 },
        ],
      });
    for (const [zone, dz, radius] of [
      ['R', -170, 110],
      ['C', 0, 35],
      ['R', 150, 70],
      ['I', 260, 45],
    ] as const)
      sim.dispatch({
        type: 'zone',
        zone,
        area: {
          kind: 'brush',
          points: [
            { x: 960, z: hz + dz },
            { x: 1420, z: hz + dz },
          ],
          radius,
        },
      });
    // Pumps by the river at the valley's east end; septic tanks at its west end, away from them.
    const valley = (x: number) => -x;
    const west = (x: number) => Math.abs(x - 1000);
    put(sim, 'pump', valley);
    put(sim, 'septic', west);
    for (const def of ['firestation', 'police', 'clinic', 'primary', 'park_small']) put(sim, def, west);
    console.log(
      `[terraces] pass cut for $${earth.toLocaleString('en-US')}, road $${(road.ok ? road.cost : 0).toLocaleString('en-US')}, $${sim.state.treasury.toLocaleString('en-US')} left`,
    );
    const end = playOut(sim, () => keepUp(sim, valley, west));
    console.log(
      `[terraces] won: ${end.status} after ${((sim.state.tick - end.start) / 1440).toFixed(1)} months with ${sim.state.totals.population} residents, ${end.stars} stars`,
    );
    expect(end.status).toBe('won');
  });
});
