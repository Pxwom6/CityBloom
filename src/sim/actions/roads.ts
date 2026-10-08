import { ROAD_RULES, ROAD_TYPES, isRail, roadClass, roadHalfWidth, type RoadTypeId } from '../../data/roads';
import { GRID_CELL, GRID_RES } from '../../data/world';
import { fail, ok, type BulldozeTarget, type CommandResult } from '../commands';
import { Curve, compass, pointRectDistance, type Vec2 } from '../geom';
import { footprint } from '../world/buildings';
import { bulldozeCivic, civicRect } from '../world/civic';
import type { Sim } from '../sim';
import { applyRoadPlan, planRoad, type RoadPlan } from '../world/roadPlanner';
import { planEarthworks, reshapeGround, settledHeight, type EarthPlan } from '../world/earthworks';
import { gradeProfile } from '../world/grading';
import { removeStop } from '../systems/transit';
import { JUNCTION, TRAM } from '../../data/balance';
import {
  planStraighten,
  ringArms,
  ringLadder,
  ringOuter,
  ringSizes,
  shortfalls,
  straighten,
  straightenLosses,
  straighteningsOverlap,
  type ArmEnd,
  type ArmShortfall,
  type RingSite,
  type Straightening,
} from '../world/roundabout';

/** Refusal reason if a road type isn't available yet, else null. */
function roadLocked(sim: Sim, road: RoadTypeId): string | null {
  const t = ROAD_TYPES[road];
  if (!t.buildable) return "That road type can't be built";
  if (!sim.isUnlocked(t.unlockPopulation))
    return `${t.name}s unlock at ${t.unlockPopulation.toLocaleString('en-US')} residents`;
  return null;
}

export function buildRoad(
  sim: Sim,
  road: RoadTypeId,
  points: Vec2[],
  dryRun: boolean,
  oneway = false,
): CommandResult {
  const s = sim.state;
  const locked = roadLocked(sim, road);
  if (locked) return fail(locked);
  // Earthworks leave the ground under buildings alone, except those the road will replace.
  let doomed = new Set<number>();
  const plan = planRoad(sim.net, sim.terrain, road, points, s.treasury, s.options.sandbox, (pieces) => {
    doomed = new Set(buildingsInTheWay(sim, pieces, road));
    return keepUnder(sim, doomed);
  });
  // What it takes away (P2): lots under its surface, and lots where it splits a street.
  const demolished = plan.ok ? roadLosses(sim, plan) : [];
  const preview = {
    pieces: plan.pieces.map((p) => ({ a: p.a, c: p.c, b: p.b })),
    length: plan.length,
    splits: plan.splits.length,
    demolish: demolished.length,
    demolished,
    // P1: whether it joins a road that reaches the highway, only roads that don't, or nothing.
    link: linkInfo(sim, plan),
    grade: gradeInfo(plan),
  };
  if (!plan.ok) return fail(plan.reason ?? 'Invalid road', { at: plan.at, info: preview });
  if (dryRun) return ok(plan.cost, { info: preview });
  // Railways run both ways (M20).
  plan.oneway = oneway && road !== 'rail';
  const res = applyRoadPlan(sim.net, plan, () => {
    if (!plan.earth?.idx.length) return null;
    reshapeGround(sim, plan.earth.idx, plan.earth.to);
    return plan.earth.box;
  });
  // Name the new roads inside the command, so undo takes the names with them (P10).
  sim.nameSegments(res.segments);
  sim.spend(plan.cost, 'roads');
  clearTreesAlong(sim, res.segments);
  sim.markNetworkChanged();
  return ok(plan.cost, { created: res.segments, info: preview });
}

/** What the road preview shows about grading (M13): the profile of each piece and the earthworks. */
function gradeInfo(plan: RoadPlan) {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  let steepest = 0;
  let ground = 0;
  for (const p of plan.profiles) {
    if (!p) continue;
    steepest = Math.max(steepest, p.grade);
    ground = Math.max(ground, p.groundGrade);
  }
  return {
    limit: ROAD_TYPES[plan.type].maxGrade,
    max: r2(steepest),
    ground: r2(ground),
    earth: plan.earth
      ? { volume: plan.earth.volume, cut: plan.earth.cut, fill: plan.earth.fill, cost: plan.earth.cost }
      : null,
    viaduct: Math.round(plan.profiles.reduce((a, p) => a + (p?.raisedLength ?? 0), 0)),
    pieces: plan.profiles.map((p) =>
      p
        ? {
            step: p.step,
            h: Array.from(p.h, r2),
            ground: Array.from(p.ground, r2),
            raised: Array.from(p.raised),
            fail: p.fail?.at ?? -1,
          }
        : null,
    ),
  };
}

/** Ground the earthworks must not move: under buildings and civic buildings that stay. */
function keepUnder(sim: Sim, doomed: Set<number>): (x: number, z: number) => boolean {
  return (x, z) => {
    const p = { x, z };
    for (const id of sim.bldHash.queryPoint(x, z, 3))
      if (!doomed.has(id) && pointRectDistance(p, footprint(sim.state.buildings.get(id)!)) < 2) return true;
    for (const id of sim.civHash.queryPoint(x, z, 3))
      if (pointRectDistance(p, civicRect(sim.state.civics.get(id)!)) < 2) return true;
    return false;
  };
}

/**
 * Change a road to another type in place (SPEC: upgrading keeps what's built along it wherever
 * possible). Zone cells keep their indices and slide outward or inward with the new width;
 * buildings move with them and are only lost where the wider road leaves no room.
 */
export function upgradeRoad(sim: Sim, segId: number, road: RoadTypeId, dryRun: boolean): CommandResult {
  const s = sim.state;
  const seg = s.net.segments.get(segId);
  if (!seg) return fail('No road here');
  if (!ROAD_TYPES[seg.type].buildable) return fail("The regional highway can't be changed");
  if (seg.type === road) return fail(`This is already ${articled(ROAD_TYPES[road].name)}`);
  // The city highway and its ramps are their own roads (M19): no zoning, no junctions.
  if (roadClass(seg.type) !== roadClass(road))
    return fail(
      roadClass(road) === 'local'
        ? `${ROAD_TYPES[seg.type].name}s can't become local roads: bulldoze and rebuild`
        : `Local roads can't become ${articled(ROAD_TYPES[road].name)}: build it as a new road`,
    );
  const locked = roadLocked(sim, road);
  if (locked) return fail(locked);
  if (seg.tram && !ROAD_TYPES[road].tram)
    return fail('Take up the tram track first: trams run only on streets, avenues and boulevards');
  const curve = sim.net.curve(segId);
  const len = curve.length;
  const cost = Math.max(
    0,
    Math.round(len * (ROAD_TYPES[road].costPerMetre - ROAD_TYPES[seg.type].costPerMetre)),
  );
  const at = curve.pointAt(len / 2);
  if (cost > s.treasury && !s.options.sandbox) return fail('Not enough money', { at });
  // Room for the new width: other roads (not joined at the ends) and civic buildings.
  const hwNew = roadHalfWidth(road);
  const pts: Vec2[] = [];
  for (let d = 6; d < len - 6; d += 4) pts.push(curve.pointAt(d));
  const box = curve.bbox(hwNew + 40);
  for (const other of sim.net.segHash.query(box).sort((x, y) => x - y)) {
    if (other === segId) continue;
    const o = sim.net.segment(other);
    if (o.a === seg.a || o.a === seg.b || o.b === seg.a || o.b === seg.b) continue;
    const oc = sim.net.curve(other);
    const need = hwNew + sim.net.halfWidth(other) - 0.5;
    for (const p of pts) if (oc.project(p).d < need) return fail('Not enough room to widen here', { at: p });
  }
  for (const c of s.civics.values()) {
    const r = civicRect(c, 0.3);
    for (const p of pts)
      if (pointRectDistance(p, r) < hwNew) return fail('A civic building is in the way', { at: p });
  }
  // The new type's grade limit (M13): regrade the road between its junctions and widen its
  // formation; bridges and viaducts keep their decks, which must not climb too steeply.
  const graded = regrade(sim, segId, road);
  if (graded.reason) return fail(graded.reason, { at: graded.at ?? at });
  const earth = graded.earth;
  const total = cost + (earth?.cost ?? 0);
  if (total > s.treasury && !s.options.sandbox) return fail('Not enough money', { at });
  const info = {
    length: Math.round(len),
    from: seg.type,
    to: road,
    earth: earth ? { volume: earth.volume, cost: earth.cost } : null,
    // The buildings it takes away (P2), worked out by the same steps as the upgrade itself.
    demolish: 0,
    demolished: [] as number[],
  };
  if (dryRun) {
    info.demolished = upgradeLosses(sim, segId, road, earth);
    info.demolish = info.demolished.length;
    return ok(total, { info });
  }
  sim.net.setSegmentType(segId, road);
  if (earth?.idx.length) reshapeGround(sim, earth.idx, earth.to);
  sim.relocateBuildingsOn(segId);
  info.demolished = sim.net.revalidate(upgradeBox(sim, segId, earth));
  info.demolish = info.demolished.length;
  sim.spend(total, 'roads');
  clearTreesAlong(sim, [segId]);
  sim.markNetworkChanged();
  return ok(total, { info });
}

/** Where an upgrade can change which lots stand: along the road, and wherever the ground moves. */
function upgradeBox(sim: Sim, segId: number, earth: EarthPlan | null): Box {
  const around = sim.net.segmentInfluenceBox(segId);
  return earth?.box ? union(around, earth.box) : around;
}

/**
 * The buildings an upgrade would remove (P2): the road takes its new width and the ground its new
 * shape for a moment, the lots are judged as the upgrade judges them, and everything is put back
 * exactly before anyone sees it (the ground under buildings isn't moved, and buildings sliding on
 * their lots don't change which lots stand).
 */
function upgradeLosses(sim: Sim, segId: number, road: RoadTypeId, earth: EarthPlan | null): number[] {
  const net = sim.net;
  const from = net.segment(segId).type;
  // A change of type re-suffixes the street's name (P10), and not always reversibly: keep it.
  const name = net.segment(segId).name;
  const blocks = [net.segment(segId).left, net.segment(segId).right].filter((b): b is number => !!b);
  const wasDirty = {
    seg: net.dirty.segments.has(segId),
    blocks: blocks.filter((b) => net.dirty.blocks.has(b)),
  };
  const t = sim.terrain;
  const heights = earth?.idx.map((i) => t.heights[i]!) ?? [];
  try {
    net.setSegmentType(segId, road);
    earth?.idx.forEach((i, n) => (t.heights[i] = settledHeight(t.base[i]!, earth.to[n]!)));
    return net.revalidate(upgradeBox(sim, segId, earth), true);
  } finally {
    earth?.idx.forEach((i, n) => (t.heights[i] = heights[n]!));
    net.setSegmentType(segId, from);
    if (name === undefined) delete net.segment(segId).name;
    else net.segment(segId).name = name;
    if (!wasDirty.seg) net.dirty.segments.delete(segId);
    for (const b of blocks) if (!wasDirty.blocks.includes(b)) net.dirty.blocks.delete(b);
  }
}

type Box = { minX: number; minZ: number; maxX: number; maxZ: number };
const union = (a: Box, b: Box): Box => ({
  minX: Math.min(a.minX, b.minX),
  minZ: Math.min(a.minZ, b.minZ),
  maxX: Math.max(a.maxX, b.maxX),
  maxZ: Math.max(a.maxZ, b.maxZ),
});

/**
 * Grading for a road changed to `road` (M13): a profile within the new type's limit between the
 * road's two junctions and the earthworks for it, or why it can't be done.
 */
function regrade(
  sim: Sim,
  segId: number,
  road: RoadTypeId,
): { earth: EarthPlan | null; reason?: string; at?: Vec2 } {
  const seg = sim.net.segment(segId);
  const curve = sim.net.curve(segId);
  const limit = ROAD_TYPES[road].maxGrade;
  const name = articled(ROAD_TYPES[road].name);
  const deck = sim.deck(segId);
  if (deck) {
    // A bridge or viaduct: check the deck's climb over any 16 m.
    const w = Math.max(1, Math.round(16 / deck.step));
    for (let i = 0; i + w < deck.h.length; i++) {
      const g = Math.abs(deck.h[i + w]! - deck.h[i]!) / (w * deck.step);
      if (g > limit * 1.02)
        return {
          earth: null,
          reason: `Too steep for ${name}: this bridge climbs ${Math.round(g * 100)}\u00a0% and ${name} can climb ${Math.round(limit * 100)}\u00a0%`,
          at: curve.pointAt(Math.min(curve.length, i * deck.step)),
        };
    }
    return { earth: null };
  }
  const A = sim.net.node(seg.a);
  const B = sim.net.node(seg.b);
  const fine = new Curve(curve.a, curve.c, curve.b, 4);
  const heightAt = (x: number, z: number) => sim.terrain.heightAt(x, z);
  const prof = gradeProfile(fine, heightAt, road, heightAt(A.x, A.z), heightAt(B.x, B.z));
  if (prof.fail) return { earth: null, reason: prof.fail.reason, at: fine.pointAt(prof.s[prof.fail.at]!) };
  if (prof.raisedLength > 0)
    return {
      earth: null,
      reason: `Too steep for ${name}: it would need a ${Math.round(prof.maxFill)} m embankment here. Rebuild it as a new road to carry it on a viaduct`,
      at: fine.pointAt(prof.s[prof.raised.indexOf(1)]!),
    };
  const earth = planEarthworks(
    sim.terrain,
    sim.net,
    [{ curve: fine, type: road, prof, joined: [true, true] }],
    keepUnder(sim, new Set()),
    new Set([segId]),
  );
  return { earth };
}

function articled(name: string): string {
  return /^[aeiou]/i.test(name) ? `an ${name.toLowerCase()}` : `a ${name.toLowerCase()}`;
}

export function bulldoze(sim: Sim, target: BulldozeTarget, dryRun: boolean): CommandResult {
  if (target.kind === 'segment') {
    const seg = sim.state.net.segments.get(target.id);
    if (!seg) return fail('Nothing to bulldoze');
    if (!ROAD_TYPES[seg.type].buildable)
      return fail(
        seg.type === 'mainline'
          ? "The regional railway can't be bulldozed"
          : "The regional highway can't be bulldozed",
      );
    const len = sim.net.curve(seg.id).length;
    const refund = Math.round(len * ROAD_TYPES[seg.type].costPerMetre * ROAD_RULES.bulldozeRefund);
    const buildings = new Set<number>();
    for (const bid of [seg.left, seg.right]) {
      const b = bid ? sim.state.net.blocks.get(bid) : undefined;
      if (b) for (const x of b.bld) if (x) buildings.add(x);
    }
    const info = { refund, buildings: [...buildings].sort((a, b) => a - b) };
    if (dryRun) return ok(-refund, { info });
    const box = sim.net.segmentInfluenceBox(seg.id);
    const { a, b } = seg;
    sim.net.removeSegment(seg.id);
    sim.net.removeNodeIfOrphan(a);
    sim.net.removeNodeIfOrphan(b);
    sim.net.revalidate(box);
    sim.earn(refund, 'refunds');
    sim.markNetworkChanged();
    return ok(-refund, { info });
  }
  if (target.kind === 'civic') return bulldozeCivic(sim, target.id, dryRun);
  if (target.kind === 'stop') return removeStop(sim, target.id, dryRun);
  if (target.kind === 'building') {
    const b = sim.state.buildings.get(target.id);
    if (!b) return fail('Nothing to bulldoze');
    if (dryRun) return ok(0, { info: { refund: 0, buildings: [b.id] } });
    sim.removeBuilding(b.id);
    return ok(0, { info: { refund: 0, buildings: [b.id] } });
  }
  return fail('Nothing to bulldoze');
}

/** Buildings whose footprints a planned road would run through (they get demolished). */
export function buildingsInTheWay(
  sim: Sim,
  pieces: { a: Vec2; c: Vec2; b: Vec2 }[],
  type: RoadTypeId,
): number[] {
  const hw = roadHalfWidth(type);
  const out = new Set<number>();
  for (const p of pieces) {
    const curve = new Curve(p.a, p.c, p.b, 2);
    const box = curve.bbox(hw + 40);
    for (const id of sim.bldHash.query(box)) {
      const b = sim.state.buildings.get(id)!;
      const r = footprint(b, 0.5);
      for (let i = 0; i < curve.xs.length; i++) {
        if (pointRectDistance({ x: curve.xs[i]!, z: curve.zs[i]! }, r) < hw) {
          out.add(id);
          break;
        }
      }
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * What a planned road joins (P1): 'highway' if one of its ends or crossings meets a road that
 * reaches the highway, 'island' if it meets only roads that don't, 'none' if it meets no road at
 * all. Undefined for roads nothing stands along (railways, ramps, city highways).
 */
function linkInfo(sim: Sim, plan: RoadPlan): 'highway' | 'island' | 'none' | undefined {
  if (!plan.pieces.length || !ROAD_TYPES[plan.type].access) return undefined;
  let joined = false;
  for (const p of plan.pieces)
    for (const e of [p.ea, p.eb]) {
      const segs = e.kind === 'node' ? sim.net.segmentsAt(e.id) : e.kind === 'split' ? [e.seg] : [];
      for (const sid of segs) {
        // A level crossing isn't a join.
        if (isRail(sim.net.segment(sid).type)) continue;
        joined = true;
        if (sim.isSegmentConnected(sid)) return 'highway';
      }
    }
  return joined ? 'island' : 'none';
}

/**
 * The buildings a planned road will demolish (P2), as building it judges them: lots its surface
 * covers (a curve as the network makes a segment's), and lots lost where it splits a street.
 */
function roadLosses(sim: Sim, plan: RoadPlan): number[] {
  const out = new Set<number>();
  const hw = roadHalfWidth(plan.type);
  for (const p of plan.pieces)
    for (const id of sim.net.buildingsUnder(new Curve(p.a, p.c, p.b), hw)) out.add(id);
  for (const sp of plan.splits) for (const id of sim.net.splitLosses(sp.seg, sp.s)) out.add(id);
  return [...out].sort((a, b) => a - b);
}

/** Thin the tree-density grid under new roads (the renderer also hides individual trees). */
/** Thin out trees within `r` metres of `c` (a roundabout's ring and island, M19). */
function clearTreesIn(sim: Sim, c: Vec2, r: number): void {
  const trees = sim.state.trees;
  const i0 = Math.max(0, Math.floor((c.x - r) / GRID_CELL));
  const i1 = Math.min(GRID_RES - 1, Math.floor((c.x + r) / GRID_CELL));
  const j0 = Math.max(0, Math.floor((c.z - r) / GRID_CELL));
  const j1 = Math.min(GRID_RES - 1, Math.floor((c.z + r) / GRID_CELL));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const k = j * GRID_RES + i;
      if (!trees[k]) continue;
      let hit = 0;
      for (let u = 0; u < 4; u++)
        for (let v = 0; v < 4; v++) {
          const x = (i + (u + 0.5) / 4) * GRID_CELL;
          const z = (j + (v + 0.5) / 4) * GRID_CELL;
          if (Math.hypot(x - c.x, z - c.z) <= r) hit++;
        }
      const next = Math.round(trees[k]! * (1 - hit / 16));
      if (next !== trees[k]) {
        trees[k] = next;
        sim.markTreesDirty(k);
      }
    }
}

export function clearTreesAlong(sim: Sim, segments: number[]): void {
  const trees = sim.state.trees;
  for (const id of segments) {
    const curve = sim.net.curve(id);
    const hw = roadHalfWidth(sim.net.segment(id).type) + 1;
    const box = curve.bbox(hw);
    const i0 = Math.max(0, Math.floor(box.minX / GRID_CELL));
    const i1 = Math.min(GRID_RES - 1, Math.floor(box.maxX / GRID_CELL));
    const j0 = Math.max(0, Math.floor(box.minZ / GRID_CELL));
    const j1 = Math.min(GRID_RES - 1, Math.floor(box.maxZ / GRID_CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * GRID_RES + i;
        if (!trees[k]) continue;
        let hit = 0;
        for (let u = 0; u < 4; u++) {
          for (let v = 0; v < 4; v++) {
            const p = { x: (i + (u + 0.5) / 4) * GRID_CELL, z: (j + (v + 0.5) / 4) * GRID_CELL };
            if (curve.project(p).d <= hw) hit++;
          }
        }
        if (!hit) continue;
        const next = Math.round(trees[k]! * (1 - hit / 16));
        if (next !== trees[k]) {
          trees[k] = next;
          sim.markTreesDirty(k);
        }
      }
    }
  }
}

/**
 * Make a road one-way or two-way again (M19): 1 runs from its start node to its end node, -1 the
 * other way. Signs and paint only, so it's free; the regional highway can't be changed.
 */
export function setOneWay(sim: Sim, segId: number, dir: 0 | 1 | -1, dryRun: boolean): CommandResult {
  const seg = sim.state.net.segments.get(segId);
  if (!seg) return fail('No road here');
  if (!ROAD_TYPES[seg.type].buildable) return fail("The regional highway can't be changed");
  if (dir !== 0 && dir !== 1 && dir !== -1) return fail('Invalid direction');
  if (dir === 0 && ROAD_TYPES[seg.type].oneWay) return fail('A ramp is always one-way');
  if (isRail(seg.type)) return fail('Railways have a track each way');
  if ((seg.oneway ?? 0) === dir)
    return fail(dir ? 'This road already runs that way' : 'This road is already two-way');
  if (dryRun) return ok(0);
  if (dir) seg.oneway = dir;
  else delete seg.oneway;
  sim.net.dirty.segments.add(segId);
  sim.markNetworkChanged();
  return ok(0);
}

/**
 * Lay tram track along a road, or take it up (M20). Track goes on streets, avenues and boulevards,
 * costs TRAM.trackCost a metre and is taken up for nothing.
 */
export function setTram(sim: Sim, segId: number, on: boolean, dryRun: boolean): CommandResult {
  const s = sim.state;
  const seg = s.net.segments.get(segId);
  if (!seg) return fail('No road here');
  const curve = sim.net.curve(segId);
  const at = curve.pointAt(curve.length / 2);
  if (!on) {
    if (!seg.tram) return fail('No tram track here', { at });
    if (dryRun) return ok(0);
    delete seg.tram;
  } else {
    if (seg.tram) return fail('This road already has tram track', { at });
    if (!ROAD_TYPES[seg.type].tram) return fail('Tram track goes on streets, avenues and boulevards', { at });
    if (!sim.isUnlocked(TRAM.unlockPopulation))
      return fail(`Trams unlock at ${TRAM.unlockPopulation.toLocaleString('en-US')} residents`, { at });
    const cost = Math.round(curve.length * TRAM.trackCost);
    if (cost > s.treasury && !s.options.sandbox) return fail('Not enough money', { at });
    if (dryRun) return ok(cost, { info: { length: Math.round(curve.length) } });
    seg.tram = true;
    sim.spend(cost, 'roads');
  }
  sim.net.dirty.segments.add(segId);
  sim.markNetworkChanged();
  return ok(on ? Math.round(curve.length * TRAM.trackCost) : 0);
}

/** Where a roundabout goes: a junction, or a point along a road that will be split there. */
type RoundaboutSite = RingSite;

const WHAT: Record<ArmEnd, string> = {
  junction: 'the next junction',
  ring: 'another roundabout',
  bend: 'a bend',
  end: 'the end of the road',
};

/**
 * Put a roundabout on a junction, or on a road at `at` (M19). `radius` is the ring's centre line;
 * without one the site gets the usual size for the widest road meeting it, or the largest smaller
 * one that fits, down to a mini roundabout (P5). Each road meeting the ring is measured through
 * bends to the next junction, and needs room past the ring's outer edge: 14 m to a junction or
 * another ring, 6 m to a bend or a dead end. A bend inside the ring is taken in, the road into it
 * rebuilt straight, when no ring fits otherwise. A refusal says which road is short, what's in the
 * way and how much room is missing; buildings on the ring are demolished; civic buildings and other
 * roads stop it.
 */
export function placeRoundabout(
  sim: Sim,
  at: { node?: number; x?: number; z?: number },
  radius: number | undefined,
  dryRun: boolean,
): CommandResult {
  const net = sim.net;
  const st = sim.state.net;
  if (radius !== undefined && !Number.isFinite(radius)) return fail('No such size of roundabout');
  let site: RoundaboutSite | null = null;
  if (at.node !== undefined) {
    if (!st.nodes.has(at.node)) return fail('No junction here');
    site = { node: at.node };
  } else if (at.x !== undefined && at.z !== undefined && Number.isFinite(at.x) && Number.isFinite(at.z)) {
    const p = { x: at.x, z: at.z };
    const n = net.nearestNode(p, 10);
    if (n) site = { node: n.id };
    else {
      const hit = net.nearestSegment(p, 8);
      if (hit) site = { seg: hit.seg, s: hit.s, x: hit.x, z: hit.z };
    }
  }
  if (!site) return fail('Put a roundabout on a junction or a road');
  const onRail =
    'node' in site
      ? net.segmentsAt(site.node).some((id) => isRail(net.segment(id).type))
      : isRail(net.segment(site.seg).type);
  if (onRail) return fail("A roundabout can't go on a railway or a level crossing");
  const centre = 'node' in site ? net.node(site.node) : { x: site.x, z: site.z };
  if ('node' in site && net.node(site.node).roundabout) return fail('There is already a roundabout here');
  // The roads that will meet the ring, each measured out to what stops it.
  const arms = ringArms(net, site);
  if (arms.length < 2) return fail('A roundabout needs at least two roads meeting it');
  let widest: RoadTypeId = 'street';
  for (const a of arms) {
    const t = net.segment(a.seg).type;
    if (!ROAD_TYPES[t].buildable) return fail("The regional highway can't have a roundabout");
    if (!ROAD_TYPES[t].access) return fail('Roundabouts are for local roads: the city highway uses ramps');
    if (roadHalfWidth(t) > roadHalfWidth(widest)) widest = t;
  }
  const { mini } = ringSizes(widest);
  const ladder = ringLadder(widest);
  const sizes =
    radius === undefined ? ladder : [Math.min(JUNCTION.maxRadius, Math.max(mini, Math.round(radius)))];
  // What's near, gathered once for the largest ring tried (the tool previews on every move).
  const reach = ringOuter(Math.max(...sizes));
  const nearRoads = net.segHash.queryPoint(centre.x, centre.z, reach + 30);
  const nearRings = net
    .nodesIn({
      minX: centre.x - reach - JUNCTION.maxRadius,
      minZ: centre.z - reach - JUNCTION.maxRadius,
      maxX: centre.x + reach + JUNCTION.maxRadius,
      maxZ: centre.z + reach + JUNCTION.maxRadius,
    })
    .filter((n) => n.roundabout && ('node' in site ? n.id !== site.node : true));
  const box = (outer: number): Box => ({
    minX: centre.x - outer,
    minZ: centre.z - outer,
    maxX: centre.x + outer,
    maxZ: centre.z + outer,
  });
  type Fit =
    | { ok: true; r: number; doomed: number[]; straighten: Straightening[] }
    | { ok: false; reason: string; at: Vec2; short?: ArmShortfall };
  const fit = (r: number, takeIn: boolean): Fit => {
    const outer = ringOuter(r);
    const straighten: Straightening[] = [];
    const short = shortfalls(arms, r);
    for (const sf of short) {
      const st =
        takeIn && sf.bendInside && 'node' in site ? planStraighten(net, site.node, sf.arm, outer) : null;
      if (!st) return { ok: false, reason: '', at: net.node(sf.node), short: sf };
      straighten.push(st);
    }
    // Two bends on the one road (it loops back into the junction): refused, not half done.
    if (straighteningsOverlap(straighten))
      return { ok: false, reason: 'The roads into the ring loop round into each other', at: centre };
    // Other roads through the ring (an arm's own road beyond its first junction may come near).
    const own = new Set(arms.map((a) => a.seg));
    const later = new Set(arms.flatMap((a) => a.chain.slice(1)));
    const gone = new Set(straighten.flatMap((t) => t.arm.chain.slice(0, t.k + 1)));
    for (const sid of nearRoads) {
      if (own.has(sid) || gone.has(sid)) continue;
      const seg = net.segment(sid);
      if ('node' in site && (seg.a === site.node || seg.b === site.node)) continue;
      const d = net.curve(sid).project(centre).d;
      if (later.has(sid) ? d < outer : d < outer + net.halfWidth(sid))
        return { ok: false, reason: 'Another road is in the way of the ring', at: centre };
    }
    for (const n of nearRings)
      if (Math.hypot(n.x - centre.x, n.z - centre.z) < outer + n.roundabout! + JUNCTION.ringWidth + 8)
        return { ok: false, reason: 'Too close to another roundabout', at: centre };
    // Civic buildings on the ring stop it; zoned buildings are demolished.
    for (const c of sim.state.civics.values())
      if (pointRectDistance(centre, civicRect(c)) < outer)
        return { ok: false, reason: 'A building is in the way of the ring', at: centre };
    const doomed = new Set<number>();
    for (const id of sim.bldHash.query(box(outer))) {
      const b = sim.state.buildings.get(id)!;
      if (pointRectDistance(centre, footprint(b)) < outer) doomed.add(id);
    }
    for (const t of straighten) for (const id of straightenLosses(net, t)) doomed.add(id);
    return { ok: true, r, doomed: [...doomed].sort((a, b) => a - b), straighten };
  };
  // A smaller ring that leaves the roads alone beats a bigger one that rebuilds a road.
  let chosen: Extract<Fit, { ok: true }> | null = null;
  let refusal: Extract<Fit, { ok: false }> | null = null;
  for (const takeIn of [false, true]) {
    for (const r of sizes) {
      const f = fit(r, takeIn);
      if (f.ok) {
        chosen = f;
        break;
      }
      // The smallest size tried explains a refusal best, short of room before anything else.
      if (!takeIn && (!refusal || f.short || !refusal.short)) refusal = f;
    }
    if (chosen) break;
  }
  if (!chosen) {
    const tried = sizes[sizes.length - 1]!;
    const f = refusal!;
    // The largest smaller size that would fit, for the tool's [ ].
    let fits = 0;
    if (radius !== undefined)
      for (const r of ladder.filter((x) => x < tried))
        if (fit(r, false).ok || fit(r, true).ok) {
          fits = r;
          break;
        }
    const info: Record<string, unknown> = { radius: tried, minRadius: mini, fits };
    if (!f.short) return fail(f.reason, { at: f.at, info });
    const sf = f.short;
    const have = Math.round(sf.have);
    const need = Math.ceil(sf.need);
    info.short = {
      seg: sf.arm.seg,
      segs: sf.arm.chain,
      at: { x: f.at.x, z: f.at.z },
      have,
      need,
      missing: need - have,
      what: sf.what,
      dir: compass(sf.arm.dir.x, sf.arm.dir.z),
    };
    const size =
      radius === undefined
        ? 'No room for even a mini roundabout'
        : `No room for a roundabout ${2 * tried} m across`;
    const smaller = fits ? ` One up to ${2 * fits} m across would fit.` : '';
    return fail(
      `${size}: the road ${compass(sf.arm.dir.x, sf.arm.dir.z)} runs ${have} m to ${WHAT[sf.what]}, and a ring needs ${need} m.${smaller}`,
      { at: f.at, info },
    );
  }
  const r = chosen.r;
  const outer = ringOuter(r);
  const cost = Math.round(2 * Math.PI * r * JUNCTION.costPerMetre);
  const info = {
    radius: r,
    minRadius: mini,
    demolish: chosen.doomed.length,
    demolished: chosen.doomed,
    arms: arms.length,
    straightened: chosen.straighten.length,
  };
  if (cost > sim.state.treasury && !sim.state.options.sandbox)
    return fail('Not enough money', { at: centre, info });
  if (dryRun) return ok(cost, { info });
  let nodeId: number;
  if ('node' in site) nodeId = site.node;
  else nodeId = net.splitSegment(site.seg, site.s).node.id;
  for (const t of chosen.straighten) straighten(net, nodeId, t);
  for (const id of chosen.doomed) if (sim.state.buildings.has(id)) sim.removeBuilding(id);
  clearTreesIn(sim, centre, outer + 1);
  net.node(nodeId).roundabout = r;
  net.dirty.nodes.add(nodeId);
  const b = box(outer + 20);
  net.revalidate(b);
  sim.spend(cost, 'roads');
  sim.markNetworkChanged();
  return ok(cost, { created: [nodeId], info });
}

/** Take a roundabout out, leaving an ordinary junction (a share of its price back). */
export function removeRoundabout(sim: Sim, nodeId: number, dryRun: boolean): CommandResult {
  const n = sim.state.net.nodes.get(nodeId);
  if (!n?.roundabout) return fail('No roundabout here');
  const refund = Math.round(2 * Math.PI * n.roundabout * JUNCTION.costPerMetre * ROAD_RULES.bulldozeRefund);
  if (dryRun) return ok(-refund);
  const r = n.roundabout + JUNCTION.ringWidth + 20;
  delete n.roundabout;
  sim.net.dirty.nodes.add(nodeId);
  sim.net.revalidate({ minX: n.x - r, minZ: n.z - r, maxX: n.x + r, maxZ: n.z + r });
  sim.earn(refund, 'refunds');
  sim.markNetworkChanged();
  return ok(-refund);
}
