import { expect, test } from '@playwright/test';
import { openGame, shot, watchErrors } from './helpers';
import { settings } from './ui';
import { armTown, servedTown } from './war';

/**
 * M36 Diplomacy through the real UI: the war room's Diplomacy tab. A proposal to a neighbour is
 * answered by its character; a war is declared with a reason and opens after its warning; the
 * neighbour puts terms to the city, which counters them and then accepts a treaty that ends the war
 * with tribute; the city stands neutral.
 */
test('M36: proposals, a declared war, a treaty with tribute and a neutral stance, from the war room', async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await servedTown(page);
  await armTown(page, ['militaryhq', 'barracks', 'bunker'], { infantry: 2 });
  const [a, b] = await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const rivals = s.region.neighbours.filter((n) => n.rival);
    // Too weak to raid (a raid needs a strength of 1): only what the test does happens.
    for (const n of rivals)
      await g.dispatch({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0.5, defences: 1 });
    return rivals.map((n) => ({ id: n.id, name: n.name }));
  });

  // --- The Diplomacy tab: the neighbours, the city's reputation. ---
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-diplomacy').click();
  await expect(page.getByTestId('dip-reputation')).toHaveText('60');
  await expect(page.getByTestId(`dip-neighbour-${a!.id}`)).toContainText(a!.name);

  // --- A proposal: a non-aggression pact, answered within a couple of hours. ---
  await page.getByTestId(`dip-propose-${b!.id}`).click();
  await page.getByTestId('dip-term-kind').selectOption('nonAggression');
  await page.getByTestId('dip-term-add').click();
  await expect(page.getByTestId('dip-term-0')).toContainText('Non-aggression pact');
  await shot(page, 'm36-builder');
  await page.getByTestId('dip-send').click();
  await expect(page.getByTestId('dip-outgoing')).toContainText(b!.name);
  await page.evaluate(() => window.__game!.advance(60 * 3));
  await expect(page.getByTestId('dip-outgoing')).toHaveCount(0);
  await expect(page.getByTestId('dip-log')).toContainText(b!.name);

  // --- War, declared with a reason; it opens after the warning. ---
  await page.getByTestId(`dip-declare-${a!.id}`).click();
  await page.getByTestId('dip-scale').selectOption('war');
  await page.getByTestId('dip-reason').fill('They dammed our river');
  await page.getByTestId('dip-declare-go').click();
  await expect(page.getByTestId(`dip-war-${a!.id}`)).toContainText('opens in 12 hours');
  await expect(page.getByTestId(`dip-war-${a!.id}`)).toContainText('They dammed our river');
  await shot(page, 'm36-declared');
  await page.evaluate(() => window.__game!.advance(60 * 13));
  await expect(page.getByTestId(`dip-war-${a!.id}`)).toContainText('Score 0');

  // --- Its terms: peace for tribute. The city counters with less, then the neighbour's next terms
  // are accepted, and the war ends with tribute in the ledger. ---
  await page.evaluate(
    async ([id]) => {
      const r = await window.__game!.dispatch({
        type: 'cheat',
        cheat: 'proposal',
        neighbour: id!,
        terms: [{ k: 'peace' }, { k: 'tribute', payer: 'us', amount: 2_000, months: 12 }],
      });
      if (!r.ok) throw new Error(r.reason);
    },
    [a!.id],
  );
  const offer = page.locator('[data-testid^="dip-proposal-"]').first();
  await expect(offer).toContainText('pays $2,000 a month for 12 months');
  await shot(page, 'm36-proposal');
  await offer.locator('[data-testid^="dip-counter-"]').click();
  await page.getByTestId('dip-term-1-amount').fill('800');
  await page.getByTestId('dip-send').click();
  await expect(page.getByTestId('dip-outgoing')).toContainText('$800 a month');
  await page.evaluate(() => window.__game!.advance(60 * 3));
  // Signed, countered again, or refused: the neighbour answered by its character.
  await expect(page.getByTestId('dip-outgoing')).toHaveCount(0);
  const signed = await page.evaluate(
    ([id]) => !window.__game!.getDiplomacy()!.wars.some((w) => w.with === id),
    [a!.id],
  );
  if (!signed) {
    // Whatever it answered, it now offers peace for a small tribute, and the city accepts.
    await page.evaluate(
      async ([id]) => {
        const g = window.__game!;
        const d = g.getDiplomacy()!;
        for (const p of d.proposals.filter((x) => x.from === 'them'))
          await g.dispatch({ type: 'answerProposal', proposal: p.id, accept: false });
        const r = await g.dispatch({
          type: 'cheat',
          cheat: 'proposal',
          neighbour: id!,
          terms: [{ k: 'peace' }, { k: 'tribute', payer: 'us', amount: 600, months: 12 }],
        });
        if (!r.ok) throw new Error(r.reason);
      },
      [a!.id],
    );
    await page.locator('[data-testid^="dip-accept-"]').first().click();
  }
  await expect(page.getByTestId(`dip-war-${a!.id}`)).toHaveCount(0);
  await expect(page.getByTestId('dip-pacts')).toContainText('a month for 12 months');
  await shot(page, 'm36-treaty');
  // A month on, the tribute is in the books.
  await page.evaluate(() => window.__game!.advance(1440 * 2));
  const paid = await page.evaluate(
    async () => (await window.__game!.getLedger()).history.at(-1)?.lines.tributeOut ?? 0,
  );
  expect(paid).toBeLessThan(0);
  await expect(page.getByTestId('dip-pacts')).toContainText('paid');

  // --- Standing neutral. ---
  await page.getByTestId('dip-neutral').click();
  await expect(page.getByTestId('dip-standing')).toContainText('Neutral');
  await expect(page.getByTestId(`dip-declare-${b!.id}`)).toBeDisabled();
  await shot(page, 'm36-neutral');
  errs.check();
});
