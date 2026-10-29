import { expect, test, type Page } from '@playwright/test';
import { openGame, shot, watchErrors } from './helpers';
import { settings } from './ui';
import { armTown, servedTown } from './war';

/**
 * M38 the war economy through the real UI: the war room's Trade tab. A stake in a neighbour's
 * industry pays dividends in peace and is frozen once the city is at war with it; an ally borrows,
 * buys munitions by the month and a unit outright; a sanction on another neighbour cuts the deal
 * the city had with it.
 */

// A button that never turns up fails in a minute, not at the test's timeout.
test.use({ actionTimeout: 60_000 });

async function trade(page: Page) {
  return page.evaluate(async () => (await window.__game!.getState()).war?.economy ?? null);
}
const ledger = (page: Page) => page.evaluate(() => window.__game!.getLedger());

test('M38: stakes, an ally’s loan, munitions and a unit, a war that freezes a stake, sanctions', async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await servedTown(page);
  // A base for a unit to sell, and an arms factory for munitions.
  await armTown(page, ['militaryhq', 'barracks', 'armsfactory'], { infantry: 1 });
  const [a, b, c] = await page.evaluate(async () => {
    const g = window.__game!;
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
    const s = await g.getState();
    const rivals = s.region.neighbours.filter((n) => n.rival);
    // Too weak to raid (a raid needs a strength of 1): only what the test does happens.
    for (const n of rivals)
      await g.dispatch({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0.5, defences: 1 });
    return rivals.map((n) => ({ id: n.id, name: n.name }));
  });

  // --- The Trade tab: a stake in A's industry, then dividends. ---
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-trade').click();
  await expect(page.getByTestId(`trade-${a!.id}`)).toContainText(a!.name);
  await expect(page.getByTestId(`trade-stake-${a!.id}`)).toHaveText('No stake.');
  await page.getByTestId(`trade-buy-${a!.id}`).click();
  await expect(page.getByTestId(`trade-stake-${a!.id}`)).toContainText('You hold 5 %');
  await page.getByTestId(`trade-buy-${a!.id}`).click();
  await expect(page.getByTestId(`trade-stake-${a!.id}`)).toContainText('You hold 10 %');
  await page.getByTestId(`trade-buy-${b!.id}`).click();
  await expect(page.getByTestId(`trade-stake-${b!.id}`)).toContainText('You hold 5 %');
  await expect(page.getByTestId('trade-dividends')).toContainText('+$');
  await page.evaluate(() => window.__game!.advance(1440));
  const paid = (await ledger(page)).history.at(-1)?.lines.dividends ?? 0;
  expect(paid).toBeGreaterThan(0);
  await shot(page, 'm38-trade-stakes');

  // --- An alliance with A (its proposal, accepted in the Diplomacy tab), then a loan, munitions, a unit. ---
  await page.evaluate(
    (id) =>
      window.__game!.dispatch({
        type: 'cheat',
        cheat: 'proposal',
        neighbour: id,
        terms: [{ k: 'alliance' }],
      }),
    a!.id,
  );
  await page.getByTestId('war-tab-diplomacy').click();
  await page.locator('[data-testid^="dip-accept-"]').first().click();
  await page.getByTestId('war-tab-trade').click();
  await expect(page.getByTestId(`trade-${a!.id}`)).toContainText('Ally');
  await page.getByTestId(`trade-lend-amount-${a!.id}`).selectOption('150000');
  await page.getByTestId(`trade-lend-${a!.id}`).click();
  await expect(page.getByTestId(`trade-loan-${a!.id}`)).toContainText('Owes $150,000');
  await page.getByTestId(`trade-arms-${a!.id}`).selectOption('10');
  await expect(page.getByTestId(`trade-arms-sold-${a!.id}`)).toBeVisible();
  const before = (await trade(page))!.munitions;
  await page.evaluate(() => window.__game!.advance(60 * 12));
  await expect
    .poll(async () => (await trade(page))!.neighbours.find((n) => n.id === a!.id)!.arms!.sold)
    .toBeGreaterThan(0);
  expect((await trade(page))!.munitions).toBeLessThan(before + 1);
  // The unit: an infantry company to the ally.
  await expect(page.getByTestId('trade-unit-to')).toHaveValue(String(a!.id));
  await page.getByTestId('trade-unit-sell').click();
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getForces()))!.units.length)
    .toBe(0);
  await shot(page, 'm38-trade-ally');

  // --- War with B (declared, open after its warning): the stake there freezes. ---
  await page.evaluate(
    (id) =>
      window.__game!.dispatch({ type: 'declareWar', neighbour: id, scale: 'war', reason: 'Border dispute' }),
    b!.id,
  );
  await page.evaluate(() => window.__game!.advance(60 * 30));
  await expect(page.getByTestId(`trade-stake-${b!.id}`)).toContainText('frozen');
  await expect(page.getByTestId(`trade-sell-${b!.id}`)).toBeDisabled();
  // A's stake still pays: dividends go on from it alone.
  const stakes = (await trade(page))!.neighbours;
  expect(stakes.find((n) => n.id === b!.id)!.dividend).toBe(0);
  expect(stakes.find((n) => n.id === a!.id)!.dividend).toBeGreaterThan(0);
  await shot(page, 'm38-trade-frozen');

  // --- A sanction on C: the city's stake there freezes too, and C minds. ---
  await page.getByTestId(`trade-buy-${c!.id}`).click();
  await expect(page.getByTestId(`trade-stake-${c!.id}`)).toContainText('You hold 5 %');
  await page.getByTestId(`trade-sanction-${c!.id}`).click();
  await expect(page.getByTestId(`trade-${c!.id}`)).toContainText('you sanction it');
  await expect(page.getByTestId(`trade-stake-${c!.id}`)).toContainText('frozen');
  await expect(page.getByTestId(`trade-sanction-${c!.id}`)).toHaveText('Lift the sanctions');
  await shot(page, 'm38-trade-sanction');
  errs.check();
});
