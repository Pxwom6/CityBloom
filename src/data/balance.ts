/** Balancing constants for demand, growth, occupancy and happiness. DESIGN.md §3.3–3.10. */
export const DEMAND = {
  workforceShare: 0.5,
  /** R: open jobs pull residents in; unemployment pushes them away. */
  jobsWeight: 1.5,
  jobsSoftening: 100,
  /** R: settlers arriving from the highway while the town is tiny. */
  newcomers: 0.6,
  newcomersFadePopulation: 400,
  /** R: approval above/below this pulls demand up/down. */
  appealNeutral: 0.55,
  appealWeight: 0.8,
  /** C: commercial jobs wanted per resident (shoppers). */
  shopJobsPerResident: 0.12,
  shoppersWeight: 1.2,
  cWorkforceWeight: 0.6,
  /** I: unemployed workers attract industry. */
  iWorkforceWeight: 1.5,
  /** I: regional demand for goods while connected to the highway. */
  exports: 0.25,
  /** Demand change per tax point above the neutral rate. */
  taxPerPoint: -0.04,
  neutralTax: 9,
  /** Demand values are eased towards their targets each hour. */
  easing: 0.35,
};

export const GROWTH = {
  /** Ticks between growth passes. */
  passInterval: 10,
  /** Blocks examined per pass. */
  blocksPerPass: 60,
  /** Spawn chance per candidate lot per pass at demand 1. */
  spawnChance: 0.25,
  baseConstructions: 6,
  constructionsPerPopulation: 1 / 150,
  /** Max share of capacity that moves in / out per pass. */
  moveIn: 0.1,
  moveOut: 0.05,
  /** Residents only move in while R demand is above this. */
  moveInMinDemand: -0.2,
  /** Upgrade: needs this happiness and occupancy for `upgradeChecks` hourly checks. */
  upgradeHappiness: 0.66,
  upgradeOccupancy: 0.88,
  upgradeChecks: 3,
  upgradeChance: 0.25,
  /** Hourly chance an industrial building retools to a higher tier the workforce now supports. */
  retoolChance: 0.02,
  /** Decline: distress per hour while unhappy; abandoned at `abandonAt`. */
  distressHappiness: 0.3,
  abandonAt: 48,
  recoverRate: 2,
  /** Abandoned buildings re-occupy after this many hours of good conditions. */
  reoccupyHours: 24,
  /** Abandoned buildings nobody moves back into crumble to rubble after this many hours, freeing the lot. */
  abandonedDecayHours: 96,
  reoccupyHappiness: 0.5,
  /** Max angle difference (radians) between adjacent columns of one lot. */
  maxLotBend: 0.1,
  /** Max terrain height range across a lot, metres. */
  maxLotRise: 3.5,
};

export const COMMUTE = {
  /** Longest commute anyone accepts, seconds of travel. */
  maxCommute: 1800,
  /** Longest trip to the shops, seconds. */
  maxShopTrip: 900,
  /** Customers per commercial job per day. */
  customersPerJob: 10,
  /** Seconds a building is from its road node (walk + parking). */
  accessSeconds: 30,
};

/** Traffic (DESIGN §3.8). Volumes are daily passenger-car units (PCU), both directions. */
export const TRAFFIC = {
  /** One-way trips per employed resident per day (there and back). */
  tripsPerWorker: 2,
  /** One-way shopping trips per resident per day. */
  shopTripsPerResident: 0.5,
  /** Share of trips made by car when there's no transit. */
  carShare: 0.9,
  /** People per car. */
  occupancy: 1.2,
  /** Share of the day's traffic on the road in the busiest hour (the day is compressed). */
  peakShare: 0.25,
  /** Congestion: travel time × (1 + alpha · (v/c)^beta), capped. */
  bprAlpha: 0.15,
  bprBeta: 4,
  maxSlowdown: 8,
  /**
   * Oversaturated roads also queue: extra seconds = queueSeconds · (1 − c/v) when v > c (the average
   * wait of a queue that builds through the rush hour at a bottleneck).
   */
  queueSeconds: 600,
  /** Method of successive averages: how far volumes move towards each new assignment. */
  msa: 0.2,
  /** Freight truck trips per industrial worker per day, and needed per commercial job. */
  freightPerIndustrialJob: 0.12,
  freightPerCommercialJob: 0.06,
  /** A truck counts as this many cars. */
  truckPcu: 2.5,
  /**
   * A one-way road's capacity against the same road two-way (M19): every lane runs with the
   * traffic, with no oncoming cars to wait for when turning.
   */
  oneWayCapacity: 1.25,
  /** Hourly traffic as a share of the rush-hour peak, 00:00 to 23:00. */
  profile: [
    0.08, 0.05, 0.04, 0.05, 0.1, 0.25, 0.5, 0.85, 1, 0.7, 0.5, 0.5, 0.55, 0.5, 0.5, 0.55, 0.75, 1, 0.85, 0.55,
    0.4, 0.3, 0.2, 0.12,
  ],
  /** Visible commuter trips sampled per assignment round. */
  samples: 320,
};

/** Buses (DESIGN §3.8). */
export const TRANSIT = {
  stopCost: 400,
  stopUpkeep: 12,
  /** Farthest walk to a stop, metres (straight line; walking distance is 1.3× that). */
  walkRadius: 360,
  walkSpeed: 1.4,
  /** Seconds a bus spends at each stop. */
  dwell: 20,
  /** Most commuters who'd ever take the bus, and how sharply the share responds to time saved. */
  maxShare: 0.7,
  shareScale: 240,
  /** Seconds of car hassle (parking, fuel) a bus rider saves; tilts the choice towards buses. */
  carPenalty: 300,
  /** A bus counts as this many cars on the road. */
  busPcu: 2.5,
};

/** Environment, health and education (DESIGN §3.11). */
export const ENVIRONMENT = {
  /** Air: cells the plume moves downwind per 3-hour update, diffusion, decay per update. */
  windCells: 2.5,
  airDiffusion: 0.22,
  airDecay: 0.95,
  /** Emission per lot cell per 3 h for heavy, manufacturing and high-tech industry. */
  industryAir: [0.03, 0.01, 0.0015],
  /** Emission per 3 h per unit of a plant's airPollution rating. */
  plantAir: 1.1,
  /** Emission per metre of road per 3 h per daily PCU. */
  trafficAir: 3e-7,
  /** Share of air pollution a fully wooded cell absorbs per update; parks absorb this within reach. */
  treeAbsorb: 0.3,
  parkAbsorb: 0.5,
};

export const HEALTH = {
  /** New cases per resident per hour. */
  baseRate: 0.0004,
  airRate: 0.015,
  groundRate: 0.003,
  waterRate: 0.004,
  garbageRate: 0.002,
  /** Share of the sick who recover per hour, untreated and in a hospital or clinic bed. */
  recoverUntreated: 0.05,
  recoverTreated: 0.25,
  /** Share of untreated sick who die (leave the city) per hour. */
  deathRate: 0.004,
  /** Mood: per unit share of untreated sick residents. */
  sickMood: -1.5,
  /** Mood: per unit of air pollution (× wealth sensitivity). */
  airMood: -0.2,
  airSensitivity: [0.8, 1.0, 1.4],
};

export const EDUCATION = {
  /** Share of residents who are pupils at each level: primary, high school, university. */
  pupils: [0.1, 0.06, 0.04],
  /** How fast a home's education moves towards what its schooling supports, per hour. */
  learnRate: 0.004,
  /** Education of newcomers. */
  newcomer: 0.5,
  /** Workforce thresholds for industry tiers: share at level ≥ 1 for manufacturing, ≥ 2 for high-tech. */
  manufacturing: 0.4,
  highTech: 0.3,
  /** Offices (high-wealth commerce) need this share of the workforce at level ≥ 2. */
  offices: 0.2,
};

export const HAPPINESS = {
  base: 0.55,
  unemployment: -0.15,
  commuteGood: 0.06,
  commuteGoodSeconds: 480,
  commuteBad: -0.12,
  commuteBadSeconds: 1500,
  shopsGood: 0.04,
  shopsBad: -0.06,
  taxPerPoint: -0.015,
  taxSensitivity: [1.4, 1.0, 0.8],
  noHighwayAccess: -0.4,
  /** Businesses. */
  customersGood: 0.08,
  customersBad: -0.15,
  workersBad: -0.2,
  staffedGood: 0.06,
  landValue: 0.1,
  /** Services: +gain × coverage − loss × (1 − coverage) × expectation[wealth]. */
  serviceGain: 0.05,
  serviceLoss: 0.06,
  serviceExpect: [0.6, 1.0, 1.5],
  bizServiceGain: 0.03,
  bizServiceLoss: 0.04,
  park: 0.1,
  crime: -0.15,
};

/** Disasters (M9). Distances in metres, times in ticks unless noted. DESIGN.md §3.12. */
export const DISASTERS = {
  /** Random disasters: chance per hour once the city has `minPopulation` residents. */
  hourlyChance: 1 / (24 * 30 * 30),
  minPopulation: 1500,
  /** Relative odds of each kind when one strikes at random. */
  weights: { earthquake: 0.3, tornado: 0.3, flood: 0.25, meteor: 0.15 },
  maxActive: 3,
  earthquake: {
    magnitude: [5.6, 7.4] as [number, number],
    /** Radius = base + perMagnitude × (magnitude − 5). */
    radiusBase: 120,
    radiusPerMagnitude: 220,
    shakeTicks: 20,
    /** Collapse chance = collapse × intensity²; otherwise a fire with fire × intensity. */
    collapse: 0.6,
    fire: 0.12,
    /** Roads within this share of the radius can crack: chance roadChance × intensity. */
    roadReach: 0.7,
    roadChance: 0.7,
    /** Civic buildings knocked offline: chance civicChance × intensity. */
    civicChance: 0.7,
  },
  tornado: {
    /** Metres per tick and lifetime. */
    speed: 28,
    ticks: [45, 70] as [number, number],
    halfWidth: [18, 32] as [number, number],
    /** Destroy chance per tick for a building in the core (inner 60 %) or the edge. */
    destroyCore: 0.35,
    destroyEdge: 0.1,
    civicHours: 36,
    roadHours: 8,
  },
  flood: {
    /**
     * Peak water level (terrain height, m): this far above the typical land within 150 m of the
     * water near the source, within `height`. And how far it reaches from the source.
     */
    aboveShore: 1.8,
    height: [4, 13] as [number, number],
    radius: 520,
    riseTicks: 60 * 4,
    holdTicks: 60 * 10,
    fallTicks: 60 * 8,
    /** Needs open water this close to where it's triggered. */
    maxWaterDistance: 320,
    /** Hourly chance a flooded building is wrecked, after `graceHours` under water. */
    graceHours: 3,
    destroyLow: 0.05,
    destroyOther: 0.02,
  },
  meteor: {
    radius: [28, 48] as [number, number],
    /** Ticks from the warning to the impact. */
    fallTicks: 30,
    /** Fires within this multiple of the crater radius. */
    fireReach: 2.2,
    civicHours: 72,
    roadHours: 72,
    /** Crater scorch fades over this many ticks. */
    scorchTicks: 1440 * 60,
  },
  /** Repairs: roads cost this share of their build cost, civic buildings this share of theirs. */
  roadRepairShare: 0.5,
  civicRepairShare: 0.25,
  /** Hours to repair a civic building knocked offline by an earthquake (plus up to 16 by intensity). */
  civicRepairHours: 8,
  civicRepairPerIntensity: 16,
  /** Hours to repair a cracked road (plus up to 18 by intensity). */
  roadRepairHours: 6,
  roadRepairPerIntensity: 18,
};
