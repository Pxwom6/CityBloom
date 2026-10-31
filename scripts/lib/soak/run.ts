import { lines, result, type SoakResult } from './report';
import { disturbances, story } from './story';
import type { SoakOptions } from './types';
import { Soak } from './world';

export { type SoakOptions } from './types';

/** What a caller may change about a run: the story, the disturbances, or the world before it begins (a test's own mischief). */
export interface SoakHooks {
  story?: (w: Soak) => Promise<void>;
  disturbances?: (w: Soak) => void;
  before?: (w: Soak) => void;
}

/** Play the soak and judge it. The relay (real mode) is closed, whatever happened. */
export async function runSoak(
  opts: SoakOptions,
  hooks: SoakHooks = {},
): Promise<{ result: SoakResult; lines: string[]; soak: Soak }> {
  const soak = new Soak(opts);
  hooks.before?.(soak);
  try {
    await soak.run(hooks.story ?? story, hooks.disturbances ?? disturbances);
  } catch (e) {
    soak.fail('crash', e instanceof Error ? (e.stack ?? e.message) : String(e));
  }
  const r = result(soak);
  const out = lines(r, soak);
  await soak.close().catch(() => undefined);
  return { result: r, lines: out, soak };
}
