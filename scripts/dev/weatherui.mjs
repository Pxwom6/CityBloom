// Dev (M22): the weather in the interface on Kingsmere under snow: the top bar's weather panel,
// a snowy road's inspector, a public works depot's inspector, the advisors, the Settings screen's
// seasons and weather, and photo mode's season and weather controls.
// Usage: node scripts/dev/weatherui.mjs outDir   (after npm run build:test)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4191', '--strictPort'], {
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
  await page.addInitScript(() => {
    localStorage.setItem('citybloom.settings', JSON.stringify({ tips: false, graphicsChecked: true }));
  });
  await page.goto('http://localhost:4191/?scenario=market');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 120000,
  });
  await page.getByTestId('scenario-begin').click();
  await page.evaluate(() => window.__game.setSpeed(0));
  const frames = (n = 2) => page.evaluate((n) => window.__game.waitFrames(n), n);
  // Snow for a few hours, in daylight.
  await page.evaluate(async () => {
    const g = window.__game;
    const s = await g.getState();
    const hour = ((s.tick + 420) % 1440) / 60;
    await g.advance(Math.round(((9 - hour + 24) % 24) * 60));
    await g.dispatch({ type: 'cheat', cheat: 'weather', kind: 'snow', strength: 0.9, hours: 8 });
    await g.advance(5 * 60);
  });
  await page.evaluate(() => window.__game.setCamera({ x: 200, z: 925, yaw: 0.4, distance: 260, tilt: 0.6 }));
  await frames();
  await page.getByTestId('weather').click();
  await frames();
  console.log('panel:', (await page.getByTestId('weather-panel').innerText()).replace(/\n+/g, ' | '));
  await page.screenshot({ path: `${out}/panel.png` });
  await page.getByTestId('weather').click();
  // A snowy road.
  const seg = await page.evaluate(() => window.__game.segmentAt(200, 925));
  if (seg) {
    const p = await page.evaluate(() => window.__game.worldToScreen(200, 925));
    await page.mouse.click(p.x, p.y);
    await frames();
    console.log(
      'road:',
      await page
        .getByTestId('road-snow')
        .innerText()
        .catch(() => 'no snow line'),
    );
    await page.screenshot({ path: `${out}/road.png` });
    await page.keyboard.press('Escape');
  }
  // A depot, and its inspector once ploughs are out.
  const depot = await page.evaluate(() => window.__game.placeCivic('works', { x: 204, z: 1010 }));
  await page.evaluate(() => window.__game.advance(90));
  await frames();
  const d = await page.evaluate((id) => window.__game.getCivics().find((c) => c.id === id), depot);
  await page.evaluate(
    (d) => window.__game.setCamera({ x: d.x, z: d.z, yaw: 2.2, distance: 160, tilt: 0.55 }),
    d,
  );
  await frames();
  const dp = await page.evaluate((d) => window.__game.worldToScreen(d.x, d.z), d);
  await page.mouse.click(dp.x, dp.y);
  await frames();
  console.log(
    'depot:',
    (
      await page
        .getByTestId('plough-details')
        .innerText()
        .catch(() => '?')
    ).replace(/\n/g, ' '),
  );
  await page.screenshot({ path: `${out}/depot.png` });
  await page.keyboard.press('Escape');
  // Advisors.
  await page.keyboard.press('j');
  await frames();
  await page.screenshot({ path: `${out}/advisors.png` });
  await page.keyboard.press('j');
  // Settings (from the pause menu).
  await page.keyboard.press('Escape');
  await page.getByTestId('pause-settings').click();
  await frames();
  await page.getByTestId('set-seasons').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/settings.png` });
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  // Photo mode: autumn fog.
  await page.keyboard.press('k');
  await page.getByTestId('photo-season-autumn').click();
  await page.getByTestId('photo-weather-fog').click();
  await page.evaluate(() =>
    window.__game.setCamera({ x: 330, z: 905, yaw: 0.55, distance: 460, tilt: 0.22 }),
  );
  await frames(3);
  await page.screenshot({ path: `${out}/photo.png` });
  if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
