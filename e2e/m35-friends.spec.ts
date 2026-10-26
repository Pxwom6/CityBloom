import { test, expect, type Browser, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext, openGame, shot, watchErrors } from './helpers';
import { frames } from './ui';
import { armTown, servedTown } from './war';

closeContextsAfterEach();

/**
 * M35, war between friends through the interface: Ada starts a region and turns war on, Sam brings
 * Samford in; both arm. Sam quits to the menu (Samford's last save goes to the region). Ada sends a
 * force against Samford from the war room; it's fought in the region's save of Samford and reported.
 * When Sam opens Samford again it rejoins the region, takes the battle at once, and the war room has
 * a report that matches the damage, and a replay that plays the battle out in Samford.
 */
async function player(browser: Browser, name: string, color: number): Promise<Page> {
  // Two SwiftShader pages: Low graphics and smaller windows.
  const ctx = await newContext(browser, { viewport: { width: 1200, height: 760 } });
  await ctx.addInitScript(
    ([n, c]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...s, graphicsChecked: true, tips: false, quality: 'low' }));
    },
    [name, color] as const,
  );
  return ctx.newPage();
}

const region = (page: Page) => page.evaluate(() => window.__game!.getRegion());
const reports = async (page: Page) => (await page.evaluate(() => window.__game!.getBattle())).reports;

test('M35: a friend’s raid while the player is away waits for them, with a matching report and the replay', async ({
  browser,
}) => {
  test.setTimeout(3_600_000);
  const ada = await player(browser, 'Ada', 0);
  const adaErrs = watchErrors(ada);
  await openGame(ada, '&seed=regionada&preset=river&name=Adaville');
  await servedTown(ada);
  const sam = await player(browser, 'Sam', 1);
  // What Sam's page said, to print if the menu doesn't come (once it never did, in a loaded VM).
  const samLog: string[] = [];
  sam.on('console', (m) => samLog.push(`${m.type()}: ${m.text()}`));
  sam.on('pageerror', (e) => samLog.push(`pageerror: ${e.message}`));
  await openGame(sam, '&seed=regionsam&preset=lakes&name=Samford');
  await servedTown(sam);

  // Ada starts a region and turns war on; Sam brings Samford in with the code.
  await ada.keyboard.press('Shift+N');
  await ada.getByTestId('region-start').click();
  await expect.poll(async () => (await region(ada))?.state, { timeout: 120_000 }).toBe('in');
  await ada.getByTestId('region-war-on').check();
  await expect.poll(async () => (await region(ada))?.rules.war, { timeout: 15_000 }).toBe(true);
  const code = (await region(ada))!.code;
  await sam.keyboard.press('Shift+N');
  await sam.getByTestId('region-code').fill(code);
  await sam.getByTestId('region-join').click();
  await expect.poll(async () => (await region(sam))?.state, { timeout: 120_000 }).toBe('in');
  await expect.poll(async () => (await region(sam))?.rules.war, { timeout: 60_000 }).toBe(true);
  await expect(sam.getByTestId('region-war-rules')).toContainText('War is on', { timeout: 60_000 });
  await ada.keyboard.press('Shift+N');
  await sam.keyboard.press('Shift+N');

  // Both arm: Ada a raiding force, Sam an HQ and a bunker.
  await armTown(ada, ['militaryhq', 'barracks', 'vehicledepot'], {
    infantry: 4,
    vehicles: ['tank', 'transport', 'tank'],
  });
  await armTown(sam, ['militaryhq', 'bunker']);
  const before = await sam.evaluate(() => window.__game!.getDamage());
  expect((await reports(sam)).length).toBe(0);

  // Sam quits to the menu: Samford's last save goes to the region, and Sam is away.
  await ada.evaluate(() => window.__game!.setSpeed(0));
  await sam.getByTestId('menu-button').click();
  await sam.getByTestId('pause-quit').click();
  // The menu grows its backdrop town first: slow on SwiftShader beside another 3D page.
  try {
    await expect(sam.getByTestId('main-menu')).toBeVisible({ timeout: 300_000 });
    await expect(sam.getByTestId('main-continue')).toBeVisible({ timeout: 60_000 });
  } catch (err) {
    await sam.screenshot({ path: 'test-results/m35-friends-sam-menu.png' }).catch(() => undefined);
    console.log(`Sam's page at ${sam.url()}:\n${samLog.slice(-40).join('\n')}`);
    throw err;
  }
  await expect
    .poll(async () => (await region(ada))?.cities.find((c) => c.name === 'Samford')?.online, {
      timeout: 30_000,
    })
    .toBe(false);

  // Ada sends a force against Samford from the war room.
  await ada.evaluate(() => window.__game!.regionReportNow());
  const target = await ada.evaluate(async () => {
    const s = await window.__game!.getState();
    const n = s.region.neighbours.find((x) => x.name === 'Samford' && x.player)!;
    return { id: n.id, name: n.name };
  });
  await ada.keyboard.press('Shift+KeyM');
  await ada.getByTestId('war-tab-send').click();
  await ada.getByTestId('send-to').selectOption(String(target.id));
  await ada.getByTestId('send-infantry').fill('4');
  await ada.getByTestId('send-tank').fill('2');
  await ada.getByTestId('send-transport').fill('1');
  await ada.getByTestId('send-force').click();
  await expect(ada.getByTestId('war-expeditions')).toContainText('on the way to Samford');
  await ada.getByTestId('war-tab-map').click();
  await shot(ada, 'm35-friends-map');

  // It arrives: Ada's page fights in the region's save of Samford, reports, and passes it on.
  await ada.evaluate(() => window.__game!.advance(60 * 12));
  await expect
    .poll(async () => (await reports(ada)).length, { timeout: 300_000, intervals: [2_000] })
    .toBe(1);
  const sent = (await reports(ada))[0]!;
  expect(sent.other).toBe('Samford');
  // Samford's HQ and bunker were there to strike: the region's save was the city as Sam left it.
  expect(sent.aimed ?? 0).toBeGreaterThan(0);
  await ada.getByTestId('war-tab-reports').click();
  await expect(ada.getByTestId(`report-${sent.id}`)).toContainText('Samford');
  await shot(ada, 'm35-friends-attacker');

  // Sam comes back: Samford rejoins the region and takes the battle at once.
  await sam.getByTestId('main-continue').click();
  await sam.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
    null,
    {
      timeout: 120_000,
    },
  );
  await expect.poll(async () => (await region(sam))?.state, { timeout: 120_000 }).toBe('in');
  await expect
    .poll(async () => (await reports(sam)).length, { timeout: 120_000, intervals: [1_000] })
    .toBe(1);
  const got = (await reports(sam))[0]!;
  expect(got.other).toBe('Adaville');
  expect(got.ours).toBe(false);
  expect(got.outcome).toBe(sent.outcome);
  // The report is what was broken: the city opens paused, so nothing is repaired yet.
  const after = await sam.evaluate(() => window.__game!.getDamage());
  expect(after.rubble - before.rubble).toBe(got.collapsed);
  expect(after.civics - before.civics).toBe(got.civics);
  expect(got.theirLost).toBe(sent.lost);
  await sam.keyboard.press('Shift+KeyM');
  await sam.getByTestId('war-tab-reports').click();
  await expect(sam.getByTestId(`report-${got.id}`)).toContainText('Adaville');
  await shot(sam, 'm35-friends-report');

  // The replay: the battle plays out again in Samford as it was.
  await sam.getByTestId(`watch-${got.id}`).click();
  await sam.waitForFunction(() => window.__game?.ready && window.__game.getAway().viewing !== null, null, {
    timeout: 300_000,
  });
  await expect(sam.getByTestId('viewer-bar')).toContainText("Adaville's raid on Samford");
  await expect(sam.getByTestId('battle-bar')).toBeVisible({ timeout: 60_000 });
  await expect(sam.getByTestId('visit-banner')).toHaveCount(0);
  await sam.evaluate(() => window.__game!.setSpeed(0));
  await sam.evaluate(() => window.__game!.advance(90));
  await sam.evaluate(() => window.__game!.followBattle());
  await frames(sam, 4);
  await shot(sam, 'm35-friends-replay');
  for (let k = 0; k < 60; k++) {
    const b = await sam.evaluate(async () => {
      await window.__game!.advance(60);
      return window.__game!.getBattle();
    });
    if (!b.frame) break;
  }
  const replayed = await sam.evaluate(() => window.__game!.getDamage());
  expect(replayed.rubble).toBe(after.rubble);

  // Back to Samford: still in the region, and the battle isn't taken twice.
  await sam.getByTestId('viewer-back').click();
  await sam.waitForFunction(
    () => window.__game?.ready === true && window.__game.getAway().viewing === null,
    null,
    {
      timeout: 120_000,
    },
  );
  await expect.poll(async () => (await region(sam))?.state, { timeout: 120_000 }).toBe('in');
  await sam.waitForTimeout(3_000);
  expect((await reports(sam)).length).toBe(1);
  adaErrs.check();
});
