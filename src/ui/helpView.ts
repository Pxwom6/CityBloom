/**
 * An ally's help in a friend's live battle, the parts of its panels that are only arithmetic and words
 * (M39 step 6, design call 7): which combatant a city's pacts let it help, which units it sends, and what
 * the force's progress says. Pure, so the rules are tested without a page (`Help.tsx` and the war room
 * draw them).
 */
import { BINDING_PACTS, LIVE, helpSideOf, type AidPact } from '../../relay/protocol';
import type { HelpView } from '../client/liveBattles';

/** Seconds of play a battle step takes at the room's pace: 16 steps a second. */
const STEPS_PER_SECOND = 16;

/** "30 seconds" and the like, from steps of battle. */
export const seconds = (steps: number): number => Math.max(1, Math.ceil(steps / STEPS_PER_SECOND));

/** A combatant this city could send help to. */
export interface HelpAlly {
  /** The neighbour in the city's own list, its place in the region, its name, and the side it fights on. */
  id: number;
  slot: number;
  name: string;
  side: 0 | 1;
}

/** What the rule needs of the city's mirror of the region's pacts, and of its neighbours. */
export interface PactsView {
  pacts: readonly { room: number | null; with: number; term: { k: string } }[];
  neighbours: readonly { id: number; name: string; player?: { slot: number } | null }[];
}

/**
 * The combatant of a live battle this city has a pact of aid with, as its own mirror of the region's pacts
 * has it: the room's rule (`helpSideOf`, which it decides help by) applied to the pacts held with the
 * attacker and with the defender. None when it has pacts with both (it can't take sides), a defensive pact
 * only with the one attacking, none at all, or a pact that binds with the combatant it would fight (a
 * non-aggression or defensive pact: ending it comes first). The room has the last word, and knows more (a
 * war's ceasefire, a vassal's duty).
 */
export function helpAlliesOf(view: PactsView, b: { from: number; to: number }): HelpAlly[] {
  const pacts = view.pacts.filter((p) => p.room !== null);
  const find = (slot: number) => view.neighbours.find((x) => x.player?.slot === slot);
  const aid = (slot: number): AidPact => {
    const n = find(slot);
    if (!n) return null;
    const kinds = pacts.filter((p) => p.with === n.id).map((p) => p.term.k);
    return kinds.includes('alliance') ? 'alliance' : kinds.includes('defensivePact') ? 'defensivePact' : null;
  };
  const rule = helpSideOf(aid(b.from), aid(b.to));
  if (!('side' in rule)) return [];
  const slot = rule.side === 0 ? b.from : b.to;
  const n = find(slot)!;
  // A pact that binds with the other combatant stands in the way (the room: "that breaks your … pact").
  const enemy = find(rule.side === 0 ? b.to : b.from);
  if (enemy && pacts.some((p) => p.with === enemy.id && BINDING_PACTS.includes(p.term.k as never))) return [];
  return [{ id: n.id, slot, name: n.name, side: rule.side }];
}

/**
 * The units to send from what was picked: of each kind the number asked for, taken in order of the kinds,
 * and never more than `cap` in all (a force's cap). `taken` is how many of each kind that comes to, what
 * the inputs show; `chosen` is exactly what is sent.
 */
export function pickUnits<U extends { id: number; kind: string }>(
  home: readonly U[],
  picked: Readonly<Record<string, number>>,
  cap: number = LIVE.helpUnits,
): { chosen: U[]; taken: Record<string, number>; cap: number } {
  const chosen: U[] = [];
  const taken: Record<string, number> = {};
  for (const kind of new Set(home.map((u) => u.kind))) {
    const want = Math.max(0, Math.floor(picked[kind] ?? 0));
    const these = home.filter((u) => u.kind === kind).slice(0, Math.min(want, cap - chosen.length));
    chosen.push(...these);
    taken[kind] = these.length;
  }
  return { chosen, taken, cap };
}

/** The force's progress, in words. */
export function helpLine(h: HelpView, side: string): string {
  switch (h.state) {
    case 'asked':
      return `Asking the region to let your ${h.units} unit${h.units === 1 ? '' : 's'} in…`;
    case 'on':
      return `Your ${h.units} unit${h.units === 1 ? ' is' : 's are'} on the way to help ${side}${
        h.arrive !== null ? `: ${seconds(h.arrive - h.step)} seconds to go` : ''
      }.`;
    case 'fighting':
      return `Your force is fighting for ${side}${h.alive !== null ? `: ${h.alive} of ${h.units} standing` : ''}.`;
    case 'done': {
      // (A battle the page could not follow to its end: the force came home as it went.)
      if (h.reason) return `${h.reason} Your force is on its way home.`;
      if (h.late) return 'The battle ended before your force could get there: it is on its way home.';
      const repairs = h.hurt ? `${h.hurt} need${h.hurt === 1 ? 's' : ''} repairs` : '';
      if (h.lost)
        return `The battle is over: ${h.lost} of your ${h.units} units were knocked out${repairs ? ` and ${repairs}` : ''}, and the rest are on their way home.`;
      return repairs
        ? `The battle is over: none of your ${h.units} units were knocked out, but ${repairs}. They are on their way home.`
        : 'The battle is over: your force came through unharmed and is on its way home.';
    }
    case 'refused':
      return `${h.reason ?? 'The help was turned down'}. Your force is home.`;
  }
}

/**
 * What the war room's list of forces says of a force that went to help a friend (it is not a raid: it
 * has no town to strike and nothing to call back). `left` is the hours until it is home, `h` the page's
 * own view of the force while it is out (it knows the battle; the sim only knows the force is away).
 */
export function helpForceLine(
  e: { state: 'out' | 'fighting' | 'back'; name: string; help?: string },
  h: HelpView | null,
  left: number,
): string {
  if (e.state === 'back') return `coming home from helping ${e.name}: ${left.toFixed(1)} h`;
  const mine = h && h.battle === e.help ? h : null;
  switch (mine?.state) {
    case 'asked':
      return `asking the region to let it help ${e.name}`;
    case 'on':
      return `on the way to help ${e.name}${mine.arrive !== null ? `: about ${seconds(mine.arrive - mine.step)} seconds to go` : ''}`;
    case 'fighting':
      return `fighting beside ${e.name}${mine.alive !== null ? `: ${mine.alive} of ${mine.units} standing` : ''}`;
    case 'done':
    case 'refused':
      return `coming home from helping ${e.name}`;
    default:
      return `helping ${e.name} in a battle`;
  }
}
