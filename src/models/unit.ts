import { UNIT, type UnitDomain, type UnitKind } from '../data/war';
import { UNIT_ROLES, type BakedUnit } from './baked';
import { emptyBox, growBox, orientFaces, type Box3 } from './check';
import { GlbError, parseGlb, type GlbFile } from './glb';
import { budgetFor } from './spec';

/**
 * The unit spec (v1, docs/models/PROMPTS-WAR.md) at build time: is a hand-made unit fit for the
 * game, and its conversion into what the game ships (`BakedUnit`, src/models/baked.ts). Units are
 * war models (phase 5): they go in the war models file, never the main one. A unit that fails is
 * left out with a warning, and the game draws its generated look.
 */

/** The moving parts the spec names: each its own node, turning about the node's origin. */
export const MOVING = new Set([
  'turret',
  'barrel',
  'rotor',
  'tail_rotor',
  'propeller',
  'wheel',
  'track_left',
  'track_right',
  'hatch',
  'ramp',
  'radar_dish',
  'crane',
  'windup_key',
  'arm_left',
  'arm_right',
  'leg_left',
  'leg_right',
  'tail',
  'jaw',
]);
/** Parts that spin about their own centre; the rest hinge at a joint (a ramp's bottom edge, a shoulder). */
const SPINS = new Set(['turret', 'rotor', 'tail_rotor', 'propeller', 'wheel', 'radar_dish', 'windup_key']);
/** A 0.3 m cube where it fires from: not drawn. */
export const MUZZLE = 'muzzle';
/** Where engine smoke comes from: drawn, and marked. */
export const EXHAUST = 'exhaust';

/** Units whose kind the game doesn't have yet (the atom bomb, M40): where each goes. */
export const LATER_UNITS: Record<string, UnitDomain> = {
  atombomb: 'air',
};

/** The moving parts and markers each unit's prompt names, and how many at least. */
export const UNIT_PARTS: Record<string, Record<string, number>> = {
  infantry: {},
  tank: { track_left: 1, track_right: 1, turret: 1, barrel: 1, muzzle: 1 },
  heavytank: { track_left: 1, track_right: 1, turret: 1, barrel: 1, muzzle: 1, exhaust: 1 },
  artillery: { wheel: 6, turret: 1, barrel: 1, muzzle: 1 },
  transport: { wheel: 6 },
  repair: { crane: 1 },
  fighter: { wheel: 3, muzzle: 1, exhaust: 1 },
  bomber: { propeller: 4, hatch: 1, wheel: 1 },
  helicopter: { rotor: 1, tail_rotor: 1, muzzle: 1 },
  drone: { propeller: 4 },
  patrolboat: { turret: 1, barrel: 1, muzzle: 1, exhaust: 1 },
  gunboat: { turret: 2, barrel: 2, muzzle: 2, exhaust: 1 },
  submarine: { propeller: 1 },
  landingcraft: { ramp: 1, propeller: 2 },
  windupbot: { arm_left: 1, arm_right: 1, leg_left: 1, leg_right: 1, windup_key: 1 },
  skyfortress: { hatch: 2, propeller: 4 },
  clockworkwhale: { windup_key: 1, tail: 1, jaw: 1 },
  atombomb: { exhaust: 1 },
};

/** Parts drawn from the inside on purpose, never turned round: the whale's mouth (its faces look into it). */
export const INSIDE_OUT: Record<string, readonly string[]> = {
  clockworkwhale: ['mouth', 'jaw_inside'],
};

export const UNIT_ROLE_INDEX = new Map<string, number>(UNIT_ROLES.map((r, i) => [r, i]));

/** How far a unit may be from its prompt's size (the spec: within about 10 %). */
const SIZE_SLACK = 0.1;
/** Resting on 0, and a muzzle's size (m). */
const EXACT = 0.05;
const MUZZLE_SIZE = [0.15, 0.6];

/**
 * What the far version keeps: a part as big face on (its second-largest dimension) as this share
 * of the unit's longest side, and never less than `FAR_MIN` m; a long one (a stripe down a hull)
 * `FAR_LONG` times that long and a third as wide; and what moves (a barrel, a dish, a rotor) if it
 * is that long. Studs, lamps, windows, bolts and bars go; hulls, turrets, barrels, wheels, rotors
 * and limbs stay.
 */
const FAR_SHARE = 0.04;
const FAR_MIN = 0.35;
const FAR_LONG = 3;

export interface UnitReport {
  file: string;
  /** The file name without `.glb` (`unit-tank`). */
  id: string;
  /** The unit kind it stands for (`tank`), and whether the game has that kind yet. */
  kind: string | null;
  known: boolean;
  domain: UnitDomain | null;
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Triangles drawn (muzzles aside), and the budget from its prompt. */
  triangles: number;
  budget: number | undefined;
  /** Length (z), width (x) and height above 0; how far it goes below 0 (m). */
  size: [number, number, number];
  depth: number;
  /** Moving parts and markers by name, how many of each. */
  parts: Record<string, number>;
}

const f1 = (v: number) => String(Number(v.toFixed(2)));

/** The node a part's triangles turn with: the innermost moving node at or above it, or −1 (the body). */
function movingOf(file: GlbFile, node: number): number {
  for (let n = node; n >= 0; n = file.nodes[n]!.parent) if (MOVING.has(file.nodes[n]!.name)) return n;
  return -1;
}

/** The nearest node named `name` at or above a node, or −1. */
function named(file: GlbFile, node: number, name: string): number {
  for (let n = node; n >= 0; n = file.nodes[n]!.parent) if (file.nodes[n]!.name === name) return n;
  return -1;
}

/** Check a unit file's bytes. Never throws: an unreadable file is a failed report. */
export function checkUnit(bytes: Uint8Array, fileName: string, budgets: Map<string, number>): UnitReport {
  return inspectUnit(bytes, fileName, budgets).report;
}

/** As `checkUnit`, also handing back the parsed file (null when it couldn't be read). */
export function inspectUnit(
  bytes: Uint8Array,
  fileName: string,
  budgets: Map<string, number>,
): { report: UnitReport; file: GlbFile | null } {
  const id = fileName.replace(/\.glb$/i, '');
  const stem = /^unit-(.+)$/.exec(id)?.[1] ?? null;
  const def = stem ? UNIT.get(stem as UnitKind) : undefined;
  const report: UnitReport = {
    file: fileName,
    id,
    kind: stem,
    known: !!def,
    domain: def?.domain ?? (stem ? (LATER_UNITS[stem] ?? null) : null),
    ok: false,
    errors: [],
    warnings: [],
    triangles: 0,
    budget: budgetFor(id, budgets),
    size: [0, 0, 0],
    depth: 0,
    parts: {},
  };
  let file: GlbFile;
  try {
    file = parseGlb(bytes);
  } catch (e) {
    report.errors.push(e instanceof GlbError ? e.message : `can't be read (${(e as Error).message})`);
    return { report, file: null };
  }
  try {
    checkUnitParsed(file, report);
  } catch (e) {
    report.errors.push(`can't be checked (${(e as Error).message})`);
  }
  report.ok = report.errors.length === 0;
  return { report, file };
}

function checkUnitParsed(file: GlbFile, report: UnitReport): void {
  const { errors, warnings } = report;
  const stem = report.kind;
  if (!stem || !report.domain)
    errors.push(
      `"${report.id}" isn't a unit in the game: name the file unit-<kind> after a unit in src/data/war.ts (unit-tank)`,
    );
  else if (!report.known)
    warnings.push(`"${stem}" isn't a unit in the game yet: checked and packed for later`);
  if (file.images || file.textures)
    errors.push(`has textures (${file.images} images): the spec asks for plain colours only`);
  if (file.extensionsRequired.length)
    errors.push(`needs glTF extensions the game can't read: ${file.extensionsRequired.join(', ')}`);
  for (const n of file.notes) warnings.push(n);
  if (!file.parts.length) {
    errors.push('has no meshes');
    return;
  }

  // Materials: the unit spec's roles.
  const unknown = new Map<string, string>();
  for (const p of file.parts)
    if (!UNIT_ROLE_INDEX.has(p.material)) unknown.set(p.rawMaterial || '(none)', p.rawName || '(unnamed)');
  if (unknown.size)
    errors.push(
      `materials that aren't roles in the unit spec: ${[...unknown]
        .slice(0, 6)
        .map(([m, part]) => `"${m}" (on ${part})`)
        .join(', ')}${unknown.size > 6 ? `, and ${unknown.size - 6} more` : ''}`,
    );

  const drawn = file.parts.filter((p) => named(file, p.node, MUZZLE) < 0);
  report.triangles = drawn.reduce((s, p) => s + p.tris.length / 9, 0);
  if (!report.triangles) errors.push('has nothing to draw');

  // Size, origin and where it rests.
  const all = emptyBox();
  for (const p of drawn) growBox(all, p.tris);
  const length = all.max[2] - all.min[2];
  const width = all.max[0] - all.min[0];
  report.size = [length, width, Math.max(0, all.max[1])];
  report.depth = Math.max(0, -all.min[1]);
  const expected = UNIT.get(stem as UnitKind)?.size;
  if (expected) {
    const names = ['long', 'wide', 'tall'];
    const off = report.size
      .map((v, k) => [v, expected[k]!, names[k]!] as const)
      .filter(([v, e]) => Math.abs(v / e - 1) > SIZE_SLACK);
    if (off.length)
      errors.push(
        `is ${off.map(([v, e, n]) => `${f1(v)} m ${n} (its prompt: ${f1(e)})`).join(', ')}: more than ${SIZE_SLACK * 100} % off`,
      );
  }
  const cx = (all.min[0] + all.max[0]) / 2;
  const cz = (all.min[2] + all.max[2]) / 2;
  if (Math.abs(cx) > Math.max(0.15, width * 0.1) || Math.abs(cz) > Math.max(0.15, length * 0.1))
    errors.push(`the origin isn't under its middle: its middle is at x ${f1(cx)}, z ${f1(cz)}`);
  if (report.domain === 'sea') {
    if (all.min[1] > -EXACT)
      errors.push("its hull doesn't go below the waterline: a ship's waterline is at 0");
    else if (all.max[1] <= EXACT)
      errors.push('it is all below the waterline: a ship floats with its waterline at 0');
  } else if (report.domain) {
    if (all.min[1] < -EXACT)
      errors.push(`goes ${f1(-all.min[1])} m below the ground: the origin should be where it rests`);
    else if (all.min[1] > EXACT)
      errors.push(`floats ${f1(all.min[1])} m above the ground: wheels, tracks, feet or skids touch 0`);
  }

  // Moving parts and markers.
  const counts: Record<string, number> = {};
  for (const n of file.nodes)
    if (MOVING.has(n.name) || n.name === MUZZLE || n.name === EXHAUST)
      counts[n.name] = (counts[n.name] ?? 0) + 1;
  report.parts = counts;
  const missing = Object.entries(UNIT_PARTS[stem ?? ''] ?? {}).filter(([n, k]) => (counts[n] ?? 0) < k);
  if (missing.length)
    errors.push(
      `its prompt names parts it doesn't have: ${missing.map(([n, k]) => `${k > 1 ? `${k} × ` : ''}${n} (${counts[n] ?? 0} found)`).join(', ')}`,
    );

  // Each moving part turns about its node's origin: it must be on the part (a spinning one at its centre).
  const own = new Map<number, Box3>();
  for (const p of drawn) {
    const m = movingOf(file, p.node);
    if (m < 0) continue;
    let b = own.get(m);
    if (!b) own.set(m, (b = emptyBox()));
    growBox(b, p.tris);
  }
  const off: string[] = [];
  const offCentre: string[] = [];
  const turned: string[] = [];
  file.nodes.forEach((n, i) => {
    if (!MOVING.has(n.name)) return;
    const b = own.get(i);
    if (!b) {
      warnings.push(`${n.name} has nothing of its own to draw`);
      return;
    }
    const o = n.origin;
    const ext = [0, 1, 2].map((k) => b.max[k]! - b.min[k]!);
    const slack = (k: number) => Math.max(0.5, ext[k]! * 0.25);
    if ([0, 1, 2].some((k) => o[k]! < b.min[k]! - slack(k) || o[k]! > b.max[k]! + slack(k))) off.push(n.name);
    else if (SPINS.has(n.name)) {
      const centred = [0, 1, 2].filter(
        (k) => Math.abs(o[k]! - (b.min[k]! + b.max[k]!) / 2) <= Math.max(0.1, ext[k]! * 0.1),
      ).length;
      if (centred < 2) offCentre.push(n.name);
    }
    // Turned or scaled in the file: its triangles are baked as they stand, so it still turns about
    // its origin in model space.
    const w = n.world;
    const identity = [w[0]! - 1, w[1]!, w[2]!, w[4]!, w[5]! - 1, w[6]!, w[8]!, w[9]!, w[10]! - 1].every(
      (v) => Math.abs(v) < 1e-4,
    );
    if (!identity) turned.push(n.name);
  });
  const list = (a: string[]) => [...new Set(a)].join(', ');
  if (off.length)
    errors.push(
      `moving parts whose origin isn't on them (they'd swing round a point off the part): ${list(off)}`,
    );
  if (offCentre.length)
    warnings.push(`spinning parts whose origin isn't at their centre: ${list(offCentre)}`);
  if (turned.length)
    warnings.push(`moving parts turned or scaled in the file (baked as they stand): ${list(turned)}`);

  // Muzzles: 0.3 m cubes.
  const muzzles = new Map<number, Box3>();
  for (const p of file.parts) {
    const m = named(file, p.node, MUZZLE);
    if (m < 0) continue;
    let b = muzzles.get(m);
    if (!b) muzzles.set(m, (b = emptyBox()));
    growBox(b, p.tris);
  }
  const odd = [...muzzles.values()].filter((b) =>
    [0, 1, 2].some((k) => b.max[k]! - b.min[k]! < MUZZLE_SIZE[0]! || b.max[k]! - b.min[k]! > MUZZLE_SIZE[1]!),
  ).length;
  if (odd) warnings.push(`${odd} muzzle${odd > 1 ? 's are' : ' is'} not a 0.3 m cube`);

  // Faces wound inside out in a closed part (the whale's mouth looks inward on purpose).
  const keep = INSIDE_OUT[stem ?? ''] ?? [];
  const insideOut = new Map<string, number>();
  for (const p of drawn) {
    if (keep.includes(p.name)) continue;
    const t = orientFaces(p.tris).turned;
    if (t) insideOut.set(p.rawName || '(unnamed)', (insideOut.get(p.rawName || '(unnamed)') ?? 0) + t);
  }
  if (insideOut.size)
    warnings.push(
      `faces wound inside out: ${[...insideOut].map(([n, k]) => `${k} in ${n}`).join(', ')}; the game turns them round`,
    );
  if (keep.length && file.parts.some((p) => keep.includes(p.name)))
    warnings.push(`${keep.join(' and ')}: drawn from the inside on purpose, left as they are`);

  if (report.budget === undefined) warnings.push('has no triangle budget in docs/models/PROMPTS*.md');
  else if (report.triangles > report.budget)
    errors.push(
      `${report.triangles.toLocaleString('en-US')} triangles, over its budget of ${report.budget.toLocaleString('en-US')}`,
    );
}

/** Where smoke leaves an exhaust: the top of an upright one, else its end facing away from the unit's middle. */
function outlet(e: Box3, unit: Box3): [number, number, number] {
  const c = [0, 1, 2].map((k) => (e.min[k]! + e.max[k]!) / 2) as [number, number, number];
  const ext = [0, 1, 2].map((k) => e.max[k]! - e.min[k]!);
  if (ext[1]! >= 1.2 * Math.max(ext[0]!, ext[2]!) && c[1] >= (unit.min[1] + unit.max[1]) / 2) {
    c[1] = e.max[1];
    return c;
  }
  let axis = 0;
  let most = -Infinity;
  for (let k = 0; k < 3; k++) {
    const half = Math.max(1e-6, (unit.max[k]! - unit.min[k]!) / 2);
    const away = Math.abs(c[k]! - (unit.min[k]! + unit.max[k]!) / 2) / half;
    if (away > most) [most, axis] = [away, k];
  }
  c[axis] = c[axis]! >= (unit.min[axis]! + unit.max[axis]!) / 2 ? e.max[axis]! : e.min[axis]!;
  return c;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r3v = (v: readonly number[]) => [r3(v[0]!), r3(v[1]!), r3(v[2]!)] as [number, number, number];

/** Convert a checked unit into what the game loads (`BakedUnit`, src/models/baked.ts). */
export function bakeUnit(file: GlbFile, report: UnitReport): BakedUnit {
  if (!report.ok || !report.kind) throw new Error(`${report.id}: can't bake a unit that failed its check`);
  const keep = INSIDE_OUT[report.kind] ?? [];

  // Moving parts in the file's order, each with the moving part it hangs from (a barrel its turret).
  const order: number[] = [];
  file.nodes.forEach((n, i) => {
    if (MOVING.has(n.name)) order.push(i);
  });
  const index = new Map<number, number>(order.map((n, k) => [n, k + 1]));
  const parts = order.map((n) => ({
    name: file.nodes[n]!.name,
    parent: index.get(movingOf(file, file.nodes[n]!.parent)) ?? 0,
    pivot: r3v(file.nodes[n]!.origin),
  }));

  const drawn = file.parts.filter((p) => named(file, p.node, MUZZLE) < 0);
  const all = emptyBox();
  for (const p of drawn) growBox(all, p.tris);
  const longest = Math.max(all.max[0] - all.min[0], all.max[1] - all.min[1], all.max[2] - all.min[2]);
  const farMin = Math.max(FAR_MIN, longest * FAR_SHARE);

  // Markers: muzzles (not drawn) and exhausts (drawn, and marked), each by the part it moves with.
  const boxes = (name: string) => {
    const out = new Map<number, Box3>();
    for (const p of file.parts) {
      const m = named(file, p.node, name);
      if (m < 0) continue;
      let b = out.get(m);
      if (!b) out.set(m, (b = emptyBox()));
      growBox(b, p.tris);
    }
    return out;
  };
  const muzzles = [...boxes(MUZZLE)].map(([n, b]) => ({
    part: index.get(movingOf(file, file.nodes[n]!.parent)) ?? 0,
    at: r3v([0, 1, 2].map((k) => (b.min[k]! + b.max[k]!) / 2)),
  }));
  const exhausts = [...boxes(EXHAUST)].map(([n, b]) => ({
    part: index.get(movingOf(file, n)) ?? 0,
    at: r3v(outlet(b, all)),
  }));

  const pos: number[] = [];
  const role: number[] = [];
  const part: number[] = [];
  const far: number[] = [];
  const colors: Record<number, [number, number, number]> = {};
  for (const p of drawn) {
    const r = UNIT_ROLE_INDEX.get(p.material) ?? 0;
    colors[r] ??= p.color;
    const k = index.get(movingOf(file, p.node)) ?? 0;
    const b = growBox(emptyBox(), p.tris);
    const ext = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]].sort((x, y) => y - x);
    const kept =
      ext[1]! >= farMin ||
      (ext[0]! >= FAR_LONG * farMin && ext[1]! >= farMin / 3) ||
      (k > 0 && ext[0]! >= farMin)
        ? 1
        : 0;
    const tris = keep.includes(p.name) ? p.tris : orientFaces(p.tris).tris;
    for (let i = 0; i < tris.length; i += 9) {
      for (let c = 0; c < 9; c++) pos.push(tris[i + c]!);
      role.push(r);
      part.push(k);
      far.push(kept);
    }
  }

  // Weld equal corners (to the millimetre); normals are rebuilt from the winding.
  const idx = new Uint32Array(pos.length / 3);
  const unique: number[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.length; i += 3) {
    const v = r3v([pos[i]!, pos[i + 1]!, pos[i + 2]!]);
    const key = v.join(',');
    let at = seen.get(key);
    if (at === undefined) {
      at = unique.length / 3;
      seen.set(key, at);
      unique.push(...v);
    }
    idx[i / 3] = at;
  }
  const fileTris = file.parts.reduce((s, p) => s + p.tris.length / 9, 0);
  return {
    id: report.id,
    kind: report.kind,
    size: r3v(report.size),
    depth: r3(report.depth),
    positions: new Float32Array(unique),
    index: idx,
    triRole: Uint8Array.from(role),
    triPart: Uint8Array.from(part),
    triFar: Uint8Array.from(far),
    colors,
    parts,
    muzzles,
    exhausts,
    counts: { file: fileTris, near: role.length, far: far.filter((f) => f).length },
  };
}

/** The plain report `models:check` prints for units. */
export function formatUnitReports(reports: UnitReport[]): string {
  const lines: string[] = [];
  const n = (v: number) => v.toLocaleString('en-US');
  for (const r of reports) {
    const what = r.known ? r.kind : r.kind ? `${r.kind} (not in the game yet)` : 'unknown unit';
    if (r.ok) {
      const [l, w, h] = r.size;
      const tri = r.budget ? `${n(r.triangles)} of ${n(r.budget)} triangles` : `${n(r.triangles)} triangles`;
      const moving = Object.entries(r.parts)
        .map(([name, k]) => (k > 1 ? `${k} ${name}` : name))
        .join(', ');
      lines.push(
        `ok    ${r.file.padEnd(26)} ${what}: ${f1(l)} × ${f1(w)} m, ${f1(h)} m tall${r.domain === 'sea' ? ` above the waterline, ${f1(r.depth)} m below` : ''}, ${tri}${moving ? `; ${moving}` : ''}`,
      );
    } else {
      lines.push(`FAIL  ${r.file.padEnd(26)} ${what}: skipped, the game keeps its generated look`);
      for (const e of r.errors) lines.push(`        ✗ ${e}`);
    }
    for (const w of r.warnings) lines.push(`        · ${w}`);
  }
  return lines.join('\n');
}
