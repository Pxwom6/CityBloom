import { expect, test, type Page } from '@playwright/test';
import { openGame, shot, watchErrors } from './helpers';
import { frames, screen, settings, state } from './ui';
import { servedTown } from './war';

/**
 * M37 weapon development through the real UI: the war room's Research tab queues every tier of all
 * six branches (the test pours the labs' points in), each unit a tier unlocks is a prototype tried
 * at the proving ground from the tab, and then every one of them can be trained at its base.
 */

// A button that never turns up fails in a minute, not at the test's timeout.
test.use({ actionTimeout: 60_000 });

const civics = (page: Page, def: string) =>
  page.evaluate((def) => window.__game!.getCivics().filter((c) => c.def === def), def);

/** Look at a civic building from above, and click it to open its inspector. */
async function inspect(page: Page, def: string): Promise<void> {
  const c = (await civics(page, def))[0]!;
  await page.evaluate(
    (p) => window.__game!.setCamera({ x: p.x, z: p.z, yaw: 0.6, distance: 260, tilt: 0.55 }),
    c,
  );
  await frames(page, 3);
  const p = await screen(page, c.x, c.z);
  await page.mouse.click(p.x, p.y);
  await expect(page.getByTestId('military')).toBeVisible({ timeout: 20_000 });
}

const BRANCHES = ['land', 'air', 'sea', 'defence', 'intel', 'logistics'] as const;
/** Every unit research unlocks, and the base that trains it. */
const UNLOCKED: [string, string][] = [
  ['heavytank', 'vehicledepot'],
  ['windupbot', 'vehicledepot'],
  ['repair', 'vehicledepot'],
  ['bomber', 'airfield'],
  ['skyfortress', 'airfield'],
  ['gunboat', 'navalyard'],
  ['landingcraft', 'navalyard'],
  ['submarine', 'navalyard'],
  ['clockworkwhale', 'navalyard'],
];

test('M37: research unlocks every branch’s units, each tried at the proving ground, then trained', async ({
  page,
}) => {
  test.setTimeout(2_400_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await servedTown(page);
  const hz = (await state(page)).highwayZ;
  // The military buildings by the API (M34's spec places them through the toolbar): the HQ, a lab,
  // a proving ground, a depot, an airfield, and a naval yard where the coast road meets deep water.
  await page.evaluate(
    async ([hz]) => {
      const g = window.__game!;
      const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
        const r = await g.dispatch(cmd);
        if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
      };
      await ok({ type: 'cheat', cheat: 'addMoney', amount: 8_000_000 });
      const at = (dx: number, dz: number) => ({ x: 24 + dx, z: hz! + dz });
      await ok({ type: 'buildRoad', road: 'avenue', points: [at(480, 0), { x: 1430, z: hz! }] });
      await ok({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: 1430, z: hz! - 560 },
          { x: 1430, z: hz! },
        ],
      });
      for (const [def, near] of [
        ['militaryhq', at(300, -160)],
        ['militarylab', at(640, -30)],
        ['provingground', at(760, -40)],
        ['vehicledepot', at(880, -40)],
        ['airfield', at(1000, 50)],
        ['navalyard', { x: 1467, z: hz! - 310 }],
      ] as const)
        if ((await g.placeCivic(def, near)) === null) throw new Error(`no room for ${def}`);
      // A neighbour too weak to raid: only research happens.
      const s = await g.getState();
      for (const n of s.region.neighbours.filter((x) => x.rival))
        await ok({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0.5, defences: 1 });
      await g.advance(60 * 6);
    },
    [hz],
  );

  // --- The Research tab: a lab, its rate, the six branches. ---
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-research').click();
  await expect(page.getByTestId('research-head')).toContainText('1 lab');
  for (const b of BRANCHES) await expect(page.getByTestId(`research-branch-${b}`)).toBeVisible();
  // A second tier can't come before the first.
  await expect(page.getByTestId('research-start-land2')).toBeDisabled();
  await shot(page, 'm37-research');

  // --- Every branch, a branch a time: its four tiers queued from the tab, the points poured in. ---
  for (const b of BRANCHES) {
    await page.getByTestId(`research-branch-${b}`).click();
    for (let t = 1; t <= 4; t++) await page.getByTestId(`research-start-${b}${t}`).click();
    await expect(page.getByTestId('research-queue')).toContainText('4.');
    if (b === 'land') await shot(page, 'm37-research-queue');
    await page.evaluate(async () => {
      const r = await window.__game!.dispatch({ type: 'cheat', cheat: 'researchPoints', points: 20_000 });
      if (!r.ok) throw new Error(r.reason);
    });
    for (let t = 1; t <= 4; t++)
      await expect(page.getByTestId(`research-tier-${b}${t}`)).toContainText('Done');
  }
  const research = (await page.evaluate(() => window.__game!.getResearch()))!;
  expect(research.done).toHaveLength(24);
  expect([...research.prototypes].sort()).toEqual(UNLOCKED.map(([k]) => k).sort());
  await shot(page, 'm37-research-done');

  // --- Each prototype tried at the proving ground, started from the tab. ---
  for (const [kind] of UNLOCKED) {
    await page.getByTestId(`trial-start-${kind}`).click();
    await expect(page.getByTestId(`trial-${kind}`)).toBeVisible();
    if (kind === 'heavytank') await shot(page, 'm37-trial');
    const hours = (await page.evaluate(() => window.__game!.getResearch()))!.trials[0]!.hours;
    // Run to the end (staff and power may slow it a little).
    for (let k = 0; k < 6; k++) {
      const r = (await page.evaluate(() => window.__game!.getResearch()))!;
      if (r.proven.includes(kind as never)) break;
      await page.evaluate((h) => window.__game!.advance(60 * h), Math.ceil(hours / 2) + 2);
    }
    await expect
      .poll(async () => (await page.evaluate(() => window.__game!.getResearch()))!.proven)
      .toContain(kind);
  }

  // --- Now each can be trained at its base: its Train button is open. ---
  await page.keyboard.press('Escape');
  for (const base of ['vehicledepot', 'airfield', 'navalyard']) {
    await inspect(page, base);
    for (const [kind, at] of UNLOCKED)
      if (at === base) await expect(page.getByTestId(`train-${kind}`), kind).toBeEnabled();
    if (base === 'vehicledepot') {
      await page.getByTestId('train-heavytank').click();
      await expect
        .poll(async () =>
          (await page.evaluate(() => window.__game!.getForces()))!.orders.some((o) => o.kind === 'heavytank'),
        )
        .toBe(true);
      await shot(page, 'm37-train-heavytank');
    }
    await page.keyboard.press('Escape');
  }
  // The superweapons strip says where each stands.
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-forces').click();
  await expect(page.getByTestId('super-windupbot')).toContainText('Train it at the vehicle depot');
  await expect(page.getByTestId('super-domeshield')).toContainText('Build it');
  await shot(page, 'm37-supers-strip');
  errs.check();
});
