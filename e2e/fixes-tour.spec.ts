import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, serveTownViaApi, shot, skipGraphicsCheck, watchErrors } from './helpers';
import { frames, screen, state } from './ui';

/**
 * PLAYTHROUGH-FIXES.md, "When everything's done": one short city, Kestrel Bend on the playthrough's
 * own map (River Valley, seed usnpp7, Normal, tutorial on), played from the main menu through the
 * interface, touching every area the round fixed. Screenshots `docs/screenshots/fixes-tour-*.png`.
 * Runs under `npm run playthrough`.
 */

const hint = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="tool-hint"]');
    return { text: el?.textContent ?? '', tone: el?.className ?? '' };
  });

async function moveTo(page: Page, x: number, z: number): Promise<{ x: number; y: number }> {
  const p = await screen(page, x, z);
  await page.mouse.move(p.x, p.y, { steps: 4 });
  await page.waitForTimeout(250);
  return p;
}

async function clickAt(page: Page, x: number, z: number): Promise<void> {
  const p = await moveTo(page, x, z);
  await page.mouse.click(p.x, p.y);
}

test('Playthrough fixes: Kestrel Bend through the UI, touching every fixed area @playthrough', async ({
  page,
}) => {
  test.setTimeout(1_200_000);
  const errs = watchErrors(page);
  await skipGraphicsCheck(page);

  // A new city from the main menu, with the tutorial.
  await page.goto('./');
  await page.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'menu',
    null,
    {
      timeout: 90_000,
    },
  );
  await page.getByTestId('main-new').click();
  await page.getByTestId('new-name').fill('Kestrel Bend');
  await page.getByTestId('preset-river').click();
  await page.getByTestId('new-seed').fill('usnpp7');
  await page.getByTestId('difficulty-normal').click();
  await expect(page.getByTestId('new-tutorial')).toBeChecked();
  await page.getByTestId('new-start').click();
  await expect(page.getByTestId('topbar')).toBeVisible({ timeout: 90_000 });
  await page.waitForFunction(() => window.__game?.ready === true && window.__game.getShell().mode === 'play');
  await page.evaluate(() => window.__game!.setSpeed(0));
  const cz = (await state(page)).highwayZ;
  const cx = 24;

  // P9: "Lay a road" waits for a road; the highway and the railway don't count.
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByTestId('tutorial')).toContainText('Lay a road');
  await page.evaluate(() => window.__game!.advance(180));
  await expect(page.getByTestId('tutorial')).toContainText('Lay a road');
  expect((await state(page)).achievements.firstStreet).toBeUndefined();

  // P3: the road tool says how to pan with it out; P1: a road out in the fields says it joins nothing.
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 380, z: cz - 140, distance: 640, yaw: 0, tilt: 0.6 }),
    cz,
  );
  await frames(page, 2);
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  await moveTo(page, 300, cz - 120);
  await expect.poll(async () => (await hint(page)).text).toContain('middle-drag');
  // The first street, dragged out from the highway (the tutorial's way).
  const a = await screen(page, cx, cz);
  const b = await screen(page, cx + 60, cz - 220);
  const s0 = (await state(page)).segments;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await state(page)).segments).toBe(s0 + 1);
  await expect(page.getByTestId('tutorial')).not.toContainText('Lay a road', { timeout: 15_000 });
  await shot(page, 'fixes-tour-01-first-street');
  // A street out in the fields, north of where the town will be.
  await clickAt(page, 480, cz - 300);
  await moveTo(page, 480, cz - 120);
  await expect.poll(async () => (await hint(page)).text).toContain("Doesn't join any road");
  await shot(page, 'fixes-tour-02-joins-nothing');
  const p2 = await screen(page, 480, cz - 120);
  await page.mouse.click(p2.x, p2.y);
  await expect.poll(async () => (await state(page)).segments).toBe(s0 + 2);
  // P11: one Escape ends the chain, the next leaves the tool.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-road')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('tool-select')).toHaveAttribute('aria-pressed', 'true');
  expect((await page.evaluate(() => window.__game!.getRoadIslands())).islands.length).toBe(1);
  await page.getByTestId('tutorial-skip').click();

  // A town: the planned town of the other specs, served, and given a few months (through the
  // test API, to be quick: what matters here is what the player then sees and does).
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  await page.evaluate(() => window.__game!.advance(1440 * 3));

  // P1: the cut-off street is named by the advisor; joining it with an end that stops 14 m short
  // of the avenue snaps it on, and it clears.
  await page.getByTestId('open-advisors').click();
  await expect(page.getByTestId('advice-island')).toContainText('can’t reach the highway', {
    timeout: 15_000,
  });
  await shot(page, 'fixes-tour-03-island-advice');
  await page.getByTestId('open-advisors').click();
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 480, z: cz - 60, distance: 420, yaw: 0, tilt: 0.6 }),
    cz,
  );
  await frames(page, 2);
  await page.getByTestId('tool-road').click();
  await clickAt(page, 480, cz - 120);
  await moveTo(page, 480, cz - 14);
  await expect.poll(async () => (await hint(page)).tone).toContain('ok');
  await shot(page, 'fixes-tour-04-join');
  const j = await screen(page, 480, cz - 14);
  await page.mouse.click(j.x, j.y);
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getRoadIslands())).islands.length)
    .toBe(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // P4: opening a category arms nothing; a click on the map at once builds nothing.
  const civics0 = await page.evaluate(() => window.__game!.getCivics().length);
  await page.getByTestId('tool-water').click();
  await expect(page.getByTestId('place-options')).toBeVisible();
  await clickAt(page, 700, cz - 150);
  expect(await page.evaluate(() => window.__game!.getCivics().length)).toBe(civics0);
  await page.getByTestId('tool-select').click();

  // P2: upgrading a built-up street asks before it demolishes anything.
  const pick = await page.evaluate(async (cz) => {
    const g = window.__game!;
    for (const x of [120, 216, 312, 408])
      for (const dz of [-80, 80]) {
        const s = g.segmentAt(x, cz + dz);
        if (!s) continue;
        const r = await g.preview({ type: 'upgradeRoad', seg: s.id, road: 'boulevard' });
        const gone = r.ok ? ((r.info as { demolished?: number[] }).demolished ?? []).length : 0;
        if (gone) return { x, z: cz + dz, gone };
      }
    return null;
  }, cz);
  if (pick) {
    await page.evaluate(
      (p) => window.__game!.setCamera({ x: p.x, z: p.z, distance: 300, yaw: 0, tilt: 0.7 }),
      pick,
    );
    await frames(page, 2);
    await page.getByTestId('tool-road').click();
    await page.getByTestId('mode-upgrade').click();
    await page.getByTestId('road-boulevard').click();
    await clickAt(page, pick.x, pick.z);
    await expect(page.getByTestId('tool-question')).toContainText(`demolishes ${pick.gone} building`);
    await shot(page, 'fixes-tour-05-upgrade-asks');
    await page.getByTestId('tool-question-no').click();
    await page.getByTestId('mode-straight').click();
    await page.getByTestId('tool-select').click();
  }

  // P5: a roundabout on a crossroads of the town, the largest that fits.
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 216, z: cz, distance: 260, yaw: 0, tilt: 0.7 }),
    cz,
  );
  await frames(page, 2);
  await page.getByTestId('tool-road').click();
  await page.getByTestId('mode-roundabout').click();
  await moveTo(page, 216, cz);
  await expect.poll(async () => (await page.evaluate(() => window.__game!.getRing())).ok).toBe(true);
  await shot(page, 'fixes-tour-06-roundabout');
  await clickAt(page, 216, cz);
  await expect
    .poll(() => page.evaluate((cz) => window.__game!.junctionAt(216, cz)?.roundabout ?? 0, cz))
    .toBeGreaterThan(0);
  await page.getByTestId('mode-straight').click();
  await page.getByTestId('tool-select').click();

  // P17, P24, P19: the budget's tax bands, loan terms and its two road lines.
  await page.getByTestId('open-budget').click();
  await page.getByTestId('budget-tab-taxes').click();
  await expect(page.getByTestId('tax-row-I2')).toContainText('no one pays');
  await shot(page, 'fixes-tour-07-taxes');
  await page.getByTestId('budget-tab-loans').click();
  await expect(page.getByTestId('loan-terms-25000')).toContainText('/mo × 60');
  await page.getByTestId('budget-tab-overview').click();
  await expect(page.getByTestId('budget')).toContainText('Road maintenance');
  await page.getByTestId('open-budget').click();

  // P20: the Region panel says what the city makes and uses.
  await page.getByTestId('open-region').click();
  await expect(page.getByTestId('region-supply-power')).toContainText('You make');
  await shot(page, 'fixes-tour-08-region');
  await page.getByTestId('open-region').click();

  // P26, P16: a winter's notifications in groups, and the year turning in January.
  await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const month = Math.floor((s.tick + 420) / 1440);
    await g.advance(Math.max(0, 10 - month) * 1440 + 60);
  });
  await expect(page.getByTestId('topbar')).toContainText('Jan, Year 2');
  await page.getByTestId('open-notifications').click();
  await expect(page.getByTestId('notifications').locator('h3.notice-group').first()).toBeVisible();
  await shot(page, 'fixes-tour-09-new-year');
  await page.getByTestId('open-notifications').click();

  // P22: the save toast names the slot.
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Saved “Quick save”' })).toBeVisible();
  await page.getByTestId('pause-resume').click();
  await page.evaluate(() => window.__game!.setSpeed(0));

  // P21: the city limit at the whole-city view.
  await page.evaluate(() => window.__game!.setCamera('overview'));
  await frames(page, 3);
  await shot(page, 'fixes-tour-10-limits');
  errs.check();
});
