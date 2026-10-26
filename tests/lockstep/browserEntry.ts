/** Bundled into a blank page by the cross-browser test (e2e-xb/determinism.spec.ts). */
import { decodeSave } from '../../src/client/saves';
import { runDeterminism } from './determinism';

(globalThis as unknown as Record<string, unknown>).citybloomDeterminism = (
  months: number,
  scenario: { id: string; save: string } | null,
) => {
  const bytes = scenario ? Uint8Array.from(atob(scenario.save), (ch) => ch.charCodeAt(0)) : null;
  return runDeterminism(months, scenario && bytes ? { id: scenario.id, save: decodeSave(bytes) } : null);
};
