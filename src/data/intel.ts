/**
 * Intelligence (M37, SPEC-5.md): spies from a spy agency reveal a rival's defences, sabotage a power
 * plant or a depot, or steal research; counter-intelligence catches them, and a caught spy is a
 * diplomatic incident. Odds are whole numbers per thousand, worked out the same way by the sim (a
 * computer neighbour's town) and by the region room (a friend's city), in every browser.
 */
import type { TierKey } from './research';

export type SpyOp = 'reveal' | 'sabotage' | 'steal';
export const SPY_OPS: readonly SpyOp[] = ['reveal', 'sabotage', 'steal'];
export type SabotageTarget = 'power' | 'depot';

export interface SpyOpDef {
  name: string;
  /** The research it needs, its price, and war-clock hours there and back (the outcome at half way). */
  research: TierKey;
  cost: number;
  hours: number;
  /** Chance of success before counter-intelligence, and the share of the rest that is caught (‰). */
  success: number;
  caughtShare: number;
}

export const SPY_OP: Record<SpyOp, SpyOpDef> = {
  reveal: { name: 'Look round', research: 'intel2', cost: 20_000, hours: 8, success: 850, caughtShare: 300 },
  sabotage: { name: 'Sabotage', research: 'intel2', cost: 45_000, hours: 16, success: 600, caughtShare: 500 },
  steal: {
    name: 'Steal research',
    research: 'intel3',
    cost: 60_000,
    hours: 24,
    success: 500,
    caughtShare: 500,
  },
};

/** Intelligence's running numbers (M37). Logged in DECISIONS, "M37". */
export const INTEL = {
  /** Agents the agency keeps (Stealth research brings a third), and hours until a caught one is replaced. */
  agents: 2,
  replaceHours: 48,
  /** What a revealed rival shows for, and the edge it gives battles there and warnings of its raids. */
  revealHours: 240,
  revealReadiness: 0.1,
  revealWarning: 2,
  /** Sabotage: guns manned this much for this long after a power plant is hit, no raids meanwhile. */
  sabotagePowerHours: 72,
  sabotageManning: 0.5,
  /** Sabotage of a depot: its forces this much at once, and no arming for this many months. */
  sabotageDepotForces: 0.9,
  sabotageDepotMonths: 6,
  /** A building of the city's that saboteurs close, for this many hours. */
  sabotageClosed: 24,
  /** Stealing banks this share of a tier's points (once per neighbour and tier). */
  stealShare: 0.25,
  /** A computer neighbour's spy that steals from the city brings its next tech step this many war hours sooner. */
  theirStealSooner: 6 * 24,
  /**
   * Counter-intelligence (‰): the city's from its agency and research, a computer neighbour's from
   * its character, at war, after catching a spy, and its tech.
   */
  counter: {
    base: 50,
    agency: 300,
    intel1: 50,
    intel2: 100,
    intel3: 100,
    atWar: 100,
    max: 750,
    rival: { cautious: 400, honourable: 300, treacherous: 300, mercantile: 250, aggressive: 200 },
    rivalAtWar: 200,
    rivalAfterCatch: 150,
    rivalCatchHours: 72,
    rivalPerTech: 50,
    rivalMax: 850,
  },
  /** A computer neighbour's spies: each month's chance (aggressive and treacherous ones more), at most one a month. */
  rivalSpies: { chance: 0.05, eager: 0.12, atWar: 2, pact: 0.5, neutral: 0.25, arriveMin: 8, arriveMax: 24 },
  /** The city hears of a quiet look or theft only with this much counter-intelligence. */
  noticeCounter: 400,
  /** Incidents: a spy of the city's caught (reputation, the neighbour's relation, under a pact, its allies). */
  caught: { reputation: -5, relation: -15, relationPact: -25, allies: -5, freshHours: 24 },
  /** A spy of theirs caught here: their relation, and how long war may be declared on them at no cost. */
  theirsCaught: { relation: -10, grievanceHours: 72 },
  /** In a declared war: a sabotage that worked, or a spy caught, moves the score this much. */
  score: 3,
};

/** Odds of a mission, in whole numbers per thousand. */
export interface SpyOdds {
  success: number;
  caught: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The odds of an operation (‰): by the sender's intelligence tier (0–4), the target's
 * counter-intelligence (‰), whether the target was revealed lately (sabotage and theft are surer),
 * and Stealth (fewer caught). Whole numbers only, so every browser and the room agree.
 */
export function spyOdds(
  op: SpyOp,
  intelTier: number,
  counter: number,
  revealed: boolean,
  stealth: boolean,
): SpyOdds {
  const d = SPY_OP[op];
  const success = clamp(
    d.success +
      50 * (intelTier - 2) -
      Math.floor((2 * counter) / 5) +
      (revealed && op !== 'reveal' ? 100 : 0),
    100,
    950,
  );
  let caught = Math.floor(((1000 - success) * d.caughtShare) / 1000) + Math.floor(counter / 4);
  if (stealth) caught = Math.floor((7 * caught) / 10);
  caught = clamp(caught, 50, 1000 - success);
  return { success, caught };
}

/** What a roll (0–999) gives with these odds: success, caught, or a quiet failure in between. */
export function spyOutcome(roll: number, odds: SpyOdds): 'success' | 'failed' | 'caught' {
  if (roll < odds.success) return 'success';
  if (roll >= 1000 - odds.caught) return 'caught';
  return 'failed';
}

/** Agent names, by mission id (no dice). */
export const AGENT_NAMES = [
  'Plum',
  'Hazel',
  'Juniper',
  'Quill',
  'Tansy',
  'Bramble',
  'Sorrel',
  'Wren',
  'Fennel',
  'Pippin',
  'Marlow',
  'Clove',
];
