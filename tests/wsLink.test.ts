import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webSocketLink } from '../src/net/link';

/**
 * Opening a socket on a busy page (M35 e2e): a city that has just opened can hold the page for a
 * minute; the socket's own wait mustn't count that against the network.
 */
class FakeSocket {
  static last: FakeSocket | null = null;
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { reason: string; code: number }) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(): void {}
  close(): void {
    this.closed = true;
    this.readyState = 3;
  }
}

describe('opening a socket (M35)', () => {
  // The page's clock: the timers' own time, plus however long the page was held.
  let held = 0;
  beforeEach(() => {
    held = 0;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const start = Date.now();
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now() - start + held);
    vi.stubGlobal('WebSocket', FakeSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('a socket open but whose event is still waiting is open', async () => {
    const p = webSocketLink('ws://x', 8000);
    FakeSocket.last!.readyState = 1; // opened; the page hasn't heard yet
    await vi.advanceTimersByTimeAsync(8000);
    await expect(p).resolves.toBeTruthy();
    expect(FakeSocket.last!.closed).toBe(false);
  });

  it('a wait that ran late (a busy page) waits once more, then gives up', async () => {
    const p = webSocketLink('ws://x', 8000);
    const failed = vi.fn();
    p.catch(failed);
    // The page was held for 30 s: the timer runs late.
    held = 30_000;
    await vi.advanceTimersByTimeAsync(8000);
    expect(FakeSocket.last!.closed).toBe(false);
    expect(failed).not.toHaveBeenCalled();
    // Still not open after a full wait more, on time: it's the network.
    await vi.advanceTimersByTimeAsync(8000);
    expect(FakeSocket.last!.closed).toBe(true);
    expect(failed).toHaveBeenCalled();
  });

  it('a socket that never opens is given up after its wait', async () => {
    const p = webSocketLink('ws://x', 8000);
    const failed = vi.fn();
    p.catch(failed);
    await vi.advanceTimersByTimeAsync(8000);
    expect(failed).toHaveBeenCalled();
    expect(FakeSocket.last!.closed).toBe(true);
  });
});
