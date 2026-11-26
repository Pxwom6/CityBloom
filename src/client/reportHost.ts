/**
 * The page's reporter (M41) as main.ts makes it, before the game exists: what a report says about the
 * game and machine, the names to scrub, the setting, and the report desk's address. Errors while
 * booting are reported too (`where: 'boot'`); once the game is made, `attach` gives it the rest.
 */
import { BUILD_ID } from '../config';
import { SAVE_VERSION } from '../sim/save';
import { relayUrl } from '../net/multiplayer';
import type { Game } from '../game';
import type { ReportEnv, ReportWhere } from '../../relay/reports';
import { loadSettings } from './settings';
import { loadProfile } from './profile';
import { describeBrowser, installReporter, IdbQueue, MemoryQueue, reportEndpoint, Reporter } from './reports';

/** Every name the page knows of, to scrub from messages and stacks. */
export function namesOf(game: Game | null): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push(v);
  };
  try {
    add(loadProfile().name);
  } catch {
    /* no storage */
  }
  if (!game) return out;
  const st = game.world.stats as unknown as Record<string, unknown>;
  add(st.cityName);
  const region = st.region as
    { neighbours?: { name?: unknown; player?: { mayor?: unknown; name?: unknown } }[] } | undefined;
  for (const n of region?.neighbours ?? []) {
    add(n.name);
    add(n.player?.mayor);
    add(n.player?.name);
  }
  const districts = (game.world as unknown as { districts?: Map<number, { name?: unknown }> }).districts;
  if (districts instanceof Map) for (const d of districts.values()) add(d.name);
  for (const p of game.net?.session.players ?? []) add(p.name);
  return out;
}

function whereOf(game: Game | null): ReportWhere {
  if (!game) return 'boot';
  if (game.mode === 'menu') return 'menu';
  if (game.mode === 'editor') return 'editor';
  if (game.viewing) return 'battle';
  if (game.readOnly) return 'visit';
  return 'city';
}

export function envOf(game: Game | null): ReportEnv {
  const { browser, os } = describeBrowser(typeof navigator === 'undefined' ? '' : navigator.userAgent);
  return {
    build: BUILD_ID,
    browser,
    os,
    quality: (game?.settings ?? loadSettings()).quality,
    save: SAVE_VERSION,
    shared: game?.net ? 'room' : game?.region ? 'region' : 'no',
    where: whereOf(game),
  };
}

/** The reporter for this page, installed so `reportProblem` reaches it from anywhere. */
export function pageReporter(): { reporter: Reporter; attach(game: Game): void } {
  let game: Game | null = null;
  const queue = typeof indexedDB === 'undefined' ? new MemoryQueue() : new IdbQueue();
  const reporter = new Reporter(
    {
      env: () => envOf(game),
      names: () => namesOf(game),
      enabled: () => (game?.settings ?? loadSettings()).crashReports,
      endpoint: () => reportEndpoint(relayUrl()),
    },
    queue,
  );
  installReporter(reporter);
  if (typeof window !== 'undefined') reporter.listen(window);
  return {
    reporter,
    attach: (g) => {
      game = g;
    },
  };
}
