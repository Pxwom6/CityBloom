import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { ClientWorld } from '../client/world';
import { CIVIC } from '../data/civic';
import { ModelBuilder, type ModelData } from './assets/builder';
import { plane } from './assets/specialModels';
import { buildingYaw } from './buildings';

/**
 * Planes and ships (M23). Each airport has planes landing along its runway and taking off from it,
 * more of them the more visitors fly in; each seaport has container ships sailing in from the open
 * water to its berth, lying alongside a while, and sailing out again. They follow the city's clock
 * (paused when it is) and are drawn as instanced meshes, a draw call each.
 */

const C = (h: string) => new Color(h);
const MAX = 12;

function planeModel(): ModelData {
  const m = new ModelBuilder();
  plane(m, 0, 0, 0, 30, C('#1f6fb2'));
  return m.build();
}

function shipModel(): ModelData {
  const m = new ModelBuilder();
  const L = 120;
  const B = 9;
  // Hull (dark below, red antifouling at the waterline), a bridge aft and containers on deck.
  m.box(-L / 2 + 6, L / 2 - 8, -4, 6, -B, B, C('#2b3440'), C('#8b8f94'));
  m.box(L / 2 - 8, L / 2, -2, 6, -B * 0.6, B * 0.6, C('#2b3440'));
  m.box(-L / 2, -L / 2 + 6, -2, 6, -B * 0.8, B * 0.8, C('#2b3440'));
  m.box(-L / 2 + 6, L / 2 - 8, -4.2, -1.5, -B - 0.05, B + 0.05, C('#a8392f'));
  m.box(-L / 2 + 4, -L / 2 + 18, 6, 20, -B + 1, B - 1, C('#f2f2ee'));
  m.box(-L / 2 + 4.5, -L / 2 + 17.5, 16.5, 18.5, -B + 0.9, B - 0.9, C('#34495e'));
  m.box(-L / 2 + 8, -L / 2 + 12, 20, 26, -1.2, 1.2, C('#d9a33a'));
  const cols = [C('#c9423a'), C('#1f6fb2'), C('#2f8f5a'), C('#e0913a'), C('#8a8f96'), C('#d9c23a')];
  let k = 0;
  for (let x = -L / 2 + 22; x < L / 2 - 16; x += 13)
    for (const z of [-B + 1, -2.6, 3.8 - 1])
      for (let t = 0; t < 2 + ((k * 7) % 3); t++)
        m.box(
          x,
          x + 12,
          6 + t * 2.6,
          8.5 + t * 2.6,
          z,
          z + 5,
          cols[((k++ * 2654435761) % 97) % cols.length]!,
        );
  return m.build();
}

function mesh(d: ModelData, name: string): InstancedMesh {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(d.pos, 3));
  g.setAttribute('normal', new BufferAttribute(d.nrm, 3));
  g.setAttribute('color', new BufferAttribute(d.col, 3));
  const m = new InstancedMesh(g, new MeshLambertMaterial({ vertexColors: true }), MAX);
  m.instanceMatrix.setUsage(DynamicDrawUsage);
  m.count = 0;
  m.castShadow = true;
  m.frustumCulled = false;
  m.name = name;
  return m;
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

export class PortRenderer {
  readonly group = new Group();
  private planes = mesh(planeModel(), 'planes');
  private ships = mesh(shipModel(), 'ships');
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  private tilt = new Quaternion();
  private side = new Vector3();
  /** Drawn last frame (tests and stats), with their positions. */
  counts = { planes: 0, ships: 0 };
  readonly shown: { kind: 'plane' | 'ship'; x: number; y: number; z: number }[] = [];

  constructor(private world: ClientWorld) {
    this.group.name = 'ports';
    this.group.add(this.planes, this.ships);
  }

  update(tick: number): void {
    const w = this.world;
    const flows = w.stats.region?.flows;
    const flights = Math.max(1, Math.round((flows?.visitors.air ?? 0) / 90));
    const loads = w.stats.region?.shipLoads ?? 0;
    let np = 0;
    let ns = 0;
    this.shown.length = 0;
    for (const c of w.civics.values()) {
      const def = CIVIC.get(c.def);
      if (!def || (c.stage !== undefined && c.stage >= 0 && def.project)) continue;
      const yaw = buildingYaw(c);
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);
      // Local (x along the road, z back from it) to world.
      const at = (lx: number, lz: number) => ({ x: c.x + lx * cos + lz * sin, z: c.z - lx * sin + lz * cos });
      if (def.airport) {
        const z = def.d / 2 - 19;
        const half = def.w / 2;
        // A plane lands every so often and another takes off in between; more flights, more planes.
        const concurrent = Math.min(3, Math.ceil(flights / 8));
        for (let k = 0; k < concurrent && np < MAX; k++) {
          const period = 40;
          const t = (((tick / period + k / concurrent) % 1) + 1) % 1;
          let lx: number;
          let y: number;
          let heading: number;
          let pitch = 0;
          if (t < 0.3) {
            // Final approach from far out along the runway line, down the glide slope.
            const u = t / 0.3;
            lx = half + 1400 * (1 - u) - 20;
            y = 3 + 140 * (1 - u) ** 1.2;
            heading = Math.PI;
            pitch = -0.05;
          } else if (t < 0.42) {
            const u = smooth((t - 0.3) / 0.12);
            lx = half - 20 - (half + 40) * u;
            y = 0.2;
            heading = Math.PI;
          } else if (t < 0.55) continue;
          else if (t < 0.66) {
            // The take-off roll, then up and away.
            const u = ((t - 0.55) / 0.11) ** 2;
            lx = -half + 20 + (half + 40) * u;
            y = 0.2;
            heading = 0;
          } else if (t < 0.9) {
            const u = (t - 0.66) / 0.24;
            lx = 60 + 1600 * u;
            y = 0.2 + 260 * u ** 1.1;
            heading = 0;
            pitch = 0.12 * clamp01(u * 5);
          } else continue;
          const pos = at(lx, z);
          this.p.set(pos.x, (c.y ?? 0) + y, pos.z);
          this.q.setFromAxisAngle(this.up, yaw + heading);
          this.side.set(0, 0, 1).applyQuaternion(this.q);
          this.tilt.setFromAxisAngle(this.side, pitch);
          this.q.premultiply(this.tilt);
          this.m.compose(this.p, this.q, this.s);
          this.planes.setMatrixAt(np++, this.m);
          this.shown.push({ kind: 'plane', x: pos.x, y: this.p.y, z: pos.z });
        }
      }
      if (def.seaport && loads > 0) {
        // The berth: the first deep water out from the back of the quay (as the sim finds it).
        let berth: { x: number; z: number } | null = null;
        for (let d = 20; d <= 70 && !berth; d += 10) {
          const p = at(0, def.d / 2 + d);
          if (w.heightAt(p.x, p.z) <= -6) berth = p;
        }
        if (!berth) continue;
        const out = { x: (berth.x - c.x) / Math.hypot(berth.x - c.x, berth.z - c.z), z: 0 };
        out.z = (berth.z - c.z) / Math.hypot(berth.x - c.x, berth.z - c.z);
        const ships = Math.min(2, Math.ceil(loads / 240));
        for (let k = 0; k < ships && ns < MAX; k++) {
          const t = (((tick / 180 + k / ships) % 1) + 1) % 1;
          // In from the open water, alongside the quay, and out again.
          let dist: number;
          let turn = 0;
          if (t < 0.35) {
            const u = smooth(t / 0.35);
            dist = 1300 * (1 - u) + 12;
            turn = clamp01((u - 0.8) / 0.2);
          } else if (t < 0.65) {
            dist = 12;
            turn = 1;
          } else {
            const u = smooth((t - 0.65) / 0.35);
            dist = 12 + 1300 * u;
            turn = 1 - clamp01(u / 0.2);
          }
          const x = berth.x + out.x * dist;
          const z = berth.z + out.z * dist;
          // Heading: bow towards the quay while sailing in (away when sailing out), alongside when docked.
          const inbound = Math.atan2(out.z, -out.x);
          const alongside = yaw;
          const h =
            t < 0.65
              ? inbound + (alongside - inbound) * turn
              : inbound + Math.PI + (alongside - inbound - Math.PI) * turn;
          this.p.set(x, 0, z);
          this.q.setFromAxisAngle(this.up, h);
          this.m.compose(this.p, this.q, this.s);
          this.ships.setMatrixAt(ns++, this.m);
          this.shown.push({ kind: 'ship', x, y: 0, z });
        }
      }
    }
    this.planes.count = np;
    this.ships.count = ns;
    this.planes.instanceMatrix.needsUpdate = true;
    this.ships.instanceMatrix.needsUpdate = true;
    this.counts = { planes: np, ships: ns };
  }
}
