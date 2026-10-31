/**
 * The atom bomb (M40, SPEC-5.md): the last prize cities race for. This module is its state and its
 * gates (`docs/plans/M40-design.md`, calls 1 to 4): what a city has made so far, the stage that
 * follows from it, and why the enrichment plant and the silo can or can't be put down. Fuel, the
 * build, the launch, the flight and the impact come in later steps. `WarState.atom` appears when
 * first used, so every city that never races is exactly as before; nothing here draws from a random
 * stream.
 */
import { ATOM, type AtomStage } from '../../data/atom';
import { CIVIC } from '../../data/civic';
import { requirementStatus } from '../../data/projects';
import type { Sim } from '../sim';
import { TICKS_PER_HOUR } from '../time';
import { civicOnline, type Civic } from '../world/civic';
import { allTiersDone, researchTree } from './research';
import { requirementContext } from './projects';
import { civicOutput } from './utilities';

/**
 * The city's bomb race (`WarState.atom`), made when the first fact is set. The stage is derived from
 * these and from the two buildings (`atomStage`), never stored. One bomb a city, ever: once `fired`
 * is set, no plant, silo or bomb can follow it. A bomb being built (`bomb`) and a finished one
 * (`have`, then `prep`, then `fired`) never stand together.
 */
export interface Atom {
  /** War hours of fuel made, 0 to `ATOM.fuel.hours`; a plant lost halves it. */
  fuel: number;
  /** The bomb being built: war hours done, and instalments paid (of twelve, which stay spent if it is called off). */
  bomb?: { done: number; paid: number };
  /** The finished bomb, in the silo. */
  have?: true;
  /** A launch being prepared: war hours done of `ATOM.launch.prepHours`. */
  prep?: { done: number };
  /**
   * The bomb has left: the tick, the neighbour it was aimed at (its id and name) and, for a friend,
   * its place in the region. It is the end of the race for this city.
   */
  fired?: { tick: number; to: number; name: string; slot?: number };
  /**
   * A bomb on its way to this city, who sent it, the ticks it was warned of and lands at, and
   * ground zero (fixed when it was accepted).
   */
  inbound?: { from: number; name: string; slot?: number; warn: number; arrive: number; x: number; z: number };
  /** The landing in hand: hourly slices done, residents who have left the city so far, ground zero. */
  impact?: { done: number; fled: number; x: number; z: number };
  /** The city finished a bomb before every other city in its region (the achievement's fact). */
  first?: true;
  /** Bombs that have landed in this city, and bombs its dome has stopped. */
  boom: number;
  stopped: number;
}

/** The city's bomb race, made on first use (the caller is about to set a fact in it). */
export function atomOf(sim: Sim): Atom {
  const w = sim.state.war!;
  return (w.atom ??= { fuel: 0, boom: 0, stopped: 0 });
}

/**
 * May the city race for the bomb at all (M40, call 3)? In a region, only if its host's rules allow
 * it, which they can only with total war and superweapons; in a city of its own, if it has rivals.
 */
export function bombAllowed(sim: Sim): boolean {
  const s = sim.state;
  if (!s.war) return false;
  const rules = s.region.rules;
  if (rules) return rules.war && rules.scale === 'total' && rules.supers === true && rules.bomb === true;
  return !!s.options.rivals;
}

/** The city's building of a kind (a project may still be going up), if it has one. */
export function civicOfDef(sim: Sim, def: string): Civic | undefined {
  for (const c of sim.state.civics.values()) if (c.def === def) return c;
  return undefined;
}

/**
 * A nuclear power plant is running (M40): online and giving power. The enrichment plant feeds on its
 * power, so a plant that is closed, flooded, unfunded or blacked out doesn't count.
 */
export function nuclearRunning(sim: Sim): boolean {
  for (const c of sim.state.civics.values())
    if (c.def === 'nuclear' && civicOnline(c) && civicOutput(sim, c, 'power') > 0) return true;
  return false;
}

/** Does the city have a building of this kind that works now (a nuclear plant: that is giving power)? */
export function civicRunning(sim: Sim, def: string): boolean {
  if (def === 'nuclear') return nuclearRunning(sim);
  for (const c of sim.state.civics.values()) if (c.def === def && civicOnline(c)) return true;
  return false;
}

/**
 * Where the city stands in the race (M40, call 1), the furthest step it has reached: from nothing
 * (`none`) through the plant going up, fuel being made, the silo going up, the bomb being built and
 * ready, to a launch being prepared, the bomb in flight (a game day after it left) and used. The
 * plant counts as making fuel once it is finished with fuel in hand, whether or not damage has
 * closed it for the moment, so a stage doesn't flicker.
 */
export function atomStage(sim: Sim): AtomStage {
  const a = sim.state.war?.atom;
  const fired = a?.fired;
  if (fired) return sim.state.tick < fired.tick + ATOM.flight.hours * TICKS_PER_HOUR ? 'flying' : 'spent';
  if (a?.prep) return 'preparing';
  if (a?.have) return 'ready';
  if (a?.bomb) return 'bomb';
  if (civicOfDef(sim, 'atomsilo')) return 'silo';
  const plant = civicOfDef(sim, 'enrichment');
  if (plant && !plant.build && (a?.fuel ?? 0) > 0) return 'enriching';
  return plant ? 'plant' : 'none';
}

/**
 * Why the city can't put down this building for want of the bomb's conditions, or null (also for
 * every building but the enrichment plant and the silo). The first missing step, in plain words:
 * every research branch maxed, the rules, no scenario, the bomb not already used, then the plant's
 * nuclear plant or the silo's enrichment plant. The requirement lines are the buildings' own, the
 * ones the build menu shows. A hard gate, reached from `civicLock`, which sandbox cannot skip.
 */
export function atomLock(sim: Sim, defId: string): string | null {
  const def = CIVIC.get(defId);
  if (!def?.military?.atom) return null;
  const ctx = requirementContext(sim);
  const needs = (research: boolean): string | null => {
    for (const r of def.project?.requires ?? []) {
      if ((r.kind === 'researchAll') !== research) continue;
      const st = requirementStatus(r, ctx);
      if (!st.met) return `Needs ${st.label.charAt(0).toLowerCase()}${st.label.slice(1)} (${st.now})`;
    }
    return null;
  };
  if (!allTiersDone(sim)) return needs(true) ?? 'Needs every research branch maxed';
  if (!bombAllowed(sim))
    return sim.state.region.rules
      ? 'Your region’s rules turn the atom bomb off'
      : 'The atom bomb needs rival neighbours or a region whose rules allow it';
  if (sim.state.scenario) return 'The atom bomb is not part of a scenario';
  if (sim.state.war?.atom?.fired) return 'The city has used its atom bomb: there is only ever one';
  return needs(false);
}

/** The city's race as the page shows it (M40): what the build menu and the war room need to know. */
export interface AtomSummary {
  /** The rules (or the city's rivals) allow the bomb. */
  allowed: boolean;
  stage: AtomStage;
  /** Tiers of the research tree done, in all, and the name of the first still to do. */
  research: { done: number; total: number; next: string | null };
  /** A nuclear plant is giving power; the enrichment plant is online. */
  nuclear: boolean;
  plant: boolean;
  /** Fuel made, 0 to 1. */
  fuel: number;
}

export function atomSummary(sim: Sim): AtomSummary | null {
  const w = sim.state.war;
  if (!w) return null;
  const tree = researchTree(sim);
  return {
    allowed: bombAllowed(sim),
    stage: atomStage(sim),
    research: { done: tree.done, total: tree.total, next: tree.next ?? null },
    nuclear: nuclearRunning(sim),
    plant: civicRunning(sim, 'enrichment'),
    fuel: Math.round(Math.min(1, (w.atom?.fuel ?? 0) / ATOM.fuel.hours) * 1000) / 1000,
  };
}
