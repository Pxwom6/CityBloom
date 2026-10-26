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

test('F12: an invite link asks for a name, checks the graphics and says what it’s waiting for', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  // Ada shares her city in an online room.
  const actx = await browser.newContext({ viewport: { width: 960, height: 640 } });
  await actx.addInitScript(() => {
    localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Ada', color: 0 }));
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({ tips: false, graphicsChecked: true, quality: 'low' }),
    );
  });
  const ada = await actx.newPage();
  await ada.goto('./?paused=1&seed=invite&preset=river&name=Inviteby');
  await ada.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await ada.keyboard.press('Escape');
  await ada.getByTestId('pause-invite').click();
  await expect
    .poll(async () => (await ada.evaluate(() => window.__game!.getNet()))?.state, { timeout: 30_000 })
    .toBe('playing');
  const invite = (await ada.evaluate(() => window.__game!.getNet()))!.invite;

  // Sam opens the link on a fresh browser: no name yet, graphics never checked.
  const sctx = await browser.newContext({ viewport: { width: 960, height: 640 } });
  await sctx.addInitScript(() => {
    // What the boot screen says as it goes.
    const seen: string[] = [];
    (window as unknown as { __boot: string[] }).__boot = seen;
    const watch = () => {
      const b = document.getElementById('boot');
      if (!b) return void requestAnimationFrame(watch);
      new MutationObserver(() => {
        const t = b.textContent ?? '';
        if (t && seen.at(-1) !== t) seen.push(t);
      }).observe(b, { childList: true, characterData: true, subtree: true });
    };
    watch();
  });
  const sam = await sctx.newPage();
  await sam.goto(`./?join=${invite}`);
  await expect(sam.getByTestId('join-name')).toContainText(`Join room ${invite}`, { timeout: 60_000 });
  await sam.getByTestId('join-name-input').fill('Sam');
  await sam.getByTestId('join-name-go').click();
  // A room on the page once it's ready means Sam got in (a join that fails opens the menu instead).
  await sam.waitForFunction(() => window.__game?.ready === true && !!window.__game.getNet(), null, {
    timeout: 120_000,
  });
  // Ada sees Sam by the name he chose.
  await expect
    .poll(async () => (await ada.evaluate(() => window.__game!.getNet()))!.players.map((p) => p.name))
    .toContain('Sam');
  // The boot screen said what it was waiting for.
  const said = await sam.evaluate(() => (window as unknown as { __boot: string[] }).__boot);
  expect(said.join(' | ')).toMatch(/Connecting to room/);
  expect(said.join(' | ')).toMatch(/Loading the city|Building the scene/);
  // The first-launch graphics check ran here too.
  await expect
    .poll(async () => (await sam.evaluate(() => window.__game!.getShell())).settings.graphicsChecked, {
      timeout: 60_000,
    })
    .toBe(true);
  for (const c of [actx, sctx]) await c.close();
});
