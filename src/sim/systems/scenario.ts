import { CIVIC } from '../../data/civic';
import { goalMet, SCENARIO, starMet, type ScenarioDef, type ScenarioGoal } from '../../data/scenarios';
import { UNIT } from '../../data/war';
import { ZONE_C, ZONE_I, ZONE_R } from '../../data/zones';
import { objectiveSpots } from '../battle/layout';
import type { CommandResult } from '../commands';
import { Rng } from '../rng';
import type { Sim } from '../sim';
import { districtAt } from './districts';
import { dateOf, START_TICK_OFFSET, TICKS_PER_MONTH } from '../time';
import { BState } from '../world/buildings';
import { CHRONICLE_SERIES, monthFigures, type SeriesKey } from './chronicle';
import { openProject } from './projects';
import { planRaid } from './raids';

/**
 * Scenarios (M18): the city's scenario, if it's playing one. Goals are checked as each month closes
 * (all must hold at once, each for as many months in a row as it asks); the scenario is lost when
 * time runs out, the city goes bankrupt, or (where it says so) an election is lost. After it ends the
 * city plays on as an ordinary one.
 */

export interface ScenarioState {
  id: string;
  /** Tick it began. */
  start: number;
  status: 'playing' | 'won' | 'lost';
  stars: number;
  /** Tick it was won or lost (-1 while playing). */
  end: number;
  reason: '' | 'time' | 'bankrupt' | 'election';
  /** Month closes in a row each goal has held. */
  held: number[];
  /** The buildings standing when it began (their ids, by zone), for a `standing` goal (M39). */
  base?: Record<'R' | 'C' | 'I', number[]>;
  /** The raids its script has sent, in order (M39: their ids). */
  waves?: number[];
  /** Things that happened since it began (M39): wars won, districts lost, towns freed. */
  facts?: Partial<Record<ScenarioFact, number>>;
}

/** What the scenario keeps count of as it happens (M39). */
export type ScenarioFact = 'warWon' | 'districtsLost' | 'liberated';

export interface ScenarioSummary {
  id: string;
  status: ScenarioState['status'];
  stars: number;
  reason: ScenarioState['reason'];
  /** Months left (fractional) while playing; months taken once it's over. */
  monthsLeft: number;
  monthsTaken: number;
  goals: {
    measure: ScenarioGoal['measure'];
    label: string;
    value: number;
    min?: number;
    max?: number;
    met: boolean;
    held: number;
    hold: number;
  }[];
}

export function scenarioDef(sim: Sim): ScenarioDef | undefined {
  const sc = sim.state.scenario;
  return sc ? SCENARIO.get(sc.id) : undefined;
}

/** Tick the scenario's time runs out: the first month close on or after its months are up. */
function deadline(sc: ScenarioState, def: ScenarioDef): number {
  const due = sc.start + def.months * TICKS_PER_MONTH;
  // Months close when the clock (START_TICK_OFFSET ahead of the tick) passes midnight.
  const into = (due + START_TICK_OFFSET) % TICKS_PER_MONTH;
  return into === 0 ? due : due + TICKS_PER_MONTH - into;
}

/** Start a scenario on the city that's loaded (its starting save). */
export function startScenario(sim: Sim, id: string, dryRun: boolean): CommandResult {
  const def = SCENARIO.get(id);
  if (!def) return { ok: false, reason: 'Unknown scenario' };
  if (sim.state.scenario) return { ok: false, reason: 'This city is already playing a scenario' };
  if (dryRun) return { ok: true, cost: 0 };
  const s = sim.state;
  s.options = { ...s.options, sandbox: false, disasters: def.disasters, elections: def.elections };
  s.weather.seasons = def.weather?.seasons ?? true;
  s.weather.intensity = def.weather?.intensity ?? 2;
  // Neighbours (M23): a scenario that doesn't mention them is played without them, so the puzzle
  // is the town's own.
  if (!def.region) s.region = { neighbours: [], deals: [], nextDeal: s.region.nextDeal };
  if (!def.elections) {
    s.election.nextMonth = -1;
    s.election.promises = [];
  }
  s.scenario = {
    id,
    start: s.tick,
    status: 'playing',
    stars: 0,
    end: -1,
    reason: '',
    held: def.goals.map(() => 0),
  };
  // A goal over the buildings standing counts them as the scenario begins (M39).
  if (
    [...def.goals, ...def.stars.flatMap((r) => (r.goal ? [r.goal] : []))].some(
      (g) => g.measure === 'standing',
    )
  )
    s.scenario.base = standingBase(sim);
  return { ok: true, cost: 0 };
}

/** The buildings of the town, not in rubble, by zone (M39). */
function standingBase(sim: Sim): NonNullable<ScenarioState['base']> {
  const base: NonNullable<ScenarioState['base']> = { R: [], C: [], I: [] };
  for (const b of sim.state.buildings.values()) {
    if (b.state === BState.Rubble) continue;
    if (b.zone === ZONE_R) base.R.push(b.id);
    else if (b.zone === ZONE_C) base.C.push(b.id);
    else if (b.zone === ZONE_I) base.I.push(b.id);
  }
  for (const ids of Object.values(base)) ids.sort((a, b) => a - b);
  return base;
}

/** The share (%) of the buildings the scenario began with (of this zone, or all) that still stand, not in rubble (M39). */
function standingShare(sim: Sim, g: ScenarioGoal): number {
  const base = sim.state.scenario?.base;
  if (!base) return 100;
  const ids = g.zone ? base[g.zone] : [...base.R, ...base.C, ...base.I];
  if (!ids.length) return 100;
  let n = 0;
  for (const id of ids) {
    const b = sim.state.buildings.get(id);
    if (b && b.state !== BState.Rubble) n++;
  }
  return Math.round((n / ids.length) * 1000) / 10;
}

/** Something the scenario counts happened (M39); nothing happens when no scenario is playing. */
export function scenarioFact(sim: Sim, fact: ScenarioFact): void {
  const sc = sim.state.scenario;
  if (!sc || sc.status !== 'playing') return;
  const facts = (sc.facts ??= {});
  facts[fact] = (facts[fact] ?? 0) + 1;
}

/** Whether the city's scenario scripts its invasion: the neighbours raid and declare war only as it says (M39). */
export function scriptedInvasion(sim: Sim): boolean {
  const sc = sim.state.scenario;
  if (!sc || sc.status !== 'playing') return false;
  return !!SCENARIO.get(sc.id)?.script;
}

/** Waves of the script fought to an end: sent, and neither on their way nor being fought. */
function wavesDone(sim: Sim): number {
  const sc = sim.state.scenario;
  const w = sim.state.war;
  if (!sc?.waves || !w) return 0;
  return sc.waves.filter((id) => w.battle?.id !== id && !w.incoming?.some((r) => r.id === id)).length;
}

/**
 * The script's next wave, if it is due (M39): the neighbour sets off with the force the script
 * names, on the war's own dice. A raid already on its way or being fought holds it to the next month.
 */
function fireScript(sim: Sim, sc: ScenarioState, def: ScenarioDef): void {
  const w = sim.state.war;
  const step = def.script?.[sc.waves?.length ?? 0];
  if (!w || !step) return;
  const elapsed = dateOf(sim.state.tick).totalMonths - dateOf(sc.start).totalMonths;
  if (elapsed < step.month || w.battle || w.incoming?.length) return;
  const n = sim.state.region.neighbours.filter((x) => x.rival && !x.player)[step.raid.rival];
  if (!n?.rival) return;
  const rng = new Rng(w.rng);
  const raid = planRaid(sim, n, n.rival, rng, step.raid.hours);
  w.rng = rng.getState();
  const units = step.raid.units?.filter((k) => UNIT.has(k)).slice(0, 24);
  if (units?.length) {
    raid.units = units.map((kind) => ({ kind, hp: 1 }));
    // Its warning (already given) counts the force it brings.
    for (const e of sim.events)
      if (e.kind === 'raidWarning' && e.id === raid.id && e.info) e.info.units = raid.units.length;
  }
  if (step.raid.target && (step.raid.target === 'military' || objectiveSpots(sim, step.raid.target).length))
    raid.target = step.raid.target;
  (sc.waves ??= []).push(raid.id);
}

/** A goal's current value (`figures` are the city history's figures, if already worked out). */
export function goalValue(sim: Sim, g: ScenarioGoal, figures?: number[]): number {
  const s = sim.state;
  const figs = () => figures ?? (figures = monthFigures(sim));
  const series = CHRONICLE_SERIES.indexOf(g.measure as SeriesKey);
  if (series >= 0) return figs()[series]!;
  switch (g.measure) {
    case 'net': {
      const f = figs();
      return f[CHRONICLE_SERIES.indexOf('income')]! - f[CHRONICLE_SERIES.indexOf('spending')]!;
    }
    case 'visitors':
      return s.tourism.visitors;
    case 'abandoned': {
      let n = 0;
      for (const b of s.buildings.values()) if (b.state === BState.Abandoned) n++;
      return n;
    }
    case 'loans':
      return s.economy.loans.length;
    case 'project':
      return g.def && openProject(sim, g.def) ? 1 : 0;
    case 'election': {
      const start = s.scenario?.start ?? 0;
      return s.election.results.some((r) => r.won && r.tick >= start) ? 1 : 0;
    }
    case 'trucks':
      return Math.round(s.traffic.get(s.highway.segment) ?? 0);
    case 'districtTraffic': {
      // A district that's gone (dissolved) can't meet the goal.
      if (g.district === undefined || !s.districts.has(g.district)) return Infinity;
      let most = 0;
      for (const seg of s.net.segments.values()) {
        const c = sim.net.curve(seg.id);
        const p = c.pointAt(c.length / 2);
        if (districtAt(s.districtCells, p.x, p.z) === g.district)
          most = Math.max(most, s.traffic.get(seg.id) ?? 0);
      }
      return Math.round(most);
    }
    case 'shipped': {
      let n = 0;
      for (const c of s.civics.values()) if (CIVIC.get(c.def)?.seaport) n += sim.railFreight.get(c.id) ?? 0;
      return Math.round(n);
    }
    case 'powered': {
      const u = s.utilityStats.power;
      const n = u.served + u.unserved;
      return n ? Math.round((u.served / n) * 1000) / 10 : 100;
    }
    case 'riders':
      return sim
        .lines()
        .filter((l) => l.mode !== 'bus')
        .reduce((n, l) => n + (s.transit.riders.get(l.depot) ?? 0), 0);
    case 'standing':
      return standingShare(sim, g);
    case 'waves':
      return wavesDone(sim);
    case 'warWon':
    case 'districtsLost':
    case 'liberated':
      return s.scenario?.facts?.[g.measure] ?? 0;
    default:
      return 0;
  }
}

/** End the scenario (won or lost) and tell the player. */
function finish(
  sim: Sim,
  sc: ScenarioState,
  def: ScenarioDef,
  won: boolean,
  reason: ScenarioState['reason'],
) {
  sc.status = won ? 'won' : 'lost';
  sc.end = sim.state.tick;
  sc.reason = reason;
  if (won) {
    const months = Math.ceil((sc.end - sc.start) / TICKS_PER_MONTH - 1e-9);
    const figures = monthFigures(sim);
    sc.stars = 1 + def.stars.filter((r) => starMet(r, months, (g) => goalValue(sim, g, figures))).length;
  }
  sim.events.push({ kind: won ? 'scenarioWon' : 'scenarioLost', id: sc.stars, info: { reason } });
}

/** As each month closes (after the ledger, history and elections): check the goals and the clock. */
export function scenarioMonth(sim: Sim): void {
  const sc = sim.state.scenario;
  const def = scenarioDef(sim);
  if (!sc || !def || sc.status !== 'playing') return;
  if (def.mustWinElection && sim.state.election.results.some((r) => !r.won && r.tick >= sc.start)) {
    finish(sim, sc, def, false, 'election');
    return;
  }
  const figures = monthFigures(sim);
  let all = true;
  def.goals.forEach((g, i) => {
    sc.held[i] = goalMet(g, goalValue(sim, g, figures)) ? sc.held[i]! + 1 : 0;
    if (sc.held[i]! < (g.hold ?? 1)) all = false;
  });
  if (all) finish(sim, sc, def, true, '');
  else if (sim.state.tick >= deadline(sc, def)) finish(sim, sc, def, false, 'time');
  else if (def.script) fireScript(sim, sc, def);
}

/** The city went bankrupt: a scenario in play is lost. */
export function scenarioBankrupt(sim: Sim): void {
  const sc = sim.state.scenario;
  const def = scenarioDef(sim);
  if (sc && def && sc.status === 'playing') finish(sim, sc, def, false, 'bankrupt');
}

/** Why the scenario's limits forbid something, or null. */
export function scenarioForbids(
  sim: Sim,
  what: { civic?: string; loan?: boolean; zone?: string; tax?: number },
): string | null {
  const sc = sim.state.scenario;
  const def = scenarioDef(sim);
  if (!sc || !def || sc.status !== 'playing') return null;
  for (const l of def.limits) {
    if (l.kind === 'noCivic' && what.civic && l.defs.includes(what.civic))
      return `${l.label} in this scenario`;
    if (l.kind === 'noLoans' && what.loan) return `${l.label} in this scenario`;
    if (l.kind === 'noZone' && what.zone === l.zone) return `${l.label} in this scenario`;
    if (l.kind === 'maxTax' && what.tax !== undefined && what.tax > l.rate)
      return `${l.label} in this scenario`;
  }
  return null;
}

/** Where the scenario stands, for the goals panel (null without one). */
export function scenarioSummary(sim: Sim): ScenarioSummary | null {
  const sc = sim.state.scenario;
  const def = scenarioDef(sim);
  if (!sc || !def) return null;
  const figures = monthFigures(sim);
  const now = sc.status === 'playing' ? sim.state.tick : sc.end;
  return {
    id: sc.id,
    status: sc.status,
    stars: sc.stars,
    reason: sc.reason,
    monthsLeft: Math.max(0, (deadline(sc, def) - now) / TICKS_PER_MONTH),
    monthsTaken: (now - sc.start) / TICKS_PER_MONTH,
    goals: def.goals.map((g, i) => {
      const value = goalValue(sim, g, figures);
      return {
        measure: g.measure,
        label: g.label,
        value,
        min: g.min,
        max: g.max,
        met: goalMet(g, value),
        held: sc.held[i] ?? 0,
        hold: g.hold ?? 1,
      };
    }),
  };
}
