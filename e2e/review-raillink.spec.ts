import { expect, test } from '@playwright/test';
import { shot, watchErrors } from './helpers';
import { frames, screen, settings, settledHint, state, untilHour } from './ui';

/**
 * Phase 2 review: a city without a regional rail link lays one from the toolbar. The user's save
 * (a big coast city from before M20) got its link when it was first loaded after M20; the test takes
 * it away first, which is the state a city whose west edge was full is left in.
 */
test('Phase 2 review: an older city lays its regional rail link from the toolbar, and undoes it', async ({
  page,
}) => {
  test.setTimeout(480_000);
  const errs = watchErrors(page);
  await settings(page);
  await page.goto('./');
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([
    page.waitForURL(/\?load=/),
    page.getByTestId('import-file').setInputFiles('Saves/Legacy-no-rail.citybloom'),
  ]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  const g = (cmd: Parameters<NonNullable<typeof window.__game>['dispatch']>[0]) =>
    page.evaluate((cmd) => window.__game!.dispatch(cmd), cmd);
  expect((await state(page)).railLinkOffered).toBe(false);
  await expect(page.getByTestId('tool-transit')).toBeVisible();
  expect(await g({ type: 'cheat', cheat: 'removeRailLink' })).toMatchObject({ ok: true });
  expect(await g({ type: 'cheat', cheat: 'addMoney', amount: 60_000 })).toMatchObject({ ok: true });
  await expect.poll(async () => (await state(page)).railLinkOffered).toBe(true);
  await untilHour(page, 11);

  // The transport advisor says what's missing and where it goes.
  await page.getByTestId('open-advisors').click();
  await expect(page.getByText('No regional rail link')).toBeVisible();
  await page.getByTestId('open-advisors').click();

  // Transit: the button and its tooltip.
  await page.getByTestId('tool-transit').click();
  const btn = page.getByTestId('place-raillink');
  await expect(btn).toBeVisible();
  await btn.hover();
  await expect(page.getByRole('tooltip')).toContainText('Click on the west edge');
  await expect(page.getByRole('tooltip')).toContainText('$40,000');
  await btn.click();
  await page.evaluate(() => window.__game!.setCamera({ x: 90, z: 1830, distance: 420, yaw: 0, tilt: 0.85 }));
  await frames(page, 3);

  // Refused where a dirt road runs along the edge; accepted where the old link was.
  const hover = async (z: number) => {
    const p = await screen(page, 12, z);
    await page.mouse.move(p.x, p.y, { steps: 4 });
    return settledHint(page);
  };
  for (const z of [1880, 1790]) {
    const p = await screen(page, 12, z);
    expect(p.y, `the edge at ${z} is on screen`).toBeGreaterThan(120);
    expect(p.y).toBeLessThan(560);
  }
  const road = await hover(1880);
  expect(road.tone).toMatch(/\bbad\b/);
  expect(road.text).toMatch(/road is in the way/);
  const ok = await hover(1790);
  expect(ok.tone).toMatch(/\bok\b/);
  expect(ok.text).toContain('Regional rail link · $40,000');
  await shot(page, 'review-raillink-preview');
  const at = await screen(page, 12, 1790);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => (await state(page)).railway?.z ?? null, { timeout: 20_000 }).toBe(1790);
  expect((await state(page)).railLinkOffered).toBe(false);
  // The button has gone; the tool is back to select.
  await page.getByTestId('tool-transit').click();
  await expect(page.getByTestId('place-raillink')).toHaveCount(0);
  await page.getByTestId('tool-select').click();

  // Its inspector, from its junction building.
  const box = await page.evaluate(() => window.__game!.getCivics().find((c) => c.def === 'raillink'));
  expect(box).toBeDefined();
  const bp = await screen(page, box!.x, box!.z);
  await page.mouse.click(bp.x, bp.y);
  await expect(page.getByTestId('inspector')).toContainText('Regional rail link');
  await expect(page.getByTestId('raillink-joined')).toContainText('Nothing joined yet');
  await expect(page.getByTestId('bulldoze')).toHaveCount(0);
  await expect(page.getByTestId('move-civic')).toHaveCount(0);
  await frames(page, 3);
  await shot(page, 'review-raillink-built');
  await page.keyboard.press('Escape');

  // Undo takes it away (and puts the button back); redo lays it again.
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).railway, { timeout: 20_000 }).toBeNull();
  expect((await state(page)).railLinkOffered).toBe(true);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(async () => (await state(page)).railway?.z ?? null, { timeout: 20_000 }).toBe(1790);
  errs.check();
});
