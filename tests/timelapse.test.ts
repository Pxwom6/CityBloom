import { describe, expect, it } from 'vitest';
import {
  TIMELAPSE,
  busiestCell,
  frameMix,
  orbitCentre,
  thinFrames,
  type FrameRef,
} from '../src/client/timelapseThin';
import { TICKS_PER_MONTH } from '../src/sim/time';

/**
 * M45: what a timelapse keeps and how it plays. A view's frames stay within their limits however long
 * a city runs (the older half thinned first, the first and newest frames kept, the spread still
 * covering the whole life); a video runs evenly through game time, cross-fading between stored
 * frames; the orbit looks at the busiest part of town and doesn't wander.
 */
function record(months: number, bytes = 50_000): FrameRef[] {
  // A frame of a view every 6 game hours (the two views take turns every 3), thinned as it goes, as
  // the recorder does after each frame.
  let frames: FrameRef[] = [];
  for (let t = 0; t <= months * TICKS_PER_MONTH; t += TIMELAPSE.step * 2) {
    frames.push({ tick: t, bytes });
    const drop = new Set(thinFrames(frames, TIMELAPSE.perView, TIMELAPSE.cityBytes / 2));
    if (drop.size) frames = frames.filter((f) => !drop.has(f.tick));
  }
  return frames;
}

describe('M45 the timelapse', () => {
  it('keeps a twenty-year city within its limits, its first and newest frames, its whole life', () => {
    const frames = record(240);
    expect(frames.length).toBeLessThanOrEqual(TIMELAPSE.perView);
    expect(frames.reduce((s, f) => s + f.bytes, 0)).toBeLessThanOrEqual(TIMELAPSE.cityBytes / 2);
    expect(frames[0]!.tick).toBe(0);
    expect(frames.at(-1)!.tick).toBe(240 * TICKS_PER_MONTH);
    // Every year of the city still has frames.
    for (let y = 0; y < 20; y++) {
      const inYear = frames.filter(
        (f) => f.tick >= y * 12 * TICKS_PER_MONTH && f.tick < (y + 1) * 12 * TICKS_PER_MONTH,
      );
      expect(inYear.length, `year ${y + 1}`).toBeGreaterThan(0);
    }
    // Recent frames are denser than old ones.
    const last = frames.filter((f) => f.tick >= 228 * TICKS_PER_MONTH).length;
    const first = frames.filter((f) => f.tick < 12 * TICKS_PER_MONTH).length;
    expect(last).toBeGreaterThan(first);
  });

  it('thins by bytes too: big frames keep fewer', () => {
    const frames = record(60, 400_000);
    expect(frames.reduce((s, f) => s + f.bytes, 0)).toBeLessThanOrEqual(TIMELAPSE.cityBytes / 2);
    expect(frames.length).toBeGreaterThan(10);
  });

  it('leaves a short city alone', () => {
    const frames: FrameRef[] = Array.from({ length: 50 }, (_, k) => ({ tick: k * 360, bytes: 1000 }));
    expect(thinFrames(frames, TIMELAPSE.perView, TIMELAPSE.cityBytes)).toEqual([]);
  });

  it('runs a video evenly through game time, cross-fading between the frames either side', () => {
    // Thinned old frames: far apart early, close together late.
    const ticks = [0, 1000, 2000, 2100, 2200, 2300, 2400];
    expect(frameMix(ticks, 0, 25)).toEqual({ a: 0, b: 1, mix: 0 });
    expect(frameMix(ticks, 24, 25)).toEqual({ a: 6, b: 6, mix: 0 });
    // A quarter of the way through the video is a quarter of the way through game time (600).
    expect(frameMix(ticks, 6, 25)).toMatchObject({ a: 0, b: 1 });
    expect(frameMix(ticks, 6, 25).mix).toBeCloseTo(0.6, 5);
    // Late in the video, frames change quickly.
    expect(frameMix(ticks, 22, 25).a).toBeGreaterThanOrEqual(4);
    expect(frameMix([5], 3, 10)).toEqual({ a: 0, b: 0, mix: 0 });
    expect(frameMix([], 3, 10).a).toBe(-1);
  });

  it('orbits the busiest part of town, and moves only for a clearly busier one', () => {
    const b = (x: number, z: number, level = 1) => ({ x, z, w: 20, d: 20, level, density: 0 });
    const town = [b(100, 100), b(120, 110), b(130, 90), b(900, 900, 2)];
    const c = busiestCell(town)!;
    expect(c.x).toBeGreaterThan(90);
    expect(c.x).toBeLessThan(140);
    expect(busiestCell([])).toBeNull();
    // A new district a little busier: the orbit stays; a lot busier: it moves.
    const here = { x: 115, z: 100, score: 1000 };
    expect(orbitCentre(here, { x: 900, z: 900, score: 1100 })).toBe(here);
    expect(orbitCentre(here, { x: 900, z: 900, score: 2000 })).toMatchObject({ x: 900 });
    // The same place grown: it follows.
    expect(orbitCentre(here, { x: 130, z: 105, score: 900 })).toMatchObject({ x: 130 });
    expect(orbitCentre(null, here)).toBe(here);
  });
});
