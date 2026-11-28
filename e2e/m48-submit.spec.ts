import { randomBytes } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { closeContextsAfterEach, newContext } from './helpers';
import { testModels } from '../scripts/lib/makeGlb';

closeContextsAfterEach();

/**
 * M48, Send it in, through the real UI against the local relay (its owner key is
 * `e2e-owner-key-0123456789`): a player sends an idea with a picture of the game and a building from
 * My buildings, seeing exactly what goes first; the owner area shows both, accepts the idea with a
 * reply and declines the building; the player sees both statuses and replies; Accepted ideas shows only
 * the accepted one. Nothing is reachable without the owner key, a token reads only its own, and a
 * modified client is held to the day's cap.
 */
const RELAY = 'http://127.0.0.1:8787';
const KEY = 'e2e-owner-key-0123456789';

async function player(browser: Browser): Promise<Page> {
  const ctx = await newContext(browser, { viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(
      key,
      JSON.stringify({ ...s, tips: false, graphicsChecked: true, quality: 'low', timelapse: false }),
    );
  });
  return page;
}

test('an idea and a building sent, one accepted and one declined, and the player sees both', async ({
  browser,
}) => {
  test.setTimeout(420_000);
  const page = await player(browser);
  await page.goto('./?seed=sendit&preset=river&paused=1');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  // A building of the player's own, in My buildings.
  const added = await page.evaluate(
    (b64) => window.__game!.addMyBuilding(b64, 'Clock pavilion', { kind: 'landmark', size: 2 }),
    Buffer.from(testModels().good).toString('base64'),
  );
  expect(added.ok).toBe(true);

  // An idea, from the pause menu, with a picture of the game.
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-submit').click();
  await expect(page.getByTestId('submit-screen')).toBeVisible();
  await page.getByTestId('submit-about').selectOption('feature');
  await page.getByTestId('submit-title').fill('Roof gardens on tram depots');
  await page
    .getByTestId('submit-text')
    .fill('A green roof on the tram depot.\nIt would look lovely from above.');
  await page.getByTestId('submit-shot').check();
  await expect(page.getByTestId('submit-shot-preview')).toBeVisible();
  await page.getByTestId('submit-credit').fill('Ada');
  await page.getByTestId('submit-review').click();
  // Exactly what will be sent, and who sees it.
  await expect(page.getByTestId('submit-preview-title')).toHaveText('Roof gardens on tram depots');
  await expect(page.getByTestId('submit-preview-credit')).toHaveText('Ada');
  await expect(page.getByTestId('submit-who')).toContainText("Only the game's maker will see it");
  await page.screenshot({ path: 'docs/screenshots/m48-preview.png' });
  await page.getByTestId('submit-send').click();
  await expect(page.getByTestId('submit-mine-row')).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId('submit-status').first()).toHaveText('Sent');
  // Back to the pause menu, then on with the game.
  await page.getByTestId('submit-close').click();
  await page.getByTestId('pause-resume').click();

  // A building, from its row in My buildings.
  await page.evaluate(() => window.__game!.openPanel('buildings'));
  await page.getByTestId(`buildings-send-${added.hash}`).click();
  await expect(page.getByTestId('submit-model')).toHaveValue(added.hash!);
  await page.getByTestId('submit-line').fill('A little clock tower for a town square');
  await page.getByTestId('submit-credit').fill('Ada');
  await page.getByTestId('submit-review').click();
  await expect(page.getByTestId('submit-preview-title')).toContainText('Clock pavilion');
  await page.getByTestId('submit-send').click();
  await expect(page.getByTestId('submit-mine-row')).toHaveCount(2, { timeout: 20_000 });
  await page.getByTestId('submit-close').click();

  // The owner area: both there; accept the idea with a reply, decline the building.
  const owner = await (await newContext(browser, { viewport: { width: 1200, height: 900 } })).newPage();
  await owner.goto('./owner.html');
  await owner.getByTestId('owner-key').fill(KEY);
  await owner.getByTestId('owner-signin-go').click();
  await owner.getByTestId('owner-section-submissions').click();
  // Both there (the phone runs' sends may be there too: the test relay is shared).
  await expect(owner.locator('.owner-entry', { hasText: 'Roof gardens on tram depots' })).toHaveCount(1, {
    timeout: 20_000,
  });
  await expect(owner.locator('.owner-entry', { hasText: 'Clock pavilion' })).toHaveCount(1);
  const ideaRow = owner.locator('.owner-entry', { hasText: 'Roof gardens on tram depots' });
  await ideaRow.locator('.owner-entry-line').click();
  await expect(owner.getByTestId('owner-sub-text')).toContainText('It would look lovely from above.');
  await expect(owner.getByTestId('owner-sub-shot')).toBeVisible();
  await owner.getByTestId('owner-sub-reply').fill('Coming in the next update: thank you!');
  await owner.getByTestId('owner-sub-accept').click();
  await expect(owner.getByTestId('owner-toast')).toContainText('accepted');
  const buildingRow = owner.locator('.owner-entry', { hasText: 'Clock pavilion' });
  await buildingRow.locator('.owner-entry-line').click();
  await expect(owner.getByTestId('owner-sub-preview')).toBeVisible();
  await expect(owner.getByTestId('owner-sub-check')).toContainText("passes the game's check", {
    timeout: 30_000,
  });
  await owner.screenshot({ path: 'docs/screenshots/m48-owner.png' });
  const [download] = await Promise.all([
    owner.waitForEvent('download'),
    owner.getByTestId('owner-sub-download').click(),
  ]);
  expect(download.suggestedFilename()).toBe('clock-pavilion-by-ada.glb');
  await owner.getByTestId('owner-sub-reply').fill('Not this time: we have a clock tower already');
  await owner.getByTestId('owner-sub-decline').click();
  await expect(owner.getByTestId('owner-toast')).toContainText('declined');

  // The player sees both statuses and replies.
  await page.getByTestId('menu-button').click();
  await page.getByTestId('pause-submit').click();
  await page.getByTestId('submit-tab-mine').click();
  const rows = page.getByTestId('submit-mine-row');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('[data-testid="submit-mine-row"][data-status="accepted"]')).toContainText(
    'Coming in an update',
  );
  await expect(page.locator('[data-testid="submit-mine-row"][data-status="accepted"]')).toContainText(
    'Coming in the next update: thank you!',
  );
  await expect(page.locator('[data-testid="submit-mine-row"][data-status="declined"]')).toContainText(
    'Not this time',
  );
  await page.screenshot({ path: 'docs/screenshots/m48-mine.png' });
  // Accepted ideas: the accepted one with its credit, never the declined one (nor the phone runs'
  // sends, none of them accepted: the test relay is shared by the whole run).
  await page.getByTestId('submit-tab-accepted').click();
  const ours = page.getByTestId('accepted-row').filter({ hasText: 'Roof gardens on tram depots' });
  await expect(ours).toHaveCount(1);
  await expect(ours).toContainText('from Ada');
  await expect(page.getByTestId('accepted-list')).not.toContainText('Clock pavilion');

  // Nothing reachable without the owner key; a token reads only its own; the day's cap holds.
  const r = page.request;
  expect((await r.get(`${RELAY}/owner/submissions`)).status()).toBe(401);
  expect(
    (
      await r.get(`${RELAY}/owner/submissions/1`, {
        headers: { authorization: 'Bearer wrong-key-0123456789x' },
      })
    ).status(),
  ).toBe(401);
  // Another browser's token, new each run.
  const other = randomBytes(16).toString('hex');
  expect(
    await (
      await r.post(`${RELAY}/submit/mine`, {
        headers: { 'content-type': 'text/plain' },
        data: JSON.stringify({ token: other }),
      })
    ).json(),
  ).toEqual({ mine: [] });
  const accepted = (await (await r.get(`${RELAY}/submit/accepted`)).json()) as {
    accepted: { title: string }[];
  };
  const titles = accepted.accepted.map((a) => a.title);
  expect(titles.filter((t) => t === 'Roof gardens on tram depots')).toHaveLength(1);
  // Nothing accepted but what the owner accepted: not the declined building, not the waiting ones.
  for (const t of titles) expect(t).not.toMatch(/Clock pavilion|ferry|Ferry|Night markets|Market hall/);
  // A modified client sending as fast as it likes: refused once the day's few are used (5 a browser;
  // the cap per address, 5 online too, is raised for the test relay, where every page is 127.0.0.1).
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const res = await r.post(`${RELAY}/submit`, {
      headers: { 'content-type': 'text/plain' },
      data: JSON.stringify({ token: other, kind: 'idea', about: 'other', title: `Spam ${i}`, text: 'More' }),
    });
    statuses.push(res.status());
  }
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  // And a body past the cap is refused before it's read.
  const huge = await r.post(`${RELAY}/submit`, {
    headers: { 'content-type': 'text/plain' },
    data: 'x'.repeat(1_600_000),
  });
  expect(huge.status()).toBe(413);
});
