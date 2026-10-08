import { describe, expect, it } from 'vitest';
import { advise, type Advice } from '../src/sim/systems/advisors';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { thoughts } from '../src/sim/systems/thoughts';
import { BState } from '../src/sim/world/buildings';
import { buildTown, newSim, placeAlong, serveTown } from './helpers';
import { twoDistricts } from './trafficTown';
import { windStreet } from './envTown';

const find = (list: Advice[], advisor: Advice['advisor'], re: RegExp) =>
  list.find((a) => a.advisor === advisor && re.test(a.title));

describe('advisors', () => {
  it('spot missing utilities and services, and say where', () => {
    const sim = newSim();
    buildTown(sim);
    sim.advance(TICKS_PER_MONTH);
    const list = advise(sim);
    const power = find(list, 'utilities', /without power/i)!;
    expect(power).toBeDefined();
    expect(power.severity).toBeGreaterThanOrEqual(2);
    expect(power.map).toBe('power');
    // The location is in the middle of the affected buildings.
    const near = [...sim.state.buildings.values()].some(
      (b) => Math.hypot(b.x - power.at!.x, b.z - power.at!.z) < 200,
    );
    expect(near).toBe(true);
    expect(list[0]!.severity).toBe(3);
    // Sorted most urgent first.
    for (let i = 1; i < list.length; i++)
      expect(list[i]!.severity).toBeLessThanOrEqual(list[i - 1]!.severity);
  });

  it('a served town hears about safety, health and schools until it has them', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim, false);
    sim.advance(TICKS_PER_MONTH * 2);
    const list = advise(sim);
    expect(find(list, 'utilities', /all supplied/i)).toBeDefined();
    expect(find(list, 'safety', /beyond fire cover/i)).toBeDefined();
    expect(find(list, 'health', /far from health care/i)).toBeDefined();
    expect(find(list, 'education', /without a school place/i)).toBeDefined();
    // Every advisor speaks.
    for (const a of [
      'finance',
      'utilities',
      'safety',
      'health',
      'education',
      'transport',
      'environment',
    ] as const)
      expect(list.some((x) => x.advisor === a)).toBe(true);
  });

  it('the transport advisor points at the jam', () => {
    const sim = newSim();
    const t = twoDistricts(sim, 'dirt');
    sim.advance(TICKS_PER_MONTH * 5);
    const jam = find(advise(sim), 'transport', /jam/i)!;
    expect(jam).toBeDefined();
    expect(sim.net.curve(t.link).project(jam.at!).d).toBeLessThan(5);
    expect(jam.map).toBe('traffic');
  });

  it('the environment advisor finds the smog downwind', () => {
    const sim = newSim();
    const t = windStreet(sim);
    sim.advance(TICKS_PER_MONTH * 4);
    const smog = find(advise(sim), 'environment', /smog/i);
    expect(smog).toBeDefined();
    expect(smog!.at!.z).toBeGreaterThan(t.mid.z);
    expect(smog!.map).toBe('airPollution');
  });

  // P15 (c): residents grumble about the first sliver of a shortfall; the advisor must say so too.
  describe('residents and the utilities advisor agree (P15)', () => {
    const SPEAKS = {
      power: /blackout|candles|fridge/i,
      water: /water again|nothing comes out/i,
      sewage: /drains|sewers/i,
    } as const;
    const live = (sim: ReturnType<typeof newSim>) =>
      [...sim.state.buildings.values()].filter((b) => b.state === BState.Active);

    it.each(['power', 'water', 'sewage'] as const)('about %s that only part of a building gets', (u) => {
      const sim = newSim();
      buildTown(sim);
      serveTown(sim);
      sim.advance(TICKS_PER_MONTH * 2);
      const homes = live(sim);
      expect(find(advise(sim), 'utilities', /all supplied/i)).toBeDefined(); // baseline
      homes.forEach((b) => (b[u] = 0.7)); // part-served, none under half
      // Precondition: the residents do complain.
      expect(thoughts(sim, 1000).filter((t) => SPEAKS[u].test(t.text)).length).toBeGreaterThan(0);
      const list = advise(sim);
      expect(find(list, 'utilities', /all supplied/i)).toBeUndefined();
      const line = list.find((a) => a.advisor === 'utilities' && a.map === u)!;
      expect(line).toBeDefined();
      // The advisor's figure is the count the mood list uses (anything under full).
      expect(line.title).toBe(`${homes.length} buildings short of ${u}`);
      expect(line.severity).toBe(1);
      expect(line.at).toBeDefined();
      // Under half: the existing line, same count, and no second line for the same utility.
      homes.forEach((b) => (b[u] = 0.3));
      const low = advise(sim).filter((a) => a.advisor === 'utilities' && a.map === u);
      expect(low).toHaveLength(1);
      expect(low[0]!.title).toBe(`${homes.length} buildings without ${u}`);
      // Full: no complaint, and "All supplied" returns.
      homes.forEach((b) => (b[u] = 1));
      expect(thoughts(sim, 1000).filter((t) => SPEAKS[u].test(t.text))).toHaveLength(0);
      expect(find(advise(sim), 'utilities', /all supplied/i)).toBeDefined();
    });

    it('names a single building that is nearly served in the singular', () => {
      const sim = newSim();
      buildTown(sim);
      serveTown(sim);
      sim.advance(TICKS_PER_MONTH * 2);
      live(sim)[0]!.sewage = 0.9;
      const line = advise(sim).find((a) => a.advisor === 'utilities' && a.map === 'sewage')!;
      expect(line.title).toBe('1 building short of sewage');
      expect(line.text).toMatch(/^It gets only part of the sewage/);
    });

    it('a town on one septic tank: whenever someone is short, the advisor says so', () => {
      const sim = newSim();
      buildTown(sim);
      sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
      sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
      const segs = [...sim.state.net.segments.values()]
        .filter((s) => s.type !== 'highway' && s.type !== 'mainline')
        .map((s) => s.id);
      for (const def of ['coal', 'pump', 'pump', 'pump', 'septic', 'landfill']) {
        const at = segs.find((id) => {
          try {
            placeAlong(sim, def, id);
            return true;
          } catch {
            return false;
          }
        });
        expect(at, def).toBeDefined();
      }
      let partial = 0;
      for (let h = 0; h < 24 * 16; h++) {
        sim.advance(TICKS_PER_HOUR);
        const some = live(sim).filter((b) => b.sewage < 0.999);
        if (!some.length) continue;
        if (some.some((b) => b.sewage >= 0.5)) partial++;
        const list = advise(sim);
        expect(find(list, 'utilities', /all supplied/i)).toBeUndefined();
        expect(list.some((a) => a.advisor === 'utilities' && a.map === 'sewage')).toBe(true);
      }
      // The town did sit at its limit at some point, or this test proves nothing.
      expect(partial).toBeGreaterThan(0);
    });
  });
});
