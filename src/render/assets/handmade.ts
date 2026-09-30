import { Color } from 'three';
import {
  DRIVEN_GROUPS,
  TRI_FAR,
  TRI_NEAR,
  TRI_PARTY_NEG,
  TRI_PARTY_POS,
  TRI_SKY,
  UNIT_GLOW,
  UNIT_SHOP,
  type BakedModel,
} from '../../models/baked';
import { ROLES, type Role } from '../../models/spec';
import { SURF_GRASS, SURF_HEDGE, modelRng, type ModelData } from './builder';
import { PALETTES } from './models';

/**
 * Hand-made models in the game (phase 3). The build converts each GLB into triangles tagged by
 * material role, window and part (src/models); here a design becomes a drawable model for one
 * lot or site: as many copies side by side as fill the lot's width, each repainted from the
 * game's palettes and perhaps mirrored, standing on the game's lot base, with the generator's
 * darkening near the ground, windows each copy lights for itself, and its far and skyline
 * versions.
 */

const ROLE = Object.fromEntries(ROLES.map((r, i) => [r, i])) as Record<Role, number>;
const GROUP = Object.fromEntries(DRIVEN_GROUPS.map((g, i) => [g, i + 1])) as Record<string, number>;

/** The palettes a repainted role may take, by how the model's own colour reads. */
const WALL_FAMILIES = [
  PALETTES.wallsR,
  PALETTES.wallsRich,
  PALETTES.wallsC,
  PALETTES.wallsI,
  PALETTES.brick,
  PALETTES.modern,
];
const FAMILIES: Partial<Record<Role, Color[][]>> = {
  wall: WALL_FAMILIES,
  wall_alt: WALL_FAMILIES,
  roof: [PALETTES.roofs],
  awning: [PALETTES.awnings],
  sign: [PALETTES.signs],
};
/** A colour further than this (in sRGB) from every palette is the model's own: it is kept. */
const OWN_COLOUR = 0.2;

const srgb = new Color();
function distance(a: Color, b: Color): number {
  const ar = srgb.copy(a).convertLinearToSRGB().r;
  const ag = srgb.g;
  const ab = srgb.b;
  srgb.copy(b).convertLinearToSRGB();
  return Math.hypot(ar - srgb.r, ag - srgb.g, ab - srgb.b);
}

/** The palette nearest a colour: brick stays brick, pastels stay pastel. Null: keep the colour. */
export function nearestPalette(role: Role, c: Color): Color[] | null {
  let best: Color[] | null = null;
  let bestD = OWN_COLOUR;
  for (const family of FAMILIES[role] ?? []) {
    for (const p of family) {
      const d = distance(c, p);
      if (d < bestD) {
        bestD = d;
        best = family;
      }
    }
  }
  return best;
}

export interface HandOptions {
  /** The lot or site (m): along the road, and away from it. */
  W: number;
  D: number;
  /** What makes this copy itself: its paint, mirroring and (with the building) its lit windows. */
  seed: number;
  /** The chance a window is lit at night. */
  lit: number;
  /** Copies may be mirrored left to right (zoned buildings; a civic site's layout is fixed). */
  mirror: boolean;
  /** The lot base under it: the colour of its top (the yard a shallow model leaves), or none. */
  base: Color | null;
  /** How full the landfill is (0..1): the mound rises with it. */
  fill?: number;
  /** A project being built: the share of the model's height raised so far, and what isn't there yet. */
  reveal?: number;
  bare?: boolean;
  /**
   * Roles this model keeps in its own colours though the game would repaint them: a civic
   * building's signs and awnings say what it is (a hospital's red cross).
   */
  own?: readonly Role[];
}

const STONE = PALETTES.stone;
/** The lot base's top, above the model's zero (m). */
export const BASE_TOP = 0.04;
const EARTH = new Color('#8b7355');

/** Triangles being gathered for one level of detail. */
class Soup {
  pos: number[] = [];
  col: number[] = [];
  emi: number[] = [];
  win: number[] = [];
  nrm: number[] = [];

  /** A triangle, its corners counter-clockwise from outside; colour darkened near the ground. */
  tri(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    col: Color,
    emi: number,
    win: number,
  ): void {
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l;
    ny /= l;
    nz /= l;
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    this.nrm.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    for (const y of [ay, by, cy]) {
      // The generator's baked darkening at the foot of walls (panes that light are left clear).
      const ao = emi > 0 || win > 0 ? 1 : 0.78 + 0.22 * Math.min(1, y / 3);
      this.col.push(col.r * ao, col.g * ao, col.b * ao);
      this.emi.push(emi);
      this.win.push(win);
    }
  }

  /** Add a generated model (an annex, a building site's cranes) as it is. */
  add(m: ModelData): void {
    for (let i = 0; i < m.pos.length; i++) {
      this.pos.push(m.pos[i]!);
      this.nrm.push(m.nrm[i]!);
      this.col.push(m.col[i]!);
    }
    for (let i = 0; i < m.emi.length; i++) {
      this.emi.push(m.emi[i]!);
      this.win.push(0);
    }
  }

  build(height: number, chances: number[]): ModelData {
    return {
      pos: new Float32Array(this.pos),
      nrm: new Float32Array(this.nrm),
      col: new Float32Array(this.col),
      emi: new Float32Array(this.emi),
      height,
      win: Uint16Array.from(this.win),
      winChance: Float32Array.from(chances),
    };
  }
}

interface Copy {
  x: number;
  z: number;
  mirror: boolean;
  /** Colour by role for this copy. */
  paint: (Color | undefined)[];
  /** The first window of this copy among the whole model's. */
  unit0: number;
  /** A neighbour in the row hides this copy's side: at +x, at −x. */
  joinPos: boolean;
  joinNeg: boolean;
  scale: number;
  y: number;
}

/** Where a model's copies stand on a lot, and how each is painted. */
function layout(model: BakedModel, o: HandOptions): Copy[] {
  const n = Math.max(1, Math.round(o.W / model.w));
  const r = modelRng((o.seed + 1) * 7919 + model.design * 131 + n * 17);
  // A model shallower than its lot stands at the front, its steps and awnings inside the lot.
  const spare = o.D - model.d;
  const back = spare > 0.01 ? Math.min(spare, model.over.front > 0.05 ? model.over.front + 0.3 : 0) : 0;
  const z = -o.D / 2 + model.d / 2 + back;
  const own = (role: number) => {
    const c = model.colors[role];
    return c ? new Color(c[0], c[1], c[2]) : undefined;
  };
  const copies: Copy[] = [];
  for (let k = 0; k < n; k++) {
    const paint: (Color | undefined)[] = ROLES.map((_, i) => own(i));
    for (const role of Object.keys(FAMILIES) as Role[]) {
      const base = paint[ROLE[role]];
      if (!base || o.own?.includes(role)) continue;
      const family = nearestPalette(role, base);
      if (!family) continue;
      // Neighbours in a row are painted differently.
      const before = copies[k - 1]?.paint[ROLE[role]];
      let pick = family[Math.floor(r() * family.length)]!;
      for (let tries = 0; tries < 4 && before && pick.equals(before) && family.length > 1; tries++)
        pick = family[Math.floor(r() * family.length)]!;
      paint[ROLE[role]] = pick;
    }
    copies.push({
      x: -o.W / 2 + model.w * (k + 0.5),
      z,
      mirror: o.mirror && r() < 0.5,
      paint,
      unit0: k * model.units.length,
      joinPos: model.party && k < n - 1,
      joinNeg: model.party && k > 0,
      scale: 1,
      y: 0,
    });
  }
  return copies;
}

/** Emit one level of detail of a model's copies into a soup. */
function emit(model: BakedModel, copies: Copy[], level: number, o: HandOptions, out: Soup): void {
  const P = model.positions;
  const I = model.index;
  const moundScale = o.fill === undefined ? 1 : (1 + 12 * Math.max(0, Math.min(1, o.fill))) / 13;
  const building = o.reveal !== undefined;
  const cut = building ? model.h * o.reveal! : Infinity;
  const v = new Float64Array(9);
  for (const c of copies) {
    const sx = c.mirror ? -c.scale : c.scale;
    for (let t = 0; t < model.triRole.length; t++) {
      const f = model.triFlags[t]!;
      if (!(f & level)) continue;
      // A row's party walls: whichever of this copy's sides has a neighbour against it.
      if (c.joinPos && f & (c.mirror ? TRI_PARTY_NEG : TRI_PARTY_POS)) continue;
      if (c.joinNeg && f & (c.mirror ? TRI_PARTY_POS : TRI_PARTY_NEG)) continue;
      const g = model.triGroup[t]!;
      // The rocket and the receiver arrive when the rest is finished.
      if (building && (g === GROUP.rocket || g === GROUP.receiver)) continue;
      const role = model.triRole[t]!;
      for (let k = 0; k < 3; k++) {
        const i = I[t * 3 + k]! * 3;
        v[k * 3] = P[i]! * sx + c.x;
        v[k * 3 + 1] = P[i + 1]! * c.scale * (g === GROUP.mound ? moundScale : 1) + c.y;
        v[k * 3 + 2] = P[i + 2]! * c.scale + c.z;
      }
      // Mirroring turns the winding round; swap two corners to turn it back.
      if (c.mirror)
        for (let k = 0; k < 3; k++) {
          const s = v[3 + k]!;
          v[3 + k] = v[6 + k]!;
          v[6 + k] = s;
        }
      let col = c.paint[role] ?? WHITE;
      let emi = 0;
      let win = 0;
      const u = model.triUnit[t]!;
      if (u > 0) {
        if (model.units[u - 1] === UNIT_GLOW) emi = 0.3;
        else win = c.unit0 + u;
      } else if (role === ROLE.grass) emi = SURF_GRASS;
      else if (role === ROLE.hedge) emi = SURF_HEDGE;
      // A building site: bare earth until the last stage, and nothing lit until it opens.
      if (o.bare && (role === ROLE.grass || role === ROLE.hedge || role === ROLE.water)) {
        col = EARTH;
        emi = 0;
      }
      if (building && (win || emi > 0)) {
        win = 0;
        emi = 0;
      }
      if (cut === Infinity) {
        out.tri(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, v[6]!, v[7]!, v[8]!, col, emi, win);
      } else clipBelow(v, cut, out, col, emi, win);
    }
  }
}

const WHITE = new Color(1, 1, 1);

/** The part of a triangle at or below height `cut` (a building rising stage by stage). */
function clipBelow(v: Float64Array, cut: number, out: Soup, col: Color, emi: number, win: number): void {
  const below = [v[1]! <= cut, v[4]! <= cut, v[7]! <= cut];
  const n = (below[0] ? 1 : 0) + (below[1] ? 1 : 0) + (below[2] ? 1 : 0);
  if (n === 0) return;
  if (n === 3) {
    out.tri(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, v[6]!, v[7]!, v[8]!, col, emi, win);
    return;
  }
  // Walk the corners in order, adding where an edge crosses the cut.
  const poly: number[] = [];
  for (let k = 0; k < 3; k++) {
    const a = k * 3;
    const b = ((k + 1) % 3) * 3;
    if (below[k]) poly.push(v[a]!, v[a + 1]!, v[a + 2]!);
    if (below[k] !== below[(k + 1) % 3]) {
      const s = (cut - v[a + 1]!) / (v[b + 1]! - v[a + 1]!);
      poly.push(v[a]! + (v[b]! - v[a]!) * s, cut, v[a + 2]! + (v[b + 2]! - v[a + 2]!) * s);
    }
  }
  for (let k = 1; k + 1 < poly.length / 3; k++)
    out.tri(
      poly[0]!,
      poly[1]!,
      poly[2]!,
      poly[k * 3]!,
      poly[k * 3 + 1]!,
      poly[k * 3 + 2]!,
      poly[k * 3 + 3]!,
      poly[k * 3 + 4]!,
      poly[k * 3 + 5]!,
      col,
      emi,
      win,
    );
}

/**
 * The lot base: the game's plinth under every building, which hides a slope under the lot. A
 * hand-made model brings its own ground, so the base's top is at the model's zero and shows only
 * where the model leaves the lot bare (a yard behind a shallow model).
 */
function base(out: Soup, W: number, D: number, top: Color, sides: boolean): void {
  const x0 = -W / 2;
  const x1 = W / 2;
  const z0 = -D / 2;
  const z1 = D / 2;
  const tag = top === PALETTES.grass || top === PALETTES.grassRich ? SURF_GRASS : 0;
  // Just above the ground a level site is graded to (or the two would flicker), and under the
  // model's own lawns and paving (5 cm up or more).
  const y1 = BASE_TOP;
  out.tri(x0, y1, z0, x0, y1, z1, x1, y1, z1, top, tag, 0);
  out.tri(x0, y1, z0, x1, y1, z1, x1, y1, z0, top, tag, 0);
  if (!sides) return;
  const y0 = -5;
  const wall = (ax: number, az: number, bx: number, bz: number) => {
    out.tri(ax, y0, az, ax, y1, az, bx, y1, bz, STONE, 0, 0);
    out.tri(ax, y0, az, bx, y1, bz, bx, y0, bz, STONE, 0, 0);
  };
  wall(x0, z0, x1, z0);
  wall(x1, z1, x0, z1);
  wall(x0, z1, x0, z0);
  wall(x1, z0, x1, z1);
}

/** An add-on annex or other piece set into a model: a design, where it stands, and how big. */
export interface Inset {
  model: BakedModel;
  x: number;
  z: number;
  y: number;
  scale: number;
  seed: number;
}

/** A civic annex's site (m): as `ANNEX_SITE` in the model spec. */
const ANNEX = { w: 9, d: 8 };

/**
 * Where an add-on annex stands on a hand-made civic site. `from` is where the generator would
 * put it, a back corner, which a hand-made site may have built on. The annex takes the clear
 * spot nearest that corner: along the back of the site, down the sides, along the front, then
 * anywhere; failing that a smaller annex (down to about half size); failing that the spot where
 * it overlaps least. `taken` are annexes already placed (x, z, width, depth).
 */
export function clearPlace(
  site: BakedModel,
  from: { x: number; z: number; scale: number },
  taken: { x: number; z: number; w: number; d: number }[],
): { x: number; z: number; scale: number } {
  const W = site.w;
  const D = site.d;
  const cols = Math.ceil(W);
  const rows = Math.ceil(D);
  const gap = 0.5;
  /** Square metres of the rectangle that are built on (a placed annex counts for all of it). */
  const overlap = (x0: number, z0: number, x1: number, z1: number): number => {
    for (const t of taken)
      if (x0 < t.x + t.w / 2 && x1 > t.x - t.w / 2 && z0 < t.z + t.d / 2 && z1 > t.z - t.d / 2) return 1e6;
    let n = 0;
    const c0 = Math.max(0, Math.floor(x0 + W / 2));
    const c1 = Math.min(cols - 1, Math.floor(x1 + W / 2 - 1e-6));
    const r0 = Math.max(0, Math.floor(z0 + D / 2));
    const r1 = Math.min(rows - 1, Math.floor(z1 + D / 2 - 1e-6));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        if (site.occupied[(r * cols + c) >> 3]! & (1 << ((r * cols + c) & 7))) n++;
    return n;
  };
  const side = from.x >= 0 ? 1 : -1;
  let best = from;
  let bestOver = Infinity;
  for (const shrink of [1, 0.85, 0.7, 0.58]) {
    const scale = Math.max(0.45, from.scale * shrink);
    const w = ANNEX.w * scale;
    const d = ANNEX.d * scale;
    const edgeX = W / 2 - 1 - w / 2;
    const edgeZ = D / 2 - 1 - d / 2;
    if (edgeX < 0 || edgeZ < 0) continue;
    const spots: [number, number][] = [];
    // Along the back from its corner, down both sides, along the front, then the rest.
    for (let t = 0; t <= 2 * edgeX; t++) spots.push([side * (edgeX - t), edgeZ]);
    for (let t = 1; t <= 2 * edgeZ; t++) spots.push([side * edgeX, edgeZ - t], [-side * edgeX, edgeZ - t]);
    for (let t = 0; t <= 2 * edgeX; t++) spots.push([side * (edgeX - t), -edgeZ]);
    for (let u = 1; u < 2 * edgeZ; u++)
      for (let t = 1; t < 2 * edgeX; t++) spots.push([side * (edgeX - t), edgeZ - u]);
    for (const [x, z] of spots) {
      const over = overlap(x - w / 2 - gap, z - d / 2 - gap, x + w / 2 + gap, z + d / 2 + gap);
      if (over === 0) return { x, z, scale };
      // No room anywhere: the smallest annex where it overlaps least.
      if (over <= bestOver) {
        if (over < bestOver || scale < best.scale) best = { x, z, scale };
        bestOver = over;
      }
    }
  }
  return best;
}

/**
 * A drawable model of a design on a lot or site, with its far and skyline versions. `extra`
 * (generated pieces: a generated annex, a building site's cranes) is added to every level.
 */
export function buildHandModel(
  model: BakedModel,
  o: HandOptions,
  insets: Inset[] = [],
  extra: ModelData[] = [],
): ModelData {
  const copies = layout(model, o);
  const inset = insets.map((a) => ({
    at: a,
    model: a.model,
    copies: layout(a.model, { ...o, W: a.model.w, D: a.model.d, seed: a.seed, mirror: false }).map((c) => {
      // An annex is painted as the building it belongs to: its walls and roofs.
      const paint = [...c.paint];
      for (const role of ['wall', 'wall_alt', 'roof'] as const)
        if (paint[ROLE[role]] && copies[0]!.paint[ROLE[role]])
          paint[ROLE[role]] = copies[0]!.paint[ROLE[role]];
      return { ...c, paint, x: a.x, z: a.z, y: a.y, scale: a.scale, unit0: 0 };
    }),
  }));
  // Windows across the copies, then the insets': each with the chance it is lit.
  const chances: number[] = [];
  const chance = (m: BakedModel) => {
    for (const kind of m.units) chances.push(kind === UNIT_SHOP ? 0.9 : kind === UNIT_GLOW ? 0 : o.lit);
  };
  for (let k = 0; k < copies.length; k++) chance(model);
  for (const a of inset) {
    for (const c of a.copies) c.unit0 = chances.length;
    chance(a.model);
  }
  let top = model.h * (o.reveal ?? 1);
  for (const e of extra) top = Math.max(top, e.height);
  const level = (flag: number, sides: boolean): ModelData => {
    const s = new Soup();
    if (o.base) base(s, o.W, o.D, o.base, sides);
    emit(model, copies, flag, o, s);
    for (const a of inset) emit(a.model, a.copies, flag, { ...o, fill: undefined, reveal: undefined }, s);
    for (const e of extra) s.add(e);
    return s.build(top, chances);
  };
  const near = level(TRI_NEAR, true);
  near.far = level(TRI_FAR, true);
  near.sky = level(TRI_SKY, false);
  near.hand = model.id;
  // Markers, carried to where each copy stands.
  const place = (list: number[], bare: boolean): Float32Array => {
    const out: number[] = [];
    if (bare) return new Float32Array(0);
    for (const c of copies)
      for (let i = 0; i < list.length; i += 3) {
        const x = list[i]! * (c.mirror ? -1 : 1) + c.x;
        const z = list[i + 2]! + c.z;
        // No tree where an annex has been built.
        const built = inset.some(
          (a) =>
            Math.abs(x - a.at.x) < (a.model.w * a.at.scale) / 2 + 1.5 &&
            Math.abs(z - a.at.z) < (a.model.d * a.at.scale) / 2 + 1.5,
        );
        if (!built) out.push(x, list[i + 1]!, z);
      }
    return new Float32Array(out);
  };
  near.trees = place(model.trees, !!o.bare);
  near.stacks = place(model.stacks, o.reveal !== undefined);
  return near;
}

/** Hand-made designs by what they stand for. */
export class HandmadeModels {
  private designs = new Map<string, BakedModel[]>();
  /** Goes up whenever the set of models changes: caches built from it are stale. */
  version = 0;

  set(models: BakedModel[]): void {
    this.designs.clear();
    for (const m of models) {
      const k = `${m.kind}:${m.def}`;
      let list = this.designs.get(k);
      if (!list) this.designs.set(k, (list = []));
      list.push(m);
    }
    for (const list of this.designs.values()) list.sort((a, b) => a.design - b.design);
    this.version++;
  }

  get count(): number {
    let n = 0;
    for (const l of this.designs.values()) n += l.length;
    return n;
  }

  all(kind: BakedModel['kind'], def: string): BakedModel[] {
    return this.designs.get(`${kind}:${def}`) ?? [];
  }

  /** A design stands on a lot as wide as it, or twice or three times as wide, and no shallower. */
  static fits(m: BakedModel, W: number, D: number): boolean {
    const n = Math.round(W / m.w);
    return n >= 1 && n <= 3 && Math.abs(n * m.w - W) < 0.05 && m.d <= D + 0.05;
  }

  /**
   * The design a zoned building of this look takes on its lot, or null for a generated one.
   * With three designs or more every look is hand-made; with fewer they share the looks with
   * the generator's variants (one design: every other look; two: two looks in three).
   */
  zoned(def: string, W: number, D: number, look: number): BakedModel | null {
    const fit = this.all('zoned', def).filter((m) => HandmadeModels.fits(m, W, D));
    const n = fit.length;
    if (!n) return null;
    if (n >= 3) return fit[look % n]!;
    const slot = look % (n + 1);
    return slot < n ? fit[slot]! : null;
  }

  civic(def: string, variant: number): BakedModel | null {
    const list = this.all('civic', def);
    return list.length ? list[variant % list.length]! : null;
  }

  annex(module: string, variant: number): BakedModel | null {
    const list = this.all('annex', module);
    return list.length ? list[variant % list.length]! : null;
  }
}

export const handmade = new HandmadeModels();
