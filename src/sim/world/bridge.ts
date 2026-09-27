import { SHORE_HEIGHT, WATER_LEVEL } from '../../data/world';
import type { Curve } from '../geom';

/** Bridges (SPEC §5 Roads, M6): a road may cross water on a raised deck with ramps on each bank. */
export const BRIDGE = {
  /** Longest stretch of water one bridge may span, metres. */
  maxSpan: 360,
  /** Deck clearance above the water, metres. */
  clearance: 6,
  /** Grade of the ramps up to the deck. */
  rampGrade: 0.08,
  /** Cost per metre over water, as a multiple of the road's normal cost. */
  costFactor: 6,
  /** Upkeep per metre over water, as a multiple of the road's normal upkeep. */
  upkeepFactor: 3,
  /** Profile sample spacing, metres. */
  step: 4,
};

/** Deck heights along a road that crosses water, sampled every BRIDGE.step metres. */
export interface DeckProfile {
  step: number;
  /** Absolute deck height at each sample (terrain height where the road is on the ground). */
  h: Float32Array;
  /** Metres of the road that lie over water. */
  overWater: number;
  /** Longest single stretch of water. */
  longestSpan: number;
  /** Distance from each end of the road to the nearest water, metres. */
  landA: number;
  landB: number;
}

/** Height a ramp needs to climb from the banks to the deck: the ramp length in metres. */
export function rampLength(): number {
  return (WATER_LEVEL + BRIDGE.clearance - SHORE_HEIGHT) / BRIDGE.rampGrade;
}

/**
 * The deck profile of a road, or null if it never crosses water. Over water the deck sits at
 * `clearance` above the water; within a ramp length of each stretch of water it slopes down to
 * the ground. Deterministic, so the sim and the renderer agree.
 */
export function deckProfile(curve: Curve, heightAt: (x: number, z: number) => number): DeckProfile | null {
  const step = BRIDGE.step;
  const n = Math.max(2, Math.ceil(curve.length / step) + 1);
  const ground = new Float32Array(n);
  const wet = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const s = Math.min(curve.length, i * step);
    const p = curve.pointAt(s);
    const h = heightAt(p.x, p.z);
    ground[i] = h;
    if (h < SHORE_HEIGHT) {
      wet[i] = 1;
      any = true;
    }
  }
  if (!any) return null;
  const top = WATER_LEVEL + BRIDGE.clearance;
  const h = new Float32Array(n);
  let overWater = 0;
  let longest = 0;
  let run = 0;
  let firstWet = -1;
  let lastWet = -1;
  for (let i = 0; i < n; i++) {
    if (wet[i]) {
      run++;
      if (firstWet < 0) firstWet = i;
      lastWet = i;
      overWater += step;
    } else run = 0;
    longest = Math.max(longest, run * step);
  }
  // Distance (in samples) from each sample to the nearest wet sample, both ways.
  const distWet = new Float32Array(n).fill(Infinity);
  let last = -Infinity;
  for (let i = 0; i < n; i++) {
    if (wet[i]) last = i;
    distWet[i] = (i - last) * step;
  }
  last = Infinity;
  for (let i = n - 1; i >= 0; i--) {
    if (wet[i]) last = i;
    distWet[i] = Math.min(distWet[i]!, (last - i) * step);
  }
  for (let i = 0; i < n; i++) {
    const ramp = top - distWet[i]! * BRIDGE.rampGrade;
    h[i] = Math.max(ground[i]!, Math.max(WATER_LEVEL, ramp));
  }
  return {
    step,
    h,
    overWater,
    longestSpan: longest,
    landA: firstWet * step,
    landB: (n - 1 - lastWet) * step,
  };
}

/** Deck height at arc length s. */
export function deckAt(p: DeckProfile, s: number): number {
  const f = Math.max(0, s / p.step);
  const i = Math.min(p.h.length - 2, Math.floor(f));
  const k = Math.min(1, f - i);
  return p.h[i]! * (1 - k) + p.h[i + 1]! * k;
}

/**
 * The deck of a road carried on a viaduct over dry ground (M13): the stored road heights, with the
 * raised stretches (well above the ground) counted like water for cost and upkeep.
 */
export function viaductDeck(
  heights: number[],
  curve: Curve,
  heightAt: (x: number, z: number) => number,
): DeckProfile {
  const step = BRIDGE.step;
  const h = Float32Array.from(heights);
  let raised = 0;
  let run = 0;
  let longest = 0;
  for (let i = 0; i < h.length; i++) {
    const p = curve.pointAt(Math.min(curve.length, i * step));
    if (h[i]! > heightAt(p.x, p.z) + 1) {
      run++;
      raised += step;
    } else run = 0;
    longest = Math.max(longest, run * step);
  }
  return { step, h, overWater: raised, longestSpan: longest, landA: 0, landB: 0 };
}
