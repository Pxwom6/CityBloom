import { describe, expect, it } from 'vitest';
import { raid } from '../../scripts/lib/soak/story';
import { runSoak } from '../../scripts/lib/soak/run';
import type { SoakOptions } from '../../scripts/lib/soak/types';

/**
 * M39 step 10: the war soak's short version (`scripts/dev/regionsoak.ts` is the long one: two hours of
 * real time against the local relay). Four players' cities in one region at war, a region room in this
 * process over loopback links, and a clock the soak moves: the same story the long soak plays (an
 * alliance, a war that opens after its warning, live battles with orders from both sides and an ally's
 * help, a treaty, a total war, drops and reloads), faster than real time. The long soak's judges are
 * these: every live battle's two runs agree (or a disturbance explains it), every battle is taken once
 * by its defender and its force reported once, the cities' invariants hold, the room's wars, pacts and
 * vassals match each page and each city, and the room's cost is inside the free plan.
 *
 * A soak that cannot fail proves nothing, so the second test makes one fail on purpose.
 */

const options = (minutes: number): SoakOptions => ({
  minutes,
  mode: 'virtual',
  seed: 'soak',
  speed: 1,
  fairClock: false,
  disturb: true,
  story: 'full',
  log: () => undefined,
});

describe('M39 step 10: the war soak', () => {
  it('four players play the war story for a quarter of an hour of room time: no failures, and the story covers what it should', async () => {
    const { result, lines } = await runSoak(options(Number(process.env.SOAK_MINUTES ?? 15)));
    // On a failure the whole report is the message. (What the story covered is judged apart below: a story
    // that fell a battle short in a quarter of an hour is not a defect of the game.)
    const broken = result.failures.filter((f) => f.kind !== 'coverage');
    expect(broken, lines.join('\n')).toEqual([]);
    const c = result.coverage as Record<string, number>;
    expect(c.liveBattles, lines.join('\n')).toBeGreaterThanOrEqual(2);
    expect(c.orders).toBeGreaterThanOrEqual(4);
    expect(c.warsOpened).toBeGreaterThanOrEqual(1);
    expect(c.treaties).toBeGreaterThanOrEqual(1);
    expect(c.helpSent).toBeGreaterThanOrEqual(1);
    expect(c.drops! + c.outages! + c.reloads! + c.leaves!).toBeGreaterThanOrEqual(2);
    expect(result.battles.failed).toBe(0);
    expect(result.battles.unfinished).toBe(0);
    // Every live battle was taken by its defender and reported by its attacker (once each: the soak fails
    // on a second), but for those a disturbance explains (a city that was away at the end takes it later).
    const owed = result.battles.live - result.battles.explained;
    expect(result.applications.liveTakenByDefender).toBeGreaterThanOrEqual(owed);
    expect(result.applications.reported).toBeGreaterThanOrEqual(owed);
    expect(result.budget.ok).toBe(true);
  }, 420_000);

  it('catches a battle whose attacker’s run was fed an order the room never stamped', async () => {
    let ran = false;
    const { result } = await runSoak(
      { ...options(4), disturb: false, story: 'short' },
      {
        // One raid, no war: the attacker's page runs the battle, and a second after it begins its run
        // is given a withdrawal of its own that the room (and the defender's city) never hear of.
        story: async (w) => {
          await raid(w, w.player('Ada'), w.player('Sam'));
        },
        before: (w) => {
          w.onBattle = (b) =>
            w.later(10_000, () => {
              const page = w.bySlot(b.attacker)?.page;
              const run = page?.runs.at(-1)?.run;
              if (!run || run.done) return;
              run.input.orders.push({ step: run.step + 4, side: 0, kind: 'withdraw' });
              ran = true;
            });
        },
      },
    );
    expect(ran).toBe(true);
    expect(result.failures.map((f) => f.kind)).toContain('desync');
    expect(result.battles.failed).toBeGreaterThanOrEqual(1);
  }, 180_000);
});
