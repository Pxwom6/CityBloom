import { test, expect, type Browser, type Page } from '@playwright/test';
import { openGame } from './helpers';
import { startNostr, trysteroTopic, type LocalNostr } from '../relay/tests/nostr';

/**
 * The live peer-to-peer path until online rooms are set up (multiplayer review, F2 and F13): a room
 * in the host's browser found through Trystero over Nostr relays, then WebRTC between the pages.
 * The relay here is a stand-in on this computer (test builds name it in VITE_TRYSTERO_RELAYS); the
 * pages prefer Trystero over the local relay's signalling (`citybloom.signal`). The room is found by
 * its code and key only: the short code alone is turned away, and never appears on the relay.
 */
test.describe.configure({ mode: 'serial' });

let nostr: LocalNostr;
test.beforeAll(async () => {
  nostr = await startNostr(7447);
});
test.afterAll(async () => {
  await nostr?.close();
});

async function newPage(browser: Browser, name: string, color: number): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 960, height: 640 } });
  await ctx.addInitScript(
    ([n, c]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      localStorage.setItem('citybloom.signal', 'trystero');
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...s, tips: false, graphicsChecked: true, quality: 'low' }));
      // Every toast as it appears: SwiftShader's first frames can outlast a toast's few seconds.
      const seen: string[] = [];
      (window as unknown as { __toasts: string[] }).__toasts = seen;
      new MutationObserver(() => {
        for (const t of document.querySelectorAll('[data-testid="toast"]'))
          if (t.textContent && !seen.includes(t.textContent)) seen.push(t.textContent);
      }).observe(document, { childList: true, subtree: true, characterData: true });
    },
    [name, color] as const,
  );
  return ctx.newPage();
}

const toasts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.join(' | '));

const net = (page: Page) => page.evaluate(() => window.__game!.getNet());

test('a friend joins a room in the host’s browser through Trystero, by the whole invite only', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const ada = await newPage(browser, 'Ada', 0);
  const sam = await newPage(browser, 'Sam', 1);
  try {
    await together(ada, sam);
  } finally {
    for (const p of [ada, sam]) await p.context().close();
  }
});

async function together(ada: Page, sam: Page): Promise<void> {
  await openGame(ada, '&seed=trystero&preset=river&name=Trystford');
  await ada.keyboard.press('Escape');
  await ada.getByTestId('pause-invite-p2p').click();
  await expect.poll(async () => (await net(ada))?.state, { timeout: 30_000 }).toBe('playing');
  const room = (await net(ada))!;
  expect(room.kind).toBe('p2p');
  expect(room.invite).toMatch(/^[A-Z][A-Z2-9]{5}(-[A-Z2-9]{4}){3}$/);
  await expect(ada.getByTestId('room-invite')).toHaveText(room.invite);
  await expect.poll(() => nostr.events.length, { timeout: 30_000 }).toBeGreaterThan(2);

  // The short code alone is turned away before anything is tried.
  await sam.goto(`./?join=${room.code}`);
  await sam.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await expect.poll(() => toasts(sam), { timeout: 30_000 }).toContain('missing its second part');
  expect(await net(sam)).toBeNull();

  // The invite link: Sam lands in Ada's city over WebRTC, found through the relay.
  await sam.goto(`./?join=${room.invite}`);
  await sam.waitForFunction(() => window.__game?.ready === true && !!window.__game.getNet(), null, {
    timeout: 120_000,
  });
  await expect.poll(async () => (await net(sam))?.state, { timeout: 60_000 }).toBe('playing');
  await expect(ada.getByTestId('room-players')).toContainText('Sam');
  const r = await sam.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    return g.dispatch({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: 60, z: s.highwayZ - 40 },
        { x: 60, z: s.highwayZ - 200 },
      ],
    });
  });
  expect(r.ok).toBe(true);

  // Paused, both games stand at the same tick with the same city.
  await ada.getByTestId('speed-0').click();
  await expect
    .poll(
      async () => {
        const [a, s] = await Promise.all([net(ada), net(sam)]);
        return a!.tick === a!.allowed && s!.tick === a!.allowed && s!.allowed === a!.allowed;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const [ha, hs] = await Promise.all([ada, sam].map((p) => p.evaluate(() => window.__game!.hash())));
  expect(hs).toBe(ha);

  // Nothing on the relay names the room by its code alone, or gives the code or key away.
  const topics = new Set(nostr.events.flatMap((e) => e.tags.filter((t) => t[0] === 'x').map((t) => t[1])));
  expect(topics.has(trysteroTopic('citybloom-rooms-v1', room.code))).toBe(false);
  const [code, ...key] = room.invite.split('-');
  expect(topics.has(trysteroTopic('citybloom-rooms-v1', `${code}-${key.join('')}`))).toBe(true);
  for (const e of nostr.events) expect(e.content).not.toContain(room.code);
}
