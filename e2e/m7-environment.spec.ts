import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';

async function state(page: Page) {
  return page.evaluate(() => window.__game!.getState());
}

test('M7: smoke drifts downwind, the air and education maps show it, and homes report their health', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errs = watchErrors(page);
  await openGame(page);
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  const cz = (await state(page)).highwayZ;
  // A high school through the Education toolbar category.
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 250, z: cz - 40, distance: 360, yaw: 0, tilt: 0.3 }),
    cz,
  );
  await page.getByTestId('tool-education').click();
  await page.getByTestId('place-highschool').click();
  let placed = false;
  for (const [x, dz] of [
    [300, -160],
    [140, -160],
    [440, 150],
    [60, 150],
  ] as const) {
    const p = await page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, cz + dz]);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(300);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    if (await page.evaluate(() => window.__game!.findCivic('highschool') !== null)) {
      placed = true;
      break;
    }
  }
  expect(placed).toBe(true);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__game!.advance(1440 * 3));
  expect((await state(page)).population).toBeGreaterThan(300);

  // Smoke from the coal plant's stacks.
  const coal = await page.evaluate(() => window.__game!.getCivics().find((c) => c.def === 'coal')!);
  await page.evaluate(
    (c) => window.__game!.setCamera({ x: c.x, z: c.z + 60, distance: 260, yaw: 2.0, tilt: 0 }),
    coal,
  );
  await page.evaluate(() => window.__game!.waitFrames(32));
  expect((await state(page)).renderStats.smoke).toBeGreaterThan(20);
  await shot(page, 'm7-smoke');

  // The air pollution map, through the maps menu.
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-airPollution').click();
  await expect(page.getByTestId('map-legend')).toContainText('Air pollution');
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 250, z: cz + 120, distance: 560, yaw: 0, tilt: 0.35 }),
    cz,
  );
  await shot(page, 'm7-air-map');
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-eduLevel').click();
  await expect(page.getByTestId('map-legend')).toContainText('Education level');
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 250, z: cz, distance: 480, yaw: 0, tilt: 0.35 }),
    cz,
  );
  await shot(page, 'm7-education-map');
  await page.getByTestId('map-legend').getByRole('button').click();

  // A home reports its residents' health, schooling and air.
  const home = await page.evaluate(() => {
    const list = window.__game!.getBuildings().filter((b) => b.state === 1 && b.zone === 1);
    return list[Math.floor(list.length / 3)]!;
  });
  await page.evaluate(
    (h) => window.__game!.setCamera({ x: h.x, z: h.z, distance: 110, yaw: 0.3, tilt: 0.3 }),
    home,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  const hp = await page.evaluate((h) => window.__game!.worldToScreen(h.x, h.z), home);
  await page.mouse.click(hp.x, hp.y);
  await expect(page.getByTestId('inspector-health')).toBeVisible();
  await expect(page.getByTestId('inspector')).toContainText('Education level');
  await expect(page.getByTestId('inspector')).toContainText('Air');
  await shot(page, 'm7-inspector');
  errs.check();
});
