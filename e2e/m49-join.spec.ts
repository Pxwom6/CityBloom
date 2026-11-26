import { test, expect, type Browser, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext, openGame, shot } from './helpers';
import { phone } from './phone';

closeContextsAfterEach();

/**
 * M49: a phone, its CPU slowed four times, joins a busy shared city through the local relay and
 * catches up: the room holds the city for it while it does (the host is told who it's waiting for),
 * then the two play in step. Before M49 a page this slow fell behind for good.
 */
const net = (page: Page) => page.evaluate(() => window.__game!.getNet());

async function hostPage(browser: Browser): Promise<Page> {
  const ctx = await newContext(browser, { viewport: { width: 960, height: 640 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Ada', color: 0 }));
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({
        tips: false,
        graphicsChecked: true,
        quality: 'low',
        shadows: false,
        reportsNotice: true,
      }),
    );
  });
  return ctx.newPage();
}

async function phonePage(browser: Browser): Promise<Page> {
  const ctx = await newContext(browser, phone('iPhone 13', 'portrait'));
  await ctx.addInitScript(() => {
    localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Pip', color: 3 }));
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({
        tips: false,
        graphicsChecked: true,
        quality: 'phone',
        shadows: false,
        drawDistance: 'near',
        fpsCap: 30,
        roomIntro: true,
        reportsNotice: true,
      }),
    );
  });
  const page = await ctx.newPage();
  // A phone's slower CPU: everything on its page, the 3D view and the joining included.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return page;
}

test('M49: a throttled phone joins a busy shared city, is waited for, and catches up', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const ada = await hostPage(browser);
  await openGame(ada, '&seed=joiner&preset=river&name=Busyford');
  // A town that keeps the sim busy: roads, homes, shops and services.
  await ada.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
      const r = await g.dispatch(cmd);
      if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
    };
    await ok({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
    await ok({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 460, z: c.z }] });
    for (const x of [120, 240, 360])
      await ok({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: c.x + x, z: c.z - 160 },
          { x: c.x + x, z: c.z + 160 },
        ],
      });
    for (const [zone, dz, r] of [
      ['R', -90, 60],
      ['C', 24, 20],
      ['R', 100, 50],
    ] as const)
      await ok({
        type: 'zone',
        zone,
        area: {
          kind: 'brush',
          points: [
            { x: c.x + 20, z: c.z + dz },
            { x: c.x + 440, z: c.z + dz },
          ],
          radius: r,
        },
      });
  });
  await ada.getByTestId('menu-button').click();
  await ada.getByTestId('pause-invite').click();
  await expect.poll(async () => (await net(ada))?.state, { timeout: 30_000 }).toBe('playing');
  const invite = (await net(ada))!.invite;
  // The city runs at full speed for a while before the phone comes.
  await ada.getByTestId('speed-3').click();
  await expect.poll(async () => (await net(ada))!.tick, { timeout: 120_000 }).toBeGreaterThan(1500);

  const pip = await phonePage(browser);
  const t0 = Date.now();
  await pip.goto(`./?join=${invite}`);
  await pip.waitForFunction(() => window.__game?.ready === true, null, { timeout: 180_000 });
  // While the phone catches up, the room holds the city, and the host says who it's waiting for.
  const sawHold = await expect
    .poll(
      async () => {
        const n = (await net(ada))!;
        return n.players.some((p) => p.name === 'Pip' && p.joining);
      },
      { timeout: 60_000 },
    )
    .toBe(true)
    .then(() => true);
  expect(sawHold).toBe(true);
  // In step: the room no longer counts it as joining, and its game is within reach of the host's.
  await expect
    .poll(
      async () => {
        const [a, p] = [(await net(ada))!, await net(pip)];
        const me = a.players.find((x) => x.name === 'Pip');
        return !!p && p.state === 'playing' && !!me && !me.joining && p.tick > a.tick - 300;
      },
      { timeout: 240_000 },
    )
    .toBe(true);
  console.log(
    `[m49] the phone was in step ${((Date.now() - t0) / 1000).toFixed(0)} s after opening the link`,
  );
  await shot(pip, 'm49-join-phone');

  // Both build, the city runs on, and the two agree.
  const zone = (page: Page, z: 'R' | 'C' | 'I', dz: number) =>
    page.evaluate(
      async ([z, dz]) => {
        const g = window.__game!;
        const s = await g.getState();
        return g.dispatch({
          type: 'zone',
          zone: z,
          area: {
            kind: 'brush',
            points: [
              { x: 44, z: s.highwayZ + dz },
              { x: 430, z: s.highwayZ + dz },
            ],
            radius: 20,
          },
        });
      },
      [z, dz] as const,
    );
  expect((await zone(pip, 'I', 150)).ok).toBe(true);
  const at = (await net(ada))!.tick;
  await expect.poll(async () => (await net(pip))!.tick, { timeout: 120_000 }).toBeGreaterThan(at + 600);
  await ada.getByTestId('speed-0').click();
  await expect
    .poll(
      async () => {
        const all = [(await net(ada))!, (await net(pip))!];
        const allow = all[0]!.allowed;
        return all.every((n) => n.tick === allow && n.allowed === allow && n.state === 'playing');
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  const [ha, hp] = await Promise.all([ada, pip].map((p) => p.evaluate(() => window.__game!.hash())));
  expect(hp).toBe(ha);
});
