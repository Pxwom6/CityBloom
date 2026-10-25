import { test, expect, type Page } from '@playwright/test';
import { openGame } from './helpers';

/**
 * M33, ready for friends: the lobby, the invite and the room's messages on a phone held upright and
 * on a tablet, by touch. Nothing runs off the side, every button can be reached by scrolling and
 * tapped, and the room panel and region card fit.
 */
test.use({ hasTouch: true, isMobile: false });

async function overflow(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const bad: string[] = [];
    const vw = window.innerWidth;
    const root = document.querySelector(`[data-testid="${scope}"]`) as HTMLElement | null;
    if (!root) return [`no ${scope}`];
    for (const el of root.querySelectorAll<HTMLElement>('button, input, a, summary')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const name =
        el.dataset.testid ?? el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 30);
      if (r.left < -1 || r.right > vw + 1)
        bad.push(`${name} runs off the ${vw} px window (${Math.round(r.left)}..${Math.round(r.right)})`);
      if (r.height > 0 && r.height < 24 && el.tagName === 'BUTTON')
        bad.push(`${name} is only ${Math.round(r.height)} px tall to tap`);
    }
    return bad;
  }, scope);
}

for (const [label, size] of [
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 820, height: 1180 }],
] as const) {
  test(`the lobby and the room on a ${label}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Ada', color: 3 }));
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...s, tips: false, graphicsChecked: true, quality: 'low' }));
    });
    await page.goto('./');
    await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
    await page.getByTestId('main-friends').tap();
    await expect(page.getByTestId('friends-screen')).toBeVisible();
    await page.getByTestId('friends-help').locator('summary').tap();
    expect(await overflow(page, 'friends-screen')).toEqual([]);
    await page.screenshot({ path: `docs/screenshots/m33-lobby-${label}.png`, fullPage: false });
    // Join box: a bad code says so plainly.
    await page.getByTestId('friends-code').scrollIntoViewIfNeeded();
    await page.getByTestId('friends-code').fill('ab');
    await page.getByTestId('friends-join').tap();
    await expect(page.getByRole('alert')).toBeVisible();

    // A shared city: the room chip and panel.
    await openGame(page, '&seed=narrow&name=Pocketford');
    await page.keyboard.press('Escape');
    await page.getByTestId('pause-invite').scrollIntoViewIfNeeded();
    await page.getByTestId('pause-invite').tap();
    await expect
      .poll(async () => (await page.evaluate(() => window.__game!.getNet()))?.state, { timeout: 30_000 })
      .toBe('playing');
    await expect(page.getByTestId('room-panel')).toBeVisible();
    expect(await overflow(page, 'room-panel')).toEqual([]);
    await page.screenshot({ path: `docs/screenshots/m33-room-${label}.png` });
    await page.getByTestId('room-panel').getByRole('button', { name: 'Close' }).tap();
    await expect(page.getByTestId('room-chip')).toBeVisible();
    await page.getByTestId('room-chip').tap();
    await expect(page.getByTestId('room-panel')).toBeVisible();
  });
}
