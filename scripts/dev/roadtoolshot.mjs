// Dev (M19): builds a roundabout, one-way streets, a city highway passing over a street, a street
// passing over it and a ramp, then screenshots each. Usage: npm run build:test &&
// node scripts/dev/roadtoolshot.mjs <outDir> [hour]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const hour = Number(process.argv[3] ?? 14);
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
  await page.goto('http://localhost:4188/?paused=1');
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
  const c = await page.evaluate(async () => {
    const g = window.__game;
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    await g.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900000 });
    const at = (x, z) => ({ x: c.x + x, z: c.z + z });
    const log = [];
    const b = async (road, pts, extra = {}) => {
      const r = await g.dispatch({
        type: 'buildRoad',
        road,
        points: pts.map(([x, z]) => at(x, z)),
        ...extra,
      });
      log.push(`${road} ${JSON.stringify(pts)} ${r.ok ? 'ok' : r.reason}`);
      return r;
    };
    await b('avenue', [
      [0, 0],
      [760, 0],
    ]);
    await b('street', [
      [250, -200],
      [250, 420],
    ]);
    const rb = await g.dispatch({ type: 'roundabout', at: at(250, 0) });
    log.push(`roundabout ${rb.ok ? 'ok ' + JSON.stringify(rb.info) : rb.reason}`);
    await b(
      'street',
      [
        [420, -220],
        [420, 0],
      ],
      { oneway: true },
    );
    await b(
      'street',
      [
        [500, 0],
        [500, -220],
      ],
      { oneway: true },
    );
    await b(
      'street',
      [
        [420, -220],
        [500, -220],
      ],
      { oneway: true },
    );
    await b('motorway', [
      [100, 300],
      [760, 300],
    ]);
    await b('street', [
      [560, 0],
      [560, 460],
    ]);
    await b('street', [
      [380, 200],
      [520, 200],
    ]);
    await b('ramp', [
      [430, 300],
      [470, 288],
      [490, 200],
    ]);
    await g.dispatch({
      type: 'zone',
      zone: 'R',
      area: { kind: 'brush', points: [at(300, -120), at(400, -120)], radius: 80 },
    });
    await g.dispatch({
      type: 'zone',
      zone: 'C',
      area: { kind: 'brush', points: [at(260, 80), at(540, 80)], radius: 40 },
    });
    return { c, log };
  });
  console.log(c.log.join('\n'));
  await page.evaluate((h) => window.__game.setPhoto?.({ hour: h }), hour).catch(() => {});
  await page.evaluate(() => window.__game.advance(600));
  const snap = async (name, pose) => {
    await page.evaluate((p) => window.__game.setCamera(p), pose);
    await page.evaluate(() => window.__game.waitFrames(3));
    await page.screenshot({ path: `${out}/${name}.png` });
  };
  const { x, z } = c.c;
  await snap('rt-roundabout', { x: x + 250, z, distance: 110, yaw: 0.6, tilt: 0.1 });
  await snap('rt-oneway', { x: x + 460, z: z - 110, distance: 180, yaw: 0.3, tilt: 0.15 });
  await snap('rt-flyover', { x: x + 250, z: z + 300, distance: 140, yaw: 1.1, tilt: -0.05 });
  await snap('rt-overpass', { x: x + 560, z: z + 300, distance: 150, yaw: 2.2, tilt: -0.05 });
  await snap('rt-ramp', { x: x + 460, z: z + 250, distance: 170, yaw: 0.8, tilt: 0.1 });
  await snap('rt-overview', { x: x + 420, z: z + 120, distance: 700, yaw: 0.5, tilt: 0.3 });
  // The interface: the road tool's modes, a road's inspector and the traffic map (UI=1).
  if (process.env.UI) {
    await page.evaluate(() => window.__game.advance(1440 * 3));
    await page.evaluate((p) => window.__game.setCamera(p), {
      x: x + 330,
      z: z - 40,
      distance: 260,
      yaw: 0.4,
      tilt: 0.2,
    });
    await page.evaluate(() => window.__game.waitFrames(2));
    await page.click('[data-testid=tool-road]');
    await page.click('[data-testid=mode-roundabout]');
    await page.screenshot({ path: `${out}/rt-ui-toolbar.png` });
    await page.click('[data-testid=tool-select]');
    const pt = await page.evaluate(({ x, z }) => window.__game.worldToScreen(x + 420, z - 120), { x, z });
    await page.mouse.click(pt.x, pt.y);
    await page.evaluate(() => window.__game.waitFrames(2));
    await page.screenshot({ path: `${out}/rt-ui-inspector.png` });
    await page.evaluate(() => window.__game.setOverlay('traffic'));
    await page.evaluate(() => window.__game.waitFrames(2));
    await page.screenshot({ path: `${out}/rt-ui-traffic.png` });
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
