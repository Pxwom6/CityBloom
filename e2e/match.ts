import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { newContext } from './helpers';

/**
 * Quick matches (M43) through the interface: players open the Quick match screen from the main menu,
 * the host picks the settings and hosts, the others join with the code, the host starts; each round
 * every page must end on the same result, and each page's own hash must be the one the result lists
 * for its city. Low graphics and small windows: several software-drawn pages share the VM.
 */
export const NAMES = ['Ada', 'Sam', 'Kit', 'Lou'];

export type Mode = 'race' | 'rich' | 'happy' | 'mixed';

export interface MatchView {
  active: boolean;
  phase: string | null;
  round: number;
  slot: number;
  host: boolean;
  invite: string | null;
  players: { slot: number; ready: boolean; out?: true }[];
  result: {
    round: number;
    winner: number;
    endedBy: string;
    settings: { mode: Mode };
    rows: { slot: number; hash?: string; out?: true; population: number }[];
  } | null;
  started: boolean;
  hash: string | null;
  resultsOpen: boolean;
  kept: string | null;
  said: { from: number; e?: number }[];
  tick: number;
  speed: number;
  sent: { messages: number; bytes: number } | null;
  received: { messages: number; bytes: number } | null;
}

export async function matchPlayer(
  browser: Browser,
  k: number,
  device: BrowserContextOptions = {},
): Promise<Page> {
  const ctx = await newContext(browser, { viewport: { width: 960, height: 640 }, ...device });
  await ctx.addInitScript(
    ([n, c]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(
        key,
        JSON.stringify({
          ...s,
          tips: false,
          graphicsChecked: true,
          quality: 'low',
          shadows: false,
          reportsNotice: true,
        }),
      );
    },
    [NAMES[k]!, k] as const,
  );
  const page = await ctx.newPage();
  // The match clock's lines (test builds), printed when a round's checks fail.
  const lines: string[] = [];
  logs.set(page, lines);
  page.on('console', (m) => {
    if (m.text().startsWith('[match]'))
      lines.push(`${new Date().toISOString().slice(11, 23)} ${NAMES[k]} ${m.text()}`);
  });
  return page;
}

const logs = new WeakMap<Page, string[]>();

/** Every page's match-clock lines, merged in time order. */
export function matchLogs(pages: Page[]): string {
  return pages
    .flatMap((p) => logs.get(p) ?? [])
    .sort()
    .join('\n');
}

export const getMatch = (p: Page) => p.evaluate(() => window.__game!.getMatch() as unknown as MatchView);

/** Poll a page's match until `ok` (a page reloading for a rematch answers nothing for a moment). */
export async function until(
  p: Page,
  ok: (m: MatchView) => boolean,
  what: string,
  ms = 180_000,
): Promise<MatchView> {
  const end = Date.now() + ms;
  let last: MatchView | null = null;
  for (;;) {
    last = await p
      .evaluate(() => (window.__game?.ready ? (window.__game.getMatch() as unknown as MatchView) : null))
      .catch(() => null);
    if (last && ok(last)) return last;
    if (Date.now() > end)
      throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(last)?.slice(0, 500)}`);
    await p.waitForTimeout(500).catch(() => undefined);
  }
}

/** The main menu's Quick match screen. */
export async function quickMatchScreen(p: Page, tap = false): Promise<void> {
  await p.goto('./');
  await p.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
  const press = (id: string) => (tap ? p.getByTestId(id).tap() : p.getByTestId(id).click());
  await press('main-match');
  await expect(p.getByTestId('match-screen')).toBeVisible();
}

/** The host picks the settings on the Quick match screen and hosts; resolves with the invite. */
export async function hostMatch(
  p: Page,
  o: { kind: 'online' | 'p2p'; mode: Mode; target?: number; chat?: boolean },
  tap = false,
): Promise<string> {
  await quickMatchScreen(p, tap);
  const press = (id: string) => (tap ? p.getByTestId(id).tap() : p.getByTestId(id).click());
  await press(`match-mode-${o.mode}`);
  if (o.mode === 'race' && o.target) await press(`match-target-${o.target}`);
  await press('match-minutes-1');
  if (o.chat) await press('match-chat');
  await press(`match-host-${o.kind}`);
  await p.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
  const m = await until(p, (x) => !!x.invite && x.phase === 'lobby', 'the match to open');
  await expect(p.getByTestId('match-lobby')).toBeVisible();
  await expect(p.getByTestId('match-invite')).toHaveText(m.invite!);
  return m.invite!;
}

/** A player joins with the code typed on the Quick match screen. */
export async function joinMatch(p: Page, invite: string, tap = false): Promise<void> {
  await quickMatchScreen(p, tap);
  await p.getByTestId('match-code').fill(invite);
  await (tap ? p.getByTestId('match-join').tap() : p.getByTestId('match-join').click());
  await p.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
  await until(p, (x) => x.phase === 'lobby' && x.slot > 0, 'the guest to be in the lobby');
}

/** A small town by the game's own commands (refused before the start and after the end). */
export function build(p: Page): Promise<boolean[]> {
  return p.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    const r: boolean[] = [];
    const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => r.push((await g.dispatch(cmd)).ok);
    await ok({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 400, z: c.z }] });
    for (const x of [c.x + 133, c.x + 266])
      await ok({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x, z: c.z - 160 },
          { x, z: c.z + 160 },
        ],
      });
    const brush = (zone: 'R' | 'C', z: number, radius: number) =>
      ok({
        type: 'zone',
        zone,
        area: {
          kind: 'brush',
          points: [
            { x: c.x + 20, z },
            { x: c.x + 400, z },
          ],
          radius,
        },
      });
    await brush('R', c.z - 100, 70);
    await brush('C', c.z + 20, 22);
    const near = { x: 300, z: s.highwayZ + 170 };
    for (const def of ['coal', 'pump']) r.push((await g.placeCivic(def, near)) !== null);
    return r;
  });
}

/**
 * Play the round the pages are in: wait for the clock (the host presses Start in round 1; a rematch
 * starts by itself), build, react, and wait for the result. Checks every page has the same result and
 * its own hash in it; returns it with each page's traffic.
 */
export async function playRound(
  pages: Page[],
  round: number,
  o: { start?: boolean; tap?: boolean; during?: () => Promise<void>; leavers?: Page[] } = {},
): Promise<{ result: NonNullable<MatchView['result']>; views: MatchView[] }> {
  const [host, guest] = pages as [Page, Page];
  for (const p of pages) await until(p, (m) => m.round === round && m.phase !== null, `round ${round}`);
  if (o.start) {
    await until(
      host,
      (m) => m.players.length === pages.length && m.players.every((x) => x.ready),
      'everyone ready',
    );
    // Nothing can be built before the start.
    expect((await build(guest)).some(Boolean)).toBe(false);
    await (o.tap ? host.getByTestId('match-start').tap() : host.getByTestId('match-start').click());
  }
  for (const p of pages) await until(p, (m) => m.started, 'the clock to start', 60_000);
  await expect(host.getByTestId('match-bar')).toBeVisible();
  // The speed is the match's, and the buttons can't change it.
  expect((await getMatch(host)).speed).toBe(3);
  await expect(host.getByTestId('speed-0')).toBeDisabled();
  const built = await Promise.all(pages.map((p) => build(p)));
  for (const b of built) expect(b.every(Boolean)).toBe(true);
  // A quick reaction from the second player reaches the host.
  const press = (p: Page, id: string) => (o.tap ? p.getByTestId(id).tap() : p.getByTestId(id).click());
  await press(guest, 'match-emote-btn');
  await press(guest, 'match-emote-1');
  const guestSlot = (await getMatch(guest)).slot;
  await until(host, (m) => m.said.some((x) => x.from === guestSlot && x.e === 1), 'the emote');
  await o.during?.();
  const staying = pages.filter((p) => !o.leavers?.includes(p));
  for (const p of staying)
    await until(p, (m) => m.phase === 'over' && m.resultsOpen, `round ${round}'s result`, 180_000);
  await expect(staying[0]!.getByTestId('match-results')).toBeVisible();
  const views = await Promise.all(staying.map((p) => getMatch(p)));
  const result = views[0]!.result!;
  const missing = views.filter((v) => result.rows.find((r) => r.slot === v.slot)?.hash !== v.hash);
  if (missing.length)
    console.log(
      `[m43] round ${round}: slots ${missing.map((v) => v.slot).join(', ')} not as listed\n${matchLogs(pages)}\n${JSON.stringify(result.rows)}`,
    );
  expect(result.round).toBe(round);
  for (const v of views) {
    expect(JSON.stringify(v.result)).toBe(JSON.stringify(result));
    // Each city stopped at the timer's last tick (a one-minute match: 1,440) or where a Race ended.
    if (result.endedBy === 'time') expect(v.tick).toBe(1440);
    const mine = result.rows.find((r) => r.slot === v.slot)!;
    expect(mine.hash).toBe(v.hash);
    expect(v.hash).toMatch(/^[0-9a-f]{8,}$/);
  }
  expect(result.rows.find((r) => r.slot === result.winner)?.out).toBeUndefined();
  return { result, views };
}

/** The host asks for a rematch in another mode from the results; every page reloads into round + 1. */
export async function rematch(host: Page, mode: Mode, tap = false): Promise<void> {
  await host.getByTestId('match-rematch-mode').selectOption(mode);
  await (tap ? host.getByTestId('match-rematch').tap() : host.getByTestId('match-rematch').click());
}
