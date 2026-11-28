// Quick match balance (M43): the balance mayor plays matches against itself, each city founded with
// the fast start on the same seed, for the match's real minutes at the match speed (a game month a
// minute), deciding every six game hours as balance.ts does. Prints, per seed, each city's figures at
// the end and when it reached Race's target, then what each mode would have made of the match: its
// winner, and whether the mode was won in its time (Race: a city at the target; Happy town: a winner
// past the minimum population; Rich list: a winner richer than it started; Mixed: a winner).
// Usage: npx tsx scripts/matchBalance.ts [minutes=20] [seeds=4] [careful,greedy,neglectful]
//   [--fast funds=250000,growth=3,unlock=0.25] (try other fast-start numbers) [--target 10000]
//   [--plain] (the same cities without the fast start, for comparison)
import { Sim } from '../src/sim/sim';
import {
  MATCH,
  MATCH_MODES,
  matchMoney,
  matchScore,
  type MatchFigures,
  type MatchStart,
} from '../src/data/match';
import { matchOptions } from '../src/client/matchBoot';
import { matchReport } from '../src/sim/systems/region';
import { SPEED_TICKS_PER_SECOND, TICKS_PER_HOUR } from '../src/sim/time';
import { Player, type StrategyId } from './lib/mayor';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const fastArg = flag('--fast');
const target = Number(flag('--target') ?? MATCH.raceTarget);
const plain = args.includes('--plain');
if (plain) args.splice(args.indexOf('--plain'), 1);
const minutes = Number(args[0] ?? 20);
const seeds = Number(args[1] ?? 4);
const strategies = (args[2] ?? 'careful,greedy,neglectful').split(',') as StrategyId[];
const fast: MatchStart = { ...MATCH.fastStart };
for (const kv of (fastArg ?? '').split(',').filter(Boolean)) {
  const [k, v] = kv.split('=');
  (fast as unknown as Record<string, number>)[k!] = Number(v);
}
const ticks = minutes * 60 * SPEED_TICKS_PER_SECOND[MATCH.speed];
const STEP = TICKS_PER_HOUR * 6;
const fmt = (n: number) => Math.round(n).toLocaleString('en-GB');
const mins = (t: number) => (t / (60 * SPEED_TICKS_PER_SECOND[MATCH.speed])).toFixed(1);

console.log(
  `${minutes}-minute matches (${ticks} ticks), ${strategies.join(' v ')}, fast start ${plain ? 'off' : JSON.stringify(fast)}, Race to ${fmt(target)}`,
);
const won: Record<string, number> = Object.fromEntries(MATCH_MODES.map((m) => [m, 0]));
const reachTimes: number[] = [];
for (let k = 0; k < seeds; k++) {
  const seed = `match${k}`;
  const settings = {
    seed,
    preset: 'river' as const,
    mode: 'race' as const,
    minutes,
    target,
    minPop: MATCH.happyMinPop,
    chat: false,
  };
  const players = strategies.map((st) => {
    const o = matchOptions(settings, st);
    const sim = Sim.create(plain ? { ...o, match: undefined } : { ...o, match: fast });
    return new Player(st, sim);
  });
  const start = players.map((p) => matchMoney(figures(p.sim)));
  const reached: (number | null)[] = players.map(() => null);
  for (let t = 0; t < ticks; t += STEP) {
    players.forEach((p, i) => {
      p.play();
      // Hour by hour, so Race's moment is known to the hour.
      for (let h = 0; h < 6 && p.sim.state.tick < ticks; h++) {
        p.sim.advance(TICKS_PER_HOUR);
        if (reached[i] === null && p.sim.state.totals.population >= target) reached[i] = p.sim.state.tick;
      }
    });
  }
  const figs = players.map((p) => figures(p.sim));
  console.log(`\nseed ${seed}`);
  players.forEach((p, i) => {
    const f = figs[i]!;
    console.log(
      `  ${p.strategy.padEnd(10)} pop ${fmt(f.population).padStart(7)}  treasury $${fmt(f.treasury).padStart(10)}  assets $${fmt(f.assets).padStart(9)}  approval ${String(f.approval).padStart(3)} %` +
        `  ${reached[i] !== null ? `reached ${fmt(target)} at ${mins(reached[i]!)} min` : `never reached ${fmt(target)}`}`,
    );
    if (reached[i] !== null) reachTimes.push(reached[i]!);
  });
  for (const mode of MATCH_MODES) {
    const scores = figs.map((f) => matchScore(mode, f, settings));
    let w = 0;
    if (mode === 'race' && reached.some((r) => r !== null))
      w = reached.reduce<number>(
        (b, r, i) => (r !== null && (reached[b] === null || r < reached[b]!) ? i : b),
        reached.findIndex((r) => r !== null),
      );
    else w = scores.indexOf(Math.max(...scores));
    const f = figs[w]!;
    const ok =
      mode === 'race'
        ? reached.some((r) => r !== null)
        : mode === 'happy'
          ? f.population >= MATCH.happyMinPop
          : mode === 'rich'
            ? matchMoney(f) > start[w]!
            : true;
    if (ok) won[mode]!++;
    console.log(
      `  ${mode.padEnd(6)} winner ${players[w]!.strategy.padEnd(10)} score ${fmt(scores[w]!).padStart(9)} (next ${fmt([...scores].sort((a, b) => b - a)[1] ?? 0)})  ${ok ? 'won in its time' : 'NOT won in its time'}`,
    );
  }
}
console.log(
  `\nwon in their time: ${MATCH_MODES.map((m) => `${m} ${won[m]}/${seeds}`).join(', ')}; Race reached ${reachTimes.length} times, earliest ${reachTimes.length ? mins(Math.min(...reachTimes)) : '-'} min, latest ${reachTimes.length ? mins(Math.max(...reachTimes)) : '-'} min`,
);

function figures(sim: Sim): MatchFigures {
  const r = matchReport(sim);
  return {
    population: sim.state.totals.population,
    treasury: r.treasury,
    assets: r.assets,
    approval: r.approval,
  };
}
