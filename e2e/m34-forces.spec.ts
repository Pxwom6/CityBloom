import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, skipGraphicsCheck, watchErrors } from './helpers';
import { frames, placeFromToolbar, screen, state } from './ui';

/**
 * M34 Armed forces through the real UI: a peaceful city shows none of it; the new-city screen founds a
 * city with rival neighbours; that city builds every military building from the toolbar, trains every
 * kind of unit from the bases' inspectors, sees the upkeep in the budget and the inspector, and opens
 * the war room three ways.
 */

const civics = (page: Page, def: string) =>
  page.evaluate((def) => window.__game!.getCivics().filter((c) => c.def === def), def);

/** Look at a civic building from above, and click it to open its inspector. */
async function inspect(page: Page, def: string): Promise<void> {
  const c = (await civics(page, def))[0]!;
  await page.evaluate(
    (p) => window.__game!.setCamera({ x: p.x, z: p.z, yaw: 0.6, distance: 230, tilt: 0.55 }),
    c,
  );
  await frames(page, 3);
  const p = await screen(page, c.x, c.z);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('military')).toBeVisible({ timeout: 20_000 });
}

/** Spots north of the town's avenue, then along it, for buildings of a size. */
function spots(cx: number, hz: number, dz: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const z of dz) for (let x = cx + 60; x <= cx + 460; x += 40) out.push([x, hz + z]);
  return out;
}

test('M34: a peaceful city shows no military, war room or defence funding', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = watchErrors(page);
  await openGame(page);
  const s = await state(page);
  expect(s.war).toBeNull();
  expect('rivals' in s.options).toBe(false);
  await expect(page.getByTestId('tool-military')).toHaveCount(0);
  await expect(page.getByTestId('open-war')).toHaveCount(0);
  await page.keyboard.press('KeyM');
  await page.getByTestId('budget-tab-funding').click();
  await expect(page.getByTestId('funding-fire')).toBeVisible();
  await expect(page.getByTestId('funding-defence')).toHaveCount(0);
  errs.check();
});

test('M34: the new-city screen founds a city with rival neighbours', async ({ page }) => {
  test.setTimeout(400_000);
  const errs = watchErrors(page);
  await skipGraphicsCheck(page);
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.getShell().mode === 'menu', null, { timeout: 120_000 });
  await page.getByTestId('main-new').click();
  const rivals = page.getByTestId('new-rivals');
  await expect(rivals).not.toBeChecked();
  await rivals.check();
  await page.getByTestId('new-tutorial').uncheck();
  await shot(page, 'm34-new-city');
  await page.getByTestId('new-start').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  const s = await state(page);
  expect(s.options.rivals).toBe(true);
  expect(s.war).not.toBeNull();
  await expect(page.getByTestId('tool-military')).toBeVisible();
  // Its neighbours are rivals, each with a character, in the Region panel.
  await page.keyboard.press('Shift+KeyN');
  await expect(page.locator('[data-testid$="-rival"]').first()).toBeVisible();
  errs.check();
});

test('M34: every military building from the toolbar, every kind of unit trained, upkeep and the war room', async ({
  page,
}) => {
  test.setTimeout(1_500_000);
  const errs = watchErrors(page);
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  const hz = (await state(page)).highwayZ;
  const cx = 24;
  // Money for everything, and roads out to the sea for the naval yard and the coastal gun.
  await page.evaluate(
    async ([hz]) => {
      const g = window.__game!;
      await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
      const roads: { road: 'avenue' | 'street'; points: { x: number; z: number }[] }[] = [
        {
          road: 'avenue',
          points: [
            { x: 504, z: hz! },
            { x: 1430, z: hz! },
          ],
        },
        {
          road: 'street',
          points: [
            { x: 1430, z: hz! - 560 },
            { x: 1430, z: hz! },
          ],
        },
      ];
      for (const r of roads) {
        const res = await g.dispatch({ type: 'buildRoad', ...r });
        if (!res.ok) throw new Error(res.reason);
      }
      // A few hours for the town to fill its homes before the forces recruit.
      await g.advance(60 * 20);
    },
    [hz],
  );
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 300, z: hz - 80, yaw: 0, distance: 900, tilt: 0.85 }),
    hz,
  );
  await frames(page);
  await expect(page.getByTestId('tool-military')).toBeVisible();

  // --- The HQ first: the others need it. ---
  await placeFromToolbar(page, 'military', 'militaryhq', spots(cx, hz, [-130, -60]));
  for (const def of ['barracks', 'shelter', 'bunker', 'vehicledepot', 'radar', 'antiair', 'armsfactory'])
    await placeFromToolbar(page, 'military', def, spots(cx, hz, [-130, -60, 70]));
  // The big sites out along the avenue to the sea.
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 950, z: hz, yaw: 0, distance: 1100, tilt: 0.85 }),
    hz,
  );
  await frames(page);
  const along = (dz: number[]): [number, number][] =>
    dz.flatMap((z) => [640, 760, 880, 1000, 1120, 1240].map((x) => [x, hz + z] as [number, number]));
  await placeFromToolbar(page, 'military', 'provingground', along([-40, 40]));
  await placeFromToolbar(page, 'military', 'airfield', along([-55, 55]));
  // By the sea: the naval yard where deep water comes close, the coastal gun where the shore does.
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 1450, z: hz - 300, yaw: 0, distance: 800, tilt: 0.85 }),
    hz,
  );
  await frames(page);
  const shore = (x: number, z0: number, z1: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let z = z0; z <= z1; z += 10) out.push([x, hz + z]);
    return out;
  };
  await placeFromToolbar(page, 'military', 'navalyard', shore(1467, -380, -240));
  await placeFromToolbar(page, 'military', 'coastalgun', shore(1443, -550, -440));
  for (const def of [
    'militaryhq',
    'barracks',
    'shelter',
    'bunker',
    'vehicledepot',
    'radar',
    'antiair',
    'armsfactory',
    'provingground',
    'airfield',
    'navalyard',
    'coastalgun',
  ])
    expect(await civics(page, def), def).toHaveLength(1);

  // Staff and power come at the next matching round and utilities pass.
  await page.evaluate(() => window.__game!.advance(60 * 4));

  // --- Train every kind of unit from the bases' inspectors. ---
  const train: [string, string[]][] = [
    ['barracks', ['infantry']],
    ['vehicledepot', ['tank', 'artillery', 'transport']],
    ['airfield', ['fighter', 'helicopter', 'drone']],
    ['navalyard', ['patrolboat']],
  ];
  for (const [base, kinds] of train) {
    await inspect(page, base);
    await expect(page.getByTestId('military-staff')).toBeVisible();
    for (const k of kinds) {
      await page.getByTestId(`train-${k}`).click();
      await expect
        .poll(async () =>
          (await page.evaluate(() => window.__game!.getForces()))!.orders.some((o) => o.kind === k),
        )
        .toBe(true);
    }
    if (base === 'vehicledepot') await shot(page, 'm34-inspector-depot');
    await page.keyboard.press('Escape');
  }
  // Training takes up to three months for the fighter and the patrol boat at full staff and power.
  await page.evaluate(() => window.__game!.advance(1440 * 5));
  const forces = (await page.evaluate(() => window.__game!.getForces()))!;
  const kinds = new Set(forces.units.map((u) => u.kind));
  for (const k of [
    'infantry',
    'tank',
    'artillery',
    'transport',
    'fighter',
    'helicopter',
    'drone',
    'patrolboat',
  ])
    expect(kinds, `${k} trained`).toContain(k);

  // --- Upkeep in the inspector and the budget. ---
  await inspect(page, 'barracks');
  await expect(page.getByTestId('military-unit-list')).toContainText('Infantry squad');
  await expect(page.getByTestId('inspector')).toContainText('/month');
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyM');
  await expect(page.getByTestId('budget')).toContainText('Forces upkeep');
  await expect(page.getByTestId('budget')).toContainText('Defence upkeep');
  await page.getByTestId('budget-tab-funding').click();
  await expect(page.getByTestId('funding-defence')).toBeVisible();
  await page.keyboard.press('KeyM');

  // --- The war room: from the HQ's inspector, Shift+M, and the top bar. ---
  await inspect(page, 'militaryhq');
  await page.getByTestId('open-war-room').click();
  const room = page.getByTestId('war-room');
  await expect(room).toBeVisible();
  await expect(page.getByTestId('war-strength')).toContainText('units');
  await expect(page.getByTestId('war-group-tanks')).toContainText('1');
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 300, z: hz - 60, yaw: 0.4, distance: 520, tilt: 0.6 }),
    hz,
  );
  await shot(page, 'm34-war-room-forces');
  for (const tab of ['economy', 'readiness', 'research']) {
    await page.getByTestId(`war-tab-${tab}`).click();
    await expect(page.getByTestId(`war-${tab}`)).toBeVisible();
  }
  await page.getByTestId('war-tab-economy').click();
  await expect(page.getByTestId('war-upkeep-forces')).toContainText('/month');
  await page.getByTestId('issue-bond-40000').click();
  await expect(page.locator('[data-testid^="repay-bond-"]')).toHaveCount(1);
  await shot(page, 'm34-war-room-upkeep');
  await page.getByTestId('war-tab-readiness').click();
  await expect(page.getByTestId('war-readiness')).not.toHaveText('0 %');
  await page.keyboard.press('Shift+KeyM');
  await expect(room).toHaveCount(0);
  await page.keyboard.press('Shift+KeyM');
  await expect(room).toBeVisible();
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('open-war').click();
  await expect(room).toBeVisible();
  errs.check();
});
