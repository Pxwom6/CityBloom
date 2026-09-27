import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshLambertMaterial,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import { GRID_CELL, GRID_RES, HEIGHT_RES, HEIGHT_STEP, MAP_SIZE, SCENERY_MARGIN } from '../data/world';
import { Noise2D, clamp, smoothstep } from '../sim/terrain/noise';
import type { ClientWorld } from '../client/world';
import { PAL } from './palette';

const CHUNKS = 4; // buildable terrain split into CHUNKS² meshes for culling
const SCENERY_STEP = 32;

export interface TerrainUniforms {
  uOverlay: { value: DataTexture };
  uOverlayOn: { value: number };
  uTime: { value: number };
  uMapSize: { value: number };
  uGridOn: { value: number };
}

/**
 * Terrain: the buildable area at full resolution (8 m) in chunks, plus a coarser scenery ring out
 * to SCENERY_MARGIN, both vertex-coloured. A shader hook adds shoreline foam, the buildable-area
 * border, a darker tint outside it and the data-map overlay.
 */
export class TerrainRenderer {
  readonly group = new Group();
  readonly material: MeshLambertMaterial;
  readonly uniforms: TerrainUniforms;
  private noise = new Noise2D('terrain-colour');
  private tmp = new Color();

  constructor(private world: ClientWorld) {
    const overlayData = new Uint8Array(GRID_RES * GRID_RES * 4);
    const overlay = new DataTexture(overlayData, GRID_RES, GRID_RES, RGBAFormat, UnsignedByteType);
    overlay.magFilter = LinearFilter;
    overlay.minFilter = LinearFilter;
    overlay.needsUpdate = true;
    this.uniforms = {
      uOverlay: { value: overlay },
      uOverlayOn: { value: 0 },
      uTime: { value: 0 },
      uMapSize: { value: MAP_SIZE },
      uGridOn: { value: 0 },
    };
    this.material = new MeshLambertMaterial({ vertexColors: true });
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWorldPos;
uniform sampler2D uOverlay;
uniform float uOverlayOn;
uniform float uTime;
uniform float uMapSize;
uniform float uGridOn;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  vec2 p = vWorldPos.xz;
  // Shoreline foam band that gently pulses.
  float shore = 1.0 - smoothstep(0.05, 0.45, abs(vWorldPos.y - 0.12 - 0.08 * sin(uTime * 1.3 + p.x * 0.05 + p.y * 0.03)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.95, 0.9), shore * 0.55);
  // Outside the buildable area: slightly muted.
  float outside = step(p.x, 0.0) + step(uMapSize, p.x) + step(p.y, 0.0) + step(uMapSize, p.y);
  outside = clamp(outside, 0.0, 1.0);
  float grey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, vec3(grey), 0.22) * 0.96, outside);
  // Border line.
  float dEdge = min(min(abs(p.x), abs(p.x - uMapSize)), min(abs(p.y), abs(p.y - uMapSize)));
  float inRange = step(-4.0, p.x) * step(p.x, uMapSize + 4.0) * step(-4.0, p.y) * step(p.y, uMapSize + 4.0);
  float border = (1.0 - smoothstep(0.8, 2.5, dEdge)) * inRange;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.97, 0.85), border * 0.6);
  // Data-map overlay.
  if (uOverlayOn > 0.5) {
    // Data maps: mute the scene, then paint the data on top.
    float g2 = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(g2) * 0.95 + 0.03, 0.75);
    if (outside < 0.5) {
      vec4 o = texture2D(uOverlay, p / uMapSize);
      diffuseColor.rgb = mix(diffuseColor.rgb, o.rgb, o.a * 0.9);
    }
  }
  // Construction grid (8 m) while placing things.
  if (uGridOn > 0.5 && outside < 0.5) {
    vec2 g = abs(fract(p / 8.0 - 0.5) - 0.5) * 8.0;
    float line = 1.0 - smoothstep(0.0, 0.25, min(g.x, g.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), line * 0.12);
  }
}`,
        );
    };
    this.buildBuildable();
    this.buildScenery();
  }

  private colourAt(x: number, z: number, h: number, slope: number, forest: number, out: Color): Color {
    const n1 = this.noise.fbm(x / 160, z / 160, 3) * 0.5 + 0.5;
    const n2 = this.noise.fbm(x / 47 + 30, z / 47, 2) * 0.5 + 0.5;
    if (h < 0.4) {
      const depth = clamp(-h / 5, 0, 1);
      out
        .copy(PAL.wetSand)
        .lerp(PAL.riverbed, smoothstep(0, 0.3, depth))
        .lerp(PAL.deepBed, smoothstep(0.3, 1, depth));
      return out;
    }
    out.copy(PAL.grassLight).lerp(PAL.grassMid, n1);
    if (n2 > 0.62) out.lerp(PAL.meadow, smoothstep(0.62, 0.85, n2) * 0.6);
    out.lerp(PAL.forestFloor, clamp(forest * 1.1, 0, 0.7));
    out.lerp(PAL.grassDark, smoothstep(40, 110, h) * 0.5);
    const sandy = 1 - smoothstep(1.2, 2.6, h + n2 * 0.6);
    out.lerp(PAL.sand, sandy);
    const rocky = smoothstep(0.42, 0.85, slope + (n2 - 0.5) * 0.15);
    if (rocky > 0) out.lerp(this.tmp.copy(PAL.rock).lerp(PAL.rockDark, n1), rocky);
    const snowy = smoothstep(175, 230, h + n1 * 25) * (1 - smoothstep(0.9, 1.4, slope));
    if (snowy > 0) out.lerp(PAL.snow, snowy);
    return out;
  }

  private forestAt(x: number, z: number): number {
    if (x < 0 || z < 0 || x >= MAP_SIZE || z >= MAP_SIZE) {
      const h = this.world.gen.height(x, z);
      return h > 1.6 ? this.world.gen.forestNoise(x, z) * (1 - smoothstep(120, 220, h)) : 0;
    }
    const fx = clamp(x / GRID_CELL - 0.5, 0, GRID_RES - 1.001);
    const fz = clamp(z / GRID_CELL - 0.5, 0, GRID_RES - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const t = this.world.trees;
    const a = t[j * GRID_RES + i]!;
    const b = t[j * GRID_RES + i + 1]!;
    const c = t[(j + 1) * GRID_RES + i]!;
    const d = t[(j + 1) * GRID_RES + i + 1]!;
    return ((a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz) / 255;
  }

  private chunks: Mesh[] = [];

  private buildBuildable(): void {
    for (let cj = 0; cj < CHUNKS; cj++)
      for (let ci = 0; ci < CHUNKS; ci++) {
        const mesh = new Mesh(this.chunkGeometry(ci, cj), this.material);
        mesh.receiveShadow = true;
        mesh.name = `terrain-${ci}-${cj}`;
        this.chunks.push(mesh);
        this.group.add(mesh);
      }
  }

  /** Earthworks changed the ground in `box`: rebuild the chunks it touches (M13). */
  refresh(box: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    const size = MAP_SIZE / CHUNKS;
    const c0 = (v: number) => clamp(Math.floor(v / size), 0, CHUNKS - 1);
    for (let cj = c0(box.minZ - HEIGHT_STEP); cj <= c0(box.maxZ + HEIGHT_STEP); cj++)
      for (let ci = c0(box.minX - HEIGHT_STEP); ci <= c0(box.maxX + HEIGHT_STEP); ci++) {
        const mesh = this.chunks[cj * CHUNKS + ci]!;
        mesh.geometry.dispose();
        mesh.geometry = this.chunkGeometry(ci, cj);
      }
  }

  private chunkGeometry(ci: number, cj: number): BufferGeometry {
    const H = this.world.heights;
    const D = this.world.terrainDelta;
    const per = (HEIGHT_RES - 1) / CHUNKS; // quads per chunk side
    const c = new Color();
    const vx = per + 1;
    const skirtVerts = 4 * vx;
    const pos = new Float32Array((vx * vx + skirtVerts) * 3);
    const col = new Float32Array((vx * vx + skirtVerts) * 3);
    const idx: number[] = [];
    for (let j = 0; j <= per; j++) {
      for (let i = 0; i <= per; i++) {
        const gi = ci * per + i;
        const gj = cj * per + j;
        const x = gi * HEIGHT_STEP;
        const z = gj * HEIGHT_STEP;
        const h = H[gj * HEIGHT_RES + gi]!;
        const hx =
          H[gj * HEIGHT_RES + Math.min(HEIGHT_RES - 1, gi + 1)]! - H[gj * HEIGHT_RES + Math.max(0, gi - 1)]!;
        const hz =
          H[Math.min(HEIGHT_RES - 1, gj + 1) * HEIGHT_RES + gi]! - H[Math.max(0, gj - 1) * HEIGHT_RES + gi]!;
        const slope = Math.hypot(hx, hz) / (2 * HEIGHT_STEP);
        const v = j * vx + i;
        pos[v * 3] = x;
        pos[v * 3 + 1] = h;
        pos[v * 3 + 2] = z;
        this.colourAt(x, z, h, slope, this.forestAt(x, z), c);
        const d = D[gj * HEIGHT_RES + gi]!;
        if (d !== 0) this.earthworks(d, slope, c);
        col[v * 3] = c.r;
        col[v * 3 + 1] = c.g;
        col[v * 3 + 2] = c.b;
      }
    }
    for (let j = 0; j < per; j++) {
      for (let i = 0; i < per; i++) {
        const a = j * vx + i;
        const b = a + 1;
        const d = a + vx;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    // Skirts hide cracks against the coarser scenery mesh.
    let s = vx * vx;
    const edges: number[][] = [
      Array.from({ length: vx }, (_, i) => i), // top row
      Array.from({ length: vx }, (_, i) => per * vx + i), // bottom row
      Array.from({ length: vx }, (_, j) => j * vx), // left col
      Array.from({ length: vx }, (_, j) => j * vx + per), // right col
    ];
    const onMapEdge = [cj === 0, cj === CHUNKS - 1, ci === 0, ci === CHUNKS - 1];
    edges.forEach((edge, e) => {
      const start = s;
      for (const v of edge) {
        pos[s * 3] = pos[v * 3]!;
        pos[s * 3 + 1] = pos[v * 3 + 1]! - 4;
        pos[s * 3 + 2] = pos[v * 3 + 2]!;
        col[s * 3] = col[v * 3]!;
        col[s * 3 + 1] = col[v * 3 + 1]!;
        col[s * 3 + 2] = col[v * 3 + 2]!;
        s++;
      }
      if (!onMapEdge[e]) return;
      for (let k = 0; k < vx - 1; k++) {
        const a = edge[k]!;
        const b = edge[k + 1]!;
        const a2 = start + k;
        const b2 = start + k + 1;
        idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2); // both windings
      }
    });
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }

  /**
   * Ground reshaped by earthworks (M13): cutting faces show bare earth, embankments fresh turf,
   * and the level verges beside a road a lighter, mown green.
   */
  private earthworks(delta: number, slope: number, out: Color): void {
    const amount = smoothstep(0.15, 1.2, Math.abs(delta));
    if (amount <= 0) return;
    const face = smoothstep(0.08, 0.24, slope);
    if (face > 0) out.lerp(delta < 0 ? PAL.cutFace : PAL.bank, amount * face * (delta < 0 ? 0.95 : 0.8));
    else out.lerp(PAL.meadow, amount * 0.25);
  }

  private buildScenery(): void {
    const gen = this.world.gen;
    const start = -Math.ceil(SCENERY_MARGIN / SCENERY_STEP) * SCENERY_STEP;
    const end = MAP_SIZE - start;
    const n = (end - start) / SCENERY_STEP; // quads per side
    const vx = n + 1;
    const pos = new Float32Array(vx * vx * 3);
    const col = new Float32Array(vx * vx * 3);
    const heights = new Float32Array(vx * vx);
    for (let j = 0; j < vx; j++) {
      for (let i = 0; i < vx; i++) {
        const x = start + i * SCENERY_STEP;
        const z = start + j * SCENERY_STEP;
        const inside = x >= 0 && x <= MAP_SIZE && z >= 0 && z <= MAP_SIZE;
        heights[j * vx + i] = inside ? this.world.heightAt(x, z) : gen.height(x, z);
      }
    }
    const c = new Color();
    for (let j = 0; j < vx; j++) {
      for (let i = 0; i < vx; i++) {
        const v = j * vx + i;
        const x = start + i * SCENERY_STEP;
        const z = start + j * SCENERY_STEP;
        const h = heights[v]!;
        const hx = heights[j * vx + Math.min(n, i + 1)]! - heights[j * vx + Math.max(0, i - 1)]!;
        const hz = heights[Math.min(n, j + 1) * vx + i]! - heights[Math.max(0, j - 1) * vx + i]!;
        const slope = Math.hypot(hx, hz) / (2 * SCENERY_STEP);
        pos[v * 3] = x;
        pos[v * 3 + 1] = h;
        pos[v * 3 + 2] = z;
        this.colourAt(x, z, h, slope, this.forestAt(x, z), c);
        col[v * 3] = c.r;
        col[v * 3 + 1] = c.g;
        col[v * 3 + 2] = c.b;
      }
    }
    const idx: number[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x0 = start + i * SCENERY_STEP;
        const z0 = start + j * SCENERY_STEP;
        if (x0 >= 0 && x0 + SCENERY_STEP <= MAP_SIZE && z0 >= 0 && z0 + SCENERY_STEP <= MAP_SIZE) continue;
        const a = j * vx + i;
        const b = a + 1;
        const d = a + vx;
        const e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.name = 'terrain-scenery';
    this.group.add(mesh);
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }
}
