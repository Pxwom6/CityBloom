import { expect, test, type Page } from '@playwright/test';
import { settings } from './ui';

/**
 * M39 review: the touch-target floor of 24 px holds at the smallest interface size too. A rem is
 * 16 px times the interface size, which runs down to 80 % (12.8 px), so a rule of 1.6rem gave 20.5 px
 * there. m39-narrow.spec.ts checks 24 px at 100 %; this one looks at 80 % on a phone, where every
 * control the narrow rules enlarge is shown at least once: a small button, a drop-down, a text and a
 * number field, a slider, the top bar's date and weather, and the lobby's help summary.
 */
test.use({ hasTouch: true, isMobile: false });

/** The controls the touch rule covers (main.css, "Touch targets"), by the name a failure reports. */
const COVERED: Record<string, string> = {
  'small button': '.btn.small',
  'drop-down': 'select',
  'text field': 'input[type="text"]',
  'number field': 'input[type="number"]',
  slider: 'input[type="range"]',
  'date and weather': '.topbar .stat-btn',
  'help summary': '.friends-help summary',
};

/** What the page shows of those controls: how many, of each, and the ones under 24 px tall to tap. */
async function touchTargets(page: Page): Promise<{ seen: Record<string, number>; short: string[] }> {
  return page.evaluate((covered) => {
    const seen: Record<string, number> = {};
    const short: string[] = [];
    for (const [name, selector] of Object.entries(covered)) {
      for (const el of document.querySelectorAll<HTMLElement>(`#ui ${selector}`)) {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (s.display === 'none' || s.visibility === 'hidden' || (r.width === 0 && r.height === 0)) continue;
        seen[name] = (seen[name] ?? 0) + 1;
        // (A rounded layout box: 23.99 px is a pixel-snapping artefact, not a short target.)
        if (r.height < 23.9) {
          const who = el.dataset.testid ?? (el.className || (el.textContent ?? '').trim().slice(0, 24));
          short.push(`${name} ${who} is ${r.height.toFixed(1)} px tall`);
        }
      }
    }
    return { seen, short };
  }, COVERED);
}

/** The window is a phone held upright at the smallest interface size, so the rules under test apply. */
async function atPhoneSize(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => ({
        rem: getComputedStyle(document.documentElement).fontSize,
        width: document.querySelector('#ui')?.getAttribute('data-width'),
      })),
    )
    .toEqual({ rem: '12.8px', width: 'xs' });
}

test('M39: touch targets are 24 px at the smallest interface size (80 %) on a phone', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await settings(page, { uiScale: 0.8, quality: 'low' });
  const seen: Record<string, number> = {};
  const short: string[] = [];
  const look = async (where: string) => {
    const t = await touchTargets(page);
    for (const [k, n] of Object.entries(t.seen)) seen[k] = (seen[k] ?? 0) + n;
    // (Each look sees what the page still shows from the look before: a control is listed once.)
    for (const x of t.short) if (!short.some((y) => y.endsWith(`: ${x}`))) short.push(`${where}: ${x}`);
  };

  // --- The menu's screens: the lobby (help summary), settings (drop-downs, sliders) and the new city. ---
  await page.goto('./');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await atPhoneSize(page);
  await page.getByTestId('main-friends').tap();
  await expect(page.getByTestId('friends-screen')).toBeVisible();
  await look('the lobby');
  await page.getByTestId('shell-back').tap();

  await page.getByTestId('main-settings').tap();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await look('settings');
  await page.getByTestId('shell-back').tap();

  await page.getByTestId('main-new').tap();
  await expect(page.getByTestId('new-game')).toBeVisible();
  await look('the new city screen');

  // --- A city: the top bar's date and weather button. ---
  await page.goto('./?paused=1');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await page.evaluate(() => window.__game!.waitFrames(2));
  await atPhoneSize(page);
  await look('the city');

  // --- The map editor: a drop-down (the climate). ---
  await page.goto('./?editor=new&flat=1');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await page.evaluate(() => window.__game!.waitFrames(2));
  await atPhoneSize(page);
  await look('the map editor');

  // --- A number field: the screens that have one (a room's spending limit, the war room's Send tab) need
  // a room or an army, so this stands one in the interface's own markup (the rule goes by element). ---
  await page.evaluate(() => {
    const field = document.createElement('input');
    field.type = 'number';
    field.dataset.testid = 'probe-number';
    document.querySelector('#ui')!.appendChild(field);
  });
  await look('a number field');

  // Every kind of control was on show at least once (or the check would pass for want of looking).
  expect(Object.keys(seen).sort(), 'the controls the check looked at').toEqual(Object.keys(COVERED).sort());
  expect(short, 'controls under 24 px to tap at 80 %').toEqual([]);
});
