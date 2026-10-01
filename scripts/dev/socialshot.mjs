// Dev: the share preview image (public/social.jpg, 1200×630): a saved town imported through the load
// screen, in late-afternoon light with the interface hidden, and the game's name over it.
// Usage: npm run build:test && node scripts/dev/socialshot.mjs town.citybloom public/social.jpg [hour] [yaw] [distance] [tilt] [--gpu]
// The town: npx tsx scripts/balance.ts 12 careful --seed citybloom --save <dir>
// `--gpu` draws in a headed Chrome window on the real GPU (phase 3: true colours, in summer, clear).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const gpu = process.argv.includes('--gpu');
const [file, out, hourArg, yawArg, distArg, tiltArg] = process.argv.slice(2).filter((a) => a !== '--gpu');
if (!file || !out)
  throw new Error('usage: node scripts/dev/socialshot.mjs town.citybloom out.png [hour] [yaw]');
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4197', '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch(
  gpu
    ? { channel: 'chrome', headless: false, args: ['--window-size=1200,700'] }
    : { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
);
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
  await page.addInitScript(() =>
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({
        tips: false,
        graphicsChecked: true,
        quality: 'high',
        drawDistance: 'far',
        tiltShift: true,
      }),
    ),
  );
  await page.goto('http://localhost:4197/');
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  const hour = Number(hourArg ?? 17.5);
  await page.evaluate(async (h) => {
    const g = window.__game;
    // Clear summer weather, so the picture doesn't depend on the save's month.
    g.setWeatherLook({ season: [0, 1, 0, 0], kind: 'clear', strength: 0, snow: 0, wet: 0 });
    const s = await g.getState();
    const now = (s.tick + 7 * 60) % 1440;
    await g.advance(Math.round((h * 60 - now + 1440) % 1440) || 1);
  }, hour);
  // Look over the busiest part of town: the centre of its buildings, weighted to the dense ones.
  const centre = await page.evaluate(() => {
    const bs = window.__game.getBuildings();
    let x = 0;
    let z = 0;
    let w = 0;
    for (const b of bs) {
      const k = 1 + (b.density ?? 0) * 2;
      x += b.x * k;
      z += b.z * k;
      w += k;
    }
    return { x: x / w, z: z / w, n: bs.length };
  });
  console.log('buildings', centre.n, 'centre', Math.round(centre.x), Math.round(centre.z));
  await page.evaluate(
    ({ c, yaw, distance, tilt }) => window.__game.setCamera({ x: c.x, z: c.z, distance, yaw, tilt }),
    {
      c: centre,
      yaw: Number(yawArg ?? 2.4),
      distance: Number(distArg ?? 360),
      tilt: Number(tiltArg ?? 0.42),
    },
  );
  await page.evaluate(() => {
    // As photo mode shows the city: no problem icons or zone paint.
    window.__game.showGroup('icons', false);
    window.__game.showGroup('zones', false);
    document.getElementById('ui').style.display = 'none';
    const title = document.createElement('div');
    title.innerHTML =
      '<div style="font:800 76px/1 Inter,system-ui,sans-serif;letter-spacing:-1.5px">Citybloom</div>' +
      '<div style="font:500 28px/1.3 Inter,system-ui,sans-serif;margin-top:10px;opacity:.95">Build a city in your browser</div>';
    Object.assign(title.style, {
      position: 'absolute',
      left: '56px',
      bottom: '48px',
      color: '#fffdf8',
      textShadow: '0 2px 18px rgba(20,28,40,.55), 0 1px 3px rgba(20,28,40,.5)',
      zIndex: 99,
    });
    const shade = document.createElement('div');
    Object.assign(shade.style, {
      position: 'absolute',
      inset: '0',
      background: 'linear-gradient(to top, rgba(18,26,38,.5), rgba(18,26,38,0) 45%)',
      zIndex: 98,
      pointerEvents: 'none',
    });
    document.getElementById('app').append(shade, title);
  });
  await page.evaluate((n) => window.__game.waitFrames(n), gpu ? 30 : 4);
  await page.screenshot(out.endsWith('.jpg') ? { path: out, type: 'jpeg', quality: 88 } : { path: out });
  console.log('wrote', out);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
