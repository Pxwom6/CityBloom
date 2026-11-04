import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext, skipGraphicsCheck, watchErrors } from './helpers';
import { armTown, servedTown } from './war';
import { TIPS } from '../src/client/tutorial';

/**
 * The end of phase 5 (SPEC-5.md, "When every milestone is done"): a war with a computer neighbour and one
 * between two players through the real UI, and the race for the atom bomb, played as a player would.
 *
 * 1. A city founded from the main menu with rival neighbours, grown with the mouse; a military HQ and a
 *    barracks from the Military bar, units trained, a raid lived through, an expedition sent from the
 *    Send tab; war declared from the Diplomacy tab and ended by a peace the city proposes; every war
 *    room tab opened once; a computer neighbour racing for the bomb (Hard's rivals do).
 * 2. Two players in a region on the local relay: war turned on in the Region panel, declared from the
 *    Diplomacy tab's Friends block, a live battle both command from the battle map, peace by treaty.
 * 3. The race between two friends: the nuclear plant, enrichment plant and silo from the toolbar, the
 *    bomb from the Bomb tab, total war, a launch by the real three-second hold, and on the target's page
 *    the countdown, the flight, the flash, the cloud and the landing; then the radiation map, the
 *    clean-up tool, the winter on both cities and the firer a pariah.
 *
 * Tips are on. Cheats only skip waiting (money, research, a project's stages, the fuel and the bomb,
 * fast-forwarding, a raid brought near). A picture is taken at every step (test-results/phase5/); the
 * best are kept as docs/screenshots/phase5-*.png. `PHASE5_GPU=1` plays it in a real Chrome window on the
 * GPU at High (as it was judged, on the Mac); otherwise it runs as the other playthroughs do.
 */

const GPU = !!process.env.PHASE5_GPU;
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

const OUT = 'test-results/phase5';
mkdirSync(OUT, { recursive: true });
const TIERS = ['land', 'air', 'sea', 'defence', 'intel', 'logistics'].flatMap((b) =>
  [1, 2, 3, 4].map((t) => `${b}${t}`),
);
/** The pictures kept for the docs (by step name). */
const KEEP = new Set([
  'a-new-city',
  'a-raid',
  'a-report',
  'a-declared',
  'a-rival-race',
  'b-battle-attacker',
  'b-battle-defender',
  'b-peace',
  'c-launch-hold',
  'c-countdown',
  'c-flash',
  'c-cloud',
  'c-radiation',
  'c-cleanup',
  'c-winter',
  'c-pariah',
]);
/**
 * The tips about building a town, marked as read in tests 2 and 3 (as m39-friends does): those towns are
 * grown through the test API, and their mayors would have read these long before a war. The war's tips,
 * and the region's, stay on.
 */
const TOWN_TIPS = TIPS.slice(TIPS.findIndex((t) => t.id === 'atomWinter') + 1).map((t) => t.id);
let shots = 0;
const log = (msg: string) => console.log(`[phase5] ${msg}`);

/** A picture of this step (and, for the best, a copy in the docs). */
async function snap(page: Page, name: string): Promise<void> {
  // (The interface redraws a few times a second; the picture waits for it.)
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__game!.waitFrames(3));
  const n = String(++shots).padStart(3, '0');
  await page.screenshot({ path: `${OUT}/${n}-${name}.png` });
  if (KEEP.has(name)) await page.screenshot({ path: `docs/screenshots/phase5-${name}.png` });
}

/** The tip showing now, read (logged) and dismissed, as a player would; and the toasts on screen. */
async function readTips(page: Page, who: string): Promise<void> {
  const card = page.getByTestId('tip');
  for (let k = 0; k < 6; k++) {
    // (The game picks a tip every 2 s: the next may follow the one just read, as a player would see.)
    const shown = await card.waitFor({ state: 'visible', timeout: 2_500 }).then(
      () => true,
      () => false,
    );
    if (!shown) break;
    const id = await page.evaluate(() => window.__game!.getShell().tip);
    log(`${who} tip ${id}: ${(await card.innerText()).replace(/\s+/g, ' ')}`);
    await page.getByTestId('tip-ok').click();
  }
  const toasts = await page.locator('.toast').allInnerTexts();
  if (toasts.length) log(`${who} toasts: ${toasts.map((t) => t.replace(/\s+/g, ' ')).join(' | ')}`);
}

const state = (page: Page) => page.evaluate(() => window.__game!.getState());

/** The city's pulse, logged: people, approval, the utilities' supply against demand, damage. */
async function pulse(page: Page, when: string): Promise<void> {
  const p = await page.evaluate(async () => {
    const s = await window.__game!.getState();
    const u = s.utilities;
    const f = (k: 'power' | 'water' | 'sewage') =>
      `${Math.round(u[k].supply)}/${Math.round(u[k].demand)} unserved ${u[k].unserved}`;
    return `${s.population} residents, approval ${Math.round(s.approval * 100)} %, jobs ${s.jobsFilled}/${s.jobs}, abandoned ${s.abandoned}; power ${f('power')}; water ${f('water')}; sewage ${f('sewage')}; damage ${JSON.stringify(window.__game!.getDamage())}`;
  });
  log(`pulse ${when}: ${p}`);
}
const advance = (page: Page, ticks: number) => page.evaluate((n) => window.__game!.advance(n), ticks);
const ok = (page: Page, cmd: Record<string, unknown>) =>
  page.evaluate(async (cmd) => {
    const r = await window.__game!.dispatch(cmd as never);
    if (!r.ok) throw new Error(`${String(cmd.type)} ${String(cmd.cheat ?? '')}: ${r.reason}`);
  }, cmd);
const civics = (page: Page, def: string) =>
  page.evaluate((def) => window.__game!.getCivics().filter((c) => c.def === def), def);

async function screenAt(page: Page, x: number, z: number) {
  const p = await page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
  const hit = await page.evaluate(([sx, sy]) => document.elementFromPoint(sx!, sy!)?.id ?? '', [p.x, p.y]);
  return { ...p, onMap: hit === 'scene' };
}

/** Drag the mouse through ground points (a road, or a brush stroke). */
async function drag(page: Page, points: [number, number][]): Promise<void> {
  let p = await screenAt(page, points[0]![0], points[0]![1]);
  expect(p.onMap, `(${points[0]}) under the interface`).toBe(true);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (const [x, z] of points.slice(1)) {
    p = await screenAt(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/**
 * A milestone's banner (9 s, in the middle of the screen) clicked away, as a player would before building
 * or opening the war room: the spec moves faster than a player, and the banner stood over the spots.
 */
async function clearBanner(page: Page): Promise<void> {
  const banner = page.getByTestId('milestone-banner');
  if (await banner.isVisible()) await banner.click();
  await expect(banner).toHaveCount(0);
}

/** Place a building from a toolbar menu, trying spots beside the roads until one takes it. */
async function place(page: Page, category: string, def: string, spots: [number, number][]): Promise<boolean> {
  const count = async () => (await civics(page, def)).length;
  await clearBanner(page);
  const before = await count();
  const button = page.getByTestId(`place-${def}`);
  if (!(await page.getByTestId('place-options').isVisible()) || !(await button.isVisible()))
    await page.getByTestId(`tool-${category}`).click();
  if (await button.isDisabled()) {
    log(`${def} is greyed: ${(await button.getAttribute('title')) ?? ''}`);
    return false;
  }
  await button.click();
  const why: string[] = [];
  for (const [x, z] of spots) {
    const p = await screenAt(page, x, z);
    if (!p.onMap) {
      why.push(`(${x},${z}) under the interface`);
      continue;
    }
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(250);
    const hint = await page
      .getByTestId('tool-hint')
      .innerText({ timeout: 500 })
      .catch(() => '');
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(400);
    if ((await count()) > before) return true;
    why.push(`(${x},${z}) ${hint.replace(/\s+/g, ' ')}`);
  }
  log(`no spot took the ${def}: ${why.join('; ')}`);
  await page.screenshot({ path: `${OUT}/no-room-${def}.png` });
  return false;
}

const roomOpen = (page: Page) => page.evaluate(() => window.__game!.getWarRoom().open);

/** The war room open on a tab (its shortcut toggles it: the game says whether it is open, and the page catches up). */
async function warTab(page: Page, tab: string): Promise<void> {
  await clearBanner(page);
  if (!(await roomOpen(page))) await page.keyboard.press('Shift+KeyM');
  await expect(page.getByTestId('war-room')).toBeVisible();
  await page.getByTestId(`war-tab-${tab}`).click();
}
async function closeRoom(page: Page): Promise<void> {
  if (await roomOpen(page)) await page.keyboard.press('Shift+KeyM');
  await expect(page.getByTestId('war-room')).toHaveCount(0);
}

/** Click a civic building on the map (its inspector opens). */
async function inspect(page: Page, def: string, testId: string): Promise<void> {
  const c = (await civics(page, def))[0]!;
  await page.evaluate(
    (c) => window.__game!.setCamera({ x: c.x, z: c.z, yaw: 0.6, distance: 230, tilt: 0.55 }),
    c,
  );
  await page.evaluate(() => window.__game!.waitFrames(4));
  const p = await screenAt(page, c.x, c.z);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 20_000 });
}

/** Look away to empty ground (a software-drawn town holds a page up past the region's ten seconds of silence). */
async function lookAway(page: Page): Promise<void> {
  const hz = (await state(page)).highwayZ;
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 1700, z: hz - 1200, yaw: 0, distance: 120, tilt: 0.5 }),
    hz,
  );
}

/** Computer neighbours' forces back to nothing: no raid moves a war's score while a long wait is played on. */
async function calmRivals(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g = window.__game!;
    for (const n of (await g.getState()).region.neighbours.filter((x) => x.rival && !x.player))
      await g.dispatch({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0, defences: 1 });
  });
}

async function player(browser: Browser, name: string, color: number, quality: 'high' | 'low'): Promise<Page> {
  const ctx = await newContext(browser, {
    viewport: quality === 'high' ? { width: 1280, height: 800 } : { width: 1100, height: 760 },
  });
  await ctx.addInitScript(
    ([n, c, q, read]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      localStorage.setItem('citybloom.fairClock', 'off');
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(
        key,
        JSON.stringify({
          ...s,
          graphicsChecked: true,
          tips: true,
          seenTips: read,
          quality: q,
          ...(q === 'low' ? { shadows: false, drawDistance: 'near' } : {}),
        }),
      );
    },
    [name, color, quality, TOWN_TIPS] as const,
  );
  return ctx.newPage();
}

const quality = GPU ? 'high' : 'low';

async function openCity(page: Page, query: string): Promise<void> {
  await page.goto(`./?paused=1${query}`);
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120_000 });
  await page.evaluate(() => window.__game!.waitFrames(2));
}

// ------------------------------------------------------------------------------------------------
test('phase 5 end, 1: a war with a computer neighbour, from the main menu @playthrough @phase5', async ({
  page,
}) => {
  test.setTimeout(45 * 60_000);
  const errs = watchErrors(page);
  await skipGraphicsCheck(page);
  await page.addInitScript((q) => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, quality: q, tips: true }));
  }, quality);
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 90_000,
  });

  // --- A new city with rival neighbours. ---
  await page.getByTestId('main-new').click();
  await page.getByTestId('new-name').fill('Harrowgate');
  await page.getByTestId('new-rivals').check();
  await page.getByTestId('new-tutorial').uncheck();
  await snap(page, 'a-new-city');
  await page.getByTestId('new-start').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 120_000,
  });
  await page.evaluate(() => window.__game!.setSpeed(0));
  const s0 = await state(page);
  const cz = s0.highwayZ;
  expect(s0.war).toBeTruthy();
  await readTips(page, 'Harrowgate');
  await page.evaluate(
    (cz) => window.__game!.setCamera({ x: 290, z: cz + 50, distance: 700, yaw: 0, tilt: 0.55 }),
    cz,
  );
  await page.evaluate(() => window.__game!.waitFrames(2));

  // --- A town with the mouse: an avenue, side streets, zones, power, water and the services. ---
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
  await drag(page, [
    [504, cz],
    [760, cz],
  ]);
  // Room to grow: the side streets on north, and a street across their ends (the camera moved north to draw them).
  const view = async (z: number) => {
    await page.evaluate((z) => window.__game!.setCamera({ x: 290, z, distance: 700, yaw: 0, tilt: 0.55 }), z);
    await page.evaluate(() => window.__game!.waitFrames(3));
  };
  await view(cz - 200);
  for (const x of [120, 216, 312, 408])
    await drag(page, [
      [x, cz - 160],
      [x, cz - 320],
    ]);
  await drag(page, [
    [120, cz - 320],
    [264, cz - 320],
    [408, cz - 320],
  ]);
  await page.getByTestId('tool-select').click();
  // Money for the town and its forces (a cheat for waiting, not for the choices).
  await ok(page, { type: 'cheat', cheat: 'addMoney', amount: 3_000_000 });
  // The services in the middle of the town, before the zones take the lots.
  const centre: [number, number][] = [
    [232, cz - 100],
    [296, cz - 100],
    [232, cz - 230],
    [296, cz - 230],
    [200, cz - 100],
    [328, cz - 100],
    [200, cz - 230],
    [328, cz - 230],
  ];
  for (const [cat, def] of [
    ['fire', 'firestation'],
    ['health', 'clinic'],
    ['police', 'police'],
    ['education', 'primary'],
  ] as const)
    log(`${def}: ${(await place(page, cat, def, centre)) ? 'placed' : 'no room'}`);
  await page.getByTestId('tool-select').click();
  await page.getByTestId('tool-zone').click();
  const fill = async (zone: string, spots: [number, number][]) => {
    await page.getByTestId(`zone-${zone}`).click();
    for (const [x, z] of spots) {
      const p = await screenAt(page, x, z);
      await page.mouse.move(p.x, p.y, { steps: 2 });
      await page.keyboard.down('Shift');
      await page.mouse.click(p.x, p.y);
      await page.keyboard.up('Shift');
    }
  };
  await fill('R', [
    [120, cz - 240],
    [216, cz - 240],
    [312, cz - 240],
    [408, cz - 240],
    [168, cz - 320],
    [360, cz - 320],
  ]);
  // The blocks' middles too, with a wider brush.
  for (let k = 0; k < 3; k++) await page.keyboard.press(']');
  for (const x of [168, 264, 360])
    await drag(page, [
      [x, cz - 300],
      [x, cz - 175],
    ]);
  await snap(page, 'a-zones-north');
  await view(cz + 50);
  await page.getByTestId('zone-R').click();
  for (const x of [168, 264, 360])
    await drag(page, [
      [x, cz - 140],
      [x, cz - 30],
    ]);
  await drag(page, [
    [168, cz + 30],
    [168, cz + 140],
  ]);
  await fill('R', [
    [120, cz - 80],
    [216, cz - 80],
    [312, cz - 80],
    [408, cz - 80],
    [120, cz + 80],
  ]);
  await fill('C', [
    [72, cz],
    [168, cz],
    [264, cz],
  ]);
  await fill('I', [
    [216, cz + 80],
    [312, cz + 80],
    [408, cz + 80],
  ]);
  await page.getByTestId('tool-select').click();
  const east: [number, number][] = [530, 560, 590, 620, 650, 680, 710, 740].flatMap((x) => [
    [x, cz - 30],
    [x, cz + 30],
  ]);
  expect(await place(page, 'power', 'coal', east)).toBe(true);
  // Water and sewage for a town of a few thousand (the advisors and the notices said so the first time).
  const far: [number, number][] = [540, 580, 620, 660, 700, 740].flatMap((x) => [
    [x, cz - 60],
    [x, cz + 60],
  ]);
  // The pumps north of the homes, upwind of nothing: the inspector said tap water by the coal plant was polluted.
  await view(cz - 150);
  const clean: [number, number][] = [130, 160, 190, 220, 250, 280].map((x) => [x, cz - 345]);
  for (let k = 0; k < 4; k++) expect(await place(page, 'water', 'pump', [...clean, ...far])).toBe(true);
  await view(cz + 50);
  for (let k = 0; k < 3; k++) expect(await place(page, 'water', 'septic', [...east, ...far])).toBe(true);
  log(`landfill: ${(await place(page, 'garbage', 'landfill', east)) ? 'placed' : 'not yet'}`);
  await page.getByTestId('tool-select').click();
  // Grown until the military HQ unlocks (2,000 residents): the rivals tip says the neighbours arm month by
  // month, and raids start once a city has 3,000 residents and a year behind it.
  let months = 0;
  for (; months < 12; months++) {
    await advance(page, 1440);
    await readTips(page, 'Harrowgate');
    if (months >= 4 && (await state(page)).population >= 2_050) break;
  }
  const s = await state(page);
  log(
    `month ${months + 1}: ${s.population} residents, $${s.treasury}, approval ${Math.round(s.approval * 100)} %`,
  );
  await snap(page, 'a-town');
  // A home and an abandoned building in the inspector: what the residents think of the town.
  for (const [st, tag] of [
    [1, 'home'],
    [2, 'abandoned'],
  ] as const) {
    const b = (await page.evaluate(() => window.__game!.getBuildings())).find(
      (b) => b.zone === 1 && b.state === st,
    );
    if (!b) continue;
    await page.evaluate(
      (b) => window.__game!.setCamera({ x: b.x, z: b.z, yaw: 0.6, distance: 160, tilt: 0.55 }),
      b,
    );
    await page.evaluate(() => window.__game!.waitFrames(4));
    const p = await screenAt(page, b.x, b.z);
    await page.mouse.click(p.x, p.y);
    const shown = await page
      .getByTestId('inspector')
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(
        () => true,
        () => false,
      );
    if (shown) {
      log(`${tag}: ${(await page.getByTestId('inspector').innerText()).replace(/\s+/g, ' ').slice(0, 500)}`);
      await snap(page, `a-inspect-${tag}`);
    }
    await page.keyboard.press('Escape');
  }
  expect(s.population).toBeGreaterThan(2_000);
  // A second coal plant and a treatment plant before the forces want their share of power and the
  // septic tanks fill (the notices and the inspector asked for both).
  await view(cz + 50);
  expect(await place(page, 'power', 'coal', [...east, ...far])).toBe(true);
  log(
    `treatment plant: ${(await place(page, 'water', 'treatment', [...east, ...far])) ? 'placed' : 'not yet'}`,
  );
  await page.getByTestId('tool-select').click();

  // --- The military: an HQ, a barracks and bunkers from the Military bar, a shelter by the homes. ---
  await expect(page.getByTestId('tool-military')).toBeVisible();
  const mil: [number, number][] = [140, 180, 220, 260, 300, 340, 380].flatMap((x) => [
    [x, cz - 350],
    [x, cz - 380],
  ]);
  await view(cz - 260);
  expect(await place(page, 'military', 'militaryhq', [...mil, ...east])).toBe(true);
  expect(await place(page, 'military', 'barracks', [...mil, ...east])).toBe(true);
  for (let k = 0; k < 2; k++)
    log(`bunker: ${(await place(page, 'military', 'bunker', mil)) ? 'placed' : 'no room'}`);
  await view(cz - 100);
  log(`shelter: ${(await place(page, 'military', 'shelter', centre)) ? 'placed' : 'no room'}`);
  await page.getByTestId('tool-select').click();
  await advance(page, 60 * 4);
  await readTips(page, 'Harrowgate');
  await inspect(page, 'barracks', 'military');
  await snap(page, 'a-barracks');
  for (let k = 0; k < 8; k++) await page.getByTestId('train-infantry').click();
  await page.keyboard.press('Escape');
  // On to the end of the first year, the squads training one after another.
  for (; months < 13; months++) {
    await advance(page, 1440);
    await readTips(page, 'Harrowgate');
  }
  const f = await page.evaluate(() => window.__game!.getForces());
  log(
    `a year on: ${(await state(page)).population} residents, ${f?.units.length ?? 0} units, ${f?.orders.length ?? 0} training`,
  );
  await pulse(page, 'a year on');
  expect(f!.units.length).toBeGreaterThanOrEqual(6);
  // The foe for this story: the weakest rival, which raids the city and is then made to pay for it.
  const dip0 = (await page.evaluate(() => window.__game!.getDiplomacy()))!;
  log(
    `the city's strength ${dip0.strength}; neighbours ${dip0.neighbours.map((n) => `${n.name} ${n.personality} ${n.strength} (${n.relation})`).join(', ')}`,
  );
  const rivals = (await state(page)).region.neighbours.filter((n) => n.rival && !n.player);
  // The weakest of the neighbours that aren't spoiling for a fight (a careful mayor picks a war it can end).
  const calm = (p: string) => (p === 'aggressive' || p === 'treacherous' ? 1 : 0);
  const byStrength = [...dip0.neighbours].sort(
    (a, b) => calm(a.personality) - calm(b.personality) || a.strength - b.strength,
  );
  const foe = rivals.find((n) => n.id === byStrength[0]!.id)!;
  const other = rivals.find((n) => n.id !== foe.id)!;

  // --- A raid lived through: the warning, the battle at home, the report. ---
  await ok(page, { type: 'cheat', cheat: 'raidIn', hours: 4, neighbour: foe.id });
  await advance(page, 60 * 3 + 20);
  await expect(page.getByTestId('raid-chip')).toBeVisible();
  await readTips(page, 'Harrowgate');
  await snap(page, 'a-raid-warning');
  await advance(page, 60);
  await expect(page.getByTestId('battle-bar')).toBeVisible({ timeout: 60_000 });
  await advance(page, 30);
  await page.getByTestId('battle-follow').click();
  await page.evaluate(() => window.__game!.waitFrames(6));
  await snap(page, 'a-raid');
  for (let k = 0; k < 60; k++) {
    const b = await page.evaluate(async () => {
      await window.__game!.advance(60);
      return window.__game!.getBattle();
    });
    if (!b.frame) break;
  }
  await readTips(page, 'Harrowgate');
  await warTab(page, 'reports');
  await snap(page, 'a-report');
  await pulse(page, 'after the raid');

  // The raid cost squads: new ones trained at the barracks before going on the attack.
  const units = async () => (await page.evaluate(() => window.__game!.getForces()))?.units.length ?? 0;
  const lost = 8 - (await units());
  if (lost > 0) {
    await closeRoom(page);
    await inspect(page, 'barracks', 'military');
    for (let k = 0; k < lost; k++) await page.getByTestId('train-infantry').click();
    await page.keyboard.press('Escape');
  }
  for (let d = 0; d < 6 && (await units()) < 7; d++) {
    await advance(page, 1440);
    await readTips(page, 'Harrowgate');
  }
  log(`before the expedition: ${await units()} units`);

  /** An expedition from the Send tab: all but two squads, its battle fought in the neighbour's town. */
  const expedition = async (tag: string | null): Promise<void> => {
    const reports0 = (await page.evaluate(() => window.__game!.getBattle())).reports.length;
    const n = Math.max(1, (await units()) - 2);
    await warTab(page, 'send');
    await page.getByTestId('send-to').selectOption(String(foe.id));
    await page.getByTestId('send-infantry').fill(String(n));
    if (tag) await snap(page, tag);
    await page.getByTestId('send-force').click();
    await expect(page.getByTestId('war-expeditions')).toContainText(`on the way to ${foe.name}`);
    await closeRoom(page);
    await advance(page, 60 * 15);
    await expect
      .poll(async () => (await page.evaluate(() => window.__game!.getBattle())).reports.length, {
        timeout: 900_000,
        intervals: [2_000],
      })
      .toBeGreaterThan(reports0);
    await advance(page, 60 * 16);
    await readTips(page, 'Harrowgate');
  };

  // --- An expedition from the Send tab, its battle fought in the neighbour's town. ---
  await expedition('a-send');
  await warTab(page, 'reports');
  await snap(page, 'a-expedition-report');
  await pulse(page, 'after the expedition');

  // --- War declared from the Diplomacy tab, battles won, then a peace the city proposes. ---
  await warTab(page, 'diplomacy');
  await page.getByTestId(`dip-declare-${foe.id}`).click();
  await page.getByTestId('dip-scale').selectOption('war');
  await page.getByTestId('dip-reason').fill('They raided us');
  await page.getByTestId('dip-declare-go').click();
  await expect(page.getByTestId(`dip-war-${foe.id}`)).toContainText('opens in');
  await snap(page, 'a-declared');
  await closeRoom(page);
  await advance(page, 60 * 13);
  await readTips(page, 'Harrowgate');
  const war = () =>
    page.evaluate((id) => window.__game!.getDiplomacy()!.wars.find((w) => w.with === id) ?? null, foe.id);
  for (let round = 0; round < 6; round++) {
    const w = await war();
    if (!w) break;
    log(
      `war round ${round}: score ${Math.round(w.score)} after ${w.battles} battles, ${await units()} units; ${w.capitulated ? `capitulated by ${w.capitulated.by}` : ''}${w.hold ? ` hold by ${w.hold.by}` : ''}`,
    );
    if (w.capitulated?.by === 'them') {
      // The neighbour gave up: the city sets the terms.
      await warTab(page, 'diplomacy');
      await page.getByTestId(`dip-impose-${foe.id}`).click();
      await page.getByTestId('dip-term-kind').selectOption('reparations');
      await page.getByTestId('dip-term-add').click();
      await snap(page, 'a-impose');
      await page.getByTestId('dip-send').click();
      await closeRoom(page);
      await advance(page, 60);
      continue;
    }
    // A counter-proposal from the neighbour is answered first.
    const incoming = (await page.evaluate(() => window.__game!.getDiplomacy()!.proposals)).filter(
      (p) => p.with === foe.id && p.from === 'them',
    );
    if (incoming.length) {
      log(`${foe.name} proposes: ${JSON.stringify(incoming[0]!.terms)}`);
      await warTab(page, 'diplomacy');
      await snap(page, `a-counter-${round}`);
      await page.getByTestId(`dip-accept-${incoming[0]!.id}`).click();
      await closeRoom(page);
      await advance(page, 60);
      continue;
    }
    if (round >= 1) {
      await warTab(page, 'diplomacy');
      await page.getByTestId(`dip-peace-${foe.id}`).click();
      if (w.score < 0 || round >= 2) {
        // Behind (or turned down once): the city pays reparations, half a year of its taxes and more each time.
        const taxes = (await page.evaluate(() => window.__game!.getDiplomacy()!.taxes)) ?? 0;
        await page.getByTestId('dip-term-kind').selectOption('reparations');
        await page.getByTestId('dip-term-add').click();
        await page.getByTestId('dip-term-1-payer').selectOption('us');
        await page
          .getByTestId('dip-term-1-amount')
          .fill(String(Math.max(1_000, Math.round(taxes * (3 + 3 * round)))));
      }
      await snap(page, `a-peace-terms-${round}`);
      await page.getByTestId('dip-send').click();
      await closeRoom(page);
      await advance(page, 60 * 3);
      await readTips(page, 'Harrowgate');
      continue;
    }
    if ((await units()) >= 3) await expedition(null);
    else await advance(page, 1440);
    await pulse(page, `war round ${round}`);
  }
  await warTab(page, 'diplomacy');
  await snap(page, 'a-peace');
  const atWar = !!(await war());
  log(
    `after the war: ${atWar ? 'still at war' : 'at peace'}; ${JSON.stringify((await page.evaluate(() => window.__game!.getDiplomacy()!.pacts)).filter((p) => p.with === foe.id).map((p) => p.term))}`,
  );
  expect(atWar).toBe(false);

  // --- Every war room tab, once. ---
  for (const tab of [
    'forces',
    'send',
    'map',
    'research',
    'intel',
    'diplomacy',
    'trade',
    'atom',
    'economy',
    'readiness',
    'reports',
  ]) {
    if (!(await roomOpen(page))) await page.keyboard.press('Shift+KeyM');
    await expect(page.getByTestId('war-room')).toBeVisible();
    const t = page.getByTestId(`war-tab-${tab}`);
    if (!(await t.count())) {
      log(`no ${tab} tab`);
      continue;
    }
    await t.click();
    await snap(page, `a-tab-${tab}`);
  }
  await closeRoom(page);

  // --- A computer neighbour racing for the bomb (as Hard's rivals do), on the map and the race list. ---
  await ok(page, { type: 'cheat', cheat: 'rivalBomb', neighbour: other.id, stage: 'silo', hours: 300 });
  await advance(page, 60);
  await readTips(page, 'Harrowgate');
  await warTab(page, 'map');
  await snap(page, 'a-rival-race');
  await warTab(page, 'atom');
  await snap(page, 'a-rival-race-tab');
  await closeRoom(page);
  errs.check();
});

// ------------------------------------------------------------------------------------------------
const region = (page: Page) => page.evaluate(() => window.__game!.getRegion());
const friendsWar = (page: Page) => page.evaluate(() => window.__game!.getFriendsWar());
const live = (page: Page) => page.evaluate(() => window.__game!.getLive());
const map = (page: Page) => page.evaluate(() => window.__game!.battleMap());
const points = (page: Page) => page.evaluate(() => window.__game!.battleMapPoints()!);
const report = (page: Page) => page.evaluate(() => window.__game!.regionReportNow());

/** A city joins a region with its code, from the Region panel. */
async function joinRegion(page: Page, code: string): Promise<void> {
  await page.bringToFront();
  await page.keyboard.press('Shift+N');
  await page.getByTestId('region-code').fill(code);
  await page.getByTestId('region-join').click();
  await expect.poll(async () => (await region(page))?.state, { timeout: 120_000 }).toBe('in');
  await page.keyboard.press('Shift+N');
}

/** Cities in a region: Ada starts it, Sam (and any others) join with the code; the host's rules. */
async function regionOf(
  ada: Page,
  sam: Page,
  rules: 'war' | 'total',
  others: Page[] = [],
): Promise<{ adaSlot: number; samSlot: number }> {
  await ada.bringToFront();
  await ada.keyboard.press('Shift+N');
  await ada.getByTestId('region-start').click();
  await expect.poll(async () => (await region(ada))?.state, { timeout: 120_000 }).toBe('in');
  const code = (await region(ada))!.code;
  await ada.keyboard.press('Shift+N');
  for (const p of [sam, ...others]) await joinRegion(p, code);
  await ada.bringToFront();
  await ada.keyboard.press('Shift+N');
  await ada.getByTestId('region-war-on').check();
  await expect.poll(async () => (await region(ada))?.rules.war, { timeout: 15_000 }).toBe(true);
  await ada.getByTestId(`region-war-scale-${rules}`).click();
  await expect.poll(async () => (await region(ada))?.rules.scale, { timeout: 15_000 }).toBe(rules);
  await snap(ada, `${rules === 'war' ? 'b' : 'c'}-region-rules`);
  await ada.keyboard.press('Shift+N');
  return { adaSlot: (await region(ada))!.slot, samSlot: (await region(sam))!.slot };
}

/** Declare a war on a friend from the Friends block, and wait for the region to open it. */
async function declareOnFriend(
  ada: Page,
  sam: Page,
  slot: number,
  scale: 'war' | 'total',
  tag: string,
): Promise<void> {
  await ada.bringToFront();
  await warTab(ada, 'diplomacy');
  await ada.getByTestId(`dip-fdeclare-${slot}`).click();
  await expect(ada.getByTestId('dip-fdeclare-form')).toBeVisible();
  await ada.getByTestId('dip-fscale').selectOption(scale);
  await ada.getByTestId('dip-freason').fill('The river is ours');
  await snap(ada, `${tag}-declare`);
  // A friend whose bomb is ready makes the page ask first (the deterrent).
  await ada.getByTestId('dip-fdeclare-go').click();
  if (
    await ada
      .getByTestId('dip-confirm')
      .isVisible()
      .catch(() => false)
  )
    await ada.getByTestId('dip-confirm-yes').click();
  await expect(ada.getByTestId(`dip-fwar-text-${slot}`)).toContainText('It opens in');
  await closeRoom(ada);
  await lookAway(ada);
  await lookAway(sam);
  await expect
    .poll(
      async () => {
        await report(ada);
        await report(sam);
        const w = (await friendsWar(ada)).wars.find((x) => x.a === slot || x.b === slot);
        return w?.state;
      },
      { timeout: 300_000, intervals: [8_000] },
    )
    .toBe('open');
}

async function stamped(page: Page, kind: string) {
  await expect
    .poll(async () => (await map(page)).log.at(-1), { timeout: 60_000, intervals: [300] })
    .toMatchObject({ kind, state: 'stamped' });
  return (await map(page)).log.at(-1)!;
}
/** The notices stand clear of the battle map (phase 5 end: at 1100 px they covered its orders and their log). */
async function clearOfMap(page: Page, who: string): Promise<void> {
  const sheet = (await page.getByTestId('battle-map').boundingBox())!;
  for (const t of await page.getByTestId('toast').all()) {
    const box = await t.boundingBox();
    if (box)
      expect(box.x + box.width, `${who}'s notice beside the battle map`).toBeLessThanOrEqual(sheet.x + 1);
  }
}
async function takeCommand(page: Page): Promise<void> {
  const handed = page.getByTestId('map-handed');
  if (await handed.isVisible()) await page.getByTestId('map-rejoin').click();
  await expect(handed).toBeHidden();
}
async function standing(page: Page) {
  let found: Awaited<ReturnType<typeof points>>['structs'][number] | undefined;
  await expect
    .poll(
      async () => {
        const pts = await points(page);
        found =
          pts.structs.find((s) => s.objective && s.visible && s.state !== 2) ??
          pts.structs.find((s) => s.visible && s.state !== 2);
        return !!found;
      },
      { timeout: 60_000, intervals: [500] },
    )
    .toBe(true);
  return found!;
}

test('phase 5 end, 2: a war between two players, a live battle both command, and peace by treaty @playthrough @phase5', async ({
  browser,
}) => {
  test.setTimeout(60 * 60_000);
  const ada = await player(browser, 'Ada', 0, quality);
  const adaErrs = watchErrors(ada);
  await openCity(ada, '&seed=port&preset=coast&name=Adaville');
  await servedTown(ada);
  const sam = await player(browser, 'Sam', 1, 'low');
  const samErrs = watchErrors(sam);
  await openCity(sam, '&seed=regionsam&preset=lakes&name=Samford');
  await servedTown(sam);
  // Kit, a third player in the region, watches the battle (a new city: watching needs no town).
  const kit = await player(browser, 'Kit', 2, 'low');
  const kitErrs = watchErrors(kit);
  await openCity(kit, '&seed=kitsbury&preset=river&name=Kitsbury');
  await readTips(ada, 'Ada');
  await readTips(sam, 'Sam');
  const { adaSlot, samSlot } = await regionOf(ada, sam, 'war', [kit]);
  await readTips(ada, 'Ada');
  await readTips(sam, 'Sam');
  await readTips(kit, 'Kit');

  // Both arm: Ada a raiding force, Sam defences; Samford's newcomer's shield lifted (as the friends specs do).
  await ada.bringToFront();
  await armTown(ada, ['militaryhq', 'barracks', 'vehicledepot'], {
    infantry: 4,
    vehicles: ['tank', 'transport', 'tank'],
  });
  await sam.bringToFront();
  await armTown(sam, ['militaryhq', 'barracks', 'bunker', 'shelter'], { infantry: 6 });
  await ok(sam, { type: 'cheat', cheat: 'unshield' });
  await report(sam);
  await report(ada);
  await readTips(ada, 'Ada');
  await readTips(sam, 'Sam');
  const samId = await ada.evaluate(async () => {
    const s = await window.__game!.getState();
    return s.region.neighbours.find((x) => x.name === 'Samford' && x.player)!.id;
  });

  await declareOnFriend(ada, sam, samSlot, 'war', 'b');
  await readTips(ada, 'Ada');
  await readTips(sam, 'Sam');
  await sam.bringToFront();
  await warTab(sam, 'diplomacy');
  await snap(sam, 'b-warned');
  await closeRoom(sam);

  // Ada sends a force; it arrives and the region makes the battle live; both command it.
  await ada.bringToFront();
  await warTab(ada, 'send');
  await ada.getByTestId('send-to').selectOption(String(samId));
  await ada.getByTestId('send-infantry').fill('4');
  await ada.getByTestId('send-tank').fill('2');
  await ada.getByTestId('send-transport').fill('1');
  await snap(ada, 'b-send');
  await ada.getByTestId('send-force').click();
  await closeRoom(ada);
  await lookAway(ada);
  await lookAway(sam);
  await advance(ada, 60 * 12);
  const attack = (async () => {
    await expect
      .poll(async () => (await live(ada))?.role, { timeout: 300_000, intervals: [1_000] })
      .toBe('attacker');
    await readTips(ada, 'Ada');
    await ada.keyboard.press('KeyO');
    await expect(ada.getByTestId('battle-map')).toBeVisible();
    await takeCommand(ada);
    await ada.getByTestId('map-select-all').click();
    await ada.getByTestId('map-order-focus').click();
    const goal = await standing(ada);
    await ada.mouse.click(goal.x, goal.y);
    await stamped(ada, 'focus');
  })();
  const defend = (async () => {
    await expect
      .poll(async () => (await live(sam))?.role, { timeout: 300_000, intervals: [1_000] })
      .toBe('defender');
    await expect(sam.getByTestId('battle-bar')).toBeVisible({ timeout: 120_000 });
    await readTips(sam, 'Sam');
    await sam.getByTestId('battle-command').click();
    await expect(sam.getByTestId('battle-map')).toBeVisible();
    await takeCommand(sam);
    await sam.getByTestId('map-select-all').click();
    await sam.getByTestId('map-order-guard').click();
    const at = await standing(sam);
    await sam.mouse.click(at.x, at.y);
    await stamped(sam, 'guard');
  })();
  const watch = (async () => {
    await kit.bringToFront();
    await expect(kit.getByTestId('live-spectacle')).toBeVisible({ timeout: 300_000 });
    await readTips(kit, 'Kit');
    log(`Kit sees: ${(await kit.getByTestId('live-spectacle').innerText()).replace(/\s+/g, ' ')}`);
    await snap(kit, 'b-watch-offer');
    await kit.getByTestId('live-watch').click();
    await expect(kit.getByTestId('battle-map')).toBeVisible();
  })();
  await Promise.all([attack, defend, watch]);
  await snap(ada, 'b-battle-attacker');
  await snap(sam, 'b-battle-defender');
  await clearOfMap(ada, 'Ada');
  await clearOfMap(sam, 'Sam');
  await expect
    .poll(async () => (await points(kit)).enemy.length + (await points(kit)).own.length, { timeout: 60_000 })
    .toBeGreaterThan(0);
  await snap(kit, 'b-battle-watcher');
  await expect(ada.getByTestId('map-over')).toBeVisible({ timeout: 600_000 });
  await expect(sam.getByTestId('map-over')).toBeVisible({ timeout: 600_000 });
  await snap(ada, 'b-battle-over');
  await snap(sam, 'b-battle-over-defender');
  await ada.getByTestId('map-close').click();
  await sam.getByTestId('map-close').click();
  if (await kit.getByTestId('map-close').isVisible()) {
    await snap(kit, 'b-battle-over-watcher');
    await kit.getByTestId('map-close').click();
  }
  await expect
    .poll(
      async () => {
        await report(ada);
        await report(sam);
        return (await friendsWar(ada)).wars.find((w) => w.a === samSlot || w.b === samSlot)?.battles;
      },
      { timeout: 120_000, intervals: [4_000] },
    )
    .toBe(1);
  await readTips(ada, 'Ada');
  await readTips(sam, 'Sam');

  // Peace by treaty: Sam offers terms, Ada accepts.
  await sam.bringToFront();
  await warTab(sam, 'diplomacy');
  await sam.getByTestId(`dip-fpeace-${adaSlot}`).click();
  await expect(sam.getByTestId('dip-fbuilder')).toBeVisible();
  await sam.getByTestId('dip-fbuilder').scrollIntoViewIfNeeded();
  await snap(sam, 'b-terms');
  await sam.getByTestId('dip-fsend').click();
  await closeRoom(sam);
  await ada.bringToFront();
  await warTab(ada, 'diplomacy');
  const proposal = ada.locator('[data-testid^="dip-fproposal-"]');
  await expect(proposal).toContainText('peace', { timeout: 60_000 });
  await proposal.locator('[data-testid^="dip-faccept-"]').click();
  await expect
    .poll(
      async () => {
        await report(ada);
        await report(sam);
        return (await friendsWar(ada)).wars.some((w) => w.a === samSlot || w.b === samSlot);
      },
      { timeout: 120_000, intervals: [3_000] },
    )
    .toBe(false);
  await snap(ada, 'b-peace');
  await closeRoom(ada);
  await readTips(ada, 'Ada');
  await readTips(sam, 'Sam');
  await sam.bringToFront();
  await warTab(sam, 'diplomacy');
  await snap(sam, 'b-peace-sam');
  await closeRoom(sam);
  await readTips(kit, 'Kit');
  adaErrs.check();
  samErrs.check();
  kitErrs.check();
});

// ------------------------------------------------------------------------------------------------
test('phase 5 end, 3: the race for the atom bomb between two friends, and its aftermath @playthrough @phase5', async ({
  browser,
}) => {
  test.setTimeout(60 * 60_000);
  // Sam is the target, at High: the countdown, flight, flash and cloud are watched there.
  const sam = await player(browser, 'Sam', 1, quality);
  const samErrs = watchErrors(sam);
  await openCity(sam, '&seed=regionsam&preset=lakes&name=Samford');
  await servedTown(sam);
  const ada = await player(browser, 'Ada', 0, 'low');
  const adaErrs = watchErrors(ada);
  await openCity(ada, '&seed=port&preset=coast&name=Adaville');
  await servedTown(ada);
  const { samSlot } = await regionOf(ada, sam, 'total');
  await expect.poll(async () => (await region(ada))?.rules.bomb).toBe(true);

  // Both research everything (the Research tab is M37's); Samford's HQ stands east, past where a bomb would fall.
  for (const p of [ada, sam]) {
    await ok(p, { type: 'cheat', cheat: 'addMoney', amount: 20_000_000 });
    await ok(p, { type: 'cheat', cheat: 'research', tiers: TIERS });
    await calmRivals(p);
  }
  await armTown(ada, ['militaryhq']);
  await sam.evaluate(async () => {
    const g = window.__game!;
    const hz = (await g.getState()).highwayZ;
    const r = await g.dispatch({
      type: 'buildRoad',
      road: 'avenue',
      points: [
        { x: 504, z: hz },
        { x: 1430, z: hz },
      ],
    });
    if (!r.ok) throw new Error(r.reason);
    if ((await g.placeCivic('militaryhq', { x: 1200, z: hz - 40 })) === null)
      throw new Error('no room for the HQ');
    await g.advance(60 * 4);
  });
  await ok(sam, { type: 'cheat', cheat: 'unshield' });
  await report(sam);
  await report(ada);
  const samId = await ada.evaluate(async () => {
    const s = await window.__game!.getState();
    return s.region.neighbours.find((x) => x.name === 'Samford' && x.player)!.id;
  });

  // --- Ada builds the nuclear plant, the enrichment plant and the silo from the toolbar. ---
  await ada.bringToFront();
  const hz = (await state(ada)).highwayZ;
  await ok(ada, {
    type: 'buildRoad',
    road: 'avenue',
    points: [
      { x: 504, z: hz },
      { x: 1430, z: hz },
    ],
  });
  const stretch = (x0: number, dz: number): [number, number][] =>
    [0, 20, 40, 60, 80, 100].map((dx) => [x0 + dx, hz + dz]);
  const look = async (x: number) => {
    await ada.evaluate(
      ([x, hz]) => window.__game!.setCamera({ x, z: hz + 40, yaw: 0, distance: 520, tilt: 0.75 }),
      [x, hz],
    );
    await ada.evaluate(() => window.__game!.waitFrames(2));
  };
  await look(660);
  expect(await place(ada, 'power', 'nuclear', stretch(600, -52))).toBe(true);
  await ada.getByTestId('tool-select').click();
  await advance(ada, 60 * 4);
  await readTips(ada, 'Ada');
  await look(800);
  expect(await place(ada, 'military', 'enrichment', stretch(740, -44))).toBe(true);
  await ada.getByTestId('tool-select').click();
  await snap(ada, 'c-enrichment');
  await ok(ada, { type: 'cheat', cheat: 'finishStages', civic: (await civics(ada, 'enrichment'))[0]!.id });
  await advance(ada, 60 * 2);
  await report(ada);
  await readTips(sam, 'Sam');
  await look(940);
  expect(await place(ada, 'military', 'atomsilo', stretch(880, -44))).toBe(true);
  await ada.getByTestId('tool-select').click();
  await ok(ada, { type: 'cheat', cheat: 'atom', stage: 'silo' });
  await ok(ada, { type: 'cheat', cheat: 'finishStages', civic: (await civics(ada, 'atomsilo'))[0]!.id });
  await expect
    .poll(
      async () => {
        await advance(ada, 60);
        return (await ada.evaluate(() => window.__game!.getAtom())).summary!.buildWhy;
      },
      { timeout: 120_000, intervals: [1_000] },
    )
    .toBeNull();
  await warTab(ada, 'atom');
  await snap(ada, 'c-bomb-tab');
  await ada.getByTestId('atom-build').click();
  await expect
    .poll(async () => (await ada.evaluate(() => window.__game!.getAtom())).summary!.bomb?.paid ?? 0)
    .toBeGreaterThanOrEqual(1);
  await ok(ada, { type: 'cheat', cheat: 'atom', stage: 'ready' });
  await report(ada);
  await closeRoom(ada);
  await readTips(ada, 'Ada');
  await sam.bringToFront();
  await readTips(sam, 'Sam');
  await warTab(sam, 'atom');
  await snap(sam, 'c-race-seen');
  await closeRoom(sam);

  // --- Total war, then the launch by the real three-second hold. ---
  await declareOnFriend(ada, sam, samSlot, 'total', 'c');
  await ada.bringToFront();
  await warTab(ada, 'atom');
  await ada.getByTestId(`atom-target-${samId}`).click();
  const hold = ada.getByTestId('launch-hold');
  await expect(hold).toBeEnabled();
  await hold.hover();
  await ada.mouse.down();
  await ada.waitForTimeout(1_500);
  await snap(ada, 'c-launch-hold');
  await ada.waitForTimeout(2_100);
  await ada.mouse.up();
  await expect
    .poll(async () => (await ada.evaluate(() => window.__game!.getAtom())).summary!.launch?.to)
    .toBe(samId);
  await report(ada);
  await closeRoom(ada);
  await lookAway(ada);
  await ada.waitForTimeout(25_000);
  for (let day = 0; day < 20; day++) {
    const s = (await ada.evaluate(() => window.__game!.getAtom())).summary!;
    if (s.fired || s.launch?.sent || s.launch?.refused) break;
    await calmRivals(ada);
    await advance(ada, 1440);
    await report(ada);
  }
  await expect
    .poll(
      async () => {
        await report(ada);
        const s = (await ada.evaluate(() => window.__game!.getAtom())).summary!;
        return s.fired?.to ?? s.launch?.refused ?? null;
      },
      { timeout: 180_000, intervals: [2_000] },
    )
    .toBe(samId);

  // --- On Samford, at High: the countdown, the missile in the sky, the flash and the cloud. ---
  await sam.bringToFront();
  await expect
    .poll(
      async () => {
        await report(sam);
        await advance(sam, 2);
        return (await sam.evaluate(() => window.__game!.getAtom())).summary!.inbound?.from ?? null;
      },
      { timeout: 120_000, intervals: [2_000] },
    )
    .toBe('Adaville');
  await expect(sam.getByTestId('atom-countdown')).toBeVisible();
  await readTips(sam, 'Sam');
  const inbound = (await sam.evaluate(() => window.__game!.getAtom())).summary!.inbound!;
  await advance(sam, Math.round((inbound.arrive - (await state(sam)).tick) * 0.7));
  await sam.getByTestId('atom-look').click();
  await sam.evaluate(() => window.__game!.waitFrames(40));
  await snap(sam, 'c-countdown');
  // The last 20 seconds at normal speed, as a player would watch them, from the side of ground zero (the
  // missile's own camera ends looking straight down, where the toy mushroom is a heap of puffs).
  await advance(sam, inbound.arrive - (await state(sam)).tick - 160);
  await sam.evaluate(
    ([x, z]) => window.__game!.setCamera({ x, z: z + 250, yaw: 0.35, distance: 1100, tilt: 0.28 }),
    [inbound.x, inbound.z],
  );
  await sam.evaluate(() => window.__game!.setSpeed(1));
  for (let k = 0; k < 600; k++) {
    if ((await sam.evaluate(() => window.__game!.getAtomFx())).flash > 0.3) break;
    await sam.waitForTimeout(50);
  }
  await snap(sam, 'c-flash');
  await sam.waitForTimeout(12_000);
  await snap(sam, 'c-cloud');
  await sam.evaluate(() => window.__game!.setSpeed(0));
  await expect
    .poll(
      async () => {
        await advance(sam, 30);
        return (await sam.evaluate(() => window.__game!.getAtom())).summary!.impact?.over ?? false;
      },
      { timeout: 180_000, intervals: [1_000] },
    )
    .toBe(true);
  await expect(sam.getByTestId('atom-after')).toBeVisible();
  await snap(sam, 'c-after');
  await sam.getByTestId('atom-after-ok').click();
  await readTips(sam, 'Sam');

  // --- The aftermath on Samford: the radiation map, a clean-up crew. ---
  await advance(sam, 1440);
  await readTips(sam, 'Sam');
  const impact = (await sam.evaluate(() => window.__game!.getAtom())).summary!.impact!;
  await sam.evaluate(
    ([x, z]) => window.__game!.setCamera({ x, z: z + 200, yaw: 0.3, distance: 1100, tilt: 0.5 }),
    [impact.x, impact.z],
  );
  await sam.getByTestId('tool-maps').click();
  await sam.getByTestId('map-radiation').click();
  await expect(sam.getByTestId('radiation-bands')).toBeVisible();
  const p = await screenAt(sam, impact.x + 150, impact.z);
  await sam.mouse.move(p.x, p.y, { steps: 3 });
  await sam.waitForTimeout(800);
  await snap(sam, 'c-radiation');
  await warTab(sam, 'atom');
  await sam.getByTestId('atom-cleanup').click();
  await expect(sam.getByTestId('cleanup-bar')).toBeVisible();
  const q = await screenAt(sam, impact.x, impact.z);
  await sam.mouse.move(q.x, q.y, { steps: 3 });
  await sam.waitForTimeout(800);
  await sam.mouse.click(q.x, q.y);
  await sam.waitForTimeout(1_000);
  await snap(sam, 'c-cleanup');
  await sam.getByTestId('cleanup-done').click();

  // --- The winter on both cities; Ada a pariah. (The fallout map off: the snow and the ash sky to see.) ---
  const hideMap = sam.getByRole('button', { name: 'Hide data map' });
  if (await hideMap.isVisible()) await hideMap.click();
  for (let k = 0; k < 8; k++) {
    await report(ada);
    await report(sam);
    await advance(ada, 60 * 6);
    await advance(sam, 60 * 6);
  }
  await expect
    .poll(async () => (await state(ada)).weather.winter, { timeout: 120_000, intervals: [3_000] })
    .toBeGreaterThan(0);
  await expect(sam.getByTestId('winter-badge')).toBeVisible();
  await sam.evaluate(
    ([x, z]) => window.__game!.setCamera({ x: x + 300, z: z + 500, yaw: 0.5, distance: 900, tilt: 0.2 }),
    [impact.x, impact.z],
  );
  await readTips(sam, 'Sam');
  await snap(sam, 'c-winter');
  await ada.bringToFront();
  await readTips(ada, 'Ada');
  await warTab(ada, 'diplomacy');
  await expect(ada.getByTestId('dip-pariah')).toBeVisible();
  await snap(ada, 'c-pariah');
  adaErrs.check();
  samErrs.check();
});
