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
};
