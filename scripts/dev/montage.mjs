// Dev: tile screenshots into one image. Usage: node scripts/dev/montage.mjs out.png cols a.png b.png ...
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const [out, cols, ...files] = process.argv.slice(2);
const w = 1800 / Number(cols);
const cells = files
  .map(
    (f) =>
      `<figure><img src="data:image/png;base64,${readFileSync(f).toString('base64')}"><figcaption>${basename(f)}</figcaption></figure>`,
  )
  .join('');
const html = `<style>body{margin:0;display:grid;grid-template-columns:repeat(${cols},${w}px);background:#222;font:12px sans-serif;color:#eee}
figure{margin:0}img{width:${w}px;display:block}figcaption{padding:2px 4px}</style>${cells}`;
const browser = await chromium.launch(
  process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
);
const page = await browser.newPage({ viewport: { width: 1800, height: 400 } });
await page.setContent(html);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
