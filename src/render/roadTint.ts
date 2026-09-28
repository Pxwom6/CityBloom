import { Color, Group, Mesh, MeshBasicMaterial } from 'three';
import { rampColor } from '../client/overlay';
import type { Curve, Vec2 } from '../sim/geom';
import { GeoBuffer, mergeChunks } from './geoBuffer';

export interface RoadTintPiece {
  curve: Curve;
  /** Values 0..1 at evenly spaced points from the curve's start to its end. */
  v: number[];
  half: number;
  /** The road surface's height at arc length s (a flyover's deck); the ground if absent. */
  surface?: (s: number, x: number, z: number) => number;
  /** One-way roads and ramps (M19): chevrons pointing the way traffic runs (1 is start → end). */
  dir?: 1 | -1;
}

/** A junction's load on the traffic map (M19): a disc shaded like the roads. */
export interface JunctionTint {
  x: number;
  z: number;
  r: number;
  v: number;
}

const CHEVRON = new Color('#ffffff');

/**
 * Translucent ribbons laid over roads, shaded by a value that varies along each road: the
 * coverage preview when placing a service building, and the service coverage data maps.
 */
export class RoadTint {
  readonly group = new Group();
  private mesh: Mesh | null = null;
  private mat: MeshBasicMaterial;
  private get defaultRamp(): 'sequential' | 'diverging' | 'traffic' {
    return this.ramp;
  }
  /** Roads currently tinted (for tests and stats). */
  pieces = 0;

  constructor(
    private heightAt: (x: number, z: number) => number,
    private ramp: 'sequential' | 'diverging' | 'traffic',
    opacity: number,
    private skipBelow = -1,
  ) {
    this.mat = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
    });
  }

  show(list: RoadTintPiece[] | null, ramp = this.defaultRamp, junctions: JunctionTint[] = []): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh = null;
    }
    this.pieces = list?.length ?? 0;
    if (!list?.length) return;
    const buf = new GeoBuffer(4096);
    const col = new Color();
    for (const { curve, v, half, surface, dir } of list) {
      const y = (s: number, x: number, z: number) =>
        (surface ? surface(s, x, z) : Math.max(0, this.heightAt(x, z))) + 0.45;
      const n = Math.max(1, Math.ceil(curve.length / 4));
      for (let i = 0; i < n; i++) {
        const s0 = (curve.length * i) / n;
        const s1 = (curve.length * (i + 1)) / n;
        const f = ((s0 + s1) / 2 / curve.length) * (v.length - 1);
        const k = Math.min(v.length - 2, Math.floor(f));
        const val = v[k]! + (v[k + 1]! - v[k]!) * (f - k);
        if (val <= this.skipBelow) continue;
        if (ramp === 'sequential') rampColor('sequential', 0.25 + val * 0.75, col);
        else rampColor(ramp, val, col);
        const a = curve.pointAt(s0);
        const b = curve.pointAt(s1);
        const ta = curve.tangentAt(s0);
        const tb = curve.tangentAt(s1);
        const pt = (p: Vec2, t: Vec2, o: number, s: number) => {
          const x = p.x + t.z * o;
          const z = p.z - t.x * o;
          return [x, y(s, x, z), z];
        };
        buf.quad(pt(a, ta, -half, s0), pt(a, ta, half, s0), pt(b, tb, half, s1), pt(b, tb, -half, s1), col);
      }
      if (dir) {
        // Chevrons every 24 m pointing along the traffic.
        const w = Math.min(half * 0.8, 5);
        for (let s = 12; s < curve.length - 6; s += 24) {
          const p = curve.pointAt(s);
          const t0 = curve.tangentAt(s);
          const t = { x: t0.x * dir, z: t0.z * dir };
          const at = (u: number, o: number) => {
            const x = p.x + t.x * u - t.z * o;
            const z = p.z + t.z * u + t.x * o;
            return [x, y(s, x, z) + 0.05, z];
          };
          for (const side of [-1, 1]) {
            buf.quad(at(-2, side * w), at(-2 + 1.2, side * w), at(2 + 1.2, 0), at(2, 0), CHEVRON);
          }
        }
      }
    }
    for (const j of junctions) {
      rampColor(ramp === 'sequential' ? 'sequential' : ramp, j.v, col);
      const m = 20;
      for (let k = 0; k < m; k++) {
        const a0 = (Math.PI * 2 * k) / m;
        const a1 = (Math.PI * 2 * (k + 1)) / m;
        const x0 = j.x + Math.cos(a0) * j.r;
        const z0 = j.z + Math.sin(a0) * j.r;
        const x1 = j.x + Math.cos(a1) * j.r;
        const z1 = j.z + Math.sin(a1) * j.r;
        const lift = 0.55;
        const start = buf.n;
        buf.tri(
          j.x,
          Math.max(0, this.heightAt(j.x, j.z)) + lift,
          j.z,
          x0,
          Math.max(0, this.heightAt(x0, z0)) + lift,
          z0,
          x1,
          Math.max(0, this.heightAt(x1, z1)) + lift,
          z1,
          col,
        );
        buf.faceUp(start);
      }
    }
    if (!buf.n) return;
    this.mesh = new Mesh(mergeChunks([buf.trimmed()]), this.mat);
    this.mesh.renderOrder = 11;
    this.group.add(this.mesh);
  }
}
