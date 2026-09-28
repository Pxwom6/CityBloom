/**
 * Scenario progress on this device (M18): the best result for each scenario won, kept in
 * localStorage beside the settings. Reads validate what they find and fall back to nothing.
 */

const KEY = 'citybloom.scenarios';

export interface ScenarioBest {
  /** Stars (1–3) and months taken for the best win. */
  stars: number;
  months: number;
}

export type ScenarioProgress = Record<string, ScenarioBest>;

export function loadProgress(): ScenarioProgress {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
    const out: ScenarioProgress = {};
    for (const [id, v] of Object.entries(raw)) {
      const r = v as Partial<ScenarioBest> | null;
      if (!r || typeof r.stars !== 'number' || typeof r.months !== 'number') continue;
      if (r.stars < 1 || r.stars > 3 || !Number.isFinite(r.months)) continue;
      out[id] = { stars: Math.round(r.stars), months: r.months };
    }
    return out;
  } catch {
    return {};
  }
}

/** Keep a win if it beats the best so far (more stars, or as many in fewer months). */
export function recordWin(id: string, stars: number, months: number): ScenarioProgress {
  const all = loadProgress();
  const best = all[id];
  if (!best || stars > best.stars || (stars === best.stars && months < best.months))
    all[id] = { stars, months: Math.round(months * 10) / 10 };
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private windows can refuse storage; the win still shows, it just isn't kept.
  }
  return all;
}
