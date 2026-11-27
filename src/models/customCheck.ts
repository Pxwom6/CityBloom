/**
 * Checking a player's own model (M46): the same check `npm run models:check` runs (`inspectModel`,
 * spec v6), against the site and triangle budget of what the model is for, plus what a file from a
 * player needs on top: at most 1 MB, and nothing inside it that points outside the file. A model
 * that passes is baked as the build bakes the game's own. Pure, so it runs in a worker and in Node.
 */
import { CIVIC, CIVIC_DEFS, takesLook } from '../data/civic';
import type { BakedModel } from './baked';
import { bakeModel } from './bake';
import { CIVIC_BUDGETS } from './budgets';
import { boxOf, inspectModel, type Box3, type ModelReport } from './check';
import { parseGlb, type GlbFile, type GlbPart } from './glb';

export const CUSTOM = {
  /** The biggest file the game takes. */
  maxBytes: 1_048_576,
  /** A file this big isn't even opened (its size is the only problem worth saying). */
  maxParse: 8 * 1_048_576,
  /** Landmarks' triangle budgets, 1×1 to 4×4 cells. */
  landmarkBudgets: [800, 1_500, 2_500, 3_500],
  /** A model's name, at most. */
  nameChars: 40,
} as const;

export type LandmarkSize = 1 | 2 | 3 | 4;
export type CustomTarget = { kind: 'look'; def: string } | { kind: 'landmark'; size: LandmarkSize };

/** The id a model is checked as: the civic building's own, or the landmark's. */
export const targetId = (t: CustomTarget) => (t.kind === 'look' ? t.def : `landmark${t.size}`);

/** What a target is, in words. */
export function targetLabel(t: CustomTarget): string {
  if (t.kind === 'landmark')
    return `a landmark of ${t.size}×${t.size} cells (${t.size * 8} × ${t.size * 8} m)`;
  const d = CIVIC.get(t.def);
  return d ? `a new look for the ${d.name.toLowerCase()}` : 'a new look';
}

/** Civic buildings a player's model can stand in for: placed ones, not big projects or landmarks. */
export function canHaveLook(def: string): boolean {
  return takesLook(def) && CIVIC.get(def)?.category !== 'custom';
}

/** A target's triangle budget: its prompt's, else one by the site's size. */
export function budgetOf(t: CustomTarget): number {
  if (t.kind === 'landmark') return CUSTOM.landmarkBudgets[t.size - 1]!;
  const known = CIVIC_BUDGETS[t.def];
  if (known) return known;
  const d = CIVIC.get(t.def);
  return d ? Math.round(Math.min(8_000, Math.max(800, d.w * d.d * 3.5))) : 800;
}

/** A problem, in words, with the parts it names (drawn red in the picture). */
export interface CustomProblem {
  words: string;
  parts: string[];
}

export interface CustomCheck {
  ok: boolean;
  problems: CustomProblem[];
  /** The checker's own report (warnings too), when the file could be read. */
  report: ModelReport | null;
  baked: BakedModel | null;
  /** The site it was checked on (m), and the model's extent. */
  site: { w: number; d: number };
  box: Box3 | null;
}

const MB = (n: number) => `${(n / 1_048_576).toFixed(n < 10 * 1_048_576 ? 1 : 0)} MB`;

/**
 * What inside a GLB points outside it: buffers or images with a `uri` (a link or another file), as
 * words; null if nothing. A file that isn't a GLB says nothing here (the check says what's wrong).
 */
export function externalLinks(bytes: Uint8Array): string | null {
  if (bytes.length < 20) return null;
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.getUint32(0, true) !== 0x46546c67) return null;
  const len = v.getUint32(12, true);
  if (v.getUint32(16, true) !== 0x4e4f534a || 20 + len > bytes.length) return null;
  let json: { buffers?: { uri?: unknown }[]; images?: { uri?: unknown }[] };
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len))) as typeof json;
  } catch {
    return null;
  }
  const uris = [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((x) => x.uri)
    .filter((u): u is string => typeof u === 'string');
  if (!uris.length) return null;
  const shown = uris
    .slice(0, 2)
    .map((u) => (u.startsWith('data:') ? 'data embedded as text' : `"${u.slice(0, 40)}"`));
  return `It points to files outside itself (${shown.join(', ')}${uris.length > 2 ? '…' : ''}): export it as one GLB with everything inside`;
}

/** The parts a problem names ("…" in the checker's words). */
function namedParts(words: string, parts: GlbPart[]): string[] {
  const names = new Set(parts.map((p) => p.rawName).filter(Boolean));
  const out: string[] = [];
  for (const m of words.matchAll(/"([^"]+)"/g)) if (names.has(m[1]!)) out.push(m[1]!);
  for (const m of words.matchAll(/\bon ([\w.-]+)\)/g)) if (names.has(m[1]!)) out.push(m[1]!);
  return [...new Set(out)];
}

/** The checker's words as a sentence about the model. */
function sentence(s: string): string {
  if (/^\d/.test(s) || /^materials\b/.test(s)) return `It has ${s}`;
  if (/^(has|needs|goes|floats|is|can't|can’t|faces|stands|holds)\b/.test(s)) return `It ${s}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Check a player's model for a target; the parsed file comes back for the picture. */
export function checkCustom(
  bytes: Uint8Array,
  target: CustomTarget,
): { result: CustomCheck; file: GlbFile | null } {
  const id = targetId(target);
  const def = CIVIC.get(id);
  const site = { w: def?.w ?? 8, d: def?.d ?? 8 };
  const problems: CustomProblem[] = [];
  const result = (file: GlbFile | null, report: ModelReport | null, baked: BakedModel | null) => ({
    result: {
      ok: problems.length === 0 && !!baked,
      problems,
      report,
      baked,
      site,
      box: file?.parts.length ? boxOf(file.parts) : null,
    },
    file,
  });
  if (target.kind === 'look' && !canHaveLook(target.def))
    problems.push({ words: 'That building can’t take a model of your own', parts: [] });
  if (bytes.length > CUSTOM.maxBytes)
    problems.push({
      words: `It is ${MB(bytes.length)}: the game takes models up to 1 MB (fewer triangles, or no hidden parts, make it smaller)`,
      parts: [],
    });
  if (bytes.length > CUSTOM.maxParse) return result(null, null, null);
  const links = externalLinks(bytes);
  if (links) problems.push({ words: links, parts: [] });
  const { report, file } = inspectModel(bytes, `${id}.glb`, new Map([[id, budgetOf(target)]]));
  for (const e of report.errors) {
    // The link problem above says it in plainer words.
    if (links && /outside the GLB/i.test(e)) continue;
    problems.push({ words: sentence(e), parts: file ? namedParts(e, file.parts) : [] });
  }
  let baked: BakedModel | null = null;
  if (!problems.length && file)
    try {
      baked = bakeModel(file, report);
    } catch (e) {
      problems.push({ words: `It couldn’t be made ready for the game (${(e as Error).message})`, parts: [] });
    }
  return result(file, report, baked);
}

/** A model's size (m): how wide (x), deep (z) and tall it is. */
export interface ModelSize {
  w: number;
  d: number;
  h: number;
}

/**
 * A quick look at a file before it's checked: its size, to suggest what it could be; or why it
 * can't be read at all.
 */
export function probeCustom(bytes: Uint8Array): ModelSize | { why: string } {
  if (bytes.length > CUSTOM.maxParse)
    return { why: `It is ${MB(bytes.length)}: the game takes models up to 1 MB` };
  const links = externalLinks(bytes);
  if (links) return { why: links };
  try {
    const file = parseGlb(bytes);
    if (!file.parts.length) return { why: 'There’s nothing in it to draw' };
    const b = boxOf(file.parts);
    const r = (n: number) => Math.round(n * 100) / 100;
    return { w: r(b.max[0] - b.min[0]), d: r(b.max[2] - b.min[2]), h: r(b.max[1] - b.min[1]) };
  } catch (e) {
    return { why: `It isn’t a GLB the game can read (${(e as Error).message})` };
  }
}

/** Within the checker's tolerance (a model fills its site exactly). */
const fits = (a: number, b: number) => Math.abs(a - b) <= 0.05;

/**
 * What a model of this size could be, best first: the landmark it fills (or, if none, the nearest
 * size, for the check to explain), then the civic buildings whose site it fills (at most `most`).
 */
export function suggestTargets(size: { w: number; d: number }, most = 8): CustomTarget[] {
  const out: CustomTarget[] = [];
  const square = ([1, 2, 3, 4] as const).find((n) => fits(size.w, n * 8) && fits(size.d, n * 8));
  const looks = CIVIC_DEFS.filter((d) => canHaveLook(d.id) && fits(d.w, size.w) && fits(d.d, size.d))
    .slice(0, most)
    .map((d): CustomTarget => ({ kind: 'look', def: d.id }));
  if (square) out.push({ kind: 'landmark', size: square });
  out.push(...looks);
  if (!square && !looks.length) {
    const n = Math.min(4, Math.max(1, Math.round(Math.max(size.w, size.d) / 8))) as LandmarkSize;
    out.push({ kind: 'landmark', size: n });
  }
  return out;
}
