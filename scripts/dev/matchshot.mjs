// A quick match (M43) end to end, for looking at: starts the local relay (one-minute matches allowed)
// and a game server for dist-test, then two (or more) players play a match from the address the Quick
// match screen makes: the lobby, the countdown, the scoreboard, an emote, the last minute, the results
// with the chart; optionally a rematch. Prints each page's result and hashes, and checks they agree.
// Usage (after `npm run build:test`): node scripts/dev/matchshot.mjs <outDir>
//   env MODE=race|rich|happy|mixed (rich), PLAYERS=2..4 (2), KIND=online|p2p (online), REMATCH=1,
//   PHONE=1 (the second player on a phone, upright), PORT (8787), WEB (4180)
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const out = process.argv[2] ?? 'shots/match';
mkdirSync(out, { recursive: true });
const MODE = process.env.MODE ?? 'rich';
const PLAYERS = Number(process.env.PLAYERS ?? 2);
const KIND = process.env.KIND ?? 'online';
const PORT = process.env.PORT ?? '8787';
const WEB = process.env.WEB ?? '4180';
const NAMES = ['Ada', 'Sam', 'Kit', 'Lou'];
const kids = [
  spawn('npx', ['tsx', 'relay/local.ts', PORT, '--test-matches'], { stdio: 'ignore', detached: true }),
  spawn('node', ['e2e/serve.mjs', 'dist-test', WEB, '/'], { stdio: 'ignore', detached: true }),
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
process.on('SIGINT', () => process.exit(1));

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
await waitFor(`http://127.0.0.1:${PORT}/health`);
await waitFor(`http://localhost:${WEB}/index.html`);

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const base = `http://localhost:${WEB}/index.html`;
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);

async function player(k) {
  const phone = process.env.PHONE === '1' && k === 1;
  const ctx = await browser.newContext(
    phone
      ? { ...devices['iPhone 13'], defaultBrowserType: undefined }
      : { viewport: { width: 1100, height: 720 } },
  );
  await ctx.addInitScript(
    ([n, c]) => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: n, color: c }));
      localStorage.setItem(
        'citybloom.settings',
        JSON.stringify({
          tips: false,
          graphicsChecked: true,
          quality: 'low',
          shadows: false,
          reportsNotice: true,
        }),
      );
    },
    [NAMES[k], k],
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(`${NAMES[k]} page error:`, e.message));
  page.on('console', (m) => m.type() === 'error' && log(`${NAMES[k]} console:`, m.text().slice(0, 200)));
  return page;
}

const match = (p) => p.evaluate(() => window.__game.getMatch());
const until = async (p, fn, what, ms = 180_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const m = await match(p).catch(() => null);
    if (m && fn(m)) return m;
    if (Date.now() > end)
      throw new Error(`timed out waiting for ${what}: ${JSON.stringify(m)?.slice(0, 400)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
};
const ready = (p) => p.waitForFunction(() => window.__game?.ready === true, null, { timeout: 180_000 });

/** A small town each, by the test API (through the game's own commands: refused before the start). */
async function build(p) {
  return p.evaluate(async () => {
    const g = window.__game;
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    const r = [];
    const ok = async (cmd) => r.push((await g.dispatch(cmd)).ok);
    await ok({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 400, z: c.z }] });
    for (let k = 1; k <= 2; k++) {
      const x = c.x + (400 * k) / 3;
      await ok({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x, z: c.z - 160 },
          { x, z: c.z + 160 },
        ],
      });
    }
    await ok({
      type: 'zone',
      zone: 'R',
      area: {
        kind: 'brush',
        points: [
          { x: c.x + 20, z: c.z - 100 },
          { x: c.x + 400, z: c.z - 100 },
        ],
        radius: 70,
      },
    });
    await ok({
      type: 'zone',
      zone: 'C',
      area: {
        kind: 'brush',
        points: [
          { x: c.x + 20, z: c.z + 20 },
          { x: c.x + 400, z: c.z + 20 },
        ],
        radius: 22,
      },
    });
    const near = { x: 300, z: s.highwayZ + 170 };
    for (const def of ['coal', 'pump']) r.push((await g.placeCivic(def, near)) !== null);
    return r;
  });
}

async function round(pages, n) {
  const [host, ...rest] = pages;
  if (n === 1) {
    // Everyone in the lobby, ready.
    await until(
      host,
      (m) => m.phase === 'lobby' && m.players.length === pages.length && m.players.every((p) => p.ready),
      'all ready',
    );
    log(`round ${n}: lobby`, (await match(host)).players);
    await host.screenshot({ path: `${out}/r${n}-lobby-host.png` });
    await rest[0].screenshot({ path: `${out}/r${n}-lobby-guest.png` });
    // Building before the start is refused.
    const early = await build(rest[0]);
    log(
      'built before the start (all refused?):',
      early.every((x) => !x),
    );
    await host.getByTestId('match-start').click();
  }
  // (A rematch starts by itself once every new city is ready.)
  await until(host, (m) => m.phase === 'countdown' || m.phase === 'playing', 'countdown');
  await host.waitForTimeout(1500);
  await host.screenshot({ path: `${out}/r${n}-countdown.png` });
  await until(host, (m) => m.started, 'start', 30_000);
  for (const p of pages) {
    const m = await match(p);
    log(
      'after start:',
      JSON.stringify({
        slot: m.slot,
        phase: m.phase,
        started: m.started,
        left: Math.round(m.timeLeft),
        tick: m.tick,
        open: m.resultsOpen,
        cut: m.cut,
        speed: m.speed,
      }),
    );
  }
  // (In parallel: each command redraws the town, which takes seconds on a software renderer.)
  const built = await Promise.all(pages.map((p) => build(p)));
  log('built:', built.map((b) => b.filter(Boolean).length).join(', '), 'ok');
  await rest[0].getByTestId('match-emote-btn').click();
  await rest[0].getByTestId('match-emote-1').click();
  await host.waitForTimeout(1500);
  log('emotes the host saw:', JSON.stringify((await match(host)).said));
  await host.screenshot({ path: `${out}/r${n}-playing-host.png` });
  await rest[0].screenshot({ path: `${out}/r${n}-playing-guest.png` });
  // The last seconds, then the results.
  await until(host, (m) => m.timeLeft < 8_000, 'last seconds', 120_000);
  await host.screenshot({ path: `${out}/r${n}-last.png` });
  for (const p of pages) await until(p, (m) => m.phase === 'over' && m.resultsOpen, 'results', 120_000);
  const results = await Promise.all(pages.map((p) => match(p)));
  const same = results.every((m) => JSON.stringify(m.result) === JSON.stringify(results[0].result));
  log(`round ${n}: winner slot`, results[0].result.winner, 'same result on every page:', same);
  for (const m of results) {
    const mine = m.result.rows.find((r) => r.slot === m.slot);
    log(
      `  slot ${m.slot}: my hash ${m.hash}, result says ${mine?.hash}, tick ${m.tick}`,
      mine?.hash === m.hash ? 'OK' : 'DIFFERENT',
    );
  }
  await host.screenshot({ path: `${out}/r${n}-results-host.png` });
  await rest[0].screenshot({ path: `${out}/r${n}-results-guest.png` });
  return { same, results };
}

const pages = [];
for (let k = 0; k < PLAYERS; k++) pages.push(await player(k));
const q = new URLSearchParams({
  match: 'new',
  mkind: KIND,
  mode: MODE,
  minutes: '1',
  target: '5000',
  preset: 'river',
  chat: '1',
});
await pages[0].goto(`${base}?${q}`);
await ready(pages[0]);
const hostView = await until(pages[0], (m) => m.invite && m.phase === 'lobby', 'the match to open');
log('invite', hostView.invite);
for (const p of pages.slice(1)) {
  await p.goto(`${base}?match=${hostView.invite}`);
  await ready(p);
}
const first = await round(pages, 1);
let ok = first.same;
if (process.env.REMATCH === '1') {
  await pages[0].getByTestId('match-rematch-mode').selectOption('race');
  await pages[0].getByTestId('match-rematch').click();
  // Every page reloads into its new city on the new seed.
  await pages[0].waitForTimeout(3000);
  for (const p of pages) await ready(p);
  for (const p of pages) await until(p, (m) => m.round === 2, 'round 2', 120_000);
  const second = await round(pages, 2);
  ok = ok && second.same;
}
log(ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
