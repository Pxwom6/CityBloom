import { Color } from 'three';
import { ROAD_TYPES, type RoadTypeId } from '../data/roads';

export interface Strip {
  from: number;
  to: number;
  lift: number;
  color: Color;
}
export interface Marking {
  offset: number;
  width: number;
  dash: number;
  gap: number;
  color: Color;
  /** Extra height above the road's markings (rails over their sleepers, M20). */
  lift?: number;
}
export interface RoadStyle {
  strips: Strip[];
  markings: Marking[];
  /** Offsets where a vertical kerb face joins two strips of different lift. */
  kerbs: { at: number; low: number; high: number }[];
  asphaltHalf: number;
  totalHalf: number;
  /** Half the median's width (0 without one). */
  medianHalf: number;
  asphalt: Color;
  sidewalk: Color;
  /** The kerb's face, darker than the pavement so the step reads (M27). */
  kerb: Color;
  /** The pavement's kerb stones along the road, a little brighter (M27). */
  kerbTop: Color;
  lift: number;
  sidewalkLift: number;
  /** A railway's ballast bed (M20). */
  rail?: boolean;
  /** A town road with kerbs and pavements, which may get crossings at junctions (M27). */
  town?: boolean;
}

const ASPHALT = new Color('#767b82');
const HIGHWAY_ASPHALT = new Color('#6c7178');
const SIDEWALK = new Color('#cfc9bd');
const KERB = new Color('#a39e93');
const KERB_TOP = new Color('#dcdedf');
const EDGING = new Color('#b4aea2');
/** Kerb stones' width, and the edging along the pavement's back (m). */
const KERB_W = 0.3;
const EDGE_W = 0.15;
const DIRT = new Color('#b59a6d');
const VERGE = new Color('#9aa36a');
const MEDIAN = new Color('#7da65c');
const YELLOW = new Color('#f1cf63');
const WHITE = new Color('#f4f2ea');
const BALLAST = new Color('#8d8579');
const SLEEPER = new Color('#5a4a3b');
const RAIL = new Color('#c8cbd0');

const L = 0.2; // asphalt lift above the terrain
const S = 0.34; // sidewalk lift

function build(id: RoadTypeId): RoadStyle {
  const t = ROAD_TYPES[id];
  const hw = t.width / 2;
  const tot = hw + t.sidewalk;
  const strips: Strip[] = [];
  const markings: Marking[] = [];
  const kerbs: RoadStyle['kerbs'] = [];
  if (id === 'dirt') {
    strips.push({ from: -tot, to: -hw, lift: L - 0.02, color: VERGE });
    strips.push({ from: -hw, to: hw, lift: L, color: DIRT });
    strips.push({ from: hw, to: tot, lift: L - 0.02, color: VERGE });
    return {
      strips,
      markings,
      kerbs,
      asphaltHalf: hw,
      totalHalf: tot,
      medianHalf: 0,
      asphalt: DIRT,
      sidewalk: VERGE,
      kerb: VERGE,
      kerbTop: VERGE,
      lift: L,
      sidewalkLift: L - 0.02,
    };
  }
  if (id === 'rail') {
    // Railway (M20): a ballast bed with two tracks of sleepers and rails.
    strips.push({ from: -tot, to: tot, lift: L, color: BALLAST });
    for (const c of [-2, 2]) {
      markings.push({ offset: c, width: 2.6, dash: 0.35, gap: 0.55, color: SLEEPER });
      for (const r of [-0.72, 0.72])
        markings.push({ offset: c + r, width: 0.14, dash: 1000, gap: 0, color: RAIL, lift: 0.08 });
    }
    return {
      strips,
      markings,
      kerbs,
      asphaltHalf: hw,
      totalHalf: tot,
      medianHalf: 0,
      asphalt: BALLAST,
      sidewalk: BALLAST,
      kerb: BALLAST,
      kerbTop: BALLAST,
      lift: L,
      sidewalkLift: L,
      rail: true,
    };
  }
  if (id === 'ramp' || id === 'motorway') {
    // The city highway and its ramps (M19): grass verges, no kerbs; a concrete barrier down the
    // highway's middle and solid edge lines.
    strips.push({ from: -tot, to: -hw, lift: L - 0.02, color: VERGE });
    strips.push({ from: hw, to: tot, lift: L - 0.02, color: VERGE });
    if (id === 'ramp') strips.push({ from: -hw, to: hw, lift: L, color: HIGHWAY_ASPHALT });
    else {
      const med = 0.8;
      strips.push({ from: -hw, to: -med, lift: L, color: HIGHWAY_ASPHALT });
      strips.push({ from: med, to: hw, lift: L, color: HIGHWAY_ASPHALT });
      strips.push({ from: -med, to: med, lift: L + 0.6, color: SIDEWALK });
      kerbs.push({ at: -med, low: L, high: L + 0.6 }, { at: med, low: L, high: L + 0.6 });
      const laneW = (hw - med - 1.5) / (t.lanes / 2);
      for (let k = 1; k < t.lanes / 2; k++) {
        const o = med + 0.5 + laneW * k;
        markings.push({ offset: o, width: 0.18, dash: 4, gap: 8, color: WHITE });
        markings.push({ offset: -o, width: 0.18, dash: 4, gap: 8, color: WHITE });
      }
    }
    markings.push({ offset: hw - 0.6, width: 0.18, dash: 1000, gap: 0, color: WHITE });
    markings.push({ offset: -hw + 0.6, width: 0.18, dash: 1000, gap: 0, color: WHITE });
    return {
      strips,
      markings,
      kerbs,
      asphaltHalf: hw,
      totalHalf: tot,
      medianHalf: id === 'motorway' ? 0.8 : 0,
      asphalt: HIGHWAY_ASPHALT,
      sidewalk: VERGE,
      kerb: KERB,
      kerbTop: SIDEWALK,
      lift: L,
      sidewalkLift: L - 0.02,
    };
  }
  const asphalt = id === 'highway' ? HIGHWAY_ASPHALT : ASPHALT;
  // Pavements: kerb stones along the road, slabs, and an edging along the back.
  for (const sg of [-1, 1]) {
    const band = (a: number, b: number, color: Color) =>
      strips.push({ from: Math.min(sg * a, sg * b), to: Math.max(sg * a, sg * b), lift: S, color });
    band(hw, hw + KERB_W, KERB_TOP);
    band(hw + KERB_W, tot - EDGE_W, SIDEWALK);
    band(tot - EDGE_W, tot, EDGING);
  }
  kerbs.push({ at: -hw, low: L, high: S }, { at: hw, low: L, high: S });
  if (id === 'street') {
    strips.push({ from: -hw, to: hw, lift: L, color: asphalt });
    markings.push({ offset: 0, width: 0.22, dash: 3, gap: 4, color: YELLOW });
  } else {
    const med = id === 'avenue' ? 1 : id === 'boulevard' ? 1.5 : 0.6;
    strips.push({ from: -hw, to: -med, lift: L, color: asphalt });
    strips.push({ from: med, to: hw, lift: L, color: asphalt });
    if (id === 'highway') strips.push({ from: -med, to: med, lift: L + 0.5, color: SIDEWALK });
    else {
      // A planted median inside kerb stones.
      const k = Math.min(0.2, med / 3);
      strips.push({ from: -med, to: -med + k, lift: S, color: KERB_TOP });
      strips.push({ from: -med + k, to: med - k, lift: S, color: MEDIAN });
      strips.push({ from: med - k, to: med, lift: S, color: KERB_TOP });
    }
    kerbs.push(
      { at: -med, low: L, high: id === 'highway' ? L + 0.5 : S },
      { at: med, low: L, high: id === 'highway' ? L + 0.5 : S },
    );
    const lanesPerSide = t.lanes / 2;
    const laneW = (hw - med) / lanesPerSide;
    for (let k = 1; k < lanesPerSide; k++) {
      const o = med + laneW * k;
      markings.push({ offset: o, width: 0.18, dash: 3, gap: 6, color: WHITE });
      markings.push({ offset: -o, width: 0.18, dash: 3, gap: 6, color: WHITE });
    }
    markings.push({ offset: hw - 0.5, width: 0.15, dash: 1000, gap: 0, color: WHITE });
    markings.push({ offset: -hw + 0.5, width: 0.15, dash: 1000, gap: 0, color: WHITE });
  }
  return {
    strips,
    markings,
    kerbs,
    asphaltHalf: hw,
    totalHalf: tot,
    medianHalf: id === 'street' ? 0 : id === 'avenue' ? 1 : id === 'boulevard' ? 1.5 : 0.6,
    asphalt,
    sidewalk: SIDEWALK,
    kerb: KERB,
    kerbTop: KERB_TOP,
    lift: L,
    sidewalkLift: S,
    town: id !== 'highway',
  };
}

/**
 * Tram track (M20): how far each direction's track runs from the road's centre line, in the lane
 * next to the centre line (or the median).
 */
export function tramOffset(id: RoadTypeId): number {
  const t = ROAD_TYPES[id];
  const hw = t.width / 2;
  const med = id === 'street' ? 0 : id === 'avenue' ? 1 : id === 'boulevard' ? 1.5 : 0.6;
  return med + (hw - med) / Math.max(1, t.lanes / 2) / 2;
}

/** A railway's two tracks run this far either side of its centre line (M20). */
export const RAIL_TRACK_OFFSET = 2;

export const ROAD_STYLES: Record<RoadTypeId, RoadStyle> = {
  dirt: build('dirt'),
  street: build('street'),
  avenue: build('avenue'),
  boulevard: build('boulevard'),
  motorway: build('motorway'),
  ramp: build('ramp'),
  rail: build('rail'),
  mainline: build('rail'),
  highway: build('highway'),
};
