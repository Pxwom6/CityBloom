import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DynamicDrawUsage,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  OctahedronGeometry,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector2,
  Vector3,
  Vector4,
  type BufferGeometry,
} from 'three';
import { GRID_CELL, GRID_RES, MAP_SIZE, SCENERY_MARGIN } from '../data/world';
import { hash2 } from '../sim/rng';
import { smoothstep } from '../sim/terrain/noise';
import type { ClientWorld } from '../client/world';
import { mergeGeometries, painted } from './geom';
import { PAL } from './palette';
import { GRADE_GLSL, type WeatherUniforms } from './weather';

const REGION = 512; // in-map regions (for culling and incremental rebuilds)
const REGIONS = MAP_SIZE / REGION;
const SCENERY_STEP = 40;
/** Beyond this distance (m) from the camera a tree region switches to the low-poly models. */
const LOD_DISTANCE = 750;

function coniferGeometry(): BufferGeometry {
  const trunk = painted(new CylinderGeometry(0.25, 0.35, 1.6, 5).translate(0, 0.8, 0), PAL.trunk);
  const low = painted(new ConeGeometry(1.9, 3.6, 7).translate(0, 3.0, 0), PAL.conifer);
  const high = painted(
    new ConeGeometry(1.3, 2.8, 7).translate(0, 4.8, 0),
    new Color(PAL.conifer).offsetHSL(0, 0, 0.04),
  );
  return mergeGeometries([trunk, low, high]);
}

function coniferLow(): BufferGeometry {
  return mergeGeometries([painted(new ConeGeometry(1.9, 6.4, 5, 1, true).translate(0, 3.6, 0), PAL.conifer)]);
}

function broadleafLow(): BufferGeometry {
  const crown = painted(new OctahedronGeometry(2.1, 0).scale(1, 1.1, 1).translate(0, 3.5, 0), PAL.broadleaf);
  return mergeGeometries([crown]);
}

function broadleafGeometry(): BufferGeometry {
  const trunk = painted(new CylinderGeometry(0.22, 0.32, 2.2, 5).translate(0, 1.1, 0), PAL.trunk);
  const crown = painted(new IcosahedronGeometry(1.9, 0).scale(1, 0.9, 1).translate(0, 3.4, 0), PAL.broadleaf);
  const tuft = painted(new IcosahedronGeometry(1.1, 0).translate(0.7, 4.3, 0.3), PAL.broadleafAlt);
  return mergeGeometries([trunk, crown, tuft]);
}

/**
 * Tree material (M22). Broadleaf crowns (their green vertices) take the season's colours — fresh
 * green with some trees in blossom in spring, golds and reds in autumn, bare grey-brown and thinner
 * in winter — and every tree carries snow on its upward faces.
 */
function treeMaterial(broadleaf: boolean, weather: () => WeatherUniforms | null): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  mat.customProgramCacheKey = () => (broadleaf ? 'tree-broadleaf' : 'tree-conifer');
  mat.onBeforeCompile = (shader) => {
    const w = weather();
    Object.assign(shader.uniforms, {
      uSnow: w?.uSnow ?? { value: 0 },
      uSeason: w?.uSeason ?? { value: new Vector4(0, 1, 0, 0) },
      uGrade: w?.uGrade ?? { value: new Vector2() },
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec4 uSeason;
varying float vCrown;
varying float vHash;
varying float vUp;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vCrown = step(color.r + 0.02, color.g);
${broadleaf ? 'transformed.xz *= mix(1.0, 0.7, uSeason.w * vCrown); // bare in winter: a thinner crown' : ''}`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
#ifdef USE_INSTANCING
vec2 ip = instanceMatrix[3].xz;
vUp = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal).y;
#else
vec2 ip = modelMatrix[3].xz;
vUp = normalize(mat3(modelMatrix) * objectNormal).y;
#endif
vHash = fract(sin(dot(ip, vec2(12.9898, 78.233))) * 43758.5453);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uSnow;
uniform vec4 uSeason;
uniform vec2 uGrade;
varying float vCrown;
varying float vHash;
varying float vUp;
${GRADE_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec3 c0 = diffuseColor.rgb;
  float l0 = dot(c0, vec3(0.299, 0.587, 0.114));
${
  broadleaf
    ? `  vec3 spring = c0 * vec3(1.05, 1.13, 0.8) + 0.02;
  vec3 blossom = mix(vec3(0.96, 0.74, 0.84), vec3(0.97, 0.94, 0.9), fract(vHash * 5.0));
  spring = mix(spring, blossom, step(0.74, vHash) * 0.85);
  vec3 autumn = mix(vec3(0.93, 0.52, 0.12), vec3(0.8, 0.2, 0.08), fract(vHash * 7.0)) * (0.55 + l0 * 1.5);
  autumn = mix(autumn, vec3(0.88, 0.72, 0.18) * (0.6 + l0), step(0.62, fract(vHash * 3.0)));
  vec3 winter = vec3(0.37, 0.32, 0.28) * (0.8 + l0);
  vec3 seasonal = spring * uSeason.x + c0 * uSeason.y + autumn * uSeason.z + winter * uSeason.w;
  diffuseColor.rgb = mix(c0, seasonal, vCrown);`
    : '  diffuseColor.rgb *= 1.0 - 0.1 * uSeason.w * vCrown;'
}
  float up = smoothstep(0.15, 0.75, vUp);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.98), uSnow * up * mix(0.35, ${broadleaf ? '0.6' : '0.85'}, vCrown));
  diffuseColor.rgb = weatherGrade(diffuseColor.rgb);
}`,
      );
  };
  return mat;
}

interface Placement {
  x: number;
  z: number;
  s: number;
  rot: number;
  species: 0 | 1;
  shade: number;
}

/** Instanced low-poly trees placed deterministically from the tree-density grid. */
export class TreeRenderer {
  readonly group = new Group();
  private geos: BufferGeometry[] = [coniferGeometry(), broadleafGeometry()];
  private lowGeos: BufferGeometry[] = [coniferLow(), broadleafLow()];
  /** Conifers and broadleaves (M22: broadleaves change with the seasons; both carry snow). */
  private materials = [treeMaterial(false, () => this.weather), treeMaterial(true, () => this.weather)];
  /** Season and snow (M22); set by the renderer before the first frame. */
  weather: WeatherUniforms | null = null;
  private regionMeshes: (InstancedMesh | null)[][] = [];
  /** Optional filter: return true where a tree must not stand (roads, buildings). */
  blocked: ((x: number, z: number) => boolean) | null = null;
  private m = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private sc = new Vector3();
  private up = new Vector3(0, 1, 0);
  private c = new Color();
  density = 1;
  /** Beyond this distance (metres) a forest region switches to low-poly trees (draw-distance setting). */
  lodDistance = LOD_DISTANCE;

  constructor(private world: ClientWorld) {
    for (let r = 0; r < REGIONS * REGIONS; r++) this.regionMeshes.push([null, null]);
    for (let r = 0; r < REGIONS * REGIONS; r++) this.rebuildRegion(r);
    this.buildScenery();
    world.on('trees', () => this.rebuildAll());
  }

  rebuildAll(): void {
    for (let r = 0; r < REGIONS * REGIONS; r++) this.rebuildRegion(r);
  }

  /** Rebuild the in-map regions overlapping a box (the ground moved there, M13). */
  rebuildBox(box: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    const r0 = (v: number) => Math.min(REGIONS - 1, Math.max(0, Math.floor(v / REGION)));
    for (let j = r0(box.minZ); j <= r0(box.maxZ); j++)
      for (let i = r0(box.minX); i <= r0(box.maxX); i++) this.rebuildRegion(j * REGIONS + i);
  }

  /** Rebuild the in-map regions that contain any of these points (after roads/buildings change). */
  rebuildAround(points: { x: number; z: number }[]): void {
    const set = new Set<number>();
    for (const p of points) {
      const i = Math.min(REGIONS - 1, Math.max(0, Math.floor(p.x / REGION)));
      const j = Math.min(REGIONS - 1, Math.max(0, Math.floor(p.z / REGION)));
      set.add(j * REGIONS + i);
    }
    for (const r of set) this.rebuildRegion(r);
  }

  private placementsInRegion(r: number): Placement[] {
    const ri = r % REGIONS;
    const rj = Math.floor(r / REGIONS);
    const cellsPer = REGION / GRID_CELL;
    const out: Placement[] = [];
    for (let j = rj * cellsPer; j < (rj + 1) * cellsPer; j++) {
      for (let i = ri * cellsPer; i < (ri + 1) * cellsPer; i++) {
        const d = this.world.trees[j * GRID_RES + i]! / 255;
        if (d <= 0.02) continue;
        const count = Math.floor(d * 2.8 * this.density + hash2(i, j, 1));
        for (let k = 0; k < count; k++) {
          const x = (i + hash2(i, j, 10 + k)) * GRID_CELL;
          const z = (j + hash2(i, j, 20 + k)) * GRID_CELL;
          if (this.world.heightAt(x, z) < 1.4) continue;
          if (this.blocked?.(x, z)) continue;
          out.push({
            x,
            z,
            s: 0.75 + hash2(i, j, 30 + k) * 0.6,
            rot: hash2(i, j, 40 + k) * Math.PI * 2,
            species: hash2(i, j, 50 + k) < 0.45 + 0.3 * (d - 0.5) ? 0 : 1,
            shade: 0.85 + hash2(i, j, 60 + k) * 0.25,
          });
        }
      }
    }
    return out;
  }

  private fill(mesh: InstancedMesh, list: Placement[]): void {
    for (let k = 0; k < list.length; k++) {
      const p = list[k]!;
      this.v.set(p.x, this.world.heightAt(p.x, p.z) - 0.15, p.z);
      this.q.setFromAxisAngle(this.up, p.rot);
      this.sc.setScalar(p.s);
      this.m.compose(this.v, this.q, this.sc);
      mesh.setMatrixAt(k, this.m);
      this.c.setScalar(p.shade);
      mesh.setColorAt(k, this.c);
    }
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  rebuildRegion(r: number): void {
    const all = this.placementsInRegion(r);
    for (const species of [0, 1] as const) {
      const list = all.filter((p) => p.species === species);
      let mesh = this.regionMeshes[r]![species];
      if (!mesh || mesh.instanceMatrix.count < list.length) {
        if (mesh) {
          this.group.remove(mesh);
          mesh.dispose();
        }
        mesh = new InstancedMesh(
          this.geos[species]!,
          this.materials[species]!,
          Math.max(16, Math.ceil(list.length * 1.2)),
        );
        mesh.instanceMatrix.setUsage(DynamicDrawUsage);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `trees-${r}-${species}`;
        mesh.userData = {
          species,
          cx: ((r % REGIONS) + 0.5) * REGION,
          cz: (Math.floor(r / REGIONS) + 0.5) * REGION,
          radius: REGION * 0.71,
        };
        this.regionMeshes[r]![species] = mesh;
        this.group.add(mesh);
      }
      this.fill(mesh, list);
      mesh.visible = list.length > 0;
    }
  }

  private buildScenery(): void {
    const gen = this.world.gen;
    const lo = -SCENERY_MARGIN;
    const hi = MAP_SIZE + SCENERY_MARGIN;
    const bands = 3; // scenery is always far away: big bands, few draw calls
    const band = (hi - lo) / bands;
    for (let bj = 0; bj < bands; bj++) {
      for (let bi = 0; bi < bands; bi++) {
        const lists: Placement[][] = [[], []];
        for (let z = lo + bj * band; z < lo + (bj + 1) * band; z += SCENERY_STEP) {
          for (let x = lo + bi * band; x < lo + (bi + 1) * band; x += SCENERY_STEP) {
            if (x >= -SCENERY_STEP && x <= MAP_SIZE && z >= -SCENERY_STEP && z <= MAP_SIZE) continue;
            const ix = Math.round(x / SCENERY_STEP);
            const iz = Math.round(z / SCENERY_STEP);
            const px = x + hash2(ix, iz, 3) * SCENERY_STEP;
            const pz = z + hash2(ix, iz, 4) * SCENERY_STEP;
            const h = gen.height(px, pz);
            if (h < 1.8 || h > 160) continue;
            // Keep the highway corridor clear.
            if (Math.abs(px - gen.params.highway.lineX) < 70) continue;
            const d = gen.forestNoise(px, pz) * (1 - smoothstep(90, 160, h));
            if (hash2(ix, iz, 5) > d * 1.1) continue;
            const species = h > 60 || hash2(ix, iz, 6) < 0.55 ? 0 : 1;
            lists[species]!.push({
              x: px,
              z: pz,
              s: 1.1 + hash2(ix, iz, 7) * 0.8,
              rot: hash2(ix, iz, 8) * 6.28,
              species,
              shade: 0.8 + hash2(ix, iz, 9) * 0.25,
            });
          }
        }
        for (const species of [0, 1] as const) {
          const list = lists[species]!;
          if (!list.length) continue;
          const mesh = new InstancedMesh(this.geos[species]!, this.materials[species]!, list.length);
          // Placement heights in the scenery come from the generator.
          for (let k = 0; k < list.length; k++) {
            const p = list[k]!;
            this.v.set(p.x, gen.height(p.x, p.z) - 0.2, p.z);
            this.q.setFromAxisAngle(this.up, p.rot);
            this.sc.setScalar(p.s);
            this.m.compose(this.v, this.q, this.sc);
            mesh.setMatrixAt(k, this.m);
            this.c.setScalar(p.shade);
            mesh.setColorAt(k, this.c);
          }
          mesh.computeBoundingSphere();
          mesh.name = `trees-scenery-${bi}-${bj}-${species}`;
          mesh.castShadow = false;
          mesh.userData = {
            species,
            cx: lo + (bi + 0.5) * band,
            cz: lo + (bj + 0.5) * band,
            radius: band * 0.71,
          };
          this.group.add(mesh);
        }
      }
    }
  }

  /** Swap each region between detailed and low-poly models by (3-D) distance to the camera. */
  updateLod(camX: number, camY: number, camZ: number): void {
    for (const o of this.group.children) {
      const mesh = o as InstancedMesh;
      const u = mesh.userData as { species: 0 | 1; cx: number; cz: number; radius: number };
      const d = Math.hypot(Math.max(0, Math.hypot(camX - u.cx, camZ - u.cz) - u.radius), camY);
      const far = d > this.lodDistance;
      const geo = far ? this.lowGeos[u.species]! : this.geos[u.species]!;
      if (mesh.geometry !== geo) mesh.geometry = geo;
      // Far-off trees are a pixel or two across: their shadows aren't worth a shadow-pass draw.
      mesh.castShadow = !far;
    }
  }

  get instanceCount(): number {
    let n = 0;
    this.group.traverse((o) => {
      if (o instanceof InstancedMesh && o.visible) n += o.count;
    });
    return n;
  }
}
