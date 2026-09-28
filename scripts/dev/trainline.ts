// Train line probe (M20): grows the two-district jam town (tests/trafficTown.ts), then plays on
// with and without a railway and two stations beside the jammed link, printing the link's traffic,
// train riders and the average commute. Usage: npx tsx scripts/dev/trainline.ts [seed] [months] [after]
import { Sim } from '../../src/sim/sim';
import { CHRONICLE_SERIES, monthFigures } from '../../src/sim/systems/chronicle';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { newSim } from '../../tests/helpers';
import { twoDistricts } from '../../tests/trafficTown';
import { trainCorridor } from '../../tests/railTown';

const seed = process.argv[2] ?? 'rail';
const months = Number(process.argv[3] ?? 5);
const after = Number(process.argv[4] ?? 3);
const sim = newSim({ seed });
const t = twoDistricts(sim, (process.env.LINK as 'dirt' | 'street') ?? 'dirt');
const commute = (s: Sim) => monthFigures(s)[CHRONICLE_SERIES.indexOf('traffic')]!;
const line = (s: Sim, label: string) => {
  const riders = [...s.state.transit.riders.values()].reduce((a, b) => a + b, 0);
  console.log(
    label.padEnd(8),
    'pop',
    String(s.state.totals.population).padStart(6),
    'commute',
    commute(s).toFixed(2),
    'link',
    Math.round(s.state.traffic.get(t.link) ?? 0),
    'riders',
    riders,
    'lines',
    s
      .lines()
      .map((l) => `${l.mode}:${l.stops.length}`)
      .join(','),
  );
};
for (let m = 1; m <= months; m++) {
  sim.advance(TICKS_PER_MONTH);
  line(sim, `m${m}`);
}
sim.finishMatching();
const ctl = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
console.log('built', JSON.stringify(trainCorridor(sim, t.c)));
for (let m = 1; m <= after; m++) {
  sim.advance(TICKS_PER_MONTH);
  ctl.advance(TICKS_PER_MONTH);
  line(sim, `rail +${m}`);
  line(ctl, `ctl +${m}`);
}
