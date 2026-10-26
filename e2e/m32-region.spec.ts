import { test, expect, type Browser, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi } from './helpers';
import { placeFromToolbar } from './ui';

/**
 * M32, shared regions, through the interface: Ada starts a region from her city's Region panel and
 * Sam brings his own city in with the code. Each city runs on its own; Sam buys power from Ada's
 * city and the deal settles the same in both; both pay into Sunfield Commons, which Ada (the bigger
 * giver) builds; Sam looks round Ada's city read-only.
 */
async function player(browser: Browser, name: string, color: number): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(
    ([n, c]) => localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c })),
    [name, color] as const,
  );
  return ctx.newPage();
}

const region = (page: Page) => page.evaluate(() => window.__game!.getRegion());
const stats = (page: Page) => page.evaluate(() => window.__game!.getState());

test('two players run their own cities in one region: trade, a great work, a visit', async ({ browser }) => {
  test.setTimeout(600_000);
  const ada = await player(browser, 'Ada', 0);
  await openGame(ada, '&seed=regionada&preset=river&name=Adaville');
  await buildTownViaApi(ada);
  await serveTownViaApi(ada);
  await ada.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 600_000 }));
  await ada.evaluate(() => window.__game!.advance(1440));

  const sam = await player(browser, 'Sam', 1);
  await openGame(sam, '&seed=regionsam&preset=lakes&name=Samford');
  await buildTownViaApi(sam);
  await sam.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 }));
  await sam.evaluate(() => window.__game!.advance(1440));

  // Ada starts a region from her Region panel.
  await ada.keyboard.press('Shift+N');
  await ada.getByTestId('region-start').click();
  await expect.poll(async () => (await region(ada))?.state, { timeout: 30_000 }).toBe('in');
  const code = (await region(ada))!.code;
  await expect(ada.getByTestId('region-share')).toContainText(code);

  // Sam brings Samford in with the code.
  await sam.keyboard.press('Shift+N');
  await sam.getByTestId('region-code').fill(code);
  await sam.getByTestId('region-join').click();
  await expect.poll(async () => (await region(sam))?.state, { timeout: 30_000 }).toBe('in');
  await ada.evaluate(() => window.__game!.regionReportNow());
  await sam.evaluate(() => window.__game!.regionReportNow());
  // In Sam's panel, Adaville stands where a neighbouring town stood, played by Ada.
  const adaCard = sam.locator('.region-town.player', { hasText: 'Adaville' });
  await expect(adaCard).toContainText('Played by Ada', { timeout: 15_000 });

  // Sam buys power from Adaville.
  const sign = adaCard.locator('[data-testid$="-buy-power-sign"]');
  await expect(sign).toBeVisible();
  await sign.click();
  await expect
    .poll(async () => (await stats(sam)).region.deals.filter((d) => d.resource === 'power').length)
    .toBe(1);
  await sam.evaluate(() => window.__game!.regionReportNow());
  // Ada's panel shows Samford's deal as a sale.
  const samCard = ada.locator('.region-town.player', { hasText: 'Samford' });
  await expect(samCard.locator('[data-testid*="remote-deal-"]')).toContainText('Samford buys', {
    timeout: 15_000,
  });
  // Each city runs on its own; the deal goes through the same in both.
  await ada.evaluate(() => window.__game!.advance(240));
  await sam.evaluate(() => window.__game!.advance(120));
  const bought = (await stats(sam)).region.deals.find((d) => d.resource === 'power')!;
  const sold = (await stats(ada)).region.deals.find((d) => d.resource === 'power' && d.remote)!;
  expect(bought.delivered).toBeGreaterThan(0);
  expect(sold.delivered).toBe(bought.delivered);
  await sam.screenshot({ path: 'docs/screenshots/m32-region-sam.png' });

  // The great work: both give; Ada gives more and builds it.
  for (let i = 0; i < 4; i++) await ada.getByTestId('region-give-100000').click();
  for (let i = 0; i < 2; i++) await sam.getByTestId('region-give-100000').click();
  await expect.poll(async () => (await region(ada))?.project?.funded, { timeout: 15_000 }).toBe(true);
  expect((await region(ada))!.project!.host).toBe((await region(ada))!.slot);
  await ada.keyboard.press('Shift+N');
  await placeFromToolbar(ada, 'power', 'sunfield', [
    [300, (await stats(ada)).highwayZ + 230],
    [200, (await stats(ada)).highwayZ + 230],
    [400, (await stats(ada)).highwayZ + 230],
    [480, (await stats(ada)).highwayZ - 120],
  ]);
  await ada.evaluate(() => window.__game!.regionReportNow());
  await expect.poll(async () => (await region(sam))?.project?.built, { timeout: 15_000 }).toBe(true);
  await ada.keyboard.press('Shift+N');
  await expect(ada.getByTestId('region-project-status')).toContainText('built');
  await ada.screenshot({ path: 'docs/screenshots/m32-region-ada.png' });

  // Sam looks round Adaville, read-only, in a new tab.
  await expect
    .poll(async () => (await region(sam))?.cities.find((c) => c.name === 'Adaville')?.visitable, {
      timeout: 15_000,
    })
    .toBe(true);
  const [visit] = await Promise.all([
    sam.context().waitForEvent('page'),
    adaCard.locator('[data-testid^="visit-"]').click(),
  ]);
  await visit.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
  await expect(visit.getByTestId('visit-banner')).toContainText('Adaville');
  expect(
    (
      await visit.evaluate(() =>
        window.__game!.dispatch({ type: 'setTax', zone: 'R', wealth: 'all', rate: 0.2 }),
      )
    ).ok,
  ).toBe(false);
  await visit.screenshot({ path: 'docs/screenshots/m32-visit.png' });
  for (const p of [ada, sam]) await p.context().close();
});
