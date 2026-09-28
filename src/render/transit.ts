import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { ClientWorld } from '../client/world';
import { ROAD_TYPES } from '../data/roads';
import { VEHICLE_SPEED_SCALE } from '../data/civic';
import type { Leg } from '../sim/systems/graph';
import { ModelBuilder, type ModelData } from './assets/builder';
import { VEHICLE_MODELS } from './vehicles';

const SHELTER = new Color('#e9e6de');
const ROOF = new Color('#2f5d9e');
const POLE = new Color('#6b7178');
const SIGN = new Color('#f2b31b');

function shelterModel(): ModelData {
  const m = new ModelBuilder();
  // Local: x along the road, z away from it (the shelter stands on the verge).
  m.box(-1.6, 1.6, 0, 0.12, -0.2, 1.6, new Color('#bdb8ae'));
  m.box(-1.5, 1.5, 0.12, 2.3, 1.35, 1.45, SHELTER);
  m.box(-1.5, -1.4, 0.12, 2.3, 0.1, 1.45, SHELTER);
  m.box(1.4, 1.5, 0.12, 2.3, 0.1, 1.45, SHELTER);
  m.box(-1.7, 1.7, 2.3, 2.45, -0.1, 1.6, ROOF);
  m.box(-0.9, 0.9, 0.45, 0.6, 0.9, 1.25, new Color('#8a6a4a'));
  // Stop sign on a pole at the kerb.
  m.box(-2.3, -2.2, 0, 2.8, -0.15, -0.05, POLE);
  m.box(-2.55, -1.95, 2.3, 2.9, -0.16, -0.04, SIGN);
  return m.build();
}

/** A tram stop (M20): a long raised platform at the kerb, a green glass shelter and a "T" sign. */
function tramStopModel(): ModelData {
  const m = new ModelBuilder();
  const green = new Color('#2f6b52');
  m.box(-7, 7, 0, 0.3, -0.3, 1.8, new Color('#c9c3b6'));
  m.box(-7, 7, 0.3, 0.32, -0.3, -0.05, new Color('#f1cf63'));
  m.box(-2, 2, 0.3, 2.5, 1.45, 1.55, new Color('#9fc3b4'));
  for (const x of [-2, 2]) m.box(x - 0.08, x + 0.08, 0.3, 2.5, 0.2, 1.55, green);
  m.box(-2.2, 2.2, 2.5, 2.65, 0.1, 1.75, green);
  m.box(-1, 1, 0.75, 0.9, 1.05, 1.35, new Color('#8a6a4a'));
  m.box(5.2, 5.3, 0.3, 3.2, 0.3, 0.4, POLE);
  m.box(4.95, 5.55, 2.6, 3.2, 0.26, 0.44, green);
  m.box(5.2, 5.3, 2.7, 3.1, 0.24, 0.46, SHELTER);
  m.box(5.0, 5.5, 3.0, 3.1, 0.24, 0.46, SHELTER);
  return m.build();
}

function toGeometry(m: ModelData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new BufferAttribute(m.nrm, 3));
  g.setAttribute('color', new BufferAttribute(m.col, 3));
  return g;
}

interface LineRun {
  legs: Leg[];
  cum: number[];
  length: number;
  buses: number;
}

/**
 * Bus stops (shelters beside the road) and the buses running each depot's loop. Buses are spaced
 * evenly round the loop and driven by the display clock, so they keep going at every speed.
 */
export class TransitRenderer {
  readonly group = new Group();
  private stops: InstancedMesh;
  private tramStops: InstancedMesh;
  private buses: InstancedMesh;
  private version = -1;
  private runs: LineRun[] = [];
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  /** Latest bus positions (tests and stats), and each bus's place this frame (the follow camera). */
  busCount = 0;
  readonly busPoses: { x: number; y: number; z: number }[] = [];
  /** Where each stop's shelter stands (for picking, M20). */
  shelters: { id: number; x: number; z: number }[] = [];

  constructor(
    private world: ClientWorld,
    private heightOn: (seg: number, s: number, x: number, z: number) => number,
  ) {
    const mat = new MeshLambertMaterial({ vertexColors: true });
    this.stops = new InstancedMesh(toGeometry(shelterModel()), mat, 1024);
    this.stops.count = 0;
    this.stops.castShadow = true;
    this.stops.name = 'bus-stops';
    this.tramStops = new InstancedMesh(toGeometry(tramStopModel()), mat, 512);
    this.tramStops.count = 0;
    this.tramStops.castShadow = true;
    this.tramStops.name = 'tram-stops';
    this.buses = new InstancedMesh(toGeometry(VEHICLE_MODELS.bus!), mat, 256);
    this.buses.instanceMatrix.setUsage(DynamicDrawUsage);
    this.buses.count = 0;
    this.buses.castShadow = true;
    this.buses.frustumCulled = false;
    this.buses.name = 'buses';
    this.group.add(this.stops, this.tramStops, this.buses);
  }

  private rebuild(): void {
    const w = this.world;
    let i = 0;
    let j = 0;
    this.shelters = [];
    for (const st of [...w.stops.values()].sort((a, b) => a.id - b.id)) {
      const seg = w.netState.segments.get(st.seg);
      if (!seg || i >= 1024 || j >= 512) continue;
      const curve = w.net.curve(st.seg);
      const t = curve.tangentAt(st.s);
      // Stand on the right-hand verge (driving on the right).
      const off = ROAD_TYPES[seg.type].width / 2 + 0.4;
      const x = st.x - t.z * off;
      const z = st.z + t.x * off;
      // The shelter's middle, a metre or so back from the kerb (tram platforms are longer).
      this.shelters.push({ id: st.id, x: x - t.z * 0.8, z: z + t.x * 0.8 });
      this.p.set(x, w.roadHeight(st.seg, st.s, st.x, st.z) + 0.15, z);
      this.q.setFromAxisAngle(this.up, -Math.atan2(t.z, t.x));
      this.m.compose(this.p, this.q, this.s);
      if (st.tram) this.tramStops.setMatrixAt(j++, this.m);
      else this.stops.setMatrixAt(i++, this.m);
    }
    this.stops.count = i;
    this.stops.instanceMatrix.needsUpdate = true;
    this.tramStops.count = j;
    this.tramStops.instanceMatrix.needsUpdate = true;
    // Buses only here; trains have their own renderer (M20).
    this.runs = w.lines
      .filter((l) => l.mode === 'bus' && l.legs.every((x) => w.netState.segments.has(x.seg)))
      .map((l) => {
        const cum = [0];
        for (const x of l.legs) cum.push(cum[cum.length - 1]! + Math.abs(x.s1 - x.s0));
        return { legs: l.legs, cum, length: cum[cum.length - 1]!, buses: l.buses };
      });
  }

  update(displayTick: number): void {
    if (this.version !== this.world.transitVersion) {
      this.version = this.world.transitVersion;
      this.rebuild();
    }
    let n = 0;
    const net = this.world.net;
    for (const run of this.runs) {
      if (run.length <= 0) continue;
      const v = (40 / 3.6) * VEHICLE_SPEED_SCALE * 0.8; // metres per tick at a street's pace
      for (let k = 0; k < run.buses && n < 256; k++) {
        const d = (((displayTick * v + (k * run.length) / run.buses) % run.length) + run.length) % run.length;
        let li = 0;
        while (li < run.legs.length - 1 && run.cum[li + 1]! < d) li++;
        const l = run.legs[li]!;
        const t = d - run.cum[li]!;
        const curve = net.curve(l.seg);
        const dir = l.s1 >= l.s0 ? 1 : -1;
        const sArc = Math.max(0, Math.min(curve.length, l.s0 + dir * t));
        const pt = curve.pointAt(sArc);
        const tan = curve.tangentAt(sArc);
        const hx = tan.x * dir;
        const hz = tan.z * dir;
        const x = pt.x - hz * 2.4;
        const z = pt.z + hx * 2.4;
        this.p.set(x, this.heightOn(l.seg, sArc, x, z) + 0.25, z);
        const pose = this.busPoses[n] ?? (this.busPoses[n] = { x: 0, y: 0, z: 0 });
        pose.x = this.p.x;
        pose.y = this.p.y;
        pose.z = this.p.z;
        this.q.setFromAxisAngle(this.up, -Math.atan2(hz, hx));
        this.m.compose(this.p, this.q, this.s);
        this.buses.setMatrixAt(n++, this.m);
      }
    }
    this.buses.count = n;
    this.buses.instanceMatrix.needsUpdate = true;
    this.busCount = n;
    this.busPoses.length = n;
  }

  /** The stop whose shelter or platform is at (x, z), if any. */
  stopAt(x: number, z: number): number | null {
    let best: number | null = null;
    let bd = 4.5;
    for (const s of this.shelters) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) {
        bd = d;
        best = s.id;
      }
    }
    return best;
  }

  /** Meshes for picking tests. */
  get meshes(): Mesh[] {
    return [this.stops, this.tramStops, this.buses];
  }
}
