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

test('F5: looking round a neighbour’s city never saves it in your browser', async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.addInitScript(() =>
    localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Ada', color: 0 })),
  );
  await menu(page);
  // Adaville starts a region, keeps a save there for visitors, and is autosaved here.
  await page.goto('./?paused=1&seed=visitada&preset=river&name=Adaville');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await page.evaluate(() => window.__game!.waitFrames(2));
  await page.mouse.click(600, 300);
  await page.keyboard.press('Shift+N');
  await page.getByTestId('region-start').click();
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getRegion()))?.state, { timeout: 120_000 })
    .toBe('in');
  await page.evaluate(() => window.__game!.regionReportNow());
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getRegion()))?.cities[0]?.visitable, {
      timeout: 30_000,
    })
    .toBe(true);
  expect(await page.evaluate(() => window.__game!.autosaveNow())).toBe(true);
  const invite = (await page.evaluate(() => window.__game!.getRegion()))!.invite;

  // A visit (as a neighbour would make it), in another tab of this browser.
  const visit = await page.context().newPage();
  await visit.goto(`./?visit=${invite}&city=1`);
  await visit.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
  await expect(visit.getByTestId('visit-banner')).toBeVisible();
  expect(await visit.evaluate(() => window.__game!.autosaveNow())).toBe(false);
  await visit.getByTestId('menu-button').click();
  await expect(visit.getByTestId('pause-menu')).toBeVisible();
  for (const id of ['pause-save', 'menu-save', 'pause-export', 'pause-invite', 'pause-invite-p2p'])
    await expect(visit.getByTestId(id), id).toHaveCount(0);
  await expect(visit.getByTestId('pause-quit')).toContainText('nothing is saved');
  const before = await page.evaluate(() => window.__game!.slotSavedAt('auto'));
  await Promise.all([
    visit.waitForURL((u) => !u.searchParams.has('visit'), { timeout: 60_000 }),
    visit.getByTestId('pause-quit').click(),
  ]);
  await visit.close();
  // Adaville's autosave is the one Adaville made, untouched by the visit.
  expect(await page.evaluate(() => window.__game!.slotSavedAt('auto'))).toBe(before);
});

test("F6: a city saved over another's slot doesn't take its place in the region", async ({ page }) => {
  test.setTimeout(420_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.addInitScript(() =>
    localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Ada', color: 0 })),
  );
  await menu(page);
  // Adaville starts a region (online, through the local relay) and is autosaved.
  await page.goto('./?paused=1&seed=bindada&preset=river&name=Adaville');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await page.evaluate(() => window.__game!.waitFrames(2));
  await page.mouse.click(600, 300);
  await page.keyboard.press('Shift+N');
  await page.getByTestId('region-start').click();
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getRegion()))?.state, { timeout: 120_000 })
    .toBe('in');
  expect(await page.evaluate(() => window.__game!.autosaveNow())).toBe(true);
  // Opening Adaville's save again rejoins the region as Adaville.
  await page.goto('./?load=auto');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getRegion()))?.state, { timeout: 120_000 })
    .toBe('in');
  expect((await page.evaluate(() => window.__game!.getRegion()))!.slot).toBe(1);

  // Later, an unrelated city is autosaved into the same slot.
  await page.goto('./?paused=1&seed=bindother&preset=lakes&name=Otherby');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  expect(await page.evaluate(() => window.__game!.getRegion())).toBeNull();
  expect(await page.evaluate(() => window.__game!.autosaveNow())).toBe(true);
  expect(await page.evaluate(() => window.__game!.slotCity('auto'))).toBe('Otherby');
  // Continue opens Otherby: it stays out of Adaville's region.
  await page.goto('./?load=auto');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await page.evaluate(() => window.__game!.waitFrames(30));
  expect(await page.evaluate(() => window.__game!.getState().then((s) => s.cityName))).toBe('Otherby');
  expect(await page.evaluate(() => window.__game!.getRegion())).toBeNull();
});
