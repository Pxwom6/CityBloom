import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { BarrierArm } from './roadMesh';

/** Display ticks for an arm to swing all the way down (or up): 1.5 s at 1× speed. */
const SWING_TICKS = 12;
/** Upright, leaning a touch over the road; and flat across it. */
const RAISED = 0.08;
const LOWERED = Math.PI / 2;
const MAX_ARMS = 2048;

/** A unit arm along +Y, in red and white bands, with a box section. */
function armGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const red = new Color('#c8342c');
  const white = new Color('#f4f2ea');
  const w = 0.07;
  const bands = 6;
  for (let k = 0; k < bands; k++) {
    const y0 = k / bands;
    const y1 = (k + 1) / bands;
    const c = k % 2 ? white : red;
    // Four sides of the band.
    for (const [nx, nz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const ux = nz;
      const uz = -nx;
      const cx = nx * w;
      const cz = nz * w;
      const quad = [
        [cx - ux * w, y0, cz - uz * w],
        [cx + ux * w, y0, cz + uz * w],
        [cx + ux * w, y1, cz + uz * w],
        [cx - ux * w, y1, cz - uz * w],
      ];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        pos.push(...quad[i]!);
        nrm.push(nx, 0, nz);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3));
  return g;
}

/**
 * Level-crossing barriers (Phase 2 review): each road approach's arm stands raised and swings down
 * across the road while a train is near (the rail vehicles say which crossings are closed), then
 * back up once it has gone. Visible cars wait at the stop line meanwhile (render/traffic.ts).
 */
export class CrossingRenderer {
  readonly mesh: InstancedMesh;
  private arms: { node: number; arm: BarrierArm }[] = [];
  private angle = new Map<number, number>();
  private version = -1;
  private lastTick = -1;
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private axis = new Vector3();
  /** Crossings with their arms down (or on the way down), for tests. */
  readonly down = new Set<number>();

  constructor(private source: { crossings: Map<number, BarrierArm[]>; crossingVersion: number }) {
    this.mesh = new InstancedMesh(armGeometry(), new MeshLambertMaterial({ vertexColors: true }), MAX_ARMS);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'crossing-arms';
  }

  /** How far a crossing's arms are down, 0 (up) to 1 (across the road). */
  downShare(node: number): number {
    const a = this.angle.get(node) ?? RAISED;
    return (a - RAISED) / (LOWERED - RAISED);
  }

  /** Swing arms towards down at `closed` crossings and up elsewhere, by the display ticks gone by. */
  update(displayTick: number, closed: ReadonlySet<number>): void {
    if (this.version !== this.source.crossingVersion) {
      this.version = this.source.crossingVersion;
      this.arms = [];
      for (const [node, arms] of this.source.crossings) for (const arm of arms) this.arms.push({ node, arm });
      for (const node of [...this.angle.keys()])
        if (!this.source.crossings.has(node)) this.angle.delete(node);
    }
    const dt = this.lastTick < 0 ? 0 : Math.max(0, Math.min(SWING_TICKS, displayTick - this.lastTick));
    this.lastTick = displayTick;
    const step = ((LOWERED - RAISED) * dt) / SWING_TICKS;
    this.down.clear();
    for (const node of this.source.crossings.keys()) {
      const a = this.angle.get(node) ?? RAISED;
      const target = closed.has(node) ? LOWERED : RAISED;
      const next = a < target ? Math.min(target, a + step) : Math.max(target, a - step);
      this.angle.set(node, next);
      if (closed.has(node)) this.down.add(node);
    }
    let n = 0;
    for (const { node, arm } of this.arms) {
      if (n >= MAX_ARMS) break;
      const a = this.angle.get(node) ?? RAISED;
      // Rotate +Y towards the road (n) about the horizontal axis across it.
      this.axis.set(arm.nz, 0, -arm.nx).normalize();
      this.q.setFromAxisAngle(this.axis, a);
      this.p.set(arm.x, arm.y, arm.z);
      this.s.set(1, arm.len, 1);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n++, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
