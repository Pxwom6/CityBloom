// Dev (M23): a town grown with and without its neighbours, month by month: jobs and how they're
// filled (regional commuters), unemployment (residents working out of town), shoppers from out of
// town, visitors by how they arrived, and the traffic on the highway link.
// Usage: npx tsx scripts/dev/region.ts [seed] [months] [R|I|mixed]
import { Sim } from '../../src/sim/sim';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { buildTown, connectPoint, serveTown } from '../../tests/helpers';

const seed = process.argv[2] ?? 'region';
const months = Number(process.argv[3] ?? 6);
const mix = process.argv[4] ?? 'mixed';

function grow(withRegion: boolean): string[] {
  const sim = Sim.create({ seed });
  if (!withRegion) sim.state.region.neighbours = [];
  buildTown(sim, { zone: mix === 'mixed' });
  if (mix !== 'mixed') {
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
    zone(mix === 'R' ? 'R' : 'I', -100, 70);
    zone(mix === 'R' ? 'R' : 'I', 100, 70);
    zone('C', 20, 22);
    if (mix === 'I') zone('R', -40, 25);
  }
  serveTown(sim);
  const rows: string[] = [];
  for (let m = 1; m <= months; m++) {
    sim.advance(TICKS_PER_MONTH);
    const t = sim.state.totals;
    const f = sim.regionFlows;
    rows.push(
      `m${m}: pop ${t.population} jobs ${t.jobsFilled}/${t.jobs} (in ${t.fromRegion}) unemployed ${t.unemployed} (out ${t.toRegion}) shoppers in ${f.shoppersIn} visitors ${JSON.stringify(f.visitors)} highway ${Math.round(sim.state.traffic.get(sim.state.highway.segment) ?? 0)} demand ${sim.state.demand.R.toFixed(2)}/${sim.state.demand.C.toFixed(2)}/${sim.state.demand.I.toFixed(2)}`,
    );
  }
  return rows;
}

for (const w of [true, false]) {
  console.log(w ? '== with neighbours' : '== no neighbours');
  for (const r of grow(w)) console.log(r);
}
