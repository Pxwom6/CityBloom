// Dev: the hand-made models compared batch by batch (which `docs/models/PROMPTS*.md` names each
// file; a later batch wins): triangles against the budget, what is left near, far and in the
// skyline, the packed file's size, how much of the paintwork the game repaints (walls, roofs,
// awnings and signs whose colour is near one of its palettes) and what lights at night: windows lit
// one by one, and glass outside any window (glows whole) with its longest piece.
// Usage: npx tsx scripts/dev/batchstats.ts [--models] [--zoned] [--only C02,I02 …] [--as id=batch,…]
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Color } from 'three';
import { nearestPalette } from '../../src/render/assets/handmade';
import {
  TRI_FAR,
  TRI_NEAR,
  TRI_SKY,
  UNIT_BAND,
  UNIT_GLOW,
  UNIT_SHOP,
  UNIT_WINDOW,
} from '../../src/models/baked';
import type { BakedModel } from '../../src/models/baked';
import { encodeModels } from '../../src/models/codec';
import { REPAINTED, ROLES, type Role } from '../../src/models/spec';
import { buildModels } from '../lib/modelPipeline';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const perModel = argv.includes('--models');
const zonedOnly = argv.includes('--zoned');
const only = flag('only')?.split(',');
const as = new Map((flag('as')?.split(',') ?? []).map((s) => s.split('=') as [string, string]));

// Which batch's prompts name each file.
const batchOf = new Map<string, string>();
const prompts = readdirSync('docs/models')
  .filter((f) => /^PROMPTS(-\d+)?\.md$/.test(f))
  .map((f) => ({ f, n: Number(/-(\d+)/.exec(f)?.[1] ?? 1) }))
  .sort((a, b) => a.n - b.n);
for (const { f, n } of prompts) {
  for (const m of readFileSync(`docs/models/${f}`, 'utf8').matchAll(/`([A-Za-z0-9_-]+)\.glb`/g)) {
    batchOf.set(m[1]!, String(n));
  }
}
for (const [id, b] of as) batchOf.set(id, b);

interface Stats {
  id: string;
  batch: string;
  tris: number;
  budget: number | undefined;
  near: number;
  far: number;
  sky: number;
  vertsPerTri: number;
  gzBytes: number;
  painted: number; // area in repainted roles
  repainted: number; // … of it near a palette (so the game repaints it)
  kept: string[]; // repainted roles the game keeps (colour far from every palette)
  windows: number; // window units lit one by one (runs counted)
  glowUnits: number;
  glowArea: number;
  glowLongest: number;
  shopLongest: number;
  litArea: number; // all glass that lights
  wallArea: number; // wall + wall_alt + trim
  h: number;
}

const { models, reports } = buildModels();
const budgetOf = new Map(reports.map((r) => [r.id, r.budget]));
const rows: Stats[] = [];
for (const m of models) {
  if (zonedOnly && m.kind !== 'zoned') continue;
  if (only && !only.some((p) => m.id.startsWith(p))) continue;
  rows.push(stats(m));
}

function stats(m: BakedModel): Stats {
  const P = m.positions;
  const I = m.index;
  const area = (t: number): number => {
    const a = I[3 * t]! * 3;
    const b = I[3 * t + 1]! * 3;
    const c = I[3 * t + 2]! * 3;
    const ux = P[b]! - P[a]!;
    const uy = P[b + 1]! - P[a + 1]!;
    const uz = P[b + 2]! - P[a + 2]!;
    const vx = P[c]! - P[a]!;
    const vy = P[c + 1]! - P[a + 1]!;
    const vz = P[c + 2]! - P[a + 2]!;
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  };
  const roleArea = new Map<number, number>();
  const unitBox = new Map<number, [number, number, number, number, number, number]>();
  const unitArea = new Map<number, number>();
  const nTri = I.length / 3;
  for (let t = 0; t < nTri; t++) {
    if (!(m.triFlags[t]! & TRI_NEAR)) continue;
    const a = area(t);
    roleArea.set(m.triRole[t]!, (roleArea.get(m.triRole[t]!) ?? 0) + a);
    const u = m.triUnit[t]!;
    if (!u) continue;
    unitArea.set(u, (unitArea.get(u) ?? 0) + a);
    const box = unitBox.get(u) ?? [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) {
      const v = I[3 * t + k]! * 3;
      for (let j = 0; j < 3; j++) {
        box[j] = Math.min(box[j]!, P[v + j]!);
        box[j + 3] = Math.max(box[j + 3]!, P[v + j]!);
      }
    }
    unitBox.set(u, box);
  }
  let painted = 0;
  let repainted = 0;
  const kept: string[] = [];
  for (const role of REPAINTED) {
    const r = ROLES.indexOf(role);
    const a = roleArea.get(r) ?? 0;
    const c = m.colors[r];
    if (!a || !c) continue;
    painted += a;
    if (nearestPalette(role as Role, new Color(...c))) repainted += a;
    else kept.push(`${role} #${new Color(...c).getHexString()}`);
  }
  let windows = 0;
  let glowUnits = 0;
  let glowArea = 0;
  let glowLongest = 0;
  let shopLongest = 0;
  let litArea = 0;
  for (const [u, a] of unitArea) {
    const kind = m.units[u - 1];
    const b = unitBox.get(u)!;
    const longest = Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    if (kind === UNIT_WINDOW || kind === UNIT_BAND) windows++;
    if (kind === UNIT_GLOW) {
      glowUnits++;
      glowArea += a;
      glowLongest = Math.max(glowLongest, longest);
    }
    if (kind === UNIT_SHOP) shopLongest = Math.max(shopLongest, longest);
    if (kind === UNIT_WINDOW || kind === UNIT_BAND || kind === UNIT_GLOW || kind === UNIT_SHOP) litArea += a;
  }
  const wallArea = ['wall', 'wall_alt', 'trim'].reduce(
    (s, r) => s + (roleArea.get(ROLES.indexOf(r as Role)) ?? 0),
    0,
  );
  return {
    id: m.id,
    batch: batchOf.get(m.id) ?? '?',
    tris: m.counts.file,
    budget: budgetOf.get(m.id),
    near: m.counts.near,
    far: m.triFlags.filter((f) => f & TRI_FAR).length,
    sky: m.triFlags.filter((f) => f & TRI_SKY).length,
    vertsPerTri: P.length / 3 / nTri,
    gzBytes: gzipSync(encodeModels([m]), { level: 9 }).length,
    painted,
    repainted,
    kept,
    windows,
    glowUnits,
    glowArea,
    glowLongest,
    shopLongest,
    litArea,
    wallArea,
    h: m.h,
  };
}

const pct = (a: number, b: number): string => (b ? `${Math.round((100 * a) / b)}%` : '-');
const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : 0;
};

if (perModel) {
  for (const s of rows.sort((a, b) => a.id.localeCompare(b.id))) {
    console.log(
      `${s.id.padEnd(14)} b${s.batch.padEnd(4)} tris ${String(s.tris).padStart(5)}/${String(s.budget ?? '-').padEnd(5)} far ${pct(s.far, s.near).padStart(4)} sky ${pct(s.sky, s.near).padStart(4)}  v/t ${s.vertsPerTri.toFixed(2)}  ${(s.gzBytes / 1024).toFixed(1).padStart(5)} KB gz  repainted ${pct(s.repainted, s.painted).padStart(4)}  windows ${String(s.windows).padStart(4)}  lit ${s.litArea.toFixed(0).padStart(4)} m² (${pct(s.litArea, s.wallArea + s.litArea)} of facade)  glow ${s.glowUnits} (${s.glowArea.toFixed(0)} m², longest ${s.glowLongest.toFixed(1)} m)  shop longest ${s.shopLongest.toFixed(1)} m${s.kept.length ? `  kept: ${s.kept.join(', ')}` : ''}`,
    );
  }
  console.log();
}

const batches = [...new Set(rows.map((s) => s.batch))].sort();
console.log(
  'batch  models  budget used  far/near  sky/near  verts/tri  KB gz/model  B gz/tri  repainted  keep a colour  windows/model  lit share  glowing glass  glow > 4.5 m',
);
for (const b of batches) {
  const rs = rows.filter((s) => s.batch === b);
  const withBudget = rs.filter((s) => s.budget);
  const tris = rs.reduce((n, s) => n + s.tris, 0);
  const gz = rs.reduce((n, s) => n + s.gzBytes, 0);
  console.log(
    `${b.padEnd(6)} ${String(rs.length).padStart(6)}  ${pct(mean(withBudget.map((s) => s.tris / s.budget!)), 1).padStart(11)}  ${pct(mean(rs.map((s) => s.far / s.near)), 1).padStart(8)}  ${pct(mean(rs.map((s) => s.sky / s.near)), 1).padStart(8)}  ${mean(
      rs.map((s) => s.vertsPerTri),
    )
      .toFixed(2)
      .padStart(
        9,
      )}  ${(gz / 1024 / rs.length).toFixed(1).padStart(11)}  ${(gz / tris).toFixed(2).padStart(8)}  ${pct(
      rs.reduce((n, s) => n + s.repainted, 0),
      rs.reduce((n, s) => n + s.painted, 0),
    ).padStart(
      9,
    )}  ${String(rs.filter((s) => s.kept.length).length).padStart(13)}  ${String(Math.round(median(rs.map((s) => s.windows)))).padStart(13)}  ${pct(mean(rs.map((s) => s.litArea / (s.wallArea + s.litArea || 1))), 1).padStart(9)}  ${String(rs.filter((s) => s.glowUnits).length).padStart(13)}  ${String(rs.filter((s) => s.glowLongest > 4.5).length).padStart(12)}`,
  );
}
