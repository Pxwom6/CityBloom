/** Road types and road-building rules. DESIGN.md §2, SPEC §5 Roads. */
export type RoadTypeId = 'dirt' | 'street' | 'avenue' | 'boulevard' | 'highway';

export interface RoadType {
  id: RoadTypeId;
  name: string;
  /** Carriageway width in metres (kerb to kerb). */
  width: number;
  /** Sidewalk / verge width on each side. */
  sidewalk: number;
  lanes: number;
  /** Free-flow speed, km/h. */
  speed: number;
  /** Capacity, vehicles per hour (both directions). */
  capacity: number;
  costPerMetre: number;
  /** Maintenance per metre per month. */
  upkeepPerMetre: number;
  /** Highest zone density that can grow along it: 0 low, 1 medium, 2 high. */
  maxDensity: 0 | 1 | 2;
  /**
   * Steepest grade (rise over run) of its graded profile (M13). Close to real practice: local
   * streets climb far more than arterials.
   */
  maxGrade: number;
  /** Population needed to unlock. */
  unlockPopulation: number;
  buildable: boolean;
  blurb: string;
}

export const ROAD_TYPES: Record<RoadTypeId, RoadType> = {
  dirt: {
    id: 'dirt',
    maxGrade: 0.2,
    name: 'Dirt road',
    width: 6,
    sidewalk: 1,
    lanes: 2,
    speed: 30,
    capacity: 400,
    costPerMetre: 4,
    upkeepPerMetre: 0.02,
    maxDensity: 0,
    unlockPopulation: 0,
    buildable: true,
    blurb: 'Cheap and slow. Only low-density buildings grow along it.',
  },
  street: {
    id: 'street',
    maxGrade: 0.16,
    name: 'Street',
    width: 8,
    sidewalk: 2,
    lanes: 2,
    speed: 40,
    capacity: 900,
    costPerMetre: 10,
    upkeepPerMetre: 0.05,
    maxDensity: 1,
    unlockPopulation: 0,
    buildable: true,
    blurb: 'Two lanes with sidewalks. Supports up to medium density.',
  },
  avenue: {
    id: 'avenue',
    maxGrade: 0.12,
    name: 'Avenue',
    width: 16,
    sidewalk: 2.5,
    lanes: 4,
    speed: 50,
    capacity: 2400,
    costPerMetre: 26,
    upkeepPerMetre: 0.12,
    maxDensity: 2,
    unlockPopulation: 0,
    buildable: true,
    blurb: 'Four lanes and a planted median. Carries heavy traffic; allows high density.',
  },
  boulevard: {
    id: 'boulevard',
    maxGrade: 0.08,
    name: 'Boulevard',
    width: 22,
    sidewalk: 3,
    lanes: 6,
    speed: 60,
    capacity: 3800,
    costPerMetre: 48,
    upkeepPerMetre: 0.2,
    maxDensity: 2,
    unlockPopulation: 20_000,
    buildable: true,
    blurb: 'Six lanes for a growing metropolis. Highest capacity on the map.',
  },
  highway: {
    id: 'highway',
    maxGrade: 0.06,
    name: 'Regional highway',
    width: 20,
    sidewalk: 2,
    lanes: 4,
    speed: 80,
    capacity: 6000,
    costPerMetre: 0,
    upkeepPerMetre: 0,
    maxDensity: 0,
    unlockPopulation: 0,
    buildable: false,
    blurb: 'Connects the city to the region.',
  },
};

export const BUILDABLE_ROADS: RoadTypeId[] = ['dirt', 'street', 'avenue', 'boulevard'];

/** Half the corridor a road occupies (carriageway + sidewalks). */
export const roadHalfWidth = (t: RoadTypeId): number => ROAD_TYPES[t].width / 2 + ROAD_TYPES[t].sidewalk;

export const ROAD_RULES = {
  /** Shortest segment that may be built. */
  minLength: 12,
  /** Longest single segment (longer paths are split automatically). */
  maxSegmentLength: 400,
  /** Roads that cross water (on bridges) are checked the old way: grade over this many metres. */
  gradeWindow: 16,
  /** Minimum angle between roads meeting at a node or crossing. */
  minAngleDeg: 28,
  /** Minimum turning radius of a curve, metres. */
  minRadius: 18,
  /** Endpoints this close to an existing node reuse it. */
  nodeTolerance: 1.0,
  /** Endpoints this close to a segment split it. */
  segmentTolerance: 1.0,
  /** A node this close to a new road's centre line joins it as a junction. */
  nodeOnPath: 2.5,
  /** Extra clearance between the corridors of unconnected roads. */
  clearance: 2,
  /** Share of the build cost refunded when bulldozing. */
  bulldozeRefund: 0.25,
};

/** Client-side snapping radii (input convenience; the sim still validates). */
export const SNAP = {
  node: 10,
  segment: 8,
  angleDeg: 5,
  grid: 8,
};

/**
 * Road grading (M13): each road gets a smoothed vertical profile within its type's grade limit, and
 * the ground under it and a little to each side is cut or filled to match. DESIGN.md §3.15.
 */
export const GRADING = {
  /** Profile sample spacing, metres (the bridge deck spacing too). */
  step: 4,
  /** The ground is averaged over this many metres before grading, so small bumps are shaved off. */
  smooth: 40,
  /** Deepest cutting, metres: beyond it the route really is too steep (no tunnels). */
  maxCut: 14,
  /** Tallest embankment, metres: beyond it the road goes over on a viaduct instead. */
  maxFill: 8,
  /**
   * Side slopes, metres out per metre of height: embankments 1 in 3 (gentle enough that lots
   * across their fall stay buildable), cuttings 1 in 1 (so they meet the ground on steep hills).
   */
  fillSlope: 3,
  cutSlope: 1,
  /** Level ground beyond the road's edge on each side, metres. */
  shoulder: 1.5,
  /**
   * Further level ground beyond the shoulder where the road is cut or filled: `benchPerDepth`
   * metres per metre of cut or fill, up to `bench`. It keeps the road surface (draped on 8 m height
   * samples) flat across in a cutting or on an embankment and gives the first lots a level site;
   * a road at grade leaves the lots beside it alone.
   */
  bench: 8,
  benchPerDepth: 2,
  /** Height changes smaller than this (metres) aren't worth making, or charging for. */
  minEdit: 0.25,
  /** Level ground around a civic building's pad, metres. */
  padMargin: 4,
  /**
   * Civic buildings on ground that varies by more than `padFrom` metres get a level pad; beyond
   * `padMax` the site really is too steep.
   */
  padFrom: 1,
  padMax: 12,
  /** Cost of moving earth, dollars per cubic metre. */
  costPerCubicMetre: 0.4,
};
