// My buildings (M46), for looking at: a test build's new city grows a small town, then through the
// UI the landmarks row and My buildings, three bad models refused (their words and pictures), the
// good one added and seen on the turntable by day, night and in winter, placed as a landmark from the
// toolbar and worn by a pocket park through its inspector.
// Usage (after `npm run build:test`): node scripts/dev/buildingsshot.mjs <outDir>
// Env: PORT (4182), QUALITY (low; high with GPU=1), GPU=1 (headed Chrome on the GPU: gpuLaunch.mjs), ONLY=row,empty,bad,added,preview,placed,look,phone
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { devices } from 'playwright';
import { launchBrowser, QUALITY, SHADOWS } from './gpuLaunch.mjs';

const out = process.argv[2] ?? 'shots/buildings';
const port = Number(process.env.PORT ?? 4182);
const only = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (k) => !only || only.has(k);
mkdirSync(out, { recursive: true });
const glbs = `${out}/glbs`;
const made = spawnSync('npx', ['tsx', 'scripts/dev/testglbs.ts', glbs], { encoding: 'utf8' });
if (made.status !== 0) throw new Error(made.stderr);

const server = spawn('node', ['e2e/serve.mjs', 'dist-test', String(port), '/'], {
  stdio: 'ignore',
  detached: true,
});
process.on('exit', () => {
  try {
    process.kill(-server.pid);
  } catch {
    /* gone */
  }
});
const game = `http://localhost:${port}/index.html`;
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(game)).ok) break;
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}
const browser = await launchBrowser();

async function open(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  await ctx.addInitScript(
    ([q, sh]) => {
      localStorage.setItem(
        'citybloom.settings',
        JSON.stringify({
          tips: false,
          graphicsChecked: true,
          quality: q,
          shadows: sh,
          reportsNotice: true,
          timelapse: false,
        }),
      );
    },
    [QUALITY, SHADOWS],
  );
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log(`[page] ${m.text()}`));
  await page.goto(`${game}?seed=mb1&preset=river&paused=1`);
  await page.waitForFunction(
    () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
    null,
    { timeout: 180_000 },
  );
  return { ctx, page };
}

const { ctx, page } = await open({ viewport: { width: 1280, height: 800 } });
// A small town on an avenue east of the highway, grown a few months.
const town = await page.evaluate(async () => {
  const g = window.__game;
  g.setSpeed(0);
  const s = await g.getState();
  const c = { x: 24, z: s.highwayZ };
  const ok = async (cmd) => {
    const r = await g.dispatch(cmd);
    if (!r.ok) console.log(`${cmd.type}: ${r.reason}`);
  };
  await ok({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
  await ok({ type: 'cheat', cheat: 'unlockAll' });
  await ok({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 500, z: c.z }] });
  for (let k = 1; k <= 4; k++)
    await ok({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: c.x + k * 100, z: c.z - 200 },
        { x: c.x + k * 100, z: c.z + 200 },
      ],
    });
  for (const [zone, dz, r] of [
    ['R', -110, 80],
    ['C', 24, 20],
    ['R', 110, 60],
  ])
    await ok({
      type: 'zone',
      zone,
      area: {
        kind: 'brush',
        points: [
          { x: c.x + 20, z: c.z + dz },
          { x: c.x + 490, z: c.z + dz },
        ],
        radius: r,
      },
    });
  for (const def of ['coal', 'pump', 'treatment', 'landfill', 'firestation', 'clinic', 'primary'])
    await g.placeCivic(def, { x: c.x + 250, z: c.z + 230 });
  const park = await g.placeCivic('park_small', { x: c.x + 150, z: c.z - 60 });
  return { c, park };
});
for (let k = 0; k < 12; k++) await page.evaluate(() => window.__game.advance(240));
await page.evaluate(() => window.__game.waitFrames(5));
const { c } = town;
const frame = (dist = 300, tilt = 0.75, at = { x: c.x + 220, z: c.z - 30 }) =>
  page.evaluate(
    ([at, dist, tilt]) => window.__game.setCamera({ x: at.x, z: at.z, distance: dist, yaw: 0.5, tilt }),
    [at, dist, tilt],
  );
await frame(420, 0.8);
await page.evaluate(() => window.__game.waitFrames(4));

// The landmarks row: the game's landmarks and My buildings.
await page.getByTestId('tool-landmark').click();
await page.getByTestId('place-mybuildings').waitFor();
if (want('row')) await page.screenshot({ path: `${out}/01-row.png` });
await page.getByTestId('place-mybuildings').click();
await page.getByTestId('buildings-panel').waitFor();
if (want('empty')) await page.screenshot({ path: `${out}/02-empty.png` });

// Three bad models and a file too big, each with what's wrong.
const tryBad = async (file, name, pick) => {
  await page.getByTestId('buildings-file').setInputFiles(`${glbs}/${file}.glb`);
  await page.getByTestId('buildings-import').waitFor();
  // Measured first (a file pointing outside itself is refused right there).
  await page.waitForFunction(() => {
    const card = document.querySelector('[data-testid=buildings-import]');
    return (
      card &&
      (card.querySelector('[data-testid=buildings-problem]') ||
        card.querySelector('[data-testid=buildings-target]:not([disabled])'))
    );
  });
  if (pick) await page.getByTestId('buildings-target').selectOption(pick);
  if (await page.getByTestId('buildings-add').isVisible()) {
    await page.getByTestId('buildings-add').click();
    await page.getByTestId('buildings-problems').waitFor({ timeout: 30_000 });
  }
  const words = await page.getByTestId('buildings-problem').allTextContents();
  console.log(`${file}: ${words.join(' | ')}`);
  if (want('bad')) {
    await page
      .getByTestId('buildings-picture')
      .waitFor({ timeout: 3000 })
      .catch(() => undefined);
    await page.getByTestId('buildings-panel').screenshot({ path: `${out}/03-${name}.png` });
  }
  await page.getByTestId('buildings-cancel').click();
};
await tryBad('tooWide', 'wide', 'landmark:2');
await tryBad('outside', 'outside');
await tryBad('textured', 'textured');
await tryBad('tooBig', 'big');

// The good one: named, checked and added, on the turntable.
await page.getByTestId('buildings-file').setInputFiles(`${glbs}/good.glb`);
await page.getByTestId('buildings-target').waitFor();
await page.waitForFunction(() => !document.querySelector('[data-testid=buildings-target]')?.disabled);
await page.getByTestId('buildings-name').fill('Clock pavilion');
if (want('added')) await page.getByTestId('buildings-panel').screenshot({ path: `${out}/04-import.png` });
await page.getByTestId('buildings-add').click();
await page.getByTestId('buildings-list').waitFor({ timeout: 30_000 });
const mine = await page.evaluate(() => window.__game.getMyBuildings());
const hash = mine.models[0].hash;
console.log('added', JSON.stringify(mine.models));
await page.waitForTimeout(1500);
if (want('added')) await page.screenshot({ path: `${out}/05-added.png` });
if (want('preview')) {
  for (const [name, steps] of [
    ['day', ['buildings-day', 'buildings-season-summer']],
    ['night', ['buildings-night']],
    ['winter', ['buildings-day', 'buildings-season-winter']],
    ['autumn-night', ['buildings-night', 'buildings-season-autumn']],
  ]) {
    for (const s of steps) await page.getByTestId(s).click();
    await page.waitForTimeout(1200);
    await page.getByTestId('buildings-preview').screenshot({ path: `${out}/06-preview-${name}.png` });
  }
  await page.getByTestId('buildings-day').click();
  await page.getByTestId('buildings-season-summer').click();
}

// Placed as a landmark from the landmarks row, at the first spot by the avenue the sim accepts.
await page.getByTestId('buildings-panel').getByRole('button', { name: 'Close' }).click();
await page
  .getByTestId('tool-landmark')
  .click()
  .catch(() => undefined);
if (!(await page.getByTestId(`place-own-${hash}`).isVisible()))
  await page.getByTestId('tool-landmark').click();
await page.getByTestId(`place-own-${hash}`).click();
let placed = false;
for (const dx of [60, 140, 240, 330, 420])
  for (const dz of [-30, 34]) {
    if (placed) break;
    const p = await page.evaluate(([x, z]) => window.__game.worldToScreen(x, z), [c.x + dx, c.z + dz]);
    await page.mouse.move(p.x, p.y, { steps: 3 });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__game.waitFrames(2));
    const hint = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="tool-hint"]');
      return { tone: el?.className ?? '', text: el?.textContent ?? '' };
    });
    if (!/\bok\b/.test(hint.tone) || hint.text.includes('replaces')) continue;
    console.log(`hint: ${hint.text}`);
    await page.mouse.click(p.x, p.y);
    placed = true;
  }
await page.waitForTimeout(800);
const own = await page.evaluate(() => window.__game.getCivics().filter((c) => c.def.startsWith('landmark')));
console.log('landmarks', JSON.stringify(own));
await page.getByTestId('tool-select').click();
if (want('placed') && own[0]) {
  await frame(140, 0.6, { x: own[0].x, z: own[0].z });
  await page.evaluate(() => window.__game.waitFrames(6));
  await page.screenshot({ path: `${out}/07-placed.png` });
  await page.evaluate(() => window.__game.setTime?.(22));
}

// Worn by the pocket park, chosen in its inspector.
if (town.park) {
  const park = (await page.evaluate(() => window.__game.getCivics())).find((x) => x.id === town.park);
  await frame(120, 0.6, { x: park.x, z: park.z });
  await page.evaluate(() => window.__game.waitFrames(4));
  if (want('look')) await page.screenshot({ path: `${out}/08-park-before.png` });
  // Picked on the map, as a player would.
  const at = await page.evaluate(([x, z]) => window.__game.worldToScreen(x, z), [park.x, park.z]);
  await page.mouse.click(at.x, at.y);
  await page.getByTestId('inspector-look').waitFor();
  await page.getByTestId('inspector-look').selectOption(hash);
  await page.waitForFunction((id) => window.__game.getCivics().find((x) => x.id === id)?.look, town.park);
  await page.evaluate(() => window.__game.waitFrames(6));
  if (want('look')) await page.screenshot({ path: `${out}/09-park-after.png` });
  console.log('drawn', JSON.stringify(await page.evaluate(() => window.__game.getMyBuildings())));
}
await ctx.close();

// A phone, upright: the panel as a sheet with the model on the turntable.
if (want('phone')) {
  const { ctx: pctx, page: pp } = await open({ ...devices['iPhone 13'], defaultBrowserType: undefined });
  await pp.evaluate(async () => {
    const g = window.__game;
    g.setSpeed(0);
    await g.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  });
  await pp.getByTestId('tool-build').tap();
  await pp.getByTestId('tool-landmark').tap();
  await pp.getByTestId('place-mybuildings').tap();
  await pp.getByTestId('buildings-file').setInputFiles(`${glbs}/good.glb`);
  await pp.getByTestId('buildings-target').waitFor();
  await pp.waitForFunction(() => !document.querySelector('[data-testid=buildings-target]')?.disabled);
  await pp.getByTestId('buildings-add').tap();
  await pp.getByTestId('buildings-list').waitFor({ timeout: 30_000 });
  await pp.waitForTimeout(1500);
  await pp.screenshot({ path: `${out}/10-phone.png` });
  await pctx.close();
}
await browser.close();
process.exit(0);
