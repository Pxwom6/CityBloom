/** The owner area's times on the owner's own clock (phase 6 end: they showed UTC). */
import { describe, expect, it } from 'vitest';
import { localDay, localWhen } from '../src/owner/time';

describe('owner area times', () => {
  it('reads a moment on this device’s clock, not UTC', () => {
    const ms = Date.UTC(2026, 10, 27, 17, 17);
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(localDay(ms)).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    expect(localWhen(ms)).toBe(`${localDay(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
    // Where the clock isn't UTC (Adelaide: 03:47 on the 28th), it isn't the UTC reading.
    if (d.getTimezoneOffset() !== 0) expect(localWhen(ms)).not.toBe('2026-11-27 17:17');
  });
});
