import { execSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { shot, watchErrors } from './helpers';

const shell = (page: Page) => page.evaluate(() => window.__game!.getShell());
const state = (page: Page) => page.evaluate(() => window.__game!.getState());

async function booted(page: Page, mode: 'menu' | 'play') {
  await page.waitForFunction(
    (m) => window.__game?.ready === true && window.__game.getShell().mode === m,
    mode,
    {
      timeout: 90_000,
    },
  );
  await page.evaluate(() => window.__game!.waitFrames(2));
}

test('M15: first launch picks graphics; the app installs, plays offline after one visit, and takes an update', async ({
  page,
  context,
  baseURL,
  request,
}) => {
  test.setTimeout(480_000);
  // The same code built again with another build id is the "next deploy" (a real second build:
  // new hashed files, new index.html, new service worker).
  execSync('npx vite build --mode test --base /CityBloom/ --outDir dist-e2e-next', {
    env: { ...process.env, BUILD_ID: 'e2e-next' },
    stdio: 'ignore',
  });
  // The e2e server's switches (e2e/serve.mjs), at the host root.
  const server = async (path: string) =>
    expect((await request.get(new URL(path, baseURL).href)).ok()).toBe(true);
  const errs = watchErrors(page);
  try {
    // --- A first visit: the main menu, and a quick graphics check for this device. ---
    await page.goto('./');
    await booted(page, 'menu');
    await expect
      .poll(async () => (await shell(page)).settings.graphicsChecked, { timeout: 30_000 })
      .toBe(true);
    let sh = await shell(page);
    // Chromium here draws with SwiftShader, a software renderer: the light preset.
    expect(sh.graphics.result).toMatchObject({ preset: 'low', reason: 'software rendering' });
    expect(sh.settings).toMatchObject({
      quality: 'low',
      shadows: false,
      drawDistance: 'near',
      autoGraphics: 'low',
    });
    expect(sh.applied.pixelRatio).toBeLessThan(1);
    expect(sh.applied.shadows).toBe(false);
    await expect(
      page.getByTestId('toast').filter({ hasText: 'Graphics set to Low for this device' }),
    ).toBeVisible();
    const firstBuild = sh.build;
    expect(firstBuild).not.toBe('e2e-next');
    // Settings says what was picked and can check again.
    await page.getByTestId('main-settings').click();
    await expect(page.getByTestId('graphics-auto')).toContainText('Picked for this device: Low');
    await page.getByTestId('shell-back').click();

    // --- Installable: manifest, icons, share preview. ---
    const meta = await page.evaluate(async () => {
      const link = document.querySelector('link[rel=manifest]') as HTMLLinkElement;
      const manifest = await (await fetch(link.href)).json();
      const icons = await Promise.all(
        (manifest.icons as { src: string }[]).map(async (i) => {
          const r = await fetch(new URL(i.src, link.href));
          return `${r.status} ${r.headers.get('content-type')}`;
        }),
      );
      const og = (p: string) => document.querySelector(`meta[property="${p}"]`)?.getAttribute('content');
      return {
        href: link.getAttribute('href'),
        manifest,
        icons,
        title: og('og:title'),
        desc: og('og:description'),
      };
    });
    expect(meta.href).toBe('/CityBloom/manifest.webmanifest');
    expect(meta.manifest).toMatchObject({ name: 'Citybloom', start_url: './', display: 'standalone' });
    expect(meta.icons).toEqual(['200 image/png', '200 image/png', '200 image/png']);
    expect(meta.title).toContain('Citybloom');
    expect(meta.desc).toBeTruthy();

    // --- The service worker keeps the game: offline after one visit. ---
    await expect
      .poll(async () => (await shell(page)).app, { timeout: 60_000 })
      .toMatchObject({ offlineReady: true, controlled: true });
    await expect(page.getByTestId('shell-foot')).toContainText('works offline');
    await server('/__e2e/offline?on=1');
    await context.setOffline(true);
    await page.reload();
    await booted(page, 'menu');
    // The demo town behind the menu came from the offline copy too.
    expect((await state(page)).population).toBeGreaterThan(0);
    // Found a city offline, through the menu.
    await page.getByTestId('main-new').click();
    await page.getByTestId('new-name').fill('Offlineton');
    await page.getByTestId('new-tutorial').uncheck();
    await page.getByTestId('new-start').click();
    await booted(page, 'play');
    expect((await state(page)).cityName).toBe('Offlineton');
    await page.evaluate(async () => {
      const g = window.__game!;
      const s = await g.getState();
      const r = await g.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: 24, z: s.highwayZ },
          { x: 224, z: s.highwayZ },
        ],
      });
      if (!r.ok) throw new Error(r.reason);
    });
    const segments = (await state(page)).segments;
    await shot(page, 'm15-offline');

    // --- A new version is deployed; back online, the game notices and offers it. ---
    await context.setOffline(false);
    await server('/__e2e/offline?on=0');
    await server('/__e2e/deploy?dir=dist-e2e-next');
    await page.evaluate(() => window.__game!.checkForUpdate());
    const notice = page.getByTestId('update-notice');
    await expect(notice).toBeVisible({ timeout: 60_000 });
    await expect(notice).toContainText('New version of Citybloom');
    await expect(notice).toContainText('your city is saved first');
    await shot(page, 'm15-update');
    // Reload: the city is saved, and the page comes back as the new version.
    await page.getByTestId('update-reload').click();
    await page.waitForFunction(
      () => window.__game?.ready === true && window.__game.getShell().build === 'e2e-next',
      null,
      {
        timeout: 90_000,
      },
    );
    await booted(page, 'menu');
    await expect(page.getByTestId('toast').filter({ hasText: 'up to date (build e2e-next)' })).toBeVisible();
    await expect(page.getByTestId('shell-foot')).toContainText('build e2e-next');
    // Settings and saves survived the update: no second graphics check, and Continue opens the city.
    sh = await shell(page);
    expect(sh.graphics.checking).toBe(false);
    expect(sh.settings.quality).toBe('low');
    await expect(page.getByTestId('main-continue')).toContainText('Offlineton');
    await page.getByTestId('main-continue').click();
    await booted(page, 'play');
    const after = await state(page);
    expect(after.cityName).toBe('Offlineton');
    expect(after.segments).toBe(segments);

    // --- And the new version works offline too. ---
    await expect.poll(async () => (await shell(page)).app.controlled, { timeout: 30_000 }).toBe(true);
    await server('/__e2e/offline?on=1');
    await context.setOffline(true);
    await page.goto('./');
    await booted(page, 'menu');
    expect((await shell(page)).build).toBe('e2e-next');
    errs.check();
  } finally {
    await context.setOffline(false);
    await server('/__e2e/offline?on=0');
    await server('/__e2e/deploy?dir=dist-e2e');
  }
});
