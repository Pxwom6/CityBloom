// Dev (phase 3): grow homes along an avenue until they reach medium density, low wealth, level 3
// (R103, the tenement's type), and print what lots they stand on month by month.
// Usage: npx tsx scripts/dev/tenement.ts [seed] [months]
import { buildTown, connectPoint, newSim, road, serveTown } from '../../tests/helpers';

const seed = process.argv[2] ?? 'tenement';
const months = Number(process.argv[3] ?? 18);
const sim = newSim({ seed, preset: 'river', sandbox: true, disasters: false });
buildTown(sim);
serveTown(sim);
const c = connectPoint(sim);
// A second avenue north of the town, homes both sides: avenues take medium density.
const z = c.z - 230;
for (const x of [c.x + 96, c.x + 384])
  road(sim, [
    { x, z: c.z - 160 },
    { x, z },
  ]);
road(
  sim,
  [
    { x: c.x + 40, z },
    { x: c.x + 440, z },
  ],
  'avenue',
);
sim.dispatch({
  type: 'zone',
  zone: 'R',
  area: {
    kind: 'brush',
    points: [
      { x: c.x + 40, z },
      { x: c.x + 440, z },
    ],
    radius: 40,
  },
});
for (let m = 1; m <= months; m++) {
  sim.advance(1440);
  const by = new Map<string, number>();
  for (const b of sim.state.buildings.values()) {
    if (b.zone !== 1 || b.density < 1) continue;
    const k = `${b.def}@${b.w}x${b.d}`;
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  console.log(
    `month ${m}: pop ${sim.state.totals.population}  ${[...by]
      .sort()
      .map(([k, n]) => `${k}×${n}`)
      .join(' ')}`,
  );
}
