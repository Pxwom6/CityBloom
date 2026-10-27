import { expect, test, type Page } from '@playwright/test';
import { openGame, shot, watchErrors } from './helpers';
import { frames, screen, settings, state } from './ui';
import { servedTown } from './war';

/**
 * M37 superweapons through the real UI: the giant wind-up robot tried at the proving ground and
 * trained at the depot, sent once from the Send tab, fought in a neighbour's town, home again and
 * winding up; and the blackout tower used once from its inspector, then recharging.
 */

const civics = (page: Page, def: string) =>
  page.evaluate((def) => window.__game!.getCivics().filter((c) => c.def === def), def);

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

/** The HQ, and the buildings each test needs, by the API, near the town. */
async function place(page: Page, defs: string[], tiers: string[]): Promise<void> {
  const hz = (await state(page)).highwayZ;
  await page.evaluate(
    async ([hz, defs, tiers]) => {
      const g = window.__game!;
      const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
        const r = await g.dispatch(cmd);
        if (!r.ok) throw new Error(`${cmd.type}: ${r.reason}`);
        return r;
      };
      await ok({ type: 'cheat', cheat: 'addMoney', amount: 8_000_000 });
      // The research these need, done (the Research tab's own test queues it through the UI).
      await ok({ type: 'cheat', cheat: 'research', tiers: tiers as never });
      const at = (dx: number, dz: number) => ({ x: 24 + dx, z: hz! + dz });
      const spots = [at(300, -160), at(200, 160), at(120, -160), at(380, 160), at(420, -160)];
      for (const [k, def] of (defs as string[]).entries()) {
        const id = await g.placeCivic(def, spots[k] ?? at(240, -160));
        if (id === null) throw new Error(`no room for ${def}`);
        // A superweapon building's stages, done (each is a project of months).
        const c = (await g.getCivics()).find((x) => x.id === id);
        if (c?.stage !== undefined) await ok({ type: 'cheat', cheat: 'finishStages', civic: id });
      }
      const s = await g.getState();
      for (const n of s.region.neighbours.filter((x) => x.rival))
        await ok({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 3, defences: 1 });
      await g.advance(60 * 6);
    },
    [hz, defs, tiers] as const,
  );
}

test('M37: the giant robot, tried and trained, is sent once, comes home and winds up again', async ({
  page,
}) => {
  test.setTimeout(2_400_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await servedTown(page);
  await place(page, ['militaryhq', 'vehicledepot', 'provingground'], ['land1', 'land2', 'land3', 'land4']);
  const rival = await page.evaluate(async () => {
    const s = await window.__game!.getState();
    const n =
      s.region.neighbours.find((x) => x.rival && x.side === 'west') ??
      s.region.neighbours.find((x) => x.rival)!;
    return { id: n.id, name: n.name };
  });

  // --- Its trial, started from the Research tab. ---
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-research').click();
  await page.getByTestId('trial-start-windupbot').click();
  await expect(page.getByTestId('trial-windupbot')).toBeVisible();
  for (let k = 0; k < 8; k++) {
    const r = (await page.evaluate(() => window.__game!.getResearch()))!;
    if (r.proven.includes('windupbot')) break;
    await page.evaluate(() => window.__game!.advance(60 * 24));
  }
  expect((await page.evaluate(() => window.__game!.getResearch()))!.proven).toContain('windupbot');
  await page.keyboard.press('Shift+KeyM');

  // --- Trained at the depot, from its inspector. ---
  await inspect(page, 'vehicledepot');
  await page.getByTestId('train-windupbot').click();
  await page.keyboard.press('Escape');
  for (let day = 0; day < 40; day++) {
    const s = await page.evaluate(() => window.__game!.getSupers());
    if (s.units.length) break;
    await page.evaluate(() => window.__game!.advance(1440));
  }
  const robot = (await page.evaluate(() => window.__game!.getSupers())).units[0]!;
  expect(robot.kind).toBe('windupbot');
  await page.keyboard.press('Shift+KeyM');
  await page.getByTestId('war-tab-forces').click();
  await expect(page.getByTestId('super-windupbot')).toContainText('Ready');
  await shot(page, 'm37-robot-ready');

  // --- Sent once, from the Send tab: twice as long on the road. ---
  await page.getByTestId('war-tab-send').click();
  await page.getByTestId('send-to').selectOption(String(rival.id));
  await page.getByTestId('send-windupbot').fill('1');
  await shot(page, 'm37-send-robot');
  await page.getByTestId('send-force').click();
  await expect(page.getByTestId('war-expeditions')).toContainText(`on the way to ${rival.name}`);
  // There (12 hours or so), the page fights its battle in the neighbour's town; the report comes back.
  await page.evaluate(() => window.__game!.advance(60 * 15));
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getBattle())).reports.length, {
      timeout: 900_000,
      intervals: [2_000],
    })
    .toBeGreaterThan(0);
  const report = (await page.evaluate(() => window.__game!.getBattle())).reports.at(-1)!;
  await page.getByTestId('war-tab-reports').click();
  await expect(page.getByTestId(`report-${report.id}`)).toContainText(rival.name);
  // Home again, and winding up (never lost).
  await page.evaluate(() => window.__game!.advance(60 * 16));
  const home = (await page.evaluate(() => window.__game!.getSupers())).units[0]!;
  expect(home.away).toBe(false);
  expect(home.ready).toBeGreaterThan(200);
  await page.getByTestId('war-tab-forces').click();
  await expect(page.getByTestId('super-windupbot')).toContainText('Winding up');
  await page.getByTestId('war-tab-send').click();
  await expect(page.getByTestId('send-winding')).toContainText('Giant wind-up robot winding up');
  await shot(page, 'm37-robot-winding');
  errs.check();
});

test('M37: the blackout tower darkens a rival once from its inspector, then recharges', async ({ page }) => {
  test.setTimeout(1_200_000);
  const errs = watchErrors(page);
  await settings(page, { quality: 'low' });
  await openGame(page, '&rivals=1&seed=port&preset=coast');
  await servedTown(page);
  await place(page, ['militaryhq', 'blackouttower'], ['intel1', 'intel2', 'intel3', 'intel4']);
  const rival = await page.evaluate(async () => {
    const s = await window.__game!.getState();
    const n = s.region.neighbours.find((x) => x.rival)!;
    return { id: n.id, name: n.name };
  });
  await inspect(page, 'blackouttower');
  await expect(page.getByTestId('tower')).toContainText('Ready');
  await page.getByTestId('blackout-to').selectOption(String(rival.id));
  await shot(page, 'm37-tower');
  await page.getByTestId('blackout-use').click();
  await expect(page.getByTestId('tower')).toContainText(`Charging at ${rival.name}`);
  await page.evaluate(() => window.__game!.advance(60 * 2));
  await expect
    .poll(async () =>
      (await page.evaluate(() => window.__game!.getSupers())).buildings?.darkened.map((d) => d.id),
    )
    .toContain(rival.id);
  await expect(page.getByTestId('tower')).toContainText('Recharging');
  await expect(page.getByTestId('blackout-use')).toBeDisabled();
  await shot(page, 'm37-tower-recharging');
  errs.check();
});
