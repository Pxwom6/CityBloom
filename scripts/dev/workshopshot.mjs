// The Workshop (M47), for looking at and for the guide's pictures: the Learn page's Making buildings
// lesson opens its town with the Workshop; through the UI a 2×2 landmark is picked, the prompt filled
// in (and the Blender steps shown), a first try that floats and faces backwards checked (the teacher's
// notes), the fixed model checked, seen in its street by day and night, added and placed in the town.
// Usage (after `npm run build:test`): node scripts/dev/workshopshot.mjs <outDir> [--guide]
// --guide writes the pictures the guide uses into docs/screenshots/workshop-*.png as well.
// Env: PORT (4184), QUALITY (medium).
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'shots/workshop';
const guide = process.argv.includes('--guide');
const port = Number(process.env.PORT ?? 4184);
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
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
await ctx.addInitScript((q) => {
  localStorage.setItem(
    'citybloom.settings',
    JSON.stringify({ tips: false, graphicsChecked: true, quality: q, reportsNotice: true, timelapse: false }),
  );
}, process.env.QUALITY ?? 'medium');
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log(`[page] ${m.text()}`));
await page.goto(`${game}?lesson=buildings`);
await page.waitForFunction(
  () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
  null,
  {
    timeout: 180_000,
  },
);
const panel = page.getByTestId('buildings-panel');
await page.getByTestId('workshop').waitFor();
const shot = async (name, el = panel) => {
  await page.evaluate(() => window.__game.waitFrames(3));
  const file = `${out}/${name}.png`;
  await el.screenshot({ path: file });
  if (guide) copyFileSync(file, `docs/screenshots/${name}.png`);
  console.log(`shot ${name}`);
};
// 1 Pick
await page.getByTestId('workshop-pick-landmark2').click();
await shot('workshop-1-pick');
// 2 Make
await page.getByTestId('workshop-next').click();
await page.getByTestId('workshop-name').fill('Clock pavilion');
await page
  .getByTestId('workshop-idea')
  .fill(
    'A little clock tower on a paved square: cream walls with a red band, a slate roof, a clock face over the door, lawns in the corners and low hedges',
  );
await shot('workshop-2-prompt');
await page.getByTestId('workshop-copy').click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
console.log(
  `copied ${copied.length} characters; site line: ${copied.split('\n').find((l) => l.startsWith('Site '))}`,
);
await page.getByTestId('workshop-make-blender').click();
await shot('workshop-2-blender');
await page.getByTestId('workshop-make-ai').click();
// 3 Check: a first try that floats and faces backwards, then the fixed one
await page.getByTestId('workshop-next').click();
await page.getByTestId('workshop-file').setInputFiles(`${glbs}/firstTry.glb`);
await page.getByTestId('workshop-note').first().waitFor({ timeout: 60_000 });
console.log('notes:', (await page.getByTestId('workshop-note').locator('h4').allTextContents()).join(' | '));
await shot('workshop-3-notes');
await page.getByTestId('workshop-file').setInputFiles(`${glbs}/good.glb`);
await page.getByTestId('workshop-ok').waitFor({ timeout: 60_000 });
await shot('workshop-3-ok');
// 4 See
await page.getByTestId('workshop-next').click();
await page.getByTestId('workshop-canvas').waitFor();
await page.waitForTimeout(2500);
await shot('workshop-4-see');
await page.getByTestId('workshop-night').click();
await page.waitForTimeout(1500);
await shot('workshop-4-night');
await page.getByTestId('workshop-day').click();
await page.getByTestId('workshop-season-winter').click();
await page.waitForTimeout(1500);
await shot('workshop-4-winter');
await page.getByTestId('workshop-season-summer').click();
// 5 Use: into My buildings, then placed in the town where the sim takes it
await page.getByTestId('workshop-next').click();
await page.getByTestId('workshop-add').click();
await page.getByTestId('workshop-added').waitFor({ timeout: 30_000 });
await shot('workshop-5-use');
const spot = await page.evaluate(async () => {
  const g = window.__game;
  // Among the homes: the middle of the town's zoned buildings.
  const b = g.getBuildings();
  const c = b.length
    ? { x: b.reduce((t, v) => t + v.x, 0) / b.length, z: b.reduce((t, v) => t + v.z, 0) / b.length }
    : { x: 400, z: 400 };
  const id = await g.placeCivic('landmark2', { x: c.x, z: c.z });
  if (id === null) return null;
  const p = g.getCivics().find((x) => x.id === id);
  await g.dispatch({ type: 'bulldoze', target: { kind: 'civic', id } });
  return p;
});
if (!spot) throw new Error('no spot for the landmark');
await page.evaluate(
  (p) => window.__game.setCamera({ x: p.x, z: p.z, distance: 125, yaw: 0.5, tilt: 0.6 }),
  spot,
);
await page.getByTestId('workshop-place').click();
await page.evaluate(() => window.__game.waitFrames(4));
const at = await page.evaluate((p) => window.__game.worldToScreen(p.x, p.z), spot);
await page.mouse.move(at.x, at.y, { steps: 4 });
await page.waitForTimeout(800);
await page.mouse.click(at.x, at.y);
await page.waitForFunction(
  () => window.__game.getCivics().some((c) => c.def === 'landmark2' && c.look),
  null,
  {
    timeout: 30_000,
  },
);
await page.getByTestId('tool-select').click();
await page.evaluate(() => window.__game.waitFrames(8));
await page.screenshot({ path: `${out}/workshop-6-placed.png` });
if (guide) copyFileSync(`${out}/workshop-6-placed.png`, 'docs/screenshots/workshop-6-placed.png');
console.log('placed', JSON.stringify(await page.evaluate(() => window.__game.getTutorial?.())));
await browser.close();
process.exit(0);
