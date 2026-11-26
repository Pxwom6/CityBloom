// How the game sits on a phone (M49): opens saved cities in Playwright's phone emulation with the CPU
// slowed (CDP throttling), and prints per city and view the game's own work per frame, the frame
// intervals, draw calls and triangles, the worker's tick times, and memory: the page's and the sim
// worker's JavaScript heaps (CDP), what the page has handed to the GPU (WebGL buffers, textures and
// render buffers counted as they're made and deleted), and the renderer and GPU processes' resident
// memory (ps). SwiftShader draws on the CPU here, so frame intervals mean little; the work, calls,
// triangles, heaps and GPU bytes are what to read.
// Usage: npm run build:test && node scripts/dev/phoneprobe.mjs [--cities demo,20k,bench]
//   [--devices iphone,pixel] [--quality low,phone] [--throttle 4] [--views overview,city,street]
//   [--json out.json] [--shots dir]
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
/**
 * The Phone preset's frame target (M49): 30 fps on a phone 4× slower than this machine's CPU means
 * the main thread at most 80 % busy (every frame's own work 30 times a second plus the work paced by
 * time), and a GPU load a mid-range phone draws at 30 fps.
 */
const PHONE_TARGET = { load: 0.8, calls: 250, triangles: 2.5e6 };
/** A phone's memory budget for the 20k city: the renderer's private memory plus what's on the GPU (MB). */
const MEMORY_BUDGET_MB = 700;
const CITIES = {
  demo: 'public/demo.citybloom',
  '20k': 'Saves/Town20k.citybloom',
  bench: 'bench-results/city.gz',
};
const DEVICES = { iphone: 'iPhone 13', pixel: 'Pixel 7' };
const cities = arg('cities', 'demo,20k,bench').split(',');
const devs = arg('devices', 'iphone').split(',');
const qualities = arg('quality', 'low').split(',');
const throttle = Number(arg('throttle', '4'));
const views = arg('views', 'overview,city,street').split(',');
const jsonOut = arg('json', '');
const shots = arg('shots', '');
/** --check: fail (exit 1) if the Phone preset's frame target or the 20k city's memory budget is missed. */
const check = process.argv.includes('--check');
const failures = [];
const dist = process.env.DIST || 'dist-test';
const PORT = Number(process.env.PORT || 4191);
if (shots) mkdirSync(shots, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
process.on('exit', () => {
  try {
    process.kill(-server.pid);
  } catch {
    /* gone */
  }
});
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 250));
}

/** Counts what the page hands the GPU: every buffer, texture and render buffer's bytes while it lives. */
function gpuTracker() {
  const sizes = new Map();
  let total = 0;
  const set = (obj, key, bytes) => {
    if (!obj) return;
    let m = sizes.get(obj);
    if (!m) sizes.set(obj, (m = new Map()));
    total += bytes - (m.get(key) ?? 0);
    m.set(key, bytes);
  };
  const drop = (obj) => {
    const m = sizes.get(obj);
    if (!m) return;
    for (const v of m.values()) total -= v;
    sizes.delete(obj);
  };
  const BPP = new Map([
    [0x8058, 4], // RGBA8
    [0x8051, 3], // RGB8
    [0x881a, 8], // RGBA16F
    [0x8814, 16], // RGBA32F
    [0x8229, 1], // R8
    [0x822b, 2], // RG8
    [0x822d, 2], // R16F
    [0x822e, 4], // R32F
    [0x81a5, 2], // DEPTH16
    [0x81a6, 4], // DEPTH24
    [0x8cac, 4], // DEPTH32F
    [0x88f0, 4], // DEPTH24_STENCIL8
    [0x8c43, 4], // SRGB8_ALPHA8
    [0x8c3a, 4], // R11F_G11F_B10F
  ]);
  const bpp = (fmt, type) => BPP.get(fmt) ?? (type === 0x1406 ? 16 : type === 0x140b ? 8 : 4);
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) {
    const P = C.prototype;
    const wrap = (name, fn) => {
      const orig = P[name];
      if (!orig) return;
      P[name] = function (...a) {
        const r = orig.apply(this, a);
        try {
          fn.call(this, a);
        } catch {
          /* counting only */
        }
        return r;
      };
    };
    const bound = (gl, target) => {
      const q = {
        0x8892: 0x8894, // ARRAY_BUFFER
        0x8893: 0x8895, // ELEMENT_ARRAY_BUFFER
        0x8a11: 0x8a28, // UNIFORM_BUFFER
        0x0de1: 0x8069, // TEXTURE_2D
        0x8c1a: 0x8c1d, // TEXTURE_2D_ARRAY
        0x806f: 0x806a, // TEXTURE_3D
        0x8513: 0x8514, // TEXTURE_CUBE_MAP
        0x8d41: 0x8ca7, // RENDERBUFFER
      }[target];
      if (q) return gl.getParameter(q);
      if (target >= 0x8515 && target <= 0x851a) return gl.getParameter(0x8514);
      return null;
    };
    wrap('bufferData', function (a) {
      const [target, src] = a;
      const n = typeof src === 'number' ? src : (src?.byteLength ?? 0);
      set(bound(this, target), 'b', n);
    });
    wrap('deleteBuffer', (a) => drop(a[0]));
    wrap('texImage2D', function (a) {
      const [target, level] = a;
      let w, h, fmt, type;
      if (a.length >= 8) [, , fmt, w, h, , , type] = a;
      else {
        const src = a[5];
        fmt = a[2];
        type = a[4];
        w = src?.width ?? src?.videoWidth ?? 0;
        h = src?.height ?? src?.videoHeight ?? 0;
      }
      set(bound(this, target), `${target}:${level}`, w * h * bpp(fmt, type));
    });
    wrap('texStorage2D', function (a) {
      const [target, levels, fmt, w, h] = a;
      const faces = target === 0x8513 ? 6 : 1;
      set(bound(this, target), 's', w * h * bpp(fmt) * faces * (levels > 1 ? 4 / 3 : 1));
    });
    wrap('texImage3D', function (a) {
      const [target, level, fmt, w, h, d, , , type] = a;
      set(bound(this, target), `${target}:${level}`, w * h * d * bpp(fmt, type));
    });
    wrap('texStorage3D', function (a) {
      const [target, levels, fmt, w, h, d] = a;
      set(bound(this, target), 's', w * h * d * bpp(fmt) * (levels > 1 ? 4 / 3 : 1));
    });
    wrap('deleteTexture', (a) => drop(a[0]));
    wrap('renderbufferStorage', function (a) {
      const [target, fmt, w, h] = a;
      set(bound(this, target), 'r', w * h * bpp(fmt));
    });
    wrap('renderbufferStorageMultisample', function (a) {
      const [target, samples, fmt, w, h] = a;
      set(bound(this, target), 'r', w * h * bpp(fmt) * Math.max(1, samples));
    });
    wrap('deleteRenderbuffer', (a) => drop(a[0]));
  }
  window.__gpuBytes = () => total;
}

/**
 * The renderer process's memory (MB): resident, and private (pages no other process shares: closest
 * to what a phone counts against a tab), from /proc's smaps_rollup; and the GPU process's resident
 * memory (where SwiftShader keeps what a phone's GPU would hold).
 */
function processRss() {
  const rollup = (pid) => {
    try {
      const t = readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8');
      const kb = (k) => Number(t.match(new RegExp(`^${k}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
      return { rss: kb('Rss'), priv: kb('Private_Clean') + kb('Private_Dirty') };
    } catch {
      return { rss: 0, priv: 0 };
    }
  };
  try {
    const rows = execSync('ps -eo pid,rss,args --no-headers', { encoding: 'utf8' }).split('\n');
    let renderer = { pid: 0, rss: 0 };
    let gpu = 0;
    for (const r of rows) {
      const m = r.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) continue;
      const kb = Number(m[2]);
      if (/--type=renderer/.test(m[3]) && kb > renderer.rss) renderer = { pid: Number(m[1]), rss: kb };
      else if (/--type=gpu-process/.test(m[3])) gpu = Math.max(gpu, kb);
    }
    const r = rollup(renderer.pid);
    return {
      renderer: Math.round(r.rss / 1024),
      private: Math.round(r.priv / 1024),
      gpu: Math.round(gpu / 1024),
    };
  } catch {
    return { renderer: 0, private: 0, gpu: 0 };
  }
}

/** Every worker's JavaScript heap (MB), through the page's CDP session. */
async function workerHeaps(cdp, sessions) {
  const out = [];
  for (const s of sessions) {
    const id = Math.floor(Math.random() * 1e9);
    const got = new Promise((resolve) => {
      const on = (e) => {
        if (e.sessionId !== s) return;
        const m = JSON.parse(e.message);
        if (m.id !== id) return;
        cdp.off('Target.receivedMessageFromTarget', on);
        resolve(m.result?.usedSize ?? 0);
      };
      cdp.on('Target.receivedMessageFromTarget', on);
      setTimeout(() => resolve(0), 5000);
    });
    await cdp
      .send('Target.sendMessageToTarget', {
        sessionId: s,
        message: JSON.stringify({ id, method: 'Runtime.getHeapUsage' }),
      })
      .catch(() => {});
    out.push(await got);
  }
  return out.map((b) => Math.round(b / 1048576));
}

/** A CPU profile's busy time split into WebGL calls, garbage collection and the rest (ms). */
const GL =
  /^(draw|uniform|bind|buffer|tex|use|vertexAttrib|enable|disable|clear|viewport|blit|invalidate|read|get|framebuffer|renderbuffer|blend|depth|stencil|cull|front|color|scissor|polygon|generateMipmap|pixelStorei|create|delete|attach|link|compile|shader|active|is[A-Z]|fenceSync|clientWaitSync|flush|finish)/;
function splitProfile(prof) {
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const out = { js: 0, gl: 0, gc: 0 };
  for (let i = 0; i < prof.samples.length; i++) {
    const n = byId.get(prof.samples[i]);
    const dt = (prof.timeDeltas[i + 1] ?? 0) / 1000;
    if (!n) continue;
    const f = n.callFrame;
    if (['(idle)', '(program)', '(root)'].includes(f.functionName)) continue;
    if (f.functionName === '(garbage collector)') out.gc += dt;
    else if (!f.url && GL.test(f.functionName)) out.gl += dt;
    else out.js += dt;
  }
  return out;
}

const pct = (a, p) => {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mb = (b) => Math.round(b / 1048576);

const results = [];
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  for (const dev of devs) {
    for (const quality of qualities) {
      for (const city of cities) {
        const profile = devices[DEVICES[dev] ?? dev];
        const ctx = await browser.newContext({ ...profile });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => console.log('page error:', e.message));
        await page.addInitScript(
          ([q]) => {
            const s = { tips: false, graphicsChecked: true, crashReports: false, reportsNotice: true };
            if (q !== 'default') Object.assign(s, { quality: q, shadows: false, drawDistance: 'near' });
            localStorage.setItem('citybloom.settings', JSON.stringify(s));
          },
          [quality],
        );
        await page.addInitScript(gpuTracker);
        const cdp = await ctx.newCDPSession(page);
        const workers = [];
        cdp.on('Target.attachedToTarget', (e) => {
          if (e.targetInfo.type === 'worker') workers.push(e.sessionId);
        });
        await cdp.send('Target.setAutoAttach', {
          autoAttach: true,
          waitForDebuggerOnStart: false,
          flatten: false,
        });
        const t0 = Date.now();
        await page.goto(`http://localhost:${PORT}/`);
        await page.getByTestId('main-load').click({ timeout: 180_000 });
        await Promise.all([
          page.waitForURL(/\?load=/, { timeout: 180_000 }),
          page.getByTestId('import-file').setInputFiles(CITIES[city] ?? city),
        ]);
        await page.waitForFunction(
          () => window.__game?.ready && window.__game.getShell().mode === 'play',
          null,
          { timeout: 300_000 },
        );
        const loadS = (Date.now() - t0) / 1000;
        await page.evaluate(() => window.__game.waitFrames(5));
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
        await page.evaluate(() => window.__game.setSpeed(1));
        const row = { device: dev, quality, city, loadS, views: {} };
        const st0 = await page.evaluate(() => window.__game.getState());
        row.population = st0.population;
        for (const v of views) {
          await page.evaluate((p) => window.__game.setCamera(p), v);
          await page.evaluate(() => window.__game.waitFrames(8));
          await cdp.send('Profiler.enable');
          await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
          await cdp.send('Profiler.start');
          const rec = await page.evaluate(() => window.__game.recordFrames(5000));
          const { profile } = await cdp.send('Profiler.stop');
          const split = splitProfile(profile);
          if (shots)
            writeFileSync(`${shots}/${dev}-${quality}-${city}-${v}.cpuprofile`, JSON.stringify(profile));
          const st = await page.evaluate(() => window.__game.getState());
          const r = st.renderStats;
          row.views[v] = {
            frames: rec.interval.length,
            intervalAvg: rec.interval.reduce((a, b) => a + b, 0) / Math.max(1, rec.interval.length),
            intervalP95: pct(rec.interval, 0.95),
            workAvg: rec.work.reduce((a, b) => a + b, 0) / Math.max(1, rec.work.length),
            workP50: pct(rec.work, 0.5),
            workP95: pct(rec.work, 0.95),
            // Of the recording, the share of the main thread busy (any script, WebGL call or GC).
            busy: (split.js + split.gl + split.gc) / 5000,
            // Main-thread time a frame spent in the game's own scripts, and in WebGL calls (where a
            // software-drawn page waits for the GPU process), from the CPU profile.
            jsMs: split.js / Math.max(1, rec.interval.length),
            glMs: split.gl / Math.max(1, rec.interval.length),
            gcMs: split.gc / Math.max(1, rec.interval.length),
            calls: r.calls,
            triangles: r.triangles,
            cars: r.cars,
            walkers: r.walkers,
            trees: r.trees,
          };
          // Paused: no building changes, so no rebuilds; what's left is what every frame costs.
          await page.evaluate(() => window.__game.setSpeed(0));
          await page.evaluate(() => window.__game.waitFrames(3));
          if (shots) await cdp.send('Profiler.start');
          const still = await page.evaluate(() => window.__game.recordFrames(3000));
          if (shots) {
            const { profile: paused } = await cdp.send('Profiler.stop');
            writeFileSync(`${shots}/${dev}-${quality}-${city}-${v}-paused.cpuprofile`, JSON.stringify(paused));
          }
          await page.evaluate(() => window.__game.setSpeed(1));
          const x = row.views[v];
          x.frameCost = pct(still.work, 0.5);
          // Projected main-thread load drawing 30 frames a second: every frame's cost 30 times, plus
          // the work paced by time (rebuilds, the worker's messages, the interface) measured running.
          const fps = x.frames / 5;
          const paced = Math.max(0, x.busy * 1000 - fps * x.frameCost);
          x.load30 = (30 * x.frameCost + paced) / 1000;
          if (shots) await page.screenshot({ path: `${shots}/${dev}-${quality}-${city}-${v}.png` });
        }
        const perf = await page.evaluate(() => window.__game.getPerf());
        const heap = await cdp.send('Runtime.getHeapUsage');
        row.perf = perf;
        row.memory = {
          pageHeap: mb(heap.usedSize),
          workerHeaps: await workerHeaps(cdp, workers),
          gpu: mb(await page.evaluate(() => window.__gpuBytes?.() ?? 0)),
          canvas: await page.evaluate(() => {
            const c = document.querySelector('canvas');
            return c ? `${c.width}×${c.height}` : '';
          }),
          rss: processRss(),
        };
        row.memory.groups = await page.evaluate(() => window.__game.memoryBreakdown?.() ?? []);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
        results.push(row);
        const m = row.memory;
        console.log(
          `\n${dev} ${quality} ${city} (pop ${row.population}, loaded in ${loadS.toFixed(0)} s, canvas ${m.canvas}):` +
            `\n  memory: page heap ${m.pageHeap} MB, worker heap ${m.workerHeaps.join('+')} MB, GPU ${m.gpu} MB, renderer RSS ${m.rss.renderer} MB (private ${m.rss.private}), GPU process RSS ${m.rss.gpu} MB` +
            `\n  ticks (×${throttle} slower CPU): avg ${perf.tickMsAvg.toFixed(2)} ms, max ${perf.tickMsMax.toFixed(1)} ms, ${perf.ticksPerSecond.toFixed(1)}/s, dropped ${perf.droppedTicks}`,
        );
        const groups = (m.groups ?? []).filter((g) => g.cpu >= 1).sort((a, b) => b.cpu - a.cpu);
        console.log(
          `  geometry kept on the CPU: ${groups.reduce((a, g) => a + g.cpu, 0).toFixed(0)} MB (${groups
            .map((g) => `${g.name} ${g.cpu}`)
            .join(', ')})`,
        );
        for (const [v, x] of Object.entries(row.views)) {
          if (
            check &&
            quality === 'phone' &&
            (x.load30 > PHONE_TARGET.load ||
              x.calls > PHONE_TARGET.calls ||
              x.triangles > PHONE_TARGET.triangles)
          )
            failures.push(
              `${dev} ${city} ${v}: load ${(x.load30 * 100).toFixed(0)} %, ${x.calls} calls, ${(x.triangles / 1e6).toFixed(2)}M triangles`,
            );
          console.log(
            `  ${v.padEnd(9)} frame ${x.frameCost.toFixed(1)} ms paused, load at 30 fps ${(x.load30 * 100).toFixed(0)} %; work p50 ${x.workP50.toFixed(1)} avg ${x.workAvg.toFixed(1)} p95 ${x.workP95.toFixed(1)} ms, main thread ${(x.busy * 100).toFixed(0)} % busy (scripts ${x.jsMs.toFixed(1)}, WebGL ${x.glMs.toFixed(1)}, GC ${x.gcMs.toFixed(1)}); interval avg ${x.intervalAvg.toFixed(0)} p95 ${x.intervalP95.toFixed(0)} ms (${x.frames} frames); calls ${x.calls}, tris ${(x.triangles / 1e6).toFixed(2)}M, cars ${x.cars}, walkers ${x.walkers}, trees ${x.trees}`,
          );
        }
        // The memory budget (M49): the 20k city on a phone.
        const total = row.memory.rss.private + row.memory.gpu;
        if (check && city === '20k' && total > MEMORY_BUDGET_MB)
          failures.push(
            `${dev} ${quality} 20k: ${total} MB (private ${row.memory.rss.private} + GPU ${row.memory.gpu}) over ${MEMORY_BUDGET_MB} MB`,
          );
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
}
if (check) {
  if (failures.length) {
    console.log(`\nmissed:\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nThe Phone preset holds its frame target, and the 20k city is inside its memory budget.');
}
process.exit(0);
