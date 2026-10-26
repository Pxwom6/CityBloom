// Dev (phase 5): screenshot the war buildings' hand-made models in the game. Boots a city with war
// on (rival neighbours), so the game fetches the war models file itself, lays every war building
// out with the test API's showCivics (the ones the game doesn't have yet as stand-ins on the page),
// and shoots them by day and at night, plus the naval yard's dry dock and the spy agency's ramp
// from above (with the ground, and without it to see what the lot base leaves open).
// Usage: npm run build:test && node scripts/dev/warshot.mjs outDir [--only day,each,night,pits]
//        [--hour 13] [--night 22] [--dist dist-test] [--gpu]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};
const out = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!out) throw new Error('usage: node scripts/dev/warshot.mjs outDir [--only day,each,night,pits]');
mkdirSync(out, { recursive: true });
const only = new Set(flag('only', 'day,each,night,pits').split(','));
const day = Number(flag('hour', '13'));
const night = Number(flag('night', '22'));
const dist = flag('dist', 'dist-test');
const gpu = argv.includes('--gpu');

/** Every war building, biggest first so the rows pack. */
const WAR = [
  'airfield',
  'navalyard',
  'provingground',
  'vehicledepot',
  'armsfactory',
  'enrichment',
  'expressgate',
  'militaryhq',
  'barracks',
  'domeshield',
  'atomsilo',
  'militarylab',
  'radar',
  'interceptor',
  'shieldgen',
  'spyagency',
  'blackouttower',
  'shelter',
  'bunker',
  'antiair',
  'coastalgun',
];

const PORT = 4187;
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch(
  gpu
    ? { channel: 'chrome', headless: false, args: ['--window-size=1300,900', '--window-position=0,0'] }
    : {
        args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
        // A browser other than Playwright's own revision (env PW_CHROMIUM=path), as a VM may have.
        ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
      },
);
const t0 = Date.now();
const files = [];
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 1 });
  // The software renderer takes many seconds a frame.
  page.setDefaultTimeout(300_000);
  const errors = [];
  const fetched = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => /models-[\w-]+\.bin/.test(r.url()) && fetched.push(r.url().replace(/^.*\//, '')));
  await page.addInitScript(() =>
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({ tips: false, graphicsChecked: true, quality: 'medium' }),
    ),
  );
  // An open map with war on: the game fetches the war models itself.
  await page.goto(`http://localhost:${PORT}/?paused=1&seed=models&preset=lakes&rivals=1`);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120000 });
  await page.waitForFunction(() => window.__game.getWarModels().designs.length > 0, null, {
    timeout: 60000,
  });
  const loaded = await page.evaluate(() => window.__game.getWarModels());
  console.log(
    `war on: ${loaded.designs.length} war buildings and ${loaded.units.length} units loaded; files fetched: ${fetched.join(', ')}`,
  );
  await page.addStyleTag({ content: '#ui { display: none !important; }' });

  const toHour = (h) =>
    page.evaluate(async (hour) => {
      const g = window.__game;
      const st = await g.getState();
      const now = ((st.tick + 420) % 1440) / 60;
      let d = (hour - now) * 60;
      if (d < 0) d += 1440;
      if (d > 0) await g.advance(Math.round(d));
      g.setWeatherLook({ season: [0, 1, 0, 0], kind: 'clear', strength: 0, snow: 0, wet: 0 });
    }, h);
  const placed = await page.evaluate(async (defs) => {
    const g = window.__game;
    g.showGroup('icons', false);
    const p = g.showCivics(
      defs.map((def) => ({ def })),
      { x: 260, z: 820 },
      430,
    );
    await g.waitFrames(6);
    return p.map((c) => ({ ...c, ...g.civicSize(c.def), hand: null }));
  }, WAR);
  console.log(`laid out: ${placed.map((c) => c.def).join(' ')}`);

  const shoot = async (name, pose, opts = {}) => {
    await page.evaluate(
      ({ pose, terrain }) => {
        const g = window.__game;
        g.setCamera(pose);
        g.showGroup('terrain', terrain);
        g.showGroup('water', terrain);
        g.showGroup('trees', terrain);
      },
      { pose, terrain: opts.terrain !== false },
    );
    await page.evaluate(() => window.__game.waitFrames(4));
    const f = `${out}/${name}.png`;
    await page.screenshot({ path: f });
    files.push(f);
    console.log(`${f} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  };
  const xs = placed.map((c) => c.x);
  const zs = placed.map((c) => c.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const at = (def) => placed.find((c) => c.def === def);
  const close = (c, yaw = 0.45, tilt = 0.3) => ({
    x: c.x,
    z: c.z,
    distance: Math.max(c.w, c.d) * 1.1 + 24,
    yaw,
    tilt,
  });

  if (only.has('day') || only.has('each')) await toHour(day);
  if (only.has('day')) {
    await shoot('day-all', { x: cx, z: cz, distance: 520, yaw: 0.35, tilt: 0 });
    await shoot('day-all-back', { x: cx, z: cz, distance: 520, yaw: Math.PI + 0.35, tilt: 0 });
  }
  if (only.has('each'))
    for (const c of placed) {
      await shoot(`day-${c.def}`, close(c));
      // The three whose doors face away from the road on purpose, from behind too.
      if (['airfield', 'bunker', 'enrichment', 'navalyard', 'coastalgun'].includes(c.def))
        await shoot(`day-${c.def}-back`, close(c, Math.PI - 0.5));
    }
  if (only.has('pits')) {
    if (!only.has('day') && !only.has('each')) await toHour(day);
    for (const def of ['navalyard', 'spyagency', 'coastalgun']) {
      const c = at(def);
      const d = def === 'navalyard' ? 110 : 40;
      // From above and behind (the site's back is +z here), with the ground and without it.
      const pose = { x: c.x, z: c.z + c.d * 0.15, distance: d, yaw: Math.PI - 0.3, tilt: 0.6 };
      await shoot(`pit-${def}`, pose);
      await shoot(`pit-${def}-noground`, pose, { terrain: false });
    }
  }
  if (only.has('night')) {
    await toHour(night);
    await shoot('night-all', { x: cx, z: cz, distance: 520, yaw: 0.35, tilt: 0 });
    for (const def of ['atomsilo', 'navalyard', 'blackouttower', 'expressgate'])
      await shoot(`night-${def}`, close(at(def)));
  }
  const s = await page.evaluate(() => window.__game.getState());
  console.log(
    `${placed.length} buildings, ${s.renderStats.calls} calls, ${(s.renderStats.triangles / 1e3).toFixed(0)}k triangles, ${files.length} pictures in ${out}, ${((Date.now() - t0) / 1000).toFixed(0)} s`,
  );
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {
    // The preview server has gone already.
  }
}
