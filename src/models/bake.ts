import type { GlbFile, GlbPart } from './glb';
import { boxOf, emptyBox, growBox, groupsNamed, under, type Box3, type ModelReport } from './check';
import { GROUND_ROLES, PART, ROLE_INDEX, type Role } from './spec';
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
  UNIT_BAND,
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
  /^(window_frame|sill|mullion|door_frame|garage_door_frame|storefront_frame|bumper|bench.*|bin.*|bike_rack|lounger|valve|clock_hand|.*_line|.*_marking|helipad_h|tile|flower_bed_edge)$/;
/** Glass that stays dark at night: not a window. */
const UNLIT_GLASS = /heliostat|solar|panel|balcony|grille|slit|opening|mirror/;
/** Glass lit like a shop window. */
const SHOP_GLASS = /storefront|shop|lobby|entrance|door/;

/** A part is a plain axis-aligned box when every vertex is at a corner of its bounding box. */
function isBox(tris: Float32Array, b: Box3): boolean {
  if (tris.length > 12 * 9) return false;
  for (let i = 0; i < tris.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k]!;
      if (Math.abs(v - b.min[k]!) > 1e-4 && Math.abs(v - b.max[k]!) > 1e-4) return false;
    }
  // … and it has some volume.
  return [0, 1, 2].every((k) => b.max[k]! - b.min[k]! > 1e-3);
}

export function bakeModel(file: GlbFile, report: ModelReport): BakedModel {
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

  const src = file.parts.filter((p) => !treeParts.has(p));
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
  for (const p of src) {
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
  let hidden = 0;

  // What each part is, and whether the far and the skyline versions keep it.
  const info = src.map((p, pi) => {
    const b = boxes[pi]!;
    const ext = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]] as const;
    // How big the part looks face on: its second-largest dimension.
    const [largest, second] = [...ext].sort((x, y) => y - x) as [number, number, number];
    const ground = GROUND_ROLES.includes(p.material as Role) && b.max[1] < 0.35 && ext[1] < 0.3;
    const u = unitOf.get(p) ?? 0;
    const fitting = FAR_DROP.test(p.name) || p.path.some((n) => FAR_DROP.test(n));
    // A window's frame stays in the far version as its outward face, or the wall would read
    // darker; the skyline drops the frames too: there a window is a pixel or two.
    const frame = p.name === 'window_frame' && solid[pi]!;
    const keeps = (k: typeof FAR_KEEP, frames: boolean) =>
      u > 0 || (frame && frames)
        ? second >= k.pane
        : ground
          ? second >= k.ground
          : !fitting && (second >= k.part || (largest >= k.long && second >= k.thin));
    return { ext, ground, u, frame, fitting, keep: [keeps(FAR_KEEP, true), keeps(SKY_KEEP, false)] };
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
          return (
            Math.abs(k.min[1] - b.max[1]) < 0.4 &&
            k.min[1] > b.min[1] + 0.5 &&
            cx > k.min[0] - 0.2 &&
            cx < k.max[0] + 0.2 &&
            cz > k.min[2] - 0.2 &&
            cz < k.max[2] + 0.2
          );
        });
      });

  src.forEach((p, pi) => {
    const r = ROLE_INDEX.get(p.material) ?? 0;
    colors[r] ??= p.color;
    const { ext, ground, u, frame } = info[pi]!;
    const [farPart, skyPart] = info[pi]!.keep as [boolean, boolean];
    // Which way a pane faces: its thinnest direction.
    const thin = ext[0] <= ext[1] && ext[0] <= ext[2] ? 0 : ext[2] <= ext[1] ? 2 : 1;
    const driven = DRIVEN_GROUPS.findIndex((g) => under(p, g)) + 1;

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
      // box (a wall's foot on the lawn slab, a window frame's back in the wall).
      const cx = (ax + tr[i + 3]! + tr[i + 6]!) / 3;
      const cy = (ay + tr[i + 4]! + tr[i + 7]!) / 3;
      const cz = (az + tr[i + 5]! + tr[i + 8]!) / 3;
      let covered = false;
      for (let o = 0; o < src.length && !covered; o++) {
        if (o === pi || !solid[o]) continue;
        const ob = boxes[o]!;
        let inside = true;
        for (let k = 0; k < 9 && inside; k += 3) {
          const qx = tr[i + k]! + (cx - tr[i + k]!) * 0.02 + nx * 0.02;
          const qy = tr[i + k + 1]! + (cy - tr[i + k + 1]!) * 0.02 + ny * 0.02;
          const qz = tr[i + k + 2]! + (cz - tr[i + k + 2]!) * 0.02 + nz * 0.02;
          inside =
            qx >= ob.min[0] &&
            qx <= ob.max[0] &&
            qy >= ob.min[1] &&
            qy <= ob.max[1] &&
            qz >= ob.min[2] &&
            qz <= ob.max[2];
        }
        covered = inside;
      }
      // Faces on the ground looking down are never seen either.
      if (covered || (ny < -0.99 && cy < 0.02)) {
        hidden++;
        continue;
      }
      let f = TRI_NEAR;
      if (ground) f |= TRI_GROUND;
      if (ny > -0.7) {
        // Distant panes are flat panels: only the faces that look out of (or into) the wall.
        // Distant ground is its top alone.
        const nThin = thin === 0 ? nx : thin === 1 ? ny : nz;
        const pane = frame || (u > 0 && solid[pi] && unitKinds[u - 1] !== UNIT_GLOW);
        if ((!pane || Math.abs(nThin) > 0.7) && (!ground || ny > 0.5)) {
          if (farPart) f |= TRI_FAR;
          if (skyPart) f |= TRI_SKY;
        }
      }
      if (party) {
        const edge = fp.w / 2 - 0.2;
        if (ax >= edge && tr[i + 3]! >= edge && tr[i + 6]! >= edge) f |= TRI_PARTY_POS;
        if (ax <= -edge && tr[i + 3]! <= -edge && tr[i + 6]! <= -edge) f |= TRI_PARTY_NEG;
      }
      for (let k = 0; k < 9; k++) pos.push(tr[i + k]!);
      role.push(r);
      group.push(driven);
      flags.push(f);
      unit.push(u);
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

  // Civic sites: what is built on, a bit per square metre (a part's whole bounding box counts).
  const cols = Math.ceil(fp.w);
  const rows = Math.ceil(fp.d);
  const occupied = new Uint8Array(t.kind === 'civic' ? Math.ceil((cols * rows) / 8) : 0);
  if (t.kind === 'civic') {
    const mark = (x0: number, z0: number, x1: number, z1: number) => {
      const c0 = Math.max(0, Math.floor(x0 + fp.w / 2));
      const c1 = Math.min(cols - 1, Math.floor(x1 + fp.w / 2 - 1e-6));
      const r0 = Math.max(0, Math.floor(z0 + fp.d / 2));
      const r1 = Math.min(rows - 1, Math.floor(z1 + fp.d / 2 - 1e-6));
      for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++) occupied[(r * cols + c) >> 3]! |= 1 << ((r * cols + c) & 7);
    };
    src.forEach((_, pi) => {
      const b = boxes[pi]!;
      // Buildings and machinery; an annex may stand on a hedge, a kerb or a low wall.
      if (b.max[1] > 2.2 && !info[pi]!.ground) mark(b.min[0], b.min[2], b.max[0], b.max[2]);
    });
    for (let i = 0; i < trees.length; i += 3)
      mark(trees[i]! - 1, trees[i + 2]! - 1, trees[i]! + 1, trees[i + 2]! + 1);
  }

  const n = role.length;
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
    trees,
    stacks,
    counts: {
      file: n + hidden,
      near: n,
      far: flags.filter((f) => f & TRI_FAR).length,
      sky: flags.filter((f) => f & TRI_SKY).length,
    },
  };
}
