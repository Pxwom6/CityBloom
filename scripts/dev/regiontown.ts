// Dev (M23): a coast town with its neighbours, an airport, a seaport and a landmark, grown a few
// months with a power deal and a garbage deal, saved as a .citybloom for regionshot.mjs.
// Usage: npx tsx scripts/dev/regiontown.ts out.citybloom [seed]
import { writeFileSync } from 'node:fs';
import { gzipSync, strToU8 } from 'fflate';
import { Sim } from '../../src/sim/sim';
import { capacity } from '../../src/sim/systems/region';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { buildTown, connectPoint, placeAlong, road, serveTown } from '../../tests/helpers';

const out = process.argv[2] ?? 'region.citybloom';
const seed = process.argv[3] ?? 'port';
const sim = Sim.create({ seed, preset: 'coast', cityName: 'Harbourside' });
sim.testMode = true;
sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
buildTown(sim, { length: 640, streets: 5 });
serveTown(sim);
const c = connectPoint(sim);
const placeOn = (def: string, segs: number[]) => {
  for (const id of segs)
    try {
      return placeAlong(sim, def, id);
    } catch {
      /* no room */
    }
  throw new Error(`nowhere for ${def}`);
};
const streets = () =>
  [...sim.state.net.segments.values()].filter((s) => s.type === 'street').map((s) => s.id);
placeOn('clocktower', streets());
placeOn('hotel', streets());
// Out to the sea: an avenue east and a street along the shore, with the seaport on it.
const x = 1430;
road(
  sim,
  [
    { x: c.x + 640, z: c.z },
    { x, z: c.z },
  ],
  'avenue',
);
road(sim, [
  { x, z: c.z - 400 },
  { x, z: c.z + 400 },
]);
const shore = streets().filter((id) => Math.abs(sim.net.curve(id).pointAt(0).x - x) < 3);
const port = placeOn('seaport', shore);
// Industry by the port for it to ship.
sim.dispatch({
  type: 'zone',
  zone: 'I',
  area: {
    kind: 'brush',
    points: [
      { x: c.x + 760, z: c.z + 60 },
      { x: 1300, z: c.z + 60 },
    ],
    radius: 50,
  },
});
// An airport north of town on its own avenue, joined to the first side street.
for (const dz of [-460, -520, -400]) {
  const pts = [
    { x: c.x + 60, z: c.z + dz },
    { x: c.x + 860, z: c.z + dz },
  ];
  if (!sim.preview({ type: 'buildRoad', road: 'avenue', points: pts }).ok) continue;
  const av = road(sim, pts, 'avenue').created!;
  road(sim, [
    { x: c.x + 640 / 6, z: c.z + dz },
    { x: c.x + 640 / 6, z: c.z - 160 },
  ]);
  placeOn('airport', av);
  break;
}
sim.advance(TICKS_PER_MONTH * 3);
const ind = sim.state.region.neighbours.find((n) => n.kind === 'industrial')!;
sim.dispatch({ type: 'setDeal', neighbour: ind.id, resource: 'power', direction: 'buy', amount: 300 });
sim.dispatch({
  type: 'setDeal',
  neighbour: ind.id,
  resource: 'garbage',
  direction: 'buy',
  amount: Math.min(400, capacity(sim, ind, 'garbage', 'buy')),
});
sim.advance(TICKS_PER_MONTH * 2);
const t = sim.state.totals;
console.log(
  `pop ${t.population} jobs ${t.jobsFilled}/${t.jobs} in ${t.fromRegion} out ${t.toRegion} visitors ${JSON.stringify(sim.state.tourism.by)} ship loads ${sim.railFreight.get(port) ?? 0}`,
);
writeFileSync(out, gzipSync(strToU8(JSON.stringify(sim.save()))));
console.log(`saved ${out}`);
