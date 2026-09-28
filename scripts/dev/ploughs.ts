// Dev (M22): Market Town with a public works depot under ten hours of heavy snow, hour by hour:
// the weather, snowy and deeply snowy road length, ploughs out (phase:stops:metres cleared).
// Usage: npx tsx scripts/dev/ploughs.ts [hours]
import { openScenario } from '../../tests/scenarios/harness';
import { placeAlong } from '../../tests/helpers';
import { weatherSummary } from '../../src/sim/systems/weather';
import { TICKS_PER_HOUR } from '../../src/sim/time';

const hours = Number(process.argv[2] ?? 16);
const sim = openScenario('market');
// The weather cheat is for test mode.
(sim as unknown as { testMode: boolean }).testMode = true;
sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
let id: number | null = null;
for (const seg of [...sim.state.net.segments.values()].filter((s) => s.type === 'street')) {
  try {
    id = placeAlong(sim, 'works', seg.id);
    break;
  } catch {
    /* no room here */
  }
}
const depot = sim.state.civics.get(id!)!;
console.log(
  'depot',
  id,
  sim.dispatch({ type: 'cheat', cheat: 'weather', kind: 'snow', strength: 1, hours: 10 }),
);
for (let h = 0; h < hours; h++) {
  sim.advance(TICKS_PER_HOUR);
  const ploughs = [...sim.state.vehicles.values()].filter((v) => v.kind === 'plough');
  const w = weatherSummary(sim);
  console.log(
    `${h} ${w.kind} ${w.temp} °C  snowy ${(w.roadsSnowy * 100).toFixed(0)} %  deep ${(w.roadsDeep * 100).toFixed(0)} %  ` +
      `ploughs ${ploughs.map((p) => `${p.phase}:${p.stops}:${p.load}`).join(' ')}  cleared today ${depot.processedToday} m`,
  );
}
