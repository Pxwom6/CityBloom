/**
 * City policies (M10): each has a running cost and one measurable effect, applied where that system
 * lives. Costs are monthly: a base plus an amount per resident. DESIGN.md §3.13.
 */
export type PolicyId =
  | 'freeTransit'
  | 'fireSafety'
  | 'recycling'
  | 'healthyLiving'
  | 'neighbourhoodWatch'
  | 'cleanIndustry'
  | 'highRiseBan'
  | 'tourismCampaign'
  | 'heavyTrafficBan'
  | 'heritage';

export interface PolicyDef {
  id: PolicyId;
  name: string;
  /** What it does, for the panel. */
  effect: string;
  costBase: number;
  costPerResident: number;
  unlockPopulation: number;
  /**
   * Where it can apply (M21): the whole city only, one district only, or either (the default). A
   * district pays its population's share of the city-wide cost.
   */
  scope?: 'city' | 'district';
}

export const POLICIES: PolicyDef[] = [
  {
    id: 'fireSafety',
    name: 'Home fire safety',
    effect: 'Smoke alarms and inspections: half as many fires break out.',
    costBase: 150,
    costPerResident: 0.02,
    unlockPopulation: 800,
  },
  {
    id: 'freeTransit',
    name: 'Free buses',
    effect: 'No fares: many more people leave the car at home when a bus is handy.',
    costBase: 200,
    costPerResident: 0.04,
    unlockPopulation: 2_000,
  },
  {
    id: 'recycling',
    name: 'Recycling scheme',
    effect: 'Households sort their waste: a quarter less garbage to collect.',
    costBase: 120,
    costPerResident: 0.02,
    unlockPopulation: 2_000,
  },
  {
    id: 'neighbourhoodWatch',
    name: 'Neighbourhood watch',
    effect: 'Residents look out for each other: crime falls by a quarter.',
    costBase: 100,
    costPerResident: 0.02,
    unlockPopulation: 5_000,
  },
  {
    id: 'healthyLiving',
    name: 'Healthy living',
    effect: 'Sports clubs and check-ups: people fall ill 30 % less often.',
    costBase: 180,
    costPerResident: 0.03,
    unlockPopulation: 5_000,
  },
  {
    id: 'cleanIndustry',
    name: 'Clean industry grants',
    effect: 'Filters and cleaner processes: industry pollutes 40 % less.',
    costBase: 300,
    costPerResident: 0.03,
    unlockPopulation: 5_000,
  },
  {
    id: 'highRiseBan',
    name: 'High-rise ban',
    effect: 'Keeps the skyline low: no new high-density towers. Free.',
    costBase: 0,
    costPerResident: 0,
    unlockPopulation: 5_000,
  },
  {
    id: 'tourismCampaign',
    name: 'Tourism campaign',
    effect: 'Advertising in the region: half as many visitors again.',
    costBase: 400,
    costPerResident: 0.02,
    unlockPopulation: 10_000,
    scope: 'city',
  },
  // District-only policies (M21).
  {
    id: 'heavyTrafficBan',
    name: 'Heavy-traffic ban',
    effect: 'Trucks keep off its roads where there is another way round; deliveries still get in.',
    costBase: 150,
    costPerResident: 0.01,
    unlockPopulation: 5_000,
    scope: 'district',
  },
  {
    id: 'heritage',
    name: 'Heritage district',
    effect:
      'Buildings keep their character: none is rebuilt bigger or grander, new ones stay low or medium density, and the charm lifts land value.',
    costBase: 100,
    costPerResident: 0.01,
    unlockPopulation: 5_000,
    scope: 'district',
  },
];

export const POLICY = new Map(POLICIES.map((p) => [p.id, p]));

/** Policy strengths used by the systems. */
export const POLICY_EFFECTS = {
  fireSafety: 0.5,
  recycling: 0.75,
  neighbourhoodWatch: 0.75,
  healthyLiving: 0.7,
  cleanIndustry: 0.6,
  tourismCampaign: 1.5,
  /** Free buses: the bus looks this many seconds quicker in the mode choice. */
  freeTransitSeconds: 300,
};

export function policyCost(p: PolicyDef, population: number): number {
  return p.costBase + p.costPerResident * population;
}
