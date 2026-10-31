/**
 * The war soak (M39 step 10, design call 13): four players' cities in one region at war, played for
 * as long as asked (two hours for the milestone) through the region room, with raids, live battles
 * (orders from both sides, an ally's help), a war declared and opened after its warning, a treaty, a
 * total war that ends in a conquest and a vassal paying dues, and, now and then, a connection that
 * drops, a network that goes, a page that reloads and a player who leaves and comes back.
 *
 * It checks, as it goes and at the end: every live battle's two runs agreed (or the disagreement is
 * explained by a disturbance and listed); every battle was taken once by its defender and every force
 * reported (or called home) once by its attacker, and none waits in the room for a city that is here;
 * every treaty was applied by both its cities, and the region's pacts and vassals are the ones each
 * city's sim mirrors; the cities' invariants; the region's wars as the room keeps them against each
 * page and each city; and what the room cost (rows, requests, duration) against Cloudflare's free
 * plan. Everyone who is away when the time is up comes back before the final checks. Exits 1 on any
 * failure.
 *
 *   npx tsx scripts/dev/regionsoak.ts [minutes] [--virtual] [--seed s] [--speed 1|2|3] [--no-fair]
 *                                     [--no-disturb] [--crash] [--story short|full] [--log file] [--json file]
 *
 * `real` (the default) is the local relay over real sockets on the wall clock, the cities at the
 * game's own 1× pace and the game's fair clock on: two hours take two hours. `--virtual` (or
 * `SOAK_FAST=1`) plays the same story against the same room class in this process with a clock the
 * soak moves, as fast as the machine goes; the same seed plays the same story, so a failure found
 * there can be found again. Real mode's wall clock is the room's, so its war warnings (2 minutes),
 * ceasefire cooldowns (9) and a held seat of power (6) are real minutes.
 *
 * The milestone's run, started apart from the shell that starts it (it takes over two hours: the
 * minutes asked for, a drain of up to three more, and the set-up) and read from its log:
 *
 *   nohup npx tsx scripts/dev/regionsoak.ts 120 --crash > /dev/null 2>&1 &
 *   tail -f bench-results/regionsoak.log
 *
 * Where a tool call caps how long a command may run (two hours for a background one), ask for fewer
 * minutes (110 leaves room for the drain). Output goes to `bench-results/` (git-ignored): the log is
 * written as the run goes, the JSON every five minutes (marked `partial`) and again at the end.
 * `--crash` is off unless asked for: it makes a page die and come back from its last autosave.
 * SIGTERM and SIGINT end the run early the way time running out does (everyone comes back, what is
 * under way finishes, and the verdict, the coverage, the budget and the JSON are written); a second
 * signal writes what there is and exits at once.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { result } from '../lib/soak/report';
import { runSoak } from '../lib/soak/run';
import type { Soak } from '../lib/soak/world';

/** Flags that take a value (a bare number after one of these is its value, not the minutes). */
const VALUE_FLAGS = new Set(['seed', 'speed', 'log', 'json', 'story', 'minutes']);

/** The command line: the minutes (the first bare number, or `--minutes n`) and the flags. */
export function parseArgs(args: string[]): {
  minutes: number | undefined;
  flags: Set<string>;
  values: Map<string, string>;
} {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  let minutes: number | undefined;
  for (let k = 0; k < args.length; k++) {
    const a = args[k]!;
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (VALUE_FLAGS.has(name) && k + 1 < args.length) values.set(name, args[++k]!);
      else flags.add(name);
    } else if (/^\d+(\.\d+)?$/.test(a) && minutes === undefined) minutes = Number(a);
  }
  const m = values.get('minutes');
  if (m !== undefined && /^\d+(\.\d+)?$/.test(m)) minutes = Number(m);
  return { minutes, flags, values };
}

async function main(): Promise<void> {
  const { minutes: asked, flags, values } = parseArgs(process.argv.slice(2));
  const fast = !!process.env.SOAK_FAST || flags.has('virtual');
  const minutes = asked ?? (fast ? 30 : 120);
  const logAt = values.get('log') ?? 'bench-results/regionsoak.log';
  const jsonAt = values.get('json') ?? 'bench-results/regionsoak.json';
  mkdirSync(dirname(logAt), { recursive: true });
  mkdirSync(dirname(jsonAt), { recursive: true });
  writeFileSync(logAt, '');
  const log = (line: string) => {
    console.log(line);
    appendFileSync(logAt, `${line}\n`);
  };
  const mode = fast ? 'virtual' : 'real';
  const story = values.get('story') === 'short' ? 'short' : 'full';
  const speed = Number(values.get('speed') ?? 1) as 1 | 2 | 3;
  log(
    `soak: ${minutes} minutes (${asked === undefined ? 'the default' : 'asked for'}), ${mode} mode, seed ${values.get('seed') ?? 'soak'}, ${story} story, speed ${speed}×${flags.has('crash') ? ', with crashes' : ''}${flags.has('no-disturb') ? ', undisturbed' : ''}`,
  );

  let soak: Soak | null = null;
  // The run so far, written now and then (and when a second signal comes).
  const snapshot = (w: Soak) => writeFileSync(jsonAt, JSON.stringify(result(w, false), null, 2));
  let signals = 0;
  const onSignal = (name: string) => () => {
    signals++;
    if (signals === 1 && soak) {
      log(
        `${name}: ending the run early; it is finished and judged as if its time were up (a second signal exits at once)`,
      );
      soak.stop();
      return;
    }
    if (soak) snapshot(soak);
    log(`${name} again: exiting with the run so far written to ${jsonAt}`);
    process.exit(130);
  };
  process.on('SIGTERM', onSignal('SIGTERM'));
  process.on('SIGINT', onSignal('SIGINT'));

  const run = await runSoak(
    {
      minutes,
      mode,
      seed: values.get('seed') ?? 'soak',
      speed,
      fairClock: !flags.has('no-fair'),
      disturb: !flags.has('no-disturb'),
      crash: flags.has('crash'),
      story,
      log,
      onProgress: snapshot,
    },
    { before: (w) => (soak = w) },
  );
  for (const l of run.lines) log(l);
  writeFileSync(jsonAt, JSON.stringify(run.result, null, 2));
  log(`written to ${logAt} and ${jsonAt}`);
  process.exit(run.result.ok ? 0 : 1);
}

// (Only when run: the runner's argument parser is also loaded by its test.)
if (process.argv[1] && /regionsoak\.ts$/.test(process.argv[1])) await main();
