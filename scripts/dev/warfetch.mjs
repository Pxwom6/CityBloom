// Dev (phase 5): which models files a page fetches. The main menu and a peaceful city must never
// ask for the war models file; a city with war on (rival neighbours) fetches it once and draws its
// military buildings with it. Prints each page's model downloads and what the test API says.
// Usage: npm run build:test && node scripts/dev/warfetch.mjs [--dist dist-test]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const i = argv.indexOf('--dist');
const dist = i >= 0 ? argv[i + 1] : 'dist-test';
const PORT = 4188;
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
// Until the preview server answers (it can take a few seconds on a busy machine).
for (let t = 0; t < 60; t++) {
  const up = await fetch(`http://localhost:${PORT}/`).then(
    (r) => r.ok,
    () => false,
  );
  if (up) break;
  await new Promise((r) => setTimeout(r, 500));
}
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});
let bad = false;
try {
  for (const [name, query, war] of [
    ['main menu', '', false],
    ['peaceful city', '?paused=1&seed=peace&preset=lakes', false],
    ['city with rivals', '?paused=1&seed=peace&preset=lakes&rivals=1', true],
  ]) {
    const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
    page.setDefaultTimeout(300_000);
    const fetched = [];
    page.on(
      'request',
      (r) =>
        /models-[\w-]+\.bin|__(war-)?models\.bin/.test(r.url()) && fetched.push(r.url().replace(/^.*\//, '')),
    );
    await page.addInitScript(() =>
      localStorage.setItem(
        'citybloom.settings',
        JSON.stringify({ tips: false, graphicsChecked: true, quality: 'low' }),
      ),
    );
    await page.goto(`http://localhost:${PORT}/${query}`);
    await page.waitForFunction(() => window.__game?.ready);
    // A few frames: the game asks for the war models on its first frames in a city with war on.
    await page.evaluate(() => window.__game.waitFrames(8));
    if (war) await page.waitForFunction(() => window.__game.getWarModels().designs.length > 0);
    const got = await page.evaluate(() => window.__game.getWarModels());
    const warFetched = fetched.filter((f) => f.startsWith('war-models') || f.startsWith('__war-models'));
    console.log(
      `${name}: fetched ${fetched.join(', ') || 'nothing'}; asked for war models ${got.asked}; ${got.designs.length} war buildings, ${got.units.length} units`,
    );
    if (war !== (warFetched.length === 1) || war !== got.asked) bad = true;
    await page.close();
  }
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {
    // Gone already.
  }
}
console.log(bad ? 'FAIL: a page fetched what it shouldn’t, or not what it should' : 'ok');
if (bad) process.exitCode = 1;
