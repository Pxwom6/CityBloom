/**
 * A finished live battle as the region room keeps it (M39): the defender's input as it was sent, in
 * parts, and every order the room stamped. This turns it back into the battle that was fought, which
 * any page can run again (a defender who was away takes it as a late battle; the attacker runs it to
 * report; a replay shows it).
 */
import type { LiveRecord } from '../../relay/live';
import { recordInput } from '../sim/battle/live';
import type { BattleInput } from '../sim/battle/types';
import { decodeBattle } from './snapshot';

export function inputOfRecord(rec: LiveRecord): BattleInput {
  return recordInput(decodeBattle(rec.input), rec.orders);
}
