import { describe, expect, it } from 'vitest';
import { FRIENDS, LIVE, type WarEvent } from '../../relay/protocol';
import {
  HISTORY_GROUPS,
  NO_FILTER,
  STATE_WORDS,
  TEXT_MAX,
  byDay,
  cleanEvent,
  dayLabel,
  expectOf,
  groupOf,
  historyCities,
  historyRows,
  historyState,
  localOffset,
  mergeHistory,
  offersRegionHistory,
  replayKey,
  replayOf,
  replayVerdict,
  replaysFrom,
  timeLabel,
  withReplay,
  type ReplayRef,
} from '../../src/client/regionHistory';

/**
 * M39 step 7: the region's war history as a page shows it: merging what the room says, narrowing it,
 * which battles have a replay, and the days. Pure functions, no room.
 */
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0); // Fri 30 Oct 2026, noon UTC

const ev = (id: number, over: Partial<WarEvent> = {}): WarEvent => ({
  id,
  at: T0 + id * 1000,
  kind: 'declared',
  a: 1,
  b: 2,
  text: `event ${id}`,
  ...over,
});

const ref = (id: string, from = 1, to = 2, over: Partial<ReplayRef> = {}): ReplayRef => ({
  id,
  from,
  to,
  step: 400,
  hash: 'abcd1234',
  agree: true,
  ...over,
});

describe('merging the room’s events', () => {
  it('keeps them oldest first by id, whatever order they arrive in', () => {
    const got = mergeHistory([ev(3), ev(1)], [ev(2), ev(4)]);
    expect(got.map((e) => e.id)).toEqual([1, 2, 3, 4]);
  });

  it('an event heard again replaces the first (a battle gains its outcome and score)', () => {
    const first = ev(5, {
      kind: 'battle',
      text: 'A and B fought a live battle',
      battle: { from: 1, id: 'x', live: true },
    });
    const later = ev(5, {
      kind: 'battle',
      text: 'A raided B: the raid was repelled',
      battle: { from: 1, id: 'x', live: true },
      outcome: 'repelled',
      score: -8,
    });
    const got = mergeHistory([ev(4), first], [later]);
    expect(got).toHaveLength(2);
    expect(got[1]).toMatchObject({
      id: 5,
      outcome: 'repelled',
      score: -8,
      text: 'A raided B: the raid was repelled',
    });
  });

  it('is the same list when the same words come twice (the welcome after a live event)', () => {
    const list = [ev(1), ev(2), ev(3)];
    const once = mergeHistory([], list);
    const twice = mergeHistory(once, list);
    expect(twice).toEqual(once);
  });

  it('keeps only the newest hundred, the room’s own cap', () => {
    const many = Array.from({ length: 130 }, (_, k) => ev(k + 1));
    const got = mergeHistory([], many);
    expect(got).toHaveLength(FRIENDS.history);
    expect(got[0]!.id).toBe(31);
    expect(got.at(-1)!.id).toBe(130);
    // And one more event pushes out the oldest.
    const next = mergeHistory(got, [ev(131)]);
    expect(next).toHaveLength(FRIENDS.history);
    expect(next[0]!.id).toBe(32);
  });

  it('leaves the list it was given alone', () => {
    const list = [ev(1)];
    const copy = structuredClone(list);
    mergeHistory(list, [ev(2)]);
    expect(list).toEqual(copy);
  });

  it('drops what is not an event and cuts a long line (a friend’s browser may host the region)', () => {
    const junk: unknown[] = [
      null,
      7,
      'x',
      [],
      { id: 'a', at: 1, kind: 'battle', a: 1, b: 2, text: 't' },
      { id: 9, at: 1, kind: 'nonsense', a: 1, b: 2, text: 't' },
      { id: 9, at: 1, kind: 'battle', a: 1, b: 2, text: 5 },
      { id: -1, at: 1, kind: 'battle', a: 1, b: 2, text: 't' },
      { id: 10, at: -5, kind: 'battle', a: 1, b: 2, text: 't' },
      { id: 10, at: Number.NaN, kind: 'battle', a: 1, b: 2, text: 't' },
      { id: 10, at: '5', kind: 'battle', a: 1, b: 2, text: 't' },
      { id: 10.5, at: 5, kind: 'battle', a: 1, b: 2, text: 't' },
      { ...ev(11), text: 'x'.repeat(5_000), extra: 'dropped', battle: { from: 1, id: 'y'.repeat(200) } },
    ];
    const got = mergeHistory([], junk);
    expect(got.map((e) => e.id)).toEqual([11]);
    expect(got[0]!.text).toHaveLength(TEXT_MAX);
    expect(got[0]).not.toHaveProperty('extra');
    // A battle id too long to be one is not kept with the event.
    expect(got[0]).not.toHaveProperty('battle');
  });

  it('rounds a time with fractions instead of dropping the event (a room on performance.now())', () => {
    // Chromium's own: fractions of a millisecond, counted from the page's load.
    const e = cleanEvent({ ...ev(4), at: 15.199999999254942 });
    expect(e).toMatchObject({ id: 4, at: 15 });
    expect(
      mergeHistory(
        [],
        [
          { ...ev(5), at: 5372.7000000477 },
          { ...ev(6), at: 5372.2 },
        ],
      ).map((x) => x.at),
    ).toEqual([5373, 5372]);
    expect(cleanEvent({ ...ev(7), at: Infinity })).toBeNull();
  });

  it('cleanEvent keeps a battle’s link, outcome and score', () => {
    const e = cleanEvent({
      ...ev(3),
      kind: 'battle',
      battle: { from: 1, id: 'live-7', live: true },
      outcome: 'raided',
      score: 12.5,
      war: 4,
    });
    expect(e).toMatchObject({
      battle: { from: 1, id: 'live-7', live: true },
      outcome: 'raided',
      score: 12.5,
      war: 4,
    });
  });
});

describe('kinds', () => {
  it('every kind of the room’s belongs to exactly one group the list can be narrowed to', () => {
    const kinds = HISTORY_GROUPS.flatMap((g) => g.kinds);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds.sort()).toEqual(
      [
        'battle',
        'broken',
        'capitulated',
        'ceasefire',
        'declared',
        'ended',
        'freed',
        'hold',
        'opened',
        'treaty',
        'vassal',
      ].sort(),
    );
    expect(groupOf('battle')).toBe('battles');
    expect(groupOf('treaty')).toBe('treaties');
    expect(groupOf('vassal')).toBe('conquests');
    expect(groupOf('broken')).toBe('broken');
  });
});

describe('replays', () => {
  it('are told in the welcome oldest first and never more than the room keeps', () => {
    const many = Array.from({ length: LIVE.replays + 5 }, (_, k) => ({ ...ref(`b${k}`), k }));
    const got = replaysFrom(many);
    expect(got).toHaveLength(LIVE.replays);
    expect(got[0]!.id).toBe('b5');
    // The room’s row is not the page’s business.
    expect(got[0]).not.toHaveProperty('k');
    expect(replaysFrom(undefined)).toEqual([]);
    expect(replaysFrom([{ nope: 1 }, null, ref('ok')])).toEqual([ref('ok')]);
  });

  it('a battle’s end adds its replay; heard twice it is one; the oldest go first', () => {
    let list: ReplayRef[] = [];
    for (let k = 0; k < LIVE.replays + 3; k++) list = withReplay(list, ref(`b${k}`));
    expect(list).toHaveLength(LIVE.replays);
    expect(list[0]!.id).toBe('b3');
    const again = withReplay(list, ref('b10', 1, 2, { hash: 'ffff0000' }));
    expect(again).toHaveLength(LIVE.replays);
    expect(again.filter((r) => r.id === 'b10')).toHaveLength(1);
    expect(again.at(-1)).toMatchObject({ id: 'b10', hash: 'ffff0000' });
  });

  it('a battle the room did not store is not added, and takes no replay of the others off', () => {
    const full = Array.from({ length: LIVE.replays }, (_, k) => ref(`r${k}`));
    const end = { id: 'unstored', from: 1, to: 2, step: 9, hash: 'ab', agree: true, kept: false as const };
    expect(withReplay(full, end)).toEqual(full);
    expect(withReplay([], end)).toEqual([]);
    // One that was stored is added as before, and the oldest drop off.
    const added = withReplay(full, { ...end, id: 'stored', kept: undefined });
    expect(added).toHaveLength(LIVE.replays);
    expect(added.at(-1)!.id).toBe('stored');
    expect(added[0]!.id).toBe('r1');
  });

  it('two battles of the same id from different cities are two replays', () => {
    const list = withReplay(withReplay([], ref('same', 1, 3)), ref('same', 2, 3));
    expect(list).toHaveLength(2);
    expect(replayOf(list, 1, 'same')?.to).toBe(3);
    expect(replayOf(list, 2, 'same')?.from).toBe(2);
    expect(replayOf(list, 3, 'same')).toBeUndefined();
    expect(replayKey(1, 'same')).not.toBe(replayKey(2, 'same'));
  });

  it('a battle nobody finished has nothing to be held to', () => {
    expect(expectOf(ref('a', 1, 2, { abandoned: true }))).toBeNull();
    expect(expectOf(ref('a', 1, 2, { solo: true }))).toEqual({ step: 400, hash: 'abcd1234' });
  });

  it('is checked when it ends where the battle ended, and differs when it does not', () => {
    const want = { step: 400, hash: 'abcd1234' };
    expect(replayVerdict(want, { step: 400, hash: 'abcd1234' })).toBe('checked');
    expect(replayVerdict(want, { step: 399, hash: 'abcd1234' })).toBe('differs');
    expect(replayVerdict(want, { step: 400, hash: 'abcd1235' })).toBe('differs');
  });
});

describe('rows', () => {
  const events: WarEvent[] = [
    ev(1, { kind: 'declared', a: 1, b: 2 }),
    ev(2, { kind: 'opened', a: 1, b: 2 }),
    ev(3, {
      kind: 'battle',
      a: 1,
      b: 2,
      battle: { from: 1, id: 'kept', live: true },
      outcome: 'raided',
      score: 9,
    }),
    ev(4, { kind: 'battle', a: 3, b: 2, battle: { from: 3, id: 'old-way' } }),
    ev(5, { kind: 'battle', a: 2, b: 1, battle: { from: 2, id: 'gone', live: true }, outcome: 'repelled' }),
    ev(6, { kind: 'treaty', a: 3, b: 2 }),
    ev(7, { kind: 'broken', a: 3, b: 1 }),
    ev(8, { kind: 'vassal', a: 1, b: 2 }),
  ];
  const replays = [ref('kept', 1, 2)];

  it('are newest first', () => {
    expect(historyRows(events, replays).map((r) => r.id)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it('a battle the room still keeps has its replay; one it does not, and an old-way raid, have none', () => {
    const rows = historyRows(events, replays);
    const by = (id: number) => rows.find((r) => r.id === id)!;
    expect(by(3).replay).toMatchObject({ id: 'kept', from: 1, to: 2 });
    expect(by(3).live).toBe(true);
    expect(by(5).replay).toBeUndefined();
    expect(by(5).live).toBe(true);
    expect(by(4).replay).toBeUndefined();
    expect(by(4).live).toBe(false);
    expect(by(1).replay).toBeUndefined();
    // The outcome and score ride along.
    expect(by(3)).toMatchObject({ outcome: 'raided', score: 9, group: 'battles' });
  });

  it('are narrowed by kind: none chosen is all, several are joined', () => {
    expect(historyRows(events, replays, { city: null, groups: ['battles'] }).map((r) => r.id)).toEqual([
      5, 4, 3,
    ]);
    expect(
      historyRows(events, replays, { city: null, groups: ['treaties', 'broken'] }).map((r) => r.id),
    ).toEqual([7, 6]);
    expect(historyRows(events, replays, NO_FILTER)).toHaveLength(8);
  });

  it('are narrowed by city: either side of the line', () => {
    expect(historyRows(events, replays, { city: 3, groups: [] }).map((r) => r.id)).toEqual([7, 6, 4]);
    expect(historyRows(events, replays, { city: 9, groups: [] })).toEqual([]);
    // City and kind together.
    expect(historyRows(events, replays, { city: 1, groups: ['battles'] }).map((r) => r.id)).toEqual([5, 3]);
  });

  it('keep the order of ids when two happen in the same millisecond', () => {
    const same = [ev(1, { at: T0 }), ev(2, { at: T0 })];
    expect(historyRows(same, []).map((r) => r.id)).toEqual([2, 1]);
  });

  it('the cities to choose from are those in the region, then those that have left', () => {
    const cities = historyCities(events, [
      { slot: 2, name: 'Samford' },
      { slot: 1, name: 'Adaville' },
    ]);
    expect(cities.map((c) => c.slot)).toEqual([1, 2, 3]);
    expect(cities[2]).toMatchObject({ gone: true, name: 'A former city (#3)' });
    expect(cities[0]!.gone).toBeUndefined();
  });
});

describe('days', () => {
  const noon = T0;
  it('say today, yesterday, then the date, in the player’s own day', () => {
    expect(dayLabel(noon, noon, 0)).toBe('Today');
    expect(dayLabel(noon - 86_400_000, noon, 0)).toBe('Yesterday');
    expect(dayLabel(noon - 2 * 86_400_000, noon, 0)).toBe('Wed 28 Oct');
    // Another year says so.
    expect(dayLabel(Date.UTC(2025, 11, 31, 8), noon, 0)).toBe('Wed 31 Dec 2025');
  });

  it('follow the player’s offset from UTC: the same moment is another day further east', () => {
    const lateEvening = Date.UTC(2026, 9, 29, 23, 30); // Thu 23:30 UTC
    expect(dayLabel(lateEvening, noon, 0)).toBe('Yesterday');
    // +2 h: it is already Friday 01:30 there, today.
    expect(dayLabel(lateEvening, noon, 120)).toBe('Today');
    expect(timeLabel(lateEvening, 0)).toBe('23:30');
    expect(timeLabel(lateEvening, 120)).toBe('01:30');
    // West of UTC.
    expect(timeLabel(Date.UTC(2026, 9, 30, 3, 5), -300)).toBe('22:05');
  });

  it('use the offset the player had at the time of each line: the clocks change in between', () => {
    // New York: the clocks went back at 06:00 UTC on Sun 1 Nov 2026 (EDT, −4 h, then EST, −5 h).
    const ny = (at: number): number => (at < Date.UTC(2026, 10, 1, 6) ? -240 : -300);
    const now = Date.UTC(2026, 10, 2, 12); // Mon 2 Nov, noon UTC: 07:00 EST
    const late = Date.UTC(2026, 9, 31, 3, 30); // 03:30 UTC on Sat 31 Oct: 23:30 EDT on Friday the 30th
    const small = Date.UTC(2026, 9, 31, 4, 30); // 04:30 UTC: 00:30 EDT on Saturday the 31st
    // Today's offset would say 22:30 and 23:30, and put both on Friday.
    expect(timeLabel(late, ny)).toBe('23:30');
    expect(timeLabel(small, ny)).toBe('00:30');
    expect(timeLabel(small, ny(now))).toBe('23:30');
    expect(dayLabel(small, now, ny)).toBe('Sat 31 Oct');
    expect(dayLabel(small, now, ny(now))).toBe('Fri 30 Oct');
    // And the rows land under the days they were lived in.
    const rows = historyRows([ev(1, { at: late }), ev(2, { at: small })], []);
    expect(byDay(rows, now, ny).map((d) => [d.day, d.rows.map((r) => r.id)])).toEqual([
      ['Sat 31 Oct', [2]],
      ['Fri 30 Oct', [1]],
    ]);
    // The browser's own offset takes a moment, as the function does.
    expect(typeof localOffset(now)).toBe('number');
  });

  it('put each line under its day, newest first', () => {
    const rows = historyRows(
      [
        ev(1, { at: noon - 3 * 86_400_000 }),
        ev(2, { at: noon - 86_400_000 + 60_000 }),
        ev(3, { at: noon - 3_600_000 }),
        ev(4, { at: noon - 60_000 }),
      ],
      [],
    );
    const days = byDay(rows, noon, 0);
    expect(days.map((d) => d.day)).toEqual(['Today', 'Yesterday', 'Tue 27 Oct']);
    expect(days.map((d) => d.rows.map((r) => r.id))).toEqual([[4, 3], [2], [1]]);
  });
});

describe('what the panel says', () => {
  it('offers the region’s history only where war is on: peaceful play is unchanged', () => {
    // A peaceful city, alone or in a region at peace: no new tab.
    expect(offersRegionHistory({ cityWar: false, regionWar: undefined })).toBe(false);
    expect(offersRegionHistory({ cityWar: false, regionWar: false })).toBe(false);
    // A city with war on, or a region with war on (the city is joining it, or its war state is on).
    expect(offersRegionHistory({ cityWar: true, regionWar: undefined })).toBe(true);
    expect(offersRegionHistory({ cityWar: true, regionWar: false })).toBe(true);
    expect(offersRegionHistory({ cityWar: false, regionWar: true })).toBe(true);
  });

  it('has a list only in a region with war on and something to list', () => {
    expect(historyState({ inRegion: false, warOn: false, events: 0 })).toBe('none');
    expect(historyState({ inRegion: false, warOn: true, events: 5 })).toBe('none');
    expect(historyState({ inRegion: true, warOn: false, events: 5 })).toBe('off');
    expect(historyState({ inRegion: true, warOn: true, events: 0 })).toBe('empty');
    expect(historyState({ inRegion: true, warOn: true, events: 1 })).toBe('list');
    // Just back in a region, before it has told the page its history: not "nothing has happened".
    expect(historyState({ inRegion: true, warOn: true, events: 0, synced: false })).toBe('loading');
    expect(historyState({ inRegion: true, warOn: true, events: 0, synced: true })).toBe('empty');
    expect(historyState({ inRegion: true, warOn: true, events: 3, synced: false })).toBe('list');
    for (const w of Object.values(STATE_WORDS)) expect(w.length).toBeGreaterThan(20);
  });

  it('a city on its way into a region says so, and is not told it has no region', () => {
    // `game.region` is set at once; the region's view comes with the first word of the room.
    expect(historyState({ inRegion: false, joining: true, warOn: false, events: 0 })).toBe('joining');
    expect(historyState({ inRegion: false, joining: false, warOn: false, events: 0 })).toBe('none');
    expect(STATE_WORDS.joining).toMatch(/Joining the region/);
    expect(STATE_WORDS.joining).not.toMatch(/isn’t in a region/);
  });

  it('a region of an older version that keeps no history says so, rather than waiting for one', () => {
    const base = { inRegion: true, warOn: true, events: 0 } as const;
    expect(historyState({ ...base, synced: false })).toBe('loading');
    expect(historyState({ ...base, synced: false, unsupported: true })).toBe('unsupported');
    expect(STATE_WORDS.unsupported).toMatch(/older version/);
    // Heard from, a region has its list or nothing to show; and never both.
    expect(historyState({ ...base, synced: true, unsupported: false })).toBe('empty');
    expect(historyState({ ...base, events: 2, unsupported: true })).toBe('list');
  });
});
