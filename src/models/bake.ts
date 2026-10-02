import type { GlbFile, GlbPart } from './glb';
import {
  boxOf,
  emptyBox,
  groundLift,
  growBox,
  groupsNamed,
  onGround,
  under,
  type Box3,
  type ModelReport,
} from './check';
import { PART, ROLE_INDEX } from './spec';
import {
  DRIVEN_GROUPS,
  FAR_KEEP,
  SKY_KEEP,
  TRI_FAR,
  TRI_GROUND,
  TRI_NEAR,
  TRI_PARTY_NEG,
  TRI_PARTY_POS,
  TRI_SKY,
  TRI_TWO_SIDED,
  UNIT_BAND,
  UNIT_DARK,
  UNIT_GLOW,
  UNIT_SHOP,
  UNIT_WINDOW,
  type BakedModel,
} from './baked';

/**
 * Build-time conversion of a checked model into what the game ships (phase 3): plain triangles
 * with every part's transform baked in, each tagged with its material role, its part and the
 * window it belongs to, plus markers for the things the game adds itself (trees, smoke) and a
 * far version picked from the named parts. Colours, night lights, rows and mirroring are decided
 * per copy in the game (src/render/assets/handmade.ts), not here.
 */

export * from './baked';

/** Small fittings left out of the distant versions whatever their size. */
const FAR_DROP =
  /^(window_frame|sill|door_frame|garage_door_frame|storefront_frame|bumper|bench.*|bin.*|bike_rack|lounger|valve|clock_hand|bay_line|tile|flower_bed_edge)$/;
/** Hidden-face test: how far a face may stand out of a box and still count as inside it (m). */
const EPS = 1e-3;
/** A glass box no deeper than this is a pane set in a wall (m); deeper, a glazed room. */
const PANE_DEPTH = 0.6;
/** Ground on a civic site that nothing is put on: the roads in. */
const KEEP_CLEAR = /^(entrance_road|access_road|service_road|road|drive|driveway|lane)$/;
/** Doors whose approach is kept clear. */
const DOORWAY = /^(door|garage_door|entrance)$/;
/** Glass that stays dark at night: not a window. */
const UNLIT_GLASS = /heliostat|solar|panel|balcony|grille|slit|opening|mirror/;
/** Glass lit like a shop window. */
const SHOP_GLASS = /storefront|shop|lobby|entrance|door/;
/**
 * Long windows light in runs (model batch 3): a window or band longer than `RUN_SPLIT` along its
 * wall is cut across into runs of about `RUN_LENGTH`, each lit on its own, with an unlit strip
 * `MULLION` wide between two runs, so a floor-long band doesn't light up as one stripe at night
 * and two lit neighbours still read as two windows (m; 0.2 m read as a crack from a few hundred
 * metres). By day nothing changes: it is the same glass.
 */
const RUN_SPLIT = 4.5;
const RUN_LENGTH = 3.5;
const MULLION = 0.4;

/** A stretch of a long window along its run direction, and the window unit it lights as. */
interface Span {
  from: number;
  to: number;
  unit: number;
}

/** Where a long window is cut. */
interface Runs {
  /** The way it runs, across the ground. */
  tx: number;
  tz: number;
  /** The way it faces: its faces looking (nearly) this way or the other are cut into runs. */
  facing: [number, number, number];
  /** Near and far: each run, and the unlit strip between two. */
  near: Span[];
  /** In the skyline version, where the strip is a pixel or less: the runs alone, meeting halfway across it. */
  sky: Span[];
}

/**
 * The way a window faces, as a unit vector: the normal its faces share most area along (either
 * way), so the front of a band of glass, a skylight's top or a saw-tooth roof's slope; and the
 * way it runs across the ground, square to that (for glass facing straight up, its longer side).
 */
function runDirection(parts: GlbPart[]): { facing: [number, number, number]; tx: number; tz: number } {
  const area = new Map<string, { n: [number, number, number]; a: number }>();
  const b = emptyBox();
  for (const p of parts) {
    growBox(b, p.tris);
    const tr = p.tris;
    for (let i = 0; i < tr.length; i += 9) {
      const ux = tr[i + 3]! - tr[i]!;
      const uy = tr[i + 4]! - tr[i + 1]!;
      const uz = tr[i + 5]! - tr[i + 2]!;
      const vx = tr[i + 6]! - tr[i]!;
      const vy = tr[i + 7]! - tr[i + 1]!;
      const vz = tr[i + 8]! - tr[i + 2]!;
      let n: [number, number, number] = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
      const l = Math.hypot(...n);
      if (l < 1e-9) continue;
      n = n.map((c) => c / l) as [number, number, number];
      // A face and the one behind it count as one way.
      const lead = n.find((c) => Math.abs(c) > 1e-3) ?? 1;
      if (lead < 0) n = n.map((c) => -c) as [number, number, number];
      const key = n.map((c) => Math.round(c * 50)).join(',');
      const e = area.get(key);
      if (e) e.a += l / 2;
      else area.set(key, { n, a: l / 2 });
    }
  }
  let facing: [number, number, number] = [0, 0, 1];
  let most = -1;
  for (const e of area.values()) if (e.a > most) [most, facing] = [e.a, e.n];
  let tx: number;
  let tz: number;
  const h = Math.hypot(facing[0], facing[2]);
  if (h < 0.05) [tx, tz] = b.max[0] - b.min[0] >= b.max[2] - b.min[2] ? [1, 0] : [0, 1];
  else [tx, tz] = [-facing[2] / h, facing[0] / h];
  // Exactly along x or z when it nearly is, so the cuts fall where the model's own lines do.
  if (Math.abs(tz) < 1e-4) [tx, tz] = [1, 0];
  else if (Math.abs(tx) < 1e-4) [tx, tz] = [0, 1];
  else if (tx < 0) [tx, tz] = [-tx, -tz];
  return { facing, tx, tz };
}

/** The part of a convex polygon (x, y, z each) whose place along (tx, tz) lies between from and to. */
function clipSpan(poly: number[], tx: number, tz: number, from: number, to: number): number[] {
  let out = poly;
  for (const [limit, above] of [
    [from, true],
    [to, false],
  ] as const) {
    if (!Number.isFinite(limit)) continue;
    const inp = out;
    out = [];
    const m = inp.length / 3;
    for (let k = 0; k < m; k++) {
      const a = k * 3;
      const b = ((k + 1) % m) * 3;
      const sa = inp[a]! * tx + inp[a + 2]! * tz - limit;
      const sb = inp[b]! * tx + inp[b + 2]! * tz - limit;
      const ina = above ? sa >= 0 : sa <= 0;
      const inb = above ? sb >= 0 : sb <= 0;
      if (ina) out.push(inp[a]!, inp[a + 1]!, inp[a + 2]!);
      if (ina !== inb) {
        const t = sa / (sa - sb);
        for (let c = 0; c < 3; c++) out.push(inp[a + c]! + (inp[b + c]! - inp[a + c]!) * t);
      }
    }
    if (out.length < 9) return [];
  }
  return out;
}

/**
 * Coplanar convex pieces (x, y, z each, wound about the normal n) that together make one convex
 * polygon, as that polygon: a rectangle cut into runs comes back as rectangles, two triangles each,
 * not the slivers either half of it makes. Pieces that don't (they leave a gap or overlap) as they are.
 */
function mergePieces(pieces: number[][], nx: number, ny: number, nz: number): number[][] {
  if (pieces.length < 2) return pieces;
  // A frame in the plane, e1 × e2 = n: anticlockwise in it is anticlockwise about n.
  const p0 = pieces[0]!;
  let e1x = p0[3]! - p0[0]!;
  let e1y = p0[4]! - p0[1]!;
  let e1z = p0[5]! - p0[2]!;
  const l = Math.hypot(e1x, e1y, e1z);
  if (l < 1e-9) return pieces;
  e1x /= l;
  e1y /= l;
  e1z /= l;
  const e2x = ny * e1z - nz * e1y;
  const e2y = nz * e1x - nx * e1z;
  const e2z = nx * e1y - ny * e1x;
  const pts: { u: number; v: number; x: number; y: number; z: number }[] = [];
  let area = 0;
  for (const p of pieces) {
    const m = p.length / 3;
    const at = pts.length;
    for (let k = 0; k < m; k++) {
      const [x, y, z] = [p[k * 3]!, p[k * 3 + 1]!, p[k * 3 + 2]!];
      // On a micrometre grid, so the corners along one side sort by where they are along it, not
      // by rounding noise (which could drop a corner as if it lay along a side).
      const u = Math.round((x * e1x + y * e1y + z * e1z) * 1e6) / 1e6;
      const v = Math.round((x * e2x + y * e2y + z * e2z) * 1e6) / 1e6;
      pts.push({ u, v, x, y, z });
    }
    for (let k = 0; k < m; k++) {
      const a = pts[at + k]!;
      const b = pts[at + ((k + 1) % m)]!;
      area += (a.u * b.v - b.u * a.v) / 2;
    }
  }
  // Convex hull, anticlockwise, without points along its sides (Andrew's monotone chain).
  pts.sort((a, b) => a.u - b.u || a.v - b.v);
  const cross = (o: (typeof pts)[0], a: (typeof pts)[0], b: (typeof pts)[0]) =>
    (a.u - o.u) * (b.v - o.v) - (a.v - o.v) * (b.u - o.u);
  const hull: typeof pts = [];
  for (const pass of [pts, [...pts].reverse()]) {
    const start = hull.length;
    for (const p of pass) {
      while (hull.length >= start + 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 1e-7)
        hull.pop();
      hull.push(p);
    }
    hull.pop();
  }
  if (hull.length < 3) return pieces;
  let hullArea = 0;
  for (let k = 0; k < hull.length; k++) {
    const a = hull[k]!;
    const b = hull[(k + 1) % hull.length]!;
    hullArea += (a.u * b.v - b.u * a.v) / 2;
  }
  if (Math.abs(hullArea - area) > 1e-5 + 1e-5 * Math.abs(area)) return pieces;
  return [hull.flatMap((p) => [p.x, p.y, p.z])];
}

/**
 * A part is a plain axis-aligned box when it is twelve triangles, two in each face of its bounding
 * box. (A wedge or a sloped sheet also has every corner on its bounding box, and hides nothing.)
 */
function isBox(tris: Float32Array, b: Box3): boolean {
  if (tris.length !== 12 * 9) return false;
  if (![0, 1, 2].every((k) => b.max[k]! - b.min[k]! > 1e-3)) return false;
  const faces = [0, 0, 0, 0, 0, 0];
  for (let t = 0; t < tris.length; t += 9) {
    let face = -1;
    for (let k = 0; k < 3 && face < 0; k++)
      for (const [side, at] of [b.min[k]!, b.max[k]!].entries())
        if ([0, 3, 6].every((c) => Math.abs(tris[t + c + k]! - at) <= 1e-4)) face = k * 2 + side;
    if (face < 0) return false;
    // Every corner at a corner of the box.
    for (let c = 0; c < 9; c++) {
      const v = tris[t + c]!;
      if (Math.abs(v - b.min[c % 3]!) > 1e-4 && Math.abs(v - b.max[c % 3]!) > 1e-4) return false;
    }
    faces[face]!++;
  }
  return faces.every((n) => n === 2);
}

/** Is a triangle mesh a closed surface: does every edge belong to exactly two triangles? */
function closed(tris: Float32Array): boolean {
  const edges = new Map<string, number>();
  const key = (i: number) => `${tris[i]!.toFixed(3)},${tris[i + 1]!.toFixed(3)},${tris[i + 2]!.toFixed(3)}`;
  for (let t = 0; t < tris.length; t += 9) {
    const v = [key(t), key(t + 3), key(t + 6)];
    for (let k = 0; k < 3; k++) {
      const [a, b] = [v[k]!, v[(k + 1) % 3]!];
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) ?? 0) + 1);
    }
  }
  for (const n of edges.values()) if (n !== 2) return false;
  return edges.size > 0;
}

/** Each triangle, and the same triangle turned round. */
function bothSides(tris: Float32Array): Float32Array {
  const out = new Float32Array(tris.length * 2);
  out.set(tris);
  for (let t = 0; t < tris.length; t += 9) {
    const o = tris.length + t;
    for (let k = 0; k < 3; k++) {
      out[o + k] = tris[t + k]!;
      out[o + 3 + k] = tris[t + 6 + k]!;
      out[o + 6 + k] = tris[t + 3 + k]!;
    }
  }
  return out;
}

/** `runs: false` leaves long windows whole (to compare with in tests and dev tools). */
export function bakeModel(file: GlbFile, report: ModelReport, options: { runs?: boolean } = {}): BakedModel {
  const t = report.target;
  const fp = report.footprint;
  if (!t || !fp) throw new Error(`${report.id}: can't bake a model that failed its check`);

  const treeParts = new Set<GlbPart>(groupsNamed(file, PART.treeSpot).flat());
  const trees: number[] = [];
  for (const g of groupsNamed(file, PART.treeSpot)) {
    const b = boxOf(g);
    trees.push((b.min[0] + b.max[0]) / 2, b.min[1], (b.min[2] + b.max[2]) / 2);
  }
  const stacks: number[] = [];
  for (const g of groupsNamed(file, PART.smokeStack)) {
    const b = boxOf(g);
    stacks.push((b.min[0] + b.max[0]) / 2, b.max[1], (b.min[2] + b.max[2]) / 2);
  }

  // A part in a double-sided material that isn't a closed solid is a sheet seen from both sides
  // (a canopy, an open roof): the game draws one side of a triangle, so it gets both.
  const kept = file.parts.filter((p) => !treeParts.has(p));
  const src = kept.map((p) => (p.doubleSided && !closed(p.tris) ? { ...p, tris: bothSides(p.tris) } : p));
  // The file's part each of those is (a doubled sheet is a copy).
  const original = new Map<GlbPart, GlbPart>(src.map((p, i) => [p, kept[i]!]));
  const boxes = src.map((p) => growBox(emptyBox(), p.tris));
  const solid = src.map((p, i) => isBox(p.tris, boxes[i]!));

  // Window units: every `window` group, every window_band, and every other pane that lights up.
  const unitOf = new Map<GlbPart, number>();
  const unitKinds: number[] = [];
  const isGlass = (p: GlbPart) => p.material === 'glass' || p.material === 'shop_glass';
  for (const g of groupsNamed(file, PART.window)) {
    const panes = g.filter(isGlass);
    if (!panes.length) continue;
    unitKinds.push(UNIT_WINDOW);
    for (const p of panes) unitOf.set(p, unitKinds.length);
  }
  for (const copy of src) {
    const p = original.get(copy)!;
    if (unitOf.has(p) || !isGlass(p)) continue;
    if (p.name === PART.windowBand) {
      unitKinds.push(UNIT_BAND);
      unitOf.set(p, unitKinds.length);
    } else if (p.name === PART.windowGlass) {
      unitKinds.push(UNIT_WINDOW);
      unitOf.set(p, unitKinds.length);
    } else if (!UNLIT_GLASS.test(p.name) && !p.path.some((n) => UNLIT_GLASS.test(n))) {
      unitKinds.push(
        SHOP_GLASS.test(p.name) || p.path.some((n) => SHOP_GLASS.test(n)) ? UNIT_SHOP : UNIT_GLOW,
      );
      unitOf.set(p, unitKinds.length);
    }
  }

  // Long windows are lit in runs: each run after the first a unit of its own kind, and the strips
  // between them one unit that never lights.
  const runs = new Map<number, Runs>();
  let mullion = 0;
  const partsOf = new Map<number, GlbPart[]>();
  for (const copy of src) {
    const u = unitOf.get(original.get(copy)!);
    if (u) partsOf.set(u, [...(partsOf.get(u) ?? []), copy]);
  }
  for (const [u, parts] of partsOf) {
    const kind = unitKinds[u - 1]!;
    if (options.runs === false || (kind !== UNIT_WINDOW && kind !== UNIT_BAND)) continue;
    const { facing, tx, tz } = runDirection(parts);
    let s0 = Infinity;
    let s1 = -Infinity;
    for (const p of parts)
      for (let i = 0; i < p.tris.length; i += 3) {
        const s = p.tris[i]! * tx + p.tris[i + 2]! * tz;
        s0 = Math.min(s0, s);
        s1 = Math.max(s1, s);
      }
    const len = s1 - s0;
    if (len <= RUN_SPLIT) continue;
    const n = Math.max(2, Math.round(len / RUN_LENGTH));
    const w = (len - (n - 1) * MULLION) / n;
    const near: Span[] = [];
    const sky: Span[] = [];
    for (let k = 0; k < n; k++) {
      const from = s0 + k * (w + MULLION);
      let unitK = u;
      if (k > 0) {
        unitKinds.push(kind);
        unitK = unitKinds.length;
      }
      const first = k === 0;
      const last = k === n - 1;
      near.push({ from: first ? -Infinity : from, to: last ? Infinity : from + w, unit: unitK });
      sky.push({
        from: first ? -Infinity : from - MULLION / 2,
        to: last ? Infinity : from + w + MULLION / 2,
        unit: unitK,
      });
      if (!last) {
        if (!mullion) {
          unitKinds.push(UNIT_DARK);
          mullion = unitKinds.length;
        }
        near.push({ from: from + w, to: from + w + MULLION, unit: mullion });
      }
    }
    runs.set(u, { tx, tz, facing, near, sky });
  }

  const walls = src.filter((p) => p.material === 'wall' || p.material === 'wall_alt');
  const wb = walls.length ? boxOf(walls) : null;
  const party =
    t.kind === 'zoned' &&
    !!wb &&
    Math.abs(wb.max[0] - fp.w / 2) < 0.05 &&
    Math.abs(wb.min[0] + fp.w / 2) < 0.05;
  const all = boxOf(src);

  const pos: number[] = [];
  const role: number[] = [];
  const group: number[] = [];
  const flags: number[] = [];
  const unit: number[] = [];
  const colors: Record<number, [number, number, number]> = {};

  // Each part's surface as seen from one side: a sheet's area, half a closed solid's.
  const areas = kept.map((p) => {
    let a = 0;
    const tr = p.tris;
    for (let i = 0; i < tr.length; i += 9) {
      const ux = tr[i + 3]! - tr[i]!;
      const uy = tr[i + 4]! - tr[i + 1]!;
      const uz = tr[i + 5]! - tr[i + 2]!;
      const vx = tr[i + 6]! - tr[i]!;
      const vy = tr[i + 7]! - tr[i + 1]!;
      const vz = tr[i + 8]! - tr[i + 2]!;
      a += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    }
    return closed(tr) ? a / 2 : a;
  });
  // What each part is, and whether the far and the skyline versions keep it.
  const info = src.map((p, pi) => {
    const b = boxes[pi]!;
    const ext = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] as const;
    // How big the part looks face on: its second-largest dimension; for a slanting bar or sheet
    // (a fire escape's flight), whose box is mostly air, its area over its length.
    const [largest, boxSecond] = [...ext].sort((x, y) => y - x) as [number, number, number];
    const second = Math.min(boxSecond, areas[pi]! / Math.max(largest, 1e-6));
    const ground = onGround(p, b);
    const u = unitOf.get(original.get(p)!) ?? 0;
    const fitting = FAR_DROP.test(p.name) || p.path.some((n) => FAR_DROP.test(n));
    // A window's frame stays in the distant versions as its outward face, or the wall would
    // read darker (a brick tenement's white frames are a quarter of its brightness).
    const frame = p.name === 'window_frame' && solid[pi]!;
    const keeps = (k: typeof FAR_KEEP) =>
      u > 0 || frame
        ? second >= k.pane
        : ground
          ? // Flat on the ground: big patches, and long lines (a pitch's touchlines, a runway's).
            second >= k.ground || (!fitting && largest >= k.line && second >= k.thin)
          : !fitting &&
            (second >= k.part ||
              (largest >= k.long && second >= k.thin) ||
              (largest * second >= k.sheet && second >= k.thin));
    return { ext, ground, u, frame, fitting, keep: [keeps(FAR_KEEP), keeps(SKY_KEEP)] };
  });
  // Whatever holds up a part that stays, stays: legs under a water tank, posts under a canopy.
  for (const level of [0, 1])
    for (let pass = 0; pass < 2; pass++)
      src.forEach((_, pi) => {
        const me = info[pi]!;
        if (me.keep[level] || me.u > 0 || me.ground || me.fitting || me.ext[1] < 1) return;
        const b = boxes[pi]!;
        const cx = (b.min[0] + b.max[0]) / 2;
        const cz = (b.min[2] + b.max[2]) / 2;
        me.keep[level] = src.some((_, o) => {
          if (o === pi || !info[o]!.keep[level]) return false;
          const k = boxes[o]!;
          // It reaches the part's underside from well below (and may run on past it: the posts
          // at the corners of a tower's crown).
          return (
            b.max[1] > k.min[1] - 0.4 &&
            b.max[1] < k.max[1] + 1.5 &&
            k.min[1] > b.min[1] + 0.5 &&
            cx > k.min[0] - 0.2 &&
            cx < k.max[0] + 0.2 &&
            cz > k.min[2] - 0.2 &&
            cz < k.max[2] + 0.2
          );
        });
      });

  // The model's own ground, clear of the lot base the game draws under it (GROUND_FLOOR).
  const lift = groundLift(kept);
  src.forEach((p, pi) => {
    const r = ROLE_INDEX.get(p.material) ?? 0;
    colors[r] ??= p.color;
    const { ext, ground, u, frame } = info[pi]!;
    const [farPart, skyPart] = info[pi]!.keep as [boolean, boolean];
    // Which way a pane faces: its thinnest direction.
    const thin = ext[0] <= ext[1] && ext[0] <= ext[2] ? 0 : ext[2] <= ext[1] ? 2 : 1;
    const driven = DRIVEN_GROUPS.findIndex((g) => under(p, g)) + 1;
    const put = (v: ArrayLike<number>, at: number, f: number, un: number) => {
      for (let k = 0; k < 9; k++) pos.push(v[at + k]! + (k % 3 === 1 && ground ? lift : 0));
      role.push(r);
      group.push(driven);
      flags.push(f);
      unit.push(un);
    };
    // A long window's faces, kept to cut into its runs once the part is done.
    const cut = runs.get(u);
    const pending: { v: number[]; f: number; n: [number, number, number] }[] = [];

    const tr = p.tris;
    for (let i = 0; i < tr.length; i += 9) {
      const ax = tr[i]!;
      const ay = tr[i + 1]!;
      const az = tr[i + 2]!;
      const ux = tr[i + 3]! - ax;
      const uy = tr[i + 4]! - ay;
      const uz = tr[i + 5]! - az;
      const vx = tr[i + 6]! - ax;
      const vy = tr[i + 7]! - ay;
      const vz = tr[i + 8]! - az;
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      // Hidden faces: the space just outside the face is inside another part that is a solid
      // box (a wall's foot on the lawn slab, a window frame's back in the wall). A distant
      // version that leaves that box out shows the face again.
      const cy = (ay + tr[i + 4]! + tr[i + 7]!) / 3;
      const covered = [false, false, false];
      for (let o = 0; o < src.length; o++) {
        if (o === pi || !solid[o]) continue;
        const keep = info[o]!.keep;
        if (covered[0] && (covered[1] || !keep[0]) && (covered[2] || !keep[1])) continue;
        const ob = boxes[o]!;
        let inside = true;
        for (let k = 0; k < 9 && inside; k += 3) {
          const qx = tr[i + k]! + nx * 0.02;
          const qy = tr[i + k + 1]! + ny * 0.02;
          const qz = tr[i + k + 2]! + nz * 0.02;
          inside =
            qx >= ob.min[0] - EPS &&
            qx <= ob.max[0] + EPS &&
            qy >= ob.min[1] - EPS &&
            qy <= ob.max[1] + EPS &&
            qz >= ob.min[2] - EPS &&
            qz <= ob.max[2] + EPS;
        }
        if (!inside) continue;
        covered[0] = true;
        if (keep[0]) covered[1] = true;
        if (keep[1]) covered[2] = true;
      }
      // Faces on the ground looking down are never seen either.
      if (ny < -0.99 && cy < 0.02) continue;
      let f = covered[0] ? 0 : TRI_NEAR;
      // Faces looking down stay in the distant versions: they show from a low camera (a deck
      // on a tower, the back of a solar panel), and they are what casts a part's shadow (the
      // shadow pass draws the faces turned away from the sun). Only those at the ground go.
      if (ny > -0.97 || cy > 0.5) {
        // Distant panes are flat panels: only the faces that look out of (or into) the wall; a
        // glazed room (a lobby standing out of its building) keeps its walls. Distant ground is
        // its top alone.
        const nThin = thin === 0 ? nx : thin === 1 ? ny : nz;
        const pane =
          frame || (u > 0 && solid[pi] && unitKinds[u - 1] !== UNIT_GLOW && ext[thin]! <= PANE_DEPTH);
        if ((!pane || Math.abs(nThin) > 0.7) && (!ground || ny > 0.5)) {
          if (farPart && !covered[1]) f |= TRI_FAR;
          if (skyPart && !covered[2]) f |= TRI_SKY;
        }
      }
      if (!f) continue;
      if (ground) f |= TRI_GROUND;
      if (p !== original.get(p)) f |= TRI_TWO_SIDED;
      if (party) {
        // What the neighbour in a row hides: whatever lies within 20 cm of the party line, but
        // not a wall set back from it and looking out (the gap between two would show).
        const edge = fp.w / 2;
        const xs = [ax, tr[i + 3]!, tr[i + 6]!];
        if (xs.every((x) => x >= edge - 0.2) && !(nx > 0.5 && Math.max(...xs) < edge - 0.01))
          f |= TRI_PARTY_POS;
        if (xs.every((x) => x <= -edge + 0.2) && !(nx < -0.5 && Math.min(...xs) > -edge + 0.01))
          f |= TRI_PARTY_NEG;
      }
      if (cut) pending.push({ v: Array.from(tr.subarray(i, i + 9)), f, n: [nx, ny, nz] });
      else put(tr, i, f, u);
    }
    if (!cut) return;
    // The faces it looks out of are cut into its spans (near and far with the unlit strips between
    // runs, in the skyline the runs alone), and the pieces of one plane in one span joined again.
    // Its edges (a band's top and bottom) light with the run they lie in, or stay unlit where they
    // run past one.
    const pieces = new Map<
      string,
      { unit: number; f: number; n: [number, number, number]; polys: number[][] }
    >();
    const [fx, fy, fz] = cut.facing;
    for (const { v, f, n } of pending) {
      if (Math.abs(n[0] * fx + n[1] * fy + n[2] * fz) < 0.7) {
        const s = [0, 3, 6].map((k) => v[k]! * cut.tx + v[k + 2]! * cut.tz);
        const [lo, hi] = [Math.min(...s), Math.max(...s)];
        const in1 = cut.near.find((sp) => lo >= sp.from - 1e-4 && hi <= sp.to + 1e-4);
        put(v, 0, f, in1 ? in1.unit : mullion);
        continue;
      }
      const plane = `${n.map((c) => Math.round(c * 1e4)).join(',')}|${Math.round((n[0] * v[0]! + n[1] * v[1]! + n[2] * v[2]!) * 1e3)}`;
      for (const [spans, lf] of [
        [cut.near, f & (TRI_NEAR | TRI_FAR) ? f & ~TRI_SKY : 0],
        [cut.sky, f & TRI_SKY ? f & ~(TRI_NEAR | TRI_FAR) : 0],
      ] as const) {
        if (!lf) continue;
        spans.forEach((sp, k) => {
          const poly = clipSpan(v, cut.tx, cut.tz, sp.from, sp.to);
          if (!poly.length) return;
          const key = `${lf}|${k}|${plane}`;
          let e = pieces.get(key);
          if (!e) pieces.set(key, (e = { unit: sp.unit, f: lf, n, polys: [] }));
          e.polys.push(poly);
        });
      }
    }
    const t = new Float64Array(9);
    for (const e of pieces.values())
      for (const poly of mergePieces(e.polys, ...e.n))
        for (let k = 1; k + 1 < poly.length / 3; k++) {
          t.set(poly.slice(0, 3), 0);
          t.set(poly.slice(k * 3, k * 3 + 6), 3);
          // Leave out the slivers a cut along an edge leaves.
          const ux = t[3]! - t[0]!;
          const uy = t[4]! - t[1]!;
          const uz = t[5]! - t[2]!;
          const vx = t[6]! - t[0]!;
          const vy = t[7]! - t[1]!;
          const vz = t[8]! - t[2]!;
          if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 2e-6) continue;
          put(t, 0, e.f, e.unit);
        }
  });

  // Weld equal corners so the shipped data is small; normals are rebuilt from the winding.
  const index = new Uint32Array(pos.length / 3);
  const unique: number[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < pos.length; i += 3) {
    const x = Math.round(pos[i]! * 1000) / 1000;
    const y = Math.round(pos[i + 1]! * 1000) / 1000;
    const z = Math.round(pos[i + 2]! * 1000) / 1000;
    const key = `${x},${y},${z}`;
    let v = seen.get(key);
    if (v === undefined) {
      v = unique.length / 3;
      seen.set(key, v);
      unique.push(x, y, z);
    }
    index[i / 3] = v;
  }

  // Civic sites: what is built on, a bit per square metre (a part's whole bounding box counts),
  // and what is kept clear.
  const cols = Math.ceil(fp.w);
  const rows = Math.ceil(fp.d);
  const occupied = new Uint8Array(t.kind === 'civic' ? Math.ceil((cols * rows) / 8) : 0);
  const approach = new Uint8Array(occupied.length);
  if (t.kind === 'civic') {
    const mark = (x0: number, z0: number, x1: number, z1: number, into = occupied) => {
      const c0 = Math.max(0, Math.floor(x0 + fp.w / 2));
      const c1 = Math.min(cols - 1, Math.floor(x1 + fp.w / 2 - 1e-6));
      const r0 = Math.max(0, Math.floor(z0 + fp.d / 2));
      const r1 = Math.min(rows - 1, Math.floor(z1 + fp.d / 2 - 1e-6));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) into[(r * cols + c) >> 3]! |= 1 << ((r * cols + c) & 7);
    };
    src.forEach((_, pi) => {
      const b = boxes[pi]!;
      // Buildings and machinery; an annex may stand on a hedge, a kerb or a low wall.
      if (b.max[1] > 2.2 && !info[pi]!.ground) mark(b.min[0], b.min[2], b.max[0], b.max[2]);
    });
    for (let i = 0; i < trees.length; i += 3)
      mark(trees[i]! - 1, trees[i + 2]! - 1, trees[i]! + 1, trees[i + 2]! + 1);
    // Roads in.
    src.forEach((p, pi) => {
      const b = boxes[pi]!;
      if (info[pi]!.ground && KEEP_CLEAR.test(p.name)) mark(b.min[0], b.min[2], b.max[0], b.max[2], approach);
    });
    // The approach to each door: a strip as wide as it, out from the wall it is set in.
    const inWall = (x: number, y: number, z: number) =>
      src.some((q, qi) => {
        const k = boxes[qi]!;
        return (
          !DOORWAY.test(q.name) &&
          (q.material === 'wall' || q.material === 'wall_alt') &&
          x > k.min[0] &&
          x < k.max[0] &&
          y > k.min[1] &&
          y < k.max[1] &&
          z > k.min[2] &&
          z < k.max[2]
        );
      });
    src.forEach((p, pi) => {
      if (!DOORWAY.test(p.name)) return;
      const b = boxes[pi]!;
      const along = b.max[0] - b.min[0] < b.max[2] - b.min[2] ? 0 : 2;
      const cx = (b.min[0] + b.max[0]) / 2;
      const cz = (b.min[2] + b.max[2]) / 2;
      const y = b.min[1] + 1;
      const reach = p.name === 'garage_door' ? 9 : 6;
      for (const dir of [-1, 1]) {
        // Out on the side that isn't wall (both, if the door isn't in a wall).
        if (along === 0 ? inWall(cx + dir * 0.6, y, cz) : inWall(cx, y, cz + dir * 0.6)) continue;
        const face = dir > 0 ? b.max[along]! : b.min[along]!;
        const [lo, hi] = dir > 0 ? [face, face + reach] : [face - reach, face];
        if (along === 0) mark(lo, b.min[2] - 0.5, hi, b.max[2] + 0.5, approach);
        else mark(b.min[0] - 0.5, lo, b.max[0] + 0.5, hi, approach);
      }
    });
  }

  return {
    id: report.id,
    kind: t.kind,
    def: t.def,
    design: t.design,
    w: fp.w,
    d: fp.d,
    h: all.max[1],
    over: {
      front: Math.max(0, -fp.d / 2 - all.min[2]),
      back: Math.max(0, all.max[2] - fp.d / 2),
      side: Math.max(0, all.max[0] - fp.w / 2, -fp.w / 2 - all.min[0]),
    },
    party,
    positions: new Float32Array(unique),
    index,
    triRole: Uint8Array.from(role),
    triFlags: Uint8Array.from(flags),
    triUnit: Uint16Array.from(unit),
    triGroup: Uint8Array.from(group),
    colors,
    units: Uint8Array.from(unitKinds),
    occupied,
    approach,
    trees,
    stacks,
    counts: {
      file: report.triangles,
      near: flags.filter((f) => f & TRI_NEAR).length,
      far: flags.filter((f) => f & TRI_FAR).length,
      sky: flags.filter((f) => f & TRI_SKY).length,
    },
  };
}
