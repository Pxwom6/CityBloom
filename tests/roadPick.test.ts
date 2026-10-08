import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { ROAD_TYPES } from '../src/data/roads';
import { deckAt } from '../src/sim/world/bridge';
import type { Sim } from '../src/sim/sim';
import { roadUnderCursor } from '../src/tools/roadPick';
import { newSim } from './helpers';

/**
 * P12: bus stops refused on the road. A click's ground point is a ray against the terrain, which on
 * a bridge deck lands well behind the road; the stop tool now picks the road under the cursor as
 * it's drawn.
 */
const W = 1280;
const H = 800;
const rect = { left: 0, top: 0, width: W, height: H };

/** An avenue across the river at z = 1500 on the default map, and its bridge segment. */
function bridge(): { sim: Sim; seg: number; wx: number; ex: number; z: number } {
  const sim = newSim();
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  const z = 1500;
  let wx = 0;
  let ex = 0;
  for (let x = 900; x < 1800; x += 2) {
    const wet = sim.terrain.heightAt(x, z) < 0.6;
    if (wet && !wx) wx = x;
    if (wx && !wet) {
      ex = x;
      break;
    }
  }
  const r = sim.dispatch({
    type: 'buildRoad',
    road: 'avenue',
    points: [
      { x: wx - 140, z },
      { x: ex + 140, z },
    ],
  });
  if (!r.ok) throw new Error(r.reason);
  const seg = sim.net.nearestSegment({ x: (wx + ex) / 2, z }, 5)!.seg;
  expect(sim.deck(seg)).not.toBeNull();
  return { sim, seg, wx, ex, z };
}

/** A camera `distance` from a point, turned `yaw` round and looking down at `pitch`. */
function camera(at: Vector3, distance: number, yaw: number, pitch: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(45, W / H, 1, 14000);
  cam.position.set(
    at.x + Math.sin(yaw) * Math.cos(pitch) * distance,
    at.y + Math.sin(pitch) * distance,
    at.z + Math.cos(yaw) * Math.cos(pitch) * distance,
  );
  cam.lookAt(at);
  cam.updateMatrixWorld(true);
  return cam;
}

const roadHeight = (sim: Sim) => (seg: number, s: number, x: number, z: number) => {
  const g = Math.max(0, sim.terrain.heightAt(x, z));
  const d = sim.deck(seg);
  return d ? Math.max(g, deckAt(d, s)) : g;
};

function toScreen(cam: PerspectiveCamera, p: Vector3): { x: number; y: number } {
  const v = p.clone().project(cam);
  return { x: ((v.x + 1) / 2) * W, y: ((1 - v.y) / 2) * H };
}

/** Where the cursor's ray meets the ground, as the camera controller finds it. */
function groundUnder(sim: Sim, cam: PerspectiveCamera, x: number, y: number): { x: number; z: number } {
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2((x / W) * 2 - 1, -(y / H) * 2 + 1), cam);
  const o = ray.ray.origin;
  const d = ray.ray.direction;
  for (let t = 1; t < 12000; t += 0.25) {
    const px = o.x + d.x * t;
    const pz = o.z + d.z * t;
    if (o.y + d.y * t <= Math.max(0, sim.terrain.heightAt(px, pz))) return { x: px, z: pz };
  }
  throw new Error('the ray missed the ground');
}

/** The camera's pitch at a distance and tilt, as CameraController.pitchFor works it out. */
function pitch(distance: number, tilt: number): number {
  const t = Math.min(1, Math.max(0, (distance - 25) / (2600 - 25)));
  return 0.32 + (1.0 - 0.32) * t * t * (3 - 2 * t) + tilt;
}

/** Street-level, close and city-level views, and the one the playthrough's clicks came from. */
const POSES: [number, number, number][] = [
  [70, 0.85, pitch(70, -0.02)],
  [170, 0.9, pitch(170, -0.1)],
  [300, 0, pitch(300, 0)],
  [300, 0.55, pitch(300, 0)],
  [620, 0, pitch(620, 0)],
];

describe('bus stops on a bridge (P12)', () => {
  it('miss the bridge with the ground under the cursor (the cause)', () => {
    const { sim, seg, wx, ex, z } = bridge();
    const mid = (wx + ex) / 2;
    const top = new Vector3(
      mid,
      roadHeight(sim)(seg, sim.net.curve(seg).project({ x: mid, z }).s, mid, z),
      z,
    );
    let refused = 0;
    for (const [dist, yaw, pitch] of POSES) {
      const cam = camera(top, dist, yaw, pitch);
      const s = toScreen(cam, top);
      const g = groundUnder(sim, cam, s.x, s.y);
      if (!sim.preview({ type: 'placeStop', x: g.x, z: g.z }).ok) refused++;
    }
    expect(refused).toBeGreaterThan(2);
  });

  it('land on the bridge when the road under the cursor is picked as drawn', () => {
    const { sim, seg, wx, ex, z } = bridge();
    const curve = sim.net.curve(seg);
    const misses: string[] = [];
    for (const [dist, yaw, pitch] of POSES)
      for (let x = wx + 5; x < ex - 5; x += 10) {
        const s = curve.project({ x, z }).s;
        const top = new Vector3(x, roadHeight(sim)(seg, s, x, z), z);
        const cam = camera(top, dist, yaw, pitch);
        const sp = toScreen(cam, top);
        const pick = roadUnderCursor({
          net: sim.net,
          roadHeight: roadHeight(sim),
          camera: cam,
          rect,
          clientX: sp.x,
          clientY: sp.y,
          near: groundUnder(sim, cam, sp.x, sp.y),
          accept: (id) => ROAD_TYPES[sim.net.segment(id).type].access,
        });
        if (!pick || curve.project(pick).d > 0.5 || !sim.preview({ type: 'placeStop', ...pick }).ok)
          misses.push(
            `${dist} m, yaw ${yaw}, x ${x}: ${pick ? curve.project(pick).d.toFixed(1) : 'nothing'}`,
          );
      }
    expect(misses).toEqual([]);
  });

  it('pick nothing well beside the road, or a road no bus stops on', () => {
    const { sim, seg, wx, ex, z } = bridge();
    const mid = (wx + ex) / 2;
    const top = new Vector3(
      mid,
      roadHeight(sim)(seg, sim.net.curve(seg).project({ x: mid, z }).s, mid, z),
      z,
    );
    const cam = camera(top, 300, 0, pitch(300, 0));
    const s = toScreen(cam, top);
    const args = {
      net: sim.net,
      roadHeight: roadHeight(sim),
      camera: cam,
      rect,
      clientX: s.x,
      clientY: s.y - 60,
      near: groundUnder(sim, cam, s.x, s.y - 60),
      accept: (id: number) => ROAD_TYPES[sim.net.segment(id).type].access,
    };
    expect(roadUnderCursor(args)).toBeNull();
    expect(roadUnderCursor({ ...args, clientY: s.y, accept: () => false })).toBeNull();
  });
});
