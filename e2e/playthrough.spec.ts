import { expect, test, type Page } from '@playwright/test';
import { skipGraphicsCheck, watchErrors } from './helpers';

/**
 * Final playthrough (M12): a new player's first city, start to finish through the real UI. The main
 * menu, the new-city screen and the tutorial; roads, zones, utilities and services placed with the
 * mouse and paid for from the city's own money; the budget, advisors and data maps; a disaster;
 * then save, quit to the menu and continue. Only game time is fast-forwarded (through the test
 * API). Screenshots: docs/screenshots/m12-play-*.png. Run with `npm run playthrough`.
 */
type State = Awaited<ReturnType<NonNullable<Window['__game']>['getState']>>;

const state = (page: Page): Promise<State> => page.evaluate(() => window.__game!.getState());

async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => window.__game!.waitFrames(3));
  await page.screenshot({ path: `docs/screenshots/m12-play-${name}.png` });
}

/** Screen position of a ground point, and whether it's on the map (not under a panel or toolbar). */
async function screenAt(page: Page, x: number, z: number) {
  const p = await page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
  const hit = await page.evaluate(([sx, sy]) => document.elementFromPoint(sx!, sy!)?.id ?? '', [p.x, p.y]);
  return { ...p, onMap: hit === 'scene' };
}

/** Screen position of a ground point that must be on the map. */
async function at(page: Page, x: number, z: number) {
  const p = await screenAt(page, x, z);
  expect(p.onMap, `(${x}, ${z}) is at screen ${Math.round(p.x)},${Math.round(p.y)}, under the UI`).toBe(true);
  return p;
}

/** Look down over the town site, as a player would before building (clear of the toolbars). */
async function topDown(page: Page, cz: number): Promise<void> {
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 290, z: cz + 50, distance: 700, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
}

/** Contextual tips pop up as the town hits problems; read and close them. */
async function closeTips(page: Page, seen: string[]): Promise<void> {
  const tip = page.getByTestId('tip');
  if (await tip.isVisible()) {
    seen.push((await tip.innerText()).split('\n').join(' '));
    await page.getByTestId('tip-ok').click();
  }
}

/** Drag the road tool along points; returns why not if nothing was built. */
async function drag(page: Page, points: [number, number][]): Promise<string | null> {
  const before = (await state(page)).segments;
  let p = await at(page, points[0]![0], points[0]![1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  let hint = '';
  for (const [x, z] of points.slice(1)) {
    p = await at(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 5 });
    const h = page.getByTestId('tool-hint');
    if (await h.isVisible()) hint = await h.innerText();
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  if ((await state(page)).segments > before) return null;
  return `${JSON.stringify(points)} at screen ${Math.round(p.x)},${Math.round(p.y)}: ${hint || 'no hint'}`;
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

/** Run the clock for a while, a month at a time, closing any tips that come up. */
async function play(page: Page, months: number, tips: string[]): Promise<State> {
  for (let m = 0; m < months; m++) {
    await page.evaluate(() => window.__game!.advance(1440));
    await closeTips(page, tips);
  }
  return state(page);
}

test('playthrough: a first city from the main menu to a thriving town @playthrough', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const errs = watchErrors(page);
  const tips: string[] = [];
  const log = (msg: string) => console.log(`[playthrough] ${msg}`);

  // Main menu over the demo town.
  await skipGraphicsCheck(page);
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 90_000,
  });
  await shot(page, 'menu');

  // A new city on the river map, normal difficulty, with the tutorial.
  await page.getByTestId('main-new').click();
  await page.getByTestId('new-name').fill('Maplewood');
  await page.getByTestId('preset-river').click();
  // A fixed seed keeps the run repeatable (tests/terrain.test.ts checks any seed takes this layout).
  await page.getByTestId('new-seed').fill('maplewood');
  await expect(page.getByTestId('new-tutorial')).toBeChecked();
  await page.getByTestId('new-start').click();
  await expect(page.getByTestId('topbar')).toBeVisible({ timeout: 90_000 });
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play');
  const s0 = await state(page);
  const cz = s0.highwayZ;
  log(`new city: $${s0.treasury}, highway at z ${cz}`);
  await expect(page.getByTestId('tutorial')).toContainText('Welcome');
  await page.getByTestId('tutorial-next').click();

  // Roads: an avenue off the highway and four side streets across it, then (unzoned) a service road
  // along the streets' north ends and a utility road past the avenue's east end, so there's room
  // for services and plants once the zones fill up.
  await expect(page.getByTestId('tutorial')).toContainText('Lay a road');
  await topDown(page, cz);
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-avenue').click();
  const failed: string[] = [];
  const road = async (points: [number, number][]) => {
    const why = await drag(page, points);
    if (why) failed.push(why);
  };
  await road([
    [24, cz],
    [264, cz],
    [504, cz],
  ]);
  await page.getByTestId('road-street').click();
  for (const x of [120, 216, 312, 408])
    await road([
      [x, cz - 160],
      [x, cz],
      [x, cz + 160],
    ]);
  await road([
    [120, cz - 160],
    [264, cz - 160],
    [408, cz - 160],
  ]);
  await road([
    [504, cz],
    [760, cz],
  ]);
  if (failed.length) await page.screenshot({ path: 'test-results/playthrough-roads.png' });
  expect(failed, failed.join('\n')).toEqual([]);
  const s1 = await state(page);
  expect(s1.segments).toBeGreaterThanOrEqual(s0.segments + 17);
  log(`roads: ${s1.segments - s0.segments} segments for $${s0.treasury - s1.treasury}`);
  await page.getByTestId('tool-select').click();

  // Zones: homes to the north and south-west, shops on the avenue, industry to the south-east.
  await expect(page.getByTestId('tutorial')).toContainText('Zone homes');
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
  await expect(page.getByTestId('tutorial')).toContainText('Jobs and shops');
  await fill('C', [
    [72, cz],
    [168, cz],
    [264, cz],
  ]);
  await fill('I', [
    [312, cz + 80],
    [408, cz + 80],
  ]);
  const s2 = await state(page);
  log(`zoned R ${s2.zoned.R}, C ${s2.zoned.C}, I ${s2.zoned.I}`);
  expect(s2.zoned.R).toBeGreaterThan(100);
  await page.getByTestId('tool-select').click();
  await shot(page, 'zoned');

  // Where things go: plants, tanks and the landfill on the utility road; pumps and services on the
  // service road, upwind of industry (both sides of each road).
  const sides = (xs: number[], z: number, off: number): [number, number][] =>
    xs.flatMap((x) => [
      [x, z - off],
      [x, z + off],
    ]);
  const east = sides([530, 560, 590, 620, 650, 680, 710, 740], cz, 30);
  const north = sides([140, 170, 200, 230, 260, 290, 320, 350, 380], cz - 160, 30).filter(
    ([, z]) => z < cz - 160,
  );

  // Power, water and sewage, as the tutorial asks.
  await expect(page.getByTestId('tutorial')).toContainText('Power');
  expect(await place(page, 'power', 'wind', east)).toBe(true);
  expect(await place(page, 'power', 'wind', east)).toBe(true);
  await expect(page.getByTestId('tutorial')).toContainText('Water');
  expect(await place(page, 'water', 'pump', north)).toBe(true);
  expect(await place(page, 'water', 'septic', east)).toBe(true);
  await page.getByTestId('tool-select').click();

  // Let time run until the first families arrive; the tutorial's last card points at the advisors.
  // (The step ticks itself off if the first families have already arrived while we built.)
  await expect(page.getByTestId('tutorial')).toContainText(/Let time run|Keep the city happy/);
  await page.getByTestId('speed-1').click();
  await page.evaluate(() => window.__game!.advance(600));
  await expect(page.getByTestId('tutorial')).toContainText('Keep the city happy', { timeout: 30_000 });
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
  await page.keyboard.press('Space');
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 250, z: cz, distance: 420, yaw: 0.5, tilt: 0 }),
    cz,
  );
  await shot(page, 'first-homes');
  log(`first homes: pop ${(await state(page)).population}`);

  // Keep the utilities ahead of demand, as the advisors ask.
  const keepUp = async (s: State) => {
    await topDown(page, cz);
    const u = s.utilities;
    const report = (what: string, ok: boolean) =>
      log(`month ${month(s)}: ${what} ${ok ? 'added' : 'no room/money'}`);
    if (u.power.supply < u.power.demand * 1.2 + 10)
      report(
        'power',
        await place(page, 'power', s.population > 800 && s.treasury > 20_000 ? 'coal' : 'wind', east),
      );
    if (u.water.supply < u.water.demand * 1.2 + 10)
      report('water', await place(page, 'water', 'pump', north));
    if (u.sewage.supply < u.sewage.demand * 1.2 + 10)
      report('sewage', await place(page, 'water', 'septic', east));
    await page.getByTestId('tool-select').click();
  };
  const month = (s: State) => Math.floor(s.tick / 1440);

  // Services as the town grows, with a loan from the budget panel to pay for the first few.
  const services: [string, string, [number, number][]][] = [
    ['parks', 'park_small', north],
    ['garbage', 'landfill', east],
    ['fire', 'firestation', north],
    ['health', 'clinic', north],
    ['education', 'primary', north],
    ['police', 'police', north],
  ];
  const placeServices = async (s: State) => {
    for (let k = 0; k < services.length;) {
      const [cat, def, where] = services[k]!;
      if ((await state(page)).treasury < 14_000) break;
      if (await place(page, cat, def, where)) {
        log(`month ${month(s)}: placed ${def}`);
        services.splice(k, 1);
      } else k++;
    }
    await page.getByTestId('tool-select').click();
  };
  let s = await play(page, 3, tips);
  log(`month 3: pop ${s.population}, $${s.treasury}, net ${s.netMonthly}/mo, approval ${s.approval}`);
  let borrowed = false;
  while (month(s) < 11) {
    await keepUp(s);
    if (!borrowed && s.treasury < 20_000 && s.netMonthly > 0) {
      await page.getByTestId('open-budget').click();
      await page.getByTestId('budget-tab-loans').click();
      await page.getByTestId('loan-25000').click();
      await page.getByTestId('open-budget').click();
      borrowed = true;
      log(`month ${month(s)}: borrowed $25,000`);
    }
    await placeServices(s);
    s = await play(page, 1, tips);
  }

  // A year in: the town has grown, pays its way and people are mostly happy.
  s = await play(page, Math.max(0, 12 - month(s)), tips);
  await keepUp(s);
  log(
    `year 1: pop ${s.population}, $${s.treasury}, net ${s.netMonthly}/mo, approval ${s.approval}, ` +
      `jobs ${s.jobsFilled}/${s.jobs}, abandoned ${s.abandoned}, still to build: ${services.map((x) => x[1]).join(', ') || 'none'}`,
  );
  expect(s.population).toBeGreaterThan(600);
  expect(s.approval).toBeGreaterThan(0.5);
  expect(s.netMonthly).toBeGreaterThan(0);
  expect(s.abandoned).toBeLessThan(10);
  const year1 = s.population;
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 260, z: cz - 20, distance: 520, yaw: 0.6, tilt: 0 }),
    cz,
  );
  await shot(page, 'year-1');
  // The homes, shops and factories are really drawn, not just their shadows.
  expect(await page.evaluate(() => window.__game!.drawnPixels('buildings'))).toBeGreaterThan(200);
  expect(await page.evaluate(() => window.__game!.drawnPixels('civics'))).toBeGreaterThan(20);

  // The budget, the advisors and a data map, through the top bar and toolbar.
  await page.getByTestId('open-budget').click();
  await expect(page.getByTestId('budget')).toBeVisible();
  await shot(page, 'budget');
  await page.getByTestId('open-budget').click();
  await page.getByTestId('open-advisors').click();
  await shot(page, 'advisors');
  await page.getByTestId('open-advisors').click();
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-happiness').click();
  await expect(page.getByTestId('map-legend')).toBeVisible();
  await shot(page, 'happiness-map');
  await page.getByTestId('map-legend').getByRole('button').click();

  // Another year (finishing the services), then a tornado through the edge of town, and the clean-up.
  for (let q = 0; q < 4; q++) {
    s = await play(page, 3, tips);
    await keepUp(s);
    await placeServices(s);
  }
  log(`year 2: pop ${s.population}, $${s.treasury}, net ${s.netMonthly}/mo, approval ${s.approval}`);
  expect(s.population).toBeGreaterThan(year1);
  await page.getByTestId('tool-disasters').click();
  await page.getByTestId('disaster-tornado').click();
  const hit = await at(page, 400, cz - 120);
  await page.mouse.click(hit.x, hit.y);
  await page.getByTestId('tool-select').click();
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 330, z: cz - 60, distance: 560, yaw: 0.3, tilt: -0.05 }),
    cz,
  );
  await page.evaluate(() => window.__game!.advance(14));
  await page.evaluate(() => window.__game!.waitFrames(4));
  expect((await state(page)).renderStats.disasters.funnels).toBe(1);
  await shot(page, 'tornado');
  // Rebuild what it knocked down (a power plant or pump in its path empties homes within days).
  for (let m = 0; m < 2; m++) {
    s = await play(page, 1, tips);
    await keepUp(s);
  }
  s = await play(page, 1, tips);
  log(`after the tornado: pop ${s.population}, $${s.treasury}`);
  expect(s.population).toBeGreaterThan(500);

  // Evening over the town.
  await page.evaluate(async () => {
    const g = window.__game!;
    const t = (await g.getState()).tick;
    await g.advance(((20 - 7) * 60 - (t % 1440) + 1440) % 1440);
  });
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 300, z: cz - 40, distance: 260, yaw: 2.4, tilt: -0.1 }),
    cz,
  );
  await shot(page, 'evening');

  // Save, quit to the menu and carry on where we left off.
  const pop = (await state(page)).population;
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-save')).toBeVisible();
  await page.getByTestId('pause-save').click();
  await page.getByTestId('save-name').fill('Maplewood, year 2');
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
  expect((await state(page)).population).toBe(pop);
  log(`tips seen: ${tips.join(' | ') || 'none'}`);
  errs.check();
});
