import { describe, expect, it } from 'vitest';
import { CIVIC } from '../../src/data/civic';
import { stageClock } from '../../src/sim/systems/projects';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { labTown, ok, refusal } from './researchTown';

/**
 * M37, step 10: the fair clock in the sim (design call 15). In a city bound to a region with war on,
 * the page caps the war clock at the region's fair clock and a two-day bank (`warClock`); at the
 * cap the war clock holds, and with it training, research, trials, cooldowns, missions and war
 * projects' stages, while readiness and the stores go on. A city of its own never has a cap. (The
 * room's side is relay/tests/fairClock.test.ts.)
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

/** A war town researching Field workshops in one lab, training infantry at a barracks. */
function town() {
  const t = labTown(1);
  const barracks = t.place('barracks');
  t.sim.advance(M);
  ok(t.sim, { type: 'queueResearch', key: 'land1' });
  for (let k = 0; k < 4; k++) ok(t.sim, { type: 'trainUnit', base: barracks, kind: 'infantry' });
  t.sim.advance(2 * H);
  return { ...t, barracks };
}

const progress = (sim: ReturnType<typeof town>['sim']) => {
  const w = sim.state.war!;
  return {
    clock: w.clock,
    points: w.research?.points.land1 ?? 0,
    trained: [...w.orders.values()].reduce((a, o) => a + o.done, 0) + w.units.size,
  };
};

describe('M37 the fair clock in the sim', () => {
  it('a city ahead of its region holds training and research at the cap, and catches up when it moves', () => {
    const { sim } = town();
    const w = sim.state.war!;
    const start = progress(sim);
    expect(start.points).toBeGreaterThan(0);
    // The region has seen the city play to here: two days' bank beyond it.
    ok(sim, { type: 'warClock', cap: w.clock + 48 });
    // The city runs at 3× for a game week, far beyond what the region allows.
    sim.advance(7 * 24 * H);
    const held = progress(sim);
    expect(held.clock).toBe(start.clock + 48);
    expect(held.points).toBeGreaterThan(start.points);
    expect(held.trained).toBeGreaterThan(start.trained);
    // Told so, with the wait at 1×: 48 hours at 7.5 s each is six minutes.
    const note = sim.events.filter((e) => e.kind === 'clockHeld');
    expect(note.length).toBeGreaterThanOrEqual(1);
    expect(note[0]!.info!.text).toBe(
      'Your city is ahead of the region’s clock: research waits about 6 minutes',
    );
    // Once a game day at most, however long it waits.
    expect(note.length).toBeLessThanOrEqual(7);
    // Held: nothing that runs on the war clock moves; readiness and the stores go on.
    w.readiness = 0;
    sim.advance(24 * H);
    expect(progress(sim)).toEqual(held);
    expect(w.readiness).toBeGreaterThan(0);
    // The region's clock moves on a day: the city catches up to the new cap, and holds there.
    ok(sim, { type: 'warClock', cap: w.clock + 24 });
    sim.advance(3 * 24 * H);
    const caught = progress(sim);
    expect(caught.clock).toBe(held.clock + 24);
    expect(caught.points).toBeGreaterThan(held.points);
    // Out of the region: no cap, the city of its own again.
    ok(sim, { type: 'warClock', cap: null });
    expect(w.clockCap).toBeUndefined();
    sim.advance(24 * H);
    expect(w.clock).toBe(caught.clock + 24);
  });

  it('is the region’s alone: a city of its own and a shared city never wait; a cap is a whole hour', () => {
    const { sim } = town();
    const w = sim.state.war!;
    const c0 = w.clock;
    sim.advance(24 * H);
    expect(w.clock).toBe(c0 + 24);
    expect(w.clockCap).toBeUndefined();
    expect(refusal(sim, { type: 'warClock', cap: 1.5 })).toBe('No such clock');
    expect(refusal(sim, { type: 'warClock', cap: -1 })).toBe('No such clock');
    // A city shared in a room isn't in a region: a cap from before holds nothing.
    ok(sim, { type: 'warClock', cap: w.clock });
    sim.shared = true;
    sim.advance(5 * H);
    expect(w.clock).toBe(c0 + 29);
    sim.shared = false;
    sim.advance(5 * H);
    expect(w.clock).toBe(c0 + 29);
  });

  it('a war project’s stage ends at its month close in a city of its own, and waits for the war clock at the cap', () => {
    const stages = CIVIC.get('domeshield')!.project!.stages;
    const build = (cap: boolean) => {
      const { sim, place } = town();
      ok(sim, { type: 'cheat', cheat: 'research', tiers: ['defence1', 'defence2', 'defence3', 'defence4'] });
      // Placed mid-day (a month is a game day).
      sim.advance(7 * H);
      const id = place('domeshield');
      const c = () => sim.state.civics.get(id)!;
      expect(c().build!.clock).toBe(stageClock(sim));
      if (cap) ok(sim, { type: 'warClock', cap: sim.state.war!.clock + 30 });
      // Month closes until the first stage is done.
      let closes = 0;
      while (c().build?.stage === 0 && closes < 20) {
        sim.advance(M);
        closes++;
      }
      return { sim, c, closes };
    };
    // A city of its own: the stage's months, exactly.
    const own = build(false);
    expect(own.closes).toBe(stages[0]!.months);
    // The next stage starts on the war clock at that month close (the day has run on since).
    const w = own.sim.state.war!;
    expect(own.c().build!.clock).toBeLessThanOrEqual(w.clock);
    expect(w.clock - own.c().build!.clock!).toBeLessThan(24);
    // Held at the cap: the stage waits for the war clock, months or not.
    const held = build(true);
    expect(held.closes).toBe(20);
    expect(held.c().build!.stage).toBe(0);
    expect(held.c().build!.months).toBeGreaterThan(stages[0]!.months);
    // The region's clock moves on: the stage ends at the next month close the war clock allows.
    ok(held.sim, { type: 'warClock', cap: held.sim.state.war!.clock + 24 * stages[0]!.months });
    for (let k = 0; k < 6 && held.c().build!.stage === 0; k++) held.sim.advance(M);
    expect(held.c().build!.stage).toBe(1);
  });

  it('a war project placed while the clock is held gets no credit for hours the war clock didn’t run', () => {
    const { sim, place } = town();
    const w = sim.state.war!;
    ok(sim, { type: 'cheat', cheat: 'research', tiers: ['defence1', 'defence2', 'defence3', 'defence4'] });
    // Held at the cap since the month began, then placed 18 game hours in: the war clock stood still.
    ok(sim, { type: 'warClock', cap: w.clock });
    sim.advance(18 * H);
    const id = place('domeshield');
    expect(sim.state.civics.get(id)!.build!.clock).toBe(w.clock);
    // A city of its own still counts its month from the month's start.
    ok(sim, { type: 'warClock', cap: null });
    expect(stageClock(sim)).toBeLessThan(w.clock);
  });

  it('a city that leaves its region is free of its cap, and only `cap: null` may say it left', () => {
    const { sim } = town();
    const w = sim.state.war!;
    ok(sim, { type: 'warClock', cap: w.clock });
    expect(refusal(sim, { type: 'warClock', cap: w.clock + 5, left: true })).toBe('No such clock');
    ok(sim, { type: 'warClock', cap: null, left: true });
    expect(w.clockCap).toBeUndefined();
    const before = w.clock;
    sim.advance(5 * H);
    expect(w.clock).toBeGreaterThan(before);
  });
});
