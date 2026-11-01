import { describe, expect, it } from 'vitest';
import { bombLine, raceLine } from '../../src/data/atom';
import { atomEventNotice, raceNotice } from '../../src/client/atomNotices';

/**
 * M40 step 10 review: what the page says of the bomb. `Game.notice` collapses repeats of one kind for a
 * minute (keeping the first text) and toasts a kind at most once in twenty seconds, so a kind has to
 * stand for one thing said; and the region's race lines are notices of their own, not a plain toast.
 */
describe('the city’s own bomb events', () => {
  it('give a held launch a notice for each reason, and one for a reason said again', () => {
    const held = (why: string, id = 7) =>
      atomEventNotice({ kind: 'launchHeld', id, info: { to: 'Samford', why } })!;
    const still = held('Adaville’s launch is still being prepared: the region waits 3 minutes more');
    const away = held('Samford’s player is not here: the bomb waits');
    // Two refusals in a row are two things to read: they do not share a kind (and so a log line and a toast).
    expect(still.kind).not.toBe(away.kind);
    expect(still.text).toContain('still being prepared');
    expect(away.text).toContain('is not here');
    // The same reason again is the same thing said (it collapses to a count); and says the city must send it.
    expect(held('Samford’s player is not here: the bomb waits').kind).toBe(away.kind);
    expect(away.text).toMatch(/stays in the silo until it is sent again/);
    expect(away.tone).toBe('bad');
    // Another neighbour's refusal is another notice.
    expect(held('Samford’s player is not here: the bomb waits', 9).kind).not.toBe(away.kind);
  });

  it('keep the strike put to the room and the bomb gone as they were, and ignore any other event', () => {
    expect(atomEventNotice({ kind: 'strikeSent', id: 3, info: { to: 'Samford' } })).toEqual({
      kind: 'strike:3',
      text: 'The atom bomb is with the region’s room, which has to agree to the strike on Samford.',
      tone: 'info',
    });
    expect(atomEventNotice({ kind: 'bombFired', id: 3, info: { to: 'Samford' } })).toEqual({
      kind: 'fired:3',
      text: 'The atom bomb has left the silo for Samford.',
      tone: 'bad',
    });
    for (const kind of ['fire', 'closed', 'bombWarning', 'rivalBomb'])
      expect(atomEventNotice({ kind, id: 1 }), kind).toBeNull();
  });
});

describe('the region’s lines about the race', () => {
  it('are notices of their own: the plant, fuel, silo and bomb being built are news, the bomb in hand and a launch are red alerts', () => {
    for (const stage of [1, 2, 3, 4, 5, 6]) {
      const text = raceLine(stage, 'Adaville')!;
      const n = raceNotice(text);
      expect(n, text).toMatchObject({ text, tone: stage >= 5 ? 'bad' : 'info' });
      // Each line has a kind of its own, so the log keeps it and the toast is not held back by another's.
      expect(n!.kind).toBe(`race:${text}`);
    }
    expect(raceNotice(raceLine(5, 'Adaville')!)!.kind).not.toBe(raceNotice(raceLine(5, 'Samford')!)!.kind);
  });

  it('give a bomb fired or fallen a red alert, and a dome that stopped one news', () => {
    for (const text of [
      bombLine('fired', 'Adaville'),
      bombLine('fired', 'Adaville', 'Samford'),
      bombLine('boom', 'Samford'),
    ])
      expect(raceNotice(text), text).toMatchObject({ tone: 'bad' });
    expect(raceNotice(bombLine('stopped', 'Samford'))).toMatchObject({ tone: 'info' });
  });

  it('leave every other notice of the room alone', () => {
    for (const text of [
      'Reconnecting to the region…',
      'Back in the region',
      'A spy from Adaville was caught in Samford',
      'Samford has joined the region',
      raceLine(7, 'Adaville') ?? 'none',
      ' has the atom bomb',
      '',
    ])
      expect(raceNotice(text), text).toBeNull();
  });
});
