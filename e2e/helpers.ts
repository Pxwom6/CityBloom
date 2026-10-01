import { expect, type Page } from '@playwright/test';

/** Collects console errors and unhandled rejections; call `check()` at the end of a test. */
export function watchErrors(page: Page): { errors: string[]; check: () => void } {
  const errors: string[] = [];
  // Where each page error was thrown, for the failure message.
  const stacks: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => {
    errors.push(`pageerror: ${e.message}`);
    stacks.push(e.stack ?? '');
  });
  return {
    errors,
    check: () => expect(errors, [...errors, ...stacks].join('\n')).toEqual([]),
  };
}

/**
 * Mark the first-launch graphics check as done, so a test that starts at the main menu keeps the
 * default (high) graphics for its screenshots; m15-publish tests the check itself.
 */
export async function skipGraphicsCheck(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, graphicsChecked: true }));
  });
}

export async function openGame(page: Page, query = ''): Promise<void> {
  // Contextual tips are for new players; keep them out of these scripted towns and their screenshots
  // (m11-shell checks them). Merge, so other settings still persist across reloads.
  await page.addInitScript(() => {
    const key = 'citybloom.settings';
    const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(key, JSON.stringify({ ...s, tips: false }));
  });
  await page.goto(`./?paused=1${query}`);
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  await page.evaluate(() => window.__game!.waitFrames(2));
}

export async function shot(page: Page, name: string): Promise<void> {
  await page.evaluate(() => window.__game!.waitFrames(2));
  await page.screenshot({ path: `docs/screenshots/${name}.png` });
}

/** Same planned town as tests/helpers.ts `buildTown`, dispatched through the test API. */
export async function buildTownViaApi(page: Page, len = 480, streets = 4): Promise<void> {
  await page.evaluate(
    async ([len, streets]) => {
      const g = window.__game!;
      const s = await g.getState();
      const c = { x: 24, z: s.highwayZ };
      const ok = async (cmd: Parameters<typeof g.dispatch>[0]) => {
        const r = await g.dispatch(cmd);
        if (!r.ok) throw new Error(`${cmd.type} failed: ${r.reason}`);
      };
      await ok({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + len!, z: c.z }] });
      for (let k = 1; k <= streets!; k++) {
        const x = c.x + (len! * k) / (streets! + 1);
        await ok({
          type: 'buildRoad',
          road: 'street',
          points: [
            { x, z: c.z - 160 },
            { x, z: c.z + 160 },
          ],
        });
      }
      const brush = (
        zone: 'R' | 'C' | 'I',
        a: { x: number; z: number },
        b: { x: number; z: number },
        radius: number,
      ) => ok({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
      await brush('R', { x: c.x + 20, z: c.z - 100 }, { x: c.x + len!, z: c.z - 100 }, 70);
      await brush('C', { x: c.x + 20, z: c.z + 20 }, { x: c.x + len!, z: c.z + 20 }, 22);
      await brush('R', { x: c.x + 20, z: c.z + 90 }, { x: c.x + len! / 2, z: c.z + 90 }, 50);
      await brush('I', { x: c.x + len! / 2 + 20, z: c.z + 110 }, { x: c.x + len!, z: c.z + 110 }, 50);
    },
    [len, streets],
  );
}

/** Power, water, sewage and garbage for the planned town (via the test API). */
export async function serveTownViaApi(page: Page): Promise<void> {
  const ok = await page.evaluate(async () => {
    const g = window.__game!;
    await g.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    await g.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 80_000 });
    const s = await g.getState();
    const near = { x: 300, z: s.highwayZ + 170 };
    const ids = [];
    for (const def of ['coal', 'pump', 'pump', 'treatment', 'landfill'])
      ids.push(await g.placeCivic(def, near));
    return ids.every((x) => x !== null);
  });
  expect(ok).toBe(true);
}

/**
 * Every visible button (or link, or role=button) must say what it does: an accessible name (its
 * text, aria-label, aria-labelledby or title), and any text it shows must be readable against
 * whatever is behind it (contrast at least 3:1; disabled buttons are exempt from contrast).
 * Returns one line per problem, prefixed with `where`.
 */
export async function auditButtons(page: Page, where: string): Promise<string[]> {
  // Let colour transitions (a button turning active or danger under the mouse) finish first.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a instanceof CSSTransition)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const rgba = (c: string): [number, number, number, number] => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const p = m[1]!
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      return [p[0]!, p[1]!, p[2]!, p.length > 3 ? p[3]! : 1];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    // The colour behind an element: its own background or the nearest ancestor's, with any
    // translucent layers composited over white (the canvas behind the UI is mostly light).
    const backdrop = (el: Element): number[] => {
      const layers: number[][] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const st = getComputedStyle(e);
        // A gradient counts as an opaque layer of its average colour.
        const stops = [...st.backgroundImage.matchAll(/rgba?\([^)]+\)/g)].map((m) => rgba(m[0]));
        if (stops.length) {
          layers.push([0, 1, 2].map((i) => stops.reduce((t, c) => t + c[i]!, 0) / stops.length).concat(1));
          break;
        }
        const c = rgba(st.backgroundColor);
        if (c[3] > 0) layers.push(c);
        if (c[3] >= 1) break;
      }
      let col = [255, 255, 255];
      for (const [r, g, b, a] of layers.reverse())
        col = [r! * a! + col[0]! * (1 - a!), g! * a! + col[1]! * (1 - a!), b! * a! + col[2]! * (1 - a!)];
      return col;
    };
    const visibleText = (el: Element): string => {
      let t = '';
      const walk = (n: Node) => {
        if (n.nodeType === Node.TEXT_NODE) t += n.textContent ?? '';
        else if (n instanceof Element && n.getAttribute('aria-hidden') !== 'true') n.childNodes.forEach(walk);
      };
      walk(el);
      return t.replace(/\s+/g, ' ').trim();
    };
    const nameOf = (el: Element): string => {
      const label = el.getAttribute('aria-label');
      if (label?.trim()) return label.trim();
      const by = el.getAttribute('aria-labelledby');
      if (by) {
        const t = by
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (t) return t;
      }
      const text = visibleText(el);
      if (text) return text;
      const img = el.querySelector('img[alt], svg title');
      const alt = img?.getAttribute('alt') ?? img?.textContent ?? '';
      if (alt.trim()) return alt.trim();
      return el.getAttribute('title')?.trim() ?? '';
    };
    const describe = (el: Element) => {
      const id = el.getAttribute('data-testid');
      return id
        ? `[data-testid=${id}]`
        : `<${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}">`;
    };
    const els = document.querySelectorAll(
      'button, [role="button"], a[href], input[type="button"], input[type="submit"]',
    );
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
      const name = nameOf(el);
      if (!name) {
        out.push(`${describe(el)} has no label or accessible name`);
        continue;
      }
      if ((el as HTMLButtonElement).disabled) continue;
      // Each run of text is checked against its own element's colour and background (a badge
      // inside a button has its own).
      const runs = new Set<Element>();
      const collect = (n: Node) => {
        if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim() && n.parentElement)
          runs.add(n.parentElement);
        else if (n instanceof Element && n.getAttribute('aria-hidden') !== 'true')
          n.childNodes.forEach(collect);
      };
      collect(el);
      for (const run of runs) {
        const cs = getComputedStyle(run);
        const fg = rgba(cs.color);
        const bg = backdrop(run);
        const shown = [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3]));
        const [a, b] = [lum(shown), lum(bg)];
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < 3) {
          const text = (run.textContent ?? '').replace(/\s+/g, ' ').trim();
          out.push(
            `${describe(el)} "${text}" is unreadable: contrast ${ratio.toFixed(2)}:1 (${cs.color} on rgb(${bg.map(Math.round).join(', ')}))`,
          );
          break;
        }
      }
    }
    return out;
  });
  return problems.map((p) => `${where}: ${p}`);
}
