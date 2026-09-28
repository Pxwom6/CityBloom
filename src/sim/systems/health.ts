import { SPECIALISATION } from '../../data/civic';
import { hasResearchPark } from './specialisations';
import { POLICY_EFFECTS } from '../../data/policies';
import { EDUCATION, HEALTH } from '../../data/balance';
import { GARBAGE } from '../../data/civic';
import { ZONE_C, ZONE_I, ZONE_R } from '../../data/zones';
import type { Sim } from '../sim';
import { BState, type Building } from '../world/buildings';
import type { Wealth } from '../../data/buildings';
import { fieldAt } from './pollution';

/**
 * Sickness and learning, hourly (DESIGN §3.11). Pollution, dirty water and garbage make residents
 * sick; clinic and hospital beds (allocated nearest-first in the coverage pass) speed recovery;
 * the untreated sick drag moods down and some die. Schooling moves each home's education towards
 * what its seats support; newcomers arrive with basic schooling.
 */
export function healthHour(sim: Sim): void {
  const s = sim.state;
  for (const b of [...s.buildings.values()].sort((a, c) => a.id - c.id)) {
    if (b.zone !== ZONE_R || b.state !== BState.Active) continue;
    if (b.pop <= 0) {
      b.sick = 0;
      continue;
    }
    const rate = sicknessRate(sim, b);
    const treated = b.sick * b.treated;
    const untreated = b.sick - treated;
    const recovered = treated * HEALTH.recoverTreated + untreated * HEALTH.recoverUntreated;
    const deaths = untreated * HEALTH.deathRate;
    const next = b.sick + (b.pop - b.sick) * rate - recovered - deaths;
    b.sick = Math.round(Math.max(0, Math.min(b.pop, next)) * 1000) / 1000;
    // Deaths (and families leaving): whole residents, the fraction by chance.
    let lost = Math.floor(deaths);
    if (sim.rng.events.chance(deaths - lost)) lost++;
    if (lost > 0) {
      b.pop = Math.max(0, b.pop - lost);
      b.sick = Math.min(b.sick, b.pop);
    }
    // Learning.
    const target = 0.3 + 0.7 * b.seat1 + b.seat2 + b.seat3;
    b.edu = Math.round((b.edu + (target - b.edu) * EDUCATION.learnRate) * 10000) / 10000;
  }
}

/** New cases per resident per hour for a home. */
export function sicknessRate(sim: Sim, b: Building): number {
  const s = sim.state;
  const air = fieldAt(s.airPollution, b.x, b.z);
  const ground = fieldAt(s.groundPollution, b.x, b.z);
  const water = b.water > 0 ? b.polluted : 0;
  const garbage = Math.min(1, b.garbage / GARBAGE.bad);
  const k = sim.policyAt('healthyLiving', b.x, b.z) ? POLICY_EFFECTS.healthyLiving : 1;
  return (
    k *
    (HEALTH.baseRate +
      HEALTH.airRate * air +
      HEALTH.groundRate * ground +
      HEALTH.waterRate * water +
      HEALTH.garbageRate * garbage)
  );
}

/** Newcomers bring basic schooling: blend a home's education when residents move in. */
export function welcome(b: Building, before: number): void {
  if (b.zone !== ZONE_R || b.pop <= before) return;
  const added = b.pop - before;
  b.edu = Math.round(((b.edu * before + EDUCATION.newcomer * added) / b.pop) * 10000) / 10000;
}

/**
 * Share of a home's residents educated to at least level 1 and at least level 2, from its average
 * education: with no schooling the average settles near 0.3 (nobody finished school), with full
 * primary seats near 1.0 (everyone has).
 */
export function educatedShares(edu: number): [number, number] {
  return [Math.max(0, Math.min(1, (edu - 0.3) / 0.7)), Math.max(0, Math.min(1, edu - 1))];
}

/** Share of employed residents educated to at least level 1 and level 2. */
export function workforceEducation(sim: Sim): [number, number] {
  let n = 0;
  let e1 = 0;
  let e2 = 0;
  for (const b of sim.state.buildings.values()) {
    if (b.zone !== ZONE_R || b.state !== BState.Active || b.employed <= 0) continue;
    n += b.employed;
    const [s1, s2] = educatedShares(b.edu);
    e1 += b.employed * s1;
    e2 += b.employed * s2;
  }
  return n ? [e1 / n, e2 / n] : [0, 0];
}

/**
 * The best industry tier the workforce supports (0 heavy, 1 manufacturing, 2 high-tech), and for
 * commerce whether offices (high wealth) can open.
 */
export function educationCap(sim: Sim, zone: number, lv: number): Wealth {
  const [e1, e2] = sim.state.totals.eduWorkforce;
  if (zone === ZONE_I) {
    // A research park lowers the bar for high-tech industry.
    const tech = hasResearchPark(sim);
    const need = tech ? SPECIALISATION.techEducation : EDUCATION.highTech;
    const lvNeed = tech ? SPECIALISATION.techLandValue : 0.4;
    return e2 >= need && lv >= lvNeed ? 2 : e1 >= EDUCATION.manufacturing ? 1 : 0;
  }
  if (zone === ZONE_C) return e2 >= EDUCATION.offices ? 2 : 1;
  return 2;
}
