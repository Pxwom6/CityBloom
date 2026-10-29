/**
 * Diplomacy and the stakes of war (phase 5, M36): declarations, the war score, treaties and their
 * terms, conquest and vassals, and the fairness limits. The numbers here; the sim side is
 * `src/sim/systems/diplomacy.ts`. DESIGN.md §3.30, docs/DECISIONS.md "M36".
 */
import type { Personality } from './war';

/** The scales a war can be declared at (a skirmish needs no declaration). */
export type DeclaredScale = 'war' | 'total';

/** Which side of a treaty a term binds: this city, or the other. */
export type Party = 'us' | 'them';

/**
 * A treaty's terms. Money terms name who pays; a demilitarised zone and an occupied district name
 * whose side of the border (or whose district) they are on.
 */
export type Term =
  /** No battles between the two for so many hours. */
  | { k: 'ceasefire'; hours: number }
  /** The war ends. */
  | { k: 'peace' }
  /** A sum paid once, when the treaty is signed. */
  | { k: 'reparations'; payer: Party; amount: number }
  /** An amount a month for so many months, a line in the ledger. */
  | { k: 'tribute'; payer: Party; amount: number; months: number }
  /** Military buildings within `DIPLOMACY.dmz` metres of the shared border stand down. */
  | { k: 'dmz'; side: Party; months: number }
  /** A district's taxes go to the other side until it's returned or bought back. */
  | { k: 'occupy'; side: Party; district: number }
  /** An occupied district is handed back. */
  | { k: 'release'; side: Party; district: number }
  /** Neither side attacks the other for so many months. */
  | { k: 'nonAggression'; months: number }
  /** Each joins the other's wars. */
  | { k: 'alliance' }
  /** Each joins a war declared on the other. */
  | { k: 'defensivePact' }
  /** No deals between the two (M23's), until trade resumes. */
  | { k: 'embargo' }
  /** An embargo ends. */
  | { k: 'trade' }
  /** A vassal goes free. */
  | { k: 'independence' }
  /**
   * A town held by the other side as its subject goes free (M39, scenarios): `town` is the freed
   * neighbour's id. Only a neighbour that holds a subject town can be asked for it.
   */
  | { k: 'liberate'; town: number };

export type TermKind = Term['k'];

export const TERM_KINDS: readonly TermKind[] = [
  'ceasefire',
  'peace',
  'reparations',
  'tribute',
  'dmz',
  'occupy',
  'release',
  'nonAggression',
  'alliance',
  'defensivePact',
  'embargo',
  'trade',
  'independence',
  'liberate',
];

export const TERM_NAMES: Record<TermKind, string> = {
  ceasefire: 'Ceasefire',
  peace: 'Peace',
  reparations: 'Reparations',
  tribute: 'Tribute',
  dmz: 'Demilitarised zone',
  occupy: 'Occupied district',
  release: 'District returned',
  nonAggression: 'Non-aggression pact',
  alliance: 'Alliance',
  defensivePact: 'Defensive pact',
  embargo: 'Embargo',
  trade: 'Trade resumes',
  independence: 'Independence',
  liberate: 'Liberation',
};

export const DIPLOMACY = {
  /** The city's reputation (0–100): where it starts, what moves it, and how it mends. */
  reputation: {
    start: 60,
    /** Declaring war on a neighbour that hasn't struck the city lately. */
    declare: -5,
    /** Breaking a pact (a raid or declaration under one, leaving an ally at war). */
    breakPact: -30,
    /** A month of keeping its word mends it this much, up to `start`. */
    mendPerMonth: 1,
  },
  /** Hours from a declaration to the war opening (the other side sees the reason and the time). */
  warningHours: 12,
  /** A declaration's reason, at most this many characters. */
  reasonMax: 80,
  /** Proposals lapse after this many hours. */
  proposalHours: 48,
  /** Most terms in one proposal. */
  maxTerms: 8,
  /** The war score, −100 to 100 from the city's side. */
  score: {
    /** A battle won: the least and most it's worth, by how decisive it was. */
    battleMin: 8,
    battleMax: 15,
    /** A point per this many dollars of buildings knocked down or wrecked on the other side. */
    damagePer: 25_000,
    /** What a building knocked down in the other town is worth, from the page's counts. */
    awayBuilding: 40_000,
    /** Holding the other side's seat of power: points an hour. */
    holdPerHour: 2,
    /** A day with an ally fighting on the city's side. */
    allyPerDay: 1,
    /** At or below this a side capitulates. */
    capitulate: -60,
  },
  /** The winner of a capitulation has this many days to set its terms (then the defaults stand). */
  termsDays: 7,
  /** Total war: hold the other side's seat of power this many hours and the city falls. */
  conquestHours: 48,
  vassal: {
    /** A vassal pays its overlord this share of its taxes. */
    taxShare: 0.2,
    /** A vassal may rebel once its strength reaches this many times its overlord's. */
    rebelRatio: 1.2,
    /** A conquered computer neighbour's forces are cut to this share. */
    forcesLeft: 0.4,
  },
  /** Game months between the end of one war with a neighbour and the next declaration. */
  cooldownMonths: 3,
  neutral: {
    /** Computer neighbours raid a neutral city this much as often (treacherous ones as before). */
    raidShare: 0.25,
    /** Leaving neutrality takes this long to count (months): until then the city can't strike. */
    leaveMonths: 1,
    /** A city can't go neutral within this many months of striking a neighbour. */
    afterStrikeMonths: 3,
  },
  /** A demilitarised zone's depth from the shared border (m). */
  dmz: 800,
  /** Buying an occupied district back costs this many months of its taxes. */
  buyBackMonths: 24,
  /** A broken pact: the victim's allies like the city this much less. */
  alliesRelation: -40,
  /** A subject town set free (M39): its feelings towards the city rise this much, and it offers an alliance. */
  liberateRelation: 50,
  /** A declaration: the target's relation drops this much, its allies' this much. */
  declareRelation: -30,
  allyDeclareRelation: -15,
  /** Limits on terms. */
  limits: {
    ceasefireHours: [12, 720] as [number, number],
    months: [1, 120] as [number, number],
    /** Money terms at most this many months of the payer's taxes (reparations), or this share of
     * them a month (tribute). */
    reparationsMonths: 12,
    tributeShare: 0.5,
  },
  /** A computer neighbour's taxes a month per resident (its means, for money terms). */
  neighbourTaxPerResident: 4,
  /** In a war, computer neighbours raid this much more often, and wait this long between raids. */
  war: { raidFactor: 6, gapEachMonths: 0.5, gapAnyMonths: 0.25 },
  /** A capitulating side's default terms (when the winner sets none): months of its taxes. */
  defaults: { reparationsMonths: 3, tributeShare: 0.15, tributeMonths: 36 },
} as const;

/**
 * How each character weighs a treaty (M36): peace (when losing), money, pacts, its pride (giving
 * up land or arms), and trade. Higher means it cares more. Its feelings, the city's reputation and
 * the war score add to these.
 */
export const DIPLOMATS: Record<
  Personality,
  { peace: number; money: number; pacts: number; pride: number; trade: number; allies: number }
> = {
  aggressive: { peace: 0.5, money: 1, pacts: 0.4, pride: 1.5, trade: 0.4, allies: 0.3 },
  cautious: { peace: 1.5, money: 0.8, pacts: 1.3, pride: 1, trade: 0.6, allies: 0.8 },
  mercantile: { peace: 1.2, money: 1.4, pacts: 0.9, pride: 0.7, trade: 1.8, allies: 0.5 },
  honourable: { peace: 1, money: 0.8, pacts: 1.5, pride: 1.2, trade: 0.8, allies: 0.9 },
  treacherous: { peace: 0.8, money: 1.2, pacts: 0.7, pride: 1, trade: 0.8, allies: 0.1 },
};

/** Reasons a computer neighbour gives when it declares war, by character. */
export const WAR_REASONS: Record<Personality, string[]> = {
  aggressive: ['Your border is ours by right', 'Our people demand your land', 'You are weak, and we are not'],
  cautious: ['Your forces threaten us; we strike before you do'],
  mercantile: ['You have ruined our trade'],
  honourable: ['You broke your word, and we answer for it', 'We stand by our allies'],
  treacherous: ['An old debt comes due', 'We never trusted you'],
};

const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
const isParty = (v: unknown): v is Party => v === 'us' || v === 'them';

/** A clean copy of a term from outside, or null when it doesn't make sense. */
export function cleanTerm(raw: unknown): Term | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  const L = DIPLOMACY.limits;
  switch (t.k) {
    case 'ceasefire':
      return isInt(t.hours, L.ceasefireHours[0], L.ceasefireHours[1])
        ? { k: 'ceasefire', hours: t.hours }
        : null;
    case 'peace':
    case 'alliance':
    case 'defensivePact':
    case 'embargo':
    case 'trade':
    case 'independence':
      return { k: t.k };
    case 'reparations':
      return isParty(t.payer) && isInt(t.amount, MIN_MONEY, 1e9)
        ? { k: 'reparations', payer: t.payer, amount: t.amount }
        : null;
    case 'tribute':
      return isParty(t.payer) && isInt(t.amount, MIN_MONEY, 1e8) && isInt(t.months, L.months[0], L.months[1])
        ? { k: 'tribute', payer: t.payer, amount: t.amount, months: t.months }
        : null;
    case 'dmz':
      return isParty(t.side) && isInt(t.months, L.months[0], L.months[1])
        ? { k: 'dmz', side: t.side, months: t.months }
        : null;
    case 'occupy':
    case 'release':
      return isParty(t.side) && isInt(t.district, 1, 255)
        ? { k: t.k, side: t.side, district: t.district }
        : null;
    case 'nonAggression':
      return isInt(t.months, L.months[0], L.months[1]) ? { k: 'nonAggression', months: t.months } : null;
    case 'liberate':
      return isInt(t.town, 1, 255) ? { k: 'liberate', town: t.town } : null;
  }
  return null;
}

/** A computer neighbour's three quarters, by number (an occupied "district" of a town). */
export const QUARTERS = ['', 'north', 'middle', 'south'];

/** Money terms start at this (dollars). */
export const MIN_MONEY = 100;

/** What's wrong with a term from outside, in words, or null when `cleanTerm` takes it. */
export function termProblem(raw: unknown): string | null {
  if (cleanTerm(raw)) return null;
  const k = raw && typeof raw === 'object' ? (raw as { k?: unknown }).k : undefined;
  if (typeof k !== 'string' || !(TERM_KINDS as readonly string[]).includes(k))
    return 'A term doesn’t make sense';
  const L = DIPLOMACY.limits;
  const name = TERM_NAMES[k as TermKind];
  switch (k as TermKind) {
    case 'ceasefire':
      return `${name}: ${L.ceasefireHours[0]} to ${L.ceasefireHours[1]} hours`;
    case 'reparations':
      return `${name}: $${MIN_MONEY} or more, paid by one side`;
    case 'tribute':
      return `${name}: $${MIN_MONEY} or more a month, for ${L.months[0]} to ${L.months[1]} months`;
    case 'dmz':
    case 'nonAggression':
      return `${name}: ${L.months[0]} to ${L.months[1]} months`;
    case 'occupy':
    case 'release':
      return `${name}: pick a district`;
    case 'liberate':
      return `${name}: pick the town to free`;
    default:
      return `${name} doesn’t make sense`;
  }
}
