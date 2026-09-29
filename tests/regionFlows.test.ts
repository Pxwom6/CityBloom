import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, connectPoint, placeAlong, serveTown } from './helpers';

/**
 * A town zoned mostly for industry (jobs going begging) or mostly for homes (residents without
 * work), grown `months` with or without its neighbours.
 */
function grow(kind: 'jobs' | 'homes', withRegion: boolean, months = 3): Sim {
  const sim = Sim.create({ seed: 'region' });
  if (!withRegion) sim.state.region.neighbours = [];
  buildTown(sim, { zone: false });
  const c = connectPoint(sim);
  const zone = (z: 'R' | 'C' | 'I', dz: number, r: number) =>
    sim.dispatch({
      type: 'zone',
      zone: z,
      area: {
        kind: 'brush',
        points: [
          { x: c.x + 20, z: c.z + dz },
          { x: c.x + 480, z: c.z + dz },
        ],
        radius: r,
      },
    });
  const main = kind === 'jobs' ? 'I' : 'R';
  zone(main, -100, 70);
  zone(main, 100, 70);
  zone('C', 20, 22);
  if (kind === 'jobs') zone('R', -40, 25);
  serveTown(sim);
  sim.advance(TICKS_PER_MONTH * months);
  return sim;
}

describe('regional commuters, shoppers and visitors (M23)', () => {
  it("the neighbours' workers fill jobs the town can't staff, driving in along the highway", () => {
    const alone = grow('jobs', false);
    const sim = grow('jobs', true);
    const a = alone.state.totals;
    const t = sim.state.totals;
    console.log(
      `[region] jobs filled ${a.jobsFilled}/${a.jobs} alone, ${t.jobsFilled}/${t.jobs} with neighbours (${t.fromRegion} from out of town)`,
    );
    expect(t.fromRegion).toBeGreaterThan(200);
    expect(t.jobsFilled).toBeGreaterThan(a.jobsFilled + 200);
    // They come by road: the highway link carries them, and some are among the sampled trips.
    const hw = (s: Sim) => s.state.traffic.get(s.state.highway.segment) ?? 0;
    expect(hw(sim)).toBeGreaterThan(hw(alone) + 300);
    expect(sim.tripSamples.some((x) => x.purpose === 'incommute')).toBe(true);
    // Jobs they hold still count as open to newcomers: homes stay in demand.
    expect(sim.state.demand.R).toBeGreaterThan(0.5);
  });

  it("residents with no work here take jobs in the neighbours, and don't count as unemployed", () => {
    const alone = grow('homes', false);
    const sim = grow('homes', true);
    const a = alone.state.totals;
    const t = sim.state.totals;
    console.log(
      `[region] unemployed ${a.unemployed} alone, ${t.unemployed} with neighbours (${t.toRegion} work out of town)`,
    );
    expect(t.toRegion).toBeGreaterThan(20);
    expect(t.unemployed).toBeLessThan(a.unemployed);
    // Their commute includes the drive to the neighbour: homes with residents working out of town
    // commute further on average than those whose workers all work here.
    const homes = [...sim.state.buildings.values()].filter((b) => b.zone === 1 && b.employed > 0);
    const mean = (l: typeof homes) => l.reduce((a, b) => a + b.commute, 0) / l.length;
    const out = homes.filter((b) => (b.toRegion ?? 0) > 0);
    const local = homes.filter((b) => !b.toRegion);
    expect(out.length).toBeGreaterThan(0);
    expect(mean(out)).toBeGreaterThan(mean(local) + 60);
    expect(sim.tripSamples.some((x) => x.purpose === 'outcommute')).toBe(true);
  });

  it('visitors drive in to the sights through the traffic model', () => {
    const sim = Sim.create({ seed: 'region' });
    buildTown(sim);
    serveTown(sim);
    let tower = 0;
    for (const seg of [...sim.state.net.segments.values()].filter((x) => x.type === 'street')) {
      try {
        tower = placeAlong(sim, 'clocktower', seg.id);
        break;
      } catch {
        /* no room by this one */
      }
    }
    expect(tower).toBeGreaterThan(0);
    sim.advance(TICKS_PER_MONTH * 2);
    const by = sim.state.tourism.by!;
    expect(sim.state.tourism.visitors).toBeGreaterThan(0);
    expect(by.road).toBe(sim.state.tourism.visitors);
    // The traffic round (every two hours) saw nearly the same number as the hourly count.
    expect(Math.abs(sim.regionFlows.visitors.road - by.road)).toBeLessThan(by.road * 0.05 + 2);
    const visit = sim.tripSamples.filter((x) => x.purpose === 'visit');
    expect(visit.length).toBeGreaterThan(0);
    expect(visit.every((x) => x.to === tower && x.legs[0]!.seg === sim.state.highway.segment)).toBe(true);
  });
});
