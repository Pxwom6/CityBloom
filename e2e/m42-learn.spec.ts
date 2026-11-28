import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { closeContextsAfterEach, newContext, skipGraphicsCheck, clickMain } from './helpers';
import { placeFromToolbar } from './ui';

/**
 * M42's Learn lessons, every one played through the real interface from the main menu's Learn screen
 * on its prepared town, back to Learn with its tick; and the card a player joining a friend's room
 * sees the first time.
 */
closeContextsAfterEach();
test.describe.configure({ mode: 'serial' });

const OUT = 'test-results/m42';
mkdirSync(OUT, { recursive: true });

const tut = (page: Page) => page.evaluate(() => window.__game!.getTutorial());

async function player(
  browser: Browser,
  extra: Record<string, unknown> = {},
  size = { width: 1280, height: 800 },
) {
  const ctx = await newContext(browser, { viewport: size });
  const page = await ctx.newPage();
  await skipGraphicsCheck(page);
  await page.addInitScript((extra) => {
    if (sessionStorage.getItem('m42-seeded')) return;
    sessionStorage.setItem('m42-seeded', '1');
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(
      key,
      JSON.stringify({ ...s, quality: 'low', shadows: false, reportsNotice: true, tips: false, ...extra }),
    );
  }, extra);
  return page;
}

/** Wait for a lesson's card, and keep its picture. */
async function step(page: Page, id: string): Promise<void> {
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-step', id, { timeout: 60_000 });
  await page.evaluate(() => window.__game!.waitFrames(2));
  await page.screenshot({ path: `${OUT}/lesson-${(await tut(page)).lesson}-${id}.png` });
}

async function next(page: Page, id: string): Promise<void> {
  await step(page, id);
  await page.getByTestId('tutorial-next').click();
}

/** From the main menu's Learn screen into a lesson's town. */
async function open(page: Page, id: string): Promise<number> {
  await page.goto('./?screen=learn');
  await expect(page.getByTestId('learn-screen')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId(`lesson-start-${id}`).click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 90_000,
  });
  const cz = (await page.evaluate(() => window.__game!.getState())).highwayZ;
  return cz;
}

/** The town from above, to the right of the lesson's card. */
async function above(page: Page, cz: number): Promise<void> {
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 250, z: cz + 40, distance: 760, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
}

async function at(page: Page, x: number, z: number) {
  return page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
}

/** The last card, then back to Learn, where the lesson has its tick. */
async function done(page: Page, id: string): Promise<void> {
  await step(page, 'lessonDone');
  await page.getByTestId('lesson-learn').click();
  await expect(page.getByTestId('learn-screen')).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId(`lesson-${id}`)).toHaveClass(/done/);
}

/** Spots by the town's roads (the avenue runs east from x 24; side streets cross it). */
const spots = (cz: number): [number, number][] => [
  [620, cz + 30],
  [620, cz - 30],
  [650, cz + 30],
  [650, cz - 30],
  [300, cz + 230],
  [360, cz + 230],
  [420, cz + 230],
  [480, cz + 230],
  [300, cz + 290],
  [420, cz + 290],
  [540, cz + 230],
  [540, cz + 290],
];

test('every Learn lesson, played on its town from the main menu', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  const page = await player(browser);
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 90_000 });
  await clickMain(page, 'main-learn');
  await expect(page.getByTestId('learn-screen')).toBeVisible();
  // Making buildings is the Workshop's lesson since M47 (played through in e2e/m47-workshop.spec.ts).
  await expect(page.getByTestId('lesson-start-buildings')).toBeEnabled();
  await expect(page.getByTestId('lesson-war')).toContainText('Rival neighbours');
  await page.screenshot({ path: `${OUT}/learn-screen.png` });

  // Traffic and transit: the traffic map, another way through, buses.
  let cz = await open(page, 'traffic');
  await next(page, 'trafficIntro');
  await step(page, 'trafficMap');
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-traffic').click();
  await step(page, 'trafficRoad');
  await above(page, cz);
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  let p = await at(page, 584, cz);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  p = await at(page, 700, cz);
  await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('tool-select').click();
  await step(page, 'trafficBus');
  await placeFromToolbar(page, 'transit', 'busdepot', spots(cz));
  await page.getByTestId('tool-transit').click();
  await page.getByTestId('place-busstop').click();
  for (const [x, dz] of [
    [117, -80],
    [211, -60],
    [304, -80],
    [397, 70],
    [491, 70],
  ] as const) {
    p = await at(page, x, cz + dz);
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await page.waitForTimeout(200);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(200);
  }
  await page.getByTestId('tool-select').click();
  await page.evaluate(() => window.__game!.advance(240));
  await next(page, 'trafficWatch');
  await done(page, 'traffic');

  // Money and loans: the budget, taxes, a loan, funding.
  await open(page, 'money');
  await next(page, 'moneyIntro');
  await step(page, 'moneyBudget');
  await page.getByTestId('open-budget').click();
  await next(page, 'moneyTaxes');
  await step(page, 'moneyLoan');
  await page.getByTestId('budget-tab-loans').click();
  await page.locator('[data-testid^="loan-"]:not([data-testid^="loan-terms"])').first().click();
  await next(page, 'moneyFunding');
  await done(page, 'money');

  // Happiness and services: the advisors, the happiness map, a fire station, a clinic, coverage.
  cz = await open(page, 'services');
  await next(page, 'servicesIntro');
  await step(page, 'servicesAdvisors');
  const advisors = page.getByTestId('open-advisors');
  if (!(await advisors.isVisible())) await page.getByTestId('open-more').click();
  await advisors.click();
  await expect(page.getByTestId('advisors')).toContainText(/shrink|without/);
  await page.screenshot({ path: `${OUT}/lesson-services-advisors-open.png` });
  await page.getByTestId('advisors').getByRole('button', { name: 'Close' }).click();
  await step(page, 'servicesHappy');
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-happiness').click();
  await step(page, 'servicesFire');
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-happiness').click();
  await above(page, cz);
  await placeFromToolbar(page, 'fire', 'firestation', spots(cz));
  await step(page, 'servicesClinic');
  await placeFromToolbar(page, 'health', 'clinic', spots(cz));
  await step(page, 'servicesCoverage');
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-fire').click();
  await done(page, 'services');

  // Disasters: one set off at the edge of town, help, rebuilding, the switch.
  cz = await open(page, 'disasters');
  await next(page, 'disastersIntro');
  await step(page, 'disastersStart');
  await above(page, cz);
  await page.getByTestId('tool-disasters').click();
  await page.getByTestId('disaster-meteor').click();
  p = await at(page, 680, cz - 120);
  await page.mouse.click(p.x, p.y);
  await next(page, 'disastersRespond');
  await next(page, 'disastersRebuild');
  await next(page, 'disastersSwitch');
  await done(page, 'disasters');

  // Districts and policies: paint one, give it a rule.
  cz = await open(page, 'districts');
  await next(page, 'districtsIntro');
  await step(page, 'districtsPaint');
  await above(page, cz);
  await page.getByTestId('tool-district').click();
  await page.getByTestId('district-new').click();
  // (East of the panel the District tool opens.) The hint offers the neighbourhood's name first.
  p = await at(page, 200, cz - 60);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await expect(page.getByTestId('tool-hint')).toContainText('New district', { timeout: 20_000 });
  await page.mouse.down();
  for (const [x, z] of [
    [300, cz - 60],
    [400, cz - 60],
    [500, cz - 60],
  ] as const) {
    p = await at(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.mouse.up();
  await page.screenshot({ path: `${OUT}/lesson-districts-painted.png` });
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getDistricts())).list.length, {
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
  await step(page, 'districtsPolicy');
  await page.locator('[data-testid^="district-"][data-testid$="1"]').first().click();
  await page.locator('[data-testid^="district-policy-"]').first().check();
  await done(page, 'districts');

  // Playing with friends: the menu's Invite friends, codes, roles, regions.
  await open(page, 'friends');
  await next(page, 'friendsIntro');
  await step(page, 'friendsMenu');
  await page.getByTestId('menu-button').click();
  await next(page, 'friendsCodes');
  await next(page, 'friendsRoles');
  await page.getByTestId('pause-resume').click();
  await next(page, 'friendsRegion');
  await done(page, 'friends');

  // War: the war room, forces, raids.
  await open(page, 'war');
  await next(page, 'warIntro');
  await step(page, 'warRoom');
  const war = page.getByTestId('open-war');
  if (!(await war.isVisible())) await page.getByTestId('open-more').click();
  await war.click();
  await next(page, 'warTrain');
  await next(page, 'warRaid');
  await done(page, 'war');
  await page.screenshot({ path: `${OUT}/learn-screen-done.png` });
});

test('a friend’s room, the first time: what’s shared, what you may do, chat and pointing', async ({
  browser,
}) => {
  test.setTimeout(400_000);
  const ada = await player(browser, {}, { width: 1000, height: 700 });
  await ada.evaluate(() => undefined).catch(() => undefined);
  await ada.addInitScript(() =>
    localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Ada', color: 0 })),
  );
  await ada.goto('./?paused=1&seed=m42room&name=Sharewell');
  await ada.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await ada.keyboard.press('Escape');
  await ada.getByTestId('pause-invite').click();
  const net = (p: Page) => p.evaluate(() => window.__game!.getNet());
  await expect.poll(async () => (await net(ada))?.state, { timeout: 30_000 }).toBe('playing');
  const code = (await net(ada))!.code;
  await ada.getByTestId('speed-0').click();
  await ada.getByTestId('room-panel').getByRole('button', { name: 'Close' }).click();
  // The host doesn't see the card: it's for a player joining someone else's city.
  await expect(ada.getByTestId('room-intro')).toHaveCount(0);

  // Sam, with tips on, joins by the invite link.
  const sam = await player(browser, { tips: true }, { width: 1000, height: 700 });
  await sam.addInitScript(() =>
    localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Sam', color: 1 })),
  );
  await sam.goto(`./?join=${code}`);
  await sam.waitForFunction(() => window.__game?.ready === true && !!window.__game.getNet(), null, {
    timeout: 120_000,
  });
  const card = sam.getByTestId('room-intro');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card).toContainText('Welcome to Ada’s city');
  await expect(card).toContainText('same money');
  await expect(sam.getByTestId('room-intro-perms')).toContainText('You may:');
  await expect(card).toContainText('Shift+G');
  await sam.screenshot({ path: `${OUT}/room-intro.png` });
  await sam.getByTestId('room-intro-ok').click();
  await expect(card).toHaveCount(0);
  // Seen once; the room panel's How rooms work brings it back.
  await sam.getByTestId('room-chip').click();
  await sam.getByTestId('room-intro-open').click();
  await expect(card).toBeVisible();
});
