/**
 * The battle simulation (M35): a force against a city's defences and units, on a frozen picture
 * of the city (layout.ts). Fixed steps of BATTLE.dt game seconds; land units drive the roads by
 * shortest-path fields and cover the last stretch over open ground, aircraft fly straight and
 * circle, boats follow the water; everything that can fire picks a target every few steps and
 * shoots on its reload. Deterministic: units in a fixed order, the battle's own dice, DMath.
 * Events (damage, wrecks, craters, units out) are what the defending city applies. DESIGN §3.29.
 */
import { BATTLE, BATTLE_MOD, INTERCEPT, SUPER } from '../../data/battle';
import { MILITARY_DEFS, UNIT, type UnitDomain, type UnitKind, type UnitStats } from '../../data/war';
import { DMath } from '../dmath';
import { Rng } from '../rng';
import { Mixer } from '../sync';
import { MinHeap } from '../systems/graph';
import { isObjective } from './layout';
import {
  CELL_SHALLOW,
  CELL_STEEP,
  DOMAIN_BIT,
  E,
  S,
  TAG,
  type BattleEvent,
  type BattleFrame,
  type BattleInput,
  type BattleResult,
  type BattleMods,
  type BattleShot,
  type BattleUnitIn,
  type Outcome,
  type Side,
} from './types';

const enum Mode {
  Wait,
  Road,
  Free,
  Air,
  Sea,
  Hold,
  Out,
  Left,
}

const enum Plan {
  Attack,
  Exit,
  Intercept,
  Guard,
}

interface Unit {
  i: number;
  id: number;
  kind: UnitKind;
  side: Side;
  domain: UnitDomain;
  max: number;
  hp: number;
  attack: number;
  reload: number;
  range: number;
  speed: number;
  armour: number;
  siege: number;
  targets: number;
  x: number;
  z: number;
  y: number;
  yaw: number;
  aim: number;
  mode: Mode;
  plan: Plan;
  /** On a road: which edge, how far along (m), and which way (1 towards b, −1 towards a). */
  edge: number;
  at: number;
  dir: 1 | -1;
  /** Heading for (free, air), and the road point it left (to come back to). */
  gx: number;
  gz: number;
  backEdge: number;
  backAt: number;
  /** A boat's way (points), and where along it. */
  path: number[] | null;
  pi: number;
  /** The structure it's after (attackers), −1 for none. */
  objective: number;
  /** What it's shooting: a unit's index, or −(structure + 1); NONE for nothing. */
  target: number;
  cool: number;
  wait: number;
  firing: boolean;
  /** Infantry riding in trucks until close. */
  riding: boolean;
  /** Base structure (defenders), −1. */
  base: number;
  /** Share of hits that miss it (version 3: research's evasion; 0 without). */
  evade: number;
  /** Version 3, attackers only: the robot's stamp, the units the fortress carries, the whale's dives. */
  stomp: UnitStats['stomp'] | null;
  carries: UnitStats['carries'] | null;
  dives: UnitStats['dives'] | null;
  /** A carrier: the step it launches the next unit it carries. */
  launchAt: number;
  /** A carried unit: its carrier's index (−1 for none), and whether it's still aboard. */
  carrier: number;
  aboard: boolean;
  /** A diving unit: under water (nothing can target it), and the step it surfaced. */
  dived: boolean;
  surfaced: number;
}

const NONE = 0x7fffffff;

/** The interceptor battery's reach (m), chance when fully manned, and cooldown (steps), M37. */
const INTERCEPTOR = MILITARY_DEFS.find((d) => d.military.intercept)?.military.intercept ?? {
  range: 450,
  chance: 0.5,
  cooldown: 8,
};

/** A research modifier, within the bounds a battle accepts (`fallback` when it's absent or no number). */
function modOf(
  m: { hp?: number; attack?: number; armour?: number; evade?: number } | undefined,
  k: 'hp' | 'attack' | 'armour' | 'evade',
  fallback: number,
): number {
  const v = m?.[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  const [lo, hi] = BATTLE_MOD[k];
  return Math.min(hi, Math.max(lo, v));
}

const TAU = Math.PI * 2;
const TRUCK_SPEED = 11;

/** A path field: for every node, the distance to a goal on a road and the edge to take there. */
interface Field {
  dist: Float64Array;
  /** Edge to leave the node by; −2: the goal's own edge meets here; −1: no way. */
  next: Int32Array;
  edge: number;
  at: number;
}

export class Battle {
  readonly input: BattleInput;
  step = 0;
  outcome: Outcome | null = null;
  readonly units: Unit[] = [];
  /** Structures' health, starting strength, and what's happened to them (1 damaged, 2 destroyed). */
  readonly hp: Float64Array;
  readonly maxHp: Float64Array;
  readonly state: Uint8Array;
  private gunCool: Float64Array;
  private gunTarget: Int32Array;
  readonly objectives: number[] = [];
  private rng: Rng;
  private events: BattleEvent[] = [];
  private allEvents = { damaged: [] as number[], destroyed: [] as number[], craters: [] as number[] };
  private cratered = new Set<number>();
  private collapsed = 0;
  private wrecked = 0;
  private withdrawing = false;
  private fields = new Map<string, Field>();
  private adj: { e: number; o: number; len: number }[][] = [];
  private sgrid = new Map<number, number[]>();
  private shots: BattleShot[] = [];
  private seaPaths = new Map<number, number[] | null>();
  private startStrength = 0;
  private nStruct: number;
  /** Version 3: interceptor batteries (structure indices, in order) and the step each is ready again. */
  private interceptors: number[] = [];
  private interceptReady: Int32Array;
  /** Version 3: the dome's pool, at the start and left (0 for no dome). */
  private domeMax: number;
  private domeLeft: number;
  /** Version 3: the force brought a superweapon (what only such a battle does is gated on it). */
  private superweapon = false;

  constructor(input: BattleInput) {
    this.input = input;
    const L = input.layout;
    this.rng = Rng.fromSeed(`${input.seed}:battle`);
    this.nStruct = L.structs.length / S.stride;
    const n = this.nStruct;
    this.hp = new Float64Array(n);
    this.maxHp = new Float64Array(n);
    this.state = new Uint8Array(n);
    this.gunCool = new Float64Array(n);
    this.gunTarget = new Int32Array(n).fill(NONE);
    this.interceptReady = new Int32Array(n);
    this.domeMax = typeof L.dome === 'number' && L.dome > 0 ? L.dome : 0;
    this.domeLeft = this.domeMax;
    for (let k = 0; k < n; k++) {
      this.hp[k] = L.structs[k * S.stride + S.hp]!;
      this.maxHp[k] = this.hp[k]!;
      if ((L.structs[k * S.stride + S.tags]! & TAG.intercept) !== 0) this.interceptors.push(k);
      const x = this.sx(k);
      const z = this.sz(k);
      const key = this.cellKey(x, z);
      let l = this.sgrid.get(key);
      if (!l) this.sgrid.set(key, (l = []));
      l.push(k);
    }
    // Roads: adjacency in edge order.
    const nn = L.nodes.length / 2;
    for (let k = 0; k < nn; k++) this.adj.push([]);
    for (let e = 0; e < L.edges.length / E.stride; e++) {
      const a = L.edges[e * E.stride + E.a]!;
      const b = L.edges[e * E.stride + E.b]!;
      const len = L.edges[e * E.stride + E.len]!;
      this.adj[a]!.push({ e, o: b, len });
      this.adj[b]!.push({ e, o: a, len });
    }
    // Objectives: the target kind's structures, nearest the way in first.
    const entry = this.entry(input.attacker.route);
    const objs: { k: number; d: number }[] = [];
    for (let k = 0; k < n; k++) {
      const tags = L.structs[k * S.stride + S.tags]!;
      if (!isObjective(tags, input.attacker.target)) continue;
      objs.push({ k, d: DMath.hypot(this.sx(k) - entry.x, this.sz(k) - entry.z) });
    }
    objs.sort((a, b) => a.d - b.d || a.k - b.k);
    for (const o of objs.slice(0, BATTLE.maxTargets)) this.objectives.push(o.k);
    // Units: the attackers in their order, then those they carry in (version 3), then the defenders.
    const force = input.attacker.units;
    force
      .filter((u) => u.from === undefined)
      .slice(0, BATTLE.maxAttackers)
      .forEach((u, k) => this.addAttacker(u, k));
    for (const u of force.filter((x) => x.from !== undefined).slice(0, SUPER.maxCarried)) this.addCarried(u);
    for (const u of L.defenders.slice(0, BATTLE.maxDefenders)) this.addDefender(u);
    for (const u of this.units) if (u.side === 0) this.startStrength += this.strength(u);
    this.superweapon = this.units.some((u) => u.side === 0 && !!UNIT.get(u.kind)?.super);
    if (!this.objectives.length) this.finish('withdrew');
  }

  // --- Layout access. ---
  private sx(k: number): number {
    return this.input.layout.structs[k * S.stride + S.x]!;
  }
  private sz(k: number): number {
    return this.input.layout.structs[k * S.stride + S.z]!;
  }
  private sv(k: number, f: number): number {
    return this.input.layout.structs[k * S.stride + f]!;
  }
  private cellKey(x: number, z: number): number {
    return Math.floor(x / BATTLE.unitCell) * 4096 + Math.floor(z / BATTLE.unitCell);
  }
  private edgeLen(e: number): number {
    return this.input.layout.edges[e * E.stride + E.len]!;
  }
  private entry(route: string): { x: number; z: number; edge: number; at: number } {
    const L = this.input.layout;
    const want = route === 'sea' ? 'sea' : route === 'air' ? 'air' : route === 'rail' ? 'rail' : 'highway';
    return (
      L.entries.find((e) => e.route === want) ??
      L.entries.find((e) => e.route === 'highway') ?? { x: 0, z: 0, edge: -1, at: 0 }
    );
  }

  /** A point along a road. */
  private roadPoint(e: number, at: number): { x: number; z: number; yaw: number } {
    const L = this.input.layout;
    const p0 = L.edges[e * E.stride + E.pt]!;
    const n = L.edges[e * E.stride + E.n]!;
    const len = L.edges[e * E.stride + E.len]!;
    const t = len > 0 ? Math.min(1, Math.max(0, at / len)) * (n - 1) : 0;
    const k = Math.min(n - 2, Math.floor(t));
    const f = t - k;
    const ax = L.pts[(p0 + k) * 2]!;
    const az = L.pts[(p0 + k) * 2 + 1]!;
    const bx = L.pts[(p0 + k + 1) * 2]!;
    const bz = L.pts[(p0 + k + 1) * 2 + 1]!;
    return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, yaw: DMath.atan2(-(bx - ax), -(bz - az)) };
  }

  private cellAt(x: number, z: number): number {
    const g = this.input.layout.grid;
    const i = Math.min(g.nx - 1, Math.max(0, Math.floor((x - g.x0) / BATTLE.cell)));
    const j = Math.min(g.nz - 1, Math.max(0, Math.floor((z - g.z0) / BATTLE.cell)));
    return g.cells[j * g.nx + i]!;
  }

  private makeUnit(u: BattleUnitIn, side: Side): Unit | null {
    const def = UNIT.get(u.kind);
    if (!def) return null;
    let targets = 0;
    for (const d of def.stats.targets) targets |= DOMAIN_BIT[d];
    // Research's modifiers for its side and domain (version 3): none, and every number is as it was.
    const mods: BattleMods | undefined = side === 0 ? this.input.attacker.mods : this.input.layout.mods;
    const mod = mods?.[def.domain];
    const max = def.stats.hp * modOf(mod, 'hp', 1);
    const armour = def.stats.armour;
    const attacker = side === 0;
    const unit: Unit = {
      i: this.units.length,
      id: u.id,
      kind: u.kind,
      side,
      domain: def.domain,
      max,
      hp: max * Math.max(0.05, Math.min(1, u.hp)),
      attack: def.stats.attack * modOf(mod, 'attack', 1),
      reload: def.stats.reload,
      range: def.stats.range,
      speed: def.stats.speed,
      armour:
        mod?.armour === undefined
          ? armour
          : Math.min(Math.max(armour, BATTLE_MOD.armourMax), armour + modOf(mod, 'armour', 0)),
      siege: def.stats.siege,
      targets,
      x: u.x,
      z: u.z,
      y: 0,
      yaw: 0,
      aim: 0,
      mode: Mode.Wait,
      plan: side === 0 ? Plan.Attack : Plan.Intercept,
      edge: -1,
      at: 0,
      dir: 1,
      gx: u.x,
      gz: u.z,
      backEdge: -1,
      backAt: 0,
      path: null,
      pi: 0,
      objective: -1,
      target: NONE,
      cool: 0,
      wait: 0,
      firing: false,
      riding: false,
      base: u.base,
      evade: modOf(mod, 'evade', 0),
      stomp: (attacker && def.stats.stomp) || null,
      carries: (attacker && def.stats.carries) || null,
      dives: (attacker && def.stats.dives) || null,
      launchAt: 0,
      carrier: -1,
      aboard: false,
      dived: attacker && !!def.stats.dives,
      surfaced: -1,
    };
    this.units.push(unit);
    return unit;
  }

  private addAttacker(u: BattleUnitIn, k: number): void {
    const unit = this.makeUnit(u, 0);
    if (!unit) return;
    const route = this.input.attacker.route;
    const entry = this.entry(unit.domain === 'air' ? 'air' : unit.domain === 'sea' ? 'sea' : route);
    unit.x = entry.x;
    unit.z = entry.z;
    unit.wait = k * 4;
    unit.objective = this.objectives[0] ?? -1;
    if (unit.domain === 'land') {
      unit.edge = entry.edge;
      unit.at = entry.at;
      unit.dir = entry.at > 0 ? -1 : 1;
      const trucks = this.input.attacker.units.filter((x) => x.kind === 'transport').length;
      const squads = this.input.attacker.units.filter((x) => x.kind === 'infantry').length;
      unit.riding = u.kind === 'infantry' && trucks * BATTLE.squadsPerTruck >= squads && trucks > 0;
    }
    if (unit.domain === 'air') unit.y = BATTLE.flyHeight;
  }

  /**
   * A unit carried in (version 3: the sky fortress's drones): aboard its carrier until the carrier
   * nears its objective, then launched one at a time. One whose carrier isn't in the force, or is
   * full, or carries another kind, doesn't come.
   */
  private addCarried(u: BattleUnitIn): void {
    const carrier = this.units.find((c) => c.side === 0 && c.id === u.from && c.carries && c.carrier < 0);
    if (!carrier?.carries || carrier.carries.kind !== u.kind) return;
    let aboard = 0;
    for (const o of this.units) if (o.carrier === carrier.i) aboard++;
    if (aboard >= carrier.carries.n) return;
    const unit = this.makeUnit(u, 0);
    if (!unit) return;
    unit.carrier = carrier.i;
    unit.aboard = true;
    // Bomb drones: what a carrier brings hits buildings with the carrier's siege, not its own.
    if (carrier.carries.siege !== undefined) unit.siege = carrier.carries.siege;
    unit.x = carrier.x;
    unit.z = carrier.z;
    unit.objective = carrier.objective;
    if (unit.domain === 'air') unit.y = BATTLE.flyHeight;
  }

  private addDefender(u: BattleUnitIn): void {
    const unit = this.makeUnit(u, 1);
    if (!unit) return;
    const L = this.input.layout;
    const ready = L.readiness;
    unit.wait = Math.round(BATTLE.reaction * (1 - ready)) + (unit.i % 8) * 2;
    if (unit.domain === 'land' && unit.base >= 0) {
      const e = this.sv(unit.base, S.edge);
      if (e >= 0) {
        unit.edge = e;
        unit.at = this.sv(unit.base, S.at);
      }
    }
    if (unit.domain === 'sea') unit.plan = Plan.Guard;
  }

  private strength(u: Unit): number {
    return (UNIT.get(u.kind)?.strength ?? 1) * (u.hp / u.max);
  }

  private alive(u: Unit): boolean {
    return u.mode !== Mode.Out && u.mode !== Mode.Left;
  }

  // --- Path fields. ---

  private field(key: string, goals: { edge: number; at: number }[], cache = true): Field {
    let f = cache ? this.fields.get(key) : undefined;
    if (f) return f;
    const nn = this.adj.length;
    const dist = new Float64Array(nn).fill(Infinity);
    const next = new Int32Array(nn).fill(-1);
    const heap = new MinHeap();
    const L = this.input.layout;
    for (const g of goals) {
      if (g.edge < 0) continue;
      const a = L.edges[g.edge * E.stride + E.a]!;
      const b = L.edges[g.edge * E.stride + E.b]!;
      const len = this.edgeLen(g.edge);
      for (const [n, d] of [
        [a, g.at],
        [b, len - g.at],
      ] as const) {
        if (d < dist[n]!) {
          dist[n] = d;
          next[n] = -2;
          heap.push(d, n);
        }
      }
    }
    const out = [0];
    while (heap.size) {
      const n = heap.pop(out);
      const d = out[0]!;
      if (d > dist[n]!) continue;
      for (const { e, o, len } of this.adj[n]!) {
        const nd = d + len;
        if (nd < dist[o]!) {
          dist[o] = nd;
          next[o] = e;
          heap.push(nd, o);
        }
      }
    }
    f = { dist, next, edge: goals[0]?.edge ?? -1, at: goals[0]?.at ?? 0 };
    if (cache && goals.length === 1) this.fields.set(key, f);
    return f;
  }

  private objectiveField(k: number): Field {
    return this.field(`s${k}`, [{ edge: this.sv(k, S.edge), at: this.sv(k, S.at) }]);
  }

  private exitField(): Field {
    const e = this.entry(this.input.attacker.route);
    return this.field('exit', [{ edge: e.edge, at: e.at }]);
  }

  private intercept: Field | null = null;
  private interceptAt = -1;

  /** Where the defenders head: the attackers' land units on the roads, found again now and then. */
  private interceptField(): Field | null {
    if (this.intercept && this.step - this.interceptAt < BATTLE.interceptEvery) return this.intercept;
    const goals: { edge: number; at: number }[] = [];
    for (const u of this.units) {
      if (u.side !== 0 || !this.alive(u) || u.domain !== 'land' || u.mode === Mode.Wait) continue;
      if (u.mode === Mode.Road) goals.push({ edge: u.edge, at: u.at });
      else if (u.backEdge >= 0) goals.push({ edge: u.backEdge, at: u.backAt });
    }
    this.interceptAt = this.step;
    // Found again each time: never from the cache, wherever the attackers were last time.
    this.intercept = goals.length ? this.field('intercept', goals, false) : null;
    return this.intercept;
  }

  // --- Moving. ---

  /** Drive along the roads by a field: returns true on reaching its goal point. */
  private drive(u: Unit, f: Field, dist: number): boolean {
    let left = dist;
    for (let guard = 0; guard < 64 && left > 0; guard++) {
      if (u.edge < 0) return true;
      const len = this.edgeLen(u.edge);
      if (u.edge === f.edge) {
        // On the goal's own road: straight to the point.
        const d = f.at - u.at;
        if (Math.abs(d) <= left) {
          u.at = f.at;
          this.placeOnRoad(u, d >= 0 ? 1 : -1);
          return true;
        }
        u.dir = d > 0 ? 1 : -1;
        u.at += u.dir * left;
        this.placeOnRoad(u, u.dir);
        return false;
      }
      const end = u.dir > 0 ? len : 0;
      const toEnd = Math.abs(end - u.at);
      if (toEnd > left) {
        u.at += u.dir * left;
        this.placeOnRoad(u, u.dir);
        return false;
      }
      left -= toEnd;
      const L = this.input.layout;
      const node = L.edges[u.edge * E.stride + (u.dir > 0 ? E.b : E.a)]!;
      const nx = f.next[node]!;
      if (nx === -1) {
        u.at = end;
        this.placeOnRoad(u, u.dir);
        return true;
      }
      const ne = nx === -2 ? f.edge : nx;
      const a = L.edges[ne * E.stride + E.a]!;
      u.edge = ne;
      u.at = node === a ? 0 : this.edgeLen(ne);
      u.dir = node === a ? 1 : -1;
    }
    this.placeOnRoad(u, u.dir);
    return false;
  }

  private placeOnRoad(u: Unit, dir: number): void {
    const p = this.roadPoint(u.edge, u.at);
    u.x = p.x;
    u.z = p.z;
    u.yaw = dir > 0 ? p.yaw : p.yaw + Math.PI;
  }

  /** Over open ground towards (gx, gz): returns true on arrival (or when water stops it). */
  private walk(u: Unit, dist: number, stopAt = 0): boolean {
    const dx = u.gx - u.x;
    const dz = u.gz - u.z;
    const d = DMath.hypot(dx, dz);
    if (d <= stopAt + 0.01) return true;
    const cell = this.cellAt(u.x + (dx / d) * 6, u.z + (dz / d) * 6);
    if (u.domain === 'land' && cell >= CELL_SHALLOW) return true;
    const step = Math.min(d - stopAt, dist * (cell === CELL_STEEP ? 0.5 : 1));
    u.x += (dx / d) * step;
    u.z += (dz / d) * step;
    u.yaw = DMath.atan2(-dx, -dz);
    return d - step <= stopAt + 0.01;
  }

  /** A boat's way over water (cells) from where it is to near `to`, or null. */
  private seaPath(u: Unit, key: number, tx: number, tz: number): number[] | null {
    if (this.seaPaths.has(key)) return this.seaPaths.get(key)!;
    const g = this.input.layout.grid;
    const c = BATTLE.cell;
    const ci = (x: number) => Math.min(g.nx - 1, Math.max(0, Math.floor((x - g.x0) / c)));
    const cj = (z: number) => Math.min(g.nz - 1, Math.max(0, Math.floor((z - g.z0) / c)));
    const start = cj(u.z) * g.nx + ci(u.x);
    const prev = new Int32Array(g.nx * g.nz).fill(-1);
    prev[start] = start;
    const queue = [start];
    let best = start;
    let bestD = Infinity;
    for (let q = 0; q < queue.length; q++) {
      const cur = queue[q]!;
      const x = (cur % g.nx) * c + c / 2;
      const z = Math.floor(cur / g.nx) * c + c / 2;
      const d = DMath.hypot(x - tx, z - tz);
      if (d < bestD) {
        bestD = d;
        best = cur;
      }
      const i = cur % g.nx;
      const j = Math.floor(cur / g.nx);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= g.nx || nj >= g.nz) continue;
        const nIdx = nj * g.nx + ni;
        if (prev[nIdx]! >= 0 || g.cells[nIdx]! < CELL_SHALLOW) continue;
        prev[nIdx] = cur;
        queue.push(nIdx);
      }
    }
    const cells: number[] = [];
    for (let cur = best; ; cur = prev[cur]!) {
      cells.push(cur);
      if (cur === start) break;
    }
    cells.reverse();
    const path: number[] = [];
    for (const cur of cells) path.push((cur % g.nx) * c + c / 2, Math.floor(cur / g.nx) * c + c / 2);
    const out = path.length >= 2 ? path : null;
    this.seaPaths.set(key, out);
    return out;
  }

  private move(u: Unit): void {
    if (u.aboard) return; // carried in, not launched yet
    if (u.wait > 0) {
      u.wait--;
      return;
    }
    if (u.mode === Mode.Wait) this.setOff(u);
    // Standing to fire; the robot walks on as it fires.
    if (u.firing && u.domain === 'land' && !u.stomp) return;
    const dt = BATTLE.dt;
    const speed = u.riding ? TRUCK_SPEED : u.speed;
    // The robot strides over open ground as fast as it walks a road.
    const offRoad = u.stomp ? 1 : BATTLE.offRoad;
    if (u.domain === 'air') {
      this.fly(u, speed * dt);
      if (u.carries) this.launch(u);
      return;
    }
    if (u.domain === 'sea') {
      this.sail(u, speed * dt);
      if (u.dives) this.surfaceOrDive(u);
      return;
    }
    if (u.mode === Mode.Hold) {
      // Defenders on the move again when the attackers have moved on.
      if (u.side === 1 && u.plan === Plan.Intercept && u.edge >= 0 && this.step % 10 === u.i % 10)
        u.mode = Mode.Road;
      else return;
    }
    if (u.plan === Plan.Exit) {
      if (u.mode === Mode.Free) {
        u.gx = u.backEdge >= 0 ? this.roadPoint(u.backEdge, u.backAt).x : u.x;
        u.gz = u.backEdge >= 0 ? this.roadPoint(u.backEdge, u.backAt).z : u.z;
        if (this.walk(u, speed * dt * offRoad)) {
          if (u.backEdge < 0) return this.leave(u);
          u.mode = Mode.Road;
          u.edge = u.backEdge;
          u.at = u.backAt;
        }
        return;
      }
      if (this.drive(u, this.exitField(), speed * dt)) this.leave(u);
      return;
    }
    if (u.side === 0) {
      const k = u.objective;
      if (k < 0) return;
      if (u.mode === Mode.Road) {
        if (u.stomp && DMath.hypot(this.sx(k) - u.x, this.sz(k) - u.z) <= SUPER.free) {
          // The robot leaves the road near its objective and walks straight there, stamping.
          u.mode = Mode.Free;
          u.backEdge = u.edge;
          u.backAt = u.at;
        } else {
          if (this.drive(u, this.objectiveField(k), speed * dt)) {
            u.mode = Mode.Free;
            u.backEdge = u.edge;
            u.backAt = u.at;
          }
          return;
        }
      }
      if (u.mode === Mode.Free) {
        u.gx = this.sx(k);
        u.gz = this.sz(k);
        // The robot walks right up to it; anything else stops within its reach.
        const reach = u.stomp
          ? this.sv(k, S.rIn)
          : u.range > 0
            ? this.sv(k, S.rIn) + u.range * 0.8
            : BATTLE.dismount;
        if (this.walk(u, speed * dt * offRoad, reach)) u.mode = Mode.Hold;
      }
      return;
    }
    // Defenders: towards the attackers by road, holding when there are none to find.
    if (u.mode === Mode.Road) {
      const f = this.interceptField();
      if (!f) return;
      if (this.drive(u, f, speed * dt)) u.mode = Mode.Hold;
    }
  }

  /** A unit leaves its starting place: on the road, in the air, at sea. */
  private setOff(u: Unit): void {
    if (u.domain === 'air') u.mode = Mode.Air;
    else if (u.domain === 'sea') u.mode = Mode.Sea;
    else if (u.edge >= 0) {
      u.mode = Mode.Road;
      this.placeOnRoad(u, u.dir);
    } else u.mode = Mode.Hold;
  }

  private fly(u: Unit, dist: number): void {
    let cx: number;
    let cz: number;
    if (u.plan === Plan.Exit) {
      const e = this.entry('air');
      u.gx = e.x;
      u.gz = e.z;
      if (this.walk(u, dist)) this.leave(u);
      return;
    }
    if (u.side === 0) {
      if (u.objective < 0) return;
      cx = this.sx(u.objective);
      cz = this.sz(u.objective);
    } else {
      // Defending aircraft go for the nearest attacker they can hit.
      let best = Infinity;
      cx = u.x;
      cz = u.z;
      for (const o of this.units) {
        if (o.side === u.side || !this.alive(o) || o.mode === Mode.Wait || o.dived) continue;
        if ((u.targets & DOMAIN_BIT[o.domain]) === 0) continue;
        const d = DMath.hypot(o.x - u.x, o.z - u.z);
        if (d < best) {
          best = d;
          cx = o.x;
          cz = o.z;
        }
      }
    }
    const dx = u.x - cx;
    const dz = u.z - cz;
    const d = DMath.hypot(dx, dz);
    const r = Math.min(BATTLE.circle, Math.max(40, u.range * 0.7));
    if (d > r + 1) {
      u.gx = cx;
      u.gz = cz;
      this.walk(u, dist, r);
      return;
    }
    // Circle the target.
    const a = DMath.atan2(dz, dx) + dist / Math.max(r, 1);
    u.x = cx + DMath.cos(a) * r;
    u.z = cz + DMath.sin(a) * r;
    u.yaw = DMath.atan2(-(-DMath.sin(a)), -DMath.cos(a));
  }

  private sail(u: Unit, dist: number): void {
    if (u.plan === Plan.Guard) return;
    if (!u.path) {
      const goal =
        u.plan === Plan.Exit
          ? this.entry('sea')
          : u.objective >= 0
            ? { x: this.sx(u.objective), z: this.sz(u.objective) }
            : null;
      if (!goal) return;
      u.path = this.seaPath(u, u.plan === Plan.Exit ? -1 : u.objective, goal.x, goal.z);
      u.pi = 0;
      if (!u.path) {
        if (u.plan === Plan.Exit) this.leave(u);
        return;
      }
    }
    let left = dist;
    while (left > 0 && u.pi < u.path.length / 2) {
      u.gx = u.path[u.pi * 2]!;
      u.gz = u.path[u.pi * 2 + 1]!;
      const d = DMath.hypot(u.gx - u.x, u.gz - u.z);
      if (d <= left) {
        u.x = u.gx;
        u.z = u.gz;
        left -= d;
        u.pi++;
      } else {
        u.x += ((u.gx - u.x) / d) * left;
        u.z += ((u.gz - u.z) / d) * left;
        u.yaw = DMath.atan2(-(u.gx - u.x), -(u.gz - u.z));
        left = 0;
      }
    }
    if (u.pi >= u.path.length / 2 && u.plan === Plan.Exit) this.leave(u);
  }

  private leave(u: Unit): void {
    u.mode = Mode.Left;
    u.target = NONE;
    u.aboard = false;
    this.events.push({ k: 'left', side: u.side, unit: u.id });
    if (u.carries) this.dropCarried(u);
  }

  // --- Superweapons (version 3). ---

  /** The fortress near its objective launches what it carries, one every `carries.every` steps. */
  private launch(c: Unit): void {
    if (c.plan !== Plan.Attack || c.objective < 0 || this.step < c.launchAt) return;
    if (DMath.hypot(this.sx(c.objective) - c.x, this.sz(c.objective) - c.z) > SUPER.launch) return;
    const d = this.units.find((o) => o.carrier === c.i && o.aboard);
    if (!d) return;
    d.aboard = false;
    d.x = c.x;
    d.z = c.z;
    d.y = c.y;
    d.yaw = c.yaw;
    d.objective = c.objective;
    c.launchAt = this.step + c.carries!.every;
  }

  /** A carrier knocked out or gone: what it still carries goes home with it. */
  private dropCarried(c: Unit): void {
    for (const o of this.units) if (o.carrier === c.i && o.aboard && this.alive(o)) this.leave(o);
  }

  /**
   * The whale swims under water (nothing can target it), surfaces within `dives.surface` m of its
   * objective's shore (its way's end), fires for `dives.fire` steps at most, then dives and leaves.
   */
  private surfaceOrDive(u: Unit): void {
    const d = u.dives!;
    if (u.plan !== Plan.Attack) {
      u.dived = true;
      return;
    }
    if (u.dived) {
      const p = u.path;
      if (!p || u.surfaced >= 0) return;
      if (DMath.hypot(u.x - p[p.length - 2]!, u.z - p[p.length - 1]!) <= d.surface) {
        u.dived = false;
        u.surfaced = this.step;
      }
      return;
    }
    if (this.step - u.surfaced >= d.fire) {
      u.dived = true;
      u.plan = Plan.Exit;
      u.path = null;
      u.target = NONE;
      u.firing = false;
    }
  }

  /** The robot stamps on what stands within its reach. No dice: the battle's caps still bound it. */
  private stompAt(u: Unit): void {
    const st = u.stomp!;
    for (const k of this.nearStructs(u.x, u.z, st.radius + 64)) {
      if (this.state[k] === 2) continue;
      if (DMath.hypot(this.sx(k) - u.x, this.sz(k) - u.z) - this.sv(k, S.rIn) > st.radius) continue;
      this.damage(k, st.damage);
    }
  }

  /** The first interceptor battery (lowest index) in reach of a spot, manned and ready, or −1. */
  private interceptorFor(x: number, z: number): number {
    for (const k of this.interceptors) {
      if (this.state[k] === 2 || this.interceptReady[k]! > this.step || this.sv(k, S.manned) <= 0) continue;
      if (DMath.hypot(this.sx(k) - x, this.sz(k) - z) <= INTERCEPTOR.range) return k;
    }
    return -1;
  }

  // --- Fighting. ---

  private canHit(shooterTargets: number, u: Unit): boolean {
    return (shooterTargets & DOMAIN_BIT[u.domain]) !== 0;
  }

  private choose(u: Unit): void {
    let best = NONE;
    let bestScore = Infinity;
    const consider = (target: number, rank: number, d: number) => {
      const score = rank * 100_000 + d;
      if (score < bestScore || (score === bestScore && target < best)) {
        bestScore = score;
        best = target;
      }
    };
    for (const o of this.units) {
      if (o.side === u.side || !this.alive(o) || o.mode === Mode.Wait || o.dived) continue;
      if (!this.canHit(u.targets, o)) continue;
      const d = DMath.hypot(o.x - u.x, o.z - u.z);
      if (d > u.range) continue;
      consider(o.i, this.canHit(o.targets, u) && o.attack > 0 ? 0 : 3, d);
    }
    if (u.side === 0 && u.siege > 0 && (u.targets & DOMAIN_BIT.land) !== 0) {
      // Defences, then the objectives.
      for (const k of this.nearStructs(u.x, u.z, u.range + 40)) {
        if (this.state[k] === 2) continue;
        const gun = this.sv(k, S.gun) > 0 && this.sv(k, S.manned) > 0;
        const obj = this.objectives.includes(k);
        if (!gun && !obj) continue;
        const d = Math.max(0, DMath.hypot(this.sx(k) - u.x, this.sz(k) - u.z) - this.sv(k, S.rIn));
        if (d > u.range) continue;
        // Bomb drones (version 3: what a carrier brings) dive on the objectives first, then the guns.
        consider(-(k + 1), u.carrier >= 0 ? (obj ? 1 : 2) : gun ? 1 : 2, d);
      }
    }
    u.target = best;
  }

  private nearStructs(x: number, z: number, r: number): number[] {
    const out: number[] = [];
    const c = BATTLE.unitCell;
    const i0 = Math.floor((x - r) / c);
    const i1 = Math.floor((x + r) / c);
    const j0 = Math.floor((z - r) / c);
    const j1 = Math.floor((z + r) / c);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const l = this.sgrid.get(i * 4096 + j);
        if (l) for (const k of l) out.push(k);
      }
    return out.sort((a, b) => a - b);
  }

  private accuracy(side: Side, domain: UnitDomain | 'defence'): number {
    const ready = side === 0 ? this.input.attacker.readiness : this.input.layout.readiness;
    return BATTLE.accuracy[domain] * (0.7 + 0.3 * Math.min(1, Math.max(0, ready)));
  }

  /** Cover a land unit gets from a standing building between it and the shooter. */
  private cover(t: Unit, fx: number, fz: number): number {
    if (t.domain !== 'land') return 0;
    const vx = fx - t.x;
    const vz = fz - t.z;
    for (const k of this.nearStructs(t.x, t.z, BATTLE.coverRange + 30)) {
      if (this.state[k] === 2) continue;
      const dx = this.sx(k) - t.x;
      const dz = this.sz(k) - t.z;
      const d = DMath.hypot(dx, dz) - this.sv(k, S.rIn);
      if (d > BATTLE.coverRange) continue;
      if (dx * vx + dz * vz > 0) return t.kind === 'infantry' ? BATTLE.cover.infantry : BATTLE.cover.vehicle;
    }
    return 0;
  }

  private fire(u: Unit): void {
    u.cool = Math.max(0, u.cool - BATTLE.dt);
    if (u.target === NONE || u.attack <= 0) {
      u.firing = false;
      return;
    }
    let tx: number;
    let tz: number;
    let ty = 0;
    if (u.target >= 0) {
      const t = this.units[u.target]!;
      if (!this.alive(t) || t.dived || DMath.hypot(t.x - u.x, t.z - u.z) > u.range) {
        u.target = NONE;
        u.firing = false;
        return;
      }
      tx = t.x;
      tz = t.z;
      ty = t.y;
    } else {
      const k = -u.target - 1;
      if (this.state[k] === 2) {
        u.target = NONE;
        u.firing = false;
        return;
      }
      tx = this.sx(k);
      tz = this.sz(k);
    }
    u.firing = true;
    u.aim = DMath.atan2(-(tx - u.x), -(tz - u.z)) - u.yaw;
    if (u.cool > 0) return;
    u.cool = u.reload;
    // Interceptors (version 3): a shell fired from afar (to the building's wall, as reach is
    // measured), or a bomb, aimed at a building may be stopped in the air by a battery in reach of
    // it. One draw, only when there's a battery to make it.
    if (
      u.target < 0 &&
      u.siege >= 1 &&
      this.interceptors.length &&
      (u.domain === 'air' ||
        DMath.hypot(tx - u.x, tz - u.z) - this.sv(-u.target - 1, S.rIn) >= INTERCEPT.from)
    ) {
      const ic = this.interceptorFor(tx, tz);
      if (ic >= 0) {
        this.interceptReady[ic] = this.step + INTERCEPTOR.cooldown;
        if (this.rng.next() < INTERCEPTOR.chance * this.sv(ic, S.manned)) {
          this.shot(u.x, u.z, u.y + 2, tx + (u.x - tx) * 0.15, tz + (u.z - tz) * 0.15, 40, 3, false);
          return;
        }
      }
    }
    // Evasion (version 3) folds into the one draw: no evasion, the same chance as ever.
    const evade = u.target >= 0 ? this.units[u.target]!.evade : 0;
    const hit = this.rng.next() < this.accuracy(u.side, u.domain) * (1 - evade);
    this.shot(u.x, u.z, u.y + 2, tx, tz, ty, u.siege >= 1 ? 1 : 0, hit);
    if (u.target >= 0) {
      if (hit) this.hurt(this.units[u.target]!, u.attack, u.x, u.z);
    } else {
      const k = -u.target - 1;
      if (hit) this.damage(k, u.attack * u.siege);
      else if (u.siege >= 1) this.stray(tx, tz, u.attack * u.siege * 0.5);
      if (u.siege >= 1) this.maybeCrater(tx, tz);
    }
  }

  private shot(
    x0: number,
    z0: number,
    y0: number,
    x1: number,
    z1: number,
    y1: number,
    kind: 0 | 1 | 2 | 3,
    hit: boolean,
  ) {
    if (this.shots.length < 64) this.shots.push({ x0, z0, y0, x1, z1, y1, kind, hit });
  }

  private hurt(t: Unit, attack: number, fx: number, fz: number): void {
    const dmg = attack * (1 - t.armour) * (1 - this.cover(t, fx, fz));
    t.hp -= dmg;
    if (t.hp > 0) return;
    t.hp = 0;
    t.mode = Mode.Out;
    t.target = NONE;
    t.firing = false;
    this.events.push({ k: 'out', side: t.side, unit: t.id, kind: t.kind });
    if (t.carries) this.dropCarried(t);
  }

  /** A shot that missed lands nearby: what stands within a few metres takes some of it. */
  private stray(x: number, z: number, dmg: number): void {
    const a = this.rng.next() * TAU;
    const r = 6 + this.rng.next() * 14;
    const px = x + DMath.cos(a) * r;
    const pz = z + DMath.sin(a) * r;
    let best = -1;
    let bestD = Infinity;
    for (const k of this.nearStructs(px, pz, 40)) {
      if (this.state[k] === 2) continue;
      const d = DMath.hypot(this.sx(k) - px, this.sz(k) - pz) - this.sv(k, S.rIn);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0 && bestD <= 4) this.damage(best, dmg);
  }

  private maybeCrater(x: number, z: number): void {
    if (this.rng.next() >= BATTLE.craterChance) return;
    const L = this.input.layout;
    let best = -1;
    let bestD: number = BATTLE.craterRange;
    for (const k of this.nearStructs(x, z, 60)) {
      const e = this.sv(k, S.edge);
      if (e < 0) continue;
      const p = this.roadPoint(e, this.sv(k, S.at));
      const d = DMath.hypot(p.x - x, p.z - z);
      if (d < bestD) {
        bestD = d;
        best = L.edges[e * E.stride + E.seg]!;
      }
    }
    if (best < 0 || this.cratered.has(best)) return;
    this.cratered.add(best);
    this.allEvents.craters.push(best);
    this.events.push({ k: 'crater', seg: best });
  }

  private damage(k: number, dmg: number): void {
    if (this.state[k] === 2 || dmg <= 0) return;
    // A raised dome (version 3) takes every blow on a building while its pool lasts, then pops.
    if (this.domeLeft > 0) {
      const soak = Math.min(this.domeLeft, dmg);
      this.domeLeft -= soak;
      dmg -= soak;
      if (this.domeLeft <= 0) {
        this.domeLeft = 0;
        this.events.push({ k: 'dome', left: 0 });
      }
      if (dmg <= 0) return;
    }
    const tags = this.sv(k, S.tags);
    const civic = (tags & TAG.civic) !== 0;
    const capped = civic
      ? this.wrecked >= this.input.caps.maxWreck
      : this.collapsed >= this.input.caps.maxCollapse;
    let hp = this.hp[k]! - dmg;
    if (hp <= 0 && capped) hp = 1;
    this.hp[k] = Math.max(0, hp);
    if (this.state[k] === 0 && this.hp[k]! < this.maxHp[k]! * BATTLE.fireBelow) {
      this.state[k] = 1;
      this.allEvents.damaged.push(this.sv(k, S.id));
      this.events.push({ k: 'damaged', s: this.sv(k, S.id) });
    }
    if (this.hp[k]! <= 0) {
      this.state[k] = 2;
      if (civic) this.wrecked++;
      else this.collapsed++;
      this.allEvents.destroyed.push(this.sv(k, S.id));
      this.events.push({ k: 'destroyed', s: this.sv(k, S.id) });
      for (const u of this.units) if (u.target === -(k + 1)) u.target = NONE;
    }
  }

  /** Defences fire at what comes in range. */
  private guns(): void {
    const L = this.input.layout;
    const n = this.nStruct;
    for (let k = 0; k < n; k++) {
      const gun = L.structs[k * S.stride + S.gun]!;
      if (!gun || this.state[k] === 2) continue;
      const manned = L.structs[k * S.stride + S.manned]!;
      if (manned <= 0) continue;
      this.gunCool[k] = Math.max(0, this.gunCool[k]! - BATTLE.dt);
      const range = L.structs[k * S.stride + S.range]!;
      const against = L.structs[k * S.stride + S.against]!;
      const x = this.sx(k);
      const z = this.sz(k);
      if ((this.step + k) % BATTLE.targetEvery === 0) {
        let best = NONE;
        let bestD = Infinity;
        for (const o of this.units) {
          if (o.side !== 0 || !this.alive(o) || o.mode === Mode.Wait || o.dived) continue;
          if ((against & DOMAIN_BIT[o.domain]) === 0) continue;
          const d = DMath.hypot(o.x - x, o.z - z);
          if (d <= range && d < bestD) {
            bestD = d;
            best = o.i;
          }
        }
        this.gunTarget[k] = best;
      }
      const t = this.gunTarget[k]!;
      if (t === NONE || this.gunCool[k]! > 0) continue;
      const o = this.units[t]!;
      if (!this.alive(o) || o.dived || DMath.hypot(o.x - x, o.z - z) > range) {
        this.gunTarget[k] = NONE;
        continue;
      }
      this.gunCool[k] = BATTLE.defence.reload;
      const hit = this.rng.next() < this.accuracy(1, 'defence') * (1 - o.evade);
      this.shot(x, z, 4, o.x, o.z, o.y, o.domain === 'air' ? 2 : 0, hit);
      if (hit) this.hurt(o, gun * BATTLE.defence.attackPer * manned, x, z);
    }
  }

  // --- The battle's course. ---

  private finish(outcome: Outcome): void {
    if (this.outcome) return;
    this.outcome = outcome;
    this.events.push({ k: 'end', outcome });
  }

  private orders(): void {
    for (const o of this.input.orders)
      if (o.step === this.step && o.side === 0 && o.kind === 'withdraw') this.withdraw();
  }

  private withdraw(): void {
    if (this.withdrawing) return;
    this.withdrawing = true;
    for (const u of this.units) {
      if (u.side !== 0 || !this.alive(u)) continue;
      u.plan = Plan.Exit;
      u.target = NONE;
      u.firing = false;
      u.path = null;
      if (u.dives) u.dived = true;
      if (u.mode === Mode.Wait) this.leave(u);
      else if (u.mode === Mode.Hold)
        u.mode = u.domain === 'land' ? (u.backEdge >= 0 ? Mode.Free : Mode.Road) : u.mode;
    }
  }

  /** Every attacker moves on to the next objective still standing. */
  private retarget(): void {
    const next = this.objectives.find((k) => this.state[k] !== 2);
    if (next === undefined) return;
    for (const u of this.units) {
      if (u.side !== 0 || !this.alive(u) || u.plan !== Plan.Attack) continue;
      if (u.objective >= 0 && this.state[u.objective] !== 2) continue;
      u.objective = next;
      u.path = null;
      if (u.domain === 'land' && (u.mode === Mode.Free || u.mode === Mode.Hold) && u.backEdge >= 0) {
        // Back to the road it left, then on.
        u.mode = Mode.Road;
        u.edge = u.backEdge;
        u.at = u.backAt;
        u.backEdge = -1;
      }
    }
  }

  private check(): void {
    if (this.outcome) return;
    let alive = 0;
    let strength = 0;
    for (const u of this.units)
      if (u.side === 0 && this.alive(u)) {
        alive++;
        strength += this.strength(u);
      }
    const down = this.objectives.filter((k) => this.state[k] === 2).length;
    if (!alive) {
      const anyLeft = this.units.some((u) => u.side === 0 && u.mode === Mode.Left);
      this.finish(down > 0 ? 'raided' : anyLeft ? 'withdrew' : 'repelled');
      return;
    }
    if (this.withdrawing) {
      if (this.step >= BATTLE.maxSteps + 1_200)
        for (const u of this.units) if (u.side === 0 && this.alive(u)) this.leave(u);
      return;
    }
    const lost = this.startStrength > 0 ? 1 - strength / this.startStrength : 1;
    if (
      down === this.objectives.length ||
      lost >= BATTLE.withdraw[this.input.attacker.stance] ||
      this.step >= BATTLE.maxSteps ||
      (this.superweapon && this.capsHold())
    )
      this.withdraw();
    else if (down > 0) this.retarget();
  }

  /**
   * Version 3, a superweapon's battle: every objective still standing is one the battle's caps won't
   * let fall (city buildings once `maxWreck` are wrecked, the rest once `maxCollapse` have
   * collapsed), so the force has done all it may and pulls out rather than wait for the clock.
   */
  private capsHold(): boolean {
    const caps = this.input.caps;
    for (const k of this.objectives) {
      if (this.state[k] === 2) continue;
      const civic = (this.sv(k, S.tags) & TAG.civic) !== 0;
      if (civic ? this.wrecked < caps.maxWreck : this.collapsed < caps.maxCollapse) return false;
    }
    return true;
  }

  /** One step of BATTLE.dt game seconds. */
  stepOnce(): void {
    if (this.outcome) return;
    // Events this step alone (not those the caller hasn't drained yet): a battle plays the same
    // whether it's ticked, run straight through or re-run after a load.
    const before = this.events.length;
    this.orders();
    for (const u of this.units) {
      // Units pulling out don't stop to shoot back.
      if (!this.alive(u) || u.plan === Plan.Exit) continue;
      // A dived whale (version 3) neither aims nor fires.
      if (u.dived) continue;
      if (u.wait <= 0 && u.mode !== Mode.Wait && (u.i + this.step) % BATTLE.targetEvery === 0) this.choose(u);
      if (u.mode !== Mode.Wait) this.fire(u);
      // The robot (version 3) stamps once it has left the road.
      if (
        u.stomp &&
        (u.mode === Mode.Free || u.mode === Mode.Hold) &&
        (this.step + u.i) % u.stomp.every === 0
      )
        this.stompAt(u);
    }
    this.guns();
    for (const u of this.units) if (this.alive(u)) this.move(u);
    this.step++;
    if (this.step % 10 === 0 || this.events.length > before) this.check();
  }

  /** Steps for one city tick; returns the events since the last call. */
  tick(): BattleEvent[] {
    this.shots = [];
    for (let k = 0; k < BATTLE.stepsPerTick && !this.outcome; k++) this.stepOnce();
    return this.drain();
  }

  drain(): BattleEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Play on to the end (or `max` steps more). */
  runToEnd(max = BATTLE.maxSteps + 2_000): this {
    for (let k = 0; k < max && !this.outcome; k++) this.stepOnce();
    if (!this.outcome) this.finish('withdrew');
    return this;
  }

  static run(input: BattleInput): Battle {
    return new Battle(input).runToEnd();
  }

  hash(): string {
    const m = new Mixer();
    m.int(this.step);
    for (const w of this.rng.getState()) m.int(w);
    for (const u of this.units) {
      m.int(u.mode);
      m.num(u.hp);
      m.num(u.x);
      m.num(u.z);
      if (u.dives) m.int(u.dived ? 1 : 0);
    }
    for (let k = 0; k < this.nStruct; k++) m.num(this.hp[k]!);
    if (this.domeMax > 0) m.num(this.domeLeft);
    return m.hex();
  }

  result(): BattleResult {
    return {
      outcome: this.outcome ?? 'withdrew',
      steps: this.step,
      hash: this.hash(),
      units: this.units.map((u) => ({
        side: u.side,
        id: u.id,
        kind: u.kind,
        hp: Math.round((u.hp / u.max) * 1000) / 1000,
        out: u.mode === Mode.Out,
      })),
      damaged: [...this.allEvents.damaged],
      destroyed: [...this.allEvents.destroyed],
      craters: [...this.allEvents.craters],
      objectives: {
        aimed: this.objectives.length,
        down: this.objectives.filter((k) => this.state[k] === 2).length,
      },
    };
  }

  /** The battle as drawn this tick. */
  frame(): BattleFrame {
    const sides = [0, 1].map((side) => {
      const list = this.units.filter((u) => u.side === side);
      const f = side === 0 ? this.input.attacker : this.input.defender;
      return {
        name: f.name,
        color: f.color,
        alive: list.filter((u) => this.alive(u)).length,
        total: list.length,
      };
    });
    return {
      id: this.input.id,
      step: this.step,
      maxSteps: BATTLE.maxSteps,
      units: this.units
        .filter((u) => u.mode !== Mode.Wait && u.mode !== Mode.Left)
        .map((u) => ({
          id: u.id,
          kind: u.kind,
          side: u.side,
          x: Math.round(u.x * 10) / 10,
          z: Math.round(u.z * 10) / 10,
          y: u.y,
          yaw: Math.round(u.yaw * 1000) / 1000,
          aim: Math.round(u.aim * 1000) / 1000,
          hp: Math.round((u.hp / u.max) * 100) / 100,
          state: u.mode === Mode.Out ? 2 : u.dived ? 3 : u.firing || u.mode === Mode.Hold ? 1 : 0,
        })),
      shots: [...this.shots],
      sides,
      targets: this.objectives.map((k) => ({
        id: this.sv(k, S.id),
        x: this.sx(k),
        z: this.sz(k),
        hp: Math.round((this.hp[k]! / this.maxHp[k]!) * 100) / 100,
      })),
      outcome: this.outcome,
      ...(this.domeMax > 0 ? { dome: Math.round((this.domeLeft / this.domeMax) * 1000) / 1000 } : {}),
    };
  }
}
