/**
 * The atom bomb (phase 5, M40): the last prize cities race for. Very hard to get, terrible to use.
 * The numbers here; the sim side is `src/sim/systems/atom.ts`. DESIGN.md §3.34, docs/DECISIONS.md
 * "M40", the plan docs/plans/M40-design.md (calls 4 to 10).
 *
 * Times are "war hours": the war clock's, which in a city of its own runs one a game hour and in a
 * region is held to the region's fair clock. The flight is the exception: it runs on the target
 * city's own clock. A game hour is 7.5 seconds of play at 1×, a game day (a "month") 3 minutes, a game
 * year 36. The buildings' own prices, stages, staff and upkeep are their definitions' (the Military
 * buildings in `src/data/war.ts`); what is here is what happens once they stand.
 *
 * Tone: a toy look and a plain voice. Nothing that names people hurt: residents who leave the city
 * are counted as having left, and no string here says more.
 */
import { DOME } from './research';

/** How far along the race a city is, in order (the index is the stage number the region report carries). */
export type AtomStage =
  'none' | 'plant' | 'enriching' | 'silo' | 'bomb' | 'ready' | 'preparing' | 'flying' | 'spent';

export const ATOM_STAGES: readonly AtomStage[] = [
  'none',
  'plant',
  'enriching',
  'silo',
  'bomb',
  'ready',
  'preparing',
  'flying',
  'spent',
];

/** A stage's number, 0 (nothing started) to 8 (the bomb used). */
export function atomStageNo(stage: AtomStage): number {
  return ATOM_STAGES.indexOf(stage);
}

/** What each stage is called, for the war room's ladder, the region's notices and the map. */
export const ATOM_STAGE_NAMES: Record<AtomStage, string> = {
  none: 'Nothing started',
  plant: 'Enrichment plant going up',
  enriching: 'Enriching fuel',
  silo: 'Silo going up',
  bomb: 'Building the bomb',
  ready: 'Atom bomb ready',
  preparing: 'Preparing a launch',
  flying: 'Atom bomb in flight',
  spent: 'Atom bomb used',
};

export const ATOM = {
  /**
   * Fuel (call 5): a full load takes `hours` war hours with the plant working at full staff and power
   * (and funding, up to `fundingMax` times), at `cost` dollars an hour while it works. Four game
   * years, 144 minutes of play at 1×.
   */
  fuel: { hours: 1_152, cost: 2_000, fundingMax: 1.25 },
  /**
   * The bomb's build (call 6): `hours` war hours at the silo's rate, paid in instalments, the first
   * when it starts and then every `every` hours (twelve in all). Each instalment takes the money and
   * materials from the war stores first and buys the rest at the import price.
   */
  bomb: {
    hours: 720,
    every: 60,
    instalment: { money: 650_000, goods: 50, ore: 200, oil: 167 },
  },
  /**
   * A launch (call 7): the price, the preparation (war hours at the silo's rate, starting over if
   * damage closes the silo) and the share of the price that comes back if it is called off. A prepared
   * bomb waits as long as it likes.
   */
  launch: { cost: 1_200_000, prepHours: 288, refund: 0.5 },
  /**
   * What the prices (these and the two buildings') were sized against: the 57,000-resident careful
   * city of the balance runs, taking about this much in taxes a year. The silo and the bomb come to
   * about three years of it and the whole race to five or six, "several years of a big city's entire
   * income". A 110,000-resident city, with twice the taxes, reads about half of that
   * (`scripts/dev/atomprice.ts` prints both). `atomPrices` is the sum, and its test the band.
   */
  priceCity: { residents: 57_000, taxesPerYear: 3_600_000 },
  /**
   * The flight (call 8): game hours on the target city's own clock between the warning and the
   * landing, and, on the display clock, the seconds between the siren's two-tone calls and the
   * last seconds that tick.
   */
  flight: { hours: 24, sirenEvery: 6, tickLast: 10 },
  /** The dome (call 9): hours it stays down after stopping a bomb, before it starts charging again. */
  dome: { down: DOME.bombRecharge - DOME.chargeHours },
  /**
   * The impact (call 10), in metres and war hours. Ground zero is the densest `window` of the city
   * (summed from `bucket` cells); within `level` everything is levelled, in hourly slices of at most
   * `slice` buildings; civic buildings out to `civicReach` times that stand closed for `civicClosed`
   * hours, roads inside it for `roadClosed`; trees go out to `treeReach` times it, fires start out to
   * `fireReach` times it (at most `fires`), and a crater of `crater` metres is left. An open hosted
   * battle makes the bomb wait up to `battleWait` hours.
   */
  impact: {
    level: 450,
    window: 520,
    bucket: 64,
    slice: 400,
    civicReach: 1.5,
    civicClosed: 72,
    roadClosed: 240,
    treeReach: 1.6,
    fireReach: 1.5,
    fires: 400,
    /**
     * Fires are set at most this many a tick, nearest first, from the tick after the landing on
     * (lighting one dispatches a fire engine and costs about 0.08 ms on the 100k city, so the whole
     * ring's worth at once would take 30 to 40 ms): the rest follow on the next ticks.
     */
    firesPerTick: 120,
    crater: 90,
    battleWait: 12,
    /** The chance a building at the blast's edge catches fire, falling to nothing at the fire reach. */
    fireChance: 0.7,
    /**
     * Civic buildings inside the blast come down at most this many a tick, nearest first, once the
     * fires are set (taking one away re-checks the lots round it: 4 ms each on the 100k city, so all
     * at once would blow the tick), not in the hourly slices; and, because a big one costs several
     * small ones, a tick stops taking more once the lots round the ones it has taken (the cells of
     * the box `removeCivic` re-checks) come to `civicCells`. Always at least one a tick. About 1 ms
     * to 100 cells on the 100k city, so a tick's civic work stays under about 10 ms whatever stands.
     */
    civicsPerTick: 3,
    civicCells: 500,
  },
  /**
   * What a bomb that lands on a computer neighbour does to its record (call 10): the share of its
   * people, forces and defences left, its feeling for the city, its fallout level (1: a direct hit)
   * and the swing of the war score (`scoreIntel`, in a war that is open).
   */
  record: { keep: 0.4, relation: -100, fallout: 1, score: 60 },
  /**
   * The dread of a bomb on its way, and for `days` after it lands (call 8): the raid dip's
   * approval term (`raidMood`) scaled by this much, by the share of nearby residents the shelters
   * can't take.
   */
  warning: { mood: 0.08, days: 3 },
  /**
   * The world turns on the city that fires the bomb (M40 step 6, plan call 14), the moment it
   * leaves, stopped or not. Every computer neighbour's feeling for the city falls: the target's to
   * `target`, its allies' by `allies`, every other neighbour's by `others`. A neighbour may then
   * declare a total war on the city whatever its character (`floor`: it declares at the chance of one
   * at least that aggressive), whenever (no cooldown after a war that ended), against a city half as
   * strong as itself (`ratio`: the usual is one and a half times).
   */
  world: { target: -100, allies: -40, others: -40, ratio: 0.5, floor: 0.5 },
  /**
   * The protest at home (call 14): the firing city's people are ashamed. Approval takes `approval`
   * (a city-wide term) and every home's happiness `home`, each starting at `start` when the bomb
   * leaves and easing, in a straight line over `hours` game hours (the city's own clock: it is the
   * people's mood, not the war's), to `end`, which stays: shame fades but never goes.
   */
  shame: {
    approval: { start: -0.3, end: -0.05 },
    home: { start: -0.25, end: -0.06 },
    hours: 720,
  },
  /**
   * The deterrent (call 15): what a computer neighbour adds to its liking for peace, a ceasefire and
   * the pacts of friendship with a city that has the bomb ready or is preparing to use it. It also
   * fights such a city a limited war, never a total one.
   */
  deter: 15,
  /**
   * Spies and the race (M40 step 7, plan call 18). A sabotage of the race's works that gets through
   * sets a plant or silo still going up back `setBack` war hours (its stage clock), takes that many
   * hours of work from a finished one (fuel at the plant, the bomb's build at the silo: instalments
   * paid stay paid) and closes it `closed` game hours. While an enrichment plant stands the city's
   * counter-intelligence is `guard` per thousand higher (guards at the gate). A won expedition sets a
   * computer neighbour's race back `expedition` war hours.
   */
  spy: { setBack: 120, closed: 12, guard: 150, expedition: 240 },
};

/** The stages of a computer neighbour's race: the city's stages from the fuel on (it builds no plant to see). */
export type RivalStage = Extract<AtomStage, 'enriching' | 'silo' | 'bomb' | 'ready' | 'preparing' | 'spent'>;
/** ... in the order a race takes them. */
export const RIVAL_STAGES: readonly RivalStage[] = [
  'enriching',
  'silo',
  'bomb',
  'ready',
  'preparing',
  'spent',
];

/**
 * A computer neighbour's race for the bomb (M40 step 7, plan call 19), Hard difficulty only. A
 * neighbour starts once the city is `years` game years old, the neighbour has weapons `tech` 4 and
 * `population` residents and no other neighbour is racing, by a chance a month of `chance` times
 * (`character` + its aggression), on dice of their own (`${seed}:bomb:${month}`). Each stage takes
 * `hours` war hours (fuel, then the silo, then the bomb), set back by the city's spies and forces.
 * A finished bomb waits until the neighbour is desperate (an open total war with the war score, from
 * the city's side, at or above `desperate`); it then prepares for `prep` war hours (ten game days)
 * and, if it still is desperate, launches once, at the city.
 */
export const RIVAL_BOMB = {
  years: 20,
  tech: 4,
  population: 40_000,
  chance: 0.015,
  character: 0.5,
  hours: { enriching: 1_500, silo: 500, bomb: 800 } as Record<'enriching' | 'silo' | 'bomb', number>,
  prep: 240,
  desperate: 45,
};

/**
 * Why the city's saboteurs can't be sent for the atom bomb's works at this neighbour, or null (M40
 * step 7). A computer neighbour must be racing with its bomb not finished (a bomb waiting for its war,
 * or used, has nothing to slow); a friend's city, as its last report said (a stage from the plant to
 * a launch being prepared: the report carries it from step 9). Pure, so the war room's menu and the
 * sim's refusal read the same thing.
 */
export function raceSlowWhy(n: {
  name: string;
  player?: { atom?: { stage: number } };
  rival?: { bomb?: { stage: string } };
}): string | null {
  if (n.player) {
    const stage = n.player.atom?.stage ?? 0;
    return stage >= 1 && stage <= atomStageNo('preparing')
      ? null
      : `${n.name} isn’t racing for the atom bomb`;
  }
  const stage = n.rival?.bomb?.stage;
  if (!stage) return `${n.name} isn’t racing for the atom bomb`;
  if (stage === 'ready') return `${n.name} has finished its atom bomb: there is nothing left to slow`;
  if (stage === 'spent') return `${n.name} has used its atom bomb`;
  return null;
}

/** A span of war hours in words: "5 days", or "9 hours" under a day. */
export function spanWords(hours: number): string {
  const h = Math.round(hours);
  if (hours < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** The notice a computer neighbour's stage gives the city (call 19), in a plain voice. */
export function rivalNotice(stage: AtomStage, who: string): string {
  switch (stage) {
    case 'enriching':
      return `${who} has begun enriching fuel for an atom bomb.`;
    case 'silo':
      return `${who} has begun building an atom silo.`;
    case 'bomb':
      return `${who} is building the atom bomb.`;
    case 'ready':
      return `${who} has the atom bomb.`;
    default:
      return `${who} is racing for the atom bomb.`;
  }
}

/**
 * Fallout (M40 step 4, plan calls 11 and 12): a ground layer that stays and decays, and an air layer
 * that moves with the city's wind. Rasters of the pollution's size (128 cells of 16 m); everything is
 * "per update", an update being three game hours (the pollution's rhythm, run in the slot after it).
 * The sim side is `src/sim/systems/fallout.ts`.
 */
export const FALLOUT = {
  /**
   * Half-life of the ground layer and of a computer neighbour's level, in game years: 8, so the
   * core of a strike (1.0) falls below the ban (0.2) after 8 log2(5) = 18.6 years, 11 hours of play.
   */
  halfLifeYears: 8,
  /** Ground at or above this level is closed: nothing can be zoned, placed or grown on it. */
  ban: 0.2,
  /**
   * The strike's ground deposit: `min(1, peak (1 - d / reach)^shape)` at distance d metres from
   * ground zero (0.2 at about 570 m), and the share of the mass that is put into the air instead,
   * over the downwind side, to be carried off.
   */
  impact: { peak: 1.3, reach: 720, shape: 1.2, plume: 0.3 },
  /**
   * One update of the air: it moves `wind` cells along the city's wind (as the smoke does), diffuses
   * (the share a cell takes from its four neighbours' mean), loses `deposit` of what it holds to the
   * ground and decays; the ground diffuses a little. Cells below `floor` snap to 0.
   */
  air: { wind: 4, diffusion: 0.2, deposit: 0.02, decay: 0.97 },
  ground: { diffusion: 0.02 },
  floor: 1e-5,
  /**
   * What the air carries out across the map's edges (call 12): the shift of one update is counted
   * where it carries air off the north, south or west edge (the east edge is a sink), into a
   * cumulative counter rounded to `round`. Air thinner than `town.inflow`, the thickest stream a
   * neighbour can send, is haze and is not counted (a neighbour's stream passing through the city must
   * not make the next town ill, nor be taken back to the one it came from). A computer neighbour on
   * that side gains `town.share x counted / town.scale` fallout (at most 1); its growth is dragged by
   * `town.drag` x its level a month. And from a neighbour with fallout upwind, `town.inflow` x its
   * level is the air's concentration beyond that edge, drifting in when the wind blows from that side.
   * (`scale` 750: a strike in the middle of the map gives the downwind neighbour about 0.28.)
   */
  edge: { round: 0.001 },
  town: { share: 0.6, scale: 750, drag: 0.01, inflow: 0.006 },
  /**
   * What fallout does where people are, with `dose` = ground + `airDose` x air, at most 1: sickness
   * (new cases per resident per hour, on top of HEALTH's), a home's mood, the share of its work that
   * is lost (taxes, freight, specialisation income: at most `workMax`), and land value.
   */
  airDose: 0.5,
  effect: { sickness: 0.04, mood: -0.6, work: 1.2, workMax: 0.6, landValue: 0.6 },
  /**
   * A clean-up job (call 11): `cost` dollars (`relief` times that for relief crews, hired by a city
   * that hasn't researched `tier`), `hours` of the city's own time, `jobs` at a time, within `radius`
   * metres the ground is multiplied by `keep`. A spot whose ground is below `min` is not worth a job.
   */
  cleanup: {
    cost: 350_000,
    relief: 2,
    tier: 'logistics2',
    hours: 96,
    jobs: 3,
    radius: 128,
    keep: 0.5,
    min: 0.02,
  },
  /** Game hours in a game year and seconds of play per game hour at 1x, for "hours of play". */
  yearHours: 288,
  secondsPerHour: 7.5,
};

/**
 * The nuclear winter (M40 step 5, plan call 13): a bomb that lands anywhere darkens every city's sky.
 * A winter is a depth (1 for the first bomb; `later` for one that lands while another still holds)
 * that rises for `rise` game hours, holds for `hold` and falls back over `fall` (6 game years in all,
 * 3.6 hours of play at 1x); winters in force add up to at most `cap`. At depth d the month's mean
 * temperature is `chill x d` degrees lower (every month, seasons on or off), the sun gives `solar x d`
 * less, rain and storms fall as snow up to `snowLine x d` degrees above the usual snow line, and from
 * `noHeat` on a heatwave drawn turns into a cloudy spell. A computer neighbour's town grows `townDrag
 * x d` slower a month. Everything is a value: no winter reads or adds a draw on any random stream.
 * The sim side is `winterDepth` in `src/sim/systems/weather.ts`.
 */
export const WINTER = {
  rise: 144,
  hold: 576,
  fall: 1_008,
  /** Game hours in a game year, for "year 2 of 6". */
  yearHours: 288,
  cap: 1.5,
  later: 0.5,
  chill: 18,
  solar: 0.55,
  snowLine: 6,
  noHeat: 0.25,
  townDrag: 0.008,
};

/** Game hours a winter lasts from its first bomb to its last cold day, and how many game years that is. */
export const WINTER_HOURS = WINTER.rise + WINTER.hold + WINTER.fall;
export const WINTER_YEARS = WINTER_HOURS / WINTER.yearHours;

/**
 * The line the city's history shows for one of the bomb's moments (the chronicle's `atom` events,
 * whose `ref` is `what` or `what:who`; `src/sim/systems/atomWorld.ts` writes them). A plain voice.
 */
export function atomEventText(ref: string | number): string {
  const text = String(ref);
  const at = text.indexOf(':');
  const what = at < 0 ? text : text.slice(0, at);
  const who = at < 0 ? '' : text.slice(at + 1);
  switch (what) {
    case 'ready':
      return 'Finished the atom bomb';
    case 'fired':
      return who ? `Fired the atom bomb at ${who}` : 'Fired the atom bomb';
    case 'landed':
      return who ? `The atom bomb fell on ${who}` : 'The atom bomb fell';
    case 'hit':
      return who ? `An atom bomb from ${who} fell on the city` : 'An atom bomb fell on the city';
    case 'stopped':
      return who ? `The dome stopped an atom bomb from ${who}` : 'The dome stopped an atom bomb';
    // A computer neighbour's race (Hard), stage by stage.
    case 'rivalFuel':
      return `${who || 'A neighbour'} began enriching fuel for an atom bomb`;
    case 'rivalSilo':
      return `${who || 'A neighbour'} began building an atom silo`;
    case 'rivalBomb':
      return `${who || 'A neighbour'} began building an atom bomb`;
    case 'rivalReady':
      return `${who || 'A neighbour'} finished an atom bomb`;
    default:
      return 'The atom bomb';
  }
}
