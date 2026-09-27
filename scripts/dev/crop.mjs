// Dev: crop and scale a (large) PNG for review, e.g. a 2× photo from photo mode.
// Usage: node scripts/dev/crop.mjs in.png out.png [x y w h] [scale]   (region in source pixels)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const [src, out, ...rest] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: node scripts/dev/crop.mjs in.png out.png [x y w h] [scale]');
const buf = readFileSync(src);
const [sw, sh] = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
const [x = 0, y = 0, w = sw, h = sh, scale = 1] = rest.map(Number);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: Math.round(w * scale), height: Math.round(h * scale) },
  });
  await page.setContent(
    `<body style="margin:0;overflow:hidden"><img style="position:absolute;left:${-x * scale}px;top:${-y * scale}px;width:${sw * scale}px" src="data:image/png;base64,${buf.toString('base64')}"></body>`,
  );
  await page.screenshot({ path: out });
} finally {
  await browser.close();
}
