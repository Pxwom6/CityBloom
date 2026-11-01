/**
 * The atom bomb among friends, the sim's page-only half (M40 step 10, `docs/plans/M40-design.md` calls
 * 12, 16 and 17). The region room keeps the truth of the race, the winters and who finished first; each
 * city's sim only mirrors it, as it mirrors a war (M39): a winter the region began is applied once by
 * its id, the first finisher's word sets a fact, and a friend's cloud is `friendFallout`
 * (`fallout.ts`). All are idempotent, so a message heard again (a page that reloaded, a room that said
 * it twice) changes nothing, and none touches a random stream. The strike itself (a prepared bomb put to
 * the room, and a kept one arriving here) is `atom.ts` and `regionOps.ts`, on the road spies take.
 */
import { ATOM_WIRE, winterIdOk } from '../../data/atom';
import { fail, ok, type CommandResult } from '../commands';
import type { Sim } from '../sim';
import { atomOf } from './atom';
import { startWinter } from './weather';

/** The most winters a city keeps: three friends' bombs (eight each at most) and its own, with room to spare. */
const WINTERS_KEPT = ATOM_WIRE.winters * 5;

/**
 * A winter the region began (page only, `friendWinter`): applied once by its id, at this city's own
 * tick (so it is as deep as the city's own winters make it). The ids are the room's `slot-n`; a city
 * keeps at most a few more than a region of four can make, however many a room is made to send.
 */
export function friendWinter(sim: Sim, id: unknown, dryRun: boolean): CommandResult {
  if (!winterIdOk(id)) return fail('That winter could not be read');
  const w = sim.state.weather;
  if (w.winters?.some((e) => e.id === id)) return ok(0, { info: { already: 1 } });
  if ((w.winters?.length ?? 0) >= WINTERS_KEPT)
    return fail('The city has had all the winters a region can bring');
  if (dryRun) return ok(0);
  startWinter(sim, id);
  return ok(0);
}

/**
 * The region says this city finished the atom bomb before any other (page only, `atomFirst`): the
 * fact the achievement `firstBomb` reads. Said again on every return (the room repeats it), so a
 * second time changes nothing. Taken only from a city that has a bomb, held, prepared or used.
 */
export function atomFirst(sim: Sim, dryRun: boolean): CommandResult {
  const w = sim.state.war;
  if (!w) return fail('War is off in this city');
  const a = w.atom;
  if (!a || !(a.have || a.prep || a.fired)) return fail('The city has not finished an atom bomb');
  if (a.first) return ok(0, { info: { already: 1 } });
  if (dryRun) return ok(0);
  atomOf(sim).first = true;
  sim.warChanged();
  return ok(0);
}
