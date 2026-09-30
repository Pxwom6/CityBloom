import { CELL } from '../data/zones';
import { GlbError, parseGlb, type GlbFile, type GlbPart } from './glb';
import { PART, ROLE_INDEX, budgetFor, targetOf, type ModelTarget } from './spec';

/**
 * `models:check`: is a hand-made model fit for the game? It is measured against the model spec
 * (docs/models/PROMPTS.md) and the game's own data (src/data). A model that fails is left out of
 * the game with a warning; the building keeps its generated look.
 */

export interface Box3 {
  min: [number, number, number];
  max: [number, number, number];
}

export function emptyBox(): Box3 {
  return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

export function growBox(b: Box3, tris: Float32Array): Box3 {
  for (let i = 0; i < tris.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k]!;
      if (v < b.min[k]!) b.min[k] = v;
      if (v > b.max[k]!) b.max[k] = v;
    }
  return b;
}

export function boxOf(parts: GlbPart[]): Box3 {
  const b = emptyBox();
  for (const p of parts) growBox(b, p.tris);
  return b;
}

/** Is this part (or a group above it) called `name`? */
export function under(p: GlbPart, name: string): boolean {
  return p.name === name || p.path.includes(name);
}

/** The groups named `name`: each as the parts at or below one node of that name. */
export function groupsNamed(file: GlbFile, name: string): GlbPart[][] {
  const byNode = new Map<number, GlbPart[]>();
  for (const p of file.parts) {
    // The outermost node of that name above the part (or the part's own node).
    let found = -1;
    for (let n = p.node; n >= 0; n = file.nodes[n]!.parent) if (file.nodes[n]!.name === name) found = n;
    if (found < 0) continue;
    let list = byNode.get(found);
    if (!list) byNode.set(found, (list = []));
    list.push(p);
  }
  return [...byNode.values()];
}

export interface ModelReport {
  file: string;
  /** The file name without `.glb`. */
  id: string;
  ok: boolean;
  target: ModelTarget | null;
  errors: string[];
  warnings: string[];
  /** Triangles the game would draw (tree_spot markers aside), and the budget from PROMPTS.md. */
  triangles: number;
  budget: number | undefined;
  /** The whole model's extent: along the road, up, and away from it (m). */
  size: [number, number, number];
  /** The footprint it was accepted at, and how many stand side by side on the type's own lot. */
  footprint: { w: number; d: number; abreast: number } | null;
  windows: number;
  bands: number;
  trees: number;
  stacks: number;
  parts: number;
}

const EXACT = 0.05;
/** How far trim, awnings, steps and the like may overhang a wall-to-wall building's footprint. */
const OVERHANG_FRONT = 1.6;
const OVERHANG_SIDE = 0.75;

/** A length to the centimetre, without trailing zeros. */
const f1 = (v: number) => String(Number(v.toFixed(2)));

/** Check a model file's bytes. Never throws: an unreadable file is a failed report. */
export function checkModel(bytes: Uint8Array, fileName: string, budgets: Map<string, number>): ModelReport {
  return inspectModel(bytes, fileName, budgets).report;
}

/** As `checkModel`, also handing back the parsed file (null when it couldn't be read). */
export function inspectModel(
  bytes: Uint8Array,
  fileName: string,
  budgets: Map<string, number>,
): { report: ModelReport; file: GlbFile | null } {
  const id = fileName.replace(/\.glb$/i, '');
  const report: ModelReport = {
    file: fileName,
    id,
    ok: false,
    target: targetOf(id),
    errors: [],
    warnings: [],
    triangles: 0,
    budget: budgetFor(id, budgets),
    size: [0, 0, 0],
    footprint: null,
    windows: 0,
    bands: 0,
    trees: 0,
    stacks: 0,
    parts: 0,
  };
  let file: GlbFile;
  try {
    file = parseGlb(bytes);
  } catch (e) {
    report.errors.push(e instanceof GlbError ? e.message : `can't be read (${(e as Error).message})`);
    return { report, file: null };
  }
  checkParsed(file, report);
  report.ok = report.errors.length === 0;
  return { report, file };
}

/** The checks themselves, on a parsed file. Fills in the report. */
export function checkParsed(file: GlbFile, report: ModelReport): void {
  const { errors, warnings } = report;
  const t = report.target;
  if (!t)
    errors.push(
      `"${report.id}" isn't a building in the game: name the file after a civic building's id, a zoned type's id (R103) or an annex (annex-engineBay)`,
    );

  if (file.images || file.textures)
    errors.push(`has textures (${file.images} images): the spec asks for plain colours only`);
  if (file.extensionsRequired.length)
    errors.push(`needs glTF extensions the game can't read: ${file.extensionsRequired.join(', ')}`);
  for (const n of file.notes) warnings.push(n);

  const parts = file.parts;
  report.parts = parts.length;
  if (!parts.length) {
    errors.push('has no meshes');
    return;
  }
  const drawn = parts.filter((p) => !under(p, PART.treeSpot));
  report.triangles = drawn.reduce((s, p) => s + p.tris.length / 9, 0);

  // Materials: named exactly by role.
  const unknown = new Map<string, string>();
  for (const p of parts)
    if (!ROLE_INDEX.has(p.material)) unknown.set(p.rawMaterial || '(none)', p.rawName || '(unnamed)');
  if (unknown.size)
    errors.push(
      `materials that aren't roles in the spec: ${[...unknown]
        .slice(0, 6)
        .map(([m, part]) => `"${m}" (on ${part})`)
        .join(', ')}${unknown.size > 6 ? `, and ${unknown.size - 6} more` : ''}`,
    );

  // Origin at ground level: the lowest point sits on y = 0 (a seaport's quay walls go below).
  const all = boxOf(parts);
  report.size = [all.max[0] - all.min[0], all.max[1] - all.min[1], all.max[2] - all.min[2]];
  const grounded = boxOf(parts.filter((p) => !under(p, 'quay')));
  if (grounded.min[1] < -EXACT)
    errors.push(`goes ${f1(-grounded.min[1])} m below the ground: the origin should be at ground level`);
  else if (all.min[1] > EXACT)
    errors.push(`floats ${f1(all.min[1])} m above the ground: the origin should be at ground level`);

  if (t) footprint(parts, all, t, report);
  facing(parts, report);

  // Windows: a group named "window" holding "window_glass"; bands on towers.
  const windows = groupsNamed(file, PART.window);
  const empty = windows.filter((g) => !g.some((p) => p.name === PART.windowGlass)).length;
  if (empty) errors.push(`${empty} window group${empty > 1 ? 's have' : ' has'} no window_glass inside`);
  const glass = parts.filter((p) => p.name === PART.windowGlass);
  report.windows = glass.length;
  report.bands = parts.filter((p) => p.name === PART.windowBand).length;
  const wrong = [...glass, ...parts.filter((p) => p.name === PART.windowBand)].filter(
    (p) => p.material !== 'glass' && p.material !== 'shop_glass',
  );
  if (wrong.length)
    warnings.push(
      `${wrong.length} window panes aren't in a glass material (${wrong[0]!.rawMaterial}): they won't light up`,
    );
  const anyGlass = parts.some((p) => p.material === 'glass' || p.material === 'shop_glass');
  if (t?.kind === 'zoned' && !anyGlass) warnings.push('has no glass: nothing lights up at night');

  // Smoke comes from the tops of parts named smoke_stack.
  report.stacks = groupsNamed(file, PART.smokeStack).length;
  if (t?.smokes && !report.stacks)
    errors.push('gives off smoke in the game but has no part named smoke_stack');
  if (t && !t.smokes && report.stacks)
    warnings.push(
      "has a smoke_stack, but this building doesn't smoke in the game: no smoke will come from it",
    );

  // Tree markers: 1 m cubes.
  const spots = groupsNamed(file, PART.treeSpot);
  report.trees = spots.length;
  const odd = spots.filter((g) => {
    const b = boxOf(g);
    return [0, 1, 2].some((k) => b.max[k]! - b.min[k]! < 0.4 || b.max[k]! - b.min[k]! > 2.5);
  }).length;
  if (odd) warnings.push(`${odd} tree_spot marker${odd > 1 ? 's are' : ' is'} not a 1 m cube`);

  if (t?.kind === 'civic' && t.def === 'landfill' && !groupsNamed(file, PART.mound).length)
    warnings.push("has no part named mound: the heap won't rise as the landfill fills");

  // The triangle budget.
  if (report.budget === undefined) warnings.push('has no triangle budget in PROMPTS.md');
  else if (report.triangles > report.budget)
    errors.push(
      `${report.triangles.toLocaleString('en-US')} triangles, over its budget of ${report.budget.toLocaleString('en-US')}`,
    );
}

/** The footprint against the lot or site in src/data: exact, centred on the origin, nothing outside. */
function footprint(parts: GlbPart[], all: Box3, t: ModelTarget, report: ModelReport): void {
  const { errors, warnings } = report;
  const w = all.max[0] - all.min[0];
  const d = all.max[2] - all.min[2];
  const cx = (all.max[0] + all.min[0]) / 2;
  const cz = (all.max[2] + all.min[2]) / 2;
  const site = t.kind === 'zoned' ? 'lot' : 'site';
  // Zoned models may be a half or a third of the lot's width (rows), and may stop short of the
  // back of the lot by whole cells (the game leaves a yard behind them).
  const widths = t.kind === 'zoned' ? [t.w, t.w / 2, t.w / 3] : [t.w];
  const depths = [t.d];
  if (t.kind === 'zoned') for (let x = t.d - CELL; x >= CELL - EXACT; x -= CELL) depths.push(x);
  const near = (a: number, b: number) => Math.abs(a - b) <= EXACT;
  const accept = (fw: number, fd: number) => {
    const abreast = Math.round(t.w / fw);
    report.footprint = { w: fw, d: fd, abreast };
    if (fd < t.d - EXACT)
      warnings.push(
        `${f1(fd)} m deep on a ${f1(t.d)} m ${site}: it stands at the front and the game leaves a yard behind`,
      );
  };

  // The usual case: the whole model is exactly the site.
  for (const fw of widths)
    for (const fd of depths)
      if (near(w, fw) && near(d, fd)) {
        if (Math.abs(cx) > EXACT || Math.abs(cz) > EXACT)
          errors.push(
            `the origin isn't at the centre of the ${site}: the model's middle is at x ${f1(cx)}, z ${f1(cz)}`,
          );
        accept(fw, fd);
        return;
      }

  // A wall-to-wall building (its walls are exactly a footprint) with trim, steps or awnings that
  // overhang it a little.
  const walls = parts.filter((p) => p.material === 'wall' || p.material === 'wall_alt');
  if (walls.length) {
    const wb = boxOf(walls);
    const ww = wb.max[0] - wb.min[0];
    const wd = wb.max[2] - wb.min[2];
    for (const fw of widths)
      for (const fd of depths) {
        if (!near(ww, fw) || !near(wd, fd)) continue;
        const wcx = (wb.max[0] + wb.min[0]) / 2;
        const wcz = (wb.max[2] + wb.min[2]) / 2;
        const over = {
          front: wb.min[2] - all.min[2],
          back: all.max[2] - wb.max[2],
          left: wb.min[0] - all.min[0],
          right: all.max[0] - wb.max[0],
        };
        if (over.front > OVERHANG_FRONT || Math.max(over.back, over.left, over.right) > OVERHANG_SIDE)
          continue;
        if (Math.abs(wcx) > EXACT || Math.abs(wcz) > EXACT)
          errors.push(
            `the origin isn't at the centre of the building: its walls' middle is at x ${f1(wcx)}, z ${f1(wcz)}`,
          );
        accept(fw, fd);
        warnings.push(
          `parts overhang its ${f1(fw)} × ${f1(fd)} m footprint: ${f1(over.front)} m at the front, ${f1(Math.max(over.left, over.right))} m at the sides, ${f1(over.back)} m at the back`,
        );
        return;
      }
  }

  // No match: say what it is, what it should be, and what sticks out.
  const rows = t.kind === 'zoned' ? ` (or ${f1(t.w / 2)} or ${f1(t.w / 3)} m wide, to stand in a row)` : '';
  errors.push(`is ${f1(w)} × ${f1(d)} m; its ${site} is ${f1(t.w)} × ${f1(t.d)} m${rows}`);
  const out: string[] = [];
  for (const p of parts) {
    const b = growBox(emptyBox(), p.tris);
    const past = Math.max(-t.w / 2 - b.min[0], b.max[0] - t.w / 2, -t.d / 2 - b.min[2], b.max[2] - t.d / 2);
    if (past > EXACT && !out.some((o) => o.startsWith(`${p.rawName} `)))
      out.push(`${p.rawName || '(unnamed)'} (${f1(past)} m outside)`);
  }
  if (out.length && out.length < parts.length)
    errors.push(
      `outside the ${site}: ${out.slice(0, 5).join(', ')}${out.length > 5 ? `, and ${out.length - 5} more` : ''}`,
    );
}

/** What shows which way a building faces, and how much each counts per square metre. */
const FRONT_EVIDENCE: [RegExp, number][] = [
  [/^(door|entrance|entrance_arch|storefront|storefront_glass|market_bay|lobby_glass)$/, 3],
  [/^(canopy|door_canopy|awning|porch|porch_roof|sign|stoop|step|steps)$/, 2],
  [/^garage_door$/, 0.5],
];

/**
 * The front faces −Z. Entrances, shopfronts, canopies, signs and garage doors say which way a
 * building faces: each is set in or against a wall and looks away from it. The side with the
 * weight of them is the front (a back door or a garage at the rear doesn't make a front).
 */
function facing(parts: GlbPart[], report: ModelReport): void {
  // An add-on annex is a wing in a back corner: its door can be on any side.
  if (report.target?.kind === 'annex') return;
  const { road, back, side } = frontEvidence(parts);
  if (back > road * 1.5 && back >= 4)
    report.errors.push(
      'the front faces +Z: its entrances, shopfronts and canopies look away from the road (turn the model half round)',
    );
  else if (road === 0 && back === 0 && side > 0)
    report.errors.push(
      'the front faces along X: every door and shopfront is in a side wall (turn the model a quarter round)',
    );
}

/** The weight of entrances and the like looking at the road (−Z), away from it, and sideways. */
export function frontEvidence(parts: GlbPart[]): {
  road: number;
  back: number;
  side: number;
  seen: string[];
} {
  const seen: string[] = [];
  const weightOf = (p: GlbPart): number => {
    for (const [re, w] of FRONT_EVIDENCE) if (re.test(p.name) || p.path.some((n) => re.test(n))) return w;
    return p.material === 'door' ? 3 : 0;
  };
  const fronts = parts.filter((p) => weightOf(p) > 0);
  const solids = parts
    .filter((p) => !fronts.includes(p) && p.material !== 'glass' && p.material !== 'frame')
    .map((p) => growBox(emptyBox(), p.tris))
    .filter((b) => b.max[1] - b.min[1] > 1.5);
  const inSolid = (x: number, y: number, z: number) =>
    solids.some(
      (b) => x > b.min[0] && x < b.max[0] && y > b.min[1] && y < b.max[1] && z > b.min[2] && z < b.max[2],
    );
  const walls = parts.filter((p) => p.material === 'wall' || p.material === 'wall_alt');
  const body = boxOf(walls.length ? walls : parts);
  const midZ = (body.min[2] + body.max[2]) / 2;
  let road = 0;
  let back = 0;
  let side = 0;
  for (const p of fronts) {
    const b = growBox(emptyBox(), p.tris);
    const cx = (b.min[0] + b.max[0]) / 2;
    const cy = Math.max(0.5, (b.min[1] + b.max[1]) / 2 - 0.5);
    const cz = (b.min[2] + b.max[2]) / 2;
    const ex = b.max[0] - b.min[0];
    const ey = b.max[1] - b.min[1];
    const ez = b.max[2] - b.min[2];
    const furniture = weightOf(p) === 2;
    // A door or a shopfront is a panel in a wall; a hall glazed all round says nothing.
    if (!furniture && Math.min(ex, ez) > 1.2) continue;
    const flat = furniture && ey <= ex && ey <= ez; // a canopy or a step: it lies against a wall
    const w = weightOf(p) * Math.min(flat ? ex * ez : Math.max(ex, ez) * ey, 40);
    const solidZ = inSolid(cx, cy, b.max[2] + 0.4) ? 1 : 0;
    const solidz = inSolid(cx, cy, b.min[2] - 0.4) ? 1 : 0;
    const solidX = inSolid(b.max[0] + 0.4, cy, cz) ? 1 : 0;
    const solidx = inSolid(b.min[0] - 0.4, cy, cz) ? 1 : 0;
    // Upright and thin across x: it is in a side wall.
    let where: 'road' | 'back' | 'side';
    if (!flat && ex < ez) where = 'side';
    else if (flat && solidX + solidx > 0 && solidZ + solidz === 0) where = 'side';
    else if (solidZ && !solidz) where = 'road';
    else if (solidz && !solidZ) where = 'back';
    else where = cz < midZ ? 'road' : 'back';
    if (where === 'road') road += w;
    else if (where === 'back') back += w;
    else side += w;
    seen.push(`${p.name} ${where} ${w.toFixed(1)}`);
  }
  return { road, back, side, seen };
}

/** The plain report `models:check` prints. */
export function formatReports(reports: ModelReport[]): string {
  const lines: string[] = [];
  const n = (v: number) => v.toLocaleString('en-US');
  for (const r of reports) {
    const what = r.target ? r.target.label : 'unknown building';
    if (r.ok) {
      const fp = r.footprint!;
      const row = fp.abreast > 1 ? `, ${fp.abreast} abreast` : '';
      const tri = r.budget ? `${n(r.triangles)} of ${n(r.budget)} triangles` : `${n(r.triangles)} triangles`;
      const bits = [
        r.windows + r.bands ? `${r.windows + r.bands} windows` : '',
        r.trees ? `${r.trees} trees` : '',
        r.stacks ? `${r.stacks} smoke stacks` : '',
      ].filter(Boolean);
      lines.push(
        `ok    ${r.file.padEnd(26)} ${what}: ${f1(fp.w)} × ${f1(fp.d)} m${row}, ${f1(r.size[1])} m tall, ${tri}${bits.length ? `, ${bits.join(', ')}` : ''}`,
      );
    } else {
      lines.push(`FAIL  ${r.file.padEnd(26)} ${what}: skipped, the game keeps its generated look`);
      for (const e of r.errors) lines.push(`        ✗ ${e}`);
    }
    for (const w of r.warnings) lines.push(`        · ${w}`);
  }
  const bad = reports.filter((r) => !r.ok).length;
  lines.push('');
  lines.push(
    `${reports.length} models: ${reports.length - bad} pass${bad ? `, ${bad} fail and are skipped` : ''}, ${reports.reduce((s, r) => s + r.warnings.length, 0)} notes`,
  );
  return lines.join('\n');
}
