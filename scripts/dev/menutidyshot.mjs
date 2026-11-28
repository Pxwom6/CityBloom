// Dev (Menu tidy): the main menu and each of its sub-menus, on a desktop window (a new player, a player
// with a save, and at the 140 % interface size) and on an iPhone and a Pixel held upright and sideways.
// Usage: npm run dev (or a built test build served somewhere), then
//   node scripts/dev/menutidyshot.mjs <out dir> [--url http://localhost:5173/] [--gpu] [--only desktop,big,iphone,pixel]
// `--gpu` draws in headed Chrome on the real GPU (the Mac); otherwise SwiftShader, headless.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const args = process.argv.slice(2);
const out = args.find((a) => !a.startsWith('--')) ?? 'test-results/menu-tidy';
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const url = opt('url', 'http://localhost:5173/');
const gpu = args.includes('--gpu');
const only = (opt('only', '') || 'desktop,big,iphone,pixel').split(',');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(
  gpu
    ? { channel: 'chrome', headless: false, args: ['--ignore-gpu-blocklist'] }
    : { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
);

/** A phone profile in Chromium, upright or sideways (as e2e/phone.ts). */
function phone(name, orient) {
  const { defaultBrowserType: _b, viewport, ...rest } = devices[name];
  return {
    ...rest,
    viewport: orient === 'landscape' ? { width: viewport.height, height: viewport.width } : viewport,
  };
}

async function menuPage(options, settings = {}) {
  const ctx = await browser.newContext(options);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.addInitScript((s) => {
    const key = 'citybloom.settings';
    const was = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...was, graphicsChecked: true, reportsNotice: true, ...s }));
  }, settings);
  await page.goto(url);
  await booted(page, 'menu');
  return { ctx, page };
}

async function booted(page, mode) {
  await page.waitForFunction((m) => window.__game?.ready && window.__game.getShell().mode === m, mode, {
    timeout: 180_000,
  });
  await page.evaluate(() => window.__game.waitFrames(3));
}

async function snap(page, name) {
  await page.evaluate(() => window.__game.waitFrames(2));
  await page.waitForTimeout(300);
  const path = `${out}/${name}.png`;
  await page.screenshot({ path });
  console.log(path);
}

/** Found a city and quit back to the menu, so the menu has a save to Continue. */
async function withSave(page) {
  await page.goto(`${url}?new=1&name=Ashford&seed=menutidy&preset=river&difficulty=normal&sandbox=0`);
  await booted(page, 'play');
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-quit').click();
  await page.getByTestId('main-continue').waitFor({ timeout: 180_000 });
  await page.evaluate(() => window.__game.waitFrames(3));
}

async function subs(page, prefix, tap = false) {
  for (const sub of ['play', 'multiplayer', 'create']) {
    const b = page.getByTestId(`main-${sub}`);
    if (tap) await b.tap();
    else await b.click();
    await page.getByTestId(`main-sub-${sub}`).waitFor();
    if (sub === 'multiplayer') await page.getByTestId('main-join-code').fill('7KQ2MX');
    await snap(page, `${prefix}-${sub}`);
    const back = page.getByTestId('main-back');
    if (tap) await back.tap();
    else await back.click();
    await page.getByTestId('main-top').waitFor();
  }
}

try {
  if (only.includes('desktop')) {
    const { ctx, page } = await menuPage({ viewport: { width: 1280, height: 800 } });
    await snap(page, 'desktop-new-player');
    await subs(page, 'desktop-new-player');
    await withSave(page);
    await snap(page, 'desktop-saved');
    await subs(page, 'desktop-saved');
    await ctx.close();
  }
  if (only.includes('big')) {
    const { ctx, page } = await menuPage({ viewport: { width: 1280, height: 800 } }, { uiScale: 1.4 });
    await withSave(page);
    await snap(page, 'desktop-140-saved');
    await subs(page, 'desktop-140');
    await ctx.close();
  }
  for (const [key, name] of [
    ['iphone', 'iPhone 13'],
    ['pixel', 'Pixel 7'],
  ]) {
    if (!only.includes(key)) continue;
    for (const orient of ['portrait', 'landscape']) {
      const { ctx, page } = await menuPage(phone(name, orient));
      await snap(page, `${key}-${orient}-new-player`);
      await subs(page, `${key}-${orient}`, true);
      await withSave(page);
      await snap(page, `${key}-${orient}-saved`);
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
