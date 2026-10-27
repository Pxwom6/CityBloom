/**
 * What a command from another player must look like (multiplayer review, F7). A shared city takes
 * commands from other people's games, so the room checks each one's shape before ordering it, and
 * every sim checks again before applying it: a field missing, of the wrong type, out of bounds or a
 * prototype key would otherwise throw in a handler, hang every player's worker (a brush a million
 * metres long) or quietly damage the city everyone shares. The check returns a clean copy with only
 * the fields the command has, so nothing unknown is ordered, logged or sent on.
 *
 * Pure and deterministic like the rest of `src/sim` (the room runs it too, in Node, a Worker or a
 * host's browser). Single player never goes through it.
 */
import type { Command, CommandType } from './commands';
import { DOME_MODES, TIER, type TierKey } from '../data/research';
import type { Vec2 } from './geom';
import type { DisasterKind } from './systems/disasters';
import { BUILDABLE_ROADS } from '../data/roads';
import { CIVIC } from '../data/civic';
import { DEPTS, LOAN_OPTIONS } from '../data/economy';
import { PROMISES } from '../data/elections';
import { POLICY } from '../data/policies';
import { MODULE } from '../data/modules';
import { DEAL_RESOURCES } from '../data/region';
import { TERRAFORM, TERRAFORM_MODES } from '../data/terraform';
import { MAP_BRUSHES, MAP_EDIT } from '../data/mapEditor';
import { CLIMATES } from '../data/climate';
import { UNIT, WAR, type UnitKind } from '../data/war';
import { cleanTerm, DIPLOMACY, type Term } from '../data/diplomacy';
import { MAP_SIZE } from '../data/world';

/**
 * Commands only this page's own game sends, never another player: cheats, a region's news and
 * payments (a city in a region isn't shared), the map editor's, and starting a scenario (which
 * resets the city's options, neighbours and deals). A room turns them away before ordering them.
 */
export const PAGE_ONLY: ReadonlySet<CommandType> = new Set<CommandType>([
  'cheat',
  'regionUpdate',
  'contributeProject',
  'editMap',
  'setMapEntry',
  'setMapInfo',
  'startScenario',
  'battleReport',
  'battleSettling',
  'battleResolve',
]);

const DISASTERS = { earthquake: true, tornado: true, flood: true, meteor: true } as const satisfies Record<
  DisasterKind,
  true
>;

type Fields = Record<string, unknown>;
type Check = (c: Fields) => Command | string;

const BAD = 'A command the game could not read';
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isObj = (v: unknown): v is Fields => !!v && typeof v === 'object' && !Array.isArray(v);
const isBool = (v: unknown): v is boolean => v === true || v === false;
const isNum = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo = 0, hi = 0x7fff_ffff): v is number => isNum(v, lo, hi) && Number.isInteger(v);
const oneOf = <T>(v: unknown, list: readonly T[]): v is T => list.includes(v as T);
/** A ground coordinate: the map and a margin round it (further out is never a real click). */
const isCoord = (v: unknown): v is number => isNum(v, -MAP_SIZE, 2 * MAP_SIZE);
/** A name as a player types it (the handler trims and shortens it). */
const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= 200 && v.trim().length > 0;

function vec(v: unknown): Vec2 | null {
  return isObj(v) && isCoord(v.x) && isCoord(v.z) ? { x: v.x, z: v.z } : null;
}

function vecs(v: unknown, min: number, max: number): Vec2[] | null {
  if (!Array.isArray(v) || v.length < min || v.length > max) return null;
  const out: Vec2[] = [];
  for (const p of v) {
    const q = vec(p);
    if (!q) return null;
    out.push(q);
  }
  return out;
}

/** A round brush along a few points, as the zoning, district and terrain tools send. */
function brush(v: unknown, maxRadius: number): { kind: 'brush'; points: Vec2[]; radius: number } | null {
  if (!isObj(v) || v.kind !== 'brush' || !isNum(v.radius, 1, maxRadius)) return null;
  const points = vecs(v.points, 1, 64);
  return points ? { kind: 'brush', points, radius: v.radius } : null;
}

const stroke = (c: Fields): { stroke?: number } | null =>
  c.stroke === undefined ? {} : isInt(c.stroke) ? { stroke: c.stroke } : null;

const ROADS = BUILDABLE_ROADS as readonly string[];
const DEPT_IDS = DEPTS.map((d) => d.id) as readonly string[];
const LOANS = LOAN_OPTIONS.map((l) => l.amount);
const BONDS = WAR.bonds.map((b) => b.amount);
const PROMISE_IDS = PROMISES.map((p) => p.id) as readonly string[];
const MODES = TERRAFORM_MODES.map((m) => m.id) as readonly string[];
const BRUSHES = MAP_BRUSHES.map((b) => b.id) as readonly string[];
const ANGLE = 64;

const CHECKS: Record<CommandType, Check> = {
  cheat: () => 'Cheats are off in a shared city',
  renameCity: (c) => (isText(c.name) ? { type: 'renameCity', name: c.name } : BAD),
  buildRoad: (c) => {
    if (!oneOf(c.road, ROADS) || (c.oneway !== undefined && !isBool(c.oneway))) return BAD;
    // Two points for a straight road, or anchors and control points (an odd number) for curves.
    const points = vecs(c.points, 2, 599);
    if (!points || (points.length > 2 && points.length % 2 === 0)) return BAD;
    return {
      type: 'buildRoad',
      road: c.road as Extract<Command, { type: 'buildRoad' }>['road'],
      points,
      ...(c.oneway !== undefined ? { oneway: c.oneway as boolean } : {}),
    };
  },
  bulldoze: (c) => {
    const t = c.target;
    if (!isObj(t) || !oneOf(t.kind, ['segment', 'building', 'civic', 'stop'] as const) || !isInt(t.id))
      return BAD;
    return { type: 'bulldoze', target: { kind: t.kind, id: t.id } };
  },
  placeStop: (c) => {
    if (!isCoord(c.x) || !isCoord(c.z) || (c.tram !== undefined && !isBool(c.tram))) return BAD;
    return {
      type: 'placeStop',
      x: c.x,
      z: c.z,
      ...(c.tram !== undefined ? { tram: c.tram as boolean } : {}),
    };
  },
  upgradeRoad: (c) =>
    isInt(c.seg) && oneOf(c.road, ROADS)
      ? { type: 'upgradeRoad', seg: c.seg, road: c.road as Extract<Command, { type: 'upgradeRoad' }>['road'] }
      : BAD,
  setOneWay: (c) =>
    isInt(c.seg) && oneOf(c.dir, [0, 1, -1] as const) ? { type: 'setOneWay', seg: c.seg, dir: c.dir } : BAD,
  setTram: (c) => {
    const s = stroke(c);
    return isInt(c.seg) && isBool(c.on) && s ? { type: 'setTram', seg: c.seg, on: c.on, ...s } : BAD;
  },
  roundabout: (c) => {
    if (c.node === undefined && c.at === undefined) return BAD;
    if (c.node !== undefined && !isInt(c.node)) return BAD;
    const at = c.at === undefined ? null : vec(c.at);
    if (c.at !== undefined && !at) return BAD;
    if (c.radius !== undefined && !isNum(c.radius, 0, 100)) return BAD;
    return {
      type: 'roundabout',
      ...(c.node !== undefined ? { node: c.node as number } : {}),
      ...(at ? { at } : {}),
      ...(c.radius !== undefined ? { radius: c.radius as number } : {}),
    };
  },
  removeRoundabout: (c) => (isInt(c.node) ? { type: 'removeRoundabout', node: c.node } : BAD),
  zone: (c) => {
    if (!oneOf(c.zone, ['R', 'C', 'I', 'none'] as const)) return BAD;
    const s = stroke(c);
    if (!s) return BAD;
    const a = c.area;
    if (isObj(a) && a.kind === 'segment')
      return isInt(a.id) ? { type: 'zone', zone: c.zone, area: { kind: 'segment', id: a.id }, ...s } : BAD;
    const area = brush(a, 200);
    return area ? { type: 'zone', zone: c.zone, area, ...s } : BAD;
  },
  undo: () => ({ type: 'undo' }),
  redo: () => ({ type: 'redo' }),
  setTax: (c) =>
    oneOf(c.zone, ['R', 'C', 'I'] as const) &&
    oneOf(c.wealth, [0, 1, 2, 'all'] as const) &&
    isNum(c.rate, -1000, 1000)
      ? { type: 'setTax', zone: c.zone, wealth: c.wealth, rate: c.rate }
      : BAD,
  setFunding: (c) =>
    oneOf(c.dept, DEPT_IDS) && isNum(c.pct, -1000, 1000)
      ? { type: 'setFunding', dept: c.dept as Extract<Command, { type: 'setFunding' }>['dept'], pct: c.pct }
      : BAD,
  takeLoan: (c) => (oneOf(c.amount, LOANS) ? { type: 'takeLoan', amount: c.amount } : BAD),
  promise: (c) =>
    oneOf(c.promise, PROMISE_IDS) && isBool(c.on)
      ? { type: 'promise', promise: c.promise as Extract<Command, { type: 'promise' }>['promise'], on: c.on }
      : BAD,
  repayLoan: (c) => (isInt(c.id) ? { type: 'repayLoan', id: c.id } : BAD),
  placeBuilding: (c) =>
    typeof c.def === 'string' &&
    CIVIC.has(c.def) &&
    isCoord(c.x) &&
    isCoord(c.z) &&
    isNum(c.angle, -ANGLE, ANGLE) &&
    oneOf(c.side, [1, -1] as const)
      ? { type: 'placeBuilding', def: c.def, x: c.x, z: c.z, angle: c.angle, side: c.side }
      : BAD,
  // `size` and `heading` are for tests and never come from a player's tools: they're left out.
  disaster: (c) => {
    const at = vec(c.at);
    return typeof c.kind === 'string' && has(DISASTERS, c.kind) && at
      ? { type: 'disaster', kind: c.kind as DisasterKind, at }
      : BAD;
  },
  setDisasters: (c) => (isBool(c.on) ? { type: 'setDisasters', on: c.on } : BAD),
  setWeather: (c) => {
    if (c.seasons !== undefined && !isBool(c.seasons)) return BAD;
    if (c.intensity !== undefined && !oneOf(c.intensity, [0, 1, 2, 3] as const)) return BAD;
    return {
      type: 'setWeather',
      ...(c.seasons !== undefined ? { seasons: c.seasons as boolean } : {}),
      ...(c.intensity !== undefined ? { intensity: c.intensity as 0 | 1 | 2 | 3 } : {}),
    };
  },
  setDeal: (c) =>
    isInt(c.neighbour) &&
    oneOf(c.resource, DEAL_RESOURCES) &&
    oneOf(c.direction, ['buy', 'sell'] as const) &&
    isNum(c.amount, 0, 1e7)
      ? {
          type: 'setDeal',
          neighbour: c.neighbour,
          resource: c.resource,
          direction: c.direction,
          amount: c.amount,
        }
      : BAD,
  setElections: (c) => (isBool(c.on) ? { type: 'setElections', on: c.on } : BAD),
  startScenario: () => 'A scenario is started on its own city, not in a shared one',
  setPolicy: (c) =>
    typeof c.id === 'string' && POLICY.has(c.id as never) && isBool(c.on)
      ? { type: 'setPolicy', id: c.id as Extract<Command, { type: 'setPolicy' }>['id'], on: c.on }
      : BAD,
  moveBuilding: (c) =>
    isInt(c.id) &&
    isCoord(c.x) &&
    isCoord(c.z) &&
    isNum(c.angle, -ANGLE, ANGLE) &&
    oneOf(c.side, [1, -1] as const)
      ? { type: 'moveBuilding', id: c.id, x: c.x, z: c.z, angle: c.angle, side: c.side }
      : BAD,
  createDistrict: (c) => (isText(c.name) ? { type: 'createDistrict', name: c.name } : BAD),
  paintDistrict: (c) => {
    const area = brush(c.area, 200);
    const s = stroke(c);
    return isInt(c.district, 0, 255) && area && s
      ? { type: 'paintDistrict', district: c.district, area, ...s }
      : BAD;
  },
  renameDistrict: (c) =>
    isInt(c.district, 1, 255) && isText(c.name)
      ? { type: 'renameDistrict', district: c.district, name: c.name }
      : BAD,
  removeDistrict: (c) => (isInt(c.district, 1, 255) ? { type: 'removeDistrict', district: c.district } : BAD),
  setDistrictPolicy: (c) =>
    isInt(c.district, 1, 255) && typeof c.policy === 'string' && POLICY.has(c.policy as never) && isBool(c.on)
      ? {
          type: 'setDistrictPolicy',
          district: c.district,
          policy: c.policy as Extract<Command, { type: 'setDistrictPolicy' }>['policy'],
          on: c.on,
        }
      : BAD,
  buildRailLink: (c) => (isCoord(c.z) ? { type: 'buildRailLink', z: c.z } : BAD),
  terraform: (c) => {
    if (!oneOf(c.mode, MODES) || !isNum(c.radius, TERRAFORM.radius.min, TERRAFORM.radius.max)) return BAD;
    const points = vecs(c.points, 1, 64);
    const s = stroke(c);
    if (!points || !s) return BAD;
    if (c.mode === 'level' ? !isNum(c.level, -1000, 1000) : c.level !== undefined) return BAD;
    return {
      type: 'terraform',
      mode: c.mode as Extract<Command, { type: 'terraform' }>['mode'],
      points,
      radius: c.radius,
      ...(c.mode === 'level' ? { level: c.level as number } : {}),
      ...s,
    };
  },
  // The map editor's own: its city never shares, but the shapes are checked like any other's.
  editMap: (c) => {
    if (!oneOf(c.brush, BRUSHES) || !isNum(c.radius, MAP_EDIT.radius.min, MAP_EDIT.radius.max)) return BAD;
    const points = vecs(c.points, 1, 64);
    const s = stroke(c);
    if (!points || !s) return BAD;
    if (c.strength !== undefined && !isNum(c.strength, 0, 10)) return BAD;
    if (c.level !== undefined && !isNum(c.level, -1000, 1000)) return BAD;
    return {
      type: 'editMap',
      brush: c.brush as Extract<Command, { type: 'editMap' }>['brush'],
      points,
      radius: c.radius,
      ...(c.strength !== undefined ? { strength: c.strength as number } : {}),
      ...(c.level !== undefined ? { level: c.level as number } : {}),
      ...s,
    };
  },
  setMapEntry: (c) =>
    oneOf(c.entry, ['highway', 'rail'] as const) && (c.z === null || isCoord(c.z))
      ? { type: 'setMapEntry', entry: c.entry, z: c.z }
      : BAD,
  setMapInfo: (c) => {
    if (c.name !== undefined && !isText(c.name)) return BAD;
    if (c.climate !== undefined && !(typeof c.climate === 'string' && has(CLIMATES, c.climate))) return BAD;
    return {
      type: 'setMapInfo',
      ...(c.name !== undefined ? { name: c.name as string } : {}),
      ...(c.climate !== undefined
        ? { climate: c.climate as Extract<Command, { type: 'setMapInfo' }>['climate'] }
        : {}),
    };
  },
  regionUpdate: () => 'Only your own game passes on the region’s news',
  contributeProject: () => 'Only a city in a shared region pays into its project',
  addModule: (c) =>
    isInt(c.civic) && typeof c.module === 'string' && MODULE.has(c.module)
      ? { type: 'addModule', civic: c.civic, module: c.module }
      : BAD,
  trainUnit: (c) =>
    isInt(c.base) && typeof c.kind === 'string' && UNIT.has(c.kind as never)
      ? { type: 'trainUnit', base: c.base, kind: c.kind as Extract<Command, { type: 'trainUnit' }>['kind'] }
      : BAD,
  cancelTraining: (c) => (isInt(c.order) ? { type: 'cancelTraining', order: c.order } : BAD),
  sendForce: (c) =>
    Array.isArray(c.units) &&
    c.units.length <= 64 &&
    c.units.every((u) => isInt(u)) &&
    isInt(c.to) &&
    oneOf(c.route, ['highway', 'rail', 'sea', 'air'] as const) &&
    oneOf(c.target, ['military', 'industry', 'power', 'cityhall'] as const) &&
    oneOf(c.stance, ['cautious', 'bold'] as const)
      ? {
          type: 'sendForce',
          units: [...(c.units as number[])],
          to: c.to,
          route: c.route,
          target: c.target,
          stance: c.stance,
          ...(c.breakPact === true ? { breakPact: true } : {}),
          ...(c.gate === true ? { gate: true } : {}),
        }
      : BAD,
  recallForce: (c) => (isInt(c.expedition) ? { type: 'recallForce', expedition: c.expedition } : BAD),
  battleReport: () => 'Only your own game reports its battles',
  battleSettling: () => 'Only your own game reports its battles',
  battleResolve: () => 'Only your own game hosts its battles',
  disbandUnit: (c) => (isInt(c.unit) ? { type: 'disbandUnit', unit: c.unit } : BAD),
  issueBond: (c) => (oneOf(c.amount, BONDS) ? { type: 'issueBond', amount: c.amount } : BAD),
  repayBond: (c) => (isInt(c.id) ? { type: 'repayBond', id: c.id } : BAD),
  declareWar: (c) =>
    isInt(c.neighbour) &&
    oneOf(c.scale, ['war', 'total'] as const) &&
    typeof c.reason === 'string' &&
    c.reason.length <= DIPLOMACY.reasonMax
      ? {
          type: 'declareWar',
          neighbour: c.neighbour,
          scale: c.scale,
          reason: c.reason,
          ...(c.breakPact === true ? { breakPact: true } : {}),
        }
      : BAD,
  propose: (c) => {
    if (!isInt(c.neighbour) || !Array.isArray(c.terms) || c.terms.length > DIPLOMACY.maxTerms) return BAD;
    const terms = c.terms.map((t) => cleanTerm(t));
    if (terms.some((t) => !t)) return BAD;
    if (c.counters !== undefined && !isInt(c.counters)) return BAD;
    return {
      type: 'propose',
      neighbour: c.neighbour,
      terms: terms as Term[],
      ...(c.counters !== undefined ? { counters: c.counters as number } : {}),
    };
  },
  answerProposal: (c) =>
    isInt(c.proposal) && typeof c.accept === 'boolean'
      ? { type: 'answerProposal', proposal: c.proposal, accept: c.accept }
      : BAD,
  withdrawProposal: (c) => (isInt(c.proposal) ? { type: 'withdrawProposal', proposal: c.proposal } : BAD),
  endPact: (c) =>
    isInt(c.pact)
      ? { type: 'endPact', pact: c.pact, ...(c.breakPact === true ? { breakPact: true } : {}) }
      : BAD,
  buyBack: (c) => (isInt(c.pact) ? { type: 'buyBack', pact: c.pact } : BAD),
  setNeutral: (c) => (typeof c.on === 'boolean' ? { type: 'setNeutral', on: c.on } : BAD),
  queueResearch: (c) =>
    typeof c.key === 'string' && TIER.has(c.key as TierKey)
      ? { type: 'queueResearch', key: c.key as TierKey }
      : BAD,
  startTrial: (c) =>
    isInt(c.ground) && typeof c.kind === 'string' && UNIT.has(c.kind as UnitKind)
      ? { type: 'startTrial', ground: c.ground, kind: c.kind as UnitKind }
      : BAD,
  stopTrial: (c) => (isInt(c.ground) ? { type: 'stopTrial', ground: c.ground } : BAD),
  setDome: (c) => (oneOf(c.mode, DOME_MODES) ? { type: 'setDome', mode: c.mode } : BAD),
  useBlackout: (c) =>
    isInt(c.neighbour)
      ? {
          type: 'useBlackout',
          neighbour: c.neighbour,
          ...(c.breakPact === true ? { breakPact: true } : {}),
        }
      : BAD,
  unqueueResearch: (c) =>
    typeof c.key === 'string' && TIER.has(c.key as TierKey)
      ? { type: 'unqueueResearch', key: c.key as TierKey }
      : BAD,
};

/**
 * A command from another player, checked: a clean copy to order and apply, or why not. Page-only
 * commands (`PAGE_ONLY`) are always turned away.
 */
export function checkCommand(raw: unknown): { cmd: Command } | { problem: string } {
  if (!isObj(raw) || typeof raw.type !== 'string' || !has(CHECKS, raw.type)) return { problem: BAD };
  const out = CHECKS[raw.type as CommandType](raw);
  if (typeof out === 'string') return { problem: out };
  if (PAGE_ONLY.has(out.type)) return { problem: BAD };
  return { cmd: out };
}
