import { GRADING, ROAD_TYPES, type RoadTypeId } from '../../data/roads';
import { SHORE_HEIGHT } from '../../data/world';
import type { Curve } from '../geom';

/**
 * Road grading (M13). A road no longer drapes over every bump: it gets a smoothed vertical profile
 * within its type's grade limit, pinned only where it joins roads that already exist, and the
 * ground is cut or filled to meet it. Pure and deterministic, so previews, the sim and tests agree.
 * DESIGN.md §3.15.
 */
export interface GradeProfile {
  /** Sample spacing along the road, metres (the last sample sits at the road's end). */
  step: number;
  /** Arc length of each sample. */
  s: Float32Array;
  /** Road surface height at each sample. */
  h: Float32Array;
  /** The ground there before any earthworks. */
  ground: Float32Array;
  /** Samples carried on a viaduct because the embankment would be taller than GRADING.maxFill. */
  raised: Uint8Array;
  /** Deepest cutting and tallest embankment (metres), and metres of viaduct. */
  maxCut: number;
  maxFill: number;
  raisedLength: number;
  /** Steepest grade of the profile, and of the raw ground over any 16 m (for the preview). */
  grade: number;
  groundGrade: number;
  /** Why it can't be built, where (sample index), and by how much it's out. */
  fail?: { reason: string; at: number };
}

/** Height of a profile at arc length s. */
export function profileAt(p: { step: number; h: ArrayLike<number> }, s: number): number {
  const f = Math.max(0, Math.min(p.h.length - 1, s / p.step));
  const i = Math.min(p.h.length - 2, Math.floor(f));
  if (i < 0) return p.h[0]!;
  const t = f - i;
  return p.h[i]! * (1 - t) + p.h[i + 1]! * t;
}

/** A grade as a percentage (a non-breaking space keeps the number and sign together). */
const pct = (g: number) => `${Math.round(g * 100)}\u00a0%`;

/**
 * Grade a road along `curve` over ground given by `groundAt`. `pinA`/`pinB` fix the height at an
 * end that joins an existing road (null leaves that end free to be cut or filled too).
 */
export function gradeProfile(
  curve: Curve,
  groundAt: (x: number, z: number) => number,
  type: RoadTypeId,
  pinA: number | null,
  pinB: number | null,
): GradeProfile {
  const step = GRADING.step;
  const L = curve.length;
  const n = Math.max(2, Math.ceil(L / step) + 1);
  const s = new Float32Array(n);
  const ground = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s[i] = Math.min(L, i * step);
    const p = curve.pointAt(s[i]!);
    ground[i] = groundAt(p.x, p.z);
  }
  const G = ROAD_TYPES[type].maxGrade;
  const out: GradeProfile = {
    step,
    s,
    h: new Float32Array(n),
    ground,
    raised: new Uint8Array(n),
    maxCut: 0,
    maxFill: 0,
    raisedLength: 0,
    grade: 0,
    groundGrade: 0,
  };
  // How steep the raw ground is over any 16 m (what the old check measured).
  const w16 = Math.max(1, Math.round(16 / step));
  for (let i = 0; i + w16 < n; i++)
    out.groundGrade = Math.max(
      out.groundGrade,
      Math.abs(ground[i + w16]! - ground[i]!) / (s[i + w16]! - s[i]! || 1),
    );

  // Two joined ends further apart in height than the road can climb: no profile exists.
  if (pinA !== null && pinB !== null && Math.abs(pinB - pinA) > G * L * 1.0001) {
    const rise = Math.abs(pinB - pinA);
    out.fail = {
      reason: `Too steep: the ends are ${Math.round(rise)} m apart in height over ${Math.round(L)} m (${pct(rise / L)}); ${roadName(type)} can climb ${pct(G)}. Make it longer, or wind it up the slope`,
      at: Math.floor(n / 2),
    };
    return out;
  }

  // 1. Smooth the ground so short bumps are shaved off rather than followed. The window narrows
  // symmetrically towards the ends, so a road on an even slope isn't lifted or dropped there.
  const half = GRADING.smooth / 2;
  const sm = new Float32Array(n);
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + ground[i]!;
  for (let i = 0; i < n; i++) {
    const w = Math.min(half, s[i]!, L - s[i]!);
    let a = i;
    let b = i;
    while (a > 0 && s[a - 1]! >= s[i]! - w - 1e-6) a--;
    while (b < n - 1 && s[b + 1]! <= s[i]! + w + 1e-6) b++;
    // Keep it symmetric in samples too (the last sample may sit closer than a full step).
    const k = Math.min(i - a, b - i);
    sm[i] = (prefix[i + k + 1]! - prefix[i - k]!) / (2 * k + 1);
  }
  // 2. The band the profile must stay in to reach each pinned end at no more than the limit.
  const bandLo = new Float32Array(n).fill(-Infinity);
  const bandHi = new Float32Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) {
    if (pinA !== null) {
      bandLo[i] = Math.max(bandLo[i]!, pinA - G * s[i]!);
      bandHi[i] = Math.min(bandHi[i]!, pinA + G * s[i]!);
    }
    if (pinB !== null) {
      bandLo[i] = Math.max(bandLo[i]!, pinB - G * (L - s[i]!));
      bandHi[i] = Math.min(bandHi[i]!, pinB + G * (L - s[i]!));
    }
  }
  // 3. The profile: within the grade limit, as close to the smoothed ground as it can be.
  const h = out.h;
  fit(s, sm, bandLo, bandHi, G, FILL_SHARE, pinA, pinB, h);
  // Cutting too deep? Try again letting fill run tall: a viaduct beats an impossible cutting.
  let deepest = 0;
  for (let i = 0; i < n; i++) if (ground[i]! >= SHORE_HEIGHT) deepest = Math.max(deepest, ground[i]! - h[i]!);
  if (deepest > GRADING.maxCut) {
    const alt = new Float32Array(n);
    fit(s, sm, bandLo, bandHi, G, 4, pinA, pinB, alt);
    let altDeepest = 0;
    for (let i = 0; i < n; i++)
      if (ground[i]! >= SHORE_HEIGHT) altDeepest = Math.max(altDeepest, ground[i]! - alt[i]!);
    const endsDown =
      alt[0]! - ground[0]! <= GRADING.maxFill && alt[n - 1]! - ground[n - 1]! <= GRADING.maxFill;
    if (altDeepest < deepest && endsDown) h.set(alt);
  }

  // 4. Cut and fill (the earthworks themselves are planned in earthworks.ts), and viaducts where
  // the fill would be too tall.
  for (let i = 0; i < n; i++) {
    const d = h[i]! - ground[i]!;
    const ds = i === 0 || i === n - 1 ? step / 2 : step;
    if (i > 0) out.grade = Math.max(out.grade, Math.abs(h[i]! - h[i - 1]!) / (s[i]! - s[i - 1]! || 1));
    if (ground[i]! < SHORE_HEIGHT) continue; // water: bridges are planned separately
    if (d > GRADING.maxFill) {
      out.raised[i] = 1;
      out.raisedLength += ds;
      out.maxFill = Math.max(out.maxFill, d);
      continue;
    }
    if (d < -GRADING.maxCut && !out.fail)
      out.fail = {
        reason: `Too steep: the ground here rises ${pct(out.groundGrade)} and ${roadName(type)} can climb ${pct(G)}, so it would need a ${Math.ceil(-d)} m cutting (${GRADING.maxCut} m at most). Go round the hill, or wind up it`,
        at: i,
      };
    if (d > 0) out.maxFill = Math.max(out.maxFill, d);
    else out.maxCut = Math.max(out.maxCut, -d);
  }
  return out;
}

/** Fill allowed per metre of cut when fitting a profile (tall fill means a viaduct). */
const FILL_SHARE = GRADING.maxFill / GRADING.maxCut;

/**
 * Fit a profile within the grade limit that strays as little as possible from the smoothed ground
 * `sm` (least worst cut, with fill held to `fillShare` of it), and within that hugs the ground
 * wherever it can. Bisects on the worst cut.
 */
function fit(
  s: Float32Array,
  sm: Float32Array,
  bandLo: Float32Array,
  bandHi: Float32Array,
  G: number,
  fillShare: number,
  pinA: number | null,
  pinB: number | null,
  out: Float32Array,
): void {
  const top = Math.max(...sm, pinA ?? -Infinity, pinB ?? -Infinity);
  const bottom = Math.min(...sm, pinA ?? Infinity, pinB ?? Infinity);
  let lo = 0;
  let hi = (top - bottom) / Math.min(1, fillShare) + 1;
  while (hi - lo > 0.05) {
    const mid = (lo + hi) / 2;
    if (fitProfile(s, sm, bandLo, bandHi, G, mid, fillShare, out)) hi = mid;
    else lo = mid;
  }
  fitProfile(s, sm, bandLo, bandHi, G, hi, fillShare, out);
}

/**
 * Is there a profile within `eps` of cut and `fillShare` × eps of fill of `sm`, inside the band,
 * climbing at most `G`? If so, write the one closest to `sm` into `out`. Forward pass: the heights
 * reachable at each sample; backward pass: pick within them.
 */
function fitProfile(
  s: Float32Array,
  sm: Float32Array,
  bandLo: Float32Array,
  bandHi: Float32Array,
  G: number,
  eps: number,
  fillShare: number,
  out: Float32Array,
): boolean {
  const n = s.length;
  const rLo = new Float64Array(n);
  const rHi = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let lo = Math.max(bandLo[i]!, sm[i]! - eps);
    let hi = Math.min(bandHi[i]!, sm[i]! + eps * fillShare);
    if (i > 0) {
      const d = (s[i]! - s[i - 1]!) * G;
      lo = Math.max(lo, rLo[i - 1]! - d);
      hi = Math.min(hi, rHi[i - 1]! + d);
    }
    if (lo > hi + 1e-9) return false;
    rLo[i] = lo;
    rHi[i] = Math.max(lo, hi);
  }
  out[n - 1] = Math.min(rHi[n - 1]!, Math.max(rLo[n - 1]!, sm[n - 1]!));
  for (let i = n - 2; i >= 0; i--) {
    const d = (s[i + 1]! - s[i]!) * G;
    const lo = Math.max(rLo[i]!, out[i + 1]! - d);
    const hi = Math.min(rHi[i]!, out[i + 1]! + d);
    out[i] = Math.min(hi, Math.max(lo, sm[i]!));
  }
  return true;
}

function roadName(type: RoadTypeId): string {
  const n = ROAD_TYPES[type].name.toLowerCase();
  return /^[aeiou]/.test(n) ? `an ${n}` : `a ${n}`;
}
