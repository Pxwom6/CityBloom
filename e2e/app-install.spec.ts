import { expect, test, type Page } from '@playwright/test';
import { auditButtons, shot, skipGraphicsCheck, watchErrors } from './helpers';

const shell = (page: Page) => page.evaluate(() => window.__game!.getShell());

async function booted(page: Page, mode: 'menu' | 'play') {
  await page.waitForFunction(
    (m) => window.__game?.ready === true && window.__game.getShell().mode === m,
    mode,
    { timeout: 90_000 },
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
}

type Counters = { __persistAsked: number; __prompts: number };

/**
 * Count the game's requests to keep its storage and say yes, as a browser does for an installed app
 * (Chromium here would answer by its own rules). Runs before the page's own scripts.
 */
async function stubStorage(page: Page, standalone = false): Promise<void> {
  await page.addInitScript((standalone) => {
    const w = window as unknown as Counters;
    w.__persistAsked = 0;
    let kept = false;
    const s = navigator.storage;
    s.persisted = () => Promise.resolve(kept);
    s.persist = () => {
      w.__persistAsked++;
      kept = true;
      return Promise.resolve(true);
    };
    // The installed app's own window.
    if (standalone) {
      const match = window.matchMedia.bind(window);
      window.matchMedia = (q: string) =>
        q === '(display-mode: standalone)' ? ({ ...match(q), matches: true } as MediaQueryList) : match(q);
    }
  }, standalone);
}

const asked = (page: Page) => page.evaluate(() => (window as unknown as Counters).__persistAsked);

/** Chrome's offer to install (beforeinstallprompt), answered with `outcome`; true if the page took it. */
function offerInstall(page: Page, outcome: 'accepted' | 'dismissed'): Promise<boolean> {
  return page.evaluate((outcome) => {
    const w = window as unknown as Counters;
    w.__prompts = 0;
    const e = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: () => {
        w.__prompts++;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome }),
    });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }, outcome);
}

test('Install: Chrome and Edge install from the main menu; opening a city asks the browser to keep the saves', async ({
  page,
}) => {
  test.setTimeout(360_000);
  const errs = watchErrors(page);
  await skipGraphicsCheck(page);
  await stubStorage(page);
  await page.goto('./');
  await booted(page, 'menu');
  // A first visit's main menu doesn't ask yet (Firefox would put the question to the player).
  expect(await asked(page)).toBe(0);
  expect((await shell(page)).app).toMatchObject({ saves: 'unknown', installed: false });

  // The browser offers to install: the menu's button takes it, instead of the browser's own bar.
  const install = page.getByTestId('main-install');
  expect(await offerInstall(page, 'dismissed')).toBe(true);
  await expect(install).toBeVisible();
  await expect(page.getByTestId('install-note')).toHaveText('Its own icon and window, like any other app');
  expect((await shell(page)).app.install).toBe('prompt');
  expect(await auditButtons(page, 'main menu')).toEqual([]);
  // Turned down: an offer can be shown once, so the button goes until the next one.
  await install.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Counters).__prompts)).toBe(1);
  await expect(install).toHaveCount(0);

  expect(await offerInstall(page, 'accepted')).toBe(true);
  await expect(install).toBeVisible();
  await shot(page, 'install-menu');
  await install.click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Counters).__prompts)).toBe(1);
  // Installed: the button goes, the toast says where the game is now, and the browser is asked to
  // keep the saves (it says yes to installed apps).
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(install).toHaveCount(0);
  await expect(page.getByTestId('toast').filter({ hasText: 'Citybloom is installed' })).toBeVisible();
  await expect.poll(() => asked(page)).toBe(1);
  expect((await shell(page)).app).toMatchObject({ installed: true, install: null, saves: 'kept' });

  // The load screen says where cities are kept and how to move one.
  await page.getByTestId('main-load').click();
  await expect(page.getByTestId('saves-note')).toContainText('Cities are saved in this browser');
  await shot(page, 'install-load-note');
  await page.getByTestId('shell-back').click();

  // A new city (a page of its own) asks once it's open.
  await page.getByTestId('main-new').click();
  await page.getByTestId('new-name').fill('Keepsake');
  await page.getByTestId('new-tutorial').uncheck();
  await page.getByTestId('new-start').click();
  await booted(page, 'play');
  await expect.poll(() => asked(page)).toBe(1);
  expect((await shell(page)).app.saves).toBe('kept');
  errs.check();
});

test.describe('Safari', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  });

  test('Install: Safari on a Mac shows the steps to add the game to the Dock', async ({ page }) => {
    test.setTimeout(360_000);
    const errs = watchErrors(page);
    await skipGraphicsCheck(page);
    await stubStorage(page);
    await page.goto('./');
    await booted(page, 'menu');
    const install = page.getByTestId('main-install');
    const note = page.getByTestId('install-note');
    // Safari can't open an install dialog from a page: the button shows how instead.
    await expect(install).toBeVisible();
    await expect(install).toHaveAttribute('aria-expanded', 'false');
    await install.click();
    await expect(install).toHaveAttribute('aria-expanded', 'true');
    await expect(note).toContainText('File → Add to Dock');
    // Safari's app keeps its own storage: say how to bring a city across.
    await expect(note).toContainText('Export one, then Import it in the app');
    expect(await auditButtons(page, 'main menu (Safari)')).toEqual([]);
    await shot(page, 'install-safari');
    await install.click();
    await expect(note).toHaveText('Its own icon and window, like any other app');
    expect(await asked(page)).toBe(0);
    errs.check();
  });

  test('Install: the game opened from the Dock shows no button and asks to keep the saves at once', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const errs = watchErrors(page);
    await skipGraphicsCheck(page);
    await stubStorage(page, true);
    await page.goto('./');
    await booted(page, 'menu');
    await expect(page.getByTestId('main-menu')).toBeVisible();
    await expect(page.getByTestId('main-install')).toHaveCount(0);
    await expect.poll(() => asked(page)).toBe(1);
    expect((await shell(page)).app).toMatchObject({ installed: true, install: null, saves: 'kept' });
    errs.check();
  });
});
