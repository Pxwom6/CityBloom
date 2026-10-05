// Dev: every zoned type, every lot it can stand on, and how many hand-made designs fit each lot
// (two or more: every look hand-made; one: it takes turns with the generator; none: generated).
// Lots follow growth.ts: a building is founded on its type's level-1 shape, and each upgrade takes
// the first of these that fits: the next type's shape, the lot it has made deeper, or the lot it has
// (a step up in density only onto a lot at least as big as the new type's). A shape within the lot
// it has always fits, so then it is the only outcome. Industry retools to another tier on its lot.
// Usage: npx tsx scripts/dev/modelcoverage.ts [root of another checkout to compare] [--all]
import { HandmadeModels } from '../../src/render/assets/handmade';
import { ZONED_DEFS, zonedDef, type Density, type Level } from '../../src/data/buildings';
import { CELL, ZONE_C, ZONE_I, ZONE_R, type ZoneCode } from '../../src/data/zones';
import { buildModels } from '../lib/modelPipeline';
import type { BakedModel } from '../../src/models/baked';

const argv = process.argv.slice(2);
const other = argv.find((a) => !a.startsWith('--'));
const all = argv.includes('--all');

type Lot = [number, number];
const key = (l: Lot): string => `${l[0]}x${l[1]}`;
/** The lots an upgrade to shape `s` can leave a building on lot `b` with. */
const upgrades = (b: Lot, s: Lot): Lot[] =>
  s[0] <= b[0] && s[1] <= b[1] ? [s] : [s, [b[0], Math.max(b[1], s[1])], b];

/** Lots (in cells) a building of this zone, density and level can stand on. */
function reachable(): Map<string, Lot[]> {
  const out = new Map<string, Lot[]>();
  const shape = (zone: ZoneCode, density: Density, level: Level): Lot => {
    const d = zonedDef(zone, density, 0, level);
    return [d.w, d.d];
  };
  for (const zone of [ZONE_R, ZONE_C, ZONE_I] as ZoneCode[]) {
    let prev3: Lot[] = [];
    for (const density of [0, 1, 2] as Density[]) {
      let lots = new Map<string, Lot>();
      const s1 = shape(zone, density, 1);
      lots.set(key(s1), s1);
      // A step up in density from the level-3 type below, onto a lot at least as big.
      for (const b of prev3) {
        for (const l of upgrades(b, s1)) {
          if (l[0] * l[1] >= s1[0] * s1[1]) lots.set(key(l), l);
        }
      }
      out.set(`${zone}${density}1`, [...lots.values()]);
      for (const level of [2, 3] as Level[]) {
        const s = shape(zone, density, level);
        const next = new Map<string, Lot>();
        for (const b of lots.values()) {
          for (const l of upgrades(b, s)) next.set(key(l), l);
        }
        lots = next;
        out.set(`${zone}${density}${level}`, [...lots.values()]);
      }
      prev3 = out.get(`${zone}${density}3`)!;
    }
  }
  return out;
}

function designsByDef(root: string): Map<string, BakedModel[]> {
  const by = new Map<string, BakedModel[]>();
  for (const m of buildModels(root).models) {
    if (m.kind !== 'zoned') continue;
    by.set(m.def, [...(by.get(m.def) ?? []), m]);
  }
  return by;
}

const lots = reachable();
const now = designsByDef('.');
const before = other ? designsByDef(other) : null;

let pairs = 0;
const short = { now: [0, 0], before: [0, 0] }; // [no design, one design]
const rows: string[] = [];
for (const def of ZONED_DEFS.values()) {
  const reach = lots.get(`${def.zone}${def.density}${def.level}`)!;
  for (const [w, d] of reach) {
    pairs++;
    const W = w * CELL;
    const D = d * CELL;
    const fit = (by: Map<string, BakedModel[]>): BakedModel[] =>
      (by.get(def.id) ?? []).filter((m) => HandmadeModels.fits(m, W, D));
    const n = fit(now);
    const b = before ? fit(before) : null;
    if (n.length < 2) short.now[n.length]!++;
    if (b && b.length < 2) short.before[b.length]!++;
    const base = w === def.w && d === def.d ? ' (its own shape)' : '';
    if (all || n.length < 2 || (b && b.length < 2)) {
      rows.push(
        `  ${`${def.id}@${W}×${D}${base}`.padEnd(30)} ` +
          (b ? `${String(b.length).padStart(2)} → ` : '') +
          `${String(n.length).padStart(2)}  ${n.map((m) => m.id).join(' ')}`,
      );
    }
  }
}
console.log(`${ZONED_DEFS.size} zoned types, ${pairs} type-and-lot pairs they can stand on`);
if (before) {
  console.log(
    `before (${other}): ${short.before[0]} with no design, ${short.before[1]} with one (takes turns with the generator)`,
  );
}
console.log(`now: ${short.now[0]} with no design, ${short.now[1]} with one (takes turns with the generator)`);
console.log(all ? 'every pair:' : 'pairs with fewer than two designs (before or now):');
for (const r of rows) console.log(r);
