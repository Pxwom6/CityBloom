/**
 * What the page tells the player of the atom bomb as it happens (M40 step 10): the city's own events
 * (a strike put to the region's room, a prepared bomb that can't leave, a bomb gone) and the region's
 * words about the race (a city has begun a plant, has the bomb, has fired it). They are pure, so a
 * test can ask what a given event or line says without a game; `Game` logs them and toasts them with
 * `notice`, which collapses repeats of one kind for a minute and toasts a kind at most once in twenty
 * seconds, so a kind has to stand for one thing said.
 */
import { bombLine, raceLine } from '../data/atom';

export interface PageNotice {
  kind: string;
  text: string;
  tone: 'info' | 'ok' | 'bad';
}

/** A sim event, as the page receives it. */
export interface PageEvent {
  kind: string;
  id: number;
  info?: Record<string, number | string>;
}

/**
 * The notice the city's own bomb events give, or null for any other event. A held launch's kind has
 * its reason in it: a second, different refusal inside the minute (the room's "still being prepared",
 * then "its player is not here") is a new thing to read, not a repeat of the first.
 */
export function atomEventNotice(e: PageEvent): PageNotice | null {
  switch (e.kind) {
    case 'strikeSent':
      // The bomb is put to the region's room for a friend's city: it leaves only if the room keeps it.
      return {
        kind: `strike:${e.id}`,
        text: `The atom bomb is with the region’s room, which has to agree to the strike on ${String(e.info?.to)}.`,
        tone: 'info',
      };
    case 'launchHeld': {
      // A prepared bomb that can't leave (a war paused, or the room's refusal in its words): it waits in
      // the silo, and nothing sends it by itself.
      const why = String(e.info?.why);
      return {
        kind: `held:${e.id}:${why}`,
        text: `The prepared bomb can’t leave: ${why}. It stays in the silo until it is sent again.`,
        tone: 'bad',
      };
    }
    case 'bombFired':
      return {
        kind: `fired:${e.id}`,
        text: `The atom bomb has left the silo for ${String(e.info?.to)}.`,
        tone: 'bad',
      };
    default:
      return null;
  }
}

/** The end of each race line the region says, by stage (1 to 6), and whether it is a red alert (the bomb in hand, a launch). */
const RACE_TAILS: { tail: string; tone: 'info' | 'bad' }[] = [1, 2, 3, 4, 5, 6].map((stage) => ({
  tail: raceLine(stage, '')!,
  tone: stage >= 5 ? 'bad' : 'info',
}));

/**
 * What a notice the region's room sent says of the race, or null when it is some other notice. Every
 * line has its own kind (the text), so the log keeps each, and the bomb in hand, a launch prepared, a
 * bomb fired or fallen are red alerts (a bad notice: logged, toasted, with the alert sound); the
 * plant, the fuel, the silo and the bomb being built are news (info), and so is a dome stopping a bomb.
 */
export function raceNotice(text: string): PageNotice | null {
  const kind = `race:${text}`;
  for (const { tail, tone } of RACE_TAILS)
    if (text.length > tail.length && text.endsWith(tail)) return { kind, text, tone };
  if (/ has fired the atom bomb( at .+)?$/.test(text) || /^An atom bomb has fallen on ./.test(text))
    return { kind, text, tone: 'bad' };
  if (/.’s dome has stopped an atom bomb$/.test(text)) return { kind, text, tone: 'info' };
  return null;
}

/**
 * A line the room says of the race or the bomb that is about this very city: its own steps ("Adaville has
 * begun enriching fuel", "Adaville has fired the atom bomb at Samford") or a bomb on it ("… at Samford",
 * "An atom bomb has fallen on Samford", "Samford’s dome has stopped an atom bomb"). The room tells every
 * page; the city's own notices, its Bomb tab and its countdown have said it already, in its own voice
 * (phase 5 end: a strike gave its target three notices at once), so the page lets it pass.
 */
export function ownRaceLine(text: string, city: string): boolean {
  if (!city || raceNotice(text) === null) return false;
  return (
    text.startsWith(`${city} has `) ||
    text.startsWith(`${city} is `) ||
    text.startsWith(`${city}’s `) ||
    text.endsWith(` at ${city}`) ||
    text === bombLine('boom', city)
  );
}

/**
 * The intelligence note of a friend's bomb fired at the city: kept in the log, not toasted, since the
 * sirens come with it and say more (when it lands, the shelters).
 */
export const quietIntel = (text: string): boolean => / has fired the atom bomb at the city$/.test(text);
