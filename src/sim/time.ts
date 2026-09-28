/**
 * Compressed calendar: 1 tick = 1 game minute, and one day/night cycle is one calendar month.
 * See DESIGN.md §3.1.
 */
export const TICKS_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const TICKS_PER_MONTH = TICKS_PER_HOUR * HOURS_PER_DAY; // 1440
export const MONTHS_PER_YEAR = 12;
export const TICKS_PER_YEAR = TICKS_PER_MONTH * MONTHS_PER_YEAR;
/** The game starts at 07:00 on the first month so the first view is in daylight. */
export const START_HOUR = 7;
/**
 * Calendar month a city is founded in (M22): March, so a new city's first season is spring and
 * winter comes once it can afford ploughs. Year 1 runs from March to February.
 */
export const START_MONTH = 2;
export const START_TICK_OFFSET = START_HOUR * TICKS_PER_HOUR;

/** Ticks per real second at each speed (index = speed setting; 0 = paused). */
export const SPEED_TICKS_PER_SECOND = [0, 8, 16, 24] as const;
export type Speed = 0 | 1 | 2 | 3;

export const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export interface GameDate {
  year: number; // starts at 1
  month: number; // 0..11
  hour: number; // 0..23
  minute: number; // 0..59
  /** Time of day in [0, 1): 0 = midnight, 0.5 = noon. */
  dayFraction: number;
  /** Months elapsed since the start. */
  totalMonths: number;
}

export function dateOf(tick: number): GameDate {
  const t = tick + START_TICK_OFFSET;
  const totalMonths = Math.floor(t / TICKS_PER_MONTH);
  const inDay = t - totalMonths * TICKS_PER_MONTH;
  return {
    year: Math.floor(totalMonths / MONTHS_PER_YEAR) + 1,
    month: calendarMonth(totalMonths),
    hour: Math.floor(inDay / TICKS_PER_HOUR),
    minute: inDay % TICKS_PER_HOUR,
    dayFraction: inDay / TICKS_PER_MONTH,
    totalMonths,
  };
}

/** Calendar month (0 = Jan) of the `k`th month since the city was founded. */
export function calendarMonth(k: number): number {
  return (((k + START_MONTH) % MONTHS_PER_YEAR) + MONTHS_PER_YEAR) % MONTHS_PER_YEAR;
}

/** "Mar, Year 1" for the `k`th month since the city was founded. */
export function monthLabel(k: number): string {
  return `${MONTH_NAMES[calendarMonth(k)]}, Year ${Math.floor(k / MONTHS_PER_YEAR) + 1}`;
}

/** Time of day in hours [0, 24) for a possibly fractional tick. */
export function hourOfDay(tick: number): number {
  const t = tick + START_TICK_OFFSET;
  const inDay = t - Math.floor(t / TICKS_PER_MONTH) * TICKS_PER_MONTH;
  return inDay / TICKS_PER_HOUR;
}

/** Number of ticks from `tick` until the clock next shows `hour`:00 (0 < result ≤ one day). */
export function ticksUntilHour(tick: number, hour: number): number {
  const now = hourOfDay(tick) * TICKS_PER_HOUR;
  let delta = hour * TICKS_PER_HOUR - now;
  if (delta <= 0) delta += TICKS_PER_MONTH;
  return Math.round(delta);
}

export function formatDate(d: GameDate): string {
  const hh = String(d.hour).padStart(2, '0');
  const mm = String(d.minute).padStart(2, '0');
  return `${MONTH_NAMES[d.month]}, Year ${d.year} — ${hh}:${mm}`;
}

/** "Mar, Year 4": the month a tick falls in. */
export function formatMonth(tick: number): string {
  const d = dateOf(tick);
  return `${MONTH_NAMES[d.month]}, Year ${d.year}`;
}

/** True when this tick is the first tick of a new hour. */
export function isHourStart(tick: number): boolean {
  return (tick + START_TICK_OFFSET) % TICKS_PER_HOUR === 0;
}

/** True when this tick is the first tick of a new month (midnight). */
export function isMonthStart(tick: number): boolean {
  return (tick + START_TICK_OFFSET) % TICKS_PER_MONTH === 0;
}

/**
 * Minute of each game hour at which the hourly systems run (DESIGN §3.2). They are spread out so a
 * big city's worst tick is its slowest system rather than the sum of them all.
 */
export const HOURLY_AT = {
  utilities: 0,
  /** Rebuild the coverage cache here if roads or services changed. */
  coverageCache: 3,
  /** Seats and beds; every building's coverage fields on the next tick. */
  coverage: 6,
  health: 12,
  garbage: 18,
  /** Every third hour: ground pollution, then air pollution and crime decay on the next tick. */
  pollution: 24,
  /** The commute matcher runs over MATCH_SLICES ticks from here, every other hour. */
  matcher: 30,
  happiness: 36,
  lifecycle: 42,
  economy: 48,
  landValue: 54,
} as const;

/** Ticks a commute-matching round is spread over (a slice of origins each). */
export const MATCH_SLICES = 4;
