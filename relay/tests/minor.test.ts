import { describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { PROTOCOL_VERSION, parseClientMsg } from '../protocol';
import { parseRegionMsg } from '../region';
import { startRelay } from '../local';
import { Sim } from '../../src/sim/sim';
import { regionReport } from '../../src/sim/systems/region';

/**
 * The multiplayer review's minor items on the relay's side (docs/DECISIONS.md, "Multiplayer review
 * follow-ups"): city names from players are cleaned as players' names are, and the local relay
 * listens only on this computer unless told otherwise.
 */
describe('city names from players are cleaned', () => {
  // A control character, markup, a right-to-left override and a zero-width space.
  const messy = 'Ada\u0007ville ‮<Town>​';

  it('in a region: a city, its reports and the region’s own name', () => {
    const hello = parseRegionMsg(
      JSON.stringify({
        t: 'rhello',
        v: PROTOCOL_VERSION,
        mayor: 'Ada',
        color: 0,
        city: messy,
        create: { name: 'Three Rivers and friends of Ada' },
      }),
    );
    expect(hello).toMatchObject({ t: 'rhello', city: 'Ada ville Town' });
    // A region's name is a city-length name, not a player's 20 characters.
    expect(hello).toMatchObject({ create: { name: 'Three Rivers and friends of Ada' } });
    const report = parseRegionMsg(
      JSON.stringify({
        t: 'report',
        city: `${messy}\n`,
        report: regionReport(Sim.create({ seed: 'minor' })),
      }),
    );
    expect(report).toMatchObject({ t: 'report', city: 'Ada ville Town' });
    // Nothing left of a name: the city still has one.
    const blank = parseRegionMsg(
      JSON.stringify({ t: 'rhello', v: PROTOCOL_VERSION, mayor: 'Ada', color: 0, city: '<>​' }),
    );
    expect(blank).toMatchObject({ city: 'A city' });
  });

  it('in a room: the city it was made from, and every snapshot’s', () => {
    const hello = parseClientMsg(
      JSON.stringify({ t: 'hello', v: PROTOCOL_VERSION, name: 'Ada', color: 0, create: { cityName: messy } }),
    );
    expect(hello).toMatchObject({ create: { cityName: 'Ada ville Town' } });
    const snap = parseClientMsg(
      JSON.stringify({
        t: 'snap',
        meta: {
          id: 'x',
          tick: 0,
          seq: -1,
          eventHash: 0,
          parts: 1,
          cityName: `Pocket\nford${'!'.repeat(80)}`,
          population: 0,
        },
        part: 0,
        data: '',
      }),
    );
    expect(snap).toMatchObject({ meta: { cityName: `Pocket ford${'!'.repeat(29)}` } });
  });
});

describe('the local relay', () => {
  it('listens on this computer only, unless given another address', async () => {
    const mine = await startRelay(0);
    const any = await startRelay(0, null, { host: '0.0.0.0' });
    try {
      expect((mine.server.address() as AddressInfo).address).toBe('127.0.0.1');
      expect((any.server.address() as AddressInfo).address).toBe('0.0.0.0');
    } finally {
      await mine.close();
      await any.close();
    }
  });
});
