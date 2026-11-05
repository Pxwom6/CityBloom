import { test, expect, type Page } from '@playwright/test';
import { webSocketLink } from '../src/net/link';
import { friendsPage } from '../tests/war/friendsHarness';
import { armSam, liveTown } from '../tests/war/liveTown';
import { armTown, servedTown } from './war';

/**
 * M39 polish: the way into war with friends on a phone held upright and on a tablet, by touch. The
 * lobby's region ways (starting a region, the code to join one), the new-city screen's war switch, the
 * Region panel's invite and war switch, and the war room: every tab, and the Diplomacy tab's Friends
 * block with a friend's proposal, a declared war and the terms builder (the friend is a headless page
 * of the test's own, joined by the region's code). Nothing runs off the side of the window, everything
 * can be scrolled into reach and tapped, and every tap target is at least 24 px.
 */
// (A tap that can't land, with the button off the window, fails in half a minute and says so.)
test.use({ hasTouch: true, isMobile: false, actionTimeout: 30_000 });

const RELAY = process.env.E2E_RELAY_URL ?? 'ws://127.0.0.1:8787';

/**
 * What is wrong with the layout inside `scope`: anything wider than the window (outside a part that
 * scrolls sideways on purpose), and every control that can't be scrolled into the window, is covered
 * where a finger would land, or is under 24 px to tap. A checkbox or radio is tapped by its label.
 */
async function layoutProblems(page: Page, scope: string): Promise<string[]> {
  return page.evaluate((scope) => {
    const root = document.querySelector<HTMLElement>(`[data-testid="${scope}"]`);
    if (!root) return [`no ${scope} on the page`];
    const bad: string[] = [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const name = (el: Element) =>
      (el as HTMLElement).dataset.testid ??
      el.getAttribute('aria-label') ??
      `${el.tagName.toLowerCase()} “${(el.textContent ?? '').trim().slice(0, 28)}”`;
    const px = (n: number) => Math.round(n);
    if (document.documentElement.scrollWidth > vw + 1)
      bad.push(`the page scrolls sideways: ${document.documentElement.scrollWidth} px wide in ${vw}`);
    // Is the element inside a part that scrolls sideways on purpose (below `root`)?
    const scrollsSideways = (el: Element) => {
      for (let p = el.parentElement; p && p !== root.parentElement; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
      }
      return false;
    };
    for (const el of root.querySelectorAll<HTMLElement>('*')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if ((r.right > vw + 1 || r.left < -1) && !scrollsSideways(el))
        bad.push(`${name(el)} runs off the ${vw} px window (${px(r.left)}..${px(r.right)})`);
    }
    const controls = root.querySelectorAll<HTMLElement>(
      'button, select, summary, a[href], input:not([type=hidden]), [role=tab], [role=radio]',
    );
    for (const el of controls) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const box =
        el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')
          ? (el.closest('label') ?? el)
          : el;
      if (box.getBoundingClientRect().width === 0 && box.getBoundingClientRect().height === 0) continue;
      box.scrollIntoView({ block: 'center', inline: 'center' });
      const r = box.getBoundingClientRect();
      const at = `${px(r.left)}..${px(r.right)} x ${px(r.top)}..${px(r.bottom)}`;
      if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1) {
        bad.push(`${name(el)} can’t be brought into the ${vw}x${vh} window (${at})`);
        continue;
      }
      if (r.width < 24 || r.height < 24)
        bad.push(`${name(el)} is only ${px(r.width)}x${px(r.height)} px to tap`);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === box || box.contains(hit)))
        bad.push(`${name(el)} is covered by ${hit?.tagName}.${hit?.className} (${at})`);
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-scrolled]')) delete el.dataset.scrolled;
    return bad;
  }, scope);
}

/** A milestone card the town's growth brings sits over the top bar for a while: a tap dismisses it. */
async function dismissMilestone(page: Page): Promise<void> {
  const banner = page.getByTestId('milestone-banner');
  if (!(await banner.isVisible().catch(() => false))) return;
  // (It slides in and goes by itself too: a tap that finds it moving or gone is no failure.)
  await banner.tap({ timeout: 5_000 }).catch(() => undefined);
  await expect(banner).toBeHidden({ timeout: 30_000 });
}

/** Open a panel's button from the top bar: where the bar has folded it into the More menu, through that. */
async function fromTopBar(page: Page, testid: string): Promise<void> {
  await dismissMilestone(page);
  const button = page.getByTestId(testid);
  if (!(await button.isVisible())) {
    await page.getByTestId('open-more').tap();
    await expect(button).toBeVisible();
    // The menu is inside the window with every button of it (it once ran off the left edge of a phone).
    expect.soft(await layoutProblems(page, 'topbar'), 'the top bar with its More menu open').toEqual([]);
  }
  await button.tap();
}

const shot = async (page: Page, name: string) => {
  await page.evaluate(() => window.__game?.waitFrames(2));
  await page.screenshot({ path: `docs/screenshots/m39-narrow-${name}.png` });
};

/** A tap on this VM's software renderer is now and then lost under load: tap again until `done` holds. */
async function tapUntil(page: Page, testid: string, done: () => Promise<void>): Promise<void> {
  await expect(async () => {
    await page.getByTestId(testid).tap();
    await done();
  }).toPass({ timeout: 30_000 });
}

for (const [label, size] of [
  ['phone', { width: 390, height: 844 }],
  ['tablet', { width: 820, height: 1180 }],
] as const) {
  test(`M39: the lobby, the region’s war switch and the war room with a friend on a ${label}`, async ({
    page,
  }) => {
    test.setTimeout(1_800_000);
    await page.setViewportSize(size);
    await page.addInitScript(() => {
      localStorage.setItem('citybloom.player', JSON.stringify({ name: 'Fay', color: 3 }));
      // The spec builds and arms by fast-forwarding, far past the region's 1× clock.
      localStorage.setItem('citybloom.fairClock', 'off');
      const key = 'citybloom.settings';
      const s = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
      localStorage.setItem(key, JSON.stringify({ ...s, tips: false, graphicsChecked: true, quality: 'low' }));
    });
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.goto('./');
    await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });

    // --- The lobby: its region ways. ---
    await page.getByTestId('main-friends').tap();
    await expect(page.getByTestId('friends-screen')).toBeVisible();
    await page.getByTestId('friends-region-start').scrollIntoViewIfNeeded();
    expect.soft(await layoutProblems(page, 'friends-screen'), 'the lobby').toEqual([]);
    await shot(page, `lobby-${label}`);
    // A bad code to join a region says so plainly, beside the box.
    await page.getByTestId('friends-region-code').fill('ab');
    await page.getByTestId('friends-region-join').tap();
    await expect(page.getByRole('alert').last()).toBeVisible();
    expect.soft(await layoutProblems(page, 'friends-screen'), 'the lobby with a problem shown').toEqual([]);

    // --- Starting a region: the new-city screen has the war switch, with its scale. ---
    await page.getByTestId('friends-region-start').tap();
    await expect(page.getByTestId('new-game')).toBeVisible();
    await page.getByTestId('new-region-war').check();
    await expect(page.getByTestId('new-region-scale-war')).toBeVisible();
    await page.getByTestId('new-region-scale-war').tap();
    await page.getByTestId('new-name').fill('Fayton');
    // (No tutorial card over the city: this spec is about the way into war.)
    await page.getByTestId('new-tutorial').uncheck();
    expect
      .soft(await layoutProblems(page, 'new-game'), 'the new city screen with the region’s war switch')
      .toEqual([]);
    await shot(page, `new-city-${label}`);
    await page.getByTestId('new-start').scrollIntoViewIfNeeded();
    await page.getByTestId('new-start').tap();
    await page.waitForFunction(
      () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
      null,
      { timeout: 120_000 },
    );
    await expect
      .poll(async () => (await page.evaluate(() => window.__game!.getRegion()))?.state, { timeout: 120_000 })
      .toBe('in');
    await expect
      .poll(async () => (await page.evaluate(() => window.__game!.getRegion()))?.rules, { timeout: 30_000 })
      .toMatchObject({ war: true, scale: 'war' });
    await page.evaluate(() => window.__game!.setSpeed(0));

    // --- The Region panel: the invite, and the war switch (the host's). ---
    await fromTopBar(page, 'open-region');
    await expect(page.getByTestId('region-panel')).toBeVisible();
    await expect(page.getByTestId('region-invite')).toBeVisible();
    await page.getByTestId('region-war-on').scrollIntoViewIfNeeded();
    expect.soft(await layoutProblems(page, 'region-panel'), 'the Region panel with war on').toEqual([]);
    await shot(page, `region-${label}`);
    await page.getByTestId('region-panel').getByRole('button', { name: 'Close' }).first().tap();
    await expect(page.getByTestId('region-panel')).toHaveCount(0);

    // --- A town with an HQ, so there is a war room; a friend joins the region by its code. ---
    await servedTown(page);
    await armTown(page, ['militaryhq']);
    const code = (await page.evaluate(() => window.__game!.getRegion()))!.code;
    const me = (await page.evaluate(() => window.__game!.getRegion()))!.slot;
    const clock = { now: () => Date.now(), advance: () => undefined };
    const samTown = liveTown('narrow-sam', 'Samford');
    const sam = await friendsPage(
      {
        connect: () => webSocketLink(`${RELAY}/region/${code}`),
        clock,
        sim: samTown.sim,
        mayor: 'Sam',
        color: 1,
      },
      clock,
    );
    try {
      armSam(samTown);
      const known = () =>
        page.evaluate(() => !!window.__game!.getRegion()?.cities.some((c) => c.name === 'Samford'));
      const t0 = Date.now();
      while (!(await known())) {
        if (Date.now() - t0 > 90_000) throw new Error('Fay’s page never heard of Samford');
        await sam.link.reportNow(true);
        await page.evaluate(() => window.__game!.regionReportNow());
        sam.frames();
        await page.waitForTimeout(500);
      }
      const knowsFay = () =>
        sam.sim.state.region.neighbours.some((n) => n.player?.slot === me) &&
        sam.fw.view().me === sam.link.slot;
      const t1 = Date.now();
      while (!knowsFay()) {
        if (Date.now() - t1 > 90_000) throw new Error('Samford’s page never heard of Fay');
        await sam.link.reportNow(true);
        await page.evaluate(() => window.__game!.regionReportNow());
        sam.frames();
        sam.fw.pump();
        await page.waitForTimeout(500);
      }

      // --- The war room: every tab, nothing off the side, everything in reach. ---
      await fromTopBar(page, 'open-war');
      await expect(page.getByTestId('war-room')).toBeVisible();
      for (const tab of [
        'forces',
        'send',
        'map',
        'research',
        'intel',
        'diplomacy',
        'trade',
        'economy',
        'readiness',
        'reports',
      ]) {
        await page.getByTestId(`war-tab-${tab}`).scrollIntoViewIfNeeded();
        await tapUntil(page, `war-tab-${tab}`, () =>
          // (The Map tab's picture has the same id as its tab: the tab's own is the first.)
          expect(page.getByTestId(`war-${tab}`).first()).toBeVisible({ timeout: 3_000 }),
        );
        expect.soft(await layoutProblems(page, 'war-room'), `the war room’s ${tab} tab`).toEqual([]);
        if (['send', 'map', 'trade'].includes(tab)) await shot(page, `war-${tab}-${label}`);
      }

      // --- The Diplomacy tab's Friends block: a friend's proposal, then a declared war, then the builder. ---
      await page.getByTestId('war-tab-diplomacy').tap();
      await expect(page.getByTestId('dip-friends')).toBeVisible();
      const samSlot = sam.link.slot;
      await expect(page.getByTestId(`dip-friend-${samSlot}`)).toContainText('Samford');
      expect.soft(await layoutProblems(page, 'war-room'), 'Friends block with a friend').toEqual([]);
      const offered = sam.fw.propose(me, [{ k: 'nonAggression', months: 24 }, { k: 'trade' }]);
      expect(offered.sent).toBe(true);
      const proposal = page.locator('[data-testid^="dip-fproposal-"]');
      await expect
        .poll(
          async () => {
            sam.fw.pump();
            return proposal.count();
          },
          { timeout: 60_000, intervals: [1_000] },
        )
        .toBe(1);
      await expect(proposal).toContainText('Samford');
      expect.soft(await layoutProblems(page, 'war-room'), 'a friend’s proposal').toEqual([]);
      await proposal.scrollIntoViewIfNeeded();
      await shot(page, `proposal-${label}`);
      await proposal.locator('[data-testid^="dip-fdecline-"]').tap();
      await expect(proposal).toHaveCount(0, { timeout: 30_000 });

      // Samford is a newcomer: Declare war… is off, and says until when (the spec lifts its shield next).
      await expect(page.getByTestId(`dip-fdeclare-${samSlot}`)).toBeDisabled();
      await expect(page.getByTestId(`dip-fwhy-declare-${samSlot}`)).toContainText(
        'protected as a newcomer until it has 3,000 residents',
      );
      expect.soft(await layoutProblems(page, 'war-room'), 'a refusal beside Declare war…').toEqual([]);
      expect(samTown.sim.dispatch({ type: 'cheat', cheat: 'unshield' }).ok).toBe(true);
      await expect
        .poll(
          async () => {
            await sam.link.reportNow(true);
            await page.evaluate(() => window.__game!.regionReportNow());
            return page.getByTestId(`dip-fdeclare-${samSlot}`).isEnabled();
          },
          { timeout: 90_000, intervals: [2_000] },
        )
        .toBe(true);

      // The declare form (Fay's), then Samford's war on Fay: the card with its countdown.
      await page.getByTestId(`dip-fdeclare-${samSlot}`).tap();
      await expect(page.getByTestId('dip-fdeclare-form')).toBeVisible();
      await page.getByTestId('dip-freason').fill('The river is ours');
      expect.soft(await layoutProblems(page, 'war-room'), 'the declare form').toEqual([]);
      await page.getByTestId('dip-fdeclare-form').scrollIntoViewIfNeeded();
      await shot(page, `declare-${label}`);
      await page.getByTestId(`dip-fdeclare-${samSlot}`).tap();
      await expect(page.getByTestId('dip-fdeclare-form')).toHaveCount(0);
      // Fay is a newcomer too, which Samford can't declare on until it strikes first: lifted for the spec.
      await page.evaluate(async () => {
        const r = await window.__game!.dispatch({ type: 'cheat', cheat: 'unshield' });
        if (!r.ok) throw new Error(r.reason);
        await window.__game!.regionReportNow();
      });
      expect(sam.fw.declare(me, 'war', 'Their bridge is in our way')).toBe(true);
      await expect(page.getByTestId(`dip-fwar-${samSlot}`)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId(`dip-fwar-text-${samSlot}`)).toContainText('It opens in');
      expect.soft(await layoutProblems(page, 'war-room'), 'a declared war').toEqual([]);
      await page.getByTestId(`dip-fwar-${samSlot}`).scrollIntoViewIfNeeded();
      await shot(page, `war-card-${label}`);

      // The terms builder with several terms (peace is there; add a ceasefire-free set of money terms).
      await page.getByTestId(`dip-fpropose-${samSlot}`).tap();
      await expect(page.getByTestId('dip-fbuilder')).toBeVisible();
      for (const kind of ['reparations', 'tribute']) {
        await page.getByTestId('dip-fterm-kind').selectOption(kind);
        await page.getByTestId('dip-fterm-add').tap();
      }
      await expect(page.getByTestId('dip-fterm-0')).toBeVisible();
      expect.soft(await layoutProblems(page, 'war-room'), 'the terms builder with three terms').toEqual([]);
      await page.getByTestId('dip-fbuilder').scrollIntoViewIfNeeded();
      await shot(page, `builder-${label}`);
      await page.getByTestId('dip-fbuilder').getByRole('button', { name: 'Cancel' }).tap();
      await expect(page.getByTestId('dip-fbuilder')).toHaveCount(0);
    } finally {
      sam.link.leave();
    }
    expect(errors.filter((e) => !/ERR_CONNECTION|WebSocket|relay/i.test(e))).toEqual([]);
  });
}
