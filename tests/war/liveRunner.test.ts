import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LiveRunner, LIVE_STEPS_PER_SECOND, pumpRun } from '../../src/client/liveRunner';
import { Battle } from '../../src/sim/battle/battle';
import { recordInput, stampLive, type StampedOrder } from '../../src/sim/battle/live';
import type { BattleInput } from '../../src/sim/battle/types';

/**
 * M39, step 3: the attacker's side of a live battle, the run the battle worker does. It keeps the
 * battle's pace, never steps to the room's frontier, takes the room's orders once, and rushes a
 * battle the room has ended.
 */
const kept = JSON.parse(readFileSync('tests/fixtures/war/battle-v2.json', 'utf8')) as {
  input: BattleInput;
}[];
const input = (): BattleInput => stampLive(structuredClone(kept[0]!.input));

class Time {
  t = 1_000;
  now = () => this.t;
}

const hold = (seq: number, step: number): StampedOrder => ({ seq, step, side: 0, kind: 'hold' });

describe('M39: the attacker’s live run', () => {
  it('keeps the pace of the battle at 1×: 16 steps a second', () => {
    expect(LIVE_STEPS_PER_SECOND).toBe(16);
    const time = new Time();
    const near = new LiveRunner(input(), time.now);
    near.feed([], 48);
    let ran = 0;
    for (let ms = 0; ms < 1_000; ms += 40) {
      time.t += 40;
      ran += near.pump();
    }
    // A second of play makes sixteen steps (not forty-eight at once), then waits for the frontier.
    expect(ran).toBe(16);
    expect(near.step).toBe(16);
    for (let ms = 0; ms < 4_000; ms += 40) {
      time.t += 40;
      near.pump();
    }
    expect(near.step).toBe(48);
  });

  it('never steps to the room’s frontier, and an order stamped at it applies as that step begins', () => {
    const time = new Time();
    const a = new LiveRunner(input(), time.now);
    a.feed([hold(1, 48)], 48);
    for (let k = 0; k < 400; k++) {
      time.t += 40;
      a.pump();
    }
    expect(a.step).toBe(48);
    expect(a.battle.input.orders).toHaveLength(1);
    // The frontier moves: only then does the step at it run, with the order.
    a.feed([], 49);
    time.t += 1_000;
    a.pump();
    expect(a.step).toBe(49);
    const b = new Battle(recordInput(input(), [hold(1, 48)]));
    while (b.step < 49) b.stepOnce();
    expect(a.battle.hash()).toBe(b.hash());
  });

  it('takes the room’s orders once, however often it is told', () => {
    const run = new LiveRunner(input(), () => 0);
    run.feed([hold(1, 32), hold(2, 40)], 10);
    run.feed([hold(1, 32), hold(2, 40)], 20);
    run.feed([hold(3, 64)], 30);
    expect(run.battle.input.orders.map((o) => o.step)).toEqual([32, 40, 64]);
    expect(run.seen).toBe(3);
    expect(run.allow).toBe(30);
    // The frontier does not go back.
    run.feed([], 5);
    expect(run.allow).toBe(30);
  });

  it('catches up at once when it is far behind (a page that came back to a battle on)', () => {
    const time = new Time();
    const run = new LiveRunner(input(), time.now);
    run.feed([hold(1, 100)], 400);
    time.t += 40;
    run.pump();
    expect(run.step).toBe(400);
    // Then it is at the frontier, and goes on at the battle’s pace.
    run.feed([], 440);
    time.t += 1_000;
    expect(run.pump()).toBeLessThanOrEqual(16);
  });

  it('runs a battle the room has ended out at once, and says how it ended', () => {
    const time = new Time();
    const run = new LiveRunner(input(), time.now);
    run.feed([hold(1, 40)], 10_000);
    run.rush();
    const frames: number[] = [];
    let end = null as ReturnType<LiveRunner['end']>;
    const shown = { step: -2 };
    let over = false;
    for (let k = 0; k < 100 && !over; k++) {
      time.t += 40;
      over = pumpRun(run, shown, { frame: (step) => frames.push(step), done: (e) => (end = e) });
    }
    expect(over).toBe(true);
    expect(end).not.toBeNull();
    const plain = Battle.run(recordInput(input(), [hold(1, 40)]));
    expect(end!.hash).toBe(plain.hash());
    expect(end!.step).toBe(plain.step);
    expect(end!.result.hash).toBe(plain.hash());
    // A picture every other step at most, and one when it ended.
    expect(frames.at(-1)).toBe(plain.step);
  });
});
