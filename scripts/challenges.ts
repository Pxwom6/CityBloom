// The weekly challenges against the balance mayor (M44): it plays a year of weeks' challenges, each
// founded from its options as a player's is, deciding every six game hours, until the challenge ends;
// prints each week's template, twist, map, how it ended, when and its score, and a summary. A week the
// mayor can't win is listed as such: the generator's targets are set so there are none.
// With --replay each week's run is recorded as the worker records a player's (every command the city
// took, at its tick, frozen at the tick the challenge ended), packed as the page packs it, and replayed
// from the challenge alone: it must come to the same hash and score (and how big and slow that is).
// Usage: npx tsx scripts/challenges.ts [weeks=52] [first=0] [strategy=careful] [--verbose] [--replay]
import { gzipSync } from 'node:zlib';
import { Sim } from '../src/sim/sim';
import { CHALLENGE_TOWN, RUN_VERSION, replayRun, type RunEntry } from '../src/sim/runReplay';
import { challengeScoreNow } from '../src/sim/systems/scenario';
import type { Command } from '../src/sim/commands';
import { challengeFor, challengeOptions } from '../src/data/challenges';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { goalValue } from '../src/sim/systems/scenario';
import { Player, type StrategyId } from './lib/mayor';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const replay = args.includes('--replay');
const pos = args.filter((a) => !a.startsWith('--'));
const weeks = Number(pos[0] ?? 52);
const first = Number(pos[1] ?? 0);
const strategy = (pos[2] ?? 'careful') as StrategyId;

const rows: { week: number; won: boolean; months: number; score: number }[] = [];
const runs: { week: number; ok: boolean; entries: number; packed: number; secs: number }[] = [];
const t0 = performance.now();
for (let w = first; w < first + weeks; w++) {
  const def = challengeFor(w);
  const sim = Sim.create(challengeOptions(def, replay ? CHALLENGE_TOWN : 'Mayorton'));
  // The run, as the worker records it: each command the city took, at its tick.
  const entries: RunEntry[] = [];
  if (replay) {
    const dispatch = sim.dispatch.bind(sim);
    sim.dispatch = (cmd: Command, ...rest) => {
      const tick = sim.state.tick;
      const r = dispatch(cmd, ...rest);
      if (r.ok) entries.push({ tick, cmd: JSON.parse(JSON.stringify(cmd)) as Command });
      return r;
    };
  }
  let final: { count: number; end: number; hash: string; score: number } | null = null;
  const p = new Player(strategy, sim);
  while (sim.state.scenario?.status === 'playing' && sim.state.tick < (def.months + 2) * TICKS_PER_MONTH) {
    p.play();
    if (!replay) {
      sim.advance(TICKS_PER_HOUR * 6);
      continue;
    }
    // Tick by tick, to freeze the run the moment the challenge ends (the worker's `freezeRun`).
    for (let k = 0; k < TICKS_PER_HOUR * 6 && sim.state.scenario?.status === 'playing'; k++) sim.step();
    if (sim.state.scenario?.status !== 'playing')
      final = { count: entries.length, end: sim.state.tick, hash: sim.hash(), score: challengeScoreNow(sim) };
  }
  const sc = sim.state.scenario!;
  const months = Math.round(((sc.end < 0 ? sim.state.tick : sc.end) - sc.start) / TICKS_PER_MONTH);
  const won = sc.status === 'won';
  rows.push({ week: w, won, months, score: sc.score ?? 0 });
  if (replay && final) {
    const run = { v: RUN_VERSION, week: w, def, entries: entries.slice(0, final.count), ...final };
    const packed = gzipSync(JSON.stringify({ v: RUN_VERSION, entries: run.entries, end: run.end })).toString(
      'base64',
    );
    const r0 = performance.now();
    const back = replayRun(JSON.parse(JSON.stringify(run)) as typeof run);
    const secs = (performance.now() - r0) / 1000;
    runs.push({ week: w, ok: back.ok, entries: run.entries.length, packed: packed.length, secs });
    console.log(
      `   run: ${run.entries.length} commands, ${(packed.length / 1024).toFixed(1)} kB packed, replayed in ${secs.toFixed(1)} s: ${back.ok ? 'same hash and score' : `NOT THE SAME (${back.why}: ${back.hash} vs ${final.hash}, ${back.score} vs ${final.score})`}`,
    );
  }
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
if (replay && runs.length) {
  const bad = runs.filter((r) => !r.ok);
  const max = (k: 'entries' | 'packed' | 'secs') => Math.max(...runs.map((r) => r[k]));
  console.log(
    `runs: ${runs.length - bad.length} of ${runs.length} replayed to the same hash and score${bad.length ? ` (not weeks ${bad.map((r) => r.week).join(', ')})` : ''}; at most ${max('entries')} commands, ${(max('packed') / 1024).toFixed(1)} kB packed, ${max('secs').toFixed(1)} s to replay`,
  );
}
