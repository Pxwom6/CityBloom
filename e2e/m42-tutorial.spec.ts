import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { closeContextsAfterEach, newContext, skipGraphicsCheck, watchErrors, clickMain } from './helpers';

/**
 * M42, learning to play, through the real interface: the whole first-city tutorial from the main menu
 * to 1,000 residents (roads, zones, utilities, the demand bars, the budget and taxes, services and a
 * coverage map, the advisors, saving, and any first problem on the way); leaving, skipping a step and
 * picking the tutorial up again after a reload; and every card's picture at 100 % and 140 % interface
 * size and on a phone. The town is the phase-1 playthrough's (River Valley, seed maplewood).
 */
closeContextsAfterEach();
test.describe.configure({ mode: 'serial' });

const OUT = 'test-results/m42';
mkdirSync(OUT, { recursive: true });

type State = Awaited<ReturnType<NonNullable<Window['__game']>['getState']>>;
const state = (page: Page): Promise<State> => page.evaluate(() => window.__game!.getState());
const tut = (page: Page) => page.evaluate(() => window.__game!.getTutorial());

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

/** Looking down on the town, framed to the right of the tutorial card. */
async function topDown(page: Page, cz: number): Promise<void> {
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 250, z: cz + 40, distance: 760, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
}

async function drag(page: Page, points: [number, number][]): Promise<string | null> {
  const before = (await state(page)).segments;
  let p = await at(page, points[0]![0], points[0]![1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (const [x, z] of points.slice(1)) {
    p = await at(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 5 });
  }
  await page.mouse.up();
  await page.waitForTimeout(300);
  return (await state(page)).segments > before ? null : JSON.stringify(points);
}

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

/** First problems met on the way (their lessons interrupt whichever step is showing). */
const metProblems: string[] = [];

/** The tutorial's steps in order (`TUTORIAL` in src/client/tutorial.ts). */
const ORDER = [
  'welcome',
  'road',
  'homes',
  'jobs',
  'power',
  'water',
  'time',
  'demand',
  'grow150',
  'budget',
  'taxes',
  'services',
  'coverage',
  'advisors',
  'grow500',
  'save',
  'grow1000',
  'finish',
];

/**
 * The card on screen, with its picture kept; a first problem's lesson met on the way is read and put
 * away. With `orLater`, a step the town has already done (it ticks itself off) is passed over.
 */
async function card(page: Page, id: string, timeout = 30_000, orLater = false): Promise<boolean> {
  const end = Date.now() + timeout;
  for (;;) {
    const t = await tut(page);
    if (t.event && t.step) {
      metProblems.push(t.step);
      await page.screenshot({ path: `${OUT}/play-${t.step}.png` });
      await page.getByTestId('tutorial-next').click();
      continue;
    }
    if (t.step === id) break;
    if (orLater && t.step && ORDER.indexOf(t.step) > ORDER.indexOf(id)) return false;
    if (Date.now() > end) expect(t.step, `waiting for the card ${id}`).toBe(id);
    await page.waitForTimeout(300);
  }
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', id);
  await page.evaluate(() => window.__game!.waitFrames(2));
  await page.screenshot({ path: `${OUT}/play-${id}.png` });
  return true;
}

/** A first problem's lesson, if one has come: its picture, then "Got it". */
async function problems(page: Page, seen: string[]): Promise<void> {
  const t = await tut(page);
  if (t.event && t.step) {
    seen.push(t.step);
    await page.screenshot({ path: `${OUT}/play-${t.step}.png` });
    await page.getByTestId('tutorial-next').click();
  }
  const tip = page.getByTestId('tip');
  if (await tip.isVisible()) await page.getByTestId('tip-ok').click();
}

test('the first-city tutorial from the main menu to 1,000 residents', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const ctx = await newContext(browser, { viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  await skipGraphicsCheck(page);
  await page.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, quality: 'low', shadows: false, reportsNotice: true }));
  });
  const log = (m: string) => console.log(`[m42] ${m}`);
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 90_000 });
  await clickMain(page, 'main-new');
  await page.getByTestId('new-name').fill('Firstville');
  await page.getByTestId('preset-river').click();
  await page.getByTestId('new-seed').fill('maplewood');
  await expect(page.getByTestId('new-tutorial')).toBeChecked();
  await page.getByTestId('new-start').click();
  await expect(page.getByTestId('topbar')).toBeVisible({ timeout: 90_000 });
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play');
  const cz = (await state(page)).highwayZ;
  const seen: string[] = [];

  // 1. Welcome: the camera at the highway's end.
  await card(page, 'welcome');
  await page.getByTestId('tutorial-next').click();

  // 2. Roads: an avenue off the highway, four side streets, a service road and a utility road.
  await card(page, 'road');
  await expect(page.getByTestId('guide-pointer')).toBeVisible();
  await expect(page.getByTestId('tool-road')).toHaveAttribute('data-guide', '');
  await topDown(page, cz);
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-avenue').click();
  const failed: string[] = [];
  const road = async (pts: [number, number][]) => {
    const why = await drag(page, pts);
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
  expect(failed, failed.join('\n')).toEqual([]);
  await page.getByTestId('tool-select').click();

  // 3–4. Homes, then shops and industry.
  await card(page, 'homes');
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
  await card(page, 'jobs');
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

  // 5–6. Power, water and sewage.
  const sides = (xs: number[], z: number, off: number): [number, number][] =>
    xs.flatMap((x) => [
      [x, z - off],
      [x, z + off],
    ]);
  const east = sides([530, 560, 590, 620, 650, 680, 710, 740], cz, 30);
  const north = sides([140, 170, 200, 230, 260, 290, 320, 350, 380], cz - 160, 30).filter(
    ([, z]) => z < cz - 160,
  );
  await card(page, 'power');
  expect(await place(page, 'power', 'wind', east)).toBe(true);
  expect(await place(page, 'power', 'wind', east)).toBe(true);
  await card(page, 'water');
  expect(await place(page, 'water', 'pump', north)).toBe(true);
  expect(await place(page, 'water', 'septic', east)).toBe(true);
  await page.getByTestId('tool-select').click();

  // 7. Let time run (it ticks itself off if the first families arrived while the player built).
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', /^(time|demand)$/);
  // (A new city is already running: the player only has to wait.)
  if ((await tut(page)).step === 'time') {
    await card(page, 'time');
    await page.evaluate(() => window.__game!.advance(600));
  }

  // 8. The demand bars: the game holds still while it's read.
  await card(page, 'demand');
  await expect(page.getByTestId('rci')).toHaveAttribute('data-guide', '');
  await expect(page.getByTestId('speed-0')).toHaveClass(/active/);
  const held = (await tut(page)).held;
  expect(held).toBe(1);
  await page.getByTestId('tutorial-next').click();
  // 9. Grow to 150, keeping the utilities ahead of demand.
  const keepUp = async () => {
    const s = await state(page);
    await topDown(page, cz);
    const u = s.utilities;
    if (u.power.supply < u.power.demand * 1.2 + 10)
      await place(page, 'power', s.population > 800 && s.treasury > 20_000 ? 'coal' : 'wind', east);
    if (u.water.supply < u.water.demand * 1.2 + 10) await place(page, 'water', 'pump', north);
    if (u.sewage.supply < u.sewage.demand * 1.2 + 10) await place(page, 'water', 'septic', east);
    await page.getByTestId('tool-select').click();
  };
  const month = async () => {
    await page.evaluate(() => window.__game!.advance(1440));
    await problems(page, seen);
  };
  await card(page, 'grow150', 30_000, true);
  // Time runs again as it was, once the demand card (and any first problem's lesson) is passed.
  if ((await tut(page)).step === 'grow150') await expect(page.getByTestId('speed-1')).toHaveClass(/active/);
  for (let m = 0; m < 12 && (await state(page)).population < 150; m++) {
    await keepUp();
    await month();
  }

  // 10–11. The budget, then taxes beside it.
  await card(page, 'budget', 60_000);
  await page.getByTestId('open-budget').click();
  await card(page, 'taxes');
  await expect(page.getByTestId('budget')).toBeVisible();
  await page.getByTestId('tutorial-next').click();
  await page.getByTestId('open-budget').click();

  // 12. Services: a fire station and a clinic, near the homes.
  await card(page, 'services');
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 30_000 }));
  await topDown(page, cz);
  expect(await place(page, 'fire', 'firestation', north)).toBe(true);
  expect(await place(page, 'health', 'clinic', north)).toBe(true);
  await page.getByTestId('tool-select').click();

  // 13. A coverage map, from the data maps.
  await card(page, 'coverage');
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-fire').click();
  await card(page, 'advisors');
  await page.getByTestId('tool-maps').click();
  await page
    .getByTestId('map-fire')
    .click()
    .catch(() => undefined);

  // 14. The advisors: opened, read, closed.
  const advisors = page.getByTestId('open-advisors');
  if (!(await advisors.isVisible())) await page.getByTestId('open-more').click();
  await advisors.click();
  await expect(page.getByTestId('advisors')).toBeVisible();
  await page.screenshot({ path: `${OUT}/play-advisors-open.png` });
  await page.getByTestId('advisors').getByRole('button', { name: 'Close' }).click();
  await card(page, 'grow500', 30_000, true);

  // 15. Grow to 500: utilities, the other services as money allows.
  const services: [string, string][] = [
    ['parks', 'park_small'],
    ['garbage', 'landfill'],
    ['education', 'primary'],
    ['police', 'police'],
  ];
  for (let m = 0; m < 24 && (await state(page)).population < 500; m++) {
    await keepUp();
    const s = await state(page);
    if (services.length && s.treasury > 16_000) {
      const [cat, def] = services[0]!;
      if (await place(page, cat, def, cat === 'garbage' ? east : north)) services.shift();
      await page.getByTestId('tool-select').click();
    }
    await month();
    log(`month ${Math.floor(s.tick / 1440)}: pop ${s.population}, $${s.treasury}`);
  }

  // 16. Save the city from the menu.
  await card(page, 'save', 60_000);
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('toast').last()).toContainText('Saved');
  await page.getByTestId('pause-resume').click();

  // 17. Grow to 1,000.
  await card(page, 'grow1000', 30_000, true);
  for (let m = 0; m < 36 && (await state(page)).population < 1000; m++) {
    await keepUp();
    const s = await state(page);
    if (services.length && s.treasury > 16_000) {
      const [cat, def] = services[0]!;
      if (await place(page, cat, def, cat === 'garbage' ? east : north)) services.shift();
      await page.getByTestId('tool-select').click();
    }
    await month();
    log(`month ${Math.floor(s.tick / 1440)}: pop ${s.population}, $${s.treasury}`);
  }

  // 18. A thousand people: the last card, and the tutorial is over.
  await card(page, 'finish', 60_000);
  const s = await state(page);
  log(`finished: pop ${s.population}, first problems met: ${[...seen, ...metProblems].join(', ') || 'none'}`);
  expect(s.population).toBeGreaterThanOrEqual(1000);
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
  expect(
    (await page.evaluate(() => window.__game!.getShell().settings)) as { tutorialStep: number },
  ).toMatchObject({
    tutorialStep: -1,
  });
  errs.check();
});

test('leaving the tutorial, skipping a step, and picking it up again after a reload', async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await newContext(browser, { viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await skipGraphicsCheck(page);
  await page.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, quality: 'low', shadows: false, reportsNotice: true }));
  });
  await page.goto('./?new=1&name=Restart&tutorial=1&seed=m42r');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 90_000,
  });
  await card(page, 'welcome');
  await page.getByTestId('tutorial-next').click();
  await card(page, 'road');
  // Skip this step: on to the next without building.
  await page.getByTestId('tutorial-skip-step').click();
  await card(page, 'homes');
  // Leave for now: the card goes; the pause menu brings it back at the same step.
  await page.getByTestId('tutorial-leave').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
  expect((await tut(page)).away).toBe(true);
  await page.getByTestId('menu-button').click();
  await page.screenshot({ path: `${OUT}/resume-pause-menu.png` });
  await page.getByTestId('pause-tutorial').click();
  await card(page, 'homes');
  // Saved and reloaded: Continue on the main menu opens the city with the tutorial where it was.
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('toast').last()).toContainText('Saved');
  await page.reload();
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 90_000 });
  await clickMain(page, 'main-continue');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 90_000,
  });
  await card(page, 'homes');
  // Skip tutorial ends it.
  await page.getByTestId('tutorial-skip').click();
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
});

test('every tutorial card at 100 % and 140 % interface size and on a phone', async ({ browser }) => {
  test.setTimeout(900_000);
  const STEPS = [
    'welcome',
    'road',
    'homes',
    'jobs',
    'power',
    'water',
    'time',
    'demand',
    'grow150',
    'budget',
    'taxes',
    'services',
    'coverage',
    'advisors',
    'grow500',
    'save',
    'grow1000',
    'finish',
    'firstFire',
    'firstPowerCut',
    'firstJam',
  ];
  for (const [size, viewport, ui, mobile] of [
    ['100', { width: 1280, height: 800 }, 1, false],
    ['140', { width: 1280, height: 800 }, 1.4, false],
    ['phone', { width: 390, height: 844 }, 1, true],
  ] as const) {
    const ctx = await newContext(browser, {
      viewport,
      ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    });
    const page = await ctx.newPage();
    await skipGraphicsCheck(page);
    await page.addInitScript((ui) => {
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(
        key,
        JSON.stringify({
          ...s,
          quality: 'low',
          shadows: false,
          uiScale: ui,
          tips: false,
          reportsNotice: true,
        }),
      );
    }, ui);
    await page.goto('./?lesson=friends');
    await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
    await page.getByTestId('lesson-leave').click();
    for (const id of STEPS) {
      expect(await page.evaluate((id) => window.__game!.showTutorialStep(id), id)).toBe(true);
      // The taxes card stands beside the budget it teaches.
      if (id === 'taxes') await page.getByTestId('open-budget').click();
      await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', id);
      const box = await page.getByTestId('tutorial').boundingBox();
      expect(box, id).not.toBeNull();
      // The whole card is on screen at every size.
      expect(box!.x, id).toBeGreaterThanOrEqual(0);
      expect(box!.y, id).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, id).toBeLessThanOrEqual(viewport.width + 1);
      expect(box!.y + box!.height, id).toBeLessThanOrEqual(viewport.height + 1);
      await page.evaluate(() => window.__game!.waitFrames(1));
      await page.screenshot({ path: `${OUT}/card-${size}-${id}.png` });
      if (id === 'taxes') await page.getByTestId('open-budget').click();
    }
    await ctx.close();
  }
});
