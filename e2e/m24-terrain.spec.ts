import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, serveTownViaApi, shot, watchErrors } from './helpers';
import { frames, openScenario, screen, settings, settledHint, state } from './ui';

const hash = (page: Page) => page.evaluate(() => window.__game!.hash());

/** The city's hash once the last brush passes are in (two reads a moment apart agree). */
async function settledHash(page: Page): Promise<string> {
  let last = await hash(page);
  for (let k = 0; k < 20; k++) {
    await page.waitForTimeout(400);
    const now = await hash(page);
    if (now === last) return now;
    last = now;
  }
  return last;
}

/** Open the terrain tool (its toolbar button toggles it off when it's already open). */
async function terrainTool(page: Page, mode: string): Promise<void> {
  if (!(await page.getByTestId('terrain-options').isVisible()))
    await page.getByTestId('tool-terrain').click();
  await page.getByTestId(`terrain-${mode}`).click();
}

/** Drag the mouse through world points (a brush stroke), holding a moment at the end. */
async function drag(page: Page, pts: [number, number][], hold = 300): Promise<void> {
  const a = await screen(page, pts[0]![0], pts[0]![1]);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (const [x, z] of pts.slice(1)) {
    const p = await screen(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 10 });
  }
  await page.waitForTimeout(hold);
  await page.mouse.up();
}

test('M24: Over the Ridge through the UI: the terrain tool cuts a pass (a drag undoes exactly), a street goes through, and the valley wins it', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errs = watchErrors(page);
  await openScenario(page, 'terraces', 'Ridgeholm');
  const hz = (await state(page)).highwayZ;
  expect((await state(page)).map?.name).toBe('Ridgeholm Hills');
  const view = { x: 760, z: hz, distance: 650, yaw: 0, tilt: 0.6 };
  await page.evaluate((p) => window.__game!.setCamera(p), view);
  await frames(page);

  // A street straight over the saddle: the road tool says it's too steep.
  const tryRoad = async (): Promise<boolean> => {
    await page.getByTestId('tool-road').click();
    await page.getByTestId('road-street').click();
    const a = await screen(page, 530, hz);
    const b = await screen(page, 1100, hz);
    await page.mouse.move(a.x, a.y);
    await page.mouse.click(a.x, a.y);
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 3 });
    await page.mouse.move(b.x, b.y, { steps: 3 });
    const h = await settledHint(page);
    if (/\bok\b/.test(h.tone)) {
      await page.mouse.click(b.x, b.y);
      await page.keyboard.press('Escape');
      await page.getByTestId('tool-select').click();
      return true;
    }
    expect(h.text).toMatch(/Too steep/);
    await page.keyboard.press('Escape');
    await page.getByTestId('tool-select').click();
    return false;
  };
  expect(await tryRoad()).toBe(false);

  // --- The terrain tool, from the toolbar. ---
  await page.getByTestId('tool-terrain').hover();
  await expect(page.getByRole('tooltip')).toContainText('Raise, lower, level or smooth');
  await terrainTool(page, 'lower');
  await expect(page.getByTestId('terrain-options')).toBeVisible();
  await page.evaluate((p) => window.__game!.setCamera(p), view);
  await frames(page);
  const mid = await screen(page, 750, hz);
  await page.mouse.move(mid.x, mid.y, { steps: 3 });
  await expect(page.getByTestId('tool-hint')).toContainText(/Lower · brush 48 m.*a pass/, {
    timeout: 20_000,
  });
  await shot(page, 'm24-terrain-tool');

  // One drag is one step, and undo puts the ground and the money back exactly.
  const h0 = await settledHash(page);
  const money0 = (await state(page)).treasury;
  await drag(page, [
    [620, hz],
    [880, hz],
  ]);
  expect(await settledHash(page)).not.toBe(h0);
  await expect.poll(async () => (await state(page)).treasury).toBeLessThan(money0);
  await page.getByTestId('tool-undo').click();
  await expect.poll(() => hash(page), { timeout: 20_000 }).toBe(h0);
  await expect(page.locator('.toast').filter({ hasText: 'Undone: lowering ground' })).toBeVisible();

  // Lower the saddle, a few drags at a time, until the street fits through.
  let through = false;
  let drags = 0;
  for (let round = 0; round < 5 && !through; round++) {
    await terrainTool(page, 'lower');
    for (let k = 0; k < 3; k++, drags++)
      await drag(
        page,
        [
          [620, hz],
          [880, hz],
        ],
        500,
      );
    await settledHash(page);
    await page.getByTestId('tool-select').click();
    through = await tryRoad();
  }
  expect(through).toBe(true);
  const spent = money0 - (await state(page)).treasury;
  console.log(
    `[m24] pass cut in ${drags} drags, and the street built, for $${spent.toLocaleString('en-US')}`,
  );
  await expect
    .poll(async () => (await page.evaluate((hz) => window.__game!.segmentAt(800, hz!), hz))?.type)
    .toBe('street');
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 760, z: hz + 260, distance: 520, yaw: 0.2, tilt: 0.35 }),
    hz,
  );
  await shot(page, 'm24-pass');

  // A quarter in the valley (as the scenario test builds it), then play on to the win. It costs
  // about $130k; holding the brush keeps digging in real time, so what the pass cost varies from
  // run to run ($190–240k), and a mayor left short borrows, as a player would.
  const before = (await state(page)).treasury;
  const { failed, loan } = await page.evaluate(async (hz) => {
    const g = window.__game!;
    const failed: string[] = [];
    let loan = 0;
    const check = (what: string, r: { ok: boolean; reason?: string }) => {
      if (!r.ok) failed.push(`${what}: ${r.reason}`);
    };
    if ((await g.getState()).treasury < 150_000) {
      const r = await g.dispatch({ type: 'takeLoan', amount: 100_000 });
      check('loan', r);
      if (r.ok) loan = 100_000;
    }
    check(
      'valley road',
      await g.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: 1100, z: hz },
          { x: 1400, z: hz },
        ],
      }),
    );
    for (let x = 1000; x <= 1400; x += 100)
      check(
        `street at x=${x}`,
        await g.dispatch({
          type: 'buildRoad',
          road: 'street',
          points: [
            { x, z: hz - 300 },
            { x, z: hz + 300 },
          ],
        }),
      );
    for (const [zone, dz, radius] of [
      ['R', -170, 110],
      ['C', 0, 35],
      ['R', 150, 70],
      ['I', 260, 45],
    ] as const)
      await g.dispatch({
        type: 'zone',
        zone,
        area: {
          kind: 'brush',
          points: [
            { x: 960, z: hz + dz },
            { x: 1420, z: hz + dz },
          ],
          radius,
        },
      });
    const place = async (def: string, near: { x: number; z: number }) => {
      if ((await g.placeCivic(def, near)) === null) failed.push(`no room or money for ${def}`);
    };
    await place('pump', { x: 1400, z: hz + 60 });
    await place('septic', { x: 1000, z: hz + 200 });
    for (const def of ['firestation', 'police', 'clinic', 'primary'])
      await place(def, { x: 1050, z: hz - 60 });
    for (let k = 0; k < 4; k++) await place('wind', { x: 1150, z: hz + 290 });
    return { failed, loan };
  }, hz);
  expect(failed).toEqual([]);
  const cost = before + loan - (await state(page)).treasury;
  console.log(
    `[m24] $${before.toLocaleString('en-US')} left after the pass, ${loan ? `a $${loan.toLocaleString('en-US')} loan, ` : ''}the valley quarter cost $${cost.toLocaleString('en-US')}`,
  );
  for (let m = 0; m < 6; m++) {
    if ((await page.evaluate(() => window.__game!.getScenario())).summary?.status !== 'playing') break;
    await page.evaluate(() => window.__game!.advance(720));
    await page.evaluate(() => window.__game!.advance(720));
  }
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getScenario())).summary?.status, {
      timeout: 60_000,
    })
    .toBe('won');
  const sum = (await page.evaluate(() => window.__game!.getScenario())).summary!;
  console.log(
    `[m24] Over the Ridge won in ${sum.monthsTaken.toFixed(1)} months, ${sum.stars} stars, ${(await state(page)).population} residents`,
  );
  await page.getByTestId('scenario-end').getByRole('button', { name: 'Keep playing' }).click();
  errs.check();
});

test('M24: the map editor from the main menu: brushes, entries, the check, save and export, then a city on the map', async ({
  page,
}) => {
  test.setTimeout(900_000);
  const errs = watchErrors(page);
  await settings(page);
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 120_000,
  });
  await page.getByTestId('main-editor').click();
  await expect(page.getByTestId('maps-screen')).toBeVisible();
  await page.getByTestId('maps-base-flat').click();
  await page.getByTestId('maps-name').fill('Flatwater');
  await page.getByTestId('maps-new').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'editor', null, {
    timeout: 120_000,
  });
  await expect(page.getByTestId('editor-bar')).toBeVisible();
  await expect(page.getByTestId('editor-name')).toHaveValue('Flatwater');
  await page.evaluate(() =>
    window.__game!.setCamera({ x: 1024, z: 1024, distance: 2600, yaw: 0, tilt: 1.1 }),
  );
  await frames(page);

  // Brushes: a bay, a river, a hill, a wood, ore in the hill.
  await page.getByTestId('brush-sea').hover();
  await expect(page.getByRole('tooltip')).toContainText('Deep water');
  await page.getByTestId('brush-sea').click();
  await page.getByTestId('editor-radius').fill('256');
  await drag(
    page,
    [
      [2000, 1300],
      [2000, 2000],
      [1500, 2000],
    ],
    1200,
  );
  const h1 = await settledHash(page);
  await page.getByTestId('brush-water').click();
  await page.getByTestId('editor-radius').fill('48');
  const river: [number, number][] = [
    [1300, 250],
    [1250, 700],
    [1500, 1500],
  ];
  await drag(page, river, 800);
  expect(await settledHash(page)).not.toBe(h1);
  // Undo takes the whole river back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => hash(page), { timeout: 20_000 }).toBe(h1);
  await drag(page, river, 800);
  await page.getByTestId('brush-raise').click();
  await page.getByTestId('editor-radius').fill('160');
  await page.getByTestId('editor-strength').fill('3');
  await drag(
    page,
    [
      [500, 300],
      [600, 350],
    ],
    2500,
  );
  await page.getByTestId('brush-forest').click();
  await drag(
    page,
    [
      [300, 1500],
      [700, 1800],
    ],
    800,
  );
  await page.getByTestId('brush-ore').click();
  await expect(page.getByTestId('map-legend')).toContainText('Ore and oil');
  await drag(
    page,
    [
      [500, 300],
      [560, 320],
    ],
    1200,
  );
  // The highway comes in further north.
  await page.getByTestId('entry-highway').click();
  // Close in over the west edge, as a player would to put it just so.
  await page.evaluate(() => window.__game!.setCamera({ x: 250, z: 800, distance: 700, yaw: 0, tilt: 1.1 }));
  await frames(page);
  const e = await screen(page, 30, 800);
  await page.mouse.click(e.x, e.y);
  await expect
    .poll(async () => Math.abs(((await state(page)).map?.highwayZ ?? 0) - 800), { timeout: 20_000 })
    .toBeLessThan(80);
  await page.getByTestId('brush-raise').click();
  await page.evaluate(() =>
    window.__game!.setCamera({ x: 1024, z: 1100, distance: 2300, yaw: 0, tilt: 0.9 }),
  );
  await frames(page);
  await expect(page.getByTestId('editor-status')).toContainText('Playable', { timeout: 20_000 });
  await page.getByTestId('editor-status').click();
  await expect(page.getByTestId('editor-check')).toContainText('Playable');
  await expect(page.getByTestId('editor-start')).toContainText('ha');
  await shot(page, 'm24-editor');
  await page.getByTestId('editor-status').click();

  // Save, and export the file.
  await page.getByTestId('editor-save').click();
  await expect(page.locator('.toast').filter({ hasText: 'playable' })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByTestId('editor-export').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Flatwater.citymap');
  const path = test.info().outputPath('Flatwater.citymap');
  await file.saveAs(path);

  // Back to the menu; the map is on the new-city screen, and the file opens there too.
  await page.getByTestId('editor-exit').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 120_000,
  });
  await page.getByTestId('main-new').click();
  const mine = page.locator('[data-testid^="newmap-m"]').filter({ hasText: 'Flatwater' });
  await expect(mine).toHaveCount(1);
  await page.getByTestId('newmap-input').setInputFiles(path);
  await expect(page.locator('[data-testid^="newmap-m"]').filter({ hasText: 'Flatwater' })).toHaveCount(2);
  await mine.first().click();
  await expect(page.getByTestId('new-seed')).toHaveValue('Flatwater');
  await shot(page, 'm24-new-city');
  await page.getByTestId('new-name').fill('Flatwater Town');
  await page.getByTestId('new-tutorial').uncheck();
  await page.getByTestId('new-start').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 120_000,
  });
  await page.evaluate(() => window.__game!.setSpeed(0));
  const st = await state(page);
  expect(st.cityName).toBe('Flatwater Town');
  expect(st.map?.name).toBe('Flatwater');
  expect(Math.abs(st.highwayZ - 800)).toBeLessThan(80);
  // The town grows on the map.
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  await page.evaluate(() => window.__game!.advance(1440 * 2));
  await expect.poll(async () => (await state(page)).population, { timeout: 60_000 }).toBeGreaterThan(300);
  await page.evaluate(
    (z) => window.__game!.setCamera({ x: 400, z, distance: 1100, yaw: 0.6, tilt: 0.25 }),
    st.highwayZ,
  );
  await shot(page, 'm24-city');
  console.log(`[m24] Flatwater Town: ${(await state(page)).population} residents`);
  errs.check();
});
