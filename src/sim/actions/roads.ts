import { ROAD_RULES, ROAD_TYPES, roadHalfWidth, type RoadTypeId } from '../../data/roads';
import { GRID_CELL, GRID_RES } from '../../data/world';
import { fail, ok, type BulldozeTarget, type CommandResult } from '../commands';
import { Curve, pointRectDistance, type Vec2 } from '../geom';
import { footprint } from '../world/buildings';
import { bulldozeCivic, civicRect } from '../world/civic';
import type { Sim } from '../sim';
import { applyRoadPlan, planRoad, type RoadPlan } from '../world/roadPlanner';
import { planEarthworks, reshapeGround, type EarthPlan } from '../world/earthworks';
import { gradeProfile } from '../world/grading';
import { removeStop } from '../systems/transit';

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
  const preview = {
    pieces: plan.pieces.map((p) => ({ a: p.a, c: p.c, b: p.b })),
    length: plan.length,
    splits: plan.splits.length,
    demolish: doomed.size,
    grade: gradeInfo(plan),
  };
  if (!plan.ok) return fail(plan.reason ?? 'Invalid road', { at: plan.at, info: preview });
  if (dryRun) return ok(plan.cost, { info: preview });
  plan.oneway = oneway;
  const res = applyRoadPlan(sim.net, plan, () => {
    if (!plan.earth?.idx.length) return null;
    reshapeGround(sim, plan.earth.idx, plan.earth.to);
    return plan.earth.box;
  });
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
  const locked = roadLocked(sim, road);
  if (locked) return fail(locked);
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
  };
  if (dryRun) return ok(total, { info });
  sim.net.setSegmentType(segId, road);
  if (earth?.idx.length) reshapeGround(sim, earth.idx, earth.to);
  sim.relocateBuildingsOn(segId);
  const around = sim.net.segmentInfluenceBox(segId);
  sim.net.revalidate(earth?.box ? union(around, earth.box) : around);
  sim.spend(total, 'roads');
  clearTreesAlong(sim, [segId]);
  sim.markNetworkChanged();
  return ok(total, { info });
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
    if (!ROAD_TYPES[seg.type].buildable) return fail("The regional highway can't be bulldozed");
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

/** Thin the tree-density grid under new roads (the renderer also hides individual trees). */
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
  if ((seg.oneway ?? 0) === dir)
    return fail(dir ? 'This road already runs that way' : 'This road is already two-way');
  if (dryRun) return ok(0);
  if (dir) seg.oneway = dir;
  else delete seg.oneway;
  sim.net.dirty.segments.add(segId);
  sim.markNetworkChanged();
  return ok(0);
}
