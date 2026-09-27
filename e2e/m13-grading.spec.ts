import { expect, test, type Page } from '@playwright/test';
import { openGame, shot, watchErrors } from './helpers';

async function state(page: Page) {
  return page.evaluate(() => window.__game!.getState());
}

async function screen(page: Page, x: number, z: number) {
  return page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
}

const edits = (page: Page) => page.evaluate(() => window.__game!.getTerrainEdits());

test('M13: a street over a ridge is graded with cuttings and embankments; extreme ground is explained', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const errs = watchErrors(page);
  // The `hill` highlands map: a ridge up to 18 m high east of the start (scripts/dev/earthshot.mjs).
  await openGame(page, '&seed=hill&preset=highlands');
  const s0 = await state(page);
  await page.evaluate(async (cz) => {
    const g = window.__game!;
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 300_000 });
    await g.dispatch({
      type: 'buildRoad',
      road: 'avenue',
      points: [
        { x: 24, z: cz },
        { x: 560, z: 1030 },
      ],
    });
    await g.dispatch({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: 560, z: 1030 },
        { x: 560, z: 1060 },
      ],
    });
  }, s0.highwayZ);
  const e0 = await edits(page);
  const s1 = await state(page);
  await page.evaluate(() => window.__game!.setCamera({ x: 700, z: 1060, distance: 460, yaw: 0, tilt: 0.55 }));
  await page.evaluate(() => window.__game!.waitFrames(2));

  // Draw the street over the ridge with the road tool: click at the junction, move to the far side.
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  const a = await screen(page, 560, 1060);
  const b = await screen(page, 840, 1060);
  await page.mouse.move(a.x, a.y);
  await page.mouse.click(a.x, a.y);
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
  await page.mouse.move(b.x, b.y, { steps: 3 });
  // The hint says how steeply it climbs against the street's limit and what the earthworks cost.
  const hint = page.getByTestId('tool-hint');
  await expect(hint).toContainText(/climbs 1\d\s% \(max 16\s%\)/, { timeout: 20_000 });
  await expect(hint).toContainText(/earthworks \$[\d,]+/);
  // The ghost is drawn at the graded height, coloured by grade, with cut and fill posts (once the
  // preview for the final cursor position is in).
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.ghostGrade())).posts, { timeout: 20_000 })
    .toBeGreaterThan(3);
  const g1 = await page.evaluate(() => window.__game!.ghostGrade());
  expect(g1.ok + g1.warn).toBeGreaterThan(50);
  expect(g1.warn).toBeGreaterThan(0);
  expect(g1.bad).toBe(0);
  await shot(page, 'm13-preview');

  await page.mouse.click(b.x, b.y);
  // (+1 more if the click snapped onto the short street and split it)
  await expect
    .poll(async () => (await state(page)).segments, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(s1.segments + 1);
  await page.getByTestId('tool-select').click();
  // The client has the reshaped ground: many more samples cut and filled, metres deep.
  await expect
    .poll(async () => (await edits(page)).edited, { timeout: 20_000 })
    .toBeGreaterThan(e0.edited + 40);
  const e1 = await edits(page);
  expect(e1.maxCut).toBeGreaterThan(3);
  expect(e1.version).toBeGreaterThan(e0.version);
  await page.evaluate(() =>
    window.__game!.setCamera({ x: 740, z: 1060, distance: 150, yaw: 0.25, tilt: 0.05 }),
  );
  await shot(page, 'm13-cutting');

  // Undo puts the ground back.
  await page.getByTestId('tool-undo').click();
  await expect.poll(async () => (await edits(page)).edited, { timeout: 20_000 }).toBe(e0.edited);
  expect((await state(page)).segments).toBe(s1.segments);

  // Extreme ground: the ghost turns red where it's too steep and the hint says by how much and
  // what would fix it.
  await page.evaluate(() => window.__game!.setCamera({ x: 940, z: 1240, distance: 420, yaw: 0, tilt: 0.55 }));
  await page.evaluate(() => window.__game!.waitFrames(2));
  await page.getByTestId('tool-road').click();
  const c = await screen(page, 860, 1240);
  const d = await screen(page, 1020, 1240);
  await page.mouse.move(c.x, c.y);
  await page.mouse.click(c.x, c.y);
  await page.mouse.move(d.x, d.y, { steps: 4 });
  await expect(hint).toContainText(/Too steep: the ground here rises \d+\s%/, { timeout: 20_000 });
  await expect(hint).toContainText(/\d+ m cutting \(14 m at most\)\. Go round the hill, or wind up it/);
  const g2 = await page.evaluate(() => window.__game!.ghostGrade());
  expect(g2.bad).toBeGreaterThan(0);
  await shot(page, 'm13-too-steep');
  await page.keyboard.press('Escape');
  await page.getByTestId('tool-select').click();
  errs.check();
});
