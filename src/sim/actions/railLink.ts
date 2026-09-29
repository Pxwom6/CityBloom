import { CIVIC } from '../../data/civic';
import { ROAD_TYPES } from '../../data/roads';
import { HIGHWAY_CONNECT_X, MAP_SIZE, SHORE_HEIGHT } from '../../data/world';
import { fail, ok, type CommandResult } from '../commands';
import { pointRectDistance, rectsOverlap, type ORect, type Vec2 } from '../geom';
import type { Sim } from '../sim';
import { ENTRY_SPACING } from '../terrain/customMap';
import { clearTreesUnder, footprint as zonedFootprint } from '../world/buildings';
import { civicRect, type Civic } from '../world/civic';

/**
 * A regional rail link placed by the player (Phase 2 review). A city founded before M20 got its
 * link on loading only if an empty, flat 160 m stretch of the west edge was free; one whose edge
 * was built up got none, for good. While a city has no link, it can lay one anywhere along the
 * west edge at least 160 m from the highway: the same mainline link a new city starts with, plus a
 * small junction building beside it for the inspector. It clears homes and businesses in its way,
 * and refuses civic buildings, roads, water and steep ground.
 */

/** The junction building stands beside the track, just inside the map edge. */
const BOX_X = 14;
/** How far off the edge of the map the link's ground must be clear (its track, its building). */
const CLEAR_TO_X = HIGHWAY_CONNECT_X + 6;
/** Most the ground may rise or fall under the link and its building (m). */
const MAX_RISE = 4;

export interface RailLinkPlan {
  ok: boolean;
  reason?: string;
  /** Where the link comes in (m from the north edge). */
  z: number;
  /** The junction building's pose. */
  box: { x: number; z: number; angle: number; side: 1 | -1 };
  /** Zoned buildings cleared for it. */
  demolish: number[];
  cost: number;
}

/** Why this city can't lay a regional rail link now (null: it can). */
export function railLinkUnavailable(sim: Sim): string | null {
  const s = sim.state;
  if (s.railway) return 'The city already has its regional rail link';
  if (s.options.editor) return 'Not in the map editor';
  if (s.scenario) return 'Scenarios keep the railway they were set with';
  if (s.map && s.map.railZ === null) return 'This map was made without a railway';
  const def = CIVIC.get('raillink')!;
  if (!sim.isUnlocked(def.unlockPopulation))
    return `Unlocks at ${def.unlockPopulation.toLocaleString('en-US')} residents`;
  return null;
}

/** Whether the toolbar offers a link at all (it may still be locked). */
export function railLinkOffered(sim: Sim): boolean {
  const s = sim.state;
  return !s.railway && !s.options.editor && !s.scenario && !(s.map && s.map.railZ === null);
}

/** The link's track inside the map, as a rectangle (x from the edge to its end). */
function trackRect(z: number): ORect {
  const half = ROAD_TYPES.mainline.width / 2 + ROAD_TYPES.mainline.sidewalk + 1;
  return { x: CLEAR_TO_X / 2, z, hw: CLEAR_TO_X / 2, hd: half, angle: 0 };
}

export function planRailLink(sim: Sim, zIn: number): RailLinkPlan {
  const z = Math.round(zIn);
  const def = CIVIC.get('raillink')!;
  const half = ROAD_TYPES.mainline.width / 2 + ROAD_TYPES.mainline.sidewalk;
  const hw = sim.terrain.gen.params.highway;
  const away = z >= hw.connectZ ? 1 : -1;
  // The building on the side away from the highway (awayDir with angle 0 is (0, −side)).
  const box = { x: BOX_X, z: z + away * (half + def.d / 2 + 1), angle: 0, side: -away as 1 | -1 };
  const plan: RailLinkPlan = { ok: false, z, box, demolish: [], cost: def.cost };
  const no = (reason: string): RailLinkPlan => ({ ...plan, reason });
  const why = railLinkUnavailable(sim);
  if (why) return no(why);
  if (!Number.isFinite(z) || z < 120 || z > MAP_SIZE - 120) return no('Too close to the corner of the map');
  if (Math.abs(z - hw.connectZ) < ENTRY_SPACING)
    return no(`At least ${ENTRY_SPACING} m from the highway, so the two don't cross`);
  const rects = [trackRect(z), civicRect({ ...box, def: 'raillink' })];
  // Dry, gentle ground under the track and the building.
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of rects)
    for (let u = -1; u <= 1; u += 0.5)
      for (let v = -1; v <= 1; v += 0.5) {
        const x = Math.max(0, r.x + u * r.hw);
        const h = sim.terrain.heightAt(x, r.z + v * r.hd);
        if (h < SHORE_HEIGHT + 0.5) return no("The railway can't come in over water");
        lo = Math.min(lo, h);
        hi = Math.max(hi, h);
      }
  if (hi - lo > MAX_RISE) return no('Too steep here for the railway');
  // Roads and civic buildings stay; zoned buildings in the way are cleared.
  for (const r of rects) {
    const reach = Math.hypot(r.hw, r.hd);
    for (const sid of sim.net.segHash.queryPoint(r.x, r.z, reach + 20)) {
      const curve = sim.net.curve(sid);
      const w = sim.net.halfWidth(sid);
      for (let i = 0; i < curve.xs.length; i++)
        if (pointRectDistance({ x: curve.xs[i]!, z: curve.zs[i]! }, r) < w)
          return no('A road is in the way: move along the edge, or bulldoze it first');
    }
    for (const id of sim.civHash.queryPoint(r.x, r.z, reach + 80))
      if (rectsOverlap(r, civicRect(sim.state.civics.get(id)!)))
        return no(`The ${CIVIC.get(sim.state.civics.get(id)!.def)!.name.toLowerCase()} is in the way`);
    for (const id of sim.bldHash.queryPoint(r.x, r.z, reach + 40)) {
      const b = sim.state.buildings.get(id)!;
      if (!plan.demolish.includes(id) && rectsOverlap(r, zonedFootprint(b, 0.5))) plan.demolish.push(id);
    }
  }
  plan.demolish.sort((a, b) => a - b);
  if (!sim.state.options.sandbox && sim.state.treasury < def.cost) return no('Not enough money');
  return { ...plan, ok: true };
}

/** What the preview shows: the track's line and the buildings it clears. */
export function railLinkInfo(sim: Sim, plan: RailLinkPlan): Record<string, unknown> {
  const hw = sim.terrain.gen.params.highway;
  const clear = plan.demolish.map((id) => {
    const r = zonedFootprint(sim.state.buildings.get(id)!, 0);
    return { x: r.x, z: r.z, hw: r.hw, hd: r.hd, angle: r.angle };
  });
  const track: { a: Vec2; b: Vec2 } = {
    a: { x: hw.lineX, z: plan.z },
    b: { x: HIGHWAY_CONNECT_X, z: plan.z },
  };
  return { demolish: plan.demolish.length, clear, track, box: plan.box, z: plan.z };
}

export function buildRailLink(sim: Sim, z: number, dryRun: boolean): CommandResult {
  const plan = planRailLink(sim, z);
  const info = railLinkInfo(sim, plan);
  if (!plan.ok) return fail(plan.reason ?? "Can't lay the link here", { at: { x: 0, z: plan.z }, info });
  if (dryRun) return ok(plan.cost, { info });
  for (const id of plan.demolish) sim.removeBuilding(id);
  const seg = sim.layRailway(plan.z);
  const s = sim.state;
  const civ: Civic = {
    id: s.nextId++,
    def: 'raillink',
    x: plan.box.x,
    z: plan.box.z,
    y: sim.terrain.heightAt(plan.box.x, plan.box.z),
    angle: plan.box.angle,
    side: plan.box.side,
    access: { seg, s: sim.net.curve(seg).length - (HIGHWAY_CONNECT_X - plan.box.x) },
    stored: 0,
    processedToday: 0,
    lastDay: 0,
    out: 0,
    cost: plan.cost,
    born: s.tick,
    variant: sim.rng.world.int(1 << 16),
    damage: 0,
    flooded: false,
    modules: [],
  };
  sim.addCivic(civ);
  sim.spend(plan.cost, 'construction');
  clearTreesUnder(sim, civicRect(civ, 0));
  clearTreesUnder(sim, trackRect(plan.z));
  return ok(plan.cost, { created: [civ.id], info });
}
