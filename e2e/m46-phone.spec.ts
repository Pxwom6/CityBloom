import { expect, test, type Page } from '@playwright/test';
import { closeContextsAfterEach } from './helpers';
import { fingers, holdForSpot, phone, phoneProblems, phoneShot, type Orient } from './phone';
import { frames } from './ui';
import { testModels } from '../scripts/lib/makeGlb';

closeContextsAfterEach();

/**
 * M46 on phones, by touch: an iPhone and an Android phone (Playwright's emulation), each upright and
 * sideways. My buildings opens from the Build sheet's landmarks; a bad model is refused (its words and
 * picture) and the good one added and shown on the turntable; the sheet is checked for what a finger
 * needs (nothing off the screen, presses of 44 px). Upright on the iPhone and sideways on the Pixel the
 * model is placed as a landmark by touch: a long press finds the spot, a tap builds it.
 */
const cases: [string, Orient, boolean][] = [
  ['iPhone 13', 'portrait', true],
  ['iPhone 13', 'landscape', false],
  ['Pixel 7', 'portrait', false],
  ['Pixel 7', 'landscape', true],
];

const models = testModels();
const glb = (name: string, bytes: Uint8Array) => ({
  name,
  mimeType: 'model/gltf-binary',
  buffer: Buffer.from(bytes),
});

async function check(p: Page, scope: string, where: string): Promise<void> {
  await frames(p, 2);
  expect(await phoneProblems(p, scope), where).toEqual([]);
}

async function measured(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-testid=buildings-import]');
    return (
      !!card?.querySelector('[data-testid=buildings-problem]') ||
      !!card?.querySelector('[data-testid=buildings-target]:not([disabled])')
    );
  });
}

for (const [device, orient, place] of cases) {
  test.describe(`${device} ${orient}`, () => {
    test.use({ ...phone(device, orient) });
    test(`my own building by touch${place ? ', placed' : ''}`, async ({ page }) => {
      test.setTimeout(place ? 300_000 : 200_000);
      const tag = `${device.replace(/ /g, '')}-${orient}`;
      await page.addInitScript(() => {
        const key = 'citybloom.settings';
        const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
        localStorage.setItem(
          key,
          JSON.stringify({
            ...s,
            tips: false,
            graphicsChecked: true,
            reportsNotice: true,
            timelapse: false,
            // As the first launch's check sets on a phone (M49), and quick enough that a tap stays a tap.
            quality: 'phone',
            shadows: false,
            drawDistance: 'near',
          }),
        );
      });
      await page.goto('./?seed=mbphone&preset=river&name=Pocketton');
      await page.waitForFunction(
        () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
        null,
        { timeout: 120_000 },
      );
      const c = await page.evaluate(async () => {
        const g = window.__game!;
        g.setSpeed(0);
        const s = await g.getState();
        const c = { x: 24, z: s.highwayZ };
        await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
        await g.dispatch({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 400, z: c.z }] });
        g.setCamera({ x: c.x + 160, z: c.z - 20, distance: 300, yaw: 0, tilt: 0.75 });
        return c;
      });

      // My buildings, from the Build sheet's landmarks.
      await page.getByTestId('tool-build').tap();
      await page.getByTestId('tool-landmark').tap();
      await page.getByTestId('place-mybuildings').tap();
      await expect(page.getByTestId('buildings-panel')).toBeVisible();
      await check(page, '[data-testid=buildings-panel]', `${tag}: My buildings, empty`);

      // A textured model: refused, with its picture.
      await page.getByTestId('buildings-file').setInputFiles(glb('textured.glb', models.textured));
      await measured(page);
      await page.getByTestId('buildings-add').tap();
      await expect(page.getByTestId('buildings-problem')).toContainText('plain colours only', {
        timeout: 30_000,
      });
      await expect(page.getByTestId('buildings-picture')).toBeVisible();
      await check(page, '[data-testid=buildings-panel]', `${tag}: a model refused`);
      await page.getByTestId('buildings-cancel').tap();

      // The good one, added and on the turntable.
      await page.getByTestId('buildings-file').setInputFiles(glb('pavilion.glb', models.good));
      await measured(page);
      await page.getByTestId('buildings-name').fill('Pocket pavilion');
      await page.getByTestId('buildings-add').tap();
      await expect(page.getByTestId('buildings-list')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('buildings-night').tap();
      await expect(page.getByTestId('buildings-night')).toHaveAttribute('aria-pressed', 'true');
      await check(page, '[data-testid=buildings-panel]', `${tag}: a model added`);
      await phoneShot(page, `m46-phone-${tag}`);
      if (!place) return;

      // Placed as a landmark by touch: Place on its row, a long press for the spot, a tap.
      const hash = (await page.evaluate(() => window.__game!.getMyBuildings())).models[0]!.hash;
      await page.getByTestId(`buildings-place-${hash}`).tap();
      await expect(page.getByTestId('buildings-panel')).toHaveCount(0);
      const f = await fingers(page);
      const spots: [number, number][] = [60, 120, 180, 240, 300].flatMap((dx) => [
        [c.x + dx, c.z - 26] as [number, number],
        [c.x + dx, c.z + 26] as [number, number],
      ]);
      const p = await holdForSpot(page, f, spots, 'the pavilion');
      await f.tap(p);
      // By touch, a building asks first with its price (M49).
      const yes = page.getByTestId('tool-question-yes');
      if (await yes.isVisible({ timeout: 3000 }).catch(() => false)) await yes.tap();
      await expect
        .poll(
          async () =>
            (await page.evaluate(() => window.__game!.getCivics())).filter(
              (x) => x.def === 'landmark2' && x.look === hash,
            ).length,
          { timeout: 20_000 },
        )
        .toBe(1);
      await expect
        .poll(async () => (await page.evaluate(() => window.__game!.getMyBuildings())).drawn)
        .toBe(1);
      await phoneShot(page, `m46-phone-${tag}-placed`);
    });
  });
}
