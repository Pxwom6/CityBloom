// The careful mayor's money curve (M17): treasury, spending on goals and population by year, from
// the balance tool's CSV, drawn as three small charts (one axis each) with goals and elections
// marked. Writes an SVG, and a PNG beside it when asked.
// Usage: npx tsx scripts/balance.ts 25 careful --csv out && node scripts/dev/moneychart.mjs out/careful out.svg [--png]
import { readFileSync, writeFileSync } from 'node:fs';

const [base, out] = process.argv.slice(2);
const png = process.argv.includes('--png');
if (!base || !out) {
  console.error('usage: node scripts/dev/moneychart.mjs <csv base, e.g. out/careful> <out.svg> [--png]');
  process.exit(1);
}
const parse = (text) => {
  const [head, ...rows] = text.trim().split('\n');
  const keys = head.split(',');
  return rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [keys[i], isNaN(+v) ? v : +v])));
};
const samples = parse(readFileSync(`${base}.csv`, 'utf8'));
let events = [];
try {
  events = parse(readFileSync(`${base}-events.csv`, 'utf8'));
} catch {
  // Older runs wrote no events.
}

const INK = '#24303c';
const MUTED = '#66727f';
const GRID = 'rgba(40,52,66,0.12)';
const LINE = '#2f86c9';
const BAR = '#2e9a5a';
const W = 760;
const H = 190;
const L = 70;
const R = 20;
const T = 34;
const B = 30;
const months = samples.length;
const years = Math.ceil(months / 12);
const x = (m) => L + ((W - L - R) * m) / Math.max(1, months - 1);
const fmtMoney = (v) =>
  Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M` : `$${Math.round(v / 1e3)}k`;
const fmtPop = (v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`);

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v || 1));
  for (const k of [1, 2, 2.5, 5, 10]) if (k * p >= v) return k * p;
  return 10 * p;
}

function frame(y0, title, max, fmt) {
  const y = (v) => y0 + T + (H - T - B) * (1 - v / max);
  let g = `<text x="${L}" y="${y0 + 18}" font-size="13" font-weight="600" fill="${INK}">${title}</text>`;
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${GRID}"/>`;
    g += `<text x="${L - 6}" y="${y(v) + 4}" font-size="11" text-anchor="end" fill="${MUTED}">${fmt(v)}</text>`;
  }
  for (let yr = 0; yr <= years; yr += years > 12 ? 5 : 2) {
    const xx = x(Math.min(months - 1, yr * 12));
    g += `<text x="${xx}" y="${y0 + H - 10}" font-size="11" text-anchor="middle" fill="${MUTED}">${yr === 0 ? 'Year 0' : `Y${yr}`}</text>`;
  }
  return { g, y };
}

let svg = '';
let y0 = 0;
// 1. Treasury, with goals met (circles) and elections won (triangles).
{
  const max = niceMax(Math.max(...samples.map((s) => s.treasury)));
  const { g, y } = frame(y0, 'Treasury', max, fmtMoney);
  svg += g;
  const pts = samples.map((s, i) => `${x(i).toFixed(1)},${y(Math.max(0, s.treasury)).toFixed(1)}`);
  svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>`;
  for (const e of events) {
    const s = samples[Math.min(months - 1, e.month)];
    if (!s) continue;
    const cx = x(Math.min(months - 1, e.month));
    const cy = y(Math.max(0, s.treasury));
    if (e.kind === 'goal')
      svg += `<circle cx="${cx}" cy="${cy}" r="4.5" fill="#fff" stroke="${INK}" stroke-width="2"><title>${e.ref} (month ${e.month})</title></circle>`;
    if (e.kind === 'election')
      svg += `<path d="M${cx - 5},${cy + 12} L${cx + 5},${cy + 12} L${cx},${cy + 4} Z" fill="${INK}"><title>election ${e.ref}</title></path>`;
  }
  svg += `<circle cx="${W - 250}" cy="${y0 + 14}" r="4.5" fill="#fff" stroke="${INK}" stroke-width="2"/><text x="${W - 240}" y="${y0 + 18}" font-size="11" fill="${MUTED}">goal met</text>`;
  svg += `<path d="M${W - 160},${y0 + 19} L${W - 150},${y0 + 19} L${W - 155},${y0 + 10} Z" fill="${INK}"/><text x="${W - 144}" y="${y0 + 18}" font-size="11" fill="${MUTED}">election</text>`;
  y0 += H;
}
// 2. Spent on goals each year.
{
  const per = [];
  for (let yr = 0; yr < years; yr++) {
    const end = samples[Math.min(months - 1, yr * 12 + 11)].goals;
    const start = yr ? samples[yr * 12 - 1].goals : 0;
    per.push(end - start);
  }
  const max = niceMax(Math.max(1, ...per));
  const { g, y } = frame(
    y0,
    'Spent on goals (landmarks, projects, university, research park), per year',
    max,
    fmtMoney,
  );
  svg += g;
  const bw = ((W - L - R) / years) * 0.7;
  per.forEach((v, yr) => {
    if (v <= 0) return;
    const cx = x(Math.min(months - 1, yr * 12 + 6));
    const top = y(v);
    const base = y(0);
    const r = Math.min(4, (base - top) / 2);
    svg += `<path d="M${cx - bw / 2},${base} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${base} Z" fill="${BAR}"><title>Year ${yr + 1}: ${fmtMoney(v)}</title></path>`;
  });
  y0 += H;
}
// 3. Population, with the 50k line.
{
  const max = niceMax(Math.max(50_000, ...samples.map((s) => s.population)));
  const { g, y } = frame(y0, 'Population', max, fmtPop);
  svg += g;
  svg += `<line x1="${L}" x2="${W - R}" y1="${y(50_000)}" y2="${y(50_000)}" stroke="${MUTED}" stroke-dasharray="4 4"/>`;
  svg += `<text x="${W - R}" y="${y(50_000) - 5}" font-size="11" text-anchor="end" fill="${MUTED}">50,000</text>`;
  const pts = samples.map((s, i) => `${x(i).toFixed(1)},${y(s.population).toFixed(1)}`);
  svg += `<polyline points="${pts.join(' ')}" fill="none" stroke="${LINE}" stroke-width="2" stroke-linejoin="round"/>`;
  y0 += H;
}
const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y0}" viewBox="0 0 ${W} ${y0}" font-family="system-ui, sans-serif"><rect width="${W}" height="${y0}" fill="#fffdf8"/>${svg}</svg>`;
writeFileSync(out, doc);
console.log(`wrote ${out}`);
if (png) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: y0 }, deviceScaleFactor: 1.5 });
  await page.setContent(`<body style="margin:0">${doc}</body>`);
  await page.screenshot({ path: out.replace(/\.svg$/, '.png') });
  await browser.close();
  console.log(`wrote ${out.replace(/\.svg$/, '.png')}`);
}
