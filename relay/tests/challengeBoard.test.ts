import { describe, expect, it } from 'vitest';
import { BOARD_LIMITS, ChallengeBoard } from '../challengeBoard';
import { challengeHttp } from '../challengeHttp';
import { nodeSql } from '../nodeSql';
import { challengeWeek, weekStart } from '../week';
import { challengeFor, challengeMaxScore } from '../../src/data/challenges';
import type { HttpRequest } from '../reportsHttp';

/**
 * M44: the weekly challenge's board. It takes a score it can't fault cheaply (the week, the score within
 * what the challenge gives, the run's length, the size, a name through the owner's filter, one every few
 * minutes) and keeps each player's best; shows the week's board and a group's; drops a run a page found
 * didn't replay (unless pages have found it right before, then it's the owner's to judge); lets the owner
 * remove and restore entries, pin a challenge and filter names; keeps this week and last.
 */
const KEY = 'owner-key-0123456789-abcdef';
const T = weekStart(46) + 2 * 86_400_000;

async function boardAt(limits: Partial<typeof BOARD_LIMITS> = {}) {
  const db = await nodeSql(':memory:');
  return new ChallengeBoard(db.sql, T, { ...BOARD_LIMITS, ...limits });
}

let n = 0;
const score = (o: Record<string, unknown> = {}) => ({
  week: 46,
  player: `player${String(n++).padStart(4, '0')}`,
  name: 'Ada',
  score: 3000,
  hash: '0a1b2c3d',
  end: 40_000,
  entries: 120,
  run: 'H4sIAAAAAAAAA6tWKkktLlGyUlAqS8wpTVWqBQBH2ztdEQAAAA==',
  ...o,
});

function req(
  method: string,
  path: string,
  o: { body?: unknown; key?: string; address?: string } = {},
): HttpRequest {
  const url = new URL(`http://x${path}`);
  return {
    method,
    path: url.pathname,
    query: url.searchParams,
    header: (name) => (name === 'authorization' && o.key ? `Bearer ${o.key}` : null),
    text: () => Promise.resolve(o.body === undefined ? '' : JSON.stringify(o.body)),
    address: o.address ?? '10.0.0.1',
  };
}

describe('M44 the weekly challenge board', () => {
  it('takes a score it can’t fault, and turns away what it can', async () => {
    const b = await boardAt();
    const ok = b.post(score(), 'a1', T);
    expect(ok).toMatchObject({ ok: true, rank: 1, best: true });
    expect(b.board(46, null).rows).toEqual([
      { id: expect.any(Number), rank: 1, name: 'Ada', score: 3000, checked: false, run: true },
    ]);
    expect(b.top(46)).toEqual({ name: 'Ada', score: 3000 });
    const max = challengeMaxScore(challengeFor(46));
    expect(b.post(score({ score: max + 1 }), 'a2', T)).toMatchObject({
      ok: false,
      why: 'That score isn’t one this challenge can give',
    });
    expect(b.post(score({ week: 45 }), 'a3', T)).toMatchObject({
      ok: false,
      why: 'That week’s challenge is over',
    });
    expect(b.post(score({ week: 47 }), 'a4', T)).toMatchObject({ ok: false });
    expect(b.post(score({ end: 10_000_000 }), 'a5', T)).toMatchObject({
      ok: false,
      why: 'That run is longer than the challenge',
    });
    expect(b.post(score({ run: 'x'.repeat(BOARD_LIMITS.runChars + 1) }), 'a6', T)).toMatchObject({
      ok: false,
      status: 413,
    });
    expect(b.post(score({ hash: 'nothex!!' }), 'a7', T)).toMatchObject({ ok: false });
    expect(b.post(score({ name: '' }), 'a8', T)).toMatchObject({ ok: false });
    // One score every few minutes from an address.
    expect(b.post(score(), 'a1', T + 1000)).toMatchObject({ ok: false, status: 429 });
    expect(b.post(score(), 'a1', T + BOARD_LIMITS.scoreEvery)).toMatchObject({ ok: true });
  });

  it('keeps a player’s best, and runs only for the best entries', async () => {
    const b = await boardAt({ runsKept: 2, perWeek: 3 });
    const me = score({ player: 'meplayer1', score: 2000 });
    b.post(me, 'x1', T);
    expect(b.post({ ...me, score: 1500 }, 'x2', T + 5 * 60_000)).toMatchObject({ ok: true, best: false });
    expect(b.board(46, null).rows[0]!.score).toBe(2000);
    expect(b.post({ ...me, score: 2600 }, 'x3', T + 10 * 60_000)).toMatchObject({ ok: true, best: true });
    expect(b.board(46, null).total).toBe(1);
    b.post(score({ score: 2500 }), 'y1', T);
    b.post(score({ score: 2400 }), 'y2', T);
    // Full (three a week here): a lower score doesn't get on; a higher one pushes the lowest off.
    expect(b.post(score({ score: 100 }), 'y3', T)).toMatchObject({
      ok: false,
      why: 'Not in this week’s top 500',
    });
    expect(b.post(score({ score: 2550 }), 'y4', T)).toMatchObject({ ok: true });
    const rows = b.board(46, null).rows;
    expect(rows.map((r) => r.score)).toEqual([2600, 2550, 2500]);
    expect(rows.map((r) => r.run)).toEqual([true, true, false]);
  });

  it('shows a group’s board among everyone’s', async () => {
    const b = await boardAt();
    b.post(score({ name: 'Kit', score: 4000 }), 'g1', T);
    b.post(score({ name: 'Sam', score: 3000, groups: ['abc234'] }), 'g2', T);
    b.post(score({ name: 'Lou', score: 2000, groups: ['ABC234', 'XYZ789'] }), 'g3', T);
    expect(b.board(46, null).rows.map((r) => r.name)).toEqual(['Kit', 'Sam', 'Lou']);
    expect(b.board(46, 'ABC234').rows.map((r) => [r.name, r.rank])).toEqual([
      ['Sam', 1],
      ['Lou', 2],
    ]);
    expect(b.post(score({ groups: ['not a code'] }), 'g4', T)).toMatchObject({ ok: false });
  });

  it('drops a run a page found didn’t replay, unless pages found it right before', async () => {
    const b = await boardAt();
    const forged = b.post(score({ name: 'Forger', score: 9000 }), 'f1', T) as { id: number };
    const honest = b.post(score({ name: 'Honest', score: 5000 }), 'f2', T) as { id: number };
    expect(b.verdict({ id: forged.id, ok: false }, 'v1', T)).toEqual({ ok: true, status: 'dropped' });
    expect(b.board(46, null).rows.map((r) => r.name)).toEqual(['Honest']);
    expect(b.run(forged.id)).toBeNull();
    // One address's verdicts count once: saying "yes" again doesn't make it trusted.
    const sock = b.post(score({ name: 'Sock', score: 4000 }), 'f3', T) as { id: number };
    for (let k = 0; k < 3; k++) b.verdict({ id: sock.id, ok: true }, 's1', T);
    expect(b.verdict({ id: sock.id, ok: false }, 's2', T)).toEqual({ ok: true, status: 'dropped' });
    for (const v of ['v2', 'v3']) b.verdict({ id: honest.id, ok: true }, v, T);
    expect(b.board(46, null).rows[0]).toMatchObject({ name: 'Honest', checked: true });
    // Two pages found it right: one saying otherwise only puts it in dispute (the owner judges).
    expect(b.verdict({ id: honest.id, ok: false }, 'v4', T)).toEqual({ ok: true, status: 'disputed' });
    expect(b.board(46, null).rows.map((r) => r.name)).toEqual(['Honest']);
    // Verdicts are limited per address.
    let last: { ok: boolean } = { ok: true };
    for (let k = 0; k < BOARD_LIMITS.verdicts.burst + 2; k++)
      last = b.verdict({ id: honest.id, ok: true }, 'spam', T);
    expect(last.ok).toBe(false);
  });

  it('turns over at the week’s change: last week’s results stay, older go; a late run within the hour', async () => {
    const b = await boardAt();
    b.post(score({ name: 'Old' }), 'r1', T);
    const monday = weekStart(47);
    expect(challengeWeek(monday)).toBe(47);
    // Just after the change, a run of last week still counts; an hour later it doesn't.
    expect(b.post(score({ week: 46, name: 'Late' }), 'r2', monday + 10 * 60_000)).toMatchObject({ ok: true });
    expect(b.post(score({ week: 46, name: 'Too late' }), 'r3', monday + 61 * 60_000)).toMatchObject({
      ok: false,
    });
    expect(b.post(score({ week: 47, name: 'New' }), 'r4', monday + 61 * 60_000)).toMatchObject({ ok: true });
    expect(b.board(46, null).rows.map((r) => r.name)).toEqual(['Old', 'Late']);
    // Two changes on, week 46 is gone.
    b.post(score({ week: 48, name: 'Newer' }), 'r5', weekStart(48) + 1000);
    expect(b.board(46, null).total).toBe(0);
    expect(b.board(47, null).total).toBe(1);
  });

  it('serves the board over HTTP, and the owner’s area only with the key', async () => {
    const b = await boardAt();
    const cur = await challengeHttp(req('GET', '/challenge/current'), b, KEY, T);
    expect(cur).toMatchObject({ status: 200, json: { week: 46, top: null } });
    const posted = await challengeHttp(
      req('POST', '/challenge/score', { body: score({ name: 'Pat' }) }),
      b,
      KEY,
      T,
    );
    expect(posted).toMatchObject({ status: 200, json: { ok: true } });
    const id = (posted!.json as { id: number }).id;
    expect(await challengeHttp(req('GET', '/challenge/board?week=46'), b, KEY, T)).toMatchObject({
      json: { total: 1 },
    });
    expect(await challengeHttp(req('GET', `/challenge/run?id=${id}`), b, KEY, T)).toMatchObject({
      status: 200,
      json: { name: 'Pat' },
    });
    expect(
      await challengeHttp(req('GET', '/owner/challenge', { key: 'wrong-key-0123456789' }), b, KEY, T),
    ).toMatchObject({ status: 401 });
    expect(await challengeHttp(req('GET', '/owner/challenge'), b, undefined, T)).toMatchObject({
      status: 503,
    });
    const owner = await challengeHttp(req('GET', '/owner/challenge?week=46', { key: KEY }), b, KEY, T);
    expect(owner).toMatchObject({ status: 200, json: { entries: [{ id, name: 'Pat', status: 'shown' }] } });
    // The owner removes it, and puts it back.
    await challengeHttp(
      req('POST', `/owner/challenge/entry/${id}`, { key: KEY, body: { action: 'remove' } }),
      b,
      KEY,
      T,
    );
    expect(b.board(46, null).total).toBe(0);
    await challengeHttp(
      req('POST', `/owner/challenge/entry/${id}`, { key: KEY, body: { action: 'restore' } }),
      b,
      KEY,
      T,
    );
    expect(b.board(46, null).total).toBe(1);
    // The word filter catches a name (letters only, any case).
    await challengeHttp(
      req('POST', '/owner/challenge/words', { key: KEY, body: { words: ['Bad Word', 'poo'] } }),
      b,
      KEY,
      T,
    );
    expect(b.words()).toEqual(['badword', 'poo']);
    expect(b.post(score({ name: 'Mr P.O.O.' }), 'w1', T)).toMatchObject({
      ok: false,
      why: 'That name can’t go on the board: choose another',
    });
    // A pin replaces the week's challenge (checked as any challenge is).
    const pin = { ...challengeFor(46), name: 'The owner’s special', months: 24 };
    expect(
      await challengeHttp(
        req('POST', '/owner/challenge/pin', { key: KEY, body: { week: 46, def: pin } }),
        b,
        KEY,
        T,
      ),
    ).toMatchObject({ status: 200 });
    expect(b.challenge(46)).toMatchObject({ name: 'The owner’s special', months: 24, pinned: true });
    expect(
      await challengeHttp(
        req('POST', '/owner/challenge/pin', { key: KEY, body: { week: 46, def: { name: 'broken' } } }),
        b,
        KEY,
        T,
      ),
    ).toMatchObject({ status: 400 });
  });
});
