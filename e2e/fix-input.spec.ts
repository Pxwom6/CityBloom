import { expect, test, type Page } from '@playwright/test';
import { frames, holdSim, screen, state } from './ui';
import { buildTownViaApi, openGame, watchErrors } from './helpers';

/**
 * Playthrough fixes, input (P3, P4, P11): what a player does with the mouse and keyboard, driven the
 * way a player does it (real presses, drags and keys). Where a test needs the sim to answer late it
 * holds the page's messages to the sim back (`holdSim`) rather than racing a timer.
 */

const hint = (page: Page) => page.getByTestId('tool-hint');
const shell = (page: Page) => page.evaluate(() => window.__game!.getShell());

/** Look down the avenue from the highway, as the road specs do. */
async function camera(page: Page): Promise<number> {
  const cz = (await state(page)).highwayZ;
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 260, z: cz, distance: 520, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await frames(page);
  return cz;
}

/** Road segments in the city (a query, so it does not wait behind a held command). */
const segments = async (page: Page) => (await state(page)).segments;

test.describe('P11: Escape follows its order', () => {
  test('Escape before the sim replies ends the chain once, then leaves the tool, then closes the panel, then opens the menu', async ({
    page,
  }) => {
    const errs = watchErrors(page);
    await openGame(page);
    const cz = await camera(page);
    await page.getByTestId('tool-road').click();
    await page.getByTestId('road-street').click();
    const s0 = await segments(page);

    // A chain: click the highway end, click again, and the first street is built.
    const a = await screen(page, 24, cz);
    const b = await screen(page, 160, cz);
    await page.mouse.move(a.x, a.y, { steps: 2 });
    await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.click(b.x, b.y);
    await expect.poll(() => segments(page)).toBe(s0 + 1);

    // A panel is open too, so the order has a third step to show.
    await page.keyboard.press('KeyM');
    await expect(page.getByTestId('budget')).toBeVisible();

    // The next click builds a road; Escape comes before the sim has answered. (North of the avenue:
    // the toolbar covers the south of the map.)
    await holdSim(page, true);
    const c = await screen(page, 160, cz - 150);
    await page.mouse.move(c.x, c.y, { steps: 3 });
    await page.mouse.click(c.x, c.y);
    await page.keyboard.press('Escape');

    // One press ended the chain: the tool is still out, waiting for a new road.
    await expect(page.getByTestId('tool-road')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('road-options')).toBeVisible();
    await expect(hint(page)).toContainText('drag to draw');
    // The sim now answers. The road already sent is built, and its reply does not bring the chain back.
    await holdSim(page, false);
    await expect.poll(() => segments(page), { timeout: 20_000 }).toBe(s0 + 2);
    await page.waitForTimeout(1000);
    await frames(page);
    await expect(hint(page)).toContainText('drag to draw');
    await page.mouse.move(c.x + 80, c.y, { steps: 3 });
    await page.waitForTimeout(400);
    await expect(hint(page)).toContainText('drag to draw');
    await expect(hint(page)).not.toContainText('release to place');

    // The second press leaves the tool, and nothing of it is left on screen.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('road-options')).toBeHidden();
    await page.waitForTimeout(1000);
    await expect(hint(page)).toHaveCount(0);
    await expect(page.getByTestId('budget')).toBeVisible();
    expect((await shell(page)).screens).toEqual([]);

    // The third closes the panel, the fourth opens the menu.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('budget')).toBeHidden();
    expect((await shell(page)).screens).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('pause-settings')).toBeVisible();
    expect((await shell(page)).screens).toContain('pause');
    errs.check();
  });

  test('a late preview reply does not bring the road hint back after the tool is left', async ({ page }) => {
    const errs = watchErrors(page);
    await openGame(page);
    const cz = await camera(page);
    await page.getByTestId('tool-road').click();
    await page.getByTestId('road-street').click();
    const a = await screen(page, 24, cz);
    const b = await screen(page, 200, cz);
    await page.mouse.move(a.x, a.y, { steps: 2 });
    await page.mouse.click(a.x, a.y);

    // A preview for the road to B is on its way when the player gives up on the tool.
    await holdSim(page, true);
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    await expect(hint(page)).toHaveCount(0);
    await holdSim(page, false);
    await page.waitForTimeout(1500);
    await expect(hint(page)).toHaveCount(0);
    expect((await shell(page)).screens).toEqual([]);
    errs.check();
  });

  test('a late preview reply does not bring a placement hint back after the tool is left', async ({
    page,
  }) => {
    const errs = watchErrors(page);
    await openGame(page);
    await buildTownViaApi(page);
    await page.evaluate(async () => {
      await window.__game!.dispatch({ type: 'cheat', cheat: 'unlockAll' });
      await window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
    });
    const cz = await camera(page);
    const over = await screen(page, 300, cz + 45);
    const road = await screen(page, 300, cz);
    const tools: [string, string | null, { x: number; y: number }][] = [
      ['tool-power', 'place-wind', over],
      ['tool-transit', 'place-busstop', over],
      ['tool-bulldoze', null, road],
      ['tool-disasters', 'disaster-earthquake', over],
    ];
    for (const [tool, sub, at] of tools) {
      await page.getByTestId(tool).click();
      if (sub) await page.getByTestId(sub).click();
      await holdSim(page, true);
      await page.mouse.move(at.x - 30, at.y - 20);
      await page.mouse.move(at.x, at.y, { steps: 3 });
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('tool-select'), tool).toHaveAttribute('aria-pressed', 'true');
      await expect(hint(page), `${tool}: the hint right after leaving`).toHaveCount(0);
      await holdSim(page, false);
      await page.waitForTimeout(1500);
      await expect.soft(hint(page), `${tool}: the hint after the late reply`).toHaveCount(0);
      // Whatever a late reply left up, clear it so the next tool starts clean.
      await page.mouse.move(at.x + 40, at.y + 40);
    }
    expect((await shell(page)).screens).toEqual([]);
    errs.check();
  });
});
