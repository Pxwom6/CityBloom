import { readFileSync } from 'node:fs';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext, openGame, clickMain } from './helpers';
import { findSpot, frames, screen } from './ui';
import { testModels } from '../scripts/lib/makeGlb';

closeContextsAfterEach();

/**
 * M46, players' own buildings, through the real interface. One player adds three bad models and a
 * file over 1 MB in My buildings (each refused with its reason and a picture) and a good one (seen on
 * the turntable by night and in winter), places it as a landmark from the landmarks row and as a
 * pocket park's new look from its inspector, shares it as a building file, saves, and opens the save
 * as on another device (My buildings emptied): the city brings the model with it, and the shared file
 * makes it the player's own again. Then two players in a shared city: the friend's page fetches the
 * model through the room and draws it, hides it with "Show friends' custom buildings" off, and
 * everyone sees the game's own when the host turns custom buildings off.
 */
test.describe.configure({ mode: 'serial' });

const models = testModels();
const glb = (name: string, bytes: Uint8Array) => ({
  name,
  mimeType: 'model/gltf-binary',
  buffer: Buffer.from(bytes),
});
const mine = (page: Page) => page.evaluate(() => window.__game!.getMyBuildings());
const civics = (page: Page) => page.evaluate(() => window.__game!.getCivics());

async function settings(page: Page, extra: Record<string, unknown> = {}) {
  await page.addInitScript((extra) => {
    // "Another device" (a test's flag): My buildings starts empty, as on a phone that never had them.
    if (localStorage.getItem('e2e.wipeBuildings')) {
      localStorage.removeItem('e2e.wipeBuildings');
      indexedDB.deleteDatabase('citybloom-buildings');
    }
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(
      key,
      JSON.stringify({
        ...s,
        tips: false,
        graphicsChecked: true,
        quality: 'low',
        timelapse: false,
        ...extra,
      }),
    );
  }, extra);
}

/** A model through the panel: its measurements back, then (optionally) the target, then the check. */
async function importModel(page: Page, file: ReturnType<typeof glb>, target?: string, name?: string) {
  await page.getByTestId('buildings-file').setInputFiles(file);
  await expect(page.getByTestId('buildings-import')).toBeVisible();
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-testid=buildings-import]');
    return (
      !!card?.querySelector('[data-testid=buildings-problem]') ||
      !!card?.querySelector('[data-testid=buildings-target]:not([disabled])')
    );
  });
  if (target) await page.getByTestId('buildings-target').selectOption(target);
  if (name) await page.getByTestId('buildings-name').fill(name);
  if (await page.getByTestId('buildings-add').isVisible()) await page.getByTestId('buildings-add').click();
}

/** The problems a refused model came back with (the card waits for the check). */
async function refused(page: Page): Promise<string> {
  await expect(page.getByTestId('buildings-problems')).toBeVisible({ timeout: 30_000 });
  return (await page.getByTestId('buildings-problem').allTextContents()).join('\n');
}

/** A small town east of the highway: an avenue, a street north, and a pocket park on it. */
async function town(page: Page) {
  return page.evaluate(async () => {
    const g = window.__game!;
    g.setSpeed(0);
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
    await g.dispatch({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 420, z: c.z }] });
    await g.dispatch({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: c.x + 260, z: c.z },
        { x: c.x + 260, z: c.z - 200 },
      ],
    });
    const park = await g.placeCivic('park_small', { x: c.x + 270, z: c.z - 120 });
    return { c, park: park! };
  });
}

test('my own building: refused with reasons, added, placed as a landmark and a look, saved and opened elsewhere', async ({
  page,
}) => {
  test.setTimeout(600_000);
  await settings(page);
  await openGame(page, '&seed=mybuild&preset=river&name=Pavilion Park');
  const { c, park } = await town(page);
  await page.evaluate(
    (c) => window.__game!.setCamera({ x: c.x + 200, z: c.z - 60, distance: 420, yaw: 0, tilt: 0.7 }),
    c,
  );

  // My buildings, from the landmarks row.
  await page.getByTestId('tool-landmark').click();
  await page.getByTestId('place-mybuildings').click();
  await expect(page.getByTestId('buildings-panel')).toBeVisible();
  await expect(page.getByTestId('buildings-empty')).toBeVisible();

  // Too wide for the 2×2 landmark it's meant as: the site, and the parts outside it in red.
  await importModel(page, glb('tower-too-wide.glb', models.tooWide), 'landmark:2');
  await expect(page.getByTestId('buildings-size')).toContainText('19 m wide, 19 m deep');
  expect(await refused(page)).toMatch(/It is 19 × 19 m; its site is 16 × 16 m/);
  await expect(page.getByTestId('buildings-picture')).toBeVisible();
  await page.getByTestId('buildings-cancel').click();
  // Its data in another file: refused before anything is read.
  await importModel(page, glb('tower-outside.glb', models.outside));
  expect(await refused(page)).toMatch(/points to files outside itself \("building\.bin"\)/);
  await expect(page.getByTestId('buildings-add')).toHaveCount(0);
  await page.getByTestId('buildings-cancel').click();
  // A texture: plain colours only.
  await importModel(page, glb('tower-textured.glb', models.textured));
  expect(await refused(page)).toMatch(/textures \(1 image\): the spec asks for plain colours only/);
  await page.getByTestId('buildings-cancel').click();
  // And a file over 1 MB.
  await importModel(page, glb('tower-big.glb', models.tooBig));
  expect(await refused(page)).toMatch(/1\.2 MB: the game takes models up to 1 MB/);
  await page.getByTestId('buildings-cancel').click();
  expect((await mine(page)).models).toEqual([]);

  // The good one: its size suggests the 2×2 landmark; named, checked and added.
  await importModel(page, glb('pavilion.glb', models.good), undefined, 'Clock pavilion');
  await expect(page.getByTestId('buildings-list')).toBeVisible({ timeout: 30_000 });
  const added = (await mine(page)).models;
  expect(added).toHaveLength(1);
  expect(added[0]).toMatchObject({
    name: 'Clock pavilion',
    target: { kind: 'landmark', size: 2 },
    size: { w: 16, d: 16 },
    mine: true,
  });
  const hash = added[0]!.hash;
  await expect(page.getByTestId(`buildings-also-${hash}`)).toContainText('Pocket park look');
  // On the turntable, by night and in winter.
  await expect(page.getByTestId('buildings-canvas')).toBeVisible();
  await page.getByTestId('buildings-night').click();
  await expect(page.getByTestId('buildings-night')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('buildings-season-winter').click();
  await expect(page.getByTestId('buildings-season-winter')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('buildings-day').click();
  await frames(page, 4);
  await page.screenshot({ path: 'docs/screenshots/m46-panel.png' });
  // Shared as a building file (a download on a computer).
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId(`buildings-share-${hash}`).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Clock_pavilion.citybloom-building');
  const shared = readFileSync((await download.path())!);

  // Placed as a landmark from the landmarks row, where the sim takes it.
  await page.getByTestId('buildings-panel').getByRole('button', { name: 'Close' }).click();
  if (!(await page.getByTestId(`place-own-${hash}`).isVisible()))
    await page.getByTestId('tool-landmark').click();
  await page.getByTestId(`place-own-${hash}`).click();
  const spots: [number, number][] = [80, 150, 330, 390].map((dx) => [c.x + dx, c.z - 26]);
  const at = await findSpot(page, spots, 'the pavilion');
  await expect(page.getByTestId('tool-hint')).toContainText('Clock pavilion');
  const p = await screen(page, at[0], at[1]);
  await page.mouse.click(p.x, p.y);
  await expect
    .poll(async () => (await civics(page)).filter((x) => x.def === 'landmark2' && x.look === hash).length, {
      timeout: 20_000,
    })
    .toBe(1);
  await page.getByTestId('tool-select').click();

  // The pocket park's new look, chosen in its inspector.
  const pk = (await civics(page)).find((x) => x.id === park)!;
  await page.evaluate(
    (pk) => window.__game!.setCamera({ x: pk.x, z: pk.z, distance: 160, yaw: 0, tilt: 0.65 }),
    pk,
  );
  await frames(page, 3);
  const pp = await screen(page, pk.x, pk.z);
  await page.mouse.click(pp.x, pp.y);
  await expect(page.getByTestId('inspector-look')).toBeVisible();
  await page.getByTestId('inspector-look').selectOption(hash);
  await expect.poll(async () => (await civics(page)).find((x) => x.id === park)?.look).toBe(hash);
  await expect(page.getByTestId('inspector-name')).toHaveText('Clock pavilion');
  await expect.poll(async () => (await mine(page)).drawn).toBe(2);
  await page.evaluate(
    (c) => window.__game!.setCamera({ x: c.x + 200, z: c.z - 70, distance: 300, yaw: 0.4, tilt: 0.75 }),
    c,
  );
  await frames(page, 6);
  await page.screenshot({ path: 'docs/screenshots/m46-city.png' });

  // Saved by name.
  await page.getByTestId('inspector').getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('pause-menu')).toBeVisible();
  await page.getByTestId('pause-save').click();
  await page.getByTestId('save-name').fill('With the pavilion');
  await page.getByTestId('save-new').click();
  await expect(page.getByTestId('toast').first()).toContainText('Saved “With the pavilion”');

  // As on another device: My buildings is empty, and the save brings the model with the city.
  await page.evaluate(() => localStorage.setItem('e2e.wipeBuildings', '1'));
  await page.goto('./');
  await page.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'menu',
    null,
    {
      timeout: 90_000,
    },
  );
  expect((await mine(page)).models).toEqual([]);
  await clickMain(page, 'main-load');
  await page
    .getByTestId('slot-list')
    .locator('.slot', { hasText: 'With the pavilion' })
    .getByRole('button', { name: 'Load' })
    .click();
  await page.waitForFunction(() => window.__game?.getShell().mode === 'play', null, { timeout: 90_000 });
  await expect
    .poll(
      async () => {
        const m = await mine(page);
        return { models: m.models.map((x) => [x.hash, x.mine]), drawn: m.drawn };
      },
      { timeout: 30_000 },
    )
    .toEqual({ models: [[hash, false]], drawn: 2 });
  expect((await civics(page)).filter((x) => x.look === hash)).toHaveLength(2);

  // The shared file makes it the player's own here too.
  await page.getByTestId('tool-landmark').click();
  await page.getByTestId('place-mybuildings').click();
  await expect(page.getByTestId('buildings-empty')).toBeVisible();
  await page.getByTestId('buildings-file').setInputFiles({
    name: 'Clock_pavilion.citybloom-building',
    mimeType: 'application/json',
    buffer: shared,
  });
  await expect(page.getByTestId('buildings-name')).toHaveValue('Clock pavilion');
  await expect(page.getByTestId('buildings-target')).toHaveValue('landmark:2');
  await page.getByTestId('buildings-add').click();
  await expect(page.getByTestId(`buildings-row-${hash}`)).toBeVisible({ timeout: 30_000 });
  expect((await mine(page)).models.map((x) => [x.hash, x.mine])).toEqual([[hash, true]]);
});

async function player(browser: Browser, name: string, color: number, extra: Record<string, unknown> = {}) {
  const ctx = await newContext(browser, { viewport: { width: 1100, height: 720 } });
  await ctx.addInitScript(
    ([n, c]) => localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c })),
    [name, color] as const,
  );
  const page = await ctx.newPage();
  await settings(page, { shadows: false, ...extra });
  return page;
}

const net = (page: Page) => page.evaluate(() => window.__game!.getNet());

test('a friend in a shared city sees my building, unless they hide friends’ or the host turns them off', async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const ada = await player(browser, 'Ada', 0);
  await openGame(ada, '&seed=mybuild2&preset=river&name=Twinbrook');
  const { c } = await town(ada);
  // Ada's model, kept on her device, worn by a landmark of hers.
  const b64 = Buffer.from(models.good).toString('base64');
  const r = await ada.evaluate(
    (b64) => window.__game!.addMyBuilding(b64, 'Clock pavilion', { kind: 'landmark', size: 2 }),
    b64,
  );
  expect(r.ok).toBe(true);
  const hash = r.hash!;
  const id = await ada.evaluate(
    (c) => window.__game!.placeCivic('landmark2', { x: c.x + 120, z: c.z - 30 }),
    c,
  );
  expect(
    await ada.evaluate(
      ([id, hash]) => window.__game!.dispatch({ type: 'setLook', civic: id as number, look: hash as string }),
      [id, hash],
    ),
  ).toMatchObject({ ok: true });
  await expect.poll(async () => (await mine(ada)).drawn).toBe(1);

  // Ada shares the city; Sam joins with the code.
  await ada.keyboard.press('Escape');
  await ada.getByTestId('pause-invite').click();
  await expect.poll(async () => (await net(ada))?.state, { timeout: 30_000 }).toBe('playing');
  const code = (await net(ada))!.code;
  await ada.getByTestId('speed-0').click();
  await ada.getByTestId('room-panel').getByRole('button', { name: 'Close' }).click();
  const sam = await player(browser, 'Sam', 1);
  await sam.goto(`./?join=${code}`);
  await sam.waitForFunction(() => window.__game?.ready === true && !!window.__game.getNet(), null, {
    timeout: 120_000,
  });
  await expect.poll(async () => (await net(sam))?.state, { timeout: 90_000 }).toBe('playing');

  // Sam's page asks the room for the model and draws it, kept as a friend's.
  await expect
    .poll(
      async () => {
        const m = await mine(sam);
        return { models: m.models.map((x) => [x.hash, x.mine, x.name]), drawn: m.drawn };
      },
      { timeout: 60_000 },
    )
    .toEqual({ models: [[hash, false, 'Clock pavilion']], drawn: 1 });
  const lm = (await civics(sam)).find((x) => x.look === hash)!;
  await sam.evaluate(
    (lm) => window.__game!.setCamera({ x: lm.x, z: lm.z, distance: 150, yaw: 0.3, tilt: 0.65 }),
    lm,
  );
  await frames(sam, 6);
  await sam.screenshot({ path: 'docs/screenshots/m46-friend.png' });

  // "Show friends' custom buildings" off: Sam sees the game's own plaza; on again, the pavilion.
  await sam.getByTestId('tool-landmark').click();
  await sam.getByTestId('place-mybuildings').click();
  await sam.getByTestId('buildings-friends').uncheck();
  await expect.poll(async () => (await mine(sam)).drawn).toBe(0);
  expect((await mine(ada)).drawn).toBe(1);
  await sam.getByTestId('buildings-friends').check();
  await expect.poll(async () => (await mine(sam)).drawn).toBe(1);
  await sam.getByTestId('buildings-panel').getByRole('button', { name: 'Close' }).click();

  // The host turns custom buildings off for the room: nobody sees them, and nothing new may wear one.
  await ada.getByTestId('room-chip').click();
  // (The box follows the room's rules: it changes once the room has them.)
  await ada.getByTestId('room-custom-toggle').click();
  await expect(ada.getByTestId('room-custom-toggle')).not.toBeChecked({ timeout: 10_000 });
  await expect
    .poll(async () => [(await mine(ada)).drawn, (await mine(sam)).drawn], { timeout: 20_000 })
    .toEqual([0, 0]);
  const no = await sam.evaluate(
    ([id, hash]) => window.__game!.dispatch({ type: 'setLook', civic: id as number, look: hash as string }),
    [lm.id, hash],
  );
  expect(no).toMatchObject({ ok: false, reason: 'The host has turned custom buildings off in this room' });
  await ada.getByTestId('room-custom-toggle').click();
  await expect(ada.getByTestId('room-custom-toggle')).toBeChecked({ timeout: 10_000 });
  await expect
    .poll(async () => [(await mine(ada)).drawn, (await mine(sam)).drawn], { timeout: 20_000 })
    .toEqual([1, 1]);
});
