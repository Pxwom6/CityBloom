/**
 * Times in the owner area as the owner reads them: on their own clock (phase 6 end: the lists showed
 * UTC, so a report sent at 3:47 one morning in Adelaide read as the afternoon before). What's copied
 * for Claude Code stays in UTC and says so.
 */
const pad = (n: number) => String(n).padStart(2, '0');

/** "2026-11-28", the day on this device's clock. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-11-28 03:47", on this device's clock. */
export function localWhen(ms: number): string {
  const d = new Date(ms);
  return `${localDay(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
