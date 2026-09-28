// Dev (M20): a town with a railway from the regional link, a level crossing, two stations, trams on
// the avenue and a rail freight terminal; screenshots of each and the ridership map.
// Usage: node scripts/dev/railshot.mjs outDir [ticks] [hour]   (after npm run build:test)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const ticks = Number(process.argv[3] ?? 4320);
const hour = Number(process.argv[4] ?? 8);
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4186', '--strictPort'], {
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
  await page.goto(`http://localhost:4186/?paused=1&seed=${process.env.SEED ?? 'goods'}`);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
  const info = await page.evaluate(
    async ({ ticks, hour }) => {
      const g = window.__game;
      const log = [];
      const d = async (cmd) => {
        const r = await g.dispatch(cmd);
        if (!r.ok) log.push(`${cmd.type} ${cmd.road ?? cmd.def ?? ''}: ${r.reason}`);
        return r;
      };
      await d({ type: 'cheat', cheat: 'unlockAll' });
      await d({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
      const s = await g.getState();
      const c = { x: 24, z: s.highwayZ };
      const rail = s.railway;
      const dir = Math.sign(rail.z - c.z) || 1;
      const at = (dx, dz) => ({ x: c.x + dx, z: c.z + dz });
      const rz = rail.z - c.z;
      await d({ type: 'buildRoad', road: 'avenue', points: [c, at(640, 0)] });
      for (const x of [120, 220, 420, 520])
        await d({ type: 'buildRoad', road: 'street', points: [at(x, -dir * 170), at(x, dir * 170)] });
      // A street over the railway at a level crossing.
      await d({ type: 'buildRoad', road: 'street', points: [at(320, -dir * 170), at(320, rz + dir * 110)] });
      // The railway from the regional link along the town's side.
      await d({ type: 'buildRoad', road: 'rail', points: [{ x: rail.x, z: rail.z }, at(760, rz)] });
      const brush = (zone, a, b, radius) =>
        d({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
      await brush('R', at(40, -dir * 100), at(600, -dir * 100), 75);
      await brush('C', at(40, dir * 20), at(600, dir * 20), 25);
      await brush('R', at(40, dir * 110), at(300, dir * 110), 55);
      await brush('I', at(420, dir * 120), at(600, dir * 120), 55);
      for (const def of ['coal', 'pump', 'pump', 'pump', 'treatment', 'landfill'])
        await g.placeCivic(def, at(560, -dir * 170));
      for (const [def, x, dz] of [
        ['firestation', 120, -60],
        ['police', 420, -60],
        ['clinic', 220, 60],
        ['primary', 520, -110],
      ])
        await g.placeCivic(def, at(x, dir * dz));
      // Stations near each end of town.
      const stations = [
        await g.placeCivic('station', at(150, rz)),
        await g.placeCivic('station', at(560, rz)),
      ];
      // Tram track along the avenue, a depot and stops.
      for (let x = 30; x <= 630; x += 20) {
        const sg = g.segmentAt(c.x + x, c.z);
        if (sg && sg.type === 'avenue') await g.dispatch({ type: 'setTram', seg: sg.id, on: true });
      }
      const depot = await g.placeCivic('tramdepot', at(80, 0));
      for (const x of [110, 270, 370, 470, 600])
        await d({ type: 'placeStop', x: c.x + x, z: c.z + dir * 8, tram: true });
      // A freight terminal between the industry and the railway.
      await d({ type: 'buildRoad', road: 'street', points: [at(420, dir * 170), at(420, rz - dir * 52)] });
      await d({
        type: 'buildRoad',
        road: 'street',
        points: [at(420, rz - dir * 52), at(700, rz - dir * 52)],
      });
      const freight = await g.placeCivic('railfreight', at(560, rz - dir * 52));
      await g.advance(ticks);
      const st = await g.getState();
      const now = (st.tick + 420) % 1440;
      let dt = hour * 60 - now;
      if (dt <= 0) dt += 1440;
      await g.advance(dt);
      g.setSpeed(1);
      return { c, rail, dir, rz, stations, depot, freight, log };
    },
    { ticks, hour },
  );
  console.log(JSON.stringify(info));
  for (let k = 0; k < 6; k++) await page.evaluate(() => window.__game.waitFrames(4));
  await page.evaluate(() => window.__game.setSpeed(0));
  const st = await page.evaluate(() => window.__game.getState());
  console.log('pop', st.population, 'calls', st.renderStats.calls, 'tris', st.renderStats.triangles);
  console.log(
    'rail',
    JSON.stringify(st.renderStats.rail),
    JSON.stringify(await page.evaluate(() => window.__game.getTransit())),
  );
  const snap = async (name, pose) => {
    await page.evaluate((p) => window.__game.setCamera(p), pose);
    await page.evaluate(() => window.__game.waitFrames(2));
    await page.screenshot({ path: `${out}/${name}.png` });
  };
  const { c, rail, rz } = info;
  const only = process.env.ONLY?.split(',');
  const want = (n) => !only || only.includes(n);
  if (want('overview'))
    await snap('overview', { x: c.x + 330, z: c.z + rz / 2, distance: 700, yaw: 0.2, tilt: 0.1 });
  if (want('crossing'))
    await snap('crossing', { x: c.x + 320, z: c.z + rz, distance: 70, yaw: 0.6, tilt: 0 });
  const civ = await page.evaluate(() => window.__game.getCivics());
  const byId = (id) => civ.find((x) => x.id === id);
  if (want('station') && byId(info.stations[0]))
    await snap('station', {
      x: byId(info.stations[0]).x,
      z: byId(info.stations[0]).z,
      distance: 90,
      yaw: 0.8,
      tilt: 0,
    });
  if (want('tram')) await snap('tram', { x: c.x + 280, z: c.z, distance: 80, yaw: 0.5, tilt: 0 });
  if (want('depot') && byId(info.depot))
    await snap('depot', { x: byId(info.depot).x, z: byId(info.depot).z, distance: 80, yaw: 0.7, tilt: 0 });
  if (want('freight') && byId(info.freight))
    await snap('freight', {
      x: byId(info.freight).x,
      z: byId(info.freight).z,
      distance: 110,
      yaw: 0.6,
      tilt: 0,
    });
  if (want('edge')) await snap('edge', { x: rail.x + 40, z: rail.z, distance: 160, yaw: -1.2, tilt: 0.05 });
  for (const kind of ['tram', 'train', 'freight']) {
    if (!want(kind + 'car')) continue;
    const v = await page.evaluate((k) => window.__game.getRailVehicles().find((x) => x.kind === k), kind);
    if (v)
      await snap(kind + 'car', { x: v.x, z: v.z, distance: kind === 'tram' ? 45 : 90, yaw: 0.9, tilt: 0.05 });
  }
  // Inspectors, opened by clicking things on screen (the real UI).
  const clickAt = async (name, x, z, pose) => {
    await page.evaluate((p) => window.__game.setCamera(p), pose);
    await page.evaluate(() => window.__game.waitFrames(2));
    const s = await page.evaluate(([x, z]) => window.__game.worldToScreen(x, z), [x, z]);
    await page.mouse.click(s.x, s.y);
    await page.evaluate(() => window.__game.waitFrames(3));
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${out}/${name}.png` });
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.__game.waitFrames(1));
  };
  if (want('ui')) {
    const shelters = (await page.evaluate(() => window.__game.getTransit())).shelters.filter((s) => s.tram);
    const t = shelters.sort((a, b) => Math.abs(a.x - c.x - 270) - Math.abs(b.x - c.x - 270))[0];
    await clickAt('insp-tramstop', t.x, t.z, { x: t.x, z: t.z, distance: 60, yaw: 0.4, tilt: 0 });
    await clickAt('insp-road', c.x + 356, c.z, { x: c.x + 356, z: c.z, distance: 70, yaw: 0.4, tilt: 0 });
    await clickAt('insp-rail', c.x + 400, c.z + rz, {
      x: c.x + 400,
      z: c.z + rz,
      distance: 70,
      yaw: 0.4,
      tilt: 0,
    });
    const st = byId(info.stations[0]);
    if (st) await clickAt('insp-station', st.x, st.z, { x: st.x, z: st.z, distance: 90, yaw: 0.4, tilt: 0 });
    const fr = byId(info.freight);
    if (fr) await clickAt('insp-freight', fr.x, fr.z, { x: fr.x, z: fr.z, distance: 110, yaw: 0.4, tilt: 0 });
    await page.getByTestId('tool-road').click();
    await page.getByTestId('road-rail').hover();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/ui-roadbar.png` });
    await page.getByTestId('mode-tram').click();
    const s2 = await page.evaluate(
      ([x, z]) => window.__game.worldToScreen(x, z),
      [c.x + 200, c.z - info.dir * 100],
    );
    await page.mouse.move(s2.x, s2.y);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${out}/ui-tramtool.png` });
    await page.getByTestId('tool-select').click();
  }
  if (want('map')) {
    await page.evaluate(() => window.__game.setOverlay('transit'));
    await page.waitForTimeout(500);
    await snap('ridership', { x: c.x + 330, z: c.z + rz / 2, distance: 700, yaw: 0, tilt: 0.3 });
  }
  if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
