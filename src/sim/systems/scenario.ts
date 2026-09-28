import { goalMet, SCENARIO, starMet, type ScenarioDef, type ScenarioGoal } from '../../data/scenarios';
import type { CommandResult } from '../commands';
import type { Sim } from '../sim';
import { START_TICK_OFFSET, TICKS_PER_MONTH } from '../time';
import { BState } from '../world/buildings';
import { CHRONICLE_SERIES, monthFigures, type SeriesKey } from './chronicle';
import { openProject } from './projects';

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
}

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
  return { ok: true, cost: 0 };
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
