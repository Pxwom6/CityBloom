import { describe, expect, it } from 'vitest';
import { openScenario, playOut } from './harness';

describe('scenario: Gridlock', () => {
  it('is won by widening the track and opening a second route', () => {
    const sim = openScenario('gridlock');
    const hw = sim.state.net.nodes.get(sim.state.highway.connect)!;
    const track = [...sim.state.net.segments.values()].find((sg) => sg.type === 'dirt')!;
    expect(sim.dispatch({ type: 'upgradeRoad', seg: track.id, road: 'avenue' }).ok).toBe(true);
    // A street from the utility road north of the homes to the first job street.
    const bypass = sim.dispatch({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: hw.x + 300, z: hw.z - 240 },
        { x: hw.x + 410, z: hw.z - 230 },
      ],
    });
    expect(bypass.ok).toBe(true);
    const end = playOut(sim);
    expect(end).toMatchObject({ status: 'won' });
    console.log(`[gridlock] won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`);
  });

  it('is lost by a neglectful one: the jam never clears', () => {
    const end = playOut(openScenario('gridlock'));
    expect(end).toMatchObject({ status: 'lost', reason: 'time' });
  });
});
