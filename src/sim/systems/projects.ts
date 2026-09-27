import { CIVIC, type CivicDef } from '../../data/civic';
import type { ProjectRequirement } from '../../data/projects';
import type { Sim } from '../sim';
import type { Civic } from '../world/civic';
import { dateOf, TICKS_PER_MONTH } from '../time';
import { civicOnline } from '../world/civic';
import { chronicleEvent } from './chronicle';

/**
 * Big projects (M17): civic buildings raised in stages over months. Placing one pays for its first
 * stage; as each month closes the stage in hand moves on, and when it's done the next stage starts
 * if the treasury can pay for it (otherwise the site waits, and says so). Until the last stage is
 * finished the building does nothing (`civicOnline` is false) and costs no upkeep.
 */

/** Construction in hand: the stage being built and the months spent on it. */
export interface ProjectBuild {
  stage: number;
  months: number;
  /** The last stage finished but the next couldn't be paid for yet. */
  waiting: boolean;
}

export interface RequirementStatus {
  label: string;
  met: boolean;
  /** Where the city stands ("12,400 residents"). */
  now: string;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

function requirement(sim: Sim, r: ProjectRequirement): RequirementStatus {
  const s = sim.state;
  switch (r.kind) {
    case 'population': {
      const pop = Math.max(s.progress.peak, s.totals.population);
      return {
        label: `${r.min.toLocaleString('en-US')} residents`,
        met: pop >= r.min,
        now: `${pop.toLocaleString('en-US')} so far`,
      };
    }
    case 'education': {
      const share = s.totals.eduWorkforce[r.level - 1] ?? 0;
      const what = r.level === 1 ? 'a basic education' : 'a high-school education';
      return {
        label: `${pct(r.share)} of workers with ${what}`,
        met: share >= r.share,
        now: `${pct(share)} now`,
      };
    }
    case 'civic': {
      const has = [...s.civics.values()].some((c) => c.def === r.def && !c.build);
      return { label: `The city runs ${r.label}`, met: has, now: has ? 'yes' : 'not yet' };
    }
    case 'visitors':
      return {
        label: `${r.min.toLocaleString('en-US')} visitors a day`,
        met: s.tourism.visitors >= r.min,
        now: `${s.tourism.visitors.toLocaleString('en-US')} now`,
      };
  }
}

/** Every requirement of a project and whether the city meets it. */
export function projectRequirements(sim: Sim, def: CivicDef): RequirementStatus[] {
  return (def.project?.requires ?? []).map((r) => requirement(sim, r));
}

/** Why a project can't be started yet, or null. */
export function projectBlocked(sim: Sim, def: CivicDef): string | null {
  const missing = projectRequirements(sim, def).find((r) => !r.met);
  return missing
    ? `Needs ${missing.label.charAt(0).toLowerCase()}${missing.label.slice(1)} (${missing.now})`
    : null;
}

/** What a project costs in all, and what its first stage costs (paid when it's placed). */
export function projectCost(def: CivicDef): { total: number; first: number } {
  const stages = def.project?.stages ?? [];
  return { total: stages.reduce((a, st) => a + st.cost, 0), first: stages[0]?.cost ?? def.cost };
}

/** The price to put a civic building down: a project's first stage, or the building's cost. */
export function placementPrice(def: CivicDef): number {
  return def.project ? projectCost(def).first : def.cost;
}

/** Months a project still needs, if every stage starts on time. */
export function monthsLeft(c: Civic): number {
  const def = CIVIC.get(c.def)!;
  if (!c.build || !def.project) return 0;
  let m = def.project.stages[c.build.stage]!.months - c.build.months;
  for (let k = c.build.stage + 1; k < def.project.stages.length; k++) m += def.project.stages[k]!.months;
  return Math.max(0, m);
}

/** As each month closes: move every building site on, starting the next stage where it can. */
export function projectsMonth(sim: Sim): void {
  const s = sim.state;
  for (const c of [...s.civics.values()].sort((a, b) => a.id - b.id)) {
    const b = c.build;
    const def = CIVIC.get(c.def);
    if (!b || !def?.project) continue;
    const stages = def.project.stages;
    if (!b.waiting) b.months++;
    if (b.months < stages[b.stage]!.months) continue;
    if (b.stage + 1 >= stages.length) {
      delete c.build;
      sim.civicStatusChanged(c.id);
      sim.events.push({ kind: 'projectDone', id: c.id });
      chronicleEvent(sim, 'project', c.def);
      continue;
    }
    const next = stages[b.stage + 1]!;
    if (!s.options.sandbox && s.treasury < next.cost) {
      if (!b.waiting) sim.events.push({ kind: 'projectWaiting', id: c.id });
      b.waiting = true;
      continue;
    }
    sim.spend(next.cost, 'projects');
    c.cost += next.cost;
    b.stage++;
    b.months = 0;
    b.waiting = false;
    sim.civicStatusChanged(c.id);
    sim.events.push({ kind: 'projectStage', id: c.id });
  }
}

/** A finished project that is running (online and on a connected road), if the city has one. */
export function openProject(sim: Sim, defId: string): Civic | undefined {
  for (const c of sim.state.civics.values())
    if (c.def === defId && civicOnline(c) && c.access && sim.isSegmentConnected(c.access.seg)) return c;
  return undefined;
}

/**
 * Perks that happen on a schedule, as each month closes: the stadium's match days (visitors, a
 * crowd on the roads and a cheer for the whole city) and the launch complex's launches.
 */
export function projectEvents(sim: Sim): void {
  const s = sim.state;
  const month = dateOf(s.tick).totalMonths;
  const stadium = openProject(sim, 'stadium');
  const md = CIVIC.get('stadium')?.project?.matchDays;
  if (stadium && md && month % md.every === 0) {
    s.matchDay = { civic: stadium.id, until: s.tick + TICKS_PER_MONTH };
    sim.events.push({ kind: 'matchDay', id: stadium.id });
  } else if (s.matchDay && s.tick >= s.matchDay.until) s.matchDay = null;
  const launch = openProject(sim, 'launchsite');
  if (launch && month % 3 === 0) sim.events.push({ kind: 'launch', id: launch.id });
}

/** The match day under way, if any: visitors it draws, cars to the ground, and the city's cheer. */
export function matchDayNow(
  sim: Sim,
): { civic: Civic; visitors: number; trips: number; approval: number } | null {
  const s = sim.state;
  const md = s.matchDay;
  const def = CIVIC.get('stadium')?.project?.matchDays;
  if (!md || !def || s.tick >= md.until) return null;
  const civic = s.civics.get(md.civic);
  if (!civic || !civicOnline(civic)) return null;
  return { civic, visitors: def.visitors, trips: def.trips, approval: def.approval };
}
