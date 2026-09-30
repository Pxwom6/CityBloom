// Dev (phase 3): where the triangles go. Imports a saved city in a headed Chrome window and prints,
// for each camera preset, the triangles and draw calls each scene group costs in the colour pass
// and in the shadow pass (test API `passBreakdown()`).
// Usage: npm run build:test && node scripts/dev/passprobe.mjs city.gz [--quality high] [--views overview,city,street] [--hour 13] [--dist dist-test]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};
const file = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!file) throw new Error('usage: node scripts/dev/passprobe.mjs city.gz');
const quality = flag('quality', 'high');
const views = flag('views', 'overview,city,street').split(',');
const hour = Number(flag('hour', '13'));
const dist = flag('dist', 'dist-test');
const PRESETS = {
  low: { quality: 'low', shadows: false, drawDistance: 'near' },
  medium: { quality: 'medium', shadows: true, drawDistance: 'medium' },
  high: { quality: 'high', shadows: true, drawDistance: 'medium' },
};
const PORT = 4197;
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-size=1512,945', '--window-position=0,0'],
});
try {
  const page = await browser.newPage({ viewport: null });
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
  await page.addInitScript(
    (p) =>
      localStorage.setItem('citybloom.settings', JSON.stringify({ tips: false, graphicsChecked: true, ...p })),
    PRESETS[quality],
  );
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  for (const view of views) {
    const rows = await page.evaluate(
      async ({ view, hour }) => {
        const g = window.__game;
        g.setSpeed(0);
        const s = await g.getState();
        const now = (s.tick + 7 * 60) % 1440;
        await g.advance((hour * 60 - now + 1440) % 1440 || 1);
        g.setCamera(view);
        await g.waitFrames(20);
        return g.passBreakdown();
      },
      { view, hour },
    );
    const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
    console.log(
      `${quality} ${view}: colour ${(sum('colour') / 1e3).toFixed(0)}k tris / ${sum('colourCalls')} calls, shadow ${(sum('shadow') / 1e3).toFixed(0)}k / ${sum('shadowCalls')}`,
    );
    for (const r of rows.sort((a, b) => b.colour + b.shadow - a.colour - a.shadow))
      console.log(
        `   ${r.name.padEnd(14)} colour ${(r.colour / 1e3).toFixed(0).padStart(5)}k ${String(r.colourCalls).padStart(4)}   shadow ${(r.shadow / 1e3).toFixed(0).padStart(5)}k ${String(r.shadowCalls).padStart(4)}`,
      );
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
