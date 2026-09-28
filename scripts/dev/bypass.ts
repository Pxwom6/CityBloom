// Bypass probe (M19): grows the main-street test town (tests/bypassTown.ts), then plays on with and
// without a city highway bypass, printing traffic on Main Street through the centre, on the
// bypass, trucks and the average commute. Usage: npx tsx scripts/dev/bypass.ts [seed] [months] [after]
import { Sim } from '../../src/sim/sim';
import { CHRONICLE_SERIES, monthFigures } from '../../src/sim/systems/chronicle';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { mainStreetTown } from '../../tests/bypassTown';

const seed = process.argv[2] ?? 'bypass';
const months = Number(process.argv[3] ?? 6);
const after = Number(process.argv[4] ?? 3);
const sim = Sim.create({ seed, preset: 'river' });
const town = mainStreetTown(sim);
let bypass: number[] = [];
const commute = (s: Sim) => monthFigures(s)[CHRONICLE_SERIES.indexOf('traffic')]!;
const line = (s: Sim, label: string) => {
  const onBypass = bypass
    .filter((id) => s.state.net.segments.get(id)?.type === 'motorway')
    .map((id) => s.state.traffic.get(id) ?? 0);
  console.log(
    label.padEnd(8),
    'pop',
    String(s.state.totals.population).padStart(6),
    'jobs',
    String(s.state.totals.jobs).padStart(6),
    'commute',
    commute(s).toFixed(2),
    'centre',
    Math.round(s.state.traffic.get(town.centre) ?? 0),
    'bypass max',
    Math.round(Math.max(0, ...onBypass)),
  );
};
for (let m = 1; m <= months; m++) {
  sim.advance(TICKS_PER_MONTH);
  line(sim, `m${m}`);
}
sim.finishMatching();
const save = JSON.stringify(sim.save());
bypass = town.bypass();
console.log('bypass segments', bypass.length);
const ctl = Sim.fromSave(JSON.parse(save));
for (let m = 1; m <= after; m++) {
  sim.advance(TICKS_PER_MONTH);
  ctl.advance(TICKS_PER_MONTH);
  line(sim, `by +${m}`);
  line(ctl, `ctl +${m}`);
}
