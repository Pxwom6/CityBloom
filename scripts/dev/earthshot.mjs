// Dev (M13): build streets over a hill on a highlands map, grow a little town along them and
// screenshot the embankments, cuttings and buildings beside them.
// Usage: node scripts/dev/earthshot.mjs outDir [ticks=2880]  (after `npm run build:test`)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const ticks = Number(process.argv[3] ?? 2880);
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4191', '--strictPort'], {
  stdio: 'ignore',
  // Its own process group, so the preview server (a child of npx) goes down with it.
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
  await page.goto('http://localhost:4191/?seed=hill&preset=highlands&paused=1');
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
  const log = await page.evaluate(
    async ([ticks, nobuild]) => {
      const g = window.__game;
      if (nobuild) return ['(nothing built)'];
      const s = await g.getState();
      const c = { x: 24, z: s.highwayZ };
      await g.dispatch({ type: 'cheat', cheat: 'unlockAll' });
      await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400000 });
      const res = [];
      const road = async (type, points) => {
        const r = await g.dispatch({ type: 'buildRoad', road: type, points });
        res.push(
          `${type} ${JSON.stringify(points)} ${r.ok ? '$' + r.cost + ' ' + JSON.stringify(r.info.grade.earth) + ' max ' + r.info.grade.max + ' ground ' + r.info.grade.ground : r.reason}`,
        );
        return r;
      };
      // Two streets over a ridge (up to 18 m high), joined into a loop, with homes and shops along
      // them; a fire station beside the cutting.
      await road('avenue', [c, { x: 560, z: 1030 }]);
      await road('street', [
        { x: 560, z: 1030 },
        { x: 560, z: 1000 },
      ]);
      await road('street', [
        { x: 560, z: 1030 },
        { x: 560, z: 1060 },
      ]);
      await road('street', [
        { x: 560, z: 1000 },
        { x: 840, z: 1000 },
      ]);
      await road('street', [
        { x: 560, z: 1060 },
        { x: 840, z: 1060 },
      ]);
      await road('street', [
        { x: 840, z: 1000 },
        { x: 840, z: 1060 },
      ]);
      await road('street', [
        { x: 700, z: 1060 },
        { x: 700, z: 1200 },
      ]);
      const brush = (zone, a, b, radius) =>
        g.dispatch({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
      await brush('R', { x: 570, z: 960 }, { x: 830, z: 960 }, 40);
      await brush('R', { x: 570, z: 1100 }, { x: 830, z: 1100 }, 40);
      await brush('C', { x: 700, z: 1080 }, { x: 700, z: 1190 }, 30);
      for (const def of ['coal', 'pump', 'pump', 'treatment', 'landfill'])
        await g.placeCivic(def, { x: 200, z: 1200 });
      const fire = await g.placeCivic('firestation', { x: 760, z: 1030 });
      res.push('firestation ' + fire);
      await g.advance(ticks);
      return res;
    },
    [ticks, !!process.env.NOBUILD],
  );
  console.log(log.join('\n'));
  const st = await page.evaluate(() => window.__game.getState());
  console.log('pop', st.population, 'buildings', st.buildings);
  console.log('terrain', JSON.stringify(await page.evaluate(() => window.__game.getTerrainEdits())));
  const shots = [
    ['earth-a', { x: 700, z: 1030, distance: 320, yaw: 0.6, tilt: 0.1 }],
    ['earth-b', { x: 740, z: 1000, distance: 120, yaw: 0.2, tilt: 0.05 }],
    ['earth-c', { x: 740, z: 1060, distance: 120, yaw: 2.9, tilt: 0.05 }],
    ['earth-d', { x: 700, z: 1030, distance: 110, yaw: 1.7, tilt: 0 }],
    ['earth-e', { x: 790, z: 1030, distance: 100, yaw: -1.2, tilt: 0 }],
    ['earth-top', { x: 700, z: 1030, distance: 260, yaw: 0.3, tilt: 0.6 }],
  ];
  for (const [name, pose] of shots) {
    await page.evaluate((p) => window.__game.setCamera(p), pose);
    await page.evaluate(() => window.__game.waitFrames(2));
    await page.screenshot({ path: `${out}/${name}.png` });
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
