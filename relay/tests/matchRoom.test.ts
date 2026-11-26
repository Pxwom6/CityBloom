import { describe, expect, it } from 'vitest';
import {
  MemoryRegionStore,
  RegionRoom,
  type RegionConn,
  type RegionRoomMsg,
  type RegionView,
} from '../region';
import { PROTOCOL_VERSION } from '../protocol';
import { matchEndTick, type MatchResult } from '../match';
import { MATCH, defaultMatch, type MatchSettings } from '../../src/data/match';
import { FakeClock } from './harness';

/**
 * M43: a quick match in the region room. The room keeps the clock (a countdown, then the timer),
 * counts each city's figures only within the ticks the time allows, ends a Race at the target, waits
 * for the cities' last reports and decides one result that every page is sent; a player who leaves is
 * out and the match goes on; an online host who goes hands over; a rematch starts the next round on a
 * new seed by itself once every city has founded again.
 */

interface Raw {
  got: RegionRoomMsg[];
  conn: RegionConn;
  slot: number;
  say(m: object): void;
}

function raw(room: RegionRoom): Raw {
  const r: Raw = {
    got: [],
    slot: 0,
    conn: null as unknown as RegionConn,
    say: (m) => room.message(r.conn, JSON.stringify(m)),
  };
  r.conn = { send: (m) => r.got.push(m), close: () => undefined };
  room.open(r.conn);
  return r;
}

const TPS = 24;
const MAYORS = ['Ada', 'Bo', 'Cy', 'Di'];

function hello(room: RegionRoom, k: number, extra: object = {}, v = PROTOCOL_VERSION): Raw {
  const r = raw(room);
  r.say({ t: 'rhello', v, mayor: MAYORS[k], color: k, city: `${MAYORS[k]}ton`, ...extra });
  const w = r.got.find((m) => m.t === 'rwelcome') as { slot: number } | undefined;
  r.slot = w?.slot ?? 0;
  return r;
}

const view = (r: Raw): RegionView =>
  (r.got.filter((m) => m.t === 'region' || m.t === 'rwelcome').at(-1) as { region: RegionView }).region;

function report(
  r: Raw,
  f: { population: number; tick: number; treasury?: number; assets?: number; approval?: number },
  extra: { round?: number; reached?: number; final?: true; hash?: string; thumb?: string } = {},
) {
  const { thumb, ...more } = extra;
  r.say({
    t: 'report',
    city: `${MAYORS[r.slot - 1] ?? 'X'}ton`,
    report: {
      population: f.population,
      kind: 'suburb',
      workers: 0,
      jobs: 0,
      shoppers: 0,
      offers: { buy: { power: 0, water: 0, garbage: 0 }, sell: { power: 0, water: 0, garbage: 0 } },
      deals: [],
      projectBuilt: false,
      match: {
        tick: f.tick,
        treasury: f.treasury ?? 100_000,
        assets: f.assets ?? 0,
        approval: f.approval ?? 50,
        round: 1,
        ...more,
      },
    },
    ...(thumb ? { thumb } : {}),
  });
}

function match(settings: Partial<MatchSettings> = {}, players = 2, opts: { kind?: 'local' | 'p2p' } = {}) {
  const clock = new FakeClock();
  const store = new MemoryRegionStore();
  const room = new RegionRoom('7MATCH', opts.kind ?? 'local', store, clock, { testMatches: true });
  const s: MatchSettings = { ...defaultMatch('mabc12'), minutes: 15, ...settings };
  const cities = [hello(room, 0, { create: { name: 'Quick match', match: s } })];
  for (let k = 1; k < players; k++) cities.push(hello(room, k));
  return { clock, store, room, cities, s };
}

const ready = (rs: Raw[], round = 1) => rs.forEach((r) => r.say({ t: 'mready', round }));
const result = (r: Raw): MatchResult | undefined => view(r).match?.result;

/** Start the match and run the countdown out. */
function play(w: ReturnType<typeof match>) {
  ready(w.cities);
  w.cities[0]!.say({ t: 'mstart' });
  w.clock.advance(MATCH.countdownMs);
}

describe('M43 a quick match in the region room', () => {
  it('runs a lobby, a countdown and a timer, and decides one result every page is sent', () => {
    const w = match({ mode: 'rich' }, 4);
    const [a, b, c, d] = w.cities;
    expect(view(a!).match).toMatchObject({
      phase: 'lobby',
      round: 1,
      settings: { mode: 'rich', seed: 'mabc12' },
    });
    // The host can't start while a city is still founding.
    ready([a!, b!, c!]);
    a!.say({ t: 'mstart' });
    expect(a!.got.at(-1)).toMatchObject({ t: 'notice', text: 'A player is still founding their city' });
    expect(view(a!).match!.phase).toBe('lobby');
    // Only the host starts it.
    ready([d!]);
    b!.say({ t: 'mstart' });
    expect(view(b!).match!.phase).toBe('lobby');
    a!.say({ t: 'mstart' });
    expect(view(b!).match).toMatchObject({ phase: 'countdown', startIn: MATCH.countdownMs });
    expect(view(b!).match!.endsIn).toBe(MATCH.countdownMs + 15 * 60_000);
    // The timer (where the room has one) starts the clock.
    w.clock.advance(MATCH.countdownMs);
    expect(view(c!).match!.phase).toBe('playing');
    // Five minutes in: each city reports; one claims a tick the time doesn't allow and isn't counted.
    w.clock.advance(5 * 60_000);
    const t = 5 * 60 * TPS;
    report(a!, { population: 3000, tick: t, treasury: 400_000 });
    report(b!, { population: 4000, tick: t - 50, treasury: 300_000 });
    report(c!, { population: 2000, tick: t, treasury: 200_000, assets: 300_000 });
    report(d!, { population: 9000, tick: t + MATCH.slackTicks + 10, treasury: 9_000_000 });
    const scores = d!.got.filter((m) => m.t === 'mscores').at(-1) as Extract<RegionRoomMsg, { t: 'mscores' }>;
    expect(scores.rows.map((r) => r.slot).sort()).toEqual([1, 2, 3]);
    // Each line says how long is left by the room's clock (a page that started late catches up to it).
    expect(scores.left).toBe(10 * 60_000);
    // A late message (an older tick than counted) doesn't move the figures back.
    report(a!, { population: 10, tick: t - 100, treasury: 1 });
    // The timer ends: the room waits for the last reports (each with its hash).
    w.clock.advance(10 * 60_000);
    expect(view(a!).match).toMatchObject({ phase: 'final', endedBy: 'time' });
    const end = matchEndTick(w.s);
    report(a!, { population: 5000, tick: end, treasury: 700_000 }, { final: true, hash: 'aaaa' });
    report(b!, { population: 6000, tick: end, treasury: 650_000 }, { final: true, hash: 'bbbb' });
    report(
      c!,
      { population: 4000, tick: end, treasury: 200_000, assets: 600_000 },
      { final: true, hash: 'cccc' },
    );
    expect(view(a!).match!.phase).toBe('final');
    report(d!, { population: 1, tick: end, treasury: 1 }, { final: true, hash: 'dddd' });
    // Every city's last report is in: decided at once.
    const r = result(a!)!;
    expect(r).toBeDefined();
    expect(r.winner).toBe(3);
    expect(r.rows.map((x) => x.slot)).toEqual([3, 1, 2, 4]);
    expect(r.rows.map((x) => x.hash)).toEqual(['cccc', 'aaaa', 'bbbb', 'dddd']);
    expect(r.rows[0]).toMatchObject({ score: 800_000, final: true, name: 'Cyton' });
    // The chart: the value every so often, holes carried forward.
    expect(r.samples[1]!.length).toBe(MATCH.samples);
    expect(r.samples[1]![20]).toBe(400_000);
    expect(r.samples[1]!.at(-1)).toBe(700_000);
    // Every page has the same result.
    for (const x of w.cities) expect(JSON.stringify(result(x))).toBe(JSON.stringify(r));
    expect(a!.got.some((m) => m.t === 'notice' && m.text === 'Cyton won the match')).toBe(true);
  });

  it('doesn’t wait for ever for a city’s last report', () => {
    const w = match({ mode: 'happy' }, 2);
    const [a, b] = w.cities;
    play(w);
    report(a!, { population: 2500, tick: 100, approval: 60 });
    report(b!, { population: 1500, tick: 100, approval: 95 });
    w.clock.advance(15 * 60_000);
    report(a!, { population: 2500, tick: matchEndTick(w.s), approval: 61 }, { final: true, hash: 'a1' });
    expect(result(a!)).toBeUndefined();
    w.clock.advance(MATCH.finalWaitMs);
    const r = result(a!)!;
    // Under the minimum population, a happier town still can't win Happy town.
    expect(r.winner).toBe(1);
    expect(r.rows[1]).toMatchObject({ slot: 2, final: false, score: 0 });
    expect(r.rows[1]!.hash).toBeUndefined();
  });

  it('ends a Race when a city reaches the target, and the earliest tick wins', () => {
    const w = match({ mode: 'race', target: 5_000 }, 3);
    const [a, b, c] = w.cities;
    play(w);
    w.clock.advance(4 * 60_000);
    report(a!, { population: 4_000, tick: 4 * 60 * TPS });
    expect(view(a!).match!.phase).toBe('playing');
    report(b!, { population: 5_200, tick: 4 * 60 * TPS - 20 }, { reached: 4 * 60 * TPS - 100 });
    expect(view(a!).match).toMatchObject({ phase: 'final', endedBy: 'race' });
    // Cyton crossed earlier, but its report came after Bo's: the earlier tick wins.
    report(
      c!,
      { population: 5_050, tick: 4 * 60 * TPS },
      { reached: 4 * 60 * TPS - 300, final: true, hash: 'c' },
    );
    report(a!, { population: 4_100, tick: 4 * 60 * TPS + 10 }, { final: true, hash: 'a' });
    report(b!, { population: 5_300, tick: 4 * 60 * TPS }, { final: true, hash: 'b' });
    const r = result(a!)!;
    expect(r.endedBy).toBe('race');
    expect(r.winner).toBe(3);
    expect(r.rows.map((x) => x.slot)).toEqual([3, 2, 1]);
  });

  it('goes on when a player leaves, hands an online host’s role over, and ends when one is left', () => {
    const w = match({ mode: 'mixed' }, 3);
    const [a, b, c] = w.cities;
    play(w);
    report(c!, { population: 900, tick: 10 });
    // The host leaves: out, and the next city still in is the host.
    a!.say({ t: 'mleave' });
    w.room.closed(a!.conn);
    expect(view(b!).host).toBe(2);
    expect(view(b!).match).toMatchObject({
      phase: 'playing',
      players: [{ slot: 1, out: true }, { slot: 2 }, { slot: 3 }],
    });
    expect(b!.got.some((m) => m.t === 'notice' && m.text === 'Boton is the host now')).toBe(true);
    // Bo leaves too: Cy is alone, and wins.
    b!.say({ t: 'mleave' });
    expect(view(c!).match).toMatchObject({ phase: 'final', endedBy: 'alone' });
    report(c!, { population: 1000, tick: 30 }, { final: true, hash: 'cc' });
    const r = result(c!)!;
    expect(r.winner).toBe(3);
    expect(
      r.rows
        .filter((x) => x.out)
        .map((x) => x.slot)
        .sort(),
    ).toEqual([1, 2]);
  });

  it('keeps an online host’s part through a reload, and passes it on after a minute away', () => {
    const w = match({}, 3);
    const [a, b] = w.cities;
    play(w);
    // The host's page goes (a reload): still the host meanwhile.
    w.room.closed(a!.conn);
    w.clock.advance(MATCH.hostGraceMs - 1_000);
    expect(view(b!).host).toBe(1);
    // Back in time: the part stays.
    const back = hello(w.room, 0, {
      rejoin: { slot: 1, secret: (a!.got.find((m) => m.t === 'rwelcome') as { secret: string }).secret },
    });
    expect(back.slot).toBe(1);
    w.clock.advance(MATCH.hostGraceMs);
    expect(view(b!).host).toBe(1);
    // Gone for good: after the grace, the next city still in is the host.
    w.room.closed(back.conn);
    w.clock.advance(MATCH.hostGraceMs);
    expect(view(b!).host).toBe(2);
  });

  it('keeps a peer-to-peer host’s role (the room lives in its browser)', () => {
    const w = match({}, 3, { kind: 'p2p' });
    play(w);
    w.room.closed(w.cities[0]!.conn);
    expect(view(w.cities[1]!).host).toBe(1);
  });

  it('plays a rematch on a new seed, starting by itself once every city has founded again', () => {
    const w = match({ mode: 'race' }, 3);
    const [a, b, c] = w.cities;
    play(w);
    c!.say({ t: 'mleave' });
    w.clock.advance(15 * 60_000);
    report(a!, { population: 7000, tick: matchEndTick(w.s) }, { final: true, hash: 'x' });
    report(b!, { population: 8000, tick: matchEndTick(w.s) }, { final: true, hash: 'y' });
    expect(result(a!)!.winner).toBe(2);
    // Only the host asks for a rematch; changes come with it (the seed is the room's).
    b!.say({ t: 'mnext' });
    expect(view(a!).match!.phase).toBe('over');
    a!.say({ t: 'mnext', settings: { ...w.s, mode: 'rich', seed: 'chosen' } });
    const m = view(b!).match!;
    expect(m).toMatchObject({ phase: 'lobby', round: 2, auto: true, settings: { mode: 'rich' } });
    expect(m.settings.seed).not.toBe('mabc12');
    expect(m.settings.seed).not.toBe('chosen');
    expect(m.result).toBeUndefined();
    // Cy left: it's no longer in the region at all, and its place is free.
    expect(view(b!).cities.map((x) => x.slot)).toEqual([1, 2]);
    expect(view(b!).cities.every((x) => x.report === null && !x.visitable)).toBe(true);
    // A report for the old round counts nothing.
    report(a!, { population: 9, tick: 0 }, { round: 1 });
    expect(view(a!).match!.phase).toBe('lobby');
    // A newcomer may join the lobby; once every city here is ready, the countdown starts by itself.
    const d = hello(w.room, 3);
    expect(d.slot).toBe(4);
    ready([a!, b!], 2);
    expect(view(a!).match!.phase).toBe('lobby');
    ready([d], 2);
    expect(view(a!).match).toMatchObject({ phase: 'countdown', round: 2 });
    w.clock.advance(MATCH.countdownMs);
    expect(view(d).match!.phase).toBe('playing');
  });

  it('waits for every player of a rematch to come back, then a minute at most', () => {
    const w = match({ mode: 'rich' }, 3);
    const [a, b, c] = w.cities;
    play(w);
    w.clock.advance(15 * 60_000);
    for (const r of [a!, b!, c!])
      report(r, { population: 10, tick: matchEndTick(w.s) }, { final: true, hash: 'h' });
    a!.say({ t: 'mnext' });
    // Two pages are back with their new cities; the third is still reloading (not connected).
    w.room.closed(c!.conn);
    ready([a!, b!], 2);
    expect(view(a!).match!.phase).toBe('lobby');
    // A minute on, the two start without it; it's out of this round.
    w.clock.advance(MATCH.rematchWaitMs);
    expect(view(a!).match).toMatchObject({ phase: 'countdown', round: 2 });
    expect(view(a!).match!.players.find((p) => p.slot === 3)).toMatchObject({ out: true });
  });

  it('turns away a late joiner, an older page, and a one-minute match outside tests', () => {
    const w = match({}, 2);
    play(w);
    const late = hello(w.room, 2);
    expect(late.got.at(-1)).toMatchObject({ t: 'error', code: 'full' });
    // A visitor may still look.
    const look = hello(w.room, 2, { visitor: true });
    expect(view(look).match!.phase).toBe('playing');
    // A page on protocol 7 can't take part in a match, but still joins an ordinary region.
    const old = hello(w.room, 3, {}, 7);
    expect(old.got.at(-1)).toMatchObject({ t: 'error', code: 'version' });
    const plain = new RegionRoom('7PLAIN', 'local', new MemoryRegionStore(), new FakeClock());
    const p7 = hello(plain, 0, { create: { name: 'Vale' } }, 7);
    expect(p7.slot).toBe(1);
    expect(view(p7).match).toBeUndefined();
    // One minute is for test builds' relays only.
    const online = new RegionRoom('7ONLIN', 'online', new MemoryRegionStore(), new FakeClock());
    const one = hello(online, 0, { create: { name: 'Q', match: { ...defaultMatch('mabc12'), minutes: 1 } } });
    expect(one.got.at(-1)).toMatchObject({ t: 'error', code: 'bad-message' });
    // And no war in a match, whatever the hello says.
    const war = new RegionRoom('7WARMA', 'online', new MemoryRegionStore(), new FakeClock());
    const h = hello(war, 0, {
      create: { name: 'Q', rules: { war: true, scale: 'war' }, match: defaultMatch('mabc12') },
    });
    expect(view(h).rules.war).toBe(false);
    h.say({ t: 'rrules', rules: { war: true, scale: 'war' } });
    expect(view(h).rules.war).toBe(false);
  });

  it('passes emotes on (one every two seconds a player) and chat only when the host allows it', () => {
    const w = match({ chat: false }, 2);
    const [a, b] = w.cities;
    a!.say({ t: 'emote', e: 2 });
    a!.say({ t: 'emote', e: 3 });
    expect(b!.got.filter((m) => m.t === 'memote')).toEqual([{ t: 'memote', from: 1, e: 2 }]);
    w.clock.advance(MATCH.emoteEveryMs);
    a!.say({ t: 'mchat', text: 'hello' });
    expect(b!.got.some((m) => m.t === 'mchat')).toBe(false);
    a!.say({ t: 'mset', settings: { ...w.s, chat: true, mode: 'happy', seed: 'other' } });
    expect(view(b!).match!.settings).toMatchObject({ chat: true, mode: 'happy', seed: 'mabc12' });
    b!.say({ t: 'mchat', text: '  good luck\u0007 ' });
    expect(a!.got.filter((m) => m.t === 'mchat')).toEqual([{ t: 'mchat', from: 2, text: 'good luck' }]);
    // An emote that isn't one of the fixed ones closes nothing but is refused as unreadable.
    b!.say({ t: 'emote', e: 99 });
    expect(b!.got.at(-1)).toMatchObject({ t: 'error', code: 'bad-message' });
  });

  it('writes a handful of rows a match, and sends score lines rather than the whole region', () => {
    const w = match({ mode: 'mixed' }, 4);
    const rows0 = w.store.rowsWritten;
    play(w);
    const thumb = 'data:image/jpeg;base64,' + 'A'.repeat(30_000);
    const views0 = w.cities[1]!.got.filter((m) => m.t === 'region').length;
    for (let s = 5; s <= 15 * 60; s += 5) {
      w.clock.advance(5_000);
      for (const r of w.cities)
        report(r, { population: s * 10, tick: s * TPS }, s % 60 === 0 ? { thumb: thumb + s } : {});
    }
    w.clock.advance(1_000);
    for (const r of w.cities)
      report(r, { population: 9_000, tick: matchEndTick(w.s) }, { final: true, hash: `h${r.slot}` });
    expect(result(w.cities[0]!)).toBeDefined();
    const views = w.cities[1]!.got.filter((m) => m.t === 'region').length - views0;
    const lines = w.cities[1]!.got.filter((m) => m.t === 'mscores').length;
    // A score line for each counted report; the whole view about once a minute a city (its picture).
    expect(lines).toBeGreaterThan(600);
    expect(views).toBeLessThan(4 * 16 + 10);
    expect(w.store.rowsWritten - rows0).toBeLessThan(15);
  });
});
