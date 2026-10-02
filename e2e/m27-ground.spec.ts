import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, shot, watchErrors } from './helpers';
import { untilHour } from './ui';

/**
 * M27: ground, lots and streets in a real town. Empty zoned land is a faint tint with an outline
 * until the zoning tool comes out; busy junctions get zebra crossings and side roads give-way
 * lines; shopping streets get benches, bins and planters close up; and the ground's detail and
 * the street props follow the graphics quality chosen in Settings.
 */
const zones = (page: Page) => page.evaluate(() => window.__game!.getZoneLook());
const streets = (page: Page) => page.evaluate(() => window.__game!.getStreets());
const applied = (page: Page) => page.evaluate(() => window.__game!.getShell().applied);

async function quality(page: Page, q: 'low' | 'medium' | 'high'): Promise<void> {
  await page.getByTestId('menu-button').click();
  await page.getByTestId('pause-settings').click();
  await page.getByTestId(`quality-${q}`).click();
  await page.getByTestId('shell-back').click();
  await page.getByTestId('pause-resume').click();
  await page.evaluate(() => window.__game!.waitFrames(4));
}

test('M27: subtle zones until zoning, crossings at busy junctions, street furniture, and detail by quality', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errs = watchErrors(page);
  await openGame(page, '&seed=ground&preset=river&sandbox=1&disasters=0');
  await buildTownViaApi(page);
  await page.evaluate(async () => {
    const g = window.__game!;
    await g.advance(60 * 24 * 12);
    g.setWeatherLook({ season: [0, 1, 0, 0], kind: 'clear', strength: 0, snow: 0, wet: 0 });
    const s = await g.getState();
    g.setCamera({ x: 24 + 200, z: s.highwayZ + 30, distance: 150, yaw: 0.6, tilt: 0.15 });
  });
  await untilHour(page, 13);
  await page.evaluate(() => window.__game!.waitFrames(6));

  // Empty zoned land: a faint tint and an outline, not the cell-by-cell grid.
  let z = await zones(page);
  expect(z.fill.tris).toBeGreaterThan(0);
  expect(z.edge.tris).toBeGreaterThan(0);
  expect(z.fill.shown && z.edge.shown).toBe(true);
  expect(z.zoned.shown || z.grid.shown).toBe(false);

  // Busy junctions (the avenue's crossroads) are painted; the furniture is out close up.
  const st = await streets(page);
  expect(st.zebra).toBeGreaterThanOrEqual(8);
  expect(st.props).toBeGreaterThan(0);
  expect(st.propsShown).toBe(true);
  expect(await applied(page)).toMatchObject({ ground: 1 });
  await shot(page, 'm27-street');

  // The zoning tool shows every cell in full, and the zoning grid; leaving it, the subtle look.
  await page.getByTestId('tool-zone').click();
  await page.getByTestId('zone-R').click();
  await page.evaluate(() => window.__game!.waitFrames(2));
  z = await zones(page);
  expect(z.zoned.shown && z.grid.shown).toBe(true);
  expect(z.fill.shown || z.edge.shown).toBe(false);
  await shot(page, 'm27-zoning');
  await page.getByTestId('tool-select').click();
  await page.evaluate(() => window.__game!.waitFrames(2));
  z = await zones(page);
  expect(z.fill.shown && !z.zoned.shown).toBe(true);

  // From far off the furniture is put away.
  await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    g.setCamera({ x: 24 + 240, z: s.highwayZ, distance: 1600, yaw: 0.6, tilt: 0 });
    await g.waitFrames(3);
  });
  expect((await streets(page)).propsShown).toBe(false);
  await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    g.setCamera({ x: 24 + 200, z: s.highwayZ + 30, distance: 150, yaw: 0.6, tilt: 0.15 });
    await g.waitFrames(3);
  });

  // Low quality: the plain ground and no furniture; Medium and High bring them back.
  await quality(page, 'low');
  expect(await applied(page)).toMatchObject({ ground: 0 });
  expect((await streets(page)).propsShown).toBe(false);
  expect((await page.evaluate(() => window.__game!.frameStats())).lum).toBeGreaterThan(0.2);
  await quality(page, 'medium');
  expect(await applied(page)).toMatchObject({ ground: 1 });
  expect((await streets(page)).propsShown).toBe(true);
  await quality(page, 'high');
  expect(await applied(page)).toMatchObject({ ground: 1 });
  errs.check();
});
