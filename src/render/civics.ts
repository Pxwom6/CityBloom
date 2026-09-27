import { Group, Mesh, type Material } from 'three';
import type { ClientWorld } from '../client/world';
import type { CivicData } from '../sim/protocol';
import { assets } from './assets/registry';
import { Arrays, appendModel, buildingYaw } from './buildings';

/** Civic buildings are merged per chunk of this many metres (one draw call per chunk). */
const CHUNK = 512;

/**
 * Civic buildings (utilities, services, parks, landmarks): merged into one mesh per 512 m chunk, so
 * a big city's hundreds of pumps, schools and stations cost a handful of draw calls. A chunk is
 * rebuilt only when something in it changes how it looks.
 */
export class CivicRenderer {
  readonly group = new Group();
  readonly heights = new Map<number, number>();
  private chunks = new Map<number, { ids: Set<number>; mesh: Mesh | null }>();
  private chunkOf = new Map<number, number>();
  /** What each civic's model depends on; unchanged means no rebuild. */
  private looks = new Map<number, string>();

  constructor(
    private world: ClientWorld,
    private material: Material,
  ) {
    const dirty = new Set<number>();
    for (const c of world.civics.values()) this.place(c.id, dirty);
    this.rebuild(dirty);
    world.onCivics((changed, removed) => {
      const touched = new Set<number>();
      for (const id of removed) this.place(id, touched);
      for (const id of changed) this.place(id, touched);
      this.rebuild(touched);
    });
  }

  private chunkKey(c: CivicData): number {
    return Math.floor(c.x / CHUNK) * 1000 + Math.floor(c.z / CHUNK);
  }

  private look(c: CivicData): string {
    return `${c.def}:${c.variant}:${c.fill ?? 0}:${c.modules?.length ?? 0}:${c.stage ?? '-'}:${c.x}:${c.y}:${c.z}:${c.angle}:${c.side}`;
  }

  private place(id: number, dirty: Set<number>): void {
    const c = this.world.civics.get(id);
    const look = c ? this.look(c) : '';
    if (c && this.looks.get(id) === look) return;
    const old = this.chunkOf.get(id);
    if (old !== undefined) {
      this.chunks.get(old)?.ids.delete(id);
      dirty.add(old);
      this.chunkOf.delete(id);
    }
    if (!c) {
      this.heights.delete(id);
      this.looks.delete(id);
      return;
    }
    this.looks.set(id, look);
    const k = this.chunkKey(c);
    let ch = this.chunks.get(k);
    if (!ch) this.chunks.set(k, (ch = { ids: new Set(), mesh: null }));
    ch.ids.add(id);
    this.chunkOf.set(id, k);
    dirty.add(k);
  }

  private rebuild(keys: Set<number>): void {
    for (const k of keys) {
      const ch = this.chunks.get(k);
      if (!ch) continue;
      if (ch.mesh) {
        this.group.remove(ch.mesh);
        ch.mesh.geometry.dispose();
        ch.mesh = null;
      }
      if (!ch.ids.size) {
        this.chunks.delete(k);
        continue;
      }
      const arr = new Arrays(false);
      for (const id of [...ch.ids].sort((a, b) => a - b)) {
        const c = this.world.civics.get(id);
        if (!c) continue;
        const m = assets.civic(c.def, c.variant, c.fill, c.modules?.length ?? 0, c.stage);
        appendModel(arr, m, c.x, c.y, c.z, buildingYaw(c));
        this.heights.set(id, m.height);
      }
      const mesh = new Mesh(arr.geometry(), this.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = `civics-${k}`;
      ch.mesh = mesh;
      this.group.add(mesh);
    }
  }

  data(id: number): CivicData | undefined {
    return this.world.civics.get(id);
  }
}
