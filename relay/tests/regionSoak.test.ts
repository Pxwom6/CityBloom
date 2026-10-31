import { describe, expect, it } from 'vitest';
import { propose, raid } from '../../scripts/lib/soak/story';
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
    // on a second), but for those the run itself excuses (a battle nobody finished, a crash's loss: listed).
    const owed = result.battles.live - result.applications.excused;
    expect(result.applications.liveTakenByDefender).toBeGreaterThanOrEqual(owed);
    // (An attacker who left in the middle has its force called home, the region having turned the battle away.)
    expect(result.applications.reported + result.applications.recalled).toBeGreaterThanOrEqual(owed);
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

  it('catches a city that is told of a treaty and a pact and drops both (the page shows them, the sim never holds them)', async () => {
    const { result, lines } = await runSoak(
      { ...options(3), disturb: false, story: 'short' },
      {
        // Sam's sim says yes to every treaty and every list of pacts and does nothing with either; Kit's works.
        before: (w) => {
          w.onBuilt = () => {
            const sim = w.player('Sam').sim;
            const dispatch = sim.dispatch.bind(sim);
            sim.dispatch = ((cmd: Parameters<typeof dispatch>[0]) =>
              cmd.type === 'friendPacts' || cmd.type === 'friendTreaty'
                ? { ok: true }
                : dispatch(cmd)) as typeof dispatch;
          };
        },
        story: async (w) => {
          const kit = w.player('Kit');
          const sam = w.player('Sam');
          await w.wait(8_000);
          // An alliance, and a treaty with money in it, both signed; then a minute for the difference to show.
          await propose(w, kit, sam, [{ k: 'alliance' }], () => false, 20_000);
          await propose(
            w,
            kit,
            sam,
            [
              { k: 'nonAggression', months: 2 },
              { k: 'reparations', payer: 'them', amount: 900 },
            ],
            () => false,
            20_000,
          );
          await w.wait(70_000);
        },
      },
    );
    const kinds = new Set(result.failures.map((f) => f.kind));
    expect(kinds, lines.join('\n')).toContain('region'); // the pact the room keeps and Sam's sim lacks
    expect(kinds).toContain('treaty-not-applied');
    expect(kinds).toContain('treaty-money');
    expect(result.failures.find((f) => f.kind === 'region')!.text).toMatch(/Sam's city holds pacts \[\]/);
  }, 240_000);

  it('brings a player who is away when the time runs out back before the final checks', async () => {
    let comebackAfterTimeUp = false;
    const { soak, result } = await runSoak(
      { ...options(3), disturb: false, story: 'short' },
      {
        // Lou leaves for ten minutes a minute in; the run lasts three.
        story: async (w) => {
          await w.wait(60_000);
          await w.away(w.player('Lou'), 10 * 60_000);
          await w.wait(10 * 60_000);
        },
        before: (w) => {
          const note = w.note.bind(w);
          let over = false;
          w.note = (text) => {
            if (/time is up/.test(text)) over = true;
            if (over && /Lou comes back/.test(text)) comebackAfterTimeUp = true;
            note(text);
          };
        },
      },
    );
    expect(soak.player('Lou').page).not.toBeNull();
    expect(comebackAfterTimeUp).toBe(true);
    expect(result.failures.filter((f) => f.kind === 'away-at-end')).toEqual([]);
  }, 240_000);
});
