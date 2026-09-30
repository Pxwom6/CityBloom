// Dev (phase 3): which buildings of a saved city wear hand-made models, and what they cost.
// Usage: npm run build:test && node scripts/dev/modelcensus.mjs city.gz
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const file = process.argv[2];
const PORT = 4189;
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', 'dist-test', '--port', String(PORT), '--strictPort'],
  {
    stdio: 'ignore',
    detached: true,
  },
);
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.addInitScript(() =>
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({ tips: false, graphicsChecked: true, quality: 'low', shadows: false }),
    ),
  );
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  const models = await page.evaluate(() => window.__game.getModels());
  const by = new Map();
  for (const m of models) {
    const k = `${m.def}@${m.w}x${m.d}`;
    const e = by.get(k) ?? { n: 0, hand: 0, tris: 0, far: 0, sky: 0, gen: 0, genTris: 0 };
    e.n++;
    if (m.hand) {
      e.hand++;
      e.tris += m.triangles;
      e.far += m.far;
      e.sky += m.sky;
    } else {
      e.gen++;
      e.genTris += m.triangles;
    }
    by.set(k, e);
  }
  const rows = [...by].sort((a, b) => b[1].n - a[1].n);
  let hand = 0,
    handTris = 0,
    far = 0,
    sky = 0,
    genTris = 0,
    noFit = 0;
  for (const [, e] of rows) {
    hand += e.hand;
    handTris += e.tris;
    far += e.far;
    sky += e.sky;
    genTris += e.genTris;
    if (!e.hand) noFit += e.n;
  }
  console.log(
    `${models.length} buildings: ${hand} hand-made (${Math.round((100 * hand) / models.length)} %), ${noFit} on lots no model fits`,
  );
  console.log(`triangles: hand-made near ${handTris}, far ${far}, skyline ${sky}; generated ${genTris}`);
  console.log(
    `mean per building: hand-made near ${Math.round(handTris / hand)}, far ${Math.round(far / hand)}, sky ${Math.round(sky / hand)}; generated ${Math.round(genTris / (models.length - hand))}`,
  );
  for (const [k, e] of rows.slice(0, 40))
    console.log(
      `  ${k.padEnd(10)} ${String(e.n).padStart(4)}  hand ${String(e.hand).padStart(4)}  near ${e.hand ? Math.round(e.tris / e.hand) : '-'} far ${e.hand ? Math.round(e.far / e.hand) : '-'} sky ${e.hand ? Math.round(e.sky / e.hand) : '-'} | gen ${e.gen ? Math.round(e.genTris / e.gen) : '-'}`,
    );
} finally {
  await browser.close();
  process.kill(-server.pid);
}
