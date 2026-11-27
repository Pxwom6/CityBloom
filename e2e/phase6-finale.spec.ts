import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext, watchErrors } from './helpers';
import { fingers, onMap, phone, phoneProblems, type Fingers, type Orient } from './phone';
import { getMatch, matchLogs, until, type MatchView } from './match';
import { testModels, goodModelParts, transformParts, writeGlb } from '../scripts/lib/makeGlb';
import { frames, settledHint } from './ui';

/**
 * The end of phase 6 (SPEC-6.md, "When every milestone is done"): the phase played as players would,
 * through the real UI.
 *
 * 1. A brand-new player's first city on a laptop: the first-launch check, the main menu's one sentence
 *    about crash reports, New city with the tutorial, every card followed by its arrow (the button it
 *    points at must be on screen and uncovered) to a town of 1,000; the town played on for a while, a
 *    timelapse of it made in City history and saved, and a problem reported from the pause menu.
 * 2–3. The same first city by touch alone, in an iPhone's emulation held upright and an Android
 *    phone's held sideways: roads drawn with a finger and confirmed, zones painted, buildings from the
 *    Build sheet after a long press shows the spot is good, the budget and the data maps as sheets.
 * 4. A four-player quick match online: two players on laptops, two on phones (an iPhone upright and an
 *    Android phone sideways), each building their town with their own mouse or fingers; reactions,
 *    a peek, the results, a rematch in another mode, and a city kept.
 * 5. This week's challenge, the generator's (the owner takes any pin away first): played from the main
 *    menu for its four years, posted to the board in a friends' group, and watched to its end by a friend
 *    on a phone, who sees it come to the same city.
 * 6. A building made through the Workshop (Learn → Making your own buildings), shared with a friend as a
 *    file (who adds it on a phone and places it in their own town) and sent in, beside an idea.
 * 7. The owner area on the owner's phone handling all of it: the problem reports, the challenge board (a
 *    name filtered, an entry removed and put back), the submissions accepted and declined with replies;
 *    then the player sees both answers.
 *
 * Tips are on wherever a player is new. Cheats only skip waiting (game time fast-forwarded; money only
 * where a step says so). A picture is taken at every step (test-results/phase6/); the best are kept as
 * docs/screenshots/phase6-*.png. `PHASE6_GPU=1` plays it in a real Chrome window on the GPU (as it was
 * judged, on the Mac); otherwise it runs as the other playthroughs do. The local relay's owner key is
 * `e2e-owner-key-0123456789` (playwright.config.ts).
 */

const GPU = !!process.env.PHASE6_GPU;
test.use({
  actionTimeout: 60_000,
  viewport: { width: 1280, height: 800 },
  // (A window behind others is throttled: the interface would redraw seconds late between steps.)
  ...(GPU
    ? {
        channel: 'chrome',
        headless: false,
        launchOptions: {
          args: [
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
          ],
        },
      }
    : {}),
});
closeContextsAfterEach();

const OUT = 'test-results/phase6';
mkdirSync(OUT, { recursive: true });
const NOTES = `${OUT}/notes.json`;

/** The pictures kept for the docs (by step name). */
const KEEP = new Set([
  'a-arrow-road',
  'a-town-1000',
  'a-timelapse',
  'b-iphone-road',
  'b-iphone-town',
  'c-pixel-town',
  'd-scoreboard',
  'd-phone-scoreboard',
  'd-results',
  'e-challenge',
  'e-end',
  'e-watched',
  'f-workshop-see',
  'f-friend-placed',
  'f-sent',
  'g-owner-reports',
  'g-owner-challenge',
  'g-owner-submission',
  'g-player-answers',
]);
let shots = 0;
const log = (msg: string) => console.log(`[phase6] ${msg}`);

/** A picture of this step (and, for the best, a copy in the docs at the page's CSS size). */
async function snap(page: Page, name: string): Promise<void> {
  // (The interface redraws a few times a second; the picture waits for it.)
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__game?.waitFrames(3)).catch(() => undefined);
  const n = String(++shots).padStart(3, '0');
  await page.screenshot({ path: `${OUT}/${n}-${name}.png`, scale: 'css' });
  if (KEEP.has(name)) await page.screenshot({ path: `docs/screenshots/phase6-${name}.png`, scale: 'css' });
}

/** The tip showing now, read (logged) and put away, as a player would; and the toasts on screen. */
async function readTips(page: Page, who: string, tap = false): Promise<void> {
  const card = page.getByTestId('tip');
  for (let k = 0; k < 6; k++) {
    const shown = await card.waitFor({ state: 'visible', timeout: 600 }).then(
      () => true,
      () => false,
    );
    if (!shown) break;
    const id = await page.evaluate(() => window.__game!.getShell().tip);
    log(`${who} tip ${id}: ${(await card.innerText()).replace(/\s+/g, ' ')}`);
    await press(page, 'tip-ok', tap);
    await card.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => undefined);
  }
}

const press = (page: Page, id: string, tap = false) =>
  tap ? page.getByTestId(id).tap() : page.getByTestId(id).click();

type State = Awaited<ReturnType<NonNullable<Window['__game']>['getState']>>;
const state = (page: Page): Promise<State> => page.evaluate(() => window.__game!.getState());
const tut = (page: Page) => page.evaluate(() => window.__game!.getTutorial());
const advance = (page: Page, ticks: number) => page.evaluate((n) => window.__game!.advance(n), ticks);
const civicCount = (page: Page) => page.evaluate(() => window.__game!.getCivics().length);

async function screenAt(page: Page, x: number, z: number) {
  const p = await page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
  return { ...p, onMap: await onMap(page, p) };
}

/** Findings the playthroughs make along the way, gathered for the log and the notes file. */
const findings: string[] = [];
function note(what: string): void {
  findings.push(what);
  log(`FINDING ${what}`);
}

/**
 * The tutorial's arrow, as a new player follows it: the button it points at (or on a phone, the bar's
 * button whose sheet holds it) must be on screen and not under anything. Returns its test id.
 */
async function arrow(page: Page, step: string): Promise<string | null> {
  // (The pulse and the arrow follow the card within a few hundred milliseconds.)
  await page
    .waitForFunction(
      () =>
        !!document.querySelector('[data-guide]') && !!document.querySelector('[data-testid=guide-pointer]'),
      null,
      {
        timeout: 2_000,
      },
    )
    .catch(() => undefined);
  // (Its effects run after the card's own render: the old card's pulse can linger a frame or two.)
  await page.waitForTimeout(700);
  const a = await page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLElement>('[data-guide]')];
    // The card's own target: the pulse the arrow is drawn beside (any other pulse is a stale one).
    const pointer0 = document.querySelector<HTMLElement>('[data-testid=guide-pointer]');
    const px = pointer0 ? parseFloat(pointer0.style.left) : NaN;
    const el =
      all.find((e) => {
        const r = e.getBoundingClientRect();
        return Math.abs(r.left + r.width / 2 - px) < 2;
      }) ?? all[0];
    if (!el) return null;
    const others = all.filter((e) => e !== el).map((e) => e.dataset.testid ?? e.className);
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const inside = !!hit && (el === hit || el.contains(hit));
    const pointer = document.querySelector('[data-testid=guide-pointer]');
    return {
      id: el.dataset.testid ?? el.className,
      shown: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight,
      covered: !inside,
      by: hit ? ((hit.closest('[data-testid]') as HTMLElement | null)?.dataset.testid ?? hit.className) : '',
      pointer: !!pointer,
      others,
    };
  });
  if (!a) return null;
  if (a.others.length)
    note(`tutorial ${step}: ${a.others.join(', ')} still pulses beside the arrow's ${a.id}`);
  if (!a.shown) note(`tutorial ${step}: the arrow's button (${a.id}) is not on screen`);
  else if (a.covered) note(`tutorial ${step}: the arrow's button (${a.id}) is under ${a.by}`);
  if (!a.pointer) note(`tutorial ${step}: no arrow drawn beside ${a.id}`);
  return a.id;
}

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
 * Wait for the card `id`, reading any first problem's lesson met on the way (and tips); with `orLater`,
 * a step the town has already done (it ticks itself off) is passed over. The card's words are logged.
 */
async function card(
  page: Page,
  who: string,
  id: string,
  o: { timeout?: number; orLater?: boolean; tap?: boolean; seen?: string[] } = {},
): Promise<boolean> {
  const end = Date.now() + (o.timeout ?? 30_000);
  for (;;) {
    const t = await tut(page);
    if (t.event && t.step) {
      o.seen?.push(t.step);
      log(
        `${who} first problem ${t.step}: ${(await page.getByTestId('tutorial').innerText()).replace(/\s+/g, ' ')}`,
      );
      await arrow(page, t.step);
      await snap(page, `${who}-${t.step}`);
      await press(page, 'tutorial-next', o.tap);
      continue;
    }
    if (t.step === id) break;
    if (o.orLater && t.step && ORDER.indexOf(t.step) > ORDER.indexOf(id)) return false;
    if (Date.now() > end) expect(t.step, `${who} waiting for the card ${id}`).toBe(id);
    await readTips(page, who, o.tap);
    await page.waitForTimeout(300);
  }
  const c = page.getByTestId('tutorial');
  await expect(c).toHaveAttribute('data-step', id);
  log(
    `${who} card ${id}: ${(await c.innerText()).replace(/\s+/g, ' ')} [saw ${(await tut(page)).saw.join(',')}]`,
  );
  return true;
}

// ————————————————————————————————————————— 1. A laptop —————————————————————————————————————————

/** Looking down on the town east of the highway, framed to the right of the tutorial card. */
async function topDown(page: Page, cz: number, distance = 760): Promise<void> {
  await page.evaluate(
    ([cz, d]) => window.__game!.setCamera({ x: 250, z: cz! + 40, distance: d!, yaw: 0, tilt: 0.55 }),
    [cz, distance],
  );
  await frames(page, 2);
}

async function dragMouse(page: Page, points: [number, number][]): Promise<boolean> {
  const before = (await state(page)).segments;
  const ps = [];
  for (const [x, z] of points) {
    const p = await screenAt(page, x, z);
    if (!p.onMap) return false;
    ps.push(p);
  }
  await page.mouse.move(ps[0]!.x, ps[0]!.y);
  await page.mouse.down();
  for (const p of ps.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
  await page.waitForTimeout(250);
  await page.mouse.up();
  await expect
    .poll(async () => (await state(page)).segments, { timeout: 5_000 })
    .toBeGreaterThan(before)
    .catch(() => undefined);
  return (await state(page)).segments > before;
}

/** A building from the toolbar, put at the first spot the hint says is good (as a player hovers). */
async function placeMouse(
  page: Page,
  category: string,
  def: string,
  spots: [number, number][],
): Promise<boolean> {
  const n0 = await civicCount(page);
  const button = page.getByTestId(`place-${def}`);
  if (!(await page.getByTestId('place-options').isVisible()) || !(await button.isVisible()))
    await page.getByTestId(`tool-${category}`).click();
  if (await button.isDisabled()) return false;
  await button.click();
  for (const [x, z] of spots) {
    const p = await screenAt(page, x, z);
    if (!p.onMap) continue;
    await page.mouse.move(p.x, p.y, { steps: 3 });
    const h = await settledHint(page);
    if (!/\bok\b/.test(h.tone) || h.text.includes('replaces')) continue;
    await page.mouse.click(p.x, p.y);
    const placed = await expect
      .poll(() => civicCount(page), { timeout: 5_000 })
      .toBeGreaterThan(n0)
      .then(
        () => true,
        () => false,
      );
    if (placed) return true;
  }
  return false;
}

test('phase 6 end, 1: a brand-new player’s first city on a laptop, its timelapse, and a problem reported @playthrough @phase6', async ({
  browser,
}) => {
  test.setTimeout(45 * 60_000);
  // A brand-new player: nothing stored at all (the first-launch check runs; tips are on).
  const ctx = await newContext(browser, { viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = watchErrors(page);
  const who = 'a';
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 120_000 });
  await page.waitForFunction(() => window.__game?.getShell().settings.graphicsChecked === true, null, {
    timeout: 120_000,
  });
  const picked = await page.evaluate(() => window.__game!.getShell().settings);
  log(`first launch picked ${JSON.stringify({ quality: picked.quality, auto: picked.autoGraphics })}`);
  // The one sentence about crash reports, once.
  await expect(page.getByTestId('reports-notice')).toBeVisible();
  log(`main menu notice: ${(await page.getByTestId('reports-notice').innerText()).replace(/\s+/g, ' ')}`);
  await snap(page, `${who}-menu`);
  await page.getByTestId('reports-notice-ok').click();
  await page.getByTestId('main-new').click();
  await page.getByTestId('new-name').fill('Firstville');
  await page.getByTestId('preset-river').click();
  await page.getByTestId('new-seed').fill('maplewood');
  // The tutorial is on for a first city.
  await expect(page.getByTestId('new-tutorial')).toBeChecked();
  await snap(page, `${who}-new-city`);
  await page.getByTestId('new-start').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 120_000,
  });
  const cz = (await state(page)).highwayZ;
  const seen: string[] = [];
  const opts = { seen };

  // 1. Welcome.
  await card(page, who, 'welcome', opts);
  await snap(page, `${who}-welcome`);
  await press(page, 'tutorial-next');

  // 2. A road: the arrow at the road tool; an avenue off the highway, side streets, a back street.
  await card(page, who, 'road', opts);
  expect(await arrow(page, 'road')).toBe('tool-road');
  await snap(page, `${who}-arrow-road`);
  await topDown(page, cz);
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-avenue').click();
  const missed: string[] = [];
  const road = async (pts: [number, number][]) => {
    if (!(await dragMouse(page, pts))) missed.push(JSON.stringify(pts));
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
  expect(missed, missed.join('\n')).toEqual([]);
  await page.getByTestId('tool-select').click();

  // 3–4. Homes, then shops and industry, filled block by block (Shift and a click).
  await card(page, who, 'homes', opts);
  expect(await arrow(page, 'homes')).toBe('tool-zone');
  await page.getByTestId('tool-zone').click();
  const fill = async (zone: string, spots: [number, number][]) => {
    await page.getByTestId(`zone-${zone}`).click();
    for (const [x, z] of spots) {
      const p = await screenAt(page, x, z);
      expect(p.onMap, `(${x}, ${z}) under the interface`).toBe(true);
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
  await card(page, who, 'jobs', opts);
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

  // 5–6. Power, water and sewage, where the arrows point.
  const sides = (xs: number[], z: number, off: number): [number, number][] =>
    xs.flatMap((x) => [
      [x, z - off],
      [x, z + off],
    ]);
  const east = sides([530, 560, 590, 620, 650, 680, 710, 740], cz, 30);
  const north = sides([140, 170, 200, 230, 260, 290, 320, 350, 380], cz - 160, 30).filter(
    ([, z]) => z < cz - 160,
  );
  await card(page, who, 'power', opts);
  expect(await arrow(page, 'power')).toBe('tool-power');
  expect(await placeMouse(page, 'power', 'wind', east)).toBe(true);
  expect(await placeMouse(page, 'power', 'wind', east)).toBe(true);
  await card(page, who, 'water', opts);
  expect(await arrow(page, 'water')).toBe('tool-water');
  expect(await placeMouse(page, 'water', 'pump', north)).toBe(true);
  expect(await placeMouse(page, 'water', 'septic', east)).toBe(true);
  await page.getByTestId('tool-select').click();
  await snap(page, `${who}-utilities`);

  // 7–8. Time runs; the demand bars, read while the game holds still.
  if (await card(page, who, 'time', { ...opts, orLater: true })) {
    expect(await arrow(page, 'time')).toBe('speed-1');
    await page.getByTestId('speed-1').click();
    await advance(page, 600);
  }
  await card(page, who, 'demand', opts);
  expect(await arrow(page, 'demand')).toBe('rci');
  await expect(page.getByTestId('speed-0')).toHaveClass(/active/);
  await snap(page, `${who}-demand`);
  await press(page, 'tutorial-next');

  /** The player's month: utilities kept ahead of demand, services as money allows, time played on. */
  const services: [string, string][] = [
    ['parks', 'park_small'],
    ['garbage', 'landfill'],
    ['education', 'primary'],
    ['police', 'police'],
  ];
  const keepUp = async () => {
    const s = await state(page);
    await topDown(page, cz);
    const u = s.utilities;
    if (u.power.supply < u.power.demand * 1.2 + 10)
      await placeMouse(page, 'power', s.population > 800 && s.treasury > 20_000 ? 'coal' : 'wind', east);
    if (u.water.supply < u.water.demand * 1.2 + 10) await placeMouse(page, 'water', 'pump', north);
    if (u.sewage.supply < u.sewage.demand * 1.2 + 10) await placeMouse(page, 'water', 'septic', east);
    await page.getByTestId('tool-select').click();
  };
  const addService = async () => {
    const s = await state(page);
    if (!services.length || s.treasury < 16_000) return;
    const [cat, def] = services[0]!;
    if (await placeMouse(page, cat, def, cat === 'garbage' ? east : north)) services.shift();
    await page.getByTestId('tool-select').click();
  };
  // A month in four steps, so the timelapse keeps a frame of each (as a city played at speed would).
  const month = async () => {
    for (let q = 0; q < 4; q++) {
      await advance(page, 360);
      await frames(page, 2);
    }
    const t = await tut(page);
    if (t.event && t.step)
      await card(page, who, ORDER[Math.max(0, t.index)] ?? 'grow150', opts).catch(() => undefined);
    await readTips(page, who);
  };

  // 9. Grow to 150.
  await card(page, who, 'grow150', { ...opts, orLater: true });
  for (let m = 0; m < 12 && (await state(page)).population < 150; m++) {
    await keepUp();
    await month();
  }

  // 10–11. The budget from the money in the top bar, then taxes beside it.
  await card(page, who, 'budget', { ...opts, timeout: 60_000 });
  expect(await arrow(page, 'budget')).toBe('open-budget');
  await page.getByTestId('open-budget').click();
  await card(page, who, 'taxes', opts);
  // The budget opens on its Overview: the arrow points at the Taxes tab, then at the slider.
  expect(await arrow(page, 'taxes')).toBe('budget-tab-taxes');
  await page.getByTestId('budget-tab-taxes').click();
  await expect.poll(() => arrow(page, 'taxes'), { timeout: 3_000 }).toBe('tax-R1');
  await snap(page, `${who}-taxes`);
  await press(page, 'tutorial-next');
  await page.getByTestId('open-budget').click();

  // 12. Services: a fire station and a clinic near the homes (money handed over: the tutorial's town
  // can't yet afford both, and the player would wait months for it).
  await card(page, who, 'services', opts);
  expect(await arrow(page, 'services')).toBe('tool-fire');
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 30_000 }));
  await topDown(page, cz);
  expect(await placeMouse(page, 'fire', 'firestation', north)).toBe(true);
  expect(await placeMouse(page, 'health', 'clinic', north)).toBe(true);
  await page.getByTestId('tool-select').click();

  // 13. A coverage map from the data maps.
  await card(page, who, 'coverage', opts);
  expect(await arrow(page, 'coverage')).toBe('tool-maps');
  await page.getByTestId('tool-maps').click();
  await page.getByTestId('map-fire').click();
  await snap(page, `${who}-coverage`);
  await card(page, who, 'advisors', opts);
  const advisorsAt = await arrow(page, 'advisors');
  await page.getByTestId('tool-maps').click();
  await page
    .getByTestId('map-fire')
    .click()
    .catch(() => undefined);

  // 14. The advisors, opened where the arrow points.
  if (advisorsAt === 'open-more') await page.getByTestId('open-more').click();
  await page.getByTestId('open-advisors').click();
  await expect(page.getByTestId('advisors')).toBeVisible();
  await snap(page, `${who}-advisors`);
  await page.getByTestId('advisors').getByRole('button', { name: 'Close' }).click();

  // 15. Grow to 500.
  await card(page, who, 'grow500', { ...opts, orLater: true });
  for (let m = 0; m < 24 && (await state(page)).population < 500; m++) {
    await keepUp();
    await addService();
    await month();
  }

  // 16. Save from the menu.
  await card(page, who, 'save', { ...opts, timeout: 60_000 });
  expect(await arrow(page, 'save')).toBe('menu-button');
  await page.getByTestId('menu-button').click();
  await page.getByTestId('menu-save').click();
  await expect(page.getByTestId('toast').last()).toContainText('Saved');
  await page.getByTestId('pause-resume').click();

  // 17–18. Grow to 1,000; the last card.
  await card(page, who, 'grow1000', { ...opts, orLater: true });
  for (let m = 0; m < 36 && (await state(page)).population < 1000; m++) {
    await keepUp();
    await addService();
    await month();
    const s = await state(page);
    log(`${who} month ${Math.floor(s.tick / 1440)}: ${s.population} residents, $${s.treasury}`);
  }
  await card(page, who, 'finish', { ...opts, timeout: 60_000 });
  await topDown(page, cz, 620);
  await snap(page, `${who}-town-1000`);
  await press(page, 'tutorial-next');
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
  log(
    `${who} tutorial done at ${(await state(page)).population}; first problems met: ${seen.join(', ') || 'none'}`,
  );

  // The town played on for two more years, the player keeping it supplied.
  for (let m = 0; m < 24; m++) {
    await keepUp();
    await addService();
    await month();
  }
  const grown = await state(page);
  log(`${who} after two more years: ${grown.population} residents, $${grown.treasury}`);

  // A timelapse of it: City history → Make timelapse, 30 seconds of the whole map with music.
  const tl = await page.evaluate(() => window.__game!.getTimelapse());
  log(`${who} timelapse kept: ${JSON.stringify({ frames: tl.frames, bytes: tl.bytes, late: tl.late })}`);
  await page.getByTestId('open-history').click();
  await expect(page.getByTestId('timelapse-recorded')).toContainText('frames since');
  await page.getByTestId('timelapse-open').click();
  await expect(page.getByTestId('timelapse-card')).toBeVisible();
  await page.getByTestId('timelapse-length-30').click();
  await page.getByTestId('timelapse-view-wide').click();
  await page.getByTestId('timelapse-music').check();
  const t0 = Date.now();
  await page.getByTestId('timelapse-make').click();
  await expect(page.getByTestId('timelapse-result')).toBeVisible({ timeout: 600_000 });
  log(`${who} a 30 s timelapse made in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const v = await page.evaluate(async () => {
    const el = document.querySelector<HTMLVideoElement>('[data-testid=timelapse-video]')!;
    if (el.readyState < 1) await new Promise((r) => el.addEventListener('loadedmetadata', r, { once: true }));
    return { duration: el.duration, width: el.videoWidth, height: el.videoHeight };
  });
  expect(v.duration).toBeGreaterThan(29.5);
  expect([v.width, v.height]).toEqual([960, 540]);
  await snap(page, `${who}-timelapse`);
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('timelapse-download').click(),
  ]);
  const mp4 = readFileSync((await dl.path())!);
  log(`${who} saved ${dl.suggestedFilename()} (${(mp4.length / 1e6).toFixed(1)} MB)`);
  expect(dl.suggestedFilename()).toBe('Firstville-timelapse-30s-wide.mp4');
  expect(mp4.subarray(4, 8).toString('latin1')).toBe('ftyp');
  await page.getByTestId('timelapse-close').click();
  await page.getByTestId('open-history').click();

  // Something felt off: reported from the pause menu, with a picture, seeing what goes first.
  await page.getByTestId('menu-button').click();
  await page.getByTestId('pause-report').click();
  await page.getByTestId('report-note').fill('The first fire came while I was reading the budget card.');
  await page.getByTestId('report-shot').check();
  await expect(page.getByTestId('report-shot-preview')).toBeVisible();
  await page.getByTestId('report-what').click();
  await expect(page.getByTestId('report-lines')).toBeVisible();
  await snap(page, `${who}-report`);
  await page.getByTestId('report-send').click();
  await expect(page.getByText('Thanks: your report is on its way.')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('report-screen')).toBeHidden();
  await page.getByTestId('pause-resume').click();
  writeFileSync(
    NOTES,
    JSON.stringify({ report: 'The first fire came while I was reading the budget card.' }),
  );
  log(`findings: ${findings.length ? findings.join(' | ') : 'none'}`);
  errs.check();
});

// ———————————————————————————————————— 2–3. Phones, by touch ————————————————————————————————————

/** Frame the camera so every point is on the map (not under the card, the bars or a sheet). */
async function frameOn(page: Page, pts: [number, number][], at: { x: number; z: number; d: number }) {
  // Looking at the points' middle (the town's first streets are near `at`).
  const c = {
    x: pts.reduce((t, p) => t + p[0], 0) / pts.length,
    z: pts.reduce((t, p) => t + p[1], 0) / pts.length,
    d: at.d,
  };
  for (const k of [1, 1.3, 1.7, 2.2])
    for (const dz of [0, 90, -90, 180, -180])
      for (const dx of [0, 80, -80]) {
        await page.evaluate(
          ([x, z, d]) => window.__game!.setCamera({ x: x!, z: z!, distance: d!, yaw: 0, tilt: 0.55 }),
          [c.x + dx, c.z + dz, c.d * k],
        );
        await frames(page, 2);
        let all = true;
        for (const [x, z] of pts)
          if (!(await screenAt(page, x, z)).onMap) {
            all = false;
            break;
          }
        if (all) return true;
      }
  return false;
}

/** A road drawn with a finger; it asks with the price before spending, and the player says yes. */
async function fingerRoad(
  page: Page,
  f: Fingers,
  pts: [number, number][],
  c: { x: number; z: number; d: number },
) {
  const before = (await state(page)).segments;
  let asked = false;
  // (A lesson or a notice arriving mid-drag can take it: the player draws it again.)
  for (let attempt = 0; attempt < 2 && !asked; attempt++) {
    if ((await tut(page)).event) await page.getByTestId('tutorial-next').tap();
    if (!(await frameOn(page, pts, c))) {
      log(`phone: nowhere to see the whole of road ${JSON.stringify(pts)} beside the card`);
      return false;
    }
    const sp = [];
    for (const [x, z] of pts) sp.push(await screenAt(page, x, z));
    await f.drag(sp, 8);
    asked = await page
      .getByTestId('tool-question')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(
        () => true,
        () => false,
      );
    if (!asked) log(`phone road ${JSON.stringify(pts)}: no question; hint ${(await settledHint(page)).text}`);
  }
  if (!asked) return false;
  await page.getByTestId('tool-question-yes').tap();
  return expect
    .poll(async () => (await state(page)).segments, { timeout: 15_000 })
    .toBeGreaterThan(before)
    .then(
      () => true,
      () => false,
    );
}

/** A zone painted with a finger along the points. */
async function fingerZone(
  page: Page,
  f: Fingers,
  zone: string,
  pts: [number, number][],
  c: { x: number; z: number; d: number },
) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const z = page.getByTestId(`zone-${zone}`);
    // (The zone bar follows a tap on Zones a moment later: tapping again would put the tool away.)
    const shown = await z.waitFor({ state: 'visible', timeout: 1_500 }).then(
      () => true,
      () => false,
    );
    if (!shown) await page.getByTestId('tool-zone').tap();
    await z.tap();
    // (Framed once the tool's bar is up: it takes room at the foot.)
    await page.waitForTimeout(300);
    if (!(await frameOn(page, pts, c)))
      log(`phone: nowhere to see the whole of a ${zone} stroke beside the card`);
    const before = (await state(page)).zoned;
    const sp = [];
    for (const [x, zz] of pts) sp.push(await screenAt(page, x, zz));
    await f.drag(sp, 10);
    await frames(page, 2);
    await page.waitForTimeout(500);
    const after = (await state(page)).zoned;
    if (JSON.stringify(after) !== JSON.stringify(before)) return;
    // Painted already, or a first problem's lesson came mid-stroke (its camera flies and the game holds):
    // read it and paint again.
    const t = await tut(page);
    if (!t.event) return;
    log(`phone ${zone} stroke interrupted by ${t.step}: read, then painted again`);
    await page.getByTestId('tutorial-next').tap();
  }
}

/** A building from the Build sheet at the first spot a long press says is good; null if none was. */
async function fingerPlace(
  page: Page,
  f: Fingers,
  category: string,
  def: string,
  spots: [number, number][],
  c: { x: number; z: number; d: number },
): Promise<boolean> {
  const n0 = await civicCount(page);
  await page.getByTestId('tool-build').tap();
  await expect(page.getByTestId('build-sheet')).toBeVisible();
  await page.getByTestId(`tool-${category}`).tap();
  const b = page.getByTestId(`place-${def}`);
  await expect(b).toBeVisible();
  if (await b.isDisabled()) {
    await page.getByTestId('tool-select').tap();
    return false;
  }
  await b.tap();
  let pick: [number, number] | null = null;
  let fallback: [number, number] | null = null;
  const said: string[] = [];
  for (const [x, z] of spots) {
    let p = await screenAt(page, x, z);
    if (!p.onMap && (await frameOn(page, [[x, z]], c))) p = await screenAt(page, x, z);
    if (!p.onMap) {
      said.push(`${x - 0},${Math.round(z)}: hidden`);
      continue;
    }
    await f.hold(p, 650);
    const h = await settledHint(page);
    said.push(`${x},${Math.round(z)}: ${h.text}`);
    if (!/\bok\b/.test(h.tone)) continue;
    if (h.text.includes('replaces')) {
      fallback ??= [x, z];
      continue;
    }
    pick = [x, z];
    break;
  }
  pick ??= fallback;
  if (!pick) {
    log(`no spot for ${def}:\n  ${said.join('\n  ')}`);
    await page.getByTestId('tool-select').tap();
    return false;
  }
  let at = await screenAt(page, pick[0], pick[1]);
  if (!at.onMap && (await frameOn(page, [pick], c))) at = await screenAt(page, pick[0], pick[1]);
  await f.tap(at);
  const ok = await expect
    .poll(() => civicCount(page), { timeout: 15_000 })
    .toBeGreaterThan(n0)
    .then(
      () => true,
      () => false,
    );
  await page.getByTestId('tool-select').tap();
  return ok;
}

/** The budget sheet put away by its × (a drag on its header closes it too: m49-phone tests that). */
async function closeBudget(page: Page) {
  const budget = page.getByTestId('budget');
  if (!(await budget.isVisible())) return;
  await budget.getByRole('button', { name: 'Close' }).tap();
  await expect(budget).toBeHidden();
}

async function phoneTutorial(page: Page, key: string, orient: Orient) {
  const who = `${key}-${orient}`;
  const errs = watchErrors(page);
  // A brand-new player on a phone: the first-launch check knows it's a phone; tips are on.
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 120_000,
  });
  await expect(page.locator('#ui[data-phone]')).toHaveCount(1);
  await expect
    .poll(() => page.evaluate(() => window.__game!.getShell().settings))
    .toMatchObject({ quality: 'phone', graphicsChecked: true });
  await expect(page.getByTestId('reports-notice')).toBeVisible();
  await snap(page, `${who}-menu`);
  await page.getByTestId('reports-notice-ok').tap();
  await page.getByTestId('main-new').tap();
  await page.getByTestId('new-name').fill('Pocketon');
  await page.getByTestId('preset-river').tap();
  await page.getByTestId('new-seed').fill('phone');
  await expect(page.getByTestId('new-tutorial')).toBeChecked();
  expect(await phoneProblems(page, '#ui'), `${who}: the new city screen`).toEqual([]);
  await page.getByTestId('new-start').tap();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 120_000,
  });
  const f = await fingers(page);
  const cz = (await state(page)).highwayZ;
  const c = { x: 200, z: cz, d: orient === 'portrait' ? 620 : 440 };
  const seen: string[] = [];
  const opts = { seen, tap: true };

  // 1. Welcome, in a phone's words.
  await card(page, who, 'welcome', opts);
  await expect(page.getByTestId('tutorial')).toContainText('pinch to zoom');
  await expect(page.getByTestId('tutorial')).not.toContainText('right-drag');
  await snap(page, `${who}-welcome`);
  expect(await phoneProblems(page, '[data-testid=tutorial]'), `${who}: the tutorial card`).toEqual([]);
  await press(page, 'tutorial-next', true);

  // 2. A road with a finger: a street off the highway, and a cross street.
  await card(page, who, 'road', opts);
  expect(await arrow(page, 'road')).toBe('tool-road');
  await page.getByTestId('tool-road').tap();
  await expect(page.getByTestId('road-options')).toBeVisible();
  // The card folds to one line while the player acts on it, leaving the map to draw on.
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-folded', '');
  expect(await phoneProblems(page, '#ui'), `${who}: the folded card`).toEqual([]);
  expect(
    await fingerRoad(
      page,
      f,
      [
        [24, cz],
        [140, cz],
        [250, cz],
      ],
      c,
    ),
  ).toBe(true);
  await snap(page, key === 'iphone' ? 'b-iphone-road' : `${who}-road`);
  expect(
    await fingerRoad(
      page,
      f,
      [
        [150, cz - 110],
        [150, cz],
        [150, cz + 110],
      ],
      c,
    ),
  ).toBe(true);
  await page.getByTestId('tool-select').tap();

  // 3–4. Homes, shops and industry, painted with a finger.
  await card(page, who, 'homes', opts);
  // The next card comes unfolded; folded again by Hide, and back at a tap.
  await expect(page.getByTestId('tutorial')).not.toHaveAttribute('data-folded', '');
  expect(await arrow(page, 'homes')).toBe('tool-zone');
  await page.getByTestId('tutorial-fold').tap();
  await expect(page.getByTestId('tutorial')).toHaveAttribute('data-folded', '');
  await page.getByTestId('tutorial').tap();
  await expect(page.getByTestId('tutorial-skip-step')).toBeVisible();
  await page.getByTestId('tool-zone').tap();
  await fingerZone(
    page,
    f,
    'R',
    [
      [40, cz - 35],
      [240, cz - 35],
    ],
    c,
  );
  await fingerZone(
    page,
    f,
    'R',
    [
      [40, cz - 65],
      [240, cz - 65],
    ],
    c,
  );
  await fingerZone(
    page,
    f,
    'R',
    [
      [130, cz - 50],
      [130, cz - 100],
    ],
    c,
  );
  await fingerZone(
    page,
    f,
    'R',
    [
      [170, cz - 50],
      [170, cz - 100],
    ],
    c,
  );
  await card(page, who, 'jobs', opts);
  await fingerZone(
    page,
    f,
    'C',
    [
      [40, cz + 35],
      [130, cz + 35],
    ],
    c,
  );
  await fingerZone(
    page,
    f,
    'I',
    [
      [172, cz + 50],
      [172, cz + 100],
    ],
    c,
  );
  await page.getByTestId('tool-select').tap();
  const z = (await state(page)).zoned;
  expect(z.R > 0 && z.C > 0 && z.I > 0, JSON.stringify(z)).toBe(true);

  // 5–6. Power, water and sewage from the Build sheet.
  const south: [number, number][] = [
    [210, cz + 30],
    [240, cz + 30],
    [128, cz + 60],
    [128, cz + 90],
    [180, cz + 30],
  ];
  const north: [number, number][] = [
    [90, cz - 125],
    [128, cz - 125],
    [172, cz - 125],
    [210, cz - 60],
    [240, cz - 60],
  ];
  // Later streets add room: spots along them once they're built.
  const east: [number, number][] = [
    [390, cz + 30],
    [410, cz + 60],
    [360, cz + 30],
    [300, cz + 60],
    [360, cz + 90],
    [300, cz + 90],
  ];
  const farNorth: [number, number][] = [
    [190, cz - 140],
    [230, cz - 140],
    [270, cz - 140],
    [310, cz - 140],
    [360, cz - 60],
  ];
  // Beside the streets anywhere (homes give way to a service where nothing else is free).
  const around: [number, number][] = [
    ...[200, 230, 270, 300, 360, 390, 60, 90].flatMap((x): [number, number][] => [
      [x, cz - 30],
      [x, cz + 30],
    ]),
    ...[-90, -60, 60, 90].flatMap((dz): [number, number][] => [
      [120, cz + dz],
      [180, cz + dz],
    ]),
  ];
  await card(page, who, 'power', opts);
  expect(await arrow(page, 'power')).toBe('tool-build');
  expect(await fingerPlace(page, f, 'power', 'wind', south, c)).toBe(true);
  expect(await fingerPlace(page, f, 'power', 'wind', [...south, ...north], c)).toBe(true);
  await card(page, who, 'water', opts);
  expect(await fingerPlace(page, f, 'water', 'pump', north, c)).toBe(true);
  expect(await fingerPlace(page, f, 'water', 'septic', [...south, ...north], c)).toBe(true);

  // 7–8. Time, in a phone's words; the demand bars.
  await snap(page, `${who}-utilities`);
  if (await card(page, who, 'time', { ...opts, orLater: true })) {
    await expect(page.getByTestId('tutorial')).not.toContainText('space bar');
    expect(await arrow(page, 'time')).toBe('speed-1');
    await page.getByTestId('speed-1').tap();
    // Then faster, as the card says, until the first families are in.
    await page.getByTestId('speed-3').tap();
    for (let k = 0; k < 6 && (await state(page)).population < 40; k++) await advance(page, 600);
    const s = await state(page);
    log(
      `${who} after the first hours: ${s.population} residents, zoned ${JSON.stringify(s.zoned)}, power ${Math.round(s.utilities.power.supply)}/${Math.round(s.utilities.power.demand)}, water ${Math.round(s.utilities.water.supply)}/${Math.round(s.utilities.water.demand)}, civics ${await civicCount(page)}`,
    );
    await snap(page, `${who}-time`);
  }
  await card(page, who, 'demand', opts);
  expect(await arrow(page, 'demand')).toBe('rci');
  await press(page, 'tutorial-next', true);

  // More streets and zones, as the bars ask (the next cards say so).
  await card(page, who, 'grow150', { ...opts, orLater: true });
  await page.getByTestId('tool-road').tap();
  await fingerRoad(
    page,
    f,
    [
      [250, cz],
      [335, cz],
      [420, cz],
    ],
    c,
  );
  await fingerRoad(
    page,
    f,
    [
      [330, cz - 110],
      [330, cz],
      [330, cz + 110],
    ],
    c,
  );
  await page.getByTestId('tool-select').tap();
  await page.getByTestId('tool-zone').tap();
  await fingerZone(
    page,
    f,
    'R',
    [
      [260, cz - 35],
      [410, cz - 35],
    ],
    c,
  );
  await fingerZone(
    page,
    f,
    'R',
    [
      [310, cz - 50],
      [310, cz - 100],
    ],
    c,
  );
  await fingerZone(
    page,
    f,
    'C',
    [
      [260, cz + 35],
      [320, cz + 35],
    ],
    c,
  );
  await page.getByTestId('tool-select').tap();
  const services: [string, string][] = [
    ['parks', 'park_small'],
    ['garbage', 'landfill'],
    ['education', 'primary'],
    ['police', 'police'],
  ];
  const hasFireStation = () =>
    page.evaluate(() => window.__game!.getCivics().some((x) => x.def === 'firestation'));
  const taught = () =>
    page.evaluate(() => (window.__game!.getShell().settings as { tutorialSeen: string[] }).tutorialSeen);
  const keepUp = async () => {
    const s = await state(page);
    const u = s.utilities;
    // A fire's lesson said to build a fire station near the homes: the player does, once they can.
    if ((await taught()).includes('firstFire') && s.treasury > 12_000 && !(await hasFireStation()))
      await fingerPlace(page, f, 'fire', 'firestation', [...north, ...farNorth, ...around], c);
    if (u.power.supply < u.power.demand * 1.2 + 10)
      await fingerPlace(
        page,
        f,
        'power',
        s.population > 800 && s.treasury > 20_000 ? 'coal' : 'wind',
        [...east, ...south],
        c,
      );
    if (u.water.supply < u.water.demand * 1.2 + 10)
      await fingerPlace(page, f, 'water', 'pump', [...north, ...farNorth, ...around], c);
    if (u.sewage.supply < u.sewage.demand * 1.2 + 10)
      await fingerPlace(page, f, 'water', 'septic', [...east, ...south], c);
    if (services.length && s.treasury > 16_000) {
      const [cat, def] = services[0]!;
      if (
        await fingerPlace(page, f, cat, def, cat === 'garbage' ? east : [...north, ...farNorth, ...around], c)
      )
        services.shift();
    }
  };
  const month = async () => {
    await advance(page, 1440);
    await frames(page, 2);
    const t = await tut(page);
    if (t.event && t.step)
      await card(page, who, ORDER[Math.max(0, t.index)] ?? 'grow150', opts).catch(() => undefined);
    await readTips(page, who, true);
  };
  for (let m = 0; m < 12 && (await state(page)).population < 150; m++) {
    await keepUp();
    await month();
    const s = await state(page);
    log(
      `${who} month ${Math.floor(s.tick / 1440)}: ${s.population} residents, $${s.treasury}, zoned ${JSON.stringify(s.zoned)}, jobs ${s.jobsFilled}/${s.jobs}, buildings ${s.buildings}, abandoned ${s.abandoned}, demand ${JSON.stringify(s.demand)} ${JSON.stringify(s.demandFactors).slice(0, 300)}, sewage ${Math.round(s.utilities.sewage.supply)}/${Math.round(s.utilities.sewage.demand)}`,
    );
  }

  // 10–11. The budget by a tap on the money, in a phone's words; the Taxes tab where the arrow points.
  await card(page, who, 'budget', { ...opts, timeout: 60_000 });
  await expect(page.getByTestId('tutorial')).toContainText('Tap your money');
  expect(await arrow(page, 'budget')).toBe('open-budget');
  await page.getByTestId('open-budget').tap();
  await card(page, who, 'taxes', opts);
  expect(await arrow(page, 'taxes')).toBe('budget-tab-taxes');
  await page.getByTestId('budget-tab-taxes').tap();
  await expect.poll(() => arrow(page, 'taxes'), { timeout: 3_000 }).toBe('tax-R1');
  await snap(page, `${who}-taxes`);
  expect(await phoneProblems(page, '[data-testid=tutorial]'), `${who}: the taxes card`).toEqual([]);
  await press(page, 'tutorial-next', true);
  await closeBudget(page);

  // 12. Services (money handed over, as on the laptop).
  await card(page, who, 'services', opts);
  expect(await arrow(page, 'services')).toBe('tool-build');
  await page.evaluate(() => window.__game!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 30_000 }));
  expect(await fingerPlace(page, f, 'fire', 'firestation', [...north, ...farNorth, ...around], c)).toBe(true);
  expect(await fingerPlace(page, f, 'health', 'clinic', [...north, ...farNorth, ...around], c)).toBe(true);

  // 13. A coverage map from the bar's Maps.
  await card(page, who, 'coverage', opts);
  expect(await arrow(page, 'coverage')).toBe('tool-maps');
  await page.getByTestId('tool-maps').tap();
  await page.getByTestId('map-fire').tap();
  await snap(page, `${who}-coverage`);
  await card(page, who, 'advisors', opts);
  const advisorsAt = await arrow(page, 'advisors');
  if (await page.getByTestId('map-fire').isVisible()) await page.getByTestId('map-fire').tap();
  if (await page.getByTestId('map-fire').isVisible()) await page.getByTestId('tool-maps').tap();

  // 14. The advisors, where the arrow points.
  if (advisorsAt === 'open-more') await page.getByTestId('open-more').tap();
  await page.getByTestId('open-advisors').tap();
  await expect(page.getByTestId('advisors')).toBeVisible();
  await snap(page, `${who}-advisors`);
  expect(await phoneProblems(page, '[data-testid=advisors]'), `${who}: the advisors`).toEqual([]);
  await page.getByTestId('advisors').getByRole('button', { name: 'Close' }).tap();

  // 15. Grow to 500, with two more streets.
  await card(page, who, 'grow500', { ...opts, orLater: true });
  await page.getByTestId('tool-road').tap();
  await fingerRoad(
    page,
    f,
    [
      [150, cz - 110],
      [240, cz - 110],
      [330, cz - 110],
    ],
    c,
  );
  await fingerRoad(
    page,
    f,
    [
      [150, cz + 110],
      [240, cz + 110],
      [330, cz + 110],
    ],
    c,
  );
  await page.getByTestId('tool-select').tap();
  await page.getByTestId('tool-zone').tap();
  // The zone paint shows while zoning, even with the fire map from the Coverage card still on.
  await expect(page.getByTestId('zone-options')).toBeVisible();
  expect(await page.evaluate(() => window.__game!.groupShown('zones'))).toBe(true);
  await fingerZone(
    page,
    f,
    'R',
    [
      [170, cz - 125],
      [310, cz - 125],
    ],
    c,
  );
  await fingerZone(
    page,
    f,
    'I',
    [
      [170, cz + 125],
      [310, cz + 125],
    ],
    c,
  );
  await page.getByTestId('tool-select').tap();
  // More streets when the town stops growing with homes wanted (the bars ask for them), homes beside.
  const more: { road: [number, number][]; homes: [number, number][][] }[] = [
    {
      road: [
        [420, cz],
        [480, cz],
        [540, cz],
      ],
      homes: [
        [
          [430, cz - 30],
          [530, cz - 30],
        ],
        [
          [430, cz + 30],
          [530, cz + 30],
        ],
      ],
    },
    {
      road: [
        [480, cz - 110],
        [480, cz],
        [480, cz + 110],
      ],
      homes: [
        [
          [460, cz - 40],
          [460, cz - 100],
        ],
        [
          [500, cz - 40],
          [500, cz - 100],
        ],
      ],
    },
    // Back streets further east, and a cross street west, before going further out.
    ...[-110, 110].map((dz) => ({
      road: [
        [330, cz + dz],
        [405, cz + dz],
        [480, cz + dz],
      ] as [number, number][],
      homes: [
        [
          [340, cz + dz + Math.sign(dz) * 20],
          [470, cz + dz + Math.sign(dz) * 20],
        ],
        [
          [340, cz + dz - Math.sign(dz) * 30],
          [470, cz + dz - Math.sign(dz) * 30],
        ],
      ] as [number, number][][],
    })),
    {
      road: [
        [80, cz - 110],
        [80, cz],
        [80, cz + 110],
      ],
      homes: [
        [
          [60, cz - 40],
          [60, cz - 100],
        ],
        [
          [100, cz + 40],
          [100, cz + 100],
        ],
      ],
    },
    ...[600, 720].flatMap((x) => [
      {
        road: [
          [x - 60, cz],
          [x, cz],
          [x + 60, cz],
        ] as [number, number][],
        homes: [
          [
            [x - 50, cz - 30],
            [x + 50, cz - 30],
          ],
          [
            [x - 50, cz + 30],
            [x + 50, cz + 30],
          ],
        ] as [number, number][][],
      },
      {
        road: [
          [x, cz - 110],
          [x, cz],
          [x, cz + 110],
        ] as [number, number][],
        homes: [
          [
            [x - 20, cz - 40],
            [x - 20, cz - 100],
          ],
          [
            [x + 20, cz - 40],
            [x + 20, cz - 100],
          ],
        ] as [number, number][][],
      },
    ]),
  ];
  let was = 0;
  const growMore = async () => {
    const s = await state(page);
    // Whatever the bars ask for most, as the Demand card says.
    const want = (['R', 'C', 'I'] as const).reduce(
      (a, z) => (s.demand[z] > s.demand[a] ? z : a),
      'R' as 'R' | 'C' | 'I',
    );
    const stalled = s.population < was + 10 && s.demand[want] > 0.15;
    was = s.population;
    const next = stalled ? more.shift() : undefined;
    if (!next) return;
    log(
      `${who} the town has stopped at ${s.population}, the bars asking for ${want} (${JSON.stringify(s.demand)}): another street`,
    );
    await page.getByTestId('tool-road').tap();
    await fingerRoad(page, f, next.road, c);
    await page.getByTestId('tool-select').tap();
    await page.getByTestId('tool-zone').tap();
    for (const h of next.homes) await fingerZone(page, f, want, h, c);
    await page.getByTestId('tool-select').tap();
  };
  for (let m = 0; m < 24 && (await state(page)).population < 500; m++) {
    await keepUp();
    await growMore();
    await month();
    const s = await state(page);
    log(
      `${who} month ${Math.floor(s.tick / 1440)}: ${s.population} residents, $${s.treasury}, zoned ${JSON.stringify(s.zoned)}, jobs ${s.jobsFilled}/${s.jobs}, demand ${JSON.stringify(s.demand)}, power ${Math.round(s.utilities.power.supply)}/${Math.round(s.utilities.power.demand)}, water ${Math.round(s.utilities.water.supply)}/${Math.round(s.utilities.water.demand)}`,
    );
  }

  // 16. Save from the menu (☰).
  await card(page, who, 'save', { ...opts, timeout: 60_000 });
  await expect(page.getByTestId('tutorial')).not.toContainText('(Esc)');
  expect(await arrow(page, 'save')).toBe('menu-button');
  await page.getByTestId('menu-button').tap();
  await page.getByTestId('menu-save').tap();
  await expect(page.getByTestId('toast').last()).toContainText('Saved');
  await page.getByTestId('pause-resume').tap();

  // 17–18. Grow to 1,000; the last card.
  await card(page, who, 'grow1000', { ...opts, orLater: true });
  for (let m = 0; m < 36 && (await state(page)).population < 1000; m++) {
    await keepUp();
    await growMore();
    await month();
    const s = await state(page);
    log(`${who} month ${Math.floor(s.tick / 1440)}: ${s.population} residents, $${s.treasury}`);
  }
  await card(page, who, 'finish', { ...opts, timeout: 60_000 });
  await frameOn(page, [[150, cz]], c);
  await snap(page, key === 'iphone' ? 'b-iphone-town' : 'c-pixel-town');
  await press(page, 'tutorial-next', true);
  await expect(page.getByTestId('tutorial')).toHaveCount(0);
  const mem = await page.evaluate(() => window.__game!.getShell());
  log(
    `${who} done: ${(await state(page)).population} residents; first problems ${seen.join(', ') || 'none'}; ${JSON.stringify(mem.applied ?? {}).slice(0, 200)}`,
  );
  log(`findings: ${findings.length ? findings.join(' | ') : 'none'}`);
  errs.check();
}

for (const [n, key, name, orient] of [
  [2, 'iphone', 'iPhone 13', 'portrait'],
  [3, 'pixel', 'Pixel 7', 'landscape'],
] as const) {
  test.describe(`${key} ${orient}`, () => {
    test.use(phone(name, orient));
    test(`phase 6 end, ${n}: a brand-new player’s first city with the tutorial by touch (${name}, ${orient}) @playthrough @phase6`, async ({
      page,
    }) => {
      test.setTimeout(45 * 60_000);
      await phoneTutorial(page, key, orient);
    });
  });
}

// ————————————————————————————————— 4. A four-player quick match —————————————————————————————————

const MATCH_NAMES = ['Ada', 'Sam', 'Kit', 'Lou'];

/** A player's page for a match: a name and colour of their own, tips off (they've played before). */
async function matchPage(browser: Browser, k: number, device: BrowserContextOptions, quality: string) {
  const ctx = await newContext(browser, { ...device, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(
    ([n, c, q]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(
        key,
        JSON.stringify({
          ...s,
          tips: false,
          graphicsChecked: true,
          quality: q,
          shadows: q === 'high',
          reportsNotice: true,
          timelapse: false,
        }),
      );
    },
    [MATCH_NAMES[k]!, k, quality] as const,
  );
  return ctx.newPage();
}

/** A laptop player's town, with the mouse: streets off the highway, zones block by block, coal and water. */
async function mouseTown(page: Page, streets: number[]) {
  const s = await state(page);
  const cz = s.highwayZ;
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 220, z: cz, distance: 640, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await frames(page, 2);
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  const roads: [number, number][][] = [
    [
      [24, cz],
      [200, cz],
      [400, cz],
    ],
    ...streets.map((x): [number, number][] => [
      [x, cz - 140],
      [x, cz],
      [x, cz + 140],
    ]),
  ];
  // (A smaller window shows less: the camera stands back until the streets are all in view.)
  await frameOn(page, roads.flat(), { x: 220, z: cz, d: 640 });
  for (const r of roads)
    if (!(await dragMouse(page, r))) {
      const where = await Promise.all(r.map(([x, z]) => screenAt(page, x, z)));
      log(
        `a laptop road ${JSON.stringify(r)} not built: ${where.map((p) => `${Math.round(p.x)},${Math.round(p.y)} ${p.onMap ? 'map' : 'covered'}`).join('; ')}`,
      );
    }
  await page.getByTestId('tool-select').click();
  await page.getByTestId('tool-zone').click();
  const fill = async (zone: string, spots: [number, number][]) => {
    await page.getByTestId(`zone-${zone}`).click();
    for (const [x, z] of spots) {
      const p = await screenAt(page, x, z);
      if (!p.onMap) continue;
      await page.mouse.move(p.x, p.y, { steps: 2 });
      await page.keyboard.down('Shift');
      await page.mouse.click(p.x, p.y);
      await page.keyboard.up('Shift');
    }
  };
  await fill(
    'R',
    streets.flatMap((x): [number, number][] => [
      [x, cz - 70],
      [x, cz + 70],
    ]),
  );
  await fill('C', [
    [60, cz],
    [300, cz],
  ]);
  await page.getByTestId('tool-select').click();
  const spots: [number, number][] = [380, 340, 300, 260, 220].flatMap((x): [number, number][] => [
    [x, cz + 30],
    [x, cz - 30],
  ]);
  await placeMouse(page, 'power', 'coal', spots);
  await placeMouse(page, 'water', 'pump', spots);
  await page.getByTestId('tool-select').click();
  const t = await state(page);
  log(
    `a laptop town: ${t.segments - s.segments} roads, zoned ${JSON.stringify(t.zoned)}, ${await civicCount(page)} buildings placed`,
  );
}

/** A phone player's town, by touch: a street and a cross street, homes and shops, a wind turbine and a pump. */
async function fingerTown(page: Page, f: Fingers, orient: Orient) {
  const cz = (await state(page)).highwayZ;
  const c = { x: 160, z: cz, d: orient === 'portrait' ? 560 : 420 };
  await page.getByTestId('tool-road').tap();
  await fingerRoad(
    page,
    f,
    [
      [24, cz],
      [140, cz],
      [260, cz],
    ],
    c,
  );
  await fingerRoad(
    page,
    f,
    [
      [150, cz - 110],
      [150, cz],
      [150, cz + 110],
    ],
    c,
  );
  await page.getByTestId('tool-select').tap();
  await page.getByTestId('tool-zone').tap();
  await fingerZone(
    page,
    f,
    'R',
    [
      [128, cz - 40],
      [128, cz - 100],
    ],
    c,
  );
  await fingerZone(
    page,
    f,
    'R',
    [
      [172, cz - 40],
      [172, cz - 100],
    ],
    c,
  );
  await fingerZone(
    page,
    f,
    'C',
    [
      [128, cz + 40],
      [128, cz + 100],
    ],
    c,
  );
  await page.getByTestId('tool-select').tap();
  const spots: [number, number][] = [
    [210, cz + 30],
    [240, cz + 30],
    [210, cz - 30],
    [240, cz - 30],
    [172, cz + 60],
    [172, cz + 90],
  ];
  await fingerPlace(page, f, 'power', 'wind', spots, c);
  await fingerPlace(page, f, 'water', 'pump', spots, c);
}

test('phase 6 end, 4: a four-player quick match, two on laptops and two on phones @playthrough @phase6', async ({
  browser,
}) => {
  test.setTimeout(30 * 60_000);
  const ada = await matchPage(browser, 0, { viewport: { width: 1280, height: 800 } }, GPU ? 'high' : 'low');
  const sam = await matchPage(browser, 1, { viewport: { width: 1100, height: 720 } }, 'low');
  const kit = await matchPage(browser, 2, phone('iPhone 13', 'portrait'), 'phone');
  const lou = await matchPage(browser, 3, phone('Pixel 7', 'landscape'), 'phone');
  const pages = [ada, sam, kit, lou];
  const errs = pages.map((p) => watchErrors(p));
  const ready = (p: Page) =>
    p.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
  try {
    // Ada sets up a Race on the Quick match screen and hosts it online.
    await ada.goto('./');
    await ready(ada);
    await ada.getByTestId('main-match').click();
    await expect(ada.getByTestId('match-screen')).toBeVisible();
    await snap(ada, 'd-screen');
    await ada.getByTestId('match-mode-race').click();
    await ada.getByTestId('match-target-5000').click();
    // (The local relay allows one-minute matches for tests; a real one is 15, 20 or 30.)
    await ada.getByTestId('match-minutes-1').click();
    await ada.getByTestId('match-chat').click();
    await ada.getByTestId('match-host-online').click();
    await ready(ada);
    const hostView = await until(ada, (m) => !!m.invite && m.phase === 'lobby', 'the match to open');
    const code = hostView.invite!;
    await ada.getByTestId('match-copy').click();
    await expect(ada.getByTestId('match-copy')).toHaveText('Link copied');
    const link = await ada.evaluate(() => navigator.clipboard.readText());
    log(`match ${code}, invite link ${link}`);
    // Sam types the code on a laptop; Kit opens the invite link on an iPhone; Lou types it on a Pixel.
    await sam.goto('./');
    await ready(sam);
    await sam.getByTestId('main-match').click();
    await sam.getByTestId('match-code').fill(code);
    await sam.getByTestId('match-join').click();
    await kit.goto(link);
    await lou.goto('./');
    await ready(lou);
    await lou.getByTestId('main-match').tap();
    await expect(lou.getByTestId('match-screen')).toBeVisible();
    expect(
      await phoneProblems(lou, '[data-testid=match-screen]'),
      'the Quick match screen on a Pixel',
    ).toEqual([]);
    await lou.getByTestId('match-code').fill(code.toLowerCase());
    await lou.getByTestId('match-join').tap();
    for (const p of [sam, kit, lou]) {
      await ready(p);
      await until(p, (m) => m.phase === 'lobby' && m.slot > 0, 'a guest in the lobby');
    }
    await until(ada, (m) => m.players.length === 4 && m.players.every((x) => x.ready), 'all four ready');
    await snap(ada, 'd-lobby');
    await snap(kit, 'd-phone-lobby');
    expect(await phoneProblems(kit, '[data-testid=match-lobby]'), 'the lobby on an iPhone').toEqual([]);
    await ada.getByTestId('match-start').click();
    for (const p of pages) await until(p, (m) => m.started, 'the clock to start', 60_000);
    const t0 = Date.now();

    // Everyone builds at once, each with their own hands; Kit cheers; Lou peeks at Ada's town.
    const [fk, fl] = [await fingers(kit), await fingers(lou)];
    await Promise.all([
      mouseTown(ada, [110, 200, 290]),
      mouseTown(sam, [150, 250]),
      fingerTown(kit, fk, 'portrait'),
      fingerTown(lou, fl, 'landscape'),
    ]);
    log(`all four built in ${((Date.now() - t0) / 1000).toFixed(0)} s of a one-minute match`);
    await kit.getByTestId('match-emote-btn').tap();
    await kit.getByTestId('match-emote-1').tap();
    const kitSlot = (await getMatch(kit)).slot;
    await until(ada, (m) => m.said.some((x) => x.from === kitSlot), 'Kit’s cheer');
    const adaSlot = (await getMatch(ada)).slot;
    await lou.getByTestId(`match-chip-${adaSlot}`).tap();
    await expect(lou.getByTestId('match-peek')).toBeVisible();
    await snap(lou, 'd-phone-peek');
    expect(await phoneProblems(lou, '[data-testid=match-peek]'), 'a peek on a Pixel').toEqual([]);
    await lou.getByTestId(`match-chip-${adaSlot}`).tap();
    await snap(ada, 'd-scoreboard');
    await snap(kit, 'd-phone-scoreboard');
    // All four cities on the iPhone's scoreboard at once, none scrolled out of sight.
    const cut = await kit.evaluate(() => {
      const list = document.querySelector('.match-chips')!.getBoundingClientRect();
      return [...document.querySelectorAll<HTMLElement>('.match-chip')]
        .filter((c) => {
          const r = c.getBoundingClientRect();
          return r.left < list.left - 1 || r.right > list.right + 1 || r.right > innerWidth;
        })
        .map((c) => c.dataset.testid);
    });
    expect(cut, 'scoreboard chips cut off on an iPhone').toEqual([]);

    // Time's up: every page has the same result, and its own hash in it.
    for (const p of pages) await until(p, (m) => m.phase === 'over' && m.resultsOpen, 'the results', 180_000);
    const views: MatchView[] = await Promise.all(pages.map((p) => getMatch(p)));
    const result = views[0]!.result!;
    for (const v of views) {
      expect(JSON.stringify(v.result)).toBe(JSON.stringify(result));
      expect(result.rows.find((r) => r.slot === v.slot)?.hash).toBe(v.hash);
    }
    log(
      `round 1: ${result.endedBy}, winner slot ${result.winner}; ${result.rows.map((r) => `${MATCH_NAMES[r.slot - 1]} ${r.population}`).join(', ')}`,
    );
    await snap(ada, 'd-results');
    await snap(kit, 'd-phone-results');
    expect(await phoneProblems(kit, '[data-testid=match-results]'), 'the results on an iPhone').toEqual([]);

    // A rematch in Mixed, by the host; every page reloads into round 2, which starts by itself.
    await ada.getByTestId('match-rematch-mode').selectOption('mixed');
    await ada.getByTestId('match-rematch').click();
    for (const p of pages) await until(p, (m) => m.round === 2 && m.started, 'round 2 to start', 180_000);
    await Promise.all([
      mouseTown(ada, [150, 250]),
      mouseTown(sam, [110, 200, 290]),
      fingerTown(kit, fk, 'portrait'),
      fingerTown(lou, fl, 'landscape'),
    ]);
    for (const p of pages)
      await until(p, (m) => m.phase === 'over' && m.resultsOpen, 'round 2’s result', 180_000);
    const second = (await getMatch(ada)).result!;
    expect(second.settings.mode).toBe('mixed');
    log(
      `round 2: winner slot ${second.winner}; ${second.rows.map((r) => `${MATCH_NAMES[r.slot - 1]} ${r.population}`).join(', ')}`,
    );
    // Sam keeps his city and plays on; Kit goes back to the menu.
    await sam.getByTestId('match-keep').click();
    await until(sam, (m) => !!m.kept, 'Sam’s city kept', 60_000);
    await expect(sam.getByTestId('toast').filter({ hasText: 'Kept as' })).toContainText('Load city');
    await sam.getByTestId('match-play-on').click();
    await expect(sam.getByTestId('speed-1')).toBeEnabled();
    await kit.getByTestId('match-menu').tap();
    await expect(kit.getByTestId('main-menu')).toBeVisible({ timeout: 120_000 });
  } catch (err) {
    console.log(`[phase6] the match clocks:\n${matchLogs(pages)}`);
    throw err;
  }
  log(`findings: ${findings.length ? findings.join(' | ') : 'none'}`);
  for (const e of errs) e.check();
});

// ———————————————————————————————————————— 5. This week's challenge ————————————————————————————————————————

const RELAY = 'http://127.0.0.1:8787';
const OWNER_KEY = 'e2e-owner-key-0123456789';

/** The owner area, signed in (the local relay's key: playwright.config.ts). */
async function ownerArea(
  browser: Browser,
  device: BrowserContextOptions = { viewport: { width: 1200, height: 900 } },
) {
  const page = await (await newContext(browser, device)).newPage();
  await page.goto('./owner.html');
  await page.getByTestId('owner-key').fill(OWNER_KEY);
  await page.getByTestId(device.hasTouch ? 'owner-signin-go' : 'owner-signin-go').click();
  await expect(page.getByTestId('owner-area')).toHaveAttribute('data-state', /./);
  return page;
}

/**
 * A challenge city built with the mouse, whatever the week's map: a main street off the highway (the
 * way the preview takes), three cross streets, homes, shops and industry block by block, coal, a pump
 * and septic tanks; then each month the player keeps power, water and sewage ahead and adds services.
 */
async function challengeCity(page: Page): Promise<number> {
  const s = await state(page);
  const hx = s.highwayX;
  const hz = s.highwayZ;
  // Which way from the highway's end there's room (a player sees the ghost turn red the other way).
  const dir = await page.evaluate(
    async ([hx, hz]) => {
      for (const d of [1, -1])
        if (
          (
            await window.__game!.preview({
              type: 'buildRoad',
              road: 'street',
              points: [
                { x: hx!, z: hz! },
                { x: hx! + 380 * d, z: hz! },
              ],
            })
          ).ok
        )
          return d;
      return 0;
    },
    [hx, hz],
  );
  expect(dir, 'room for a main street either way from the highway').not.toBe(0);
  const at = (dx: number, dz: number): [number, number] => [hx + dx * dir, hz + dz];
  const roads: [number, number][][] = [
    [at(0, 0), at(190, 0), at(380, 0)],
    ...[100, 200, 300].map((x) => [at(x, -150), at(x, 0), at(x, 150)]),
  ];
  await frameOn(page, roads.flat(), { x: hx + 200 * dir, z: hz, d: 700 });
  await page.getByTestId('tool-road').click();
  await page.getByTestId('road-street').click();
  for (const r of roads)
    if (!(await dragMouse(page, r))) log(`challenge road ${JSON.stringify(r)} not built`);
  await page.getByTestId('tool-select').click();
  await page.getByTestId('tool-zone').click();
  const fill = async (zone: string, spots: [number, number][]) => {
    await page.getByTestId(`zone-${zone}`).click();
    for (const [x, z] of spots) {
      const p = await screenAt(page, x, z);
      if (!p.onMap) continue;
      await page.mouse.move(p.x, p.y, { steps: 2 });
      await page.keyboard.down('Shift');
      await page.mouse.click(p.x, p.y);
      await page.keyboard.up('Shift');
    }
  };
  await fill('R', [at(100, -80), at(200, -80), at(300, -80), at(100, 80)]);
  await fill('C', [at(60, 0), at(150, 0), at(250, 0)]);
  await fill('I', [at(300, 80), at(200, 80)]);
  await page.getByTestId('tool-select').click();
  const z = (await state(page)).zoned;
  log(`challenge city: ${(await state(page)).segments - s.segments} roads, zoned ${JSON.stringify(z)}`);
  const beside: [number, number][] = [340, 360, 380, 320, 160, 240].flatMap((x) => [at(x, 30), at(x, -30)]);
  const ends: [number, number][] = [100, 200, 300].flatMap((x) => [
    at(x + 30, 130),
    at(x - 30, 130),
    at(x + 30, -130),
    at(x - 30, -130),
  ]);
  const services: [string, string][] = [
    ['fire', 'firestation'],
    ['health', 'clinic'],
    ['parks', 'park_small'],
    ['education', 'primary'],
    ['police', 'police'],
    ['garbage', 'landfill'],
  ];
  const keepUp = async () => {
    const st = await state(page);
    await frameOn(page, [at(0, 0), at(380, 0), at(200, 150), at(200, -150)], {
      x: hx + 200 * dir,
      z: hz,
      d: 700,
    });
    const u = st.utilities;
    if (u.power.supply < u.power.demand * 1.2 + 10)
      await placeMouse(page, 'power', st.treasury > 25_000 ? 'coal' : 'wind', [...beside, ...ends]);
    if (u.water.supply < u.water.demand * 1.2 + 10)
      await placeMouse(page, 'water', 'pump', [...ends, ...beside]);
    if (u.sewage.supply < u.sewage.demand * 1.2 + 10)
      await placeMouse(page, 'water', 'septic', [...beside, ...ends]);
    if (services.length && st.treasury > 15_000 && st.population > 150) {
      const [cat, def] = services[0]!;
      if (await placeMouse(page, cat, def, [...ends, ...beside])) services.shift();
    }
    await page.getByTestId('tool-select').click();
  };
  // The months, played out: the end card comes as the last one closes.
  let m = 0;
  for (; m < 60 && !(await page.getByTestId('challenge-end').isVisible()); m++) {
    if (m % 2 === 0) await keepUp();
    await advance(page, 1440);
    await readTips(page, 'e');
    if (m % 6 === 5) {
      const st = await state(page);
      log(
        `challenge month ${m + 1}: ${st.population} residents, $${st.treasury}, approval ${Math.round(st.approval * 100)} %`,
      );
    }
  }
  return m;
}

test('phase 6 end, 5: this week’s challenge played and posted, and a friend on a phone watches it @playthrough @phase6', async ({
  browser,
}) => {
  test.setTimeout(40 * 60_000);
  // The owner takes away any pin: the week's challenge is the generator's, as players get it.
  const owner = await ownerArea(browser);
  await owner.getByTestId('owner-section-challenge').click();
  await expect(owner.getByTestId('owner-challenge-name')).toBeVisible();
  if (await owner.getByTestId('owner-unpin').isVisible()) {
    await owner.getByTestId('owner-unpin').click();
    await expect(owner.getByTestId('owner-toast')).toContainText('generator');
  }
  const weekName = (await owner.getByTestId('owner-challenge-name').textContent())!;
  log(`owner: ${weekName}`);
  await owner.context().close();

  // Ada, on a laptop: the main menu's entry, the screen, a friends' group, Play, the brief.
  const ada = await matchPage(browser, 0, { viewport: { width: 1280, height: 800 } }, GPU ? 'high' : 'low');
  const errs = watchErrors(ada);
  await ada.goto('./');
  await ada.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'menu',
    null,
    {
      timeout: 120_000,
    },
  );
  await expect(ada.getByTestId('main-challenge-line')).toContainText('left');
  log(`menu: ${(await ada.getByTestId('main-challenge-line').textContent())!}`);
  await ada.getByTestId('main-challenge').click();
  await expect(ada.getByTestId('challenge-detail')).toBeVisible();
  log(
    `challenge: ${(await ada.getByTestId('challenge-name').textContent())!} · ${(await ada.getByTestId('challenge-twist').textContent())!}`,
  );
  await ada.getByTestId('board-tab-friends').click();
  await ada.getByTestId('group-make').click();
  const code = (await ada.getByTestId('group-made').locator('strong').textContent())!.trim();
  await snap(ada, 'e-challenge');
  await ada.getByTestId('challenge-play').click();
  await ada.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
    null,
    {
      timeout: 120_000,
    },
  );
  await expect(ada.getByTestId('scenario-brief')).toBeVisible();
  log(`brief: ${(await ada.getByTestId('scenario-brief').innerText()).replace(/\s+/g, ' ').slice(0, 400)}`);
  await ada.getByTestId('scenario-begin').click();
  await ada.evaluate(() => window.__game!.setSpeed(0));
  const months = await challengeCity(ada);
  await expect(ada.getByTestId('challenge-end')).toBeVisible({ timeout: 60_000 });
  const score = Number((await ada.getByTestId('challenge-score').textContent())!.replace(/\D/g, ''));
  log(
    `challenge over after ${months} months: ${score} points; ${(await ada.getByTestId('challenge-end').innerText()).replace(/\s+/g, ' ').slice(0, 300)}`,
  );
  await ada.getByTestId('challenge-name-input').fill('Ada');
  await ada.getByTestId('challenge-post').click();
  await expect(ada.getByTestId('challenge-post-result')).toContainText('On the board');
  await snap(ada, 'e-end');

  // Kit, on an Android phone upright: the menu's entry by touch, Ada's group by its code, Ada's run watched.
  const kit = await matchPage(browser, 2, phone('Pixel 7', 'portrait'), 'phone');
  await kit.goto('./');
  await kit.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'menu',
    null,
    {
      timeout: 120_000,
    },
  );
  await kit.getByTestId('main-challenge').tap();
  await expect(kit.getByTestId('challenge-detail')).toBeVisible();
  expect(
    await phoneProblems(kit, '[data-testid=challenge-screen]'),
    'the challenge screen on a Pixel',
  ).toEqual([]);
  await kit.getByTestId('board-tab-friends').tap();
  await kit.getByTestId('group-code').fill(code.toLowerCase());
  await kit.getByTestId('group-join').tap();
  const row = kit.getByTestId('board-row').filter({ hasText: 'Ada' });
  await expect(row).toHaveCount(1, { timeout: 30_000 });
  await snap(kit, 'e-phone-board');
  await row.getByRole('button', { name: 'Watch' }).tap();
  await kit.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
    null,
    {
      timeout: 120_000,
    },
  );
  await expect(kit.getByTestId('run-viewer')).toContainText('Ada');
  const t0 = Date.now();
  await kit.getByTestId('run-rush').tap();
  // How far the replay has got, every half minute (a four-year run on a phone is the slow case).
  for (let k = 0; k < 40 && !(await kit.getByTestId('run-result').isVisible()); k++) {
    await kit.waitForTimeout(30_000);
    const v = await kit
      .getByTestId('run-viewer')
      .innerText()
      .catch(() => '');
    const s = await state(kit).catch(() => null);
    log(
      `replay after ${((Date.now() - t0) / 1000).toFixed(0)} s: ${v.replace(/\s+/g, ' ').slice(0, 160)}; tick ${s?.tick ?? '?'}`,
    );
  }
  await expect(kit.getByTestId('run-result')).toContainText('replayed to the same city', {
    timeout: 60_000,
  });
  log(
    `Kit watched Ada's ${months}-month run to its end in ${((Date.now() - t0) / 1000).toFixed(0)} s: same city`,
  );
  await snap(kit, 'e-watched');
  // The board says so too.
  const board = (await fetch(
    `${RELAY}/challenge/board?week=${(await fetch(`${RELAY}/challenge/current`).then((r) => r.json())).week}`,
  ).then((r) => r.json())) as { rows: { name: string; checked: boolean }[] };
  log(`board: ${JSON.stringify(board.rows.slice(0, 5))}`);
  log(`findings: ${findings.length ? findings.join(' | ') : 'none'}`);
  errs.check();
});

// ———————————————————————————— 6. A building made in the Workshop, shared and sent in ————————————————————————————

const PLAYER_STATE = `${OUT}/player-state.json`;
const glbFile = (name: string, bytes: Uint8Array) => ({
  name,
  mimeType: 'model/gltf-binary',
  buffer: Buffer.from(bytes),
});

test('phase 6 end, 6: a building made in the Workshop, shared with a friend on a phone, and sent in @playthrough @phase6', async ({
  browser,
}) => {
  test.setTimeout(20 * 60_000);
  const ctx = await newContext(browser, {
    viewport: { width: 1280, height: 860 },
    acceptDownloads: true,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ctx.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(
      key,
      JSON.stringify({ ...s, graphicsChecked: true, reportsNotice: true, timelapse: false }),
    );
  });
  const ada = await ctx.newPage();
  const errs = watchErrors(ada);
  // Learn → Making your own buildings: the lesson's town opens on the Workshop.
  await ada.goto('./');
  await expect(ada.getByTestId('main-menu')).toBeVisible({ timeout: 120_000 });
  await ada.getByTestId('main-learn').click();
  await ada.getByTestId('lesson-start-buildings').click();
  await ada.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 120_000,
  });
  await expect(ada.getByTestId('workshop')).toBeVisible();
  // 1 Pick: a 2×2 landmark.
  await ada.getByTestId('workshop-pick-landmark2').click();
  await expect(ada.getByTestId('workshop-facts')).toContainText('16 × 16 m');
  await snap(ada, 'f-workshop-pick');
  await ada.getByTestId('workshop-next').click();
  // 2 Make: the prompt for an AI 3D tool, written for it and copied.
  await ada.getByTestId('workshop-name').fill('Clock pavilion');
  await ada.getByTestId('workshop-idea').fill('A little clock tower on a paved square, lawns in the corners');
  await ada.getByTestId('workshop-copy').click();
  const prompt = await ada.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('Save as landmark2.glb.');
  log(
    `the Workshop's prompt: ${prompt.length} characters, starting "${prompt.slice(0, 80).replace(/\s+/g, ' ')}"`,
  );
  await ada.getByTestId('workshop-next').click();
  // 3 Check: a first try turned round and floating gets two notes; the fixed model passes.
  await ada
    .getByTestId('workshop-file')
    .setInputFiles(
      glbFile('first-try.glb', writeGlb(transformParts(goodModelParts(16), { turn: Math.PI, lift: 1.2 }))),
    );
  await expect(ada.getByTestId('workshop-note')).toHaveCount(2, { timeout: 60_000 });
  log(
    `first try's notes: ${(await ada.getByTestId('workshop-note').locator('h4').allTextContents()).join(' | ')}`,
  );
  await snap(ada, 'f-workshop-notes');
  await ada.getByTestId('workshop-file').setInputFiles(glbFile('pavilion.glb', testModels().good));
  await expect(ada.getByTestId('workshop-ok')).toBeVisible({ timeout: 60_000 });
  await ada.getByTestId('workshop-next').click();
  // 4 See: in a street, by night.
  await ada.getByTestId('workshop-night').click();
  await frames(ada, 4);
  await snap(ada, 'f-workshop-see');
  await ada
    .getByTestId('workshop-day')
    .click()
    .catch(() => undefined);
  await ada.getByTestId('workshop-next').click();
  // 5 Use: into My buildings, and placed in the lesson's town.
  await ada.getByTestId('workshop-add').click();
  await expect(ada.getByTestId('workshop-added')).toContainText('Clock pavilion');
  const mine = (await ada.evaluate(() => window.__game!.getMyBuildings())).models;
  const hash = mine.find((m) => m.name === 'Clock pavilion')!.hash;
  const near = await ada.evaluate(async () => {
    const g = window.__game!;
    const b = g.getBuildings();
    const c = { x: b.reduce((t, v) => t + v.x, 0) / b.length, z: b.reduce((t, v) => t + v.z, 0) / b.length };
    g.setCamera({ x: c.x, z: c.z, distance: 260, yaw: 0, tilt: 0.65 });
    return c;
  });
  await ada.getByTestId('workshop-place').click();
  await expect(ada.getByTestId('buildings-panel')).toHaveCount(0);
  const spots: [number, number][] = [];
  for (let r = 20; r <= 120; r += 20)
    for (let a = 0; a < 8; a++)
      spots.push([near.x + r * Math.cos((a * Math.PI) / 4), near.z + r * Math.sin((a * Math.PI) / 4)]);
  const pick = await (await import('./ui')).findSpot(ada, spots, 'the pavilion');
  const p = await screenAt(ada, pick[0], pick[1]);
  await ada.mouse.click(p.x, p.y);
  await expect
    .poll(
      async () =>
        (await ada.evaluate(() => window.__game!.getCivics())).filter((c) => c.look === hash).length,
      {
        timeout: 20_000,
      },
    )
    .toBe(1);
  await ada.getByTestId('tool-select').click();
  await frames(ada, 4);
  await snap(ada, 'f-placed');
  // The lesson's last card stands beside My buildings when it's opened (not on its tabs); then Keep playing.
  await expect(ada.getByTestId('tutorial')).toHaveAttribute('data-step', 'lessonDone');
  await ada.getByTestId('tool-landmark').click();
  await ada.getByTestId('place-mybuildings').click();
  await ada.getByTestId('buildings-tab-mine').click({ timeout: 5_000 });
  await expect(ada.getByTestId('tutorial')).toHaveClass(/beside-panel/);
  await ada.getByTestId('lesson-keep').click();

  // Shared with a friend: the building as a file (a download on a laptop), sent through a chat.
  if (!(await ada.getByTestId('buildings-panel').isVisible())) {
    await ada.getByTestId('tool-landmark').click();
    await ada.getByTestId('place-mybuildings').click();
  }
  await ada.getByTestId('buildings-tab-mine').click();
  const [download] = await Promise.all([
    ada.waitForEvent('download'),
    ada.getByTestId(`buildings-share-${hash}`).click(),
  ]);
  const shared = readFileSync((await download.path())!);
  log(`shared as ${download.suggestedFilename()} (${shared.length} bytes)`);
  expect(download.suggestedFilename()).toBe('Clock_pavilion.citybloom-building');

  // Sam, on an iPhone upright, adds it to My buildings and places it in his own town, by touch.
  const sam = await matchPage(browser, 1, phone('iPhone 13', 'portrait'), 'phone');
  await sam.goto('./?seed=samtown&preset=river&paused=1');
  await sam.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
  const scz = (await state(sam)).highwayZ;
  // (His town: a street, laid by the game's own command; this test is about the building.)
  await sam.evaluate(
    (cz) =>
      window.__game!.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: 24, z: cz },
          { x: 300, z: cz },
        ],
      }),
    scz,
  );
  const fs = await fingers(sam);
  await sam.getByTestId('tool-build').tap();
  await sam.getByTestId('tool-landmark').tap();
  await sam.getByTestId('place-mybuildings').tap();
  await expect(sam.getByTestId('buildings-empty')).toBeVisible();
  await sam.getByTestId('buildings-file').setInputFiles({
    name: 'Clock_pavilion.citybloom-building',
    mimeType: 'application/json',
    buffer: shared,
  });
  await expect(sam.getByTestId('buildings-name')).toHaveValue('Clock pavilion');
  await sam.getByTestId('buildings-add').tap();
  await expect(sam.getByTestId(`buildings-row-${hash}`)).toBeVisible({ timeout: 30_000 });
  expect(await phoneProblems(sam, '[data-testid=buildings-panel]'), 'My buildings on an iPhone').toEqual([]);
  await snap(sam, 'f-friend-added');
  await sam.getByTestId(`buildings-place-${hash}`).tap();
  await expect(sam.getByTestId('buildings-panel')).toHaveCount(0);
  const c = { x: 160, z: scz, d: 360 };
  const spot = await (async () => {
    for (const [x, z] of [80, 120, 160, 200, 240].flatMap((x): [number, number][] => [
      [x, scz - 22],
      [x, scz + 22],
    ])) {
      await frameOn(sam, [[x, z]], c);
      const q = await screenAt(sam, x, z);
      if (!q.onMap) continue;
      await fs.hold(q, 650);
      const h = await settledHint(sam);
      if (/\bok\b/.test(h.tone)) return q;
    }
    return null;
  })();
  expect(spot, 'somewhere for the pavilion in Sam’s town').not.toBeNull();
  await fs.tap(spot!);
  await expect
    .poll(
      async () =>
        (await sam.evaluate(() => window.__game!.getCivics())).filter((x) => x.look === hash).length,
      {
        timeout: 20_000,
      },
    )
    .toBe(1);
  await sam.getByTestId('tool-select').tap();
  await frames(sam, 4);
  await snap(sam, 'f-friend-placed');

  // Sent in: the building from its row in My buildings, then an idea with a picture from the pause menu.
  await ada.getByTestId(`buildings-send-${hash}`).click();
  await expect(ada.getByTestId('submit-model')).toHaveValue(hash);
  await ada.getByTestId('submit-line').fill('A little clock tower for a town square');
  await ada.getByTestId('submit-credit').fill('Ada');
  await ada.getByTestId('submit-review').click();
  await expect(ada.getByTestId('submit-preview-title')).toContainText('Clock pavilion');
  await expect(ada.getByTestId('submit-who')).toContainText("Only the game's maker will see it");
  await ada.getByTestId('submit-send').click();
  await expect(ada.getByTestId('submit-mine-row').filter({ hasText: 'Clock pavilion' })).toHaveCount(1, {
    timeout: 20_000,
  });
  await snap(ada, 'f-sent');
  await ada.getByTestId('submit-close').click();
  await ada.getByTestId('menu-button').click();
  await ada.getByTestId('pause-submit').click();
  await ada
    .getByTestId('submit-tab-form')
    .click()
    .catch(() => undefined);
  await ada
    .getByTestId('submit-kind-idea')
    .click()
    .catch(() => undefined);
  await ada.getByTestId('submit-about').selectOption('feature');
  await ada.getByTestId('submit-title').fill('A clock that chimes the hour');
  await ada
    .getByTestId('submit-text')
    .fill('The clock pavilion could chime on the hour, quietly, if you zoom in.');
  await ada.getByTestId('submit-shot').check();
  await expect(ada.getByTestId('submit-shot-preview')).toBeVisible();
  await ada.getByTestId('submit-credit').fill('Ada');
  await ada.getByTestId('submit-review').click();
  await ada.getByTestId('submit-send').click();
  await expect(
    ada.getByTestId('submit-mine-row').filter({ hasText: 'A clock that chimes the hour' }),
  ).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(
    ada
      .getByTestId('submit-mine-row')
      .filter({ hasText: 'A clock that chimes the hour' })
      .getByTestId('submit-status'),
  ).toHaveText('Sent');
  // The player's browser is kept for the owner's answers (test 7).
  await ctx.storageState({ path: PLAYER_STATE });
  log(`findings: ${findings.length ? findings.join(' | ') : 'none'}`);
  errs.check();
});

// —————————————————————————————— 7. The owner area, on the owner's phone ——————————————————————————————

test('phase 6 end, 7: the owner area on a phone handles the reports, the challenge board and the submissions @playthrough @phase6', async ({
  browser,
}) => {
  test.setTimeout(10 * 60_000);
  const owner = await ownerArea(browser, phone('iPhone 13', 'portrait'));
  const notes = JSON.parse(readFileSync(NOTES, 'utf8')) as { report: string };
  // Problem reports: the written one from the first city, with its picture; marked fixed.
  await expect(owner.getByTestId('owner-reports')).toBeVisible();
  await owner.getByTestId('owner-filter-all').tap();
  const report = owner.getByTestId('owner-group').filter({ hasText: notes.report });
  await expect(report).toHaveCount(1, { timeout: 20_000 });
  await report.locator('.owner-group-head').tap();
  await report.getByTestId('owner-show-shot').tap();
  await expect(report.getByTestId('owner-shot')).toBeVisible();
  expect(await phoneProblems(owner, '[data-testid=owner-area]'), 'the owner area on an iPhone').toEqual([]);
  await snap(owner, 'g-owner-reports');
  await report.getByTestId('owner-fixed').tap();
  await expect(owner.getByTestId('owner-toast')).toHaveText('Marked fixed.');
  const others = await owner.getByTestId('owner-group').count();
  log(`owner: ${others} report entries (crash reports from the playthrough's pages, if any, included)`);

  // The challenge board: Ada's entry removed (off the public board), then put back; a word for the filter.
  await owner.getByTestId('owner-section-challenge').tap();
  const entry = owner.getByTestId('owner-entry').filter({ hasText: 'Ada' }).first();
  await expect(entry).toBeVisible({ timeout: 20_000 });
  await snap(owner, 'g-owner-challenge');
  const week = (await fetch(`${RELAY}/challenge/current`).then((r) => r.json())) as { week: number };
  const onBoard = async () =>
    (
      (await fetch(`${RELAY}/challenge/board?week=${week.week}`).then((r) => r.json())) as {
        rows: { name: string }[];
      }
    ).rows.some((r) => r.name === 'Ada');
  await entry.getByTestId('owner-entry-remove').tap();
  await expect(owner.getByTestId('owner-toast')).toContainText('Removed');
  expect(await onBoard()).toBe(false);
  await owner
    .getByTestId('owner-entry')
    .filter({ hasText: 'Ada' })
    .first()
    .getByTestId('owner-entry-restore')
    .tap();
  await expect(owner.getByTestId('owner-toast')).toContainText('Back on the board');
  expect(await onBoard()).toBe(true);
  const words = owner.getByTestId('owner-words');
  await words.fill(`${await words.inputValue()}\npoop`.trim());
  await owner.getByTestId('owner-words-save').tap();
  await expect(owner.getByTestId('owner-toast')).toContainText('Word filter saved');

  // The submissions: the building accepted with a reply (checked and seen on its turntable first), the idea
  // declined with one.
  await owner.getByTestId('owner-section-submissions').tap();
  const building = owner.locator('.owner-entry', { hasText: 'Clock pavilion' }).first();
  await expect(building).toBeVisible({ timeout: 20_000 });
  await building.locator('.owner-entry-line').tap();
  await expect(owner.getByTestId('owner-sub-check')).toContainText("passes the game's check", {
    timeout: 30_000,
  });
  await snap(owner, 'g-owner-submission');
  await owner
    .getByTestId('owner-sub-reply')
    .fill('Lovely! It comes in the next update, with your name on it.');
  await owner.getByTestId('owner-sub-accept').tap();
  await expect(owner.getByTestId('owner-toast')).toContainText('accepted');
  const idea = owner.locator('.owner-entry', { hasText: 'A clock that chimes the hour' }).first();
  await idea.locator('.owner-entry-line').tap();
  await expect(owner.getByTestId('owner-sub-text')).toContainText('chime on the hour');
  await expect(owner.getByTestId('owner-sub-shot')).toBeVisible();
  await owner
    .getByTestId('owner-sub-reply')
    .fill('Not this time: the game stays quiet unless you turn the sound up.');
  await owner.getByTestId('owner-sub-decline').tap();
  await expect(owner.getByTestId('owner-toast')).toContainText('declined');
  expect(await phoneProblems(owner, '[data-testid=owner-area]'), 'the submissions on an iPhone').toEqual([]);

  // Ada, back in her browser: What I sent shows both answers; Accepted ideas has the pavilion with her name.
  const ada = await (
    await newContext(browser, { storageState: PLAYER_STATE, viewport: { width: 1280, height: 860 } })
  ).newPage();
  await ada.goto('./');
  await expect(ada.getByTestId('main-menu')).toBeVisible({ timeout: 120_000 });
  await ada.getByTestId('main-submit').click();
  await ada.getByTestId('submit-tab-mine').click();
  const accepted = ada.locator('[data-testid="submit-mine-row"][data-status="accepted"]', {
    hasText: 'Clock pavilion',
  });
  await expect(accepted).toContainText('Coming in an update');
  await expect(accepted).toContainText('with your name on it');
  const declined = ada.locator('[data-testid="submit-mine-row"][data-status="declined"]', {
    hasText: 'A clock that chimes the hour',
  });
  await expect(declined).toContainText('Not this time');
  await snap(ada, 'g-player-answers');
  await ada.getByTestId('submit-tab-accepted').click();
  await expect(ada.getByTestId('accepted-row').filter({ hasText: 'Clock pavilion' })).toContainText('Ada');
  await expect(ada.getByTestId('accepted-list')).not.toContainText('A clock that chimes the hour');
});
