import {
  type Camera,
  type Frustum,
  type Light,
  Matrix4,
  type Object3D,
  type OrthographicCamera,
  Vector3,
  Vector4,
} from 'three';
import { SunLightShadow } from 'three/addons/lights/SunLightShadow.js';

/**
 * The sun's shadows in two cascades (phase 3, M26), fitted to the ground the camera sees rather
 * than to the whole view frustum: a crisp map for the near part of the view and a coarser one
 * for the rest, each only as big as the slab of ground and buildings in its part of the view.
 * Looking down on the city from high up, the ground is all at about the same distance and one
 * map covers it; the other is left empty.
 *
 * three.js's `SunLight` draws both maps into one atlas and picks between them by view depth; this
 * replaces only how the cascades are fitted.
 */

/** Where the ground is and how far shadows reach, set by the renderer each frame. */
export interface ShadowFit {
  /** The lowest ground and the highest roof in view (m). */
  yLo: number;
  yHi: number;
  /** View depth beyond which nothing casts or receives a shadow (m). */
  far: number;
}

interface Internals {
  _cameras: OrthographicCamera[];
  _matrices: Matrix4[];
  _frustums: Frustum[];
  _cascadeData: Vector4[];
  _viewports: Vector4[];
  _updateMatrix(camera: OrthographicCamera, matrix: Matrix4, frustum: Frustum, viewport: Vector4): void;
}

const CASCADES = 2;
/** A cascade blends into the next over this share of its depth. */
const FADE = 0.12;
/** Two cascades only when the far edge of the ground in view is this much further than the near. */
const SPLIT_RATIO = 2.2;

const orient = new Matrix4();
const toLight = new Matrix4();
const lightDir = new Vector3();
const up = new Vector3();
const centre = new Vector3();
const tmp = new Vector3();
const corner = new Vector3();
/** The view frustum's corners at unit depth (view space), from the projection. */
const rays = [new Vector3(), new Vector3(), new Vector3(), new Vector3()];
const pts: Vector3[] = Array.from({ length: 48 }, () => new Vector3());

export class CitySunShadow extends SunLightShadow {
  fit: ShadowFit = { yLo: -10, yHi: 150, far: 1500 };
  /** Two cascades only when the far edge of the ground in view is this much further than the near. */
  splitRatio = SPLIT_RATIO;
  /** How many cascades are in use this frame (tests and the debug panel). */
  inUse = 0;

  override updateMatrices(light: Light, viewCamera?: Camera): void {
    if (!viewCamera) return;
    const self = this as unknown as Internals;
    const cam = viewCamera as Camera & { near: number; far: number; isPerspectiveCamera?: boolean };
    const res = this.mapSize.x;
    // Viewports inset so filtering can't read across the atlas's tiles.
    const inset = Math.min(0.25, (Math.ceil(this.radius) + 1) / res);
    for (let i = 0; i < CASCADES; i++)
      self._viewports[i]!.set(i + inset, inset, 1 - 2 * inset, 1 - 2 * inset);
    const resolution = res * (1 - 2 * inset);

    // The view's corner rays, at a view depth of 1.
    const inv = cam.projectionMatrixInverse;
    for (let i = 0; i < 4; i++) {
      const x = i === 0 || i === 1 ? 1 : -1;
      const y = i === 0 || i === 3 ? 1 : -1;
      const r = rays[i]!.set(x, y, -1).applyMatrix4(inv);
      r.multiplyScalar(1 / -r.z);
    }
    const fit = this.fit;
    const near = cam.near;
    const far = Math.max(near + 1, Math.min(fit.far, cam.far));
    const view = cam.matrixWorld;
    const worldAt = (ray: Vector3, depth: number, out: Vector3) =>
      out.set(ray.x * depth, ray.y * depth, -depth).applyMatrix4(view);

    /**
     * The corners of the part of the view between two depths that lies within the slab of
     * ground and buildings: the slice's corners inside it, and where its edges cross the slab.
     */
    const slab = (da: number, db: number): number => {
      let n = 0;
      const add = (p: Vector3) => {
        if (n < pts.length) pts[n++]!.copy(p);
      };
      const c: Vector3[] = [];
      for (let i = 0; i < 4; i++) c.push(worldAt(rays[i]!, da, new Vector3()));
      for (let i = 0; i < 4; i++) c.push(worldAt(rays[i]!, db, new Vector3()));
      for (const p of c) if (p.y >= fit.yLo && p.y <= fit.yHi) add(p);
      const edges = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 0],
        [4, 5],
        [5, 6],
        [6, 7],
        [7, 4],
        [0, 4],
        [1, 5],
        [2, 6],
        [3, 7],
      ];
      for (const [a, b] of edges) {
        const pa = c[a!]!;
        const pb = c[b!]!;
        for (const y of [fit.yLo, fit.yHi]) {
          const t = (y - pa.y) / (pb.y - pa.y);
          if (!(t > 0 && t < 1)) continue;
          add(tmp.lerpVectors(pa, pb, t));
        }
      }
      return n;
    };

    // How deep the ground in view lies.
    const depthOf = (p: Vector3) => -corner.copy(p).applyMatrix4(cam.matrixWorldInverse).z;
    let n = slab(near, far);
    let gMin = Infinity;
    let gMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = depthOf(pts[i]!);
      gMin = Math.min(gMin, d);
      gMax = Math.max(gMax, d);
    }
    if (!n) {
      gMin = near;
      gMax = far;
    }
    gMin = Math.max(near, gMin);
    gMax = Math.min(far, Math.max(gMax, gMin + 1));
    const split = gMax / gMin > this.splitRatio ? gMin * Math.pow(gMax / gMin, 0.4) : gMax;
    const slices = split < gMax ? [gMin, split, gMax] : [gMin, gMax];
    this.inUse = slices.length - 1;

    // Light space: the rotation that looks along the sun's rays.
    lightDir.setFromMatrixPosition(light.matrixWorld).negate().normalize();
    up.set(0, 1, 0);
    if (Math.abs(up.dot(lightDir)) > 0.99) up.set(0, 0, 1);
    orient.lookAt(centre.set(0, 0, 0), lightDir, up);
    toLight.copy(orient).transpose();

    const shadowNear = this.camera.near;
    for (let i = 0; i < CASCADES; i++) {
      const cascadeCam = self._cameras[i]!;
      const flags = cascadeCam as unknown as { coordinateSystem: number; _reversedDepth: boolean };
      flags.coordinateSystem = this.camera.coordinateSystem;
      flags._reversedDepth = this.camera.reversedDepth;
      const data = self._cascadeData[i]!;
      if (i >= slices.length - 1) {
        // Not needed: never picked, and a camera that sees nothing.
        data.set(1e10, 1e10, 1e10, 0);
        cascadeCam.position.set(0, -1e6, 0);
        cascadeCam.left = cascadeCam.bottom = -0.5;
        cascadeCam.right = cascadeCam.top = 0.5;
        cascadeCam.near = 0.1;
        cascadeCam.far = 0.2;
        cascadeCam.updateProjectionMatrix();
        cascadeCam.updateMatrixWorld();
        self._updateMatrix(cascadeCam, self._matrices[i]!, self._frustums[i]!, self._viewports[i]!);
        continue;
      }
      const da = slices[i]!;
      const db = slices[i + 1]!;
      // Each cascade begins where the one before starts to fade, so both can be read there.
      const begin = i === 0 ? near : self._cascadeData[i - 1]!.z;
      const fadeStart = db - FADE * (db - da);
      data.set(i === 0 ? -1e10 : begin, db, fadeStart, 0);
      n = slab(Math.max(near, begin), db);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      let minZ = Infinity;
      for (let k = 0; k < n; k++) {
        const p = tmp.copy(pts[k]!).applyMatrix4(toLight);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
        minZ = Math.min(minZ, p.z);
        maxZ = Math.max(maxZ, p.z);
      }
      if (!n) {
        minX = minY = minZ = -1;
        maxX = maxY = maxZ = 1;
      }
      // A square, in steps of 5 % so the texel grid holds still while the view changes a little.
      let radius = Math.max(maxX - minX, maxY - minY) / 2 + 4;
      radius = Math.pow(1.05, Math.ceil(Math.log(radius) / Math.log(1.05)));
      const texel = (2 * radius) / resolution;
      centre.set(
        Math.round((minX + maxX) / 2 / texel) * texel,
        Math.round((minY + maxY) / 2 / texel) * texel,
        // Casters up to a kilometre towards the sun (hills, towers beyond the slab) still cast.
        maxZ + 1000 + shadowNear,
      );
      centre.applyMatrix4(orient);
      cascadeCam.position.copy(centre);
      cascadeCam.quaternion.setFromRotationMatrix(orient);
      cascadeCam.left = -radius;
      cascadeCam.right = radius;
      cascadeCam.top = radius;
      cascadeCam.bottom = -radius;
      cascadeCam.near = shadowNear;
      cascadeCam.far = maxZ + 1000 - minZ + 2 * shadowNear + 10;
      cascadeCam.updateProjectionMatrix();
      cascadeCam.updateMatrixWorld();
      self._updateMatrix(cascadeCam, self._matrices[i]!, self._frustums[i]!, self._viewports[i]!);
    }
  }
}

/**
 * Cast shadows in the near cascade only (M26): small things (cars, walkers, lamp posts, bags of
 * rubbish) whose shadows far off are a pixel or two, and not worth a draw call each there. Meshes
 * the renderer doesn't cull are culled from the far cascade alone.
 */
export function castNearOnly(root: Object3D, shadow: CitySunShadow): void {
  const far = shadow.getFrustum(1);
  root.traverse((o) => {
    const mesh = o as Object3D & { isMesh?: boolean; isPoints?: boolean };
    if (!mesh.isMesh) return;
    if (!mesh.frustumCulled) {
      mesh.frustumCulled = true;
      mesh.intersectsFrustum = (f: Frustum) => f !== far;
      return;
    }
    const own = mesh.intersectsFrustum.bind(mesh);
    mesh.intersectsFrustum = (f: Frustum) => f !== far && own(f);
  });
}
