import { WEATHER } from '../../data/climate';
import { isRail } from '../../data/roads';
import type { Sim } from '../sim';
import { civicDef, civicOnline, type Civic } from '../world/civic';
import { Dijkstra, type RoadGraph } from './graph';
import {
  despawnVehicle,
  driveOn,
  registerVehicleKind,
  route,
  sendHome,
  spawnVehicle,
  type Vehicle,
} from './vehicles';

/**
 * Snow ploughs (M22), DESIGN.md §3.23. A public works depot sends its ploughs out whenever snow lies
 * on the roads within its reach: each drives to the busiest snowy road it can get to, clears every
 * road it drives along, then works on to the nearest snowy road left, and after `stops` roads (or
 * when none is left) heads home. `load` counts the metres of road a plough has cleared.
 */
const dijkstra = new Dijkstra();

/** Ploughs a depot sends out at its road maintenance funding. */
export function ploughsFor(sim: Sim, c: Civic): number {
  const p = civicDef(c).plough;
  if (!p) return 0;
  return Math.max(0, Math.round(p.ploughs * sim.fundingEff('roads')));
}

/** Snow deep enough to send a plough for. */
const PLOUGH_MIN = 0.1;

function clear(sim: Sim, v: Vehicle, segId: number): void {
  const seg = sim.state.net.segments.get(segId);
  if (!seg?.snow) return;
  delete seg.snow;
  v.load = Math.round(v.load + sim.net.curve(segId).length);
  sim.roadSnowChanged(segId);
}

function nodeOf(sim: Sim, g: RoadGraph, c: Civic): number | undefined {
  const seg = sim.state.net.segments.get(c.access!.seg);
  if (!seg) return undefined;
  return g.index.get(c.access!.s < sim.net.curve(seg.id).length / 2 ? seg.a : seg.b);
}

/**
 * Each depot's reach, worked out once per game hour and road graph: a plough asks on every arrival,
 * and a Dijkstra each time was most of the ploughs' cost in a big city.
 */
const reachCache = new WeakMap<RoadGraph, Map<number, { hour: number; reach: Map<number, number> }>>();

/** Road distance (m) from a depot to each node within its reach. */
function reachOf(sim: Sim, g: RoadGraph, c: Civic): Map<number, number> {
  const hour = Math.floor(sim.state.tick / 60);
  let byDepot = reachCache.get(g);
  if (!byDepot) reachCache.set(g, (byDepot = new Map()));
  const hit = byDepot.get(c.id);
  if (hit && hit.hour === hour) return hit.reach;
  const reach = computeReach(sim, g, c);
  byDepot.set(c.id, { hour, reach });
  return reach;
}

function computeReach(sim: Sim, g: RoadGraph, c: Civic): Map<number, number> {
  const reach = new Map<number, number>();
  const node = nodeOf(sim, g, c);
  if (node === undefined) return reach;
  dijkstra.run(
    g,
    [{ node, cost: 0 }],
    civicDef(c).plough!.reach,
    (u, cost) => {
      reach.set(g.ids[u]!, cost);
      return true;
    },
    (k) => g.length[k]!,
  );
  return reach;
}

/** Snowy roads within a depot's reach that no other plough is heading for. */
function snowyRoads(sim: Sim, reach: Map<number, number>, taken: Set<number>) {
  const out: { id: number; snow: number; traffic: number; dist: number }[] = [];
  for (const seg of sim.state.net.segments.values()) {
    if ((seg.snow ?? 0) < PLOUGH_MIN || isRail(seg.type) || taken.has(seg.id)) continue;
    const d = Math.min(reach.get(seg.a) ?? Infinity, reach.get(seg.b) ?? Infinity);
    if (!Number.isFinite(d)) continue;
    out.push({ id: seg.id, snow: seg.snow!, traffic: sim.state.traffic.get(seg.id) ?? 0, dist: d });
  }
  return out;
}

function targets(sim: Sim): Set<number> {
  const t = new Set<number>();
  for (const v of sim.state.vehicles.values()) if (v.kind === 'plough' && v.phase === 'out') t.add(v.target);
  return t;
}

/** Hourly: depots send idle ploughs to the busiest snowy roads in reach. */
export function dispatchPloughs(sim: Sim): void {
  const s = sim.state;
  const depots = [...s.civics.values()]
    .filter((c) => civicDef(c).plough && c.access && civicOnline(c))
    .sort((a, b) => a.id - b.id);
  if (!depots.length) return;
  let any = false;
  for (const seg of s.net.segments.values())
    if ((seg.snow ?? 0) >= PLOUGH_MIN) {
      any = true;
      break;
    }
  if (!any) return;
  const g = sim.graph();
  const taken = targets(sim);
  for (const c of depots) {
    let free = ploughsFor(sim, c) - c.out;
    if (free <= 0) continue;
    const cands = snowyRoads(sim, reachOf(sim, g, c), taken).sort(
      (a, b) => b.traffic * b.snow - a.traffic * a.snow || a.dist - b.dist || a.id - b.id,
    );
    for (const cand of cands) {
      if (free <= 0) break;
      const legs = route(sim, c.access!, { seg: cand.id, s: sim.net.curve(cand.id).length / 2 });
      if (!legs) continue;
      spawnVehicle(sim, 'plough', c.id, cand.id, legs);
      taken.add(cand.id);
      free--;
    }
  }
}

/** On to the nearest snowy road still in the depot's reach, or home. */
function nextRoad(sim: Sim, v: Vehicle): boolean {
  const home = sim.state.civics.get(v.home);
  const def = home && civicDef(home).plough;
  if (!home || !def || v.stops + 1 >= def.stops) return false;
  const here = sim.state.net.segments.get(v.target);
  if (!here) return false;
  const reach = reachOf(sim, sim.graph(), home);
  const hereMid = sim.net.curve(here.id).pointAt(sim.net.curve(here.id).length / 2);
  const near = snowyRoads(sim, reach, targets(sim))
    .map((r) => {
      const c = sim.net.curve(r.id);
      const p = c.pointAt(c.length / 2);
      return { ...r, d: Math.hypot(p.x - hereMid.x, p.z - hereMid.z) };
    })
    .sort((a, b) => a.d - b.d || a.id - b.id);
  for (const r of near.slice(0, 4)) {
    if (driveOn(sim, v, r.id, { seg: r.id, s: sim.net.curve(r.id).length / 2 })) {
      v.stops++;
      return true;
    }
  }
  return false;
}

registerVehicleKind('plough', {
  passed(sim, v, seg) {
    clear(sim, v, seg);
  },
  arrive(sim, v) {
    clear(sim, v, v.target);
    if (!nextRoad(sim, v)) sendHome(sim, v);
  },
  workDone(sim, v) {
    sendHome(sim, v);
  },
  home(sim, v) {
    const c = sim.state.civics.get(v.home);
    if (c) c.processedToday = Math.round(c.processedToday + v.load);
    despawnVehicle(sim, v);
  },
});

/** Metres of road a depot's ploughs cleared yesterday and so far today (inspector). */
export function ploughedMetres(c: Civic): { today: number; yesterday: number } {
  return { today: c.processedToday, yesterday: c.lastDay };
}

/** Share of snowy road length the depots can reach (advisor: "roads beyond your ploughs"). */
export function unploughable(sim: Sim): number {
  const g = sim.graph();
  const reach = new Map<number, number>();
  for (const c of sim.state.civics.values()) {
    if (!civicDef(c).plough || !c.access || !civicOnline(c)) continue;
    for (const [n, d] of reachOf(sim, g, c)) reach.set(n, Math.min(d, reach.get(n) ?? Infinity));
  }
  let snowy = 0;
  let out = 0;
  for (const seg of sim.state.net.segments.values()) {
    if ((seg.snow ?? 0) < WEATHER.roadClear || isRail(seg.type)) continue;
    const len = sim.net.curve(seg.id).length;
    snowy += len;
    if (!reach.has(seg.a) && !reach.has(seg.b)) out += len;
  }
  return snowy ? out / snowy : 0;
}
