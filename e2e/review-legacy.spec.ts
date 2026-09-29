import { expect, test, type Page } from '@playwright/test';
import { shot, watchErrors } from './helpers';
import { frames, screen, settings, untilHour } from './ui';

/**
 * Phase 2 review: saves from past versions loaded through the real load screen (the playtest city
 * from M12, towns from M21 and M23 on a cold map and a lake map), every panel, tab and data map opened, and
 * each kind of inspector, failing on any console error. The corpus is `Saves/legacy/`
 * (`scripts/dev/legacy-corpus.mjs`); `tests/legacy/` plays every save for two years headless.
 */
const SAVES = [
  'Saves/Ashton.citybloom',
  'Saves/legacy/v19-highlands.citybloom',
  'Saves/legacy/v21-lakes.citybloom',
];

/** Close whatever panel or popover is open (a second click on its button, or Escape once). */
async function openClose(page: Page, button: string, panel?: string) {
  await page.getByTestId(button).click();
  if (panel) await expect(page.getByTestId(panel)).toBeVisible();
  await frames(page);
}

/** Click the first thing of a kind the renderer picks under it, from straight above, and inspect it. */
async function inspect(page: Page, kind: string, spots: { x: number; z: number }[]) {
  for (const p of spots.slice(0, 12)) {
    await page.evaluate(
      (p) => window.__game!.setCamera({ x: p.x, z: p.z, distance: 150, yaw: 0, tilt: 1.3 }),
      p,
    );
    await frames(page, 2);
    const at = await screen(page, p.x, p.z);
    const hit = await page.evaluate(([x, y]) => window.__game!.pickAt(x!, y!), [at.x, at.y]);
    if (hit?.kind !== kind) continue;
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId('inspector')).toBeVisible();
    await frames(page);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('inspector')).toBeHidden();
    return true;
  }
  return false;
}

for (const file of SAVES)
  test(`Phase 2 review: ${file.split('/').pop()} loads through the UI and every panel opens`, async ({
    page,
  }) => {
    test.setTimeout(720_000);
    const errs = watchErrors(page);
    await settings(page);
    await page.goto('./');
    await page.getByTestId('main-load').click({ timeout: 120_000 });
    await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
    await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
      timeout: 180_000,
    });
    await untilHour(page, 11);
    await frames(page, 3);
    const name = file.split('/').pop()!.replace('.citybloom', '');
    await shot(page, `review-legacy-${name}`);

    // The top bar's panels, and every tab.
    await openClose(page, 'open-budget', 'budget');
    for (const tab of ['overview', 'taxes', 'funding', 'loans', 'history']) {
      await page.getByTestId(`budget-tab-${tab}`).click();
      await frames(page);
    }
    await openClose(page, 'open-budget');
    await openClose(page, 'open-city');
    for (const tab of ['progress', 'policies', 'election', 'achievements']) {
      await page.getByTestId(`city-tab-${tab}`).click();
      await frames(page);
    }
    await openClose(page, 'open-city');
    for (const b of ['open-advisors', 'open-notifications', 'open-history', 'open-region']) {
      await openClose(page, b);
      await openClose(page, b);
    }
    await openClose(page, 'weather', 'weather-panel');
    await openClose(page, 'weather');
    await page.keyboard.press('i');
    await expect(page.getByTestId('districts-panel')).toBeVisible();
    await page.getByTestId('tool-select').click();

    // Every data map.
    await page.getByTestId('tool-maps').click();
    const maps = await page
      .getByTestId('maps-menu')
      .locator('[data-testid^="map-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!));
    expect(maps.length).toBeGreaterThan(8);
    for (const m of maps) {
      if (!(await page.getByTestId('maps-menu').isVisible())) await page.getByTestId('tool-maps').click();
      await page.getByTestId(m).click();
      await expect(page.getByTestId('map-legend')).toBeVisible();
      await frames(page);
    }
    await page.getByTestId('map-legend').getByRole('button').first().click();

    // An inspector of each kind: a home or business, a civic building, a road.
    const buildings = await page.evaluate(() => window.__game!.getBuildings().filter((b) => b.state === 1));
    const civics = await page.evaluate(() => window.__game!.getCivics());
    expect(await inspect(page, 'building', buildings)).toBe(true);
    expect(await inspect(page, 'civic', civics)).toBe(true);
    const roads = await page.evaluate(() =>
      window.__game!.getBuildings().map((b) => ({ x: b.x + 14, z: b.z })),
    );
    await inspect(page, 'road', roads);
    // The rail link, or the building to lay one on offer.
    const st = await page.evaluate(() => window.__game!.getState());
    expect(st.railway !== null || st.railLinkOffered).toBe(true);
    errs.check();
  });
