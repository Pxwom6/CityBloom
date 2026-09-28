// Junction probe (M19): grows the crossroads test town (tests/junctionTown.ts), then plays on a few
// months with and without a roundabout at its crossroads, printing the junction's load and the
// average commute each month. Usage: npx tsx scripts/dev/junction.ts [seed] [months] [after]
// [--save dir] (writes junction-jammed.citybloom and junction-ring.citybloom for queueshot.mjs).
import { Sim } from '../../src/sim/sim';
import { junctionDelay, junctionVC } from '../../src/sim/systems/traffic';
import { CHRONICLE_SERIES, monthFigures } from '../../src/sim/systems/chronicle';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { writeFileSync } from 'node:fs';
import { encodeSave } from '../../src/client/saves';
import { crossroadsTown } from '../../tests/junctionTown';

const saveAt = process.argv.indexOf('--save');
const saveDir = saveAt > 0 ? process.argv[saveAt + 1] : null;
const args = saveAt > 0 ? process.argv.slice(2, saveAt) : process.argv.slice(2);
const seed = args[0] ?? 'cross';
const months = Number(args[1] ?? 8);
const after = Number(args[2] ?? 3);
const sim = Sim.create({ seed, preset: 'river' });
const { node } = crossroadsTown(sim, (process.env.ARMS as 'street' | 'avenue') ?? 'avenue');
const commute = (s: Sim) => monthFigures(s)[CHRONICLE_SERIES.indexOf('traffic')]!;
const line = (s: Sim, label: string) =>
  console.log(
    label.padEnd(8),
    'pop',
    String(s.state.totals.population).padStart(6),
    'commute',
    commute(s).toFixed(2),
    'J v/c',
    junctionVC(s, node, 1).toFixed(2),
    'delay',
    junctionDelay(s, node, 1).toFixed(0),
    'through',
    Math.round(s.net.segmentsAt(node).reduce((a, id) => a + (s.state.traffic.get(id) ?? 0), 0) / 2),
  );
for (let m = 1; m <= months; m++) {
  sim.advance(TICKS_PER_MONTH);
  line(sim, `m${m}`);
}
const save = JSON.stringify(sim.save());
console.log('roundabout', JSON.stringify(sim.dispatch({ type: 'roundabout', node })));
const ctl = Sim.fromSave(JSON.parse(save));
for (let m = 1; m <= after; m++) {
  sim.advance(TICKS_PER_MONTH);
  ctl.advance(TICKS_PER_MONTH);
  line(sim, `ring +${m}`);
  line(ctl, `ctl +${m}`);
}
if (saveDir) {
  for (const [name, s] of [
    ['junction-jammed', ctl],
    ['junction-ring', sim],
  ] as const) {
    s.finishMatching();
    writeFileSync(`${saveDir}/${name}.citybloom`, encodeSave(s.save()));
  }
  console.log('saved to', saveDir, 'junction node', node);
}
