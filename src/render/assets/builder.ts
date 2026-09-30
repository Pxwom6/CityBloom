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

export class ModelBuilder {
  private p: number[] = [];
  private n: number[] = [];
  private c: number[] = [];
  private e: number[] = [];
  height = 0;

  /** Triangle with an explicit normal. */
  tri(a: number[], b: number[], c: number[], nx: number, ny: number, nz: number, col: Color, emi = 0): void {
    if (emi === 0) emi = SEASONAL.get(col) ?? 0;
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
    const along = face === 'front' || face === 'back' ? x1 - x0 : z1 - z0;
    const spacing = opts.spacing ?? 3;
    const count = Math.max(1, Math.floor(along / spacing));
    const ww = opts.band ? along / count - 0.5 : (opts.width ?? 1.2);
    const wh = opts.height ?? floorH * 0.5;
    let k = 0;
    for (let f = opts.skipGround ? 1 : 0; f < floors; f++) {
      const yb = y0 + f * floorH + (floorH - wh) * 0.55;
      for (let i = 0; i < count; i++) {
        const cpos = -along / 2 + (i + 0.5) * (along / count);
        const e = opts.lit(k++);
        const a0 = cpos - ww / 2;
        const a1 = cpos + ww / 2;
        if (face === 'front') {
          const xm = (x0 + x1) / 2;
          this.quad(
            [xm + a0, yb, z0 - out],
            [xm + a0, yb + wh, z0 - out],
            [xm + a1, yb + wh, z0 - out],
            [xm + a1, yb, z0 - out],
            opts.col,
            e,
          );
        } else if (face === 'back') {
          const xm = (x0 + x1) / 2;
          this.quad(
            [xm - a0, yb, z1 + out],
            [xm - a0, yb + wh, z1 + out],
            [xm - a1, yb + wh, z1 + out],
            [xm - a1, yb, z1 + out],
            opts.col,
            e,
          );
        } else if (face === 'left') {
          const zm = (z0 + z1) / 2;
          this.quad(
            [x0 - out, yb, zm - a0],
            [x0 - out, yb + wh, zm - a0],
            [x0 - out, yb + wh, zm - a1],
            [x0 - out, yb, zm - a1],
            opts.col,
            e,
          );
        } else {
          const zm = (z0 + z1) / 2;
          this.quad(
            [x1 + out, yb, zm + a0],
            [x1 + out, yb + wh, zm + a0],
            [x1 + out, yb + wh, zm + a1],
            [x1 + out, yb, zm + a1],
            opts.col,
            e,
          );
        }
      }
    }
  }

  /** Flat quad on the ground (lot surfaces), slightly raised. */
  ground(x0: number, x1: number, z0: number, z1: number, y: number, col: Color): void {
    this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], col);
  }

  build(): ModelData {
    return {
      pos: new Float32Array(this.p),
      nrm: new Float32Array(this.n),
      col: new Float32Array(this.c),
      emi: new Float32Array(this.e),
      height: this.height,
    };
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
