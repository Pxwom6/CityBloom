import { expect, test, type Browser, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext, openGame, shot, watchErrors } from './helpers';
import { state } from './ui';
import { armTown, servedTown } from './war';

/**
 * M40 between two players through the real UI, against the local relay (Low graphics, small windows, the
 * fair clock off, as m39-friends): Ada, the host, allows total war, superweapons and the atom bomb in the
 * Region panel; both cities race, and each sees the other's progress (the room's notices, the region
 * map's pips, the Bomb tab's race list); Ada finishes first (the region's alert, her achievement).
 * Ada declares total war on Sam from the Diplomacy tab's Friends block and launches at Samford by a
 * real three-second hold on the Bomb tab; the region's room keeps the strike once the launch has been
 * prepared long enough (shortened for tests: the e2e relay runs with `--atom-prep 20`). On Samford:
 * the countdown card (its new dome not yet charged, so the bomb lands), the city levelled, its report's hit on
 * Ada's map. Afterwards the nuclear winter reaches Ada too; Ada is a pariah (reputation 0 for good, her
 * pact with a computer neighbour ended); peace is made, and Sam may declare war on her again at once.
 * Cheats skip only the long waits (research, a project's stages, the fuel and the bomb).
 */

// A button that never turns up fails in a minute, not at the test's timeout.
test.use({ actionTimeout: 60_000 });

/** On a failure, each player's last console lines and region messages (as m39-friends). */
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
      await w.page.screenshot({ path: `test-results/m40-friends-${w.name}.png` }).catch(() => undefined);
      console.log(`--- ${w.name} at ${w.page.url()}\n${w.log.slice(-120).join('\n')}`);
    }
  watched.length = 0;
});
closeContextsAfterEach();

const TIERS = ['land', 'air', 'sea', 'defence', 'intel', 'logistics'].flatMap((b) =>
  [1, 2, 3, 4].map((t) => `${b}${t}`),
);

async function player(browser: Browser, name: string, color: number): Promise<Page> {
  // Two SwiftShader pages: Low graphics and smaller windows.
  const ctx = await newContext(browser, { viewport: { width: 1200, height: 760 } });
  await ctx.addInitScript(
    ([n, c]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      // The race is fast-forwarded, far past the region's 1x clock.
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
const atom = (page: Page) => page.evaluate(() => window.__game!.getAtom());
const friends = (page: Page) => page.evaluate(() => window.__game!.getFriendsWar());
const report = (page: Page) => page.evaluate(() => window.__game!.regionReportNow());
const advance = (page: Page, ticks: number) => page.evaluate((n) => window.__game!.advance(n), ticks);
const ok = (page: Page, cmd: Record<string, unknown>) =>
  page.evaluate(async (cmd) => {
    const r = await window.__game!.dispatch(cmd as never);
    if (!r.ok) throw new Error(`${String(cmd.type)} ${String(cmd.cheat ?? '')}: ${r.reason}`);
  }, cmd);

/** Look away from the town to empty ground (a software-drawn town holds a page up past the room's silence). */
async function lookAway(page: Page): Promise<void> {
  const hz = (await state(page)).highwayZ;
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 1700, z: hz - 1200, yaw: 0, distance: 120, tilt: 0.5 }),
    hz,
  );
}

/** The war room open on a tab (its shortcut toggles it, so only if it isn't). */
async function warTab(page: Page, tab: string): Promise<void> {
  await page.bringToFront();
  if (!(await page.getByTestId(`war-tab-${tab}`).isVisible())) await page.keyboard.press('Shift+KeyM');
  await page.getByTestId(`war-tab-${tab}`).click();
}
async function closeRoom(page: Page): Promise<void> {
  if (await page.evaluate(() => window.__game!.getWarRoom().open)) await page.keyboard.press('Shift+KeyM');
}

/** Computer neighbours' forces back to nothing: no raid moves a war's score while the race is played on. */
async function calmRivals(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g = window.__game!;
    for (const n of (await g.getState()).region.neighbours.filter((x) => x.rival && !x.player))
      await g.dispatch({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0, defences: 1 });
  });
}

/** A line in the Notifications panel (the room's notices of the race come there, and as toasts). */
async function noticed(page: Page, text: string | RegExp): Promise<void> {
  await page.bringToFront();
  await closeRoom(page);
  await expect
    .poll(
      async () => {
        await report(page);
        if (!(await page.getByTestId('notifications').isVisible())) await page.keyboard.press('KeyN');
        const all = await page.getByTestId('notifications').innerText();
        return typeof text === 'string' ? all.includes(text) : text.test(all);
      },
      { timeout: 120_000, intervals: [3_000] },
    )
    .toBe(true);
}
async function closeNotices(page: Page): Promise<void> {
  if (await page.getByTestId('notifications').isVisible()) await page.keyboard.press('KeyN');
}

test('M40: two friends race for the atom bomb, one strikes the other, and the region turns on it', async ({
  browser,
}) => {
  test.setTimeout(3_600_000);
  const ada = await player(browser, 'Ada', 0);
  watch('ada', ada);
  const adaErrs = watchErrors(ada);
  // (On the coast map, as m40-atom: a town big enough that the forces' quarter of its workers staffs the
  // HQ, the enrichment plant and the silo; Adaville on m39's river map is too small to run the silo.)
  await openGame(ada, '&seed=port&preset=coast&name=Adaville');
  await servedTown(ada);
  const sam = await player(browser, 'Sam', 1);
  watch('sam', sam);
  const samErrs = watchErrors(sam);
  await openGame(sam, '&seed=regionsam&preset=lakes&name=Samford');
  await servedTown(sam);

  // --- A region: Ada starts it; Sam joins with the code. ---
  await ada.bringToFront();
  await ada.keyboard.press('Shift+N');
  await ada.getByTestId('region-start').click();
  await expect.poll(async () => (await region(ada))?.state, { timeout: 120_000 }).toBe('in');
  const code = (await region(ada))!.code;
  await ada.keyboard.press('Shift+N');
  await sam.bringToFront();
  await sam.keyboard.press('Shift+N');
  await sam.getByTestId('region-code').fill(code);
  await sam.getByTestId('region-join').click();
  await expect.poll(async () => (await region(sam))?.state, { timeout: 120_000 }).toBe('in');
  await sam.keyboard.press('Shift+N');

  // --- Ada, the host, allows total war: superweapons and the atom bomb come with it, ticked. ---
  await ada.bringToFront();
  await ada.keyboard.press('Shift+N');
  await ada.getByTestId('region-war-on').check();
  await expect.poll(async () => (await region(ada))?.rules.war, { timeout: 15_000 }).toBe(true);
  await ada.getByTestId('region-war-scale-total').click();
  await expect
    .poll(async () => (await region(ada))?.rules, { timeout: 15_000 })
    .toMatchObject({ war: true, scale: 'total', supers: true, bomb: true });
  await expect(ada.getByTestId('region-war-bomb')).toBeChecked();
  await ada.keyboard.press('Shift+N');
  await sam.bringToFront();
  await sam.keyboard.press('Shift+N');
  await expect(sam.getByTestId('region-war-rules')).toContainText('atom bomb', { timeout: 60_000 });
  await shot(sam, 'm40-e2e-friends-1-rules');
  await sam.keyboard.press('Shift+N');
  const adaSlot = (await region(ada))!.slot;
  const samSlot = (await region(sam))!.slot;

  // --- Both arm and research everything; Samford's newcomer's shield is lifted (as the friends specs do). ---
  // (Samford's HQ, the seat of its war room, stands well east of the town, past the blast and the closed
  // ground: a city that loses its HQ can't open the war room, to make peace or declare war, until it builds
  // another.)
  await ada.bringToFront();
  await armTown(ada, ['militaryhq']);
  await sam.bringToFront();
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
  for (const p of [ada, sam]) {
    await p.bringToFront();
    await ok(p, { type: 'cheat', cheat: 'addMoney', amount: 20_000_000 });
    await ok(p, { type: 'cheat', cheat: 'research', tiers: TIERS });
    await calmRivals(p);
  }
  await ok(sam, { type: 'cheat', cheat: 'unshield' });
  await report(sam);
  await report(ada);
  const samId = await ada.evaluate(async () => {
    const s = await window.__game!.getState();
    return s.region.neighbours.find((x) => x.name === 'Samford' && x.player)!.id;
  });

  // A pact of Ada's with a computer neighbour, accepted from the Diplomacy tab, for the world to end.
  const pactWith = await ada.evaluate(async () => {
    const s = await window.__game!.getState();
    return s.region.neighbours.find((x) => x.rival && !x.player)?.id ?? null;
  });
  if (pactWith !== null) {
    await ok(ada, {
      type: 'cheat',
      cheat: 'proposal',
      neighbour: pactWith,
      terms: [{ k: 'nonAggression', months: 24 }],
    });
    await warTab(ada, 'diplomacy');
    await ada.locator('[data-testid^="dip-accept-"]').first().click();
    await expect
      .poll(async () => (await ada.evaluate(() => window.__game!.getDiplomacy()))!.pacts.map((p) => p.with))
      .toContain(pactWith);
    await closeRoom(ada);
  }

  // --- The race: Samford begins an enrichment plant; Ada sees it in her notices, on her region map and
  // in her Bomb tab's race list. ---
  const build = (p: Page, defs: string[]) =>
    p.evaluate(async (defs) => {
      const g = window.__game!;
      const hz = (await g.getState()).highwayZ;
      const spots = [
        { x: 24 + 300, z: hz + 260 },
        { x: 24 + 120, z: hz - 300 },
        { x: 24 + 380, z: hz - 300 },
        { x: 24 + 240, z: hz + 330 },
      ];
      const ids: Record<string, number> = {};
      for (const [k, def] of defs.entries()) {
        const id = await g.placeCivic(def, spots[k]!);
        if (id === null) throw new Error(`no room for ${def}`);
        ids[def] = id;
        // (A plant followed by a silo: the silo needs the plant online, its stages done by the cheat.)
        if (def === 'enrichment' && defs.includes('atomsilo')) {
          const r = await g.dispatch({ type: 'cheat', cheat: 'finishStages', civic: id });
          if (!r.ok) throw new Error(r.reason);
        }
        await g.advance(60 * 4);
      }
      return ids;
    }, defs);
  await sam.bringToFront();
  await build(sam, ['nuclear', 'enrichment']);
  await report(sam);
  await noticed(ada, 'Samford has begun building an enrichment plant');
  await closeNotices(ada);
  await warTab(ada, 'map');
  await expect(ada.getByTestId(`map-race-${samId}`)).toBeVisible();
  await warTab(ada, 'atom');
  await expect(ada.getByTestId(`atom-race-friend-${samSlot}`)).toContainText('Samford');
  await ada.getByTestId(`atom-race-friend-${samSlot}`).scrollIntoViewIfNeeded();
  await shot(ada, 'm40-e2e-friends-2-race');
  await closeRoom(ada);

  // --- Ada builds hers to the end first (the plant's and silo's stages, the fuel and the bomb by the
  // cheat): the region's first finisher, an alert for Sam and an achievement for Ada. ---
  await ada.bringToFront();
  await build(ada, ['nuclear', 'enrichment', 'atomsilo']);
  await ok(ada, { type: 'cheat', cheat: 'atom', stage: 'ready' });
  await report(ada);
  await expect
    .poll(
      async () => {
        await report(ada);
        return (await atom(ada)).first;
      },
      { timeout: 120_000, intervals: [3_000] },
    )
    .toBe(true);
  await advance(ada, 60 * 2);
  expect((await state(ada)).achievements.firstBomb).toBeDefined();
  await warTab(ada, 'atom');
  await expect(ada.getByTestId('atom-first-me')).toBeVisible();
  await closeRoom(ada);
  await noticed(sam, 'Adaville has the atom bomb');
  await shot(sam, 'm40-e2e-friends-3-first');
  await closeNotices(sam);
  await warTab(sam, 'atom');
  await expect(sam.getByTestId(`atom-race-friend-${adaSlot}`)).toContainText('first to the bomb');
  await closeRoom(sam);

  // --- Ada declares total war on Sam from the Friends block; the region opens it two minutes later. ---
  await warTab(ada, 'diplomacy');
  await ada.getByTestId(`dip-fdeclare-${samSlot}`).click();
  await expect(ada.getByTestId('dip-fdeclare-form')).toBeVisible();
  await ada.getByTestId('dip-fscale').selectOption('total');
  await ada.getByTestId('dip-freason').fill('The last war');
  await ada.getByTestId('dip-fdeclare-go').click();
  await expect(ada.getByTestId(`dip-fwar-text-${samSlot}`)).toContainText('It opens in');
  await closeRoom(ada);
  await lookAway(ada);
  await lookAway(sam);
  await expect
    .poll(
      async () => {
        await report(ada);
        await report(sam);
        const w = (await friends(ada)).wars.find((x) => x.a === samSlot || x.b === samSlot);
        return w ? `${w.state}:${w.scale}` : 'none';
      },
      { timeout: 300_000, intervals: [8_000] },
    )
    .toBe('open:total');

  // --- Samford builds a dome shield, too late: it has not charged, so it can't stop a bomb. ---
  await sam.bringToFront();
  const dome = await sam.evaluate(async () => {
    const g = window.__game!;
    const hz = (await g.getState()).highwayZ;
    return g.placeCivic('domeshield', { x: 24 + 60, z: hz + 200 });
  });
  expect(dome, 'room for the dome').not.toBeNull();
  if ((await sam.evaluate(() => window.__game!.getCivics())).find((c) => c.id === dome)?.stage !== undefined)
    await ok(sam, { type: 'cheat', cheat: 'finishStages', civic: dome });
  // (The dome is taken up by the war clock's next hour.)
  await advance(sam, 60 * 2);
  expect((await sam.evaluate(() => window.__game!.getSupers())).buildings?.dome).toBeTruthy();

  // --- Ada launches at Samford by a real three-second hold on the Bomb tab. ---
  await warTab(ada, 'atom');
  await expect(ada.getByTestId('atom-launch-card')).toBeVisible();
  await ada.getByTestId(`atom-target-${samId}`).click();
  const hold = ada.getByTestId('launch-hold');
  await expect(hold).toBeEnabled();
  await hold.hover();
  await ada.mouse.down();
  await ada.waitForTimeout(3_600);
  await ada.mouse.up();
  await expect.poll(async () => (await atom(ada)).summary!.launch?.to).toBe(samId);
  // The region starts the launch's own clock when it hears of it (20 s on the test relay).
  await report(ada);
  await shot(ada, 'm40-e2e-friends-4-preparing');
  await closeRoom(ada);
  await lookAway(ada);
  await ada.waitForTimeout(25_000);
  // The preparation (288 war hours) by the clock; the bomb is put to the room when it is ready. A room
  // whose own wait for the launch is longer (a relay started without `--atom-prep`) answers how long:
  // waited out (two minutes at most), and the bomb sent again by another hold.
  for (let day = 0; day < 20; day++) {
    const s = (await atom(ada)).summary!;
    if (s.fired || s.launch?.sent || s.launch?.refused) break;
    await calmRivals(ada);
    await advance(ada, 1440);
    await report(ada);
    const st = await state(ada);
    console.log(
      `[m40-friends] day ${day}: ${st.population} residents, jobs ${JSON.stringify(st.jobs ?? null)}, launch ${JSON.stringify((await atom(ada)).summary!.launch)}`,
    );
  }
  for (let k = 0; k < 3; k++) {
    await expect
      .poll(
        async () => {
          await report(ada);
          const s = (await atom(ada)).summary!;
          return s.fired
            ? 'fired'
            : (s.launch?.refused ??
                (s.launch?.sent ? 'sent' : `waiting ${JSON.stringify(s.launch)} ${s.launchWhy}`));
        },
        { timeout: 120_000, intervals: [2_000] },
      )
      .not.toMatch(/^(sent|waiting)/);
    const s = (await atom(ada)).summary!;
    if (s.fired) break;
    const wait = /waits (\d+) (second|minute)s? more/.exec(s.launch!.refused!);
    expect(wait, `the room refused the strike: ${s.launch!.refused}`).not.toBeNull();
    const ms = Number(wait![1]) * (wait![2] === 'minute' ? 60_000 : 1_000);
    expect(ms, 'the room waits too long: start the relay with --atom-prep 20').toBeLessThanOrEqual(120_000);
    await ada.waitForTimeout(ms + 2_000);
    await warTab(ada, 'atom');
    await ada.getByTestId('atom-send-again').hover();
    await ada.mouse.down();
    await ada.waitForTimeout(3_600);
    await ada.mouse.up();
    await closeRoom(ada);
  }
  expect((await atom(ada)).summary!.fired?.to).toBe(samId);

  // --- On Samford: the countdown card, the dome switched off. ---
  // (Sam's city is paused: the sim warns of a bomb it has taken on its next tick.)
  await expect
    .poll(
      async () => {
        await report(sam);
        await advance(sam, 2);
        return (await atom(sam)).summary!.inbound?.from ?? null;
      },
      { timeout: 120_000, intervals: [2_000] },
    )
    .toBe('Adaville');
  await sam.bringToFront();
  await expect(sam.getByTestId('atom-countdown')).toBeVisible();
  await expect(sam.getByTestId('atom-from')).toContainText('Adaville');
  await expect(sam.getByTestId('atom-dome')).toContainText('dome shield');
  await expect(sam.getByTestId('atom-dome')).not.toContainText('no dome shield');
  expect((await atom(sam)).summary!.inbound!.stops).toBe(false);
  // (The town in view for the picture, then away again.)
  await sam.evaluate(() => window.__game!.setCamera('city'));
  await sam.evaluate(() => window.__game!.waitFrames(6));
  await shot(sam, 'm40-e2e-friends-5-countdown');
  await lookAway(sam);

  // --- It lands: Samford levelled, its report's hit on Ada's map. ---
  const arrive = (await atom(sam)).summary!.inbound!.arrive;
  await advance(sam, arrive - (await state(sam)).tick + 10);
  await expect
    .poll(
      async () => {
        await advance(sam, 30);
        return (await atom(sam)).summary!.impact?.over ?? false;
      },
      { timeout: 180_000, intervals: [1_000] },
    )
    .toBe(true);
  const hit = (await atom(sam)).summary!.impact!;
  expect(hit.levelled).toBeGreaterThan(50);
  await expect(sam.getByTestId('atom-after')).toBeVisible();
  await expect(sam.getByTestId('atom-after-text')).toContainText('buildings were levelled');
  await sam.evaluate(
    ([x, z]) => window.__game!.setCamera({ x, z: z + 500, yaw: 0, distance: 1300, tilt: 0.3 }),
    [hit.x, hit.z],
  );
  await sam.evaluate(() => window.__game!.waitFrames(6));
  await shot(sam, 'm40-e2e-friends-6-levelled');
  await lookAway(sam);
  await sam.getByTestId('atom-after-ok').click();
  await report(sam);
  await expect
    .poll(
      async () => {
        await report(sam);
        await report(ada);
        const s = await state(ada);
        return s.region.neighbours.find((n) => n.id === samId)?.player?.atom?.hit ?? 0;
      },
      { timeout: 120_000, intervals: [3_000] },
    )
    .toBeGreaterThanOrEqual(1);
  await warTab(ada, 'map');
  await expect(ada.getByTestId(`map-cloud-${samId}`)).toBeVisible();
  await closeRoom(ada);

  // --- Afterwards: the winter reaches Ada too; Ada is a pariah, her computer neighbour's pact gone. ---
  await expect
    .poll(
      async () => {
        await report(ada);
        await advance(ada, 60);
        return (await state(ada)).weather.winter;
      },
      { timeout: 120_000, intervals: [3_000] },
    )
    .toBeGreaterThan(0);
  expect((await atom(ada)).winters.length).toBeGreaterThanOrEqual(1);
  const dip = (await ada.evaluate(() => window.__game!.getDiplomacy()))!;
  expect(dip.reputation).toBe(0);
  expect(dip.pariah).not.toBeNull();
  if (pactWith !== null) expect(dip.pacts.map((p) => p.with)).not.toContain(pactWith);
  await warTab(ada, 'diplomacy');
  await expect(ada.getByTestId('dip-pariah')).toContainText('firing the atom bomb');
  await expect(ada.getByTestId('winter-badge')).toContainText('Nuclear winter');
  await shot(ada, 'm40-e2e-friends-7-pariah');
  await closeRoom(ada);

  // --- Sam sees it, makes peace, and may declare war on Ada again at once (no cooldown for a pariah). ---
  await expect
    .poll(async () => {
      await report(ada);
      await report(sam);
      return (await sam.evaluate(() => window.__game!.getDiplomacy()))!.friends.find(
        (f) => f.slot === adaSlot,
      )?.pariah;
    })
    .toBe(true);
  await warTab(sam, 'diplomacy');
  await expect(sam.getByTestId(`dip-friend-${adaSlot}`)).toContainText('fired the atom bomb');
  await sam.getByTestId(`dip-fpeace-${adaSlot}`).click();
  await expect(sam.getByTestId('dip-fbuilder')).toBeVisible();
  await sam.getByTestId('dip-fbuilder').scrollIntoViewIfNeeded();
  await sam.getByTestId('dip-fsend').click();
  await expect(sam.locator('[data-testid^="dip-fwaiting-"]')).toContainText('waiting');
  await closeRoom(sam);
  await warTab(ada, 'diplomacy');
  const proposal = ada.locator('[data-testid^="dip-fproposal-"]');
  await expect(proposal).toContainText('peace', { timeout: 60_000 });
  await proposal.locator('[data-testid^="dip-faccept-"]').click();
  await closeRoom(ada);
  await expect
    .poll(
      async () => {
        await report(ada);
        await report(sam);
        return (await friends(sam)).wars.some((w) => w.a === adaSlot || w.b === adaSlot);
      },
      { timeout: 120_000, intervals: [3_000] },
    )
    .toBe(false);
  await warTab(sam, 'diplomacy');
  await expect(sam.getByTestId(`dip-fpariah-${adaSlot}`)).toContainText('declare war on it at once');
  await sam.getByTestId(`dip-fdeclare-${adaSlot}`).click();
  await sam.getByTestId('dip-freason').fill('The bomb');
  await sam.getByTestId('dip-fdeclare-go').click();
  await expect(sam.getByTestId(`dip-fwar-text-${adaSlot}`)).toContainText('It opens in');
  expect((await friends(sam)).wars.find((w) => w.a === adaSlot || w.b === adaSlot)?.state).toBe('declared');
  await shot(sam, 'm40-e2e-friends-8-declared');
  await closeRoom(sam);
  adaErrs.check();
  samErrs.check();
});
