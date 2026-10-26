import { test, expect, type Page } from '@playwright/test';
import { openGame, shot } from './helpers';
import { Lockstep, type Stamped } from '../src/sim/lockstep';
import type { Command } from '../src/sim/commands';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { growTown, newTown } from '../tests/lockstep/scriptedTown';

/**
 * M29, same city everywhere: two real game pages, each a player of a shared city whose worker is
 * fed the same stamped commands (no network yet; the test is the room). Both run to the tick the
 * room allows, never dropping one, and their hourly checksums match each other and Node's.
 */
const MONTHS = 3;

/**
 * The town's stamped commands, Node's reference run of them and its checksum at the end of every
 * game hour. The runner keeps only the latest 48 hours' checksums, so the reference is stepped an
 * hour at a time and each one copied out as it comes.
 */
function record(): { events: Stamped[]; ref: Lockstep; sums: Map<number, string> } {
  const events: Stamped[] = [];
  let seq = 0;
  growTown(
    MONTHS,
    () => {},
    (s, cmd) => {
      // Alternate the two players, as if both were building.
      const by = 1 + (seq % 2);
      events.push({
        tick: s.tick,
        seq: seq++,
        ev: { kind: 'cmd', cmd: JSON.parse(JSON.stringify(cmd)) as Command, by },
      });
      return s.dispatch(cmd, by);
    },
    true,
  );
  const ref = new Lockstep(newTown(true));
  for (const e of events) ref.push(structuredClone(e));
  const sums = new Map<number, string>();
  for (let t = TICKS_PER_HOUR; t <= MONTHS * TICKS_PER_MONTH; t += TICKS_PER_HOUR) {
    ref.allow(t);
    ref.run();
    sums.set(t, ref.checksums.get(t)!);
  }
  return { events, ref, sums };
}

const QUERY = '&seed=lockstep&preset=river&sandbox=1&disasters=1&elections=1&name=Stepford';

async function state(page: Page) {
  return page.evaluate(() => window.__game!.lockstepState());
}

test('two players fed the same stamped commands stay in step with each other and Node', async ({
  browser,
}) => {
  // Two 3D pages on a software renderer, as the other two-page specs allow.
  test.setTimeout(420_000);
  const { events, ref, sums } = record();
  expect(sums.size).toBe(MONTHS * 24);
  const pages: Page[] = [];
  for (let p = 1; p <= 2; p++) {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 600 } });
    const page = await ctx.newPage();
    await openGame(page, QUERY);
    await page.evaluate((player) => window.__game!.lockstepShare(player), p);
    pages.push(page);
  }
  // The room releases the town a month at a time, in two uneven batches per page.
  for (let m = 1; m <= MONTHS; m++) {
    const allow = m * TICKS_PER_MONTH;
    const batch = events.filter((e) => e.tick >= allow - TICKS_PER_MONTH && e.tick < allow);
    for (const page of pages) {
      await page.evaluate(([b, a]) => window.__game!.lockstepFeed(b, a - 500), [batch, allow] as const);
      await page.evaluate(([a]) => window.__game!.lockstepFeed([], a), [allow] as const);
    }
    for (const page of pages)
      await expect
        .poll(
          async () => {
            const st = await state(page);
            return st.behind === 0 ? st.tick : -1;
          },
          { timeout: 60_000 },
        )
        .toBe(allow);
  }
  const [a, b] = await Promise.all(pages.map(state));
  expect(a!.late).toBe(0);
  expect(b!.late).toBe(0);
  expect(a!.applied).toBe(events.length);
  expect(a!.checksums.length).toBe(MONTHS * 24);
  expect(b!.checksums).toEqual(a!.checksums);
  // Every hour, from the first: the pages' checksums are Node's.
  expect(a!.checksums.map(([tick]) => tick)).toEqual([...sums.keys()]);
  for (const [tick, sum] of a!.checksums) expect(sum, `hour ending ${tick}`).toBe(sums.get(tick));
  const hw = ref.sim.state.net.nodes.get(ref.sim.state.highway.connect)!;
  const pose = { x: hw.x + 260, z: hw.z + 60, distance: 560, yaw: 0.4 };
  for (const [i, page] of pages.entries()) {
    await page.evaluate((p) => window.__game!.setCamera(p), pose);
    await shot(page, `m29-lockstep-player${i + 1}`);
  }
  for (const page of pages) await page.context().close();
});
