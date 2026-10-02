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
import { VEHICLE_SPEED_SCALE } from '../data/civic';
import type { Leg } from '../sim/systems/graph';
import { ModelBuilder, type ModelData } from './assets/builder';
import { REGIONAL_RAIL_CURVE, REGIONAL_RAIL_DX } from './roads';
import { RAIL_TRACK_OFFSET, tramOffset } from './roadStyle';
import { uploadInstances } from './geom';

const C = (h: string) => new Color(h);

/** One car of a tram or train: local x forward, z to the right, y up, centred on the origin. */
function railCar(opts: {
  len: number;
  width: number;
  height: number;
  body: Color;
  skirt: Color;
  stripe?: Color;
  nose?: 'front' | 'both';
  roof?: Color;
  pantograph?: boolean;
}): ModelData {
  const m = new ModelBuilder();
  const { len, width, height } = opts;
  const hl = len / 2;
  const hw = width / 2;
  const glass = C('#2e3c4a');
  m.box(-hl, hl, 0.35, 0.95, -hw, hw, opts.skirt);
  m.box(-hl, hl, 0.95, height, -hw, hw, opts.body, opts.roof ?? opts.body);
  // Window band down both sides.
  m.box(-hl + 0.6, hl - 0.6, 1.55, height - 0.55, -hw - 0.02, hw + 0.02, glass);
  if (opts.stripe) m.box(-hl, hl, 1.2, 1.4, -hw - 0.03, hw + 0.03, opts.stripe);
  // Windscreens and a darker cab end where the car leads.
  const ends = opts.nose === 'both' ? [1, -1] : opts.nose === 'front' ? [1] : [];
  for (const e of ends) {
    const x = e * hl;
    m.box(
      Math.min(x, x + e * 0.04),
      Math.max(x, x + e * 0.04),
      1.45,
      height - 0.4,
      -hw + 0.25,
      hw - 0.25,
      glass,
    );
    m.box(Math.min(x, x + e * 0.05), Math.max(x, x + e * 0.05), 0.6, 0.9, -hw + 0.3, hw - 0.3, C('#f4e7a1'));
  }
  if (opts.pantograph) {
    m.box(-0.8, 0.8, height, height + 0.25, -0.7, 0.7, C('#5d636a'));
    m.box(-0.05, 0.05, height + 0.25, height + 1.1, -0.6, 0.6, C('#3a3f45'));
    m.box(-0.6, 0.6, height + 1.1, height + 1.16, -0.7, 0.7, C('#3a3f45'));
  }
  // Bogies.
  for (const x of [-hl + 2, hl - 2]) m.box(x - 1.1, x + 1.1, 0.05, 0.4, -hw + 0.2, hw - 0.2, C('#2b2f33'));
  return m.build();
}

function locoModel(): ModelData {
  const m = new ModelBuilder();
  const hl = 9;
  const hw = 1.5;
  m.box(-hl, hl, 0.35, 1.1, -hw, hw, C('#2b2f33'));
  m.box(-hl + 0.4, hl - 3.2, 1.1, 3.9, -hw + 0.25, hw - 0.25, C('#2f5d9e'), C('#39414a'));
  m.box(hl - 3.2, hl, 1.1, 4.1, -hw, hw, C('#2f5d9e'), C('#39414a'));
  m.box(hl - 0.02, hl + 0.03, 2.8, 3.7, -hw + 0.2, hw - 0.2, C('#2e3c4a'));
  m.box(hl - 3.2, hl + 0.04, 1.1, 1.8, -hw - 0.02, hw + 0.02, C('#f2b31b'));
  m.box(-hl, -hl + 0.6, 1.1, 1.8, -hw - 0.02, hw + 0.02, C('#f2b31b'));
  for (const x of [-hl + 2.5, hl - 2.5])
    m.box(x - 1.4, x + 1.4, 0.05, 0.45, -hw + 0.2, hw - 0.2, C('#1f2326'));
  return m.build();
}

function wagonModel(a: Color, b: Color): ModelData {
  const m = new ModelBuilder();
  const hl = 7;
  const hw = 1.4;
  m.box(-hl, hl, 0.35, 1.05, -hw, hw, C('#4a4d52'));
  m.box(-hl + 0.3, -0.15, 1.05, 3.6, -hw + 0.05, hw - 0.05, a);
  m.box(0.15, hl - 0.3, 1.05, 3.6, -hw + 0.05, hw - 0.05, b);
  for (const x of [-hl + 1.8, hl - 1.8]) m.box(x - 1, x + 1, 0.05, 0.4, -hw + 0.2, hw - 0.2, C('#1f2326'));
  return m.build();
}

const MODELS = {
  tramEnd: railCar({
    len: 9,
    width: 2.5,
    height: 3.3,
    body: C('#efe6cf'),
    skirt: C('#2f6b52'),
    stripe: C('#2f6b52'),
    nose: 'front',
    roof: C('#d9d3c2'),
  }),
  tramMid: railCar({
    len: 8,
    width: 2.5,
    height: 3.3,
    body: C('#efe6cf'),
    skirt: C('#2f6b52'),
    stripe: C('#2f6b52'),
    roof: C('#d9d3c2'),
    pantograph: true,
  }),
  trainEnd: railCar({
    len: 20,
    width: 2.9,
    height: 3.9,
    body: C('#f2f2ee'),
    skirt: C('#3a3f45'),
    stripe: C('#c8342c'),
    nose: 'front',
    roof: C('#b9bcc2'),
  }),
  trainMid: railCar({
    len: 20,
    width: 2.9,
    height: 3.9,
    body: C('#f2f2ee'),
    skirt: C('#3a3f45'),
    stripe: C('#c8342c'),
    roof: C('#b9bcc2'),
  }),
  loco: locoModel(),
  wagonA: wagonModel(C('#b8432f'), C('#2f5d9e')),
  wagonB: wagonModel(C('#3f6b4a'), C('#d08a2c')),
};
type ModelId = keyof typeof MODELS;

/** A consist: its cars from the front, each car's model, length and whether it faces backwards. */
interface Consist {
  cars: { model: ModelId; len: number; flip?: boolean }[];
  gap: number;
}

const TRAM: Consist = {
  cars: [
    { model: 'tramEnd', len: 9 },
    { model: 'tramMid', len: 8 },
    { model: 'tramEnd', len: 9, flip: true },
  ],
  gap: 0.4,
};
const TRAIN: Consist = {
  cars: [
    { model: 'trainEnd', len: 20 },
    { model: 'trainMid', len: 20 },
    { model: 'trainMid', len: 20 },
    { model: 'trainEnd', len: 20, flip: true },
  ],
  gap: 0.8,
};
const FREIGHT: Consist = {
  cars: [
    { model: 'loco', len: 18 },
    ...Array.from({ length: 8 }, (_, i) => ({ model: (i % 2 ? 'wagonB' : 'wagonA') as ModelId, len: 14 })),
  ],
  gap: 0.8,
};

function consistLength(c: Consist): number {
  return c.cars.reduce((s, x) => s + x.len, 0) + c.gap * (c.cars.length - 1);
}

/** A polyline with heights and cumulative distances; extrapolated straight past both ends. */
class Path {
  readonly x: number[] = [];
  readonly y: number[] = [];
  readonly z: number[] = [];
  readonly cum: number[] = [];
  get length(): number {
    return this.cum[this.cum.length - 1] ?? 0;
  }
  push(x: number, y: number, z: number): void {
    const n = this.x.length;
    if (n) {
      const d = Math.hypot(x - this.x[n - 1]!, z - this.z[n - 1]!);
      if (d < 0.05) return;
      this.cum.push(this.cum[n - 1]! + d);
    } else this.cum.push(0);
    this.x.push(x);
    this.y.push(y);
    this.z.push(z);
  }
  /** Point at distance d (wraps round when `loop`). */
  at(d: number, loop: boolean, out: { x: number; y: number; z: number }): void {
    const L = this.length;
    const n = this.x.length;
    if (n < 2 || L <= 0) {
      out.x = this.x[0] ?? 0;
      out.y = this.y[0] ?? 0;
      out.z = this.z[0] ?? 0;
      return;
    }
    if (loop) d = ((d % L) + L) % L;
    let i: number;
    if (d <= 0) i = 0;
    else if (d >= L) i = n - 2;
    else {
      let lo = 0;
      let hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.cum[mid]! <= d) lo = mid;
        else hi = mid;
      }
      i = lo;
    }
    const seg = this.cum[i + 1]! - this.cum[i]! || 1;
    const t = (d - this.cum[i]!) / seg;
    out.x = this.x[i]! + (this.x[i + 1]! - this.x[i]!) * t;
    out.y = this.y[i]! + (this.y[i + 1]! - this.y[i]!) * Math.max(0, Math.min(1, t));
    out.z = this.z[i]! + (this.z[i + 1]! - this.z[i]!) * t;
  }
}

/** One way along a path: stop positions (front of the train, ascending) and the wait at each, ticks. */
interface Direction {
  path: Path;
  stops: number[];
  dwell: number[];
  /** Level crossings the path passes, and how far along it (Phase 2 review). */
  cross?: { node: number; d: number }[];
}

/** A train closes a crossing this many ticks before its front reaches it: 5 s at 1× speed. */
export const CLOSE_AHEAD_TICKS = 40;
/**
 * Cars stop setting off across a crossing a little sooner, 8 s ahead, so one that has just gone has
 * cleared it before the barriers come down (at a low frame rate cars hear of a closing a frame late).
 */
const HOLD_AHEAD_TICKS = 64;
/** And keeps it closed until its tail is this far past (m). */
const CLOSE_BEHIND = 6;

/** A vehicle's round: one or more directions in turn at `v` metres a tick. */
interface Run {
  kind: 'tram' | 'train' | 'freight';
  loop: boolean;
  dirs: Direction[];
  consist: Consist;
  vehicles: number;
  v: number;
  /** Ticks for one round. */
  period: number;
  /**
   * Trams (Phase 2 review): each tram's own place round the loop, as it waits behind cars, the tram
   * ahead, at junctions a car from another road is crossing and at closed level crossings; and the
   * junctions round the loop (where along it, and the road it comes in on).
   */
  trams?: { d: number; next: number; dwell: number }[];
  junctions?: { node: number; d: number; seg: number }[];
  /** Trains (Phase 2 review): when in the round its front reaches each level crossing, in ticks. */
  passes?: { node: number; t: number }[];
  /** The route, to keep trams where they are when a line's figures change but not its track. */
  route?: string;
}

/**
 * What trams need of the visible cars (render/traffic.ts): where they are, and junctions' claims
 * (a tram claims a junction as it crosses, and waits while a car from another road holds it).
 */
/**
 * A tram as cars see it (Phase 2 review): its front, rear and the heading between them, and points
 * along its track from front to rear every `TRAM_BODY_STEP` metres (x, z pairs), since round a
 * curve or a turnaround across the road the straight line from front to rear isn't where it is.
 */
export interface TramBody {
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  hx: number;
  hz: number;
  pts: number[];
}
export const TRAM_BODY_STEP = 2;

export interface TramTraffic {
  readonly cars: readonly { x: number; z: number; heading: number }[];
  claimedByOther(node: number, from: number): boolean;
  claim(node: number, from: number): void;
}

/** Half the width of the lane a tram and a car share (m); and what a tram keeps to what's ahead. */
const LANE_HALF = 1.8;
const TRAM_GAP = 5;
/** A tram waits this far short of a junction or crossing it can't enter (m). */
const TRAM_STOP = 9;

function periodOf(dirs: Direction[], v: number): number {
  let t = 0;
  for (const d of dirs) {
    t += d.dwell.reduce((a, b) => a + b, 0);
    t += (d.stops[d.stops.length - 1]! - d.stops[0]!) / v;
  }
  return t;
}

/** Where a vehicle is `phase` ticks into its round: the path and the distance of its front. */
function locate(run: Run, phase: number): { path: Path; d: number } {
  let t = phase;
  for (const dir of run.dirs) {
    const st = dir.stops;
    for (let i = 0; i < st.length; i++) {
      if (t < dir.dwell[i]!) return { path: dir.path, d: st[i]! };
      t -= dir.dwell[i]!;
      if (i + 1 < st.length) {
        const move = (st[i + 1]! - st[i]!) / run.v;
        if (t < move) return { path: dir.path, d: st[i]! + t * run.v };
        t -= move;
      }
    }
  }
  const last = run.dirs[run.dirs.length - 1]!;
  return { path: last.path, d: last.stops[last.stops.length - 1]! };
}

/** `p` moved `off` metres to the right of its direction (driving on the right). */
function offsetPath(p: Path, off: number): Path {
  const out = new Path();
  const n = p.x.length;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dx = p.x[b]! - p.x[a]!;
    const dz = p.z[b]! - p.z[a]!;
    const l = Math.hypot(dx, dz) || 1;
    out.push(p.x[i]! - (dz / l) * off, p.y[i]!, p.z[i]! + (dx / l) * off);
  }
  return out;
}

function reversed(p: Path): Path {
  const out = new Path();
  for (let i = p.x.length - 1; i >= 0; i--) out.push(p.x[i]!, p.y[i]!, p.z[i]!);
  return out;
}

/** A copy of `p` with `e` metres more track straight on past each end. */
function extended(p: Path, e: number): Path {
  const n = p.x.length;
  const out = new Path();
  const dx0 = p.x[0]! - p.x[1]!;
  const dz0 = p.z[0]! - p.z[1]!;
  const l0 = Math.hypot(dx0, dz0) || 1;
  out.push(p.x[0]! + (dx0 / l0) * e, p.y[0]!, p.z[0]! + (dz0 / l0) * e);
  for (let i = 0; i < n; i++) out.push(p.x[i]!, p.y[i]!, p.z[i]!);
  const dx1 = p.x[n - 1]! - p.x[n - 2]!;
  const dz1 = p.z[n - 1]! - p.z[n - 2]!;
  const l1 = Math.hypot(dx1, dz1) || 1;
  out.push(p.x[n - 1]! + (dx1 / l1) * e, p.y[n - 1]!, p.z[n - 1]! + (dz1 / l1) * e);
  return out;
}

const MAX_CARS = 1024;
const TRAM_SPEED = (30 / 3.6) * VEHICLE_SPEED_SCALE;
const TRAIN_SPEED = (70 / 3.6) * VEHICLE_SPEED_SCALE;
const FREIGHT_SPEED = (50 / 3.6) * VEHICLE_SPEED_SCALE;

/**
 * Trams and trains (M20): each line's vehicles run its timetable along the track, stopping at every
 * stop or station, cars following each other round bends. Trams keep to their lane, trains to the
 * right-hand track (the other one on the way back); freight trains come in off the regional railway
 * to each loading terminal and go out again.
 */
export class RailVehicleRenderer {
  readonly group = new Group();
  private meshes = new Map<ModelId, InstancedMesh>();
  private runs: Run[] = [];
  private version = -1;
  private netVersion = -1;
  private key = '';
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3(1, 1, 1);
  private up = new Vector3(0, 1, 0);
  private a = { x: 0, y: 0, z: 0 };
  private b = { x: 0, y: 0, z: 0 };
  /** Vehicles drawn last frame, by kind (tests and stats). */
  counts = { tram: 0, train: 0, freight: 0 };
  /** Front of each drawn vehicle (tests, the follow camera). */
  readonly fronts: { kind: 'tram' | 'train' | 'freight'; x: number; y: number; z: number }[] = [];
  /** Level crossings a train is nearing or passing over (Phase 2 review): barriers down. */
  readonly closed = new Set<number>();
  /** Crossings cars mustn't set off across (a train a little further off, or closed). */
  readonly holding = new Set<number>();
  /** Ticks until the next train reaches each crossing (0 while one is on it), for cars deciding to cross. */
  readonly eta = new Map<number, number>();
  /** Trams on the streets as cars see them (Phase 2 review). */
  readonly tramBodies: TramBody[] = [];
  /** The visible cars trams keep out of the way of (set by the renderer). */
  traffic: TramTraffic | null = null;
  private lastTick = -1;

  constructor(
    private world: ClientWorld,
    private heightOn: (seg: number, s: number, x: number, z: number) => number,
  ) {
    const mat = new MeshLambertMaterial({ vertexColors: true });
    for (const id of Object.keys(MODELS) as ModelId[]) {
      const d = MODELS[id];
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(d.pos, 3));
      g.setAttribute('normal', new BufferAttribute(d.nrm, 3));
      g.setAttribute('color', new BufferAttribute(d.col, 3));
      const mesh = new InstancedMesh(g, mat, MAX_CARS);
      mesh.instanceMatrix.setUsage(DynamicDrawUsage);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.name = `rail-${id}`;
      this.meshes.set(id, mesh);
      this.group.add(mesh);
    }
  }

  /** Sample legs into a path, `side(seg)` metres right of the way they run (0: the centre line). */
  private pathOf(legs: Leg[], side: (seg: number) => number, lift: number, into = new Path()): Path | null {
    const w = this.world;
    for (const l of legs) {
      if (!w.netState.segments.has(l.seg)) return null;
      const curve = w.net.curve(l.seg);
      const dir = l.s1 >= l.s0 ? 1 : -1;
      const len = Math.abs(l.s1 - l.s0);
      const n = Math.max(1, Math.ceil(len / 3));
      const off = side(l.seg);
      for (let i = 0; i <= n; i++) {
        const s = l.s0 + (dir * len * i) / n;
        const p = curve.pointAt(s);
        const t = curve.tangentAt(s);
        const x = p.x - t.z * dir * off;
        const z = p.z + t.x * dir * off;
        into.push(x, this.heightOn(l.seg, s, x, z) + lift, z);
      }
    }
    return into.x.length >= 2 ? into : null;
  }

  private rebuild(): void {
    const w = this.world;
    const lines = w.lines.filter((l) => l.mode !== 'bus');
    const key = JSON.stringify([
      lines.map((l) => [l.mode, l.buses, l.legs, l.stopDist]),
      w.freight.map((f) => [f.id, f.legs]),
    ]);
    if (key === this.key) return;
    this.key = key;
    // Trams stay where they are on a route that hasn't changed (a line's vehicle count or riders
    // change every hour or so; starting them again from the timetable would jump them onto cars).
    const kept = new Map(this.runs.filter((r) => r.trams && r.route).map((r) => [r.route!, r.trams!]));
    this.runs = [];
    const type = (seg: number) => w.netState.segments.get(seg)!.type;
    const legLength = (legs: Leg[]) => legs.reduce((a, l) => a + Math.abs(l.s1 - l.s0), 0);
    for (const l of lines) {
      if (l.mode === 'tram') {
        // Round the loop in the lane next to the centre line, calling at each stop.
        const path = this.pathOf(l.legs, (seg) => tramOffset(type(seg)), 0.25);
        if (!path) continue;
        const k = path.length / Math.max(1, legLength(l.legs));
        const stops = [0, ...l.stopDist.map((d) => Math.min(path.length, d * k)), path.length];
        const dirs = [
          { path, stops, dwell: stops.map((_, i) => (i === 0 || i === stops.length - 1 ? 0 : 1)) },
        ];
        // The junctions round the loop, where along it, and the road the tram comes in on.
        const junctions: Run['junctions'] = [];
        let at = 0;
        for (const leg of l.legs) {
          at += Math.abs(leg.s1 - leg.s0);
          const sd = w.netState.segments.get(leg.seg)!;
          const node = leg.s1 >= leg.s0 ? sd.b : sd.a;
          const kind = w.junctionKind(node);
          if (kind !== 'none' && kind !== 'crossing') junctions.push({ node, d: at * k, seg: leg.seg });
        }
        const route = JSON.stringify([l.legs, l.stopDist]);
        const run: Run = {
          kind: 'tram',
          loop: true,
          dirs,
          consist: TRAM,
          vehicles: l.buses,
          v: TRAM_SPEED,
          period: periodOf(dirs, TRAM_SPEED),
          junctions,
          route,
          trams: kept.get(route)?.slice(0, l.buses),
        };
        this.runs.push(run);
        continue;
      }
      // Trains shuttle: out on the right-hand track and back on the other, standing alongside each
      // platform (the front a train's length past the start of the line, which runs on past its ends).
      const centre = this.pathOf(l.legs, () => 0, 0.3);
      if (!centre) continue;
      const len = consistLength(TRAIN);
      const k = centre.length / Math.max(1, legLength(l.legs));
      const at = l.stopDist.map((d) => Math.min(centre.length, d * k));
      const fwd = extended(offsetPath(centre, RAIL_TRACK_OFFSET), len / 2);
      const bwd = extended(offsetPath(reversed(centre), RAIL_TRACK_OFFSET), len / 2);
      const L = centre.length;
      const out = at.map((d) => d + len);
      const back = at.map((d) => L - d + len).sort((a, b) => a - b);
      const dirs = [
        { path: fwd, stops: out, dwell: out.map(() => 2) },
        { path: bwd, stops: back, dwell: back.map(() => 2) },
      ];
      this.runs.push({
        kind: 'train',
        loop: false,
        dirs,
        consist: TRAIN,
        vehicles: l.buses,
        v: TRAIN_SPEED,
        period: periodOf(dirs, TRAIN_SPEED),
      });
    }
    // Freight trains: in off the regional railway to each terminal's siding, a wait while loading,
    // then out the way they came on the other track.
    const hw = w.gen.params.highway;
    const link = w.railway ? w.netState.nodes.get(w.railway.outside) : undefined;
    for (const f of link ? w.freight : []) {
      const x0 = hw.lineX + REGIONAL_RAIL_DX;
      const away = Math.sign(link!.z - hw.connectZ) || 1;
      const rad = REGIONAL_RAIL_CURVE;
      const h = (x: number, z: number) => Math.max(0, w.heightAt(x, z)) + 0.5;
      const centre = new Path();
      for (let d = 900; d > rad; d -= 20) centre.push(x0, h(x0, link!.z + away * d), link!.z + away * d);
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const bx = (1 - t) * (1 - t) * x0 + 2 * t * (1 - t) * x0 + t * t * (x0 + rad);
        const bz = (1 - t) * (1 - t) * (link!.z + away * rad) + 2 * t * (1 - t) * link!.z + t * t * link!.z;
        centre.push(bx, h(bx, bz), bz);
      }
      // The link itself from where it leaves the curve, then on to the siding.
      const main = this.pathOf(f.legs, () => 0, 0.3);
      if (!main) continue;
      for (let i = 0; i < main.x.length; i++)
        if (main.x[i]! > x0 + rad + 1) centre.push(main.x[i]!, main.y[i]!, main.z[i]!);
      const len = consistLength(FREIGHT);
      const inn = offsetPath(centre, RAIL_TRACK_OFFSET);
      const outp = offsetPath(reversed(centre), RAIL_TRACK_OFFSET);
      const dirs = [
        { path: inn, stops: [0, inn.length], dwell: [20, 30] },
        { path: outp, stops: [len, outp.length], dwell: [0, 0] },
      ];
      this.runs.push({
        kind: 'freight',
        loop: false,
        dirs,
        consist: FREIGHT,
        vehicles: 1,
        v: FREIGHT_SPEED,
        period: periodOf(dirs, FREIGHT_SPEED),
      });
    }
  }

  /** Where each run's paths pass the level crossings (a path sample within a few metres of the node). */
  private findCrossings(): void {
    const w = this.world;
    const nodes = [...w.netState.nodes.values()].filter((n) => w.junctionKind(n.id) === 'crossing');
    for (const run of this.runs)
      for (const dir of run.dirs) {
        dir.cross = [];
        const p = dir.path;
        for (const n of nodes) {
          let best = -1;
          let bd = 6 * 6;
          for (let i = 0; i < p.x.length; i++) {
            const d = (p.x[i]! - n.x) ** 2 + (p.z[i]! - n.z) ** 2;
            if (d < bd) {
              bd = d;
              best = i;
            }
          }
          if (best >= 0) dir.cross.push({ node: n.id, d: p.cum[best]! });
        }
      }
    // When in its round each train's front reaches each crossing (its timetable is fixed), so a
    // train turning back at a terminus a little way off is seen coming too.
    for (const run of this.runs) {
      if (run.kind === 'tram') continue;
      run.passes = [];
      let t = 0;
      for (const dir of run.dirs) {
        const st = dir.stops;
        const at: number[] = [];
        let u = t;
        for (let i = 0; i < st.length; i++) {
          u += dir.dwell[i]!;
          at.push(u);
          if (i + 1 < st.length) u += (st[i + 1]! - st[i]!) / run.v;
        }
        for (const c of dir.cross ?? []) {
          if (c.d < st[0]! || c.d > st[st.length - 1]!) continue;
          let i = 0;
          while (i + 1 < st.length && st[i + 1]! < c.d) i++;
          run.passes.push({ node: c.node, t: at[i]! + (c.d - st[i]!) / run.v });
        }
        t = u;
      }
    }
  }

  /**
   * Move a tram along its loop (Phase 2 review): at its timetable's pace, calling at each stop, but
   * never into a car ahead in its lane, the tram ahead, a junction a car from another road is
   * crossing, or a closed level crossing.
   */
  private stepTram(run: Run, k: number, dt: number): void {
    const st = run.trams![k]!;
    const dir = run.dirs[0]!;
    const L = dir.path.length;
    if (L <= 0) return;
    const ahead = (d: number) => (((d - st.d) % L) + L) % L;
    const len = consistLength(run.consist);
    // Junctions under the tram are held, so a car from another road doesn't turn in on top of it;
    // one right at its front (waiting at a stop too) is taken only if no car from another road is
    // crossing it. Taking it regardless let a tram that had stopped for a car drive on at the next
    // frame, over the car.
    const held = new Set<number>();
    for (const j of run.junctions ?? []) {
      const a = ahead(j.d);
      const under = L - a < len + 8;
      if (!under && a >= TRAM_STOP + 3) continue;
      if (under || !this.traffic?.claimedByOther(j.node, j.seg)) {
        this.traffic?.claim(j.node, j.seg);
        held.add(j.node);
      }
    }
    let budget = dt;
    if (st.dwell > 0) {
      const used = Math.min(budget, st.dwell);
      st.dwell -= used;
      budget -= used;
    }
    if (budget <= 0) return;
    let room = run.v * budget;
    // Cars on its track ahead (and any crossing it just in front), looked for along the track itself:
    // a straight line from its front missed cars round a curve, and at a turnaround, where the track
    // crosses the road, it looked across the road instead of along the way it was about to go.
    const reach = room + TRAM_GAP + 3;
    dir.path.at(st.d, true, this.a);
    const near = (this.traffic?.cars ?? []).filter(
      (c) => (c.x - this.a.x) ** 2 + (c.z - this.a.z) ** 2 < (reach + LANE_HALF) ** 2,
    );
    for (let s = TRAM_BODY_STEP, hit = false; near.length && !hit && s <= reach; s += TRAM_BODY_STEP) {
      dir.path.at(st.d + s, true, this.b);
      const hl = Math.hypot(this.b.x - this.a.x, this.b.z - this.a.z) || 1;
      const hx = (this.b.x - this.a.x) / hl;
      const hz = (this.b.z - this.a.z) / hl;
      for (const c of near) {
        if ((c.x - this.b.x) ** 2 + (c.z - this.b.z) ** 2 > LANE_HALF * LANE_HALF) continue;
        // Head on in its lane: the car gives way (render/traffic.ts), the tram doesn't wait for it.
        if (Math.cos(c.heading) * hx + Math.sin(c.heading) * hz < -0.5) continue;
        room = Math.min(room, Math.max(0, s - LANE_HALF - TRAM_GAP));
        hit = true;
      }
      this.a.x = this.b.x;
      this.a.z = this.b.z;
    }
    // The tram ahead on the loop.

    for (let j = 0; j < run.trams!.length; j++) {
      if (j === k) continue;
      const gap = ahead(run.trams![j]!.d - len);
      if (gap < L / 2) room = Math.min(room, Math.max(0, gap - TRAM_GAP));
    }
    // Closed level crossings, and junctions a car from another road is crossing.
    for (const c of dir.cross ?? []) {
      const a = ahead(c.d);
      if (this.holding.has(c.node) && a > TRAM_STOP - 1 && a < room + TRAM_STOP)
        room = Math.min(room, a - TRAM_STOP);
    }
    for (const j of run.junctions ?? []) {
      const a = ahead(j.d);
      if (held.has(j.node) || a > room + TRAM_STOP) continue;
      if (this.traffic?.claimedByOther(j.node, j.seg)) {
        if (a > TRAM_STOP - 1) room = Math.min(room, a - TRAM_STOP);
      } else this.traffic?.claim(j.node, j.seg);
    }
    room = Math.max(0, room);
    // Stops.
    const stop = dir.stops[st.next]!;
    const toStop = ahead(stop);
    if (toStop <= room) {
      st.d = stop % L;
      st.dwell = dir.dwell[st.next]!;
      st.next = st.next + 1 >= dir.stops.length - 1 ? 0 : st.next + 1;
      return;
    }
    st.d = (st.d + room) % L;
  }

  /** Is there room for a tram of this line with its front at `d`: no car and no other tram there? */
  private clearForTram(run: Run, d: number): boolean {
    const path = run.dirs[0]!.path;
    const L = path.length;
    const len = consistLength(run.consist);
    for (const t of run.trams ?? []) {
      const gap = (((d - t.d) % L) + L) % L;
      if (gap < len + TRAM_GAP || L - gap < len + TRAM_GAP) return false;
    }
    for (let s = -TRAM_GAP; s <= len + TRAM_GAP; s += 2) {
      path.at(d - s, true, this.a);
      for (const c of this.traffic?.cars ?? [])
        if ((c.x - this.a.x) ** 2 + (c.z - this.a.z) ** 2 < LANE_HALF * LANE_HALF) return false;
    }
    return true;
  }

  update(displayTick: number): void {
    if (this.version !== this.world.transitVersion || this.netVersion !== this.world.netVersion) {
      const rebuilt = this.version !== this.world.transitVersion;
      this.version = this.world.transitVersion;
      this.netVersion = this.world.netVersion;
      if (rebuilt) this.rebuild();
      this.findCrossings();
    }
    // Trams start from where their timetable has them, then keep their own place (Phase 2 review).
    for (const run of this.runs) {
      if (run.kind !== 'tram' || (run.trams && run.trams.length >= run.vehicles)) continue;
      run.trams ??= [];
      const stops = run.dirs[0]!.stops;
      for (let k = run.trams.length; k < run.vehicles; k++) {
        const phase =
          (((displayTick + (k * run.period) / run.vehicles) % run.period) + run.period) % run.period;
        const { d } = locate(run, phase);
        // It joins where its timetable has it once that place is clear: not on top of a car, nor
        // too close to a tram already running (a line gaining a tram put it down on cars).
        if (!this.clearForTram(run, d)) break;
        let next = stops.findIndex((x) => x > d + 0.01);
        if (next < 0 || next >= stops.length - 1) next = 0;
        run.trams.push({ d, next, dwell: 0 });
      }
    }
    const dt = this.lastTick < 0 ? 0 : Math.max(0, Math.min(40, displayTick - this.lastTick));
    this.lastTick = displayTick;
    for (const run of this.runs)
      if (run.trams) for (let k = 0; k < run.trams.length; k++) this.stepTram(run, k, dt);
    this.tramBodies.length = 0;
    this.closed.clear();
    this.holding.clear();
    this.eta.clear();
    const counts = new Map<ModelId, number>();
    for (const id of this.meshes.keys()) counts.set(id, 0);
    this.counts = { tram: 0, train: 0, freight: 0 };
    this.fronts.length = 0;
    for (const run of this.runs) {
      if (run.period <= 0) continue;
      for (let k = 0; k < (run.trams ? run.trams.length : run.vehicles); k++) {
        const phase =
          (((displayTick + (k * run.period) / run.vehicles) % run.period) + run.period) % run.period;
        const { path, d } = run.trams ? { path: run.dirs[0]!.path, d: run.trams[k]!.d } : locate(run, phase);
        if (run.trams) {
          const len = consistLength(run.consist);
          path.at(d, true, this.a);
          path.at(d - len, true, this.b);
          const hl = Math.hypot(this.a.x - this.b.x, this.a.z - this.b.z) || 1;
          const body: TramBody = {
            fx: this.a.x,
            fz: this.a.z,
            rx: this.b.x,
            rz: this.b.z,
            hx: (this.a.x - this.b.x) / hl,
            hz: (this.a.z - this.b.z) / hl,
            pts: [],
          };
          for (let s = 0; s < len + TRAM_BODY_STEP; s += TRAM_BODY_STEP) {
            path.at(d - Math.min(s, len), true, this.b);
            body.pts.push(this.b.x, this.b.z);
          }
          this.tramBodies.push(body);
        }
        if (run.passes) {
          const over = (consistLength(run.consist) + CLOSE_BEHIND) / run.v;
          for (const c of run.passes) {
            // Ticks until its front gets there, or since it did.
            const until = (((c.t - phase) % run.period) + run.period) % run.period;
            const since = run.period - until;
            const t = since < over ? 0 : until;
            if (t < (this.eta.get(c.node) ?? Infinity)) this.eta.set(c.node, t);
            if (t < CLOSE_AHEAD_TICKS) this.closed.add(c.node);
            if (t < HOLD_AHEAD_TICKS) this.holding.add(c.node);
          }
        }
        path.at(d, run.loop, this.a);
        this.fronts.push({ kind: run.kind, x: this.a.x, y: this.a.y, z: this.a.z });
        this.counts[run.kind]++;
        let behind = 0;
        for (const car of run.consist.cars) {
          const front = d - behind;
          behind += car.len + run.consist.gap;
          path.at(front, run.loop, this.a);
          path.at(front - car.len, run.loop, this.b);
          const mesh = this.meshes.get(car.model)!;
          const i = counts.get(car.model)!;
          if (i >= MAX_CARS) continue;
          const hx = this.a.x - this.b.x;
          const hz = this.a.z - this.b.z;
          this.p.set((this.a.x + this.b.x) / 2, (this.a.y + this.b.y) / 2, (this.a.z + this.b.z) / 2);
          this.q.setFromAxisAngle(this.up, -Math.atan2(hz, hx) + (car.flip ? Math.PI : 0));
          this.m.compose(this.p, this.q, this.s);
          mesh.setMatrixAt(i, this.m);
          counts.set(car.model, i + 1);
        }
      }
    }
    for (const [id, mesh] of this.meshes) {
      mesh.count = counts.get(id)!;
      uploadInstances(mesh);
    }
  }
}
