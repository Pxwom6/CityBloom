import { describe, expect, it } from 'vitest';
import { regionRejoin } from '../src/client/profile';
import { Sim } from '../src/sim/sim';
import { encodeSave, decodeSave } from '../src/client/saves';

/**
 * F6 (multiplayer review): a city's place in a shared region belongs to the city, in its save, not to
 * the save slot: an unrelated city saved over the same slot later never takes the old one's place.
 */
const secrets = new Map([['4RT9KW.2', 'abc']]);
const secret = (code: string, slot: number) => secrets.get(`${code}.${slot}`) ?? null;
const bound = { invite: '4RT9KW', slot: 2 };

describe('F6: which region a city rejoins', () => {
  it('rejoins only the region its own save names, as itself, when this browser holds its secret', () => {
    expect(regionRejoin(bound, null, secret)).toEqual({
      invite: '4RT9KW',
      rejoin: { slot: 2, secret: 'abc' },
    });
    // A city whose save names no region (another city saved over the slot) joins nothing.
    expect(regionRejoin(undefined, null, secret)).toBeNull();
    // A copy opened in another browser, without the secret, doesn't come back as a duplicate.
    expect(regionRejoin(bound, null, () => null)).toBeNull();
  });

  it('joins a region it was invited to as a new city, unless it already stands there', () => {
    expect(regionRejoin(undefined, '4RT9KW', secret)).toEqual({ invite: '4RT9KW', rejoin: null });
    expect(regionRejoin(bound, '7KQ2MX', secret)).toEqual({ invite: '7KQ2MX', rejoin: null });
    expect(regionRejoin(bound, '4rt9kw', secret)).toEqual({
      invite: '4rt9kw',
      rejoin: { slot: 2, secret: 'abc' },
    });
  });

  it('a peer-to-peer region is named with its key, and the binding sits beside the city, not in it', () => {
    const p2p = { invite: 'A7KQ2M-BCDF-GHJK-MNPQ', slot: 1, hosted: true };
    expect(regionRejoin(p2p, null, (c, s) => (c === 'A7KQ2M' && s === 1 ? 'k' : null))).toEqual({
      invite: 'A7KQ2M-BCDF-GHJK-MNPQ',
      rejoin: { slot: 1, secret: 'k' },
    });
    // The sim never writes it, and a save carrying it loads as any other.
    const sim = Sim.create({ seed: 'bind', preset: 'river' });
    const save = sim.save('t');
    expect(save.meta.region).toBeUndefined();
    save.meta.region = p2p;
    const back = decodeSave(encodeSave(save));
    expect(back.meta.region).toEqual(p2p);
    expect(Sim.fromSave(back).hash()).toBe(sim.hash());
  });
});
