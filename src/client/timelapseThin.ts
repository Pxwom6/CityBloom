/**
 * The timelapse's arithmetic (M45), pure so it is tested on its own: what is kept (a view's frames
 * thinned evenly to stay within their limits, the newest kept whole, so a long city keeps its whole
 * life), where the orbit looks (the busiest part of the town), and which stored
 * frames make each frame of a video.
 */
import type { BuildingData } from '../sim/protocol';

export const TIMELAPSE = {
  /** Game ticks between frames; the two views take turns (3 game hours: 7.5 s of real time at 3×). */
  step: 180,
  /** A frame's size and JPEG quality. */
  width: 960,
  height: 540,
  quality: 0.72,
  /** At most this many frames a view keeps, and bytes a city (both views). */
  perView: 400,
  cityBytes: 32_000_000,
  /** At most this many bytes for every city's frames together (the least recently recorded goes first). */
  totalBytes: 160_000_000,
  /** The orbit: how far round each frame turns it (radians), its distance and the cell it looks for. */
  orbitTurn: 0.05,
  orbitDistance: 700,
  cell: 256,
  /** Another cell must be this much busier before the orbit moves to it. */
  moveOver: 1.25,
  /** Video frames a second. */
  fps: 30,
  lengths: [15, 30, 60] as const,
} as const;

export type TimelapseView = 'wide' | 'orbit';
export const TIMELAPSE_VIEWS: TimelapseView[] = ['wide', 'orbit'];

/** A stored frame as the thinning sees it. */
export interface FrameRef {
  tick: number;
  bytes: number;
}

/**
 * The ticks of the frames to drop so a view keeps within `maxFrames` and `maxBytes`: while over,
 * every other frame goes from all but the newest eighth (never the very first frame). Each pass halves
 * how often the older frames come, evenly, so the whole life stays covered however long the city runs;
 * the newest frames (and those since the last pass) stay whole. `frames` sorted by tick.
 */
export function thinFrames(frames: FrameRef[], maxFrames: number, maxBytes: number): number[] {
  let kept = [...frames];
  const dropped: number[] = [];
  let bytes = kept.reduce((s, f) => s + f.bytes, 0);
  // The newest eighth of what fits (by count, and by bytes at the frames' average size).
  const fits = Math.min(maxFrames, kept.length ? Math.floor(maxBytes / Math.max(1, bytes / kept.length)) : 0);
  const recent = Math.max(1, Math.floor(fits / 8));
  let guard = 0;
  while ((kept.length > maxFrames || bytes > maxBytes) && kept.length > recent + 2 && guard++ < 64) {
    const older = kept.length - recent;
    const next: FrameRef[] = [kept[0]!];
    for (let i = 1; i < kept.length; i++) {
      if (i < older && i % 2 === 1) {
        dropped.push(kept[i]!.tick);
        bytes -= kept[i]!.bytes;
      } else next.push(kept[i]!);
    }
    if (next.length === kept.length) break;
    kept = next;
  }
  return dropped;
}

/**
 * Which two stored frames (by index) make video frame `i` of `n`, and how much of the second: video
 * time runs evenly through game time from the first frame to the last, cross-fading between the
 * frames either side, so an early year takes as long as a late one even where old frames were thinned.
 */
export function frameMix(ticks: number[], i: number, n: number): { a: number; b: number; mix: number } {
  if (ticks.length === 0) return { a: -1, b: -1, mix: 0 };
  if (ticks.length === 1 || n <= 1) return { a: 0, b: 0, mix: 0 };
  const t0 = ticks[0]!;
  const t1 = ticks[ticks.length - 1]!;
  const t = t0 + ((t1 - t0) * i) / (n - 1);
  // The last stored frame at or before t.
  let lo = 0;
  let hi = ticks.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ticks[mid]! <= t) lo = mid;
    else hi = mid - 1;
  }
  const a = lo;
  const b = Math.min(ticks.length - 1, a + 1);
  const span = ticks[b]! - ticks[a]!;
  return { a, b, mix: span > 0 ? Math.min(1, Math.max(0, (t - ticks[a]!) / span)) : 0 };
}

/** The busiest part of the town: the cell with the most built floor (none: null). */
export function busiestCell(
  buildings: Iterable<Pick<BuildingData, 'x' | 'z' | 'w' | 'd' | 'level' | 'density'>>,
  cell: number = TIMELAPSE.cell,
): { x: number; z: number; score: number } | null {
  const sums = new Map<number, { x: number; z: number; floor: number; n: number }>();
  for (const b of buildings) {
    const cx = Math.floor(b.x / cell);
    const cz = Math.floor(b.z / cell);
    const key = cx * 100_000 + cz;
    const floor = b.w * b.d * Math.max(1, b.level) * (1 + b.density);
    const s = sums.get(key) ?? { x: 0, z: 0, floor: 0, n: 0 };
    // The cell's centre of floor, so the orbit looks at the buildings rather than the cell's corner.
    s.x += b.x * floor;
    s.z += b.z * floor;
    s.floor += floor;
    s.n++;
    sums.set(key, s);
  }
  let best: { x: number; z: number; score: number } | null = null;
  for (const s of sums.values())
    if (!best || s.floor > best.score) best = { x: s.x / s.floor, z: s.z / s.floor, score: s.floor };
  return best;
}

/** Where the orbit looks next: stays put unless another part of town is clearly busier. */
export function orbitCentre(
  prev: { x: number; z: number; score: number } | null,
  next: { x: number; z: number; score: number } | null,
): { x: number; z: number; score: number } | null {
  if (!next) return prev;
  if (!prev) return next;
  // The same place grown: follow its centre of floor.
  const near = Math.hypot(prev.x - next.x, prev.z - next.z) < TIMELAPSE.cell;
  if (near || next.score > prev.score * TIMELAPSE.moveOver) return next;
  return prev;
}
