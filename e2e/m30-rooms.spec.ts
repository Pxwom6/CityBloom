import { test, expect, type Browser, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext, openGame, shot } from './helpers';

closeContextsAfterEach();

/**
 * M30, rooms online and peer-to-peer, through real pages: a host shares a city from the pause
 * menu, a friend opens the invite link and lands in the same city; they build and run in step; a
 * third player joins halfway; a dropped connection comes back; a game knocked out of step is caught
 * and resynced. Online rooms go through the local relay (`npm run relay`, started by the config);
 * peer-to-peer goes over WebRTC between the pages, signalled through it.
 */
test.describe.configure({ mode: 'serial' });

const QUERY = '&seed=rooms&preset=river&name=Roomsby';

async function newPage(browser: Browser, name: string, color: number): Promise<Page> {
  const ctx = await newContext(browser, { viewport: { width: 960, height: 640 } });
  ctx.on('console', (m) => {
    if (m.type() === 'error' || m.text().startsWith('[p2p')) console.log(`[${name}] ${m.text()}`);
  });
  await ctx.addInitScript(
    ([n, c]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      // Three 3D pages on a software renderer: keep each one light.
      localStorage.setItem(key, JSON.stringify({ ...s, tips: false, graphicsChecked: true, quality: 'low' }));
    },
    [name, color] as const,
  );
  return ctx.newPage();
}

const net = (page: Page) => page.evaluate(() => window.__game!.getNet());

async function buildTown(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    await g.dispatch({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 420, z: c.z }] });
    for (const x of [140, 280])
      await g.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: c.x + x, z: c.z - 150 },
          { x: c.x + x, z: c.z + 150 },
        ],
      });
  });
}

async function zone(page: Page, zone: 'R' | 'C' | 'I', dz: number) {
  return page.evaluate(
    async ([z, d]) => {
      const g = window.__game!;
      const s = await g.getState();
      return g.dispatch({
        type: 'zone',
        zone: z,
        area: {
          kind: 'brush',
          points: [
            { x: 44, z: s.highwayZ + d },
            { x: 430, z: s.highwayZ + d },
          ],
          radius: 30,
        },
      });
    },
    [zone, dz] as const,
  );
}

/** Pause from `host`'s top bar and wait until every page has run to the same tick; returns hashes. */
async function settle(host: Page, pages: Page[]): Promise<string[]> {
  await host.getByTestId('speed-0').click();
  await expect.poll(async () => (await net(host))!.speed).toBe(0);
  await expect
    .poll(
      async () => {
        const all = await Promise.all(pages.map(net));
        const allow = all[0]!.allowed;
        return all.every((n) => n!.tick === allow && n!.allowed === allow && n!.state === 'playing');
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return Promise.all(pages.map((p) => p.evaluate(() => window.__game!.hash())));
}

for (const kind of ['online', 'p2p'] as const) {
  test(`${kind}: two players build one city together, a third joins, a drop comes back, a desync is resynced`, async ({
    browser,
  }) => {
    test.setTimeout(420_000);
    const ada = await newPage(browser, 'Ada', 0);
    await openGame(ada, QUERY);
    await buildTown(ada);
    // Share the city from the pause menu.
    await ada.keyboard.press('Escape');
    await ada.getByTestId(kind === 'online' ? 'pause-invite' : 'pause-invite-p2p').click();
    await expect.poll(async () => (await net(ada))?.state, { timeout: 30_000 }).toBe('playing');
    const room = (await net(ada))!;
    expect(room.kind).toBe(kind);
    expect(room.code).toMatch(kind === 'online' ? /^[2-9][A-Z2-9]{5}$/ : /^[A-Z][A-Z2-9]{5}$/);
    // A room in Ada's browser is found by its code and its key (F2); an online one by its code.
    expect(room.invite).toMatch(
      kind === 'online' ? /^[2-9][A-Z2-9]{5}$/ : /^[A-Z][A-Z2-9]{5}(-[A-Z2-9]{4}){3}$/,
    );
    await expect(ada.getByTestId('room-panel')).toBeVisible();
    const link = await ada.getByTestId('room-link').inputValue();
    expect(link).toContain(`?join=${room.invite}`);

    // Sam opens the invite link and lands in the same city.
    const sam = await newPage(browser, 'Sam', 1);
    await sam.goto(`./?join=${room.invite}`);
    await sam.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
    await expect.poll(async () => (await net(sam))?.state, { timeout: 60_000 }).toBe('playing');
    await expect(sam.getByTestId('room-chip')).toContainText(room.code);
    await expect(ada.getByTestId('room-players')).toContainText('Sam');

    // Both build, then the city runs.
    expect((await zone(ada, 'R', -90)).ok).toBe(true);
    expect((await zone(sam, 'C', 22)).ok).toBe(true);
    await ada.getByTestId('speed-3').click();
    await expect.poll(async () => (await net(sam))!.speed).toBe(3);
    await expect.poll(async () => (await net(sam))!.tick, { timeout: 60_000 }).toBeGreaterThan(400);

    // Kit joins halfway through.
    const kit = await newPage(browser, 'Kit', 2);
    await kit.goto(`./?join=${room.invite}`);
    await kit.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
    await expect.poll(async () => (await net(kit))?.state, { timeout: 180_000 }).toBe('playing');
    expect((await zone(kit, 'I', 110)).ok).toBe(true);

    // Sam's connection drops: the game says so and comes back by itself.
    await sam.evaluate(() => window.__game!.netDrop());
    await expect(sam.getByTestId('room-chip')).toContainText('Reconnecting', { timeout: 5000 });
    await expect.poll(async () => (await net(sam))?.state, { timeout: 30_000 }).toBe('playing');

    let hashes = await settle(ada, [ada, sam, kit]);
    expect(new Set(hashes).size).toBe(1);
    for (const p of [ada, sam]) await p.evaluate(() => window.__game!.setCamera('city'));
    if (!(await ada.getByTestId('room-panel').isVisible())) await ada.getByTestId('room-chip').click();
    await expect(ada.getByTestId('room-players')).toContainText('Kit');
    await shot(ada, `m30-${kind}-host`);
    await shot(sam, `m30-${kind}-guest`);

    // Kit's game is knocked out of step: the room catches it at the next hourly check.
    await kit.evaluate(() => window.__game!.netPerturb());
    await ada.getByTestId('speed-3').click();
    await expect(ada.locator('.toast', { hasText: "Kit's game fell out of step; catching up" })).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(async () => (await net(kit))?.state, { timeout: 180_000 }).toBe('playing');
    await expect
      .poll(async () => (await net(kit))!.tick, { timeout: 60_000 })
      .toBeGreaterThan((await net(ada))!.tick - 200);
    hashes = await settle(ada, [ada, sam, kit]);
    expect(new Set(hashes).size).toBe(1);
    const n = (await net(sam))!;
    console.log(
      `[m30] ${kind}: tick ${n.tick}, Sam sent ${n.sent.messages} messages (${n.sent.bytes} bytes)`,
    );
    for (const p of [ada, sam, kit]) await p.context().close();
  });
}
