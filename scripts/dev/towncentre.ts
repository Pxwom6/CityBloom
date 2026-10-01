// Dev (M27): where a saved city's buildings are, to aim shots: the centroid of its buildings
// and the densest 200 m square. Usage: npx tsx scripts/dev/towncentre.ts save.citybloom
import { readFileSync } from 'node:fs';
import { decodeSave } from '../../src/client/saves';
import { Sim } from '../../src/sim/sim';

const sim = Sim.fromSave(decodeSave(readFileSync(process.argv[2]!)));
let sx = 0;
let sz = 0;
let n = 0;
const grid = new Map<string, number>();
for (const b of sim.state.buildings.values()) {
  sx += b.x;
  sz += b.z;
  n++;
  const k = `${Math.floor(b.x / 200)},${Math.floor(b.z / 200)}`;
  grid.set(k, (grid.get(k) ?? 0) + 1);
}
const best = [...grid].sort((a, b) => b[1] - a[1]).slice(0, 3);
console.log(`${n} buildings, centroid ${(sx / n).toFixed(0)},${(sz / n).toFixed(0)}`);
for (const [k, c] of best) {
  const [i, j] = k.split(',').map(Number);
  console.log(`densest: ${i! * 200 + 100},${j! * 200 + 100} (${c} buildings)`);
}
