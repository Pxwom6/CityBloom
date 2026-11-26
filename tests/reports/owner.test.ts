/** The owner area's "Copy for Claude Code" text (M41): what it is, where and how often, how to replay. */
import { describe, expect, it } from 'vitest';
import { groupForClaude } from '../../src/owner/api';
import type { GroupView, ItemFull } from '../../relay/reportDesk';

const env = {
  build: 'abc1234',
  browser: 'Chrome 142',
  os: 'macOS',
  quality: 'high',
  save: 32,
  shared: 'room',
  where: 'city',
} as const;

const group = (over: Partial<GroupView> = {}): GroupView => ({
  key: 'error-1',
  kind: 'error',
  message: "Cannot read properties of undefined (reading 'lanes')",
  stack: 'TypeError: …\n    at stepTram (/assets/index.js:1:2)',
  first: Date.UTC(2026, 10, 20),
  last: Date.UTC(2026, 10, 26, 9, 30),
  count: 12,
  status: 'open',
  fixedAt: null,
  reopened: true,
  builds: [
    { build: 'abc1234', count: 10 },
    { build: 'def5678', count: 2 },
  ],
  browsers: [{ browser: 'Chrome 142 · macOS', count: 12 }],
  env,
  items: [],
  dropped: 0,
  ...over,
});

describe('copy for Claude Code', () => {
  it('says what, how often, where, and gives the stack', () => {
    const t = groupForClaude(group());
    expect(t).toContain('Kind: error · Status: open (came back on a newer build)');
    expect(t).toContain('Seen 12 times, first 2026-11-20, last 2026-11-26 09:30 UTC');
    expect(t).toContain('Builds: abc1234 (10), def5678 (2)');
    expect(t).toContain('at stepTram');
  });

  it('lists written reports’ messages, and for a desync where its replay starts and how to run it', () => {
    const written = groupForClaude(
      group({
        kind: 'user',
        items: [
          {
            id: 3,
            at: Date.UTC(2026, 10, 26),
            note: 'The tram froze',
            summary: null,
            shot: true,
            replay: false,
            bytes: 9,
          },
        ],
      }),
    );
    expect(written).toContain('- 2026-11-26 00:00: The tram froze');
    const item: ItemFull = {
      id: 7,
      key: 'desync-city',
      at: 1,
      note: null,
      summary: null,
      shot: false,
      replay: true,
      bytes: 100,
      report: {
        kind: 'desync',
        env,
        message: 'x',
        stack: '',
        at: 1,
        desync: {
          where: 'city',
          tick: 1020,
          mine: 'aa',
          theirs: 'bb',
          start: { tick: 0, seq: -1, sum: 'cc', founded: { seed: 's', preset: 'river' } },
        },
      },
    };
    const d = groupForClaude(group({ kind: 'desync', key: 'desync-city' }), [item]);
    expect(d).toContain(
      'Desync (city) at tick 1020: this side aa, the other bb; replay from tick 0 (founded on that machine: needs nothing more)',
    );
    expect(d).toContain('npx tsx scripts/desync.ts');
  });
});
