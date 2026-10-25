import { test, expect, type Browser, type Page } from '@playwright/test';
import { shot } from './helpers';

/**
 * M30, the lobby: from the main menu, Play with friends → a name and colour → Host online founds a
 * new city in an online room (through the local relay); a friend's menu → Join with the code lands
 * in it. A bad code is caught before it's tried.
 */
async function menuPage(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  await ctx.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, tips: false, graphicsChecked: true, quality: 'low' }));
  });
  const page = await ctx.newPage();
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  return page;
}

test('play with friends from the main menu: host online, join with the code', async ({ browser }) => {
  test.setTimeout(300_000);
  const ada = await menuPage(browser);
  await ada.getByTestId('main-friends').click();
  await expect(ada.getByTestId('friends-screen')).toBeVisible();
  await ada.getByTestId('friends-name').fill('Ada');
  await ada.getByTestId('friends-color-3').click();
  await shot(ada, 'm30-lobby');
  await ada.getByTestId('friends-host-online').click();
  // No saved cities in this browser: a new one, founded straight into a room.
  await expect(ada.getByTestId('new-start')).toBeVisible();
  await ada.getByTestId('new-start').click();
  await ada.waitForFunction(() => window.__game?.ready === true && !!window.__game.getNet(), null, {
    timeout: 90_000,
  });
  await expect
    .poll(async () => (await ada.evaluate(() => window.__game!.getNet()))?.state, { timeout: 30_000 })
    .toBe('playing');
  const code = (await ada.evaluate(() => window.__game!.getNet()))!.code;
  await expect(ada.getByTestId('room-chip')).toContainText(code);
  const me = (await ada.evaluate(() => window.__game!.getNet()))!.players[0]!;
  expect(me.name).toBe('Ada');

  const sam = await menuPage(browser);
  await sam.getByTestId('main-friends').click();
  await sam.getByTestId('friends-name').fill('Sam');
  // A code that can't be one is caught here.
  await sam.getByTestId('friends-code').fill('HELLO');
  await sam.getByTestId('friends-join').click();
  await expect(sam.getByRole('alert')).toContainText('six letters and numbers');
  await sam.getByTestId('friends-code').fill(code.toLowerCase());
  await sam.getByTestId('friends-join').click();
  await sam.waitForFunction(() => window.__game?.ready === true && !!window.__game.getNet(), null, {
    timeout: 90_000,
  });
  await expect
    .poll(async () => (await sam.evaluate(() => window.__game!.getNet()))?.state, { timeout: 60_000 })
    .toBe('playing');
  await expect(ada.getByTestId('room-chip')).toContainText(code);
  await ada.getByTestId('room-chip').click();
  await expect(ada.getByTestId('room-players')).toContainText('Sam');
  await shot(ada, 'm30-lobby-room');
  for (const p of [ada, sam]) await p.context().close();
});
