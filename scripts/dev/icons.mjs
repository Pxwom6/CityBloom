// Dev: render the app icons (public/icons/*.svg) to the PNG sizes the web app manifest and iOS use.
// Usage: node scripts/dev/icons.mjs   (writes public/icons/*.png; commit them)
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const dir = 'public/icons';
const renders = [
  { src: 'icon.svg', out: 'icon-192.png', size: 192 },
  { src: 'icon.svg', out: 'icon-512.png', size: 512 },
  { src: 'icon-maskable.svg', out: 'icon-maskable-512.png', size: 512 },
  // iOS draws its own rounded corners over a square tile.
  { src: 'icon-maskable.svg', out: 'apple-touch-icon.png', size: 180 },
];
const browser = await chromium.launch();
try {
  for (const r of renders) {
    const page = await browser.newPage({ viewport: { width: r.size, height: r.size } });
    const svg = readFileSync(`${dir}/${r.src}`, 'utf8');
    await page.setContent(
      `<html><body style="margin:0;background:transparent">` +
        `<img style="display:block;width:${r.size}px;height:${r.size}px" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}">` +
        `</body></html>`,
    );
    await page.screenshot({ path: `${dir}/${r.out}`, omitBackground: true });
    await page.close();
    console.log(r.out);
  }
} finally {
  await browser.close();
}
