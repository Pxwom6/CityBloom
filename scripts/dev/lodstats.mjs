// Dev (phase 3): triangles on show by level of detail at each camera preset of a saved city.
// Usage: npm run build:test && node scripts/dev/lodstats.mjs city.gz [--gpu]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const file = process.argv[2];
const gpu = process.argv.includes('--gpu');
const PORT = 4190;
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', 'dist-test', '--port', String(PORT), '--strictPort'],
  {
    stdio: 'ignore',
    detached: true,
  },
);
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch(
  gpu
    ? { channel: 'chrome', headless: false, args: ['--window-size=1512,945', '--window-position=0,0'] }
    : { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
);
try {
  const page = await browser.newPage(gpu ? { viewport: null } : { viewport: { width: 1280, height: 800 } });
  await page.addInitScript(() =>
    localStorage.setItem('citybloom.settings', JSON.stringify({ tips: false, graphicsChecked: true })),
  );
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  for (const preset of ['overview', 'city', 'street']) {
    const r = await page.evaluate(async (preset) => {
      const g = window.__game;
      g.setCamera(preset);
      await g.waitFrames(6);
      const s = await g.getState();
      return {
        lod: g.getLod(),
        calls: s.renderStats.calls,
        tris: s.renderStats.triangles,
        parts: g.renderBreakdown(),
      };
    }, preset);
    const k = (v) => `${Math.round(v / 1000)}k`;
    const row = (o) => `near ${k(o.near)} far ${k(o.far)} sky ${k(o.sky)} plain ${k(o.plain)}`;
    console.log(
      `${preset}: ${r.calls} calls, ${(r.tris / 1e6).toFixed(2)}M triangles drawn (shadow pass included)`,
    );
    console.log(`  buildings in visible chunk meshes: ${row(r.lod.buildings)}`);
    console.log(`  civics    in visible chunk meshes: ${row(r.lod.civics)}`);
    console.log(
      `  meshes/shadow casters: ${r.parts
        .filter((p) => p.meshes)
        .map((p) => `${p.name} ${p.meshes}/${p.shadow}`)
        .join(', ')}`,
    );
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
