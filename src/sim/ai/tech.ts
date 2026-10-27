/**
 * Computer neighbours' weapons (M37). Their tech (`RivalNeighbour.tech`, design call 12) arrives in
 * a later step; this is where it reaches their battles: their raiders' modifiers in a raid on the
 * city, and their defenders' in a battle in their town. Until then they have none, and their battles
 * are as on M36.
 */
import type { BattleMods } from '../battle/types';
import type { RivalNeighbour } from '../systems/region';

/** A computer neighbour's battle modifiers from its tech (none yet: call 12 fills this in). */
export function rivalMods(_rival: RivalNeighbour): BattleMods | undefined {
  return undefined;
}
