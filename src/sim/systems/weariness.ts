/**
 * War weariness (phase 5, M38 step 6, docs/plans/M38-design.md call 7). The longer the city is at war,
 * the more tired its people are: weariness (0 to 1) grows each hour a war is open with the city
 * (`fightingWith`: not paused by a ceasefire or ended by a capitulation), faster in a total war and
 * in a war being lost, and each raid that reaches the city adds to it. It costs approval (a term in
 * the city-wide cheer) and, past half, growth (a happiness factor for homes). With no war it falls;
 * the end of a war that really tired the city starts a short recovery, a cheer that eases away.
 *
 * It lives in `WarEconomy.weariness` and appears with the first war hour or raid: a peaceful city has
 * no `WarState` and so reads 0 everywhere here. Every rise is scaled by the difficulty.
 */
import { WEARINESS } from '../../data/warEconomy';
import type { Sim } from '../sim';
import { HOURS_PER_DAY, TICKS_PER_MONTH } from '../time';
import { fightingWith, note } from './diplomacy';
import { economy, warDifficulty } from './warEconomy';

const round5 = (v: number) => Math.round(v * 100_000) / 100_000;

/** How tired of war the city is, 0 to 1 (0 in peace and in a city that has never been at war). */
export function weariness(sim: Sim): number {
  return sim.state.war?.economy?.weariness ?? 0;
}

/** The cheer a recovery gives now: `WEARINESS.recovery.cheer` at its start, easing to nothing. */
export function recoveryCheer(sim: Sim): number {
  const until = sim.state.war?.economy?.recoveryUntil;
  if (until === undefined) return 0;
  const left = until - sim.state.tick;
  if (left <= 0) return 0;
  const R = WEARINESS.recovery;
  return (R.cheer * left) / (R.days * TICKS_PER_MONTH);
}

/** What weariness (and the recovery from it) adds to the whole city's approval: negative while weary. */
export function warCheer(sim: Sim): number {
  const e = sim.state.war?.economy;
  if (!e || (e.weariness === undefined && e.recoveryUntil === undefined)) return 0;
  return (e.weariness ?? 0) * WEARINESS.approval + recoveryCheer(sim);
}

/** The happiness a home loses to being tired of war: 0 up to half weariness, then to `WEARINESS.growth` at full. */
export function tiredOfWar(sim: Sim): number {
  const v = weariness(sim);
  if (v <= WEARINESS.growthFrom) return 0;
  return (WEARINESS.growth * (v - WEARINESS.growthFrom)) / (1 - WEARINESS.growthFrom);
}

/**
 * What the war is doing to the city's spirits now, per game hour: the rise while a war is open (with
 * its multipliers), or the fall (negative) in peace. Null when nothing is happening.
 */
export function wearinessRate(sim: Sim): number | null {
  const w = sim.state.war;
  if (!w) return null;
  let fighting = false;
  let total = false;
  let losing = false;
  for (const war of w.diplomacy?.wars ?? []) {
    if (!fightingWith(sim, war.with)) continue;
    fighting = true;
    if (war.scale === 'total') total = true;
    if (war.score <= WEARINESS.losingBelow) losing = true;
  }
  if (fighting)
    return round5(
      WEARINESS.perHour *
        (total ? WEARINESS.total : 1) *
        (losing ? WEARINESS.losing : 1) *
        warDifficulty(sim).weariness,
    );
  return weariness(sim) > 0 ? -WEARINESS.fallPerHour : null;
}

/** Each war hour: weariness grows while a war is open with the city, and falls when none is. */
export function wearinessHour(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  const rate = wearinessRate(sim);
  if (rate === null) return;
  if (rate > 0) {
    const e = economy(sim);
    // Fighting again ends the relief of an earlier peace.
    delete e.recoveryUntil;
    e.weariness = Math.min(1, round5((e.weariness ?? 0) + rate));
  } else {
    const e = w.economy!;
    const v = round5((e.weariness ?? 0) + rate);
    if (v <= 0) delete e.weariness;
    else e.weariness = v;
  }
  sim.warChanged();
}

/** A raid has reached the city (a computer neighbour's, or a friend's taken here): the people mind. */
export function wearinessRaid(sim: Sim): void {
  if (!sim.state.war) return;
  const e = economy(sim);
  delete e.recoveryUntil;
  e.weariness = Math.min(1, round5((e.weariness ?? 0) + WEARINESS.perRaid * warDifficulty(sim).weariness));
  sim.warChanged();
}

/**
 * A war has ended (a peace treaty, a conquest, the end of a capitulation): if it left the city weary
 * and it fights no other war, a recovery begins. A war that barely tired the city gives none.
 */
export function peaceCame(sim: Sim): void {
  const w = sim.state.war;
  const e = w?.economy;
  if (!w || !e || (e.weariness ?? 0) < WEARINESS.recovery.minimum) return;
  if (w.diplomacy?.wars.some((x) => fightingWith(sim, x.with))) return;
  e.recoveryUntil = sim.state.tick + WEARINESS.recovery.days * TICKS_PER_MONTH;
  note(
    sim,
    0,
    'recovery',
    `The fighting is over: the city begins to recover, and its mood lifts for ${WEARINESS.recovery.days} days`,
    'good',
  );
}

export interface WearinessSummary {
  /** 0 to 1. */
  value: number;
  /** What it costs the city's approval now (negative), and the recovery's cheer (0 or positive). */
  cheer: number;
  recovery: { cheer: number; until: number } | null;
  /** What homes lose to it now (0 or negative): it matters past `growthFrom`. */
  growth: number;
  /** Change per game day now: up while a war is open, down after (0 when still). */
  perDay: number;
}

export function wearinessSummary(sim: Sim): WearinessSummary {
  const e = sim.state.war?.economy;
  const recovery = recoveryCheer(sim);
  // (`|| 0` keeps a negative zero out of the figures.)
  const r3 = (v: number) => Math.round(v * 1000) / 1000 || 0;
  return {
    value: r3(weariness(sim)),
    cheer: r3(weariness(sim) * WEARINESS.approval),
    recovery:
      e?.recoveryUntil !== undefined && recovery > 0 ? { cheer: r3(recovery), until: e.recoveryUntil } : null,
    growth: r3(tiredOfWar(sim)),
    perDay: r3((wearinessRate(sim) ?? 0) * HOURS_PER_DAY),
  };
}
