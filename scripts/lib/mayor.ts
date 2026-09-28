// The balance tool's scripted mayors (M12, extended in M17 and M18): a careful one that plans the
// whole map, services the city, pursues spending goals and campaigns; a greedy one; and a
// neglectful one. Used by scripts/balance.ts, the scenario builder and the scenario tests.
import { Sim } from '../../src/sim/sim';
import { CIVIC } from '../../src/data/civic';
import { ROAD_TYPES, type RoadTypeId } from '../../src/data/roads';
import { advise } from '../../src/sim/systems/advisors';
import type { CityStats } from '../../src/sim/protocol';
import type { Dept } from '../../src/data/economy';
import type { Difficulty } from '../../src/sim/state';
import { CELL, ROWS, ZONE_C, ZONE_I, ZONE_NONE, ZONE_R } from '../../src/data/zones';
import { GRID_CELL, GRID_RES, MAP_SIZE, type MapPreset } from '../../src/data/world';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { roadsidePose } from '../../src/sim/world/civic';
import { BState } from '../../src/sim/world/buildings';
import { MODULE } from '../../src/data/modules';
import { trucksFor } from '../../src/sim/systems/garbage';
import { campaignOpen } from '../../src/sim/systems/elections';
import { projectBlocked, projectCost } from '../../src/sim/systems/projects';
import { scenarioForbids } from '../../src/sim/systems/scenario';

export type Vec2 = { x: number; z: number };
export type StrategyId = 'careful' | 'greedy' | 'neglectful';

/** District grid: each district is a 480 m avenue piece with four crossing side streets. */
export const DW = 480;
export const ROW = 380;
export const HALF = 160;
/**
 * Nearest the highway first (the original 15), then the far bank beyond the river, then rows
 * farther up and down the map for highways that enter near an edge (`nextSlot` skips any that
 * don't fit on the map).
 */
export const DISTRICT_ORDER: [number, number][] = [
  [0, 0],
  [1, 0],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 1],
  [0, -2],
  [1, -2],
  [0, 2],
  [1, 2],
  [2, 0],
  [2, -1],
  [2, 1],
  [2, -2],
  [2, 2],
  [3, 0],
  [3, -1],
  [3, 1],
  [3, -2],
  [3, 2],
  ...[-3, 3, -4, 4].flatMap((j) => [0, 1, 2, 3].map((i): [number, number] => [i, j])),
];

/**
 * The careful mayor's spending goals once the city can afford them: tourism and landmarks, a
 * university and research park, and the big projects (M17), each at the size a player would reach
 * for it. `reserve` is kept back in months of expenses so a goal never empties the treasury.
 */
export const GOALS: { def: string; at: number }[] = [
  { def: 'park_large', at: 5_000 },
  { def: 'hotel', at: 10_000 },
  { def: 'clocktower', at: 10_000 },
  { def: 'stadium', at: 20_000 },
  { def: 'wheel', at: 20_000 },
  { def: 'university', at: 20_000 },
  { def: 'helioarray', at: 20_000 },
  { def: 'techpark', at: 20_000 },
  { def: 'convention', at: 20_000 },
  { def: 'conservatory', at: 40_000 },
  { def: 'gardenexpo', at: 40_000 },
  { def: 'launchsite', at: 40_000 },
  { def: 'skyneedle', at: 70_000 },
  { def: 'grandarch', at: 100_000 },
];

export interface Sample {
  month: number;
  population: number;
  treasury: number;
  approval: number;
  R: number;
  C: number;
  I: number;
  net: number;
  abandoned: number;
  districts: number;
  civics: number;
  /** Spent this month on goals (landmarks, projects, the university...). */
  goals: number;
}

export class Player {
  readonly sim: Sim;
  readonly c: Vec2;
  districts: {
    i: number;
    j: number;
    segs: number[];
    dense?: boolean;
    quarter?: boolean;
    dead?: boolean;
  }[] = [];
  log: string[] = [];
  /** Leave the tax rate where it's been set (a scenario's scripted player raising a levy). */
  holdTaxes = false;
  /** Civic buildings this mayor won't build (a scenario's starting city built without coal). */
  avoid: string[] = [];
  /** Goals reached (def → month), elections held, and money spent on goals this month. */
  goalsMet = new Map<string, number>();
  goalSpend = 0;

  /** A mayor for a new city on the river map, or for a city that's already running. */
  constructor(
    readonly strategy: StrategyId,
    city: Sim | { seed: string; preset?: MapPreset; difficulty?: Difficulty; cityName?: string },
  ) {
    this.sim =
      city instanceof Sim
        ? city
        : Sim.create({
            seed: city.seed,
            preset: city.preset ?? 'river',
            cityName: city.cityName ?? strategy,
            difficulty: city.difficulty ?? 'normal',
          });
    const hw = this.sim.state.net.nodes.get(this.sim.state.highway.connect)!;
    this.c = { x: hw.x, z: hw.z };
  }

  /**
   * Take over a city this planner laid out (a scenario's starting city): find which district slots
   * have their avenue, whether each is zoned (a district) or not (a quarter), and whether its side
   * streets are already avenues. Slots without roads are skipped, as the planner itself does.
   */
  adopt(): this {
    const net = this.sim.state.net;
    const mids = [...net.segments.values()]
      .filter((sg) => sg.type !== 'highway')
      .map((sg) => {
        const cv = this.sim.net.curve(sg.id);
        return { sg, cv, mid: cv.pointAt(cv.length / 2) };
      });
    let last = -1;
    const found: (typeof this.districts)[number][] = [];
    DISTRICT_ORDER.forEach(([i, j], k) => {
      const x0 = this.c.x + i * DW;
      const z = this.c.z + j * ROW;
      const segs = mids
        .filter(({ sg, cv }) => {
          if (sg.type !== 'avenue' && sg.type !== 'street') return false;
          const a = cv.pointAt(0);
          const b = cv.pointAt(cv.length);
          return (
            Math.abs(a.z - z) < 4 &&
            Math.abs(b.z - z) < 4 &&
            Math.min(a.x, b.x) >= x0 - 4 &&
            Math.max(a.x, b.x) <= x0 + DW + 4
          );
        })
        .map(({ sg }) => sg.id);
      if (!segs.length) {
        found.push({ i, j, segs: [], dead: true });
        return;
      }
      last = k;
      let zoned = false;
      for (const b of net.blocks.values()) {
        const p = this.sim.net.cellCenter(b.id, 0);
        if (p.x < x0 || p.x > x0 + DW || Math.abs(p.z - z) > HALF) continue;
        if (b.zone.some((c) => c !== ZONE_NONE)) zoned = true;
      }
      const sides = mids.filter(
        ({ mid }) =>
          mid.x > x0 + 20 && mid.x < x0 + DW - 20 && Math.abs(mid.z - z) > 20 && Math.abs(mid.z - z) < HALF,
      );
      found.push({
        i,
        j,
        segs,
        quarter: !zoned,
        dense: sides.length > 0 && sides.every(({ sg }) => sg.type === 'avenue'),
      });
    });
    this.districts = found.slice(0, last + 1);
    return this;
  }

  stats(): CityStats {
    return this.sim.query({ type: 'summary' }) as CityStats;
  }

  road(type: RoadTypeId, a: Vec2, b: Vec2): number[] {
    const r = this.sim.dispatch({ type: 'buildRoad', road: type, points: [a, b] });
    return r.ok ? (r.created ?? []) : [];
  }

  districtCost(): number {
    return DW * ROAD_TYPES.avenue.costPerMetre + 4 * 2 * HALF * ROAD_TYPES.street.costPerMetre;
  }

  /**
   * A road from a to b, or, where one piece won't go (a river crossing needs land for its ramps),
   * two pieces split where both will.
   */
  roadAcross(type: RoadTypeId, a: Vec2, b: Vec2): number[] {
    const direct = this.road(type, a, b);
    if (direct.length) return direct;
    for (let f = 0.15; f < 0.9; f += 0.05) {
      const m = { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
      const p1 = this.sim.preview({ type: 'buildRoad', road: type, points: [a, m] });
      const p2 = this.sim.preview({ type: 'buildRoad', road: type, points: [m, b] });
      if (p1.ok && p2.ok) return [...this.road(type, a, m), ...this.road(type, m, b)];
    }
    return [];
  }

  /** The next district slot on the map, if any fits. */
  nextSlot(): [number, number] | undefined {
    return DISTRICT_ORDER.slice(this.districts.length).find(([i, j]) => {
      const x0 = this.c.x + i * DW;
      const z = this.c.z + j * ROW;
      return x0 + DW <= MAP_SIZE - 40 && z - HALF >= 40 && z + HALF <= MAP_SIZE - 40;
    });
  }

  /**
   * Lay out and zone the next district, if there's money for it. A `quarter` is an avenue with no
   * side streets or zoning: room for landmarks and big projects.
   */
  buildDistrict(quarter = false): boolean {
    // The careful mayor keeps the first slot after 8,000 residents as a quarter for landmarks and
    // projects, before the map fills up.
    if (this.strategy === 'careful' && this.sim.reached(8_000) && !this.districts.some((d) => d.quarter))
      quarter = true;
    const next = this.nextSlot();
    if (!next || this.sim.state.treasury < this.districtCost() + 2_000) return false;
    while (DISTRICT_ORDER[this.districts.length] !== next) {
      const [si, sj] = DISTRICT_ORDER[this.districts.length]!;
      this.districts.push({ i: si, j: sj, segs: [], dead: true });
    }
    const [i, j] = next;
    const x0 = this.c.x + i * DW;
    const z = this.c.z + j * ROW;
    const segs: number[] = [];
    segs.push(...this.roadAcross('avenue', { x: x0, z }, { x: x0 + DW, z }));
    // Avenue rows off the highway row are also joined end to end at the district's west edge.
    if (j !== 0 && i === 0) {
      const zNear = this.c.z + (j > 0 ? j - 1 : j + 1) * ROW;
      segs.push(...this.road('avenue', { x: x0 + 12, z: zNear }, { x: x0 + 12, z }));
    }
    // Roads that didn't join the network (a failed crossing) get no zoning or buildings.
    const cutOff = () => {
      if (segs.some((id) => this.sim.state.net.segments.has(id) && this.sim.isSegmentConnected(id)))
        return false;
      this.districts.push({ i, j, segs, dead: true });
      this.log.push(`m${this.month()}: district ${i},${j} cut off`);
      return true;
    };
    if (quarter) {
      if (cutOff()) return false;
      this.districts.push({ i, j, segs, quarter: true });
      this.log.push(`m${this.month()}: quarter ${i},${j}`);
      return true;
    }
    for (let k = 1; k <= 4; k++) {
      const x = x0 + (DW * k) / 5;
      segs.push(...this.road('street', { x, z: z - HALF }, { x, z: z + HALF }));
      // Join the side streets to the neighbouring rows so every district reaches the highway.
      for (const d of this.districts)
        if (d.i === i && Math.abs(d.j - j) === 1) {
          const zn = this.c.z + d.j * ROW;
          const a = d.j < j ? zn + HALF : z + HALF;
          const b = d.j < j ? z - HALF : zn - HALF;
          if (!d.quarter) segs.push(...this.road('street', { x, z: a }, { x, z: b }));
        }
    }
    if (cutOff()) return false;
    const zone = (letter: 'R' | 'C' | 'I', a: Vec2, b: Vec2, radius: number) =>
      this.sim.dispatch({ type: 'zone', zone: letter, area: { kind: 'brush', points: [a, b], radius } });
    // The careful mayor zones shops only while shops are wanted; otherwise homes face the avenue.
    const shops =
      this.strategy !== 'careful' ||
      this.districts.length < 2 ||
      this.vacancy(ZONE_C) < 0.5 ||
      this.stats().demand.C > 0.1;
    // Short of jobs (industry wanted, homes not): the whole south side goes to industry.
    const jobs = this.strategy === 'careful' && this.jobsShort();
    zone('R', { x: x0 + 20, z: z - 100 }, { x: x0 + DW, z: z - 100 }, 70);
    zone(shops ? 'C' : 'R', { x: x0 + 20, z: z + 20 }, { x: x0 + DW, z: z + 20 }, 22);
    zone(jobs ? 'I' : 'R', { x: x0 + 20, z: z + 90 }, { x: x0 + DW / 2, z: z + 90 }, 50);
    zone('I', { x: x0 + DW / 2 + 20, z: z + 110 }, { x: x0 + DW, z: z + 110 }, 50);
    this.districts.push({ i, j, segs });
    this.log.push(`m${this.month()}: district ${i},${j}`);
    return true;
  }

  month(): number {
    return Math.floor(this.sim.state.tick / TICKS_PER_MONTH);
  }

  /** Share of zoned cells still without a building (of one zone, or all). */
  vacancy(zone?: number): number {
    let zoned = 0;
    let empty = 0;
    for (const b of this.sim.state.net.blocks.values())
      // Growth looks at each lot's front cell (deep buildings fill the rows behind it).
      for (let k = 0; k < b.zone.length; k += ROWS) {
        if (b.zone[k] === ZONE_NONE || !b.valid[k] || (zone !== undefined && b.zone[k] !== zone)) continue;
        zoned++;
        if (b.bld[k] === 0) empty++;
      }
    return zoned ? empty / zoned : 1;
  }

  /** Some zone is in demand and has little room left. */
  wantsRoom(threshold = 0.15, full = 0.25): boolean {
    const d = this.stats().demand;
    return ([d.R, d.C, d.I] as number[]).some((v, k) => v > threshold && this.vacancy(k + 1) < full);
  }

  /** Place a civic building, trying industrial side streets first (utilities) or anywhere. */
  place(def: string, near: 'industry' | 'homes' | 'clean' | 'edge' = 'homes'): boolean {
    const d = CIVIC.get(def);
    if (!d || this.avoid.includes(def) || !this.sim.isUnlocked(d.unlockPopulation)) return false;
    if (this.sim.state.treasury < d.cost + 1_000) return false;
    // Only roads joined to the highway: a building on a cut-off piece of road serves nobody.
    const segs = [...this.sim.state.net.segments.values()].filter(
      (s) => s.type !== 'highway' && this.sim.isSegmentConnected(s.id),
    );
    const mid = (id: number) => {
      const cv = this.sim.net.curve(id);
      return cv.pointAt(cv.length / 2);
    };
    // Utilities go to the industrial (south-east) end of the newest districts; the rest spread out.
    // Pumps go where the ground water is best and cleanest, on the residential (north) side.
    // Landfills go to the edge of town, as players put them: the road farthest from where people live.
    let cx = this.c.x;
    let cz = this.c.z;
    if (near === 'edge') {
      let n = 0;
      for (const b of this.sim.state.buildings.values())
        if (b.pop > 0) {
          cx = (cx * n + b.x * b.pop) / (n + b.pop);
          cz = (cz * n + b.z * b.pop) / (n + b.pop);
          n += b.pop;
        }
    }
    const score = (id: number) => {
      const p = mid(id);
      if (near === 'edge') return -Math.hypot(p.x - cx, p.z - cz);
      if (near === 'industry') return -(p.x - this.c.x) - 2 * (p.z - this.c.z);
      if (near === 'clean') {
        const i = Math.min(GRID_RES - 1, Math.max(0, Math.floor(p.x / GRID_CELL)));
        const j = Math.min(GRID_RES - 1, Math.max(0, Math.floor(p.z / GRID_CELL)));
        const gw = this.sim.terrain.groundwater[j * GRID_RES + i]! / 255;
        return 20 * this.sim.groundPollutionAt(p.x, p.z) - gw + (p.z > this.c.z - 40 ? 0.5 : 0);
      }
      return (id * 2654435761) % 997;
    };
    segs.sort((a, b) => score(a.id) - score(b.id));
    for (const s of segs) {
      const len = this.sim.net.curve(s.id).length;
      for (let at = d.w / 2 + 12; at < len - d.w / 2 - 12; at += 10)
        for (const side of [1, -1] as const) {
          const pose = roadsidePose(this.sim.net, s.id, at, side, d.d);
          if (this.sim.dispatch({ type: 'placeBuilding', def, ...pose }).ok) {
            this.log.push(`m${this.month()}: ${def}`);
            return true;
          }
        }
    }
    return near === 'homes' && this.makeRoom(def);
  }

  /** Place a civic building on the connected road nearest a point (scenario recipes and scripts). */
  placeNear(def: string, p: Vec2, within = 400): boolean {
    const d = CIVIC.get(def);
    if (!d) return false;
    const segs = [...this.sim.state.net.segments.values()]
      .filter((sg) => sg.type !== 'highway' && this.sim.isSegmentConnected(sg.id))
      .map((sg) => {
        const cv = this.sim.net.curve(sg.id);
        const m = cv.pointAt(cv.length / 2);
        return { id: sg.id, len: cv.length, dist: Math.hypot(m.x - p.x, m.z - p.z) };
      })
      .filter((x) => x.dist < within)
      .sort((a, b) => a.dist - b.dist || a.id - b.id);
    for (const sg of segs)
      for (let at = d.w / 2 + 8; at < sg.len - d.w / 2 - 8; at += 8)
        for (const side of [1, -1] as const) {
          const pose = roadsidePose(this.sim.net, sg.id, at, side, d.d);
          if (this.sim.dispatch({ type: 'placeBuilding', def, ...pose }).ok) {
            this.log.push(`m${this.month()}: ${def} (near)`);
            return true;
          }
        }
    return false;
  }

  /**
   * No free roadside lot: clear one, as a player would, starting with abandoned buildings and
   * rubble, then the smallest homes. Tries a few spots and gives up if none will take the building.
   */
  makeRoom(def: string): boolean {
    const d = CIVIC.get(def)!;
    const candidates = [...this.sim.state.buildings.values()]
      .filter((b) => b.state === BState.Abandoned || b.state === BState.Rubble || b.density === 0)
      .sort(
        (a, b) =>
          Number(b.state === BState.Abandoned) - Number(a.state === BState.Abandoned) || a.cap - b.cap,
      )
      .slice(0, 12);
    for (const b of candidates) {
      const block = this.sim.state.net.blocks.get(b.block);
      if (!block) continue;
      const len = this.sim.net.curve(block.seg).length;
      const at = Math.min(Math.max(block.s0 + (b.col + b.w / 2) * CELL, d.w / 2 + 8), len - d.w / 2 - 8);
      const pose = roadsidePose(this.sim.net, block.seg, at, block.side, d.d);
      const r = Math.hypot(d.w, d.d) / 2 + 6;
      const clear = [...this.sim.state.buildings.values()].filter(
        (o) => Math.hypot(o.x - pose.x, o.z - pose.z) < r + (Math.hypot(o.w, o.d) * CELL) / 2,
      );
      if (clear.length > 12 || this.sim.state.treasury < d.cost + 2_000) continue;
      for (const o of clear) this.sim.dispatch({ type: 'bulldoze', target: { kind: 'building', id: o.id } });
      if (this.sim.dispatch({ type: 'placeBuilding', def, ...pose }).ok) {
        this.log.push(`m${this.month()}: ${def} (cleared ${clear.length})`);
        return true;
      }
    }
    return false;
  }

  count(def: string): number {
    let n = 0;
    for (const c of this.sim.state.civics.values()) if (c.def === def) n++;
    return n;
  }

  setTaxes(rate: number): void {
    for (const zone of ['R', 'C', 'I'] as const)
      this.sim.dispatch({ type: 'setTax', zone, wealth: 'all', rate });
  }

  setFunding(pct: number): void {
    for (const dept of Object.keys(this.sim.state.economy.funding) as Dept[])
      this.sim.dispatch({ type: 'setFunding', dept, pct });
  }

  /** Keep power, water and sewage ahead of demand. */
  utilities(cheap: boolean): void {
    const u = this.stats().utilities;
    if (u.power.supply < u.power.demand * 1.15 + 10) this.powerPlant(cheap, u.power.demand);
    if (u.water.supply < u.water.demand * 1.15 + 10) this.place('pump', cheap ? 'industry' : 'clean');
    if (u.sewage.supply < u.sewage.demand * 1.15 + 10) {
      const big = u.sewage.demand > 300 && !cheap && this.sim.isUnlocked(2_000);
      if (!(big && this.place('treatment', 'industry'))) this.place('septic', 'industry');
    }
  }

  /** Another power plant: coal for a big city (wind when cheap), whatever a scenario allows. */
  powerPlant(cheap: boolean, demand: number): boolean {
    let plant = !cheap && demand > 60 ? 'coal' : 'wind';
    // A scenario that bans fossil power (M18): solar once it's unlocked, wind until then.
    if (this.avoid.includes(plant) || scenarioForbids(this.sim, { civic: plant }))
      plant = this.sim.isUnlocked(CIVIC.get('solar')!.unlockPopulation) ? 'solar' : 'wind';
    if (this.place(plant, 'industry')) return true;
    // Can't afford the big plant (or find room for it): a wind turbine now beats a town going dark
    // while the treasury saves up (seed s1 once stalled at 140 MW for good).
    return plant !== 'wind' && !this.avoid.includes('wind') && this.place('wind', 'industry');
  }

  private lastBuilt = new Map<string, number>();

  /** Act on what the advisors say is urgent, as a sensible player would (giving each fix time). */
  followAdvice(): void {
    const pop = this.sim.state.totals.population;
    const now = this.sim.state.tick;
    // One of each service per so many residents (plus one), and time for each to take effect.
    const PER: Record<string, number> = {
      landfill: 5_000,
      recycling: 3_000,
      firestation: 2_500,
      police: 2_500,
      clinic: 2_500,
      hospital: 10_000,
      primary: 2_500,
      highschool: 6_000,
      works: 15_000,
    };
    const act = (kind: string, def: string, near: 'industry' | 'homes' | 'edge' = 'homes') => {
      if (now - (this.lastBuilt.get(kind) ?? -1e9) < TICKS_PER_MONTH * 2) return;
      if (this.count(def) >= Math.ceil(pop / (PER[def] ?? 1e9)) + 1) return;
      if (this.place(def, near)) this.lastBuilt.set(kind, now);
    };
    for (const a of advise(this.sim)) {
      if (a.severity < 2) continue;
      const t = a.title.toLowerCase();
      if (a.advisor === 'utilities' && /garbage/.test(t)) {
        // A landfill whose trucks are all out gets another truck first (the inspector says so);
        // new landfills go at the edge of town, as players put them; recycling spreads out.
        if (!this.buyTruck()) act('garbage', 'landfill', 'edge');
        act('garbage2', 'recycling');
      } else if (a.advisor === 'safety' && /fire cover/.test(t)) act('fire', 'firestation');
      else if (a.advisor === 'safety' && /crime|police/.test(t)) act('police', 'police');
      else if (a.advisor === 'health') {
        if (pop > 6_000) act('health2', 'hospital');
        act('health', 'clinic');
      } else if (a.advisor === 'utilities' && /winter/.test(t)) {
        // Build for the heating before the cold comes (M22), once a month at most.
        if (now - (this.lastBuilt.get('winter') ?? -1e9) >= TICKS_PER_MONTH) {
          this.powerPlant(false, this.stats().utilities.power.demand);
          this.lastBuilt.set('winter', now);
        }
      } else if (a.advisor === 'transport' && /snow/.test(t)) act('snow', 'works');
      else if (a.advisor === 'education') {
        act('school', 'primary');
        if (pop > 3_000) act('school2', 'highschool');
      }
    }
  }

  /** Buy an extra truck for a landfill whose trucks are all out, if it can take one (once a month). */
  buyTruck(): boolean {
    const now = this.sim.state.tick;
    if (now - (this.lastBuilt.get('truck') ?? -1e9) < TICKS_PER_MONTH) return false;
    const truck = MODULE.get('garbageTruck')!;
    if (this.sim.state.treasury < truck.cost + 2_000) return false;
    for (const c of [...this.sim.state.civics.values()].sort((a, b) => a.id - b.id)) {
      if (c.def !== 'landfill' || c.out < trucksFor(this.sim, c)) continue;
      if (this.sim.dispatch({ type: 'addModule', civic: c.id, module: truck.id }).ok) {
        this.lastBuilt.set('truck', now);
        this.log.push(`m${this.month()}: truck`);
        return true;
      }
    }
    return false;
  }

  /** One decision round (every six game hours). */
  play(): void {
    const s = this.stats();
    const e = this.sim.state.economy;
    const growRoom = this.wantsRoom();
    if (this.strategy === 'careful') {
      this.utilities(false);
      // Services once there's a town to serve.
      if (s.population >= 250) this.followAdvice();
      // Expand when a zone in demand runs short of room (homes or industry; shops follow homes),
      // borrowing for it while the budget is in the black.
      if (
        this.districts.length === 0 ||
        (growRoom && Math.min(this.vacancy(ZONE_R), this.vacancy(ZONE_I)) < 0.25)
      ) {
        if (
          this.sim.state.treasury < this.districtCost() + 2_000 &&
          s.netMonthly > 300 &&
          e.loans.length === 0
        )
          this.sim.dispatch({ type: 'takeLoan', amount: 25_000 });
        this.buildDistrict();
      }
      if (this.count('park_small') < this.districts.filter((d) => !d.quarter && !d.dead).length)
        this.place('park_small');
      this.densify();
      this.rebalanceZoning();
      this.pursueGoals();
      // Beat and station cover grows with the city (one of each per 5,000 residents).
      if (this.count('police') < Math.floor(s.population / 5_000)) this.place('police');
      if (this.count('firestation') < Math.floor(s.population / 5_000)) this.place('firestation');
      this.campaign();
      // Taxes: nudge up while losing money (never against a promise), back down when comfortable.
      const rate = e.taxes.R[0]!;
      if (this.holdTaxes) {
        // Taxes stay where they were set.
      } else if (s.netMonthly < 0 && s.treasury < -s.netMonthly * 6 && rate < 12 && !this.taxPromise())
        this.setTaxes(rate + 1);
      else if (s.netMonthly > 0 && s.treasury > 60_000 && rate > 9) this.setTaxes(rate - 1);
      // Comfortably off: trade money for happier residents and more demand.
      else if (s.netMonthly > 0 && s.treasury > 250_000 && rate > 6) this.setTaxes(rate - 1);
      // Goals met and money piling up: hand it back, a point every six months, down to 2 %.
      else if (
        s.netMonthly > 0 &&
        s.treasury > 1_500_000 &&
        this.goalsDone() &&
        rate > 2 &&
        this.sim.state.tick - this.lastTaxCut > TICKS_PER_MONTH * 6
      ) {
        this.setTaxes(rate - 1);
        this.lastTaxCut = this.sim.state.tick;
        this.log.push(`m${this.month()}: taxes ${rate - 1}%`);
      }
      if (s.treasury < 3_000 && e.loans.length === 0) this.sim.dispatch({ type: 'takeLoan', amount: 25_000 });
    } else if (this.strategy === 'greedy') {
      // Squeeze taxes, underfund services, zone as fast as money allows, build only utilities.
      this.setTaxes(15);
      this.setFunding(70);
      this.utilities(true);
      if (this.districts.length === 0 || this.vacancy() < 0.35) this.buildDistrict();
    } else {
      // Neglectful: a first district and one of each utility, then nothing.
      if (this.districts.length === 0) {
        this.buildDistrict();
        this.place('coal', 'industry');
        this.place('pump', 'clean');
        this.place('septic', 'industry');
      }
    }
  }

  /**
   * High-rises unlocked: widen a district's side streets into avenues (streets cap buildings at
   * medium density), oldest district first, one a round while homes are wanted.
   */
  densify(): boolean {
    if (!this.sim.reached(5_000) || this.stats().demand.R < 0.15) return false;
    if (this.sim.state.treasury < 150_000) return false;
    const d = this.districts.find((x) => !x.dense && !x.quarter && !x.dead);
    if (!d) return false;
    d.dense = true;
    const x0 = this.c.x + d.i * DW;
    const z = this.c.z + d.j * ROW;
    let n = 0;
    for (const sg of [...this.sim.state.net.segments.values()]) {
      if (sg.type !== 'street') continue;
      const cv = this.sim.net.curve(sg.id);
      const m = cv.pointAt(cv.length / 2);
      if (m.x < x0 || m.x > x0 + DW || Math.abs(m.z - z) > HALF + 40) continue;
      if (this.sim.dispatch({ type: 'upgradeRoad', seg: sg.id, road: 'avenue' }).ok) n++;
    }
    this.log.push(`m${this.month()}: widened ${n} streets in ${d.i},${d.j}`);
    return true;
  }

  /** The city is short of jobs: industry is wanted while homes are not. */
  jobsShort(): boolean {
    const d = this.stats().demand;
    return d.I > 0.3 && d.R < 0.15;
  }

  private lastRezone = -1e9;

  /**
   * Every few months, when jobs are short and homes stand empty, rezone the empty home lots on
   * each district's south side (beside its industry) for industry; when shops and offices are
   * wanted and full, give them the empty home lots facing the avenue. Built lots keep their zone.
   */
  rebalanceZoning(): void {
    const now = this.sim.state.tick;
    if (now - this.lastRezone < TICKS_PER_MONTH * 3) return;
    this.lastRezone = now;
    const d = this.stats().demand;
    const zone = (letter: 'C' | 'I', a: Vec2, b: Vec2, radius: number) =>
      this.sim.dispatch({ type: 'zone', zone: letter, area: { kind: 'brush', points: [a, b], radius } });
    const areas = this.districts.filter((x) => !x.quarter && !x.dead);
    if (this.jobsShort() && this.vacancy(ZONE_R) > 0.2 && this.vacancy(ZONE_I) < 0.25)
      for (const a of areas) {
        const x0 = this.c.x + a.i * DW;
        const z = this.c.z + a.j * ROW;
        zone('I', { x: x0 + 20, z: z + 90 }, { x: x0 + DW / 2, z: z + 90 }, 50);
      }
    if (d.C > 0.15 && this.vacancy(ZONE_C) < 0.1 && this.vacancy(ZONE_R) > 0.2)
      for (const a of areas) {
        const x0 = this.c.x + a.i * DW;
        const z = this.c.z + a.j * ROW;
        zone('C', { x: x0 + 20, z: z - 22 }, { x: x0 + DW, z: z - 22 }, 16);
      }
  }

  /** Every goal the city has reached is met: nothing left to save for until the next milestone. */
  goalsDone(): boolean {
    return GOALS.every(
      (g) =>
        this.goalsMet.has(g.def) ||
        this.avoid.includes(g.def) ||
        !this.sim.reached(g.at) ||
        this.goalTried.has(g.def),
    );
  }

  private lastTaxCut = -1e9;

  /** Months of running costs to keep in hand before spending on a goal. */
  reserve(): number {
    const r = this.sim.projectedNet();
    const upkeep = Object.values(this.sim.state.economy.month).reduce((a, v) => a + Math.min(0, v), 0);
    return Math.max(100_000, -upkeep * 3 - Math.min(0, r) * 6);
  }

  /**
   * Work down the spending goals: the first one the city has reached and can afford is placed on
   * a free roadside, or failing that in a quarter kept for landmarks and projects. One a round.
   */
  pursueGoals(): void {
    const s = this.sim.state;
    for (const g of GOALS) {
      if (this.goalsMet.has(g.def) || this.avoid.includes(g.def)) continue;
      const d = CIVIC.get(g.def)!;
      if (!this.sim.reached(g.at) || !this.sim.isUnlocked(d.unlockPopulation)) return;
      if (this.count(g.def) > 0) {
        this.goalsMet.set(g.def, this.month());
        continue;
      }
      if (d.project && projectBlocked(this.sim, d)) continue;
      // Nowhere to put it last time: try the others, and this one again in six months.
      if (s.tick - (this.goalTried.get(g.def) ?? -1e9) < TICKS_PER_MONTH * 6) continue;
      // A project can start once the first stage is in hand and the treasury plus the city's income
      // over the build will pay for the rest; anything else waits for its whole price.
      const reserve = this.reserve();
      if (d.project) {
        const { total, first } = projectCost(d);
        const months = d.project.stages.reduce((a, st) => a + st.months, 0);
        const income = Math.max(0, this.sim.projectedNet()) * months;
        if (s.treasury < first + reserve || s.treasury + income < total + reserve) return;
      } else if (s.treasury < d.cost + reserve) return;
      const before = s.treasury;
      if (this.placeGoal(g.def)) {
        this.goalsMet.set(g.def, this.month());
        // Projects' stages are counted from the ledger as they're paid (see sample()).
        if (!d.project) this.goalSpend += before - s.treasury;
        return;
      }
      this.goalTried.set(g.def, s.tick);
    }
  }

  private goalTried = new Map<string, number>();

  /** A goal's building: along a quarter's avenue, else any free roadside, else a new quarter. */
  placeGoal(def: string): boolean {
    const d = CIVIC.get(def)!;
    const tryQuarters = () => {
      for (const q of this.districts.filter((x) => x.quarter))
        for (const id of q.segs) {
          const sg = this.sim.state.net.segments.get(id);
          if (!sg || sg.type !== 'avenue' || !this.sim.isSegmentConnected(id)) continue;
          const len = this.sim.net.curve(id).length;
          for (let at = d.w / 2 + 12; at < len - d.w / 2 - 12; at += 10)
            for (const side of [1, -1] as const) {
              const pose = roadsidePose(this.sim.net, id, at, side, d.d);
              if (this.sim.dispatch({ type: 'placeBuilding', def, ...pose }).ok) {
                this.log.push(`m${this.month()}: ${def} (quarter)`);
                return true;
              }
            }
        }
      return false;
    };
    if (tryQuarters()) return true;
    if (!d.project && this.place(def, 'homes')) return true;
    if (this.buildDistrict(true) && tryQuarters()) return true;
    // The map is full and the quarter taken: a project goes on any roadside with room, as a
    // player's would.
    return !!d.project && this.place(def, 'homes');
  }

  /** In the campaign, promise what the city can deliver: no tax rises, and jobs or a hospital. */
  campaign(): void {
    if (!campaignOpen(this.sim)) return;
    const e = this.sim.state.election;
    const has = (id: string) => e.promises.some((p) => p.id === id);
    if (!has('taxes')) this.sim.dispatch({ type: 'promise', promise: 'taxes', on: true });
    if (e.promises.length >= 2) return;
    const t = this.sim.state.totals;
    if (t.workers > 0 && t.unemployed / t.workers < 0.025)
      this.sim.dispatch({ type: 'promise', promise: 'jobs', on: true });
    else if (t.population > 6_000 && this.sim.state.treasury > 200_000) {
      this.sim.dispatch({ type: 'promise', promise: 'hospital', on: true });
      this.place('hospital');
    }
  }

  /** A promise not to raise taxes is in force. */
  taxPromise(): boolean {
    return this.sim.state.election.promises.some((p) => p.id === 'taxes');
  }

  private ledgerSeen = -1;

  sample(): Sample {
    // Every project stage paid in the months closed since the last sample (the ledger keeps 24).
    for (const m of this.sim.state.economy.history)
      if (m.month > this.ledgerSeen) {
        this.goalSpend -= m.lines.projects ?? 0;
        this.ledgerSeen = m.month;
      }
    const s = this.stats();
    return {
      month: this.month(),
      population: s.population,
      treasury: s.treasury,
      approval: s.approval,
      R: s.demand.R,
      C: s.demand.C,
      I: s.demand.I,
      net: s.netMonthly,
      abandoned: s.abandoned,
      districts: this.districts.filter((d) => !d.dead).length,
      civics: this.sim.state.civics.size,
      goals: this.goalSpend,
    };
  }
}
