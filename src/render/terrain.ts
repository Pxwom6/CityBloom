import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DataTexture,
  Group,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  MeshLambertMaterial,
  RedFormat,
  RepeatWrapping,
  RGBAFormat,
  UnsignedByteType,
} from 'three';
import { GRID_CELL, GRID_RES, HEIGHT_RES, HEIGHT_STEP, MAP_SIZE, SCENERY_MARGIN } from '../data/world';
import { Noise2D, clamp, smoothstep } from '../sim/terrain/noise';
import type { ClientWorld } from '../client/world';
import type { RoadTypeId } from '../data/roads';
import { PAL } from './palette';
import { GRADE_GLSL, SEASON_GLSL, SNOW_COLOUR, SNOW_NOISE_GLSL, type WeatherUniforms } from './weather';

const CHUNKS = 4; // buildable terrain split into CHUNKS² meshes for culling
const SCENERY_STEP = 32;

/** The town mask's cells (m): how near the roads the ground is, for the grass to know (M27). */
const URBAN_CELL = 8;
const URBAN_RES = MAP_SIZE / URBAN_CELL;
/** How far from a road the ground still counts as town (m). */
const URBAN_REACH = 46;
const TOWN_ROADS = new Set<RoadTypeId>(['dirt', 'street', 'avenue', 'boulevard']);

export interface TerrainUniforms {
  uOverlay: { value: DataTexture };
  uUrban: { value: DataTexture };
  /** Four channels of random values a texel, tiling (M27): value noise for one lookup. */
  uNoiseTex: { value: DataTexture };
  uOverlayOn: { value: number };
  uTime: { value: number };
  uMapSize: { value: number };
  uGridOn: { value: number };
  /** Fields, hedgerows and paths in the country (M27's cost switch): 0 off, 1 on. */
  uGroundDetail: { value: number };
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
  /** Season, snow and wet ground (M22); set by the renderer before the first frame. */
  weather: WeatherUniforms | null = null;
  private noise = new Noise2D('terrain-colour');
  /** How much of a town each 8 m of the map is (0 open country … 255 by a road). */
  private urbanData: Uint8Array;
  private urbanDirty = true;
  private urbanAt = -1;
  private tmp = new Color();

  constructor(private world: ClientWorld) {
    const overlayData = new Uint8Array(GRID_RES * GRID_RES * 4);
    const overlay = new DataTexture(overlayData, GRID_RES, GRID_RES, RGBAFormat, UnsignedByteType);
    overlay.magFilter = LinearFilter;
    overlay.minFilter = LinearFilter;
    overlay.needsUpdate = true;
    this.urbanData = new Uint8Array(URBAN_RES * URBAN_RES);
    const urban = new DataTexture(this.urbanData, URBAN_RES, URBAN_RES, RedFormat, UnsignedByteType);
    urban.magFilter = LinearFilter;
    urban.minFilter = LinearFilter;
    urban.needsUpdate = true;
    this.uniforms = {
      uOverlay: { value: overlay },
      uUrban: { value: urban },
      uNoiseTex: { value: noiseTexture() },
      uOverlayOn: { value: 0 },
      uTime: { value: 0 },
      uMapSize: { value: MAP_SIZE },
      uGridOn: { value: 0 },
      uGroundDetail: { value: 1 },
    };
    this.material = new MeshLambertMaterial({ vertexColors: true });
    this.material.customProgramCacheKey = () => 'terrain-weather';
    this.material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms, this.weather);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying float vUp;')
        .replace(
          '#include <worldpos_vertex>',
          '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvUp = normalize(mat3(modelMatrix) * objectNormal).y;',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vWorldPos;
uniform sampler2D uOverlay;
uniform sampler2D uUrban;
uniform sampler2D uNoiseTex;
// Smooth value noise in four channels from one lookup (the cell's own smoothstep applied to the
// coordinate), for the broad layers that are always magnified.
vec4 wTex(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  return texture2D(uNoiseTex, (i + f * f * (3.0 - 2.0 * f) + 0.5) / 256.0);
}
uniform float uOverlayOn;
uniform float uTime;
uniform float uMapSize;
uniform float uGridOn;
uniform float uSnow;
uniform float uWet;
uniform vec4 uSeason;
uniform vec2 uGrade;
uniform float uGroundDetail;
varying float vUp;
${SNOW_NOISE_GLSL}
// Value noise and its slope (per unit of p), from the same four corners as wNoise.
vec3 wNoiseD(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = wHash(i);
  float b = wHash(i + vec2(1.0, 0.0));
  float c = wHash(i + vec2(0.0, 1.0));
  float d = wHash(i + vec2(1.0, 1.0));
  float k = a - b - c + d;
  return vec3(a + (b - a) * u.x + (c - a) * u.y + k * u.x * u.y, du * vec2(b - a + k * u.y, c - a + k * u.x));
}
${SEASON_GLSL}
${GRADE_GLSL}`,
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
  // Grass with variety (M27): warm and cool patches and a fine mottle everywhere; out in the
  // country, fields of their own shades with hedgerows between and worn paths across; by the
  // roads, tidier grass. Before the seasons, so all of it turns with them.
  {
    vec3 c0 = diffuseColor.rgb;
    float grassy0 = clamp((c0.g - max(c0.r, c0.b)) * 8.0, 0.0, 1.0) * step(0.6, vWorldPos.y);
    if (grassy0 > 0.0) {
      float town = outside > 0.5 ? 0.0 : texture2D(uUrban, p / uMapSize).r;
      float country = 1.0 - smoothstep(0.05, 0.45, town);
      vec4 broad = wTex(p * 0.011 + 17.0);
      float tone = (broad.r - 0.5) * 0.9 * (0.55 + 0.45 * country);
      vec3 c = mix(c0 * vec3(0.94, 1.0, 1.03), c0 * vec3(1.06, 1.03, 0.86), clamp(tone + 0.5, 0.0, 1.0));
      // A fine mottle, mipmapped so it fades to an even shade far off instead of shimmering.
      c *= 1.0 + 0.07 * (texture2D(uNoiseTex, p * (0.23 / 256.0)).g - 0.5);
      // Fields and paths out in the country, at Medium and High (the cost switch: Low keeps the
      // tone patches and mottle only).
      if (country > 0.0 && uGroundDetail > 0.5) {
        // Fields: farms of their own lie, a few hundred metres across, each a patchwork of fields
        // in staggered rows (turning about the farm's own middle; turning about the map's origin
        // by a slowly varying angle bent the rows into arcs). Some farms are rough grazing.
        vec2 farm = floor(p / 420.0);
        vec2 ed = min(p - farm * 420.0, (farm + 1.0) * 420.0 - p);
        float farmed = step(0.3, wHash(farm + 2.0)) * smoothstep(8.0, 30.0, min(ed.x, ed.y)) * country;
        if (farmed > 0.0) {
          float ang = (wHash(farm + 11.0) - 0.5) * 1.6;
          vec2 q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * (p - (farm + 0.5) * 420.0);
          vec2 fsize = vec2(64.0 + 50.0 * wHash(farm + 5.0), 38.0 + 30.0 * wHash(farm + 9.0));
          float row = floor(q.y / fsize.y);
          q.x += wHash(vec2(row, farm.x * 7.0 + farm.y)) * fsize.x;
          vec2 fid = vec2(floor(q.x / fsize.x), row) + farm * 31.0;
          vec2 fuv = vec2(fract(q.x / fsize.x), fract(q.y / fsize.y)) * fsize;
          float shade = wHash(fid + 7.0);
          c *= 1.0 + (shade - 0.5) * 0.1 * farmed;
          c = mix(c, c * vec3(1.05, 1.02, 0.8), step(0.84, shade) * 0.35 * farmed);
          // Hedgerows along some field sides.
          float hx = min(fuv.x, fsize.x - fuv.x) + 9.0 * step(wHash(fid * 1.3 + 1.0), 0.45);
          float hy = min(fuv.y, fsize.y - fuv.y) + 9.0 * step(wHash(vec2(row, farm.y) + 4.0), 0.4);
          float hedge = 1.0 - smoothstep(0.4, 1.3, min(hx, hy));
          c = mix(c, c * vec3(0.74, 0.86, 0.7), hedge * 0.5 * farmed);
        }
        // Worn paths: thin winding lines where a slow noise crosses its middle, in some places.
        vec4 slow = wTex(p * 0.004);
        float some = smoothstep(0.55, 0.75, slow.b);
        if (some > 0.0) {
          vec2 w = p + slow.rg * 160.0;
          // The same width everywhere: the noise's distance from its middle over its slope (a
          // fixed band of noise values widened into broad loops where the noise was flat).
          vec3 n = wNoiseD(w * 0.0035);
          float metres = abs(n.x - 0.5) / max(length(n.yz) * 0.0035, 1e-6);
          float path = (1.0 - smoothstep(0.3, 0.8, metres)) * some;
          c = mix(c, vec3(0.78, 0.71, 0.55), path * 0.45 * country);
        }
      }
      diffuseColor.rgb = mix(c0, c, grassy0);
    }
    // Shores: damp sand just above the water.
    float damp = (1.0 - smoothstep(0.3, 1.1, vWorldPos.y)) * step(0.12, vWorldPos.y);
    float sandy = clamp((diffuseColor.r - diffuseColor.b) * 4.0 - 0.6, 0.0, 1.0);
    diffuseColor.rgb *= 1.0 - 0.18 * damp * sandy;
  }
  // Seasons (M22): grass takes the season's colour (fresh in spring, gold in autumn, dull in
  // winter); wet ground darkens; snow settles on the flatter ground, patchy as it starts.
  {
    vec3 c0 = diffuseColor.rgb;
    float grassy = clamp((c0.g - max(c0.r, c0.b)) * 8.0, 0.0, 1.0);
    diffuseColor.rgb = mix(c0, seasonGrass(c0), grassy);
    diffuseColor.rgb *= 1.0 - 0.12 * uWet * step(0.6, vWorldPos.y);
    float n = wNoise(p * 0.045) * 0.6 + wNoise(p * 0.19) * 0.4;
    float level = smoothstep(0.5, 0.88, vUp) * step(0.6, vWorldPos.y);
    float cover = smoothstep(0.0, 0.45, uSnow * 1.6 - n * 0.75 + 0.05) * level;
    diffuseColor.rgb = mix(diffuseColor.rgb, ${SNOW_COLOUR} * (0.93 + 0.07 * n), cover);
    diffuseColor.rgb = weatherGrade(diffuseColor.rgb);
  }
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
    const editing = !!this.world.stats.map?.editor;
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
        // In the map editor (M24) sculpted ground is the map itself, not fresh earthworks.
        if (d !== 0 && !editing) this.earthworks(d, slope, c);
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
        // The generator beyond the map (a custom map's edge blends into it, M24).
        heights[j * vx + i] = this.world.heightAt(x, z);
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
    // The town mask follows the roads, at most once a second while they change.
    if (this.urbanDirty && time - this.urbanAt > 1) this.buildUrban(time);
  }

  /** The roads changed: the town mask is stale. */
  roadsChanged(): void {
    this.urbanDirty = true;
  }

  /** How near a road each 8 m of the map is: where the grass is tidy town grass, not country. */
  private buildUrban(time: number): void {
    this.urbanDirty = false;
    this.urbanAt = time;
    const d = this.urbanData;
    d.fill(0);
    const net = this.world.net;
    const r = Math.ceil(URBAN_REACH / URBAN_CELL);
    for (const [id, seg] of this.world.netState.segments) {
      // Town roads only: railways and motorways cross open country without taming it.
      if (!TOWN_ROADS.has(seg.type)) continue;
      const curve = net.curve(id);
      const steps = Math.max(1, Math.ceil(curve.length / 6));
      for (let k = 0; k <= steps; k++) {
        const pt = curve.pointAt((curve.length * k) / steps);
        const ci = Math.floor(pt.x / URBAN_CELL);
        const cj = Math.floor(pt.z / URBAN_CELL);
        for (let j = Math.max(0, cj - r); j <= Math.min(URBAN_RES - 1, cj + r); j++) {
          const dz = (j + 0.5) * URBAN_CELL - pt.z;
          for (let i = Math.max(0, ci - r); i <= Math.min(URBAN_RES - 1, ci + r); i++) {
            const dx = (i + 0.5) * URBAN_CELL - pt.x;
            const dd = dx * dx + dz * dz;
            if (dd >= URBAN_REACH * URBAN_REACH) continue;
            const v = (255 * (1 - Math.sqrt(dd) / URBAN_REACH)) | 0;
            const o = j * URBAN_RES + i;
            if (v > d[o]!) d[o] = v;
          }
        }
      }
    }
    this.uniforms.uUrban.value.needsUpdate = true;
  }
}

/** A tiling 256² texture of random bytes in four channels (deterministic). */
function noiseTexture(): DataTexture {
  const data = new Uint8Array(256 * 256 * 4);
  let h = 0x9e3779b9;
  for (let i = 0; i < data.length; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    data[i] = h & 255;
  }
  const t = new DataTexture(data, 256, 256, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
