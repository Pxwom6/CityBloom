import { expect, test } from '@playwright/test';
import { shot, watchErrors } from './helpers';
import { frames, settings, untilHour } from './ui';

/**
 * M28: buildings and variety, in a grown city loaded through the real load screen (the menu's demo
 * town). No two touching buildings look the same; every building on a lot two hand-made designs
 * fit wears one (model batch 2); every building, generated or hand-made, fades through its distant
 * versions (none is drawn at full detail from every distance); and the whole-city view draws fewer
 * triangles than the 2.75M of the start of the phase.
 */
test('M28: no identical neighbours, a distant version for every building, a lighter whole-city view', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errs = watchErrors(page);
  await settings(page);
  await page.goto('./');
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([
    page.waitForURL(/\?load=/),
    page.getByTestId('import-file').setInputFiles('public/demo.citybloom'),
  ]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  await untilHour(page, 13);

  // Side by side, never the same building twice.
  const n = await page.evaluate(() => window.__game!.getNeighbours());
  console.log(`[m28] ${n.pairs} touching pairs, ${n.identical} identical, ${n.looks} different models`);
  expect(n.pairs).toBeGreaterThan(300);
  expect(n.identical).toBe(0);
  expect(n.looks).toBeGreaterThan(200);

  // Hand-made models where they fit (model batch 2): every building on a lot two designs or more
  // fit wears one of them; on a lot one design fits, every other look.
  const worn = await page.evaluate(() => {
    const g = window.__game!;
    const designs = g.getHandDesigns().filter((d) => d.kind === 'zoned');
    const fits = (d: { w: number; d: number }, W: number, D: number) => {
      const k = Math.round(W / d.w);
      return k >= 1 && k <= 3 && Math.abs(k * d.w - W) < 0.05 && d.d <= D + 0.05;
    };
    const out = { buildings: 0, hand: 0, many: 0, manyHand: 0, one: 0, oneHand: 0 };
    for (const m of g.getModels()) {
      const n = designs.filter((d) => d.def === m.def && fits(d, m.w * 8, m.d * 8)).length;
      out.buildings++;
      if (m.hand) out.hand++;
      if (n >= 2) {
        out.many++;
        if (m.hand) out.manyHand++;
      } else if (n === 1) {
        out.one++;
        if (m.hand) out.oneHand++;
      }
    }
    return out;
  });
  console.log(`[m28] hand-made: ${JSON.stringify(worn)}`);
  expect(worn.manyHand).toBe(worn.many);
  expect(worn.many).toBeGreaterThan(500);
  expect(worn.oneHand).toBeGreaterThan(worn.one * 0.3);
  expect(worn.oneHand).toBeLessThan(worn.one);
  expect(worn.hand).toBeGreaterThan(worn.buildings * 0.8);

  // City zoom: buildings near, far and on the skyline, none drawn the old way at every distance.
  await page.evaluate(() => window.__game!.setCamera('city'));
  await frames(page, 6);
  const lod = await page.evaluate(() => window.__game!.getLod());
  console.log(`[m28] on show: ${JSON.stringify(lod.buildings)}`);
  expect(lod.buildings.plain).toBe(0);
  expect(lod.buildings.far + lod.buildings.sky).toBeGreaterThan(0);
  await shot(page, 'm28-city');

  // The whole-city view: fewer triangles than at the start of phase 3 (2.75M).
  await page.evaluate(() => window.__game!.setCamera('overview'));
  await frames(page, 8);
  const stats = await page.evaluate(async () => (await window.__game!.getState()).renderStats);
  console.log(`[m28] whole city: ${stats.calls} calls, ${(stats.triangles / 1e6).toFixed(2)}M triangles`);
  expect(stats.triangles).toBeLessThan(2_750_000);
  await shot(page, 'm28-overview');
  errs.check();
});
