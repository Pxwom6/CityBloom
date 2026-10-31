/**
 * A battle that comes from outside the city (a friend's page, a replay, a kept record), checked
 * before the city's sim takes it (M35): every array the right shape and size, every number
 * finite and in range, every index pointing inside its array, so a malformed or crafted battle is
 * turned away without touching the city, and a well-formed one can't run for ever or fill memory.
 */
import { BATTLE, BATTLE_MOD, ROUTES, SUPER, type BattleTarget, type Stance } from '../../data/battle';
import { MAP_SIZE } from '../../data/world';
import { UNIT } from '../../data/war';
import {
  BATTLE_V2,
  BATTLE_V4,
  BATTLE_VERSION,
  CELL_DEEP,
  E,
  S,
  TAGS_V2,
  TAGS_V3,
  type BattleHelper,
  type BattleInput,
} from './types';

/**
 * How big a battle's picture of a city may be, and what a version 4 battle may be given while it
 * runs: `orders` is the most a version 2 or 3 battle may carry (M35's withdrawals), `ordersV4` a
 * version 4 one, `perStep` the orders one side may give at one step, `orderUnits` the units one order
 * may name, `helpers` the allied forces (each at most the attackers' unit cap), `owner` the highest
 * helper owner.
 */
export const BATTLE_LIMITS = {
  nodes: 30_000,
  edges: 40_000,
  points: 600_000,
  entries: 8,
  orders: 64,
  text: 60,
  ordersV4: 256,
  perStep: 4,
  orderUnits: 256,
  helpers: 3,
  owner: 255,
} as const;

/** The orders a version 4 battle takes, and the sides each may come from (withdraw: the attackers'). */
const ORDER_SIDES: Record<string, readonly number[]> = {
  withdraw: [0],
  focus: [0, 1],
  guard: [1],
  hold: [0, 1],
  free: [0, 1],
};

const TARGETS: readonly BattleTarget[] = ['military', 'industry', 'power', 'cityhall'];
const STANCES: readonly Stance[] = ['cautious', 'bold'];
const GRID_MAX = Math.ceil(MAP_SIZE / BATTLE.cell) + 4;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v: unknown, lo: number, hi: number): v is number => num(v, lo, hi) && Number.isInteger(v);
const text = (v: unknown, max: number = BATTLE_LIMITS.text): v is string =>
  typeof v === 'string' && v.length <= max;
const numbers = (v: unknown, max: number): v is number[] =>
  Array.isArray(v) && v.length <= max && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/**
 * A unit as it goes in. Superweapons and carried units (version 3) come only with the attackers: a
 * superweapon never defends its city, and nothing carries a defender in.
 */
function unitIn(v: unknown, structs: number, v3: boolean, attacker: boolean): string | null {
  if (!isObj(v)) return 'a unit';
  if (!int(v.id, -0x7fff_ffff, 0x7fff_ffff)) return 'a unit’s id';
  const def = typeof v.kind === 'string' ? UNIT.get(v.kind as never) : undefined;
  if (!def || (def.super && !(v3 && attacker))) return 'a unit’s kind';
  if (!num(v.hp, 0, 1)) return 'a unit’s health';
  if (!num(v.x, -MAP_SIZE, 2 * MAP_SIZE) || !num(v.z, -MAP_SIZE, 2 * MAP_SIZE)) return 'a unit’s place';
  if (!int(v.base, -1, structs - 1)) return 'a unit’s base';
  if (v.from !== undefined && !(v3 && attacker && int(v.from, -0x7fff_ffff, 0x7fff_ffff)))
    return 'a unit’s carrier';
  return null;
}

/** Research's modifiers (version 3): by domain, each number within `BATTLE_MOD`'s bounds. */
function modsIn(v: unknown): boolean {
  if (!isObj(v)) return false;
  for (const [d, m] of Object.entries(v)) {
    if ((d !== 'land' && d !== 'air' && d !== 'sea') || !isObj(m)) return false;
    for (const [k, x] of Object.entries(m)) {
      if (k !== 'hp' && k !== 'attack' && k !== 'armour' && k !== 'evade') return false;
      const [lo, hi] = BATTLE_MOD[k];
      if (!num(x, lo, hi)) return false;
    }
  }
  return true;
}

/**
 * The attackers (version 3 may bring units carried in): at most `BATTLE.maxAttackers` of their own
 * and `SUPER.maxCarried` carried, each carried one of the kind its carrier carries, no more than it
 * holds, its carrier one of the force's own units.
 */
function forceIn(units: Obj[]): string | null {
  const own = units.filter((u) => u.from === undefined);
  const carried = units.filter((u) => u.from !== undefined);
  if (!own.length || own.length > BATTLE.maxAttackers || carried.length > SUPER.maxCarried)
    return 'the attackers';
  const aboard = new Map<number, number>();
  for (const u of carried) {
    const carrier = own.find((c) => c.id === u.from);
    const holds = carrier ? UNIT.get(carrier.kind as never)?.stats.carries : undefined;
    if (!holds || u.kind !== holds.kind) return 'a unit’s carrier';
    const n = (aboard.get(u.from as number) ?? 0) + 1;
    if (n > holds.n) return 'a unit’s carrier';
    aboard.set(u.from as number, n);
  }
  return null;
}

/**
 * The orders of a battle (a version 2 or 3 one carries M35's plain withdrawals only: no `units`, no
 * `target`, as it was). Version 4 takes at most `BATTLE_LIMITS.ordersV4`, `perStep` from one side at
 * a step, each of a kind its side may give, `units` as integers, and a `target` where the order has
 * one: a structure's index for `guard` and the attackers' `focus`, an attacker's id for the
 * defenders'.
 */
function ordersIn(v: unknown, v4: boolean, structs: number): string | null {
  if (!Array.isArray(v) || v.length > (v4 ? BATTLE_LIMITS.ordersV4 : BATTLE_LIMITS.orders))
    return 'the orders';
  const perStep = new Map<number, number>();
  for (const o of v) {
    if (!isObj(o) || !int(o.step, 0, v4 ? BATTLE.maxSteps + 1_200 : 0x7fff_ffff)) return 'an order';
    if (o.side !== 0 && o.side !== 1) return 'an order';
    if (!v4) {
      if (o.kind !== 'withdraw' || o.units !== undefined || o.target !== undefined) return 'an order';
      continue;
    }
    const kind = typeof o.kind === 'string' ? o.kind : '';
    // A plain withdrawal from the defenders is M35's, accepted and ignored as it was.
    const sides = ORDER_SIDES[kind];
    if (!sides || !(sides.includes(o.side) || (kind === 'withdraw' && o.units === undefined)))
      return 'an order';
    if (o.units !== undefined) {
      if (!Array.isArray(o.units) || o.units.length > BATTLE_LIMITS.orderUnits) return 'an order’s units';
      if (!o.units.every((id) => int(id, -0x7fff_ffff, 0x7fff_ffff))) return 'an order’s units';
    }
    const needs = kind === 'focus' || kind === 'guard';
    if (needs !== (o.target !== undefined)) return 'an order’s target';
    if (needs) {
      const attackerUnit = kind === 'focus' && o.side === 1;
      if (!(attackerUnit ? int(o.target, -0x7fff_ffff, 0x7fff_ffff) : int(o.target, 0, structs - 1)))
        return 'an order’s target';
    }
    const key = (o.step as number) * 2 + (o.side as number);
    const n = (perStep.get(key) ?? 0) + 1;
    if (n > BATTLE_LIMITS.perStep) return 'the orders';
    perStep.set(key, n);
  }
  return null;
}

/** Is this list of orders sound in a version 4 battle whose picture has `structs` structures? (Live battles, M39.) */
export function orderListProblem(orders: unknown, structs: number): string | null {
  return ordersIn(orders, true, structs);
}

/**
 * Allied helpers (version 4): at most `BATTLE_LIMITS.helpers`, each with its own owner (1–255), a
 * side, an arrival step within the battle, a route, research, and one to the attackers' unit cap of
 * units: no superweapons, nothing carried, none based anywhere.
 */
function helpersIn(v: unknown, structs: number): string | null {
  if (!Array.isArray(v) || v.length > BATTLE_LIMITS.helpers) return 'the helpers';
  const owners = new Set<number>();
  for (const h of v) {
    if (!isObj(h) || !int(h.owner, 1, BATTLE_LIMITS.owner) || owners.has(h.owner)) return 'a helper';
    owners.add(h.owner);
    if (!text(h.name) || !int(h.color, 0, 0xff_ffff) || (h.side !== 0 && h.side !== 1)) return 'a helper';
    if (!int(h.arrive, 0, BATTLE.maxSteps)) return 'a helper’s arrival';
    // Added while the battle ran (the step it was stamped at): never arriving before it was added.
    if (h.at !== undefined && !(int(h.at, 0, BATTLE.maxSteps) && h.at <= h.arrive))
      return 'a helper’s arrival';
    if (h.route !== undefined && !(typeof h.route === 'string' && h.route in ROUTES))
      return 'a helper’s route';
    if (h.mods !== undefined && !modsIn(h.mods)) return 'a helper’s research';
    if (!Array.isArray(h.units) || !h.units.length || h.units.length > BATTLE.maxAttackers)
      return 'a helper’s units';
    for (const u of h.units) {
      const why = unitIn(u, structs, true, false);
      if (why || (u as Obj).base !== -1) return 'a helper’s units';
    }
  }
  return null;
}

/**
 * Is this list of helpers sound for a version 4 battle with this input? A live battle checks each
 * helper the room stamps against the battle it is added to (the same on every page), the helpers it
 * has already included with it.
 */
export function helperListProblem(input: BattleInput, helpers: readonly BattleHelper[]): string | null {
  const why = helpersIn(helpers, input.layout.structs.length / S.stride);
  if (why) return why;
  return idsDiffer(
    input.attacker.units as unknown as Obj[],
    input.layout.defenders as unknown as Obj[],
    helpers as unknown as Obj[],
  )
    ? null
    : 'two units with one id';
}

/** Unit ids of a side differ (version 4: an order names units by id): the force and its helpers, the defenders and theirs. */
function idsDiffer(attackers: Obj[], defenders: Obj[], helpers: Obj[]): boolean {
  const seen = [new Set<unknown>(), new Set<unknown>()];
  const add = (side: number, us: Obj[]) => {
    for (const u of us) {
      if (seen[side]!.has(u.id)) return false;
      seen[side]!.add(u.id);
    }
    return true;
  };
  if (!add(0, attackers) || !add(1, defenders)) return false;
  for (const h of helpers) if (!add(h.side as number, h.units as Obj[])) return false;
  return true;
}

/** Why a battle can't be taken, or null when it's sound. */
export function checkBattleInput(input: unknown): string | null {
  const bad = (what: string) => `That battle could not be read (${what})`;
  if (!isObj(input)) return bad('not a battle');
  if (input.v !== BATTLE_V4 && input.v !== BATTLE_VERSION && input.v !== BATTLE_V2)
    return 'That battle was fought by another version of the game';
  // Version 3's fields come only in a version 3 battle (a version 2 one plays exactly as on M36),
  // and version 4 (orders given while it runs, helpers) has them all.
  const v3 = input.v !== BATTLE_V2;
  const v4 = input.v === BATTLE_V4;
  if (typeof input.id !== 'string' || !/^[\w:.-]{1,60}$/.test(input.id)) return bad('its name');
  if (!text(input.seed, 120)) return bad('its seed');
  if (input.scale !== 'skirmish') return bad('its scale');
  const L = input.layout;
  if (!isObj(L)) return bad('the city');
  if (
    // The picture is stamped 2 when it uses nothing of version 3, else with the battle's own version.
    (L.v !== BATTLE_V2 && L.v !== BATTLE_VERSION && L.v !== BATTLE_V4) ||
    (L.v as number) > (input.v as number) ||
    !text(L.city) ||
    !int(L.tick, 0, 0x7fff_ffff) ||
    !num(L.readiness, 0, 1)
  )
    return bad('the city');
  const layoutV3 = L.v !== BATTLE_V2;
  if (L.mods !== undefined && !(layoutV3 && modsIn(L.mods))) return bad('the defenders’ research');
  if (L.dome !== undefined && !(layoutV3 && num(L.dome, 0, 1e7))) return bad('the dome');
  if (!numbers(L.box, 4) || L.box.length !== 4) return bad('the city’s box');
  if (!numbers(L.nodes, BATTLE_LIMITS.nodes * 2) || L.nodes.length % 2) return bad('the roads');
  if (!numbers(L.pts, BATTLE_LIMITS.points * 2) || L.pts.length % 2) return bad('the roads');
  if (!numbers(L.edges, BATTLE_LIMITS.edges * E.stride) || L.edges.length % E.stride) return bad('the roads');
  const roads = L.edges;
  const nodes = L.nodes.length / 2;
  const points = L.pts.length / 2;
  const edges = roads.length / E.stride;
  for (let e = 0; e < edges; e++) {
    const r = (f: number) => roads[e * E.stride + f]!;
    if (!int(r(E.a), 0, nodes - 1) || !int(r(E.b), 0, nodes - 1)) return bad('a road’s ends');
    if (!num(r(E.len), 0, 2 * MAP_SIZE) || !int(r(E.n), 2, points) || !int(r(E.pt), 0, points - r(E.n)))
      return bad('a road’s points');
    if (!int(r(E.seg), -1, 0x7fff_ffff)) return bad('a road');
  }
  if (!numbers(L.structs, BATTLE.maxStructs * S.stride) || L.structs.length % S.stride)
    return bad('the buildings');
  const rows = L.structs;
  const structs = rows.length / S.stride;
  for (let k = 0; k < structs; k++) {
    const r = (f: number) => rows[k * S.stride + f]!;
    if (!int(r(S.id), -0x7fff_ffff, 0x7fff_ffff) || !int(r(S.tags), 0, layoutV3 ? TAGS_V3 : TAGS_V2))
      return bad('a building');
    if (!num(r(S.x), -MAP_SIZE, 2 * MAP_SIZE) || !num(r(S.z), -MAP_SIZE, 2 * MAP_SIZE))
      return bad('a building’s place');
    if (!num(r(S.r), 0, 1000) || !num(r(S.rIn), 0, 1000) || !num(r(S.hp), 0.001, 1e7))
      return bad('a building’s size');
    if (!int(r(S.edge), -1, edges - 1) || !num(r(S.at), 0, 2 * MAP_SIZE)) return bad('a building’s road');
    if (!num(r(S.gun), 0, 1e4) || !num(r(S.range), 0, MAP_SIZE) || !int(r(S.against), 0, 7))
      return bad('a building’s guns');
    if (!num(r(S.manned), 0, 1) || !int(r(S.seg), -1, 0x7fff_ffff)) return bad('a building');
  }
  if (!Array.isArray(L.names) || L.names.length > BATTLE.maxStructs) return bad('the names');
  for (const n of L.names)
    if (!Array.isArray(n) || n.length !== 2 || !int(n[0], -0x7fff_ffff, 0x7fff_ffff) || !text(n[1]))
      return bad('a name');
  const g = L.grid;
  if (!isObj(g) || !num(g.x0, -MAP_SIZE, MAP_SIZE) || !num(g.z0, -MAP_SIZE, MAP_SIZE))
    return bad('the ground');
  if (!int(g.nx, 1, GRID_MAX) || !int(g.nz, 1, GRID_MAX)) return bad('the ground');
  if (!Array.isArray(g.cells) || g.cells.length !== g.nx * g.nz) return bad('the ground');
  if (!g.cells.every((c) => Number.isInteger(c) && c >= 0 && c <= CELL_DEEP)) return bad('the ground');
  if (!Array.isArray(L.entries) || L.entries.length > BATTLE_LIMITS.entries) return bad('the ways in');
  for (const e of L.entries) {
    if (!isObj(e) || !(typeof e.route === 'string' && e.route in ROUTES)) return bad('a way in');
    if (!num(e.x, -MAP_SIZE, 2 * MAP_SIZE) || !num(e.z, -MAP_SIZE, 2 * MAP_SIZE)) return bad('a way in');
    if (!int(e.edge, -1, edges - 1) || !num(e.at, 0, 2 * MAP_SIZE)) return bad('a way in');
  }
  if (!Array.isArray(L.defenders) || L.defenders.length > BATTLE.maxDefenders) return bad('the defenders');
  for (const u of L.defenders) {
    const why = unitIn(u, structs, layoutV3, false);
    if (why) return bad(why);
  }
  const a = input.attacker;
  if (!isObj(a) || !text(a.name) || !int(a.color, 0, 0xff_ffff)) return bad('the attackers');
  if (!(typeof a.route === 'string' && a.route in ROUTES)) return bad('the attackers’ route');
  if (!TARGETS.includes(a.target as BattleTarget) || !STANCES.includes(a.stance as Stance))
    return bad('the attackers’ orders');
  if (!num(a.readiness, 0, 1)) return bad('the attackers’ readiness');
  if (a.mods !== undefined && !(v3 && modsIn(a.mods))) return bad('the attackers’ research');
  if (!Array.isArray(a.units) || !a.units.length || a.units.length > BATTLE.maxAttackers + SUPER.maxCarried)
    return bad('the attackers');
  for (const u of a.units) {
    const why = unitIn(u, structs, v3, true);
    if (why) return bad(why);
  }
  const force = forceIn(a.units as Obj[]);
  if (force) return bad(force);
  const d = input.defender;
  if (!isObj(d) || !text(d.name) || !int(d.color, 0, 0xff_ffff)) return bad('the defenders');
  const orders = ordersIn(input.orders, v4, structs);
  if (orders) return bad(orders);
  // Helpers (version 4 only), and unit ids that name one unit in a version 4 battle.
  if (input.helpers !== undefined) {
    const none = Array.isArray(input.helpers) && !input.helpers.length;
    const why = v4
      ? helpersIn(input.helpers, structs)
      : none
        ? null
        : 'a helper in a battle of another version';
    if (why) return bad(why);
  }
  if (v4 && !idsDiffer(a.units as Obj[], L.defenders as Obj[], (input.helpers ?? []) as Obj[]))
    return bad('two units with one id');
  const c = input.caps;
  if (!isObj(c) || !int(c.maxCollapse, 0, 10_000) || !int(c.maxWreck, 0, 10_000)) return bad('its caps');
  return null;
}
