import {
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  BufferAttribute,
  BufferGeometry,
} from 'three';
import type { ClientWorld } from '../client/world';
import type { VehicleData } from '../sim/protocol';
import { ModelBuilder, type ModelData } from './assets/builder';

const C = (h: string) => new Color(h);
const MAX = 512;

function truckModel(body: Color, cab: Color, stripe?: Color, long = 7.2): ModelData {
  const m = new ModelBuilder();
  // Local: x forward, z to the right, y up.
  m.box(-long / 2, long / 2 - 2.2, 0.6, 3.1, -1.15, 1.15, body);
  m.box(long / 2 - 2.2, long / 2, 0.6, 2.7, -1.1, 1.1, cab);
  m.box(long / 2 - 0.05, long / 2 + 0.02, 1.6, 2.4, -0.9, 0.9, C('#2d3b48'));
  if (stripe) m.box(-long / 2, long / 2 - 2.2, 1.6, 1.9, -1.17, 1.17, stripe);
  for (const x of [-long / 2 + 1.2, long / 2 - 1.2]) {
    m.box(x - 0.45, x + 0.45, 0, 0.9, -1.2, -0.95, C('#222'));
    m.box(x - 0.45, x + 0.45, 0, 0.9, 0.95, 1.2, C('#222'));
  }
  return m.build();
}

function carModel(body: Color, lightbar?: Color): ModelData {
  const m = new ModelBuilder();
  m.box(-2.2, 2.2, 0.35, 1.1, -0.9, 0.9, body);
  m.box(-1.1, 1.0, 1.1, 1.7, -0.8, 0.8, body);
  m.box(-1.05, 0.95, 1.15, 1.6, -0.82, 0.82, C('#34495e'));
  if (lightbar) m.box(-0.3, 0.3, 1.7, 1.9, -0.6, 0.6, lightbar);
  return m.build();
}

/** Snow plough (M22): an orange truck with a salt spreader, a wide angled blade and a beacon. */
function ploughModel(): ModelData {
  const m = new ModelBuilder();
  const orange = C('#e8792a');
  m.box(-3.4, 0.9, 0.6, 2.6, -1.15, 1.15, orange);
  m.box(-3.5, 0.95, 2.6, 2.8, -1.2, 1.2, C('#4a4f55'));
  m.box(0.9, 3.0, 0.6, 2.8, -1.1, 1.1, orange);
  m.box(2.95, 3.02, 1.7, 2.5, -0.9, 0.9, C('#2d3b48'));
  m.box(1.5, 2.1, 2.8, 3.05, -0.35, 0.35, C('#ffb21e'));
  // The blade, wider than the truck and set forward.
  m.box(3.3, 3.8, 0.1, 1.2, -1.75, 1.75, C('#f2c230'));
  m.box(3.0, 3.3, 0.5, 0.8, -0.4, 0.4, C('#555b61'));
  for (const x of [-2.3, 2.0]) {
    m.box(x - 0.45, x + 0.45, 0, 0.9, -1.2, -0.95, C('#222'));
    m.box(x - 0.45, x + 0.45, 0, 0.9, 0.95, 1.2, C('#222'));
  }
  return m.build();
}

export const VEHICLE_MODELS: Record<string, ModelData> = {
  plough: ploughModel(),
  garbage: truckModel(C('#3f8f4f'), C('#e8e8e2'), C('#f0c040')),
  fire: truckModel(C('#d0342c'), C('#d0342c'), C('#f4f4f4'), 8),
  ambulance: truckModel(C('#f4f4f2'), C('#f4f4f2'), C('#d0342c'), 6),
  police: carModel(C('#f2f4f7'), C('#2a6fdb')),
  bus: truckModel(C('#f2b31b'), C('#f2b31b'), C('#2f3b48'), 11),
};

function toGeometry(m: ModelData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new BufferAttribute(m.nrm, 3));
  g.setAttribute('color', new BufferAttribute(m.col, 3));
  return g;
}

/** Dispatched service vehicles, moved along their legs every frame (extrapolated from the sim). */
export class VehicleRenderer {
  readonly group = new Group();
  private meshes = new Map<string, InstancedMesh>();
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  /** Latest positions (for picking and tests). */
  readonly positions = new Map<
    number,
    { x: number; y: number; z: number; kind: string; phase: VehicleData['phase']; heading: number }
  >();

  constructor(private world: ClientWorld) {
    const mat = new MeshLambertMaterial({ vertexColors: true });
    for (const [kind, model] of Object.entries(VEHICLE_MODELS)) {
      const mesh = new InstancedMesh(toGeometry(model), mat, MAX);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `vehicles-${kind}`;
      this.meshes.set(kind, mesh);
      this.group.add(mesh);
    }
  }

  /** Point and heading along a vehicle's route after driving `extra` more ticks. */
  locate(
    v: VehicleData,
    extra: number,
  ): { x: number; z: number; heading: number; seg: number; s: number } | null {
    const net = this.world.net;
    let leg = v.leg;
    let t = v.t;
    if (v.phase !== 'work') {
      let budget = extra * (v.legs[leg]?.v ?? 0);
      while (leg < v.legs.length && budget > 0) {
        const l = v.legs[leg]!;
        const left = Math.abs(l.s1 - l.s0) - t;
        if (budget < left) {
          t += budget;
          budget = 0;
        } else {
          budget -= left;
          if (leg === v.legs.length - 1) {
            t = Math.abs(l.s1 - l.s0);
            break;
          }
          leg++;
          t = 0;
          budget *= (v.legs[leg]?.v ?? 1) / (l.v || 1);
        }
      }
    }
    const l = v.legs[Math.min(leg, v.legs.length - 1)];
    if (!l || !this.world.netState.segments.has(l.seg)) return null;
    const curve = net.curve(l.seg);
    const dir = l.s1 >= l.s0 ? 1 : -1;
    const s = Math.max(0, Math.min(curve.length, l.s0 + dir * t));
    const pt = curve.pointAt(s);
    const tan = curve.tangentAt(s);
    const hx = tan.x * dir;
    const hz = tan.z * dir;
    // Drive on the right: offset to the right of the heading.
    const lane = 2.4;
    return { x: pt.x - hz * lane, z: pt.z + hx * lane, heading: Math.atan2(hz, hx), seg: l.seg, s };
  }

  update(displayTick: number): void {
    const counts = new Map<string, number>();
    const extra = Math.max(0, Math.min(40, displayTick - this.world.vehiclesTick));
    this.positions.clear();
    for (const v of this.world.vehicles) {
      const mesh = this.meshes.get(v.kind);
      if (!mesh) continue;
      const at = this.locate(v, extra);
      if (!at) continue;
      const i = counts.get(v.kind) ?? 0;
      if (i >= MAX) continue;
      this.p.set(at.x, this.world.roadHeight(at.seg, at.s, at.x, at.z) + 0.25, at.z);
      this.q.setFromAxisAngle(this.up, -at.heading);
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(i, this.m);
      counts.set(v.kind, i + 1);
      this.positions.set(v.id, {
        x: at.x,
        y: this.p.y,
        z: at.z,
        kind: v.kind,
        phase: v.phase,
        heading: at.heading,
      });
    }
    for (const [kind, mesh] of this.meshes) {
      mesh.count = counts.get(kind) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
