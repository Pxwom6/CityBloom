import { describe, expect, it } from 'vitest';
import { Rng, hash2, seedFromString } from '../src/sim/rng';
import { fnv1a } from '../src/sim/hash';
import {
  dateOf,
  formatDate,
  hourOfDay,
  ticksUntilHour,
  TICKS_PER_MONTH,
  isMonthStart,
} from '../src/sim/time';
import {
  base64ToBytes,
  bytesToBase64,
  canonicalStringify,
  decodeValue,
  encodeValue,
} from '../src/sim/serialize';

describe('Rng', () => {
  it('is deterministic for a seed and differs across seeds', () => {
    const a = Rng.fromSeed('alpha');
    const b = Rng.fromSeed('alpha');
    const c = Rng.fromSeed('beta');
    const seqA = Array.from({ length: 20 }, () => a.nextU32());
    const seqB = Array.from({ length: 20 }, () => b.nextU32());
    const seqC = Array.from({ length: 20 }, () => c.nextU32());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('restores exactly from saved state', () => {
    const a = Rng.fromSeed('x');
    for (let i = 0; i < 7; i++) a.next();
    const saved = a.getState();
    const expected = Array.from({ length: 10 }, () => a.next());
    const b = new Rng(saved);
    expect(Array.from({ length: 10 }, () => b.next())).toEqual(expected);
  });

  it('produces floats in [0,1) with a sane mean and ints in range', () => {
    const r = Rng.fromSeed('dist');
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      const k = r.int(7);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(7);
    }
    expect(sum / 10000).toBeGreaterThan(0.48);
    expect(sum / 10000).toBeLessThan(0.52);
  });

  it('seeds and hash2 are stable', () => {
    expect(seedFromString('abc')).toEqual(seedFromString('abc'));
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
  });
});

describe('fnv1a', () => {
  it('matches known vectors', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
  });
});

describe('time', () => {
  it('starts at 07:00 in March of year 1 (spring, M22) and rolls months at midnight', () => {
    const d0 = dateOf(0);
    expect(d0).toMatchObject({ year: 1, month: 2, hour: 7, minute: 0, totalMonths: 0 });
    expect(formatDate(d0)).toBe('Mar, Year 1 — 07:00');
    const midnight = ticksUntilHour(0, 0);
    expect(midnight).toBe(17 * 60);
    expect(isMonthStart(midnight)).toBe(true);
    expect(dateOf(midnight)).toMatchObject({ month: 3, hour: 0, totalMonths: 1 });
    // Year 1 runs March to February.
    expect(dateOf(midnight + 9 * TICKS_PER_MONTH)).toMatchObject({ year: 1, month: 0 });
    expect(dateOf(midnight + 11 * TICKS_PER_MONTH)).toMatchObject({ year: 2, month: 2 });
  });

  it('computes hour of day for fractional ticks', () => {
    expect(hourOfDay(30)).toBeCloseTo(7.5);
    expect(ticksUntilHour(0, 7)).toBe(TICKS_PER_MONTH);
    expect(ticksUntilHour(0, 21)).toBe(14 * 60);
  });
});

describe('serialize', () => {
  it('round-trips bytes through base64', () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 1001]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it('round-trips typed arrays and maps', () => {
    const value = {
      a: 1,
      f: new Float32Array([1.5, -2.25, Math.PI]),
      u: new Uint8Array([0, 255, 7]),
      i: new Int32Array([-5, 7]),
      m: new Map<number, { x: number }>([
        [3, { x: 1 }],
        [9, { x: 2 }],
      ]),
      nested: [{ q: new Uint16Array([65535]) }],
    };
    const back = decodeValue(JSON.parse(JSON.stringify(encodeValue(value)))) as typeof value;
    expect(back.f).toBeInstanceOf(Float32Array);
    expect([...back.f]).toEqual([...value.f]);
    expect([...back.u]).toEqual([0, 255, 7]);
    expect([...back.i]).toEqual([-5, 7]);
    expect(back.m).toBeInstanceOf(Map);
    expect([...back.m.keys()]).toEqual([3, 9]);
    expect(back.nested[0]!.q[0]).toBe(65535);
  });

  it('canonical stringify ignores key order', () => {
    expect(canonicalStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(
      canonicalStringify({ a: [1, { c: 3, d: 2 }], b: 1 }),
    );
  });
});
