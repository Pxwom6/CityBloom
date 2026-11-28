import { describe, expect, it } from 'vitest';
import { adelaideClock, adelaideOffset, challengeWeek, timeLeftText, weekNow, weekStart } from '../week';

/**
 * M44: the weekly challenge's week turns over at Monday midnight in Adelaide, in winter (+9:30) and
 * in daylight saving (+10:30), and the page and the board read the same week from the same instant.
 */
const at = (iso: string) => Date.parse(iso);

describe('M44 the challenge week', () => {
  it('starts week 0 at midnight on Monday 5 January 2026 in Adelaide (daylight saving, +10:30)', () => {
    const start = weekStart(0);
    expect(new Date(start).toISOString()).toBe('2026-01-04T13:30:00.000Z');
    expect(adelaideClock(start)).toMatchObject({ y: 2026, m: 1, d: 5, h: 0, min: 0, s: 0 });
    expect(challengeWeek(start)).toBe(0);
    expect(challengeWeek(start - 1)).toBe(-1);
  });

  it('turns over at Monday midnight in winter time (+9:30)', () => {
    // Monday 1 June 2026, 00:00 in Adelaide is 31 May 14:30 UTC.
    const monday = at('2026-05-31T14:30:00Z');
    expect(adelaideOffset(monday)).toBe(9.5 * 3600_000);
    const w = challengeWeek(monday);
    expect(challengeWeek(monday - 1000)).toBe(w - 1);
    expect(challengeWeek(monday + 6 * 86_400_000 + 23 * 3600_000)).toBe(w);
    expect(weekStart(w)).toBe(monday);
    expect(weekNow(monday + 5000)).toEqual({ week: w, start: monday, end: weekStart(w + 1) });
    expect(weekStart(w + 1) - monday).toBe(7 * 86_400_000);
  });

  it('keeps whole weeks across the daylight-saving changes (one is 23 hours short, one long)', () => {
    // Daylight saving begins on Sunday 4 October 2026 (2 am → 3 am) and ends on Sunday 5 April 2026.
    const wOct = challengeWeek(at('2026-10-02T00:00:00Z'));
    expect(weekStart(wOct + 1) - weekStart(wOct)).toBe(7 * 86_400_000 - 3600_000);
    const wApr = challengeWeek(at('2026-04-02T00:00:00Z'));
    expect(weekStart(wApr + 1) - weekStart(wApr)).toBe(7 * 86_400_000 + 3600_000);
    // Each week's start is a Monday midnight in Adelaide, for two years of weeks.
    for (let w = 0; w < 104; w++) {
      const c = adelaideClock(weekStart(w));
      expect([c.h, c.min, c.s]).toEqual([0, 0, 0]);
      expect(new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay()).toBe(1);
      expect(challengeWeek(weekStart(w))).toBe(w);
      expect(challengeWeek(weekStart(w) - 1)).toBe(w - 1);
    }
  });

  it('says the time left plainly', () => {
    expect(timeLeftText(3 * 86_400_000 + 4 * 3600_000 + 5000)).toBe('3 days 4 hours');
    expect(timeLeftText(86_400_000)).toBe('1 day');
    expect(timeLeftText(5 * 3600_000 + 12 * 60_000)).toBe('5 hours 12 minutes');
    expect(timeLeftText(40 * 60_000 + 59_000)).toBe('40 minutes');
    expect(timeLeftText(-5)).toBe('0 minutes');
  });
});
