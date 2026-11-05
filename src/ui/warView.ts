/**
 * The war room's words that are plain arithmetic (M40 step 3 review): hours as it says them, and what
 * the dome shield is doing. Pure, so a test can hold the second to the summary (`SupersSummary.dome`):
 * a dome that has stopped an atom bomb is down for a long while (`down` war hours), and says so, not
 * "Charging" with an empty bar. Step 7's review adds what the Intelligence tab offers to sabotage.
 */
import { ATOM, raceSlowWhy, spanWords } from '../data/atom';
import type { SabotageTarget } from '../data/intel';

/** Hours as the war room says them: hours under a day, else days (a game month is a day). */
export function warHours(h: number): string {
  if (h < 24) return `${Math.max(1, Math.round(h))} h`;
  const d = Math.round((h / 24) * 10) / 10;
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** What the dome is doing now, in a word or three. */
export function domeStatus(d: { raised: boolean; down: number; charge: number }): string {
  if (d.raised) return 'Raised';
  if (d.down > 0) return `Down for ${warHours(d.down)} more`;
  return d.charge >= 1 ? 'Charged' : 'Charging';
}

/** The neighbour as the sabotage menu reads it: what `raceSlowWhy` needs (a friend's last report, a rival's race). */
type RaceView = Parameters<typeof raceSlowWhy>[0];

/** One thing to sabotage in the menu: always listed, greyed out with its reason when it can't be done. */
export interface SabotageChoice {
  value: SabotageTarget;
  label: string;
  /** Why it can't be sent for here (null: it can). */
  why: string | null;
}

/**
 * The sabotage menu for a neighbour (M40 step 7's review). Power and depot are always on offer. The
 * atom bomb's works are always listed too, so a player who has read a neighbour is racing can find
 * them; where there is no race to slow the entry is greyed out and says why in its label and `why`
 * (the sim's own reason, `raceSlowWhy`), instead of vanishing.
 */
export function sabotageChoices(n: RaceView | undefined): SabotageChoice[] {
  const why = n ? raceSlowWhy(n) : 'Choose a neighbour first';
  const stage = n?.rival?.bomb?.stage;
  const note = !why
    ? ''
    : n?.rival && !n.rival.vassal && stage === 'ready'
      ? ' (its bomb is finished)'
      : n?.rival && stage === 'spent'
        ? ' (its bomb is used)'
        : ' (no race to slow)';
  return [
    { value: 'power', label: 'power', why: null },
    { value: 'depot', label: 'vehicle depot', why: null },
    { value: 'plant', label: `atom bomb works${note}`, why },
  ];
}

/** What a strike on the atom bomb's works does, in words, for the line under the menu. */
export function plantStrikeWords(): string {
  return `A strike puts its race back ${spanWords(ATOM.spy.setBack)} and closes the plant or silo for ${spanWords(ATOM.spy.closed)}.`;
}

/** The mark beside a neighbour's name in the "send an agent to" list when it is racing for the bomb. */
export function raceMark(n: RaceView): string {
  return raceSlowWhy(n) === null ? ' (racing for the atom bomb)' : '';
}
