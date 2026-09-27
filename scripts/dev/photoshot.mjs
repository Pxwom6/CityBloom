// Dev: photo mode (M16) on a saved city: shoots several looks with the panel hidden, and saves one
// photo through the real Save button at 2×.
// Usage: npm run build:test && node scripts/dev/photoshot.mjs <save.citybloom> <outDir>
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';

const [file, out] = process.argv.slice(2);
if (!file || !out) throw new Error('usage: node scripts/dev/photoshot.mjs save.citybloom outDir');
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4198', '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
  await page.addInitScript(() =>
    localStorage.setItem('citybloom.settings', JSON.stringify({ tips: false, graphicsChecked: true })),
  );
  await page.goto('http://localhost:4198/');
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  // Look at the busiest part of town.
  const c = await page.evaluate(() => {
    const bs = window.__game.getBuildings();
    let x = 0;
    let z = 0;
    for (const b of bs) {
      x += b.x;
      z += b.z;
    }
    return { x: x / bs.length, z: z / bs.length };
  });
  await page.evaluate(() => window.__game.setSpeed(1));
  await page.keyboard.press('k');
  await page.getByTestId('photo-panel').waitFor();
  const looks = [
    {
      name: 'street-golden',
      pose: { distance: 45, yaw: 0.7, tilt: -0.25 },
      photo: { hour: 18.4, fov: 50, dof: 0.5, grade: 'golden' },
    },
    {
      name: 'eye-level',
      pose: { distance: 4, yaw: 2.2, tilt: -0.33 },
      photo: { hour: 11, fov: 60, dof: 0.3, grade: 'crisp' },
    },
    {
      name: 'miniature',
      pose: { distance: 260, yaw: 1.2, tilt: 0.1 },
      photo: { hour: 14, fov: 35, tiltShift: 0.8, dof: 0, grade: 'natural' },
    },
    {
      name: 'night-mono',
      pose: { distance: 120, yaw: 3.6, tilt: 0 },
      photo: { hour: 21.5, fov: 45, dof: 0, tiltShift: 0, grade: 'mono' },
    },
    {
      name: 'cool-faded',
      pose: { distance: 180, yaw: 5.0, tilt: 0.05 },
      photo: { hour: 7.2, fov: 40, dof: 0.2, tiltShift: 0.3, grade: 'faded' },
    },
  ];
  for (const l of looks) {
    await page.evaluate(({ c, pose }) => window.__game.setCamera({ x: c.x, z: c.z, ...pose }), {
      c,
      pose: l.pose,
    });
    await page.evaluate((p) => window.__game.setPhoto(p), { tiltShift: 0, dof: 0, ...l.photo, panel: false });
    await page.evaluate(() => window.__game.waitFrames(4));
    await page.screenshot({ path: `${out}/${l.name}.png` });
    console.log(l.name, JSON.stringify(await page.evaluate(() => window.__game.getPhoto().state.focus)));
  }
  if (process.env.COMPARE) {
    // The miniature view three ways: lens on, lens off, and outside photo mode.
    const l = looks[2];
    await page.evaluate(({ c, pose }) => window.__game.setCamera({ x: c.x, z: c.z, ...pose }), {
      c,
      pose: l.pose,
    });
    await page.evaluate(() =>
      window.__game.setPhoto({ tiltShift: 0, dof: 0, grade: 'natural', hour: 14, fov: 35 }),
    );
    await page.evaluate(() => window.__game.waitFrames(4));
    await page.screenshot({ path: `${out}/cmp-lens-off.png` });
    console.log('groups', JSON.stringify(await page.evaluate(() => window.__game.renderBreakdown())));
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__game.waitFrames(4));
    await page.screenshot({ path: `${out}/cmp-normal.png` });
  } else {
    // One photo through the panel's Save button, at 2×.
    await page.evaluate(() => window.__game.setPhoto({ panel: true, scale: 2 }));
    const [dl] = await Promise.all([
      page.waitForEvent('download', { timeout: 300_000 }),
      page.getByTestId('photo-save').click({ timeout: 300_000 }),
    ]);
    const saved = `${out}/saved-2x.png`;
    copyFileSync(await dl.path(), saved);
    console.log('saved', saved, await page.getByTestId('photo-saved').textContent());
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
