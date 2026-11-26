import { expect, test, type Page } from '@playwright/test';
import { shot, watchErrors } from './helpers';
import { fingers, holdForSpot, phone, phoneProblems, pickBuilding, type Fingers, type Orient } from './phone';
import { frames, screen, settings, state } from './ui';

/**
 * M49: a town built on a phone by touch alone, from the main menu, in an iPhone's and an Android
 * phone's emulation, held upright and sideways: roads drawn with a finger (and confirmed before
 * they cost anything), zones painted, a wind turbine, a water pump and a septic tank, a fire station
 * placed from the Build sheet after holding a finger on the spot to see what it would do, the budget
 * opened as a sheet and closed by dragging it down, a building's inspector by a long press, undo, and
 * saving and loading. Two fingers move the camera (pinch, twist, tilt) in its own test.
 *
 * The camera is framed by the test API so the taps can be aimed; everything that builds, opens or
 * saves is a touch.
 */
const PROFILES: [string, string, Orient][] = [
  ['iphone', 'iPhone 13', 'portrait'],
  ['iphone', 'iPhone 13', 'landscape'],
  ['pixel', 'Pixel 7', 'portrait'],
  ['pixel', 'Pixel 7', 'landscape'],
];

const counts = (page: Page) =>
  page.evaluate(async () => {
    const s = await window.__game!.getState();
    return { segments: s.segments, civics: (await window.__game!.getCivics()).length, treasury: s.treasury };
  });

/** Frame the land east of the highway's connection from above. */
async function frameTown(page: Page, cz: number, orient: Orient): Promise<void> {
  await page.evaluate(
    ([cz, d]) => window.__game!.setCamera({ x: 150, z: cz!, distance: d!, yaw: 0, tilt: 0.55 }),
    [cz, orient === 'portrait' ? 620 : 420],
  );
  await frames(page, 3);
}

async function buildTown(page: Page, f: Fingers, orient: Orient, tag: string): Promise<void> {
  const s0 = await state(page);
  const cz = s0.highwayZ;
  await frameTown(page, cz, orient);

  // A street off the highway, drawn with a finger: it asks before it costs anything.
  await page.getByTestId('tool-road').tap();
  await expect(page.getByTestId('road-options')).toBeVisible();
  const before = await counts(page);
  await f.drag([await screen(page, 24, cz), await screen(page, 140, cz), await screen(page, 250, cz)], 8);
  await expect(page.getByTestId('tool-question')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('tool-question')).toContainText('costs $');
  // Nothing spent yet.
  expect((await counts(page)).treasury).toBe(before.treasury);
  await page.getByTestId('tool-question-yes').tap();
  await expect
    .poll(async () => (await counts(page)).segments, { timeout: 15_000 })
    .toBeGreaterThan(before.segments);
  // A cross street, cancelled the first time (nothing built), then built.
  const cross = [
    await screen(page, 150, cz - 110),
    await screen(page, 150, cz),
    await screen(page, 150, cz + 110),
  ];
  const mid = await counts(page);
  await f.drag(cross, 8);
  await expect(page.getByTestId('tool-question')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tool-question-no').tap();
  await frames(page, 2);
  expect((await counts(page)).segments).toBe(mid.segments);
  await f.drag(cross, 8);
  await expect(page.getByTestId('tool-question')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('tool-question-yes').tap();
  await expect
    .poll(async () => (await counts(page)).segments, { timeout: 15_000 })
    .toBeGreaterThan(mid.segments);

  // Homes and shops painted with a finger along the streets.
  await page.getByTestId('tool-zone').tap();
  await page.getByTestId('zone-R').tap();
  await f.drag([await screen(page, 40, cz - 30), await screen(page, 240, cz - 30)], 10);
  await f.drag([await screen(page, 170, cz - 100), await screen(page, 170, cz + 100)], 10);
  await page.getByTestId('zone-C').tap();
  await f.drag([await screen(page, 40, cz + 30), await screen(page, 130, cz + 30)], 8);
  await expect.poll(async () => (await state(page)).zoned.R, { timeout: 15_000 }).toBeGreaterThan(0);

  // Power, water and a fire station from the Build sheet: a long press shows the spot is fine
  // (what hovering shows with a mouse), and a tap builds there.
  const place = async (category: string, def: string, spots: [number, number][]) => {
    const n = (await counts(page)).civics;
    await pickBuilding(page, category, def);
    const p = await holdForSpot(page, f, spots, def);
    await f.tap(p);
    await expect.poll(async () => (await counts(page)).civics, { timeout: 15_000 }).toBe(n + 1);
  };
  // Spots facing the streets: beside the highway street, and beside the cross street.
  const beside = (side: 1 | -1): [number, number][] => [
    ...[60, 210, 90, 240, 120].map((x): [number, number] => [x, cz + side * 30]),
    ...[60, 90].map((dz): [number, number] => [150 + side * 30, cz + side * dz]),
  ];
  const south = beside(1);
  const north = beside(-1);
  await place('power', 'wind', south);
  await place('water', 'pump', north);
  await place('water', 'septic', [...south, ...north]);
  await place('fire', 'firestation', [...north, ...south]);
  await page.getByTestId('tool-select').tap();
  await shot(page, `m49-phone-${tag}-town`);

  // The budget opens as a sheet; a tax is set by touching its slider; dragging the sheet's header
  // down closes it.
  await page.getByTestId('open-budget').tap();
  const budget = page.getByTestId('budget');
  await expect(budget).toBeVisible();
  await page.getByTestId('budget-tab-taxes').tap();
  const slider = page.getByTestId('tax-R1');
  const was = Number(await slider.inputValue());
  const box = (await slider.boundingBox())!;
  await f.tap({ x: box.x + box.width * 0.95, y: box.y + box.height / 2 });
  await expect.poll(async () => Number(await slider.inputValue())).toBeGreaterThan(was);
  await shot(page, `m49-phone-${tag}-budget`);
  expect(await phoneProblems(page, '[data-testid="budget"]')).toEqual([]);
  const head = (await budget.locator('header').boundingBox())!;
  const grab = { x: head.x + head.width / 2, y: head.y + 12 };
  if (orient === 'portrait') await f.drag([grab, { x: grab.x, y: grab.y + 220 }], 8);
  else
    await f.drag(
      [
        { x: head.x + 20, y: head.y + head.height / 2 },
        { x: head.x + 260, y: head.y + head.height / 2 },
      ],
      8,
    );
  await expect(budget).toBeHidden();

  // A few days on, the town grows; a long press on a home opens its inspector.
  await page.getByTestId('speed-3').tap();
  await page.evaluate(() => window.__game!.advance(4 * 1440));
  await page.getByTestId('speed-0').tap();
  await expect.poll(async () => (await state(page)).population, { timeout: 60_000 }).toBeGreaterThan(0);
  await frameTown(page, cz, orient);
  const home = await page.evaluate(async () => {
    const g = window.__game!;
    for (const b of await g.getBuildings()) {
      const p = g.worldToScreen(b.x, b.z);
      const el = document.elementFromPoint(p.x, p.y);
      if (el?.tagName === 'CANVAS') return p;
    }
    return null;
  });
  expect(home, 'a building on screen').not.toBeNull();
  await f.hold(home!, 800);
  await expect(page.locator('aside.inspector')).toBeVisible();
  await shot(page, `m49-phone-${tag}-inspector`);
  expect(await phoneProblems(page, 'aside.inspector')).toEqual([]);
  await page.locator('aside.inspector [aria-label="Close"]').first().tap();

  // Undo, one tap away: a park placed, then taken back.
  const n = (await counts(page)).civics;
  await pickBuilding(page, 'parks', 'park_small');
  const p = await holdForSpot(page, f, [...south, ...north], 'a park');
  await f.tap(p);
  await expect.poll(async () => (await counts(page)).civics, { timeout: 15_000 }).toBe(n + 1);
  await page.getByTestId('tool-undo').tap();
  await expect.poll(async () => (await counts(page)).civics, { timeout: 15_000 }).toBe(n);
  await page.getByTestId('tool-select').tap();
  expect(await phoneProblems(page, '[data-testid="toolbar"]')).toEqual([]);
}

for (const [key, name, orient] of PROFILES) {
  test.describe(`${key} ${orient}`, () => {
    test.use(phone(name, orient));

    test(`M49: a town by touch alone on a phone (${key}, ${orient})`, async ({ page }) => {
      test.setTimeout(900_000);
      const errs = watchErrors(page);
      // The first-launch check runs (it knows a phone without timing anything).
      await settings(page, {
        graphicsChecked: false,
        reportsNotice: true,
        tutorialSeen: ['firstFire', 'firstPowerCut', 'firstJam'],
      });
      await page.goto('./');
      await page.waitForFunction(
        () => window.__game?.ready && window.__game.getShell().mode === 'menu',
        null,
        { timeout: 120_000 },
      );
      // A phone opens on the phone layout, on the Phone preset at 30 frames a second.
      await expect(page.locator('#ui[data-phone]')).toHaveCount(1);
      await expect
        .poll(() => page.evaluate(() => window.__game!.getShell().settings))
        .toMatchObject({ quality: 'phone', fpsCap: 30, shadows: false, autoGraphics: 'phone' });
      await shot(page, `m49-phone-${key}-${orient}-menu`);
      await page.getByTestId('main-new').tap();
      await page.getByTestId('preset-river').tap();
      // The seed is typed on the phone's keyboard, so the run is the same every time.
      await page.getByTestId('new-seed').fill('phone');
      if (await page.getByTestId('new-tutorial').isChecked()) await page.getByTestId('new-tutorial').tap();
      await page.getByTestId('new-start').tap();
      await page.waitForFunction(
        () => window.__game?.ready && window.__game.getShell().mode === 'play',
        null,
        { timeout: 120_000 },
      );
      await page.evaluate(() => window.__game!.setSpeed(0));
      const f = await fingers(page);
      await buildTown(page, f, orient, `${key}-${orient}`);

      // Saved from the menu and loaded back.
      const before = await state(page);
      await page.getByTestId('menu-button').tap();
      await page.getByTestId('pause-save').tap();
      await page.getByTestId('save-new').tap();
      await expect(page.getByTestId('toast').first()).toContainText('Saved');
      await expect(page.getByTestId('pause-load')).toBeVisible();
      await page.getByTestId('pause-load').tap();
      await expect(page.getByTestId('slot-list')).toBeVisible();
      await page.locator('[data-testid^="load-s"]').first().tap();
      await page.waitForFunction(
        () => window.__game?.ready && window.__game.getShell().mode === 'play',
        null,
        { timeout: 120_000 },
      );
      await expect.poll(async () => (await state(page)).segments, { timeout: 60_000 }).toBe(before.segments);
      expect((await state(page)).population).toBe(before.population);
      errs.check();
    });
  });
}

test.describe('two fingers', () => {
  test.use(phone('Pixel 7', 'portrait'));

  test('M49: one finger pans, a pinch zooms, a twist turns, two fingers sliding up tilt', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await settings(page, { reportsNotice: true, quality: 'phone', shadows: false, drawDistance: 'near' });
    await page.goto('./?paused=1&seed=phone');
    await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
    const f = await fingers(page);
    const cam = () => page.evaluate(() => window.__game!.getCamera());
    await page.evaluate(() =>
      window.__game!.setCamera({ x: 600, z: 1000, distance: 600, yaw: 0.4, tilt: 0 }),
    );
    await frames(page, 3);
    const vw = page.viewportSize()!;
    const c = { x: vw.width / 2, y: vw.height * 0.45 };

    const a = await cam();
    await f.drag([c, { x: c.x + 120, y: c.y + 40 }], 8);
    await frames(page, 2);
    const b = await cam();
    expect(Math.hypot(b.x - a.x, b.z - a.z), 'one finger pans').toBeGreaterThan(20);
    expect(b.distance).toBeCloseTo(a.distance, 0);

    await f.two(
      { x: c.x - 40, y: c.y },
      { x: c.x + 40, y: c.y },
      { x: c.x - 130, y: c.y },
      { x: c.x + 130, y: c.y },
    );
    await frames(page, 2);
    const z = await cam();
    expect(z.distance, 'spreading two fingers zooms in').toBeLessThan(b.distance * 0.6);

    await f.two(
      { x: c.x - 90, y: c.y },
      { x: c.x + 90, y: c.y },
      { x: c.x - 64, y: c.y - 64 },
      { x: c.x + 64, y: c.y + 64 },
    );
    await frames(page, 2);
    const t = await cam();
    expect(Math.abs(t.yaw - z.yaw), 'a twist turns the view').toBeGreaterThan(0.4);

    await f.two(
      { x: c.x - 60, y: c.y + 60 },
      { x: c.x + 60, y: c.y + 60 },
      { x: c.x - 60, y: c.y - 60 },
      { x: c.x + 60, y: c.y - 60 },
    );
    await frames(page, 2);
    const u = await cam();
    expect(u.tilt, 'two fingers sliding up tilt towards the horizon').toBeLessThan(t.tilt - 0.2);
    expect(u.distance, 'and do not zoom').toBeCloseTo(t.distance, -1);
  });
});
