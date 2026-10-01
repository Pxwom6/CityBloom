import { Color } from 'three';

/**
 * Procedural model builder. Local space: x along the road (width), z away from the road (the front
 * faces −z), y up, origin at the lot centre on the ground. Every triangle carries a colour and an
 * emissive weight (lit windows at night). Ambient occlusion is baked into colours near the ground.
 */
export interface ModelData {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  /**
   * Per vertex: 0..1 the night glow of a lit window; a negative value tags a surface that follows
   * the seasons (SURF_GRASS, SURF_HEDGE) and never glows.
   */
  emi: Float32Array;
  height: number;
  /**
   * Hand-made models (phase 3). Windows that each copy lights for itself: per vertex, the window
   * it belongs to plus one (0 = none, its `emi` stands), and per window the chance it is lit.
   */
  win?: Uint16Array;
  winChance?: Float32Array;
  /** Distant versions: fewer triangles, the same shape and colours. */
  far?: ModelData;
  sky?: ModelData;
  /** Where the game plants its own trees (x, y, z each) and where smoke rises from (stack tops). */
  trees?: Float32Array;
  stacks?: Float32Array;
  /** The hand-made design this was built from (its file name without .glb). */
  hand?: string;
  /**
   * Per triangle: 1 if it casts a shadow worth drawing (M26). Without it, every triangle does
   * but lit panes and what lies flat on the ground.
   */
  shade?: Uint8Array;
}

/** `emi` tags for surfaces that change with the seasons. */
export const SURF_GRASS = -1;
export const SURF_HEDGE = -2;

/**
 * Colours the generator paints lawns and hedges with: triangles in them are tagged to follow
 * the seasons, as the terrain does (phase 3). Registered by the model files that own them.
 */
export const SEASONAL = new Map<Color, number>();

const tmp = new Color();

/**
 * Levels of detail a generated triangle is drawn at (M28), as a mask: near, far, skyline. Detail is
 * kept close up (NEAR_ONLY: fittings, cars, garden things) or close up and in the middle distance
 * (IN_FAR: balconies, signs, rooftop plant); SKY_ONLY marks a simpler stand-in drawn only from far
 * off (a band of windows for the panes along a floor). A distant version keeps the main volumes,
 * roofs and windows.
 */
const L_NEAR = 1;
const L_FAR = 2;
const L_SKY = 4;
export const IN_SKY = L_NEAR | L_FAR | L_SKY;
export const IN_FAR = L_NEAR | L_FAR;
export const NEAR_ONLY = L_NEAR;
export const SKY_ONLY = L_SKY;

export class ModelBuilder {
  private p: number[] = [];
  private n: number[] = [];
  private c: number[] = [];
  private e: number[] = [];
  /** Per triangle: does it cast a shadow worth drawing (M26); windows and the ground don't. */
  private s: number[] = [];
  /** Per triangle: the levels of detail it is drawn at (M28, a mask). */
  private l: number[] = [];
  private casting = true;
  /** The levels the next triangles belong to; `detail()` sets them for a block of drawing. */
  private level = IN_SKY;
  height = 0;

  /**
   * Draw `fn`'s triangles only at these levels (NEAR_ONLY, IN_FAR, SKY_ONLY), and never at a level
   * the block they're drawn in leaves out.
   */
  detail(level: number, fn: () => void): void {
    const was = this.level;
    this.level = was & level;
    try {
      fn();
    } finally {
      this.level = was;
    }
  }

  /** Triangle with an explicit normal. */
  tri(a: number[], b: number[], c: number[], nx: number, ny: number, nz: number, col: Color, emi = 0): void {
    if (emi === 0) emi = SEASONAL.get(col) ?? 0;
    this.s.push(this.casting && emi <= 0 && Math.max(a[1]!, b[1]!, c[1]!) > 0.3 ? 1 : 0);
    this.l.push(this.level);
    for (const v of [a, b, c]) {
      this.p.push(v[0]!, v[1]!, v[2]!);
      this.n.push(nx, ny, nz);
      // Baked ambient occlusion: darker at the foot of walls.
      const ao = emi > 0 ? 1 : 0.78 + 0.22 * Math.min(1, v[1]! / 3);
      this.c.push(col.r * ao, col.g * ao, col.b * ao);
      this.e.push(emi);
      if (v[1]! > this.height) this.height = v[1]!;
    }
  }

  /** Quad a-b-c-d counter-clockwise when seen from the side the normal points to. */
  quad(a: number[], b: number[], c: number[], d: number[], col: Color, emi = 0): void {
    const ux = b[0]! - a[0]!;
    const uy = b[1]! - a[1]!;
    const uz = b[2]! - a[2]!;
    const vx = d[0]! - a[0]!;
    const vy = d[1]! - a[1]!;
    const vz = d[2]! - a[2]!;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    this.tri(a, b, c, nx, ny, nz, col, emi);
    this.tri(a, c, d, nx, ny, nz, col, emi);
  }

  /** Axis-aligned box (no bottom face). */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: Color, top?: Color): void {
    const t = top ?? col;
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], t); // top
    this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], col); // front (−z)
    this.quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], col); // back (+z)
    this.quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], col); // left (−x)
    this.quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], col); // right (+x)
  }

  /** Vertical cylinder approximated with `sides` facets. */
  cylinder(
    cx: number,
    cz: number,
    r: number,
    y0: number,
    y1: number,
    col: Color,
    sides = 8,
    topCol?: Color,
  ): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r;
      const z0 = cz + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r;
      const z1 = cz + Math.sin(a1) * r;
      this.quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z1], [x1, y0, z1], col);
      this.tri([cx, y1, cz], [x1, y1, z1], [x0, y1, z0], 0, 1, 0, topCol ?? col);
    }
  }

  /** Truncated cone (cooling towers, tanks, spires): radius r0 at y0 to r1 at y1. */
  frustum(
    cx: number,
    cz: number,
    r0: number,
    r1: number,
    y0: number,
    y1: number,
    col: Color,
    sides = 12,
    cap = true,
  ): void {
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2;
      const a1 = ((i + 1) / sides) * Math.PI * 2;
      const p = (r: number, a: number, y: number) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      this.quad(p(r0, a0, y0), p(r1, a0, y1), p(r1, a1, y1), p(r0, a1, y0), col);
      if (cap && r1 > 0.01) this.tri([cx, y1, cz], p(r1, a1, y1), p(r1, a0, y1), 0, 1, 0, col);
    }
  }

  /** Low dome (hemisphere approximation) of radius r on y. */
  dome(cx: number, cz: number, r: number, y: number, col: Color, rings = 4, sides = 12): void {
    for (let k = 0; k < rings; k++) {
      const t0 = (k / rings) * (Math.PI / 2);
      const t1 = ((k + 1) / rings) * (Math.PI / 2);
      this.frustum(
        cx,
        cz,
        r * Math.cos(t0),
        r * Math.cos(t1),
        y + r * Math.sin(t0),
        y + r * Math.sin(t1),
        col,
        sides,
        k === rings - 1,
      );
    }
  }

  /** Gable roof over [x0,x1]×[z0,z1] from height y, ridge along x (or z). */
  gable(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    y: number,
    h: number,
    col: Color,
    gableCol: Color,
    alongX = true,
    over = 0.4,
  ): void {
    if (alongX) {
      const zm = (z0 + z1) / 2;
      const a = [x0 - over, y, z0 - over];
      const b = [x1 + over, y, z0 - over];
      const c = [x1 + over, y + h, zm];
      const d = [x0 - over, y + h, zm];
      this.quad(a, d, c, b, col);
      this.quad(
        [x1 + over, y, z1 + over],
        [x1 + over, y + h, zm],
        [x0 - over, y + h, zm],
        [x0 - over, y, z1 + over],
        col,
      );
      this.tri([x0, y, z0], [x0, y, z1], [x0, y + h, zm], -1, 0, 0, gableCol);
      this.tri([x1, y, z1], [x1, y, z0], [x1, y + h, zm], 1, 0, 0, gableCol);
    } else {
      const xm = (x0 + x1) / 2;
      this.quad(
        [x0 - over, y, z1 + over],
        [xm, y + h, z1 + over],
        [xm, y + h, z0 - over],
        [x0 - over, y, z0 - over],
        col,
      );
      this.quad(
        [x1 + over, y, z0 - over],
        [xm, y + h, z0 - over],
        [xm, y + h, z1 + over],
        [x1 + over, y, z1 + over],
        col,
      );
      this.tri([x0, y, z0], [xm, y + h, z0], [x1, y, z0], 0, 0, -1, gableCol);
      this.tri([x1, y, z1], [xm, y + h, z1], [x0, y, z1], 0, 0, 1, gableCol);
    }
  }

  /** Hip roof (four slopes) over a rectangle. */
  hip(x0: number, x1: number, z0: number, z1: number, y: number, h: number, col: Color, over = 0.4): void {
    const X0 = x0 - over;
    const X1 = x1 + over;
    const Z0 = z0 - over;
    const Z1 = z1 + over;
    const inset = Math.min(X1 - X0, Z1 - Z0) / 2;
    const alongX = X1 - X0 >= Z1 - Z0;
    const r0 = alongX ? [X0 + inset, y + h, (Z0 + Z1) / 2] : [(X0 + X1) / 2, y + h, Z0 + inset];
    const r1 = alongX ? [X1 - inset, y + h, (Z0 + Z1) / 2] : [(X0 + X1) / 2, y + h, Z1 - inset];
    if (alongX) {
      this.quad([X0, y, Z0], r0, r1, [X1, y, Z0], col);
      this.quad([X1, y, Z1], r1, r0, [X0, y, Z1], col);
      this.tri([X0, y, Z1], r0, [X0, y, Z0], -1, 1, 0, col);
      this.tri([X1, y, Z0], r1, [X1, y, Z1], 1, 1, 0, col);
    } else {
      this.quad([X0, y, Z1], r1, r0, [X0, y, Z0], col);
      this.quad([X1, y, Z0], r0, r1, [X1, y, Z1], col);
      this.tri([X0, y, Z0], r0, [X1, y, Z0], 0, 1, -1, col);
      this.tri([X1, y, Z1], r1, [X0, y, Z1], 0, 1, 1, col);
    }
  }

  /** Flat roof with a low parapet around the edge. */
  /** Mansard roof (M28): steep slopes rising `h` to a flat top inset by `inset`. */
  mansard(
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    y: number,
    h: number,
    inset: number,
    col: Color,
    top?: Color,
  ): void {
    const a = [x0 + inset, y + h, z0 + inset];
    const b = [x1 - inset, y + h, z0 + inset];
    const c = [x1 - inset, y + h, z1 - inset];
    const d = [x0 + inset, y + h, z1 - inset];
    this.quad([x0, y, z0], a, b, [x1, y, z0], col);
    this.quad([x1, y, z0], b, c, [x1, y, z1], col);
    this.quad([x1, y, z1], c, d, [x0, y, z1], col);
    this.quad([x0, y, z1], d, a, [x0, y, z0], col);
    this.quad(a, d, c, b, top ?? col);
  }

  /** A cornice (M28): a band standing proud of the walls all round at height y. */
  cornice(x0: number, x1: number, z0: number, z1: number, y: number, col: Color, h = 0.45, out = 0.35): void {
    this.box(x0 - out, x1 + out, y - h, y, z0 - out, z1 + out, col);
  }

  parapet(x0: number, x1: number, z0: number, z1: number, y: number, col: Color, h = 0.6, t = 0.35): void {
    this.box(x0, x1, y, y + h, z0, z0 + t, col);
    this.box(x0, x1, y, y + h, z1 - t, z1, col);
    this.box(x0, x0 + t, y, y + h, z0 + t, z1 - t, col);
    this.box(x1 - t, x1, y, y + h, z0 + t, z1 - t, col);
  }

  /**
   * Window grid on one face of a box. face: 'front' (−z), 'back' (+z), 'left' (−x), 'right' (+x).
   * `lit(i)` returns the night emissive weight for window i.
   */
  /** One pane on a wall's face, from a0 to a1 along it (from its middle), yb up `wh`. */
  private pane(
    face: 'front' | 'back' | 'left' | 'right',
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    a0: number,
    a1: number,
    yb: number,
    wh: number,
    out: number,
    col: Color,
    e: number,
  ): void {
    if (face === 'front') {
      const xm = (x0 + x1) / 2;
      this.quad(
        [xm + a0, yb, z0 - out],
        [xm + a0, yb + wh, z0 - out],
        [xm + a1, yb + wh, z0 - out],
        [xm + a1, yb, z0 - out],
        col,
        e,
      );
    } else if (face === 'back') {
      const xm = (x0 + x1) / 2;
      this.quad(
        [xm - a0, yb, z1 + out],
        [xm - a0, yb + wh, z1 + out],
        [xm - a1, yb + wh, z1 + out],
        [xm - a1, yb, z1 + out],
        col,
        e,
      );
    } else if (face === 'left') {
      const zm = (z0 + z1) / 2;
      this.quad(
        [x0 - out, yb, zm - a0],
        [x0 - out, yb + wh, zm - a0],
        [x0 - out, yb + wh, zm - a1],
        [x0 - out, yb, zm - a1],
        col,
        e,
      );
    } else {
      const zm = (z0 + z1) / 2;
      this.quad(
        [x1 + out, yb, zm + a0],
        [x1 + out, yb + wh, zm + a0],
        [x1 + out, yb + wh, zm + a1],
        [x1 + out, yb, zm + a1],
        col,
        e,
      );
    }
  }

  windows(
    face: 'front' | 'back' | 'left' | 'right',
    x0: number,
    x1: number,
    z0: number,
    z1: number,
    y0: number,
    floors: number,
    floorH: number,
    opts: {
      width?: number;
      height?: number;
      spacing?: number;
      col: Color;
      lit: (i: number) => number;
      skipGround?: boolean;
      band?: boolean;
    },
  ): void {
    const out = 0.04;
    // Panes on the wall's face: its shadow is the wall's.
    const casting = this.casting;
    this.casting = false;
    const along = face === 'front' || face === 'back' ? x1 - x0 : z1 - z0;
    const spacing = opts.spacing ?? 3;
    const count = Math.max(1, Math.floor(along / spacing));
    const ww = opts.band ? along / count - 0.5 : (opts.width ?? 1.2);
    const wh = opts.height ?? floorH * 0.5;
    let k = 0;
    const level = this.level;
    for (let f = opts.skipGround ? 1 : 0; f < floors; f++) {
      const yb = y0 + f * floorH + (floorH - wh) * 0.55;
      // Each window's light, drawn once.
      const lit: number[] = [];
      for (let i = 0; i < count; i++) lit.push(opts.lit(k++));
      if (opts.band && count > 1) {
        // A band of windows is one strip along the floor from far off (M28): its gaps are less
        // than a pixel there. Lit as its windows are on average.
        this.level = level & SKY_ONLY;
        const half = along / 2 - (along / count - ww) / 2;
        this.pane(
          face,
          x0,
          x1,
          z0,
          z1,
          -half,
          half,
          yb,
          wh,
          out,
          opts.col,
          lit.reduce((a, b) => a + b, 0) / count,
        );
        this.level = level & IN_FAR;
      }
      for (let i = 0; i < count; i++) {
        const cpos = -along / 2 + (i + 0.5) * (along / count);
        this.pane(face, x0, x1, z0, z1, cpos - ww / 2, cpos + ww / 2, yb, wh, out, opts.col, lit[i]!);
      }
      this.level = level;
    }
    this.casting = casting;
  }

  /** Flat quad on the ground (lot surfaces), slightly raised. */
  ground(x0: number, x1: number, z0: number, z1: number, y: number, col: Color): void {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], col);
  }

  /**
   * The model, with its far and skyline versions (M28: every generated building has them, so it
   * fades through the levels as a hand-made one does): the triangles kept down to each.
   */
  build(): ModelData {
    const near = this.keep(L_NEAR);
    near.far = this.keep(L_FAR);
    near.sky = this.keep(L_SKY);
    return near;
  }

  /** The triangles drawn at `level` (one of the mask's bits). */
  private keep(level: number): ModelData {
    const tris = this.l.filter((l) => l & level).length;
    const pos = new Float32Array(tris * 9);
    const nrm = new Float32Array(tris * 9);
    const col = new Float32Array(tris * 9);
    const emi = new Float32Array(tris * 3);
    const shade = new Uint8Array(tris);
    let k = 0;
    for (let t = 0; t < this.l.length; t++) {
      if (!(this.l[t]! & level)) continue;
      for (let j = 0; j < 9; j++) {
        pos[k * 9 + j] = this.p[t * 9 + j]!;
        nrm[k * 9 + j] = this.n[t * 9 + j]!;
        col[k * 9 + j] = this.c[t * 9 + j]!;
      }
      for (let j = 0; j < 3; j++) emi[k * 3 + j] = this.e[t * 3 + j]!;
      shade[k] = this.s[t]!;
      k++;
    }
    return { pos, nrm, col, emi, height: this.height, shade };
  }
}

/** Deterministic small PRNG for model variation (mulberry32). */
export function modelRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, list: readonly T[]): T {
  return list[Math.floor(r() * list.length)]!;
}

export function shade(c: Color, f: number): Color {
  return tmp.copy(c).multiplyScalar(f).clone();
}
