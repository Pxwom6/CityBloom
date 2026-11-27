// The weekly challenge (M44), for looking at: starts the local relay on :8787 with an owner key and a
// game server for dist-test, pins a short version of this week's challenge (6 months, the shortest a pin
// may be, so it ends in seconds of fast-forward), then two players each play it from the main menu, post a score (one
// in a group the other made), and the first watches the second's run. Shoots the menu entry, the
// challenge screen, the brief, the goals panel, the end card before and after posting, the board (all,
// friends), the replay viewer, and the screen and end card on a phone both ways up.
// Usage (after `npm run build:test`): node scripts/dev/challengeshot.mjs <outDir>
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const out = process.argv[2] ?? 'shots/challenge';
mkdirSync(out, { recursive: true });
const KEY = 'challenge-shot-key-0123456789';
const RELAY = 'http://127.0.0.1:8787';
const GAME = 'http://localhost:4180/index.html';
const kids = [
  spawn('npx', ['tsx', 'relay/local.ts', '8787', '--owner-key', KEY, '--board-every', '1'], {
    stdio: 'ignore',
    detached: true,
  }),
  spawn('node', ['e2e/serve.mjs', 'dist-test', '4180', '/'], { stdio: 'ignore', detached: true }),
];
const stop = () =>
  kids.forEach((k) => {
    try {
      process.kill(-k.pid);
    } catch {
      /* gone */
    }
  });
process.on('exit', stop);

async function waitFor(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${url} never answered`);
}
await waitFor(`${RELAY}/health`);
await waitFor(GAME);

// A short version of this week's challenge, pinned by the owner.
const owner = await fetch(`${RELAY}/owner/challenge`, { headers: { authorization: `Bearer ${KEY}` } }).then(
  (r) => r.json(),
);
const pin = {
  ...owner.challenge,
  months: 6,
  brief: `${owner.challenge.brief.replace(/You have .*$/, '')}You have six months.`,
};
const pinned = await fetch(`${RELAY}/owner/challenge/pin`, {
  method: 'POST',
  headers: { authorization: `Bearer ${KEY}` },
  body: JSON.stringify({ week: owner.now, def: pin }),
});
if (!pinned.ok) throw new Error(`pin: ${await pinned.text()}`);
console.log(`week ${owner.now}: ${pin.name} (${pin.twist}) on ${pin.preset} ${pin.seed}`);

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
});
const SETTINGS = { tips: false, graphicsChecked: true, quality: 'low', shadows: false };

async function newPage(opts = { viewport: { width: 1280, height: 800 } }) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript((s) => {
    const key = 'citybloom.settings';
    const was = JSON.parse(localStorage.getItem(key) ?? '{}');
    localStorage.setItem(key, JSON.stringify({ ...was, ...s }));
  }, SETTINGS);
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && console.log(`[page] ${m.text()}`));
  return { ctx, page };
}
const ready = (page, mode) =>
  page.waitForFunction((m) => window.__game?.ready === true && window.__game.getShell().mode === m, mode, {
    timeout: 180_000,
  });
const shot = async (page, name) => {
  await page.evaluate(() => window.__game.waitFrames(2));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`shot ${name}`);
};

/** From the main menu to a finished challenge city: a few streets, homes, shops, power and water. */
async function play(page, layout) {
  await page.goto(`${GAME}?screen=challenge`);
  await ready(page, 'menu');
  await page.getByTestId('challenge-play').click();
  await ready(page, 'play');
  await page.getByTestId('scenario-brief').waitFor();
  return async (afterBrief) => {
    await page.getByTestId('scenario-begin').click();
    await page.evaluate(() => window.__game.setSpeed(0));
    const built = await page.evaluate(async (layout) => {
      const g = window.__game;
      const st = await g.getState();
      const hx = st.highwayX;
      const hz = st.highwayZ;
      const at = (dx, dz) => ({ x: hx + dx, z: hz + dz });
      const done = [];
      const tryCmd = async (cmd) => {
        const r = await g.dispatch(cmd);
        if (r.ok) done.push(cmd.type);
        return r.ok;
      };
      // A main street east (or west) from the highway's end, then cross streets.
      let dir = 0;
      for (const d of [1, -1])
        if ((await g.preview({ type: 'buildRoad', road: 'street', points: [at(0, 0), at(380 * d, 0)] })).ok) {
          dir = d;
          break;
        }
      if (!dir) return { done, dir };
      await tryCmd({ type: 'buildRoad', road: 'street', points: [at(0, 0), at(380 * dir, 0)] });
      for (const x of layout.cross)
        await tryCmd({ type: 'buildRoad', road: 'street', points: [at(x * dir, -150), at(x * dir, 150)] });
      const brush = (zone, dz, r) =>
        tryCmd({
          type: 'zone',
          zone,
          area: { kind: 'brush', points: [at(40 * dir, dz), at(360 * dir, dz)], radius: r },
        });
      await brush('R', -80, 60);
      await brush('C', 25, 18);
      await brush(layout.third, 90, 45);
      for (const def of ['coal', 'pump'])
        done.push(`${def}:${(await g.placeCivic(def, at(200 * dir, 140))) !== null}`);
      return { done, dir };
    }, layout);
    console.log('built', JSON.stringify(built));
    if (afterBrief) await afterBrief();
    // Through the months: the end card comes up as the last one closes.
    for (let m = 0; m < 9; m++) {
      if (await page.getByTestId('challenge-end').isVisible()) break;
      await page.evaluate(() => window.__game.advance(1440));
    }
    await page.getByTestId('challenge-end').waitFor({ timeout: 60_000 });
  };
}

// The menu's entry, and the challenge screen.
const a = await newPage();
await a.page.goto(GAME);
await ready(a.page, 'menu');
await a.page.getByTestId('main-challenge-line').filter({ hasText: 'left' }).waitFor();
await shot(a.page, 'menu');
await a.page.getByTestId('main-challenge').click();
await a.page.getByTestId('challenge-detail').waitFor();
await shot(a.page, 'screen');
// The first player makes a group for the friends board.
await a.page.getByTestId('board-tab-friends').click();
await a.page.getByTestId('group-make').click();
const code = (await a.page.getByTestId('group-made').locator('strong').textContent()).trim();
console.log(`group ${code}`);
await shot(a.page, 'group');

let rest = await play(a.page, { cross: [100, 200, 300], third: 'I' });
await shot(a.page, 'brief');
await rest(async () => {
  await a.page.evaluate(() => window.__game.advance(1440 / 2));
  await a.page.getByTestId('open-goals').click();
  await shot(a.page, 'goals');
  await a.page.getByTestId('open-goals').click();
});
await shot(a.page, 'end');
await a.page.getByTestId('challenge-name-input').fill('Ada');
await a.page.getByTestId('challenge-post').click();
await a.page.getByTestId('challenge-post-result').waitFor();
console.log('A posted:', await a.page.getByTestId('challenge-post-result').textContent());
await shot(a.page, 'posted');

// The second player joins the group and plays it another way.
const b = await newPage();
await b.page.goto(`${GAME}?screen=challenge`);
await ready(b.page, 'menu');
await b.page.getByTestId('board-tab-friends').click();
await b.page.getByTestId('group-code').fill(code.toLowerCase());
await b.page.getByTestId('group-join').click();
rest = await play(b.page, { cross: [120, 240, 340], third: 'C' });
await rest();
await b.page.getByTestId('challenge-name-input').fill('Kit');
await b.page.getByTestId('challenge-post').click();
await b.page.getByTestId('challenge-post-result').waitFor();
console.log('B posted:', await b.page.getByTestId('challenge-post-result').textContent());

// The board: both, each checked by replaying it.
await a.page.goto(`${GAME}?screen=challenge`);
await ready(a.page, 'menu');
await a.page.getByTestId('board-row').nth(1).waitFor();
await a.page.waitForFunction(
  () => document.querySelectorAll('.challenge-check:not(:empty)').length >= 1,
  null,
  {
    timeout: 120_000,
  },
);
await shot(a.page, 'board');
await a.page.getByTestId('board-tab-friends').click();
await a.page.getByTestId('board-row').first().waitFor();
await shot(a.page, 'friends');
// Watching the second player's run.
await a.page.getByTestId('board-tab-week').click();
const rows = await a.page.getByTestId('board-row').allTextContents();
console.log('board', rows);
const kit = a.page.getByTestId('board-row').filter({ hasText: 'Kit' });
await kit.getByRole('button', { name: 'Watch' }).click();
await ready(a.page, 'play');
await a.page.getByTestId('run-viewer').waitFor();
await a.page.evaluate(() => window.__game.waitFrames(20));
await shot(a.page, 'watch');
await a.page.getByTestId('run-rush').click();
await a.page.getByTestId('run-result').waitFor({ timeout: 180_000 });
console.log('replay:', await a.page.getByTestId('run-result').textContent());
await shot(a.page, 'watched');

// Phones, both ways up.
for (const [name, dev] of [
  ['iphone', devices['iPhone 13']],
  ['pixel', devices['Pixel 7']],
]) {
  for (const landscape of [false, true]) {
    const { defaultBrowserType: _t, ...profile } = dev;
    const vp = landscape
      ? { width: profile.viewport.height, height: profile.viewport.width }
      : profile.viewport;
    const p = await newPage({ ...profile, viewport: vp, screen: vp });
    await p.page.goto(`${GAME}?screen=challenge`);
    await ready(p.page, 'menu');
    await p.page
      .getByTestId('challenge-detail')
      .waitFor({ timeout: 60_000 })
      .catch(async () => {
        await p.page.screenshot({ path: `${out}/${name}-failed.png` });
        console.log(
          'phone screens:',
          JSON.stringify(await p.page.evaluate(() => window.__game.getShell().screens)),
        );
      });
    await p.page
      .getByTestId('board-row')
      .first()
      .waitFor({ timeout: 20_000 })
      .catch(async () =>
        console.log('no rows on the phone:', await p.page.getByTestId('challenge-board').textContent()),
      );
    await shot(p.page, `${name}-${landscape ? 'side' : 'up'}`);
    await p.ctx.close();
  }
}
// The owner area: the week's entries, the pin and the word filter.
const o = await newPage({ viewport: { width: 900, height: 1100 } });
await o.page.goto('http://localhost:4180/owner.html');
await o.page.fill('[data-testid=owner-key]', KEY);
await o.page.click('[data-testid=owner-signin-go]');
await o.page.getByTestId('owner-section-challenge').click();
await o.page.getByTestId('owner-entry').first().waitFor();
await o.page.screenshot({ path: `${out}/owner.png`, fullPage: true });
console.log('shot owner');
await browser.close();
stop();
process.exit(0);
