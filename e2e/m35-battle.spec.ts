import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, shot, watchErrors } from './helpers';
import { frames, settings, state } from './ui';

/**
 * M35 Into battle through the real UI. A city with rival neighbours, a military HQ, barracks and a
 * depot, and a few units: it sends a force from the war room to raid a neighbour, the battle is
 * fought in the neighbour's town (grown by the balance mayor), watched there, and the town repairs
 * what was broken; back home, a neighbour's raid comes with a countdown and the siren, is fought in
 * the city, reported in the war room, and repaired.
 */

/** A serviced town (as e2e/m34-forces.spec.ts) with an HQ, barracks and depot, and trained units. */
async function warTown(page: Page): Promise<void> {
  await buildTownViaApi(page);
  const hz = (await state(page)).highwayZ;
  await page.evaluate(
    async ([hz]) => {
      const g = window.__game!;
      const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
        const r = await g.dispatch(cmd);
        if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
        return r;
      };
      await ok({ type: 'cheat', cheat: 'unlockAll' });
      await ok({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
      const at = (dx: number, dz: number) => ({ x: 24 + dx, z: hz! + dz });
      let util = 0;
      for (const dz of [230, 250, 270, 210, 290]) {
        const pts = [at(30, dz), at(470, dz)];
        if ((await g.preview({ type: 'buildRoad', road: 'street', points: pts })).ok) {
          await ok({ type: 'buildRoad', road: 'street', points: pts });
          util = dz;
          break;
        }
      }
      for (const x of [96, 192, 288, 384])
        await ok({ type: 'buildRoad', road: 'street', points: [at(x, 160), at(x, util)] });
      for (const def of ['coal', 'coal', 'pump', 'pump', 'treatment', 'landfill', 'pump'])
        if ((await g.placeCivic(def, at(240, util))) === null) throw new Error(`no room for ${def}`);
      for (const def of ['firestation', 'police', 'clinic', 'primary'])
        if ((await g.placeCivic(def, at(240, 0))) === null) throw new Error(`no room for ${def}`);
      await g.advance(1440 * 3);
      const place = async (def: string, near: { x: number; z: number }) => {
        const id = await g.placeCivic(def, near);
        if (id === null) throw new Error(`no room for ${def}`);
        return id;
      };
      await place('militaryhq', at(300, -160));
      const barracks = await place('barracks', at(380, -160));
      const depot = await place('vehicledepot', at(200, 160));
      await place('bunker', at(100, -160));
      await place('shelter', at(200, -160));
      for (let k = 0; k < 4; k++) await ok({ type: 'trainUnit', base: barracks, kind: 'infantry' });
      for (const kind of ['tank', 'transport', 'tank'] as const)
        await ok({ type: 'trainUnit', base: depot, kind });
      for (let m = 0; m < 10; m++) {
        await g.advance(1440);
        const f = g.getForces();
        if (f && f.units.length >= 7 && !f.orders.length) break;
      }
    },
    [hz],
  );
  expect((await page.evaluate(() => window.__game!.getForces()))!.units.length).toBeGreaterThanOrEqual(7);
}

test('M35: a force sent from the war room raids a neighbour, is watched there, and the town repairs', async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await warTown(page);
  // The neighbour to raid: weakened for the test, so the battle's damage is there to see.
  const rival = await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const n = s.region.neighbours.find((x) => x.rival)!;
    const r = await g.dispatch({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 3, defences: 0 });
    if (!r.ok) throw new Error(r.reason);
    return { id: n.id, name: n.name };
  });

  // --- The war room's Send tab. ---
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-send').click();
  await page.getByTestId('send-to').selectOption(String(rival.id));
  await page.getByTestId('send-infantry').fill('4');
  await page.getByTestId('send-tank').fill('2');
  await page.getByTestId('send-transport').fill('1');
  await shot(page, 'm35-send');
  await page.getByTestId('send-force').click();
  await expect(page.getByTestId('war-expeditions')).toContainText(`on the way to ${rival.name}`);
  // On the map, the force is a token on its way.
  await page.getByTestId('war-tab-map').click();
  await expect(page.locator('[data-testid^="token-"]')).toHaveCount(1);
  await shot(page, 'm35-map');

  // --- It arrives; the page grows the neighbour's town and fights there; the report comes back. ---
  await page.evaluate(() => window.__game!.advance(60 * 10));
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getBattle())).reports.length, {
      timeout: 600_000,
      intervals: [2_000],
    })
    .toBeGreaterThan(0);
  const report = (await page.evaluate(() => window.__game!.getBattle())).reports.at(-1)!;
  await page.getByTestId('war-tab-reports').click();
  await expect(page.getByTestId(`report-${report.id}`)).toContainText(rival.name);
  await shot(page, 'm35-report');

  // --- Watch it in the neighbour's town. ---
  await page.getByTestId(`watch-${report.id}`).click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getAway().viewing !== null, null, {
    timeout: 300_000,
  });
  await expect(page.getByTestId('viewer-bar')).toBeVisible();
  await expect(page.getByTestId('battle-bar')).toBeVisible({ timeout: 60_000 });
  await page.evaluate(() => window.__game!.setSpeed(0));
  await page.evaluate(() => window.__game!.advance(120));
  await page.evaluate(() => window.__game!.followBattle());
  await frames(page, 4);
  await shot(page, 'm35-watch');
  // To the battle's end: something in the town is broken.
  for (let k = 0; k < 60; k++) {
    const b = await page.evaluate(async () => {
      await window.__game!.advance(60);
      return window.__game!.getBattle();
    });
    if (!b.frame) break;
  }
  const broken = await page.evaluate(() => window.__game!.getDamage());
  expect(
    broken.civics + broken.rubble + broken.burning + broken.roads,
    JSON.stringify(broken),
  ).toBeGreaterThan(0);
  // Five game months on, the town has repaired its buildings and roads.
  await page.evaluate(() => window.__game!.advance(1440 * 5));
  const after = await page.evaluate(() => window.__game!.getDamage());
  expect(after.civics, JSON.stringify(after)).toBe(0);
  expect(after.roads).toBe(0);
  await frames(page, 3);
  await shot(page, 'm35-repaired');
  errs.check();
});

test('M35: a neighbour’s raid comes with a countdown and the siren, is fought in the city and repaired', async ({
  page,
}) => {
  test.setTimeout(1_800_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await warTown(page);
  // A click for the sound to start, then a raid four hours off.
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-reports').click();
  await expect(page.getByTestId('war-reports-none')).toBeVisible();
  await page.keyboard.press('Shift+KeyM');
  await page.evaluate(async () => {
    const g = window.__game!;
    const r = await g.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 4 });
    if (!r.ok) throw new Error(r.reason);
    // Past the warning: an hour before it arrives without a radar.
    await g.advance(60 * 3 + 20);
  });
  await expect(page.getByTestId('raid-chip')).toBeVisible();
  await expect(page.getByTestId('raid-eta')).toHaveText(/0:[0-5]\d/);
  await expect.poll(() => page.evaluate(() => window.__game!.getAudio().played.raid ?? 0)).toBeGreaterThan(0);
  await shot(page, 'm35-countdown');
  // The raid arrives and is fought here.
  await page.evaluate(() => window.__game!.advance(60));
  await expect(page.getByTestId('battle-bar')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('raid-chip')).toContainText('Battle');
  await page.evaluate(() => window.__game!.advance(60));
  await page.getByTestId('battle-follow').click();
  await frames(page, 4);
  await shot(page, 'm35-raid');
  for (let k = 0; k < 60; k++) {
    const b = await page.evaluate(async () => {
      await window.__game!.advance(60);
      return window.__game!.getBattle();
    });
    if (!b.frame) break;
  }
  await expect(page.getByTestId('battle-bar')).toHaveCount(0);
  // The report, in the war room.
  const report = (await page.evaluate(() => window.__game!.getBattle())).reports.at(-1)!;
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-reports').click();
  await expect(page.getByTestId(`report-${report.id}`)).toBeVisible();
  await page.keyboard.press('Shift+KeyM');
  // Repaired five game months on.
  await page.evaluate(() => window.__game!.advance(1440 * 5));
  const after = await page.evaluate(() => window.__game!.getDamage());
  expect(after.civics, JSON.stringify(after)).toBe(0);
  expect(after.roads).toBe(0);
  errs.check();
});
