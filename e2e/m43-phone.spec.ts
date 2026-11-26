import { test, expect, type Page } from '@playwright/test';
import { closeContextsAfterEach } from './helpers';
import { phone, phoneProblems, type Orient } from './phone';
import { getMatch, hostMatch, joinMatch, matchPlayer, playRound, rematch, until } from './match';
import { frames } from './ui';

closeContextsAfterEach();

/**
 * M43 on phones, by touch: an iPhone and an Android phone (Playwright's emulation) play quick matches,
 * one held upright and the other sideways, then the other way round. Every screen of a match is
 * checked for what a finger needs (nothing off the screen, presses of 44 px): the Quick match screen,
 * the lobby, the scoreboard with the reactions open, a peek at the rival, and the results; the host
 * starts by a tap, a rematch is a tap, and the city is kept by a tap.
 */
async function check(p: Page, scope: string, where: string): Promise<void> {
  await frames(p, 2);
  expect(await phoneProblems(p, scope), where).toEqual([]);
}

async function shot(p: Page, name: string): Promise<void> {
  await frames(p, 2);
  // Kept for review (`docs/screenshots`), at the phone's CSS size.
  await p.screenshot({ path: `docs/screenshots/m43-${name}.png`, scale: 'css' });
}

async function phones(
  browser: Parameters<typeof matchPlayer>[0],
  host: [string, Orient],
  guest: [string, Orient],
  kind: 'online' | 'p2p',
): Promise<void> {
  const a = await matchPlayer(browser, 0, phone(host[0], host[1]));
  const b = await matchPlayer(browser, 1, phone(guest[0], guest[1]));
  const tag = (p: Page) => (p === a ? `${host[0]}-${host[1]}` : `${guest[0]}-${guest[1]}`).replace(/ /g, '');
  // The Quick match screen, by touch, on each phone.
  const invite = await hostMatch(a, { kind, mode: 'rich' }, true);
  await check(a, '[data-testid=match-lobby]', `${tag(a)} lobby`);
  await joinMatch(b, invite, true);
  await check(b, '[data-testid=match-lobby]', `${tag(b)} lobby`);
  await shot(b, `${tag(b)}-lobby`);
  const { result } = await playRound([a, b], 1, {
    start: true,
    tap: true,
    during: async () => {
      // The scoreboard with the reactions open, and a peek at the rival, on both phones.
      for (const p of [a, b]) {
        await check(p, '[data-testid=match-bar]', `${tag(p)} scoreboard`);
        await p.getByTestId('match-emote-btn').tap();
        await check(p, '[data-testid=match-bar]', `${tag(p)} reactions`);
        await p.getByTestId('match-emote-btn').tap();
        const rival = (await getMatch(p)).slot === 1 ? 2 : 1;
        await p.getByTestId(`match-chip-${rival}`).tap();
        await expect(p.getByTestId('match-peek')).toBeVisible();
        await check(p, '[data-testid=match-peek]', `${tag(p)} peek`);
        await shot(p, `${tag(p)}-peek`);
        await p.getByTestId(`match-chip-${rival}`).tap();
      }
    },
  });
  expect(result.settings.mode).toBe('rich');
  for (const p of [a, b]) {
    await check(p, '[data-testid=match-results]', `${tag(p)} results`);
    await shot(p, `${tag(p)}-results`);
  }
  // A rematch by a tap, in another mode; both phones reload into the next round.
  await rematch(a, 'mixed', true);
  const second = await playRound([a, b], 2, { tap: true });
  expect(second.result.settings.mode).toBe('mixed');
  // The guest keeps its city by a tap.
  await b.getByTestId('match-keep').tap();
  const kept = await until(b, (m) => !!m.kept, 'the city to be kept', 60_000);
  expect(kept.kept).toContain('(match)');
  await expect(b.getByTestId('match-kept')).toBeVisible();
  // And plays on with it as an ordinary city, at its own speed.
  await b.getByTestId('match-play-on').tap();
  await expect(b.getByTestId('match-results')).toBeHidden();
  await expect(b.getByTestId('speed-1')).toBeEnabled();
  await b.getByTestId('speed-1').tap();
  await expect.poll(async () => (await getMatch(b)).tick, { timeout: 60_000 }).toBeGreaterThan(1440 + 30);
}

test('an iPhone upright hosts an Android phone held sideways, online', async ({ browser }) => {
  test.setTimeout(1_200_000);
  await phones(browser, ['iPhone 13', 'portrait'], ['Pixel 7', 'landscape'], 'online');
});

test('an Android phone upright hosts an iPhone held sideways, peer-to-peer', async ({ browser }) => {
  test.setTimeout(1_200_000);
  await phones(browser, ['Pixel 7', 'portrait'], ['iPhone 13', 'landscape'], 'p2p');
});
