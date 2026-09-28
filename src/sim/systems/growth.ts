import { EDUCATION, GROWTH } from '../../data/balance';
import {
  DENSITY_UNLOCK_POPULATION,
  ZONED_DEFS,
  zonedDef,
  type Density,
  type Level,
  type Wealth,
  type ZonedDef,
} from '../../data/buildings';
import { ROAD_TYPES } from '../../data/roads';
import { CELL, ROWS, ZONE_I, ZONE_R, type ZoneCode } from '../../data/zones';
import { angleDiff } from '../geom';
import type { Sim } from '../sim';
import { coverageOnSegment } from './services';
import {
  BState,
  buildingCapacity,
  clearTreesUnder,
  footprint,
  placeOnLot,
  setLotCells,
  type Building,
} from '../world/buildings';
import type { ZoneBlock } from '../world/network';
import { computeHappiness } from './happiness';
import { toRubble } from './incidents';
import { landValueAt } from './landValue';
import { educationCap, welcome } from './health';

const ZONE_KEY = ['R', 'R', 'C', 'I'] as const;

export function wealthFromLandValue(lv: number): Wealth {
  return lv < 0.4 ? 0 : lv < 0.7 ? 1 : 2;
}

/**
 * High wealth only moves where fire, police and health care all reach (DESIGN §3.4). Reads the
 * coverage at distance `s` along the lot's own road `seg`.
 */
export function maxWealth(sim: Sim, seg: number, s: number): Wealth {
  const cov = sim.coverage;
  const len = sim.net.curve(seg).length;
  const ok = (['fire', 'police', 'health'] as const).every(
    (k) => coverageOnSegment(cov, k, seg, s, len) >= 0.4,
  );
  return ok ? 2 : 1;
}

export function unlockedDensity(sim: Sim): Density {
  if (sim.reached(DENSITY_UNLOCK_POPULATION[2]) && !sim.policy('highRiseBan')) return 2;
  return sim.reached(DENSITY_UNLOCK_POPULATION[1]) ? 1 : 0;
}

/**
 * Densest buildings allowed at (x, z) (M21): a high-rise ban or a heritage district there keeps new
 * buildings to medium density.
 */
export function densityAt(sim: Sim, dens: Density, x: number, z: number): Density {
  if (dens < 2) return dens;
  return sim.policyAt('highRiseBan', x, z) || sim.policyAt('heritage', x, z) ? 1 : dens;
}

function lotFits(
  sim: Sim,
  block: ZoneBlock,
  col: number,
  w: number,
  d: number,
  zone: ZoneCode,
  self = 0,
): boolean {
  if (col < 0 || col + w > block.cols || d > ROWS) return false;
  for (let c = col; c < col + w; c++) {
    for (let r = 0; r < d; r++) {
      const i = c * ROWS + r;
      if (!block.valid[i] || block.zone[i] !== zone) return false;
      if (block.bld[i] && block.bld[i] !== self) return false;
    }
    if (
      c > col &&
      angleDiff(sim.net.cellAngle(block.id, c * ROWS), sim.net.cellAngle(block.id, (c - 1) * ROWS)) >
        GROWTH.maxLotBend
    )
      return false;
  }
  // Terrain rise across the lot.
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of [col, col + w - 1]) {
    for (const r of [0, d - 1]) {
      const p = sim.net.cellCenter(block.id, c * ROWS + r);
      const h = sim.terrain.heightAt(p.x, p.z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  }
  return hi - lo <= GROWTH.maxLotRise;
}

function spawnDemand(sim: Sim, zone: ZoneCode, wealth: Wealth): number {
  const d = sim.state.demand;
  const base = zone === ZONE_R ? d.R : zone === ZONE_I ? d.I : d.C;
  // Per-wealth tax: each point above neutral lowers that wealth's spawn chance.
  const tax = sim.taxRate(ZONE_KEY[zone]!, wealth);
  return base - 0.04 * (tax - 9) + 0.04 * (sim.avgTax(ZONE_KEY[zone]!) - 9);
}

function maxConstructions(sim: Sim): number {
  return (
    GROWTH.baseConstructions + Math.ceil(sim.state.totals.population * GROWTH.constructionsPerPopulation)
  );
}

export function createBuilding(sim: Sim, block: ZoneBlock, col: number, def: ZonedDef): Building {
  const s = sim.state;
  const b: Building = {
    id: s.nextId++,
    def: def.id,
    zone: def.zone,
    density: def.density,
    wealth: def.wealth,
    level: def.level,
    block: block.id,
    col,
    w: def.w,
    d: def.d,
    x: 0,
    z: 0,
    y: 0,
    angle: 0,
    side: block.side,
    state: BState.Construction,
    progress: 0,
    pop: 0,
    cap: 0,
    employed: 0,
    seekers: 0,
    commute: 0,
    shop: 0,
    happiness: 0.55,
    distress: 0,
    power: 1,
    water: 1,
    sewage: 1,
    polluted: 0,
    garbage: 0,
    noPowerH: 0,
    noWaterH: 0,
    closed: false,
    covFire: 0,
    covPolice: 0,
    covHealth: 0,
    covEdu: 0,
    covPark: 0,
    fire: 0,
    burn: 0,
    rubbleH: 0,
    flooded: 0,
    sick: 0,
    treated: 0,
    edu: def.zone === ZONE_R ? EDUCATION.newcomer : 0,
    seat1: 0,
    seat2: 0,
    seat3: 0,
    good: 0,
    variant: sim.rng.growth.int(1 << 16),
    born: s.tick,
  };
  placeOnLot(sim, b);
  s.buildings.set(b.id, b);
  setLotCells(sim, b, b.id);
  clearTreesUnder(sim, footprint(b, 1));
  sim.markBuildingDirty(b.id);
  return b;
}

/** Growth pass every GROWTH.passInterval ticks: construction, spawning, occupancy. */
export function growthPass(sim: Sim): void {
  const s = sim.state;
  const dt = GROWTH.passInterval;
  let constructing = 0;
  for (const b of s.buildings.values()) {
    if (b.state !== BState.Construction) continue;
    const def = ZONED_DEFS.get(b.def)!;
    b.progress = Math.min(1, b.progress + dt / def.buildTicks);
    if (b.progress >= 1) {
      b.state = BState.Active;
      b.progress = 1;
      b.cap = buildingCapacity(b);
      sim.events.push({ kind: 'built', id: b.id });
    } else if (b.cap === 0) constructing++; // in-place upgrades don't use up new-building slots
    sim.markBuildingDirty(b.id);
  }

  // Occupancy: residents move towards a target set by happiness and demand.
  for (const b of s.buildings.values()) {
    if (b.zone !== ZONE_R || b.state !== BState.Active) continue;
    const target = Math.round(b.cap * Math.max(0, Math.min(1, 0.3 + b.happiness)));
    if (b.pop < target && s.demand.R > GROWTH.moveInMinDemand && sim.isBuildingConnected(b)) {
      const before = b.pop;
      b.pop = Math.min(target, b.pop + Math.max(1, Math.ceil(b.cap * GROWTH.moveIn)));
      welcome(b, before);
    } else if (b.pop > target) {
      b.pop = Math.max(target, b.pop - Math.max(1, Math.ceil(b.cap * GROWTH.moveOut)));
      b.sick = Math.min(b.sick, b.pop);
    }
  }

  // Spawning on empty zoned lots, walking blocks round-robin.
  const ids = sim.blockOrder();
  if (!ids.length) return;
  let budget = maxConstructions(sim) - constructing;
  if (budget <= 0) return;
  const dens = unlockedDensity(sim);
  let idx = ids.findIndex((id) => id > s.cursors.growth);
  if (idx < 0) idx = 0;
  const n = Math.min(GROWTH.blocksPerPass, ids.length);
  for (let k = 0; k < n && budget > 0; k++) {
    const bid = ids[(idx + k) % ids.length]!;
    s.cursors.growth = bid;
    const block = s.net.blocks.get(bid);
    if (!block) continue;
    const seg = s.net.segments.get(block.seg);
    if (!seg || !sim.isSegmentConnected(seg.id)) continue;
    const roadDensity = ROAD_TYPES[seg.type].maxDensity;
    for (let c = 0; c < block.cols && budget > 0; c++) {
      const i0 = c * ROWS;
      const zone = block.zone[i0] as ZoneCode;
      if (!zone || !block.valid[i0] || block.bld[i0]) continue;
      const cell = sim.net.cellCenter(block.id, i0);
      const lv = landValueAt(sim, cell.x, cell.z);
      // Industry's "wealth" is its tier, set by the workforce's education; offices need it too.
      let wealth: Wealth =
        zone === ZONE_I
          ? educationCap(sim, zone, lv)
          : (Math.min(
              wealthFromLandValue(lv),
              maxWealth(sim, block.seg, block.s0 + (c + 0.5) * CELL),
              educationCap(sim, zone, lv),
            ) as Wealth);
      while (wealth > 0 && spawnDemand(sim, zone, wealth) <= 0) wealth = (wealth - 1) as Wealth;
      const demand = spawnDemand(sim, zone, wealth);
      if (demand <= 0) continue;
      let def: ZonedDef | null = null;
      for (let dd = Math.min(roadDensity, densityAt(sim, dens, cell.x, cell.z)); dd >= 0 && !def; dd--) {
        const cand = zonedDef(zone, dd as Density, wealth, 1);
        if (lotFits(sim, block, c, cand.w, cand.d, zone)) def = cand;
      }
      if (!def) continue;
      if (!sim.rng.growth.chance(GROWTH.spawnChance * Math.min(1, demand))) continue;
      createBuilding(sim, block, c, def);
      budget--;
      c += def.w - 1;
    }
  }
}

/** Hourly lifecycle: distress and abandonment, recovery, upgrades. */
export function lifecycle(sim: Sim): void {
  const s = sim.state;
  const dens = unlockedDensity(sim);
  const ids = [...s.buildings.keys()];
  for (const id of ids) {
    const b = s.buildings.get(id);
    if (!b) continue;
    if (b.state === BState.Abandoned) {
      const h = computeHappiness(sim, {
        ...b,
        pop: b.cap,
        employed: Math.round(b.cap / 2),
        seekers: Math.round(b.cap / 2),
      });
      b.good = h >= GROWTH.reoccupyHappiness && sim.isBuildingConnected(b) ? b.good + 1 : 0;
      if (b.good >= GROWTH.reoccupyHours) {
        b.state = BState.Active;
        b.distress = 0;
        b.good = 0;
        sim.markBuildingDirty(b.id);
        continue;
      }
      // Left empty long enough, it falls into ruin; the rubble clears and the lot can grow again.
      b.distress++;
      if (b.distress >= GROWTH.abandonAt + GROWTH.abandonedDecayHours) toRubble(sim, b, 'decayed');
      continue;
    }
    if (b.state !== BState.Active) continue;
    // Heritage districts (M21): buildings keep their character, never retooled or rebuilt grander.
    const heritage = sim.policyAt('heritage', b.x, b.z);
    const unhappy = b.happiness < GROWTH.distressHappiness;
    const cut = !sim.isBuildingConnected(b);
    // Nobody stays long in a building without power or water, however nice the neighbourhood.
    const dark = b.power < 0.5 || b.water < 0.5;
    if (unhappy || cut || dark) b.distress += cut ? 2 : 1;
    else b.distress = Math.max(0, b.distress - GROWTH.recoverRate);
    if (b.distress >= GROWTH.abandonAt) {
      b.state = BState.Abandoned;
      b.pop = 0;
      b.sick = 0;
      b.employed = 0;
      b.seekers = 0;
      b.good = 0;
      sim.markBuildingDirty(b.id);
      sim.events.push({ kind: 'abandoned', id: b.id });
      continue;
    }
    if (heritage) {
      b.good = 0;
      continue;
    }
    // Industry retools to the cleaner tier an educated workforce supports.
    if (b.zone === ZONE_I && sim.rng.growth.chance(GROWTH.retoolChance)) {
      const tier = educationCap(sim, ZONE_I, landValueAt(sim, b.x, b.z));
      if (tier > b.wealth) {
        upgradeBuilding(sim, b, zonedDef(ZONE_I, b.density, tier, b.level), b.w, b.d);
        continue;
      }
    }
    // Upgrades.
    const occupancy = b.cap > 0 ? b.pop / b.cap : 0;
    if (b.happiness >= GROWTH.upgradeHappiness && occupancy >= GROWTH.upgradeOccupancy) b.good++;
    else b.good = 0;
    if (b.good < GROWTH.upgradeChecks) continue;
    // Only grow when the city wants more of this zone.
    const zoneDemand = b.zone === ZONE_R ? s.demand.R : b.zone === ZONE_I ? s.demand.I : s.demand.C;
    if (zoneDemand <= 0) continue;
    if (!sim.rng.growth.chance(GROWTH.upgradeChance)) continue;
    const block = s.net.blocks.get(b.block);
    const seg = block ? s.net.segments.get(block.seg) : undefined;
    if (!block || !seg) continue;
    const roadDensity = ROAD_TYPES[seg.type].maxDensity;
    const lv = landValueAt(sim, b.x, b.z);
    const wealth: Wealth =
      b.zone === ZONE_I
        ? (Math.max(b.wealth, educationCap(sim, b.zone, lv)) as Wealth)
        : (Math.max(
            b.wealth,
            Math.min(
              wealthFromLandValue(lv),
              maxWealth(sim, block.seg, block.s0 + (b.col + b.w / 2) * CELL),
              educationCap(sim, b.zone, lv),
            ),
          ) as Wealth);
    let next: ZonedDef | null = null;
    if (b.level < 3) next = zonedDef(b.zone, b.density, wealth, (b.level + 1) as Level);
    else if (b.density < Math.min(roadDensity, densityAt(sim, dens, b.x, b.z)))
      next = zonedDef(b.zone, (b.density + 1) as Density, wealth, 1);
    if (!next) {
      b.good = 0;
      continue;
    }
    // Prefer the archetype's full lot; otherwise deepen, otherwise rebuild on the same lot.
    const shapes: [number, number][] = [
      [next.w, next.d],
      [b.w, Math.max(b.d, next.d)],
      [b.w, b.d],
    ];
    const shape = shapes.find(([w, d]) => lotFits(sim, block, b.col, w, d, b.zone, b.id));
    if (!shape || (next.density > b.density && shape[0] * shape[1] < next.w * next.d)) {
      b.good = 0;
      continue;
    }
    upgradeBuilding(sim, b, next, shape[0], shape[1]);
  }
}

export function upgradeBuilding(sim: Sim, b: Building, next: ZonedDef, w = next.w, d = next.d): void {
  setLotCells(sim, b, 0);
  b.def = next.id;
  b.density = next.density;
  b.wealth = next.wealth;
  b.level = next.level;
  b.w = w;
  b.d = d;
  b.state = BState.Construction;
  b.progress = 0;
  b.good = 0;
  placeOnLot(sim, b);
  setLotCells(sim, b, b.id);
  clearTreesUnder(sim, footprint(b, 1));
  sim.markBuildingDirty(b.id);
  sim.events.push({ kind: 'upgrading', id: b.id });
}

export { CELL };
