import { afterAll, describe, expect, it, vi } from 'vitest';
import type { MainToWorker, WorkerToMain } from '../../src/sim/protocol';
import { Sim } from '../../src/sim/sim';
import type { Command } from '../../src/sim/commands';

/**
 * F9 (multiplayer review): leaving a room leaves this page's copy of the city to play alone. The
 * worker forgets which player it was and the room's rules: your own undo works, and hosting a new
 * room from the same page doesn't carry the old room's rules into it.
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

const OPTIONS = { seed: 'leave', preset: 'river' as const, sandbox: true };
const ref = Sim.create(OPTIONS);
const n = ref.state.net.nodes.get(ref.state.highway.connect)!;
const road = (dz: number): Command => ({
  type: 'buildRoad',
  road: 'street',
  points: [
    { x: n.x + 40, z: n.z + dz },
    { x: n.x + 240, z: n.z + dz },
  ],
});
const lastFrame = () => {
  const f = out.filter((m) => m.type === 'frame').at(-1);
  return f?.type === 'frame' ? f.diff.stats : null;
};
const reply = (id: number) => {
  const r = out.find((m) => m.type === 'reply' && m.id === id);
  return r?.type === 'reply' ? (r.result as { ok: boolean; info?: { label?: string } }) : null;
};

describe('F9: leaving a room', () => {
  it('leaves your own undo working and no room rules behind', () => {
    send({ type: 'init', options: OPTIONS });
    send({ type: 'command', id: 1, cmd: road(-120) });
    expect(reply(1)?.ok).toBe(true);
    // Shared as player 2: the host has taken away 2's say over money, and 2 lays a road.
    send({ type: 'share', player: 2, lastSeq: -1 });
    send({
      type: 'stamped',
      events: [
        { tick: 1, seq: 0, ev: { kind: 'rules', rules: { perms: { 2: [] }, host: 1, spendLimit: null } } },
        { tick: 1, seq: 1, ev: { kind: 'cmd', by: 2, cmd: road(-200) } },
        { tick: 2, seq: 2, ev: { kind: 'cmd', by: 1, cmd: road(-280) } },
      ],
      allow: 10,
    });
    vi.advanceTimersByTime(500);
    expect(lastFrame()?.tick).toBe(10);

    // Leaving: the city is this player's alone.
    send({ type: 'unshare' });
    out.length = 0;
    send({ type: 'command', id: 2, cmd: { type: 'setTax', zone: 'R', wealth: 'all', rate: 11 } });
    expect(reply(2)?.ok).toBe(true);
    send({ type: 'command', id: 3, cmd: road(-360) });
    expect(reply(3)?.ok).toBe(true);
    // The undo button names the road just laid, and takes it back.
    expect(lastFrame()?.undoLabel).toBe('road');
    send({ type: 'command', id: 4, cmd: { type: 'undo' } });
    expect(reply(4)).toMatchObject({ ok: true, info: { label: 'road' } });
    // Next, this player's own road from the room (another player's isn't theirs to undo), and then
    // nothing: what the button shows is what undo does.
    expect(lastFrame()?.undoAvailable).toBe(true);
    send({ type: 'command', id: 5, cmd: { type: 'undo' } });
    expect(reply(5)).toMatchObject({ ok: true, info: { label: 'road' } });
    expect(lastFrame()?.undoAvailable).toBe(false);

    // Hosting a new room from the same page: the old room's rules don't come with it.
    send({ type: 'share', player: 1, lastSeq: -1 });
    const t = lastFrame()!.tick;
    out.length = 0;
    send({
      type: 'stamped',
      events: [
        {
          tick: t + 1,
          seq: 0,
          ev: { kind: 'cmd', by: 2, cmd: { type: 'setTax', zone: 'C', wealth: 'all', rate: 12 } },
        },
      ],
      allow: t + 5,
    });
    vi.advanceTimersByTime(500);
    const applied = out.flatMap((m) => (m.type === 'applied' ? m.list : []));
    expect(applied.map((a) => a.result?.ok)).toEqual([true]);
  });
});
