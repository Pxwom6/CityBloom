import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Points,
  Quaternion,
  ShaderMaterial,
  AdditiveBlending,
  Vector3,
} from 'three';
import type { ClientWorld } from '../client/world';
import { TRAFFIC } from '../data/balance';
import { ROAD_TYPES, isRail } from '../data/roads';
import { CLOSE_AHEAD_TICKS, type TramBody } from './railVehicles';
import { VEHICLE_SPEED_SCALE } from '../data/civic';
import { hourOfDay } from '../sim/time';
import { congestedSeconds } from '../sim/systems/traffic';
import type { TripSample } from '../sim/systems/traffic';
import type { Leg } from '../sim/systems/graph';
import { ModelBuilder, type ModelData } from './assets/builder';
import { uploadInstances } from './geom';

const W = new Color(1, 1, 1);
const GLASS = new Color(0.22, 0.27, 0.32);
const TYRE = new Color(0.08, 0.08, 0.08);
const LIGHT = new Color(0.95, 0.9, 0.7);

/** Car bodies are white so the per-instance paint colour shows through. Local x = forward. */
function sedan(): ModelData {
  const m = new ModelBuilder();
  m.box(-2.2, 2.2, 0.35, 1.05, -0.88, 0.88, W);
  m.box(-1.2, 0.9, 1.05, 1.6, -0.8, 0.8, W);
  m.box(-1.15, 0.85, 1.1, 1.55, -0.82, 0.82, GLASS);
  m.box(2.18, 2.22, 0.6, 0.85, -0.7, 0.7, LIGHT);
  for (const x of [-1.4, 1.4])
    for (const z of [-0.9, 0.78]) m.box(x - 0.35, x + 0.35, 0, 0.7, z, z + 0.12, TYRE);
  return m.build();
}
function hatch(): ModelData {
  const m = new ModelBuilder();
  m.box(-1.8, 1.8, 0.35, 1.05, -0.85, 0.85, W);
  m.box(-1.75, 0.8, 1.05, 1.65, -0.78, 0.78, W);
  m.box(-1.7, 0.75, 1.1, 1.6, -0.8, 0.8, GLASS);
  for (const x of [-1.1, 1.15])
    for (const z of [-0.88, 0.76]) m.box(x - 0.33, x + 0.33, 0, 0.66, z, z + 0.12, TYRE);
  return m.build();
}
function van(): ModelData {
  const m = new ModelBuilder();
  m.box(-2.4, 2.4, 0.4, 2.2, -0.95, 0.95, W);
  m.box(1.7, 2.42, 1.3, 2.0, -0.9, 0.9, GLASS);
  for (const x of [-1.5, 1.5])
    for (const z of [-1, 0.86]) m.box(x - 0.38, x + 0.38, 0, 0.76, z, z + 0.14, TYRE);
  return m.build();
}
function truck(): ModelData {
  const m = new ModelBuilder();
  // Cab in paint colour, box body in off-white.
  m.box(2.2, 4, 0.5, 2.6, -1.1, 1.1, W);
  m.box(3.95, 4.02, 1.6, 2.4, -0.95, 0.95, GLASS);
  m.box(-4, 2.1, 0.7, 3.4, -1.2, 1.2, new Color(0.93, 0.93, 0.9));
  for (const x of [-3, -1.8, 3.1])
    for (const z of [-1.22, 1.05]) m.box(x - 0.45, x + 0.45, 0, 0.9, z, z + 0.17, TYRE);
  return m.build();
}

const MODELS = { sedan: sedan(), hatch: hatch(), van: van(), truck: truck() } as const;
type ModelName = keyof typeof MODELS;
const MAX_LIGHTS = 360 * 4;
const PAINT = [
  '#d9d9d6',
  '#565b63',
  '#8a9099',
  '#b7312c',
  '#2f5d9e',
  '#e6e1d3',
  '#3f6b4a',
  '#c79a3b',
  '#5a3e6b',
  '#f2f2ef',
].map((h) => new Color(h));
const TRUCK_PAINT = ['#d0342c', '#2f5d9e', '#e8b43a', '#3f6b4a', '#e6e1d3'].map((h) => new Color(h));

interface Car {
  id: number;
  trip: TripSample;
  legs: Leg[];
  leg: number;
  /** Metres driven along the current leg. */
  t: number;
  model: ModelName;
  color: Color;
  lane: number;
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Going round a roundabout between two legs (M19): the ring, where it came on and metres driven. */
  ring?: { node: number; r: number; a0: number; span: number; t: number };
  /** Ticks spent stopped behind another car or giving way (M19). */
  waited: number;
}

/** Is any point of a tram's body (along its track) within `r` metres of (x, z)? */
function nearBody(t: TramBody, x: number, z: number, r: number): boolean {
  const p = t.pts;
  for (let i = 0; i < p.length; i += 2) if ((p[i]! - x) ** 2 + (p[i + 1]! - z) ** 2 < r * r) return true;
  return false;
}

/** Car length plus the gap kept to the car ahead when stopped, metres (M19). */
const SPACING = 7.5;
/** Ticks a junction stays taken by a car crossing it from one road, and by one on a roundabout. */
const HOLD_PLAIN = 4;
const HOLD_RING = 1.5;
/** Speed round a roundabout's ring, metres per tick (about 25 km/h at VEHICLE_SPEED_SCALE). */
const RING_SPEED = (25 / 3.6) * VEHICLE_SPEED_SCALE;

/** What a car needs to know about a node (M19): junction or roundabout, and where to stop. */
interface NodeInfo {
  /** A level crossing (Phase 2 review) holds cars only while a train is near. */
  kind: 'none' | 'plain' | 'ring' | 'crossing';
  x: number;
  z: number;
  /** Ring centre-line radius. */
  r: number;
  /** Metres short of the node where cars wait to cross (a plain junction). */
  stop: number;
}

export function toGeometry(m: ModelData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new BufferAttribute(m.nrm, 3));
  g.setAttribute('color', new BufferAttribute(m.col, 3));
  return g;
}

function reversed(legs: Leg[]): Leg[] {
  return [...legs].reverse().map((l) => ({ seg: l.seg, s0: l.s1, s1: l.s0 }));
}

/**
 * Visible traffic: a representative number of cars and trucks driving the sampled trips (real
 * routes from the sim's assignment). How many are out follows the hour's share of the rush hour;
 * speeds follow each road's congestion. Purely visual: nothing here feeds back into the sim.
 */
export class TrafficRenderer {
  readonly group = new Group();
  /** Most cars on screen at once (quality setting). */
  maxCars = 360;
  private meshes = new Map<ModelName, InstancedMesh>();
  cars: Car[] = [];
  private nextId = 1;
  private lastTick = -1;
  private spawnDebt = 0;
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  private speedCache = new Map<number, number>();
  private speedKey = '';
  /** Nodes as cars see them, rebuilt when the network changes (M19). */
  private nodeInfo = new Map<number, NodeInfo>();
  private nodeVersion = -1;
  /** Level crossings with a train near (the rail vehicles' set, Phase 2 review): cars wait. */
  closedCrossings: ReadonlySet<number> = new Set();
  /** How far a crossing's barriers are down (0–1; render/crossings.ts). */
  barrierDown: (node: number) => number = () => 0;
  /** Ticks until the next train reaches each crossing, as of this frame (the rail vehicles' map). */
  trainEta: ReadonlyMap<number, number> = new Map();
  /** Ticks stepped so far this frame (the train times above are that much nearer), and in all. */
  private frameClock = 0;
  private frameDt = 0;
  /** Trams on the streets (the rail vehicles' list, Phase 2 review): cars keep behind them. */
  trams: readonly TramBody[] = [];

  /** Is a car (or tram) from another road crossing this junction now? (For trams, Phase 2 review.) */
  claimedByOther(node: number, from: number): boolean {
    const cl = this.claims.get(node);
    return !!cl && cl.until > this.clock && cl.from !== from;
  }

  /**
   * A tram crossing a junction from road `from` holds it as a car would, until its next step: a
   * tram moves once a frame and the cars step through a frame's ticks after it, so the hold lasts a
   * frame beyond the usual (at a low frame rate it had lapsed half way, letting cars in under it).
   */
  claim(node: number, from: number): void {
    if (this.nodeInfo.get(node)?.kind === 'plain')
      this.claims.set(node, { from, until: this.clock + HOLD_PLAIN + this.frameDt });
  }

  /**
   * How far a car may drive before it would run into a tram (Phase 2 review): the nearest point of
   * a tram's body (along its track) ahead of it in its lane, less a car's length, or Infinity.
   */
  private tramRoom(c: Car): number {
    if (!this.trams.length) return Infinity;
    // Far off (by where it was drawn, give or take what it can drive this frame): nothing to check.
    const reach = 75 + 3 * this.frameDt;
    let near = false;
    for (const t of this.trams) {
      if (nearBody(t, c.x, c.z, reach)) {
        near = true;
        break;
      }
    }
    if (!near) return Infinity;
    // Where it is now, part way through the frame's steps.
    const l = c.legs[c.leg]!;
    const curve = this.world.net.curve(l.seg);
    const dir = l.s1 >= l.s0 ? 1 : -1;
    const sArc = Math.max(0, Math.min(curve.length, l.s0 + dir * c.t));
    const pt = curve.pointAt(sArc);
    const tan = curve.tangentAt(sArc);
    const hx = tan.x * dir;
    const hz = tan.z * dir;
    const lane = this.laneOffset(l.seg, c.lane);
    const cx = pt.x - hz * lane;
    const cz = pt.z + hx * lane;
    let room = Infinity;
    for (const t of this.trams) {
      if (!nearBody(t, cx, cz, 75)) continue;
      // A car already inside a tram's body (it came on to the road just there) drives out of it.
      if (nearBody(t, cx, cz, 1.8)) continue;
      const p = t.pts;
      for (let i = 0; i < p.length; i += 2) {
        const dx = p[i]! - cx;
        const dz = p[i + 1]! - cz;
        const along = dx * hx + dz * hz;
        if (along <= 0 || along > 40) continue;
        if (Math.abs(dz * hx - dx * hz) > 1.8) continue;
        room = Math.min(room, Math.max(0, along - 4.5));
      }
    }
    return room;
  }
  /** Who is crossing each junction: the road they came from, and until when (display ticks). */
  private claims = new Map<number, { from: number; until: number }>();
  private clock = 0;

  /** Head and tail lights at night: one additive point system (4 points per car). */
  private lights: Points;
  private lightPos = new Float32Array(MAX_LIGHTS * 3);
  private lightCol = new Float32Array(MAX_LIGHTS * 3);
  night = 0;

  constructor(
    private world: ClientWorld,
    private heightOn: (seg: number, s: number, x: number, z: number) => number,
  ) {
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(this.lightPos, 3));
    lg.setAttribute('color', new BufferAttribute(this.lightCol, 3));
    lg.setDrawRange(0, 0);
    this.lights = new Points(
      lg,
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        vertexColors: true,
        uniforms: { uScale: { value: 1 } },
        vertexShader: /* glsl */ `
          varying vec3 vCol;
          uniform float uScale;
          void main() {
            vCol = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = max(2.0, 0.9 * uScale / max(1.0, -mv.z));
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vCol;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            if (d > 0.5) discard;
            float a = smoothstep(0.5, 0.0, d);
            gl_FragColor = vec4(vCol * a * 1.5, a);
          }`,
      }),
    );
    this.lights.frustumCulled = false;
    this.lights.renderOrder = 9;
    this.group.add(this.lights);
    const mat = new MeshLambertMaterial({ vertexColors: true });
    for (const [name, model] of Object.entries(MODELS) as [ModelName, ModelData][]) {
      const mesh = new InstancedMesh(toGeometry(model), mat, 512);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `traffic-${name}`;
      this.meshes.set(name, mesh);
      this.group.add(mesh);
    }
  }

  get count(): number {
    return this.cars.length;
  }

  /** Dev: each model's drawn instances and how many have a black colour. */
  colourStats(): Record<string, { count: number; black: number; hasColour: boolean; sample: number[] }> {
    const out: Record<string, { count: number; black: number; hasColour: boolean; sample: number[] }> = {};
    for (const [name, mesh] of this.meshes) {
      const c = mesh.instanceColor?.array as Float32Array | undefined;
      let black = 0;
      for (let i = 0; c && i < mesh.count; i++) if (c[i * 3]! + c[i * 3 + 1]! + c[i * 3 + 2]! < 0.05) black++;
      out[name] = { count: mesh.count, black, hasColour: !!c, sample: c ? [...c.slice(0, 9)] : [] };
    }
    return out;
  }

  /** Car nearest a ground point (within `r` metres), for clicking. */
  carAt(x: number, z: number, r = 5): Car | null {
    let best: Car | null = null;
    let bd = r;
    for (const c of this.cars) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  car(id: number): Car | undefined {
    return this.cars.find((c) => c.id === id);
  }

  /** Metres a car still has to drive on its trip (photo mode's follow camera picks long ones). */
  remaining(c: Car): number {
    let m = -c.t;
    for (let i = c.leg; i < c.legs.length; i++) m += Math.abs(c.legs[i]!.s1 - c.legs[i]!.s0);
    return Math.max(0, m);
  }

  /** Metres per tick on a segment at the current hour (congested). */
  private speed(seg: number, share: number): number {
    let v = this.speedCache.get(seg);
    if (v === undefined) {
      const sd = this.world.netState.segments.get(seg);
      const free = sd ? ROAD_TYPES[sd.type].speed / 3.6 : 10;
      const t0 = 100 / free;
      v = (free * VEHICLE_SPEED_SCALE * t0) / congestedSeconds(t0, this.world.segVC(seg, share));
      this.speedCache.set(seg, v);
    }
    return v;
  }

  private spawn(hour: number): void {
    const trips = this.world.trips;
    if (!trips.length) return;
    const trip = trips[Math.floor(Math.random() * trips.length)]!;
    if (!trip.legs.every((l) => this.world.netState.segments.has(l.seg))) return;
    // Commuters head to work in the morning and home in the evening.
    let back = false;
    const commuting =
      trip.purpose === 'work' || trip.purpose === 'incommute' || trip.purpose === 'outcommute';
    if (commuting) back = hour >= 13 || hour < 4 ? Math.random() < 0.85 : Math.random() < 0.15;
    else if (trip.purpose === 'shop' || trip.purpose === 'regionshop' || trip.purpose === 'visit')
      back = Math.random() < 0.5;
    const freight = trip.purpose === 'freight' || trip.purpose === 'export' || trip.purpose === 'import';
    const r = Math.random();
    const model: ModelName = freight ? 'truck' : r < 0.55 ? 'sedan' : r < 0.85 ? 'hatch' : 'van';
    const paint = freight ? TRUCK_PAINT : PAINT;
    const legs = back ? (trip.back ?? reversed(trip.legs)) : trip.legs;
    if (!this.world.netState.segments.has(legs[0]!.seg)) return;
    // Not on top of a car already there (M19), and not on a level crossing or by a tram (Phase 2
    // review: a trip can start at a crossing's own node, and a car appeared on the rails).
    const l0 = legs[0]!;
    this.refreshNodes();
    const p0 = this.world.net.curve(l0.seg).pointAt(l0.s0);
    for (const info of this.nodeInfo.values())
      if (info.kind === 'crossing' && (info.x - p0.x) ** 2 + (info.z - p0.z) ** 2 < 12 * 12) return;
    for (const t of this.trams) if (nearBody(t, p0.x, p0.z, 14)) return;
    for (const o of this.cars) {
      const ol = o.legs[o.leg];
      if (
        !o.ring &&
        ol &&
        ol.seg === l0.seg &&
        Math.abs(ol.s0 + (ol.s1 >= ol.s0 ? 1 : -1) * o.t - l0.s0) < SPACING
      )
        return;
    }
    this.cars.push({
      waited: 0,
      id: this.nextId++,
      trip,
      legs,
      leg: 0,
      t: 0,
      model,
      color: paint[Math.floor(Math.random() * paint.length)]!,
      lane: Math.random() < 0.5 ? 1 : 0,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
    });
  }

  /**
   * Metres right of the centre line a car drives in lane `lane`: its own side of a two-way road, or
   * spread across the whole width of a one-way road or ramp (M19).
   */
  private laneOffset(seg: number, lane: number): number {
    const sd = this.world.netState.segments.get(seg);
    if (!sd) return 2.2;
    lane = this.laneOn(seg, lane);
    const rt = ROAD_TYPES[sd.type];
    if (!sd.oneway) return lane ? 5.4 : rt.lanes >= 4 ? 2.2 : rt.width / 4;
    if (rt.lanes <= 1) return 0;
    const w = rt.width / rt.lanes;
    // Two-lane one-way streets use both lanes; wider ones the middle pair.
    return (lane ? 0.5 : -0.5) * w * (rt.lanes >= 4 ? 2 : 1);
  }

  private refreshNodes(): void {
    if (this.nodeVersion === this.world.netVersion) return;
    this.nodeVersion = this.world.netVersion;
    this.nodeInfo.clear();
    this.claims.clear();
    const net = this.world.net;
    for (const n of this.world.netState.nodes.values()) {
      const segs = net.segmentsAt(n.id);
      if (n.roundabout) {
        this.nodeInfo.set(n.id, { kind: 'ring', x: n.x, z: n.z, r: n.roundabout, stop: n.roundabout + 4 });
        continue;
      }
      const kind = this.world.junctionKind(n.id);
      const widest = Math.max(...segs.map((id) => net.halfWidth(id)));
      // Cars cross a level crossing both ways at once; a train near is what stops them, short of the
      // track (Phase 2 review).
      if (kind === 'crossing') {
        const rail = Math.max(
          0,
          ...segs.filter((id) => isRail(net.segment(id).type)).map((id) => net.halfWidth(id)),
        );
        // Behind the barrier (1.5 m back from the track's edge) with a car's half length to spare.
        this.nodeInfo.set(n.id, { kind: 'crossing', x: n.x, z: n.z, r: 0, stop: rail + 6 });
        continue;
      }
      if (kind === 'none') continue;
      this.nodeInfo.set(n.id, { kind: 'plain', x: n.x, z: n.z, r: 0, stop: widest + 1.5 });
    }
  }

  /** The node a leg ends at, when the trip carries on from there along another leg. */
  private endNode(c: Car, i: number): number | null {
    if (i + 1 >= c.legs.length) return null;
    const l = c.legs[i]!;
    const sd = this.world.netState.segments.get(l.seg);
    if (!sd) return null;
    const len = this.world.net.curve(l.seg).length;
    if (l.s1 >= len - 0.05) return sd.b;
    if (l.s1 <= 0.05) return sd.a;
    return null;
  }

  /** Where along leg i a car starts: past the ring when it comes off a roundabout. */
  private startOf(c: Car, i: number): number {
    if (i === 0) return 0;
    const n = this.endNode(c, i - 1);
    const info = n !== null ? this.nodeInfo.get(n) : undefined;
    const len = Math.abs(c.legs[i]!.s1 - c.legs[i]!.s0);
    return info?.kind === 'ring' ? Math.min(len * 0.5, info.r) : 0;
  }

  /** The point on leg i at `t` metres, and the angle from a node to it. */
  private angleOn(c: Car, i: number, t: number, node: NodeInfo): number {
    const l = c.legs[i]!;
    const curve = this.world.net.curve(l.seg);
    const dir = l.s1 >= l.s0 ? 1 : -1;
    const p = curve.pointAt(Math.max(0, Math.min(curve.length, l.s0 + dir * t)));
    return Math.atan2(p.z - node.z, p.x - node.x);
  }

  /**
   * One movement step (M19): each car drives at its road's congested speed, no closer than
   * SPACING behind the car ahead in its lane, waits at a junction another road's traffic is
   * crossing, and at a roundabout gives way to cars already on the ring, then drives round it
   * anticlockwise (traffic keeps right).
   */
  private step(dt: number, share: number): void {
    this.refreshNodes();
    this.clock += dt;
    this.frameClock += dt;
    const net = this.world.net;
    // Cars by lane (road, direction, lane), in order along it; and cars on each ring.
    const lanes = new Map<number, Car[]>();
    const rings = new Map<number, Car[]>();
    const progress = (c: Car) => c.t;
    for (const c of this.cars) {
      if (c.leg >= c.legs.length) continue;
      if (c.ring) {
        const list = rings.get(c.ring.node) ?? [];
        list.push(c);
        rings.set(c.ring.node, list);
        continue;
      }
      const key = this.laneKey(c, c.leg);
      const list = lanes.get(key) ?? [];
      list.push(c);
      lanes.set(key, list);
    }
    // Along a lane, compare position in the direction of travel from the same end of the road.
    const along = (c: Car) => {
      const l = c.legs[c.leg]!;
      const len = net.curve(l.seg).length;
      const s = l.s0 + (l.s1 >= l.s0 ? 1 : -1) * progress(c);
      return l.s1 >= l.s0 ? s : len - s;
    };
    const ahead = new Map<Car, number>();
    for (const list of lanes.values()) {
      if (list.length < 2) continue;
      const pos = list.map((c) => ({ c, u: along(c) })).sort((a, b) => a.u - b.u);
      for (let i = 0; i + 1 < pos.length; i++) ahead.set(pos[i]!.c, pos[i + 1]!.u - pos[i]!.u);
    }
    for (const c of this.cars) {
      let budget = dt;
      for (let guard = 0; budget > 1e-6 && c.leg < c.legs.length && guard < 6; guard++) {
        if (c.ring) {
          budget = this.driveRing(c, budget, rings.get(c.ring.node) ?? [], lanes);
          continue;
        }
        const l = c.legs[c.leg]!;
        if (!this.world.netState.segments.has(l.seg)) {
          c.leg = c.legs.length;
          break;
        }
        const len = Math.abs(l.s1 - l.s0);
        const v = this.speed(l.seg, share);
        const n = this.endNode(c, c.leg);
        const info = n !== null ? this.nodeInfo.get(n) : undefined;
        // How far it may go: to the car ahead, and to the stop line if it must give way.
        let room = this.tramRoom(c);
        const gap = ahead.get(c);
        if (gap !== undefined) room = Math.min(room, Math.max(0, gap - SPACING));
        const end = info?.kind === 'ring' ? Math.max(c.t, len - info.r) : len;
        const stopAt = info ? Math.max(0, len - info.stop) : len;
        // (A car already past a level crossing's stop line carries on across: never stop on the rails.)
        const pastCrossingLine = info?.kind === 'crossing' && c.t > stopAt + 0.5;
        if (info && !pastCrossingLine && c.t + Math.min(room, v * budget) >= stopAt - 0.01) {
          // A level crossing is only entered with room to clear it on the far side, and time to
          // before the barriers start down (Phase 2 review). The room is for this car and every car
          // already over the line ahead of it, which get there first: counting only the road beyond
          // left the second of two cars crossing close together waiting on the rails.
          // (Cars listed at the start of the step that have since moved on to another road, or
          // finished their trip, aren't on this lane any more.)
          const key = this.laneKey(c, c.leg);
          const committed =
            info.kind === 'crossing'
              ? (lanes.get(key) ?? []).filter(
                  (o) =>
                    o !== c &&
                    o.leg < o.legs.length &&
                    !o.ring &&
                    this.laneKey(o, o.leg) === key &&
                    along(o) > along(c),
                ).length
              : 0;
          const blocked =
            !this.mayEnter(c, n!, info, rings.get(n!) ?? []) ||
            (info.kind === 'crossing' &&
              (!this.roomAhead(c, c.leg + 1, lanes, info.stop + SPACING * (1 + committed)) ||
                (this.trainEta.get(n!) ?? Infinity) - this.frameClock <
                  // Time to clear it at half speed (a car in a queue crawls over), counted from the
                  // end of this step: a long frame (a slow machine) carries a car well past the line
                  // after the train's time was read at its start (M27).
                  CLOSE_AHEAD_TICKS + budget + (2 * (2 * info.stop + 6)) / Math.max(0.1, v)));
          if (blocked) room = Math.min(room, Math.max(0, stopAt - c.t));
        }
        const move = Math.min(v * budget, room, end - c.t);
        if (move <= 1e-4 && c.t < end - 1e-3) {
          c.waited += budget;
          budget = 0;
          break;
        }
        c.t += move;
        if (move >= v * 0.2 * dt) c.waited = 0;
        if (c.t < end - 1e-3) {
          // Held up short of the end (behind a car, or at the stop line): that's this step done.
          budget = 0;
          break;
        }
        budget -= move / Math.max(0.01, v);
        {
          if (info?.kind === 'ring') {
            // Onto the ring, from the angle it came in at to the angle it leaves at.
            const a0 = this.angleOn(c, c.leg, end, info);
            const start = this.startOf(c, c.leg + 1);
            const a1 = this.angleOn(c, c.leg + 1, start, info);
            let span = a0 - a1;
            while (span <= 0.3) span += Math.PI * 2;
            while (span > Math.PI * 2 + 0.3) span -= Math.PI * 2;
            c.ring = { node: n!, r: info.r, a0, span, t: 0 };
            this.claims.set(n!, { from: l.seg, until: this.clock + HOLD_RING });
          } else {
            // Wait at the end of the road while the next one is backed up to its start.
            if (!this.roomAhead(c, c.leg + 1, lanes)) {
              c.waited += budget;
              budget = 0;
              break;
            }
            if (info?.kind === 'plain') this.claims.set(n!, { from: l.seg, until: this.clock + HOLD_PLAIN });
            c.leg++;
            c.t = c.leg < c.legs.length ? this.startOf(c, c.leg) : 0;
          }
        }
      }
    }
    this.cars = this.cars.filter((c) => c.leg < c.legs.length);
  }

  /** The lane a car keeps to on a road: its own where the road has two each way, else the one. */
  private laneOn(seg: number, lane: number): number {
    const sd = this.world.netState.segments.get(seg);
    if (!sd || !lane) return 0;
    const lanes = ROAD_TYPES[sd.type].lanes;
    return (sd.oneway ? lanes : lanes / 2) >= 2 ? 1 : 0;
  }

  /** Lane key of leg i for a car: road, direction and lane. */
  private laneKey(c: Car, i: number): number {
    const l = c.legs[i]!;
    return l.seg * 4 + (l.s1 >= l.s0 ? 2 : 0) + this.laneOn(l.seg, c.lane);
  }

  /** Is there room for a car to start leg i (no car within `span` of where it joins, nor a tram)? */
  private roomAhead(c: Car, i: number, lanes: Map<number, Car[]>, span = SPACING): boolean {
    if (i >= c.legs.length) return true;
    if (this.trams.length) {
      const l = c.legs[i]!;
      const p = this.world.net.curve(l.seg).pointAt(l.s0);
      for (const t of this.trams) if (nearBody(t, p.x, p.z, span + 3)) return false;
    }
    const list = lanes.get(this.laneKey(c, i));
    if (!list?.length) return true;
    const l = c.legs[i]!;
    const len = this.world.net.curve(l.seg).length;
    const fwd = l.s1 >= l.s0;
    const start = this.startOf(c, i);
    const u0 = fwd ? l.s0 + start : len - (l.s0 - start);
    for (const o of list) {
      if (o === c || o.ring || o.leg >= o.legs.length) continue;
      const ol = o.legs[o.leg]!;
      const s = ol.s0 + (ol.s1 >= ol.s0 ? 1 : -1) * o.t;
      const u = fwd ? s : len - s;
      if (u >= u0 - 1 && u - u0 < span) return false;
    }
    return true;
  }

  /** May a car cross (or join the ring at) this node now? Claims it if so. */
  private mayEnter(c: Car, node: number, info: NodeInfo, onRing: Car[]): boolean {
    // A level crossing: not while a train is near, nor until the barriers are (nearly) back up.
    if (info.kind === 'crossing') return !this.closedCrossings.has(node) && this.barrierDown(node) < 0.2;
    const from = c.legs[c.leg]!.seg;
    if (info.kind === 'ring') {
      // Give way to cars on the ring about to pass the entry.
      const entry = this.angleOn(c, c.leg, Math.abs(c.legs[c.leg]!.s1 - c.legs[c.leg]!.s0) - info.r, info);
      for (const o of onRing) {
        // (The list is from the start of the step: a car may have left the ring since.)
        if (!o.ring || o.ring.node !== node) continue;
        const at = o.ring.a0 - o.ring.t / o.ring.r;
        let d = at - entry;
        d = ((d % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        // Coming up to the entry (anticlockwise means decreasing angle), or just passing it.
        if (d < 14 / info.r || d > Math.PI * 2 - 5 / info.r) return false;
      }
      return true;
    }
    const cl = this.claims.get(node);
    if (cl && cl.until > this.clock && cl.from !== from) return false;
    this.claims.set(node, { from, until: this.clock + HOLD_PLAIN });
    return true;
  }

  /** Drive round a ring, keeping behind the car ahead on it; returns the ticks left over. */
  private driveRing(c: Car, budget: number, onRing: Car[], lanes: Map<number, Car[]>): number {
    const ring = c.ring!;
    const len = ring.r * ring.span;
    let room = Infinity;
    const mine = ring.a0 - ring.t / ring.r;
    for (const o of onRing) {
      if (o === c || !o.ring || o.ring.node !== ring.node) continue;
      const theirs = o.ring.a0 - o.ring.t / o.ring.r;
      // Ahead means further round (a smaller angle), within half a turn.
      let d = mine - theirs;
      d = ((d % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (d > 0 && d < Math.PI) room = Math.min(room, Math.max(0, d * ring.r - SPACING));
    }
    const move = Math.min(RING_SPEED * budget, room, len - ring.t);
    ring.t += move;
    const used = move / RING_SPEED;
    if (move <= 1e-4 && ring.t < len - 1e-3) {
      c.waited += budget;
      return 0;
    }
    if (ring.t >= len - 1e-3) {
      // Off the ring only when the road out has room.
      if (!this.roomAhead(c, c.leg + 1, lanes)) {
        c.waited += budget;
        return 0;
      }
      c.ring = undefined;
      c.leg++;
      c.t = c.leg < c.legs.length ? this.startOf(c, c.leg) : 0;
    }
    return Math.max(0, budget - used);
  }

  private placeOnRing(c: Car): void {
    const ring = c.ring!;
    const info = this.nodeInfo.get(ring.node);
    if (!info) return;
    const a = ring.a0 - ring.t / ring.r;
    c.x = info.x + Math.cos(a) * ring.r;
    c.z = info.z + Math.sin(a) * ring.r;
    c.y = Math.max(0, this.world.heightAt(c.x, c.z)) + 0.4;
    // Moving to smaller angles: the tangent is (sin a, −cos a).
    c.heading = Math.atan2(-Math.cos(a), Math.sin(a));
  }

  /** Pixels per metre at distance 1, for sizing the light sprites. */
  setScale(pxPerMetre: number): void {
    (this.lights.material as ShaderMaterial).uniforms.uScale!.value = pxPerMetre;
  }

  update(displayTick: number): void {
    const dt = this.lastTick < 0 ? 0 : Math.max(0, Math.min(30, displayTick - this.lastTick));
    this.lastTick = displayTick;
    const hour = hourOfDay(displayTick);
    const share = TRAFFIC.profile[Math.floor(hour)] ?? 0.5;
    const key = `${Math.floor(hour)}:${this.world.trafficVersion}`;
    if (key !== this.speedKey) {
      this.speedKey = key;
      this.speedCache.clear();
    }
    // How many should be out: proportional to the day's trips at this hour, capped.
    let daily = 0;
    for (const v of this.world.traffic.values()) daily += v;
    const target = Math.min(this.maxCars, Math.round(Math.sqrt(daily) * 1.6 * share));
    if (dt > 0 && this.cars.length < target) {
      this.spawnDebt += Math.min(target - this.cars.length, 2 + dt * 0.8);
      while (this.spawnDebt >= 1 && this.cars.length < target) {
        this.spawn(hour);
        this.spawnDebt -= 1;
      }
    }
    const net = this.world.net;
    // Move in short steps, so cars keep their distance and give way even at a low frame rate.
    if (dt > 0) {
      const steps = Math.min(20, Math.ceil(dt / 1.5));
      this.frameClock = 0;
      this.frameDt = dt;
      for (let k = 0; k < steps; k++) this.step(dt / steps, share);
    }
    const alive: Car[] = [];
    const counts = new Map<ModelName, number>();
    for (const c of this.cars) {
      if (c.leg >= c.legs.length || !this.world.netState.segments.has(c.legs[c.leg]!.seg)) continue;
      if (c.ring) this.placeOnRing(c);
      else {
        const l = c.legs[c.leg]!;
        const curve = net.curve(l.seg);
        const dir = l.s1 >= l.s0 ? 1 : -1;
        const sArc = Math.max(0, Math.min(curve.length, l.s0 + dir * c.t));
        const pt = curve.pointAt(sArc);
        const tan = curve.tangentAt(sArc);
        const hx = tan.x * dir;
        const hz = tan.z * dir;
        const lane = this.laneOffset(l.seg, c.lane);
        c.x = pt.x - hz * lane;
        c.z = pt.z + hx * lane;
        c.y = this.heightOn(l.seg, sArc, c.x, c.z) + 0.2;
        c.heading = Math.atan2(hz, hx);
      }
      alive.push(c);
      const mesh = this.meshes.get(c.model)!;
      const i = counts.get(c.model) ?? 0;
      if (i >= 512) continue;
      this.p.set(c.x, c.y, c.z);
      this.q.setFromAxisAngle(this.up, -c.heading);
      this.m.compose(this.p, this.q, this.s);
      mesh.setMatrixAt(i, this.m);
      mesh.setColorAt(i, c.color);
      counts.set(c.model, i + 1);
    }
    this.cars = alive;
    // Lights after dark.
    let nl = 0;
    if (this.night > 0.25) {
      const k = Math.min(1, (this.night - 0.25) / 0.4);
      for (const c of alive) {
        if (nl + 4 > MAX_LIGHTS) break;
        const len = c.model === 'truck' ? 4 : c.model === 'van' ? 2.4 : c.model === 'hatch' ? 1.8 : 2.2;
        const hx = Math.cos(c.heading);
        const hz = Math.sin(c.heading);
        for (const [f, side, r, g, b] of [
          [len, 0.6, 1, 0.92, 0.7],
          [len, -0.6, 1, 0.92, 0.7],
          [-len, 0.6, 0.9, 0.08, 0.05],
          [-len, -0.6, 0.9, 0.08, 0.05],
        ] as const) {
          const i = nl * 3;
          this.lightPos[i] = c.x + hx * f - hz * side;
          this.lightPos[i + 1] = c.y + 0.7;
          this.lightPos[i + 2] = c.z + hz * f + hx * side;
          this.lightCol[i] = r * k;
          this.lightCol[i + 1] = g * k;
          this.lightCol[i + 2] = b * k;
          nl++;
        }
      }
    }
    const lg = this.lights.geometry;
    // Only the lights and cars in use are sent to the GPU (see `uploadInstances`).
    if (nl > 0) {
      for (const name of ['position', 'color']) {
        const a = lg.getAttribute(name) as BufferAttribute;
        a.clearUpdateRanges();
        a.addUpdateRange(0, nl * 3);
        a.needsUpdate = true;
      }
    }
    lg.setDrawRange(0, nl);
    for (const [name, mesh] of this.meshes) {
      mesh.count = counts.get(name) ?? 0;
      uploadInstances(mesh);
    }
  }
}
