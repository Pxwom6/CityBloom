// Dev: spoil a good model on purpose, to see `models:check` catch it.
// Usage: npx tsx scripts/dev/breakmodel.ts assets/models/firestation.glb out/firestation.glb turn
//        (turn | shift | scale | float | sink | texture | material | nostack | noglass)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BREAKS, breakModel } from '../lib/breakModel';

const [src, out, how] = process.argv.slice(2);
if (!src || !out || !how || !BREAKS[how])
  throw new Error(`usage: breakmodel.ts in.glb out.glb ${Object.keys(BREAKS).join('|')}`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, breakModel(readFileSync(src), how));
console.log(`${out}: ${src} ${BREAKS[how]!.what}`);
