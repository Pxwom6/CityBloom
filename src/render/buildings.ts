import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Mesh,
  MeshLambertMaterial,
  type Material,
  Vector2,
} from 'three';
import type { ClientWorld } from '../client/world';
import type { BuildingData } from '../sim/protocol';
import { CELL } from '../data/zones';
import { assets } from './assets/registry';
import type { ModelData } from './assets/builder';
import type { TerrainUniforms } from './terrain';
import { GRADE_GLSL, SNOW_COLOUR, SNOW_NOISE_GLSL, type WeatherUniforms } from './weather';

const CHUNK = 256;
const MAX_CHUNK_REBUILDS_PER_FRAME = 1;
const STATE_CONSTRUCTION = 0;
const STATE_ABANDONED = 2;
const STATE_RUBBLE = 3;
const SCAFFOLD = new Color('#c98b4a');
const WINDOW_LIGHT = new Color('#ffd49a');

export interface BuildingUniforms {
  uNight: { value: number };
  uWindow: { value: Color };
}

/** Rotation that maps model space (front at −z) onto the lot: see DESIGN §4 and buildings.ts. */
export function buildingYaw(b: { angle: number; side: number }): number {
  return -b.angle + (b.side === 1 ? Math.PI : 0);
}

export function makeMaterial(
  uniforms: BuildingUniforms,
  terrain: TerrainUniforms,
  clip: boolean,
  weather: WeatherUniforms | null = null,
): Material {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  // three.js caches programs by the onBeforeCompile source, which is the same text for both
  // variants: without distinct keys, whichever compiled first (in a new city, the clipped
  // construction one) was reused for the other, and finished buildings drew nothing.
  mat.customProgramCacheKey = () => (clip ? 'building-clip' : 'building');
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, {
      uOverlay: terrain.uOverlay,
      uOverlayOn: terrain.uOverlayOn,
      uMapSize: terrain.uMapSize,
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
varying float vEmi;
varying vec3 vWorldPos;
varying float vUp;
${SNOW_NOISE_GLSL}
${GRADE_GLSL}
${clip ? 'varying float vClip;' : ''}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${clip ? 'if (vWorldPos.y > vClip) discard;' : ''}
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
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += uWindow * vEmi * uNight * 1.6;`,
      );
  };
  return mat;
}

interface Chunk {
  ids: Set<number>;
  mesh: Mesh | null;
}

/**
 * Buildings: completed ones are merged per 256 m chunk (one draw call each); buildings under
 * construction live in a separate layer that shows scaffolding and the model rising.
 */
export class BuildingRenderer {
  readonly group = new Group();
  readonly uniforms: BuildingUniforms = { uNight: { value: 0 }, uWindow: { value: WINDOW_LIGHT.clone() } };
  readonly material: Material;
  private clipMaterial: Material;
  private chunks = new Map<number, Chunk>();
  private chunkOf = new Map<number, number>();
  private dirty = new Set<number>();
  private construction: Mesh | null = null;
  private constructionDirty = true;
  private constructionKeys = '';
  /** Model heights by building, for picking. */
  readonly heights = new Map<number, number>();

  constructor(
    private world: ClientWorld,
    terrain: TerrainUniforms,
    weather: WeatherUniforms | null = null,
  ) {
    this.material = makeMaterial(this.uniforms, terrain, false, weather);
    this.clipMaterial = makeMaterial(this.uniforms, terrain, true, weather);
    for (const b of world.buildings.values()) this.place(b.id);
    world.onBuildings((changed, removed) => {
      for (const id of removed) this.place(id);
      for (const id of changed) this.place(id);
    });
  }

  private chunkKey(b: BuildingData): number {
    return Math.floor(b.x / CHUNK) * 1000 + Math.floor(b.z / CHUNK);
  }

  private place(id: number): void {
    const old = this.chunkOf.get(id);
    if (old !== undefined) {
      this.chunks.get(old)?.ids.delete(id);
      this.dirty.add(old);
      this.chunkOf.delete(id);
    }
    this.constructionDirty = true;
    const b = this.world.buildings.get(id);
    if (!b) {
      this.heights.delete(id);
      return;
    }
    this.heights.set(id, this.model(b).height);
    if (b.state === STATE_CONSTRUCTION) return;
    const k = this.chunkKey(b);
    let c = this.chunks.get(k);
    if (!c) this.chunks.set(k, (c = { ids: new Set(), mesh: null }));
    c.ids.add(id);
    this.chunkOf.set(id, k);
    this.dirty.add(k);
  }

  model(b: BuildingData): ModelData {
    if (b.state === STATE_RUBBLE) return assets.rubble(b.w, b.d, b.variant);
    return assets.zoned(b.def, b.w, b.d, b.variant);
  }

  /** Append a building's model, transformed into world space, to the arrays. */
  private append(b: BuildingData, m: ModelData, out: Arrays, clipTo?: number): void {
    const look = b.fire > 0 ? Math.min(1, b.fire * 1.2) : b.state === STATE_ABANDONED;
    appendModel(out, m, b.x, b.y, b.z, buildingYaw(b), look, clipTo);
  }

  private rebuildChunk(k: number): void {
    const c = this.chunks.get(k);
    if (!c) return;
    if (c.mesh) {
      this.group.remove(c.mesh);
      c.mesh.geometry.dispose();
      c.mesh = null;
    }
    if (!c.ids.size) {
      this.chunks.delete(k);
      return;
    }
    const arr = new Arrays(false);
    for (const id of [...c.ids].sort((a, b) => a - b)) {
      const b = this.world.buildings.get(id);
      if (b) this.append(b, this.model(b), arr);
    }
    const mesh = new Mesh(arr.geometry(), this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `buildings-${k}`;
    c.mesh = mesh;
    this.group.add(mesh);
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

  update(night: number): void {
    this.uniforms.uNight.value = night;
    let budget = MAX_CHUNK_REBUILDS_PER_FRAME;
    for (const k of [...this.dirty]) {
      if (budget-- <= 0) break;
      this.dirty.delete(k);
      this.rebuildChunk(k);
    }
    if (this.constructionDirty) {
      this.constructionDirty = false;
      this.rebuildConstruction();
    }
  }

  /** Finish all pending chunk rebuilds now (tests and screenshots). */
  flushAll(): void {
    for (const k of [...this.dirty]) this.rebuildChunk(k);
    this.dirty.clear();
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

export class Arrays {
  pos = new Float32Array(3 * 4096);
  nrm = new Float32Array(3 * 4096);
  col = new Float32Array(3 * 4096);
  emi = new Float32Array(4096);
  clip: Float32Array | null;
  n = 0;

  constructor(withClip: boolean) {
    this.clip = withClip ? new Float32Array(4096) : null;
  }

  reserve(extra: number): void {
    const need = this.n + extra;
    if (need <= this.emi.length) return;
    const cap = Math.max(need, this.emi.length * 2);
    const grow = (a: Float32Array, k: number) => {
      const b = new Float32Array(cap * k);
      b.set(a);
      return b;
    };
    this.pos = grow(this.pos, 3);
    this.nrm = grow(this.nrm, 3);
    this.col = grow(this.col, 3);
    this.emi = grow(this.emi, 1);
    if (this.clip) this.clip = grow(this.clip, 1);
  }

  geometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.pos.slice(0, this.n * 3), 3));
    g.setAttribute('normal', new BufferAttribute(this.nrm.slice(0, this.n * 3), 3));
    g.setAttribute('color', new BufferAttribute(this.col.slice(0, this.n * 3), 3));
    g.setAttribute('emissive', new BufferAttribute(this.emi.slice(0, this.n), 1));
    if (this.clip) g.setAttribute('clipY', new BufferAttribute(this.clip.slice(0, this.n), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Transform a model into world space (position, yaw) and append it; optionally darken as abandoned. */
export function appendModel(
  out: Arrays,
  m: ModelData,
  x: number,
  y: number,
  z: number,
  yaw: number,
  abandoned: boolean | number = false,
  clipTo?: number,
): void {
  // true = abandoned (greyed, dark windows); a number = charred by fire to that degree (0..1).
  const char = typeof abandoned === 'number' ? abandoned : 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const n = m.pos.length / 3;
  out.reserve(n);
  for (let i = 0; i < n; i++) {
    const lx = m.pos[i * 3]!;
    const ly = m.pos[i * 3 + 1]!;
    const lz = m.pos[i * 3 + 2]!;
    const nx = m.nrm[i * 3]!;
    const nz = m.nrm[i * 3 + 2]!;
    const o = out.n * 3;
    out.pos[o] = x + lx * c + lz * s;
    out.pos[o + 1] = y + ly;
    out.pos[o + 2] = z - lx * s + lz * c;
    out.nrm[o] = nx * c + nz * s;
    out.nrm[o + 1] = m.nrm[i * 3 + 1]!;
    out.nrm[o + 2] = -nx * s + nz * c;
    let r = m.col[i * 3]!;
    let g = m.col[i * 3 + 1]!;
    let bl = m.col[i * 3 + 2]!;
    if (char > 0) {
      const k = 1 - 0.75 * char;
      r *= k;
      g *= k * 0.92;
      bl *= k * 0.85;
    } else if (abandoned) {
      const grey = (r + g + bl) / 3;
      r = (r * 0.35 + grey * 0.65) * 0.62;
      g = (g * 0.35 + grey * 0.65) * 0.6;
      bl = (bl * 0.35 + grey * 0.65) * 0.58;
    }
    out.col[o] = r;
    out.col[o + 1] = g;
    out.col[o + 2] = bl;
    out.emi[out.n] = abandoned === true || char > 0.3 ? 0 : m.emi[i]!;
    if (out.clip) out.clip[out.n] = clipTo ?? 1e6;
    out.n++;
  }
}
