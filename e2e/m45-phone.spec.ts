import { expect, test, type Page } from '@playwright/test';
import { closeContextsAfterEach } from './helpers';
import { phone, phoneProblems, type Orient } from './phone';
import { frames } from './ui';

closeContextsAfterEach();

/**
 * M45 on phones, by touch: an iPhone and an Android phone (Playwright's emulation), each upright and
 * sideways. A town records a few frames; City history (from the top bar's More) shows the Timelapse
 * line, and Make timelapse's card is checked for what a finger needs (nothing off the screen, presses
 * of 44 px). Upright on the iPhone and sideways on the Pixel, a 15 second video is made by touch and the
 * card is checked again with the video in it.
 */
const cases: [string, Orient, boolean][] = [
  ['iPhone 13', 'portrait', true],
  ['iPhone 13', 'landscape', false],
  ['Pixel 7', 'portrait', false],
  ['Pixel 7', 'landscape', true],
];

async function check(p: Page, scope: string, where: string): Promise<void> {
  await frames(p, 2);
  expect(await phoneProblems(p, scope), where).toEqual([]);
}

for (const [device, orient, make] of cases) {
  test.describe(`${device} ${orient}`, () => {
    test.use({ ...phone(device, orient) });
    test(`the timelapse by touch${make ? ', a video made' : ''}`, async ({ page }) => {
      test.setTimeout(make ? 420_000 : 200_000);
      const tag = `${device.replace(/ /g, '')}-${orient}`;
      await page.addInitScript(() => {
        const key = 'citybloom.settings';
        const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
        localStorage.setItem(
          key,
          JSON.stringify({ ...s, tips: false, graphicsChecked: true, reportsNotice: true }),
        );
      });
      await page.goto('./?seed=tlphone&preset=river&name=Pocketton');
      await page.waitForFunction(
        () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
        null,
        { timeout: 120_000 },
      );
      // A small town, and a few frames of each view (drawn on the phone's own canvas shape).
      await page.evaluate(async () => {
        const g = window.__game!;
        g.setSpeed(0);
        const s = await g.getState();
        const c = { x: 24, z: s.highwayZ };
        await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
        await g.dispatch({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 400, z: c.z }] });
        await g.dispatch({
          type: 'zone',
          zone: 'R',
          area: {
            kind: 'brush',
            points: [
              { x: c.x + 20, z: c.z - 40 },
              { x: c.x + 390, z: c.z - 40 },
            ],
            radius: 30,
          },
        });
      });
      for (let k = 0; k < 6; k++) {
        await page.evaluate(() => window.__game!.advance(720));
        const before = (await page.evaluate(() => window.__game!.getTimelapse())).captures;
        await page.evaluate(() => window.__game!.captureTimelapse());
        await page.waitForFunction(
          (n) => window.__game!.getTimelapse().then((t) => t.captures > n && !t.busy),
          before,
        );
      }
      const t = await page.evaluate(() => window.__game!.getTimelapse());
      expect(Math.min(t.frames.wide, t.frames.orbit)).toBeGreaterThanOrEqual(3);
      // City history: in the top bar's More on a phone.
      if (await page.getByTestId('open-more').isVisible()) await page.getByTestId('open-more').tap();
      await page.getByTestId('open-history').tap();
      await expect(page.getByTestId('timelapse-section')).toBeVisible();
      await check(page, '[data-testid=timelapse-section]', `${tag} timelapse line`);
      await page.getByTestId('timelapse-open').tap();
      await expect(page.getByTestId('timelapse-card')).toBeVisible();
      await check(page, '[data-testid=timelapse-card]', `${tag} card`);
      await page.screenshot({ path: `docs/screenshots/m45-${tag}-card.png`, scale: 'css' });
      if (!make) return;
      await page.getByTestId('timelapse-length-15').tap();
      await page.getByTestId('timelapse-make').tap();
      await expect(page.getByTestId('timelapse-result')).toBeVisible({ timeout: 300_000 });
      await check(page, '[data-testid=timelapse-card]', `${tag} card with the video`);
      const d = await page.evaluate(async () => {
        const el = document.querySelector<HTMLVideoElement>('[data-testid=timelapse-video]')!;
        if (el.readyState < 1)
          await new Promise((r) => el.addEventListener('loadedmetadata', r, { once: true }));
        return el.duration;
      });
      expect(d).toBeGreaterThan(14.7);
      await page.getByTestId('timelapse-result').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `docs/screenshots/m45-${tag}-video.png`, scale: 'css' });
    });
  });
}
