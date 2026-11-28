/**
 * Replay a downloaded desync in Node and say where the hashes split (M41).
 *
 *   npx tsx scripts/desync.ts <desync.json> [--save start.citybloom] [--json]
 *
 * <desync.json> is a desync report as the owner area downloads it. A shared city founded on the
 * reporting machine replays from nothing more (the report carries its founding options and every
 * command since); otherwise give the city as it stood at the report's start with --save (saves are
 * never sent with reports), and it's checked against the start's checksum before anything runs.
 * Prints each hour's checksum from the replay beside the two sides', and the split: the first hour
 * the sides disagree, and which side left the replay where.
 */
import { readFileSync } from 'node:fs';
import { decodeSave } from '../src/client/saves';
import { desyncOf, replayDesync } from './lib/desyncReplay';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--save');
if (!file) {
  console.error('Usage: npx tsx scripts/desync.ts <desync.json> [--save start.citybloom] [--json]');
  process.exit(2);
}
const savePath = args.includes('--save') ? args[args.indexOf('--save') + 1] : undefined;
const d = desyncOf(JSON.parse(readFileSync(file, 'utf8')));
if (!d) {
  console.error(`${file} isn't a desync report.`);
  process.exit(2);
}
const result = replayDesync(d, savePath ? decodeSave(readFileSync(savePath)) : null);
if (args.includes('--json')) console.log(JSON.stringify(result, null, 1));
else {
  if (result.hours.length) {
    console.log('tick      replay                     this page                  other side');
    for (const h of result.hours) {
      const mark = (v?: string) =>
        v === undefined ? '-'.padEnd(26) : `${v === h.node ? ' ' : '≠'}${v}`.padEnd(26);
      console.log(`${String(h.tick).padEnd(9)} ${h.node.padEnd(26)} ${mark(h.mine)} ${mark(h.theirs)}`);
    }
  }
  console.log(result.text);
}
process.exit(result.ok ? 0 : 1);
