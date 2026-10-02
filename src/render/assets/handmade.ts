import { Color } from 'three';
import {
  DRIVEN_GROUPS,
  TRI_FAR,
  TRI_GROUND,
  TRI_NEAR,
  TRI_PARTY_NEG,
  TRI_PARTY_POS,
  TRI_SKY,
  TRI_TWO_SIDED,
  UNIT_DARK,
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
  /**
   * Which of its design's looks this is (0, 1, 2 …): the walls take the palette's colours in
   * turn, mirrored every other look, so no two looks of a design come out the same until every
   * combination is used. The seed if not given.
   */
  rank?: number;
  /** The chance a window is lit at night. */
  lit: number;
  /** Copies may be mirrored left to right (zoned buildings; a civic site's layout is fixed). */
  mirror: boolean;
  /** The lot base under it: the colour of its top (the yard a shallow model leaves), or none. */
  base: Color | null;
  /** A zoned building's zone: what it makes of a yard behind it (M27). */
  yard?: 'R' | 'C' | 'I';
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
/** The lot base's top, above the model's zero (m); a model's own ground lies above it (`GROUND_FLOOR`). */
export const BASE_TOP = 0.04;
const EARTH = new Color('#8b7355');

/** Triangles being gathered for one level of detail. */
class Soup {
  pos: number[] = [];
  col: number[] = [];
  emi: number[] = [];
  win: number[] = [];
  nrm: number[] = [];
  /** The highest point drawn. */
  maxY = -Infinity;
  /** Per triangle: does it cast a shadow worth drawing (M26); `casting` for the next ones. */
  shade: number[] = [];
  casting = false;

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
    this.maxY = Math.max(this.maxY, ay, by, cy);
    this.shade.push(this.casting ? 1 : 0);
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
    for (let i = 1; i < m.pos.length; i += 3) this.maxY = Math.max(this.maxY, m.pos[i]!);
    for (let i = 0; i < m.pos.length; i++) {
      this.pos.push(m.pos[i]!);
      this.nrm.push(m.nrm[i]!);
      this.col.push(m.col[i]!);
    }
    for (let i = 0; i < m.emi.length; i++) {
      this.emi.push(m.emi[i]!);
      this.win.push(0);
    }
    // A generated piece casts but for its lit panes and what lies on the ground.
    for (let v = 0; v < m.emi.length; v += 3)
      this.shade.push(
        m.shade
          ? m.shade[v / 3]!
          : m.emi[v]! <= 0 && Math.max(m.pos[v * 3 + 1]!, m.pos[v * 3 + 4]!, m.pos[v * 3 + 7]!) > 0.3
            ? 1
            : 0,
      );
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
      shade: Uint8Array.from(this.shade),
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
  /** Set into another model's site, which has its own ground: its lawns and paving go. */
  inset?: boolean;
  /** Turned half round (an annex built onto the back of its building, facing out). */
  turn?: boolean;
}

/** Where in its palette a design's role starts (a small hash of the two). */
function offset(id: string, role: Role): number {
  let h = 7;
  for (const ch of `${id}:${role}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 97;
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
  const rank = o.rank ?? o.seed;
  const copies: Copy[] = [];
  for (let k = 0; k < n; k++) {
    const paint: (Color | undefined)[] = ROLES.map((_, i) => own(i));
    // How many colours the first repainted role (the walls) could take.
    let turns = 0;
    for (const role of Object.keys(FAMILIES) as Role[]) {
      const base = paint[ROLE[role]];
      if (!base || o.own?.includes(role)) continue;
      const family = nearestPalette(role, base);
      if (!family) continue;
      let pick: Color;
      if (!turns) {
        // The walls in turn: look by look, and copy by copy along a row.
        turns = family.length;
        pick = family[(rank + k) % family.length]!;
      } else if (k === 0) {
        // The roof and the rest in turn too, from a place of the design's own, so one design two
        // lots along doesn't come back under the same roof (the walls' creams differ little); a
        // second wall colour not the first's.
        const at = (rank + offset(model.id, role)) % family.length;
        pick = family[at]!;
        if (family.length > 1 && paint[ROLE.wall]?.equals(pick)) pick = family[(at + 1) % family.length]!;
      } else {
        // Neighbours in a row are painted differently.
        const before = copies[k - 1]?.paint[ROLE[role]];
        pick = family[Math.floor(r() * family.length)]!;
        for (let tries = 0; tries < 4 && before && pick.equals(before) && family.length > 1; tries++)
          pick = family[Math.floor(r() * family.length)]!;
      }
      paint[ROLE[role]] = pick;
    }
    // The first copy is mirrored every other look, so a street of one design doesn't keep its
    // garage on one side; with an even number of wall colours the order turns over each time
    // they come round, so no two looks agree until every colour has been both ways. Along a row,
    // at random.
    const turn = turns % 2 === 0 && turns ? rank + Math.floor(rank / turns) : rank;
    const flip = k === 0 ? turn % 2 === 1 : r() < 0.5;
    copies.push({
      x: -o.W / 2 + model.w * (k + 0.5),
      z,
      mirror: o.mirror && flip,
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

/**
 * How a design looks on a lot, as a string: each copy's design, mirroring and paint. Two lots with
 * the same string look the same (whatever their depth: a yard behind is all that differs).
 */
export function appearance(
  model: BakedModel,
  o: Pick<HandOptions, 'W' | 'D' | 'seed' | 'rank' | 'mirror' | 'own'>,
): string {
  return layout(model, { ...o, lit: 0, base: null })
    .map((c) => `${model.id}${c.mirror ? '~' : ''}:${c.paint.map((p) => p?.getHexString() ?? '').join(',')}`)
    .join('|');
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
    const sx = (c.mirror ? -c.scale : c.scale) * (c.turn ? -1 : 1);
    const sz = c.turn ? -c.scale : c.scale;
    for (let t = 0; t < model.triRole.length; t++) {
      const f = model.triFlags[t]!;
      if (!(f & level)) continue;
      if (c.inset && f & TRI_GROUND) continue;
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
        v[k * 3 + 2] = P[i + 2]! * sz + c.z;
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
        // A big glazed volume glows softly all night (walk-through after M28: at 0.3, brightened
        // from far off, a curtain-walled tower read as one cream lightbox).
        if (model.units[u - 1] === UNIT_GLOW) emi = 0.14;
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
      // Its shadow: not a pane's, nothing's on the ground, and close up not the small fittings
      // (the distant versions leave them out; their shadows are a few pixels).
      out.casting = u === 0 && !(f & TRI_GROUND) && (level !== TRI_NEAR || (f & TRI_FAR) !== 0);
      if (cut === Infinity) {
        out.tri(v[0]!, v[1]!, v[2]!, v[3]!, v[4]!, v[5]!, v[6]!, v[7]!, v[8]!, col, emi, win);
      } else {
        clipBelow(v, cut, out, col, emi, win);
        // A building cut off at the height it has reached is open at the top: its walls are
        // seen from inside too, or the far ones would vanish (ground surfaces aside).
        if (!(f & (TRI_GROUND | TRI_TWO_SIDED))) {
          for (let k = 0; k < 3; k++) {
            const s = v[3 + k]!;
            v[3 + k] = v[6 + k]!;
            v[6 + k] = s;
          }
          clipBelow(v, cut, out, INSIDE.copy(col).multiplyScalar(0.82), emi, win);
        }
      }
    }
  }
}

const WHITE = new Color(1, 1, 1);
const INSIDE = new Color();

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
  out.casting = false;
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

/** A box's top and four sides (no bottom), each wound to face out. */
function soupBox(
  out: Soup,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
  col: Color,
): void {
  const q = (a: number[], b: number[], c: number[], d: number[]) => {
    out.tri(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!, col, 0, 0);
    out.tri(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!, col, 0, 0);
  };
  q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]);
  q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]);
  q([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]);
  q([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]);
  q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
}

/** A flat rectangle facing up at height y. */
function patch(
  out: Soup,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y: number,
  col: Color,
  tag = 0,
): void {
  out.tri(x0, y, z0, x0, y, z1, x1, y, z1, col, tag, 0);
  out.tri(x0, y, z0, x1, y, z1, x1, y, z0, col, tag, 0);
}

/**
 * The yard behind a shallow hand-made model, from `z0` to the back of the lot (M27): a car park
 * with marked bays and a few cars behind shops and offices, a marked loading yard with crates (or
 * a container) behind industry, a lawn with a path and a shed behind homes. Close up only: the
 * markings, cars and clutter; from further off the surfaces alone.
 */
function yard(
  out: Soup,
  W: number,
  D: number,
  z0: number,
  kind: 'R' | 'C' | 'I',
  top: Color,
  near: boolean,
  seed: number,
): void {
  const z1 = D / 2 - 0.5;
  const za = z0 + 0.6;
  if (z1 - za < 3.5) return;
  const x0 = -W / 2 + 0.5;
  const x1 = W / 2 - 0.5;
  const r = modelRng(seed * 977 + Math.round(W * 10) + Math.round((z1 - za) * 100));
  out.casting = false;
  const y = BASE_TOP + 0.02;
  if (kind === 'C') {
    patch(out, x0, x1, za, z1, y, PALETTES.asphalt);
    if (!near) return;
    // Bays nose to the back of the lot (a second row facing them if there's room for an aisle).
    const rows = z1 - za >= 13 ? [z1 - 5, za + 5] : [z1 - 5];
    const bay = 2.6;
    const n = Math.floor((x1 - x0 - 0.4) / bay);
    const left = (x0 + x1) / 2 - (n * bay) / 2;
    rows.forEach((edge, k) => {
      const back = k === 0 ? z1 : za;
      const zLo = Math.min(edge, back);
      const zHi = Math.max(edge, back);
      for (let b = 0; b <= n; b++)
        patch(out, left + b * bay - 0.06, left + b * bay + 0.06, zLo, zHi, y + 0.012, PAINT);
      for (let b = 0; b < n; b++) {
        if (r() > 0.55) continue;
        const cx = left + (b + 0.5) * bay;
        const cz = (zLo + zHi) / 2;
        const col = PALETTES.cars[Math.floor(r() * PALETTES.cars.length)]!;
        soupBox(out, cx - 0.85, cx + 0.85, y + 0.3, y + 1.0, cz - 2.05, cz + 2.05, col);
        soupBox(out, cx - 0.75, cx + 0.75, y + 1.0, y + 1.48, cz - 1.05, cz + 1.05, PALETTES.carGlass);
      }
    });
  } else if (kind === 'I') {
    // The lot's own concrete, a yellow box marked on it and something stood in it.
    const lx0 = x0 + 0.6;
    const lx1 = x1 - 0.6;
    const lz0 = za + 0.4;
    const lz1 = z1 - 0.4;
    if (!near) return;
    const w = 0.14;
    patch(out, lx0, lx1, lz0, lz0 + w, y, PALETTES.yellow);
    patch(out, lx0, lx1, lz1 - w, lz1, y, PALETTES.yellow);
    patch(out, lx0, lx0 + w, lz0, lz1, y, PALETTES.yellow);
    patch(out, lx1 - w, lx1, lz0, lz1, y, PALETTES.yellow);
    if (lz1 - lz0 >= 3.4 && lx1 - lx0 >= 8 && r() < 0.5) {
      const col = PALETTES.containers[Math.floor(r() * PALETTES.containers.length)]!;
      const cx = lx0 + 1 + r() * (lx1 - lx0 - 8);
      const cz = (lz0 + lz1) / 2;
      soupBox(out, cx, cx + 6, y, y + 2.6, cz - 1.2, cz + 1.2, col);
    } else {
      const k = 2 + Math.floor(r() * 3);
      for (let i = 0; i < k; i++) {
        const cx = lx0 + 0.8 + i * 1.5;
        if (cx + 1.2 > lx1) break;
        const h = 0.6 + Math.floor(r() * 3) * 0.5;
        soupBox(out, cx, cx + 1.2, y, y + h, lz1 - 1.6, lz1 - 0.4, PALETTES.wood);
      }
    }
  } else {
    // A lawn (on paved lots too), a path to the back and a garden shed.
    const grass = top === PALETTES.grassRich ? PALETTES.grassRich : PALETTES.grass;
    if (top !== PALETTES.grass && top !== PALETTES.grassRich)
      patch(out, x0, x1, za, z1, y, grass, SURF_GRASS);
    const px = (r() - 0.5) * Math.max(0, W - 6);
    patch(out, px - 0.55, px + 0.55, z0, z1 - 1.2, y + 0.01, PALETTES.pave);
    if (!near) return;
    if (z1 - za >= 5 && W >= 7) {
      const sx = px > 0 ? x0 + 0.4 : x1 - 2.6;
      soupBox(out, sx, sx + 2.2, y, y + 2.1, z1 - 2.2, z1 - 0.2, PALETTES.wood);
      soupBox(out, sx - 0.1, sx + 2.3, y + 2.1, y + 2.3, z1 - 2.3, z1 - 0.1, PALETTES.roofs[3]!);
    }
  }
}

const PAINT = new Color('#f2f0e8');

/** An add-on annex or other piece set into a model: a design, where it stands, and how big. */
export interface Inset {
  model: BakedModel;
  x: number;
  z: number;
  y: number;
  scale: number;
  seed: number;
  /** Turned half round, its front to the back of the site. */
  turn?: boolean;
}

/** A civic annex's site (m): as `ANNEX_SITE` in the model spec. */
const ANNEX = { w: 9, d: 8 };

/** Is square metre (c, r) of a site set in a bitmap? */
function cell(bits: Uint8Array, cols: number, c: number, r: number): boolean {
  const i = r * cols + c;
  return ((bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
}

/**
 * Where an add-on annex stands on a hand-made civic site. `from` is where the generator would
 * put it, a back corner, which a hand-made site may have built on. The annex takes the clear
 * spot nearest that corner, off the site's roads and out of the way of its doors: along the back
 * of the site and down its sides, shrinking to about half size if it must; then along the front
 * or anywhere; failing that built onto the back of the building, turned to face out; failing
 * that where it is least in the way.
 * `taken` are annexes already placed (x, z, width, depth).
 */
export function clearPlace(
  site: BakedModel,
  from: { x: number; z: number; scale: number },
  taken: { x: number; z: number; w: number; d: number }[],
): { x: number; z: number; scale: number; turn?: boolean } {
  const W = site.w;
  const D = site.d;
  const cols = Math.ceil(W);
  const rows = Math.ceil(D);
  const gap = 0.25;
  /** How much in the way a rectangle is: built-on square metres count most, then kept-clear ones. */
  const cost = (x0: number, z0: number, x1: number, z1: number): number => {
    for (const t of taken)
      if (x0 < t.x + t.w / 2 && x1 > t.x - t.w / 2 && z0 < t.z + t.d / 2 && z1 > t.z - t.d / 2) return 1e9;
    let n = 0;
    const c0 = Math.max(0, Math.floor(x0 + W / 2));
    const c1 = Math.min(cols - 1, Math.floor(x1 + W / 2 - 1e-6));
    const r0 = Math.max(0, Math.floor(z0 + D / 2));
    const r1 = Math.min(rows - 1, Math.floor(z1 + D / 2 - 1e-6));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        if (cell(site.occupied, cols, c, r)) n += 100;
        else if (cell(site.approach, cols, c, r)) n += 1;
      }
    return n;
  };
  const side = from.x >= 0 ? 1 : -1;
  const SHRINK = [1, 0.85, 0.7, 0.58];
  /** Spots for an annex of this size: the back and sides, or the front and the rest. */
  const spots = (scale: number, back: boolean): [number, number][] => {
    const edgeX = W / 2 - 1 - (ANNEX.w * scale) / 2;
    const edgeZ = D / 2 - 1 - (ANNEX.d * scale) / 2;
    if (edgeX < 0 || edgeZ < 0) return [];
    const out: [number, number][] = [];
    if (back) {
      for (let t = 0; t <= 2 * edgeX; t++) out.push([side * (edgeX - t), edgeZ]);
      for (let t = 1; t <= 2 * edgeZ; t++) out.push([side * edgeX, edgeZ - t], [-side * edgeX, edgeZ - t]);
    } else {
      for (let t = 0; t <= 2 * edgeX; t++) out.push([side * (edgeX - t), -edgeZ]);
      for (let u = 1; u < 2 * edgeZ; u++)
        for (let t = 1; t < 2 * edgeX; t++) out.push([side * (edgeX - t), edgeZ - u]);
    }
    return out;
  };
  let best: { x: number; z: number; scale: number; turn?: boolean } = from;
  let bestCost = Infinity;
  for (const back of [true, false])
    for (const shrink of SHRINK) {
      const scale = Math.max(0.45, from.scale * shrink);
      const w = ANNEX.w * scale;
      const d = ANNEX.d * scale;
      for (const [x, z] of spots(scale, back)) {
        const c = cost(x - w / 2 - gap, z - d / 2 - gap, x + w / 2 + gap, z + d / 2 + gap);
        if (c === 0) return { x, z, scale };
        // No room anywhere: where it is least in the way, and smallest.
        if (c < bestCost || (c === bestCost && scale < best.scale)) {
          best = { x, z, scale };
          bestCost = c;
        }
      }
    }
  // No clear spot: built onto the back of the building instead, turned to face the back of the
  // site, its back wall in the building's and its front clear.
  for (const shrink of SHRINK) {
    const scale = Math.max(0.45, from.scale * shrink);
    const w = ANNEX.w * scale;
    const d = ANNEX.d * scale;
    const z = D / 2 - 0.5 - d / 2;
    const edgeX = W / 2 - 1 - w / 2;
    if (edgeX < 0 || z < 0) continue;
    for (let t = 0; t <= 2 * edgeX; t++) {
      const x = side * (edgeX - t);
      // Its front half must be clear; up to half its depth may be in the building.
      const front = cost(x - w / 2 - gap, z, x + w / 2 + gap, z + d / 2 + 0.25);
      const into = cost(x - w / 2, z - d / 2, x + w / 2, z);
      if (front >= 100 || into >= 1e9) continue;
      const c = front + (into % 100) + 0.5;
      if (c < bestCost) {
        best = { x, z, scale, turn: true };
        bestCost = c;
      }
    }
  }
  return best;
}

/**
 * The clear spot on a hand-made civic site nearest (x, z) for something w by d metres (a site
 * crane, the builders' cabins): nothing of the model over head height within half a metre.
 * The spot asked for, if there is none within 40 m.
 */
export function nearestClear(
  site: BakedModel,
  x: number,
  z: number,
  w: number,
  d: number,
): { x: number; z: number } {
  const W = site.w;
  const D = site.d;
  const cols = Math.ceil(W);
  const rows = Math.ceil(D);
  const free = (cx: number, cz: number): boolean => {
    const x0 = cx - w / 2 - 0.5;
    const x1 = cx + w / 2 + 0.5;
    const z0 = cz - d / 2 - 0.5;
    const z1 = cz + d / 2 + 0.5;
    // Inside the hoarding, a metre and a half from the site's edge.
    if (x0 < -W / 2 + 1.5 || x1 > W / 2 - 1.5 || z0 < -D / 2 + 1.5 || z1 > D / 2 - 1.5) return false;
    for (let r = Math.floor(z0 + D / 2); r <= Math.min(rows - 1, Math.floor(z1 + D / 2)); r++)
      for (let c = Math.floor(x0 + W / 2); c <= Math.min(cols - 1, Math.floor(x1 + W / 2)); c++)
        if (cell(site.occupied, cols, c, r) || cell(site.approach, cols, c, r)) return false;
    return true;
  };
  // Rings of growing radius round the spot.
  for (let radius = 0; radius <= 40; radius++) {
    if (radius === 0) {
      if (free(x, z)) return { x, z };
      continue;
    }
    let best: { x: number; z: number } | null = null;
    let bestD = Infinity;
    for (let i = -radius; i <= radius; i++)
      for (const [dx, dz] of [
        [i, -radius],
        [i, radius],
        [-radius, i],
        [radius, i],
      ] as const) {
        const dist = Math.hypot(dx, dz);
        if (dist < bestD && free(x + dx, z + dz)) {
          best = { x: x + dx, z: z + dz };
          bestD = dist;
        }
      }
    if (best) return best;
  }
  return { x, z };
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
      return { ...c, paint, x: a.x, z: a.z, y: a.y, scale: a.scale, unit0: 0, inset: true, turn: a.turn };
    }),
  }));
  // Windows across the copies, then the insets': each with the chance it is lit.
  const chances: number[] = [];
  const chance = (m: BakedModel) => {
    for (const kind of m.units)
      chances.push(kind === UNIT_SHOP ? 0.9 : kind === UNIT_GLOW || kind === UNIT_DARK ? 0 : o.lit);
  };
  for (let k = 0; k < copies.length; k++) chance(model);
  for (const a of inset) {
    for (const c of a.copies) c.unit0 = chances.length;
    chance(a.model);
  }
  // The yard a shallow model leaves at the back of its lot (M27).
  const yardFrom = copies.length ? copies[0]!.z + model.d / 2 : o.D / 2;
  const level = (flag: number, sides: boolean, height?: number): ModelData => {
    const s = new Soup();
    if (o.base) base(s, o.W, o.D, o.base, sides);
    if (o.base && o.yard && flag !== TRI_SKY)
      yard(s, o.W, o.D, yardFrom, o.yard, o.base, flag === TRI_NEAR, o.seed);
    emit(model, copies, flag, o, s);
    for (const a of inset) emit(a.model, a.copies, flag, { ...o, fill: undefined, reveal: undefined }, s);
    // A generated piece's own distant version at each level (M28).
    for (const e of extra)
      s.add(flag === TRI_NEAR ? e : flag === TRI_FAR ? (e.far ?? e) : (e.sky ?? e.far ?? e));
    // As tall as what is drawn: a landfill's mound as full as it is, a project as far as it has
    // risen, with its cranes (picking and icons go by it).
    return s.build(height ?? Math.max(0, s.maxY), chances);
  };
  const near = level(TRI_NEAR, true);
  near.far = level(TRI_FAR, true, near.height);
  near.sky = level(TRI_SKY, false, near.height);
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
            Math.abs(x - a.at.x) < (a.model.w * a.at.scale) / 2 + 2.5 &&
            Math.abs(z - a.at.z) < (a.model.d * a.at.scale) / 2 + 2.5,
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

  /** Every design, by kind and what it stands for. */
  list(): BakedModel[] {
    return [...this.designs.values()].flat();
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
   * With two designs or more every look is hand-made, the designs in turn (repainted and
   * mirrored look by look); a single design shares the looks with the generator's variants
   * (every other look), so a street of them isn't one house over and over.
   */
  zoned(def: string, W: number, D: number, look: number): BakedModel | null {
    const fit = this.all('zoned', def).filter((m) => HandmadeModels.fits(m, W, D));
    const n = fit.length;
    if (!n) return null;
    if (n >= 2) return fit[look % n]!;
    return look % 2 === 0 ? fit[0]! : null;
  }

  /** Which of its design's looks a zoned look is (for `HandOptions.rank`). */
  rank(def: string, W: number, D: number, look: number): number {
    const n = this.all('zoned', def).filter((m) => HandmadeModels.fits(m, W, D)).length;
    return Math.floor(look / Math.max(2, n));
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
