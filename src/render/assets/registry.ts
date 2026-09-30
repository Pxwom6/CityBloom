import { Color } from 'three';
import { ZONED_DEFS, type ZonedDef } from '../../data/buildings';
import { CIVIC, type CivicDef } from '../../data/civic';
import { CELL, ZONE_C, ZONE_I, ZONE_R } from '../../data/zones';
import { ModelBuilder, type ModelData } from './builder';
import { PALETTES, buildZonedModel } from './models';
import { buildAnnexModel, buildCivicModel, buildRubbleModel } from './civicModels';
import { siteWorks } from './projectModels';
import { buildHandModel, clearPlace, handmade, type Inset } from './handmade';

/** Number of visual variants per archetype and lot size. */
export const VARIANTS = 12;

/** The chance a hand-made building's window is lit at night, as the generator's. */
const LIT = { [ZONE_R]: 0.58, [ZONE_C]: 0.75, [ZONE_I]: 0.5 } as Record<number, number>;
const CIVIC_LIT = 0.6;

/** The lot surface under a zoned building: what shows where a hand-made model leaves a yard. */
function lotSurface(def: ZonedDef): Color {
  if (def.zone === ZONE_R)
    return def.density === 0
      ? def.wealth === 2
        ? PALETTES.grassRich
        : PALETTES.grass
      : def.wealth >= 1
        ? PALETTES.grassRich
        : PALETTES.pave;
  if (def.zone === ZONE_I) return def.wealth === 2 ? PALETTES.grassRich : PALETTES.concrete;
  return PALETTES.pave;
}

/**
 * Asset registry: every building model comes through here, keyed by archetype, lot size and
 * variant. A hand-made model (assets/models, converted at build time, phase 3) stands in wherever
 * one fits the lot; everything else is generated.
 */
export class AssetRegistry {
  private cache = new Map<string, ModelData>();
  private overrides = new Map<string, () => ModelData>();
  private handVersion = handmade.version;

  key(def: string, w: number, d: number, variant: number): string {
    return `${def}|${w}x${d}|${variant % VARIANTS}`;
  }

  /** Register a replacement model source for an archetype (all sizes and variants). */
  override(def: string, make: () => ModelData): void {
    this.overrides.set(def, make);
    for (const k of [...this.cache.keys()])
      if (k.startsWith(`${def}|`) || k.startsWith(`civic:${def}|`)) this.cache.delete(k);
  }

  /** Models built before the hand-made ones arrived (or changed) are stale. */
  private fresh(): void {
    if (this.handVersion === handmade.version) return;
    this.handVersion = handmade.version;
    this.cache.clear();
  }

  zoned(def: string, w: number, d: number, variant: number): ModelData {
    this.fresh();
    const k = this.key(def, w, d, variant);
    let m = this.cache.get(k);
    if (!m) {
      const o = this.overrides.get(def);
      const zd = ZONED_DEFS.get(def)!;
      const look = variant % VARIANTS;
      const hand = o ? null : handmade.zoned(def, w * CELL, d * CELL, look);
      m = o
        ? o()
        : hand
          ? buildHandModel(hand, {
              W: w * CELL,
              D: d * CELL,
              seed: look,
              lit: LIT[zd.zone] ?? 0.6,
              mirror: true,
              base: lotSurface(zd),
            })
          : buildZonedModel(zd, w, d, look);
      this.cache.set(k, m);
    }
    return m;
  }

  /**
   * A civic building's model: `modules` are its add-ons (each an annex in a back corner), `fill`
   * how full a landfill is, `stage` the stage a big project is at while it's built.
   */
  civic(def: string, variant: number, fill = 0, modules: readonly string[] = [], stage?: number): ModelData {
    this.fresh();
    const q = Math.round(fill * 4);
    const k = `civic:${def}|${variant % 4}|${q}|${modules.join('+')}|${stage ?? '-'}`;
    let m = this.cache.get(k);
    if (!m) {
      const o = this.overrides.get(def);
      m = o ? o() : civicModel(CIVIC.get(def)!, variant % 4, q / 4, modules, stage);
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

/** Where add-on annex `k` stands on a W×D site (a back corner), and how much of its 9×8 m it gets. */
export function annexPlace(W: number, D: number, k: number): { x: number; z: number; scale: number } {
  const w = Math.min(9, W / 3);
  const d = Math.min(8, D / 3);
  const step = (w + 0.6) * Math.floor(k / 2);
  const x0 = k % 2 === 0 ? W / 2 - 1 - w - step : -W / 2 + 1 + step;
  return { x: x0 + w / 2, z: D / 2 - 1 - d / 2, scale: Math.min(w / 9, d / 8) };
}

function civicModel(
  def: CivicDef,
  variant: number,
  fill: number,
  modules: readonly string[],
  stage: number | undefined,
): ModelData {
  const hand = handmade.civic(def.id, variant);
  const annexes = modules.map((id, k) => ({ k, model: handmade.annex(id, variant + k) }));
  // All generated, as before phase 3.
  if (!hand && annexes.every((a) => !a.model))
    return buildCivicModel(def, variant, fill, modules.length, stage);
  const W = def.w;
  const D = def.d;
  const insets: Inset[] = [];
  const extra: ModelData[] = [];
  const taken: { x: number; z: number; w: number; d: number }[] = [];
  for (const a of annexes) {
    if (!a.model) extra.push(buildAnnexModel(W, D, a.k));
    else {
      // In its back corner, or on a hand-made site the clear spot nearest it; just clear of the
      // ground it is set on.
      const corner = annexPlace(W, D, a.k);
      const p = hand ? clearPlace(hand, corner, taken) : corner;
      taken.push({ x: p.x, z: p.z, w: a.model.w * p.scale, d: a.model.d * p.scale });
      insets.push({ model: a.model, x: p.x, z: p.z, y: 0.03, scale: p.scale, seed: variant * 31 + a.k });
    }
  }
  if (!hand) {
    // A generated building with hand-made annexes: each annex is built on its own and set in.
    const wings = insets.map((at) => ({
      at,
      m: buildHandModel(at.model, {
        W: at.model.w,
        D: at.model.d,
        seed: at.seed,
        lit: CIVIC_LIT,
        mirror: false,
        base: null,
      }),
    }));
    return merge(buildCivicModel(def, variant, fill, 0, stage), wings, extra);
  }
  const o = {
    W,
    D,
    seed: variant,
    lit: CIVIC_LIT,
    mirror: false,
    base: PALETTES.pave,
    fill: def.garbage?.storage ? fill : undefined,
    // A civic building's signs and awnings say what it is: they keep their colours.
    own: ['sign', 'awning'] as const,
  };
  if (stage === undefined || !def.project) return buildHandModel(hand, o, insets, extra);
  // A big project being built: the finished model raised stage by stage, inside the generator's
  // hoarding and under its cranes.
  const n = def.project.stages.length;
  const reveal = (stage + 0.3) / n;
  const works = new ModelBuilder();
  siteWorks(works, W, D, stage, hand.h * reveal);
  extra.push(works.build());
  return buildHandModel(hand, { ...o, reveal, bare: stage < n - 1 }, insets, extra);
}

/** A generated main building with hand-made annexes set into its back corners. */
function merge(main: ModelData, wings: { m: ModelData; at: Inset }[], extra: ModelData[]): ModelData {
  const parts: { m: ModelData; at: Inset | null }[] = [
    { m: main, at: null },
    ...wings,
    ...extra.map((m) => ({ m, at: null })),
  ];
  let n = 0;
  for (const p of parts) n += p.m.emi.length;
  const out: ModelData = {
    pos: new Float32Array(n * 3),
    nrm: new Float32Array(n * 3),
    col: new Float32Array(n * 3),
    emi: new Float32Array(n),
    height: main.height,
    win: new Uint16Array(n),
  };
  const chances: number[] = [];
  let o = 0;
  for (const p of parts) {
    const s = p.at?.scale ?? 1;
    const count = p.m.emi.length;
    for (let i = 0; i < count; i++) {
      out.pos[(o + i) * 3] = p.m.pos[i * 3]! * s + (p.at?.x ?? 0);
      out.pos[(o + i) * 3 + 1] = p.m.pos[i * 3 + 1]! * s + (p.at?.y ?? 0);
      out.pos[(o + i) * 3 + 2] = p.m.pos[i * 3 + 2]! * s + (p.at?.z ?? 0);
      out.emi[o + i] = p.m.emi[i]!;
      const w = p.m.win?.[i] ?? 0;
      out.win![o + i] = w ? w + chances.length : 0;
    }
    out.nrm.set(p.m.nrm, o * 3);
    out.col.set(p.m.col, o * 3);
    if (p.m.winChance) chances.push(...p.m.winChance);
    o += count;
  }
  out.winChance = Float32Array.from(chances);
  return out;
}

export const assets = new AssetRegistry();
