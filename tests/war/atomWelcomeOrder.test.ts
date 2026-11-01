/**
 * The region's word on the bomb arrives in the order the room sent it (M40 step 13). The room sends a
 * city's welcome with the bomb's record and the winters it is to have had; the city's report then makes the
 * room add to both and send them again whole (`{t:'atoms'}`, `{t:'winters'}`); that newer message comes in
 * while the welcome handler of `RegionLink` is still waiting for the city's save. The welcome's older copy
 * must never be put over it. Here the room is played by hand against a link whose save waits for the test,
 * so the order of the words is exact; `atomWelcome.test.ts` is the same defect through a real room.
 */
import { afterEach, expect, it } from 'vitest';
import type { RegionAtomMark, RegionRoomMsg, RegionView, RegionWinter } from '../../relay/region';
import { AtomRegion } from '../../src/client/atomRegion';
import type { Command } from '../../src/sim/commands';
import { ok } from '../../src/sim/commands';
import { RegionLink, type CityPort } from '../../src/net/regionLink';
import type { Link } from '../../src/net/link';
import type { SaveFile } from '../../src/sim/save';

const flush = async (n = 6) => {
  for (let k = 0; k < n; k++) await new Promise((r) => setTimeout(r, 0));
};

const VIEW = {
  code: '7WELCM',
  name: 'Two Rivers',
  kind: 'local',
  cities: [],
  project: { name: 'Project', goal: 1, total: 0, by: {}, funded: false, host: 0, built: false, power: 0 },
  host: 1,
  rules: { war: true, scale: 'total', supers: true, bomb: true },
} as unknown as RegionView;

const mark = (slot: number, kind: RegionAtomMark['kind'], at: number): RegionAtomMark => ({
  slot,
  name: `City ${slot}`,
  kind,
  at,
});

/** Samford is slot 3; the winters name it among the cities chilled. */
const winter = (id: string): RegionWinter => ({ id, at: 1, slots: [1, 3] });

interface Page {
  link: RegionLink;
  atom: AtomRegion;
  commands: Command[];
  /** The room's word to the page. */
  say(m: RegionRoomMsg): void;
  /** The city's save finishes (it has been waited for since the report was sent). */
  release(): void;
  started: Promise<void>;
}

const open: RegionLink[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.leave().catch(() => undefined);
});

/** A page whose welcome handler waits for the city's save, which the test releases. */
async function page(): Promise<Page> {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const commands: Command[] = [];
  const port: CityPort = {
    command: async () => ok(0),
    report: async () => ({}) as never,
    save: async () => {
      await gate;
      return {} as SaveFile;
    },
    cityName: () => 'Samford',
  };
  const wire: Link = { send: () => undefined, close: () => undefined, onmessage: null, onclose: null };
  const link = new RegionLink(port, async () => wire, {
    mayor: 'Sam',
    color: 1,
    saveEvery: 0,
    fairClock: false,
    reportEvery: 1_000_000,
  });
  open.push(link);
  const atom = new AtomRegion({
    command: async (cmd) => {
      commands.push(cmd);
      return ok(0);
    },
    now: () => 0,
    changed: () => undefined,
  });
  atom.attach(link);
  const started = link.start();
  await flush();
  return {
    link,
    atom,
    commands,
    say: (m) => wire.onmessage?.(JSON.stringify(m)),
    release,
    started,
  };
}

const welcome = (o: { atoms?: RegionAtomMark[]; winters?: RegionWinter[] }): RegionRoomMsg => ({
  t: 'rwelcome',
  slot: 3,
  secret: 's3',
  region: VIEW,
  ...o,
});

const names = (marks: RegionAtomMark[]) => marks.map((m) => `${m.slot}:${m.kind}`);

it('keeps the room’s newer record when it arrives while the welcome waits for the city’s save', async () => {
  const p = await page();
  const older = [mark(1, 'ready', 10), mark(1, 'fired', 20)];
  p.say(welcome({ atoms: older }));
  await flush();
  // The city's report made the room mark the bomb that fell on this city, and say the whole record again.
  const newer = [...older, mark(3, 'boom', 30)];
  p.say({ t: 'atoms', atoms: newer });
  await flush();
  p.release();
  await p.started;
  await flush();
  expect(names(p.atom.atoms)).toEqual(names(newer));
});

it('keeps the room’s newer winters when they arrive while the welcome waits for the city’s save', async () => {
  const p = await page();
  p.say(welcome({ winters: [winter('1-1')] }));
  await flush();
  p.say({ t: 'winters', winters: [winter('1-1'), winter('2-1')] });
  await flush();
  p.release();
  await p.started;
  await flush();
  expect(p.atom.winters.map((w) => w.id)).toEqual(['1-1', '2-1']);
  // Each winter reached the city's sim once.
  const sent = p.commands.filter((c) => c.type === 'friendWinter').map((c) => (c as { id: string }).id);
  expect(sent.sort()).toEqual(['1-1', '2-1']);
});

it('still takes the welcome’s record and winters when nothing newer comes', async () => {
  const p = await page();
  const record = [mark(1, 'ready', 10), mark(1, 'fired', 20), mark(3, 'boom', 30)];
  p.say(welcome({ atoms: record, winters: [winter('1-1')] }));
  await flush();
  p.release();
  await p.started;
  await flush();
  expect(names(p.atom.atoms)).toEqual(names(record));
  expect(p.atom.winters.map((w) => w.id)).toEqual(['1-1']);
});

it('takes a later welcome (a return) as the record, whatever the page held before', async () => {
  const p = await page();
  p.say(welcome({ atoms: [mark(1, 'ready', 10)] }));
  await flush();
  p.release();
  await p.started;
  const later = [mark(1, 'ready', 10), mark(1, 'fired', 20)];
  // The link drops and comes back: its welcome says what the room holds now.
  p.say(welcome({ atoms: later }));
  await flush();
  expect(names(p.atom.atoms)).toEqual(names(later));
});

it('hears the first finisher’s word whenever it comes', async () => {
  const p = await page();
  p.say(welcome({ atoms: [mark(3, 'ready', 10)] }));
  await flush();
  p.say({ t: 'atomFirst', at: 11 });
  await flush();
  p.release();
  await p.started;
  await flush();
  expect(p.atom.first).toBe(true);
  expect(p.commands.filter((c) => c.type === 'atomFirst')).toHaveLength(1);
});
