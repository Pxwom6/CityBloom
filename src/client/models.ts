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

let war: Promise<{ models: number; units: number }> | null = null;

/**
 * Fetch the war models (phase 5): the military buildings and the units, in a file of their own
 * (assets/models/war, converted at build time) that only a city with war on asks for, once. They
 * arrive while the city is open: buildings drawn before then are drawn again (the caller's job),
 * and until then, or if the download fails, everything keeps its generated look.
 */
export function loadWarModels(): Promise<{ models: number; units: number }> {
  war ??= (async () => {
    try {
      const [{ default: url }, { decodeWarModels }] = await Promise.all([
        import('virtual:citybloom-war-models'),
        import('../models/warCodec'),
      ]);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { models, units } = decodeWarModels(new Uint8Array(await res.arrayBuffer()));
      handmade.setWar(models, units);
      return { models: models.length, units: units.length };
    } catch (e) {
      console.warn(
        'War models could not be loaded; military buildings and units keep their generated look.',
        e,
      );
      return { models: 0, units: 0 };
    }
  })();
  return war;
}

/** Has a city asked for the war models yet (tests: a peaceful city never does)? */
export function warModelsAsked(): boolean {
  return war !== null;
}
