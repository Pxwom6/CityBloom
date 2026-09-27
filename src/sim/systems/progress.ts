import { chronicleEvent } from './chronicle';
import { ACHIEVEMENTS } from '../../data/achievements';
import { MILESTONES } from '../../data/progression';
import { ZONE_R } from '../../data/zones';
import type { Sim } from '../sim';
import { BState } from '../world/buildings';
import { civicDef } from '../world/civic';

/** Is each achievement's goal met right now? (Sim state only; checked hourly.) */
const CHECKS: Record<string, (sim: Sim) => boolean> = {
  firstStreet: (sim) => sim.state.net.segments.size > 1,
  village: (sim) => sim.state.progress.peak >= 800,
  lightsOn: (sim) => {
    const u = sim.state.utilityStats;
    return (
      sim.state.totals.population >= 500 &&
      u.power.unserved === 0 &&
      u.water.unserved === 0 &&
      u.sewage.unserved === 0
    );
  },
  debtFree: (sim) => sim.events.some((e) => e.kind === 'loanRepaid'),
  safeStreets: (sim) => {
    if (sim.state.totals.population < 2_000) return false;
    const homes = [...sim.state.buildings.values()].filter(
      (b) => b.zone === ZONE_R && b.state === BState.Active,
    );
    const ok = homes.filter((b) => b.covFire >= 0.5 && b.covPolice >= 0.5).length;
    return homes.length > 0 && ok >= homes.length * 0.9;
  },
  greenGrid: (sim) => {
    if (sim.state.totals.population < 2_000 || sim.state.utilityStats.power.unserved > 0) return false;
    const plants = [...sim.state.civics.values()].filter((c) => civicDef(c).output?.power);
    return plants.length > 0 && plants.every((c) => c.def === 'wind' || c.def === 'solar');
  },
  scholars: (sim) => {
    if (sim.state.totals.population < 5_000) return false;
    let n = 0;
    let sum = 0;
    for (const b of sim.state.buildings.values())
      if (b.zone === ZONE_R && b.pop > 0) {
        n += b.pop;
        sum += b.edu * b.pop;
      }
    return n > 0 && sum / n >= 2;
  },
  comeback: (sim) =>
    sim.state.progress.recoverTo > 0 && sim.state.totals.population > sim.state.progress.recoverTo,
  touristTrap: (sim) => sim.state.tourism.visitors >= 1_000,
  skyline: (sim) => [...sim.state.civics.values()].filter((c) => !!civicDef(c).tourism?.draw).length >= 3,
  nestEgg: (sim) => sim.state.treasury >= 500_000,
  metropolis: (sim) => sim.state.progress.peak >= 100_000,
};

/**
 * Hourly: remember the highest population reached (unlocks keep once earned), announce each
 * milestone the first time the city gets there, and award achievements (not in sandbox mode).
 */
export function progressHour(sim: Sim): void {
  const s = sim.state;
  const p = s.progress;
  const pop = s.totals.population;
  if (pop > p.peak) p.peak = pop;
  while (p.milestone + 1 < MILESTONES.length && p.peak >= MILESTONES[p.milestone + 1]!.population) {
    p.milestone++;
    sim.events.push({ kind: 'milestone', id: p.milestone });
    chronicleEvent(sim, 'milestone', p.milestone);
  }
  // A disaster that flattened ten buildings sets a comeback target: the peak so far.
  for (const e of sim.events)
    if (e.kind === 'disasterOver' && Number(e.info?.destroyed ?? 0) >= 10)
      p.recoverTo = Math.max(p.recoverTo, p.peak);
  if (s.options.sandbox) return;
  ACHIEVEMENTS.forEach((a, i) => {
    if (p.achievements[a.id] !== undefined || !CHECKS[a.id]!(sim)) return;
    p.achievements[a.id] = s.tick;
    sim.events.push({ kind: 'achievement', id: i });
  });
}
