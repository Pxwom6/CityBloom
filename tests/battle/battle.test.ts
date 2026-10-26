import { describe, expect, it } from 'vitest';
import { Battle } from '../../src/sim/battle/battle';
import { TAG } from '../../src/sim/battle/types';
import { input, lineLayout, TOWN, units } from './handmade';

/** M35: the battle simulation on hand-made layouts. */
describe('battles (M35)', () => {
  it('the same input plays out the same, every time', () => {
    const force = [...units('tank', 4), ...units('infantry', 4)];
    const make = () => input(lineLayout(TOWN), structuredClone(force));
    const a = Battle.run(make());
    const b = Battle.run(make());
    expect(a.outcome).not.toBeNull();
    expect(a.result()).toEqual(b.result());
    // Ticking (two steps a tick) gives the same as running straight through.
    const c = new Battle(make());
    const events: string[] = [];
    while (!c.outcome) for (const e of c.tick()) events.push(e.k);
    expect(c.result()).toEqual(a.result());
    expect(events.at(-1)).toBe('end');
  });

  it('a battle plays the same run straight through, ticked, or re-run from any step after a load', () => {
    // Partial hits that push losses past the stance's threshold without knocking anything out:
    // whether the battle checks on that step mustn't depend on when its events are drained.
    const bunkers = [0, 1].map((k) => ({
      id: 30 + k,
      tags: TAG.civic | TAG.military | TAG.defence,
      x: 600 + k * 40,
      z: 520,
      r: 6,
      hp: 600,
      gun: 3,
      range: 140,
      against: ['land' as const],
    }));
    let checked = 0;
    for (const stance of ['cautious', 'bold'] as const)
      for (let seed = 0; seed < 6; seed++) {
        const defenders = units('tank', 4, { x: 900, z: 540 }, 0);
        const force = [...units('tank', 3), ...units('artillery', 2), ...units('infantry', 4)];
        const make = () => {
          const i = input(
            lineLayout([...TOWN, ...bunkers], structuredClone(defenders), 1),
            structuredClone(force),
            {
              stance,
            },
          );
          i.seed = `drain-${seed}`;
          return i;
        };
        const straight = Battle.run(make()).result();
        const ticked = new Battle(make());
        const hashes = new Map<number, string>();
        while (!ticked.outcome) {
          ticked.tick();
          hashes.set(ticked.step, ticked.hash());
        }
        expect(ticked.result(), `${stance} ${seed}: ticked`).toEqual(straight);
        // A save at any tick: the battle is re-run to that step (as after a load), then ticked on.
        for (const [step, hash] of hashes) {
          if (step % 20 !== 0) continue;
          const again = new Battle(make());
          while (again.step < step && !again.outcome) again.stepOnce();
          again.drain();
          expect(again.hash(), `${stance} ${seed}: re-run to ${step}`).toBe(hash);
          while (!again.outcome) again.tick();
          expect(again.result(), `${stance} ${seed}: played on from ${step}`).toEqual(straight);
          checked++;
        }
      }
    expect(checked).toBeGreaterThan(50);
  });

  it('eight tanks knock out a bunker and wreck the depot', () => {
    const b = Battle.run(input(lineLayout(TOWN), units('tank', 8)));
    const r = b.result();
    expect(r.destroyed).toContain(11);
    expect(r.destroyed).toContain(10);
    expect(r.outcome).toBe('raided');
    expect(r.objectives.down).toBeGreaterThan(0);
  });

  it('two squads against four manned bunkers are beaten back', () => {
    const bunkers = [0, 1, 2, 3].map((k) => ({
      id: 30 + k,
      tags: TAG.civic | TAG.military | TAG.defence,
      x: 600 + k * 40,
      z: 520,
      r: 6,
      hp: 600,
      gun: 3,
      range: 120,
      against: ['land' as const],
    }));
    const b = Battle.run(input(lineLayout([...TOWN, ...bunkers]), units('infantry', 2), { stance: 'bold' }));
    const r = b.result();
    expect(r.outcome).not.toBe('raided');
    expect(r.destroyed).not.toContain(10);
    expect(r.units.filter((u) => u.side === 0 && u.out).length).toBeGreaterThan(0);
  });

  it('an unmanned bunker doesn’t fire', () => {
    const quiet = TOWN.map((s) => (s.id === 11 ? { ...s, manned: 0 } : s));
    const r = Battle.run(input(lineLayout(quiet), units('infantry', 3))).result();
    expect(r.units.filter((u) => u.side === 0 && u.out)).toHaveLength(0);
  });

  it('anti-air guns shoot at aircraft only', () => {
    const aa = [
      { id: 10, tags: TAG.civic | TAG.military, x: 900, z: 540, r: 20, hp: 900 },
      {
        id: 12,
        tags: TAG.civic | TAG.military | TAG.defence,
        x: 880,
        z: 600,
        r: 6,
        hp: 600,
        gun: 5,
        range: 320,
        against: ['air' as const],
      },
    ];
    const air = Battle.run(input(lineLayout(aa), units('helicopter', 3), { route: 'air' })).result();
    expect(air.units.some((u) => u.side === 0 && u.hp < 1)).toBe(true);
    const land = Battle.run(input(lineLayout(aa), units('tank', 3))).result();
    expect(land.units.filter((u) => u.side === 0).every((u) => u.hp === 1)).toBe(true);
  });

  it('defending tanks come out to meet the raiders', () => {
    const defenders = units('tank', 4, { x: 900, z: 540 }, 0);
    const r = Battle.run(input(lineLayout(TOWN, defenders, 1), units('infantry', 6))).result();
    expect(r.units.filter((u) => u.side === 0 && u.out).length).toBeGreaterThan(2);
    expect(r.outcome).not.toBe('raided');
  });

  it('caps stop a skirmish knocking down more than its share of homes', () => {
    const homes = Array.from({ length: 30 }, (_, k) => ({
      id: 100 + k,
      tags: TAG.home,
      x: 860 + (k % 6) * 14,
      z: 520 + Math.floor(k / 6) * 14,
      r: 5,
      hp: 60,
    }));
    const inp = input(lineLayout([...TOWN, ...homes]), [...units('artillery', 6), ...units('tank', 6)]);
    inp.caps = { maxCollapse: 2, maxWreck: 3 };
    const r = Battle.run(inp).result();
    const homesDown = r.destroyed.filter((id) => id >= 100);
    expect(homesDown.length).toBeLessThanOrEqual(2);
  });

  it('a cautious force pulls back sooner than a bold one', () => {
    const bunkers = [0, 1, 2].map((k) => ({
      id: 40 + k,
      tags: TAG.civic | TAG.military | TAG.defence,
      x: 650 + k * 30,
      z: 520,
      r: 6,
      hp: 600,
      gun: 8,
      range: 130,
      against: ['land' as const],
    }));
    const force = units('tank', 4);
    const run = (stance: 'cautious' | 'bold') =>
      Battle.run(input(lineLayout([...TOWN, ...bunkers]), structuredClone(force), { stance })).result();
    const cautious = run('cautious');
    const bold = run('bold');
    expect(cautious.outcome).toBe('withdrew');
    expect(cautious.steps).toBeLessThan(bold.steps);
    expect(bold.objectives.down).toBeGreaterThan(cautious.objectives.down);
    // Those that pulled out got away.
    expect(cautious.units.some((u) => u.side === 0 && !u.out)).toBe(true);
  });

  it('a battle ends within its time, and stays cheap', () => {
    const big = input(lineLayout(TOWN, units('tank', 40, { x: 900, z: 540 }, 0)), [
      ...units('tank', 8),
      ...units('infantry', 8),
      ...units('artillery', 4),
      ...units('helicopter', 4),
    ]);
    const t0 = performance.now();
    const b = Battle.run(big);
    const ms = performance.now() - t0;
    expect(b.outcome).not.toBeNull();
    expect(b.step).toBeLessThanOrEqual(1_440 + 2_000);
    // Generous for a loaded machine: about 70 actors for the whole battle.
    expect(ms).toBeLessThan(1_500);
  });
});
