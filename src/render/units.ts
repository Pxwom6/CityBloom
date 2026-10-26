import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Euler,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  MeshDepthMaterial,
  MeshLambertMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  RGBADepthPacking,
  Vector3,
  type Material,
} from 'three';
import type { ClientWorld } from '../client/world';
import { PLAYER_COLORS } from '../../relay/protocol';
import { UNIT_ROLES, type BakedUnit } from '../models/baked';
import type { UnitKind } from '../data/war';
import { UNIT_ROLE_COLOURS, unitModel } from './assets/unitModels';
import { PoseCache, unitPoses, type UnitActivity, type UnitPose } from './unitPoses';

/**
 * The city's units on screen (phase 5, M34): one instanced mesh per unit kind and level (near, and
 * a far version without the fittings), and beyond far range a cheap layer of dots in the owner's
 * colour. A shader turns each moving part about its pivot from per-instance pose attributes
 * (turret yaw, barrel lift, metres rolled, hatches and ramps, rotor angle) and a slow tick uniform
 * (radar dishes), and paints body and body_alt from per-instance colours; the shadow pass moves the
 * parts the same way. Poses come from unitPoses.ts, pure functions of the display clock. With war
 * off nothing here is made or drawn.
 */

/** The graphics quality's say over units (QUALITY_PARAMS.units). */
export interface UnitQuality {
  /** Camera distance (m) out to which the near version is drawn, then the far one, then dots. */
  near: number;
  far: number;
  /** Turning turrets, spinning rotors, rolling wheels: off draws every part at rest. */
  animate: boolean;
  shadows: boolean;
  /** Per base: squads marching (and vehicles drilling), vehicles and boats out, aircraft up. */
  drill: number;
  patrol: number;
  fly: number;
}

export const UNIT_QUALITY_DEFAULT: UnitQuality = {
  near: 260,
  far: 1400,
  animate: true,
  shadows: true,
  drill: 8,
  patrol: 3,
  fly: 4,
};

/** How a part moves (the shader's codes). */
const MOVE = {
  none: 0,
  turret: 1,
  barrel: 2,
  spinX: 3,
  spinY: 4,
  spinZ: 5,
  wheel: 6,
  track: 7,
  hatch: 8,
  ramp: 9,
  dish: 10,
};

/** Roles the shader treats apart: painted body, painted body_alt, glowing light. */
const ROLE_CODE: Record<string, number> = { body: 1, body_alt: 2, light: 3 };

const MOVE_GLSL = /* glsl */ `
attribute vec4 aPart;
attribute vec3 aPivot;
attribute vec3 aPivotP;
attribute vec4 iPose;
attribute vec4 iMisc;
uniform float uSlow;
mat3 unitRotX(float a) { float c = cos(a); float s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
mat3 unitRotY(float a) { float c = cos(a); float s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 unitRotZ(float a) { float c = cos(a); float s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
mat3 unitMotion(float kind, float rate) {
  if (kind < 0.5) return mat3(1.0);
  if (kind < 1.5) return unitRotY(iPose.x);
  if (kind < 2.5) return unitRotX(iPose.y);
  if (kind < 3.5) return unitRotX(iMisc.x * rate);
  if (kind < 4.5) return unitRotY(iMisc.x * rate);
  if (kind < 5.5) return unitRotZ(iMisc.x * rate);
  if (kind < 6.5) return unitRotX(-iPose.z * rate);
  if (kind < 7.5) return mat3(1.0);
  if (kind < 8.5) return unitRotX(iPose.w * 1.7);
  if (kind < 9.5) return unitRotX(-iPose.w * 1.45);
  return unitRotY(uSlow * rate);
}
vec3 unitShift(float kind) {
  // Tracks jiggle as they run rather than turn.
  return kind > 6.5 && kind < 7.5 ? vec3(0.0, 0.035 * sin(iPose.z * 2.7), 0.0) : vec3(0.0);
}
void unitMove(inout vec3 p, inout vec3 n) {
#ifdef UNIT_ANIM
  mat3 a = unitMotion(aPart.x, aPart.w);
  p = a * (p - aPivot) + aPivot + unitShift(aPart.x);
  n = a * n;
  mat3 b = unitMotion(aPart.y, 1.0);
  p = b * (p - aPivotP) + aPivotP + unitShift(aPart.y);
  n = b * n;
#endif
}
`;

export function unitMaterial(
  uniforms: { uNight: { value: number }; uSlow: { value: number } },
  animate: boolean,
): Material {
  const mat = new MeshLambertMaterial({ vertexColors: true });
  // Programs are keyed by this (three.js caches them by the source otherwise, which is the same
  // text for both variants).
  mat.customProgramCacheKey = () => `unit-${animate ? 1 : 0}`;
  if (animate) mat.defines = { UNIT_ANIM: 1 };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\n${MOVE_GLSL}\nattribute vec3 iBody;\nattribute vec3 iAlt;\nvarying float vLight;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvec3 unitPos = vec3(position);\nunitMove(unitPos, objectNormal);',
      )
      .replace('#include <begin_vertex>', 'vec3 transformed = unitPos;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
if (aPart.z > 0.5 && aPart.z < 1.5) vColor.rgb = iBody;
else if (aPart.z > 1.5 && aPart.z < 2.5) vColor.rgb = iAlt;
vLight = aPart.z > 2.5 ? 1.0 : 0.0;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLight;\nuniform float uNight;')
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vLight * (0.15 + 1.8 * uNight) * vec3(1.0, 0.86, 0.55);',
      );
  };
  return mat;
}

/** The shadow pass's material: it moves the parts as the colour pass does. */
export function unitDepthMaterial(uniforms: { uSlow: { value: number } }, animate: boolean): Material {
  const mat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  mat.customProgramCacheKey = () => `unit-depth-${animate ? 1 : 0}`;
  if (animate) mat.defines = { UNIT_ANIM: 1 };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${MOVE_GLSL}`)
      .replace(
        '#include <begin_vertex>',
        'vec3 transformed = vec3(position);\nvec3 unitN = vec3(0.0, 1.0, 0.0);\nunitMove(transformed, unitN);',
      );
  };
  return mat;
}

/** How each named part moves, and its rate (spins: turns per rotor turn; wheels: 1 / radius). */
function motionOf(
  name: string,
  pivot: [number, number, number],
  thin: 0 | 1 | 2,
): { kind: number; rate: number } {
  const spin = [MOVE.spinX, MOVE.spinY, MOVE.spinZ][thin]!;
  switch (name) {
    case 'turret':
      return { kind: MOVE.turret, rate: 1 };
    case 'barrel':
      return { kind: MOVE.barrel, rate: 1 };
    case 'rotor':
      return { kind: spin, rate: 1 };
    case 'tail_rotor':
      return { kind: spin, rate: 3 };
    case 'propeller':
      return { kind: spin, rate: 2 };
    case 'wheel':
      return { kind: MOVE.wheel, rate: 1 / Math.max(0.2, pivot[1]) };
    case 'track_left':
    case 'track_right':
      return { kind: MOVE.track, rate: 1 };
    case 'hatch':
      return { kind: MOVE.hatch, rate: 1 };
    case 'ramp':
      return { kind: MOVE.ramp, rate: 1 };
    case 'radar_dish':
      return { kind: MOVE.dish, rate: 1 };
    default:
      return { kind: MOVE.none, rate: 1 };
  }
}

/**
 * A unit's triangles as drawable geometry (flat-shaded, each triangle its own vertices): colours by
 * role, and per vertex the motion of its part and of the part that carries it, with their pivots.
 * `far` keeps the triangles the far version keeps. Muzzle cubes aren't drawn.
 */
export function unitGeometry(u: BakedUnit, far: boolean): BufferGeometry {
  const P = u.positions;
  const I = u.index;
  const nTri = I.length / 3;
  // Each part's thinnest axis (what a disc spins about).
  const lo = u.parts.map(() => [Infinity, Infinity, Infinity]);
  const hi = u.parts.map(() => [-Infinity, -Infinity, -Infinity]);
  for (let t = 0; t < nTri; t++) {
    const p = u.triPart[t]!;
    if (!p) continue;
    for (let j = 0; j < 3; j++) {
      const v = I[t * 3 + j]! * 3;
      for (let a = 0; a < 3; a++) {
        lo[p - 1]![a] = Math.min(lo[p - 1]![a]!, P[v + a]!);
        hi[p - 1]![a] = Math.max(hi[p - 1]![a]!, P[v + a]!);
      }
    }
  }
  const motions = u.parts.map((part, k) => {
    const ext = [0, 1, 2].map((a) => hi[k]![a]! - lo[k]![a]!);
    const thin = ext.indexOf(Math.min(...ext)) as 0 | 1 | 2;
    return motionOf(part.name, part.pivot, thin);
  });
  /** The nearest two moving parts up the chain from part p (1-based; 0 = the body). */
  const chain = (p: number) => {
    const out: { kind: number; rate: number; pivot: [number, number, number] }[] = [];
    for (let k = p, guard = 0; k > 0 && guard < 8 && out.length < 2; guard++) {
      const m = motions[k - 1]!;
      if (m.kind !== MOVE.none) out.push({ ...m, pivot: u.parts[k - 1]!.pivot });
      k = u.parts[k - 1]!.parent;
    }
    return out;
  };
  const chains = [[], ...u.parts.map((_, k) => chain(k + 1))];
  const keep: number[] = [];
  for (let t = 0; t < nTri; t++) {
    if (far && !u.triFar[t]) continue;
    const p = u.triPart[t]!;
    if (p && u.parts[p - 1]!.name === 'muzzle') continue;
    keep.push(t);
  }
  const n = keep.length;
  const pos = new Float32Array(n * 9);
  const nrm = new Float32Array(n * 9);
  const col = new Float32Array(n * 9);
  const part = new Float32Array(n * 12);
  const piv = new Float32Array(n * 9);
  const pivP = new Float32Array(n * 9);
  const roleCol = UNIT_ROLES.map((r, i) => {
    const own = u.colors[i];
    if (own) return own;
    return new Color(UNIT_ROLE_COLOURS[r]).toArray() as [number, number, number];
  });
  keep.forEach((t, k) => {
    const ia = I[t * 3]! * 3;
    const ib = I[t * 3 + 1]! * 3;
    const ic = I[t * 3 + 2]! * 3;
    const ux = P[ib]! - P[ia]!;
    const uy = P[ib + 1]! - P[ia + 1]!;
    const uz = P[ib + 2]! - P[ia + 2]!;
    const vx = P[ic]! - P[ia]!;
    const vy = P[ic + 1]! - P[ia + 1]!;
    const vz = P[ic + 2]! - P[ia + 2]!;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const role = u.triRole[t]!;
    const c = roleCol[role] ?? [0.5, 0.5, 0.5];
    const code = ROLE_CODE[UNIT_ROLES[role] ?? ''] ?? 0;
    const ch = chains[u.triPart[t]!] ?? [];
    const own = ch[0];
    const up = ch[1];
    [ia, ib, ic].forEach((v, j) => {
      const o = k * 9 + j * 3;
      pos[o] = P[v]!;
      pos[o + 1] = P[v + 1]!;
      pos[o + 2] = P[v + 2]!;
      nrm[o] = nx;
      nrm[o + 1] = ny;
      nrm[o + 2] = nz;
      col[o] = c[0];
      col[o + 1] = c[1];
      col[o + 2] = c[2];
      const q = k * 12 + j * 4;
      part[q] = own?.kind ?? 0;
      part[q + 1] = up?.kind ?? 0;
      part[q + 2] = code;
      part[q + 3] = own?.rate ?? 1;
      piv.set(own?.pivot ?? [0, 0, 0], o);
      pivP.set(up?.pivot ?? [0, 0, 0], o);
    });
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('normal', new BufferAttribute(nrm, 3));
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.setAttribute('aPart', new BufferAttribute(part, 4));
  g.setAttribute('aPivot', new BufferAttribute(piv, 3));
  g.setAttribute('aPivotP', new BufferAttribute(pivP, 3));
  return g;
}

interface KindMeshes {
  model: BakedUnit;
  near: InstancedMesh | null;
  far: InstancedMesh | null;
  nearGeo: BufferGeometry;
  farGeo: BufferGeometry;
}

/** Flag the first `n` instances of an instanced attribute for upload (geom.ts uploadInstances). */
function uploadRange(a: BufferAttribute, n: number): void {
  if (n <= 0) return;
  a.clearUpdateRanges();
  a.addUpdateRange(0, n * a.itemSize);
  a.needsUpdate = true;
}

export interface UnitShown {
  id: number;
  kind: UnitKind;
  level: 'near' | 'far' | 'dot';
  x: number;
  y: number;
  z: number;
  doing: UnitActivity;
}

export class UnitRenderer {
  readonly group = new Group();
  quality: UnitQuality = { ...UNIT_QUALITY_DEFAULT };
  /** The owner's colour (an index into PLAYER_COLORS): the city's player, or a shared city's host. */
  owner = 0;
  /** Drawn last frame (stats and tests). */
  counts = { near: 0, far: 0, dots: 0 };
  readonly shown: UnitShown[] = [];
  private kinds = new Map<UnitKind, KindMeshes>();
  private dots: Points | null = null;
  private cache = new PoseCache();
  private versions = '';
  private readonly uniforms = { uNight: { value: 0 }, uSlow: { value: 0 } };
  private materials: Record<'anim' | 'still', { colour: Material; depth: Material }> | null = null;
  private m = new Matrix4();
  private q = new Quaternion();
  private e = new Euler(0, 0, 0, 'YXZ');
  private p = new Vector3();
  private s = new Vector3(1, 1, 1);
  private body = new Color();
  private alt = new Color();

  constructor(private world: ClientWorld) {
    this.group.name = 'units';
  }

  /** Units made so far (meshes only exist once a unit of their kind is on the map). */
  get meshCount(): number {
    let n = this.dots ? 1 : 0;
    for (const k of this.kinds.values()) n += (k.near ? 1 : 0) + (k.far ? 1 : 0);
    return n;
  }

  private mats(): Record<'anim' | 'still', { colour: Material; depth: Material }> {
    if (!this.materials)
      this.materials = {
        anim: { colour: unitMaterial(this.uniforms, true), depth: unitDepthMaterial(this.uniforms, true) },
        still: { colour: unitMaterial(this.uniforms, false), depth: unitDepthMaterial(this.uniforms, false) },
      };
    return this.materials;
  }

  private kindMeshes(kind: UnitKind): KindMeshes {
    const model = unitModel(kind);
    let k = this.kinds.get(kind);
    if (k && k.model !== model) {
      // A hand-made model arrived (or went): build this kind again.
      for (const mesh of [k.near, k.far]) {
        if (!mesh) continue;
        this.group.remove(mesh);
        mesh.geometry.dispose();
      }
      k.nearGeo.dispose();
      k.farGeo.dispose();
      k = undefined;
    }
    if (!k) {
      k = {
        model,
        near: null,
        far: null,
        nearGeo: unitGeometry(model, false),
        farGeo: unitGeometry(model, true),
      };
      this.kinds.set(kind, k);
    }
    return k;
  }

  /** An instanced mesh with room for at least `n`, made (or grown) on demand. */
  private mesh(kind: UnitKind, level: 'near' | 'far', n: number): InstancedMesh {
    const k = this.kindMeshes(kind);
    let mesh = k[level];
    if (mesh && mesh.instanceMatrix.count >= n) return mesh;
    const cap = Math.max(8, 1 << Math.ceil(Math.log2(Math.max(1, n))));
    if (mesh) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    const base = level === 'near' ? k.nearGeo : k.farGeo;
    const g = new BufferGeometry();
    for (const name of Object.keys(base.attributes)) g.setAttribute(name, base.getAttribute(name));
    const inst = (size: number) => {
      const a = new InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(DynamicDrawUsage);
      return a;
    };
    g.setAttribute('iPose', inst(4));
    g.setAttribute('iMisc', inst(4));
    g.setAttribute('iBody', inst(3));
    g.setAttribute('iAlt', inst(3));
    mesh = new InstancedMesh(g, this.mats().anim.colour, cap);
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.name = `unit-${kind}-${level}`;
    k[level] = mesh;
    this.group.add(mesh);
    return mesh;
  }

  private dotLayer(n: number): Points {
    let d = this.dots;
    const have = d ? (d.geometry.getAttribute('position') as BufferAttribute).count : 0;
    if (d && have >= n) return d;
    const cap = Math.max(64, 1 << Math.ceil(Math.log2(Math.max(1, n))));
    if (d) {
      this.group.remove(d);
      d.geometry.dispose();
    }
    const g = new BufferGeometry();
    const pos = new BufferAttribute(new Float32Array(cap * 3), 3);
    const col = new BufferAttribute(new Float32Array(cap * 3), 3);
    pos.setUsage(DynamicDrawUsage);
    col.setUsage(DynamicDrawUsage);
    g.setAttribute('position', pos);
    g.setAttribute('color', col);
    g.setDrawRange(0, 0);
    const mat =
      (d?.material as PointsMaterial | undefined) ??
      new PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true });
    d = new Points(g, mat);
    d.frustumCulled = false;
    d.name = 'unit-dots';
    this.dots = d;
    this.group.add(d);
    return d;
  }

  /** Move every unit to where it is at `tick`, seen from `eye`; `night` lights their lamps. */
  update(tick: number, eye: Vector3, night: number): void {
    const w = this.world;
    this.shown.length = 0;
    const units = w.forces?.units;
    if (!units?.length) {
      // War off, or no units yet: nothing drawn (and nothing made until there is).
      for (const k of this.kinds.values()) for (const mesh of [k.near, k.far]) if (mesh) mesh.count = 0;
      this.dots?.geometry.setDrawRange(0, 0);
      this.counts = { near: 0, far: 0, dots: 0 };
      return;
    }
    const versions = `${w.forcesVersion}|${w.roadsVersion}|${w.terrainVersion}|${w.civics.size}`;
    if (versions !== this.versions || this.cache.size > 4000) {
      this.versions = versions;
      this.cache.clear();
    }
    const q = this.quality;
    this.uniforms.uNight.value = night;
    this.uniforms.uSlow.value = (tick * 0.06) % (Math.PI * 2);
    const poses = unitPoses(w, tick, { drill: q.drill, patrol: q.patrol, fly: q.fly }, this.cache);
    // Sort by level and kind.
    const byKind = new Map<string, UnitPose[]>();
    const dots: UnitPose[] = [];
    for (const pose of poses) {
      const d = Math.hypot(pose.x - eye.x, pose.y - eye.y, pose.z - eye.z);
      const level = d < q.near ? 'near' : d < q.far ? 'far' : 'dot';
      this.shown.push({
        id: pose.id,
        kind: pose.kind,
        level,
        x: pose.x,
        y: pose.y,
        z: pose.z,
        doing: pose.doing,
      });
      if (level === 'dot') {
        dots.push(pose);
        continue;
      }
      const key = `${pose.kind}|${level}`;
      let list = byKind.get(key);
      if (!list) byKind.set(key, (list = []));
      list.push(pose);
    }
    this.body.set(PLAYER_COLORS[this.owner] ?? PLAYER_COLORS[0]);
    this.alt.copy(this.body).multiplyScalar(0.55);
    const mats = this.mats()[q.animate ? 'anim' : 'still'];
    let near = 0;
    let far = 0;
    const touched = new Set<InstancedMesh>();
    for (const [key, list] of byKind) {
      const [kind, level] = key.split('|') as [UnitKind, 'near' | 'far'];
      const mesh = this.mesh(kind, level, list.length);
      touched.add(mesh);
      mesh.material = mats.colour;
      mesh.customDepthMaterial = mats.depth;
      mesh.castShadow = q.shadows && level === 'near';
      const pose = mesh.geometry.getAttribute('iPose') as InstancedBufferAttribute;
      const misc = mesh.geometry.getAttribute('iMisc') as InstancedBufferAttribute;
      const body = mesh.geometry.getAttribute('iBody') as InstancedBufferAttribute;
      const alt = mesh.geometry.getAttribute('iAlt') as InstancedBufferAttribute;
      const pa = pose.array as Float32Array;
      const ma = misc.array as Float32Array;
      const ba = body.array as Float32Array;
      const aa = alt.array as Float32Array;
      list.forEach((u, i) => {
        this.p.set(u.x, u.y, u.z);
        this.e.set(u.pitch, u.yaw, -u.bank, 'YXZ');
        this.q.setFromEuler(this.e);
        this.m.compose(this.p, this.q, this.s);
        mesh.setMatrixAt(i, this.m);
        pa[i * 4] = u.turret;
        pa[i * 4 + 1] = u.barrel;
        pa[i * 4 + 2] = u.rolled;
        pa[i * 4 + 3] = u.open;
        ma[i * 4] = u.spin;
        ba[i * 3] = this.body.r;
        ba[i * 3 + 1] = this.body.g;
        ba[i * 3 + 2] = this.body.b;
        aa[i * 3] = this.alt.r;
        aa[i * 3 + 1] = this.alt.g;
        aa[i * 3 + 2] = this.alt.b;
      });
      mesh.count = list.length;
      uploadRange(mesh.instanceMatrix, list.length);
      for (const a of [pose, misc, body, alt]) uploadRange(a, list.length);
      if (level === 'near') near += list.length;
      else far += list.length;
    }
    for (const k of this.kinds.values())
      for (const mesh of [k.near, k.far]) if (mesh && !touched.has(mesh)) mesh.count = 0;
    if (dots.length || this.dots) {
      const layer = this.dotLayer(dots.length);
      const pos = layer.geometry.getAttribute('position') as BufferAttribute;
      const col = layer.geometry.getAttribute('color') as BufferAttribute;
      const pa = pos.array as Float32Array;
      const ca = col.array as Float32Array;
      dots.forEach((u, i) => {
        pa[i * 3] = u.x;
        pa[i * 3 + 1] = u.y + 2;
        pa[i * 3 + 2] = u.z;
        ca[i * 3] = this.body.r;
        ca[i * 3 + 1] = this.body.g;
        ca[i * 3 + 2] = this.body.b;
      });
      layer.geometry.setDrawRange(0, dots.length);
      uploadRange(pos, dots.length);
      uploadRange(col, dots.length);
    }
    this.counts = { near, far, dots: dots.length };
  }
}
