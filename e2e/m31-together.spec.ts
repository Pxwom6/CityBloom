import { test, expect, type Browser, type Page } from '@playwright/test';
import { openGame } from './helpers';
import { placeFromToolbar } from './ui';

/**
 * M31, building together, through the real interface: Ada shares her city, Sam joins with the
 * invite link; each lays roads and zones and Sam builds a fire station; each sees the other's cursor
 * and chat; a tax change by Ada shows in Sam's budget; the inspector says who built what; a ping
 * reaches Ada. Then both leave, and the room's city opens again for Kit with everything in it.
 */
test.describe.configure({ mode: 'serial' });

async function player(browser: Browser, name: string, color: number): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  await ctx.addInitScript(
    ([n, c]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...s, tips: false, graphicsChecked: true, quality: 'low' }));
    },
    [name, color] as const,
  );
  return ctx.newPage();
}

const net = (page: Page) => page.evaluate(() => window.__game!.getNet());

async function at(page: Page, x: number, z: number) {
  const p = await page.evaluate(([x, z]) => window.__game!.worldToScreen(x!, z!), [x, z]);
  const hit = await page.evaluate(([sx, sy]) => document.elementFromPoint(sx!, sy!)?.id ?? '', [p.x, p.y]);
  expect(hit, `(${x}, ${z}) is under the interface`).toBe('scene');
  return p;
}

async function drag(page: Page, points: [number, number][]): Promise<void> {
  let p = await at(page, points[0]![0], points[0]![1]);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  for (const [x, z] of points.slice(1)) {
    p = await at(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.waitForTimeout(300);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

async function fill(page: Page, zone: string, spots: [number, number][]): Promise<void> {
  await page.getByTestId('tool-zone').click();
  await page.getByTestId(`zone-${zone}`).click();
  for (const [x, z] of spots) {
    const p = await at(page, x, z);
    await page.mouse.move(p.x, p.y, { steps: 2 });
    await page.keyboard.down('Shift');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up('Shift');
  }
  await page.getByTestId('tool-select').click();
}

test('two players grow a town together through the interface, and the room keeps it', async ({ browser }) => {
  test.setTimeout(600_000);
  const ada = await player(browser, 'Ada', 0);
  await openGame(ada, '&seed=together&preset=river&name=Twinbrook');
  const cz = (await ada.evaluate(() => window.__game!.getState())).highwayZ;
  await ada.keyboard.press('Escape');
  await ada.getByTestId('pause-invite').click();
  await expect.poll(async () => (await net(ada))?.state, { timeout: 30_000 }).toBe('playing');
  const code = (await net(ada))!.code;
  // Hold the city still while they build, from the top bar.
  await ada.getByTestId('speed-0').click();
  await expect.poll(async () => (await net(ada))!.speed).toBe(0);
  await ada.getByTestId('room-panel').getByRole('button', { name: 'Close' }).click();

  const sam = await player(browser, 'Sam', 1);
  await sam.goto(`./?join=${code}`);
  await sam.waitForFunction(() => window.__game?.ready === true && !!window.__game.getNet(), null, {
    timeout: 120_000,
  });
  await expect.poll(async () => (await net(sam))?.state, { timeout: 90_000 }).toBe('playing');
  await expect(sam.locator('.toast', { hasText: 'Ada paused the city' })).toHaveCount(0);
  for (const p of [ada, sam])
    await p.evaluate(
      (cz) => window.__game!.setCamera({ x: 270, z: cz + 60, distance: 700, yaw: 0, tilt: 0.55 }),
      cz,
    );

  // Ada lays the avenue; Sam lays two side streets.
  await ada.getByTestId('tool-road').click();
  await ada.getByTestId('road-avenue').click();
  await drag(ada, [
    [24, cz],
    [264, cz],
    [504, cz],
  ]);
  await ada.getByTestId('tool-select').click();
  await expect
    .poll(async () => (await sam.evaluate(() => window.__game!.getState())).segments, { timeout: 20_000 })
    .toBeGreaterThan(1);
  await sam.getByTestId('tool-road').click();
  await sam.getByTestId('road-street').click();
  for (const x of [168, 360])
    await drag(sam, [
      [x, cz - 150],
      [x, cz],
      [x, cz + 110],
    ]);
  // Sam's cursor shows on Ada's map, with his name.
  await expect(ada.locator('.presence-name', { hasText: 'Sam' })).toBeVisible({ timeout: 10_000 });
  await sam.getByTestId('tool-select').click();
  await expect
    .poll(async () => (await ada.evaluate(() => window.__game!.getState())).segments, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(6);

  // Zones: Ada homes, Sam shops; Sam builds a fire station.
  await fill(ada, 'R', [
    [96, cz - 80],
    [264, cz - 80],
    [432, cz - 80],
  ]);
  await fill(sam, 'C', [
    [96, cz + 30],
    [264, cz + 30],
  ]);
  await placeFromToolbar(sam, 'fire', 'firestation', [
    [440, cz + 30],
    [220, cz + 30],
    [300, cz + 30],
    [190, cz - 50],
    [390, cz - 50],
  ]);
  const fs = await sam.evaluate(() => window.__game!.getCivics().find((c) => c.def === 'firestation')!);
  // Ada sees it, and her inspector says Sam built it.
  await expect
    .poll(
      async () => (await ada.evaluate(() => window.__game!.getCivics())).some((c) => c.def === 'firestation'),
      { timeout: 20_000 },
    )
    .toBe(true);
  const p = await at(ada, fs.x, fs.z);
  await ada.mouse.click(p.x, p.y);
  await expect(ada.getByTestId('built-by')).toContainText('Built by Sam', { timeout: 10_000 });
  await ada.keyboard.press('Escape');

  // Chat: Sam says hello from the room panel; Ada sees it.
  await sam.getByTestId('room-chip').click();
  await sam.getByTestId('chat-input').fill('Shops are in, Ada!');
  await sam.getByTestId('chat-send').click();
  await expect(ada.locator('.toast', { hasText: 'Sam: Shops are in, Ada!' })).toBeVisible({
    timeout: 10_000,
  });
  // Ada changes the homes' tax in her budget; Sam's budget shows it.
  await ada.getByTestId('open-budget').click();
  await ada.getByTestId('budget-tab-taxes').click();
  await ada.getByTestId('tax-R0').fill('13');
  await ada.getByTestId('tax-R0').press('Enter');
  await sam.getByTestId('open-budget').click();
  await sam.getByTestId('budget-tab-taxes').click();
  await expect(sam.getByTestId('tax-R0')).toHaveValue('13', { timeout: 15_000 });
  await sam.getByTestId('open-budget').click();
  // Sam points Ada at the fire station.
  const q = await at(sam, fs.x, fs.z);
  await sam.mouse.move(q.x, q.y, { steps: 3 });
  await sam.keyboard.press('Shift+G');
  await expect(ada.locator('.toast', { hasText: 'Sam: look here' })).toBeVisible({ timeout: 10_000 });

  // The city runs; then everyone leaves.
  await ada.getByTestId('open-budget').click();
  await ada.getByTestId('speed-3').click();
  await expect
    .poll(async () => (await net(sam))!.tick, { timeout: 60_000 })
    .toBeGreaterThan((await net(ada))!.tick - 200);
  await sam.screenshot({ path: 'docs/screenshots/m31-sam.png' });
  await sam.mouse.move(q.x + 40, q.y - 30, { steps: 4 });
  await ada.waitForTimeout(800);
  await ada.screenshot({ path: 'docs/screenshots/m31-ada.png' });
  await ada.getByTestId('speed-0').click();
  await expect.poll(async () => (await net(ada))!.speed).toBe(0);
  await ada.waitForTimeout(1000);
  const left = await ada.evaluate(() => window.__game!.getState());
  await sam.context().close();
  await ada.context().close();

  // Later, Kit opens the room's code: the city is there with everything they built.
  const kit = await player(browser, 'Kit', 2);
  await kit.goto(`./?join=${code}`);
  await kit.waitForFunction(() => window.__game?.ready === true && !!window.__game.getNet(), null, {
    timeout: 120_000,
  });
  const back = await kit.evaluate(() => window.__game!.getState());
  expect(back.segments).toBe(left.segments);
  expect(back.cityName).toBe('Twinbrook');
  expect((await kit.evaluate(() => window.__game!.getCivics())).some((c) => c.def === 'firestation')).toBe(
    true,
  );
  await kit.context().close();
});
