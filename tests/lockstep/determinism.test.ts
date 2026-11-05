import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { SCENARIO } from '../../src/data/scenarios';
import { THROTTLES } from './atomSection';
import { runDeterminism, type DeterminismResult } from './determinism';
import { ALL_KINDS } from './scriptedTown';

/**
 * The cross-browser run's script, in Node (F13): it must issue every kind of command, or the
 * browsers never compare what that kind does. The cross-browser test checks the same, but only where
 * Playwright's browsers run; this keeps a new kind from slipping past the unit tests. Ten months
 * cover the script's every scripted month (the rest only grows the town).
 */
let played: DeterminismResult | undefined;
function run(): DeterminismResult {
  if (played) return played;
  const id = 'cleanslate';
  const save = decodeSave(new Uint8Array(readFileSync(`public/scenarios/${SCENARIO.get(id)!.save}`)));
  return (played = runDeterminism(10, { id, save }));
}

/** The JSON that follows a label in an atom entry (`impact {...}`, or the race's facts after a checksum). */
function after<T>(entry: string, from: string): T {
  return JSON.parse(entry.slice(entry.indexOf(from))) as T;
}

interface Blast {
  done: number;
  fled: number;
  levelled: number;
  lit?: number;
  fireAfter?: { d: number; id: number };
  over?: true;
}
/** The race's facts as a `mark` entry holds them. */
interface Facts {
  impact?: Blast;
}

describe('the cross-browser determinism script', () => {
  it('uses every kind of command', () => {
    expect(run().used).toEqual([...ALL_KINDS].sort());
  });

  // The same for the bomb among friends (M40 step 10), at the end of the friends section: every browser is
  // asked about a strike put to the region and turned away and kept, a cloud that is deposited from the
  // page's baseline whatever way the wind blows (and added to only past what was taken in), and a bomb from
  // the friend that starts its flight here once: not before its launch is reported, not twice from one city.
  it("the friends' entries hold the bomb among friends: a strike kept, a cloud taken in, a bomb coming", () => {
    const friends = run().friends;
    const all = friends.join('\n');
    expect(all).toMatch(/"op":"atom"/);
    expect(all).toMatch(/"fired":\{"tick":\d+,"to":\d+,"name":"Brookside","slot":2\}/);
    expect(all).toMatch(/"deposited":[1-9]/);
    // The cloud is never "waiting" for a wind, and a lower total sets nothing down: `seen` ends at the highest total.
    expect(all).not.toMatch(/"waiting":true/);
    expect(all).toMatch(/\{"2":97\.75\}/);
    expect(all).toMatch(/"inbound":\{"from":\d+,"name":"Brookside","slot":2/);
    expect(all).toMatch(/"id":"2-1","from":\d+,"depth":1/);
    const refused = run().refused;
    expect(refused).toContain('opResolve: A bomb is already on its way to the city');
    // Not taken until the friend's launch is reported, and a second bomb from one city is no bomb that city has.
    expect(refused).toContain(
      'opResolve: The region has not shown this city the launch and the total war that go with that strike',
    );
    expect(refused).toContain('opResolve: That city has fired its one atom bomb at this one already');
  });

  // What the browsers are asked to agree on has to be in the entries: a section that went green while the
  // blast was one slice and no fire was set would compare nothing about either (the strike's cap on a
  // slice and the fire ring's resumption are the code of those two).
  it("the atom section's entries hold the whole story, the blast in slices and the fires over ticks", () => {
    const atom = run().atom;
    const entry = (label: string) => atom.filter((e) => e.startsWith(`${label} `));
    const im = after<Blast>(entry('impact')[0]!, '{');
    expect(im.over).toBe(true);
    // Slices: more than one, each at most the cap, and the buildings levelled add up past one slice's worth.
    expect(im.done).toBeGreaterThan(1);
    expect(im.levelled).toBeGreaterThan(THROTTLES.slice);
    expect(im.levelled).toBeLessThanOrEqual(im.done * THROTTLES.slice);
    expect(im.fled).toBeGreaterThan(0);
    // The fire ring: lit over more than one tick, and the place it reached is kept.
    expect(im.lit).toBeGreaterThan(THROTTLES.firesPerTick);
    expect(im.fireAfter).toBeDefined();
    const lit = atom
      .filter((e) => /^blast\+\d+ /.test(e))
      .map((e) => after<Facts>(e, '{"fuel"').impact?.lit ?? 0);
    expect(lit.length).toBeGreaterThan(THROTTLES.firesPerTick);
    expect(lit.filter((n, k) => k > 0 && n > lit[k - 1]!).length).toBeGreaterThan(1);
    const levelled = atom
      .filter((e) => /^slice \d+ /.test(e))
      .map((e) => after<Facts>(e, '{"fuel"').impact?.levelled ?? 0);
    expect(levelled.length).toBeGreaterThan(1);
    expect(levelled.every((n, k) => k === 0 || n >= levelled[k - 1]!)).toBe(true);
    // The saboteurs: one caught and one through, in the entry that compares them.
    const spy = entry('spy')[0]!;
    expect(spy).toMatch(/was caught in/);
    expect(spy).toMatch(/atom bomb works: its race is put back/);
    // The dome stopped the first bomb, and the race ended with two bombs landed here and one stopped.
    expect(after<{ down: number }>(entry('dome')[1]!, '{').down).toBeGreaterThan(1000);
    const ended = after<[{ boom: number; stopped: number }, { stage: string }]>(entry('ended')[0]!, '[');
    expect(ended[0]).toMatchObject({ boom: 2, stopped: 1 });
    expect(ended[1].stage).toBe('spent');
  });
});
