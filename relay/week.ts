/**
 * The weekly challenge's week (M44): a new one every Monday at midnight, Adelaide time
 * (Australia/Adelaide: +9:30, or +10:30 in daylight saving). Weeks are numbered from the week that began
 * on Monday 5 January 2026. Worked out with `Intl.DateTimeFormat`, which browsers and Cloudflare's
 * Workers both carry, so the page and the board agree on the week. Midnight on a Monday is never inside
 * a daylight-saving change (Adelaide's are at 2 or 3 am on a Sunday).
 */
export const CHALLENGE_TZ = 'Australia/Adelaide';
const DAY = 86_400_000;
/** The calendar day (days since 1 January 1970) of Monday 5 January 2026: week 0 began then. */
export const EPOCH_DAY = Date.UTC(2026, 0, 5) / DAY;

let fmt: Intl.DateTimeFormat | null = null;

/** The wall-clock date and time in Adelaide at an instant. */
export function adelaideClock(ms: number): {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  s: number;
} {
  fmt ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: CHALLENGE_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  });
  const parts: Record<string, number> = {};
  for (const p of fmt.formatToParts(new Date(ms))) if (p.type !== 'literal') parts[p.type] = Number(p.value);
  return {
    y: parts.year!,
    m: parts.month!,
    d: parts.day!,
    h: parts.hour!,
    min: parts.minute!,
    s: parts.second!,
  };
}

/** Adelaide's offset from UTC at an instant (ms; +9:30 is 34,200,000). */
export function adelaideOffset(ms: number): number {
  const c = adelaideClock(ms);
  const wall = Date.UTC(c.y, c.m - 1, c.d, c.h, c.min, c.s);
  return wall - Math.floor(ms / 1000) * 1000;
}

/** The week an instant falls in (negative before 5 January 2026). */
export function challengeWeek(ms: number): number {
  const c = adelaideClock(ms);
  const day = Date.UTC(c.y, c.m - 1, c.d) / DAY;
  return Math.floor((day - EPOCH_DAY) / 7);
}

/** The instant a week begins: its Monday's midnight in Adelaide. */
export function weekStart(week: number): number {
  const wall = (EPOCH_DAY + week * 7) * DAY;
  // The offset at the guess, then again at the answer (the two differ only across a change).
  let t = wall - adelaideOffset(wall);
  t = wall - adelaideOffset(t);
  return t;
}

/** The week now, when it began and when it ends (ms). */
export function weekNow(ms: number): { week: number; start: number; end: number } {
  const week = challengeWeek(ms);
  return { week, start: weekStart(week), end: weekStart(week + 1) };
}

/** "3 days 4 hours", "5 hours 12 minutes", "40 minutes": time left, as the menu says it. */
export function timeLeftText(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const n = (v: number, w: string) => `${v} ${w}${v === 1 ? '' : 's'}`;
  if (d) return h ? `${n(d, 'day')} ${n(h, 'hour')}` : n(d, 'day');
  if (h) return m ? `${n(h, 'hour')} ${n(m, 'minute')}` : n(h, 'hour');
  return n(m, 'minute');
}
