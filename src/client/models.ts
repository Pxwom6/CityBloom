import { decodeModels } from '../models/codec';
import { handmade } from '../render/assets/handmade';

/**
 * Fetch the hand-made models (phase 3): one packed file, converted from assets/models at build
 * time. Without it (an old cached page, a failed or slow download) every building keeps its
 * generated look, so this never stops the game starting.
 */
export async function loadModels(deadlineMs = 6000): Promise<number> {
  // A slow connection doesn't hold the game up: past the deadline the download is dropped and
  // the city opens with generated looks (a later answer is never used: the meshes are built).
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), deadlineMs);
  try {
    const { default: url } = await import('virtual:citybloom-models');
    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (abort.signal.aborted) throw new Error('too slow');
    handmade.set(decodeModels(bytes));
  } catch (e) {
    console.warn('Hand-made models could not be loaded; buildings keep their generated look.', e);
  } finally {
    clearTimeout(timer);
  }
  return handmade.count;
}
