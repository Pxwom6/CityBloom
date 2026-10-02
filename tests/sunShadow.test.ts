import { PerspectiveCamera, Vector3, Vector4 } from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { describe, expect, it } from 'vitest';
import { CitySunShadow } from '../src/render/sunShadow';

/** The sun's two shadow cascades fitted to the ground in view (M26). */
function setup(eye: [number, number, number], target: [number, number, number], far = 1500) {
  const camera = new PerspectiveCamera(45, 1.6, 4, 9000);
  camera.position.set(...eye);
  camera.lookAt(...target);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const sun = new SunLight('#fff', 1);
  const shadow = new CitySunShadow();
  sun.shadow = shadow;
  shadow.mapSize.set(2048, 2048);
  sun.position.set(0.4, 0.8, 0.3);
  sun.updateMatrixWorld();
  shadow.fit = { yLo: -5, yHi: 140, far };
  shadow.updateMatrices(sun, camera);
  return { camera, shadow };
}

/** Ground points in view, with their view depth. */
function groundInView(camera: PerspectiveCamera, far: number): { p: Vector3; depth: number }[] {
  const out: { p: Vector3; depth: number }[] = [];
  for (let i = 0; i <= 20; i++)
    for (let j = 0; j <= 20; j++) {
      const ndc = new Vector3((i / 20) * 2 - 1, (j / 20) * 2 - 1, 0.5).unproject(camera);
      const dir = ndc.sub(camera.position).normalize();
      if (dir.y >= -1e-3) continue;
      for (const y of [0, 60, 130]) {
        const t = (y - camera.position.y) / dir.y;
        if (t <= 0) continue;
        const p = camera.position.clone().addScaledVector(dir, t);
        const depth = -p.clone().applyMatrix4(camera.matrixWorldInverse).z;
        if (depth > camera.near && depth < far) out.push({ p, depth });
      }
    }
  return out;
}

describe('sun shadow cascades', () => {
  it('splits a view across the city in two, the near one sharper, and every point in its tile', () => {
    const { camera, shadow } = setup([0, 220, 380], [0, 0, 0]);
    expect(shadow.inUse).toBe(2);
    const r0 = shadow.getCamera(0).right;
    const r1 = shadow.getCamera(1).right;
    expect(r0).toBeLessThan(r1 * 0.6);
    const data = (shadow as unknown as { _cascadeData: Vector4[] })._cascadeData;
    for (const { p, depth } of groundInView(camera, 1500)) {
      // Whichever cascade picks this depth has it inside its own half of the atlas.
      for (let i = 0; i < 2; i++) {
        const c = data[i]!;
        if (!(depth >= c.x && depth < c.y)) continue;
        const q = new Vector4(p.x, p.y, p.z, 1).applyMatrix4(shadow.getMatrix(i));
        expect(q.x / q.w).toBeGreaterThanOrEqual(i * 0.5);
        expect(q.x / q.w).toBeLessThanOrEqual(i * 0.5 + 0.5);
        expect(q.y / q.w).toBeGreaterThanOrEqual(0);
        expect(q.y / q.w).toBeLessThanOrEqual(1);
      }
    }
  });

  it('uses one map looking straight down, and leaves the other empty', () => {
    const { shadow } = setup([0, 3000, 1], [0, 0, 0], 9000);
    expect(shadow.inUse).toBe(1);
    const data = (shadow as unknown as { _cascadeData: Vector4[] })._cascadeData;
    expect(data[1]!.x).toBeGreaterThan(1e9);
    // About the ground in view: the view is ±1,240 m across at 3 km, 45° high.
    expect(shadow.getCamera(0).right).toBeGreaterThan(1000);
    expect(shadow.getCamera(0).right).toBeLessThan(3000);
  });

  it('holds its texel grid still while the camera pans a little', () => {
    const a = setup([0, 220, 380], [0, 0, 0]).shadow;
    const b = setup([0.3, 220, 380], [0.3, 0, 0]).shadow;
    expect(b.getCamera(0).right).toBe(a.getCamera(0).right);
  });
});
