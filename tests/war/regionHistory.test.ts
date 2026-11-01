import { describe, expect, it } from 'vitest';
import { FRIENDS, LIVE, type WarEvent } from '../../relay/protocol';
import type { RegionAtomMark } from '../../relay/region';
import { bombLine, raceLine } from '../../src/data/atom';
import {
  ATOM_BLOCK_ID,
  HISTORY_GROUPS,
  NO_FILTER,
  STATE_WORDS,
  TEXT_MAX,
  atomLineId,
  atomMarkText,
  atomRecord,
  byDay,
  cityNamer,
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
  withoutAtomRecord,
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
        'bomb',
        'race',
        'treaty',
        'vassal',
      ].sort(),
    );
    expect(groupOf('battle')).toBe('battles');
    expect(groupOf('treaty')).toBe('treaties');
    expect(groupOf('vassal')).toBe('conquests');
    expect(groupOf('broken')).toBe('broken');
    expect(groupOf('race')).toBe('atom');
    expect(groupOf('bomb')).toBe('atom');
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

  it('never offers “city 0”: a line about one city (the atom bomb’s race) names none as its second', () => {
    // The room writes a race line with `b: 0`: no second city. It is not a city that has left.
    const race = ev(20, {
      kind: 'race',
      a: 1,
      b: 0,
      text: 'Adaville has begun building an enrichment plant',
    });
    const cities = historyCities(
      [race, ...events],
      [
        { slot: 2, name: 'Samford' },
        { slot: 1, name: 'Adaville' },
      ],
    );
    expect(cities.map((c) => c.slot)).toEqual([1, 2, 3]);
    expect(cities.some((c) => c.slot === 0)).toBe(false);
    // ... and a line about a city that has left still offers it, alone or as the first of a line.
    const gone = historyCities([ev(21, { kind: 'race', a: 9, b: 0 })], [{ slot: 1, name: 'Adaville' }]);
    expect(gone.map((c) => c.slot)).toEqual([1, 9]);
    // Narrowing by the city the line is about still finds it.
    expect(historyRows([race], [], { city: 1, groups: [] })).toHaveLength(1);
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

/**
 * M40: the atom bomb is kept for good. The region room holds a record of it outside the history's ring
 * of 100 (`RegionMeta.atoms`); "Region at war" draws it as a block at the top, in the words the room's
 * own notices use, and does not draw the ring's lines for the same moments again.
 */
describe('the atom bomb’s record', () => {
  const H = 3_600_000;
  const NAMES: Record<number, string> = { 1: 'Adaville', 2: 'Samford', 3: 'Kitton' };
  const names = (slot: number): string | undefined => NAMES[slot];
  const mark = (
    kind: RegionAtomMark['kind'],
    slot: number,
    at: number,
    over: Partial<RegionAtomMark> = {},
  ): RegionAtomMark => ({ slot, name: NAMES[slot] ?? `City ${slot}`, kind, at, ...over });

  /** The record of a whole bomb story, oldest first, as the room writes it. */
  const record: RegionAtomMark[] = [
    mark('ready', 1, T0 + H, { first: true }),
    mark('ready', 2, T0 + 2 * H),
    mark('fired', 1, T0 + 3 * H, { to: 2 }),
    mark('boom', 2, T0 + 3 * H + 60_000),
    mark('stopped', 3, T0 + 24 * H),
  ];
  const NOW = T0 + 48 * H; // Sun 1 Nov 2026, noon UTC
  const lines = (marks: readonly RegionAtomMark[] = record, filter = NO_FILTER) =>
    atomRecord(marks, { names, now: NOW, offset: 0, filter });

  /** The ring's line for a mark, as the room writes the two together (same moment, same words). */
  const ringLine = (id: number, m: RegionAtomMark, over: Partial<WarEvent> = {}): WarEvent => {
    const text =
      m.kind === 'ready'
        ? raceLine(5, m.name)!
        : m.kind === 'fired'
          ? bombLine('fired', m.name, m.to ? NAMES[m.to] : undefined)
          : bombLine(m.kind, m.name);
    return ev(id, {
      at: m.at,
      kind: m.kind === 'ready' ? 'race' : 'bomb',
      a: m.slot,
      b: m.to ?? 0,
      text,
      ...over,
    });
  };

  it('says each kind of mark in the room’s own words, newest first, who was first named', () => {
    expect(lines().map((l) => l.text)).toEqual([
      'Kitton’s dome has stopped an atom bomb',
      'An atom bomb has fallen on Samford',
      'Adaville has fired the atom bomb at Samford',
      'Samford has the atom bomb',
      'Adaville has the atom bomb, the first in the region',
    ]);
    // The same sentences the room announces (and the war room's Bomb tab reads): one source.
    const [stopped, boom, fired, readyLate, readyFirst] = lines();
    expect(stopped!.text).toBe(bombLine('stopped', 'Kitton'));
    expect(boom!.text).toBe(bombLine('boom', 'Samford'));
    expect(fired!.text).toBe(bombLine('fired', 'Adaville', 'Samford'));
    expect(readyLate!.text).toBe(raceLine(5, 'Samford'));
    expect(readyFirst!.text).toBe(`${raceLine(5, 'Adaville')}, the first in the region`);
    expect(lines().map((l) => l.kind)).toEqual(['stopped', 'boom', 'fired', 'ready', 'ready']);
    // Only the first finisher is called the first, and the line says it as a flag too.
    expect(
      lines()
        .filter((l) => l.first)
        .map((l) => l.slot),
    ).toEqual([1]);
    // A bomb fired where the region doesn't know the target says only who fired it.
    expect(lines([mark('fired', 3, T0)])[0]!.text).toBe('Kitton has fired the atom bomb');
  });

  it('gives each line the room’s real time, in the player’s day, as the list shows its events', () => {
    const l = lines();
    expect(l.map((x) => x.when)).toEqual([
      'Yesterday 12:00',
      'Fri 30 Oct 15:01',
      'Fri 30 Oct 15:00',
      'Fri 30 Oct 14:00',
      'Fri 30 Oct 13:00',
    ]);
    // The same moment in the list is the same label (the day by `dayLabel`, the hour by `timeLabel`).
    for (const x of l) expect(x.when).toBe(`${dayLabel(x.at, NOW, 0)} ${timeLabel(x.at, 0)}`);
    // The player's own offset from UTC moves the day and the hour.
    const east = atomRecord(record, { names, now: NOW, offset: 13 * 60 });
    expect(east.at(-1)!.when).toBe('Sat 31 Oct 02:00');
    // ... and one clock change in between leaves each line in the time it was.
    const flip = (at: number) => (at < T0 + 2 * H ? 0 : 60);
    expect(atomRecord(record, { names, now: NOW, offset: flip }).map((x) => x.when)[3]).toBe(
      'Fri 30 Oct 15:00',
    );
  });

  it('keeps the order of the room’s record when two marks share a moment, and numbers the lines by it', () => {
    const same = [mark('boom', 2, T0), mark('stopped', 3, T0)];
    const l = lines(same);
    expect(l.map((x) => x.kind)).toEqual(['stopped', 'boom']);
    expect(l.map((x) => atomLineId(x.index))).toEqual([`${ATOM_BLOCK_ID}-1`, `${ATOM_BLOCK_ID}-0`]);
    expect(ATOM_BLOCK_ID).toBe('rh-atom');
  });

  it('names a city by the region now, else by its own marks, else says another city', () => {
    // A mark with no name of its own takes the region's.
    expect(atomMarkText({ slot: 1, name: '', kind: 'boom', at: T0 }, (s) => NAMES[s] ?? '?')).toBe(
      'An atom bomb has fallen on Adaville',
    );
    // A bomb fired at a city that has since left the region: its own marks still name it ...
    const left = [mark('fired', 1, T0 + H, { to: 9 }), mark('boom', 9, T0 + 2 * H, { name: 'Oldtown' })];
    expect(lines(left).map((l) => l.text)).toEqual([
      'An atom bomb has fallen on Oldtown',
      'Adaville has fired the atom bomb at Oldtown',
    ]);
    // ... and with none, it is another city.
    expect(lines([mark('fired', 1, T0, { to: 9 })])[0]!.text).toBe(
      'Adaville has fired the atom bomb at another city',
    );
    // The region's list gives names by place.
    expect(cityNamer([{ slot: 2, name: 'Samford' }])(2)).toBe('Samford');
    expect(cityNamer([{ slot: 2, name: 'Samford' }])(5)).toBeUndefined();
  });

  it('is narrowed as the list is: by the Atom bomb kind, and by a city on either side of the line', () => {
    expect(lines(record, { city: null, groups: ['atom'] })).toHaveLength(5);
    expect(lines(record, { city: null, groups: ['atom', 'battles'] })).toHaveLength(5);
    // Another kind alone leaves the block out.
    expect(lines(record, { city: null, groups: ['battles'] })).toEqual([]);
    // Samford: its own marks and the bomb fired at it.
    expect(lines(record, { city: 2, groups: [] }).map((l) => l.kind)).toEqual(['boom', 'fired', 'ready']);
    expect(lines(record, { city: 3, groups: [] }).map((l) => l.kind)).toEqual(['stopped']);
    expect(lines(record, { city: 4, groups: [] })).toEqual([]);
    // Nothing in the record, nothing to show.
    expect(lines([])).toEqual([]);
  });

  it('names no one hurt', () => {
    for (const l of lines()) expect(l.text).not.toMatch(/casualt|killed|dead|victim|died/i);
  });

  describe('beside the ring’s own lines', () => {
    const ring = (): WarEvent[] => {
      let id = 0;
      return [
        // The race's first stages: only the ring has them.
        ev(++id, { kind: 'race', a: 1, b: 0, at: T0 - 5 * H, text: raceLine(1, 'Adaville')! }),
        ev(++id, { kind: 'race', a: 1, b: 0, at: T0 - 4 * H, text: raceLine(4, 'Adaville')! }),
        ...record.map((m) => ringLine(++id, m)),
        ev(++id, { kind: 'race', a: 2, b: 0, at: T0 + 2 * H + 1000, text: raceLine(6, 'Samford')! }),
        ev(++id, { kind: 'battle', a: 1, b: 2, at: T0 + 4 * H, text: 'Adaville raided Samford' }),
      ];
    };

    it('does not draw a moment twice: the ring keeps what the record has not', () => {
      const left = withoutAtomRecord(ring(), record);
      // Both bomb lines and the “has the atom bomb” lines of the record are gone from the list ...
      expect(left.filter((e) => e.kind === 'bomb')).toEqual([]);
      expect(left.filter((e) => e.kind === 'race').map((e) => e.text)).toEqual([
        raceLine(1, 'Adaville'),
        raceLine(4, 'Adaville'),
        raceLine(6, 'Samford'),
      ]);
      // ... the rest of the history stays as it was.
      expect(left.find((e) => e.kind === 'battle')).toBeDefined();
      // Each moment is in the block or the rows, once.
      const rows = historyRows(left, []).map((r) => r.text);
      const block = lines().map((l) => l.text.replace(/, the first in the region$/, ''));
      for (const t of block) expect(rows).not.toContain(t);
      expect(rows).not.toContain(bombLine('stopped', 'Kitton'));
    });

    it('the room reads its clock twice for a moment, so a second apart is the same moment', () => {
      const m = mark('boom', 2, T0);
      const near = ringLine(1, m, { at: T0 + 40 });
      expect(withoutAtomRecord([near], [m])).toEqual([]);
      // A minute apart is another bomb of the same city.
      const later = ringLine(2, m, { at: T0 + 60_000 });
      expect(withoutAtomRecord([later], [m])).toEqual([later]);
    });

    it('keeps a line whose mark the record no longer holds, or that is about another city', () => {
      const lost = ringLine(1, mark('stopped', 3, T0 + 5 * H));
      expect(withoutAtomRecord([lost], record)).toEqual([lost]);
      const other = ringLine(2, mark('boom', 1, record[3]!.at));
      expect(withoutAtomRecord([other], record)).toEqual([other]);
      // A fired line is told apart by its target as well: Samford's, not Kitton's.
      const wrongTarget = ringLine(3, mark('fired', 1, record[2]!.at, { to: 3 }));
      expect(withoutAtomRecord([wrongTarget], record)).toEqual([wrongTarget]);
    });

    it('leaves the list it was given alone, and is the same list with no record', () => {
      const events = ring();
      const copy = structuredClone(events);
      withoutAtomRecord(events, record);
      expect(events).toEqual(copy);
      expect(withoutAtomRecord(events, [])).toEqual(events);
      expect(withoutAtomRecord(events, [])).not.toBe(events);
    });

    it('the block is still there when the ring has moved on: 101 later events evict every bomb line', () => {
      const later = Array.from({ length: 101 }, (_, k) =>
        ev(100 + k, { kind: 'battle', a: 1, b: 2, at: T0 + 100 * H + k * 1000, text: `later ${k}` }),
      );
      const full = mergeHistory(ring(), later);
      // The ring keeps its 100 newest: none of the bomb's lines, nor the race's.
      expect(full).toHaveLength(FRIENDS.history);
      expect(full.some((e) => e.kind === 'bomb' || e.kind === 'race')).toBe(false);
      expect(historyRows(full, []).some((r) => r.group === 'atom')).toBe(false);
      // The record is the room's, outside the ring: the block still says all five moments.
      expect(withoutAtomRecord(full, record)).toEqual(full);
      expect(lines().map((l) => l.kind)).toEqual(['stopped', 'boom', 'fired', 'ready', 'ready']);
      expect(lines()[4]!.text).toBe('Adaville has the atom bomb, the first in the region');
    });
  });
});
