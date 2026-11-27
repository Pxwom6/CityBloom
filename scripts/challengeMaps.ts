// The weekly challenges' maps (M44): tries candidate seeds on each map preset with the balance mayor
// (Standard money, and the tight budget's) for three years, and keeps those where it grows a real
// town either way (enough residents and jobs at month 36), writing them to
// `src/data/challengeMaps.ts`. The generator picks each week's map from that pool, so no week is on a
// map the mayor can't grow a town on (a few seeds stall at 600 residents for want of money).
// Usage: npx tsx scripts/challengeMaps.ts [candidates per preset=24] [--dry]
import { writeFileSync } from 'node:fs';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_HOUR } from '../src/sim/time';
import type { MapPreset } from '../src/data/world';
import { Player } from './lib/mayor';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const per = Number(args.find((a) => !a.startsWith('--')) ?? 24);
const PRESETS: MapPreset[] = ['river', 'coast', 'lakes', 'highlands'];
/** At month 36 with Standard money, and with the tight budget's. */
const NEED = { normal: { pop: 2500, jobs: 1500 }, budget: { pop: 1600, jobs: 1000 } };

function grow(seed: string, preset: MapPreset, funds: number): { pop: number; jobs: number } {
  const sim = Sim.create({
    seed,
    preset,
    difficulty: 'normal',
    disasters: false,
    elections: false,
    region: false,
    cityName: 'Probe',
  });
  // The tight budget: the treasury the challenge founds with (the ledger books the difference).
  if (funds !== sim.state.treasury)
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: funds - sim.state.treasury } as never);
  const p = new Player('careful', sim);
  for (let m = 0; m < 36 * 4; m++) {
    p.play();
    sim.advance(TICKS_PER_HOUR * 6);
  }
  return { pop: sim.state.totals.population, jobs: sim.state.totals.jobs };
}

const keep: { seed: string; preset: MapPreset; budget: boolean }[] = [];
for (const preset of PRESETS)
  for (let k = 0; k < per; k++) {
    const seed = `c${preset[0]}${k}`;
    const a = grow(seed, preset, 60_000);
    const ok = a.pop >= NEED.normal.pop && a.jobs >= NEED.normal.jobs;
    const b = ok ? grow(seed, preset, 45_000) : { pop: 0, jobs: 0 };
    const budget = ok && b.pop >= NEED.budget.pop && b.jobs >= NEED.budget.jobs;
    console.log(
      `${seed} ${preset}: ${a.pop} residents ${a.jobs} jobs; budget ${b.pop} / ${b.jobs} ${ok ? (budget ? 'kept, budget too' : 'kept') : ''}`,
    );
    if (ok) keep.push({ seed, preset, budget });
  }
console.log(
  `kept ${keep.length} of ${PRESETS.length * per} (${keep.filter((m) => m.budget).length} for a tight budget too)`,
);
if (!dry) {
  const body = keep
    .map((m) => `  { seed: '${m.seed}', preset: '${m.preset}'${m.budget ? ', budget: true' : ''} },`)
    .join('\n');
  writeFileSync(
    'src/data/challengeMaps.ts',
    `/**
 * The weekly challenges' maps (M44), made by \`npx tsx scripts/challengeMaps.ts\`: seeds on which the
 * balance mayor grows a real town in three years with Standard money (\`budget\`: and with the tight
 * budget's). The generator picks each week's map from these (a tight budget's from those marked).
 * Regenerate after changes that alter growth, then check with \`npx tsx scripts/challenges.ts\`.
 */
import type { MapPreset } from './world';

export const CHALLENGE_MAPS: { seed: string; preset: MapPreset; budget?: true }[] = [
${body}
];
`,
  );
}
