/**
 * Which battle version an input needs (M37). Version 3 adds research's modifiers, interceptor
 * batteries, the dome's pool and the superweapons, each an optional field; a battle that uses none
 * of them is the same battle M35–M36 fought, so it's stamped version 2 and plays, saves and travels
 * exactly as it did (a war city that never researches stays as on M36, and an older page can read
 * its battles). Whatever builds a battle stamps it last, after every field is in.
 */
import { UNIT } from '../../data/war';
import {
  BATTLE_V2,
  BATTLE_VERSION,
  TAGS_V2,
  S,
  type BattleInput,
  type BattleLayout,
  type BattleUnitIn,
} from './types';

/** A unit that only version 3 knows: one carried in, or a superweapon. */
function unitV3(u: BattleUnitIn): boolean {
  return u.from !== undefined || !!UNIT.get(u.kind)?.super;
}

/** Does the city's picture use anything of version 3? */
export function layoutUsesV3(L: BattleLayout): boolean {
  if (L.mods !== undefined || L.dome !== undefined) return true;
  for (let k = 0; k < L.structs.length; k += S.stride)
    if ((L.structs[k + S.tags]! & ~TAGS_V2) !== 0) return true;
  return L.defenders.some(unitV3);
}

/** Does the attacking force use anything of version 3? */
export function forceUsesV3(input: BattleInput): boolean {
  return input.attacker.mods !== undefined || input.attacker.units.some(unitV3);
}

/** The oldest version that plays this battle as this build does. */
export function battleVersionOf(input: BattleInput): number {
  return layoutUsesV3(input.layout) || forceUsesV3(input) ? BATTLE_VERSION : BATTLE_V2;
}

/** Stamp a battle (and its picture of the city) with the version it needs; returns it. */
export function stampBattle(input: BattleInput): BattleInput {
  const v = battleVersionOf(input);
  input.v = v;
  input.layout.v = v;
  return input;
}
