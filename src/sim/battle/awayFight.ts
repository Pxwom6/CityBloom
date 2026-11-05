/**
 * A force's battle in a friend's city as the old way fights it (M35): the city as the region keeps it,
 * without a battle of its own going on, the force against it, and the town kept for watching again.
 * It is the body of the battle worker's `awayCity` job, here as one function so that the worker and the
 * war soak (`scripts/lib/soak`) run the same code and cannot drift apart. It needs a whole `Sim`, so it
 * stays out of `away.ts`, which `sim.ts` itself imports.
 */
import type { AwayResult } from '../systems/expeditions';
import type { SaveFile } from '../save';
import { Sim } from '../sim';
import { awayInput, awayResult, type AwayCity } from './away';
import { Battle } from './battle';
import type { BattleInput } from './types';

/** What the job needs: the force's side, and the save the region keeps of the friend's city. */
export interface AwayCityJob {
  city: AwayCity;
  save: SaveFile;
}

export interface AwayCityFought {
  input: BattleInput;
  result: AwayResult;
  /** The town as the battle found it, to keep for watching again. */
  town: SaveFile;
}

export function fightAwayCity(job: AwayCityJob): AwayCityFought {
  // A battle of the friend's own that the save was taken in the middle of is not the one shown: the
  // replay holds only this one.
  const town = Sim.fromSave(job.save);
  if (town.state.war?.battle) {
    delete town.state.war.battle;
    town.battleRun = null;
  }
  const input = awayInput(job.city, town);
  const result = awayResult(input, Battle.run(structuredClone(input)));
  return { input, result, town: town.save() };
}
