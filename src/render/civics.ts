import { Group, type Vector3 } from 'three';
import type { ClientWorld } from '../client/world';
import type { CivicData } from '../sim/protocol';
import { CIVIC } from '../data/civic';
import { assets } from './assets/registry';
import type { ModelData } from './assets/builder';
import { buildingYaw } from './buildings';
import { LodChunks, type ChunkItem, type LodMaterials, type LodRange } from './lodChunks';

/** Civic buildings are merged per chunk of this many metres: drawn at every distance, near, far, skyline. */
const CHUNKS: [number, number, number, number] = [512, 128, 128, 512];

/**
 * Civic buildings (utilities, services, parks, landmarks): merged into meshes per 512 m chunk, so
 * a big city's hundreds of pumps, schools and stations cost a handful of draw calls. A chunk is
 * rebuilt only when something in it changes how it looks. Hand-made models (phase 3) are drawn at
 * three levels of detail, as zoned buildings are (LodChunks).
 */
export class CivicRenderer {
  readonly group = new Group();
  readonly heights = new Map<number, number>();
  readonly chunks: LodChunks;
  /** What each civic's model depends on; unchanged means no rebuild. */
  private looks = new Map<number, string>();

  constructor(
    private world: ClientWorld,
    materials: LodMaterials,
  ) {
    // Civic chunks rebuild as soon as they change (they change rarely, and a placed building
    // should appear at once).
    this.chunks = new LodChunks('civics', CHUNKS, materials, (id) => this.item(id), Infinity);
    this.group.add(this.chunks.group);
    for (const c of world.civics.values()) this.place(c.id);
    world.onCivics((changed, removed) => {
      for (const id of removed) this.place(id);
      for (const id of changed) this.place(id);
    });
  }

  private look(c: CivicData): string {
    // Fill by the steps the model has (a landfill's mound), so a truckload doesn't rebuild the chunk.
    return `${c.def}:${c.variant}:${Math.round((c.fill ?? 0) * 4)}:${(c.modules ?? []).join('+')}:${c.stage ?? '-'}:${c.x}:${c.y}:${c.z}:${c.angle}:${c.side}`;
  }

  /** The model a civic building is drawn with. */
  model(c: CivicData): ModelData {
    return assets.civic(c.def, c.variant, c.fill, c.modules ?? [], c.stage);
  }

  private item(id: number): ChunkItem | null {
    const c = this.world.civics.get(id);
    if (!c) return null;
    const def = CIVIC.get(c.def);
    return {
      x: c.x,
      y: c.y,
      z: c.z,
      yaw: buildingYaw(c),
      model: this.model(c),
      look: false,
      seed: c.id,
      reach: def ? Math.hypot(def.w, def.d) / 2 + 2 : 30,
    };
  }

  private place(id: number): void {
    const c = this.world.civics.get(id);
    if (!c) {
      this.heights.delete(id);
      this.looks.delete(id);
      this.chunks.set(id, null);
      return;
    }
    const look = this.look(c);
    if (this.looks.get(id) === look) return;
    this.looks.set(id, look);
    this.heights.set(id, this.model(c).height);
    this.chunks.set(id, c);
  }

  /** Once a frame: the levels of detail for where the camera is, and any rebuilds. */
  update(eye: Vector3, range: LodRange, all = false): void {
    this.chunks.update(eye, range, all);
  }

  data(id: number): CivicData | undefined {
    return this.world.civics.get(id);
  }
}
