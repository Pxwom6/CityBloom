import { expect, test } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';

test('M2: a town grows from zoning, buildings can be inspected, and save/load round-trips exactly', async ({
  page,
}) => {
  const errs = watchErrors(page);
  await openGame(page);
  await buildTownViaApi(page);
  // As in a player's first city, the first construction sites are drawn before anything is finished
  // (their shader once got reused for finished buildings, which then drew nothing).
  const sites = await page.evaluate(async () => {
    const g = window.__game!;
    g.setCamera({ x: 200, z: (await g.getState()).highwayZ, distance: 420, yaw: 0.3, tilt: 0.2 });
    for (let k = 0; k < 24 && !g.getBuildings().some((b) => b.state === 0); k++) await g.advance(60);
    await g.waitFrames(2);
    return g.getBuildings().filter((b) => b.state === 0).length;
  });
  expect(sites).toBeGreaterThan(0);
  await serveTownViaApi(page);
  // Run the clock for real for a moment at top speed, then fast-forward.
  await page.getByTestId('speed-3').click();
  await page.waitForTimeout(1500);
  await page.getByTestId('speed-0').click();
  await page.evaluate(() => window.__game!.advance(1440 * 2));
  const st = await page.evaluate(() => window.__game!.getState());
  expect(st.population).toBeGreaterThan(300);
  expect(st.jobs).toBeGreaterThan(50);
  await expect(page.getByTestId('population')).not.toHaveText('0');
  await expect(page.getByTestId('rci')).toBeVisible();

  // Hover the demand bars: factors explain them.
  await page.getByTestId('rci').hover();
  await expect(page.getByText(/Residential demand/)).toBeVisible();
  await page.mouse.move(10, 400);

  const cz = st.highwayZ;
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 200, z: cz - 40, distance: 260, yaw: 0.3, tilt: 0.2 }),
    cz,
  );
  await shot(page, 'm2-town');
  // Finished homes and the civic buildings are really drawn (not just their shadows).
  const drawn = await page.evaluate(() => ({
    buildings: window.__game!.drawnPixels('buildings'),
    civics: window.__game!.drawnPixels('civics'),
  }));
  expect(drawn.buildings).toBeGreaterThan(200);
  expect(drawn.civics).toBeGreaterThan(20);

  // Click a grown house to inspect it.
  const target = await page.evaluate(() =>
    window.__game!.getBuildings().find((b) => b.zone === 1 && b.state === 1)!,
  );
  await page.evaluate(
    (b) => window.__game!.setCamera({ x: b.x, z: b.z, distance: 140, yaw: 0.3, tilt: 0.4 }),
    target,
  );
  await page.evaluate(() => window.__game!.waitFrames(1));
  const p = await page.evaluate((b) => window.__game!.worldToScreen(b.x, b.z), target);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('inspector')).toBeVisible();
  await expect(page.getByTestId('inspector-factors')).toBeVisible();
  await shot(page, 'm2-inspector');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('inspector')).toBeHidden();

  // Save, reload into the save, and compare state hashes. (Saving settles a commute-matching round
  // in progress, so the city is hashed after the save, as it carries on.)
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('toast')).toContainText('Saved');
  const hashBefore = await page.evaluate(() => window.__game!.hash());
  errs.check();
  await page.goto('./?load=quick&paused=1');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  const hashAfter = await page.evaluate(() => window.__game!.hash());
  expect(hashAfter).toBe(hashBefore);
  const st2 = await page.evaluate(() => window.__game!.getState());
  expect(st2.population).toBe(st.population);
  errs.check();
});
