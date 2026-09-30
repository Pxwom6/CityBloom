import { BufferAttribute, BufferGeometry } from 'three';
import type { ModelData } from './assets/builder';

/**
 * Merging models into one mesh: growing vertex arrays, and a model appended in world space
 * (position and yaw), darkened if abandoned or burnt, its windows lit for this copy.
 */

export class Arrays {
  pos = new Float32Array(3 * 4096);
  nrm = new Float32Array(3 * 4096);
  col = new Float32Array(3 * 4096);
  emi = new Float32Array(4096);
  clip: Float32Array | null;
  n = 0;

  constructor(withClip: boolean) {
    this.clip = withClip ? new Float32Array(4096) : null;
  }

  reserve(extra: number): void {
    const need = this.n + extra;
    if (need <= this.emi.length) return;
    const cap = Math.max(need, this.emi.length * 2);
    const grow = (a: Float32Array, k: number) => {
      const b = new Float32Array(cap * k);
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos, 3);
    this.nrm = grow(this.nrm, 3);
    this.col = grow(this.col, 3);
    this.emi = grow(this.emi, 1);
    if (this.clip) this.clip = grow(this.clip, 1);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    g.setAttribute('normal', new BufferAttribute(this.nrm.slice(0, this.n * 3), 3));
    g.setAttribute('color', new BufferAttribute(this.col.slice(0, this.n * 3), 3));
    g.setAttribute('emissive', new BufferAttribute(this.emi.slice(0, this.n), 1));
    if (this.clip) g.setAttribute('clipY', new BufferAttribute(this.clip.slice(0, this.n), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** A number in 0..1 from two integers (which window of which building). */
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

let litScratch = new Float32Array(256);

/**
 * The night glow of each window of one copy of a hand-made model: every copy lights its own
 * mix (phase 3), the same one each time it is drawn.
 */
function litWindows(chance: Float32Array, seed: number): Float32Array {
  if (litScratch.length < chance.length) litScratch = new Float32Array(chance.length * 2);
  for (let u = 0; u < chance.length; u++)
    litScratch[u] = hash01(seed, u) < chance[u]! ? 0.6 + 0.4 * hash01(seed ^ 0x5bd1e995, u) : 0;
  return litScratch;
}

/**
 * Transform a model into world space (position, yaw) and append it; optionally darken as abandoned.
 * `seed` tells one copy of a model from the next (its lit windows).
 */
export function appendModel(
  out: Arrays,
  m: ModelData,
  x: number,
  y: number,
  z: number,
  yaw: number,
  abandoned: boolean | number = false,
  clipTo?: number,
  seed = 0,
): void {
  // true = abandoned (greyed, dark windows); a number = charred by fire to that degree (0..1).
  const char = typeof abandoned === 'number' ? abandoned : 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const n = m.pos.length / 3;
  out.reserve(n);
  const win = m.win;
  const lit = win && m.winChance ? litWindows(m.winChance, seed) : null;
  const dark = abandoned === true || char > 0.3;
  for (let i = 0; i < n; i++) {
    const lx = m.pos[i * 3]!;
    const ly = m.pos[i * 3 + 1]!;
    const lz = m.pos[i * 3 + 2]!;
    const nx = m.nrm[i * 3]!;
    const nz = m.nrm[i * 3 + 2]!;
    const o = out.n * 3;
    out.pos[o] = x + lx * c + lz * s;
    out.pos[o + 1] = y + ly;
    out.pos[o + 2] = z - lx * s + lz * c;
    out.nrm[o] = nx * c + nz * s;
    out.nrm[o + 1] = m.nrm[i * 3 + 1]!;
    out.nrm[o + 2] = -nx * s + nz * c;
    let r = m.col[i * 3]!;
    let g = m.col[i * 3 + 1]!;
    let bl = m.col[i * 3 + 2]!;
    if (char > 0) {
      const k = 1 - 0.75 * char;
      r *= k;
      g *= k * 0.92;
      bl *= k * 0.85;
    } else if (abandoned) {
      const grey = (r + g + bl) / 3;
      r = (r * 0.35 + grey * 0.65) * 0.62;
      g = (g * 0.35 + grey * 0.65) * 0.6;
      bl = (bl * 0.35 + grey * 0.65) * 0.58;
    }
    out.col[o] = r;
    out.col[o + 1] = g;
    out.col[o + 2] = bl;
    // Season tags (negative) stay; windows go dark in an abandoned or burnt building.
    const e = lit && win![i] ? lit[win![i]! - 1]! : m.emi[i]!;
    out.emi[out.n] = e > 0 && dark ? 0 : e;
    if (out.clip) out.clip[out.n] = clipTo ?? 1e6;
    out.n++;
  }
}
