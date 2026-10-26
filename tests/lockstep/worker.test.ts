import { afterAll, describe, expect, it, vi } from 'vitest';
import type { MainToWorker, WorkerToMain } from '../../src/sim/protocol';
import type { Stamped } from '../../src/sim/lockstep';
import { Lockstep } from '../../src/sim/lockstep';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { Sim } from '../../src/sim/sim';

/**
 * The worker's shared mode (M29), run in Node with a stand-in worker scope: it applies stamped
 * events at their ticks, never drops one, reports how far behind it is and an hourly checksum that
 * matches a runner fed the same events, settles and snapshots on request, and flags late events.
 */
const out: WorkerToMain[] = [];
const scope = {
  postMessage: (m: WorkerToMain) => out.push(m),
  onmessage: null as ((e: { data: MainToWorker }) => void) | null,
};
vi.useFakeTimers();
(globalThis as unknown as { self: unknown }).self = scope;
await import('../../src/sim/worker');
const send = (data: MainToWorker) => scope.onmessage!({ data });
afterAll(() => vi.useRealTimers());

const OPTIONS = { seed: 'worker', preset: 'river' as const, sandbox: true };

describe('the worker in a shared city (M29)', () => {
  it('runs to the tick the room allows, applying events at their ticks, with matching checksums', () => {
    send({ type: 'init', options: OPTIONS });
    send({ type: 'share', player: 2, lastSeq: -1 });
    const ref = new Lockstep(Sim.create(OPTIONS));
    const n = ref.sim.state.net.nodes.get(ref.sim.state.highway.connect)!;
    const events: Stamped[] = [
      {
        tick: 5,
        seq: 0,
        ev: {
          kind: 'cmd',
          by: 1,
          ref: 7,
          cmd: {
            type: 'buildRoad',
            road: 'avenue',
            points: [
              { x: n.x, z: n.z },
              { x: n.x + 300, z: n.z },
            ],
          },
        },
      },
      {
        tick: 5,
        seq: 1,
        ev: {
          kind: 'cmd',
          by: 2,
          cmd: {
            type: 'zone',
            zone: 'R',
            area: {
              kind: 'brush',
              points: [
                { x: n.x + 30, z: n.z - 30 },
                { x: n.x + 280, z: n.z - 30 },
              ],
              radius: 25,
            },
          },
        },
      },
      { tick: 130, seq: 2, ev: { kind: 'settle', taker: 2, reason: 'snapshot' } },
      { tick: 131, seq: 3, ev: { kind: 'cmd', by: 1, cmd: { type: 'cheat', cheat: 'addMoney', amount: 5 } } },
    ];
    for (const e of events) ref.push(structuredClone(e));
    const allow = 3 * TICKS_PER_HOUR + 7;
    ref.allow(allow);
    ref.run();
    send({ type: 'stamped', events, allow });
    // The worker's loop catches up in 35 ms slices every 50 ms.
    for (let i = 0; i < 400; i++) {
      vi.advanceTimersByTime(50);
      const frame = out.filter((m) => m.type === 'frame').at(-1);
      if (frame?.type === 'frame' && frame.perf.behind === 0) break;
    }
    const frame = out.filter((m) => m.type === 'frame').at(-1)!;
    expect(frame.type === 'frame' && frame.perf.behind).toBe(0);
    const sums = out.filter((m) => m.type === 'checksum');
    expect(sums.map((m) => m.type === 'checksum' && m.tick)).toEqual([60, 120, 180]);
    for (const m of sums) if (m.type === 'checksum') expect(m.sum).toBe(ref.checksums.get(m.tick));
    const applied = out.flatMap((m) => (m.type === 'applied' ? m.list : []));
    expect(applied.map((a) => [a.tick, a.seq, a.result?.ok])).toEqual([
      [5, 0, true],
      [5, 1, true],
      [131, 3, false],
    ]);
    expect(applied[2]!.result).toMatchObject({ reason: 'Cheats are off in a shared city' });
    const snap = out.find((m) => m.type === 'snapshot' && m.reason === 'snapshot');
    expect(out.find((m) => m.type === 'snapshot' && m.reason === 'upload')).toBeTruthy();
    expect(snap?.type === 'snapshot' && snap.tick).toBe(130);
    if (snap?.type === 'snapshot') {
      expect(snap.snapshot.seq).toBe(2);
      // A joiner from the snapshot, given what came after, ends where the others are.
      const joiner = new Lockstep(Sim.fromSave(snap.snapshot.save), snap.snapshot.seq);
      joiner.sim.setHistoryState(snap.snapshot.history);
      joiner.eventHash = snap.snapshot.eventHash;
      for (const e of events) joiner.push(structuredClone(e));
      joiner.allow(allow);
      joiner.run();
      expect(joiner.checksums.get(180)).toBe(ref.checksums.get(180));
    }
  });

  it('commands and time from the page are refused while shared; a late event is reported', () => {
    out.length = 0;
    send({ type: 'command', id: 1, cmd: { type: 'setPolicy', id: 'recycling', on: true } });
    send({ type: 'advance', id: 2, ticks: 100 });
    const replies = out.filter((m) => m.type === 'reply');
    expect(replies[0]).toMatchObject({ result: { ok: false } });
    expect(replies[1]).toMatchObject({ result: 3 * TICKS_PER_HOUR + 7 });
    send({
      type: 'stamped',
      events: [{ tick: 10, seq: 9, ev: { kind: 'cmd', by: 1, cmd: { type: 'undo' } } }],
      allow: TICKS_PER_MONTH,
    });
    expect(out.find((m) => m.type === 'late')).toMatchObject({ tick: 10, seq: 9 });
  });

  it('single player keeps its own clock', () => {
    send({ type: 'unshare' });
    send({ type: 'init', options: OPTIONS });
    out.length = 0;
    send({ type: 'setSpeed', speed: 1 });
    vi.advanceTimersByTime(1000);
    send({ type: 'setSpeed', speed: 0 });
    const frame = out.filter((m) => m.type === 'frame').at(-1);
    expect(frame?.type === 'frame' && frame.diff.stats.tick).toBeGreaterThan(4);
    expect(frame?.type === 'frame' && frame.perf.behind).toBeUndefined();
  });
});
