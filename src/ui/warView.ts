/**
 * The war room's words that are plain arithmetic (M40 step 3 review): hours as it says them, and what
 * the dome shield is doing. Pure, so a test can hold the second to the summary (`SupersSummary.dome`):
 * a dome that has stopped an atom bomb is down for a long while (`down` war hours), and says so, not
 * "Charging" with an empty bar.
 */

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
