import { expect, test } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';
import { frames, state } from './ui';

/**
 * Playthrough fixes (PLAYTHROUGH-FIXES.md) a player sees in the panels: budget lines, tax bands,
 * loan terms, notification groups, clickable toasts and calendar years.
 */
test('Playthrough fixes: budget, loans, notifications, toasts and dates through the UI', async ({ page }) => {
  const errs = watchErrors(page);
  await openGame(page);
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 100_000 }));

  // P17: on a new city nobody pays any tax band, and the tax tab says so.
  await page.getByTestId('open-budget').click();
  await page.getByTestId('budget-tab-taxes').click();
  for (const z of ['R', 'C', 'I'])
    for (const w of [0, 1, 2]) {
      const row = page.getByTestId(`tax-row-${z}${w}`);
      await expect(row).toHaveClass(/\bidle\b/);
      await expect(row).toContainText('no one pays');
    }
  await shot(page, 'fixes-p17-taxes-new-city');

  // P24: each loan button shows its monthly payment and what it costs in all, before borrowing.
  await page.getByTestId('budget-tab-loans').click();
  await expect(page.getByTestId('loan-terms-25000')).toHaveText('$472/mo × 60 · $28,320 in all');
  await expect(page.getByTestId('loan-terms-50000')).toContainText('/mo × 60');
  await shot(page, 'fixes-p24-loans');
  const t0 = (await state(page)).treasury;
  await page.getByTestId('loan-25000').click();
  await expect.poll(async () => (await state(page)).treasury).toBeGreaterThan(t0 + 20_000);
  await expect(page.getByTestId('budget')).toContainText('paying $472/month');

  // A town: homes pay their band, empty bands stay marked.
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  const depot = await page.evaluate(async () => {
    const s = await window.__game!.getState();
    return window.__game!.placeCivic('works', { x: 420, z: s.highwayZ + 200 });
  });
  expect(depot).not.toBeNull();
  await page.evaluate(() => window.__game!.advance(1440 * 2));
  await page.getByTestId('budget-tab-taxes').click();
  await expect(page.getByTestId('tax-row-R0')).not.toHaveClass(/\bidle\b/);
  await expect(page.getByTestId('tax-row-R0')).toContainText('/mo');
  await expect(page.getByTestId('tax-row-I2')).toHaveClass(/\bidle\b/);
  await shot(page, 'fixes-p17-taxes-town');

  // P19: the roads' upkeep and the public works depot's are two different lines.
  await page.getByTestId('budget-tab-overview').click();
  const budget = page.getByTestId('budget');
  await expect(budget).toContainText('Road maintenance');
  await expect(budget).toContainText('Public works depots');
  await expect(budget).not.toContainText('Road maintenance upkeep');
  await shot(page, 'fixes-p19-budget');
  await page.getByTestId('open-budget').click();

  // P23: a toast with a place takes a click, and the camera flies there.
  const target = await page.evaluate(async () => {
    const g = window.__game!;
    const b = g.getBuildings().find((x) => x.state === 1 && x.fire === 0)!;
    await g.dispatch({ type: 'cheat', cheat: 'ignite', id: b.id });
    await g.advance(2);
    return { x: b.x, z: b.z };
  });
  await page.evaluate(() => window.__game!.setCamera({ x: 2000, z: 2000, distance: 600, yaw: 0, tilt: 0.6 }));
  const toast = page.getByTestId('toast').filter({ hasText: 'Fire!' });
  await expect(toast).toHaveClass(/clickable/);
  const box = (await toast.boundingBox())!;
  // What a player's click would land on is the toast itself, not the map under it.
  const hit = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x!, y!)?.closest('[data-testid="toast"]')?.textContent ?? null,
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(hit).toContain('Fire!');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(async () => {
      const c = await page.evaluate(() => window.__game!.getCamera());
      return Math.hypot(c.x - target.x, c.z - target.z);
    })
    .toBeLessThan(5);
  await frames(page, 4);
  await shot(page, 'fixes-p23-toast-flew');

  // P26: notifications in groups with headings: problems, news, good news.
  await page.evaluate(() => window.__game!.advance(1440 * 3));
  await page.getByTestId('open-notifications').click();
  const panel = page.getByTestId('notifications');
  await expect(panel.getByTestId('notice-group-bad')).toHaveText('Problems');
  await expect(panel.getByTestId('notice-group-ok')).toHaveText('Good news');
  const order = await panel.locator('h3.notice-group').allTextContents();
  expect(order.filter((h) => h !== 'News')).toEqual(['Problems', 'Good news']);
  if (order.includes('News')) expect(order).toEqual(['Problems', 'News', 'Good news']);
  await shot(page, 'fixes-p26-notifications');
  await page.getByTestId('open-notifications').click();

  // P16: the top bar's year turns in January (founded in March: Jan is the 11th month).
  await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const month = Math.floor((s.tick + 420) / 1440);
    await g.advance((10 - month) * 1440 + 60);
  });
  await expect(page.getByTestId('topbar')).toContainText('Jan, Year 2');
  await shot(page, 'fixes-p16-new-year');
  errs.check();
});

test('P18: trucks bought while paused show at once, even when timers are held back', async ({ page }) => {
  // The playthrough's pane was hidden, which holds timers back: stretch every interval of half a
  // second or more to 5 s, so only what updates without a timer can keep up.
  await page.addInitScript(() => {
    const set = window.setInterval.bind(window);
    window.setInterval = ((fn: TimerHandler, ms?: number, ...rest: unknown[]) =>
      set(fn, ms && ms >= 500 ? Math.max(ms, 5000) : ms, ...rest)) as typeof window.setInterval;
  });
  const errs = watchErrors(page);
  await openGame(page);
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 100_000 }));
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  const lf = await page.evaluate(() => window.__game!.getCivics().find((c) => c.def === 'landfill')!);
  await page.evaluate(
    (c) => window.__game!.setCamera({ x: c.x, z: c.z, distance: 150, yaw: 0.4, tilt: 0.3 }),
    lf,
  );
  await frames(page, 2);
  const at = await page.evaluate((c) => window.__game!.worldToScreen(c.x, c.z), lf);
  await page.mouse.click(at.x, at.y);
  await expect(page.getByTestId('inspector')).toContainText('Landfill');
  await expect(page.getByTestId('garbage-extra')).toContainText('0 of');
  const money = (await state(page)).treasury;
  for (const k of [1, 2, 3]) {
    await page.getByTestId('buy-truck').click();
    await expect(page.getByTestId('garbage-extra')).toContainText(`${k} of`, { timeout: 1_500 });
  }
  expect((await state(page)).treasury).toBe(money - 3 * 1_200);
  await shot(page, 'fixes-p18-trucks');
  errs.check();
});
