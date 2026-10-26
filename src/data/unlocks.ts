import { DENSITY_UNLOCK_POPULATION } from './buildings';
import { CIVIC_DEFS } from './civic';
import { LOAN_OPTIONS } from './economy';
import { MODULES } from './modules';
import { POLICIES } from './policies';
import { ROAD_TYPES } from './roads';
import { formatInt } from '../sim/dmath';

/** Everything that unlocks at exactly this population, as short labels for the UI. */
export function unlocksAt(population: number): string[] {
  const out: string[] = [];
  if (population > 0 && population === DENSITY_UNLOCK_POPULATION[1]) out.push('Medium-density zones');
  if (population > 0 && population === DENSITY_UNLOCK_POPULATION[2]) out.push('High-density zones');
  for (const r of Object.values(ROAD_TYPES))
    if (r.buildable && r.unlockPopulation === population && population > 0) out.push(r.name);
  for (const d of CIVIC_DEFS) if (d.unlockPopulation === population && population > 0) out.push(d.name);
  for (const m of MODULES) if (m.unlockPopulation === population) out.push(`${m.name} (module)`);
  for (const p of POLICIES) if (p.unlockPopulation === population) out.push(`${p.name} (policy)`);
  for (const l of LOAN_OPTIONS)
    if (l.unlockPopulation === population && population > 0) out.push(`$${formatInt(l.amount)} loan`);
  return out;
}
