/**
 * The page's side of checking a player's model (M46): each file is checked in a worker of its own,
 * closed afterwards; one that takes too long (a file built to hang a reader) is stopped and refused.
 */
import { CUSTOM, type CustomCheck, type CustomTarget, type ModelSize } from '../models/customCheck';
import type { ModelCheckJob, ModelCheckReply } from './modelCheckWorker';

/** How long a check may take before the file is refused. */
export const CHECK_MS = 20_000;

export interface CheckedModel {
  result: CustomCheck;
  /** Where the problems are, as a picture (a failed model only). */
  picture: Blob | null;
}

/** Run one job in a worker of its own: its reply, or null if it failed or took too long. */
function inWorker(
  job: ModelCheckJob,
  transfer: ArrayBuffer[],
): Promise<ModelCheckReply | { failed: string }> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./modelCheckWorker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ failed: 'It took too long to read: it may be broken. Export it again as a GLB' });
    }, CHECK_MS);
    w.onmessage = (e: MessageEvent<ModelCheckReply>) => {
      clearTimeout(timer);
      w.terminate();
      resolve(e.data);
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      resolve({ failed: `It couldn’t be read (${e.message || 'the check stopped'})` });
    };
    w.postMessage(job, transfer);
  });
}

/** A copy of the bytes to send (the page keeps its own to store); past what's ever opened, cut. */
const sendable = (bytes: Uint8Array) => bytes.slice(0, Math.min(bytes.length, CUSTOM.maxParse + 1));

/** Measure a model (in a worker): its size, or why it can't be read. */
export async function probeModelFile(bytes: Uint8Array): Promise<ModelSize | { why: string }> {
  if (bytes.length > CUSTOM.maxParse)
    return { why: `It is ${(bytes.length / 1_048_576).toFixed(0)} MB: the game takes models up to 1 MB` };
  const copy = sendable(bytes);
  const r = await inWorker({ id: 1, bytes: copy.buffer, probe: true }, [copy.buffer]);
  if ('failed' in r) return { why: r.failed };
  return 'probe' in r ? r.probe : { why: 'It couldn’t be read' };
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
      const r = e.data;
      resolve('result' in r ? { result: r.result, picture: r.picture } : refuse('It couldn’t be read'));
    };
    w.onerror = (e) => {
      clearTimeout(timer);
      w.terminate();
      resolve(refuse(`It couldn’t be read (${e.message || 'the check stopped'})`));
    };
    // A copy goes (the page keeps its own bytes to store).
    const copy = sendable(bytes);
    w.postMessage({ id: 1, bytes: copy.buffer, target } satisfies ModelCheckJob, [copy.buffer]);
  });
}

/** A model's hash: the first 16 hex digits of its SHA-256 (its name everywhere: saves, rooms). */
export async function modelHash(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer));
  return [...d.subarray(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
