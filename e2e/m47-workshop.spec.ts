import { test, expect, type Page } from '@playwright/test';
import { closeContextsAfterEach } from './helpers';
import { findSpot, frames, screen } from './ui';
import { PLAYER_ROLES } from '../src/models/workshop';
import { mistakeModels, testModels, goodModelParts, transformParts, writeGlb } from '../scripts/lib/makeGlb';

closeContextsAfterEach();

/**
 * M47, the Workshop through the real UI: from the main menu's Learn page, the Making buildings lesson
 * opens its town on the Workshop; a 2×2 landmark is picked, the prompt written and copied (it names the
 * site, the budget, the file and every role); each common mistake is checked and gets its own note; the
 * good model passes, is seen in its street, added to My buildings and placed in the town, which ends the
 * lesson.
 */
test.use({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1280, height: 860 } });

const glb = (name: string, bytes: Uint8Array) => ({
  name,
  mimeType: 'model/gltf-binary',
  buffer: Buffer.from(bytes),
});
const tut = (page: Page) => page.evaluate(() => window.__game!.getTutorial());

test('the Workshop, from Learn to a model placed in the town', async ({ page }) => {
  test.setTimeout(420_000);
  await page.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(
      key,
      JSON.stringify({ ...s, tips: false, graphicsChecked: true, quality: 'low', timelapse: false }),
    );
  });
  await page.goto('./');
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 90_000 });
  await page.getByTestId('main-learn').click();
  await expect(page.getByTestId('lesson-buildings')).not.toContainText('Coming');
  await page.getByTestId('lesson-start-buildings').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 90_000,
  });
  // The lesson opens on the Workshop's first step.
  await expect(page.getByTestId('workshop')).toBeVisible();
  await expect(page.getByTestId('workshop-step-0')).toHaveAttribute('aria-current', 'step');
  expect((await tut(page)).lesson).toBe('buildings');

  // 1 Pick: a 2×2 landmark, its site, height and budget.
  await page.getByTestId('workshop-pick-landmark2').click();
  await expect(page.getByTestId('workshop-facts')).toContainText('16 × 16 m');
  await expect(page.getByTestId('workshop-facts')).toContainText('1,500 triangles');
  await expect(page.getByTestId('workshop-site')).toBeVisible();
  await page.getByTestId('workshop-next').click();

  // 2 Make: the prompt, copied, names the right footprint, budget, file and roles.
  await page.getByTestId('workshop-name').fill('Clock pavilion');
  await page
    .getByTestId('workshop-idea')
    .fill('A little clock tower on a paved square with lawns in the corners');
  await page.getByTestId('workshop-copy').click();
  const prompt = await page.evaluate(() => navigator.clipboard.readText());
  expect(prompt).toContain('Citybloom model spec (v6).');
  expect(prompt).toContain(
    'Citybloom model, following the model spec (v6) and style reference: Clock pavilion. Save as landmark2.glb.',
  );
  expect(prompt).toContain(
    'Site 16 x 16 m (16 m along the road, 16 m deep); the front is on the road, facing -Z.',
  );
  expect(prompt).toContain('Budget 1,500 triangles.');
  expect(prompt).toContain('A little clock tower on a paved square with lawns in the corners');
  const roles = prompt.match(/Name every material by its role, exactly: ([^.]+)\./)?.[1]?.split(', ');
  expect(roles).toEqual([...PLAYER_ROLES]);
  // The style sheet is there to download, and the Blender steps cover what the spec needs.
  const sheet = await page.getByTestId('workshop-style').getAttribute('href');
  expect((await page.request.get(new URL(sheet!, page.url()).href)).headers()['content-type']).toContain(
    'image/png',
  );
  await page.getByTestId('workshop-make-blender').click();
  for (const words of [
    'Metres.',
    'The front faces −Y.',
    'On the ground, centred.',
    'Name everything.',
    'Export a GLB.',
  ])
    await expect(page.locator('.workshop-blender')).toContainText(words);
  await page.getByTestId('workshop-next').click();

  // 3 Check: every common mistake gets its own plain-words fix; then the good model passes.
  const want: Record<string, string> = {
    centimetres: 'It was made in centimetres',
    backwards: 'It faces backwards',
    floating: 'It floats above the ground',
    triangles: 'It has too many triangles',
    unnamed: 'Its parts have no names',
    colours: 'Its colours are not named by their job',
  };
  for (const [name, bytes] of Object.entries(mistakeModels())) {
    await page.getByTestId('workshop-file').setInputFiles(glb(`${name}.glb`, bytes));
    await expect(page.getByTestId('workshop-note').first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('workshop-note')).toHaveCount(1);
    await expect(page.getByTestId('workshop-note').locator('h4')).toHaveText(want[name]!);
    await expect(page.getByTestId('workshop-note')).toContainText(/\w/);
    await expect(page.getByTestId('workshop-next')).toBeDisabled();
  }
  // A first try with two mistakes: two notes, with the picture.
  await page
    .getByTestId('workshop-file')
    .setInputFiles(
      glb('first-try.glb', writeGlb(transformParts(goodModelParts(16), { turn: Math.PI, lift: 1.2 }))),
    );
  await expect(page.getByTestId('workshop-note')).toHaveCount(2, { timeout: 60_000 });
  await expect(page.getByTestId('workshop-picture')).toBeVisible();
  await page.getByTestId('workshop-file').setInputFiles(glb('pavilion.glb', testModels().good));
  await expect(page.getByTestId('workshop-ok')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await tut(page)).step, { timeout: 20_000 }).toBe('workshopUse');
  await page.getByTestId('workshop-next').click();

  // 4 See: on its lot in a street, by night and in winter.
  await expect(page.getByTestId('workshop-canvas')).toBeVisible();
  await page.getByTestId('workshop-night').click();
  await expect(page.getByTestId('workshop-night')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('workshop-season-winter').click();
  await expect(page.getByTestId('workshop-season-winter')).toHaveAttribute('aria-pressed', 'true');
  await frames(page, 3);
  await page.getByTestId('buildings-panel').screenshot({ path: 'docs/screenshots/m47-see.png' });
  await page.getByTestId('workshop-next').click();

  // 5 Use: into My buildings, then placed in the town.
  await page.getByTestId('workshop-add').click();
  await expect(page.getByTestId('workshop-added')).toContainText('Clock pavilion');
  await expect(page.getByTestId('workshop-send')).toBeDisabled();
  const mine = (await page.evaluate(() => window.__game!.getMyBuildings())).models;
  expect(mine.map((m) => [m.name, m.mine])).toEqual([['Clock pavilion', true]]);
  // A spot the sim takes, among the town's homes.
  const near = await page.evaluate(async () => {
    const g = window.__game!;
    const b = g.getBuildings();
    const c = { x: b.reduce((t, v) => t + v.x, 0) / b.length, z: b.reduce((t, v) => t + v.z, 0) / b.length };
    const id = await g.placeCivic('landmark2', c);
    const p = g.getCivics().find((x) => x.id === id)!;
    await g.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: id! } });
    g.setCamera({ x: p.x, z: p.z, distance: 220, yaw: 0, tilt: 0.65 });
    return p;
  });
  await page.getByTestId('workshop-place').click();
  await expect(page.getByTestId('buildings-panel')).toHaveCount(0);
  const at = await findSpot(page, [[near.x, near.z]], 'the pavilion');
  const p = await screen(page, at[0], at[1]);
  await page.mouse.click(p.x, p.y);
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.__game!.getCivics())).filter((c) => c.look === mine[0]!.hash)
          .length,
      {
        timeout: 20_000,
      },
    )
    .toBe(1);
  // Placing it ends the lesson.
  await expect.poll(async () => (await tut(page)).step, { timeout: 20_000 }).toBe('lessonDone');
  await page.getByTestId('tool-select').click();
  await frames(page, 4);
  await page.screenshot({ path: 'docs/screenshots/m47-placed.png' });
});
