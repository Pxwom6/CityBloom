import { expect, test, type Page } from '@playwright/test';
import { closeContextsAfterEach } from './helpers';
import { phone, phoneProblems, phoneShot, type Orient } from './phone';
import { frames } from './ui';
import { mistakeModels, testModels } from '../scripts/lib/makeGlb';

closeContextsAfterEach();

/**
 * M47 on phones, by touch: an iPhone and an Android phone, each upright and sideways. The Workshop opens
 * from the Build sheet's landmarks and My buildings; every step is checked for what a finger needs
 * (nothing off the screen, presses of 44 px). On two of them a bad model is checked (its note), then the
 * good one, seen in its street and added to My buildings.
 */
const cases: [string, Orient, boolean][] = [
  ['iPhone 13', 'portrait', true],
  ['iPhone 13', 'landscape', false],
  ['Pixel 7', 'portrait', false],
  ['Pixel 7', 'landscape', true],
];

const glb = (name: string, bytes: Uint8Array) => ({
  name,
  mimeType: 'model/gltf-binary',
  buffer: Buffer.from(bytes),
});

async function check(p: Page, where: string): Promise<void> {
  await frames(p, 2);
  expect(await phoneProblems(p, '[data-testid=buildings-panel]'), where).toEqual([]);
}

for (const [device, orient, full] of cases) {
  test.describe(`${device} ${orient}`, () => {
    test.use({ ...phone(device, orient) });
    test(`the Workshop by touch${full ? ', a model checked and added' : ''}`, async ({ page }) => {
      test.setTimeout(full ? 300_000 : 200_000);
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
            quality: 'phone',
            shadows: false,
            drawDistance: 'near',
          }),
        );
      });
      await page.goto('./?seed=wsphone&preset=river&name=Pocketton');
      await page.waitForFunction(
        () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
        null,
        { timeout: 120_000 },
      );
      await page.evaluate(() => window.__game!.setSpeed(0));
      // The Workshop from the Build sheet's landmarks, then My buildings' Workshop tab.
      await page.getByTestId('tool-build').tap();
      await page.getByTestId('tool-landmark').tap();
      await page.getByTestId('place-mybuildings').tap();
      await page.getByTestId('buildings-tab-workshop').tap();
      await expect(page.getByTestId('workshop')).toBeVisible();
      // 1 Pick
      await page.getByTestId('workshop-pick-landmark1').tap();
      await expect(page.getByTestId('workshop-facts')).toContainText('8 × 8 m');
      await check(page, `${tag}: Pick`);
      await phoneShot(page, `m47-phone-${tag}-pick`);
      // 2 Make, both ways
      await page.getByTestId('workshop-next').tap();
      await expect(page.getByTestId('workshop-prompt')).toHaveValue(/Site 8 x 8 m/);
      await check(page, `${tag}: Make with an AI tool`);
      await page.getByTestId('workshop-make-blender').tap();
      await check(page, `${tag}: Make in Blender`);
      await page.getByTestId('workshop-make-ai').tap();
      // 3 Check
      await page.getByTestId('workshop-next').tap();
      await check(page, `${tag}: Check, empty`);
      if (!full) return;
      await page.getByTestId('workshop-step-0').tap();
      await page.getByTestId('workshop-pick-landmark2').tap();
      await page.getByTestId('workshop-step-2').tap();
      await page.getByTestId('workshop-file').setInputFiles(glb('floating.glb', mistakeModels().floating));
      await expect(page.getByTestId('workshop-note').locator('h4')).toHaveText('It floats above the ground', {
        timeout: 60_000,
      });
      await check(page, `${tag}: Check, a note`);
      await phoneShot(page, `m47-phone-${tag}-note`);
      await page.getByTestId('workshop-file').setInputFiles(glb('pavilion.glb', testModels().good));
      await expect(page.getByTestId('workshop-ok')).toBeVisible({ timeout: 60_000 });
      // 4 See
      await page.getByTestId('workshop-next').tap();
      await expect(page.getByTestId('workshop-canvas')).toBeVisible();
      await page.getByTestId('workshop-night').tap();
      await check(page, `${tag}: See`);
      await phoneShot(page, `m47-phone-${tag}-see`);
      // 5 Use
      await page.getByTestId('workshop-next').tap();
      await page.getByTestId('workshop-add').tap();
      await expect(page.getByTestId('workshop-added')).toBeVisible({ timeout: 30_000 });
      await check(page, `${tag}: Use`);
    });
  });
}
