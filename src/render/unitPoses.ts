import type { ClientWorld } from '../client/world';
import { CIVIC } from '../data/civic';
import { ROAD_TYPES } from '../data/roads';
import { UNIT, type UnitKind } from '../data/war';
import type { CivicData } from '../sim/protocol';
import { buildingYaw } from './buildings';

/**
 * Where the city's units are and what they're doing (phase 5, M34), as pure functions of the
 * display clock and each unit's id, its base and the roads: never a random number or the wall
 * clock, so every player in a shared city, and every screenshot, sees the same thing. Units park in
 * slots on their base's site (the same places on the hand-made and generated looks), infantry march
 * round the barracks' parade square, a tank or two circles the depot's test pad, a share of the
 * land vehicles drive a loop on the roads near their base, helicopters and drones circle low over
 * the town in front of the airfield, planes take off along its runway, circle and land, and boats
 * patrol a loop in deep water off the naval yard. Site-local frame as in ports.ts: x along the road,
 * z back from it, a heading of 0 faces the road (−z).
 */

export type UnitActivity = 'parked' | 'drill' | 'patrol' | 'flying' | 'sailing';

export interface UnitPose {
  id: number;
  kind: UnitKind;
  x: number;
  y: number;
  z: number;
  /** Rotation about y of the model (front −z), its nose up, and its bank to the right. */
  yaw: number;
  pitch: number;
  bank: number;
  /** Turret yaw and barrel lift relative to the hull (radians). */
  turret: number;
  barrel: number;
  /** Metres rolled: wheels and tracks turn by it. */
  rolled: number;
  /** Hatches and ramps, 0 shut to 1 open. */
  open: number;
  /** Rotors and propellers: their angle (radians); 0 while still. */
  spin: number;
  doing: UnitActivity;
}

/** How many units may be away from their slots at once, per base (the graphics quality's). */
export interface UnitLimits {
  /** Squads marching, and vehicles on the test pad (fewer of those: the pad is small). */
  drill: number;
  /** Vehicles out on the roads, and boats at sea. */
  patrol: number;
  /** Planes in the air, and helicopters and drones. */
  fly: number;
}

/** A place on a base's site: local position, heading, and the longest unit it takes (m). */
interface Slot {
  x: number;
  z: number;
  h: number;
  fits: number;
  /** Barracks: on the march loop (cleared when the squads march). */
  band?: boolean;
  /** Depot: at the back (beside the test pad) rather than in the forecourt. */
  back?: boolean;
}

/** Points of a route in world space, each with the speed (m per tick) on the leg leaving it. */
interface RoutePoint {
  x: number;
  y: number;
  z: number;
  v: number;
}

const TAU = Math.PI * 2;

/** An integer hash of a unit (or base) id and a salt, to [0, 1). */
export function idHash(id: number, salt = 0): number {
  let h = (Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x27d4eb2f, 0xc2b2ae35)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

const smooth = (t: number) => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * (3 - 2 * u);
};

/** The shortest turn from a to b. */
function turnTo(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** The model yaw that points the front (−z) along world direction (dx, dz). */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** A route through points, timed by each leg's speed: where it is t ticks after setting off. */
export class Route {
  readonly time: number[] = [0];
  readonly dist: number[] = [0];
  private yaws: number[] = [];

  constructor(readonly pts: RoutePoint[]) {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      this.dist.push(this.dist[i - 1]! + d);
      this.time.push(this.time[i - 1]! + d / Math.max(0.01, a.v));
    }
    // Each leg's heading; legs straight up or down keep the one before (or after).
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      this.yaws.push(Math.hypot(b.x - a.x, b.z - a.z) > 0.05 ? yawOf(b.x - a.x, b.z - a.z) : NaN);
    }
    let last = NaN;
    for (let i = 0; i < this.yaws.length; i++) {
      if (Number.isNaN(this.yaws[i]!)) this.yaws[i] = last;
      else last = this.yaws[i]!;
    }
    last = NaN;
    for (let i = this.yaws.length - 1; i >= 0; i--) {
      if (Number.isNaN(this.yaws[i]!)) this.yaws[i] = Number.isNaN(last) ? 0 : last;
      else last = this.yaws[i]!;
    }
  }

  get duration(): number {
    return this.time[this.time.length - 1]!;
  }

  get length(): number {
    return this.dist[this.dist.length - 1]!;
  }

  /** Position, heading, climb and turn rate t ticks along. */
  at(t: number): { x: number; y: number; z: number; yaw: number; pitch: number; turn: number; dist: number } {
    const T = this.duration;
    const tt = Math.max(0, Math.min(T, t));
    let lo = 0;
    let hi = this.time.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.time[mid]! <= tt) lo = mid;
      else hi = mid;
    }
    const i = Math.min(lo, this.pts.length - 2);
    const a = this.pts[i]!;
    const b = this.pts[i + 1]!;
    const span = this.time[i + 1]! - this.time[i]!;
    const u = span > 0 ? (tt - this.time[i]!) / span : 1;
    const flat = Math.hypot(b.x - a.x, b.z - a.z);
    const yaw = this.yaws[i] ?? 0;
    const next = this.yaws[i + 1] ?? yaw;
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      z: a.z + (b.z - a.z) * u,
      yaw,
      pitch: flat > 0.05 ? Math.atan2(b.y - a.y, flat) : 0,
      turn: span > 0 ? turnTo(yaw, next) / Math.max(1, span) : 0,
      dist: this.dist[i]! + (this.dist[i + 1]! - this.dist[i]!) * u,
    };
  }
}

/** A base's site: its frame and helpers from local to world. */
export class Site {
  readonly W: number;
  readonly D: number;
  readonly yaw: number;
  private cos: number;
  private sin: number;

  constructor(readonly c: CivicData) {
    const def = CIVIC.get(c.def);
    this.W = def?.w ?? 40;
    this.D = def?.d ?? 40;
    this.yaw = buildingYaw(c);
    this.cos = Math.cos(this.yaw);
    this.sin = Math.sin(this.yaw);
  }

  /** Local (x along the road, z back from it) to world. */
  at(lx: number, lz: number): { x: number; z: number } {
    return { x: this.c.x + lx * this.cos + lz * this.sin, z: this.c.z - lx * this.sin + lz * this.cos };
  }

  /** A point on the site's ground (or `dy` above it), with a speed for the leg leaving it. */
  pt(lx: number, lz: number, v: number, dy = 0.06): RoutePoint {
    const p = this.at(lx, lz);
    return { x: p.x, y: this.c.y + dy, z: p.z, v };
  }

  /** The world direction of a local one. */
  dir(dx: number, dz: number): { x: number; z: number } {
    return { x: dx * this.cos + dz * this.sin, z: -dx * this.sin + dz * this.cos };
  }

  key(): string {
    return `${this.c.id}:${this.c.x}:${this.c.z}:${this.c.angle}:${this.c.side}:${this.c.y}`;
  }
}

// ------------------------------------------------------------------ slots

/** Barracks (40 × 32): six squads in the middle of the parade square, six on its march loop. */
const BARRACKS_SLOTS: Slot[] = [
  ...[-5.5, -1.45, 2.6].flatMap((z) => [-2.3, 2.3].map((x) => ({ x, z, h: 0, fits: 4.5 }))),
  ...[-9.5, 6.6].flatMap((z) => [-4.4, 0, 4.4].map((x) => ({ x, z, h: 0, fits: 4.5, band: true }))),
];
/** The march: round the parade square (a rounded rectangle). */
const MARCH = { x0: -6.6, x1: 6.6, z0: -9.5, z1: 6.6, r: 2.4 };

/** Vehicle depot (48 × 40): six in the forecourt facing the road, six in the bays at the back. */
const DEPOT_SLOTS: Slot[] = [
  ...[-21, -16.6, -12.2, -7.8, -3.4, 1].map((x) => ({ x, z: -14.6, h: 0, fits: 9.5 })),
  ...[-1.1, 2.9, 6.9, 10.9, 14.9, 18.9].map((x) => ({ x, z: 15.8, h: 0, fits: 9.5, back: true })),
];
/** The test pad's loop under the gantry crane at the back. */
const PAD = { x0: -17.5, x1: -10.5, z0: 14, z1: 17.6, r: 1.8 };

/** Airfield (200 × 80): five big stands on the apron, three helicopter pads, eight drone spots. */
const AIRFIELD_SLOTS: Slot[] = [
  ...[-86, -61, -36, -11, 14].map((x) => ({ x, z: 2.5, h: Math.PI, fits: 28 })),
  ...[60, 82, 38].map((x) => ({ x, z: 2, h: Math.PI, fits: 16 })),
  ...[-5, -1, 3, 7].flatMap((z) => [92, 96].map((x) => ({ x, z, h: Math.PI, fits: 4 }))),
];
/** The runway's centre line (local z) and the taxiway's. */
const RUNWAY_Z = 31;
const TAXI_Z = 18.5;

/** Assign slots to a base's units in id order; null for a unit with no room (indoors, out of sight). */
function assignSlots(
  units: { id: number; kind: UnitKind }[],
  slots: Slot[],
  prefer: (k: UnitKind, s: Slot) => number,
): (Slot | null)[] {
  const used = new Set<number>();
  return units.map((u) => {
    const len = Math.max(UNIT.get(u.kind)?.size[0] ?? 4, UNIT.get(u.kind)?.size[1] ?? 4);
    let best = -1;
    let bestScore = Infinity;
    slots.forEach((s, i) => {
      if (used.has(i) || s.fits < len) return;
      const score = prefer(u.kind, s) * 1000 + i;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best < 0) return null;
    used.add(best);
    return slots[best]!;
  });
}

/** Points round a rounded rectangle (local), counter-clockwise seen from above, closed. */
function roundedRect(
  r: { x0: number; x1: number; z0: number; z1: number; r: number },
  step = 0.8,
): [number, number][] {
  const out: [number, number][] = [];
  const corners: [number, number, number][] = [
    [r.x1 - r.r, r.z0 + r.r, -Math.PI / 2],
    [r.x1 - r.r, r.z1 - r.r, 0],
    [r.x0 + r.r, r.z1 - r.r, Math.PI / 2],
    [r.x0 + r.r, r.z0 + r.r, Math.PI],
  ];
  const n = Math.max(3, Math.ceil(((Math.PI / 2) * r.r) / step));
  for (const [cx, cz, a0] of corners)
    for (let k = 0; k <= n; k++) {
      const a = a0 + (k / n) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r.r, cz + Math.sin(a) * r.r]);
    }
  out.push(out[0]!);
  return out;
}

/** A closed loop in local points as a looped route on the site's ground. */
class Loop {
  readonly route: Route;
  constructor(site: Site, pts: [number, number][], v: number) {
    this.route = new Route(pts.map(([x, z]) => site.pt(x, z, v)));
  }

  /** Where `s` metres round the loop is. */
  at(s: number) {
    const L = this.route.length;
    const d = ((s % L) + L) % L;
    // Distance to time: the speed is the same all round.
    return this.route.at((d / L) * this.route.duration);
  }
}

// ------------------------------------------------------------------ roads

/** A drive out along the roads from a point and back again (legs as in transit.ts). */
function roadPatrol(
  world: ClientWorld,
  from: { x: number; z: number },
  seed: number,
  target: number,
): RoutePoint[] | null {
  const net = world.net;
  const access = (id: number) => {
    const s = world.netState.segments.get(id);
    return !!s && ROAD_TYPES[s.type].access;
  };
  const start = net.nearestSegment(from, 40, access);
  if (!start) return null;
  const legs: { seg: number; s0: number; s1: number }[] = [];
  let seg = start.seg;
  let len = net.curve(seg).length;
  let dir = idHash(seed, 1) < 0.5 ? 1 : -1;
  let s = start.s;
  let total = 0;
  for (let step = 0; step < 12 && total < target; step++) {
    const end = dir > 0 ? len : 0;
    legs.push({ seg, s0: s, s1: end });
    total += Math.abs(end - s);
    const segment = world.netState.segments.get(seg)!;
    const node = dir > 0 ? segment.b : segment.a;
    const next = net.segmentsAt(node).filter((id) => id !== seg && access(id));
    if (!next.length) break;
    seg = next[Math.floor(idHash(seed, step + 2) * next.length)]!;
    len = net.curve(seg).length;
    const ns = world.netState.segments.get(seg)!;
    dir = ns.a === node ? 1 : -1;
    s = dir > 0 ? 0 : len;
  }
  if (total < 20) return null;
  const sample = (list: typeof legs, v: number): RoutePoint[] => {
    const out: RoutePoint[] = [];
    for (const l of list) {
      const curve = net.curve(l.seg);
      const type = world.netState.segments.get(l.seg)!.type;
      const off = ROAD_TYPES[type].width / 4;
      const d = Math.abs(l.s1 - l.s0);
      const n = Math.max(1, Math.ceil(d / 6));
      const sign = l.s1 >= l.s0 ? 1 : -1;
      for (let k = out.length ? 1 : 0; k <= n; k++) {
        const sa = l.s0 + (l.s1 - l.s0) * (k / n);
        const p = curve.pointAt(sa);
        const t = curve.tangentAt(sa);
        // Keep to the right-hand side of the road.
        const x = p.x - t.z * sign * off;
        const z = p.z + t.x * sign * off;
        out.push({ x, y: world.roadHeight(l.seg, sa, x, z) + 0.05, z, v });
      }
    }
    return out;
  };
  const out = sample(legs, 1.3);
  const back = sample(
    legs.reverse().map((l) => ({ seg: l.seg, s0: l.s1, s1: l.s0 })),
    1.3,
  );
  return [...out, ...back];
}

// ------------------------------------------------------------------ the sea

/** A loop in deep water behind a naval yard, or a run out and back; null if there's no room. */
function seaLoop(world: ClientWorld, site: Site): RoutePoint[] | null {
  const deep = (x: number, z: number) => world.heightAt(x, z) <= -4;
  const back = site.D / 2;
  for (const [d, R] of [
    [170, 110],
    [140, 90],
    [110, 70],
    [85, 50],
  ] as const) {
    const c = site.at(0, back + d);
    let ok = deep(c.x, c.z);
    for (let k = 0; k < 24 && ok; k++) {
      const a = (k / 24) * TAU;
      ok = deep(c.x + Math.cos(a) * (R + 12), c.z + Math.sin(a) * (R + 12));
    }
    if (!ok) continue;
    // Counter-clockwise from the point nearest the yard.
    const toYard = site.dir(0, -1);
    const a0 = Math.atan2(toYard.z, toYard.x);
    const pts: RoutePoint[] = [];
    for (let k = 0; k <= 36; k++) {
      const a = a0 + (k / 36) * TAU;
      pts.push({ x: c.x + Math.cos(a) * R, y: 0, z: c.z + Math.sin(a) * R, v: 1.6 });
    }
    return pts;
  }
  // Out and back along the line behind the yard, as far as the water is deep.
  let far = 0;
  for (let d = 30; d <= 400; d += 10) {
    const p = site.at(0, back + d);
    if (!deep(p.x, p.z)) break;
    far = d;
  }
  if (far < 80) return null;
  const a = site.at(0, back + 30);
  const b = site.at(0, back + far - 10);
  return [
    { x: a.x, y: 0, z: a.z, v: 1.6 },
    { x: b.x, y: 0, z: b.z, v: 1.6 },
    { x: a.x, y: 0, z: a.z, v: 1.6 },
  ];
}

/** Berths along the back of a naval yard, in the water, packed by length; whole-hull checked. */
function berths(world: ClientWorld, site: Site, units: { id: number; kind: UnitKind }[]): (Slot | null)[] {
  const out: (Slot | null)[] = [];
  const rows = [0, 0];
  for (const u of units) {
    const def = UNIT.get(u.kind)!;
    const [L, B] = def.size;
    let slot: Slot | null = null;
    for (let row = 0; row < 2 && !slot; row++) {
      for (let tries = 0; tries < 6 && !slot; tries++) {
        const x0 = -site.W / 2 + 2 + rows[row]!;
        if (x0 + L > site.W / 2 - 2) break;
        const z = site.D / 2 + 2 + B / 2 + row * 12;
        const x = x0 + L / 2;
        // The whole hull in water at least a metre deeper than its keel would need.
        let ok = true;
        for (const [px, pz] of [
          [x - L / 2, z],
          [x + L / 2, z],
          [x, z - B / 2],
          [x, z + B / 2],
          [x, z],
        ] as const) {
          const w = site.at(px, pz);
          if (world.heightAt(w.x, w.z) > -1.5) ok = false;
        }
        if (ok) slot = { x, z, h: Math.PI / 2, fits: L };
        rows[row] = rows[row]! + L + 3;
      }
    }
    out.push(slot);
  }
  return out;
}

// ------------------------------------------------------------------ poses

const parked = (site: Site, u: { id: number; kind: UnitKind }, s: Slot, y = 0.06): UnitPose => {
  const p = site.at(s.x, s.z);
  return {
    id: u.id,
    kind: u.kind,
    x: p.x,
    y: site.c.y + y,
    z: p.z,
    yaw: site.yaw + s.h,
    pitch: 0,
    bank: 0,
    turret: 0,
    barrel: 0,
    rolled: 0,
    open: 0,
    spin: 0,
    doing: 'parked',
  };
};

/** Blend from a parked pose into a moving one (w 0 → 1), turning the short way. */
function blend(a: UnitPose, b: UnitPose, w: number): UnitPose {
  if (w >= 1) return b;
  if (w <= 0) return a;
  return {
    ...b,
    x: a.x + (b.x - a.x) * w,
    y: a.y + (b.y - a.y) * w,
    z: a.z + (b.z - a.z) * w,
    yaw: a.yaw + turnTo(a.yaw, b.yaw) * w,
  };
}

/** A moving pose from a route position. */
function moving(
  u: { id: number; kind: UnitKind },
  p: ReturnType<Route['at']>,
  doing: UnitActivity,
): UnitPose {
  return {
    id: u.id,
    kind: u.kind,
    x: p.x,
    y: p.y,
    z: p.z,
    yaw: p.yaw,
    pitch: 0,
    bank: 0,
    turret: 0,
    barrel: 0,
    rolled: p.dist,
    open: 0,
    spin: 0,
    doing,
  };
}

/** Caches of routes by what they were built from (sites and the road network). */
export class PoseCache {
  private loops = new Map<string, Loop>();
  private routes = new Map<string, Route | null>();
  private slots = new Map<string, (Slot | null)[]>();

  loop(key: string, make: () => Loop): Loop {
    let l = this.loops.get(key);
    if (!l) this.loops.set(key, (l = make()));
    return l;
  }

  route(key: string, make: () => Route | null): Route | null {
    if (!this.routes.has(key)) this.routes.set(key, make());
    return this.routes.get(key)!;
  }

  slotsFor(key: string, make: () => (Slot | null)[]): (Slot | null)[] {
    let s = this.slots.get(key);
    if (!s) this.slots.set(key, (s = make()));
    return s;
  }

  /** Drop everything (the roads or the forces changed); cheap to build again. */
  clear(): void {
    this.loops.clear();
    this.routes.clear();
    this.slots.clear();
  }

  get size(): number {
    return this.loops.size + this.routes.size + this.slots.size;
  }
}

function barracksPoses(
  site: Site,
  units: { id: number; kind: UnitKind }[],
  tick: number,
  lim: UnitLimits,
  cache: PoseCache,
  out: UnitPose[],
): void {
  const key = site.key();
  const slots = cache.slotsFor(`${key}|slots|${units.map((u) => u.id).join(',')}`, () =>
    assignSlots(units, BARRACKS_SLOTS, () => 0),
  );
  const period = 720;
  const length = 360;
  const off = Math.floor(idHash(site.c.id, 7) * period);
  const phase = (((tick + off) % period) + period) % period;
  const drilling = phase < length && lim.drill > 0;
  if (!drilling) {
    units.forEach((u, i) => slots[i] && out.push(parked(site, u, slots[i]!)));
    return;
  }
  // Who marches: everyone standing on the loop, then squads from the middle in turn.
  const round = Math.floor((tick + off) / period);
  const band = units.map((_, i) => i).filter((i) => slots[i]?.band);
  const middle = units.map((_, i) => i).filter((i) => slots[i] && !slots[i]!.band);
  const turnOrder = middle.map((_, k) => middle[(k + round) % middle.length]!);
  const marchers = [...band, ...turnOrder].slice(0, Math.min(lim.drill, 12));
  const loop = cache.loop(`${key}|march`, () => new Loop(site, roundedRect(MARCH), 0.4));
  const L = loop.route.length;
  const spacing = L / Math.max(marchers.length, 8);
  const start = tick - phase;
  const w = Math.min(smooth(phase / 24), smooth((length - phase) / 24));
  units.forEach((u, i) => {
    const s = slots[i];
    if (!s) return;
    const m = marchers.indexOf(i);
    if (m < 0) {
      // Squads on the loop who aren't marching wait indoors until the drill is over.
      if (!s.band) out.push(parked(site, u, s));
      return;
    }
    const p = loop.at(m * spacing + 0.4 * (tick - start));
    const pose = moving(u, p, 'drill');
    // A marching bounce.
    pose.y += 0.07 * Math.abs(Math.sin((p.dist / 0.9) * Math.PI));
    out.push(blend(parked(site, u, s), pose, w));
  });
}

function depotPoses(
  world: ClientWorld,
  site: Site,
  units: { id: number; kind: UnitKind }[],
  tick: number,
  lim: UnitLimits,
  cache: PoseCache,
  out: UnitPose[],
): void {
  const key = site.key();
  const tanky = (k: UnitKind) => k === 'tank' || k === 'heavytank';
  const slots = cache.slotsFor(`${key}|slots|${units.map((u) => `${u.id}${u.kind}`).join(',')}`, () =>
    // Tanks take the bays by the test pad first; the others the forecourt by the road.
    assignSlots(units, DEPOT_SLOTS, (k, s) => (tanky(k) === !!s.back ? 0 : 1)),
  );
  // Drills: one or two tanks from the back bays circle the test pad.
  const period = 900;
  const length = 420;
  const off = Math.floor(idHash(site.c.id, 11) * period);
  const phase = (((tick + off) % period) + period) % period;
  const padCap = Math.min(2, Math.ceil(lim.drill / 4));
  // The ones nearest the pad, so nobody drives through a parked tank on the way.
  const backTanks = units
    .map((_, i) => i)
    .filter((i) => slots[i]?.back && tanky(units[i]!.kind))
    .sort((a, b) => slots[a]!.x - slots[b]!.x);
  const drillers = phase < length && padCap > 0 ? backTanks.slice(0, padCap) : [];
  const pad = cache.loop(`${key}|pad`, () => new Loop(site, roundedRect(PAD), 0.8));
  const w = Math.min(smooth(phase / 30), smooth((length - phase) / 30));
  // Patrols: vehicles from the forecourt drive a loop on the roads near the depot.
  let patrolling = 0;
  units.forEach((u, i) => {
    const s = slots[i];
    if (!s) return;
    const home = parked(site, u, s);
    const m = drillers.indexOf(i);
    if (m >= 0) {
      const p = pad.at((m * pad.route.length) / 2 + 0.8 * phase);
      const pose = moving(u, p, 'drill');
      pose.turret = 0.6 * Math.sin(tick * 0.03 + u.id);
      pose.open = 1;
      out.push(blend(home, pose, w));
      return;
    }
    if (!s.back && patrolling < lim.patrol) {
      const route = cache.route(`${key}|patrol|${u.id}|${s.x}|${world.roadsVersion}`, () => {
        // Out of the forecourt straight to the road, along the roads and back, reversing in.
        const front = -site.D / 2;
        const road = roadPatrol(world, site.at(s.x, front - 6), u.id, 360 + idHash(u.id, 3) * 300);
        if (!road) return null;
        const exit = [site.pt(s.x, s.z, 0.6), site.pt(s.x, front + 1, 0.9)];
        const entry = [site.pt(s.x, front + 1, 0.6), site.pt(s.x, s.z, 0.6)];
        return new Route([...exit, ...road, ...entry]);
      });
      if (route) {
        const P = 1440;
        const t = (((tick + Math.floor(idHash(u.id, 5) * P)) % P) + P) % P;
        if (t < route.duration) {
          patrolling++;
          const p = route.at(t);
          const pose = moving(u, p, 'patrol');
          pose.turret = 0.4 * Math.sin(tick * 0.02 + u.id);
          // Leave facing the road; come home and turn round in the slot.
          const settle = smooth((route.duration - t) / 12);
          if (route.duration - t < 12) pose.yaw = home.yaw + turnTo(home.yaw, p.yaw) * settle;
          out.push(pose);
          return;
        }
      }
    }
    out.push(home);
  });
}

function airfieldPoses(
  site: Site,
  units: { id: number; kind: UnitKind }[],
  tick: number,
  lim: UnitLimits,
  cache: PoseCache,
  out: UnitPose[],
): void {
  const key = site.key();
  const slots = cache.slotsFor(`${key}|slots|${units.map((u) => `${u.id}${u.kind}`).join(',')}`, () =>
    assignSlots(units, AIRFIELD_SLOTS, (k, s) => {
      if (k === 'drone') return s.fits <= 4 ? 0 : s.fits <= 16 ? 1 : 2;
      if (k === 'helicopter') return s.fits === 16 ? 0 : 1;
      return s.fits >= 28 ? 0 : 1;
    }),
  );
  let planes = 0;
  let rotors = 0;
  units.forEach((u, i) => {
    const s = slots[i];
    if (!s) return;
    const home = parked(site, u, s);
    const plane = u.kind === 'fighter' || u.kind === 'bomber';
    const cap = lim.fly;
    if (plane ? planes >= cap : rotors >= cap) return void out.push(home);
    const slow = u.kind === 'bomber' ? 0.75 : 1;
    const route = cache.route(`${key}|fly|${u.id}|${s.x}|${s.z}`, () =>
      plane
        ? new Route(circuit(site, s, slow, idHash(u.id, 9)))
        : new Route(hover(site, s, u.kind === 'drone', idHash(u.id, 9))),
    )!;
    const P = plane ? (u.kind === 'bomber' ? 2000 : 1500) : 1100;
    const t = (((tick + Math.floor(idHash(u.id, 4) * P)) % P) + P) % P;
    if (t >= route.duration) return void out.push(home);
    if (plane) planes++;
    else rotors++;
    const p = route.at(t);
    const pose = moving(u, p, 'flying');
    const airborne = p.y - site.c.y > 1.5;
    pose.pitch = plane ? p.pitch : airborne ? -0.08 : 0;
    pose.bank = Math.max(-0.6, Math.min(0.6, -p.turn * (plane ? 40 : 25)));
    // Rotors and propellers spin up before moving off and down after stopping.
    const run = Math.min(smooth(t / 10), smooth((route.duration - t) / 10));
    pose.spin = run > 0 ? ((tick * 0.9 * (plane ? 1.4 : 1)) % TAU) * Math.min(1, run * 4) : 0;
    // Taxiing back: turn into the stand at the end.
    if (route.duration - t < 14)
      pose.yaw = home.yaw + turnTo(home.yaw, p.yaw) * smooth((route.duration - t) / 14);
    if (t < 8) pose.yaw = home.yaw + turnTo(home.yaw, p.yaw) * smooth(t / 8);
    out.push(pose);
  });
}

/**
 * A plane's sortie (world points): taxi to the runway's end, roll and climb away along it, a wide
 * circuit out over the town in front, the approach, touchdown, and taxi back to its stand.
 */
function circuit(site: Site, s: Slot, slow: number, r: number): RoutePoint[] {
  const pts: RoutePoint[] = [];
  const add = (lx: number, lz: number, y: number, v: number) => pts.push(site.pt(lx, lz, v * slow, y));
  const taxi = 1.6;
  const end = -site.W / 2 + 8;
  const R = 420 + r * 200;
  const alt = 140 + r * 80;
  const far = 520 + r * 200;
  add(s.x, s.z, 0.06, taxi);
  add(s.x, TAXI_Z, 0.06, taxi);
  add(end, TAXI_Z, 0.06, taxi);
  add(end, RUNWAY_Z, 0.06, 3);
  add(end + 60, RUNWAY_Z, 0.06, 7);
  add(end + 160, RUNWAY_Z, 1, 11);
  add(far * 0.6, RUNWAY_Z, alt * 0.5, 14);
  add(far, RUNWAY_Z, alt, 16);
  // A wide turn out over the front (−z), along the downwind leg, and round again to line up.
  const turn = (cx: number, a0: number, a1: number) => {
    for (let k = 1; k <= 14; k++) {
      const a = a0 + ((a1 - a0) * k) / 14;
      add(cx + Math.cos(a) * R, RUNWAY_Z - R + Math.sin(a) * R, alt, 16);
    }
  };
  turn(far, Math.PI / 2, -Math.PI / 2);
  turn(-far, -Math.PI / 2, -Math.PI * 1.5);
  // Final approach down to the threshold, then the roll-out.
  add(-far * 0.5, RUNWAY_Z, alt * 0.45, 12);
  add(end + 10, RUNWAY_Z, 0.06, 7);
  add(end + 130, RUNWAY_Z, 0.06, 2.5);
  // Off the runway onto the taxiway, along it to the stand.
  add(end + 140, TAXI_Z, 0.06, taxi);
  add(s.x, TAXI_Z, 0.06, taxi);
  add(s.x, s.z, 0.06, taxi);
  return pts;
}

/** A helicopter's or drone's flight: lift off, out over the town in front, circle low, and back. */
function hover(site: Site, s: Slot, drone: boolean, r: number): RoutePoint[] {
  const pts: RoutePoint[] = [];
  const v = drone ? 4 : 6;
  const alt = drone ? 28 + r * 12 : 45 + r * 20;
  const ahead = (drone ? 160 : 300) + r * 120;
  const R = (drone ? 80 : 150) + r * 90;
  const add = (lx: number, lz: number, y: number, speed: number) => pts.push(site.pt(lx, lz, speed, y));
  add(s.x, s.z, 0.06, 0.9);
  add(s.x, s.z, alt, v);
  // Circle twice round a point in front of the airfield, over the town.
  const cz = -site.D / 2 - ahead;
  const a0 = Math.atan2(s.z - cz, s.x);
  for (let k = 0; k <= 48; k++) {
    const a = a0 + (k / 24) * TAU;
    add(Math.cos(a) * R, cz + Math.sin(a) * R, alt, v);
  }
  add(s.x, s.z, alt, 0.9);
  add(s.x, s.z, 0.06, 0.9);
  return pts;
}

function navalPoses(
  world: ClientWorld,
  site: Site,
  units: { id: number; kind: UnitKind }[],
  tick: number,
  lim: UnitLimits,
  cache: PoseCache,
  out: UnitPose[],
): void {
  const key = `${site.key()}|${world.terrainVersion}`;
  const slots = cache.slotsFor(`${key}|berths|${units.map((u) => `${u.id}${u.kind}`).join(',')}`, () =>
    berths(world, site, units),
  );
  const loop = cache.route(`${key}|sea`, () => {
    const pts = seaLoop(world, site);
    return pts ? new Route(pts) : null;
  });
  let sailing = 0;
  units.forEach((u, i) => {
    const s = slots[i];
    if (!s) return;
    const home = parked(site, u, s, 0);
    home.y = 0;
    if (!loop || sailing >= lim.patrol) return void out.push(home);
    // Out from the berth to the loop, round it twice, and back.
    const route = cache.route(`${key}|sail|${u.id}|${s.x}|${s.z}`, () => {
      const off = site.at(s.x, site.D / 2 + 30 + (s.z - site.D / 2));
      const berth = site.at(s.x, s.z);
      const lp = loop.pts;
      const pts: RoutePoint[] = [
        { x: berth.x, y: 0, z: berth.z, v: 0.6 },
        { x: off.x, y: 0, z: off.z, v: 1.4 },
      ];
      for (let lap = 0; lap < 2; lap++) for (const p of lp) pts.push({ ...p });
      pts.push({ x: off.x, y: 0, z: off.z, v: 0.6 }, { x: berth.x, y: 0, z: berth.z, v: 0.6 });
      return new Route(pts);
    })!;
    const P = 1800;
    const t = (((tick + Math.floor(idHash(u.id, 6) * P)) % P) + P) % P;
    if (t >= route.duration) return void out.push(home);
    sailing++;
    const p = route.at(t);
    const pose = moving(u, p, 'sailing');
    pose.y = 0;
    pose.turret = 0.5 * Math.sin(tick * 0.02 + u.id);
    pose.spin = (tick * 0.7) % TAU;
    // A gentle roll in the swell, and the submarine dives for the middle of its patrol.
    pose.bank = 0.03 * Math.sin(tick * 0.15 + u.id);
    if (u.kind === 'submarine')
      pose.y = -2.2 * Math.min(smooth((t - 60) / 40), smooth((route.duration - 60 - t) / 40));
    const settle = 16;
    if (t < settle) pose.yaw = home.yaw + turnTo(home.yaw, p.yaw) * smooth(t / settle);
    if (route.duration - t < settle)
      pose.yaw = home.yaw + turnTo(home.yaw, p.yaw) * smooth((route.duration - t) / settle);
    out.push(pose);
  });
}

/**
 * Every unit's pose at `tick` (the display clock), by its base. Units whose base has gone, or who
 * have no room on its site (more than its slots) are left out: they're indoors.
 */
export function unitPoses(world: ClientWorld, tick: number, lim: UnitLimits, cache: PoseCache): UnitPose[] {
  const out: UnitPose[] = [];
  const forces = world.forces;
  if (!forces?.units.length) return out;
  const byBase = new Map<number, { id: number; kind: UnitKind }[]>();
  for (const u of forces.units) {
    let l = byBase.get(u.base);
    if (!l) byBase.set(u.base, (l = []));
    l.push(u);
  }
  for (const [base, list] of [...byBase].sort((a, b) => a[0] - b[0])) {
    const c = world.civics.get(base);
    if (!c) continue;
    list.sort((a, b) => a.id - b.id);
    const site = new Site(c);
    switch (c.def) {
      case 'barracks':
        barracksPoses(site, list, tick, lim, cache, out);
        break;
      case 'vehicledepot':
        depotPoses(world, site, list, tick, lim, cache, out);
        break;
      case 'airfield':
        airfieldPoses(site, list, tick, lim, cache, out);
        break;
      case 'navalyard':
        navalPoses(world, site, list, tick, lim, cache, out);
        break;
      default:
        break;
    }
  }
  return out;
}

/** The slot tables (tests: parked units stay on their base's site). */
export const UNIT_SLOTS = { barracks: BARRACKS_SLOTS, vehicledepot: DEPOT_SLOTS, airfield: AIRFIELD_SLOTS };
