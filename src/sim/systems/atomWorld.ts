/**
 * What the world makes of the atom bomb (M40 step 6, `docs/plans/M40-design.md` calls 14 and 15):
 * the turn on the city that fires it, the protest at home, and the line the chronicle keeps for good.
 * The race itself, the flight and the blast are `atom.ts` and `atomImpact.ts`; this is what follows
 * them in the people and the neighbours. A city that never fires has none of it: every reader here
 * returns exactly 0 (or nothing) without the pariah mark, so no other city's figures move, and none
 * of it touches a random stream.
 *
 * - The firer is a pariah (`Diplomacy.pariah`, set in `diplomacy.ts` by `makePariah`): its reputation
 *   is nothing for good (the one accessor, `reputationOf`), every computer neighbour sanctions it for
 *   good (`warEconomy.ts`, cause `bomb`), and `computerMoves` lets any neighbour declare a total war
 *   on it. Here its pacts of friendship end and the neighbours' feelings fall.
 * - Its people are ashamed: a city-wide dip in approval and a mood term in every home, easing but
 *   never gone (`bombShame`, `homeShame`).
 * - The chronicle keeps the bomb's moments as `atom` events, which it never drops (`atomChronicle`).
 */
import { ATOM } from '../../data/atom';
import type { Sim } from '../sim';
import { TICKS_PER_HOUR } from '../time';
import { chronicleEvent } from './chronicle';
import { alliesOf, dip, endPactsWith, FRIENDSHIP, isPariah, makePariah, note } from './diplomacy';
import { sanctionsOnBomb } from './warEconomy';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * The bomb has left the silo (called once, from `atomFired`): the city becomes a pariah, its pacts of
 * friendship with computer neighbours end (they broke nothing, the city did, so no breach is counted
 * against its word, which is nothing already), the target's feeling falls to the bottom, its allies'
 * and every other neighbour's fall by a good deal, every computer neighbour sanctions the city, and
 * the chronicle keeps the launch. A friend's city (step 9 and 10) is the region room's to turn:
 * nothing here touches it.
 */
export function worldTurns(sim: Sim): void {
  const s = sim.state;
  const a = s.war?.atom;
  if (!a?.fired || isPariah(sim)) return;
  makePariah(sim);
  // No sitting it out: a neutral stance (it cannot be taken up from now on) is over, and no pact of
  // friendship is on the table, from either side (`termsRefusal` turns away any new one).
  const d = dip(sim);
  delete d.neutral;
  d.proposals = d.proposals.filter((p) => !p.terms.some((t) => FRIENDSHIP.includes(t.k)));
  const target = s.region.neighbours.find((n) => n.id === a.fired!.to && n.rival && !n.player);
  const kin = target ? alliesOf(sim, target) : [];
  for (const n of s.region.neighbours) {
    const r = n.rival;
    if (!r || n.player) continue;
    endPactsWith(sim, n, FRIENDSHIP, `${n.name} ends its pacts with the city over the atom bomb`);
    r.relation =
      n === target
        ? ATOM.world.target
        : clamp(r.relation + (kin.includes(n) ? ATOM.world.allies : ATOM.world.others), -100, 100);
  }
  note(
    sim,
    a.fired.to,
    'pariah',
    'The world turns on the city for firing the atom bomb: its word counts for nothing, every neighbour sanctions it and its pacts have ended',
    'bad',
  );
  sanctionsOnBomb(sim);
  atomChronicle(sim, 'fired', a.fired.name);
}

// ---------------------------------------------------------------------------------------------
// The protest at home
// ---------------------------------------------------------------------------------------------

/**
 * How ashamed the city is, from `start` the moment its bomb left, easing in a straight line over
 * `ATOM.shame.hours` of the city's own game hours (the people's mood runs on the city's clock, not
 * the war's, which the region's fair clock can hold) to `end`, where it stays. Exactly 0 for a city
 * that never fired.
 */
function shame(sim: Sim, { start, end }: { start: number; end: number }): number {
  const p = sim.state.war?.diplomacy?.pariah;
  if (!p) return 0;
  const done = clamp((sim.state.tick - p.tick) / (ATOM.shame.hours * TICKS_PER_HOUR), 0, 1);
  // (Written so that both ends are exact.)
  return start * (1 - done) + end * done;
}

/** What the shame adds to the whole city's approval (negative): -0.30 easing to -0.05. */
export function bombShame(sim: Sim): number {
  return shame(sim, ATOM.shame.approval);
}

/** What the shame takes off a home's happiness (negative, "Ashamed of the bomb"): -0.25 easing to -0.06. */
export function homeShame(sim: Sim): number {
  return shame(sim, ATOM.shame.home);
}

// ---------------------------------------------------------------------------------------------
// The record forever
// ---------------------------------------------------------------------------------------------

/**
 * The chronicle keeps this moment of the bomb for good: `ready` (the bomb is finished), `fired` (it
 * left, at `who`), `landed` (it fell on the computer neighbour `who`), `hit` (one from `who` fell on
 * the city) or `stopped` (the dome stopped one from `who`); and, of a computer neighbour's race, a
 * stage it began (`rivalFuel`, `rivalSilo`, `rivalBomb`) or reached (`rivalReady`). `chronicleEvent`
 * never drops an `atom` event, however many others the ring has dropped since.
 */
export function atomChronicle(
  sim: Sim,
  what:
    'ready' | 'fired' | 'landed' | 'hit' | 'stopped' | 'rivalFuel' | 'rivalSilo' | 'rivalBomb' | 'rivalReady',
  who?: string,
): void {
  chronicleEvent(sim, 'atom', who ? `${what}:${who}` : what);
}
