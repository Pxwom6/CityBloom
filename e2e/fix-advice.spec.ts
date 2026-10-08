import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';

/** Playthrough fixes round: advice and labels that said something the numbers did not (P15, P25). */

const state = (page: Page) => page.evaluate(() => window.__game!.getState());

test('P25: a home beside a primary school is told which school places it lacks', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = watchErrors(page);
  await openGame(page);
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  const cz = (await state(page)).highwayZ;
  // A primary school a street from the northern homes, placed before they grow.
  const school = await page.evaluate(async (cz) => {
    const g = window.__game!;
    const id = await g.placeCivic('primary', { x: 260, z: cz - 90 });
    return g.getCivics().find((c) => c.id === id) ?? null;
  }, cz);
  expect(school).not.toBeNull();
  await page.evaluate(() => window.__game!.advance(1440 * 3));

  // Homes nearest the school first: they have every primary seat and no high school place.
  const homes = await page.evaluate((s) => {
    return window
      .__game!.getBuildings()
      .filter((b) => b.state === 1 && b.zone === 1)
      .sort((a, b) => Math.hypot(a.x - s!.x, a.z - s!.z) - Math.hypot(b.x - s!.x, b.z - s!.z))
      .slice(0, 60)
      .filter((_, i) => i % 5 === 0);
  }, school);
  expect(homes.length).toBeGreaterThan(4);

  const seen: string[] = [];
  let last = '';
  let shown = false;
  for (const h of homes) {
    await page.evaluate(
      (h) => window.__game!.setCamera({ x: h.x, z: h.z, distance: 110, yaw: 0.3, tilt: 0.3 }),
      h,
    );
    await page.evaluate(() => window.__game!.waitFrames(2));
    const p = await page.evaluate((h) => window.__game!.worldToScreen(h.x, h.z), h);
    await page.mouse.click(p.x, p.y);
    const inspector = page.getByTestId('inspector');
    // Wait for this click to reach the panel (the last home's card stays up until it does).
    const address = page.getByTestId('inspector-address');
    await expect(address)
      .not.toHaveText(last, { timeout: 8000 })
      .catch(() => undefined);
    last = (await address.isVisible()) ? await address.innerText() : '';
    // (A click beside the school may land on the school itself.)
    if (!(await page.getByTestId('inspector-health').isVisible())) continue;
    // The residents' own level is called what the data map calls it.
    await expect(inspector).toContainText('Education level');
    const lines = (await page.getByTestId('inspector-factors').innerText()).split('\n');
    seen.push(...lines);
    const at = lines.findIndex((l) => /places nearby|is full/.test(l));
    if (at < 0) continue;
    if (!shown) {
      shown = true;
      await shot(page, 'fix-advice-p25-inspector');
    }
    // If the penalty is big enough to be listed under "Would help" (low-wealth homes rarely reach it), it
    // names the same missing level.
    if (/high school/.test(lines[at]!) && Number.parseFloat(lines[at + 1]!) <= -2) {
      await expect(page.getByTestId('inspector-needs')).toContainText(
        'A high school with free places within reach',
      );
    }
  }
  const text = seen.join('\n');
  // Never "no school" beside a school; say what is missing.
  expect(text).not.toMatch(/No school nearby/);
  expect(text).toMatch(/No high school places nearby/);
  errs.check();
});
