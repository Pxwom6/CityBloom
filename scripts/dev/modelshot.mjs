// Dev (phase 3): screenshot hand-made models in the game. Zoned types stand in rows of looks
// (hand-made and generated mixed, as in a city), one picture a row; civic buildings one at a time.
// Usage: npm run build:test && node scripts/dev/modelshot.mjs outDir [what …] [--hour 13] [--gpu]
//        [--variants 6] [--season winter] [--dist dist-test] [--backs] [--sheet cols] [--lod far|sky|all]
//   what: zoned rows like R103 R103@2x3 R103@2x2, civic ids like firestation coal, or a batch:
//   R0 R1 R2 C0 C1 C2 I0 I1 I2 (a zone and density), services, utilities, parks, special, big,
//   projects, stages (each project at each stage), annexes, landfill (empty to full).
// `--gpu` uses the real GPU in a headed Chrome window (true colours, and fast); the default is
// Playwright's own Chromium on the software renderer. `--backs` adds each civic building's back.
// `--sheet 3` also tiles the pictures into one image, three across.
import { chromium } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const VALUE_FLAGS = ['hour', 'variants', 'season', 'dist', 'sheet', 'lod'];
const flag = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};
const pos = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]?.slice(2)));
const out = pos[0];
const what = pos.slice(1);
if (!out) throw new Error('usage: node scripts/dev/modelshot.mjs outDir [what …]');
mkdirSync(out, { recursive: true });
const hour = Number(flag('hour', '13'));
const variants = Number(flag('variants', '6'));
const season = flag('season', null);
const dist = flag('dist', 'dist-test');
const sheet = flag('sheet', null);
const gpu = argv.includes('--gpu');
const backs = argv.includes('--backs');
// `--lod far|sky` draws that level of detail everywhere; `--lod all` shoots near, far and sky.
const lod = flag('lod', null);

const BATCH = {
  services: ['firestation', 'police', 'clinic', 'hospital', 'primary', 'highschool', 'library', 'university'],
  utilities: [
    'wind',
    'coal',
    'gas',
    'solar',
    'nuclear',
    'pump',
    'riverpump',
    'outflow',
    'septic',
    'treatment',
    'landfill',
    'works',
    'recycling',
    'incinerator',
  ],
  parks: ['park_small', 'plaza', 'park_large', 'busdepot', 'tramdepot', 'station'],
  special: [
    'railfreight',
    'freighthub',
    'oremine',
    'oilwell',
    'techpark',
    'hotel',
    'clocktower',
    'wheel',
    'conservatory',
    'skyneedle',
    'grandarch',
  ],
  big: ['airport', 'seaport'],
  projects: ['stadium', 'convention', 'helioarray', 'gardenexpo', 'launchsite'],
};
const zonedRows = [];
const civics = [];
for (const w of what.length ? what : ['R1']) {
  if (/^[RCI][012]$/.test(w))
    for (const wealth of [0, 1, 2]) for (const level of [1, 2, 3]) zonedRows.push(`${w}${wealth}${level}`);
  else if (/^[RCI]\d\d\d(@\dx\d)?$/.test(w)) zonedRows.push(w);
  else if (w === 'annexes')
    civics.push(
      { def: 'firestation', modules: ['engineBay'] },
      { def: 'police', modules: ['patrolWing'] },
      { def: 'clinic', modules: ['ambulanceBay', 'ward'] },
      { def: 'hospital', modules: ['ambulanceBay', 'ward'] },
      { def: 'primary', modules: ['classrooms'] },
      { def: 'highschool', modules: ['classrooms'] },
      { def: 'university', modules: ['lectureHall'] },
      { def: 'busdepot', modules: ['busBay'] },
      { def: 'landfill', modules: ['garbageTruck', 'garbageTruck', 'garbageTruck', 'garbageTruck'], fill: 1 },
      { def: 'recycling', modules: ['garbageTruck'] },
    );
  else if (w === 'landfill')
    for (const fill of [0, 0.25, 0.5, 0.75, 1]) civics.push({ def: 'landfill', fill });
  else if (w === 'stages')
    for (const def of BATCH.projects) for (const stage of [0, 1, 2, undefined]) civics.push({ def, stage });
  else if (BATCH[w]) for (const def of BATCH[w]) civics.push({ def });
  else civics.push({ def: w });
}

const PORT = 4186;
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch(
  gpu
    ? { channel: 'chrome', headless: false, args: ['--window-size=1600,1000', '--window-position=0,0'] }
    : { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
);
const files = [];
const tag = `${what.join('+') || 'R1'}${hour === 13 ? '' : `-${hour}h`}${season ? `-${season}` : ''}`.replace(
  /@/g,
  '_',
);
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() =>
    localStorage.setItem('citybloom.settings', JSON.stringify({ tips: false, graphicsChecked: true })),
  );
  // An open map: the lakes preset's plain.
  await page.goto(`http://localhost:${PORT}/?paused=1&seed=models&preset=lakes`);
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
  const at = { x: 300, z: 300 };
  const info = await page.evaluate(
    async ({ zonedRows, civics, hour, at, variants, season }) => {
      const g = window.__game;
      const st = await g.getState();
      const now = ((st.tick + 420) % 1440) / 60;
      let d = (hour - now) * 60;
      if (d < 0) d += 1440;
      if (d > 0) await g.advance(Math.round(d));
      if (season) {
        // A whole season's colours; winter with snow lying.
        const i = ['spring', 'summer', 'autumn', 'winter'].indexOf(season);
        g.setWeatherLook({
          season: [0, 1, 2, 3].map((k) => (k === i ? 1 : 0)),
          kind: 'clear',
          strength: 0,
          snow: season === 'winter' ? 0.75 : 0,
          wet: 0,
        });
      }
      if (zonedRows.length) g.showGallery(zonedRows, at, variants);
      const placed = civics.length ? g.showCivics(civics, { x: at.x, z: at.z + 600 }, 420) : [];
      await g.waitFrames(12);
      return {
        placed: placed.map((c) => ({ ...c, ...g.civicSize(c.def) })),
        buildings: g.getBuildings().filter((b) => b.id >= 9_000_000),
      };
    },
    { zonedRows, civics, hour, at, variants, season },
  );
  // No interface in the pictures.
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const shoot = async (name, pose) => {
    await page.evaluate((p) => window.__game.setCamera(p), pose);
    for (const level of lod === 'all' ? ['near', 'far', 'sky'] : [lod]) {
      await page.evaluate((l) => window.__game.setLod(l), level);
      await page.evaluate(() => window.__game.waitFrames(4));
      const f = `${out}/${tag}-${name}${level ? `-${level}` : ''}.png`;
      await page.screenshot({ path: f });
      files.push(f);
    }
  };
  if (!info.placed.length && !info.buildings.length) throw new Error('nothing to show');
  // Civic buildings one at a time: the front (they face +z here), then the back.
  for (const [i, c] of info.placed.entries()) {
    const d = Math.max(c.w, c.d) * 1.15 + 22;
    const stage = civics[i].stage !== undefined ? `-stage${civics[i].stage}` : '';
    const fill = civics[i].fill !== undefined ? `-fill${civics[i].fill}` : '';
    await shoot(`${c.def}${stage}${fill}`, { x: c.x, z: c.z, distance: d, yaw: 0.45, tilt: 0.3 });
    if (backs)
      await shoot(`${c.def}${stage}${fill}-back`, {
        x: c.x,
        z: c.z,
        distance: d,
        yaw: Math.PI - 0.5,
        tilt: 0.3,
      });
  }
  // Zoned rows: each row from the front, close enough to read the models; then all of them.
  if (info.buildings.length) {
    const rows = [...new Set(info.buildings.map((b) => b.z))].sort((a, b) => a - b);
    for (const [i, z] of rows.entries()) {
      const row = info.buildings.filter((b) => b.z === z);
      const x0 = Math.min(...row.map((b) => b.x));
      const x1 = Math.max(...row.map((b) => b.x));
      // Towers need standing further back.
      const tall = zonedRows[i][1] === '2' ? 70 : 0;
      await shoot(`row-${zonedRows[i].replace('@', '_')}`, {
        x: (x0 + x1) / 2,
        z,
        distance: (x1 - x0) * 0.55 + 40 + tall,
        yaw: 0.22,
        tilt: 0.22,
      });
    }
    const xs = info.buildings.map((p) => p.x);
    const zs = info.buildings.map((p) => p.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * 1.4, 60);
    await shoot('all', { x: cx, z: cz, distance: span * 1.05 + 60, yaw: 0.35, tilt: 0 });
    await shoot('all-back', { x: cx, z: cz, distance: span * 1.05 + 60, yaw: Math.PI + 0.4, tilt: 0 });
  }
  const s = await page.evaluate(() => window.__game.getState());
  console.log(
    `${tag}: ${info.placed.length + info.buildings.length} buildings, ${s.renderStats.calls} calls, ${(s.renderStats.triangles / 1e3).toFixed(0)}k triangles, ${files.length} pictures in ${out}`,
  );
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
if (sheet) {
  execFileSync('node', ['scripts/dev/montage.mjs', `${out}/${tag}-sheet.png`, sheet, ...files]);
  console.log(`${out}/${tag}-sheet.png`);
}
