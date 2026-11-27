/**
 * The page's side of checking a player's model (M46): each file is checked in a worker of its own,
 * closed afterwards; one that takes too long (a file built to hang a reader) is stopped and refused.
 */
import { CUSTOM, type CustomCheck, type CustomTarget } from '../models/customCheck';
import type { ModelCheckJob, ModelCheckReply } from './modelCheckWorker';

/** How long a check may take before the file is refused. */
export const CHECK_MS = 20_000;

export interface CheckedModel {
  result: CustomCheck;
  /** Where the problems are, as a picture (a failed model only). */
  picture: Blob | null;
}

export function checkModelFile(bytes: Uint8Array, target: CustomTarget): Promise<CheckedModel> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./modelCheckWorker.ts', import.meta.url), { type: 'module' });
    const refuse = (words: string): CheckedModel => ({
      result: {
        ok: false,
        problems: [{ words, parts: [] }],
        report: null,
        baked: null,
        site: { w: 0, d: 0 },
        box: null,
      },
      picture: null,
    });
    const timer = setTimeout(() => {
      w.terminate();
      resolve(refuse('It took too long to read: it may be broken. Export it again as a GLB'));
    }, CHECK_MS);
    w.onmessage = (e: MessageEvent<ModelCheckReply>) => {
      clearTimeout(timer);
      w.terminate();
      resolve({ result: e.data.result, picture: e.data.picture });
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      resolve(refuse(`It couldn’t be read (${e.message || 'the check stopped'})`));
    };
    // A copy goes (the page keeps its own bytes to store).
    const copy = bytes.slice(0, Math.min(bytes.length, CUSTOM.maxParse + 1));
    w.postMessage({ id: 1, bytes: copy.buffer, target } satisfies ModelCheckJob, [copy.buffer]);
  });
}

/** A model's hash: the first 16 hex digits of its SHA-256 (its name everywhere: saves, rooms). */
export async function modelHash(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
  return [...d.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
