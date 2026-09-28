// Dev (M22): every season and every kind of weather over Kingsmere (the Market Town scenario's
// city), from a low view with sky and from above. The winter shots let real snow fall in the sim
// first, so it lies on the roads (and ploughs can be seen at work with PLOUGH=1).
// Usage: node scripts/dev/weathershot.mjs outDir   (after npm run build:test)
//   ONLY=spring,summer,autumn,winter,rain,storm,snow,fog,heat,cloudy,roads   VIEW=low|high
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const only = process.env.ONLY?.split(',');
const want = (k) => !only || only.includes(k);
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4189', '--strictPort'], {
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
  await page.goto('http://localhost:4189/?scenario=market');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 120000,
  });
  await page.getByTestId('scenario-begin').click();
  await page.evaluate(() => window.__game.setSpeed(0));
  // Hide the interface for clean frames.
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const views = {
    low: { x: 330, z: 905, yaw: 0.55, distance: 460, tilt: 0.22 },
    high: { x: 520, z: 760, yaw: 0.3, distance: 900, tilt: 0.75 },
  };
  const view = views[process.env.VIEW ?? 'low'];
  const shot = async (name, look, at = view) => {
    await page.evaluate((l) => window.__game.setWeatherLook(l), look);
    await page.evaluate((v) => window.__game.setCamera(v), at);
    await page.evaluate(() => window.__game.waitFrames(3));
    const w = await page.evaluate(() => window.__game.getWeather());
    console.log(
      name,
      JSON.stringify({ look: w.look, particles: w.particles, overcast: w.overcast, fog: w.fog }),
    );
    await page.screenshot({ path: `${out}/${name}.png` });
  };
  const clear = { kind: 'clear', strength: 0, snow: 0, wet: 0 };
  const S = { spring: [1, 0, 0, 0], summer: [0, 1, 0, 0], autumn: [0, 0, 1, 0], winter: [0, 0, 0, 1] };
  // Early afternoon, so every frame is lit alike.
  const afternoon = () =>
    page.evaluate(async () => {
      const g = window.__game;
      const s = await g.getState();
      const hour = ((s.tick + 420) % 1440) / 60;
      await g.advance(Math.round(((13 - hour + 24) % 24) * 60));
    });
  await afternoon();
  for (const s of ['spring', 'summer', 'autumn']) if (want(s)) await shot(s, { ...clear, season: S[s] });
  if (want('cloudy'))
    await shot('cloudy', { season: S.summer, kind: 'cloudy', strength: 0.8, snow: 0, wet: 0.2 });
  if (want('rain')) await shot('rain', { season: S.spring, kind: 'rain', strength: 0.9, snow: 0, wet: 1 });
  if (want('storm')) await shot('storm', { season: S.summer, kind: 'storm', strength: 1, snow: 0, wet: 1 });
  if (want('fog')) await shot('fog', { season: S.autumn, kind: 'fog', strength: 0.9, snow: 0, wet: 0.4 });
  if (want('heat')) await shot('heat', { season: S.summer, kind: 'heat', strength: 1, snow: 0, wet: 0 });
  // PLOUGH=1: a public works depot by the market, so ploughs are out clearing the snow.
  if (process.env.PLOUGH) {
    const id = await page.evaluate(() => window.__game.placeCivic('works', { x: 204, z: 1010 }));
    console.log('depot', id);
  }
  if (want('winter') || want('snow') || want('roads')) {
    // Real snow: twelve hours of it in the sim, so it lies on the roads too.
    await page.evaluate(() =>
      window.__game.dispatch({ type: 'cheat', cheat: 'weather', kind: 'snow', strength: 1, hours: 12 }),
    );
    const snowHours = process.env.PLOUGH ? 4 : 10;
    await page.evaluate((h) => window.__game.advance(60 * h), snowHours);
    if (!process.env.PLOUGH) await afternoon();
    if (process.env.PLOUGH) {
      // Out on a round: find a plough and look at it.
      await page.evaluate(() => window.__game.advance(60));
      await page.evaluate(() => window.__game.waitFrames(2));
      const ploughs = await page.evaluate(() =>
        window.__game.getVehicles().filter((v) => v.kind === 'plough'),
      );
      const st = await page.evaluate(async () => {
        const s = await window.__game.getState();
        return { vehicles: s.vehicles, weather: s.weather.kind, snowy: s.weather.roadsSnowy, tick: s.tick };
      });
      console.log('ploughs', JSON.stringify(ploughs), JSON.stringify(st));
      if (ploughs[0])
        await shot(
          'plough',
          { season: S.winter, kind: 'clear', strength: 0, snow: 0.8, wet: 0 },
          { x: ploughs[0].x, z: ploughs[0].z, yaw: 0.6, distance: 70, tilt: 0.45 },
        );
      const depot = await page.evaluate(() => window.__game.getCivics().find((c) => c.def === 'works'));
      if (depot)
        await shot(
          'depot',
          { season: S.winter, kind: 'clear', strength: 0, snow: 0.8, wet: 0 },
          { x: depot.x, z: depot.z, yaw: 2.2, distance: 90, tilt: 0.5 },
        );
    }
    await page.evaluate(() => window.__game.waitFrames(2));
    if (want('snow'))
      await shot('snow', { season: S.winter, kind: 'snow', strength: 0.9, snow: 0.8, wet: 0.3 });
    if (want('winter'))
      await shot('winter', { season: S.winter, kind: 'clear', strength: 0, snow: 0.8, wet: 0.2 });
    if (want('roads')) {
      await shot(
        'roads',
        { season: S.winter, kind: 'clear', strength: 0, snow: 0.8, wet: 0 },
        { x: 200, z: 925, yaw: 0.4, distance: 220, tilt: 0.6 },
      );
    }
  }
  if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
