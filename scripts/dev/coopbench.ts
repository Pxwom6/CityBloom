/**
 * Frame and tick times with four players (M31): the bench city shared in an online room on the
 * local relay, three headless players building and moving their cursors, and this machine's real
 * Chrome (GPU, frame cap off) as the fourth, timed at the city's three camera presets at 3×.
 *
 *   VITE_RELAY_URL=ws://localhost:8799 npx vite build --mode test --outDir dist-coop
 *   npx tsx scripts/dev/coopbench.ts bench-results/city.gz [seconds]
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'fflate';
import { startRelay } from '../../relay/local';
import { webSocketLink } from '../../src/net/link';
import { HeadlessDriver } from '../../src/net/driver';
import { RoomSession } from '../../src/net/session';
import { Sim } from '../../src/sim/sim';

const file = process.argv[2] ?? 'bench-results/city.gz';
const seconds = Number(process.argv[3] ?? 6);
const raw = readFileSync(file);
const save = JSON.parse(new TextDecoder().decode(raw[0] === 0x1f ? gunzipSync(raw) : raw));
const relay = await startRelay(8799);
const code = '2CQPBN';
const url = `ws://localhost:8799/room/${code}`;
const headless: { s: RoomSession; d: HeadlessDriver }[] = [];
for (let i = 0; i < 3; i++) {
  const d = new HeadlessDriver(i === 0 ? Sim.fromSave(save) : Sim.create({ seed: 'x' }));
  const s = new RoomSession(d, () => webSocketLink(url), {
    name: ['Ada', 'Sam', 'Kit'][i]!,
    color: i + 1,
    ...(i === 0 ? { create: { cityName: 'Bench' } } : {}),
  });
  await s.start();
  headless.push({ s, d });
}
// The headless players wander their cursors over the city with a zoning brush out.
let t = 0;
const wander = setInterval(() => {
  t += 0.2;
  headless.forEach(({ s }, i) => {
    const x = 1000 + 400 * Math.cos(t / 3 + i * 2);
    const z = 1000 + 400 * Math.sin(t / 3 + i * 2);
    s.sendPresence({ at: [x, z], tool: 'zone', ghost: { circles: [[x, z, 30]] } });
  });
}, 200);

const PORT = 4197;
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', 'dist-coop', '--port', String(PORT), '--strictPort'],
  {
    stdio: 'ignore',
    detached: true,
  },
);
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--disable-gpu-vsync', '--disable-frame-rate-limit', '--window-size=1440,900'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
await page.addInitScript(() => {
  localStorage.setItem(
    'citybloom.settings',
    JSON.stringify({ tips: false, graphicsChecked: true, quality: 'high' }),
  );
  localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Me', color: 0 }));
});
await page.goto(`http://localhost:${PORT}/?join=${code}`);
await page.waitForFunction(
  () => window.__game?.ready === true && window.__game.getNet()?.state === 'playing',
  null,
  {
    timeout: 180_000,
  },
);
headless[0]!.s.setSpeed(3);
const stats = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const avg = s.reduce((p, v) => p + v, 0) / Math.max(1, s.length);
  return { avg: avg.toFixed(2), p95: (s[Math.floor(s.length * 0.95)] ?? 0).toFixed(2) };
};
for (const view of ['overview', 'city', 'street'] as const) {
  await page.evaluate((v) => window.__game!.setCamera(v), view);
  await page.waitForTimeout(3000);
  const f = await page.evaluate((ms) => window.__game!.recordFrames(ms), seconds * 1000);
  const n = await page.evaluate(() => window.__game!.getNet());
  console.log(
    `${view}: frame ${JSON.stringify(stats(f.interval))} ms, game work ${JSON.stringify(stats(f.work))} ms, tick avg ${n!.tickMsAvg.toFixed(2)} max ${n!.tickMsMax.toFixed(1)} ms, behind ${n!.allowed - n!.tick}`,
  );
}
const tick = headless.map(({ d }) => d.tick);
console.log(
  `headless players at ticks ${tick.join(', ')}; page at ${(await page.evaluate(() => window.__game!.getNet()))!.tick}`,
);
clearInterval(wander);
await browser.close();
for (const { s, d } of headless) {
  s.leave();
  d.stop();
}
await relay.close();
process.kill(-server.pid!);
process.exit(0);
