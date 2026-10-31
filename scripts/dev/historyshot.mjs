// Dev (M39 step 7): the City history panel's "Region at war" list, and a replay watched from it, in a real
// page. The region is `historyfixture.ts`: three cities' pages in this process against a real region
// room (a live battle with orders from both sides, a war declared and ended by treaty, older events
// written in by hand), which the local relay serves; a fourth city, in the browser, joins it by its code
// and opens the panel. Shots: the panel's two views, the list filtered by kind and by city, the phone
// width, a Watch button pressed (the viewer playing the battle in Samford's town, then its "replay
// checked" note), and the way back to the city. Prints what the page knows at each point.
// Usage: npm run build:test && npx tsx scripts/dev/historyshot.mjs outDir
// Env: PORT=4396 (the preview), RELAY=8787 (where test builds look for the relay), QUALITY=low,
//      ONLY=panel,filter,phone,viewer (the shots to take; viewer includes the bar at 360 px), PW_CHROMIUM=path to a Chromium to use,
//      DIST=dist-test and BASE=/ (a build made with another --outDir/--base, e.g. DIST=dist-rev BASE=/CityBloom/).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { startRelay } from '../../relay/local.ts';
import { historyFixture } from './historyfixture.ts';

const out = process.argv[2] ?? 'history-shots';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4396);
const relayPort = Number(process.env.RELAY ?? 8787);
const quality = process.env.QUALITY ?? 'low';
const dist = process.env.DIST ?? 'dist-test';
const base = process.env.BASE ?? '/';
const only = new Set((process.env.ONLY ?? 'panel,filter,phone,viewer').split(','));
const CODE = '7HSTRY';
const t0 = Date.now();
const log = (...a) => console.log(`[historyshot ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const relay = await startRelay(relayPort);
const fixture = await historyFixture(CODE, log);
relay.regions.set(CODE, fixture.room);
log('fixture ready; replay', JSON.stringify(fixture.replay));
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', dist, '--base', base, '--port', String(port), '--strictPort'],
  { stdio: 'ignore', detached: true },
);
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});
let code = 0;
const errors = [];

async function player(name, color, query) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(
    ([n, c, q]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      localStorage.setItem('citybloom.fairClock', 'off');
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}');
      localStorage.setItem(key, JSON.stringify({ ...s, graphicsChecked: true, tips: false, quality: q }));
    },
    [name, color, quality],
  );
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`${name}: ${e}`));
  await page.goto(`http://localhost:${port}${base}?paused=1${query}`);
  await ready(page);
  return page;
}

async function ready(page) {
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 180000 });
  await page.evaluate(() => window.__game.waitFrames(2));
}

const shot = async (page, name) => {
  await page.evaluate(() => window.__game.waitFrames(2));
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
  log('shot', name);
};
/** Only the history panel (the 3D town behind is not what is being looked at). */
const panelShot = async (page, name) => {
  await page.evaluate(() => window.__game.waitFrames(2));
  const box = await page.getByTestId('history-panel').boundingBox();
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000, ...(box ? { clip: box } : {}) });
  log('shot', name);
};
const known = (page) => page.evaluate(() => window.__game.getRegionHistory());
const rowIds = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="rh-row-"]')].map((e) => e.getAttribute('data-testid')),
  );

let fay;
try {
  fay = await player('Fay', 3, '&seed=regionfay&preset=river&name=Faytown');
  // Fay joins the region by its code.
  await fay.keyboard.press('Shift+N');
  await fay.getByTestId('region-code').fill(CODE);
  await fay.getByTestId('region-join').click();
  await fay.waitForFunction(() => window.__game.getRegion()?.state === 'in', null, { timeout: 120000 });
  await fay.waitForFunction(() => window.__game.getRegion()?.rules.war === true, null, { timeout: 60000 });
  await fay.keyboard.press('Shift+N');
  await fay.waitForFunction(() => window.__game.getRegionHistory().rows.length >= 15, null, {
    timeout: 240000,
  });
  const h0 = await known(fay);
  log('Fay knows', h0.state, h0.rows.length, 'events;', h0.kept.length, 'replay(s)');
  const battle = h0.rows.find((r) => r.replay);
  if (!battle) throw new Error('no event with a replay');

  // 1. The panel: the city's own charts first, with the two views to choose between; then the region.
  await fay.evaluate(() => window.__game.openPanel('history'));
  await fay.getByTestId('history-panel').waitFor();
  if (only.has('panel')) await panelShot(fay, 'history-1-city-tab');
  await fay.getByTestId('history-view-region').click();
  await fay.getByTestId('region-history').waitFor();
  if (only.has('panel')) {
    await panelShot(fay, 'history-2-region-list');
    await shot(fay, 'history-2-region-list-page');
  }
  log('rows shown', JSON.stringify(await rowIds(fay)));

  // 2. Narrowed by kind (battles), then by kind and city, then by a kind with nothing in it for the city.
  if (only.has('filter')) {
    await fay.getByTestId('rh-kind-battles').click();
    await panelShot(fay, 'history-3-battles');
    const cities = await fay.evaluate(() =>
      [...document.querySelectorAll('[data-testid="rh-city"] option')].map((o) => [o.value, o.textContent]),
    );
    log('cities to choose', JSON.stringify(cities));
    const eve = cities.find(([, n]) => n.startsWith('Evetown'));
    await fay.getByTestId('rh-city').selectOption(eve[0]);
    await panelShot(fay, 'history-4-battles-of-evetown');
    await fay.getByTestId('rh-kind-battles').click();
    await fay.getByTestId('rh-kind-conquests').click();
    await panelShot(fay, 'history-5-conquests-of-evetown');
    // The former city is in the list too.
    const former = cities.find(([, n]) => n.startsWith('A former city'));
    if (former) {
      await fay.getByTestId('rh-kind-conquests').click();
      await fay.getByTestId('rh-city').selectOption(former[0]);
      await panelShot(fay, 'history-6-former-city');
    }
    await fay.getByTestId('rh-city').selectOption('');
  }

  // 3. A phone's width.
  if (only.has('phone')) {
    await fay.setViewportSize({ width: 390, height: 800 });
    await fay.evaluate(() => window.__game.waitFrames(3));
    await shot(fay, 'history-7-phone');
    await fay.setViewportSize({ width: 1280, height: 800 });
    await fay.evaluate(() => window.__game.waitFrames(3));
  }

  // 4. Watch: the record and the town are fetched, the viewer plays the battle, and checks it.
  if (only.has('viewer')) {
    await panelShot(fay, 'history-8-before-watch');
    await fay.getByTestId(`rh-watch-${battle.id}`).click();
    await fay.getByTestId('viewer-bar').waitFor({ timeout: 480000 });
    await ready(fay);
    log('in the viewer; check', JSON.stringify((await known(fay)).check));
    await shot(fay, 'viewer-1-start');
    // The battle in the town while it is fought (the viewer follows it a moment after it starts), then faster.
    await new Promise((r) => setTimeout(r, 4000));
    await shot(fay, 'viewer-2-battle');
    await fay.evaluate(() => window.__game.setSpeed(3));
    await fay.waitForFunction(() => window.__game.getRegionHistory().check !== null, null, {
      timeout: 240000,
    });
    const done = await known(fay);
    log('replay check', JSON.stringify(done.check), 'record ended at', battle.replay);
    await shot(fay, 'viewer-3-checked');
    const note = await fay.getByTestId('viewer-check').textContent();
    log('note:', note);
    // The bar on a phone: the window's width (less its gutters), not the half to the right of the middle.
    await fay.setViewportSize({ width: 360, height: 740 });
    await fay.evaluate(() => window.__game.waitFrames(3));
    log('viewer bar at 360 px', JSON.stringify(await fay.getByTestId('viewer-bar').boundingBox()));
    await shot(fay, 'viewer-4-phone');
    await fay.setViewportSize({ width: 1280, height: 800 });
    await fay.evaluate(() => window.__game.waitFrames(3));
    await fay.getByTestId('viewer-back').click();
    await ready(fay);
    await fay.waitForFunction(() => window.__game.getRegion()?.state === 'in', null, { timeout: 180000 });
    await fay.waitForFunction(() => window.__game.getRegionHistory().rows.length > 0, null, {
      timeout: 60000,
    });
    const back = await known(fay);
    log('back in the city:', back.state, back.rows.length, 'events;', back.kept.length, 'replay(s)');
    await fay.evaluate(() => window.__game.openPanel('history'));
    await fay.getByTestId('history-view-region').click();
    await panelShot(fay, 'history-9-back-in-the-city');
  }
  log('page errors', errors.length ? errors.slice(0, 10) : 'none');
} catch (e) {
  console.error(e);
  console.error('page errors', errors.slice(0, 10));
  await fay?.screenshot({ path: `${out}/failed.png`, timeout: 60000 }).catch(() => undefined);
  code = 1;
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {
    /* gone */
  }
  await relay.close();
}
process.exit(code);
