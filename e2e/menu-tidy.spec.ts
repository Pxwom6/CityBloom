import { devices, expect, test, type Page } from '@playwright/test';
import { auditButtons, clickMain, mainButton, skipGraphicsCheck, watchErrors } from './helpers';

/**
 * The tidied main menu (Menu tidy): Continue, Play, Multiplayer, Create and Settings; each sub-menu in
 * place of the main buttons with Back, Esc and the back gesture; the week's card; the quiet row; joining
 * with a code; the tutorial for a new player; My buildings' small town; phones and the 140 % size.
 */

async function booted(page: Page, mode: 'menu' | 'play') {
  await page.waitForFunction(
    (m) => window.__game?.ready === true && window.__game.getShell().mode === m,
    mode,
    { timeout: 120_000 },
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
}

const shell = (page: Page) => page.evaluate(() => window.__game!.getShell());
const menu = (page: Page) => page.getByTestId('main-menu');

async function quietMenu(page: Page, settings: Record<string, unknown> = {}) {
  await skipGraphicsCheck(page);
  await page.addInitScript((s) => {
    const key = 'citybloom.settings';
    const was = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...was, reportsNotice: true, ...s }));
  }, settings);
  await page.goto('./');
  await booted(page, 'menu');
}

/** Buttons, fields and the week's card on show in the menu, with their sizes. */
async function stops(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="main-menu"] :is(button, input)')]
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.dataset.testid ?? el.textContent?.trim() ?? '', w: r.width, h: r.height };
      }),
  );
}

test('the main menu: a short top level, sub-menus in place, keys and the back gesture', async ({ page }) => {
  test.setTimeout(300_000);
  const errs = watchErrors(page);
  await quietMenu(page);

  // A new player: Play first and primary with the tutorial under it, then Multiplayer, Create, Settings.
  await expect(page.getByTestId('main-continue')).toHaveCount(0);
  await expect(page.getByTestId('main-play')).toHaveClass(/primary/);
  await expect(page.getByTestId('main-tutorial')).toContainText('Start with the tutorial');
  for (const id of ['main-multiplayer', 'main-create', 'main-settings', 'main-challenge'])
    await expect(page.getByTestId(id)).toBeVisible();
  // The rest have moved into the sub-menus, or to the quiet row by the version.
  for (const id of ['main-new', 'main-load', 'main-friends', 'main-match', 'main-editor', 'main-learn'])
    await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByTestId('main-challenge-line')).toContainText(/This week|Weekly challenge/);
  const foot = page.getByTestId('shell-foot');
  await expect(foot.getByTestId('main-submit')).toBeVisible();
  await expect(foot.getByTestId('main-report')).toBeVisible();
  await expect(foot).toContainText('Version');
  expect(await auditButtons(page, 'main menu')).toEqual([]);

  // Each sub-menu opens in place (no new screen) with Back, and Back returns to the main buttons.
  for (const [sub, ids] of [
    ['play', ['main-new', 'main-load', 'main-scenarios', 'main-learn']],
    ['multiplayer', ['main-join-code', 'main-friends', 'main-match']],
    ['create', ['main-buildings', 'main-editor']],
  ] as const) {
    await page.getByTestId(`main-${sub}`).click();
    await expect(menu(page)).toHaveAttribute('data-sub', sub);
    expect(await shell(page)).toMatchObject({ screens: ['main'], menu: sub });
    for (const id of ids) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId('main-challenge')).toHaveCount(0);
    expect(await auditButtons(page, `${sub} menu`)).toEqual([]);
    await page.screenshot({ path: `test-results/menu-tidy-${sub}.png` });
    await page.getByTestId('main-back').click();
    await expect(menu(page)).toHaveAttribute('data-sub', '');
    // The button that opened it has the focus back.
    await expect(page.getByTestId(`main-${sub}`)).toBeFocused();
  }

  // Esc backs out of a sub-menu; so does the browser's Back (a phone's back gesture).
  await page.getByTestId('main-create').click();
  await expect(menu(page)).toHaveAttribute('data-sub', 'create');
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveAttribute('data-sub', '');
  expect((await shell(page)).screens).toEqual(['main']);
  await page.getByTestId('main-play').click();
  await expect(menu(page)).toHaveAttribute('data-sub', 'play');
  await page.goBack();
  await expect(menu(page)).toHaveAttribute('data-sub', '');
  expect((await shell(page)).mode).toBe('menu');

  // By keyboard: the arrows step through the buttons, Enter opens; into a sub-menu its first button
  // has the focus.
  await page.locator('body').click({ position: { x: 1200, y: 40 } });
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('main-play')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('main-tutorial')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('main-multiplayer')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(menu(page)).toHaveAttribute('data-sub', 'multiplayer');
  await expect(page.getByTestId('main-friends')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('main-match')).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(page.getByTestId('main-join-kind-match')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toHaveAttribute('data-sub', '');
  await expect(page.getByTestId('main-multiplayer')).toBeFocused();

  // A screen opened from a sub-menu comes back to it, by its own Back and by the back gesture.
  await clickMain(page, 'main-load');
  expect(await shell(page)).toMatchObject({ screens: ['main', 'load'], menu: 'play' });
  await page.getByTestId('shell-back').click();
  await expect(menu(page)).toHaveAttribute('data-sub', 'play');
  await page.getByTestId('main-scenarios').click();
  await expect(page.getByTestId('scenario-screen')).toBeVisible();
  await page.goBack();
  await expect(menu(page)).toHaveAttribute('data-sub', 'play');
  expect((await shell(page)).screens).toEqual(['main']);
  // The back gesture again: out of the sub-menu.
  await page.goBack();
  await expect(menu(page)).toHaveAttribute('data-sub', '');

  // The map editor keeps its note; the helpers find buttons on either level.
  await expect(await mainButton(page, 'main-editor')).toContainText('make and share your own maps');
  await expect(await mainButton(page, 'main-settings')).toBeVisible();
  errs.check();
});

test('join with a code: a city or a match at once, a region by way of Play with friends', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await quietMenu(page);
  await clickMain(page, 'main-join-code');
  const code = page.getByTestId('main-join-code');
  const join = page.getByTestId('main-join');
  await expect(join).toBeDisabled();
  // A code that can't be one says so, in the room's words.
  await code.fill('ABC');
  await join.click();
  await expect(page.getByTestId('main-join-problem')).toContainText('six letters and numbers');
  // A peer-to-peer code without its key.
  await code.fill('A7KQ2M');
  await page.getByTestId('main-join-kind-match').click();
  await expect(page.getByTestId('main-join-problem')).toHaveCount(0);
  await code.press('Enter');
  await expect(page.getByTestId('main-join-problem')).toContainText('a match on someone’s computer');
  // A region: Play with friends opens with the code filled in, to choose the city to bring.
  await code.fill('4rt9kw');
  await page.getByTestId('main-join-kind-region').click();
  await expect(page.getByTestId('main-join-hint')).toContainText('region');
  await join.click();
  await expect(page.getByTestId('friends-screen')).toBeVisible();
  await expect(page.getByTestId('friends-region-code')).toHaveValue('4RT9KW');
  await page.getByTestId('shell-back').click();
  await expect(menu(page)).toHaveAttribute('data-sub', 'multiplayer');
  // A shared city: straight into the room (the name is asked on the way in, as an invite link does).
  await page.getByTestId('main-join-kind-city').click();
  await code.fill('7KQ2MX');
  await Promise.all([page.waitForURL(/\?join=7KQ2MX$/), join.click()]);
  await expect(page.getByTestId('join-name')).toBeVisible({ timeout: 60_000 });
});

test('a new player starts the tutorial from under Play; Create opens My buildings in a small town', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const errs = watchErrors(page);
  await quietMenu(page);
  await page.getByTestId('main-tutorial').click();
  await booted(page, 'play');
  await expect
    .poll(async () => (await page.evaluate(() => window.__game!.getTutorial())).step)
    .not.toBeNull();
  await expect(page.getByTestId('tutorial').first()).toBeVisible();

  // Back to the menu (the city is saved on the way), then Create → My buildings: the Workshop's town,
  // never saved.
  await page.getByTestId('menu-button').click();
  await page.getByTestId('pause-quit').click();
  await booted(page, 'menu');
  await expect(page.getByTestId('main-continue')).toBeVisible();
  await expect(page.getByTestId('main-play')).not.toHaveClass(/primary/);
  await expect(page.getByTestId('main-tutorial')).toHaveCount(0);
  await clickMain(page, 'main-buildings');
  await booted(page, 'play');
  await expect(page.getByTestId('buildings-panel')).toBeVisible();
  await expect(page.getByTestId('workshop')).toBeVisible();
  expect((await shell(page)).slot).toBeNull();
  expect(await page.evaluate(() => window.__game!.autosaveNow())).toBe(false);
  expect(page.url()).not.toContain('workshop');
  await page.screenshot({ path: 'test-results/menu-tidy-workshop-town.png' });
  errs.check();
});

test('the menu at the 140 % interface size: every button can be reached', async ({ page }) => {
  test.setTimeout(240_000);
  await quietMenu(page, { uiScale: 1.4 });
  for (const sub of ['', 'play', 'multiplayer', 'create']) {
    if (sub) await page.getByTestId(`main-${sub}`).click();
    await expect(menu(page)).toHaveAttribute('data-sub', sub);
    for (const s of await stops(page)) {
      const el = page.getByTestId(s.id).first();
      if (!(await el.count())) continue;
      await el.scrollIntoViewIfNeeded();
      await expect(el, `${s.id} in ${sub || 'the main level'}`).toBeInViewport();
    }
    if (sub) await page.getByTestId('main-back').click();
  }
});

for (const [name, orient] of [
  ['iPhone 13', 'portrait'],
  ['iPhone 13', 'landscape'],
  ['Pixel 7', 'portrait'],
  ['Pixel 7', 'landscape'],
] as const) {
  test.describe(`${name} ${orient}`, () => {
    const { defaultBrowserType: _browser, viewport, ...rest } = devices[name]!;
    test.use({
      ...rest,
      viewport: orient === 'landscape' ? { width: viewport.height, height: viewport.width } : viewport,
    });

    test(`the menu by touch, every press at least 44 px (${name}, ${orient})`, async ({ page }) => {
      test.setTimeout(240_000);
      const errs = watchErrors(page);
      await quietMenu(page);
      for (const sub of ['', 'play', 'multiplayer', 'create']) {
        if (sub) await page.getByTestId(`main-${sub}`).tap();
        await expect(menu(page)).toHaveAttribute('data-sub', sub);
        const small = (await stops(page)).filter((s) => s.h < 44 || s.w < 44);
        expect(small, `presses under 44 px in ${sub || 'the main level'}`).toEqual([]);
        for (const s of await stops(page)) {
          const el = page.getByTestId(s.id).first();
          if (!(await el.count())) continue;
          await el.scrollIntoViewIfNeeded();
          await expect(el).toBeInViewport();
        }
        const tag = `${name.split(' ')[0]!.toLowerCase()}-${orient}`;
        await page.screenshot({ path: `test-results/menu-tidy-${tag}-${sub || 'top'}.png` });
        if (sub) {
          await page.getByTestId('main-back').tap();
          await expect(menu(page)).toHaveAttribute('data-sub', '');
        }
      }
      // A phone keeps the map editor's note.
      await expect(await mainButton(page, 'main-editor', { tap: true })).toContainText(
        'needs a tablet or a computer',
      );
      errs.check();
    });
  });
}
