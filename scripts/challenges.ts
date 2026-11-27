// The weekly challenges against the balance mayor (M44): it plays a year of weeks' challenges, each
// founded from its options as a player's is, deciding every six game hours, until the challenge ends;
// prints each week's template, twist, map, how it ended, when and its score, and a summary. A week the
// mayor can't win is listed as such: the generator's targets are set so there are none.
// Usage: npx tsx scripts/challenges.ts [weeks=52] [first=0] [strategy=careful] [--verbose]
import { Sim } from '../src/sim/sim';
import { challengeFor, challengeOptions } from '../src/data/challenges';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { goalValue } from '../src/sim/systems/scenario';
import { Player, type StrategyId } from './lib/mayor';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const pos = args.filter((a) => !a.startsWith('--'));
const weeks = Number(pos[0] ?? 52);
const first = Number(pos[1] ?? 0);
const strategy = (pos[2] ?? 'careful') as StrategyId;

const rows: { week: number; won: boolean; months: number; score: number }[] = [];
const t0 = performance.now();
for (let w = first; w < first + weeks; w++) {
  const def = challengeFor(w);
  const sim = Sim.create(challengeOptions(def, 'Mayorton'));
  const p = new Player(strategy, sim);
  while (sim.state.scenario?.status === 'playing' && sim.state.tick < (def.months + 2) * TICKS_PER_MONTH) {
    p.play();
    sim.advance(TICKS_PER_HOUR * 6);
  }
  const sc = sim.state.scenario!;
  const months = Math.round(((sc.end < 0 ? sim.state.tick : sc.end) - sc.start) / TICKS_PER_MONTH);
  const won = sc.status === 'won';
  rows.push({ week: w, won, months, score: sc.score ?? 0 });
  const goals = def.goals.map((g) => `${g.label}: ${Math.round(goalValue(sim, g))}`).join('; ');
  console.log(
    `week ${String(w).padStart(3)} ${def.template.padEnd(6)} ${def.twist.padEnd(9)} ${def.preset.padEnd(9)} ${won ? 'won ' : `lost (${sc.reason})`} in ${months} months, score ${sc.score ?? 0}${verbose || !won ? ` | ${goals}` : ''}`,
  );
}
const lost = rows.filter((r) => !r.won);
const scores = rows.map((r) => r.score).sort((a, b) => a - b);
console.log(
  `\n${rows.length} weeks with the ${strategy} mayor: won ${rows.length - lost.length}, lost ${lost.length}${lost.length ? ` (weeks ${lost.map((r) => r.week).join(', ')})` : ''}; months to win ${Math.min(...rows.filter((r) => r.won).map((r) => r.months))}–${Math.max(...rows.filter((r) => r.won).map((r) => r.months))}; scores ${scores[0]}–${scores.at(-1)} (median ${scores[Math.floor(scores.length / 2)]}); ${((performance.now() - t0) / 1000).toFixed(0)} s`,
);
