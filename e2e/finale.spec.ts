import { expect, test, type Page } from '@playwright/test';
import { skipGraphicsCheck, watchErrors } from './helpers';

/**
 * The end of phase 2: a playthrough through the real UI that uses the new features. A map made in
 * the map editor (M24) from the main menu; a city founded on it from the new-city screen; roads
 * (one of them one-way, M19), zones, power and water placed with the mouse; the terrain tool
 * levelling a hillside for more homes (M24); undo (M14); a district with a policy (M21); a power
 * deal with a neighbour (M23); the weather panel (M22); city history and photo mode (M16); then
 * save, quit and continue. Only game time is fast-forwarded (through the test API).
 * Screenshots: docs/screenshots/final-*.png. Run with `npm run finale`.
 */
type State = Awaited<ReturnType<NonNullable<Window['__game']>['getState']>>;

const state = (page: Page): Promise<State> => page.evaluate(() => window.__game!.getState());

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => window.__game!.waitFrames(3));
  await page.screenshot({ path: `docs/screenshots/final-${name}.png` });
}

async function screenAt(page: Page, x: number, z: number) {
  const p = await page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
  const hit = await page.evaluate(([sx, sy]) => document.elementFromPoint(sx!, sy!)?.id ?? '', [p.x, p.y]);
  return { ...p, onMap: hit === 'scene' };
}

async function at(page: Page, x: number, z: number) {
  const p = await screenAt(page, x, z);
  expect(p.onMap, `(${x}, ${z}) is at screen ${Math.round(p.x)},${Math.round(p.y)}, under the UI`).toBe(true);
  return p;
}

/** Drag the mouse through ground points (a road, or a brush stroke), holding at the end. */
async function drag(page: Page, points: [number, number][], hold = 300): Promise<void> {
  let p = await at(page, points[0]![0], points[0]![1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (const [x, z] of points.slice(1)) {
    p = await at(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.waitForTimeout(hold);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Place a building from a toolbar menu, trying spots beside the roads until one takes it. */
async function place(page: Page, category: string, def: string, spots: [number, number][]): Promise<boolean> {
  const s0 = await state(page);
  const button = page.getByTestId(`place-${def}`);
  if (!(await page.getByTestId('place-options').isVisible()) || !(await button.isVisible()))
    await page.getByTestId(`tool-${category}`).click();
  if (await button.isDisabled()) return false;
  await button.click();
  for (const [x, z] of spots) {
    const p = await screenAt(page, x, z);
    if (!p.onMap) continue;
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(150);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
    if ((await state(page)).civics > s0.civics) return true;
  }
  return false;
}

async function closeTips(page: Page, seen: string[]): Promise<void> {
  const tip = page.getByTestId('tip');
  if (await tip.isVisible()) {
    seen.push((await tip.innerText()).split('\n').join(' '));
    await page.getByTestId('tip-ok').click();
  }
}

test('finale: a map from the editor, a city on it, and the phase-2 tools through the UI @playthrough @finale', async ({
  page,
}) => {
  test.setTimeout(30 * 60_000);
  const errs = watchErrors(page);
  const tips: string[] = [];
  const log = (msg: string) => console.log(`[finale] ${msg}`);
  await skipGraphicsCheck(page);
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 90_000,
  });

  // --- The map editor: a river valley reshaped, with a bay, a wooded ridge and ore in it. ---
  await page.getByTestId('main-editor').click();
  await page.getByTestId('maps-base-river').click();
  await page.getByTestId('maps-seed').fill('kestrel');
  await page.getByTestId('maps-name').fill('Kestrel Vale');
  await page.getByTestId('maps-new').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'editor', null, {
    timeout: 120_000,
  });
  const m0 = (await state(page)).map!;
  log(`editor: highway at z ${m0.highwayZ}, railway ${m0.railZ}`);
  await page.evaluate(() =>
    window.__game!.setCamera({ x: 1024, z: 1024, distance: 2600, yaw: 0, tilt: 1.1 }),
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  await page.getByTestId('brush-sea').click();
  await page.getByTestId('editor-radius').fill('256');
  await drag(
    page,
    [
      [1950, 1350],
      [1950, 1750],
      [1650, 1750],
    ],
    1200,
  );
  await page.getByTestId('brush-raise').click();
  await page.getByTestId('editor-radius').fill('176');
  await page.getByTestId('editor-strength').fill('2');
  await drag(
    page,
    [
      [700, 420],
      [1000, 460],
    ],
    2000,
  );
  await page.getByTestId('brush-smooth').click();
  await drag(
    page,
    [
      [700, 420],
      [1000, 460],
    ],
    600,
  );
  await page.getByTestId('brush-forest').click();
  await drag(
    page,
    [
      [650, 420],
      [1050, 460],
    ],
    800,
  );
  await page.getByTestId('brush-ore').click();
  await drag(
    page,
    [
      [800, 430],
      [900, 450],
    ],
    1000,
  );
  await page.getByTestId('brush-raise').click();
  await expect(page.getByTestId('editor-status')).toContainText('Playable', { timeout: 20_000 });
  await page.getByTestId('editor-status').click();
  await shot(page, 'editor');
  await page.getByTestId('editor-status').click();
  await page.getByTestId('editor-save').click();
  await expect(page.locator('.toast').filter({ hasText: 'playable' })).toBeVisible();
  await page.getByTestId('editor-exit').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 120_000,
  });

  // --- A new city on the map, from the new-city screen. ---
  await page.getByTestId('main-new').click();
  await page.locator('[data-testid^="newmap-m"]').filter({ hasText: 'Kestrel Vale' }).click();
  await page.getByTestId('new-name').fill('Kestrelford');
  await page.getByTestId('difficulty-easy').click();
  await page.getByTestId('new-tutorial').uncheck();
  await shot(page, 'new-city');
  await page.getByTestId('new-start').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 120_000,
  });
  await page.keyboard.press('Space');
  const s0 = await state(page);
  expect(s0.map?.name).toBe('Kestrel Vale');
  const cz = s0.highwayZ;
  log(`Kestrelford: $${s0.treasury}, highway at z ${cz}, climate ${s0.map?.climate}`);
  const topDown = async () => {
    await page.evaluate(
      (cz) => window.__game!.setCamera({ x: 290, z: cz + 50, distance: 700, yaw: 0, tilt: 0.55 }),
      cz,
    );
    await page.evaluate(() => window.__game!.waitFrames(2));
  };
  await topDown();

  // Roads: an avenue, four side streets, a service road (one-way, drawn with O) and a utility road.
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-avenue').click();
  await drag(page, [
    [24, cz],
    [264, cz],
    [504, cz],
  ]);
  await page.getByTestId('road-street').click();
  for (const x of [120, 216, 312, 408])
    await drag(page, [
      [x, cz - 160],
      [x, cz],
      [x, cz + 160],
    ]);
  await page.keyboard.press('o');
  await drag(page, [
    [120, cz - 160],
    [264, cz - 160],
    [408, cz - 160],
  ]);
  await page.keyboard.press('o');
  await drag(page, [
    [504, cz],
    [760, cz],
  ]);
  await page.getByTestId('tool-select').click();
  const s1 = await state(page);
  log(`roads: ${s1.segments - s0.segments} segments for $${s0.treasury - s1.treasury}`);
  expect(s1.segments).toBeGreaterThanOrEqual(s0.segments + 15);
  expect(await page.evaluate((cz) => window.__game!.segmentAt(190, cz - 160)?.oneway, cz)).toBeTruthy();

  // Zones, with Shift-click filling each block.
  await page.getByTestId('tool-zone').click();
  const fill = async (zone: string, spots: [number, number][]) => {
    await page.getByTestId(`zone-${zone}`).click();
    for (const [x, z] of spots) {
      const p = await at(page, x, z);
      await page.mouse.move(p.x, p.y, { steps: 2 });
      await page.keyboard.down('Shift');
      await page.mouse.click(p.x, p.y);
      await page.keyboard.up('Shift');
    }
  };
  await fill('R', [
    [120, cz - 80],
    [216, cz - 80],
    [312, cz - 80],
    [408, cz - 80],
    [120, cz + 80],
    [216, cz + 80],
  ]);
  await fill('C', [
    [72, cz],
    [168, cz],
    [264, cz],
  ]);
  await fill('I', [
    [312, cz + 80],
    [408, cz + 80],
  ]);
  await page.getByTestId('tool-select').click();

  // Power, water and sewage by the utility road.
  const east: [number, number][] = [530, 560, 590, 620, 650, 680, 710, 740].flatMap((x) => [
    [x, cz - 30],
    [x, cz + 30],
  ]);
  const north: [number, number][] = [140, 170, 200, 230, 260, 290, 320, 350, 380].map((x) => [x, cz - 190]);
  expect(await place(page, 'power', 'wind', east)).toBe(true);
  expect(await place(page, 'power', 'wind', east)).toBe(true);
  expect(await place(page, 'water', 'pump', north)).toBe(true);
  expect(await place(page, 'water', 'septic', east)).toBe(true);
  await page.getByTestId('tool-select').click();
  for (let m = 0; m < 3; m++) {
    await page.evaluate(() => window.__game!.advance(1440));
    await closeTips(page, tips);
  }
  let s = await state(page);
  log(`three months: pop ${s.population}, $${s.treasury}, approval ${s.approval}`);
  expect(s.population).toBeGreaterThan(200);

  // --- The terrain tool: level a slope north of the service road, then a street and homes on it. ---
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 300, z: cz - 330, distance: 520, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  await page.keyboard.press('Shift+T');
  await expect(page.getByTestId('terrain-options')).toBeVisible();
  await page.getByTestId('terrain-level').click();
  const money = (await state(page)).treasury;
  for (const z of [cz - 250, cz - 300, cz - 350])
    await drag(
      page,
      [
        [140, z],
        [400, z],
      ],
      500,
    );
  await page.getByTestId('tool-select').click();
  s = await state(page);
  log(`levelled north of town for $${money - s.treasury}`);
  expect(s.treasury).toBeLessThan(money);
  await shot(page, 'terrain');
  // Back up to see the service road and the levelled ground together.
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 260, z: cz - 280, distance: 760, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  await drag(page, [
    [264, cz - 160],
    [264, cz - 390],
  ]);
  // A second street, taken back with undo (Ctrl+Z).
  const beforeUndo = (await state(page)).segments;
  await drag(page, [
    [120, cz - 160],
    [120, cz - 330],
  ]);
  await expect.poll(async () => (await state(page)).segments).toBeGreaterThan(beforeUndo);
  await page.getByTestId('tool-select').click();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await state(page)).segments).toBe(beforeUndo);
  await page.getByTestId('tool-zone').click();
  await fill('R', [
    [230, cz - 280],
    [300, cz - 280],
  ]);
  await page.getByTestId('tool-select').click();

  // --- A district over the old town, with a policy of its own. ---
  await page.keyboard.press('i');
  // The Districts panel opens on the left: look at the town from further west.
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 120, z: cz, distance: 700, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
  await page.getByTestId('district-new').click();
  await drag(
    page,
    [
      [200, cz - 120],
      [420, cz - 120],
      [420, cz + 120],
      [200, cz + 120],
    ],
    300,
  );
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getDistricts())).list.length)
    .toBe(1);
  const d = (await page.evaluate(() => window.__game!.getDistricts())).list[0]!;
  await page.getByTestId(`district-${d.id}`).click();
  await page.getByTestId('district-policy-heritage').check();
  await shot(page, 'district');
  await page.keyboard.press('i');

  // Grow on, keeping power and water up.
  for (let m = 0; m < 4; m++) {
    await page.evaluate(() => window.__game!.advance(1440));
    await closeTips(page, tips);
    s = await state(page);
    await topDown();
    const u = s.utilities;
    if (u.power.supply < u.power.demand * 1.2 + 10) await place(page, 'power', 'wind', east);
    if (u.water.supply < u.water.demand * 1.2 + 10) await place(page, 'water', 'pump', north);
    if (u.sewage.supply < u.sewage.demand * 1.2 + 10) await place(page, 'water', 'septic', east);
    await page.getByTestId('tool-select').click();
  }
  s = await state(page);
  log(`seven months: pop ${s.population}, $${s.treasury}, approval ${s.approval}`);

  // --- The region: buy some power from the neighbour that sells it. ---
  await page.getByTestId('open-region').click();
  await expect(page.getByTestId('region-panel')).toBeVisible();
  const seller = s.region.neighbours.find((n) => n.offers.buy.power > 0);
  if (seller) {
    const amount = Math.max(1, Math.min(seller.offers.buy.power, 20));
    await page.getByTestId(`deal-${seller.id}-buy-power`).scrollIntoViewIfNeeded();
    await page.getByTestId(`deal-${seller.id}-buy-power-amount`).fill(String(amount));
    await page.getByTestId(`deal-${seller.id}-buy-power-sign`).click();
    await expect.poll(async () => (await state(page)).region.deals.length).toBe(1);
    log(`bought ${amount} MW from ${seller.name}`);
  }
  await shot(page, 'region');
  await page.getByTestId('open-region').click();

  // --- Weather, history and a photo. ---
  await page.getByTestId('weather').click();
  await expect(page.getByTestId('weather-panel')).toBeVisible();
  await shot(page, 'weather');
  await page.getByTestId('weather').click();
  await page.getByTestId('open-history').click();
  await expect(page.getByTestId('history-panel')).toBeVisible();
  await shot(page, 'history');
  await page.getByTestId('open-history').click();
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 300, z: cz - 60, distance: 380, yaw: 2.4, tilt: -0.05 }),
    cz,
  );
  await page.keyboard.press('k');
  await expect.poll(() => page.evaluate(() => !!window.__game!.getPhoto())).toBe(true);
  await page.evaluate(() => window.__game!.setPhoto({ hour: 18.5 }));
  await shot(page, 'photo');
  await page.keyboard.press('k');

  // --- Save, quit to the menu, and carry on. ---
  const pop = (await state(page)).population;
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-save')).toBeVisible();
  await page.getByTestId('pause-save').click();
  await page.getByTestId('save-name').fill('Kestrelford');
  await page.getByTestId('save-new').click();
  await expect(page.getByTestId('toast').first()).toContainText('Saved');
  await page.getByTestId('pause-quit').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 90_000,
  });
  await page.getByTestId('main-continue').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 90_000,
  });
  const back = await state(page);
  expect(back.population).toBe(pop);
  expect(back.map?.name).toBe('Kestrel Vale');
  log(
    `continued: ${back.cityName}, ${back.population} residents on ${back.map?.name}; tips seen: ${tips.join(' | ') || 'none'}`,
  );
  errs.check();
});
