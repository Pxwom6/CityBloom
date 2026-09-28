import { ZONED_DEFS } from '../../data/buildings';
import type { ModelData } from './builder';
import { buildZonedModel } from './models';
import { buildCivicModel, buildRubbleModel } from './civicModels';
import { CIVIC } from '../../data/civic';

/** Number of visual variants per archetype and lot size. */
export const VARIANTS = 12;

/**
 * Asset registry: every building model comes through here, keyed by archetype, lot size and
 * variant. Procedural today; a hand-made glTF model could be registered for any key later
 * (converted into the same ModelData arrays) without touching game logic.
 */
export class AssetRegistry {
  private cache = new Map<string, ModelData>();
  private overrides = new Map<string, () => ModelData>();

  key(def: string, w: number, d: number, variant: number): string {
    return `${def}|${w}x${d}|${variant % VARIANTS}`;
  }

  /** Register a replacement model source for an archetype (all sizes and variants). */
  override(def: string, make: () => ModelData): void {
    this.overrides.set(def, make);
    for (const k of [...this.cache.keys()]) if (k.startsWith(`${def}|`)) this.cache.delete(k);
  }

  zoned(def: string, w: number, d: number, variant: number): ModelData {
    const k = this.key(def, w, d, variant);
    let m = this.cache.get(k);
    if (!m) {
      const o = this.overrides.get(def);
      m = o ? o() : buildZonedModel(ZONED_DEFS.get(def)!, w, d, variant % VARIANTS);
      this.cache.set(k, m);
    }
    return m;
  }

  civic(def: string, variant: number, fill = 0, modules = 0, stage?: number): ModelData {
    const q = Math.round(fill * 4);
    const k = `civic:${def}|${variant % 4}|${q}|${modules}|${stage ?? '-'}`;
    let m = this.cache.get(k);
    if (!m) {
      const o = this.overrides.get(def);
      m = o ? o() : buildCivicModel(CIVIC.get(def)!, variant % 4, q / 4, modules, stage);
      this.cache.set(k, m);
    }
    return m;
  }

  /** Burned-out lot: a pile of charred debris. */
  rubble(w: number, d: number, variant: number): ModelData {
    const k = `rubble|${w}x${d}|${variant % 4}`;
    let m = this.cache.get(k);
    if (!m) {
      m = buildRubbleModel(w, d, variant % 4);
      this.cache.set(k, m);
    }
    return m;
  }

  get size(): number {
    return this.cache.size;
  }
}

export const assets = new AssetRegistry();
