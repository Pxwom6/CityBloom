import {
  Color,
  Group,
  Mesh,
  MeshDepthMaterial,
  MeshLambertMaterial,
  RGBADepthPacking,
  type Material,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { ClientWorld } from '../client/world';
import type { BuildingData } from '../sim/protocol';
import { CELL } from '../data/zones';
import { VARIANTS, assets } from './assets/registry';
import { LodChunks, type ChunkItem, type LodMaterials, type LodRange } from './lodChunks';
import { Arrays, appendModel } from './modelMerge';
import type { ModelData } from './assets/builder';
import type { TerrainUniforms } from './terrain';
import { GRADE_GLSL, SEASON_GLSL, SNOW_COLOUR, SNOW_NOISE_GLSL, type WeatherUniforms } from './weather';

/** Chunk sizes (m) for buildings drawn at every distance, and for the near, far and skyline levels. */
const CHUNKS: [number, number, number, number] = [256, 128, 128, 512];
const STATE_CONSTRUCTION = 0;
const STATE_ABANDONED = 2;
const STATE_RUBBLE = 3;
const SCAFFOLD = new Color('#c98b4a');
const WINDOW_LIGHT = new Color('#ffd49a');

export interface BuildingUniforms {
  uNight: { value: number };
  uWindow: { value: Color };
  /** Where the levels of detail hand over (m): near→far from x to y, far→skyline from z to w. */
  uLod: { value: Vector4 };
  /** The camera the levels are measured from (the view's, also while shadows are drawn). */
  uLodEye: { value: Vector3 };
}

/** Rotation that maps model space (front at −z) onto the lot: see DESIGN §4 and buildings.ts. */
export function buildingYaw(b: { angle: number; side: number }): number {
  return -b.angle + (b.side === 1 ? Math.PI : 0);
}

/**
 * GLSL: which fragments a level of detail draws. Each pixel has a fixed threshold; near is drawn
 * where its fade is under it, far where near isn't, and so on, so exactly one level draws each
 * pixel and the hand-over is a dither across a band, not a pop.
 */
const LOD_GLSL = `
uniform vec4 uLod;
uniform vec3 uLodEye;
#if LOD_LEVEL != 0
bool lodHidden(vec3 p, vec2 px) {
  #ifdef LOD_SHADOW
    // Shadows hand over at a line (the middle of each band): a dithered shadow caster makes
    // hatched shadows wherever the two versions differ.
    float t = 0.5;
  #else
    float t = fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
  #endif
  float d = distance(p, uLodEye);
  float far = smoothstep(uLod.x, uLod.y, d);
  float sky = smoothstep(uLod.z, uLod.w, d);
  #if LOD_LEVEL == 1
    return far > t;
  #elif LOD_LEVEL == 2
    return far <= t || sky > t;
  #else
    return sky <= t;
  #endif
}
#endif`;

/** `lod`: 0 for a mesh drawn at every distance; 1 near, 2 far, 3 skyline (see LodChunks). */
export function makeMaterial(
  uniforms: BuildingUniforms,
  terrain: TerrainUniforms,
  clip: boolean,
  weather: WeatherUniforms | null = null,
  lod = 0,
): Material {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  // three.js caches programs by the onBeforeCompile source, which is the same text for every
  // variant: without distinct keys, whichever compiled first (in a new city, the clipped
  // construction one) was reused for the other, and finished buildings drew nothing.
  mat.customProgramCacheKey = () => `${clip ? 'building-clip' : 'building'}-${lod}`;
  mat.defines = { LOD_LEVEL: lod };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uOverlay: terrain.uOverlay,
      uOverlayOn: terrain.uOverlayOn,
      uMapSize: terrain.uMapSize,
      uSeason: weather?.uSeason ?? { value: new Vector4(0, 1, 0, 0) },
      uSnow: weather?.uSnow ?? { value: 0 },
      uWet: weather?.uWet ?? { value: 0 },
      uGrade: weather?.uGrade ?? { value: new Vector2() },
    });
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float emissive;
varying float vEmi;
varying vec3 vWorldPos;
varying float vUp;
${clip ? 'attribute float clipY;\nvarying float vClip;' : ''}`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vEmi = emissive;
vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vUp = normalize(mat3(modelMatrix) * objectNormal).y;
${clip ? 'vClip = clipY;' : ''}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uNight;
uniform vec3 uWindow;
uniform sampler2D uOverlay;
uniform float uOverlayOn;
uniform float uMapSize;
uniform float uSnow;
uniform float uWet;
uniform vec2 uGrade;
uniform vec4 uSeason;
varying float vEmi;
varying vec3 vWorldPos;
varying float vUp;
${SNOW_NOISE_GLSL}
${SEASON_GLSL}
${GRADE_GLSL}
${LOD_GLSL}
${clip ? 'varying float vClip;' : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${clip ? 'if (vWorldPos.y > vClip) discard;' : ''}
#if LOD_LEVEL != 0
if (lodHidden(vWorldPos, gl_FragCoord.xy)) discard;
#endif
// Lawns and hedges in their season (a negative emissive tags them: see ModelData).
if (vEmi < -0.5) diffuseColor.rgb = vEmi < -1.5 ? seasonHedge(diffuseColor.rgb) : seasonGrass(diffuseColor.rgb);
// Snow on roofs and other flat tops, and rain-darkened ones (M22).
{
  float up = smoothstep(0.62, 0.9, vUp);
  float cover = smoothstep(0.0, 0.4, uSnow * 1.5 - wNoise(vWorldPos.xz * 0.6) * 0.5) * up;
  diffuseColor.rgb = mix(diffuseColor.rgb, ${SNOW_COLOUR}, cover * 0.95);
  diffuseColor.rgb *= 1.0 - 0.08 * uWet * up;
  diffuseColor.rgb = weatherGrade(diffuseColor.rgb);
}
if (uOverlayOn > 0.5) {
  float g2 = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(g2), 0.8);
  vec4 o = texture2D(uOverlay, vWorldPos.xz / uMapSize);
  diffuseColor.rgb = mix(diffuseColor.rgb, o.rgb, o.a * 0.85);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += uWindow * max(vEmi, 0.0) * uNight * 1.6;`,
      );
  };
  return mat;
}

/** The shadow pass's material for a level of detail: it casts what that level draws. */
export function makeDepthMaterial(uniforms: BuildingUniforms, lod: number): Material {
  const mat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  mat.customProgramCacheKey = () => `building-depth-${lod}`;
  mat.defines = { LOD_LEVEL: lod, LOD_SHADOW: 1 };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { uLod: uniforms.uLod, uLodEye: uniforms.uLodEye });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLodPos;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvLodPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLodPos;\n${LOD_GLSL}`)
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif (lodHidden(vLodPos, gl_FragCoord.xy)) discard;',
      );
  };
  return mat;
}

/** How far from the camera the levels of detail hand over, at full detail (High). */
export const LOD_RANGE: LodRange = { nearStart: 170, nearEnd: 230, skyStart: 520, skyEnd: 680 };

/**
 * Buildings: completed ones are merged per 256 m chunk (one draw call for each level of detail
 * on show); buildings under construction live in a separate layer that shows scaffolding and the
 * model rising.
 */
export class BuildingRenderer {
  readonly group = new Group();
  readonly uniforms: BuildingUniforms = {
    uNight: { value: 0 },
    uWindow: { value: WINDOW_LIGHT.clone() },
    uLod: { value: new Vector4(1e9, 2e9, 3e9, 4e9) },
    uLodEye: { value: new Vector3() },
  };
  readonly material: Material;
  /** Materials for chunk meshes by level of detail, shared with civic buildings. */
  readonly lodMaterials: LodMaterials;
  private clipMaterial: Material;
  readonly chunks: LodChunks;
  private construction: Mesh | null = null;
  private constructionDirty = true;
  private constructionKeys = '';
  /** Model heights by building, for picking. */
  readonly heights = new Map<number, number>();
  /**
   * Which of its type's looks each building wears: its own variant, moved on where a neighbour
   * of the same type and size already wears it (no two alike side by side).
   */
  private looks = new Map<number, { look: number; key: string }>();
  /** Scale on the hand-over distances (the graphics quality: coarser pixels hand over sooner). */
  lodScale = 1;

  constructor(
    private world: ClientWorld,
    terrain: TerrainUniforms,
    weather: WeatherUniforms | null = null,
  ) {
    this.material = makeMaterial(this.uniforms, terrain, false, weather);
    this.clipMaterial = makeMaterial(this.uniforms, terrain, true, weather);
    this.lodMaterials = {
      colour: [
        this.material,
        ...[1, 2, 3].map((l) => makeMaterial(this.uniforms, terrain, false, weather, l)),
      ],
      depth: [undefined, ...[1, 2, 3].map((l) => makeDepthMaterial(this.uniforms, l))],
    };
    this.chunks = new LodChunks('buildings', CHUNKS, this.lodMaterials, (id) => this.item(id));
    this.group.add(this.chunks.group);
    // In id order, so which of two alike neighbours moves on is the same every time.
    for (const b of [...world.buildings.values()].sort((a, c) => a.id - c.id)) this.place(b.id);
    world.onBuildings((changed, removed) => {
      for (const id of removed) this.place(id);
      for (const id of changed) this.place(id);
    });
  }

  /** The hand-over distances in force. */
  get range(): LodRange {
    const s = this.lodScale;
    return {
      nearStart: LOD_RANGE.nearStart * s,
      nearEnd: LOD_RANGE.nearEnd * s,
      skyStart: LOD_RANGE.skyStart * s,
      skyEnd: LOD_RANGE.skyEnd * s,
    };
  }

  private item(id: number): ChunkItem | null {
    const b = this.world.buildings.get(id);
    if (!b || b.state === STATE_CONSTRUCTION) return null;
    return {
      x: b.x,
      y: b.y,
      z: b.z,
      yaw: buildingYaw(b),
      model: this.model(b),
      look: b.fire > 0 ? Math.min(1, b.fire * 1.2) : b.state === STATE_ABANDONED,
      seed: b.id,
      reach: Math.hypot(b.w, b.d) * (CELL / 2) + 2,
    };
  }

  private place(id: number): void {
    this.constructionDirty = true;
    const b = this.world.buildings.get(id);
    if (!b) {
      this.heights.delete(id);
      this.looks.delete(id);
      this.chunks.set(id, null);
      return;
    }
    this.heights.set(id, this.model(b).height);
    this.chunks.set(id, b.state === STATE_CONSTRUCTION ? null : b);
  }

  /** The look a building wears: its variant, unless a neighbour of its type and size wears that. */
  look(b: BuildingData): number {
    const key = `${b.def}|${b.w}x${b.d}`;
    const had = this.looks.get(b.id);
    if (had && had.key === key) return had.look;
    const taken = new Set<number>();
    const reach = Math.max(b.w, b.d) * CELL + 2;
    const near = this.world.bldHash.query({
      minX: b.x - reach,
      minZ: b.z - reach,
      maxX: b.x + reach,
      maxZ: b.z + reach,
    });
    for (const id of near) {
      if (id === b.id) continue;
      const o = this.world.buildings.get(id);
      const l = this.looks.get(id);
      if (!o || !l || l.key !== key) continue;
      // Side by side or back to back: their lots touch.
      if (Math.hypot(o.x - b.x, o.z - b.z) <= Math.max(b.w, b.d) * CELL + 1.5) taken.add(l.look);
    }
    let look = b.variant % VARIANTS;
    for (let k = 0; k < VARIANTS && taken.has(look); k++) look = (look + 1) % VARIANTS;
    this.looks.set(b.id, { look, key });
    return look;
  }

  model(b: BuildingData): ModelData {
    if (b.state === STATE_RUBBLE) return assets.rubble(b.w, b.d, b.variant);
    return assets.zoned(b.def, b.w, b.d, this.look(b));
  }

  /** Append a building's model, transformed into world space, to the arrays. */
  private append(b: BuildingData, m: ModelData, out: Arrays, clipTo?: number): void {
    const look = b.fire > 0 ? Math.min(1, b.fire * 1.2) : b.state === STATE_ABANDONED;
    appendModel(out, m, b.x, b.y, b.z, buildingYaw(b), look, clipTo, b.id);
  }

  private rebuildConstruction(): void {
    const list = [...this.world.buildings.values()]
      .filter((b) => b.state === STATE_CONSTRUCTION)
      .sort((a, b) => a.id - b.id);
    const key = list.map((b) => `${b.id}:${b.def}:${Math.floor(b.progress * 20)}`).join(',');
    if (key === this.constructionKeys) return;
    this.constructionKeys = key;
    if (this.construction) {
      this.group.remove(this.construction);
      this.construction.geometry.dispose();
      this.construction = null;
    }
    if (!list.length) return;
    const arr = new Arrays(true);
    for (const b of list) {
      const m = this.model(b);
      const p = Math.min(1, Math.max(0, b.progress));
      const rise = Math.max(0, (p - 0.12) / 0.88);
      const top = m.height * rise;
      this.append(b, m, arr, b.y + Math.max(0.1, top));
      this.appendScaffold(b, top + 1.2, p, arr);
    }
    const mesh = new Mesh(arr.geometry(), this.clipMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'construction';
    this.construction = mesh;
    this.group.add(mesh);
  }

  /** Poles and planks around the lot up to height h. */
  private appendScaffold(b: BuildingData, h: number, progress: number, out: Arrays): void {
    const W = b.w * CELL - 2;
    const D = b.d * CELL - 3;
    const bars: number[][] = [];
    const t = 0.18;
    const top = Math.max(2, h);
    const nx = Math.max(2, Math.round(W / 4));
    const nz = Math.max(2, Math.round(D / 4));
    for (let i = 0; i <= nx; i++) {
      const x = -W / 2 + (W * i) / nx;
      bars.push([x - t, x + t, 0, top, -D / 2 - t, -D / 2 + t], [x - t, x + t, 0, top, D / 2 - t, D / 2 + t]);
    }
    for (let i = 1; i < nz; i++) {
      const z = -D / 2 + (D * i) / nz;
      bars.push([-W / 2 - t, -W / 2 + t, 0, top, z - t, z + t], [W / 2 - t, W / 2 + t, 0, top, z - t, z + t]);
    }
    for (let y = 2; y < top; y += 2.5) {
      bars.push(
        [-W / 2, W / 2, y, y + 0.25, -D / 2 - 0.6, -D / 2 + 0.3],
        [-W / 2, W / 2, y, y + 0.25, D / 2 - 0.3, D / 2 + 0.6],
      );
      bars.push(
        [-W / 2 - 0.6, -W / 2 + 0.3, y, y + 0.25, -D / 2, D / 2],
        [W / 2 - 0.3, W / 2 + 0.6, y, y + 0.25, -D / 2, D / 2],
      );
    }
    // Foundation slab appears first.
    bars.push([-W / 2, W / 2, 0, 0.3 + progress * 0.4, -D / 2, D / 2]);
    const mdl = boxesModel(bars, SCAFFOLD);
    this.append(b, mdl, out, 1e6);
  }

  /** Once a frame: the night glow, the levels of detail for where the camera is, and rebuilds. */
  update(night: number, eye?: Vector3): void {
    this.uniforms.uNight.value = night;
    if (eye) {
      this.uniforms.uLodEye.value.copy(eye);
      this.eye.copy(eye);
    }
    const r = this.range;
    const f = this.chunks.force;
    // One level everywhere (tests): hand over at no distance, or never.
    if (f === 1) this.uniforms.uLod.value.set(1e9, 2e9, 3e9, 4e9);
    else if (f === 2) this.uniforms.uLod.value.set(-2, -1, 3e9, 4e9);
    else if (f === 3) this.uniforms.uLod.value.set(-4, -3, -2, -1);
    else this.uniforms.uLod.value.set(r.nearStart, r.nearEnd, r.skyStart, r.skyEnd);
    this.chunks.update(this.eye, this.range);
    if (this.constructionDirty) {
      this.constructionDirty = false;
      this.rebuildConstruction();
    }
  }

  private eye = new Vector3(0, 1e6, 0);

  /** Finish all pending chunk rebuilds now (tests and screenshots). */
  flushAll(): void {
    this.chunks.update(this.eye, this.range, true);
    this.rebuildConstruction();
  }
}

function boxesModel(bars: number[][], col: Color): ModelData {
  const pos: number[] = [];
  const nrm: number[] = [];
  const cols: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], n: number[]) => {
    for (const v of [a, b, c, a, c, d]) {
      pos.push(v[0]!, v[1]!, v[2]!);
      nrm.push(n[0]!, n[1]!, n[2]!);
      cols.push(col.r, col.g, col.b);
    }
  };
  for (const [x0, x1, y0, y1, z0, z1] of bars as [number, number, number, number, number, number][]) {
    quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);
    quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]);
    quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0, 0, 1]);
    quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1, 0, 0]);
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]);
  }
  return {
    pos: new Float32Array(pos),
    nrm: new Float32Array(nrm),
    col: new Float32Array(cols),
    emi: new Float32Array(pos.length / 3),
    height: 0,
  };
}

export { Arrays, appendModel } from './modelMerge';
