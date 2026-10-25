/**
 * Deterministic maths for the sim (phase 4, M29). JavaScript promises exact results only for
 * arithmetic, `Math.sqrt` and a few others (floor, round, abs, min, max, fround, imul); `Math.sin`,
 * `Math.hypot`, `Math.pow` and friends may differ in the last bit between browsers, which would split
 * a shared city apart. These are built from exactly-rounded operations only, so every engine gives
 * the same bits. The kernels are ports of fdlibm's (Sun's freely distributable libm), accurate to
 * about one unit in the last place; ESLint forbids the engine's versions in `src/sim` and `src/data`.
 */

// Bit access for the exponent (log) and exact powers of two (exp): typed-array stores are exact.
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
// Which half of the double holds the sign and exponent (little-endian everywhere we run, but check).
const HI = (() => {
  f64[0] = 1;
  return u32[1] === 0x3ff00000 ? 1 : 0;
})();
const LO = 1 - HI;

/** 2^k exactly, for any integer k the result can hold (else 0 or Infinity). */
function pow2(k: number): number {
  if (k > 1023) return Infinity;
  if (k < -1074) return 0;
  if (k < -1022) return pow2(k + 54) * 5.551115123125783e-17; // 2^-54
  u32[HI] = (k + 1023) << 20;
  u32[LO] = 0;
  return f64[0]!;
}

function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

// ---------------------------------------------------------------- sin and cos

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.0875723212981748279e-9;
const C6 = -1.13596475577881948265e-11;

/** sin on [-π/4, π/4]. */
function kSin(x: number): number {
  const z = x * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return x + z * x * (S1 + z * r);
}

/** cos on [-π/4, π/4]. */
function kCos(x: number): number {
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  const hz = 0.5 * z;
  const w = 1 - hz;
  return w + (1 - w - hz + z * r);
}

// π/2 in three parts; the first two have 33 bits, so n·part is exact for |n| < 2^20.
const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_2 = 6.0771005063039659766e-11;
const PIO2_2T = 2.02226624879595063154e-21;

/** x reduced to [-π/4, π/4] and its quadrant (0–3). Large arguments lose precision, not determinism. */
let reduced = 0;
function reduce(x: number): number {
  const n = Math.round(x * INV_PIO2);
  reduced = x - n * PIO2_1 - n * PIO2_2 - n * PIO2_2T;
  return ((n % 4) + 4) % 4;
}

function sin(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kSin(x);
  const q = reduce(x);
  const r = reduced;
  return q === 0 ? kSin(r) : q === 1 ? kCos(r) : q === 2 ? -kSin(r) : -kCos(r);
}

function cos(x: number): number {
  if (!Number.isFinite(x)) return NaN;
  if (Math.abs(x) <= 0.7853981633974483) return kCos(x);
  const q = reduce(x);
  const r = reduced;
  return q === 0 ? kCos(r) : q === 1 ? -kSin(r) : q === 2 ? -kCos(r) : kSin(r);
}

// ---------------------------------------------------------------- atan and atan2

const ATAN_HI = [
  4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.5707963267948966,
];
const ATAN_LO = [
  2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17,
  6.12323399573676603587e-17,
];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2,
  -5.83357013379057348645e-2, 4.97687799461593236017e-2, -3.6531572744216915527e-2, 1.62858201153657823623e-2,
];

function atan(v: number): number {
  if (Number.isNaN(v)) return NaN;
  const neg = v < 0;
  const ax = Math.abs(v);
  if (ax >= 7.378697629483821e19) return neg ? -ATAN_HI[3]! - ATAN_LO[3]! : ATAN_HI[3]! + ATAN_LO[3]!; // 2^66
  let id: number;
  let x: number;
  if (ax < 0.4375) {
    if (ax < 7.450580596923828e-9) return v; // 2^-27
    id = -1;
    x = v;
  } else if (ax < 1.1875) {
    if (ax < 0.6875) {
      id = 0;
      x = (2 * ax - 1) / (2 + ax);
    } else {
      id = 1;
      x = (ax - 1) / (ax + 1);
    }
  } else if (ax < 2.4375) {
    id = 2;
    x = (ax - 1.5) / (1 + 1.5 * ax);
  } else {
    id = 3;
    x = -1 / ax;
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0]! + w * (AT[2]! + w * (AT[4]! + w * (AT[6]! + w * (AT[8]! + w * AT[10]!)))));
  const s2 = w * (AT[1]! + w * (AT[3]! + w * (AT[5]! + w * (AT[7]! + w * AT[9]!))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATAN_HI[id]! - (x * (s1 + s2) - ATAN_LO[id]! - x);
  return neg ? -r : r;
}

const PI = 3.141592653589793;
const PI_LO = 1.2246467991473532e-16;
const PIO2 = 1.5707963267948966;

function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (x === 1) return atan(y);
  if (y === 0) return x > 0 || Object.is(x, 0) ? y : Object.is(y, -0) ? -PI : PI;
  if (x === 0) return y > 0 ? PIO2 : -PIO2;
  if (!Number.isFinite(x)) {
    if (!Number.isFinite(y)) {
      const a = x > 0 ? PI / 4 : (3 * PI) / 4;
      return y > 0 ? a : -a;
    }
    const a = x > 0 ? 0 : PI;
    return y > 0 ? a : -a;
  }
  if (!Number.isFinite(y)) return y > 0 ? PIO2 : -PIO2;
  const z = atan(Math.abs(y / x));
  if (x > 0) return y > 0 ? z : -z;
  return y > 0 ? PI - (z - PI_LO) : z - PI_LO - PI;
}

// ---------------------------------------------------------------- exp, log and pow

const LN2_HI = 6.9314718036912381649e-1;
const LN2_LO = 1.90821492927058770002e-10;
const INV_LN2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;

function exp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.782712893384) return Infinity;
  if (x < -745.1332191019411) return 0;
  if (Math.abs(x) < 3.725290298461914e-9) return 1 + x; // 2^-28
  const k = Math.round(x * INV_LN2);
  const hi = x - k * LN2_HI;
  const lo = k * LN2_LO;
  const r = hi - lo;
  const t = r * r;
  const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1 - ((r * c) / (c - 2) - r);
  const y = 1 - (lo - (r * c) / (2 - c) - hi);
  // Split the scale so 2^k never overflows on its own near the ends of the range.
  return k > 1000
    ? y * pow2(k - 1000) * pow2(1000)
    : k < -1000
      ? y * pow2(k + 1000) * pow2(-1000)
      : y * pow2(k);
}

const LG1 = 6.66666666666673513e-1;
const LG2 = 3.999999999940941908e-1;
const LG3 = 2.857142874366239149e-1;
const LG4 = 2.222219843214978396e-1;
const LG5 = 1.818357216161805012e-1;
const LG6 = 1.531383769920937332e-1;
const LG7 = 1.479819860511658591e-1;

function log(x: number): number {
  if (Number.isNaN(x) || x < 0) return NaN;
  if (x === 0) return -Infinity;
  if (x === Infinity) return Infinity;
  let k = 0;
  if (x < 2.2250738585072014e-308) {
    x *= 18014398509481984; // 2^54: lift subnormals
    k = -54;
  }
  f64[0] = x;
  const hx = u32[HI]!;
  k += (hx >>> 20) - 1023;
  // The mantissa with exponent 0, in [1, 2), moved to [√2/2, √2).
  u32[HI] = (hx & 0x000fffff) | 0x3ff00000;
  let m = f64[0]!;
  if (m > Math.SQRT2) {
    m *= 0.5;
    k++;
  }
  const f = m - 1;
  const s = f / (2 + f);
  const z = s * s;
  const w = z * z;
  const t1 = w * (LG2 + w * (LG4 + w * LG6));
  const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
  const R = t2 + t1;
  const hfsq = 0.5 * f * f;
  return k * LN2_HI - (hfsq - (s * (hfsq + R) + k * LN2_LO) - f);
}

function pow(x: number, y: number): number {
  if (y === 0) return 1;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  if (Number.isInteger(y) && Math.abs(y) <= 64) {
    // Square-and-multiply in a fixed order: the same rounding steps everywhere.
    let n = Math.abs(y);
    let b = x;
    let r = 1;
    while (n > 0) {
      if (n & 1) r *= b;
      n >>= 1;
      if (n > 0) b *= b;
    }
    return y < 0 ? 1 / r : r;
  }
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x < 0) {
    if (!Number.isInteger(y)) return NaN;
    const r = exp(y * log(-x));
    return y % 2 !== 0 ? -r : r;
  }
  if (x === 1) return 1;
  return exp(y * log(x));
}

/** Drop-in replacements for the engine-dependent `Math` functions. */
export const DMath = { hypot, sin, cos, atan, atan2, exp, log, pow } as const;

/** A whole number with thousands separators ("12,345"), without the locale machinery. */
export function formatInt(n: number): string {
  const v = Math.round(n);
  const s = String(Math.abs(v));
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return v < 0 ? `-${out}` : out;
}
