import { devices, expect, type Page } from '@playwright/test';
import { frames, screen, settledHint } from './ui';

/**
 * Phones (M49): Playwright's phone profiles for Chromium (their WebKit default dropped: the suite runs
 * in Chromium), upright or sideways, and real touches through Chrome's input pipeline.
 */
export type Orient = 'portrait' | 'landscape';

/** A phone profile (`iPhone 13`, `Pixel 7`) held upright or sideways, to pass to `test.use`. */
export function phone(name: string, orient: Orient) {
  const { defaultBrowserType: _browser, viewport, ...rest } = devices[name]!;
  return {
    ...rest,
    viewport: orient === 'landscape' ? { width: viewport.height, height: viewport.width } : viewport,
  };
}

type Pt = { x: number; y: number };

/** Fingers on the screen, as CDP touch events (they arrive as pointer events of type 'touch'). */
export async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: (Pt & { id: number })[]) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map((p) => ({ x: p.x, y: p.y, id: p.id, radiusX: 3, radiusY: 3, force: 1 })),
    });
  const lerp = (a: Pt, b: Pt, t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  return {
    async tap(p: Pt) {
      await send('touchStart', [{ ...p, id: 1 }]);
      await send('touchEnd', []);
    },
    /** One finger held still for `ms` (a long press is half a second). */
    async hold(p: Pt, ms = 800) {
      await send('touchStart', [{ ...p, id: 1 }]);
      await page.waitForTimeout(ms);
      await send('touchEnd', []);
    },
    /** One finger along the points, `steps` moves between each. */
    async drag(points: Pt[], steps = 6) {
      await send('touchStart', [{ ...points[0]!, id: 1 }]);
      for (let i = 1; i < points.length; i++)
        for (let k = 1; k <= steps; k++)
          await send('touchMove', [{ ...lerp(points[i - 1]!, points[i]!, k / steps), id: 1 }]);
      await send('touchEnd', []);
    },
    /** Two fingers from `a0`, `b0` to `a1`, `b1` together (a pinch, a twist or a two-finger slide). */
    async two(a0: Pt, b0: Pt, a1: Pt, b1: Pt, steps = 8) {
      await send('touchStart', [{ ...a0, id: 1 }]);
      await send('touchStart', [
        { ...a0, id: 1 },
        { ...b0, id: 2 },
      ]);
      for (let k = 1; k <= steps; k++)
        await send('touchMove', [
          { ...lerp(a0, a1, k / steps), id: 1 },
          { ...lerp(b0, b1, k / steps), id: 2 },
        ]);
      await send('touchEnd', [{ ...a1, id: 1 }]);
      await send('touchEnd', []);
    },
  };
}
export type Fingers = Awaited<ReturnType<typeof fingers>>;

/** Is the screen point free of the interface (so a tap there lands on the map)? */
export async function onMap(page: Page, p: Pt): Promise<boolean> {
  return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'CANVAS', p);
}

/**
 * The first of the spots where the tool that's out would build, found as a phone player does: hold
 * a finger on it (a long press shows what the tool would do there, as hovering does with a mouse)
 * and read the hint. Spots hidden under the interface are skipped.
 */
export async function holdForSpot(page: Page, f: Fingers, spots: [number, number][], what: string) {
  const seen: string[] = [];
  for (const [x, z] of spots) {
    const p = await screen(page, x, z);
    if (!(await onMap(page, p))) {
      seen.push(`${x},${z}: under the interface`);
      continue;
    }
    await f.hold(p);
    const h = await settledHint(page);
    seen.push(`${x},${z}: ${h.tone} ${h.text}`);
    if (/\bok\b/.test(h.tone) && !h.text.includes('replaces')) return p;
  }
  expect(null, `nowhere for ${what}:\n${seen.join('\n')}`).not.toBeNull();
  return null as never;
}

/** Tap a building of the toolbar's Build sheet (the phone bar's Build, a category, then the building). */
export async function pickBuilding(page: Page, category: string, def: string): Promise<void> {
  await page.getByTestId('tool-build').tap();
  await expect(page.getByTestId('build-sheet')).toBeVisible();
  await page.getByTestId(`tool-${category}`).tap();
  await expect(page.getByTestId('place-options')).toBeVisible();
  await page.getByTestId(`place-${def}`).tap();
  await frames(page);
}

/** What on the page a finger couldn't use: controls under 44 px, or anything running off the screen. */
export async function phoneProblems(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const root = document.querySelector<HTMLElement>(scope);
    if (!root) return [`nothing matches ${scope}`];
    const bad: string[] = [];
    const vw = innerWidth;
    const name = (el: Element) =>
      (el as HTMLElement).dataset.testid ??
      el.getAttribute('aria-label') ??
      `${el.tagName.toLowerCase()} “${(el.textContent ?? '').trim().slice(0, 24)}”`;
    if (document.documentElement.scrollWidth > vw + 1) bad.push(`the page scrolls sideways`);
    const sideways = (el: Element) => {
      for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    for (const el of root.querySelectorAll<HTMLElement>(
      'button, select, input:not([type=hidden]), [role=tab]',
    )) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || el.closest('[hidden]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      if ((r.right > vw + 1 || r.left < -1) && !sideways(el)) bad.push(`${name(el)} runs off the screen`);
      // A checkbox or radio is pressed by its label.
      const target =
        (el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio'
          ? (el.closest('label') ?? el)
          : el;
      const t = target.getBoundingClientRect();
      if (Math.min(t.height, Math.max(t.width, 44)) < 43.5)
        bad.push(`${name(el)} is ${Math.round(t.width)}×${Math.round(t.height)} px`);
    }
    return bad;
  }, scope);
}

/** A picture for docs/screenshots at the phone's CSS size (a phone's 3× pixels would be ten times the file). */
export async function phoneShot(page: Page, name: string): Promise<void> {
  await frames(page, 2);
  await page.screenshot({ path: `docs/screenshots/${name}.png`, scale: 'css' });
}
