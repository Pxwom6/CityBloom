// Dev (M39 step 5b): the war room's Diplomacy tab with a friend, in two real pages on a local relay
// (run in-process, so the script can set a war's score the way a lost war would): the friends list, the
// declaration form, a war declared (each side's view), the war open, the other side capitulated with the
// winner setting the terms, the vassal both ways (and the fallen card), then a proposal and a signed
// treaty. Prints what each page knows (the test API's getFriendsWar) at each moment.
// Usage: npm run build:test && npx tsx scripts/dev/friendswarshot.mjs outDir
// Env: PORT=4394 (the preview), RELAY=8787 (the relay, where test builds look for it), QUALITY=low
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { startRelay } from '../../relay/local.ts';

const out = process.argv[2] ?? 'friendswar-shots';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4394);
const relayPort = Number(process.env.RELAY ?? 8787);
const quality = process.env.QUALITY ?? 'low';
const t0 = Date.now();
const log = (...a) => console.log(`[friendswarshot ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

const relay = await startRelay(relayPort);
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', 'dist-test', '--port', String(port), '--strictPort'],
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
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 760 } });
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
  await page.goto(`http://localhost:${port}/?paused=1${query}`);
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 120000 });
  await page.evaluate(() => window.__game.waitFrames(2));
  return page;
}

const friends = (page) => page.evaluate(() => window.__game.getFriendsWar());
const dip = (page) => page.evaluate(() => window.__game.getDiplomacy());
const shot = async (page, name) => {
  await page.evaluate(() => window.__game.waitFrames(2));
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000 });
  log('shot', name);
};
/** Only the war room (the 3D town behind is not what is being looked at). */
const panelShot = async (page, name) => {
  await page.evaluate(() => window.__game.waitFrames(2));
  // (Not the element's own screenshot: it waits for the panel to hold still, and a page drawn in
  // software never quite does.)
  const box = await page.getByTestId('war-room').boundingBox();
  await page.screenshot({ path: `${out}/${name}.png`, timeout: 180000, ...(box ? { clip: box } : {}) });
  log('shot', name);
};
const room = () => [...relay.regions.values()][0];
const poke = (fn) => {
  const meta = room().meta;
  for (const w of meta.friends?.wars ?? []) fn(w);
};

try {
  const ada = await player('Ada', 0, '&seed=regionada&preset=river&name=Adaville');
  const sam = await player('Sam', 1, '&seed=regionsam&preset=lakes&name=Samford');
  await ada.evaluate(() => window.__game.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 }));
  await sam.evaluate(() => window.__game.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 }));
  // A region at war, total war allowed: Ada starts it, Sam joins with the code.
  await ada.keyboard.press('Shift+N');
  await ada.getByTestId('region-start').click();
  await ada.waitForFunction(() => window.__game.getRegion()?.state === 'in', null, { timeout: 120000 });
  await ada.getByTestId('region-war-on').check();
  await ada.waitForFunction(() => window.__game.getRegion()?.rules.war === true, null, { timeout: 20000 });
  await ada.getByTestId('region-war-scale-total').click();
  await ada.waitForFunction(() => window.__game.getRegion()?.rules.scale === 'total', null, {
    timeout: 20000,
  });
  const joinCode = (await ada.evaluate(() => window.__game.getRegion())).code;
  await sam.keyboard.press('Shift+N');
  await sam.getByTestId('region-code').fill(joinCode);
  await sam.getByTestId('region-join').click();
  await sam.waitForFunction(() => window.__game.getRegion()?.state === 'in', null, { timeout: 120000 });
  await sam.waitForFunction(() => window.__game.getRegion()?.rules.war === true, null, { timeout: 60000 });
  await ada.keyboard.press('Shift+N');
  await sam.keyboard.press('Shift+N');
  // Both cities know each other (the region's reports), and war is on in both sims.
  await ada.waitForFunction(() => (window.__game.getDiplomacy()?.friends.length ?? 0) === 1, null, {
    timeout: 120000,
  });
  await sam.waitForFunction(() => (window.__game.getDiplomacy()?.friends.length ?? 0) === 1, null, {
    timeout: 120000,
  });
  // Neither is a newcomer under the shield (the dev shortcut every war spec uses).
  for (const p of [ada, sam])
    await p.evaluate(() => window.__game.dispatch({ type: 'cheat', cheat: 'unshield' }));
  await ada.evaluate(() => window.__game.regionReportNow());
  await sam.evaluate(() => window.__game.regionReportNow());
  const open = async (page) => {
    await page.evaluate(() => window.__game.openPanel('war'));
    await page.getByTestId('war-tab-diplomacy').click();
    await page.waitForSelector('[data-testid="dip-friends"]');
  };
  await open(ada);
  await open(sam);
  const samSlot = (await dip(ada)).friends[0].slot;

  // 1. The friends list before anything.
  await panelShot(ada, 'friends-1-list');

  // 2. Ada fills in the declaration of a total war.
  await ada.getByTestId(`dip-fdeclare-${samSlot}`).click();
  await ada.getByTestId('dip-fscale').selectOption('total');
  await ada.getByTestId('dip-freason').fill('Your border is ours by right');
  await panelShot(ada, 'friends-2-declare-form');
  await ada.getByTestId('dip-fdeclare-go').click();
  await sam.waitForFunction(() => window.__game.getDiplomacy()?.wars.some((w) => w.friend), null, {
    timeout: 20000,
  });
  await ada.waitForFunction(() => window.__game.getDiplomacy()?.wars.some((w) => w.friend), null, {
    timeout: 20000,
  });
  await panelShot(ada, 'friends-3-declared-ada');
  await panelShot(sam, 'friends-3-declared-sam');
  log('ada knows', JSON.stringify((await friends(ada)).wars.map((w) => [w.id, w.state, w.scale])));

  // 3. The warning (two minutes of the region's time) runs out; the next report opens the war.
  log('waiting out the warning');
  await new Promise((r) => setTimeout(r, 125_000));
  await ada.evaluate(() => window.__game.regionReportNow());
  await sam.evaluate(() => window.__game.regionReportNow());
  await ada.waitForFunction(
    () => window.__game.getDiplomacy()?.wars.some((w) => w.friend?.state === 'open'),
    null,
    { timeout: 60000 },
  );
  await sam.waitForFunction(
    () => window.__game.getDiplomacy()?.wars.some((w) => w.friend?.state === 'open'),
    null,
    { timeout: 60000 },
  );
  await panelShot(ada, 'friends-4-open-ada');
  await panelShot(sam, 'friends-4-open-sam');

  // 4. Samford's war is lost (the battles that get there are the live-battle specs'): the room
  // capitulates it at the next report, and Ada may set the terms.
  poke((w) => (w.score = 70));
  await ada.evaluate(() => window.__game.regionReportNow());
  await sam.evaluate(() => window.__game.regionReportNow());
  await ada.waitForFunction(
    () => window.__game.getDiplomacy()?.wars.some((w) => w.friend?.state === 'capitulated'),
    null,
    { timeout: 60000 },
  );
  await sam.waitForFunction(
    () => window.__game.getDiplomacy()?.wars.some((w) => w.friend?.state === 'capitulated'),
    null,
    { timeout: 60000 },
  );
  await panelShot(ada, 'friends-5-capitulated-ada');
  await panelShot(sam, 'friends-5-capitulated-sam');
  await ada.getByTestId(`dip-fimpose-${samSlot}`).click();
  await ada.getByTestId('dip-fterm-add').click(); // reparations
  await ada.getByTestId('dip-fterm-kind').selectOption('vassal');
  await ada.getByTestId('dip-fterm-add').click();
  await panelShot(ada, 'friends-6-impose-builder');
  await ada.getByTestId('dip-fsend').click();

  // 5. Vassalage, both ways: Samford is Adaville's vassal and pays; the fallen card on Sam's page.
  await sam.waitForFunction(() => !!window.__game.getDiplomacy()?.vassal?.friend, null, { timeout: 30000 });
  await ada.waitForFunction(() => (window.__game.getDiplomacy()?.subjects.length ?? 0) === 1, null, {
    timeout: 30000,
  });
  await sam.waitForSelector('[data-testid="fallen-card"]', { timeout: 20000 });
  await shot(sam, 'friends-7-fallen-card');
  await sam.getByTestId('fallen-play-on').click();
  await panelShot(sam, 'friends-7-vassal-sam');
  await panelShot(ada, 'friends-7-vassal-ada');

  // 6. A proposal between friends at peace: Ada offers a non-aggression pact and trade; Sam answers.
  await ada.getByTestId(`dip-fpropose-${samSlot}`).click();
  await ada.getByTestId('dip-fterm-kind').selectOption('nonAggression');
  await ada.getByTestId('dip-fterm-add').click();
  await ada.getByTestId('dip-fterm-kind').selectOption('trade');
  await ada.getByTestId('dip-fterm-add').click();
  await panelShot(ada, 'friends-8-propose-builder');
  await ada.getByTestId('dip-fsend').click();
  await sam.waitForFunction(() => window.__game.getFriendsWar().incoming.length === 1, null, {
    timeout: 30000,
  });
  await panelShot(sam, 'friends-8-proposal-sam');
  await panelShot(ada, 'friends-8-waiting-ada');
  const id = (await friends(sam)).incoming[0].id;
  await sam.getByTestId(`dip-faccept-${id}`).click();
  await sam.waitForFunction(
    () => window.__game.getDiplomacy()?.pacts.some((p) => p.room !== null && p.term.k === 'nonAggression'),
    null,
    { timeout: 30000 },
  );
  await ada.waitForFunction(
    () => window.__game.getDiplomacy()?.pacts.some((p) => p.room !== null && p.term.k === 'nonAggression'),
    null,
    { timeout: 30000 },
  );
  await panelShot(ada, 'friends-9-signed-ada');
  await panelShot(sam, 'friends-9-signed-sam');
  log('ada', JSON.stringify(await dip(ada), null, 0).slice(0, 400));
  log('page errors', errors.length ? errors.slice(0, 10) : 'none');
} catch (e) {
  console.error(e);
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
