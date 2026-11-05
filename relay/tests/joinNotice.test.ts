import { describe, expect, it } from 'vitest';
import { MemoryRegionStore, RegionRoom, type RegionConn } from '../region';
import { PROTOCOL_VERSION } from '../protocol';

/**
 * Phase 5 end: a city joining a region is told so once, by its own page ("Kitsbury joined the
 * region."), not a second time by the room; the cities already there hear it from the room.
 */
describe('the region’s word that a city joined', () => {
  it('goes to the cities already there, not to the one joining', () => {
    const room = new RegionRoom('RGNJNS', 'local', new MemoryRegionStore(), { now: () => 0 });
    const heard = new Map<string, string[]>();
    const join = (mayor: string, city: string, color: number, create = false) => {
      const said: string[] = [];
      heard.set(city, said);
      const conn: RegionConn = {
        send: (m) => {
          if (m.t === 'notice') said.push(m.text);
        },
        close: () => undefined,
      };
      room.open(conn);
      room.message(
        conn,
        JSON.stringify({
          t: 'rhello',
          v: PROTOCOL_VERSION,
          mayor,
          color,
          city,
          ...(create ? { create: { name: 'Three Rivers' } } : {}),
        }),
      );
    };
    join('Ada', 'Adaville', 0, true);
    join('Sam', 'Samford', 1);
    join('Kit', 'Kitsbury', 2);
    expect(heard.get('Adaville')).toEqual(
      expect.arrayContaining(['Samford joined the region', 'Kitsbury joined the region']),
    );
    expect(heard.get('Samford')).toContain('Kitsbury joined the region');
    for (const city of ['Adaville', 'Samford', 'Kitsbury'])
      expect(
        heard.get(city)!.filter((t) => t.startsWith(city)),
        `${city} told of its own joining`,
      ).toEqual([]);
  });
});
