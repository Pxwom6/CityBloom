import { test, expect, type Page } from '@playwright/test';

/**
 * The multiplayer review follow-ups that only a real page shows (docs/DECISIONS.md, "Multiplayer
 * review follow-ups"); the relay's side is in relay/tests/review.test.ts.
 */
async function menu(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((extra) => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(
      key,
      JSON.stringify({ ...s, tips: false, graphicsChecked: true, quality: 'low', ...extra }),
    );
  }, settings);
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
}

const shell = (page: Page) => page.evaluate(() => window.__game!.getShell());

test('F4: backing out of the lobby leaves the next new city your own', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await menu(page);
  await page.getByTestId('main-friends').click();
  await page.getByTestId('friends-name').fill('Ada');
  // No saved city in this browser: Host founds a new one, and the new-city screen says it's shared.
  await page.getByTestId('friends-host-p2p').click();
  await expect(page.getByTestId('new-sharing')).toContainText('shared from this browser');
  expect((await shell(page)).newCity.host).toBe('p2p');
  await page.getByTestId('shell-back').click();
  // Starting a region from the lobby, then thinking better of it.
  await page.getByTestId('friends-region-start').click();
  await expect(page.getByTestId('new-sharing')).toContainText('region');
  await page.getByTestId('shell-back').click();
  await page.getByTestId('shell-back').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();
  expect((await shell(page)).newCity).toEqual({ host: null, region: null });

  // A new city from the main menu is the player's own: not shared, not in a region.
  await page.getByTestId('main-new').click();
  await expect(page.getByTestId('new-game')).toBeVisible();
  await expect(page.getByTestId('new-sharing')).toHaveCount(0);
  const nav = page.waitForRequest(
    (r) => r.isNavigationRequest() && new URL(r.url()).searchParams.get('new') === '1',
  );
  await page.getByTestId('new-start').click();
  const q = new URL((await nav).url()).searchParams;
  for (const k of ['host', 'newregion', 'region']) expect(q.has(k), k).toBe(false);
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await page.evaluate(() => window.__game!.waitFrames(3));
  expect(await page.evaluate(() => window.__game!.getNet())).toBeNull();
  expect(await page.evaluate(() => window.__game!.getRegion())).toBeNull();
});
