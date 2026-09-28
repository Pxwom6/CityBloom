// Dev (M24): the terrain tool through the UI on seed `hill` (highlands): a hillside before and after
// levelling with the tool, a street and zoning across the levelled ground, a raised mound and a
// dug hollow, and the tool's hint. Usage: node scripts/dev/terrainshot.mjs outDir (after build:test)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4188', '--strictPort'], {
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
  await page.goto('http://localhost:4188/?seed=hill&preset=highlands&paused=1');
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
  await page.evaluate(() => window.__game.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400000 }));
  const hz = await page.evaluate(async () => (await window.__game.getState()).highwayZ);
  const x = 824;
  const cam = async (p) => {
    await page.evaluate((p) => window.__game.setCamera(p), p);
    await page.evaluate(() => window.__game.waitFrames(2));
  };
  const scr = (x, z) => page.evaluate(([x, z]) => window.__game.worldToScreen(x, z), [x, z]);
  const view = { x: x + 10, z: hz - 200, distance: 620, yaw: 0.9, tilt: 0.55 };
  await cam(view);
  await page.screenshot({ path: `${out}/before.png` });
  // The terrain tool, level, dragged along both sides of where the street will go.
  await page.keyboard.press('Shift+T');
  await page.getByTestId('terrain-level').click();
  const money0 = (await page.evaluate(() => window.__game.getState())).treasury;
  for (const dx of [-48, -16, 16, 48]) {
    for (let z0 = hz - 10; z0 > hz - 390; z0 -= 95) {
      await cam(view);
      const a = await scr(x + dx, z0);
      const b = await scr(x + dx, z0 - 95);
      await page.mouse.move(a.x, a.y);
      await page.mouse.down();
      await page.mouse.move(b.x, b.y, { steps: 8 });
      await page.waitForTimeout(400);
      await page.mouse.up();
    }
  }
  await page.evaluate(() => window.__game.waitFrames(2));
  const money1 = (await page.evaluate(() => window.__game.getState())).treasury;
  console.log(`levelling cost $${money0 - money1}`);
  const hint = await scr(x + 120, hz - 200);
  await page.mouse.move(hint.x, hint.y);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/levelled.png` });
  // A street across the levelled ground, zoned.
  await page.evaluate(
    ([x, hz]) =>
      window.__game.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x, z: hz },
          { x, z: hz - 400 },
        ],
      }),
    [x, hz],
  );
  await page.evaluate(
    ([x, hz]) =>
      window.__game.dispatch({
        type: 'zone',
        zone: 'R',
        area: {
          kind: 'brush',
          points: [
            { x, z: hz - 20 },
            { x, z: hz - 390 },
          ],
          radius: 60,
        },
      }),
    [x, hz],
  );
  await page.keyboard.press('Escape');
  await cam(view);
  await page.screenshot({ path: `${out}/street.png` });
  // Raise a mound and dig a hollow on open ground.
  await page.keyboard.press('Shift+T');
  await page.getByTestId('terrain-raise').click();
  const m = { x: 1000, z: hz - 250 };
  await cam({ x: m.x + 60, z: m.z, distance: 520, yaw: 0.9, tilt: 0.5 });
  let p = await scr(m.x, m.z);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(3000);
  await page.mouse.up();
  await page.getByTestId('terrain-lower').click();
  p = await scr(m.x + 130, m.z);
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.waitForTimeout(3000);
  await page.mouse.up();
  await page.evaluate(() => window.__game.waitFrames(2));
  await page.mouse.move(p.x + 60, p.y - 60);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/mound.png` });
  console.log(JSON.stringify(await page.evaluate(() => window.__game.getTerrainEdits?.())).slice(0, 300));
  if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
