import { describe, expect, it } from 'vitest';
import { openScenario, playOut } from './harness';

/** The crossroads everyone queues at: the town's only four-way junction of avenues. */
function crossroads(sim: ReturnType<typeof openScenario>): number {
  const hw = sim.state.net.nodes.get(sim.state.highway.connect)!;
  return sim.net.nearestNode({ x: hw.x + 460, z: hw.z }, 3)!.id;
}

describe('scenario: Crossroads (M19)', () => {
  it('is won with a roundabout at the crossroads', () => {
    const sim = openScenario('crossroads');
    const r = sim.dispatch({ type: 'roundabout', node: crossroads(sim) });
    expect(r.ok).toBe(true);
    const end = playOut(sim);
    expect(end).toMatchObject({ status: 'won' });
    console.log(
      `[crossroads] won in ${((end.end - end.start) / 1440).toFixed(1)} months, ${end.stars} stars`,
    );
  });

  it('is lost by a neglectful one: the queue never clears', () => {
    const end = playOut(openScenario('crossroads'));
    expect(end).toMatchObject({ status: 'lost', reason: 'time' });
  });
});
