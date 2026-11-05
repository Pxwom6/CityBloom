/**
 * How big a saved city's shared-city snapshot is (phase 5 checks): the save as a room or region takes it
 * (`encodeSnapshot`: gzipped JSON in base64 parts of `SNAPSHOT_PART` characters, at most
 * `MAX_SNAPSHOT_PARTS`, "8 MB"), against the cap. A city just shared has no undo history yet.
 * Usage: npx tsx scripts/dev/snapsize.ts bench-results/city.gz [more.gz …]
 */
import { readFileSync } from 'node:fs';
import { gunzipSync, gzipSync, strToU8 } from 'fflate';
import { Sim } from '../../src/sim/sim';
import { encodeSnapshot, SNAPSHOT_TOO_BIG } from '../../src/net/snapshot';
import { MAX_SNAPSHOT_PARTS, SNAPSHOT_PART } from '../../relay/protocol';
import type { SharedSnapshot } from '../../src/sim/protocol';

const mb = (n: number) => `${(n / 1e6).toFixed(2)} MB`;
for (const file of process.argv.slice(2)) {
  const raw = readFileSync(file);
  const text = new TextDecoder().decode(raw[0] === 0x1f ? gunzipSync(raw) : raw);
  const sim = Sim.fromSave(JSON.parse(text));
  const snap: SharedSnapshot = { save: sim.save(), history: [], seq: 0, eventHash: 0 };
  const json = JSON.stringify(snap);
  const gz = gzipSync(strToU8(json), { level: 6 });
  const b64 = Math.ceil(gz.length / 3) * 4;
  const cap = MAX_SNAPSHOT_PARTS * SNAPSHOT_PART;
  let parts: number | string;
  try {
    parts = encodeSnapshot(snap, 'probe').parts.length;
  } catch (e) {
    parts = e instanceof Error && e.message === SNAPSHOT_TOO_BIG ? 'too big' : String(e);
  }
  console.log(
    `${file}: ${sim.state.totals.population.toLocaleString('en-US')} residents, ${sim.state.buildings.size.toLocaleString('en-US')} buildings, ${sim.state.civics.size} civic` +
      ` | JSON ${mb(json.length)}, gzip ${mb(gz.length)}, base64 ${mb(b64)}` +
      ` | ${parts} of ${MAX_SNAPSHOT_PARTS} parts (${SNAPSHOT_PART.toLocaleString('en-US')} characters each; cap ${mb(cap)} of base64, ${((b64 / cap) * 100).toFixed(0)} % used)`,
  );
}
