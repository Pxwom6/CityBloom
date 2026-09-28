import { BufferAttribute, BufferGeometry, type Color } from 'three';

/** Growable non-indexed triangle buffer (position, normal, colour) with flat per-triangle normals. */
export class GeoBuffer {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  n = 0; // vertices

  constructor(capacity = 1024) {
    this.pos = new Float32Array(capacity * 3);
    this.nrm = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
  }

  private ensure(extra: number): void {
    const need = (this.n + extra) * 3;
    if (need <= this.pos.length) return;
    const cap = Math.max(need, this.pos.length * 2);
    const grow = (a: Float32Array) => {
      const b = new Float32Array(cap);
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos);
    this.nrm = grow(this.nrm);
    this.col = grow(this.col);
  }

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
    c: Color,
  ): void {
    this.ensure(3);
    // Normal = (b − a) × (c − a); flip to face up so winding never matters for draped surfaces.
    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;
    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const p = this.pos;
    const o = this.n * 3;
    p[o] = ax;
    p[o + 1] = ay;
    p[o + 2] = az;
    p[o + 3] = bx;
    p[o + 4] = by;
    p[o + 5] = bz;
    p[o + 6] = cx;
    p[o + 7] = cy;
    p[o + 8] = cz;
    for (let k = 0; k < 3; k++) {
      this.nrm[o + k * 3] = nx;
      this.nrm[o + k * 3 + 1] = ny;
      this.nrm[o + k * 3 + 2] = nz;
      this.col[o + k * 3] = c.r;
      this.col[o + k * 3 + 1] = c.g;
      this.col[o + k * 3 + 2] = c.b;
    }
    this.n += 3;
  }

  /** Quad a-b-c-d (in order around the edge); for horizontal-ish surfaces the normal is forced upward. */
  quad(a: number[], b: number[], c: number[], d: number[], col: Color, up = true): void {
    const start = this.n;
    this.tri(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!, col);
    this.tri(a[0]!, a[1]!, a[2]!, c[0]!, c[1]!, c[2]!, d[0]!, d[1]!, d[2]!, col);
    if (up) this.faceUp(start);
  }

  /** Make triangles from `start` face upward (flip normals whose y is negative). */
  faceUp(start: number): void {
    for (let v = start; v < this.n; v += 3) {
      if (this.nrm[v * 3 + 1]! < 0) {
        for (let k = 0; k < 3; k++) {
          this.nrm[(v + k) * 3] = -this.nrm[(v + k) * 3]!;
          this.nrm[(v + k) * 3 + 1] = -this.nrm[(v + k) * 3 + 1]!;
          this.nrm[(v + k) * 3 + 2] = -this.nrm[(v + k) * 3 + 2]!;
        }
        // Swap two vertices so front faces point up too.
        for (let k = 0; k < 3; k++) {
          const i1 = (v + 1) * 3 + k;
          const i2 = (v + 2) * 3 + k;
          const t = this.pos[i1]!;
          this.pos[i1] = this.pos[i2]!;
          this.pos[i2] = t;
        }
      }
    }
  }

  trimmed(): { pos: Float32Array; nrm: Float32Array; col: Float32Array } {
    return {
      pos: this.pos.slice(0, this.n * 3),
      nrm: this.nrm.slice(0, this.n * 3),
      col: this.col.slice(0, this.n * 3),
    };
  }
}

export interface GeoChunk {
  pos: Float32Array;
  nrm: Float32Array;
  col: Float32Array;
  /** Per-vertex id of the road or junction it belongs to (M22: snow per road); −1 when absent. */
  tag?: Float32Array;
}

export function mergeChunks(parts: GeoChunk[]): BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.pos.length;
  const pos = new Float32Array(n);
  const nrm = new Float32Array(n);
  const col = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    pos.set(p.pos, o);
    nrm.set(p.nrm, o);
    col.set(p.col, o);
    o += p.pos.length;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  if (parts.some((p) => p.tag)) {
    const tag = new Float32Array(n / 3).fill(-1);
    let v = 0;
    for (const p of parts) {
      if (p.tag) tag.set(p.tag, v);
      v += p.pos.length / 3;
    }
    g.setAttribute('aTag', new BufferAttribute(tag, 1));
  }
  g.computeBoundingSphere();
  return g;
}
