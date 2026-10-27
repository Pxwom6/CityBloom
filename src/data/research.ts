/**
 * Weapons research (M37, SPEC-5.md): six branches of four tiers, funded by weapons labs and the
 * research park, paid for when a tier starts. What each tier gives is a number the sim reads in one
 * place (`researchEffect`, `researchMods`), or a unit, building or spy operation it unlocks; the
 * fourth tier of each branch is its superweapon. Tiers' order here is the order used everywhere.
 * DESIGN.md §3.31; the plan is docs/plans/M37-design.md.
 */
import type { UnitDomain, UnitKind } from './war';

export type Branch = 'land' | 'air' | 'sea' | 'defence' | 'intel' | 'logistics';
export type TierNumber = 1 | 2 | 3 | 4;
export type TierKey = `${Branch}${TierNumber}`;

export const BRANCHES: { id: Branch; name: string; blurb: string }[] = [
  {
    id: 'land',
    name: 'Land',
    blurb: 'Tougher tanks and faster workshops, and at the end a giant to walk the region.',
  },
  {
    id: 'air',
    name: 'Air',
    blurb: 'Faster aircraft, heavy bombers, drone swarms, and a fortress in the sky.',
  },
  { id: 'sea', name: 'Sea', blurb: 'Better hulls, gunboats and submarines, and a clockwork whale.' },
  {
    id: 'defence',
    name: 'Defence',
    blurb: 'Hardened buildings, interceptors and shield generators, and a dome over the city.',
  },
  {
    id: 'intel',
    name: 'Intelligence',
    blurb: 'Radar, spies and stealth, and a tower that blacks out a rival.',
  },
  {
    id: 'logistics',
    name: 'Logistics',
    blurb: 'Faster travel, repair crews and supply, and a gate that sends forces anywhere at once.',
  },
];
export const BRANCH_IDS: readonly Branch[] = BRANCHES.map((b) => b.id);

/** Numbers research changes, each read in one place in the sim (1, or 0 for the additive ones, without it). */
export type EffectKey =
  /** Training speed by what is trained (multiplied). */
  | 'vehicleTraining'
  | 'aircraftTraining'
  | 'boatTraining'
  | 'droneTraining'
  /** Land units mend this much faster at their bases (multiplied). */
  | 'landMend'
  /** Travel time on every route (multiplied). */
  | 'travel'
  /** Hours of warning each working radar gives, and the most radars give (replace the defaults). */
  | 'radarWarning'
  | 'radarWarningMax'
  /** Units an airfield keeps (replaces its own number). */
  | 'airfieldHolds'
  /** The war stores hold this much more (multiplied). */
  | 'storeCapacity'
  /** Forces away fight at this much more readiness (added). */
  | 'forwardReadiness'
  /** Each repair truck at home adds this to mending at every base (added, up to `repairMax` in all). */
  | 'repairMend'
  /** War-damaged city buildings reopen this much sooner (share of their hours). */
  | 'repairSooner'
  /** Spy agents the agency keeps (replaces its own number). */
  | 'agents'
  /** Share of the city's spies' chance of being caught that stands (multiplied). */
  | 'stealth';

/** A domain's units in battle, after research: hit points and attack multiplied, armour and evasion added. */
export interface BattleMod {
  hp?: number;
  attack?: number;
  armour?: number;
  evade?: number;
}

/** Civilian spin-offs (SPEC-5: "better fire engines or faster construction"). */
export type SpinoffId = 'prefab' | 'quietjets' | 'hulls' | 'firesafe' | 'signals' | 'fireengines';

export const SPINOFFS: Record<SpinoffId, { name: string; blurb: string; factor: number }> = {
  prefab: {
    name: 'Prefab panels',
    blurb: 'Builders borrow the workshops’ jigs: more buildings go up at once.',
    factor: 1.3,
  },
  quietjets: {
    name: 'Quiet jets',
    blurb: 'Quieter engines for everyone: the airport’s and airfield’s noise carries less far.',
    factor: 0.75,
  },
  hulls: {
    name: 'Better hulls',
    blurb: 'Faster, fuller cargo ships: the seaport’s trade pays more.',
    factor: 1.15,
  },
  firesafe: {
    name: 'Fire-safe building',
    blurb: 'Hardened panels in every new wall: fires spread less.',
    factor: 0.6,
  },
  signals: {
    name: 'Signal processing',
    blurb: 'The radar labs’ chips sell well: the research park’s licence fees go up.',
    factor: 1.15,
  },
  fireengines: {
    name: 'Better fire engines',
    blurb: 'Supply-line pumps on every engine: fires go out faster.',
    factor: 1.3,
  },
};

export interface TierDef {
  key: TierKey;
  branch: Branch;
  tier: TierNumber;
  name: string;
  /** What it gives, in a line for the war room. */
  blurb: string;
  /** Research points it takes, and the money paid when it starts. */
  points: number;
  cost: number;
  /** Units (each a prototype to try at the proving ground first), buildings, and spy operations. */
  unlocks?: { units?: UnitKind[]; civics?: string[]; ops?: ('reveal' | 'sabotage' | 'steal')[] };
  effects?: Partial<Record<EffectKey, number>>;
  /** In battle, by domain. */
  mods?: Partial<Record<UnitDomain, BattleMod>>;
  /** In battle, buildings' strength: military and city buildings, and homes and businesses (multiplied). */
  hardened?: { civic: number; other: number };
  spinoff?: SpinoffId;
  /** The superweapon tier: worked on only while a research park is in service. */
  park?: true;
}

const PRICE: Record<TierNumber, { points: number; cost: number }> = {
  1: { points: 300, cost: 40_000 },
  2: { points: 700, cost: 90_000 },
  3: { points: 1_500, cost: 180_000 },
  4: { points: 6_000, cost: 400_000 },
};

const tier = (
  branch: Branch,
  n: TierNumber,
  def: Omit<TierDef, 'key' | 'branch' | 'tier' | 'points' | 'cost'>,
) => ({ key: `${branch}${n}`, branch, tier: n, ...PRICE[n], ...def }) as TierDef;

export const TIERS: TierDef[] = [
  tier('land', 1, {
    name: 'Field workshops',
    blurb: 'Vehicles train a quarter faster; land units mend twice as fast at their bases.',
    effects: { vehicleTraining: 1.25, landMend: 2 },
    spinoff: 'prefab',
  }),
  tier('land', 2, {
    name: 'Heavy armour',
    blurb: 'The heavy tank, once it has passed its trial.',
    unlocks: { units: ['heavytank'] },
  }),
  tier('land', 3, {
    name: 'Composite armour',
    blurb: 'Land units take a quarter more punishment and turn more shots away.',
    mods: { land: { hp: 1.25, armour: 0.05 } },
  }),
  tier('land', 4, {
    name: 'Giant wind-up robot',
    blurb: 'Wound up at the vehicle depot, it walks across the region and stomps through a city.',
    unlocks: { units: ['windupbot'] },
    park: true,
  }),
  tier('air', 1, {
    name: 'Jet engines',
    blurb: 'Aircraft hit harder and train a quarter faster.',
    effects: { aircraftTraining: 1.25 },
    mods: { air: { attack: 1.15 } },
    spinoff: 'quietjets',
  }),
  tier('air', 2, {
    name: 'Heavy bombers',
    blurb: 'The bomber, once it has passed its trial.',
    unlocks: { units: ['bomber'] },
  }),
  tier('air', 3, {
    name: 'Swarm control',
    blurb: 'Airfields keep 18 aircraft, drones train in half the time, and aircraft are tougher.',
    effects: { airfieldHolds: 18, droneTraining: 2 },
    mods: { air: { hp: 1.15 } },
  }),
  tier('air', 4, {
    name: 'Sky fortress',
    blurb: 'An airship moored at the airfield that launches swarms of drones over a city.',
    unlocks: { units: ['skyfortress'] },
    park: true,
  }),
  tier('sea', 1, {
    name: 'Hull design',
    blurb: 'Boats are tougher and train a quarter faster.',
    effects: { boatTraining: 1.25 },
    mods: { sea: { hp: 1.2 } },
    spinoff: 'hulls',
  }),
  tier('sea', 2, {
    name: 'Naval guns',
    blurb: 'The gunboat and the landing craft, once each has passed its trial.',
    unlocks: { units: ['gunboat', 'landingcraft'] },
  }),
  tier('sea', 3, {
    name: 'Submarines',
    blurb: 'The submarine, once it has passed its trial; ships turn more shots away.',
    unlocks: { units: ['submarine'] },
    mods: { sea: { armour: 0.05 } },
  }),
  tier('sea', 4, {
    name: 'Clockwork whale',
    blurb: 'A giant submarine that surfaces off a coast and opens its jaws.',
    unlocks: { units: ['clockworkwhale'] },
    park: true,
  }),
  tier('defence', 1, {
    name: 'Hardened buildings',
    blurb: 'In battle, military and city buildings stand 30 % more, homes and businesses 15 % more.',
    hardened: { civic: 1.3, other: 1.15 },
    spinoff: 'firesafe',
  }),
  tier('defence', 2, {
    name: 'Interceptors',
    blurb: 'The interceptor battery: it stops shells and bombs aimed at buildings, and shoots at aircraft.',
    unlocks: { civics: ['interceptor'] },
  }),
  tier('defence', 3, {
    name: 'Shield generators',
    blurb: 'The shield generator: buildings within 300 m stand twice as much in battle.',
    unlocks: { civics: ['shieldgen'] },
  }),
  tier('defence', 4, {
    name: 'Dome shield',
    blurb: 'A shield over the whole city that soaks one battle’s blows, then is down for a long time.',
    unlocks: { civics: ['domeshield'] },
    park: true,
  }),
  tier('intel', 1, {
    name: 'Long-range radar',
    blurb: 'Each radar gives 5 hours’ warning (9 at most), and a warning says what is coming.',
    effects: { radarWarning: 5, radarWarningMax: 9 },
    spinoff: 'signals',
  }),
  tier('intel', 2, {
    name: 'Spy agency',
    blurb: 'The spy agency: agents who look round a rival’s town, or sabotage its power or depot.',
    unlocks: { civics: ['spyagency'], ops: ['reveal', 'sabotage'] },
  }),
  tier('intel', 3, {
    name: 'Stealth',
    blurb:
      'Agents steal research, a third agent joins, spies are caught less often, aircraft dodge some hits.',
    unlocks: { ops: ['steal'] },
    effects: { agents: 3, stealth: 0.7 },
    mods: { air: { evade: 0.25 } },
  }),
  tier('intel', 4, {
    name: 'Blackout tower',
    blurb: 'A tower that cuts a rival’s power, radar and maps for half a day.',
    unlocks: { civics: ['blackouttower'] },
    park: true,
  }),
  tier('logistics', 1, {
    name: 'Supply lines',
    blurb: 'Forces travel a quarter faster on every route.',
    effects: { travel: 0.75 },
    spinoff: 'fireengines',
  }),
  tier('logistics', 2, {
    name: 'Repair crews',
    blurb: 'The repair truck, once it has passed its trial; war-damaged buildings reopen a quarter sooner.',
    unlocks: { units: ['repair'] },
    effects: { repairMend: 0.5, repairSooner: 0.25 },
  }),
  tier('logistics', 3, {
    name: 'Forward supply',
    blurb: 'Forces away fight at a tenth more readiness, and the war stores hold half as much again.',
    effects: { forwardReadiness: 0.1, storeCapacity: 1.5 },
  }),
  tier('logistics', 4, {
    name: 'Express gate',
    blurb: 'A gate that sends a force anywhere in the region within the hour.',
    unlocks: { civics: ['expressgate'] },
    park: true,
  }),
];

export const TIER = new Map<TierKey, TierDef>(TIERS.map((t) => [t.key, t]));
export const TIER_KEYS: readonly TierKey[] = TIERS.map((t) => t.key);

/** The tier a unit kind or a building needs (undefined: none). */
export const UNIT_TIER = new Map<UnitKind, TierKey>(
  TIERS.flatMap((t) => (t.unlocks?.units ?? []).map((u) => [u, t.key] as const)),
);
export const CIVIC_TIER = new Map<string, TierKey>(
  TIERS.flatMap((t) => (t.unlocks?.civics ?? []).map((c) => [c, t.key] as const)),
);

/** The tier before this one in its branch, or null for a first tier. */
export function prerequisite(key: TierKey): TierKey | null {
  const t = TIER.get(key)!;
  return t.tier === 1 ? null : (`${t.branch}${t.tier - 1}` as TierKey);
}

/** Research's running numbers (M37). Logged in DECISIONS, "M37". */
export const RESEARCH = {
  /** Points a weapons lab makes a war-clock hour at full staff, power and funding (funding counts up to 1.25). */
  labPoints: 4,
  fundingMax: 1.25,
  /** A city runs at most this many labs. */
  maxLabs: 3,
  /** The labs' total with a research park in service, and with the launch complex too. */
  parkFactor: 1.5,
  launchFactor: 1.75,
  /** Tiers waiting their turn, at most. */
  queueMax: 4,
  /** Repair trucks at home add at most this to mending (with `repairMend` each). */
  repairMax: 3,
  /** With Repair crews, a repair truck in a force mends the survivors this much on the way home. */
  awayMend: 0.1,
};

/** Trials of prototypes at the proving ground (M37). */
export const TRIAL = {
  /** A trial costs this share of the unit's money (a superweapon's, `superShare`). */
  costShare: 0.5,
  superShare: 0.1,
  /** War-clock hours: half the unit's training, at least `minHours`; a superweapon's, `superHours`. */
  minHours: 12,
  superHours: 72,
  /** Shown as this many runs, a notice at each. */
  runs: 3,
};

/** The dome shield's modes: raised for every battle, only for one bringing a superweapon, or never. */
export type DomeMode = 'all' | 'super' | 'off';
export const DOME_MODES: readonly DomeMode[] = ['all', 'super', 'off'];

/** The superweapon buildings' running numbers (M37). Logged in DECISIONS, "M37". */
export const DOME = {
  /** War hours to charge from empty, while it works (staff ≥ 0.25, power ≥ 0.5) and the city isn't blacked out. */
  chargeHours: 240,
  /** Its pool when raised for a battle: about a hundred houses' strength. */
  pool: 40_000,
  /** A full dome holds this long in a blackout, then falls empty. */
  reserveHours: 4,
  /** Kept for M40: the charge after stopping a bomb. */
  bombRecharge: 1_440,
};

export const BLACKOUT = {
  /** The tower charges at its target this long (the target is warned), then the blackout lasts `lasts`. */
  chargeHours: 1,
  lasts: 12,
  /** Hours from use until it can fire again. */
  recharge: 240,
  /** A blacked-out town's guns are manned this much in battles there; a friend's power plants give `plants`. */
  manning: 0.3,
  plants: 0.4,
  /** Its feelings towards the city. */
  relation: -15,
};

export const GATE = {
  /** A force through the gate arrives in this many hours, whatever its way; the gate charges `recharge` from departure. */
  hours: 1,
  recharge: 120,
};

/** A superweapon's strike on a computer neighbour: its feelings (a raid's are −20) and its allies'. */
export const SUPER_STRIKE = { relation: -40, allies: -10 };
