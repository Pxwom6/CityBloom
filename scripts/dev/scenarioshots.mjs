// Scenario previews (M18): opens each scenario's starting city in the test build, frames the town,
// and saves the 3D view (no interface) as public/scenarios/<id>.jpg for the scenario screen.
// Usage: npm run build:test && node scripts/dev/scenarioshots.mjs [id,id...] [hour]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/data/scenarios.ts', 'utf8');
const all = [...src.matchAll(/^ {4}id: '([a-z]+)',$/gm)].map((m) => m[1]);
const ids = (process.argv[2] ?? all.join(',')).split(',');
const hour = Number(process.argv[3] ?? 15.5);
// Views that need more than the town's middle: the resort looks out to sea.
const VIEW = { resort: { x: 1150, yaw: 5.2, distance: 900 } };
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4197', '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  for (const id of ids) {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    await page.addInitScript(() =>
      localStorage.setItem('citybloom.settings', JSON.stringify({ graphicsChecked: true, tips: false })),
    );
    await page.goto(`http://localhost:4197/?scenario=${id}`);
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
    await page.addStyleTag({ content: '#ui { display: none !important; }' });
    // Frame the town: the middle of its buildings, far enough back to see most of them.
    const pose = await page.evaluate(() => {
      const b = window.__game.getBuildings().filter((x) => x.state !== 3);
      const xs = b.map((x) => x.x).sort((p, q) => p - q);
      const zs = b.map((x) => x.z).sort((p, q) => p - q);
      const q = (a, f) => a[Math.floor((a.length - 1) * f)];
      const x = (q(xs, 0.1) + q(xs, 0.9)) / 2;
      const z = (q(zs, 0.1) + q(zs, 0.9)) / 2;
      const span = Math.max(q(xs, 0.9) - q(xs, 0.1), q(zs, 0.9) - q(zs, 0.1));
      return { x, z, distance: Math.min(1400, Math.max(260, span * 0.85)), yaw: 0.55, tilt: 0.2 };
    });
    Object.assign(pose, VIEW[id] ?? {});
    await page.evaluate((p) => window.__game.setCamera(p), pose);
    await page.evaluate((h) => window.__game.setPhoto?.({ hour: h }), hour).catch(() => {});
    await page.evaluate(() => window.__game.waitFrames(3));
    await page
      .locator('#scene')
      .screenshot({ path: `public/scenarios/${id}.jpg`, type: 'jpeg', quality: 72 });
    console.log(id, JSON.stringify(pose));
    await page.close();
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
