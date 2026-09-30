// Which buffers get uploaded every frame? Wraps bufferSubData/bufferData and groups by size.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const file = process.argv[2];
const view = process.argv[3] ?? 'overview';
const hour = Number(process.argv[4] ?? 22);
const tornado = process.argv[5] === 'tornado';
const PORT = 4197;
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', 'dist-test', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: true },
);
await new Promise((r) => setTimeout(r, 1500));
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
  await page.addInitScript(() => {
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({ tips: false, graphicsChecked: true, sound: false, music: false }),
    );
    const P = WebGL2RenderingContext.prototype;
    window.__buf = { on: false, sub: new Map(), data: new Map() };
    for (const name of ['bufferSubData', 'bufferData']) {
      const orig = P[name];
      P[name] = function (...a) {
        if (!window.__buf.on) return orig.apply(this, a);
        const src = name === 'bufferSubData' ? a[2] : a[1];
        const size =
          typeof src === 'number'
            ? src
            : a[4] !== undefined && name === 'bufferSubData'
              ? a[4] * src.BYTES_PER_ELEMENT
              : src.byteLength;
        const t = performance.now();
        const r = orig.apply(this, a);
        const dt = performance.now() - t;
        const m = name === 'bufferSubData' ? window.__buf.sub : window.__buf.data;
        const e = m.get(size) ?? [0, 0, ''];
        e[0]++;
        e[1] += dt;
        if (!e[2])
          e[2] = (new Error().stack || '')
            .split('\n')
            .slice(2, 9)
            .map((l) => l.trim().replace(/https?:\/\/[^/]+\/assets\//, ''))
            .join(' < ');
        m.set(size, e);
        return r;
      };
    }
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  await page.evaluate(() => window.__game.waitFrames(30));
  await page.waitForTimeout(6000);
  const r = await page.evaluate(
    async ({ view, hour, tornado }) => {
      const g = window.__game;
      const s = await g.getState();
      const now = (s.tick + 7 * 60) % 1440;
      await g.advance((hour * 60 - now + 1440) % 1440 || 1);
      g.setCamera(view);
      if (tornado)
        await g.dispatch({
          type: 'disaster',
          kind: 'tornado',
          at: { x: 1300, z: 1000 },
          size: 28,
          heading: Math.PI,
        });
      await g.waitFrames(20);
      g.setSpeed(3);
      await new Promise((res) => setTimeout(res, 2000));
      window.__buf.on = true;
      const f = await g.recordFrames(4000);
      window.__buf.on = false;
      g.setSpeed(0);
      const row = (m) =>
        [...m]
          .map(([size, [n, ms, stack]]) => ({ size, n, ms: +ms.toFixed(1), stack }))
          .sort((a, b) => b.ms - a.ms)
          .slice(0, 12);
      return {
        frames: f.interval.length,
        avg: f.interval.reduce((a, b) => a + b, 0) / f.interval.length,
        sub: row(window.__buf.sub),
        data: row(window.__buf.data),
      };
    },
    { view, hour, tornado },
  );
  console.log(`${r.frames} frames, avg ${r.avg.toFixed(2)} ms`);
  for (const k of ['sub', 'data']) {
    console.log(k === 'sub' ? 'bufferSubData:' : 'bufferData:');
    for (const e of r[k])
      console.log(
        `  ${String(e.size).padStart(9)} B × ${String(e.n).padStart(5)} = ${String(e.ms).padStart(7)} ms  ${e.stack.slice(0, 330)}`,
      );
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
