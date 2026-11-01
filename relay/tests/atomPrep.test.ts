import { afterAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startRelay, type LocalRelay } from '../local';
import { makeCode } from '../protocol';
import { REGION_LIMITS } from '../region';

/**
 * M40 step 12: the local relay's `--atom-prep` (`RelayOptions.regionLimits`) shortens the wait before a
 * region keeps a friend's atom strike, for the end-to-end tests; without it a region keeps the online
 * rooms' twenty minutes.
 */

const relays: LocalRelay[] = [];
afterAll(async () => {
  for (const r of relays) await r.close();
});

/** A region room the relay makes for a socket, and its limits (read for the test). */
async function regionLimits(relay: LocalRelay): Promise<{ atomPrep: number }> {
  const code = makeCode('online');
  const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/region/${code}?create=1`);
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });
  try {
    const room = relay.regions.get(code);
    expect(room, 'the relay made the region room').toBeDefined();
    return (room as unknown as { limits: { atomPrep: number } }).limits;
  } finally {
    ws.close();
  }
}

describe('the local relay’s regions (M40 step 12)', () => {
  it('keep the online wait for a friend’s atom strike unless told otherwise', async () => {
    const relay = await startRelay(0, null, { strict: true });
    relays.push(relay);
    expect((await regionLimits(relay)).atomPrep).toBe(REGION_LIMITS.atomPrep);
    expect(REGION_LIMITS.atomPrep).toBe(20 * 60_000);
  });

  it('take the shorter wait the e2e relay is started with', async () => {
    const relay = await startRelay(0, null, { strict: true, regionLimits: { atomPrep: 20_000 } });
    relays.push(relay);
    expect((await regionLimits(relay)).atomPrep).toBe(20_000);
  });
});
