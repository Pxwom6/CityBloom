import { CIVIC } from '../data/civic';
import { MODULES } from '../data/modules';
import { DENSITY_NAMES, INDUSTRY_TIER_NAMES, WEALTH_NAMES, ZONED_DEFS } from '../data/buildings';
import { CELL, ZONE_I } from '../data/zones';

/**
 * The model spec (docs/models/PROMPTS.md) as data: material roles, the part names the game gives
 * meaning to, and what a file name stands for in the game's own data.
 */

/** Material roles, in the order the converter numbers them. */
export const ROLES = [
  'wall',
  'wall_alt',
  'trim',
  'roof',
  'glass',
  'shop_glass',
  'frame',
  'door',
  'awning',
  'sign',
  'metal',
  'wood',
  'accent',
  'grass',
  'paving',
  'asphalt',
  'water',
  'hedge',
] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_INDEX = new Map<string, number>(ROLES.map((r, i) => [r, i]));

/** Roles the game repaints for each copy from its palettes. */
export const REPAINTED: readonly Role[] = ['wall', 'wall_alt', 'roof', 'awning', 'sign'];
/** Roles that lie flat on the ground of a site. */
export const GROUND_ROLES: readonly Role[] = ['grass', 'paving', 'asphalt', 'water'];

/** An add-on annex's site, in metres (PROMPTS.md, batch 6). */
export const ANNEX_SITE = { w: 9, d: 8 };

export type ModelTarget =
  | {
      kind: 'zoned';
      /** The zoned building type's id, e.g. R103. */
      def: string;
      /** 1 for `R103.glb`, 2 for `R103-2.glb`, … */
      design: number;
      /** The type's own lot, in metres. */
      w: number;
      d: number;
      label: string;
      /** Gives off smoke (heavy industry). */
      smokes: boolean;
    }
  | { kind: 'civic'; def: string; design: number; w: number; d: number; label: string; smokes: boolean }
  | { kind: 'annex'; def: string; design: number; w: number; d: number; label: string; smokes: false };

/** What a model file replaces, from its name without `.glb`; null when it names nothing in the game. */
export function targetOf(base: string): ModelTarget | null {
  const m = /^(.+?)(?:-(\d+))?$/.exec(base);
  if (!m) return null;
  const id = m[1]!;
  const design = m[2] ? Number(m[2]) : 1;
  if (design < 1) return null;
  const z = ZONED_DEFS.get(id);
  if (z) {
    const tier = z.zone === ZONE_I ? INDUSTRY_TIER_NAMES[z.wealth] : WEALTH_NAMES[z.wealth];
    return {
      kind: 'zoned',
      def: id,
      design,
      w: z.w * CELL,
      d: z.d * CELL,
      label: `${z.name} (${DENSITY_NAMES[z.density].toLowerCase()}, ${tier.toLowerCase()}, level ${z.level})`,
      smokes: z.zone === ZONE_I && z.wealth === 0,
    };
  }
  const annex = /^annex-(.+)$/.exec(id);
  if (annex) {
    const mod = MODULES.find((x) => x.id === annex[1]);
    if (!mod) return null;
    return {
      kind: 'annex',
      def: mod.id,
      design,
      w: ANNEX_SITE.w,
      d: ANNEX_SITE.d,
      label: `${mod.name} (add-on for ${mod.for.join(', ')})`,
      smokes: false,
    };
  }
  const c = CIVIC.get(id);
  if (c)
    return {
      kind: 'civic',
      def: id,
      design,
      w: c.w,
      d: c.d,
      label: c.name,
      smokes: (c.airPollution ?? 0) > 0,
    };
  return null;
}

/**
 * Triangle budgets from a batch of prompts (docs/models/PROMPTS*.md): each prompt says "Save as
 * <name>.glb" and "Budget N triangles".
 * A heading may name a file whose prompt saves another design (R103.glb's prompt makes R103-2.glb):
 * both names get that budget.
 */
export function parseBudgets(promptsMd: string): Map<string, number> {
  const out = new Map<string, number>();
  const sections = promptsMd.split(/^### /m).slice(1);
  for (const s of sections) {
    const budget = /Budget ([\d,]+) triangles/.exec(s);
    if (!budget) continue;
    const n = Number(budget[1]!.replace(/,/g, ''));
    const head = /\(`([^`]+)\.glb`\)/.exec(s.split('\n')[0] ?? '');
    const save = /Save as ([\w-]+)\.glb/.exec(s);
    if (head) out.set(head[1]!, n);
    if (save) out.set(save[1]!, n);
  }
  return out;
}

/** The budget for a model: its own prompt's, or its first design's (`R002-3` → `R002`). */
export function budgetFor(base: string, budgets: Map<string, number>): number | undefined {
  return budgets.get(base) ?? budgets.get(base.replace(/-\d+$/, ''));
}

/** Parts the game swaps or drives itself. */
export const PART = {
  treeSpot: 'tree_spot',
  smokeStack: 'smoke_stack',
  window: 'window',
  windowGlass: 'window_glass',
  windowBand: 'window_band',
  mound: 'mound',
} as const;
