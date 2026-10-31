import { expect, test, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext, openGame, watchErrors } from './helpers';
import { fightLive } from './liveRegion';

/**
 * M39 step 7 through the real UI: the region's war history in the City history panel, and a replay.
 * Two cities' headless pages (`liveRegion.ts`) fight a live battle against the local relay, so the
 * region keeps a real replay of it. A browser's city then joins the region by its code, opens the
 * panel's Region at war list, narrows it by kind and by city, presses Watch on the battle (the record
 * and Samford's town come from the region), sees the viewer play it and say the replay is checked, and
 * goes back to its city, which is still in the region with the history in hand.
 */
closeContextsAfterEach();

const known = (page: Page) => page.evaluate(() => window.__game!.getRegionHistory());

test('M39: the region’s war history lists a live battle, and Watch plays it again, checked', async ({
  browser,
}) => {
  test.setTimeout(1_200_000);
  const region = await fightLive();
  try {
    const ctx = await newContext(browser, { viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Fay', color: 3 }));
      localStorage.setItem('citybloom.fairClock', 'off');
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...s, graphicsChecked: true, tips: false, quality: 'low' }));
    });
    const fay = await ctx.newPage();
    const errs = watchErrors(fay);
    await openGame(fay, '&seed=regionfay&preset=river&name=Faytown');

    // Outside a region the panel has no region view, and says nothing of one.
    await fay.getByTestId('open-history').click();
    await expect(fay.getByTestId('history-panel')).toBeVisible();
    await expect(fay.getByTestId('history-view-region')).toBeHidden();
    await fay.getByTestId('open-history').click();

    // Fay joins the region the two cities fought in.
    await fay.keyboard.press('Shift+N');
    await fay.getByTestId('region-code').fill(region.code);
    await fay.getByTestId('region-join').click();
    await expect
      .poll(async () => (await fay.evaluate(() => window.__game!.getRegion()))?.state, {
        timeout: 120_000,
      })
      .toBe('in');
    await fay.keyboard.press('Shift+N');
    await expect.poll(async () => (await known(fay)).rows.length, { timeout: 60_000 }).toBeGreaterThan(0);

    // The region says it keeps the battle, and the history has its line, newest first.
    const h = await known(fay);
    expect(h.kept).toEqual([
      expect.objectContaining({
        id: region.replay.id,
        from: region.replay.from,
        to: region.replay.to,
        step: region.replay.step,
        hash: region.replay.hash,
      }),
    ]);
    const row = h.rows.find((r) => r.replay)!;
    expect(row, 'a history line with a replay').toBeTruthy();
    expect(row.kind).toBe('battle');

    // The panel: the city's own charts first, then the region at war.
    await fay.getByTestId('open-history').click();
    await expect(fay.getByTestId('history-charts')).toBeVisible();
    await fay.getByTestId('history-view-region').click();
    await expect(fay.getByTestId('region-history')).toBeVisible();
    await expect(fay.getByTestId('history-charts')).toBeHidden();
    await expect(fay.getByTestId(`rh-row-${row.id}`)).toContainText('Adaville');
    await expect(fay.getByTestId(`rh-row-${row.id}`)).toContainText('Samford');
    await expect(fay.getByTestId(`rh-outcome-${row.id}`)).toBeVisible();
    await expect(fay.getByTestId(`rh-watch-${row.id}`)).toBeVisible();

    // Narrowed by kind: no treaties yet; battles keep the line. By city: Faytown has none, Samford has it.
    await fay.getByTestId('rh-kind-treaties').click();
    await expect(fay.getByTestId('rh-none')).toBeVisible();
    await fay.getByTestId('rh-kind-treaties').click();
    await fay.getByTestId('rh-kind-battles').click();
    await expect(fay.getByTestId(`rh-row-${row.id}`)).toBeVisible();
    const cities = await fay.evaluate(() =>
      [...document.querySelectorAll<HTMLOptionElement>('[data-testid="rh-city"] option')].map((o) => ({
        value: o.value,
        name: o.textContent ?? '',
      })),
    );
    const own = cities.find((c) => c.name.startsWith('Faytown'))!;
    const samford = cities.find((c) => c.name.startsWith('Samford'))!;
    await fay.getByTestId('rh-city').selectOption(own.value);
    await expect(fay.getByTestId('rh-none')).toBeVisible();
    await fay.getByTestId('rh-city').selectOption(samford.value);
    await expect(fay.getByTestId(`rh-row-${row.id}`)).toBeVisible();

    // Watch: the record and the town are fetched, the viewer opens and plays the battle in Samford's town.
    await fay.getByTestId(`rh-watch-${row.id}`).click();
    await expect(fay.getByTestId('viewer-bar')).toBeVisible({ timeout: 300_000 });
    await expect(fay.getByTestId('viewer-bar')).toContainText('Adaville');
    await expect(fay.getByTestId('viewer-bar')).toContainText('Samford');
    await fay.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
    await fay.evaluate(() => window.__game!.setSpeed(3));
    // It ends where the combatants’ battle ended: the same step, the same hash.
    await expect(fay.getByTestId('viewer-check')).toContainText('Replay checked', { timeout: 300_000 });
    expect((await known(fay)).check).toEqual({
      verdict: 'checked',
      step: region.replay.step,
      want: region.replay.step,
    });

    // Back in its city, still in the region, with the history and the replay in hand.
    await fay.getByTestId('viewer-back').click();
    await fay.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
    await expect
      .poll(async () => (await fay.evaluate(() => window.__game!.getRegion()))?.state, { timeout: 300_000 })
      .toBe('in');
    await expect.poll(async () => (await known(fay)).kept.length, { timeout: 60_000 }).toBe(1);
    errs.check();
  } finally {
    region.close();
  }
});
