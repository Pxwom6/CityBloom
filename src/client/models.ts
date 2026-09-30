import { decodeModels } from '../models/codec';
import { handmade } from '../render/assets/handmade';

/**
 * Fetch the hand-made models (phase 3): one packed file, converted from assets/models at build
 * time. Without it (an old cached page, a failed download) every building keeps its generated
 * look, so this never stops the game starting.
 */
export async function loadModels(): Promise<number> {
  try {
    const { default: url } = await import('virtual:citybloom-models');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    handmade.set(decodeModels(new Uint8Array(await res.arrayBuffer())));
  } catch (e) {
    console.warn('Hand-made models could not be loaded; buildings keep their generated look.', e);
  }
  return handmade.count;
}
