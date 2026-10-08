import { Vector3, type Camera } from 'three';
import type { Vec2 } from '../sim/geom';
import type { Network } from '../sim/world/network';

/** How close, in screen pixels, the cursor must be to a road's centre line to be on it (P12). */
export const ROAD_PICK_PX = 16;

/**
 * The point on a road's centre line under the cursor as the road is drawn, bridge and viaduct decks
 * included, within `px` screen pixels, or null (P12). The cursor's ground point comes from a ray
 * against the terrain, which on a raised deck lands up to tens of metres behind the road; this
 * finds the road the player is looking at in screen space instead, so a click on a bridge is a
 * click on the bridge however far the camera is.
 */
export function roadUnderCursor(a: {
  net: Network;
  /** Height of a road's surface at arc length s (its deck on a bridge). */
  roadHeight: (seg: number, s: number, x: number, z: number) => number;
  camera: Camera;
  rect: { left: number; top: number; width: number; height: number };
  clientX: number;
  clientY: number;
  /** Where the cursor's ray meets the ground: roads are looked for around it. */
  near: Vec2;
  accept: (seg: number) => boolean;
  px?: number;
  reach?: number;
}): Vec2 | null {
  const v = new Vector3();
  let best: Vec2 | null = null;
  let bd = a.px ?? ROAD_PICK_PX;
  const toScreen = (seg: number, s: number, x: number, z: number) => {
    v.set(x, a.roadHeight(seg, s, x, z), z).project(a.camera);
    if (Math.abs(v.z) > 1) return null;
    return {
      px: a.rect.left + ((v.x + 1) / 2) * a.rect.width,
      py: a.rect.top + ((1 - v.y) / 2) * a.rect.height,
    };
  };
  for (const id of a.net.segHash.queryPoint(a.near.x, a.near.z, a.reach ?? 150)) {
    if (!a.accept(id)) continue;
    const curve = a.net.curve(id);
    let prev: { px: number; py: number; x: number; z: number } | null = null;
    for (let s = 0; ; s += 4) {
      const t = Math.min(s, curve.length);
      const c = curve.pointAt(t);
      const p = toScreen(id, t, c.x, c.z);
      const cur = p ? { ...p, x: c.x, z: c.z } : null;
      if (cur && prev) {
        // The closest point to the cursor on this stretch on screen, carried back to the ground by
        // the same share of the way along it.
        const dx = cur.px - prev.px;
        const dy = cur.py - prev.py;
        const f = Math.max(
          0,
          Math.min(1, ((a.clientX - prev.px) * dx + (a.clientY - prev.py) * dy) / (dx * dx + dy * dy || 1)),
        );
        const d = Math.hypot(prev.px + dx * f - a.clientX, prev.py + dy * f - a.clientY);
        if (d < bd) {
          bd = d;
          best = { x: prev.x + (cur.x - prev.x) * f, z: prev.z + (cur.z - prev.z) * f };
        }
      }
      prev = cur;
      if (t >= curve.length) break;
    }
  }
  return best;
}
