// Every panel on a phone (M49): opens each of the game's panels, sheets, menus and screens in turn in
// a phone's emulation, upright and sideways, and saves a picture of each, plus contact sheets
// (`sheet-<orient>-<n>.png`) for one-look review. Each picture is also checked for controls a finger
// can't use (under 44 px, or off the screen): those are printed.
// Usage: npm run build:test && node scripts/dev/phonepanels.mjs <outDir> [--device iphone|pixel]
//   [--orient portrait,landscape] [--only name,…]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const out = process.argv[2] ?? 'phone-panels';
const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const device = { iphone: 'iPhone 13', pixel: 'Pixel 7' }[arg('device', 'iphone')] ?? arg('device', 'iphone');
const orients = arg('orient', 'portrait,landscape').split(',');
const only = arg('only', '').split(',').filter(Boolean);
const PORT = Number(process.env.PORT || 4196);
mkdirSync(out, { recursive: true });

const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', process.env.DIST || 'dist-test', '--port', String(PORT), '--strictPort'],
  { stdio: 'ignore', detached: true },
);
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
const base = `http://localhost:${PORT}/`;

const SETTINGS = {
  tips: false,
  graphicsChecked: true,
  reportsNotice: true,
  quality: 'phone',
  shadows: false,
  drawDistance: 'near',
};

async function open(page, url, mode = 'play') {
  await page.goto(base + url);
  await page.waitForFunction((m) => window.__game?.ready && window.__game.getShell().mode === m, mode, {
    timeout: 180_000,
  });
  await page.evaluate(() => window.__game.waitFrames(3));
}

const tap = (page, id) => page.getByTestId(id).tap({ timeout: 15_000 });
const panel = (page, name) => page.evaluate((n) => window.__game.openPanel(n), name);

/** Tap the first of a kind of thing near the middle of the screen (for its inspector). */
async function tapThing(page, kind) {
  const at = await page.evaluate(async (kind) => {
    const g = window.__game;
    const list = kind === 'civic' ? await g.getCivics() : await g.getBuildings();
    for (const b of list) {
      const s = g.worldToScreen(b.x, b.z);
      const el = document.elementFromPoint(s.x, s.y);
      if (el?.tagName === 'CANVAS' && s.y > innerHeight * 0.2 && s.y < innerHeight * 0.6) return s;
    }
    return null;
  }, kind);
  if (at) await page.touchscreen.tap(at.x, at.y);
}

/** Each scene: where it starts (a URL), and how to open it. */
const SCENES = [
  ['menu', '', 'menu', async () => {}],
  ['new-city', '', 'menu', (p) => tap(p, 'main-new')],
  ['friends', '', 'menu', (p) => tap(p, 'main-friends')],
  ['learn', '', 'menu', (p) => tap(p, 'main-learn')],
  ['scenarios', '', 'menu', (p) => tap(p, 'main-scenarios')],
  ['load', '', 'menu', (p) => tap(p, 'main-load')],
  ['settings-menu', '', 'menu', (p) => tap(p, 'main-settings')],
  ['editor', '?editor=new&seed=phone', 'editor', async () => {}],
  ['city', 'town', 'play', async () => {}],
  ['build', 'town', 'play', (p) => tap(p, 'tool-build')],
  ['more', 'town', 'play', (p) => tap(p, 'tool-more')],
  ['roads', 'town', 'play', (p) => tap(p, 'tool-road')],
  ['zones', 'town', 'play', (p) => tap(p, 'tool-zone')],
  [
    'terrain',
    'town',
    'play',
    async (p) => {
      await tap(p, 'tool-more');
      await tap(p, 'tool-terrain');
    },
  ],
  [
    'districts-tool',
    'town',
    'play',
    async (p) => {
      await tap(p, 'tool-more');
      await tap(p, 'tool-district');
    },
  ],
  [
    'disasters',
    'town',
    'play',
    async (p) => {
      await tap(p, 'tool-more');
      await tap(p, 'tool-disasters');
    },
  ],
  ['maps', 'town', 'play', (p) => tap(p, 'tool-maps')],
  [
    'education',
    'town',
    'play',
    async (p) => {
      await tap(p, 'tool-build');
      await tap(p, 'tool-education');
    },
  ],
  ['more-menu', 'town', 'play', (p) => tap(p, 'open-more')],
  ['budget', 'town', 'play', (p) => tap(p, 'open-budget')],
  [
    'budget-taxes',
    'town',
    'play',
    async (p) => {
      await tap(p, 'open-budget');
      await tap(p, 'budget-tab-taxes');
    },
  ],
  ['advisors', 'town', 'play', (p) => panel(p, 'advisors')],
  ['notifications', 'town', 'play', (p) => panel(p, 'notifications')],
  ['city-panel', 'town', 'play', (p) => panel(p, 'city')],
  ['history', 'town', 'play', (p) => panel(p, 'history')],
  ['districts', 'town', 'play', (p) => panel(p, 'districts')],
  ['region', 'town', 'play', (p) => panel(p, 'region')],
  ['weather', 'town', 'play', (p) => tap(p, 'weather')],
  ['inspector', 'town', 'play', (p) => tapThing(p, 'building')],
  ['inspector-civic', 'town', 'play', (p) => tapThing(p, 'civic')],
  ['pause', 'town', 'play', (p) => tap(p, 'menu-button')],
  [
    'save',
    'town',
    'play',
    async (p) => {
      await tap(p, 'menu-button');
      await tap(p, 'pause-save');
    },
  ],
  [
    'settings',
    'town',
    'play',
    async (p) => {
      await tap(p, 'menu-button');
      await tap(p, 'pause-settings');
    },
  ],
  [
    'report',
    'town',
    'play',
    async (p) => {
      await tap(p, 'menu-button');
      await tap(p, 'pause-report');
    },
  ],
  [
    'photo',
    'town',
    'play',
    async (p) => {
      await tap(p, 'tool-more');
      await tap(p, 'tool-photo');
    },
  ],
  ['tutorial', 'town', 'play', (p) => p.evaluate(() => window.__game.showTutorialStep('budget'))],
  ['goals', '?scenario=holdline', 'play', (p) => panel(p, 'goals')],
  ['war-room', '?scenario=holdline', 'play', (p) => panel(p, 'war')],
  [
    'war-build',
    '?scenario=holdline',
    'play',
    async (p) => {
      await tap(p, 'tool-build');
      await tap(p, 'tool-military');
    },
  ],
  ['region-war', '?scenario=holdline', 'play', (p) => panel(p, 'region')],
];

const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const problems = [];
try {
  for (const orient of orients) {
    const { defaultBrowserType: _b, viewport: vp, ...profile } = devices[device];
    const viewport = orient === 'landscape' ? { width: vp.height, height: vp.width } : vp;
    for (const [name, url, mode, act] of SCENES) {
      if (only.length && !only.includes(name)) continue;
      const ctx = await browser.newContext({ ...profile, viewport });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => console.log(`${name} ${orient}: page error: ${e.message}`));
      await page.addInitScript(
        (s) => localStorage.setItem('citybloom.settings', JSON.stringify(s)),
        SETTINGS,
      );
      try {
        if (url === 'town') {
          await open(page, '', 'menu');
          await tap(page, 'main-load');
          await Promise.all([
            page.waitForURL(/\?load=/),
            page.getByTestId('import-file').setInputFiles('Saves/Town20k.citybloom'),
          ]);
          await page.waitForFunction(
            () => window.__game?.ready && window.__game.getShell().mode === 'play',
            null,
            {
              timeout: 180_000,
            },
          );
          await page.evaluate(() => window.__game.waitFrames(3));
        } else await open(page, url, mode);
        // A scenario's brief comes first.
        if (
          await page
            .getByTestId('scenario-begin')
            .isVisible()
            .catch(() => false)
        )
          await tap(page, 'scenario-begin');
        await act(page);
        await page.evaluate(() => window.__game.waitFrames(3));
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${out}/${name}-${orient}.png` });
        const bad = await page.evaluate(() => {
          const out = [];
          const vw = innerWidth;
          for (const el of document.querySelectorAll(
            '#ui button, #ui select, #ui input:not([type=hidden]), #ui [role=tab]',
          )) {
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden') continue;
            const r = el.getBoundingClientRect();
            if (!r.width && !r.height) continue;
            // Under another layer (a sheet over the bar), or scrolled out of view: not counted.
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (!top || !(el === top || el.contains(top) || top.contains(el))) continue;
            const label = el.closest('label');
            const t =
              (el.type === 'checkbox' || el.type === 'radio') && label ? label.getBoundingClientRect() : r;
            const name =
              el.dataset.testid ??
              el.getAttribute('aria-label') ??
              (el.textContent ?? '').trim().slice(0, 20);
            if (t.height < 43.5) out.push(`${name} ${Math.round(t.width)}×${Math.round(t.height)}`);
            if (r.right > vw + 1 || r.left < -1) out.push(`${name} off the screen`);
          }
          return out;
        });
        if (bad.length)
          problems.push(
            `${name} ${orient}: ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? ` (+${bad.length - 8})` : ''}`,
          );
      } catch (e) {
        console.log(`${name} ${orient}: ${e.message.split('\n')[0]}`);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
}
console.log(
  problems.length
    ? `\nsmall or off the screen:\n  ${problems.join('\n  ')}`
    : '\nevery control 44 px and on the screen',
);
process.exit(0);
