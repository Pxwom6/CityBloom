import type { LiveState } from '../../../src/client/liveBattles';

/**
 * M39 step 10's soak: what the four pages, the story and the checks share. See `world.ts` for the
 * soak itself and `scripts/dev/regionsoak.ts` for how to run it.
 */

export interface SoakOptions {
  /** Minutes of the room's time to play (real minutes in real mode; the same minutes of game clock in virtual). */
  minutes: number;
  /**
   * `real`: the local relay over real sockets, the wall clock and the game's own pace (the cities at 1×).
   * `virtual`: the same room in this process over loopback links with a clock the soak moves, as fast as
   * the machine runs: for tests and for finding a failure again (it plays the same story every time).
   */
  mode: 'real' | 'virtual';
  /** Randomness of the story (who attacks whom, which orders, when someone's connection drops). */
  seed: string;
  /** The cities' speed (1: the fair clock's pace; real mode only is honest about anything above). */
  speed: 1 | 2 | 3;
  /** The game's fair clock on (real mode); virtual mode, like the tests, leaves it off. */
  fairClock: boolean;
  /** Drops, outages, reloads and absences. */
  disturb: boolean;
  /**
   * Also crashes: a page that dies with no goodbye and comes back from its last autosave (up to five
   * minutes old), so what it did since is lost and the room and the other pages know more than it does.
   */
  crash?: boolean;
  /** Where lines go (the console and a log file). */
  log: (line: string) => void;
  /** Called with the play's state now and then (every progress line): a runner keeps what it has found so far. */
  onProgress?: (w: import('./world').Soak) => void;
  /** The relay's port in real mode (0: any free one). */
  port?: number;
  /**
   * The story: `full` plays every part (two wars, an alliance and its help, a treaty, a total war to a
   * conquest and the vassal's dues, and late in the run M40's atom bomb: a race, a total war, a strike
   * the region keeps, a landing and the winters it brings); `short` only what fits in a few minutes of
   * room time, with no bomb.
   */
  story: 'full' | 'short';
  /**
   * How long the region waits before it keeps a friend's atom strike, in ms of room time (the real
   * room's 20 minutes would be a fifth of the milestone's run: the e2e's relay shortens it the same way).
   */
  atomPrep?: number;
}

export interface Failure {
  /** Ms of room time since the soak began. */
  at: number;
  kind: string;
  text: string;
  /** How often it was seen (the same problem again is one failure). */
  times: number;
}

/** What a page showed of a live battle, as it last saw it. */
export interface ViewOfBattle {
  slot: number;
  role: 'attacker' | 'defender';
  state: LiveState;
  /** Room ms when this page last saw the battle. */
  seen: number;
}

/** A live battle the soak watched from the first state any page showed of it. */
export interface BattleLog {
  id: string;
  attacker: number;
  defender: number;
  attackerName: string;
  defenderName: string;
  /** Room ms: first seen, last seen running. */
  began: number;
  lastSeen: number;
  views: Map<number, ViewOfBattle>;
  /** Players who dropped, left, reloaded or lost their connection while it ran (name, what, when). */
  disturbed: { name: string; what: string; at: number }[];
  /** Orders the soak gave in it, by side. */
  orders: { attacker: number; defender: number };
  /** An ally's help sent into it (the ally's name). */
  helpedBy: string[];
  /** The expedition the attacker's sim sent (to find its report), once known. */
  expedition?: { player: string; id: number };
  /** Checked at the end of the run or when the room said it was over. */
  judged?: { ok: boolean; explained?: string; problem?: string };
}

/**
 * A friend's atom strike the region kept, as the soak followed it (M40 step 13): the firer's bomb has left
 * its silo and the region has told the target. Each count is of fresh applications by that city's sim.
 */
export interface StrikeLog {
  /** The firer's place and the target's, e.g. `1>3`. */
  id: string;
  firer: number;
  target: number;
  firerName: string;
  targetName: string;
  /** Room ms the strike was first seen kept, and its ticket (see `Soak.ticket`). */
  keptAt: number;
  keptTicket: number;
  /** The target's sim took the strike (and began the countdown); the firer's sim fired; the bomb landed; the dome stopped it. */
  taken: number;
  fired: number;
  landed: number;
  stopped: number;
  /** Where it stands: the region has it; the target's city has it (the countdown runs); it landed; the blast is over (or it was stopped). */
  phase: 'kept' | 'taken' | 'landed' | 'over';
  /** Players who dropped, left, reloaded or crashed while it was in the air or the blast was on (name, what, when). */
  disturbed: { name: string; what: string; at: number }[];
}

/** One kind of thing the story did, counted so the report can say what the soak covered. */
export type Cover =
  | 'raids'
  | 'raidsRefused'
  | 'recalled'
  | 'liveBattles'
  | 'oldBattles'
  | 'orders'
  | 'helpSent'
  | 'helpBooked'
  | 'declared'
  | 'warsOpened'
  | 'proposals'
  | 'declined'
  | 'treaties'
  | 'pacts'
  | 'capitulations'
  | 'conquests'
  | 'vassalDues'
  | 'freed'
  | 'drops'
  | 'outages'
  | 'reloads'
  | 'leaves'
  | 'crashes'
  | 'handovers'
  | 'disturbedBattles'
  // M40's atom bomb between friends: the race, the strike the region kept, what the cities made of it.
  | 'bombsReady'
  | 'strikesKept'
  | 'strikesHeld'
  | 'strikesTaken'
  | 'bombsLanded'
  | 'wintersTaken'
  | 'falloutIn'
  | 'atomDisturbed';

export const COVER_KEYS: Cover[] = [
  'raids',
  'raidsRefused',
  'recalled',
  'liveBattles',
  'oldBattles',
  'orders',
  'helpSent',
  'helpBooked',
  'declared',
  'warsOpened',
  'proposals',
  'declined',
  'treaties',
  'pacts',
  'capitulations',
  'conquests',
  'vassalDues',
  'freed',
  'drops',
  'outages',
  'reloads',
  'leaves',
  'crashes',
  'handovers',
  'disturbedBattles',
  'bombsReady',
  'strikesKept',
  'strikesHeld',
  'strikesTaken',
  'bombsLanded',
  'wintersTaken',
  'falloutIn',
  'atomDisturbed',
];

/**
 * When the story's atom act is played (M40 step 13). It begins late, so the M39 acts have happened: at
 * `from` of the run, and never before minute `earliest`. One act needs about `minutes` of room time (the
 * region's wait for a launch, the war's warning, a countdown of three minutes, the blast and the winters,
 * with a disturbance or two); a run of `needs` minutes has room for one, a run of `second` for two.
 */
export const ATOM_ACT = { from: 0.5, earliest: 25, minutes: 28, needs: 60, second: 110 };

/** The minute of the run the first atom act begins. */
export const atomStartMinute = (minutes: number): number =>
  Math.max(ATOM_ACT.earliest, Math.floor(minutes * ATOM_ACT.from));

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
