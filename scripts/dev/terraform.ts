// Dev (M24): a street up a hill on seed `hill` (highlands), and how many of its lots are buildable
// (by row back from the road) before and after levelling beside it with the terrain tool.
// Usage: npx tsx scripts/dev/terraform.ts [offset=36] [radius=32] [times=3] [x=824] [dz=-400]
import { ROWS } from '../../src/data/zones';
import { Sim } from '../../src/sim/sim';
import { connectPoint } from '../../tests/helpers';

const off = Number(process.argv[2] ?? 36);
const radius = Number(process.argv[3] ?? 32);
const times = Number(process.argv[4] ?? 3);
const at = Number(process.argv[5] ?? 824);
const dz = Number(process.argv[6] ?? -400);
const sim = Sim.create({ seed: 'hill', preset: 'highlands' });
sim.testMode = true;
const c = connectPoint(sim);
const r = sim.dispatch({
  type: 'buildRoad',
  road: 'street',
  points: [
    { x: at, z: c.z },
    { x: at, z: c.z + dz },
  ],
});
if (!r.ok) throw new Error(r.reason);
const seg = r.created![0]!;
const byRow = () => {
  const rows = new Array<number>(ROWS).fill(0);
  let total = 0;
  for (const b of sim.state.net.blocks.values())
    for (let i = 0; i < b.valid.length; i++) {
      total++;
      if (b.valid[i]) rows[i % ROWS]!++;
    }
  return `${rows.join('/')} of ${total}`;
};
console.log(`before: ${byRow()}`);
const curve = sim.net.curve(seg);
let spent = 0;
for (let s = 20; s < curve.length; s += 24)
  for (const side of [-1, 1]) {
    const p = curve.pointAt(s);
    const t = curve.tangentAt(s);
    const x = p.x - t.z * side * off;
    const z = p.z + t.x * side * off;
    const level = sim.terrain.heightAt(p.x, p.z);
    for (let k = 0; k < times; k++) {
      const r = sim.dispatch({ type: 'terraform', mode: 'level', points: [{ x, z }], radius, level });
      if (r.ok) spent += r.cost;
    }
  }
console.log(`after:  ${byRow()}  ($${spent.toLocaleString('en-US')})`);
