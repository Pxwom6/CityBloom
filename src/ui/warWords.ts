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
