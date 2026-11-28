// Phone pictures (M49): the game in Playwright's iPhone 13 or Pixel 7 emulation, upright and
// sideways, with the bars, a tool's options, each panel and the inspector open in turn.
// Usage: npm run build:test && node scripts/dev/phoneshot.mjs <outDir> [--device iphone|pixel]
//   [--only city,zone,services,budget,inspector,…] [--orient portrait,landscape] [--load save.citybloom]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { clickMain } from './menu.mjs';

const out = process.argv[2] ?? 'phone-shots';
const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const device = { iphone: 'iPhone 13', pixel: 'Pixel 7' }[arg('device', 'iphone')] ?? arg('device', 'iphone');
const only = arg('only', '').split(',').filter(Boolean);
const orients = arg('orient', 'portrait,landscape').split(',');
const load = arg('load', '');
const PORT = Number(process.env.PORT || 4193);
mkdirSync(out, { recursive: true });

const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', process.env.DIST || 'dist-test', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: true },
);
process.on('exit', () => {
  try {
    process.kill(-server.pid);
  } catch {
    /* gone */
  }
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 250));
}

/** Tap a building near the middle of the screen, for the inspector. */
async function tapBuilding(p) {
  const at = await p.evaluate(async () => {
    const g = window.__game;
    const list = await g.getBuildings();
    const vw = innerWidth;
    const vh = innerHeight;
    for (const b of list) {
      const s = g.worldToScreen(b.x, b.z);
      if (s.x > vw * 0.25 && s.x < vw * 0.75 && s.y > vh * 0.3 && s.y < vh * 0.6) return s;
    }
    return null;
  });
  if (at) await p.touchscreen.tap(at.x, at.y);
}

const SCENES = {
  city: async () => {},
  zone: async (p) => p.getByTestId('tool-zone').tap(),
  road: async (p) => p.getByTestId('tool-road').tap(),
  build: async (p) => p.getByTestId('tool-build').tap(),
  services: async (p) => {
    // On a phone the categories are in the Build sheet.
    if (await p.getByTestId('tool-build').isVisible()) await p.getByTestId('tool-build').tap();
    await p.getByTestId('tool-fire').tap();
  },
  more: async (p) => p.getByTestId('tool-more').tap(),
  maps: async (p) => p.getByTestId('tool-maps').tap(),
  budget: async (p) => p.evaluate(() => window.__game.openPanel('budget')),
  advisors: async (p) => p.evaluate(() => window.__game.openPanel('advisors')),
  citypanel: async (p) => p.evaluate(() => window.__game.openPanel('city')),
  inspector: tapBuilding,
  pause: async (p) => p.getByTestId('menu-button').tap(),
  settings: async (p) => {
    await p.getByTestId('menu-button').tap();
    await p.getByTestId('pause-settings').tap();
  },
};

/** Back to the plain city: close what's open, leave the tool. */
async function reset(p) {
  await p.evaluate(() => window.__game.openPanel(null));
  for (const id of ['pause-resume', 'tool-select', 'tool-question-no']) {
    const b = p.getByTestId(id);
    if (await b.isVisible().catch(() => false)) await b.tap().catch(() => {});
  }
  const close = p.locator('#ui [aria-label="Close"]').first();
  if (await close.isVisible().catch(() => false)) await close.tap().catch(() => {});
}

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  for (const orient of orients) {
    const profile = devices[device];
    const vp = profile.viewport;
    const viewport = orient === 'landscape' ? { width: vp.height, height: vp.width } : vp;
    const ctx = await browser.newContext({ ...profile, viewport });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('page error:', e.message));
    await page.addInitScript(() =>
      localStorage.setItem(
        'citybloom.settings',
        JSON.stringify({
          tips: false,
          graphicsChecked: true,
          reportsNotice: true,
          quality: 'phone',
          shadows: false,
          drawDistance: 'near',
        }),
      ),
    );
    if (load) {
      await page.goto(`http://localhost:${PORT}/`);
      await clickMain(page, 'main-load', { tap: true, timeout: 120_000 });
      await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(load)]);
    } else await page.goto(`http://localhost:${PORT}/?paused=1&seed=phone`);
    // A grown town to look at (the e2e's planned town, through the test API).
    await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
      timeout: 180_000,
    });
    await page.evaluate(() => window.__game.waitFrames(3));
    for (const [name, open] of Object.entries(SCENES)) {
      if (only.length && !only.includes(name)) continue;
      await open(page).catch((e) => console.log(`${name} ${orient}: ${e.message.split('\n')[0]}`));
      await page.evaluate(() => window.__game.waitFrames(3));
      await page.screenshot({ path: `${out}/${name}-${orient}.png` });
      // Back to the plain city for the next (a settings screen goes back to the pause menu first).
      if (name === 'settings')
        await page
          .getByTestId('settings-back')
          .tap()
          .catch(() => {});
      await reset(page);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
process.exit(0);
