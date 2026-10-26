/**
 * A battle that comes from outside the city (a friend's page, a replay, a kept record), checked
 * before the city's sim takes it (M35): every array the right shape and size, every number
 * finite and in range, every index pointing inside its array, so a malformed or crafted battle is
 * turned away without touching the city, and a well-formed one can't run for ever or fill memory.
 */
import { BATTLE, ROUTES, type BattleTarget, type Stance } from '../../data/battle';
import { MAP_SIZE } from '../../data/world';
import { UNIT } from '../../data/war';
import { BATTLE_VERSION, CELL_DEEP, E, S } from './types';

/** How big a battle's picture of a city may be. */
export const BATTLE_LIMITS = {
  nodes: 30_000,
  edges: 40_000,
  points: 600_000,
  entries: 8,
  orders: 64,
  text: 60,
} as const;

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

function unitIn(v: unknown, structs: number): string | null {
  if (!isObj(v)) return 'a unit';
  if (!int(v.id, -0x7fff_ffff, 0x7fff_ffff)) return 'a unit’s id';
  if (typeof v.kind !== 'string' || !UNIT.get(v.kind as never)) return 'a unit’s kind';
  if (!num(v.hp, 0, 1)) return 'a unit’s health';
  if (!num(v.x, -MAP_SIZE, 2 * MAP_SIZE) || !num(v.z, -MAP_SIZE, 2 * MAP_SIZE)) return 'a unit’s place';
  if (!int(v.base, -1, structs - 1)) return 'a unit’s base';
  return null;
}

/** Why a battle can't be taken, or null when it's sound. */
export function checkBattleInput(input: unknown): string | null {
  const bad = (what: string) => `That battle could not be read (${what})`;
  if (!isObj(input)) return bad('not a battle');
  if (input.v !== BATTLE_VERSION) return 'That battle was fought by another version of the game';
  if (typeof input.id !== 'string' || !/^[\w:.-]{1,60}$/.test(input.id)) return bad('its name');
  if (!text(input.seed, 120)) return bad('its seed');
  if (input.scale !== 'skirmish') return bad('its scale');
  const L = input.layout;
  if (!isObj(L)) return bad('the city');
  if (L.v !== BATTLE_VERSION || !text(L.city) || !int(L.tick, 0, 0x7fff_ffff) || !num(L.readiness, 0, 1))
    return bad('the city');
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
    if (!int(r(S.id), -0x7fff_ffff, 0x7fff_ffff) || !int(r(S.tags), 0, 1023)) return bad('a building');
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
    const why = unitIn(u, structs);
    if (why) return bad(why);
  }
  const a = input.attacker;
  if (!isObj(a) || !text(a.name) || !int(a.color, 0, 0xff_ffff)) return bad('the attackers');
  if (!(typeof a.route === 'string' && a.route in ROUTES)) return bad('the attackers’ route');
  if (!TARGETS.includes(a.target as BattleTarget) || !STANCES.includes(a.stance as Stance))
    return bad('the attackers’ orders');
  if (!num(a.readiness, 0, 1)) return bad('the attackers’ readiness');
  if (!Array.isArray(a.units) || !a.units.length || a.units.length > BATTLE.maxAttackers)
    return bad('the attackers');
  for (const u of a.units) {
    const why = unitIn(u, structs);
    if (why) return bad(why);
  }
  const d = input.defender;
  if (!isObj(d) || !text(d.name) || !int(d.color, 0, 0xff_ffff)) return bad('the defenders');
  if (!Array.isArray(input.orders) || input.orders.length > BATTLE_LIMITS.orders) return bad('the orders');
  for (const o of input.orders)
    if (!isObj(o) || !int(o.step, 0, 0x7fff_ffff) || (o.side !== 0 && o.side !== 1) || o.kind !== 'withdraw')
      return bad('an order');
  const c = input.caps;
  if (!isObj(c) || !int(c.maxCollapse, 0, 10_000) || !int(c.maxWreck, 0, 10_000)) return bad('its caps');
  return null;
}
