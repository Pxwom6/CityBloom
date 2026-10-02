// Dev (phase 3): which buildings of saved cities wear hand-made models, what they cost, and which
// designs rarely or never appear (and why: no building of the type, or none on a lot it fits).
// Usage: npm run build:test && node scripts/dev/modelcensus.mjs city.gz [more saves …] [--json out.json]
// Env DIST=dir censuses another build (default dist-test).
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const jsonAt = args.indexOf('--json');
const jsonOut = jsonAt >= 0 ? args[jsonAt + 1] : null;
const files = args.filter((a, i) => !a.startsWith('--') && (jsonAt < 0 || i !== jsonAt + 1));
const CELL = 8;
const RARE = 3;
const PORT = 4189;
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', process.env.DIST || 'dist-test', '--port', String(PORT), '--strictPort'],
  {
    stdio: 'ignore',
    detached: true,
  },
);
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

/** As `HandmadeModels.fits`: as wide as the lot, or two or three abreast, and no deeper. */
const fits = (m, W, D) => {
  const n = Math.round(W / m.w);
  return n >= 1 && n <= 3 && Math.abs(n * m.w - W) < 0.05 && m.d <= D + 0.05;
};

async function census(file) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  await page.addInitScript(() =>
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({ tips: false, graphicsChecked: true, quality: 'low', shadows: false }),
    ),
  );
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  const models = await page.evaluate(() => window.__game.getModels());
  const designs = await page.evaluate(() =>
    window.__game.getHandDesigns ? window.__game.getHandDesigns().filter((d) => d.kind === 'zoned') : [],
  );
  await page.close();
  return { models, designs };
}

function report(name, { models, designs }) {
  const byDef = new Map();
  for (const d of designs) byDef.set(d.def, [...(byDef.get(d.def) ?? []), d]);
  const by = new Map();
  let fitLots = 0;
  for (const m of models) {
    const k = `${m.def}@${m.w}x${m.d}`;
    const e = by.get(k) ?? { n: 0, hand: 0, tris: 0, far: 0, sky: 0, gen: 0, genTris: 0, fit: 0 };
    e.n++;
    e.fit = (byDef.get(m.def) ?? []).filter((d) => fits(d, m.w * CELL, m.d * CELL)).length;
    if (e.fit) fitLots++;
    if (m.hand) {
      e.hand++;
      e.tris += m.triangles;
      e.far += m.far;
      e.sky += m.sky;
    } else {
      e.gen++;
      e.genTris += m.triangles;
    }
    by.set(k, e);
  }
  const rows = [...by].sort((a, b) => b[1].n - a[1].n);
  let hand = 0,
    handTris = 0,
    far = 0,
    sky = 0,
    genTris = 0,
    noFit = 0;
  for (const [, e] of rows) {
    hand += e.hand;
    handTris += e.tris;
    far += e.far;
    sky += e.sky;
    genTris += e.genTris;
    if (!e.fit) noFit += e.n;
  }
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  console.log(`\n== ${name}`);
  console.log(
    `${models.length} buildings: ${hand} hand-made (${pct(hand, models.length)} %); ${noFit} (${pct(noFit, models.length)} %) on lots no design fits, ${fitLots - hand} generated on lots a design fits (shared with the generator)`,
  );
  console.log(`triangles: hand-made near ${handTris}, far ${far}, skyline ${sky}; generated ${genTris}`);
  console.log(
    `mean per building: hand-made near ${Math.round(handTris / Math.max(1, hand))}, far ${Math.round(far / Math.max(1, hand))}, sky ${Math.round(sky / Math.max(1, hand))}; generated ${Math.round(genTris / Math.max(1, models.length - hand))}`,
  );
  for (const [k, e] of rows.slice(0, 40))
    console.log(
      `  ${k.padEnd(10)} ${String(e.n).padStart(4)}  hand ${String(e.hand).padStart(4)}  designs ${e.fit}  near ${e.hand ? Math.round(e.tris / e.hand) : '-'} far ${e.hand ? Math.round(e.far / e.hand) : '-'} sky ${e.hand ? Math.round(e.sky / e.hand) : '-'} | gen ${e.gen ? Math.round(e.genTris / e.gen) : '-'}`,
    );
  // Every type and lot where generated looks still stand, and why: no design fits the lot, or one
  // does and takes turns with the generator.
  const gen = rows.filter(([, e]) => e.gen);
  console.log(
    `generated looks stand on: ${gen
      .map(
        ([k, e]) =>
          `${k} ${e.gen} of ${e.n} (${e.fit ? `${e.fit} design${e.fit > 1 ? 's' : ''}` : 'no design'})`,
      )
      .join(', ')}`,
  );
  // Each design: how many wear it, how many of its type there are, and on lots it fits.
  const worn = new Map();
  for (const m of models) if (m.hand) worn.set(m.hand, (worn.get(m.hand) ?? 0) + 1);
  const per = designs.map((d) => {
    const ofType = models.filter((m) => m.def === d.def);
    const onFit = ofType.filter((m) => fits(d, m.w * CELL, m.d * CELL)).length;
    const lots = new Map();
    for (const m of ofType)
      lots.set(`${m.w * CELL}x${m.d * CELL}`, (lots.get(`${m.w * CELL}x${m.d * CELL}`) ?? 0) + 1);
    return {
      id: d.id,
      w: d.w,
      d: d.d,
      worn: worn.get(d.id) ?? 0,
      type: ofType.length,
      onFit,
      lots: [...lots],
    };
  });
  const rare = per.filter((p) => p.worn <= RARE).sort((a, b) => a.id.localeCompare(b.id));
  const absent = rare.filter((p) => !p.type);
  const unfit = rare.filter((p) => p.type && !p.onFit);
  const few = rare.filter((p) => p.type && p.onFit);
  console.log(`designs worn by ${RARE} buildings or fewer: ${rare.length} of ${designs.length}`);
  if (absent.length) console.log(`  no building of the type: ${absent.map((p) => p.id).join(' ')}`);
  for (const p of unfit)
    console.log(
      `  ${p.id} (${p.w} × ${p.d} m): its ${p.type} buildings stand on lots it doesn't fit (${p.lots.map(([l, n]) => `${l} ×${n}`).join(', ')})`,
    );
  for (const p of few)
    console.log(
      `  ${p.id} (${p.w} × ${p.d} m): worn by ${p.worn}; ${p.onFit} of its type's ${p.type} buildings on lots it fits`,
    );
  return { name, buildings: models.length, hand, noFit, shared: fitLots - hand, per };
}

const out = [];
try {
  for (const f of files) out.push(report(basename(f), await census(f)));
  if (out.length > 1) {
    // Across every city: designs that rarely appear anywhere.
    const total = new Map();
    for (const c of out)
      for (const p of c.per) {
        const t = total.get(p.id) ?? { worn: 0, type: 0, onFit: 0, w: p.w, d: p.d };
        t.worn += p.worn;
        t.type += p.type;
        t.onFit += p.onFit;
        total.set(p.id, t);
      }
    const rare = [...total].filter(([, t]) => t.worn <= RARE).sort((a, b) => a[0].localeCompare(b[0]));
    console.log(
      `\n== all ${out.length} cities: designs worn by ${RARE} buildings or fewer: ${rare.length} of ${total.size}`,
    );
    for (const [id, t] of rare)
      console.log(
        `  ${id.padEnd(7)} ${t.w} × ${t.d} m: worn ${t.worn}; ${t.type} of its type, ${t.onFit} on lots it fits`,
      );
  }
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(out, null, 1));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
