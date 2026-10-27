/**
 * War between cities (phase 5, SPEC-5.md): the military buildings, the units they train and keep,
 * and the war economy's numbers. Everything here is inert unless a city has war on (rival
 * neighbours, or a shared region whose rules allow it): peaceful cities never see or pay for any of
 * it. Sites come from `docs/models/PROMPTS-WAR.md` (each building's site, each unit's size), so the
 * owner's models fit. A toy war: units are knocked out, never killed. DESIGN.md §3.28.
 */
import type { BattleRoute } from './battle';
import type { CivicDef } from './civic';
import type { TierKey } from './research';

/** Where a unit fights: on the ground, in the air or at sea. */
export type UnitDomain = 'land' | 'air' | 'sea';

/** The kinds of unit (M34's base set; research unlocks the rest, and the three superweapons, in M37). */
export type UnitKind =
  | 'infantry'
  | 'tank'
  | 'heavytank'
  | 'artillery'
  | 'transport'
  | 'repair'
  | 'fighter'
  | 'bomber'
  | 'helicopter'
  | 'drone'
  | 'patrolboat'
  | 'gunboat'
  | 'submarine'
  | 'landingcraft'
  | 'windupbot'
  | 'skyfortress'
  | 'clockworkwhale';

/** How the war room groups units (SPEC-5: infantry, tanks, artillery, planes, helicopters, drones, boats, transport). */
export type UnitClass =
  | 'infantry'
  | 'tanks'
  | 'artillery'
  | 'planes'
  | 'helicopters'
  | 'drones'
  | 'boats'
  | 'transport'
  | 'superweapons';

export const UNIT_CLASSES: { id: UnitClass; name: string }[] = [
  { id: 'infantry', name: 'Infantry' },
  { id: 'tanks', name: 'Tanks' },
  { id: 'artillery', name: 'Artillery' },
  { id: 'planes', name: 'Planes' },
  { id: 'helicopters', name: 'Helicopters' },
  { id: 'drones', name: 'Drones' },
  { id: 'boats', name: 'Boats' },
  { id: 'transport', name: 'Transport' },
  { id: 'superweapons', name: 'Superweapons' },
];

/** What a unit is good against in battle (M35). */
export interface UnitStats {
  /** Hit points at full strength. */
  hp: number;
  /** Damage a shot does, and seconds between shots. */
  attack: number;
  reload: number;
  /** How far it fires (m). */
  range: number;
  /** Top speed (m/s) on roads, over open ground, in the air or at sea. */
  speed: number;
  /** Share of incoming damage its armour turns away (0–1). */
  armour: number;
  /** What it can fire at. */
  targets: UnitDomain[];
  /** Damage to buildings is this times `attack` (artillery and bombers knock buildings down). */
  siege: number;
  /** The robot (M37): near its objective it walks straight there, stamping on what's within `radius` every `every` steps. */
  stomp?: { radius: number; damage: number; every: number };
  /** The sky fortress (M37): carries `n` units of `kind`, launched one every `every` steps near its objective. */
  carries?: { kind: UnitKind; n: number; every: number };
  /** The whale (M37): can't be hit while it swims; it surfaces within `surface` m of its objective and fires for `fire` steps. */
  dives?: { surface: number; fire: number };
}

/** A superweapon (M37): one of each per city, one per force; war-clock hours it winds up again after use. */
export interface SuperInfo {
  cooldown: number;
  /** The routes it may take, and its travel time on them (multiplied). */
  routes: BattleRoute[];
  travel?: number;
}

export interface UnitDef {
  id: UnitKind;
  name: string;
  plural: string;
  blurb: string;
  domain: UnitDomain;
  group: UnitClass;
  /** The military building that trains and keeps it. */
  base: string;
  /** Money, then materials: goods from industry, ore and oil. */
  cost: number;
  goods: number;
  ore: number;
  oil: number;
  /** Extra power its base draws while training it (the same units as homes and jobs use). */
  power: number;
  /** Hours on the war clock to train (a game month is 24 hours). */
  hours: number;
  /** Monthly upkeep once trained. */
  upkeep: number;
  /** Size in metres from its prompt: length (front to back), width, height above ground or waterline. */
  size: [number, number, number];
  /** Its model file's stem (`assets/models/war/<model>.glb`). */
  model: string;
  stats: UnitStats;
  /** One number for the war room's force strength (rough fighting worth). */
  strength: number;
  /** Research that unlocks it (M37); the base set needs none. */
  research?: TierKey;
  /** A superweapon (M37). */
  super?: SuperInfo;
}

export const UNIT_DEFS: UnitDef[] = [
  {
    id: 'infantry',
    name: 'Infantry squad',
    plural: 'Infantry squads',
    blurb: 'Four toy soldiers on one base: cheap, quick to train, and they hold buildings.',
    domain: 'land',
    group: 'infantry',
    base: 'barracks',
    cost: 1_500,
    goods: 6,
    ore: 0,
    oil: 0,
    power: 3,
    hours: 12,
    upkeep: 45,
    size: [4, 4, 2.2],
    model: 'unit-infantry',
    stats: {
      hp: 60,
      attack: 6,
      reload: 1.5,
      range: 60,
      speed: 2.5,
      armour: 0,
      targets: ['land'],
      siege: 0.3,
    },
    strength: 1,
  },
  {
    id: 'tank',
    name: 'Light tank',
    plural: 'Light tanks',
    blurb: 'A chunky, quick tank with a dome turret: the backbone of a ground force.',
    domain: 'land',
    group: 'tanks',
    base: 'vehicledepot',
    cost: 8_000,
    goods: 30,
    ore: 40,
    oil: 20,
    power: 15,
    hours: 48,
    upkeep: 170,
    size: [7, 3.6, 2.8],
    model: 'unit-tank',
    stats: {
      hp: 220,
      attack: 26,
      reload: 3,
      range: 120,
      speed: 9,
      armour: 0.35,
      targets: ['land', 'sea'],
      siege: 1,
    },
    strength: 5,
  },
  {
    id: 'heavytank',
    name: 'Heavy tank',
    plural: 'Heavy tanks',
    blurb: 'A big, blocky tank with a long gun: slow, and very hard to stop.',
    domain: 'land',
    group: 'tanks',
    base: 'vehicledepot',
    cost: 15_000,
    goods: 50,
    ore: 80,
    oil: 30,
    power: 22,
    hours: 72,
    upkeep: 300,
    size: [9, 4.4, 3.4],
    model: 'unit-heavytank',
    stats: {
      hp: 420,
      attack: 40,
      reload: 3.5,
      range: 140,
      speed: 6,
      armour: 0.5,
      targets: ['land', 'sea'],
      siege: 1.2,
    },
    strength: 9,
    research: 'land2',
  },
  {
    id: 'artillery',
    name: 'Artillery',
    plural: 'Artillery',
    blurb: 'A six-wheeled gun that fires from far back: it knocks down defences and buildings.',
    domain: 'land',
    group: 'artillery',
    base: 'vehicledepot',
    cost: 9_000,
    goods: 30,
    ore: 45,
    oil: 20,
    power: 15,
    hours: 48,
    upkeep: 180,
    size: [8, 3.2, 3.4],
    model: 'unit-artillery',
    stats: {
      hp: 140,
      attack: 34,
      reload: 6,
      range: 420,
      speed: 7,
      armour: 0.15,
      targets: ['land', 'sea'],
      siege: 2.5,
    },
    strength: 5,
  },
  {
    id: 'transport',
    name: 'Transport truck',
    plural: 'Transport trucks',
    blurb: 'Carries troops and supplies: a force with trucks travels faster and keeps going longer.',
    domain: 'land',
    group: 'transport',
    base: 'vehicledepot',
    cost: 3_000,
    goods: 15,
    ore: 10,
    oil: 15,
    power: 6,
    hours: 24,
    upkeep: 60,
    size: [8, 3, 3.4],
    model: 'unit-transport',
    stats: {
      hp: 90,
      attack: 0,
      reload: 1,
      range: 0,
      speed: 11,
      armour: 0.1,
      targets: [],
      siege: 0,
    },
    strength: 1,
  },
  {
    id: 'repair',
    name: 'Repair truck',
    plural: 'Repair trucks',
    blurb: 'A crane and a crew: mends units in the field and buildings after a raid.',
    domain: 'land',
    group: 'transport',
    base: 'vehicledepot',
    cost: 5_000,
    goods: 20,
    ore: 15,
    oil: 15,
    power: 8,
    hours: 36,
    upkeep: 90,
    size: [7, 3, 3.6],
    model: 'unit-repair',
    stats: {
      hp: 100,
      attack: 0,
      reload: 1,
      range: 0,
      speed: 10,
      armour: 0.1,
      targets: [],
      siege: 0,
    },
    strength: 1,
    research: 'logistics2',
  },
  {
    id: 'fighter',
    name: 'Fighter plane',
    plural: 'Fighter planes',
    blurb: 'A toy jet that clears the sky of enemy planes and strafes ground targets.',
    domain: 'air',
    group: 'planes',
    base: 'airfield',
    cost: 18_000,
    goods: 40,
    ore: 30,
    oil: 60,
    power: 25,
    hours: 72,
    upkeep: 400,
    size: [13, 12, 4],
    model: 'unit-fighter',
    stats: {
      hp: 160,
      attack: 30,
      reload: 2,
      range: 300,
      speed: 90,
      armour: 0.1,
      targets: ['air', 'land', 'sea'],
      siege: 0.5,
    },
    strength: 8,
  },
  {
    id: 'bomber',
    name: 'Bomber',
    plural: 'Bombers',
    blurb: 'A big, friendly-looking bomber: slow, and devastating to buildings.',
    domain: 'air',
    group: 'planes',
    base: 'airfield',
    cost: 30_000,
    goods: 60,
    ore: 50,
    oil: 90,
    power: 35,
    hours: 96,
    upkeep: 650,
    size: [20, 26, 5],
    model: 'unit-bomber',
    stats: {
      hp: 300,
      attack: 60,
      reload: 8,
      range: 60,
      speed: 60,
      armour: 0.2,
      targets: ['land', 'sea'],
      siege: 3,
    },
    strength: 10,
    research: 'air2',
  },
  {
    id: 'helicopter',
    name: 'Helicopter',
    plural: 'Helicopters',
    blurb: 'Hovers over the streets with rocket pods: good against tanks and boats.',
    domain: 'air',
    group: 'helicopters',
    base: 'airfield',
    cost: 12_000,
    goods: 30,
    ore: 20,
    oil: 40,
    power: 18,
    hours: 48,
    upkeep: 280,
    size: [15, 12, 4.5],
    model: 'unit-helicopter',
    stats: {
      hp: 140,
      attack: 24,
      reload: 2.5,
      range: 200,
      speed: 40,
      armour: 0.15,
      targets: ['land', 'sea'],
      siege: 0.7,
    },
    strength: 6,
  },
  {
    id: 'drone',
    name: 'Drone',
    plural: 'Drones',
    blurb: 'A small quadcopter that spots for the others and pecks at targets: cheap, and many.',
    domain: 'air',
    group: 'drones',
    base: 'airfield',
    cost: 2_500,
    goods: 8,
    ore: 4,
    oil: 4,
    power: 4,
    hours: 12,
    upkeep: 30,
    size: [3, 3, 1],
    model: 'unit-drone',
    stats: {
      hp: 30,
      attack: 5,
      reload: 1.5,
      range: 120,
      speed: 25,
      armour: 0,
      targets: ['land', 'sea'],
      siege: 0.2,
    },
    strength: 1,
  },
  {
    id: 'patrolboat',
    name: 'Patrol boat',
    plural: 'Patrol boats',
    blurb: 'A fast boat with a bow gun: guards the coast and chases off raiders.',
    domain: 'sea',
    group: 'boats',
    base: 'navalyard',
    cost: 14_000,
    goods: 40,
    ore: 40,
    oil: 40,
    power: 20,
    hours: 72,
    upkeep: 300,
    size: [18, 5, 6],
    model: 'unit-patrolboat',
    stats: {
      hp: 220,
      attack: 22,
      reload: 2.5,
      range: 220,
      speed: 18,
      armour: 0.2,
      targets: ['sea', 'land', 'air'],
      siege: 0.6,
    },
    strength: 6,
  },
  {
    id: 'gunboat',
    name: 'Gunboat',
    plural: 'Gunboats',
    blurb: 'A toy warship with two turrets: it shells the shore from out at sea.',
    domain: 'sea',
    group: 'boats',
    base: 'navalyard',
    cost: 32_000,
    goods: 80,
    ore: 100,
    oil: 70,
    power: 35,
    hours: 120,
    upkeep: 700,
    size: [40, 9, 12],
    model: 'unit-gunboat',
    stats: {
      hp: 600,
      attack: 50,
      reload: 4,
      range: 450,
      speed: 12,
      armour: 0.4,
      targets: ['sea', 'land', 'air'],
      siege: 2,
    },
    strength: 14,
    research: 'sea2',
  },
  {
    id: 'submarine',
    name: 'Submarine',
    plural: 'Submarines',
    blurb: 'A friendly toy submarine that slips under the waves and sinks ships.',
    domain: 'sea',
    group: 'boats',
    base: 'navalyard',
    cost: 26_000,
    goods: 60,
    ore: 80,
    oil: 50,
    power: 30,
    hours: 96,
    upkeep: 520,
    size: [30, 4, 3],
    model: 'unit-submarine',
    stats: {
      hp: 300,
      attack: 70,
      reload: 6,
      range: 300,
      speed: 10,
      armour: 0.3,
      targets: ['sea'],
      siege: 0,
    },
    strength: 10,
    research: 'sea3',
  },
  {
    id: 'landingcraft',
    name: 'Landing craft',
    plural: 'Landing craft',
    blurb: 'Carries tanks and troops over water and drops its ramp on the beach.',
    domain: 'sea',
    group: 'boats',
    base: 'navalyard',
    cost: 12_000,
    goods: 40,
    ore: 40,
    oil: 30,
    power: 15,
    hours: 60,
    upkeep: 220,
    size: [20, 7, 4],
    model: 'unit-landingcraft',
    stats: {
      hp: 260,
      attack: 0,
      reload: 1,
      range: 0,
      speed: 11,
      armour: 0.25,
      targets: [],
      siege: 0,
    },
    strength: 2,
    research: 'sea2',
  },
  // Superweapons (M37): toy-like, very expensive, slow to build, with a long cooldown.
  {
    id: 'windupbot',
    name: 'Giant wind-up robot',
    plural: 'Giant wind-up robots',
    blurb: 'A giant toy robot, wound up at the depot: it walks across the region and stomps through a city.',
    domain: 'land',
    group: 'superweapons',
    base: 'vehicledepot',
    cost: 1_500_000,
    goods: 600,
    ore: 1_200,
    oil: 600,
    power: 300,
    hours: 360,
    upkeep: 5_000,
    size: [10, 14, 30],
    model: 'unit-windupbot',
    stats: {
      hp: 6_000,
      attack: 150,
      reload: 4,
      range: 50,
      speed: 4,
      armour: 0.6,
      targets: ['land', 'sea'],
      siege: 4,
      stomp: { radius: 16, damage: 300, every: 4 },
    },
    strength: 60,
    research: 'land4',
    super: { cooldown: 240, routes: ['highway'], travel: 2 },
  },
  {
    id: 'skyfortress',
    name: 'Sky fortress',
    plural: 'Sky fortresses',
    blurb: 'A great airship moored at the airfield: over a city it launches a swarm of drones.',
    domain: 'air',
    group: 'superweapons',
    base: 'airfield',
    cost: 1_600_000,
    goods: 800,
    ore: 800,
    oil: 1_200,
    power: 350,
    hours: 360,
    upkeep: 6_000,
    size: [80, 24, 26],
    model: 'unit-skyfortress',
    stats: {
      hp: 5_000,
      attack: 12,
      reload: 2,
      range: 250,
      speed: 15,
      armour: 0.4,
      targets: ['air'],
      siege: 0,
      carries: { kind: 'drone', n: 16, every: 20 },
    },
    strength: 55,
    research: 'air4',
    super: { cooldown: 240, routes: ['air'], travel: 2 },
  },
  {
    id: 'clockworkwhale',
    name: 'Clockwork whale',
    plural: 'Clockwork whales',
    blurb: 'A giant clockwork submarine: it swims unseen, surfaces off a coast and opens its jaws.',
    domain: 'sea',
    group: 'superweapons',
    base: 'navalyard',
    cost: 1_500_000,
    goods: 600,
    ore: 1_500,
    oil: 900,
    power: 300,
    hours: 360,
    upkeep: 5_500,
    // 16 m tall in all, 8 of them below the waterline when it surfaces.
    size: [60, 14, 8],
    model: 'unit-clockworkwhale',
    stats: {
      hp: 7_000,
      attack: 220,
      reload: 8,
      range: 450,
      speed: 8,
      armour: 0.55,
      targets: ['sea', 'land'],
      siege: 3,
      dives: { surface: 600, fire: 600 },
    },
    strength: 60,
    research: 'sea4',
    super: { cooldown: 240, routes: ['sea'] },
  },
];

export const UNIT = new Map(UNIT_DEFS.map((u) => [u.id, u]));

/** What a military building does: staff, power, noise, safety, training and keeping units. */
export interface MilitaryInfo {
  /** Staff it needs (taken from residents looking for work). */
  jobs: number;
  /** Power it draws all the time (the units homes and jobs use), before any training. */
  power: number;
  /** Noise it makes: loudness at the site (0–1) and how far it carries (m). */
  noise?: { level: number; reach: number };
  /** An airfield is loud along its runway, like the airport (m along the runway's line). */
  runway?: number;
  /** Homes within `radius` m feel safer (approval), up to `value` at the site. */
  safety?: { radius: number; value: number };
  /** Unit kinds it trains, and how many units it keeps. */
  trains?: UnitKind[];
  holds?: number;
  /** The headquarters: opens the war room; without one readiness stays low. */
  hq?: true;
  /** Residents it shelters in a raid (M35). */
  shelters?: number;
  /** Readiness its drills add (the proving ground). */
  drills?: number;
  /** Defences (M35): fights units of these domains on its own, with this strength and range (m). */
  defends?: { against: UnitDomain[]; strength: number; range: number };
  /** Radar: how far out it sees a force coming (m beyond the city edge, M35). */
  radar?: number;
  /**
   * The arms factory: goods and munitions it makes a day at full staff, extra materials storage,
   * and how much quicker vehicles train with it running (share of the time saved).
   */
  arms?: { goods: number; munitions: number; storage: number; vehicleTime: number };
  /** Weapons lab (M37): research points it makes a war-clock hour at full staff, power and funding. */
  lab?: { points: number };
  /** Spy agency (M37): agents it keeps. */
  agency?: { agents: number };
  /**
   * Interceptor battery (M37): stops shells and bombs aimed at buildings within `range` m, a share
   * `chance` of the time when fully manned, then waits `cooldown` battle steps.
   */
  intercept?: { range: number; chance: number; cooldown: number };
  /** Shield generator (M37): buildings within `radius` m stand `factor` times as much in battle. */
  shield?: { radius: number; factor: number };
  /** The superweapon buildings (M37): the dome shield, the blackout tower and the express gate. */
  superweapon?: 'dome' | 'tower' | 'gate';
}

/** Military buildings (M34), all in the Military category and the defence department. */
export const MILITARY_DEFS: (CivicDef & { military: MilitaryInfo })[] = [
  {
    id: 'militaryhq',
    name: 'Military HQ',
    category: 'military',
    dept: 'defence',
    w: 40,
    d: 40,
    cost: 45_000,
    upkeep: 900,
    unique: true,
    military: { jobs: 60, power: 30, hq: true, safety: { radius: 220, value: 0.02 } },
    blurb:
      'Headquarters for the city’s forces: opens the war room and the other military buildings. Without it, readiness stays low.',
    unlockPopulation: 2_000,
    model: 'militaryhq',
  },
  {
    id: 'barracks',
    name: 'Barracks',
    category: 'military',
    dept: 'defence',
    w: 40,
    d: 32,
    cost: 18_000,
    upkeep: 450,
    requires: 'militaryhq',
    military: {
      jobs: 80,
      power: 25,
      trains: ['infantry'],
      holds: 12,
      noise: { level: 0.42, reach: 70 },
      safety: { radius: 160, value: 0.012 },
    },
    landValue: { radius: 120, value: -0.03 },
    blurb: 'Trains and keeps infantry squads, and drills them on its parade square.',
    unlockPopulation: 2_000,
    model: 'barracks',
  },
  {
    id: 'shelter',
    name: 'Air-raid shelter',
    category: 'military',
    dept: 'defence',
    w: 16,
    d: 16,
    cost: 4_000,
    upkeep: 60,
    military: { jobs: 2, power: 3, shelters: 400, safety: { radius: 140, value: 0.03 } },
    blurb: 'A grassy mound with a heavy door: residents nearby wait out a raid here, and sleep easier.',
    unlockPopulation: 2_000,
    model: 'shelter',
  },
  {
    id: 'bunker',
    name: 'Bunker',
    category: 'military',
    dept: 'defence',
    w: 16,
    d: 16,
    cost: 6_000,
    upkeep: 90,
    requires: 'militaryhq',
    military: {
      jobs: 8,
      power: 4,
      defends: { against: ['land'], strength: 3, range: 120 },
      safety: { radius: 100, value: 0.01 },
    },
    blurb: 'A squat concrete strongpoint in an earth bank: it holds off ground forces on its own.',
    unlockPopulation: 2_000,
    model: 'bunker',
  },
  {
    id: 'vehicledepot',
    name: 'Vehicle depot',
    category: 'military',
    dept: 'defence',
    w: 48,
    d: 40,
    cost: 32_000,
    upkeep: 800,
    requires: 'militaryhq',
    military: {
      jobs: 90,
      power: 60,
      trains: ['tank', 'artillery', 'transport', 'heavytank', 'repair', 'windupbot'],
      holds: 12,
      noise: { level: 0.5, reach: 100 },
    },
    landValue: { radius: 140, value: -0.05 },
    blurb: 'Builds and keeps tanks, artillery and trucks, and tests them on the pad at the back.',
    unlockPopulation: 5_000,
    model: 'vehicledepot',
  },
  {
    id: 'radar',
    name: 'Radar station',
    category: 'military',
    dept: 'defence',
    w: 24,
    d: 24,
    cost: 20_000,
    upkeep: 400,
    requires: 'militaryhq',
    military: { jobs: 20, power: 40, radar: 3_000, safety: { radius: 300, value: 0.008 } },
    blurb: 'Sees a force coming from far off: longer warnings before a raid.',
    unlockPopulation: 5_000,
    model: 'radar',
  },
  {
    id: 'antiair',
    name: 'Anti-air battery',
    category: 'military',
    dept: 'defence',
    w: 16,
    d: 16,
    cost: 12_000,
    upkeep: 220,
    requires: 'militaryhq',
    military: {
      jobs: 10,
      power: 10,
      defends: { against: ['air'], strength: 5, range: 320 },
      safety: { radius: 160, value: 0.012 },
    },
    blurb: 'A twin gun in a ring of sandbags: shoots at planes, helicopters and drones overhead.',
    unlockPopulation: 5_000,
    model: 'antiair',
  },
  {
    id: 'coastalgun',
    name: 'Coastal gun',
    category: 'military',
    dept: 'defence',
    w: 16,
    d: 16,
    cost: 14_000,
    upkeep: 240,
    requires: 'militaryhq',
    waterfront: 'shore',
    military: {
      jobs: 10,
      power: 8,
      defends: { against: ['sea'], strength: 6, range: 480 },
      noise: { level: 0.38, reach: 50 },
      safety: { radius: 140, value: 0.01 },
    },
    blurb:
      'A big gun on the shore, facing out to sea: keeps warships away. Stands with its back to the water.',
    unlockPopulation: 5_000,
    model: 'coastalgun',
  },
  {
    id: 'armsfactory',
    name: 'Arms factory',
    category: 'military',
    dept: 'defence',
    w: 48,
    d: 40,
    cost: 40_000,
    upkeep: 500,
    requires: 'militaryhq',
    airPollution: 0.3,
    military: {
      jobs: 200,
      power: 90,
      noise: { level: 0.45, reach: 70 },
      arms: { goods: 90, munitions: 40, storage: 400, vehicleTime: 0.25 },
    },
    landValue: { radius: 160, value: -0.06 },
    blurb:
      'Makes munitions and the goods for vehicles, with plenty of jobs: vehicles train a quarter faster, and the stores hold more.',
    unlockPopulation: 5_000,
    model: 'armsfactory',
  },
  {
    id: 'provingground',
    name: 'Proving ground',
    category: 'military',
    dept: 'defence',
    w: 64,
    d: 48,
    cost: 35_000,
    upkeep: 600,
    requires: 'militaryhq',
    military: { jobs: 40, power: 30, drills: 0.1, noise: { level: 0.55, reach: 140 } },
    landValue: { radius: 160, value: -0.06 },
    blurb: 'A test track and firing range: exercises here keep the whole force sharper (readiness).',
    unlockPopulation: 10_000,
    model: 'provingground',
  },
  {
    id: 'airfield',
    name: 'Airfield',
    category: 'military',
    dept: 'defence',
    w: 200,
    d: 80,
    cost: 120_000,
    upkeep: 2_000,
    requires: 'militaryhq',
    military: {
      jobs: 160,
      power: 120,
      trains: ['fighter', 'helicopter', 'drone', 'bomber', 'skyfortress'],
      holds: 12,
      runway: 520,
      safety: { radius: 260, value: 0.008 },
    },
    landValue: { radius: 260, value: -0.08 },
    blurb:
      'A runway, hangars and a control tower: trains and keeps planes, helicopters and drones. Very loud along its runway.',
    unlockPopulation: 10_000,
    model: 'airfield',
  },
  {
    id: 'navalyard',
    name: 'Naval yard',
    category: 'military',
    dept: 'defence',
    w: 120,
    d: 64,
    cost: 90_000,
    upkeep: 1_500,
    requires: 'militaryhq',
    waterfront: 'deep',
    military: {
      jobs: 140,
      power: 90,
      trains: ['patrolboat', 'gunboat', 'submarine', 'landingcraft', 'clockworkwhale'],
      holds: 8,
      noise: { level: 0.45, reach: 90 },
    },
    landValue: { radius: 200, value: -0.05 },
    blurb:
      'A quay, a covered dry dock and a crane: builds and keeps the navy. Its back must stand in deep water.',
    unlockPopulation: 10_000,
    model: 'navalyard',
  },
  // Research (M37): the weapons lab, the buildings research unlocks, and the superweapon buildings.
  {
    id: 'militarylab',
    name: 'Weapons lab',
    category: 'military',
    dept: 'defence',
    w: 32,
    d: 32,
    cost: 60_000,
    upkeep: 1_500,
    requires: 'militaryhq',
    max: 3,
    military: { jobs: 50, power: 60, lab: { points: 4 } },
    landValue: { radius: 120, value: -0.02 },
    blurb:
      'Engineers in white coats and safety goggles: weapons research, faster with a research park in town. A city runs three at most.',
    unlockPopulation: 5_000,
    model: 'militarylab',
  },
  {
    id: 'spyagency',
    name: 'Spy agency',
    category: 'military',
    dept: 'defence',
    w: 24,
    d: 24,
    cost: 50_000,
    upkeep: 900,
    unique: true,
    requires: 'militaryhq',
    military: { jobs: 30, power: 20, agency: { agents: 2 } },
    blurb:
      'The dullest office in town, with a ramp down to a garage nobody uses. Agents look round rivals’ towns, sabotage them or steal their research, and catch their spies.',
    unlockPopulation: 5_000,
    model: 'spyagency',
  },
  {
    id: 'interceptor',
    name: 'Interceptor battery',
    category: 'military',
    dept: 'defence',
    w: 24,
    d: 24,
    cost: 30_000,
    upkeep: 500,
    requires: 'militaryhq',
    military: {
      jobs: 12,
      power: 30,
      defends: { against: ['air'], strength: 3, range: 360 },
      intercept: { range: 450, chance: 0.5, cooldown: 8 },
      noise: { level: 0.4, reach: 60 },
      safety: { radius: 160, value: 0.012 },
    },
    blurb:
      'Racks of little rockets that knock shells and bombs out of the air before they land on the city’s buildings, and shoot at aircraft.',
    unlockPopulation: 10_000,
    model: 'interceptor',
  },
  {
    id: 'shieldgen',
    name: 'Shield generator',
    category: 'military',
    dept: 'defence',
    w: 24,
    d: 24,
    cost: 80_000,
    upkeep: 1_800,
    requires: 'militaryhq',
    military: {
      jobs: 20,
      power: 200,
      shield: { radius: 300, factor: 2 },
      safety: { radius: 300, value: 0.02 },
    },
    blurb:
      'A humming coil under a glass globe: in a battle, buildings within 300 m stand twice as much. Hungry for power.',
    unlockPopulation: 10_000,
    model: 'shieldgen',
  },
  {
    id: 'domeshield',
    name: 'Dome shield',
    category: 'military',
    dept: 'defence',
    w: 40,
    d: 40,
    cost: 0,
    upkeep: 6_000,
    unique: true,
    requires: 'militaryhq',
    military: { jobs: 60, power: 600, superweapon: 'dome' },
    blurb:
      'A spire that raises a shield over the whole city: it soaks one battle’s blows, then is down for ten days while it charges.',
    unlockPopulation: 20_000,
    model: 'domeshield',
    project: {
      stages: [
        { name: 'Foundations', months: 3, cost: 500_000 },
        { name: 'Conduits and spire', months: 4, cost: 900_000 },
        { name: 'Emitter and test', months: 3, cost: 600_000 },
      ],
      requires: [{ kind: 'research', key: 'defence4', label: 'Dome shield' }],
      perk: 'Charged, the dome rises over the city when a battle comes and soaks its blows until it pops; then it charges again for ten days.',
    },
  },
  {
    id: 'blackouttower',
    name: 'Blackout tower',
    category: 'military',
    dept: 'defence',
    w: 24,
    d: 24,
    cost: 0,
    upkeep: 6_000,
    unique: true,
    requires: 'militaryhq',
    military: { jobs: 50, power: 500, superweapon: 'tower' },
    landValue: { radius: 160, value: -0.05 },
    blurb:
      'A lattice tower crowned with dishes: aimed at a rival, it cuts its power, radar and maps for half a day, then charges for ten.',
    unlockPopulation: 20_000,
    model: 'blackouttower',
    project: {
      stages: [
        { name: 'Base', months: 3, cost: 400_000 },
        { name: 'Tower', months: 4, cost: 700_000 },
        { name: 'Dishes and test', months: 3, cost: 500_000 },
      ],
      requires: [{ kind: 'research', key: 'intel4', label: 'Blackout tower' }],
      perk: 'Black out a rival for 12 hours: its power plants falter, its radar goes quiet and its maps go dark.',
    },
  },
  {
    id: 'expressgate',
    name: 'Express gate',
    category: 'military',
    dept: 'defence',
    w: 48,
    d: 32,
    cost: 0,
    upkeep: 6_000,
    unique: true,
    requires: 'militaryhq',
    military: { jobs: 60, power: 800, superweapon: 'gate', noise: { level: 0.5, reach: 120 } },
    blurb:
      'A great ring on a platform: a force that steps through arrives anywhere in the region within the hour. It charges for five days after.',
    unlockPopulation: 20_000,
    model: 'expressgate',
    project: {
      stages: [
        { name: 'Platform', months: 3, cost: 500_000 },
        { name: 'Ring', months: 4, cost: 900_000 },
        { name: 'First jump', months: 3, cost: 600_000 },
      ],
      requires: [{ kind: 'research', key: 'logistics4', label: 'Express gate' }],
      perk: 'Send a land or air force through the gate: it arrives in an hour, wherever it is going.',
    },
  },
];

/** The war economy and the forces' running numbers (M34). Logged in DECISIONS, "Phase 5". */
export const WAR = {
  /** Readiness: with no HQ it can't rise above this; it moves towards its target by this much a day. */
  noHqReadiness: 0.5,
  readinessPerDay: 0.1,
  /** Units in training don't progress while their base is unpowered or understaffed below this share. */
  minStaffed: 0.25,
  /**
   * The forces take at most this share of the city's workers (they recruit before businesses hire);
   * when the bases want more, every base gets the same share of its posts filled.
   */
  enlistShare: 0.25,
  /** War bonds: borrowing from residents (M34). */
  bonds: [
    { amount: 40_000, annualRate: 0.04, months: 60, unlockPopulation: 2_000 },
    { amount: 120_000, annualRate: 0.045, months: 96, unlockPopulation: 5_000 },
    { amount: 300_000, annualRate: 0.05, months: 120, unlockPopulation: 20_000 },
  ],
  maxBonds: 3,
  /**
   * Bonds cost approval while any are outstanding: this much city-wide mood per dollar outstanding
   * per resident, up to `bondMoodMax` (a $120k bond in a 10,000 town: −0.024).
   */
  bondMood: -0.002,
  bondMoodMax: -0.08,
  /**
   * Materials for the forces (goods, ore, oil) and munitions: the stores fill a day at a time from
   * the city's own industry, mines and wells, paid at the local price (ore and oil not sold); what a
   * unit needs beyond the stores is bought from the region at the import price.
   */
  materials: {
    /** Goods a filled industrial job can spare for the forces a day. */
    goodsPerJob: 0.05,
    /** Share of a mine's or well's output the stores may take while they're below full. */
    resourceShare: 0.5,
    localPrice: { goods: 12, ore: 14, oil: 24, munitions: 20 },
    importPrice: { goods: 30, ore: 36, oil: 55, munitions: 45 },
    /** Stores before an arms factory adds its own. */
    storage: { goods: 200, ore: 150, oil: 150, munitions: 100 },
  },
  /** Residents' liking for feeling safe, by wealth (the wealthy like it most). */
  safetyLike: [0.7, 1, 1.25] as [number, number, number],
};

/**
 * How far a war may go (SPEC-5): a skirmish (a raid on military and border targets; nothing changes
 * hands), a war (declared, with peace terms and occupied districts), or total war (a city whose city
 * hall is held long enough can be conquered).
 */
export type WarScale = 'skirmish' | 'war' | 'total';
export const WAR_SCALES: readonly WarScale[] = ['skirmish', 'war', 'total'];
export const WAR_SCALE_NAMES: Record<WarScale, string> = {
  skirmish: 'Skirmishes only',
  war: 'Up to war',
  total: 'Total war allowed',
};

/**
 * A shared region's rules for war (M34), set by its host: is war on, how far may it go, and (M37)
 * are superweapons allowed (stored only when they are: absent means off, so older regions keep
 * their meaning).
 */
export interface RegionWarRules {
  war: boolean;
  scale: WarScale;
  supers?: true;
}
export const PEACE_RULES: RegionWarRules = { war: false, scale: 'skirmish' };

/** The rules in a sentence, for notices and refusals ("Your region's rules allow skirmishes only"). */
export function warRulesText(r: RegionWarRules): string {
  if (!r.war) return 'war is off';
  const scale =
    r.scale === 'skirmish' ? 'skirmishes only' : r.scale === 'war' ? 'war, but not total war' : 'total war';
  return r.supers ? `${scale}, superweapons allowed` : scale;
}

/** Are two sets of rules the same? */
export function sameWarRules(a: RegionWarRules, b: RegionWarRules): boolean {
  return a.war === b.war && a.scale === b.scale && !!a.supers === !!b.supers;
}

/** A clean copy of rules from outside (a region's message), or null if they don't make sense. */
export function cleanWarRules(raw: unknown): RegionWarRules | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || typeof r.war !== 'boolean') return null;
  if (!WAR_SCALES.includes(r.scale as WarScale)) return null;
  return { war: r.war, scale: r.scale as WarScale, ...(r.supers === true ? { supers: true as const } : {}) };
}

/** A computer neighbour's character in war (SPEC-5): how it arms, fights, trades and keeps its word. */
export type Personality = 'aggressive' | 'cautious' | 'mercantile' | 'honourable' | 'treacherous';
export const PERSONALITY_IDS: readonly Personality[] = [
  'aggressive',
  'cautious',
  'mercantile',
  'honourable',
  'treacherous',
];

export interface PersonalityDef {
  name: string;
  blurb: string;
  /** Forces it keeps per 1,000 residents (strength points, as `UnitDef.strength`), and defences. */
  forces: number;
  defences: number;
  /** How readily it goes to war (0–1), keeps a pact (0–1), and trades (0–1); used from M35. */
  aggression: number;
  keepsPacts: number;
  trade: number;
  /** Where its feelings towards the city start (−100 to 100). */
  relation: number;
}

export const PERSONALITY: Record<Personality, PersonalityDef> = {
  aggressive: {
    name: 'Aggressive',
    blurb: 'Arms hard and picks fights: expect raids once it thinks it can win.',
    forces: 2.4,
    defences: 0.8,
    aggression: 0.8,
    keepsPacts: 0.5,
    trade: 0.3,
    relation: -20,
  },
  cautious: {
    name: 'Cautious',
    blurb: 'Digs in behind strong defences and rarely starts anything.',
    forces: 1,
    defences: 1.8,
    aggression: 0.15,
    keepsPacts: 0.8,
    trade: 0.5,
    relation: 0,
  },
  mercantile: {
    name: 'Mercantile',
    blurb: 'Would rather trade than fight: keeps a modest force and sells arms to anyone.',
    forces: 0.8,
    defences: 1,
    aggression: 0.2,
    keepsPacts: 0.7,
    trade: 0.9,
    relation: 10,
  },
  honourable: {
    name: 'Honourable',
    blurb: 'Keeps its word and its pacts, and expects the same: break one and it remembers.',
    forces: 1.4,
    defences: 1.2,
    aggression: 0.35,
    keepsPacts: 1,
    trade: 0.6,
    relation: 5,
  },
  treacherous: {
    name: 'Treacherous',
    blurb: 'Smiles, signs, and strikes when you look away: never trust a pact with it.',
    forces: 1.8,
    defences: 0.8,
    aggression: 0.6,
    keepsPacts: 0.2,
    trade: 0.5,
    relation: 0,
  },
};

/** Computer neighbours' forces (M34): they arm towards their character's level month by month. */
export const RIVALS = {
  /** Share of the gap to its target strength a neighbour closes each month. */
  arming: 0.06,
  /** Monthly jitter in that, either way (share). */
  jitter: 0.25,
};
