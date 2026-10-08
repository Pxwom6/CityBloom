import { expect, test, type Page } from '@playwright/test';
import { findSpot, frames, holdSim, screen, state } from './ui';
import { buildTownViaApi, openGame, shot, watchErrors } from './helpers';

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

test.describe('P3: a drag with a tool out pans, a click acts', () => {
  test('a left-drag pans with a place, stop, bulldoze or disaster tool out and builds nothing; a click still acts', async ({
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
    const home = async () => {
      await camera(page);
    };
    const pose = () => page.evaluate(() => window.__game!.getCamera());
    const hash = () => page.evaluate(() => window.__game!.hash());

    /** Press at a spot, drag away and let go: the map moves under the pointer and nothing else happens. */
    const dragCheck = async (spot: [number, number], tool: string) => {
      const h0 = await hash();
      const s0 = await state(page);
      const c0 = await pose();
      const p = await screen(page, spot[0], spot[1]);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x - 220, p.y - 70, { steps: 6 });
      await page.mouse.up();
      const c1 = await pose();
      expect(Math.hypot(c1.x - c0.x, c1.z - c0.z), `${tool}: the map moved with the drag`).toBeGreaterThan(
        20,
      );
      expect(await hash(), `${tool}: a drag changed the city`).toBe(h0);
      const s1 = await state(page);
      expect(s1.treasury, `${tool}: a drag cost money`).toBe(s0.treasury);
      expect(s1.segments).toBe(s0.segments);
      expect(s1.civics).toBe(s0.civics);
      await expect(page.getByTestId(tool), `${tool}: still the tool in hand`).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    };

    // Place: a wind turbine beside the avenue.
    await page.getByTestId('tool-power').click();
    await page.getByTestId('place-wind').click();
    const wind = await findSpot(
      page,
      [
        [300, cz + 45],
        [300, cz - 45],
        [420, cz + 45],
      ],
      'the wind turbine',
    );
    await dragCheck(wind, 'tool-power');
    await home();
    await findSpot(page, [wind], 'the wind turbine again');
    const h1 = await hash();
    const civics0 = (await state(page)).civics;
    let p = await screen(page, wind[0], wind[1]);
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await state(page)).civics).toBe(civics0 + 1);
    expect(await hash()).not.toBe(h1);

    // Stop: a bus stop beside the avenue.
    await page.getByTestId('tool-transit').click();
    await page.getByTestId('place-busstop').click();
    const stop = await findSpot(
      page,
      [
        [300, cz + 12],
        [300, cz + 45],
        [420, cz + 12],
      ],
      'the bus stop',
    );
    await dragCheck(stop, 'tool-transit');
    await home();
    await findSpot(page, [stop], 'the bus stop again');
    const h2 = await hash();
    p = await screen(page, stop[0], stop[1]);
    await page.mouse.click(p.x, p.y);
    await expect.poll(hash).not.toBe(h2);

    // Bulldoze: the avenue itself, which a press would take a piece out of.
    await page.getByTestId('tool-bulldoze').click();
    await home();
    await dragCheck([260, cz], 'tool-bulldoze');
    await home();
    p = await screen(page, 260, cz);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(300);
    const roads0 = (await state(page)).segments;
    await page.mouse.click(p.x, p.y);
    await expect.poll(async () => (await state(page)).segments).toBeLessThan(roads0);

    // Disaster: last, because a click sets it off and leaves the tool.
    await page.getByTestId('tool-disasters').click();
    await page.getByTestId('disaster-earthquake').click();
    await home();
    await dragCheck([300, cz - 100], 'tool-disasters');
    await home();
    const h3 = await hash();
    p = await screen(page, 300, cz - 100);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(300);
    await page.mouse.click(p.x, p.y);
    await expect.poll(hash).not.toBe(h3);
    await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
    errs.check();
  });

  test('the road tool says how to pan, and a drag in the middle of a chain builds nothing', async ({
    page,
  }) => {
    const errs = watchErrors(page);
    await openGame(page);
    const cz = await camera(page);
    await page.getByTestId('tool-road').click();
    await page.getByTestId('road-street').click();
    const pose = () => page.evaluate(() => window.__game!.getCamera());
    const s0 = (await state(page)).segments;

    // Idle, the hint says how to move the map without drawing.
    const a = await screen(page, 24, cz);
    await page.mouse.move(a.x, a.y, { steps: 2 });
    await expect(hint(page)).toContainText('middle-drag');
    await shot(page, 'fix-input-road-hint');

    // And a middle-drag does pan, building nothing.
    const c0 = await pose();
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(a.x + 120, a.y + 40, { steps: 5 });
    await page.mouse.up({ button: 'middle' });
    const c1 = await pose();
    expect(Math.hypot(c1.x - c0.x, c1.z - c0.z)).toBeGreaterThan(20);
    expect((await state(page)).segments).toBe(s0);
    await expect(page.getByTestId('tool-road')).toHaveAttribute('aria-pressed', 'true');
    await camera(page);

    // The shortcut card lists it.
    await page.keyboard.press('Shift+Slash');
    await expect(page.getByTestId('shortcuts')).toContainText('Middle-drag');
    await shot(page, 'fix-input-shortcuts');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts')).toBeHidden();
    await expect(page.getByTestId('tool-road')).toHaveAttribute('aria-pressed', 'true');

    // A chain: two clicks build the first street.
    const b = await screen(page, 160, cz);
    await page.mouse.move(a.x, a.y, { steps: 2 });
    await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y, { steps: 3 });
    await page.mouse.click(b.x, b.y);
    await expect.poll(async () => (await state(page)).segments).toBe(s0 + 1);

    // Mid-chain, a press that is dragged away is the start of a pan, not a road.
    const f = await screen(page, 300, cz - 100);
    await page.mouse.move(f.x, f.y, { steps: 3 });
    await page.mouse.down();
    await page.mouse.move(f.x - 150, f.y + 20, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect((await state(page)).segments).toBe(s0 + 1);
    // A click still extends the chain.
    await page.mouse.move(f.x, f.y, { steps: 3 });
    await page.mouse.click(f.x, f.y);
    await expect.poll(async () => (await state(page)).segments).toBe(s0 + 2);
    errs.check();
  });
});
