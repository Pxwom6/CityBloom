import { describe, expect, it } from 'vitest';
import { MatchClient, type MatchHost } from '../src/client/matchClient';
import { defaultMatch } from '../src/data/match';
import type { RegionView } from '../relay/region';
import type { MatchView } from '../relay/match';

/**
 * M43, the page's side of a match: its clock follows the room's (a page that took the countdown late
 * moves its start up to the room's word, never back), its reports carry the round, Race's tick and
 * the last report's hash, and nothing can be built before the start.
 */
function client() {
  const clocks: unknown[] = [];
  let tick = 0;
  const host: MatchHost = {
    matchClock: (c) => clocks.push(c),
    hash: () => Promise.resolve('abcd1234'),
    tick: () => tick,
    population: () => 0,
    showSpeed: () => undefined,
    notify: () => undefined,
    rematch: () => undefined,
  };
  const c = new MatchClient(host);
  c.begin({ invite: '7ABCDE', kind: 'online', round: 1, city: 'Adaton' });
  return { c, clocks, setTick: (t: number) => (tick = t) };
}

const region = (match: MatchView): RegionView =>
  ({
    code: '7ABCDE',
    name: 'Quick match',
    kind: 'online',
    cities: [],
    project: {} as RegionView['project'],
    host: 1,
    rules: { war: false } as RegionView['rules'],
    match,
  }) as RegionView;

const settings = { ...defaultMatch('mabc12'), minutes: 15 };

describe('M43 the page’s match clock', () => {
  it('starts at the room’s word, and only ever moves earlier to it', () => {
    const { c, clocks } = client();
    expect(c.refusal()).toMatch(/hasn’t started/);
    c.view(region({ settings, phase: 'countdown', round: 1, startIn: 5_000, endsIn: 905_000, players: [] }));
    expect(clocks).toEqual([{ startIn: 5_000, endTick: 15 * 60 * 24 }]);
    const end = c.endsAt;
    // A score line says the timer ends 3 s sooner than this page thinks: it took the countdown late.
    const now = performance.now();
    c.message({ t: 'mscores', round: 1, rows: [], left: end - now - 3_000 });
    expect(c.endsAt).toBeLessThan(end - 2_900);
    expect(clocks).toHaveLength(2);
    const second = clocks[1] as { startIn: number };
    expect(second.startIn).toBeLessThan(5_000 - 2_900);
    // A line that arrived late itself (more time left than the page thinks) changes nothing.
    c.message({ t: 'mscores', round: 1, rows: [], left: c.endsAt - performance.now() + 2_000 });
    expect(clocks).toHaveLength(2);
  });

  it('adds the round, Race’s tick and, at the end, the hash to its reports', async () => {
    const { c, setTick } = client();
    const report = { population: 1, match: { tick: 100, treasury: 1, assets: 0, approval: 50 } } as never;
    expect(c.extend(report)).toMatchObject({ match: { round: 1 } });
    c.view(region({ settings, phase: 'playing', round: 1, startIn: -1_000, endsIn: 899_000, players: [] }));
    setTick(15 * 60 * 24);
    expect(c.refusal()).toBe('The match is over');
  });
});
