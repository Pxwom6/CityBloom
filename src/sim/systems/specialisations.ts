import { CIVIC, SPECIALISATION } from '../../data/civic';
import { POLICY_EFFECTS } from '../../data/policies';
import { ZONE_I } from '../../data/zones';
import type { Sim } from '../sim';
import { BState } from '../world/buildings';
import { civicDef, civicOnline, civicRect, railSiding, resourceRichness, type Civic } from '../world/civic';
import { matchDayNow, openProject } from './projects';
import { linkedToRegion } from './rail';
import { REGION } from '../../data/region';

/** Visitors a day and how many of them stay the night (saved; recomputed hourly). */
export interface TourismState {
  visitors: number;
  overnight: number;
  /** How they arrive (M23): by road, by train, by air, by sea (absent in older saves until the next hour). */
  by?: { road: number; rail: number; air: number; sea: number };
}

/** Is there a railway station in service on track linked to the regional railway (M20)? */
export function regionalRail(sim: Sim): boolean {
  for (const c of sim.state.civics.values()) {
    const def = civicDef(c);
    if (def.rail && def.track === 'rail' && c.access && civicOnline(c) && linkedToRegion(sim, c.access.seg))
      return true;
  }
  return false;
}

/** Working specialisation buildings, in id order (online, facing a road linked to the highway). */
function working(sim: Sim, has: (c: Civic) => boolean): Civic[] {
  const s = sim.state;
  return [...s.civics.values()]
    .filter((c) => has(c) && civicOnline(c) && !!c.access && sim.isSegmentConnected(c.access.seg))
    .sort((a, b) => a.id - b.id);
}

/** Units a mine or well extracts a day now: richer deposits give more, and they run down. */
export function extractionPerDay(sim: Sim, c: Civic): number {
  const r = civicDef(c).resource;
  if (!r || !civicOnline(c) || !c.access) return 0;
  const rich = resourceRichness(sim, r.kind, civicRect(c));
  const left = Math.max(SPECIALISATION.depletedFloor, 1 - c.stored / r.reserve);
  return r.perDay * rich * left * Math.min(1.25, sim.fundingEff('trade'));
}

/** Jobs in high-tech industry (what a research park earns licence fees on). */
export function highTechJobs(sim: Sim): number {
  let n = 0;
  for (const b of sim.state.buildings.values())
    if (b.state === BState.Active && b.zone === ZONE_I && b.wealth === 2) n += b.pop;
  return n;
}

/** Industrial jobs filled (the goods a freight terminal ships). */
function industrialJobs(sim: Sim): number {
  let n = 0;
  for (const b of sim.state.buildings.values())
    if (b.state === BState.Active && b.zone === ZONE_I) n += b.pop;
  return n;
}

/**
 * Ships goods: a freight hub, or a rail freight terminal whose siding is linked to the regional
 * railway (M20).
 */
function ships(sim: Sim, c: Civic): boolean {
  const d = civicDef(c);
  if (!d.freight) return false;
  if (!d.railFreight) return true;
  const siding = railSiding(sim, c);
  return !!siding && linkedToRegion(sim, siding.seg);
}

/** Freight hubs and terminals in service (a second one helps, more don't). */
export function freightHubs(sim: Sim): number {
  return Math.min(2, working(sim, (c) => ships(sim, c)).length);
}

/** The airport and seaport in service (M23), for demand. */
export function ports(sim: Sim): { airport: Civic | null; seaport: Civic | null } {
  return {
    airport: working(sim, (c) => !!civicDef(c).airport)[0] ?? null,
    seaport: working(sim, (c) => !!civicDef(c).seaport)[0] ?? null,
  };
}

export function hasResearchPark(sim: Sim): boolean {
  return working(sim, (c) => !!civicDef(c).research).length > 0;
}

/** Hourly: count today's visitors and dig out ore and oil. */
export function specialisationsHour(sim: Sim): void {
  const s = sim.state;
  let draw = 0;
  let rooms = 0;
  for (const c of working(sim, (c) => !!civicDef(c).tourism)) {
    const t = civicDef(c).tourism!;
    draw += t.draw ?? 0;
    rooms += t.rooms ?? 0;
  }
  const eff = Math.min(1.25, sim.fundingEff('tourism'));
  const appeal = SPECIALISATION.appealBase + (1 - SPECIALISATION.appealBase) * s.totals.approval;
  const campaign = sim.policy('tourismCampaign') ? POLICY_EFFECTS.tourismCampaign : 1;
  // Match days at the stadium (M17) fill the stands on top of the usual visitors.
  const match = matchDayNow(sim)?.visitors ?? 0;
  const base = draw * eff * appeal * campaign;
  // An airport or seaport (M23) brings visitors of its own and makes the city easier to reach.
  let air = 0;
  let sea = 0;
  for (const c of working(sim, (c) => !!civicDef(c).airport || !!civicDef(c).seaport)) {
    const d = civicDef(c);
    if (d.airport) air += d.airport.visitors * eff * appeal + base * d.airport.boost;
    if (d.seaport) sea += d.seaport.visitors * eff * appeal;
  }
  const visitors = base + air + sea + match * eff;
  const overnight = Math.min(visitors * SPECIALISATION.overnightShare, rooms * eff);
  // The rest come by road, or some by train where a station serves the regional line.
  const byLand = Math.max(0, visitors - air - sea);
  const railShare = regionalRail(sim) ? REGION.railShare : 0;
  s.tourism = {
    visitors: Math.round(visitors),
    overnight: Math.round(overnight),
    by: {
      road: Math.round(byLand * (1 - railShare)),
      rail: Math.round(byLand * railShare),
      air: Math.round(air),
      sea: Math.round(sea),
    },
  };
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    if (!civicDef(c).resource) continue;
    const perHour = extractionPerDay(sim, c) / 24;
    if (perHour > 0) c.stored = Math.round((c.stored + perHour) * 1000) / 1000;
  }
}

/** Daily (= monthly ledger) income from the specialisations, by ledger line. */
export function specialisationIncome(sim: Sim): Record<string, number> {
  const s = sim.state;
  const out: Record<string, number> = {};
  const t = s.tourism;
  if (t.visitors > 0)
    out.tourism =
      (t.visitors - t.overnight) * SPECIALISATION.daySpend + t.overnight * SPECIALISATION.nightSpend;
  let resources = 0;
  for (const c of s.civics.values()) {
    const r = civicDef(c).resource;
    if (r) resources += extractionPerDay(sim, c) * r.price;
  }
  if (resources > 0) out.resources = resources;
  const eff = Math.min(1.25, sim.fundingEff('trade'));
  const hubs = working(sim, (c) => ships(sim, c));
  if (hubs.length) {
    // The first terminal ships at full rate; a second adds half as much again.
    const per = civicDef(hubs[0]!).freight!.perJob;
    out.trade = industrialJobs(sim) * per * (hubs.length > 1 ? 1.5 : 1) * eff;
  }
  // A seaport (M23) ships goods by sea: trade income from every industrial job.
  const port = working(sim, (c) => !!civicDef(c).seaport)[0];
  if (port) out.trade = (out.trade ?? 0) + industrialJobs(sim) * civicDef(port).seaport!.tradePerJob * eff;
  const parks = working(sim, (c) => !!civicDef(c).research);
  // The launch complex (M17) makes research worth half as much again.
  const boost = openProject(sim, 'launchsite')
    ? (CIVIC.get('launchsite')?.project?.research?.income ?? 1)
    : 1;
  if (parks.length) out.technology = highTechJobs(sim) * civicDef(parks[0]!).research!.perJob * eff * boost;
  return out;
}
