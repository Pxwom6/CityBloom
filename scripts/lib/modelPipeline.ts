// Node side of the model pipeline (phase 3): read every GLB in a folder, check it, and convert
// the good ones into the one file the game fetches. Shared by the Vite plugin (build and dev),
// `npm run models:check`, the dev tools and the tests.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bakeModel, type BakedModel } from '../../src/models/bake';
import { inspectModel, type ModelReport } from '../../src/models/check';
import type { BakedUnit } from '../../src/models/baked';
import { encodeModels } from '../../src/models/codec';
import { parseBudgets, parseSites, type WarSite } from '../../src/models/spec';
import { bakeUnit, inspectUnit, type UnitReport } from '../../src/models/unit';
import { encodeWarModels } from '../../src/models/warCodec';

export const MODELS_DIR = 'assets/models';
/** The war models (phase 5): their own file, fetched only in a city with war on. */
export const WAR_MODELS_DIR = 'assets/models/war';
export const PROMPTS_DIR = 'docs/models';
/** A batch of prompts: `PROMPTS.md` (the first), `PROMPTS-2.md`, `PROMPTS-3.md` …, and `PROMPTS-WAR.md`. */
export const PROMPTS_NAME = /^PROMPTS(?:-(\d+|WAR))?\.md$/;
/** The war prompts came after batch 5: a later numbered batch's prompt for a file wins over theirs. */
const WAR_BATCH = 5.5;

/** A prompt file's place in the order of batches. */
export function batchOf(fileName: string): number {
  const n = PROMPTS_NAME.exec(fileName)?.[1];
  return n === 'WAR' ? WAR_BATCH : Number(n ?? 1);
}

/** The prompt files, batch by batch. */
export function promptFiles(root = '.'): string[] {
  const dir = join(root, PROMPTS_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => PROMPTS_NAME.test(f))
    .sort((a, b) => batchOf(a) - batchOf(b))
    .map((f) => join(dir, f));
}

/** The war buildings' sites (PROMPTS-WAR.md), by file name; empty without the file. */
export function readWarSites(root = '.'): Map<string, WarSite> {
  const file = join(root, PROMPTS_DIR, 'PROMPTS-WAR.md');
  return existsSync(file) ? parseSites(readFileSync(file, 'utf8')) : new Map();
}

/** Triangle budgets from every batch of prompts; a later batch's prompt for a file (a remake) wins. */
export function readBudgets(root = '.'): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of promptFiles(root))
    for (const [id, n] of parseBudgets(readFileSync(p, 'utf8'))) out.set(id, n);
  return out;
}

export function modelFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.glb'))
    .sort();
}

export interface ModelBuild {
  reports: ModelReport[];
  /** The models that passed, converted. */
  models: BakedModel[];
  /** The file the game loads: every converted model. */
  bytes: Uint8Array;
}

/** Check and convert the buildings among a folder's files; `war` are the war buildings' sites. */
function convertBuildings(
  root: string,
  dir: string,
  files: string[],
  budgets: Map<string, number>,
  war?: Map<string, WarSite>,
): { reports: ModelReport[]; models: BakedModel[] } {
  const reports: ModelReport[] = [];
  const models: BakedModel[] = [];
  for (const f of files) {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(root, dir, f));
    } catch (e) {
      const { report } = inspectModel(new Uint8Array(0), f, budgets, war);
      report.errors = [`can't be read (${(e as Error).message})`];
      reports.push(report);
      continue;
    }
    const { report, file } = inspectModel(bytes, f, budgets, war);
    // The main file is loaded in every city: a war building belongs in the war models file.
    if (!war && report.war) {
      report.ok = false;
      report.errors.push(`a war building: put it in ${WAR_MODELS_DIR}, loaded only in cities with war on`);
    }
    if (report.ok && file) {
      try {
        models.push(bakeModel(file, report));
      } catch (e) {
        report.ok = false;
        report.errors.push(`couldn't be converted (${(e as Error).message})`);
      }
    }
    reports.push(report);
  }
  return { reports, models };
}

/** Check and convert every model in a folder. A model that fails, or can't be converted, is left out. */
export function buildModels(root = '.', dir = MODELS_DIR): ModelBuild {
  const { reports, models } = convertBuildings(root, dir, modelFiles(join(root, dir)), readBudgets(root));
  return { reports, models, bytes: encodeModels(models) };
}

/** Is a model file a unit (unit spec v1) rather than a building? */
export const isUnitFile = (f: string): boolean => /^unit-/i.test(f.replace(/^.*[\\/]/, ''));

export interface WarModelBuild {
  /** The war buildings' reports, and the units'. */
  reports: ModelReport[];
  unitReports: UnitReport[];
  models: BakedModel[];
  units: BakedUnit[];
  /** The war models file: the buildings and units that passed, converted. */
  bytes: Uint8Array;
}

/**
 * Check and convert the war models (phase 5, assets/models/war): the buildings on the building spec
 * with the war allowances (their sites from the game's data, or from PROMPTS-WAR.md for the ones it
 * doesn't have yet), the units on the unit spec. A model that fails is left out.
 */
export function buildWarModels(root = '.', dir = WAR_MODELS_DIR): WarModelBuild {
  const budgets = readBudgets(root);
  const files = modelFiles(join(root, dir));
  const { reports, models } = convertBuildings(
    root,
    dir,
    files.filter((f) => !isUnitFile(f)),
    budgets,
    readWarSites(root),
  );
  const unitReports: UnitReport[] = [];
  const units: BakedUnit[] = [];
  for (const f of files.filter(isUnitFile)) {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(root, dir, f));
    } catch (e) {
      const { report } = inspectUnit(new Uint8Array(0), f, budgets);
      report.errors = [`can't be read (${(e as Error).message})`];
      unitReports.push(report);
      continue;
    }
    const { report, file } = inspectUnit(bytes, f, budgets);
    if (report.ok && file) {
      try {
        units.push(bakeUnit(file, report));
      } catch (e) {
        report.ok = false;
        report.errors.push(`couldn't be converted (${(e as Error).message})`);
      }
    }
    unitReports.push(report);
  }
  return { reports, unitReports, models, units, bytes: encodeWarModels(models, units) };
}
