// Real frame times (phase 3): import a saved city through the load screen in a headed Chrome window
// with the frame cap off (vsync and the frame-rate limit disabled, so it draws as fast as it can),
// then time every frame in each view at each quality level. Needs a real GPU (the owner's Mac).
// Usage: npm run build:test && node scripts/dev/framebench.mjs city.gz [--out file.json]
//          [--quality high,medium,low] [--views overview,city,street,overview@night,…,heavy]
//          [--seconds 6] [--warm 3] [--settle 8] [--shots dir] [--label name] [--profile]
//          [--dist dist-test]
// `--profile` also samples the main thread during each view and prints the costliest functions.
// Views: overview, city and street (camera presets) by day (13:00) and @night (22:00), all at 3×
// speed; `heavy` is the whole city at night at 3× with a tornado on screen (SPEC-3's frame budget).
// Prints average and 95th-percentile frame intervals, the game's own work per frame, draw calls
// and triangles, and writes them all to JSON.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, d) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : d;
};
const file = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
if (!file) throw new Error('usage: node scripts/dev/framebench.mjs city.gz [--out file.json] [--quality …]');
const label = flag('label', 'run');
const out = flag('out', `bench-results/frames-${label}.json`);
const qualities = flag('quality', 'high,medium,low').split(',');
const views = flag('views', 'overview,city,street,overview@night,city@night,street@night,heavy').split(',');
const seconds = Number(flag('seconds', '6'));
const warm = Number(flag('warm', '3'));
const settle = Number(flag('settle', '8'));
const shots = flag('shots', null);
const profile = argv.includes('--profile');
const dist = flag('dist', 'dist-test');
if (shots) mkdirSync(shots, { recursive: true });
mkdirSync(dirname(out), { recursive: true });

// As GRAPHICS_PRESETS in src/client/graphicsCheck.ts.
const PRESETS = {
  low: { quality: 'low', shadows: false, drawDistance: 'near' },
  medium: { quality: 'medium', shadows: true, drawDistance: 'medium' },
  high: { quality: 'high', shadows: true, drawDistance: 'medium' },
};
const PORT = 4196;
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));

const stats = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const avg = s.reduce((t, v) => t + v, 0) / Math.max(1, s.length);
  return { n: s.length, avg, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s[s.length - 1] ?? 0 };
};
const f1 = (v) => v.toFixed(1);

/** The costliest functions in a CPU profile: self and total time (ms), and where they are. */
function summariseProfile(prof, top) {
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const self = new Map();
  const total = new Map();
  const key = (n) => {
    const f = n.callFrame;
    const file = (f.url || '')
      .split('/')
      .pop()
      .replace(/-[\w-]{8}\.js$/, '.js');
    return `${f.functionName || '(anon)'} ${file}:${f.lineNumber + 1}`;
  };
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = (prof.timeDeltas[i + 1] ?? 0) / 1000;
    let n = byId.get(prof.samples[i]);
    if (!n) continue;
    self.set(key(n), (self.get(key(n)) ?? 0) + dt);
    const seen = new Set();
    for (let id = n.id; id !== undefined; id = parent.get(id)) {
      const k = key(byId.get(id));
      if (seen.has(k)) continue;
      seen.add(k);
      total.set(k, (total.get(k) ?? 0) + dt);
    }
  }
  const span = (prof.endTime - prof.startTime) / 1000;
  const rows = [`    profile over ${span.toFixed(0)} ms — top self time:`];
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, top))
    rows.push(
      `      ${v.toFixed(1).padStart(7)} self ${(total.get(k) ?? 0).toFixed(1).padStart(7)} total  ${k}`,
    );
  rows.push('    top total time:');
  for (const [k, v] of [...total].sort((a, b) => b[1] - a[1]).slice(0, top))
    rows.push(
      `      ${v.toFixed(1).padStart(7)} total ${(self.get(k) ?? 0).toFixed(1).padStart(7)} self  ${k}`,
    );
  return rows;
}
const f2 = (v) => v.toFixed(2);

const results = { label, file, date: new Date().toISOString(), seconds, runs: [] };
try {
  for (const quality of qualities) {
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
      args: [
        '--disable-gpu-vsync',
        '--disable-frame-rate-limit',
        '--window-size=1512,945',
        '--window-position=0,0',
      ],
    });
    try {
      const page = await browser.newPage({ viewport: null });
      page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
      // The whole preset, as the settings screen and the first-launch check apply it.
      await page.addInitScript(
        (p) =>
          localStorage.setItem(
            'citybloom.settings',
            JSON.stringify({ tips: false, graphicsChecked: true, sound: false, music: false, ...p }),
          ),
        PRESETS[quality],
      );
      await page.goto(`http://localhost:${PORT}/`);
      await page.bringToFront();
      await page.getByTestId('main-load').click({ timeout: 120_000 });
      await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
      await page.waitForFunction(
        () => window.__game?.ready && window.__game.getShell().mode === 'play',
        null,
        {
          timeout: 180_000,
        },
      );
      const info = await page.evaluate(async () => {
        const g = window.__game;
        const b = g.getBuildings();
        const cx = b.reduce((t, v) => t + v.x, 0) / b.length;
        const cz = b.reduce((t, v) => t + v.z, 0) / b.length;
        const s = await g.getState();
        return {
          cx,
          cz,
          population: s.population,
          buildings: b.length,
          dpr: window.devicePixelRatio,
          w: innerWidth,
          h: innerHeight,
          applied: g.getShell().applied,
        };
      });
      console.log(
        `${quality}: ${info.population} residents, ${info.buildings} buildings, window ${info.w}×${info.h} @${info.dpr}x, applied ${JSON.stringify(info.applied)}`,
      );
      // Let the loaded city settle (chunk, tree and label rebuilds) before timing anything.
      await page.evaluate(() => window.__game.waitFrames(30));
      await page.waitForTimeout(settle * 1000);
      const run = { quality, info, views: [] };
      results.runs.push(run);
      for (const view of views) {
        const [name, when] = view.split('@');
        const heavy = name === 'heavy';
        const preset = heavy ? 'overview' : name;
        const hour = heavy || when === 'night' ? 22 : 13;
        await page.evaluate(
          async ({ preset, hour, heavy, cx, cz, warmMs }) => {
            const g = window.__game;
            g.setSpeed(0);
            const s = await g.getState();
            const now = (s.tick + 7 * 60) % 1440;
            await g.advance((hour * 60 - now + 1440) % 1440 || 1);
            g.setCamera(preset);
            // A tornado lives about 2 s at 3×: whenever none is left, send another across the
            // city, so there is always one (and only one) on screen.
            let k = 0;
            const tornado = () =>
              g.getDisasters().active.some((d) => d.kind === 'tornado')
                ? null
                : g.dispatch({
                    type: 'disaster',
                    kind: 'tornado',
                    at: { x: cx + (k % 2 ? -300 : 300), z: cz + ((k++ % 3) - 1) * 250 },
                    size: 28,
                    heading: k % 2 ? 0 : Math.PI,
                  });
            const funnels = [];
            window.__bench = {
              funnels,
              timers: heavy
                ? [
                    setInterval(tornado, 250),
                    setInterval(
                      () => g.getState().then((s) => funnels.push(s.renderStats.disasters.funnels)),
                      500,
                    ),
                  ]
                : [],
            };
            if (heavy) await tornado();
            await g.waitFrames(20);
            g.setSpeed(3);
            await new Promise((res) => setTimeout(res, warmMs));
            funnels.length = 0;
          },
          { preset, hour, heavy, cx: info.cx, cz: info.cz, warmMs: warm * 1000 },
        );
        let cdp = null;
        if (profile) {
          cdp = await page.context().newCDPSession(page);
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
          await cdp.send('Profiler.start');
        }
        const r = await page.evaluate(async (ms) => {
          const g = window.__game;
          const f = await g.recordFrames(ms);
          const { funnels, timers } = window.__bench;
          timers.forEach(clearInterval);
          g.setSpeed(0);
          const st = await g.getState();
          return {
            f,
            calls: st.renderStats.calls,
            triangles: st.renderStats.triangles,
            funnels: funnels.length ? Math.min(...funnels) : st.renderStats.disasters.funnels,
            night: st.renderStats.night,
          };
        }, seconds * 1000);
        if (cdp) {
          const { profile: prof } = await cdp.send('Profiler.stop');
          await cdp.detach();
          const name = `${out.replace(/\.json$/, '')}-${quality}-${view.replace('@', '-')}.cpuprofile`;
          writeFileSync(name, JSON.stringify(prof));
          console.log(summariseProfile(prof, 18).join('\n'));
        }
        if (shots) await page.screenshot({ path: `${shots}/${quality}-${view.replace('@', '-')}.png` });
        const iv = stats(r.f.interval);
        const wk = stats(r.f.work);
        run.views.push({
          view,
          interval: iv,
          work: wk,
          fps: 1000 / iv.avg,
          calls: r.calls,
          triangles: r.triangles,
          funnels: r.funnels,
          night: r.night,
        });
        console.log(
          `  ${view.padEnd(15)} frame avg ${f2(iv.avg)} ms p95 ${f2(iv.p95)} p99 ${f2(iv.p99)} max ${f1(iv.max)} (${f1(1000 / iv.avg)} fps, ${iv.n} frames) | work avg ${f2(wk.avg)} p95 ${f2(wk.p95)} | ${r.calls} calls ${(r.triangles / 1e6).toFixed(2)}M tris${heavy ? ` | funnels on screen ≥ ${r.funnels}` : ''}`,
        );
      }
    } finally {
      await browser.close();
    }
  }
} finally {
  writeFileSync(out, JSON.stringify(results, null, 1));
  console.log(`wrote ${out}`);
  process.kill(-server.pid);
}
