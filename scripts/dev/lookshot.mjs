// Dev (phase 3): how the city looks at each zoom and time of day, in a headed Chrome window on
// the real GPU. Imports a saved city through the load screen and shoots each camera preset at
// each hour (and season), for before-and-after comparisons (SPEC-3: dawn, noon, golden hour and
// night, at whole-city and street zoom).
// Usage: npm run build:test && node scripts/dev/lookshot.mjs city.gz outDir [--views overview,city,street]
//          [--hours 6.3,13,18.6,22] [--season summer|winter|…] [--quality high] [--dist dist-test]
//          [--label name] [--at x,z] [--sheet]
// `--at x,z` centres every preset on that point; `--sheet` also tiles the pictures, a row a view.
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const VALUE_FLAGS = ['views', 'hours', 'season', 'quality', 'dist', 'label', 'at', 'tone', 'init'];
const flag = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]?.slice(2)));
const [file, out] = pos;
if (!file || !out)
  throw new Error('usage: node scripts/dev/lookshot.mjs city.gz outDir [--views …] [--hours …]');
mkdirSync(out, { recursive: true });
const views = flag('views', 'overview,city,street').split(',');
const hours = flag('hours', '6.3,13,18.6,22').split(',').map(Number);
const season = flag('season', null);
const quality = flag('quality', 'high');
const dist = flag('dist', 'dist-test');
const label = flag('label', 'look');
const at = flag('at', null)?.split(',').map(Number) ?? null;
// `--tone neutral:1.1`: a tone mapping and exposure to try (dev builds with `setTone`).
const tone = flag('tone', null)?.split(':') ?? null;
// `--init "js"`: run in the page before shooting (dev: try a renderer setting).
const init = flag('init', null);
const PRESETS = {
  low: { quality: 'low', shadows: false, drawDistance: 'near' },
  medium: { quality: 'medium', shadows: true, drawDistance: 'medium' },
  high: { quality: 'high', shadows: true, drawDistance: 'medium' },
};
const PORT = 4198;
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-size=1512,945', '--window-position=0,0'],
});
const files = [];
try {
  const page = await browser.newPage({ viewport: null });
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
  await page.addInitScript(
    (p) =>
      localStorage.setItem(
        'citybloom.settings',
        JSON.stringify({ tips: false, graphicsChecked: true, ...p }),
      ),
    PRESETS[quality],
  );
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  if (init) await page.evaluate(init);
  await page.evaluate(
    ({ season, tone }) => {
      const g = window.__game;
      g.setSpeed(0);
      if (tone) g.setTone(tone[0], Number(tone[1] ?? 1));
      // Clear weather in the season asked for (summer by default), so the hours compare.
      const i = ['spring', 'summer', 'autumn', 'winter'].indexOf(season ?? 'summer');
      g.setWeatherLook({
        season: [0, 1, 2, 3].map((k) => (k === i ? 1 : 0)),
        kind: 'clear',
        strength: 0,
        snow: season === 'winter' ? 0.75 : 0,
        wet: 0,
      });
    },
    { season, tone },
  );
  // Every view at an hour before the next hour, so the run spans one game day: a game month is a
  // day, and a view a day had the sim three months on (with snow on its roads) by the last view.
  const shots = [];
  for (const hour of hours) for (const view of views) shots.push({ view, hour });
  for (const { view, hour } of shots) {
    await page.evaluate(
      async ({ view, hour, at }) => {
        const g = window.__game;
        const s = await g.getState();
        const now = ((s.tick + 7 * 60) % 1440) / 60;
        const d = Math.round(((((hour - now) % 24) + 24) % 24) * 60);
        if (d > 0) await g.advance(d);
        g.setCamera(view);
        if (at) g.setCamera({ x: at[0], z: at[1] });
        await g.waitFrames(12);
      },
      { view, hour, at },
    );
    await page.waitForTimeout(400);
    const f = `${out}/${label}-${view}-${String(hour).replace('.', 'h')}${season ? `-${season}` : ''}.png`;
    await page.screenshot({ path: f });
    files.push(f);
  }
  // The sheet keeps a row a view.
  files.sort((a, b) => {
    const ka = shots.findIndex((s) => a.includes(`-${s.view}-${String(s.hour).replace('.', 'h')}`));
    const kb = shots.findIndex((s) => b.includes(`-${s.view}-${String(s.hour).replace('.', 'h')}`));
    const [va, ha] = [shots[ka], shots[ka]];
    return (
      views.indexOf(va.view) - views.indexOf(shots[kb].view) ||
      hours.indexOf(ha.hour) - hours.indexOf(shots[kb].hour)
    );
  });
  console.log(`${files.length} pictures in ${out}`);
} finally {
  await browser.close();
  process.kill(-server.pid);
}
if (argv.includes('--sheet')) {
  const sheet = `${out}/${label}-sheet${season ? `-${season}` : ''}.png`;
  execFileSync('node', ['scripts/dev/montage.mjs', sheet, String(hours.length), ...files]);
  console.log(sheet);
}
