import { ZONE_R } from '../../data/zones';
import type { Sim } from '../sim';
import { BState } from '../world/buildings';
import { fieldAt } from './pollution';

/**
 * City history (M16): key figures over the city's whole life, recorded as each game month closes (a
 * day-night cycle is a month) and averaged into buckets that double in length whenever a series
 * fills up, so a city of any age keeps at most `CHRONICLE.maxPoints` points per figure (a few
 * kilobytes in a save) covering its whole story: month by month for its first 20 years, then two
 * months a point, and so on. Milestones and disasters are kept as events on the timeline.
 */

export const CHRONICLE_SERIES = [
  'population',
  'approval',
  'jobs',
  'unemployment',
  'treasury',
  'income',
  'spending',
  'pollution',
  'crime',
  'traffic',
] as const;
export type SeriesKey = (typeof CHRONICLE_SERIES)[number];

export const CHRONICLE = {
  /** Points kept per series before pairs are merged and the bucket doubles. */
  maxPoints: 240,
  /** Events kept (the oldest go first). */
  maxEvents: 300,
};

export interface ChronicleEvent {
  tick: number;
  kind: 'milestone' | 'disaster';
  /** Milestone index, or the disaster's kind. */
  ref: number | string;
}

export interface Chronicle {
  /** Tick the history starts at (for a city from before M16, when it was first loaded). */
  start: number;
  /** Months per point; doubles when the series fill up. */
  step: number;
  /** Months summed into the bucket being filled, and their sums. */
  months: number;
  acc: number[];
  /** One array per CHRONICLE_SERIES entry, oldest first. */
  series: number[][];
  events: ChronicleEvent[];
}

export function emptyChronicle(tick: number): Chronicle {
  return {
    start: tick,
    step: 1,
    months: 0,
    acc: CHRONICLE_SERIES.map(() => 0),
    series: CHRONICLE_SERIES.map(() => []),
    events: [],
  };
}

/** Figures for the month just closed, in CHRONICLE_SERIES order (call right after closing it). */
export function monthFigures(sim: Sim): number[] {
  const s = sim.state;
  const t = s.totals;
  let residents = 0;
  let air = 0;
  let crime = 0;
  let commuters = 0;
  let commute = 0;
  for (const b of s.buildings.values()) {
    if (b.zone !== ZONE_R || b.state !== BState.Active || b.pop <= 0) continue;
    residents += b.pop;
    air += fieldAt(s.airPollution, b.x, b.z) * b.pop;
    crime += fieldAt(s.crime, b.x, b.z) * b.pop;
    if (b.employed > 0) {
      commuters += b.employed;
      commute += b.commute * b.employed;
    }
  }
  // The month's ledger: income leaves out borrowing (loans taken) and cheats.
  let income = 0;
  let spending = 0;
  const month = s.economy.history[s.economy.history.length - 1];
  for (const [line, v] of Object.entries(month?.lines ?? {})) {
    if (v < 0) spending -= v;
    else if (line !== 'loans' && line !== 'cheats') income += v;
  }
  const figures: Record<SeriesKey, number> = {
    population: t.population,
    approval: t.approval * 100,
    jobs: t.jobs,
    unemployment: t.workers > 0 ? (t.unemployed / t.workers) * 100 : 0,
    treasury: s.treasury,
    income,
    spending,
    pollution: residents ? (air / residents) * 100 : 0,
    crime: residents ? (crime / residents) * 100 : 0,
    // Average commute, minutes.
    traffic: commuters ? commute / commuters / 60 : 0,
  };
  return CHRONICLE_SERIES.map((k) => figures[k]);
}

/** Add a month's figures; close the bucket when it holds `step` months, halving the series when full. */
export function recordMonth(c: Chronicle, figures: number[]): void {
  for (let i = 0; i < figures.length; i++) c.acc[i]! += figures[i]!;
  c.months++;
  if (c.months < c.step) return;
  for (let i = 0; i < c.series.length; i++) {
    // Two decimals: plenty for a chart, and it keeps saves small.
    c.series[i]!.push(Math.round((c.acc[i]! / c.months) * 100) / 100);
    c.acc[i] = 0;
  }
  c.months = 0;
  if (c.series[0]!.length >= CHRONICLE.maxPoints) {
    for (let i = 0; i < c.series.length; i++) {
      const s = c.series[i]!;
      const merged: number[] = [];
      for (let k = 0; k + 1 < s.length; k += 2)
        merged.push(Math.round(((s[k]! + s[k + 1]!) / 2) * 100) / 100);
      c.series[i] = merged;
    }
    c.step *= 2;
  }
}

export function chronicleEvent(sim: Sim, kind: ChronicleEvent['kind'], ref: number | string): void {
  const ev = sim.state.chronicle.events;
  ev.push({ tick: sim.state.tick, kind, ref });
  if (ev.length > CHRONICLE.maxEvents) ev.splice(0, ev.length - CHRONICLE.maxEvents);
}
