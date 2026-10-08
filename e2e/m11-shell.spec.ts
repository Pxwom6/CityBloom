import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, serveTownViaApi, shot, skipGraphicsCheck, watchErrors } from './helpers';

/** Wait for the game on a freshly loaded page to be up, in the given mode. */
async function booted(page: Page, mode: 'menu' | 'play') {
  await page.waitForFunction(
    (m) => window.__game?.ready === true && window.__game.getShell().mode === m,
    mode,
    {
      timeout: 90_000,
    },
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
}

const shell = (page: Page) => page.evaluate(() => window.__game!.getShell());

test('M11: main menu → new city → save → quit → reload → continue; settings persist; export and import', async ({
  page,
}) => {
  test.setTimeout(480_000);
  const errs = watchErrors(page);

  // A first visit: the main menu over the backdrop map, with nothing to continue yet.
  await skipGraphicsCheck(page);
  await page.goto('./');
  await booted(page, 'menu');
  await expect(page.getByTestId('main-menu')).toBeVisible();
  await expect(page.getByTestId('main-new')).toBeVisible();
  await expect(page.getByTestId('main-continue')).toHaveCount(0);
  await expect(page.getByTestId('topbar')).toHaveCount(0);
  await shot(page, 'm11-main-menu');

  // Settings from the main menu apply at once.
  await page.getByTestId('main-settings').click();
  await page.getByTestId('quality-medium').click();
  await page.getByTestId('set-shadows').uncheck();
  await page.getByTestId('draw-far').click();
  await page.getByTestId('ui-scale').fill('110');
  await page.getByTestId('edge-scroll').check();
  await page.getByTestId('autosave-2').click();
  await page.getByTestId('vol-effectsVolume').fill('40');
  let sh = await shell(page);
  expect(sh.applied).toMatchObject({ shadows: false, fogScale: 1.5, uiScale: '1.1', edgeScroll: true });
  expect(sh.applied.pixelRatio).toBeLessThanOrEqual(1);
  await shot(page, 'm11-settings');
  await page.getByTestId('shell-back').click();
  await expect(page.getByTestId('main-menu')).toBeVisible();

  // New city: name, map, seed, difficulty; the tutorial is on for a first city.
  await page.getByTestId('main-new').click();
  await page.getByTestId('new-name').fill('Testhaven');
  await page.getByTestId('preset-lakes').click();
  await page.getByTestId('new-seed').fill('m11');
  await page.getByTestId('difficulty-hard').click();
  await expect(page.getByTestId('new-tutorial')).toBeChecked();
  await shot(page, 'm11-new-game');
  await page.getByTestId('new-start').click();
  await expect(page.getByTestId('topbar')).toBeVisible({ timeout: 90_000 });
  await booted(page, 'play');
  const st0 = await page.evaluate(() => window.__game!.getState());
  expect(st0.cityName).toBe('Testhaven');
  expect(st0.options).toMatchObject({ seed: 'm11', preset: 'lakes', difficulty: 'hard', sandbox: false });
  expect(st0.treasury).toBe(35_000);
  // The URL no longer re-creates the city on a reload.
  expect(new URL(page.url()).search).toBe('');

  // The tutorial: a welcome, then steps that tick themselves off as the town takes shape.
  await expect(page.getByTestId('tutorial')).toContainText('Welcome');
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByTestId('tutorial')).toContainText('Lay a road');
  await expect(page.getByTestId('tool-road')).toHaveAttribute('data-guide', '');
  await page.evaluate(() => window.__game!.setCamera('overview'));
  await shot(page, 'm11-tutorial');
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 60_000 }));
  await buildTownViaApi(page);
  await expect(page.getByTestId('tutorial')).toContainText('Power', { timeout: 15_000 });
  await page.getByTestId('tutorial-skip').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
  // With the tutorial over, a tip explains the town's first problem (homes without power), once.
  await page.evaluate(() => window.__game!.advance(360));
  await expect(page.getByTestId('tip')).toContainText('no power', { timeout: 15_000 });
  await page.getByTestId('tip-ok').click();
  await expect(page.getByTestId('tip')).toHaveCount(0);
  expect((await shell(page)).settings.seenTips).toContain('noPower');
  await serveTownViaApi(page);
  await page.evaluate(() => window.__game!.advance(1440));
  expect((await page.evaluate(() => window.__game!.getState())).population).toBeGreaterThan(0);

  // Escape (with nothing to cancel) pauses and opens the pause menu; save to a named slot.
  await page.evaluate(() => window.__game!.setSpeed(1));
  await page.getByTestId('tool-select').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await expect(page.getByTestId('speed-0')).toHaveClass(/active/);
  await shot(page, 'm11-pause');
  await page.getByTestId('pause-save').click();
  await page.getByTestId('save-name').fill('Before the bridge');
  await page.getByTestId('save-new').click();
  // The toast names the slot, not the city (P22).
  await expect(page.getByTestId('toast').first()).toContainText('Saved “Before the bridge”');
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('toast').last()).toContainText('Saved “Quick save”');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  const hash = await page.evaluate(() => window.__game!.hash());
  const pop = (await page.evaluate(() => window.__game!.getState())).population;

  // Quit to the main menu (the city is autosaved), then reload the page.
  await page.getByTestId('pause-quit').click();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 90_000 });
  await page.reload();
  await booted(page, 'menu');
  await expect(page.getByTestId('main-continue')).toContainText('Testhaven');

  // Both saves are listed; export the named one to a file.
  await page.getByTestId('main-load').click();
  const list = page.getByTestId('slot-list');
  await expect(list).toContainText('Before the bridge');
  await expect(list).toContainText('Autosave');
  await shot(page, 'm11-load');
  const slotRow = list.locator('.slot', { hasText: 'Before the bridge' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    slotRow.getByRole('button', { name: 'Export' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Testhaven.citybloom');
  const file = await download.path();
  await page.getByTestId('shell-back').click();

  // Continue: the same city, exactly as it was saved; the settings are still in force.
  await page.getByTestId('main-continue').click();
  await expect(page.getByTestId('topbar')).toBeVisible({ timeout: 90_000 });
  await booted(page, 'play');
  expect(await page.evaluate(() => window.__game!.hash())).toBe(hash);
  expect((await page.evaluate(() => window.__game!.getState())).population).toBe(pop);
  sh = await shell(page);
  expect(sh.settings).toMatchObject({
    quality: 'medium',
    shadows: false,
    drawDistance: 'far',
    uiScale: 1.1,
    edgeScroll: true,
    autosaveMinutes: 2,
    effectsVolume: 0.4,
    tutorialStep: -1,
  });
  expect(sh.applied).toMatchObject({ shadows: false, fogScale: 1.5, uiScale: '1.1', edgeScroll: true });
  await page.getByTestId('menu-button').click();
  await page.getByTestId('pause-settings').click();
  await expect(page.getByTestId('quality-medium')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('set-shadows')).not.toBeChecked();
  await expect(page.getByTestId('edge-scroll')).toBeChecked();
  await page.getByTestId('shell-back').click();

  // Import the exported file: it opens as its own slot, identical to the save.
  await expect(page.getByTestId('pause-import')).toBeVisible();
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await booted(page, 'play');
  expect((await page.evaluate(() => window.__game!.getState())).cityName).toBe('Testhaven');
  expect(await page.evaluate(() => window.__game!.hash())).toBe(hash);
  errs.check();
});
