import { expect, test, type Page } from '@playwright/test';
import { shot, watchErrors } from './helpers';

const screen = (page: Page, x: number, z: number) =>
  page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);

/** Drag a brush stroke through world points with the active tool. */
async function stroke(page: Page, pts: [number, number][]): Promise<void> {
  const a = await screen(page, pts[0]![0], pts[0]![1]);
  await page.mouse.move(a.x, a.y, { steps: 2 });
  await page.mouse.down();
  for (const [x, z] of pts.slice(1)) {
    const p = await screen(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 8 });
  }
  await page.mouse.up();
  await page.evaluate(() => window.__game!.waitFrames(2));
}

/** Click a world point with the active tool. */
async function clickAt(page: Page, x: number, z: number): Promise<void> {
  const p = await screen(page, x, z);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.click(p.x, p.y);
}

const districts = (page: Page) => page.evaluate(() => window.__game!.getDistricts());

test('M21: Market Town: paint and name districts, a heavy-traffic ban on Old Market, a filtered map, and a bypass that wins it', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errs = watchErrors(page);
  await page.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, tips: false, graphicsChecked: true }));
  });
  await page.goto('./?scenario=market');
  await page.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
    null,
    { timeout: 120_000 },
  );
  await expect(page.getByTestId('scenario-brief')).toContainText('Kingsmere');
  await page.getByTestId('scenario-begin').click();
  await page.evaluate(() => window.__game!.setSpeed(0));
  // The town runs east from the highway's link along one avenue: the market, then the estates.
  const c = await page.evaluate(async () => ({ x: 24, z: (await window.__game!.getState()).highwayZ }));
  const X = (dx: number) => c.x + dx;
  const Z = (dz: number) => c.z + dz;
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: X(480),
    z: Z(-120),
    distance: 950,
    yaw: 0,
    tilt: 0.8,
  });
  await page.evaluate(() => window.__game!.waitFrames(2));

  // --- The district tool opens the panel, which lists the council's Old Market. ---
  await page.keyboard.press('i');
  await expect(page.getByTestId('districts-panel')).toBeVisible();
  const start = await districts(page);
  expect(start.list.map((d) => d.name)).toEqual(['Old Market']);
  await expect(page.getByTestId('district-1')).toContainText('Old Market');

  // --- A new district over the housing estates takes the neighbourhood's name. ---
  await page.getByTestId('district-new').click();
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  const hoverAt = await screen(page, X(640), Z(-200));
  await page.mouse.move(hoverAt.x, hoverAt.y, { steps: 3 });
  // Read the hint once it has settled on the pointer's last position (it follows every move).
  const hint = async () => {
    const a = await page.getByTestId('tool-hint').textContent();
    await page.evaluate(() => window.__game!.waitFrames(3));
    return (
      a !== null && a.includes('New district: ') && a === (await page.getByTestId('tool-hint').textContent())
    );
  };
  await expect.poll(hint, { timeout: 20_000 }).toBe(true);
  const offered = (await page.getByTestId('tool-hint').textContent())!
    .match(/New district: ([^·]+) ·/)![1]!
    .trim();
  await stroke(page, [
    [X(640), Z(-200)],
    [X(880), Z(-200)],
    [X(880), Z(-420)],
    [X(640), Z(-420)],
  ]);
  await expect.poll(async () => (await districts(page)).list.length, { timeout: 30_000 }).toBe(2);
  const estates = (await districts(page)).list.find((d) => d.id !== 1)!;
  expect(estates.name).toBe(offered);
  const cellsOf = async (id: number) => (await districts(page)).list.find((d) => d.id === id)?.cells ?? 0;
  await expect.poll(() => cellsOf(estates.id)).toBeGreaterThan(150);
  await expect(page.locator('.district-label', { hasText: 'Old Market' })).toBeVisible();
  await shot(page, 'm21-paint');

  // --- Rename it in the panel. ---
  await page.getByTestId(`district-${estates.id}`).click();
  await expect(page.getByTestId('district-name')).toHaveValue(offered);
  await page.getByTestId('district-name').fill('Kingsmere Estates');
  await page.getByTestId('district-name').press('Enter');
  await expect
    .poll(async () => (await districts(page)).list.find((d) => d.id === estates.id)?.name)
    .toBe('Kingsmere Estates');
  // A high-rise ban there: it's free, and the rest of the city can still build high.
  await page.getByTestId('district-policy-highRiseBan').check();
  await expect
    .poll(async () => (await districts(page)).list.find((d) => d.id === estates.id)?.policies)
    .toEqual(['highRiseBan']);
  expect(await page.evaluate(() => window.__game!.getState().then((s) => s.policies))).not.toContain(
    'highRiseBan',
  );

  // --- Erase a corner of it; undo puts it back. ---
  await page.getByTestId('district-erase').click();
  const before = await cellsOf(estates.id);
  await stroke(page, [
    [X(860), Z(-420)],
    [X(860), Z(-360)],
  ]);
  await expect.poll(() => cellsOf(estates.id)).toBeLessThan(before);
  await page.keyboard.press('Control+z');
  await expect.poll(() => cellsOf(estates.id)).toBe(before);

  // --- Old Market: its figures and a heavy-traffic ban, at its share of the price. ---
  await page.getByTestId('district-1').click();
  await expect(page.getByTestId('district-name')).toHaveValue('Old Market');
  await expect(page.getByTestId('district-figures')).toContainText('Residents');
  await expect(page.getByTestId('district-figures')).toContainText('of the city');
  const ban = page.getByTestId('district-policy-heavyTrafficBan');
  await expect(ban).toBeEnabled();
  await ban.check();
  await expect
    .poll(async () => (await districts(page)).list.find((d) => d.id === 1)?.policies)
    .toEqual(['heavyTrafficBan']);
  await expect(page.getByTestId('district-figures')).toContainText(/Its policies\$[1-9]/, {
    timeout: 10_000,
  });
  await shot(page, 'm21-panel');

  // --- The traffic map, Old Market alone. ---
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-traffic').click();
  await expect(page.getByTestId('map-legend')).toContainText('Traffic');
  await page.getByTestId('district-filter').click();
  await expect(page.getByTestId('legend-district')).toContainText('Only Old Market');
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: X(200),
    z: Z(0),
    distance: 520,
    yaw: 0.4,
    tilt: 0.65,
  });
  await shot(page, 'm21-filtered');
  await page.getByTestId('legend-district').getByRole('button', { name: 'Whole city' }).click();
  await expect(page.getByTestId('legend-district')).toHaveCount(0);
  await page.getByTestId('map-legend').getByRole('button', { name: 'Hide data map' }).click();
  await expect(page.getByTestId('map-legend')).toHaveCount(0);

  // --- A back road south of the market for the lorries to take, drawn with the road tool. ---
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  await page.evaluate((p) => window.__game!.setCamera(p), {
    x: X(280),
    z: Z(110),
    distance: 700,
    yaw: 0,
    tilt: 0.8,
  });
  await page.evaluate(() => window.__game!.waitFrames(2));
  const roads = async () => (await page.evaluate(() => window.__game!.getState())).segments;
  const n0 = await roads();
  for (const [x, z] of [
    [40, 0],
    [40, 220],
    [520, 220],
    [520, 0],
  ] as const) {
    if (x !== 40 || z !== 0) {
      const q = await screen(page, X(x), Z(z));
      await page.mouse.move(q.x, q.y, { steps: 4 });
      await expect(page.getByTestId('tool-hint')).toContainText('$', { timeout: 20_000 });
    }
    await clickAt(page, X(x), Z(z));
  }
  await expect.poll(roads, { timeout: 30_000 }).toBeGreaterThanOrEqual(n0 + 3);
  await page.getByTestId('tool-select').click();

  // --- Play on: the lorries go round, and the market's busiest road stays under 2,500. ---
  await page.evaluate(() => window.__game!.advance(1440 * 3));
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getScenario())).summary?.status, {
      timeout: 60_000,
    })
    .toBe('won');
  const sum = (await page.evaluate(() => window.__game!.getScenario())).summary!;
  console.log(
    `[m21] Market Town won in ${sum.monthsTaken.toFixed(1)} months, ${sum.stars} stars; busiest market road ${sum.goals[0]!.value}`,
  );

  await expect(page.getByTestId('scenario-end')).toContainText('Scenario won!');
  await page.getByTestId('scenario-end').getByRole('button', { name: 'Keep playing' }).click();
  await expect(page.getByTestId('scenario-end')).toHaveCount(0);

  // --- Dissolve the estates district: the panel keeps Old Market, and the brush goes back to New. ---
  await page.keyboard.press('i');
  await page.getByTestId(`district-${estates.id}`).click();
  await expect(page.getByTestId('district-name')).toHaveValue('Kingsmere Estates');
  await page.getByTestId('district-remove').click();
  await expect.poll(async () => (await districts(page)).list.map((d) => d.name)).toEqual(['Old Market']);
  await expect(page.getByTestId('district-new')).toHaveClass(/active/);
  errs.check();
});
