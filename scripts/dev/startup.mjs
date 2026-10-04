// Dev (model batch 4): how long the game takes to open, and what the hand-made models file costs
// on the way. Serves each build gzipped as GitHub Pages does, opens it in a fresh Chrome profile
// (empty cache) on a throttled connection and times the main menu over the demo town (and a new
// city, `?new=1`), the models file's download, and whether it arrived before `loadModels`' deadline.
// Builds are measured in turn, run by run, so they share the machine's state.
// Usage: npm run build:test && node scripts/dev/startup.mjs [--dist dist-test,dist-before]
//          [--nets local,50,20,10,5,2.5] [--runs 3] [--pages menu,new] [--json out.json]
// A net is a download speed in Mbit/s (with a round trip to match); `local` is unthrottled.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};
const dists = flag('dist', 'dist-test').split(',');
const nets = flag('nets', 'local,50,20,10,5,2.5').split(',');
const runs = Number(flag('runs', '3'));
const pages = flag('pages', 'menu,new').split(',');
const jsonOut = flag('json', null);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};
/** GitHub Pages gzips text and binary files alike (the models file arrives gzipped), not images. */
const COMPRESS = (ext) => !['.png', '.jpg', '.woff2'].includes(ext);

/**
 * A static server for one build at `/`, cached ten minutes and gzipped with the system's `gzip -9`
 * (the live models file is within 1 % of its size; Node's zlib makes it 12 % bigger).
 */
function serve(dir, port) {
  const root = resolve(dir);
  const zipped = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    let rel = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = normalize(join(root, rel));
    if (!file.startsWith(root)) return res.writeHead(403).end();
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
    } catch {
      return res.writeHead(404).end();
    }
    const ext = extname(file);
    const headers = {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'cache-control': 'max-age=600',
    };
    let body = readFileSync(file);
    if (COMPRESS(ext) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
      if (!zipped.has(file))
        zipped.set(file, execFileSync('gzip', ['-9', '-c', file], { maxBuffer: 1 << 28 }));
      body = zipped.get(file);
      headers['content-encoding'] = 'gzip';
    }
    headers['content-length'] = body.length;
    res.writeHead(200, headers);
    res.end(body);
  });
  server.listen(port);
  return server;
}

const servers = dists.map((d, i) => ({ dist: d, port: 4230 + i, server: serve(d, 4230 + i) }));
/** Download speed (bytes/s) and round trip (ms) for a net. */
const netOf = (n) => {
  if (n === 'local') return null;
  const mbit = Number(n);
  return {
    down: (mbit * 1e6) / 8,
    up: (Math.min(mbit, 10) * 1e6) / 8,
    latency: mbit >= 20 ? 20 : mbit >= 10 ? 40 : 70,
  };
};

const browser = await chromium.launch({
  channel: 'chrome',
  headless: false,
  args: ['--window-size=1512,945', '--window-position=0,0'],
});

async function once(port, net, kind) {
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  await page.addInitScript(() =>
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({ tips: false, graphicsChecked: true, sound: false, music: false }),
    ),
  );
  let dropped = false;
  page.on('console', (m) => {
    if (/Hand-made models could not be loaded/.test(m.text())) dropped = true;
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  const n = netOf(net);
  if (n)
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: n.latency,
      downloadThroughput: n.down,
      uploadThroughput: n.up,
    });
  const url =
    kind === 'menu'
      ? `http://localhost:${port}/`
      : `http://localhost:${port}/?new=1&name=Probe&difficulty=normal&sandbox=0&disasters=0`;
  const mode = kind === 'menu' ? 'menu' : 'play';
  await page.goto(url, { waitUntil: 'commit' });
  await page.bringToFront();
  // When the game is up (in the page's own clock, from navigation start), then two frames drawn.
  const ready = await (
    await page.waitForFunction(
      (m) => (window.__game?.ready && window.__game.getShell().mode === m ? performance.now() : false),
      mode,
      { timeout: 180_000, polling: 25 },
    )
  ).jsonValue();
  const drawn = await page.evaluate(async () => {
    await window.__game.waitFrames(2);
    return performance.now();
  });
  const info = await page.evaluate(() => {
    const res = performance.getEntriesByType('resource');
    const pick = (re) => {
      const e = res.find((r) => re.test(r.name));
      return e
        ? { start: e.startTime, end: e.responseEnd, transfer: e.transferSize, body: e.decodedBodySize }
        : null;
    };
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      models: pick(/\/assets\/models-[0-9a-f]+\.bin/),
      demo: pick(/demo\.citybloom/),
      script: pick(/\/assets\/index-[\w-]+\.js$/),
      worker: pick(/\/assets\/worker-[\w-]+\.js$/),
      html: nav ? nav.responseEnd : 0,
      bytes: res.reduce((t, r) => t + (r.responseEnd <= performance.now() ? r.transferSize : 0), 0),
      designs: window.__game.getHandDesigns().length,
    };
  });
  await context.close();
  return { ready, drawn, dropped, ...info };
}

const f0 = (v) => (v == null ? '–' : v.toFixed(0));
const mean = (a) => a.reduce((t, v) => t + v, 0) / Math.max(1, a.length);
const results = [];
try {
  for (const kind of pages)
    for (const net of nets) {
      const byDist = new Map(servers.map((s) => [s.dist, []]));
      for (let r = 0; r < runs; r++)
        for (const s of r % 2 ? [...servers].reverse() : servers)
          byDist.get(s.dist).push(await once(s.port, net, kind));
      for (const s of servers) {
        const rs = byDist.get(s.dist);
        const row = {
          page: kind,
          net,
          dist: s.dist,
          ready: mean(rs.map((x) => x.ready)),
          drawn: mean(rs.map((x) => x.drawn)),
          modelsEnd: mean(rs.map((x) => x.models?.end ?? NaN)),
          modelsTime: mean(rs.map((x) => (x.models ? x.models.end - x.models.start : NaN))),
          modelsKB: (rs[0].models?.transfer ?? 0) / 1024,
          demoEnd: mean(rs.map((x) => x.demo?.end ?? NaN)),
          scriptEnd: mean(rs.map((x) => x.script?.end ?? NaN)),
          bytesKB: mean(rs.map((x) => x.bytes)) / 1024,
          designs: rs.map((x) => x.designs),
          dropped: rs.filter((x) => x.dropped).length,
          runs: rs,
        };
        results.push(row);
        console.log(
          `${kind.padEnd(4)} ${net.padStart(5)} ${s.dist.padEnd(12)} up ${f0(row.ready)} ms, drawn ${f0(row.drawn)} ms; models file ${f0(row.modelsKB)} KB over the wire, in ${f0(row.modelsTime)} ms (done at ${f0(row.modelsEnd)}); script done ${f0(row.scriptEnd)}, demo town ${f0(row.demoEnd)}; ${f0(row.bytesKB)} KB in all; designs loaded ${row.designs.join('/')}${row.dropped ? `; models dropped in ${row.dropped} of ${runs}` : ''}`,
        );
      }
    }
} finally {
  await browser.close();
  for (const s of servers) s.server.close();
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 1));
