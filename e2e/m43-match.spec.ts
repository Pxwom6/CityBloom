import { test, expect, type Browser, type Page } from '@playwright/test';
import { closeContextsAfterEach } from './helpers';
import { getMatch, hostMatch, joinMatch, matchPlayer, playRound, rematch, until, type Mode } from './match';

closeContextsAfterEach();

/**
 * M43, quick matches through the interface: every mode with two and with four players, online against
 * the local relay (which allows one-minute matches for tests) and over peer-to-peer. Each test is a
 * chain of rounds: the host sets up a Race on the Quick match screen, the others join by typing the
 * code, the host starts it; then from the results the host asks for a rematch in the next mode, and
 * every page reloads into a new city on the room's new seed and the next round starts by itself. Every
 * round, every page ends on the same result, and each page's own hash is the one listed for its city.
 * The four-player online chain ends with two players leaving mid-round (the host among them): they're
 * out, the match goes on, and the host's part passes on.
 */
const MODES: Mode[] = ['race', 'rich', 'happy', 'mixed'];

async function chain(
  browser: Browser,
  kind: 'online' | 'p2p',
  n: number,
  leaveInLast = false,
): Promise<void> {
  const pages: Page[] = [];
  for (let k = 0; k < n; k++) pages.push(await matchPlayer(browser, k));
  const invite = await hostMatch(pages[0]!, { kind, mode: 'race', target: 5000 });
  expect(invite.length).toBeGreaterThanOrEqual(6);
  for (const p of pages.slice(1)) await joinMatch(p, invite);
  const traffic: string[] = [];
  for (let r = 1; r <= MODES.length; r++) {
    const last = r === MODES.length;
    // (A page reloading into the next round answers nothing yet: its counters start again from 0.)
    const before = await Promise.all(pages.map((p) => getMatch(p).catch(() => null)));
    const leavers = leaveInLast && last ? [pages[0]!, pages[n - 1]!] : [];
    const { result, views } = await playRound(pages, r, {
      start: r === 1,
      leavers,
      during: leavers.length
        ? async () => {
            // A guest, then the host, leave from the pause menu: out, and the match goes on. (Both
            // before either menu has loaded: on a software renderer that takes most of a minute.)
            for (const p of [pages[n - 1]!, pages[0]!]) {
              await p.keyboard.press('Escape');
              await expect(p.getByTestId('pause-quit')).toContainText('Leave the match');
              await p.getByTestId('pause-quit').click();
            }
            for (const p of [pages[n - 1]!, pages[0]!])
              await expect(p.getByTestId('main-menu')).toBeVisible({ timeout: 120_000 });
            // The next city still in is the host now.
            await until(pages[1]!, (m) => m.host, 'the host’s part to pass on', 30_000);
          }
        : undefined,
    });
    expect(result.settings.mode).toBe(MODES[r - 1]);
    if (leavers.length) {
      expect(result.rows.filter((x) => x.out).length).toBe(2);
      // The new host can ask for a rematch.
      await expect(pages[1]!.getByTestId('match-rematch')).toBeVisible();
    }
    views.forEach((v, i) => {
      const b = before[i]?.round === r ? before[i]! : null;
      const d = (
        now: { messages: number; bytes: number },
        was?: { messages: number; bytes: number } | null,
      ) => `${now.messages - (was?.messages ?? 0)} msgs ${now.bytes - (was?.bytes ?? 0)} B`;
      traffic.push(
        `round ${r} (${MODES[r - 1]}) slot ${v.slot}: sent ${d(v.sent!, b?.sent)}, received ${d(v.received!, b?.received)}`,
      );
    });
    if (!last) await rematch(pages[0]!, MODES[r]!);
  }
  console.log(`[m43] ${kind} ×${n}\n  ${traffic.join('\n  ')}`);
}

test('online, two players: a Race, then rematches in each mode', async ({ browser }) => {
  test.setTimeout(1_500_000);
  await chain(browser, 'online', 2);
});

test('peer-to-peer, two players: every mode', async ({ browser }) => {
  test.setTimeout(1_500_000);
  await chain(browser, 'p2p', 2);
});

test('online, four players: every mode, and two leave the last round (the host among them)', async ({
  browser,
}) => {
  test.setTimeout(2_400_000);
  await chain(browser, 'online', 4, true);
});

test('peer-to-peer, four players: every mode', async ({ browser }) => {
  test.setTimeout(2_400_000);
  await chain(browser, 'p2p', 4);
});
