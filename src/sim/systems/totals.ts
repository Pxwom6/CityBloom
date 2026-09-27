import { DEMAND } from '../../data/balance';
import { ZONE_C, ZONE_I, ZONE_R } from '../../data/zones';
import type { Sim } from '../sim';
import { BState, buildingCapacity } from '../world/buildings';
import { workforceEducation } from './health';
import { matchDayNow } from './projects';
import { honeymoon } from './elections';

/** City-wide totals, recomputed each hour and saved (they feed demand and the UI). */
export interface CityTotals {
  population: number;
  workers: number;
  employed: number;
  unemployed: number;
  jobs: number;
  jobsFilled: number;
  cJobs: number;
  iJobs: number;
  pendingHomes: number;
  pendingC: number;
  pendingI: number;
  buildings: number;
  constructing: number;
  abandoned: number;
  approval: number;
  highwayConnected: boolean;
  /** Share of the employed educated to at least level 1 and level 2. */
  eduWorkforce: [number, number];
}

export function emptyTotals(): CityTotals {
  return {
    population: 0,
    workers: 0,
    employed: 0,
    unemployed: 0,
    jobs: 0,
    jobsFilled: 0,
    cJobs: 0,
    iJobs: 0,
    pendingHomes: 0,
    pendingC: 0,
    pendingI: 0,
    buildings: 0,
    constructing: 0,
    abandoned: 0,
    approval: DEMAND.appealNeutral,
    highwayConnected: false,
    eduWorkforce: [0, 0],
  };
}

export function computeTotals(sim: Sim): CityTotals {
  const t = emptyTotals();
  let resH = 0;
  let resW = 0;
  let bizH = 0;
  let bizW = 0;
  for (const b of sim.state.buildings.values()) {
    t.buildings++;
    if (b.state === BState.Abandoned) {
      t.abandoned++;
      continue;
    }
    if (b.state === BState.Rubble) continue;
    if (b.state === BState.Construction) {
      t.constructing++;
      const extra = Math.max(0, buildingCapacity(b) - b.cap);
      if (b.zone === ZONE_R) t.pendingHomes += extra;
      else if (b.zone === ZONE_C) t.pendingC += extra;
      else if (b.zone === ZONE_I) t.pendingI += extra;
    }
    if (b.zone === ZONE_R) {
      t.population += b.pop;
      t.workers += Math.round(b.pop * DEMAND.workforceShare);
      t.employed += b.employed;
      if (b.pop > 0) {
        resH += b.happiness * b.pop;
        resW += b.pop;
      }
    } else {
      if (b.state === BState.Construction && b.cap === 0) continue;
      t.jobs += b.cap;
      t.jobsFilled += b.pop;
      if (b.zone === ZONE_C) t.cJobs += b.cap;
      else t.iJobs += b.cap;
      bizH += b.happiness * Math.max(1, b.pop);
      bizW += Math.max(1, b.pop);
    }
  }
  t.unemployed = Math.max(0, t.workers - t.employed);
  const res = resW > 0 ? resH / resW : DEMAND.appealNeutral;
  const biz = bizW > 0 ? bizH / bizW : res;
  t.approval = resW > 0 ? res * 0.85 + biz * 0.15 : DEMAND.appealNeutral;
  // A match day at the stadium cheers the whole city (M17).
  // So does a won election, for a year.
  const md = matchDayNow(sim);
  const cheer = (md?.approval ?? 0) + honeymoon(sim);
  if (cheer && resW > 0) t.approval = Math.min(1, t.approval + cheer);
  t.highwayConnected = sim.highwayConnectedBlocks() > 0;
  const [e1, e2] = workforceEducation(sim);
  t.eduWorkforce = [Math.round(e1 * 1000) / 1000, Math.round(e2 * 1000) / 1000];
  return t;
}
