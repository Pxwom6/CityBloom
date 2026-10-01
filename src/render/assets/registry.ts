import { Color } from 'three';
import { ZONED_DEFS, type ZonedDef } from '../../data/buildings';
import { CIVIC, type CivicDef } from '../../data/civic';
import { CELL, ZONE_C, ZONE_I, ZONE_R } from '../../data/zones';
import { ModelBuilder, type ModelData } from './builder';
import { PALETTES, buildZonedModel } from './models';
import { buildAnnexModel, buildCivicModel, buildRubbleModel } from './civicModels';
import { siteWorks } from './projectModels';
import { buildHandModel, clearPlace, handmade, nearestClear, type Inset } from './handmade';

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
              rank: handmade.rank(def, w * CELL, d * CELL, look),
              lit: LIT[zd.zone] ?? 0.6,
              mirror: true,
              base: lotSurface(zd),
              yard: zd.zone === ZONE_R ? 'R' : zd.zone === ZONE_C ? 'C' : 'I',
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
  // A generated building keeps its generated annexes, in the corners it leaves free.
  if (!hand) return buildCivicModel(def, variant, fill, modules.length, stage);
  const W = def.w;
  const D = def.d;
  const insets: Inset[] = [];
  const extra: ModelData[] = [];
  const taken: { x: number; z: number; w: number; d: number }[] = [];
  modules.forEach((id, k) => {
    const annex = handmade.annex(id, variant + k);
    // The clear spot nearest its back corner, just clear of the ground it is set on.
    const corner = annexPlace(W, D, k);
    const p = clearPlace(hand, corner, taken);
    if (!annex) {
      // No model for this add-on: the generator's wing, moved to the same clear spot.
      taken.push({ x: p.x, z: p.z, w: 9 * p.scale, d: 8 * p.scale });
      const gen = annexPlace(W, D, k % 2);
      extra.push(moveModel(buildAnnexModel(W, D, k), gen, p));
      return;
    }
    taken.push({ x: p.x, z: p.z, w: annex.w * p.scale, d: annex.d * p.scale });
    insets.push({
      model: annex,
      x: p.x,
      z: p.z,
      y: 0.03,
      scale: p.scale,
      seed: variant * 31 + k,
      turn: p.turn,
    });
  });
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
  siteWorks(works, W, D, stage, hand.h * reveal, (x, z, w, d) => nearestClear(hand, x, z, w, d));
  extra.push(works.build());
  return buildHandModel(hand, { ...o, reveal, bare: stage < n - 1 }, insets, extra);
}

/**
 * A generated piece moved from where it was drawn (`from`, at its scale) to another spot, scaled
 * and perhaps turned half round (an annex's clear spot on a hand-made site).
 */
function moveModel(
  m: ModelData,
  from: { x: number; z: number; scale: number },
  to: { x: number; z: number; scale: number; turn?: boolean },
): ModelData {
  const r = to.scale / from.scale;
  const t = to.turn ? -1 : 1;
  const pos = new Float32Array(m.pos.length);
  const nrm = new Float32Array(m.nrm.length);
  for (let i = 0; i < m.pos.length; i += 3) {
    pos[i] = to.x + (m.pos[i]! - from.x) * r * t;
    pos[i + 1] = m.pos[i + 1]! * r;
    pos[i + 2] = to.z + (m.pos[i + 2]! - from.z) * r * t;
    nrm[i] = m.nrm[i]! * t;
    nrm[i + 1] = m.nrm[i + 1]!;
    nrm[i + 2] = m.nrm[i + 2]! * t;
  }
  return { ...m, pos, nrm, height: m.height * r };
}

export const assets = new AssetRegistry();
