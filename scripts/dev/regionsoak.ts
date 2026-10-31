/**
 * The war soak (M39 step 10, design call 13): four players' cities in one region at war, played for
 * as long as asked (two hours for the milestone) through the region room, with raids, live battles
 * (orders from both sides, an ally's help), a war declared and opened after its warning, a treaty, a
 * total war that ends in a conquest and a vassal paying dues, and, now and then, a connection that
 * drops, a network that goes, a page that reloads and a player who leaves and comes back.
 *
 * It checks, as it goes and at the end: every live battle's two runs agreed (or the disagreement is
 * explained by a disturbance and listed); every battle was taken once by its defender and its force
 * reported once by its attacker; the cities' own invariants; the region's wars, pacts and vassals as
 * the room keeps them against each page and each city; and what the room cost (rows, requests,
 * duration) against Cloudflare's free plan. Exits 1 on any failure.
 *
 *   npx tsx scripts/dev/regionsoak.ts [minutes] [--virtual] [--seed s] [--speed 1|2|3] [--no-fair]
 *                                     [--no-disturb] [--story short|full] [--log file] [--json file]
 *
 * `real` (the default) is the local relay over real sockets on the wall clock, the cities at the
 * game's own 1× pace and the game's fair clock on: two hours take two hours. `--virtual` (or
 * `SOAK_FAST=1`) plays the same story against the same room class in this process with a clock the
 * soak moves, as fast as the machine goes; the same seed plays the same story, so a failure found
 * there can be found again. Real mode's wall clock is the room's, so its war warnings (2 minutes),
 * ceasefire cooldowns (9) and a held seat of power (6) are real minutes.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runSoak } from '../lib/soak/run';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const fast = !!process.env.SOAK_FAST || flag('virtual');
const first = args.find((a, k) => /^\d+(\.\d+)?$/.test(a) && !args[k - 1]?.startsWith('--'));
const minutes = first ? Number(first) : fast ? 30 : 120;
const logAt = value('log') ?? 'bench-results/regionsoak.log';
const jsonAt = value('json') ?? 'bench-results/regionsoak.json';
mkdirSync(dirname(logAt), { recursive: true });
writeFileSync(logAt, '');
const log = (line: string) => {
  console.log(line);
  appendFileSync(logAt, `${line}\n`);
};

const speed = Number(value('speed') ?? 1) as 1 | 2 | 3;
const { result, lines } = await runSoak({
  minutes,
  mode: fast ? 'virtual' : 'real',
  seed: value('seed') ?? 'soak',
  speed,
  fairClock: !flag('no-fair'),
  disturb: !flag('no-disturb'),
  story: value('story') === 'short' ? 'short' : 'full',
  log,
});
for (const l of lines) log(l);
writeFileSync(jsonAt, JSON.stringify(result, null, 2));
log(`written to ${logAt} and ${jsonAt}`);
process.exit(result.ok ? 0 : 1);
