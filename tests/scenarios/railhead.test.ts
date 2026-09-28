import { describe, expect, it } from 'vitest';
import { placeAlong } from '../helpers';
import { openScenario, playOut } from './harness';

describe('scenario: Railhead (M20)', () => {
  it('is won by a railway from the regional link to a freight terminal at the works', () => {
    const sim = openScenario('railhead');
    const hw = sim.state.net.nodes.get(sim.state.highway.connect)!;
    const link = sim.state.net.nodes.get(sim.state.railway!.connect)!;
    const dir = Math.sign(link.z - hw.z) || 1;
    const at = (dx: number, z: number) => ({ x: hw.x + dx, z });
    const build = (road: 'rail' | 'street', a: { x: number; z: number }, b: { x: number; z: number }) => {
      const r = sim.dispatch({ type: 'buildRoad', road, points: [a, b] });
      if (!r.ok) throw new Error(`${road}: ${r.reason}`);
      return r.created!;
    };
    // Track straight on from the link past the town to the works, and a yard street beside it.
    build('rail', { x: link.x, z: link.z }, at(1110, link.z));
    const yardZ = link.z - dir * 56;
    build('street', at(870, hw.z + dir * 220), at(870, yardZ));
    const yard = build('street', at(870, yardZ), at(1070, yardZ));
    const before = Math.round(sim.state.traffic.get(sim.state.highway.segment) ?? 0);
    // The terminal goes down as soon as the treasury can pay for it.
    let term = -1;
    const end = playOut(sim, () => {
      if (term < 0 && sim.state.treasury > 60_000) term = placeAlong(sim, 'railfreight', yard[0]!);
    });
    expect(term).toBeGreaterThan(0);
    expect(end).toMatchObject({ status: 'won' });
    console.log(
      `[railhead] highway link ${before} → ${Math.round(sim.state.traffic.get(sim.state.highway.segment) ?? 0)} trucks/day, ` +
        `${sim.railFreight.get(term)} truckloads/day by rail; won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`,
    );
  });

  it('is lost by a neglectful one: the trucks keep coming', () => {
    const end = playOut(openScenario('railhead'));
    expect(end).toMatchObject({ status: 'lost', reason: 'time' });
  });
});
