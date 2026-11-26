// The owner area and Report a problem (M41), for looking at: starts the local relay on :8787 with an
// owner key and a game server for dist-test, sends a few reports (an error twice, a desync, a written
// report with a picture from the game), then shoots the main menu's notice, the report screen, and the
// owner area signed out, signed in and opened up, at phone and laptop sizes.
// Usage (after `npm run build:test`): node scripts/dev/ownershot.mjs <outDir>
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const out = process.argv[2] ?? 'shots/owner';
mkdirSync(out, { recursive: true });
const KEY = 'owner-shot-key';
const kids = [
  spawn('npx', ['tsx', 'relay/local.ts', '8787', '--owner-key', KEY], { stdio: 'ignore', detached: true }),
  spawn('node', ['e2e/serve.mjs', 'dist-test', '4180', '/'], { stdio: 'ignore', detached: true }),
];
// Each in a process group of its own, so npx's child goes with it.
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
await waitFor('http://127.0.0.1:8787/health');
await waitFor('http://localhost:4180/index.html');

const env = {
  build: 'abc1234',
  browser: 'Chrome 142',
  os: 'macOS',
  quality: 'high',
  save: 32,
  shared: 'no',
  where: 'city',
};
const post = (r, ip) =>
  fetch('http://127.0.0.1:8787/report', {
    method: 'POST',
    body: JSON.stringify(r),
    headers: { 'x-forwarded-for': ip },
  });
await post({
  kind: 'error',
  env,
  message: "Cannot read properties of undefined (reading 'lanes')",
  stack:
    'TypeError: Cannot read properties of undefined\n    at stepTram (/assets/index-AbC123.js:1:2345)\n    at frame (/assets/index-AbC123.js:1:9999)',
  at: 1,
});
await post({
  kind: 'error',
  env: { ...env, browser: 'Safari 18.4', os: 'iOS', build: 'def5678' },
  message: "Cannot read properties of undefined (reading 'lanes')",
  stack: 'stepTram@/assets/index-ZzZ999.js:1:2001',
  at: 2,
});
await post({
  kind: 'save',
  env: { ...env, quality: 'low' },
  message: 'An autosave failed: QuotaExceededError',
  stack: '',
  at: 3,
});
await post({
  kind: 'desync',
  env: { ...env, shared: 'room' },
  message: 'A shared city fell out of step on this machine',
  stack: '',
  at: 4,
  desync: {
    where: 'city',
    tick: 2880,
    mine: '9a1f02c3',
    theirs: '41d7e0aa',
    sums: [
      [2856, '77aa10f2'],
      [2880, '9a1f02c3'],
    ],
    theirSums: [
      [2856, '77aa10f2'],
      [2880, '41d7e0aa'],
    ],
    start: { tick: 2400, seq: 41, sum: '0c11d2e9' },
    events: [],
  },
});

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

// The game: the notice on the main menu, then Report a problem with a picture.
const game = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await game.goto('http://localhost:4180/index.html');
await game.waitForSelector('[data-testid=main-menu]', { timeout: 120_000 });
await game.waitForTimeout(3000);
await game.screenshot({ path: `${out}/menu-notice.png` });
await game.click('[data-testid=reports-notice-ok]');
await game.click('[data-testid=main-report]');
await game.fill(
  '[data-testid=report-note]',
  'The tram stopped in the middle of the junction and never moved again.',
);
await game.check('[data-testid=report-shot]');
await game.click('[data-testid=report-what]');
await game.waitForTimeout(500);
await game.screenshot({ path: `${out}/report-screen.png` });
await game.click('[data-testid=report-send]');
await game.waitForTimeout(1500);

for (const [name, viewport] of [
  ['phone', { width: 390, height: 844 }],
  ['laptop', { width: 1280, height: 800 }],
]) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: name === 'phone' ? 2 : 1 });
  await page.goto('http://localhost:4180/owner.html');
  await page.waitForSelector('[data-testid=owner-signin]');
  await page.fill('[data-testid=owner-key]', 'wrong');
  await page.click('[data-testid=owner-signin-go]');
  await page.waitForSelector('[data-testid=owner-error]');
  await page.screenshot({ path: `${out}/owner-${name}-signin.png` });
  await page.fill('[data-testid=owner-key]', KEY);
  await page.click('[data-testid=owner-signin-go]');
  await page.waitForSelector('[data-testid=owner-group]');
  await page.screenshot({ path: `${out}/owner-${name}-list.png`, fullPage: true });
  await page.locator('[data-testid=owner-group] .owner-group-head').first().click();
  const shot = page.locator('[data-testid=owner-show-shot]');
  if (await shot.count()) await shot.first().click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/owner-${name}-open.png`, fullPage: true });
  await page.close();
}
await browser.close();
stop();
console.log(`shots in ${out}`);
process.exit(0);
