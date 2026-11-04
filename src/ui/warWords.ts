/**
 * Words the war's notices and cards share (phase 5 end), kept in one place so they read right in every
 * case: a city with no shelter in reach is told so plainly (not "0 of the 1,208 residents head for the
 * shelters"), and one unit knocked out "was", not "were".
 */

const count = (n: number) => n.toLocaleString('en-US');

/** How many residents near a raid or in a bomb's path can reach a shelter, in a sentence (null with none near). */
export function shelterSentence(
  near: number,
  sheltered: number,
  where: 'nearby' | 'in its path',
  verb: 'head for the shelters' | 'can reach a shelter',
): string | null {
  if (near <= 0) return null;
  const all = count(near);
  if (sheltered <= 0) return `None of the ${all} residents ${where} can reach a shelter.`;
  return `${count(sheltered)} of the ${all} residents ${where} ${verb}.`;
}

/**
 * Units knocked out, the verb agreeing: "1 of our units was knocked out", "3 of your 4 units were
 * knocked out"; with the force's size, all of it lost is "all 4 of its units" or "its only unit".
 */
export function unitsKnockedOut(lost: number, whose: 'our' | 'your' | 'its', of?: number): string {
  if (of !== undefined && of > 0 && lost >= of)
    return of === 1
      ? `${whose} only unit was knocked out`
      : `all ${count(of)} of ${whose} units were knocked out`;
  const size = of !== undefined ? ` ${count(of)}` : '';
  return `${count(lost)} of ${whose}${size} units ${lost === 1 ? 'was' : 'were'} knocked out`;
}

/** Those of a force that are left after a battle, on their way home ("The rest are…", "The other is…"). */
function restHome(left: number): string {
  return left === 1 ? 'the other is on its way home' : 'the rest are on their way home';
}

const repairs = (n: number) => `${count(n)} ${n === 1 ? 'needs' : 'need'} repairs`;

/**
 * How an ally's force came out of a battle it helped in (M39), for the Help card: "The battle is over: …".
 * `lost` knocked out of `units`, `hurt` of the rest worse for it.
 */
export function helpOverLine(units: number, lost: number, hurt: number): string {
  if (lost >= units && units > 0) return `The battle is over: ${unitsKnockedOut(lost, 'your', units)}.`;
  if (lost > 0) {
    const fixes = hurt ? ` and ${repairs(hurt)}` : '';
    return `The battle is over: ${unitsKnockedOut(lost, 'your', units)}${fixes}, and ${restHome(units - lost)}.`;
  }
  if (!hurt) return 'The battle is over: your force came through unharmed and is on its way home.';
  if (units === 1)
    return 'The battle is over: your unit came through, but needs repairs. It is on its way home.';
  return `The battle is over: none of your ${count(units)} units were knocked out, but ${repairs(hurt)}. They are on their way home.`;
}

/** The same for the notice when the battle ends (M39): "Your force came through the battle, but …". */
export function helpOverNotice(units: number, lost: number, hurt: number): string {
  if (lost >= units && units > 0)
    return `Your force did not come through the battle: ${unitsKnockedOut(lost, 'its', units)}.`;
  if (lost > 0) {
    const fixes = hurt ? ` and ${repairs(hurt)}` : '';
    const rest = restHome(units - lost);
    return `Your force came through the battle, but ${unitsKnockedOut(lost, 'its', units)}${fixes}. ${rest[0]!.toUpperCase()}${rest.slice(1)}.`;
  }
  if (!hurt) return 'Your force came through the battle unharmed and is on its way home.';
  if (units === 1)
    return 'Your force came through the battle, but its unit needs repairs. It is on its way home.';
  return `Your force came through the battle with none of its ${count(units)} units knocked out, but ${repairs(hurt)}. They are on their way home.`;
}

/**
 * A battle's objective in the battle bar: a city building by its name, a zoned one by its kind (a raid on
 * industry goes for factories, which have no civic name), never a row of "Target"s.
 */
export function objectiveName(civicName: string | undefined, zone: number | undefined): string {
  if (civicName) return civicName;
  return zone === 1 ? 'Homes' : zone === 2 ? 'Business' : zone === 3 ? 'Industry' : 'Target';
}

const some = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

/** A battle report's damage line: "1 building knocked down (12 residents moved out), 2 set on fire". */
export function damageLine(collapsed: number, homeless: number, burning: number, craters: number): string {
  let s = collapsed
    ? `${some(collapsed, 'building', 'buildings')} knocked down${homeless ? ` (${some(homeless, 'resident', 'residents')} moved out)` : ''}`
    : 'No buildings knocked down';
  if (burning) s += `, ${count(burning)} set on fire`;
  if (craters) s += `, ${some(craters, 'road', 'roads')} cratered`;
  return s;
}

/**
 * A diplomacy note as a notice: the sim's notes are kept without a full stop (they are listed in the
 * Diplomacy tab), the notices beside them end with one.
 */
export function asSentence(text: string): string {
  const t = text.trimEnd();
  return !t || /[.!?…”"’)]$/.test(t) ? t : `${t}.`;
}

/** A war's score on its card: "Score −16 after 1 battle.", and before any "Score 0, no battles yet." */
export function warScoreLine(score: number, battles: number): string {
  const s = Math.round(score);
  return battles > 0
    ? `Score ${s} after ${some(battles, 'battle', 'battles')}.`
    : `Score ${s}, no battles yet.`;
}

/**
 * Who pays a money term (reparations, tribute) when it is first added to a treaty: the other side, but
 * the city itself when it offers peace in a war it is losing (phase 5 end: a city behind had to turn
 * every term round before a neighbour would listen).
 */
export function termPayer(
  mode: 'propose' | 'counter' | 'offer' | 'impose',
  score: number | undefined,
): 'us' | 'them' {
  return mode === 'offer' && (score ?? 0) < 0 ? 'us' : 'them';
}

/**
 * A building's name inside a sentence ("The enrichment plant is open!", not "The Enrichment plant"):
 * names are kept in sentence case, so the first letter falls, except in a proper name whose every word
 * is capitalised ("Sunfield Commons"); an acronym is not a proper name ("the military HQ").
 */
export function nameInSentence(name: string): string {
  const words = name.split(' ');
  const proper = words.length > 1 && words.every((w) => /^[A-Z][a-z]/.test(w));
  return proper || !name ? name : `${name[0]!.toLowerCase()}${name.slice(1)}`;
}
