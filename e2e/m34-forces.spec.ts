import { expect, test, type Page } from '@playwright/test';
import { buildTownViaApi, openGame, serveTownViaApi, shot, skipGraphicsCheck, watchErrors } from './helpers';
import { frames, placeFromToolbar, screen, settings, state } from './ui';

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
  test.setTimeout(900_000);
  const errs = watchErrors(page);
  await skipGraphicsCheck(page);
  await settings(page, { quality: 'low' });
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
    timeout: 600_000,
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
  test.setTimeout(1_800_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await buildTownViaApi(page);
  await serveTownViaApi(page);
  const hz = (await state(page)).highwayZ;
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
      // A second coal plant: the bases draw nearly 600 power between them.
      if ((await g.placeCivic('coal', { x: 300, z: hz! + 170 })) === null) throw new Error('no room for coal');
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

  // --- Everything along the avenue out to the sea, where the ground is open: the HQ first (the
  // others need it), each building on its own stretch, north of the road (the toolbar covers the
  // south of the screen). ---
  const look = (x: number) =>
    page.evaluate(
      ([x, hz]) => window.__game!.setCamera({ x: x!, z: hz! + 40, yaw: 0, distance: 420, tilt: 0.75 }),
      [x, hz],
    );
  const stretch = (x0: number, dz: number): [number, number][] =>
    [0, 20, 40, 60, 80].map((dx) => [x0 + dx, hz + dz] as [number, number]);
  const plan: [string, number, number][] = [
    ['militaryhq', 560, -40],
    ['barracks', 650, -36],
    ['shelter', 730, -18],
    ['bunker', 780, -18],
    ['vehicledepot', 840, -40],
    ['radar', 930, -22],
    ['antiair', 980, -18],
    ['armsfactory', 1040, -40],
    ['provingground', 1130, -44],
  ];
  for (const [def, x, dz] of plan) {
    await look(x + 40);
    await frames(page);
    await placeFromToolbar(page, 'military', def, stretch(x, dz));
  }
  // The airfield's long site along the road, south of it, with the camera moved to keep it clear of
  // the toolbar.
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 820, z: hz + 120, yaw: 0, distance: 600, tilt: 0.85 }),
    hz,
  );
  await frames(page);
  await placeFromToolbar(page, 'military', 'airfield', stretch(700, 50).concat(stretch(900, 50)));
  // By the sea: the naval yard where deep water comes close, the coastal gun where the shore does.
  const shore = (x: number, z0: number, z1: number): [number, number][] => {
    const out: [number, number][] = [];
    for (let z = z0; z <= z1; z += 20) out.push([x, hz + z]);
    return out;
  };
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 1450, z: hz - 290, yaw: 0, distance: 420, tilt: 0.8 }),
    hz,
  );
  await frames(page);
  await placeFromToolbar(page, 'military', 'navalyard', shore(1467, -360, -260));
  await page.evaluate(
    (hz) => window.__game!.setCamera({ x: 1445, z: hz - 500, yaw: 0, distance: 320, tilt: 0.8 }),
    hz,
  );
  await frames(page);
  await placeFromToolbar(page, 'military', 'coastalgun', shore(1443, -550, -470));
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
  // A base trains its orders in turn: the airfield's fighter, helicopter and drone take five and a
  // half months at full staff, and the bases fill their posts as the town grows (scripts/dev/forces.ts).
  await page.evaluate(() => window.__game!.advance(1440 * 8));
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
