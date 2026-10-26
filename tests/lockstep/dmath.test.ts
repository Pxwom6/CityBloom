import { describe, expect, it } from 'vitest';
import { DMath, formatInt } from '../../src/sim/dmath';
import { Rng } from '../../src/sim/rng';

/** Relative error in units of the result's last place. */
function ulps(got: number, want: number): number {
  if (got === want) return 0;
  const scale = Math.max(Math.abs(want), Number.MIN_VALUE) * Number.EPSILON;
  return Math.abs(got - want) / scale;
}

describe('deterministic maths', () => {
  const rng = Rng.fromSeed('dmath');
  const sample = (lo: number, hi: number, n = 20000) =>
    Array.from({ length: n }, () => lo + (hi - lo) * rng.next());

  it('sin and cos stay within a couple of ulps of the engine over the sim’s range', () => {
    let worst = 0;
    for (const x of [...sample(-20, 20), ...sample(-1e4, 1e4, 5000)]) {
      // Near a zero the relative error means little: compare against 1 there.
      for (const [got, want] of [
        [DMath.sin(x), Math.sin(x)],
        [DMath.cos(x), Math.cos(x)],
      ] as const)
        worst = Math.max(
          worst,
          Math.abs(want) < 1e-3 ? Math.abs(got - want) / Number.EPSILON : ulps(got, want),
        );
    }
    expect(worst).toBeLessThan(4);
    expect(DMath.sin(0)).toBe(0);
    expect(DMath.cos(0)).toBe(1);
    expect(DMath.sin(Math.PI / 2)).toBe(1);
  });

  it('atan2 covers every quadrant and the edge cases', () => {
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const y = (rng.next() - 0.5) * 10 ** (rng.next() * 8 - 4);
      const x = (rng.next() - 0.5) * 10 ** (rng.next() * 8 - 4);
      worst = Math.max(worst, ulps(DMath.atan2(y, x), Math.atan2(y, x)));
    }
    expect(worst).toBeLessThan(3);
    for (const [y, x] of [
      [0, 0],
      [0, -1],
      [-0, -1],
      [1, 0],
      [-1, 0],
      [0, 1],
      [Infinity, 1],
      [1, -Infinity],
      [Infinity, Infinity],
    ])
      expect(DMath.atan2(y!, x!)).toBe(Math.atan2(y!, x!));
  });

  it('exp, log and pow agree with the engine closely', () => {
    let worst = 0;
    for (const x of sample(-700, 700, 5000)) worst = Math.max(worst, ulps(DMath.exp(x), Math.exp(x)));
    for (const x of sample(-2, 2, 5000)) worst = Math.max(worst, ulps(DMath.exp(x), Math.exp(x)));
    expect(worst).toBeLessThan(3);
    worst = 0;
    for (const x of [...sample(1e-6, 4), ...sample(1, 1e12, 2000), 1e-310, 5e-324]) {
      const want = Math.log(x);
      worst = Math.max(
        worst,
        Math.abs(want) < 1e-3 ? Math.abs(DMath.log(x) - want) / Number.EPSILON : ulps(DMath.log(x), want),
      );
    }
    expect(worst).toBeLessThan(3);
    // pow through exp(y·log x) loses a little for big |y·log x|, still far below anything the sim sees.
    worst = 0;
    for (let i = 0; i < 20000; i++) {
      const x = rng.next() * 3;
      const y = (rng.next() - 0.5) * 40;
      worst = Math.max(worst, ulps(DMath.pow(x, y), Math.pow(x, y)));
    }
    expect(worst).toBeLessThan(200);
    expect(DMath.pow(3, 4)).toBe(81);
    expect(DMath.pow(2, -3)).toBe(0.125);
    expect(DMath.pow(-2, 3)).toBe(-8);
    expect(DMath.pow(0, 1.5)).toBe(0);
    expect(DMath.pow(5, 0)).toBe(1);
    expect(DMath.exp(0)).toBe(1);
    expect(DMath.log(1)).toBe(0);
  });

  it('hypot is sqrt of the sum of squares', () => {
    expect(DMath.hypot(3, 4)).toBe(5);
    expect(DMath.hypot(-5, 12)).toBe(13);
  });

  it('formats whole numbers with thousands separators', () => {
    expect(formatInt(0)).toBe('0');
    expect(formatInt(999)).toBe('999');
    expect(formatInt(1000)).toBe('1,000');
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatInt(-20000)).toBe('-20,000');
    expect(formatInt(12.6)).toBe('13');
  });

  it('gives fixed bits for fixed inputs (the golden values every browser must match)', () => {
    const bits = (v: number) => {
      const f = new Float64Array([v]);
      const u = new Uint32Array(f.buffer);
      return `${u[1]!.toString(16)}${u[0]!.toString(16).padStart(8, '0')}`;
    };
    const out = [
      DMath.sin(1.234),
      DMath.cos(-7.5),
      DMath.atan2(-3, 2),
      DMath.exp(2.5),
      DMath.log(17),
      DMath.pow(0.97, 7.3),
    ].map(bits);
    expect(out).toMatchSnapshot();
  });
});
