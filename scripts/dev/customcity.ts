/**
 * A city full of players' own landmarks (M46, the frame budget): a grid of streets beside a grown
 * town, and N 2×2 landmarks each wearing a heavy model (the pavilion with a garden of planters, 85 %
 * of the landmark's triangle budget), the model carried in the save as a city's own are. Loaded in
 * the game it draws them all (as a friend's model: "Show friends' custom buildings" off shows the same
 * city in the game's own look), for `scripts/dev/custombench.mjs` here and `framebench.mjs` on the Mac.
 * Usage: npx tsx scripts/dev/customcity.ts [N=150] [out=bench-results/custom-city.citybloom]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync, strToU8 } from 'fflate';
import { createHash } from 'node:crypto';
import { Sim } from '../../src/sim/sim';
import { CIVIC } from '../../src/data/civic';
import { roadsidePose } from '../../src/sim/world/civic';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { checkCustom } from '../../src/models/customCheck';
import { heavyModelParts, writeGlb } from '../lib/makeGlb';
import { buildTown, placeAlong } from '../../tests/helpers';

const N = Number(process.argv[2] ?? 150);
const out = process.argv[3] ?? 'bench-results/custom-city.citybloom';

const glb = writeGlb(heavyModelParts(16, 130));
const check = checkCustom(glb, { kind: 'landmark', size: 2 }).result;
if (!check.ok)
  throw new Error(`the heavy model fails its check: ${check.problems.map((p) => p.words).join('; ')}`);
const hash = createHash('sha256').update(glb).digest('hex').slice(0, 16);

const sim = Sim.create({ seed: 'customcity', preset: 'river' });
sim.testMode = true;
sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
// A town to stand among, with its services, grown a few months.
const town = buildTown(sim, { length: 640, streets: 6 });
for (const def of ['coal', 'pump', 'treatment', 'landfill', 'firestation', 'clinic', 'primary'])
  placeAlong(sim, def, town.streets[0]!);
// Landmarks along every street, both sides, as tightly as they fit.
const d = CIVIC.get('landmark2')!;
let placed = 0;
for (const street of town.streets) {
  const len = sim.net.curve(street).length;
  for (let s = d.w / 2 + 6; s < len - d.w / 2 - 6 && placed < N; s += d.w + 1)
    for (const side of [1, -1] as const) {
      if (placed >= N) break;
      const pose = roadsidePose(sim.net, street, s, side, d.d);
      if (sim.dispatch({ type: 'placeBuilding', def: 'landmark2', ...pose, look: hash }).ok) placed++;
    }
}
for (let m = 0; m < 3; m++) sim.advance(TICKS_PER_MONTH);
const save = sim.save('custom city', true);
save.meta.models = [
  {
    hash,
    name: 'Heavy pavilion',
    target: { kind: 'landmark', size: 2 },
    glb: Buffer.from(glb).toString('base64'),
  },
];
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gzipSync(strToU8(JSON.stringify(save))));
console.log(
  `${placed} landmarks wearing ${hash} (${check.report!.triangles} triangles, ${glb.length} bytes); ${sim.state.totals.population} residents; saved ${out}`,
);
