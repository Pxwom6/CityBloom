// What a visit downloads (M49): serves a built site at /CityBloom/ as Pages does, opens the main menu
// in a phone's emulation, and lists every file fetched with its gzipped size (as Pages sends it),
// then a second visit in the same browser (the service worker's copy) and what it still fetches.
// Usage: BASE_PATH=/CityBloom/ npx vite build --outDir dist-m49 && node scripts/dev/download.mjs dist-m49 [--city]
//   --city also opens a new city (the models file and the city's own chunks).
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';

const dir = process.argv[2] ?? 'dist-m49';
const withCity = process.argv.includes('--city');
const PORT = 4190;
const server = spawn('node', ['e2e/serve.mjs', dir, String(PORT), '/CityBloom/'], { stdio: 'ignore' });
process.on('exit', () => server.kill());
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/CityBloom/`)).ok) break;
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}

const gz = new Map();
function gzipped(path) {
  if (!gz.has(path)) {
    const file = join(dir, path || 'index.html');
    gz.set(path, existsSync(file) ? gzipSync(readFileSync(file), { level: 9 }).length : 0);
  }
  return gz.get(path);
}

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const ctx = await browser.newContext({ ...devices['iPhone 13'] });
async function visit(label) {
  const page = await ctx.newPage();
  const got = [];
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (!u.pathname.startsWith('/CityBloom/')) return;
    got.push({ path: u.pathname.slice('/CityBloom/'.length), sw: r.fromServiceWorker(), status: r.status() });
  });
  await page.goto(`http://localhost:${PORT}/CityBloom/`);
  await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), null, {
    timeout: 120_000,
  });
  await page.waitForTimeout(4000);
  if (withCity && label === 'first') {
    await page.goto(`http://localhost:${PORT}/CityBloom/?new=1&name=Phone`);
    await page.waitForFunction(() => document.getElementById('boot')?.classList.contains('hidden'), null, {
      timeout: 120_000,
    });
    await page.waitForTimeout(3000);
  }
  await page.close();
  const net = got.filter((g) => !g.sw && g.status < 400);
  const seen = new Set();
  let total = 0;
  const rows = [];
  for (const g of net) {
    if (seen.has(g.path)) continue;
    seen.add(g.path);
    const n = gzipped(g.path);
    total += n;
    rows.push([g.path || 'index.html', n]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  console.log(
    `\n${label} visit: ${rows.length} files from the network, ${(total / 1024).toFixed(0)} KB gzipped`,
  );
  for (const [p, n] of rows.slice(0, 14)) console.log(`  ${(n / 1024).toFixed(1).padStart(8)} KB  ${p}`);
  console.log(`  (${got.filter((g) => g.sw).length} answered by the service worker)`);
  return total;
}
await visit('first');
// Let the service worker finish keeping the files for offline play.
await new Promise((r) => setTimeout(r, 8000));
await visit('second');
await browser.close();
server.kill();
process.exit(0);
