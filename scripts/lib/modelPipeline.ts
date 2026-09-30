// Node side of the model pipeline (phase 3): read every GLB in a folder, check it, and convert
// the good ones into the one file the game fetches. Shared by the Vite plugin (build and dev),
// `npm run models:check`, the dev tools and the tests.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { bakeModel, type BakedModel } from '../../src/models/bake';
import { inspectModel, type ModelReport } from '../../src/models/check';
import { encodeModels } from '../../src/models/codec';
import { parseBudgets } from '../../src/models/spec';

export const MODELS_DIR = 'assets/models';
export const PROMPTS_FILE = 'docs/models/PROMPTS.md';

export function readBudgets(root = '.'): Map<string, number> {
  const p = join(root, PROMPTS_FILE);
  return existsSync(p) ? parseBudgets(readFileSync(p, 'utf8')) : new Map();
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

/** Check and convert every model in a folder. A model that fails, or can't be converted, is left out. */
export function buildModels(root = '.', dir = MODELS_DIR): ModelBuild {
  const budgets = readBudgets(root);
  const reports: ModelReport[] = [];
  const models: BakedModel[] = [];
  for (const f of modelFiles(join(root, dir))) {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(join(root, dir, f));
    } catch (e) {
      const { report } = inspectModel(new Uint8Array(0), f, budgets);
      report.errors = [`can't be read (${(e as Error).message})`];
      reports.push(report);
      continue;
    }
    const { report, file } = inspectModel(bytes, f, budgets);
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
  return { reports, models, bytes: encodeModels(models) };
}
