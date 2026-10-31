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
   * conquest and the vassal's dues); `short` only what fits in a few minutes of room time.
   */
  story: 'full' | 'short';
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
  | 'disturbedBattles';

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
];

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
