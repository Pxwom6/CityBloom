import { expect, test, type Page } from '@playwright/test';
import { shot, skipGraphicsCheck, watchErrors } from './helpers';
import { SCENARIOS } from '../src/data/scenarios';

const N = SCENARIOS.length;

async function booted(page: Page, mode: 'menu' | 'play') {
  await page.waitForFunction(
    (m) => window.__game?.ready === true && window.__game.getShell().mode === m,
    mode,
    { timeout: 90_000 },
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
}

const scenario = (page: Page) => page.evaluate(() => window.__game!.getScenario());

test('M18: pick a scenario from the menu, read the brief, follow the goals, win with stars kept on this device', async ({
  page,
}) => {
  test.setTimeout(480_000);
  const errs = watchErrors(page);
  await skipGraphicsCheck(page);
  await page.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, tips: false }));
  });
  await page.goto('./');
  await booted(page, 'menu');

  // --- The scenario screen: every scenario with a preview, none won yet. ---
  await page.getByTestId('main-scenarios').click();
  await expect(page.getByTestId('scenario-screen')).toBeVisible();
  await expect(page.locator('.scenario-item')).toHaveCount(N);
  await expect(page.getByTestId('scenario-screen')).toContainText(`0 of ${N} won`);
  await page.getByTestId('scenario-gridlock').click();
  await expect(page.getByTestId('scenario-detail')).toContainText('Gridlock');
  await expect(page.getByTestId('scenario-goals')).toContainText('Average commute under 3 minutes');
  // The previews load (the images are shipped beside the saves).
  await expect
    .poll(() =>
      page.evaluate(() => (document.querySelector('.scenario-preview') as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await shot(page, 'm18-scenarios');

  // --- Play: the starting city opens paused with the brief. ---
  await page.getByTestId('scenario-play').click();
  await booted(page, 'play');
  await expect(page.getByTestId('scenario-brief')).toBeVisible();
  await expect(page.getByTestId('scenario-brief')).toContainText('Twin Fords');
  let sc = await scenario(page);
  expect(sc.summary).toMatchObject({ id: 'gridlock', status: 'playing' });
  expect(sc.brief).toBe(true);
  await shot(page, 'm18-brief');
  await page.getByTestId('scenario-begin').click();
  await expect(page.getByTestId('scenario-brief')).toBeHidden();

  // --- G opens the goals, except while the road tool is open, which takes G for grid snap. ---
  await page.getByTestId('tool-road').click();
  const snap = page.getByTestId('grid-snap');
  const before = await snap.getAttribute('aria-pressed');
  await page.keyboard.press('g');
  await expect(snap).not.toHaveAttribute('aria-pressed', before ?? 'false');
  await expect(page.getByTestId('goals-panel')).toBeHidden();
  await page.keyboard.press('g');
  await expect(snap).toHaveAttribute('aria-pressed', before ?? 'false');
  await page.getByTestId('tool-select').click();
  await page.keyboard.press('g');
  await expect(page.getByTestId('goals-panel')).toBeVisible();
  await page.keyboard.press('g');
  await expect(page.getByTestId('goals-panel')).toBeHidden();

  // --- The goals panel from the top bar. ---
  await page.getByTestId('open-goals').click();
  await expect(page.getByTestId('goals-panel')).toBeVisible();
  await expect(page.getByTestId('goal')).toHaveCount(2);
  await expect(page.getByTestId('goals-time')).toContainText('left');
  await page.evaluate(() => window.__game!.setSpeed(0));
  await shot(page, 'm18-goals');

  // --- Fix the jam: widen the track, open a second route. ---
  const fixed = await page.evaluate(async () => {
    const g = window.__game!;
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    const track = g.segmentAt(c.x + 290, c.z);
    const up =
      track?.type === 'dirt'
        ? await g.dispatch({ type: 'upgradeRoad', seg: track.id, road: 'avenue' })
        : { ok: false };
    const by = await g.dispatch({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: c.x + 300, z: c.z - 240 },
        { x: c.x + 410, z: c.z - 230 },
      ],
    });
    return up.ok && by.ok;
  });
  expect(fixed).toBe(true);
  // Three month closes with short commutes.
  await page.evaluate(async () => {
    const g = window.__game!;
    for (let k = 0; k < 4; k++) {
      await g.advance(1440);
      if (g.getScenario().end) break;
    }
  });
  await expect(page.getByTestId('scenario-end')).toBeVisible();
  sc = await scenario(page);
  expect(sc.end).toMatchObject({ won: true });
  expect(sc.end!.stars).toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId('scenario-end')).toContainText('Scenario won!');
  await shot(page, 'm18-won');

  // --- Keep playing, then on to the next scenario: the stars are kept on this device. ---
  await page.getByTestId('scenario-keep').click();
  await expect(page.getByTestId('scenario-end')).toBeHidden();
  await expect(page.getByTestId('open-goals')).toContainText('2/2');
  await page.evaluate(() => {
    location.href = `${location.pathname}?screen=scenarios&pick=gridlock`;
  });
  await booted(page, 'menu');
  await expect(page.getByTestId('scenario-screen')).toBeVisible();
  await expect(page.getByTestId('scenario-screen')).toContainText(`1 of ${N} won`);
  await expect(page.getByTestId('scenario-best')).toBeVisible();
  const stars = await page.evaluate(() => JSON.parse(localStorage.getItem('citybloom.scenarios') ?? '{}'));
  expect(stars.gridlock.stars).toBe(sc.end!.stars);
  await shot(page, 'm18-scenarios-won');
  errs.check();
});
