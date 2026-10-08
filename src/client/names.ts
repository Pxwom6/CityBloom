import type { ClientWorld } from './world';
import { nameHash, namesSeed } from '../sim/world/streetNames';

const HOODS = [
  'Old Town',
  'Northgate',
  'Millbrook',
  'Eastfield',
  'Hillcrest',
  'Southmead',
  'Westbury',
  'Fairview',
  'Ashford',
  'Greenhollow',
  'Kingsbridge',
  'Brookside',
  'Lindenhurst',
  'Oakridge',
  'Stonebridge',
  'Harbourside',
  'Meadowvale',
  'Copperfield',
  'Rosewood',
  'Foxhill',
  'Larkspur',
  'Willowmere',
];

/**
 * Street names, as the player sees them. A road's name is saved with it (P10, `RoadSegment.name`:
 * a street is the segments sharing one, named by `src/sim/world/streetNames.ts`), so this only
 * reads it. Neighbourhoods are named per 384 m cell.
 */
export class StreetNames {
  private seed: number;

  constructor(private world: ClientWorld) {
    this.seed = namesSeed(world.options.seed);
  }

  street(segId: number): string {
    return this.world.netState.segments.get(segId)?.name ?? 'an unnamed road';
  }

  /** The district painted here (M21), or else the generated neighbourhood name. */
  neighbourhood(x: number, z: number): string {
    const d = this.world.districts.get(this.world.districtAt(x, z));
    return d ? d.name : this.generatedNeighbourhood(x, z);
  }

  /** The name the map gives a place: neighbourhoods per 384 m cell (a new district's default name). */
  generatedNeighbourhood(x: number, z: number): string {
    const i = Math.floor(x / 384);
    const j = Math.floor(z / 384);
    return HOODS[Math.floor(nameHash(this.seed, i * 131 + j * 7919 + 17) * HOODS.length)]!;
  }

  /** "Maple Street, Northgate" for a point near a road. */
  address(x: number, z: number): string {
    const hit = this.world.net.nearestSegment({ x, z }, 60);
    const hood = this.neighbourhood(x, z);
    return hit ? `${this.street(hit.seg)}, ${hood}` : hood;
  }
}
