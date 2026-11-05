import { test, expect, type Browser, type Page } from '@playwright/test';
import { TIPS } from '../src/client/tutorial';
import { closeContextsAfterEach, newContext, openGame, shot, watchErrors } from './helpers';
import { armTown, servedTown } from './war';

/**
 * M39, war between two players through the real interface, from the first click to the treaty:
 * Ada starts a region and turns war on, Sam brings Samford in with the code, both arm. Ada declares war
 * on Sam from the Diplomacy tab's Friends list; the region warns Sam and opens the war two minutes later
 * (real time). Ada sends a force from the Send tab; it arrives and the region runs a live battle with
 * both pages in it. Both open the battle map (Ada with the O key, Sam with the battle bar's Command) and
 * give orders: Ada makes the force focus a building, Sam guards one and has his units focus an attacker.
 * The region stamps every order and sends it to both pages. The battle ends with both runs agreeing on its
 * hash, and the war's score moves on both sides. Then Sam offers peace from the Diplomacy tab, Ada
 * accepts it there, and both pages show the war over and the treaty signed.
 *
 * Both players play with the contextual tips on (the done criterion is that a player could invite a friend,
 * go to war and make peace without reading anything first): at each step the tip meant for it has to come
 * up on screen, in its own words, and the words it uses for buttons and tabs have to be the ones on the
 * screen. The tips are read and dismissed as a player would, and the rest of the spec runs on as before.
 * (The tips about building a town are marked as read to begin with: the towns are grown through the test
 * API, and a card about power or traffic would only come between the spec and the buttons.)
 */

// A button that never turns up fails in a minute, not at the test's timeout.
test.use({ actionTimeout: 60_000 });

/** On a failure, each player's last console lines and region messages (as m35-friends and m37-friends). */
const watched: { name: string; page: Page; log: string[] }[] = [];
function watch(name: string, page: Page): void {
  const log: string[] = [];
  const t0 = performance.now();
  const at = () => `${((performance.now() - t0) / 1000).toFixed(0)}s`;
  const kind = (payload: string | Buffer) => {
    const t = String(payload);
    return t.startsWith('{') ? (/"t":"(\w+)"/.exec(t)?.[1] ?? '?') : t.slice(0, 20);
  };
  page.on('console', (m) => log.push(`${at()} ${m.type()}: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => log.push(`${at()} pageerror: ${e.message}`));
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => log.push(`${at()} ws > ${kind(f.payload)}`));
    ws.on('framereceived', (f) => log.push(`${at()} ws < ${kind(f.payload)}`));
  });
  watched.push({ name, page, log });
}
test.afterEach(async ({ browserName: _ }, info) => {
  if (info.status !== info.expectedStatus)
    for (const w of watched) {
      await w.page.screenshot({ path: `test-results/m39-friends-${w.name}.png` }).catch(() => undefined);
      console.log(`--- ${w.name} at ${w.page.url()}\n${w.log.slice(-120).join('\n')}`);
    }
  watched.length = 0;
});
closeContextsAfterEach();

/** The tips of a war between friends, from joining a region to the peace (src/client/tutorial.ts), in the order met. */
const WAR_TIPS = [
  'sharedRegion',
  'rivals',
  'warRoom',
  'raidComing',
  'sendForce',
  'diplomacy',
  'regionWarOff',
  'friendsAtWar',
  'friendWar',
  'liveBattle',
  'friendPeace',
  'friendTreaty',
  'friendVassal',
];

/** Turn the tips on in a city that was opened with them off (as the settings screen's box does). */
async function tipsOn(page: Page): Promise<void> {
  expect(TIPS.map((t) => t.id)).toEqual(expect.arrayContaining(WAR_TIPS));
  const read = TIPS.map((t) => t.id).filter((id) => !WAR_TIPS.includes(id));
  await page.evaluate((read) => window.__game!.setSettings({ tips: true, seenTips: read }), read);
}

/** The tip on show now (its id), and the ones shown so far in the order they came. */
const tipNow = (page: Page) => page.evaluate(() => window.__game!.getShell().tip);
const tipsSeen = (page: Page) =>
  page
    .evaluate(() => window.__game!.getShell().settings.seenTips as string[])
    .then((ids) => ids.filter((id) => WAR_TIPS.includes(id)));
/** Tips that came before the one a step wanted, read and dismissed on the way: what each player met. */
const metOnTheWay: Record<string, string[]> = {};

/**
 * The tip `id` comes up on `page` (a card with its text, which no open panel is covering), is looked at
 * (`shotName`: a screenshot) and dismissed with "Got it". A tip that comes first is read and dismissed too,
 * as a player would; none showing for two minutes is a failure.
 */
async function readTip(
  page: Page,
  who: string,
  id: string,
  opts: { shotName?: string; front?: boolean } = {},
): Promise<void> {
  const want = TIPS.find((t) => t.id === id)!;
  if (opts.front !== false) await page.bringToFront();
  const card = page.getByTestId('tip');
  const until = Date.now() + 120_000;
  for (;;) {
    const now = await tipNow(page);
    if (now === id) break;
    if (now && (await card.isVisible())) {
      (metOnTheWay[who] ??= []).push(now);
      await page.getByTestId('tip-ok').click();
      continue;
    }
    if (Date.now() > until)
      throw new Error(
        `${who} never saw the ${id} tip (tip now: ${now ?? 'none'}; seen: ${(await tipsSeen(page)).join(', ')}; a panel open hides the card)`,
      );
    await page.waitForTimeout(300);
  }
  await expect(card, `${who}'s ${id} tip is on screen`).toBeVisible();
  await expect(card).toContainText(want.text);
  if (opts.shotName) await shot(page, `m39-e2e-tip-${opts.shotName}`);
  await page.getByTestId('tip-ok').click();
  await expect.poll(() => tipNow(page)).not.toBe(id);
}

/** Dismiss whatever tip card is showing (cards queue one at a time), so none stands over a button. */
async function clearTips(page: Page, who: string): Promise<void> {
  const card = page.getByTestId('tip');
  for (let k = 0; k < 6; k++) {
    await page.waitForTimeout(600);
    if (!(await card.isVisible())) return;
    const now = await tipNow(page);
    if (now) (metOnTheWay[who] ??= []).push(now);
    await page.getByTestId('tip-ok').click();
  }
}

/** The war room open on its Diplomacy tab (the keyboard shortcut toggles it, so only if it isn't). */
async function openDiplomacy(page: Page): Promise<void> {
  await page.bringToFront();
  if (!(await page.getByTestId('war-tab-diplomacy').isVisible())) await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-diplomacy').click();
}

async function player(browser: Browser, name: string, color: number): Promise<Page> {
  // Two SwiftShader pages: Low graphics and smaller windows.
  const ctx = await newContext(browser, { viewport: { width: 1200, height: 760 } });
  await ctx.addInitScript(
    ([n, c]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      // The spec trains its forces and sends them by fast-forwarding, far past the region's 1× clock.
      localStorage.setItem('citybloom.fairClock', 'off');
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      // (No shadows and a near draw distance: a software-rendered frame holds a page up, and the region
      // hands a player who is silent for ten seconds over to their defences.)
      localStorage.setItem(
        key,
        JSON.stringify({
          ...s,
          graphicsChecked: true,
          tips: false,
          quality: 'low',
          shadows: false,
          drawDistance: 'near',
        }),
      );
    },
    [name, color] as const,
  );
  return ctx.newPage();
}

const region = (page: Page) => page.evaluate(() => window.__game!.getRegion());
const live = (page: Page) => page.evaluate(() => window.__game!.getLive());
const friends = (page: Page) => page.evaluate(() => window.__game!.getFriendsWar());
const map = (page: Page) => page.evaluate(() => window.__game!.battleMap());
const points = (page: Page) => page.evaluate(() => window.__game!.battleMapPoints()!);

/** The region's war with the other player, as this page's mirror of it says (or null before there is one). */
async function warWith(page: Page, slot: number) {
  const f = await friends(page);
  return f.wars.find((w) => w.a === slot || w.b === slot) ?? null;
}

/** The newest order in the map's list has the room's stamp on it (the room heard it and sent it to both pages). */
async function stamped(page: Page, kind: string) {
  await expect
    .poll(async () => (await map(page)).log.at(-1), { timeout: 60_000, intervals: [300] })
    .toMatchObject({ kind, state: 'stamped' });
  return (await map(page)).log.at(-1)!;
}

/**
 * Look away from the town to empty ground: the battle is played on the map (the 3D view of it is a
 * show), and this VM draws every frame in software, which would hold the page up past the region's
 * ten seconds of silence.
 */
async function lookAway(page: Page): Promise<void> {
  const hz = (await page.evaluate(() => window.__game!.getState())).highwayZ;
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 1700, z: hz - 1200, yaw: 0, distance: 120, tilt: 0.5 }),
    hz,
  );
}

/** A page that fell quiet is handed over to its defences; the map offers to take command again. */
async function takeCommand(page: Page): Promise<void> {
  const handed = page.getByTestId('map-handed');
  if (await handed.isVisible()) await page.getByTestId('map-rejoin').click();
  await expect(handed).toBeHidden();
}

/** A building that stands and can be clicked on the map (the picture is drawn and has its size). */
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

/** Ada's side: the O key opens the map, everyone focuses a building that still stands. */
async function commandAttack(ada: Page): Promise<{ target: number | undefined; step: number }> {
  await expect
    .poll(async () => (await live(ada))?.role, { timeout: 300_000, intervals: [1_000] })
    .toBe('attacker');
  // A battle both players command: the tip says to press O, and she does.
  await readTip(ada, 'Ada', 'liveBattle', { front: false, shotName: 'liveBattle-ada' });
  await ada.keyboard.press('KeyO');
  const sheet = ada.getByTestId('battle-map');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('data-role', 'attacker');
  await expect(ada.getByTestId('map-title')).toContainText('Samford');
  await takeCommand(ada);
  await ada.getByTestId('map-select-all').click();
  await ada.getByTestId('map-order-focus').click();
  await expect(ada.getByTestId('map-hint')).toContainText('click a building');
  const goal = await standing(ada);
  await ada.mouse.click(goal.x, goal.y);
  const order = await stamped(ada, 'focus');
  expect(order.units).toBe('all');
  return { target: order.target, step: order.step ?? 0 };
}

/** Sam's side: the battle bar's Command opens the map; the defences guard a building, then focus an attacker. */
async function commandDefend(sam: Page): Promise<{ guard: number | undefined; focus: number | undefined }> {
  await expect
    .poll(async () => (await live(sam))?.role, { timeout: 300_000, intervals: [1_000] })
    .toBe('defender');
  await expect(sam.getByTestId('battle-bar')).toBeVisible({ timeout: 120_000 });
  await readTip(sam, 'Sam', 'liveBattle', { front: false });
  await clearTips(sam, 'Sam');
  await sam.getByTestId('battle-command').click();
  const sheet = sam.getByTestId('battle-map');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveAttribute('data-role', 'defender');
  await expect(sam.getByTestId('map-title')).toContainText('against');
  await takeCommand(sam);
  expect((await points(sam)).own.length, 'Samford’s defenders on the map').toBeGreaterThan(0);
  await sam.getByTestId('map-select-all').click();
  await sam.getByTestId('map-order-guard').click();
  await expect(sam.getByTestId('map-hint')).toContainText('click a building');
  const place = await standing(sam);
  await sam.mouse.click(place.x, place.y);
  const guard = await stamped(sam, 'guard');
  // Then the defenders go for an attacker: Focus names a unit.
  await sam.getByTestId('map-order-focus').click();
  await expect(sam.getByTestId('map-hint')).toContainText('click an attacker');
  const pts = await points(sam);
  const raider = pts.enemy.find((u) => u.visible);
  expect(raider, 'an attacker on Sam’s map').toBeDefined();
  await sam.mouse.click(raider!.x, raider!.y);
  const focus = await stamped(sam, 'focus');
  expect(focus.target).toBe(raider!.id);
  return { guard: guard.target, focus: focus.target };
}

test('M39: two players go to war, fight a live battle both commanding, and make peace', async ({
  browser,
}) => {
  test.setTimeout(3_600_000);
  const ada = await player(browser, 'Ada', 0);
  watch('ada', ada);
  const adaErrs = watchErrors(ada);
  await openGame(ada, '&seed=regionada&preset=river&name=Adaville');
  await tipsOn(ada);
  await servedTown(ada);
  const sam = await player(browser, 'Sam', 1);
  watch('sam', sam);
  const samErrs = watchErrors(sam);
  await openGame(sam, '&seed=regionsam&preset=lakes&name=Samford');
  await tipsOn(sam);
  await servedTown(sam);

  // --- A region: Ada starts it, closes its panel and is told what a region is; Sam joins with the code. ---
  await ada.bringToFront();
  await ada.keyboard.press('Shift+N');
  await ada.getByTestId('region-start').click();
  await expect.poll(async () => (await region(ada))?.state, { timeout: 120_000 }).toBe('in');
  const code = (await region(ada))!.code;
  await ada.keyboard.press('Shift+N');
  await readTip(ada, 'Ada', 'sharedRegion', { shotName: 'sharedRegion-ada' });
  await sam.bringToFront();
  await sam.keyboard.press('Shift+N');
  await sam.getByTestId('region-code').fill(code);
  await sam.getByTestId('region-join').click();
  await expect.poll(async () => (await region(sam))?.state, { timeout: 120_000 }).toBe('in');
  await expect(sam.getByTestId('region-war-rules')).toContainText('War is off', { timeout: 60_000 });
  await sam.keyboard.press('Shift+N');
  await readTip(sam, 'Sam', 'sharedRegion');

  // --- The region is at peace. Ada, its host, is told so once a friend is here, and how to turn war on
  // (not total war): the switch is in the Region panel, where she goes next. Sam sees the rules change. ---
  await readTip(ada, 'Ada', 'regionWarOff', { shotName: 'regionWarOff-ada' });
  await ada.keyboard.press('Shift+N');
  await ada.getByTestId('region-war-on').check();
  await expect.poll(async () => (await region(ada))?.rules.war, { timeout: 15_000 }).toBe(true);
  await ada.getByTestId('region-war-scale-war').click();
  await expect.poll(async () => (await region(ada))?.rules.scale, { timeout: 15_000 }).toBe('war');
  await ada.keyboard.press('Shift+N');
  await sam.bringToFront();
  await sam.keyboard.press('Shift+N');
  await expect(sam.getByTestId('region-war-rules')).toContainText('War is on', { timeout: 60_000 });
  await shot(sam, 'm39-e2e-1-joined');
  await sam.keyboard.press('Shift+N');
  const adaSlot = (await region(ada))!.slot;
  const samSlot = (await region(sam))!.slot;

  // --- Both arm: Ada a raiding force; Sam's defences are an HQ, a barracks, a bunker and a shelter. ---
  await ada.bringToFront();
  await armTown(ada, ['militaryhq', 'barracks', 'vehicledepot'], {
    infantry: 4,
    vehicles: ['tank', 'transport', 'tank'],
  });
  await sam.bringToFront();
  await armTown(sam, ['militaryhq', 'barracks', 'bunker', 'shelter'], { infantry: 8 });
  // Samford is a newcomer (under 3,000 residents), which a friend can't declare on or raid until it
  // strikes first (M36): the spec lifts its shield, as the other friends' specs do, and the region
  // hears of it before Ada looks.
  await sam.evaluate(async () => {
    const r = await window.__game!.dispatch({ type: 'cheat', cheat: 'unshield' });
    if (!r.ok) throw new Error(r.reason);
    await window.__game!.regionReportNow();
  });
  await ada.evaluate(() => window.__game!.regionReportNow());
  const target = await ada.evaluate(async () => {
    const s = await window.__game!.getState();
    const n = s.region.neighbours.find((x) => x.name === 'Samford' && x.player)!;
    return { id: n.id, slot: n.player!.slot };
  });
  expect(target.slot).toBe(samSlot);

  // --- War is on and a friend's city is in the region: both are told how to declare war, and the words
  // the tip uses are the ones on the Diplomacy tab. (Cards for the war room and the rivals may come first.) ---
  await readTip(ada, 'Ada', 'friendsAtWar', { shotName: 'friendsAtWar-ada' });
  await readTip(sam, 'Sam', 'friendsAtWar');
  const atWarText = TIPS.find((t) => t.id === 'friendsAtWar')!.text;

  // --- Ada declares war from the Diplomacy tab's Friends list. ---
  await ada.bringToFront();
  await ada.keyboard.press('Shift+KeyM');
  await ada.getByTestId('war-tab-diplomacy').click();
  await expect(ada.getByTestId(`dip-friend-${samSlot}`)).toContainText('Samford');
  // The tip said: the war room (Shift+M), the Diplomacy tab, “Friends in the region”, each with “Declare war…”.
  expect(atWarText).toContain('Friends in the region');
  expect(atWarText).toContain('Declare war…');
  await expect(
    ada.getByTestId('dip-friends').getByRole('heading', { name: 'Friends in the region' }),
  ).toBeVisible();
  await expect(ada.getByTestId(`dip-fdeclare-${samSlot}`)).toHaveText('Declare war…');
  await ada.getByTestId(`dip-fdeclare-${samSlot}`).click();
  await expect(ada.getByTestId('dip-fdeclare-form')).toBeVisible();
  await ada.getByTestId('dip-freason').fill('The river is ours');
  await shot(ada, 'm39-e2e-2-declare');
  await ada.getByTestId('dip-fdeclare-go').click();
  await expect(ada.getByTestId(`dip-fwar-text-${samSlot}`)).toContainText('It opens in');
  await ada.keyboard.press('Shift+KeyM');
  // Sam is told at once: a war card with the reason and the countdown.
  await sam.bringToFront();
  await sam.keyboard.press('Shift+KeyM');
  await sam.getByTestId('war-tab-diplomacy').click();
  await expect(sam.getByTestId(`dip-fwar-text-${adaSlot}`)).toContainText('The river is ours', {
    timeout: 60_000,
  });
  await expect(sam.getByTestId(`dip-fwar-text-${adaSlot}`)).toContainText('Declared by Adaville');
  await shot(sam, 'm39-e2e-3-warned');
  // Both close the war room and are told what a war with a friend is while it waits to open.
  await sam.keyboard.press('Shift+KeyM');
  await readTip(sam, 'Sam', 'friendWar', { shotName: 'friendWar-sam' });
  await readTip(ada, 'Ada', 'friendWar');

  // --- Two minutes of real time later the region opens the war (it notices on the cities' next report). ---
  await expect
    .poll(
      async () => {
        await ada.evaluate(() => window.__game!.regionReportNow());
        await sam.evaluate(() => window.__game!.regionReportNow());
        return [(await warWith(ada, samSlot))?.state, (await warWith(sam, adaSlot))?.state];
      },
      { timeout: 240_000, intervals: [8_000] },
    )
    .toEqual(['open', 'open']);
  await openDiplomacy(sam);
  await expect(sam.getByTestId(`dip-fwar-text-${adaSlot}`)).toContainText('Score');
  await expect(sam.getByTestId(`dip-fpeace-${adaSlot}`)).toBeVisible();
  await shot(sam, 'm39-e2e-4-open');
  await sam.keyboard.press('Shift+KeyM');

  // --- Ada sends a force from the Send tab; it arrives, and the region makes the battle live. ---
  await ada.bringToFront();
  await ada.keyboard.press('Shift+KeyM');
  await ada.getByTestId('war-tab-send').click();
  await ada.getByTestId('send-to').selectOption(String(target.id));
  // The tab says what the raid will be, so the battle map doesn't come as a surprise.
  await expect(ada.getByTestId('send-live')).toContainText('Samford’s player is here, so the battle is live');
  await ada.getByTestId('send-infantry').fill('4');
  await ada.getByTestId('send-tank').fill('2');
  await ada.getByTestId('send-transport').fill('1');
  await ada.getByTestId('send-force').click();
  await expect(ada.getByTestId('war-expeditions')).toContainText('on the way to Samford');
  await shot(ada, 'm39-e2e-5-sent');
  await ada.keyboard.press('Shift+KeyM');
  await lookAway(ada);
  await lookAway(sam);
  await ada.evaluate(() => window.__game!.advance(60 * 12));

  // --- Both command it: Ada with the O key, Sam with the battle bar's Command; at the same time. ---
  const [attack, defend] = await Promise.all([commandAttack(ada), commandDefend(sam)]);
  // The room sent every order to both pages: each page's battle holds all three, its own in its log.
  for (const p of [ada, sam])
    await expect
      .poll(async () => (await live(p))?.orders, { timeout: 60_000, intervals: [500] })
      .toBeGreaterThanOrEqual(3);
  expect((await map(ada)).log.map((e) => [e.kind, e.state])).toEqual([['focus', 'stamped']]);
  expect((await map(sam)).log.map((e) => [e.kind, e.state])).toEqual([
    ['guard', 'stamped'],
    ['focus', 'stamped'],
  ]);
  // Where the battle had got to when each order was heard (what to look at if a slow page misses one).
  const heard = async (p: Page) => (await map(p)).log.map((e) => `${e.kind}@${e.step}`).join(' ');
  console.log(`orders heard: Ada ${await heard(ada)}; Sam ${await heard(sam)}`);
  expect(attack.target, 'Ada’s focus names a building').toBeDefined();
  expect(defend.guard, 'Sam’s guard names a building').toBeDefined();
  await shot(ada, 'm39-e2e-6-attack');
  await shot(sam, 'm39-e2e-7-defend');

  // --- The battle ends with both runs agreeing. ---
  await expect(ada.getByTestId('map-over')).toBeVisible({ timeout: 600_000 });
  await expect(sam.getByTestId('map-over')).toBeVisible({ timeout: 600_000 });
  for (const p of [ada, sam]) {
    await expect
      .poll(async () => (await live(p))?.hashes.room?.agree, { timeout: 60_000, intervals: [500] })
      .toBe(true);
    const l = (await live(p))!;
    expect(l.ended).toBe(true);
    expect(l.desync).toBe(false);
    expect(l.hashes.mine).toMatchObject({ hash: l.hashes.room!.hash, step: l.hashes.room!.step });
  }
  const adaEnd = (await live(ada))!;
  const samEnd = (await live(sam))!;
  expect(adaEnd.id).toBe(samEnd.id);
  expect(adaEnd.hashes.mine!.hash).toBe(samEnd.hashes.mine!.hash);
  await shot(ada, 'm39-e2e-8-over-attacker');
  await shot(sam, 'm39-e2e-9-over-defender');
  await ada.getByTestId('map-close').click();
  await sam.getByTestId('map-close').click();

  // --- The war's score moved on both sides (the defender's page reported the result to the region). ---
  await expect
    .poll(
      async () => {
        await ada.evaluate(() => window.__game!.regionReportNow());
        await sam.evaluate(() => window.__game!.regionReportNow());
        return [(await warWith(ada, samSlot))?.battles, (await warWith(sam, adaSlot))?.battles];
      },
      { timeout: 120_000, intervals: [4_000] },
    )
    .toEqual([1, 1]);
  // A battle has been fought: both are told how to end the war, in the words of the Offer terms button.
  const peaceText = TIPS.find((t) => t.id === 'friendPeace')!.text;
  expect(peaceText).toContain('Offer terms');
  await readTip(sam, 'Sam', 'friendPeace', { shotName: 'friendPeace-sam' });
  await readTip(ada, 'Ada', 'friendPeace');
  const roomScore = (await warWith(ada, samSlot))!.score;
  expect(roomScore).not.toBe(0);
  expect((await warWith(sam, adaSlot))!.score).toBe(roomScore);
  // Each city's own Diplomacy tab reads it from its own side: opposite signs.
  const dipScore = (page: Page) =>
    page.evaluate(() => window.__game!.getDiplomacy()!.wars.find((w) => w.friend)!.score);
  await expect.poll(() => dipScore(ada), { timeout: 60_000 }).not.toBe(0);
  await expect.poll(() => dipScore(sam), { timeout: 60_000 }).not.toBe(0);
  expect(await dipScore(ada)).toBeCloseTo(-(await dipScore(sam)), 5);
  // The region's history has the live battle in it, watchable again.
  const history = (await friends(ada)).history;
  expect(history.some((e) => e.kind === 'battle' && e.battle?.live)).toBe(true);
  await ada.bringToFront();
  await ada.keyboard.press('Shift+KeyM');
  await ada.getByTestId('war-tab-diplomacy').click();
  await expect(ada.getByTestId(`dip-fwar-text-${samSlot}`)).toContainText('1 battle');
  await shot(ada, 'm39-e2e-10-score');
  await ada.keyboard.press('Shift+KeyM');

  // --- Sam offers peace from the Diplomacy tab; Ada accepts it there. ---
  await sam.bringToFront();
  await sam.keyboard.press('Shift+KeyM');
  await sam.getByTestId('war-tab-diplomacy').click();
  await expect(sam.getByTestId(`dip-fpeace-${adaSlot}`)).toHaveText('Offer terms');
  await sam.getByTestId(`dip-fpeace-${adaSlot}`).click();
  await expect(sam.getByTestId('dip-fbuilder')).toContainText('Terms to end the war with Adaville');
  await expect(sam.getByTestId('dip-fterm-words')).toContainText('peace');
  await sam.getByTestId('dip-fbuilder').scrollIntoViewIfNeeded();
  await shot(sam, 'm39-e2e-11-offer');
  await sam.getByTestId('dip-fsend').click();
  await expect(sam.locator('[data-testid^="dip-fwaiting-"]')).toContainText('waiting');
  // The terms wait a day for a friend who is away: the one who sent them is told so (back on the map),
  // and so is the one asked, who has not opened the war room yet.
  await sam.keyboard.press('Shift+KeyM');
  await readTip(sam, 'Sam', 'friendTreaty', { shotName: 'friendTreaty-sam' });
  await readTip(ada, 'Ada', 'friendTreaty', { shotName: 'friendTreaty-ada' });
  await ada.keyboard.press('Shift+KeyM');
  await ada.getByTestId('war-tab-diplomacy').click();
  const proposal = ada.locator('[data-testid^="dip-fproposal-"]');
  await expect(proposal).toContainText('Samford', { timeout: 60_000 });
  await expect(proposal).toContainText('peace');
  await shot(ada, 'm39-e2e-12-proposal');
  await proposal.locator('[data-testid^="dip-faccept-"]').click();

  // --- Both pages show the war over and the treaty signed. ---
  for (const [p, other] of [
    [ada, samSlot],
    [sam, adaSlot],
  ] as const) {
    await expect
      .poll(
        async () => {
          const f = await friends(p);
          return { wars: f.wars.filter((w) => w.state !== 'ended').length, treaties: f.treaties.length };
        },
        { timeout: 90_000, intervals: [1_000] },
      )
      .toEqual({ wars: 0, treaties: 1 });
    const f = await friends(p);
    expect(f.history.some((e) => e.kind === 'treaty' && e.text.includes('peace'))).toBe(true);
    expect(f.incoming).toEqual([]);
    expect(f.outgoing).toEqual([]);
    await openDiplomacy(p);
    await expect(p.getByTestId(`dip-fwar-${other}`)).toHaveCount(0);
    await expect(p.getByTestId('dip-region-history')).toContainText('sign a treaty: peace');
    // The city's own mirror: no war with that friend any more.
    await expect
      .poll(() => p.evaluate(() => window.__game!.getDiplomacy()!.wars.filter((w) => w.friend).length), {
        timeout: 60_000,
      })
      .toBe(0);
  }
  await shot(ada, 'm39-e2e-13-peace-ada');
  await shot(sam, 'm39-e2e-14-peace-sam');

  // What each player was shown, in the order the war went: every step's tip came, once, and in turn.
  const adaTips = await tipsSeen(ada);
  const samTips = await tipsSeen(sam);
  console.log(
    `tips Ada: ${adaTips.join(' > ')}; Sam: ${samTips.join(' > ')}; read on the way: ${JSON.stringify(metOnTheWay)}`,
  );
  const inTurn = (seen: string[], ids: string[]) => {
    const at = ids.map((id) => seen.indexOf(id));
    return at.every((n, k) => n >= 0 && (k === 0 || n > at[k - 1]!));
  };
  expect(
    inTurn(adaTips, [
      'sharedRegion',
      'regionWarOff',
      'friendsAtWar',
      'friendWar',
      'liveBattle',
      'friendPeace',
      'friendTreaty',
    ]),
  ).toBe(true);
  expect(
    inTurn(samTips, [
      'sharedRegion',
      'friendsAtWar',
      'friendWar',
      'liveBattle',
      'friendPeace',
      'friendTreaty',
    ]),
  ).toBe(true);
  adaErrs.check();
  samErrs.check();
});
