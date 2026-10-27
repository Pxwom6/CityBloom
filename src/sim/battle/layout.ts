/**
 * A battle's picture of the defending city (M35): roads as a graph with points along them, the
 * structures near what matters (with their strength and guns), a terrain grid over the whole map,
 * the ways in, and the defenders' units. Frozen when a battle starts; deterministic (everything in
 * id order), so the same city gives the same picture on every machine, live or from its save.
 */
import { BATTLE, SKIRMISH, type BattleTarget } from '../../data/battle';
import { CIVIC } from '../../data/civic';
import { isRail } from '../../data/roads';
import { UNIT } from '../../data/war';
import { MAP_SIZE, SHORE_HEIGHT } from '../../data/world';
import { CELL, ZONE_I, ZONE_R } from '../../data/zones';
import { DMath } from '../dmath';
import type { Sim } from '../sim';
import { BState, type Building } from '../world/buildings';
import { BERTH_DEPTH, civicOnline, type Civic } from '../world/civic';
import type { NeighbourSide } from '../../data/region';
import {
  BATTLE_VERSION,
  CELL_DEEP,
  CELL_LAND,
  CELL_SHALLOW,
  CELL_STEEP,
  DOMAIN_BIT,
  E,
  TAG,
  type BattleEntry,
  type BattleLayout,
  type BattleUnitIn,
} from './types';

export interface LayoutSpec {
  /** What the attackers aim at (the layout keeps every candidate), and which side they come from. */
  target: BattleTarget;
  from?: NeighbourSide;
}

interface Cand {
  id: number;
  tags: number;
  x: number;
  z: number;
  r: number;
  rIn: number;
  hp: number;
  gun: number;
  range: number;
  against: number;
  manned: number;
  name: string | null;
  /** Lower goes first when the picture has to leave structures out. */
  rank: number;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** City buildings that count as industry for a raid on it (freight, mines, wells, the arms factory). */
export const INDUSTRY_CIVICS = new Set([
  'railfreight',
  'freighthub',
  'seaport',
  'oremine',
  'oilwell',
  'armsfactory',
]);

/** The terrain over the whole map in BATTLE.cell squares: land, steep, shallow or deep water. */
function terrainGrid(sim: Sim): BattleLayout['grid'] {
  const c = BATTLE.cell;
  const nx = Math.ceil(MAP_SIZE / c);
  const nz = nx;
  const cells: number[] = [];
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const x = (i + 0.5) * c;
      const z = (j + 0.5) * c;
      const h = sim.terrain.heightAt(x, z);
      cells.push(
        h < BERTH_DEPTH / 2
          ? CELL_DEEP
          : h < SHORE_HEIGHT
            ? CELL_SHALLOW
            : sim.terrain.slopeAt(x, z) > BATTLE.steep
              ? CELL_STEEP
              : CELL_LAND,
      );
    }
  return { x0: 0, z0: 0, nx, nz, cells };
}

/** A point on the map's edge on one side, level with `p`. */
function edgePoint(side: NeighbourSide, p: { x: number; z: number }): { x: number; z: number } {
  if (side === 'north') return { x: p.x, z: 0 };
  if (side === 'south') return { x: p.x, z: MAP_SIZE };
  return { x: 0, z: p.z };
}

/** Is this structure one the attackers could aim at, for this kind of target? */
export function isObjective(tags: number, target: BattleTarget): boolean {
  if (target === 'military') return (tags & TAG.military) !== 0;
  if (target === 'industry') return (tags & TAG.industry) !== 0;
  if (target === 'power') return (tags & TAG.power) !== 0;
  return (tags & TAG.hq) !== 0;
}

/**
 * Where a skirmish's targets of a kind stand (M35): military buildings anywhere; industry and power
 * only within `SKIRMISH.border` of the highway's way in. The battle aims at these, the city's
 * residents near them shelter, and nothing further in is struck.
 */
export function objectiveSpots(sim: Sim, target: BattleTarget): { x: number; z: number }[] {
  const s = sim.state;
  const connect = s.net.nodes.get(s.highway.connect)!;
  const near = (x: number, z: number) => DMath.hypot(x - connect.x, z - connect.z) <= SKIRMISH.border;
  const out: { x: number; z: number }[] = [];
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    const def = CIVIC.get(c.def);
    if (!def) continue;
    const hit =
      target === 'military'
        ? def.category === 'military'
        : target === 'power'
          ? def.category === 'power' && near(c.x, c.z)
          : target === 'industry'
            ? INDUSTRY_CIVICS.has(def.id) && near(c.x, c.z)
            : !!def.military?.hq;
    if (hit) out.push({ x: c.x, z: c.z });
  }
  if (target === 'industry')
    for (const b of [...s.buildings.values()].sort((a, b) => a.id - b.id))
      if (b.zone === ZONE_I && b.state !== BState.Rubble && near(b.x, b.z)) out.push({ x: b.x, z: b.z });
  return out;
}

/** A city building as a battle sees it. */
function civicCand(c: Civic): Cand | null {
  const def = CIVIC.get(c.def);
  if (!def) return null;
  const m = def.military;
  let tags = TAG.civic;
  if (def.category === 'military') tags |= TAG.military;
  if (def.category === 'power') tags |= TAG.power;
  if (INDUSTRY_CIVICS.has(def.id)) tags |= TAG.industry;
  if (m?.defends) tags |= TAG.defence;
  if (m?.shelters) tags |= TAG.shelter;
  if (m?.hq) tags |= TAG.hq;
  if (m?.trains?.length) tags |= TAG.base;
  if (m?.jobs) tags |= TAG.job;
  const area = def.w * def.d;
  const hp = m?.defends
    ? BATTLE.defence.hp
    : Math.max(BATTLE.hpMin, area * BATTLE.hpPerM2) * (m ? BATTLE.military : BATTLE.civic);
  let against = 0;
  for (const d of m?.defends?.against ?? []) against |= DOMAIN_BIT[d];
  return {
    id: c.id,
    tags,
    x: c.x,
    z: c.z,
    r: Math.max(def.w, def.d) / 2,
    rIn: Math.min(def.w, def.d) / 2,
    hp,
    gun: m?.defends?.strength ?? 0,
    range: m?.defends?.range ?? 0,
    against,
    manned: m?.defends && civicOnline(c) ? Math.min(1, c.staff ?? 0) * (c.powered ?? 0) : 0,
    name: def.name,
    rank: 0,
  };
}

/** A home or business as a battle sees it (none for rubble). */
function buildingCand(b: Building): Cand | null {
  if (b.state === BState.Rubble) return null;
  let tags = b.zone === ZONE_R ? TAG.home : TAG.job;
  if (b.zone === ZONE_I) tags |= TAG.industry;
  const w = b.w * CELL;
  const d = b.d * CELL;
  return {
    id: b.id,
    tags,
    x: b.x,
    z: b.z,
    r: Math.max(w, d) / 2,
    rIn: Math.min(w, d) / 2,
    hp: Math.max(BATTLE.hpMin, w * d * BATTLE.hpPerM2 * (1 + b.level * 0.5)),
    gun: 0,
    range: 0,
    against: 0,
    manned: 0,
    name: null,
    rank: 0,
  };
}

/** Is a spot within a skirmish's reach of the highway's way in (SKIRMISH.border)? */
function nearBorder(sim: Sim, x: number, z: number): boolean {
  const connect = sim.state.net.nodes.get(sim.state.highway.connect)!;
  return DMath.hypot(x - connect.x, z - connect.z) <= SKIRMISH.border;
}

/**
 * A structure of this city as its own battle picture would have it (packed as `battleLayout` packs
 * it), or null when nothing stands under that id: a battle made elsewhere is checked against it.
 */
export function structureAsSeen(
  sim: Sim,
  id: number,
): { tags: number; x: number; z: number; hp: number; gun: number; range: number; against: number } | null {
  const c = sim.state.civics.get(id);
  const b = c ? undefined : sim.state.buildings.get(id);
  const cand = c ? civicCand(c) : b ? buildingCand(b) : null;
  if (!cand) return null;
  return {
    tags: nearBorder(sim, cand.x, cand.z) ? cand.tags : cand.tags & ~(TAG.industry | TAG.power),
    x: round1(cand.x),
    z: round1(cand.z),
    hp: Math.round(cand.hp),
    gun: cand.gun,
    range: cand.range,
    against: cand.against,
  };
}

export function battleLayout(sim: Sim, spec: LayoutSpec): BattleLayout {
  const s = sim.state;
  const net = sim.net;
  const war = s.war;
  const readiness = war?.readiness ?? 0;
  // --- Ways in: the highway's end off the map; air from the side the force comes from. ---
  const hwSeg = s.highway.segment;
  const outside = s.net.nodes.get(s.highway.outside)!;
  const connect = s.net.nodes.get(s.highway.connect)!;
  const entryPt = { x: outside.x, z: outside.z };
  const side = spec.from ?? 'west';
  // --- Structures: every candidate, ranked. ---
  const cands: Cand[] = [];
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    const cand = civicCand(c);
    if (cand) cands.push(cand);
  }
  for (const b of [...s.buildings.values()].sort((a, b) => a.id - b.id)) {
    const cand = buildingCand(b);
    if (cand) cands.push(cand);
  }
  // What matters: military and defences anywhere; the target kind's candidates near the border
  // (industry and power within SKIRMISH.border of the way in).
  const near = (c: Cand) => DMath.hypot(c.x - connect.x, c.z - connect.z) <= SKIRMISH.border;
  const key = (c: Cand) =>
    (c.tags & (TAG.military | TAG.defence)) !== 0 ||
    (isObjective(c.tags, spec.target) && (spec.target === 'military' || near(c)));
  let x0 = Math.min(entryPt.x, connect.x);
  let z0 = Math.min(entryPt.z, connect.z);
  let x1 = Math.max(entryPt.x, connect.x);
  let z1 = Math.max(entryPt.z, connect.z);
  for (const c of cands)
    if (key(c)) {
      x0 = Math.min(x0, c.x);
      z0 = Math.min(z0, c.z);
      x1 = Math.max(x1, c.x);
      z1 = Math.max(z1, c.z);
    }
  const m = BATTLE.margin;
  const box: [number, number, number, number] = [
    Math.max(0, x0 - m),
    Math.max(0, z0 - m),
    Math.min(MAP_SIZE, x1 + m),
    Math.min(MAP_SIZE, z1 + m),
  ];
  const inBox = (x: number, z: number) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3];
  // Keep what matters, then the rest nearest the line from the way in to the middle of what matters.
  const kept = cands.filter((c) => inBox(c.x, c.z));
  const mid = { x: (x0 + x1) / 2, z: (z0 + z1) / 2 };
  for (const c of kept) c.rank = key(c) ? -1 : Math.round(DMath.hypot(c.x - mid.x, c.z - mid.z));
  kept.sort((a, b) => a.rank - b.rank || a.id - b.id);
  const structsIn = kept.slice(0, BATTLE.maxStructs).sort((a, b) => a.id - b.id);

  // --- Roads in the box (the highway always), as nodes, edges and points. ---
  const segs = [...s.net.segments.values()]
    .filter((g) => !isRail(g.type))
    .filter((g) => {
      if (g.id === hwSeg) return true;
      const cv = net.curve(g.id);
      const n = Math.max(2, Math.ceil(cv.length / 40) + 1);
      for (let k = 0; k < n; k++) {
        const p = cv.pointAt((cv.length * k) / (n - 1));
        if (inBox(p.x, p.z)) return true;
      }
      return false;
    })
    .sort((a, b) => a.id - b.id);
  const nodeIx = new Map<number, number>();
  const nodes: number[] = [];
  const nodeOf = (id: number) => {
    let i = nodeIx.get(id);
    if (i === undefined) {
      const n = s.net.nodes.get(id)!;
      i = nodes.length / 2;
      nodeIx.set(id, i);
      nodes.push(round1(n.x), round1(n.z));
    }
    return i;
  };
  for (const g of [...new Set(segs.flatMap((g) => [g.a, g.b]))].sort((a, b) => a - b)) nodeOf(g);
  const edges: number[] = [];
  const pts: number[] = [];
  const edgeOfSeg = new Map<number, number>();
  for (const g of segs) {
    const cv = net.curve(g.id);
    const len = cv.length;
    const n = Math.max(2, Math.ceil(len / BATTLE.pointStep) + 1);
    edgeOfSeg.set(g.id, edges.length / E.stride);
    edges.push(nodeOf(g.a), nodeOf(g.b), round1(len), pts.length / 2, n, g.id);
    for (let k = 0; k < n; k++) {
      const p = cv.pointAt((len * k) / (n - 1));
      pts.push(round1(p.x), round1(p.z));
    }
  }
  // Points in 64 m cells, to find the road each structure stands by.
  const pc = 64;
  const pcells = new Map<number, number[]>();
  for (let e = 0; e < edges.length / E.stride; e++) {
    const p0 = edges[e * E.stride + E.pt]!;
    const n = edges[e * E.stride + E.n]!;
    for (let k = 0; k < n; k++) {
      const x = pts[(p0 + k) * 2]!;
      const z = pts[(p0 + k) * 2 + 1]!;
      const key = Math.floor(x / pc) * 4096 + Math.floor(z / pc);
      let l = pcells.get(key);
      if (!l) pcells.set(key, (l = []));
      l.push(e, k);
    }
  }
  const nearestRoad = (x: number, z: number, reach: number): { edge: number; at: number; seg: number } => {
    let best = reach * reach;
    let be = -1;
    let bk = 0;
    const ci = Math.floor(x / pc);
    const cj = Math.floor(z / pc);
    const span = Math.ceil(reach / pc);
    for (let di = -span; di <= span; di++)
      for (let dj = -span; dj <= span; dj++) {
        const l = pcells.get((ci + di) * 4096 + cj + dj);
        if (!l) continue;
        for (let q = 0; q < l.length; q += 2) {
          const e = l[q]!;
          const k = l[q + 1]!;
          const p = (edges[e * E.stride + E.pt]! + k) * 2;
          const dx = pts[p]! - x;
          const dz = pts[p + 1]! - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < best || (d2 === best && (e < be || (e === be && k < bk)))) {
            best = d2;
            be = e;
            bk = k;
          }
        }
      }
    if (be < 0) return { edge: -1, at: 0, seg: -1 };
    const len = edges[be * E.stride + E.len]!;
    const n = edges[be * E.stride + E.n]!;
    return { edge: be, at: round1((len * bk) / (n - 1)), seg: edges[be * E.stride + E.seg]! };
  };
  const structs: number[] = [];
  const names: [number, string][] = [];
  for (const c of structsIn) {
    const road = nearestRoad(c.x, c.z, c.r + 80);
    structs.push(
      c.id,
      // A skirmish strikes industry and power only near the border (SKIRMISH.border): further in,
      // they're ordinary buildings to the battle, never its objectives.
      near(c) ? c.tags : c.tags & ~(TAG.industry | TAG.power),
      round1(c.x),
      round1(c.z),
      round1(c.r),
      round1(c.rIn),
      Math.round(c.hp),
      road.edge,
      road.at,
      c.gun,
      c.range,
      c.against,
      Math.round(c.manned * 1000) / 1000,
      road.seg,
    );
    if (c.name) names.push([c.id, c.name]);
  }

  // --- Ways in. ---
  const grid = terrainGrid(sim);
  const hwEdge = edgeOfSeg.get(hwSeg) ?? -1;
  const hwLen = hwEdge >= 0 ? edges[hwEdge * E.stride + E.len]! : 0;
  const hwAtOutside =
    hwEdge >= 0 && edges[hwEdge * E.stride + E.a] === nodeIx.get(s.highway.outside) ? 0 : hwLen;
  const entries: BattleEntry[] = [
    { route: 'highway', x: round1(entryPt.x), z: round1(entryPt.z), edge: hwEdge, at: hwAtOutside },
  ];
  const air = edgePoint(side, connect);
  entries.push({ route: 'air', x: round1(air.x), z: round1(air.z), edge: -1, at: 0 });
  if (s.railway) {
    const rc = s.net.nodes.get(s.railway.connect)!;
    const road = nearestRoad(rc.x, rc.z, 400);
    if (road.edge >= 0)
      entries.push({ route: 'rail', x: round1(rc.x), z: round1(rc.z), edge: road.edge, at: road.at });
  }
  const sea = seaEntry(grid, mid);
  if (sea) entries.push({ route: 'sea', x: sea.x, z: sea.z, edge: -1, at: 0 });

  // --- The defenders' units, at their bases (by id, at most BATTLE.maxDefenders). ---
  const defenders: BattleUnitIn[] = [];
  if (war) {
    const index = new Map(structsIn.map((c, i) => [c.id, i]));
    for (const u of [...war.units.values()].sort((a, b) => a.id - b.id)) {
      if (defenders.length >= BATTLE.maxDefenders) break;
      // Units away raiding another town aren't here to defend, and superweapons (M37) never do.
      if (!UNIT.get(u.kind) || u.away || UNIT.get(u.kind)!.super) continue;
      const base = s.civics.get(u.base);
      if (!base) continue;
      const i = index.get(base.id);
      defenders.push({
        id: u.id,
        kind: u.kind,
        hp: u.hp,
        x: round1(base.x),
        z: round1(base.z),
        base: i === undefined ? -1 : i,
      });
    }
  }
  return {
    v: BATTLE_VERSION,
    city: s.options.cityName,
    tick: s.tick,
    box,
    nodes,
    edges,
    pts,
    structs,
    names,
    grid,
    entries,
    defenders,
    readiness: Math.round(readiness * 1000) / 1000,
  };
}

/** Where ships come in: the deep water on the map's edge nearest `to`, if the sea reaches it. */
function seaEntry(grid: BattleLayout['grid'], to: { x: number; z: number }): { x: number; z: number } | null {
  let best = Infinity;
  let at: { x: number; z: number } | null = null;
  const c = BATTLE.cell;
  for (let j = 0; j < grid.nz; j++)
    for (let i = 0; i < grid.nx; i++) {
      if (i !== 0 && j !== 0 && i !== grid.nx - 1 && j !== grid.nz - 1) continue;
      if (grid.cells[j * grid.nx + i] !== CELL_DEEP) continue;
      const x = (i + 0.5) * c;
      const z = (j + 0.5) * c;
      const d = DMath.hypot(x - to.x, z - to.z);
      if (d < best) {
        best = d;
        at = { x, z };
      }
    }
  return at;
}
