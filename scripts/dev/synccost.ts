/** How long the out-of-step checks take on a saved city (M29): `npx tsx scripts/dev/synccost.ts city.gz`. */
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { Sim } from '../../src/sim/sim';
import { checksum, partHashes } from '../../src/sim/sync';
const file = process.argv[2]!;
const raw = readFileSync(file);
const text = new TextDecoder().decode(raw[0] === 0x1f ? gunzipSync(raw) : raw);
const sim = Sim.fromSave(JSON.parse(text));
console.log('pop', sim.state.totals.population, 'buildings', sim.state.buildings.size);
let t = performance.now(); for (let i = 0; i < 20; i++) checksum(sim); console.log('checksum ms', ((performance.now() - t) / 20).toFixed(2));
t = performance.now(); for (let i = 0; i < 3; i++) partHashes(sim); console.log('partHashes ms', ((performance.now() - t) / 3).toFixed(1));
t = performance.now(); sim.hash(); console.log('hash ms', (performance.now() - t).toFixed(1));
t = performance.now(); const s = JSON.stringify(sim.save()); console.log('save ms', (performance.now() - t).toFixed(1), 'bytes', s.length);
