import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, watchErrors } from './helpers';
import { frames, screen, settledHint, state } from './ui';

/** Playthrough fixes to roads (PLAYTHROUGH-FIXES.md), through the road tool. */

const buildings = (page: Page) => page.evaluate(() => window.__game!.getBuildings().length);

/** A grown town: the planned town of the other specs, served and left to grow for four months. */
async function grownTown(page: Page): Promise<number> {
  await openGame(page);
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 }));
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  await page.evaluate(() => window.__game!.advance(1440 * 4));
  return (await state(page)).highwayZ;
}

test('P2: an upgrade or a new road that demolishes buildings says how many and asks first', async ({
  page,
}) => {
  const errs = watchErrors(page);
  const cz = await grownTown(page);

  // A street whose upgrade to a boulevard can't keep every building beside it.
  const pick = await page.evaluate(async (cz) => {
    const g = window.__game!;
    for (const x of [120, 216, 312, 408])
      for (const dz of [-80, 80]) {
        const s = g.segmentAt(x, cz + dz);
        if (!s) continue;
        const r = await g.preview({ type: 'upgradeRoad', seg: s.id, road: 'boulevard' });
        const gone = r.ok ? ((r.info as { demolished?: number[] }).demolished ?? []) : [];
        if (gone.length) return { x, z: cz + dz, seg: s.id, gone: gone.length, ids: gone };
      }
    return null;
  }, cz);
  expect(pick, 'a street whose upgrade demolishes something').not.toBeNull();
  // Look between the street and what it would demolish (usually a corner lot on the avenue).
  await page.evaluate((p) => {
    const g = window.__game!;
    const b = g.getBuildings().find((x) => x.id === p.ids[0]);
    const at = b ? { x: (p.x + b.x) / 2, z: (p.z + b.z) / 2 } : p;
    g.setCamera({ ...at, distance: 260, yaw: 0, tilt: 0.75 });
  }, pick!);
  await frames(page, 2);
  await page.getByTestId('tool-road').click();
  await page.getByTestId('mode-upgrade').click();
  await page.getByTestId('road-boulevard').click();
  const p = await screen(page, pick!.x, pick!.z);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  const hint = await settledHint(page);
  // The preview counts what goes (and red boxes stand over them).
  expect(hint.text).toContain(`demolishes ${pick!.gone} building`);
  await shot(page, 'fixes-p2-upgrade-preview');

  // A click asks first; keeping them changes nothing.
  const before = { n: await buildings(page), treasury: (await state(page)).treasury };
  await page.mouse.click(p.x, p.y);
  const q = page.getByTestId('tool-question');
  await expect(q).toBeVisible();
  await expect(q).toContainText(`demolishes ${pick!.gone} building`);
  await shot(page, 'fixes-p2-upgrade-asks');
  await page.getByTestId('tool-question-no').click();
  await expect(q).toHaveCount(0);
  await frames(page, 2);
  expect(await buildings(page)).toBe(before.n);
  expect((await state(page)).treasury).toBe(before.treasury);
  expect(await page.evaluate((s) => window.__game!.segmentAt(s.x, s.z)?.type, pick!)).toBe('street');

  // Escape keeps them too, and leaves the tool out.
  await page.mouse.click(p.x, p.y);
  await expect(q).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(q).toHaveCount(0);
  await expect(page.getByTestId('tool-road')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate((s) => window.__game!.segmentAt(s.x, s.z)?.type, pick!)).toBe('street');

  // Saying yes changes the road, and exactly the buildings counted go.
  await page.mouse.move(p.x + 2, p.y, { steps: 2 });
  await settledHint(page);
  await page.mouse.click(p.x, p.y);
  await expect(q).toBeVisible();
  await page.getByTestId('tool-question-yes').click();
  await expect
    .poll(() => page.evaluate((s) => window.__game!.segmentAt(s.x, s.z)?.type, pick!))
    .toBe('boulevard');
  await expect.poll(() => buildings(page)).toBe(before.n - pick!.gone);

  // A new road through the blocks: the hint counts, a drag asks, no keeps nothing, yes builds.
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-road').click();
  await page.getByTestId('mode-straight').click();
  await page.getByTestId('road-street').click();
  // A cut along the blocks either side of the avenue that goes through some of the town.
  const cut = await page.evaluate(async (cz) => {
    const g = window.__game!;
    for (const dz of [-60, -100, -40, -130, 40, 80, 110])
      for (const [ax, bx] of [
        [40, 300],
        [160, 460],
      ]) {
        const r = await g.preview({
          type: 'buildRoad',
          road: 'street',
          points: [
            { x: ax!, z: cz + dz },
            { x: bx!, z: cz + dz },
          ],
        });
        const n = r.ok ? ((r.info as { demolished?: number[] }).demolished ?? []).length : 0;
        if (n > 0 && n < 12) return { ax: ax!, bx: bx!, rz: cz + dz, n };
      }
    return null;
  }, cz);
  expect(cut, 'a cut through the town').not.toBeNull();
  const { ax, bx, rz, n: doomed } = cut!;
  await page.evaluate(
    (c) => window.__game!.setCamera({ x: (c.ax + c.bx) / 2, z: c.rz, distance: 420, yaw: 0, tilt: 0.7 }),
    cut!,
  );
  await frames(page, 2);
  const a = await screen(page, ax, rz);
  const b = await screen(page, bx, rz);
  const drag = async () => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
    await page.mouse.move(b.x, b.y, { steps: 4 });
    await expect.poll(async () => (await settledHint(page)).text).toContain(`demolishes ${doomed} building`);
    await page.mouse.up();
  };
  const seg0 = (await state(page)).segments;
  const n0 = await buildings(page);
  await drag();
  await expect(q).toBeVisible();
  await expect(q).toContainText(`This road demolishes ${doomed} building`);
  await shot(page, 'fixes-p2-road-asks');
  await page.getByTestId('tool-question-no').click();
  await frames(page, 2);
  expect((await state(page)).segments).toBe(seg0);
  expect(await buildings(page)).toBe(n0);
  await drag();
  await expect(q).toBeVisible();
  await page.getByTestId('tool-question-yes').click();
  await expect.poll(async () => (await state(page)).segments).toBeGreaterThan(seg0);
  await expect.poll(() => buildings(page)).toBe(n0 - doomed);
  errs.check();
});
