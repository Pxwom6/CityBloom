import { Group, Mesh, type Material, type Vector3 } from 'three';
import type { ModelData } from './assets/builder';
import { Arrays, appendModel } from './modelMerge';

/**
 * Buildings merged into chunk meshes, at up to three levels of detail (phase 3). A model with
 * distant versions (a hand-made one) goes into its chunk's near, far and skyline meshes; the
 * shader fades each out where the next takes over, dithered, so nothing pops. A model without
 * them goes into the chunk's plain mesh, drawn at every distance as before.
 *
 * A level's mesh is only built when the camera is near enough to need it: the whole-city view
 * builds skyline meshes alone, and a change to a building far away rebuilds little.
 */

export const LEVELS = ['plain', 'near', 'far', 'sky'] as const;
const PLAIN = 0;
const NEAR = 1;
const FAR = 2;
const SKY = 3;

/** Where the levels hand over (m from the camera): near to far, and far to skyline. */
export interface LodRange {
  nearStart: number;
  nearEnd: number;
  skyStart: number;
  skyEnd: number;
}

/** One building as its chunk draws it. */
export interface ChunkItem {
  x: number;
  y: number;
  z: number;
  yaw: number;
  model: ModelData;
  /** true: abandoned; a number: charred by fire to that degree. */
  look: boolean | number;
  /** Tells one copy of a model from the next (its lit windows). */
  seed: number;
  /** How far the building reaches from (x, z): half its footprint's diagonal (m). */
  reach: number;
}

export interface LodMaterials {
  /** By level: plain (no fade), near, far, skyline. */
  colour: Material[];
  /** The same fades for the shadow pass (none for plain). */
  depth: (Material | undefined)[];
}

interface Chunk {
  ids: Set<number>;
  mesh: (Mesh | null)[];
  dirty: boolean[];
  /** Bounding sphere of everything in the chunk. */
  cx: number;
  cy: number;
  cz: number;
  r: number;
  bounds: boolean;
}

/** Build a level's mesh this far before it is needed, so it is there when the fade begins. */
const PREFETCH = 140;
/** Drop a near mesh this far past where it is last drawn. */
const EVICT = 700;

function versionOf(model: ModelData, level: number): ModelData | null {
  if (level === PLAIN) return model.far ? null : model;
  if (!model.far) return null;
  return level === NEAR ? model : level === FAR ? model.far : (model.sky ?? model.far);
}

export class LodChunks {
  readonly group = new Group();
  private chunks = new Map<number, Chunk>();
  private chunkOf = new Map<number, number>();
  /** Chunk meshes rebuilt (for tests and the debug panel). */
  rebuilt = 0;
  /** Show one level everywhere (tests: compare a level with the next). Null: by distance. */
  force: number | null = null;

  constructor(
    private name: string,
    private size: number,
    private materials: LodMaterials,
    private item: (id: number) => ChunkItem | null,
    /** Plain rebuilds allowed per frame (a changed building's chunk; more wait their turn). */
    private budget = 1,
  ) {}

  private key(x: number, z: number): number {
    return Math.floor(x / this.size) * 1000 + Math.floor(z / this.size);
  }

  /** A building appeared, moved or changed (give where it is), or went (null). */
  set(id: number, at: { x: number; z: number } | null): void {
    const old = this.chunkOf.get(id);
    const k = at ? this.key(at.x, at.z) : undefined;
    if (old !== undefined) {
      const c = this.chunks.get(old);
      if (c) {
        if (old !== k) c.ids.delete(id);
        c.dirty.fill(true);
        c.bounds = false;
      }
      if (old !== k) this.chunkOf.delete(id);
    }
    if (k === undefined) return;
    let c = this.chunks.get(k);
    if (!c)
      this.chunks.set(
        k,
        (c = {
          ids: new Set(),
          mesh: [null, null, null, null],
          dirty: [true, true, true, true],
          cx: 0,
          cy: 0,
          cz: 0,
          r: 0,
          bounds: false,
        }),
      );
    c.ids.add(id);
    c.dirty.fill(true);
    c.bounds = false;
    this.chunkOf.set(id, k);
  }

  private drop(c: Chunk, level: number): void {
    const m = c.mesh[level];
    if (!m) return;
    this.group.remove(m);
    m.geometry.dispose();
    c.mesh[level] = null;
  }

  private measure(c: Chunk): void {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const id of c.ids) {
      const it = this.item(id);
      if (!it) continue;
      const pad = it.reach;
      minX = Math.min(minX, it.x - pad);
      maxX = Math.max(maxX, it.x + pad);
      minZ = Math.min(minZ, it.z - pad);
      maxZ = Math.max(maxZ, it.z + pad);
      minY = Math.min(minY, it.y);
      maxY = Math.max(maxY, it.y + it.model.height);
    }
    c.cx = (minX + maxX) / 2;
    c.cy = (minY + maxY) / 2;
    c.cz = (minZ + maxZ) / 2;
    c.r = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2;
    c.bounds = true;
  }

  private rebuild(k: number, c: Chunk, level: number): void {
    this.drop(c, level);
    c.dirty[level] = false;
    const arr = new Arrays(false);
    for (const id of [...c.ids].sort((a, b) => a - b)) {
      const it = this.item(id);
      if (!it) continue;
      const m = versionOf(it.model, level);
      if (m) appendModel(arr, m, it.x, it.y, it.z, it.yaw, it.look, undefined, it.seed);
    }
    if (!arr.n) return;
    const mesh = new Mesh(arr.geometry(), this.materials.colour[level]);
    mesh.customDepthMaterial = this.materials.depth[level];
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `${this.name}-${LEVELS[level]}-${k}`;
    c.mesh[level] = mesh;
    this.group.add(mesh);
    this.rebuilt++;
  }

  /**
   * Once a frame: show each chunk's levels that the camera's distance calls for, building the
   * ones that are missing. `all` builds everything wanted now (tests and screenshots).
   */
  update(eye: Vector3, range: LodRange, all = false): void {
    let budget = all ? Infinity : this.budget;
    for (const [k, c] of this.chunks) {
      if (!c.ids.size) {
        for (let l = 0; l < 4; l++) this.drop(c, l);
        this.chunks.delete(k);
        continue;
      }
      if (!c.bounds) this.measure(c);
      const d = Math.hypot(eye.x - c.cx, eye.y - c.cy, eye.z - c.cz);
      const dMin = Math.max(0, d - c.r);
      const dMax = d + c.r;
      const f = this.force;
      const need =
        f === null
          ? [true, dMin < range.nearEnd, dMax > range.nearStart && dMin < range.skyEnd, dMax > range.skyStart]
          : [true, f === NEAR, f === FAR, f === SKY];
      const soon = [
        true,
        dMin < range.nearEnd + PREFETCH,
        dMax > range.nearStart - PREFETCH && dMin < range.skyEnd + PREFETCH,
        dMax > range.skyStart - PREFETCH,
      ];
      for (let l = 0; l < 4; l++) {
        if (c.dirty[l]) {
          // Wanted and not there at all: build it now, or there would be a hole. Wanted and
          // stale (a building in it changed), or wanted soon: in turn, a chunk a frame.
          if (need[l] && !c.mesh[l] && l !== PLAIN) this.rebuild(k, c, l);
          else if ((need[l] || soon[l]) && budget > 0) {
            budget--;
            this.rebuild(k, c, l);
          } else if (!need[l] && !soon[l]) this.drop(c, l);
        } else if (l === NEAR && c.mesh[l] && dMin > range.nearEnd + EVICT) {
          this.drop(c, l);
          c.dirty[l] = true;
        }
        const m = c.mesh[l];
        if (m) m.visible = need[l]!;
      }
    }
  }

  /** Triangles in the meshes on show, by level (debugging and tests). */
  stats(): Record<(typeof LEVELS)[number], number> {
    const out = { plain: 0, near: 0, far: 0, sky: 0 };
    for (const c of this.chunks.values())
      for (let l = 0; l < 4; l++) {
        const m = c.mesh[l];
        if (m?.visible) out[LEVELS[l]!] += m.geometry.getAttribute('position').count / 3;
      }
    return out;
  }
}
