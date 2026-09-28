// Dev (M24): the map editor through the UI: the main menu's Map editor screen, a new map from a
// generated one, brushes (sea, river, hills, forest, ore), moving the highway entry, the
// playability check, saving, and founding a city on the map from the new-city screen.
// Usage: node scripts/dev/editorshot.mjs outDir   (after npm run build:test)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4189', '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const log = (...a) => console.log('[editorshot]', ...a);
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('citybloom.settings', JSON.stringify({ tips: false, graphicsChecked: true }));
  });
  await page.goto('http://localhost:4189/');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 120000,
  });
  await page.getByTestId('main-editor').click();
  await page.getByTestId('maps-base-coast').click();
  await page.getByTestId('maps-seed').fill('edit');
  await page.getByTestId('maps-name').fill('Test Bay');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/maps-screen.png` });
  await page.getByTestId('maps-new').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'editor', null, {
    timeout: 120000,
  });
  await page.evaluate(() => window.__game.waitFrames(2));
  await page.screenshot({ path: `${out}/editor.png` });
  const scr = (x, z) => page.evaluate(([x, z]) => window.__game.worldToScreen(x, z), [x, z]);
  const cam = async (p) => {
    await page.evaluate((p) => window.__game.setCamera(p), p);
    await page.evaluate(() => window.__game.waitFrames(1));
  };
  const drag = async (pts, hold = 300) => {
    const a = await scr(pts[0][0], pts[0][1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (const [x, z] of pts.slice(1)) {
      const p = await scr(x, z);
      await page.mouse.move(p.x, p.y, { steps: 6 });
      await page.waitForTimeout(hold);
    }
    await page.waitForTimeout(hold);
    await page.mouse.up();
  };
  await cam({ x: 1024, z: 1024, distance: 2600, yaw: 0, tilt: 1.1 });
  // A river across the middle.
  await page.getByTestId('brush-water').click();
  await drag(
    [
      [300, 300],
      [600, 700],
      [800, 1100],
      [700, 1500],
      [900, 1900],
    ],
    400,
  );
  // Hills in the north-west, and forest on them.
  await page.getByTestId('brush-raise').click();
  await page.getByTestId('editor-strength').fill('3');
  await drag(
    [
      [250, 250],
      [400, 250],
    ],
    1500,
  );
  await page.getByTestId('brush-forest').click();
  await drag(
    [
      [300, 1500],
      [500, 1800],
    ],
    500,
  );
  // Ore by the hills (the resources map shows it).
  await page.getByTestId('brush-ore').click();
  await drag(
    [
      [450, 300],
      [500, 400],
    ],
    600,
  );
  await page.evaluate(() => window.__game.waitFrames(3));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/brushes.png` });
  // Move the highway entry.
  await page.getByTestId('brush-raise').click();
  await page.getByTestId('entry-highway').click();
  const e = await scr(30, 700);
  await page.mouse.click(e.x, e.y);
  await page.waitForTimeout(1500);
  const st = await page.evaluate(() => window.__game.getState());
  log('entry', JSON.stringify(st.map ?? null));
  // The check.
  await page.getByTestId('editor-status').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/check.png` });
  log('status', await page.getByTestId('editor-status').textContent());
  // Save, then found a city on it from the new-city screen.
  await page.getByTestId('editor-save').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/saved.png` });
  await page.getByTestId('editor-exit').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 120000,
  });
  await page.getByTestId('main-new').click();
  const mine = page.locator('[data-testid^="newmap-m"]').first();
  await mine.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/newcity.png` });
  await page.getByTestId('new-start').click();
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 120000,
  });
  await page.evaluate(() => window.__game.setSpeed(0));
  await page.evaluate(() => window.__game.waitFrames(3));
  await page.screenshot({ path: `${out}/city.png` });
  const city = await page.evaluate(() => window.__game.getState());
  log('city', city.cityName, 'highwayZ', city.highwayZ, 'map', JSON.stringify(city.map ?? null));
  if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
