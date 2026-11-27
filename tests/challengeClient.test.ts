import { describe, expect, it } from 'vitest';
import { groupCode, packRun, timeLeftWords, unpackRun } from '../src/client/challenge';
import type { RunEntry } from '../src/sim/runReplay';
import { ordinal } from '../src/ui/Challenge';

/**
 * M44: the page's side of the weekly challenge. A run packs small for the board and comes back whole;
 * a friend's group code is read as room codes are (look-alikes too); time left and places read well.
 */
describe('M44 the challenge on the page', () => {
  it('packs a run and gets it back whole', async () => {
    const entries: RunEntry[] = [];
    for (let i = 0; i < 2000; i++)
      entries.push(
        i % 50 === 0
          ? { tick: i * 30, settle: true }
          : {
              tick: i * 30,
              cmd: {
                type: 'buildRoad',
                road: 'street',
                points: [
                  { x: i, z: 3 },
                  { x: i + 100, z: 3 },
                ],
              },
            },
      );
    const packed = await packRun(entries, 70_000);
    expect(packed).toMatch(/^[A-Za-z0-9+/=]+$/);
    // Commands repeat a lot: gzip packs them well under the board's limit.
    expect(packed.length).toBeLessThan(JSON.stringify(entries).length / 5);
    expect(await unpackRun(packed)).toEqual({ v: 1, entries, end: 70_000 });
    expect(await unpackRun('not a run')).toBeNull();
    expect(await unpackRun(btoa('{"v":1}'))).toBeNull();
  });

  it('reads a group code as room codes are read', () => {
    expect(groupCode(' abc-234 ')).toEqual({ code: 'ABC234' });
    expect(groupCode('ab')).toEqual({ why: 'A group code is six letters and numbers' });
  });

  it('says time left and places in words', () => {
    const M = 60_000;
    expect(timeLeftWords(3 * 1440 * M + 4 * 60 * M + 30 * M)).toBe('3 days 4 hours');
    expect(timeLeftWords(5 * 60 * M + 10 * M)).toBe('5 hours 10 minutes');
    expect(timeLeftWords(60 * M)).toBe('1 hour');
    expect(timeLeftWords(12 * M)).toBe('12 minutes');
    expect(timeLeftWords(10_000)).toBe('less than a minute');
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
      '111th',
    ]);
  });
});
