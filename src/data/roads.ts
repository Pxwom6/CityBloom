/** Road types and road-building rules. DESIGN.md §2, SPEC §5 Roads. */
export type RoadTypeId =
  'dirt' | 'street' | 'avenue' | 'boulevard' | 'motorway' | 'ramp' | 'rail' | 'mainline' | 'highway';

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
  /**
   * Local road (M19): buildings, zones, stops and junctions can front it. The city highway, its
   * ramps and the regional highway are not: they meet other roads only at ramps and interchanges.
   */
  access: boolean;
  /** Always one-way, in the direction it's drawn (ramps). */
  oneWay?: boolean;
  /** Tightest curve radius, metres (ROAD_RULES.minRadius if absent). */
  minRadius?: number;
  /** Tram track can be laid along it (M20). */
  tram?: boolean;
  blurb: string;
}

export const ROAD_TYPES: Record<RoadTypeId, RoadType> = {
  dirt: {
    id: 'dirt',
    access: true,
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
    access: true,
    tram: true,
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
    access: true,
    tram: true,
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
    access: true,
    tram: true,
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
  motorway: {
    id: 'motorway',
    access: false,
    maxGrade: 0.05,
    name: 'City highway',
    width: 24,
    sidewalk: 2,
    lanes: 4,
    speed: 90,
    capacity: 6000,
    costPerMetre: 90,
    upkeepPerMetre: 0.35,
    maxDensity: 0,
    unlockPopulation: 10_000,
    buildable: true,
    blurb:
      'Four fast lanes with no junctions and no zoning. Join it with ramps; it passes over the roads it crosses.',
  },
  ramp: {
    id: 'ramp',
    access: false,
    oneWay: true,
    maxGrade: 0.07,
    name: 'Ramp',
    width: 7,
    sidewalk: 1,
    lanes: 1,
    speed: 50,
    capacity: 1500,
    costPerMetre: 30,
    upkeepPerMetre: 0.1,
    maxDensity: 0,
    unlockPopulation: 10_000,
    buildable: true,
    blurb: 'One lane on or off the city highway, one-way in the direction you draw it.',
  },
  rail: {
    id: 'rail',
    access: false,
    maxGrade: 0.035,
    minRadius: 100,
    name: 'Railway',
    width: 8,
    sidewalk: 2,
    lanes: 2,
    speed: 110,
    capacity: 0,
    costPerMetre: 70,
    upkeepPerMetre: 0.25,
    maxDensity: 0,
    unlockPopulation: 5_000,
    buildable: true,
    blurb:
      'Double track for trains, on gentle grades and wide curves. Crosses streets at level crossings and passes over bigger roads.',
  },
  mainline: {
    id: 'mainline',
    access: false,
    maxGrade: 0.035,
    minRadius: 100,
    name: 'Regional railway',
    width: 8,
    sidewalk: 2,
    lanes: 2,
    speed: 110,
    capacity: 0,
    costPerMetre: 0,
    upkeepPerMetre: 0,
    maxDensity: 0,
    unlockPopulation: 0,
    buildable: false,
    blurb: 'Links the city to the region by rail: freight trains run in and out here.',
  },
  highway: {
    id: 'highway',
    access: false,
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

export const BUILDABLE_ROADS: RoadTypeId[] = [
  'dirt',
  'street',
  'avenue',
  'boulevard',
  'motorway',
  'ramp',
  'rail',
];

/** Track (M20): railways live in the network beside roads but have a graph of their own. */
export const isRail = (t: RoadTypeId): boolean => t === 'rail' || t === 'mainline';
/** A road the player built: not the regional highway, and not railway track (P9). */
export const isPlayerRoad = (t: RoadTypeId): boolean => t !== 'highway' && !isRail(t);

/** Roads a railway crosses at a level crossing (M20); it passes over anything bigger. */
export const levelCrossing = (t: RoadTypeId): boolean => t === 'dirt' || t === 'street' || t === 'avenue';

/**
 * Roads that pass over or under the roads they cross instead of meeting them (M19): the city highway
 * and the regional highway. Rail (M20) joins them.
 */
export const gradeSeparated = (t: RoadTypeId): boolean => t === 'motorway' || t === 'highway';

/** Road families that may meet at a junction: local roads; the city highway, ramps and highway. */
export const roadClass = (t: RoadTypeId): 'local' | 'motorway' | 'ramp' | 'rail' =>
  t === 'motorway' || t === 'highway' ? 'motorway' : t === 'ramp' ? 'ramp' : isRail(t) ? 'rail' : 'local';

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
  /** Ramps may meet the city highway at this shallow an angle (M19). */
  mergeAngleDeg: 8,
};

/** Grade separation (M19): a road passing over another, or under a viaduct. */
export const GRADE_SEP = {
  /** Height of the upper road's surface above the lower one's, metres (headroom plus deck). */
  clearance: 7.5,
  /** Extra deck beyond the lower road's corridor on each side, metres. */
  margin: 3,
};

/** Client-side snapping radii (input convenience; the sim still validates). */
export const SNAP = {
  node: 10,
  segment: 8,
  /** An end this close to a road it could join snaps onto it (P1): past the 14–22 m a road must keep from one it doesn't join. */
  near: 22,
  /** However far out the camera is, a near miss reaches no further (PR #14 review). */
  nearMax: 30,
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
