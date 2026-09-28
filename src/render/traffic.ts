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
import { ROAD_TYPES } from '../data/roads';
import { VEHICLE_SPEED_SCALE } from '../data/civic';
import { hourOfDay } from '../sim/time';
import { congestedSeconds } from '../sim/systems/traffic';
import type { TripSample } from '../sim/systems/traffic';
import type { Leg } from '../sim/systems/graph';
import { ModelBuilder, type ModelData } from './assets/builder';

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
  '#2b2d31',
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
    if (trip.purpose === 'work') back = hour >= 13 || hour < 4 ? Math.random() < 0.85 : Math.random() < 0.15;
    else if (trip.purpose === 'shop') back = Math.random() < 0.5;
    const freight = trip.purpose !== 'work' && trip.purpose !== 'shop' && trip.purpose !== 'event';
    const r = Math.random();
    const model: ModelName = freight ? 'truck' : r < 0.55 ? 'sedan' : r < 0.85 ? 'hatch' : 'van';
    const paint = freight ? TRUCK_PAINT : PAINT;
    const legs = back ? (trip.back ?? reversed(trip.legs)) : trip.legs;
    const first = this.world.netState.segments.get(legs[0]!.seg)!;
    const lanes = ROAD_TYPES[first.type].lanes;
    this.cars.push({
      id: this.nextId++,
      trip,
      legs,
      leg: 0,
      t: 0,
      model,
      color: paint[Math.floor(Math.random() * paint.length)]!,
      lane: lanes >= 4 && Math.random() < 0.5 ? 1 : 0,
      x: 0,
      y: 0,
      z: 0,
      heading: 0,
    });
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
    const alive: Car[] = [];
    const counts = new Map<ModelName, number>();
    for (const c of this.cars) {
      let budget = dt;
      let done = false;
      while (budget > 0 && !done) {
        const l = c.legs[c.leg]!;
        if (!this.world.netState.segments.has(l.seg)) {
          done = true;
          break;
        }
        const len = Math.abs(l.s1 - l.s0);
        const v = this.speed(l.seg, share);
        const left = len - c.t;
        const need = left / Math.max(0.01, v);
        if (need > budget) {
          c.t += budget * v;
          budget = 0;
        } else {
          budget -= need;
          c.leg++;
          c.t = 0;
          if (c.leg >= c.legs.length) done = true;
        }
      }
      if (done) continue;
      const l = c.legs[c.leg]!;
      const curve = net.curve(l.seg);
      const dir = l.s1 >= l.s0 ? 1 : -1;
      const sArc = Math.max(0, Math.min(curve.length, l.s0 + dir * c.t));
      const pt = curve.pointAt(sArc);
      const tan = curve.tangentAt(sArc);
      const hx = tan.x * dir;
      const hz = tan.z * dir;
      const lane = c.lane ? 5.4 : 2.2;
      c.x = pt.x - hz * lane;
      c.z = pt.z + hx * lane;
      c.y = this.heightOn(l.seg, sArc, c.x, c.z) + 0.2;
      c.heading = Math.atan2(hz, hx);
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
    (lg.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (lg.getAttribute('color') as BufferAttribute).needsUpdate = true;
    lg.setDrawRange(0, nl);
    for (const [name, mesh] of this.meshes) {
      mesh.count = counts.get(name) ?? 0;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
