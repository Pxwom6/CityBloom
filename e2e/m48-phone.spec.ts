import { expect, test, type Page } from '@playwright/test';
import { closeContextsAfterEach } from './helpers';
import { phone, phoneProblems, phoneShot, type Orient } from './phone';
import { frames } from './ui';
import { testModels } from '../scripts/lib/makeGlb';

closeContextsAfterEach();

/**
 * M48 on phones, by touch: an iPhone and an Android phone, each upright and sideways. Send it in opens
 * from the menu; the form, what will be sent, What I sent and Accepted ideas are checked for what a
 * finger needs (nothing off the screen, presses of 44 px). An idea with a picture goes on every one;
 * on two of them a building from My buildings goes too.
 */
const cases: [string, Orient, boolean][] = [
  ['iPhone 13', 'portrait', true],
  ['iPhone 13', 'landscape', false],
  ['Pixel 7', 'portrait', false],
  ['Pixel 7', 'landscape', true],
];

async function check(p: Page, where: string): Promise<void> {
  await frames(p, 2);
  expect(await phoneProblems(p, '[data-testid=submit-screen]'), where).toEqual([]);
}

for (const [device, orient, full] of cases) {
  test.describe(`${device} ${orient}`, () => {
    test.use({ ...phone(device, orient) });
    test(`Send it in by touch${full ? ', a building too' : ''}`, async ({ page }) => {
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
      await page.goto('./?seed=sendphone&preset=river&name=Pocketton');
      await page.waitForFunction(
        () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
        null,
        { timeout: 120_000 },
      );
      await page.evaluate(() => window.__game!.setSpeed(0));
      // An idea, from the menu, with a picture of the game.
      await page.getByTestId('menu-button').tap();
      await page.getByTestId('pause-submit').tap();
      await expect(page.getByTestId('submit-screen')).toBeVisible();
      await check(page, `${tag}: the form`);
      await page.getByTestId('submit-about').selectOption('scenario');
      await page.getByTestId('submit-title').fill(`A ferry town (${tag})`);
      await page.getByTestId('submit-text').fill('An island town where everything comes by boat.');
      await page.getByTestId('submit-shot').tap();
      await expect(page.getByTestId('submit-shot-preview')).toBeVisible();
      await check(page, `${tag}: the form, a picture`);
      await phoneShot(page, `m48-phone-${tag}-form`);
      await page.getByTestId('submit-review').tap();
      await expect(page.getByTestId('submit-who')).toBeVisible();
      await check(page, `${tag}: what will be sent`);
      await phoneShot(page, `m48-phone-${tag}-preview`);
      await page.getByTestId('submit-send').tap();
      await expect(page.getByTestId('submit-mine-row')).toHaveCount(1, { timeout: 20_000 });
      await check(page, `${tag}: What I sent`);
      await page.getByTestId('submit-tab-accepted').tap();
      await expect(page.getByTestId('accepted-list').or(page.getByTestId('accepted-empty'))).toBeVisible();
      await check(page, `${tag}: Accepted ideas`);
      await page.getByTestId('submit-close').tap();
      await page.getByTestId('pause-resume').tap();
      if (!full) return;
      // A building of the player's own, sent from its row in My buildings.
      const added = await page.evaluate(
        (b64) => window.__game!.addMyBuilding(b64, 'Ferry kiosk', { kind: 'landmark', size: 2 }),
        Buffer.from(testModels().good).toString('base64'),
      );
      expect(added.ok).toBe(true);
      await page.getByTestId('tool-build').tap();
      await page.getByTestId('tool-landmark').tap();
      await page.getByTestId('place-mybuildings').tap();
      await page.getByTestId(`buildings-send-${added.hash}`).tap();
      await expect(page.getByTestId('submit-model')).toHaveValue(added.hash!);
      await page.getByTestId('submit-line').fill('Where the ferry tickets are sold');
      await check(page, `${tag}: a building`);
      await page.getByTestId('submit-review').tap();
      await check(page, `${tag}: a building, what will be sent`);
      await page.getByTestId('submit-send').tap();
      await expect(page.getByTestId('submit-mine-row')).toHaveCount(2, { timeout: 20_000 });
      await phoneShot(page, `m48-phone-${tag}-mine`);
    });
  });
}
