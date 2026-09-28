import { Color, Group, InstancedMesh, Matrix4, MeshLambertMaterial, Quaternion, Vector3 } from 'three';
import type { ClientWorld } from '../client/world';
import { TRAFFIC, JUNCTION } from '../data/balance';
import { ROAD_TYPES } from '../data/roads';
import { VEHICLE_SPEED_SCALE } from '../data/civic';
import { hourOfDay } from '../sim/time';
import type { TripSample } from '../sim/systems/traffic';
import type { Leg } from '../sim/systems/graph';
import { ModelBuilder } from './assets/builder';
import { toGeometry } from './traffic';

/** Walkers only show when the camera is this close (m). */
export const PEDESTRIAN_DISTANCE = 420;
/** Trips short enough to walk (route length, m). */
const WALK_SHOP = 1200;
const WALK_WORK = 900;
const MAX = 240;
/** Walking pace in metres per tick (1.4 m/s on the same time scale as vehicles). */
const PACE = 1.4 * VEHICLE_SPEED_SCALE;

const SHIRTS = ['#c94c4c', '#3f6fb5', '#e8c547', '#4f9a6a', '#e07b39', '#8e5bb5', '#f2f2ef', '#2b2d31'].map(
  (h) => new Color(h),
);

export interface Walker {
  id: number;
  trip: TripSample;
  legs: Leg[];
  leg: number;
  t: number;
  /** +1 walks on the right-hand pavement, −1 the left. */
  side: 1 | -1;
  pace: number;
  x: number;
  y: number;
  z: number;
  heading: number;
}

function reversed(legs: Leg[]): Leg[] {
  return legs
    .slice()
    .reverse()
    .map((l) => ({ seg: l.seg, s0: l.s1, s1: l.s0 }));
}

function routeLength(legs: Leg[]): number {
  return legs.reduce((s, l) => s + Math.abs(l.s1 - l.s0), 0);
}

/** A little person, 1.75 m tall, in two parts: legs and head, and a shirt tinted per instance. */
function figure() {
  const m = new ModelBuilder();
  m.box(-0.12, 0.12, 0, 0.85, -0.17, 0.17, new Color('#3a3f4a'));
  m.box(-0.11, 0.11, 1.47, 1.75, -0.11, 0.11, new Color('#e0b48f'));
  return m.build();
}
function shirt() {
  const m = new ModelBuilder();
  m.box(-0.15, 0.15, 0.85, 1.45, -0.22, 0.22, new Color(1, 1, 1));
  return m.build();
}

/**
 * Pedestrians at close zoom: people walking the short shop and work trips the sim sampled, along
 * the pavement of their route. Like cars they're a visible sample, and clickable.
 */
export class PedestrianRenderer {
  readonly group = new Group();
  /** Share of the full crowd to show (graphics quality). */
  crowd = 1;
  walkers: Walker[] = [];
  private mesh: InstancedMesh;
  private shirts: InstancedMesh;
  private nextId = 1;
  private lastTick = -1;
  private candidates: TripSample[] = [];
  private candKey = '';
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  private phase = 0;

  constructor(
    private world: ClientWorld,
    private heightOn: (seg: number, s: number, x: number, z: number) => number,
  ) {
    const mat = new MeshLambertMaterial({ vertexColors: true });
    this.mesh = new InstancedMesh(toGeometry(figure()), mat, MAX);
    this.shirts = new InstancedMesh(toGeometry(shirt()), mat, MAX);
    for (let i = 0; i < MAX; i++) this.shirts.setColorAt(i, SHIRTS[i % SHIRTS.length]!);
    for (const m of [this.mesh, this.shirts]) {
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = true;
      this.group.add(m);
    }
    this.mesh.name = 'pedestrians';
  }

  get count(): number {
    return this.walkers.length;
  }

  /** Metres a walker still has to go. */
  remaining(w: Walker): number {
    let m = -w.t;
    for (let i = w.leg; i < w.legs.length; i++) m += Math.abs(w.legs[i]!.s1 - w.legs[i]!.s0);
    return Math.max(0, m);
  }

  walker(id: number): Walker | undefined {
    return this.walkers.find((w) => w.id === id);
  }

  /** Walker nearest a ground point (within `r` metres), for clicking. */
  walkerAt(x: number, z: number, r = 1.6): Walker | null {
    let best: Walker | null = null;
    let bd = r;
    for (const w of this.walkers) {
      const d = Math.hypot(w.x - x, w.z - z);
      if (d < bd) {
        bd = d;
        best = w;
      }
    }
    return best;
  }

  /** Short trips with an end near the view centre. */
  private refreshCandidates(cx: number, cz: number, r: number): void {
    const key = `${Math.round(cx / 60)}:${Math.round(cz / 60)}:${this.world.trafficVersion}:${this.world.netVersion}`;
    if (key === this.candKey) return;
    this.candKey = key;
    const r2 = r * r;
    const near = (id: number) => {
      const b = this.world.buildings.get(id);
      return !!b && (b.x - cx) ** 2 + (b.z - cz) ** 2 < r2;
    };
    this.candidates = this.world.trips.filter((t) => {
      if (t.purpose !== 'shop' && t.purpose !== 'work') return false;
      const len = routeLength(t.legs);
      if (len > (t.purpose === 'shop' ? WALK_SHOP : WALK_WORK)) return false;
      if (!t.legs.every((l) => this.world.netState.segments.has(l.seg))) return false;
      return near(t.from) || near(t.to);
    });
  }

  private spawn(hour: number, cx: number, cz: number, r: number): void {
    const list = this.candidates;
    if (!list.length) return;
    const trip = list[Math.floor(Math.random() * list.length)]!;
    let back = false;
    if (trip.purpose === 'work') back = hour >= 13 || hour < 4 ? Math.random() < 0.85 : Math.random() < 0.15;
    else back = Math.random() < 0.5;
    const legs = back ? reversed(trip.legs) : trip.legs;
    // Start somewhere along the route inside the view so the street fills straight away.
    const w: Walker = {
      id: this.nextId++,
      trip,
      legs,
      leg: 0,
      t: 0,
      side: Math.random() < 0.5 ? 1 : -1,
      pace: PACE * (0.8 + Math.random() * 0.4),
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
    };
    const options: [number, number][] = [];
    for (let i = 0; i < legs.length; i++) {
      const l = legs[i]!;
      const len = Math.abs(l.s1 - l.s0);
      for (let t = 0; t < len; t += 25) {
        const c = this.world.net.curve(l.seg);
        const pt = c.pointAt(Math.max(0, Math.min(c.length, l.s0 + (l.s1 >= l.s0 ? t : -t))));
        if ((pt.x - cx) ** 2 + (pt.z - cz) ** 2 < r * r) options.push([i, t]);
      }
    }
    if (options.length) {
      const [i, t] = options[Math.floor(Math.random() * options.length)]!;
      w.leg = i;
      w.t = t;
    }
    this.walkers.push(w);
  }

  update(displayTick: number, cam: { x: number; z: number; distance: number }): void {
    const dt = this.lastTick < 0 ? 0 : Math.max(0, Math.min(30, displayTick - this.lastTick));
    this.lastTick = displayTick;
    if (cam.distance > PEDESTRIAN_DISTANCE) {
      this.walkers = [];
      this.mesh.count = 0;
      this.shirts.count = 0;
      return;
    }
    const r = Math.max(120, cam.distance * 0.9);
    this.refreshCandidates(cam.x, cam.z, r);
    const hour = hourOfDay(displayTick);
    const share = TRAFFIC.profile[Math.floor(hour)] ?? 0.5;
    const target = Math.min(MAX, Math.round(this.candidates.length * 3 * Math.max(0.15, share) * this.crowd));
    let spawns = 0;
    while (this.walkers.length < target && spawns++ < 6) this.spawn(hour, cam.x, cam.z, r);
    const net = this.world.net;
    const alive: Walker[] = [];
    this.phase += dt;
    let n = 0;
    for (const w of this.walkers) {
      let budget = dt;
      let done = false;
      while (budget > 0 && !done) {
        const l = w.legs[w.leg]!;
        if (!this.world.netState.segments.has(l.seg)) {
          done = true;
          break;
        }
        const left = Math.abs(l.s1 - l.s0) - w.t;
        const need = left / w.pace;
        if (need > budget) {
          w.t += budget * w.pace;
          budget = 0;
        } else {
          budget -= need;
          w.leg++;
          w.t = 0;
          if (w.leg >= w.legs.length) done = true;
        }
      }
      if (done) continue;
      const l = w.legs[w.leg]!;
      const seg = this.world.netState.segments.get(l.seg);
      if (!seg) continue;
      const rt = ROAD_TYPES[seg.type];
      const curve = net.curve(l.seg);
      const dir = l.s1 >= l.s0 ? 1 : -1;
      const sArc = Math.max(0, Math.min(curve.length, l.s0 + dir * w.t));
      const pt = curve.pointAt(sArc);
      const tan = curve.tangentAt(sArc);
      const hx = tan.x * dir;
      const hz = tan.z * dir;
      const off = (rt.width / 2 + Math.max(0.8, rt.sidewalk * 0.5)) * w.side;
      w.x = pt.x - hz * off;
      w.z = pt.z + hx * off;
      w.heading = Math.atan2(hz, hx);
      // Round a roundabout on its footway, not across the island (M19).
      for (const nid of [seg.a, seg.b]) {
        const nd = this.world.netState.nodes.get(nid);
        if (!nd?.roundabout) continue;
        const R = nd.roundabout + JUNCTION.ringWidth / 2 + 1.2;
        const dx = w.x - nd.x;
        const dz = w.z - nd.z;
        const d = Math.hypot(dx, dz);
        if (d < R) {
          w.x = nd.x + (dx / Math.max(0.01, d)) * R;
          w.z = nd.z + (dz / Math.max(0.01, d)) * R;
        }
      }
      // Off-screen walkers finish quietly.
      if ((w.x - cam.x) ** 2 + (w.z - cam.z) ** 2 > r * r * 1.6) continue;
      alive.push(w);
      if (n >= MAX) continue;
      const bob = Math.abs(Math.sin((this.phase * 0.9 + w.id) * 1.3)) * 0.06;
      w.y = this.heightOn(l.seg, sArc, w.x, w.z) + (rt.sidewalk > 0 ? 0.34 : 0.2);
      this.p.set(w.x, w.y + bob, w.z);
      this.q.setFromAxisAngle(this.up, -w.heading);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(n, this.m);
      this.shirts.setMatrixAt(n, this.m);
      this.shirts.setColorAt(n, SHIRTS[w.id % SHIRTS.length]!);
      n++;
    }
    this.walkers = alive;
    for (const m of [this.mesh, this.shirts]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
    }
    if (this.shirts.instanceColor) this.shirts.instanceColor.needsUpdate = true;
  }
}
