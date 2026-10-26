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

/** Buttons in `scope` that are off the window or covered where a finger would tap them. */
async function unreachable(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const bad: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const b of document.querySelectorAll<HTMLElement>(`[data-testid="${scope}"] button`)) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const name = b.dataset.testid ?? b.getAttribute('aria-label') ?? (b.textContent ?? '').trim();
      const at = `${Math.round(r.left)}..${Math.round(r.right)} x ${Math.round(r.top)}..${Math.round(r.bottom)}`;
      if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) {
        bad.push(`${name} is outside the ${vw}x${vh} window (${at})`);
        continue;
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === b || b.contains(hit)))
        bad.push(`${name} is covered by ${hit?.tagName}.${hit?.className} (${at})`);
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
      // Every "look here" label as it appears (each lasts three seconds).
      const pings: string[] = [];
      (window as unknown as { __pings: string[] }).__pings = pings;
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('.presence-name.ping'))
          if (el.textContent && !pings.includes(el.textContent)) pings.push(el.textContent);
      }).observe(document, { childList: true, subtree: true });
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

    // F11: in a room every button on the top bar can still be tapped (on more rows on a phone), and
    // an open panel sits below it, not over it.
    expect(await unreachable(page, 'topbar'), 'top bar over the room panel').toEqual([]);
    // (A tap on this VM's software renderer is now and then lost under load: tap again until it closes.)
    await expect(async () => {
      await page.getByTestId('room-panel').getByRole('button', { name: 'Close' }).tap();
      await expect(page.getByTestId('room-panel')).toHaveCount(0, { timeout: 3000 });
    }).toPass({ timeout: 30_000 });
    expect(await unreachable(page, 'topbar'), 'top bar in a room').toEqual([]);
    await page.screenshot({ path: `docs/screenshots/m33-topbar-${label}.png` });
    // A ping by touch: the room panel's button, then a tap on the map.
    await page.getByTestId('room-chip').tap();
    await page.getByTestId('room-ping').tap();
    await expect(page.getByTestId('room-panel')).toHaveCount(0);
    await page.touchscreen.tap(size.width / 2, size.height / 2);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __pings: string[] }).__pings))
      .toContain('You: look here');
  });
}
