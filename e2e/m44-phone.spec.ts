import { expect, test, type Page } from '@playwright/test';
import { closeContextsAfterEach } from './helpers';
import { phone, phoneProblems, type Orient } from './phone';
import { frames } from './ui';

closeContextsAfterEach();

/**
 * M44 on phones, by touch: an iPhone and an Android phone (Playwright's emulation), each upright and
 * sideways. The main menu's challenge entry opens the challenge screen; its tabs, a group made and the
 * board are checked for what a finger needs (nothing off the screen, presses of 44 px). Upright on the
 * iPhone and sideways on the Pixel, the challenge is played to its end card (game time fast-forwarded)
 * and the score posted by touch; the run viewer's bar is checked too.
 */
const RELAY = 'http://127.0.0.1:8787';
const KEY = 'e2e-owner-key-0123456789';

/** The owner's short version of this week's challenge (as m44-challenge pins it), so a phone plays it out quickly. */
async function pinShort(): Promise<void> {
  const auth = { authorization: `Bearer ${KEY}` };
  const o = (await fetch(`${RELAY}/owner/challenge`, { headers: auth }).then((r) => r.json())) as {
    now: number;
    challenge: Record<string, unknown>;
  };
  const def = {
    ...o.challenge,
    name: 'Six-month town',
    brief: 'A quick one for the tests. You have six months.',
    seed: 'cl13',
    preset: 'lakes',
    twist: 'none',
    months: 6,
    funds: 60_000,
  };
  const r = await fetch(`${RELAY}/owner/challenge/pin`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ week: o.now, def }),
  });
  expect(r.ok).toBe(true);
}

async function check(p: Page, scope: string, where: string): Promise<void> {
  await frames(p, 2);
  expect(await phoneProblems(p, scope), where).toEqual([]);
}

const ready = (page: Page, mode: 'menu' | 'play') =>
  page.waitForFunction((m) => window.__game?.ready === true && window.__game.getShell().mode === m, mode, {
    timeout: 120_000,
  });

const cases: [string, Orient, boolean][] = [
  ['iPhone 13', 'portrait', true],
  ['iPhone 13', 'landscape', false],
  ['Pixel 7', 'portrait', false],
  ['Pixel 7', 'landscape', true],
];

for (const [device, orient, play] of cases) {
  test.describe(`${device} ${orient}`, () => {
    test.use({ ...phone(device, orient) });
    test(`the challenge by touch${play ? ', played to its end and posted' : ''}`, async ({ page }) => {
      test.setTimeout(play ? 420_000 : 180_000);
      const tag = `${device.replace(/ /g, '')}-${orient}`;
      await pinShort();
      await page.addInitScript(() => {
        const key = 'citybloom.settings';
        const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
        localStorage.setItem(
          key,
          JSON.stringify({ ...s, tips: false, graphicsChecked: true, reportsNotice: true }),
        );
      });
      await page.goto('./');
      await ready(page, 'menu');
      await expect(page.getByTestId('main-challenge-line')).toContainText('left');
      await page.getByTestId('main-challenge').tap();
      await expect(page.getByTestId('challenge-detail')).toBeVisible();
      await check(page, '[data-testid=challenge-screen]', `${tag} challenge screen`);
      await page.getByTestId('board-tab-friends').tap();
      await page.getByTestId('group-make').tap();
      await expect(page.getByTestId('group-made')).toBeVisible();
      await check(page, '[data-testid=challenge-screen]', `${tag} friends`);
      await page.getByTestId('board-tab-last').tap();
      await page.getByTestId('board-tab-week').tap();
      await page.screenshot({ path: `docs/screenshots/m44-${tag}-screen.png`, scale: 'css' });
      if (!play) return;

      // Played to its end, and the score posted, by touch.
      await page.getByTestId('challenge-play').tap();
      await ready(page, 'play');
      await expect(page.getByTestId('scenario-brief')).toBeVisible();
      await check(page, '[data-testid=scenario-brief]', `${tag} brief`);
      await page.getByTestId('scenario-begin').tap();
      for (let m = 0; m < 9 && !(await page.getByTestId('challenge-end').isVisible()); m++)
        await page.evaluate(() => window.__game!.advance(1440));
      await expect(page.getByTestId('challenge-end')).toBeVisible();
      await check(page, '[data-testid=challenge-end]', `${tag} end card`);
      await page.getByTestId('challenge-name-input').fill(device === 'Pixel 7' ? 'Pix' : 'Phoebe');
      await page.getByTestId('challenge-post').tap();
      await expect(page.getByTestId('challenge-post-result')).toContainText('On the board');
      await page.screenshot({ path: `docs/screenshots/m44-${tag}-end.png`, scale: 'css' });

      // The board on the phone, and someone's run watched there.
      await page.getByTestId('challenge-see-board').tap();
      await ready(page, 'menu');
      await expect(page.getByTestId('board-row').first()).toBeVisible();
      await check(page, '[data-testid=challenge-screen]', `${tag} board`);
      await page.getByTestId('board-row').first().getByRole('button', { name: 'Watch' }).tap();
      await ready(page, 'play');
      await expect(page.getByTestId('run-viewer')).toBeVisible();
      await check(page, '[data-testid=run-viewer]', `${tag} run viewer`);
      await page.screenshot({ path: `docs/screenshots/m44-${tag}-watch.png`, scale: 'css' });
    });
  });
}
