// Dev (M23): import the region town (scripts/dev/regiontown.ts) through the load screen and shoot
// the airport with a plane landing or climbing out, the seaport with a ship, the Region panel, the
// noise and region traffic maps, and the airport's and seaport's inspectors.
// Usage: npm run build:test && node scripts/dev/regionshot.mjs region.citybloom outDir
//   ONLY=airport,plane,seaport,ship,panel,noise,region,inspectors,labels
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [file, out] = process.argv.slice(2);
const only = process.env.ONLY?.split(',');
const want = (k) => !only || only.includes(k);
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4196', '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() =>
    localStorage.setItem('citybloom.settings', JSON.stringify({ tips: false, graphicsChecked: true })),
  );
  await page.goto('http://localhost:4196/');
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  const frames = (n = 2) => page.evaluate((n) => window.__game.waitFrames(n), n);
  // Mid-morning, in daylight.
  await page.evaluate(async () => {
    const g = window.__game;
    const s = await g.getState();
    const now = (s.tick + 420) % 1440;
    await g.advance((10 * 60 - now + 1440) % 1440 || 1);
  });
  await frames();
  const civ = await page.evaluate(() => window.__game.getCivics());
  const airport = civ.find((c) => c.def === 'airport');
  const seaport = civ.find((c) => c.def === 'seaport');
  const shot = async (name, pose) => {
    if (pose) await page.evaluate((p) => window.__game.setCamera(p), pose);
    await frames(3);
    await page.screenshot({ path: `${out}/${name}.png` });
    const s = await page.evaluate(() => window.__game.getState());
    console.log(name, JSON.stringify(s.renderStats.ports), `calls ${s.renderStats.calls}`);
  };
  if (airport && want('airport'))
    await shot('airport', { x: airport.x, z: airport.z, yaw: 0.5, distance: 420, tilt: 0.55 });
  if (airport && want('plane')) {
    // Wait for a plane on the runway or just above it, then look at it.
    let p = null;
    for (let k = 0; k < 40 && !p; k++) {
      await page.evaluate(() => window.__game.advance(1));
      await frames(1);
      const shown = await page.evaluate(() => window.__game.getPorts().shown);
      p = shown.find((x) => x.kind === 'plane' && x.y < 60);
    }
    if (p) await shot('plane', { x: p.x, z: p.z, yaw: 0.9, distance: 160, tilt: 0.25 });
  }
  if (seaport && want('seaport'))
    await shot('seaport', { x: seaport.x, z: seaport.z, yaw: 2.4, distance: 320, tilt: 0.5 });
  if (seaport && want('ship')) {
    let p = null;
    for (let k = 0; k < 80 && !p; k++) {
      const shown = await page.evaluate(() => window.__game.getPorts().shown);
      p = shown.find((x) => x.kind === 'ship' && x.x > 60 && x.x < 1980 && x.z > 60 && x.z < 1980);
      if (!p) {
        await page.evaluate(() => window.__game.advance(5));
        await frames(1);
      }
    }
    if (p) await shot('ship', { x: p.x, z: p.z, yaw: 2.0, distance: 260, tilt: 0.35 });
  }
  if (want('panel')) {
    await page.evaluate(() => window.__game.setCamera('overview'));
    await page.keyboard.press('Shift+N');
    await frames(3);
    await shot('panel');
    await page.keyboard.press('Shift+N');
  }
  if (want('labels')) {
    await page.keyboard.press('Shift+N');
    await shot('labels', { x: 700, z: 1000, yaw: 0, distance: 2600, tilt: 0.9 });
    await page.keyboard.press('Shift+N');
  }
  for (const map of ['noise', 'region']) {
    if (!want(map)) continue;
    await page.evaluate((m) => window.__game.setOverlay(m), map);
    await frames(3);
    await shot(`map-${map}`, {
      x: 900,
      z: airport ? airport.z + 200 : 1000,
      yaw: 0,
      distance: 1500,
      tilt: 0.9,
    });
    await page.evaluate(() => window.__game.setOverlay(null));
  }
  if (want('inspectors'))
    for (const c of [airport, seaport].filter(Boolean)) {
      await page.evaluate(
        (c) => window.__game.setCamera({ x: c.x, z: c.z, yaw: 0.3, distance: 360, tilt: 0.6 }),
        c,
      );
      await frames(2);
      const p = await page.evaluate((c) => window.__game.worldToScreen(c.x, c.z), c);
      await page.mouse.click(p.x, p.y);
      await frames(2);
      await page.screenshot({ path: `${out}/inspect-${c.def}.png` });
      await page.keyboard.press('Escape');
    }
  if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
