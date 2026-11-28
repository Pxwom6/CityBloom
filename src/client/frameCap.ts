/**
 * How many frames a second to draw (M49), kept pure so tests can pin it: the player's cap, 30 with
 * the battery saver, and fewer while nothing on screen moves.
 */

/** Frames a second while the scene is still: normally, and with the battery saver. */
export const STILL_FPS = { normal: 10, saver: 5 };
/** The battery saver's ceiling. */
export const SAVER_FPS = 30;
/** A frame within this many ms of due is drawn (the screen's frames come a little early or late). */
export const DUE_SLACK_MS = 4;

/** The most frames a second to draw now; 0 draws every frame the screen offers. */
export function frameCap(o: { fpsCap: number; batterySaver: boolean; still: boolean }): number {
  let cap = o.batterySaver ? Math.min(o.fpsCap || SAVER_FPS, SAVER_FPS) : o.fpsCap;
  if (o.still) {
    const still = o.batterySaver ? STILL_FPS.saver : STILL_FPS.normal;
    cap = cap ? Math.min(cap, still) : still;
  }
  return cap;
}

/** Is a frame due at `now`, the last having been drawn at `drawnAt` (ms), under `cap`? */
export function frameDue(now: number, drawnAt: number, cap: number): boolean {
  return !cap || now - drawnAt >= 1000 / cap - DUE_SLACK_MS;
}
