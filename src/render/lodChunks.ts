import { Group, Mesh, type Material, type Vector3 } from 'three';
import type { ModelData } from './assets/builder';
import { Arrays, appendModel } from './modelMerge';

/**
 * Buildings merged into chunk meshes, at up to three levels of detail (phase 3). A model with
 * distant versions (a hand-made one) goes into near, far and skyline meshes; the shader fades
 * each out where the next takes over, dithered, so nothing pops. A model without them goes into
 * a plain mesh, drawn at every distance as before.
 *
 * Each level has chunks of its own size: near ones small, so only the few round the camera are
 * drawn; skyline ones large, so the whole city is a handful of draw calls. A chunk's mesh is only
 * built when the camera is near enough to need it: the whole-city view builds skyline meshes
 * alone, and a change to a building far away rebuilds little.
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

/** One building as its chunks draw it. */
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
  mesh: Mesh | null;
  dirty: boolean;
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
  /** By level: its chunks, and which chunk each building is in. */
  private chunks: Map<number, Chunk>[] = [new Map(), new Map(), new Map(), new Map()];
  private chunkOf: Map<number, number>[] = [new Map(), new Map(), new Map(), new Map()];
  /** Chunk meshes rebuilt (for tests and the debug panel). */
  rebuilt = 0;
  /** Show one level everywhere (tests: compare a level with the next). Null: by distance. */
  force: number | null = null;
  private turn = 0;

  constructor(
    private name: string,
    /** Chunk size (m) by level: plain, near, far, skyline. */
    private sizes: [number, number, number, number],
    private materials: LodMaterials,
    private item: (id: number) => ChunkItem | null,
    /** Stale chunks rebuilt per frame (a changed building's; more wait their turn). */
    private budget = 1,
  ) {}

  /** A building appeared, moved or changed (give where it is), or went (null). */
  set(id: number, at: { x: number; z: number } | null): void {
    for (let l = 0; l < 4; l++) {
      const size = this.sizes[l]!;
      const chunks = this.chunks[l]!;
      const of = this.chunkOf[l]!;
      const old = of.get(id);
      const k = at ? Math.floor(at.x / size) * 1000 + Math.floor(at.z / size) : undefined;
      if (old !== undefined) {
        const c = chunks.get(old);
        if (c) {
          if (old !== k) c.ids.delete(id);
          c.dirty = true;
          c.bounds = false;
        }
        if (old !== k) of.delete(id);
      }
      if (k === undefined) continue;
      let c = chunks.get(k);
      if (!c)
        chunks.set(
          k,
          (c = { ids: new Set(), mesh: null, dirty: true, cx: 0, cy: 0, cz: 0, r: 0, bounds: false }),
        );
      c.ids.add(id);
      c.dirty = true;
      c.bounds = false;
      of.set(id, k);
    }
  }

  private drop(c: Chunk): void {
    const m = c.mesh;
    if (!m) return;
    this.group.remove(m);
    m.geometry.dispose();
    c.mesh = null;
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
    this.drop(c);
    c.dirty = false;
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
    c.mesh = mesh;
    this.group.add(mesh);
    this.rebuilt++;
  }

  /**
   * Once a frame: show each level's chunks that the camera's distance calls for, building the
   * ones that are missing. `all` builds everything wanted now (tests and screenshots).
   */
  update(eye: Vector3, range: LodRange, all = false): void {
    let budget = all ? Infinity : this.budget;
    const f = this.force;
    // The levels take turns at the rebuild budget, so a stream of changes can't keep the far
    // and skyline meshes waiting behind the near ones.
    const first = this.turn++ % 4;
    for (let step = 0; step < 4; step++) {
      const l = (first + step) % 4;
      for (const [k, c] of this.chunks[l]!) {
        if (!c.ids.size) {
          this.drop(c);
          this.chunks[l]!.delete(k);
          continue;
        }
        if (!c.bounds) this.measure(c);
        const d = Math.hypot(eye.x - c.cx, eye.y - c.cy, eye.z - c.cz);
        const dMin = Math.max(0, d - c.r);
        const dMax = d + c.r;
        let need: boolean;
        let soon: boolean;
        if (l === PLAIN) need = soon = true;
        else if (l === NEAR) {
          need = dMin < range.nearEnd;
          soon = dMin < range.nearEnd + PREFETCH;
        } else if (l === FAR) {
          need = dMax > range.nearStart && dMin < range.skyEnd;
          soon = dMax > range.nearStart - PREFETCH && dMin < range.skyEnd + PREFETCH;
        } else {
          need = dMax > range.skyStart;
          soon = dMax > range.skyStart - PREFETCH;
        }
        if (f !== null && l !== PLAIN) need = soon = f === l;
        if (c.dirty) {
          // Wanted and not there at all: build it now, or there would be a hole. Wanted and
          // stale (a building in it changed), or wanted soon: in turn, a chunk a frame.
          if (need && !c.mesh && l !== PLAIN) this.rebuild(k, c, l);
          else if ((need || soon) && budget > 0) {
            budget--;
            this.rebuild(k, c, l);
          } else if (!need && !soon) this.drop(c);
        } else if (f === null && l === NEAR && c.mesh && dMin > range.nearEnd + EVICT) {
          this.drop(c);
          c.dirty = true;
        }
        if (c.mesh) {
          c.mesh.visible = need;
          // A chunk wholly inside its level's range has nothing to fade: it is drawn with the
          // plain material, whose shader never discards (a discard costs a tile-based GPU its
          // hidden-surface removal). Only chunks across a hand-over band pay for the dither.
          const whole =
            f === null &&
            (l === NEAR
              ? dMax < range.nearStart
              : l === FAR
                ? dMin > range.nearEnd && dMax < range.skyStart
                : l === SKY && dMin > range.skyEnd);
          c.mesh.material = this.materials.colour[whole ? PLAIN : l]!;
          c.mesh.customDepthMaterial = whole ? undefined : this.materials.depth[l];
        }
      }
    }
  }

  /** Triangles in the meshes on show, by level (debugging and tests). */
  stats(): Record<(typeof LEVELS)[number], number> {
    const out = { plain: 0, near: 0, far: 0, sky: 0 };
    for (let l = 0; l < 4; l++)
      for (const c of this.chunks[l]!.values())
        if (c.mesh?.visible) out[LEVELS[l]!] += c.mesh.geometry.getAttribute('position').count / 3;
    return out;
  }
}
