// The careful balance mayor at war (phase 5, M38 step 9, docs/plans/M38-design.md call 11). Played
// only in a city with war on (`sim.state.war`), so a city with rivals off is played exactly as
// before. It does what a sensible player does about neighbours that may raid: once raids threaten
// it builds a military HQ, a barracks and defences sized to the biggest raid a neighbour could mount,
// keeps a small force trained, keeps defence funding sensible, answers proposals and offers by a few
// plain rules, and puts money that piles up into stakes in friendly neighbours.
//
// Everything here goes through commands, like a player's hands, and nothing reads a clock or a
// random number: the same city plays the same way every time.
import { RAIDS, RIVAL_TARGET, SKIRMISH } from '../../data/battle';
import { CIVIC } from '../../data/civic';
import { INVEST } from '../../data/warEconomy';
import { DMath } from '../dmath';
import { UNIT, type UnitKind } from '../../data/war';
import type { Term } from '../../data/diplomacy';
import { annuity } from '../../data/economy';
import { TICKS_PER_MONTH } from '../time';
import { baseLoad, militaryCivics, militaryOf } from '../systems/war';
import { cityStrength } from '../systems/raids';
import { objectiveSpots } from '../battle/layout';
import { rivalMix } from './tech';
import { anyWarOpen, fightingWith, monthlyTaxes, warWith } from '../systems/diplomacy';
import { monthlyRates } from '../systems/economy';
import { cashFloor, monthlySpending, type Offer } from '../systems/offers';
import { stakeWorth } from '../systems/warEconomy';
import { weariness } from '../systems/weariness';
import type { Neighbour } from '../systems/region';
import type { Player } from './mayor';

const M = TICKS_PER_MONTH;

/** Where raids start to threaten: ahead of the 3,000 residents that starts them. */
export const WAR_FROM = 2_500;
/** The defence the city keeps, as a share of the biggest raid a neighbour could mount. */
const WANT = 1.2;
/** The most the forces and the military buildings may cost a month, as a share of the city's taxes (or this much, while the city is small). */
const BUDGET = 0.12;
const BUDGET_FLOOR = 4_000;
/** How far from the highway's way in a power plant is out of a skirmish's reach (`SKIRMISH.border`, with room to spare). */
const ENTRY_SAFE = SKIRMISH.border + 60;
/**
 * A reserve kept once raids threaten, for the day one knocks out the power: a city with no money in
 * the bank when its plants are wrecked goes bankrupt before they come back (districts and goals wait).
 */
const EMERGENCY = 30_000;
/** Where the power insurance starts: well before raids can (3,000 residents and a year). */
const INSURE_FROM = 1_500;
/** The share of the city's power demand carried by plants out of the raiders' reach. */
const SAFE_POWER = 0.8;
/** Money put by for defence while the city is well short of it. */
const HOLD = 15_000;
/** The most the instalments on all its loans may come to, as a share of the city's monthly taxes. */
const LOAN_SERVICE = 0.2;
/** Weariness past which the mayor wants the war over. */
const WEARY = 0.4;
/** A war score at which the mayor sues for peace. */
const SUE = -20;
/**
 * Money piles up when the bank holds two years (24 months) of spending, or a million, whichever is
 * less: a careful mayor's goals keep a big city's bank near one or two million while its spending
 * runs to hundreds of thousands a month, so the two years alone would never come.
 */
const SURPLUS_MONTHS = 24;
const SURPLUS_CAP = 1_000_000;

/** What the mayor has seen of the war, for the balance tool's summary. */
export interface WarTally {
  /** Raids that reached the city, by outcome ('raided', 'repelled', 'withdrew'...). */
  raids: number;
  outcomes: Record<string, number>;
  /** Wars declared on the city, and peace made (a war ended by treaty, conquest or capitulation). */
  warsOn: number;
  peaces: number;
  /** The most weary the city got. */
  peakWeariness: number;
  /** Buildings knocked down, and homes lost, by raids. */
  collapsed: number;
  homeless: number;
  /** Money over the months the ledger has closed: dividends, the military's cost, all spending. */
  dividends: number;
  military: number;
  spending: number;
}

/** A moment of the war for the balance tool's yearly table. */
export interface WarSample {
  raids: number;
  warsOn: number;
  peaces: number;
  /** Wars open with the city now, and its weariness. */
  open: number;
  weariness: number;
  dividends: number;
  military: number;
  spending: number;
  /** What its stakes are worth now. */
  stakes: number;
}

/** Ledger lines that are capital moving, not spending: left out of what the military is a share of. */
const CAPITAL = new Set([
  'loanPrincipal',
  'bondPrincipal',
  'stakeBought',
  'allyLent',
  'lenderRepaid',
  'cheats',
]);
/** Ledger lines that are the military's cost. */
const MILITARY = new Set(['forces', 'upkeep:defence', 'training', 'warImports', 'warMaterials']);

export class WarPlan {
  readonly tally: WarTally = {
    raids: 0,
    outcomes: {},
    warsOn: 0,
    peaces: 0,
    peakWeariness: 0,
    collapsed: 0,
    homeless: 0,
    dividends: 0,
    military: 0,
    spending: 0,
  };
  private ledgerSeen = -1;
  private last = new Map<string, number>();
  private seenReports = new Set<number>();
  private seenWars = new Set<number>();
  private seenPeace = new Set<string>();

  constructor(private readonly p: Player) {}

  private get sim() {
    return this.p.sim;
  }

  /** True once per `every` ticks for a kind of move (and counts as done). */
  private due(kind: string, every: number): boolean {
    const now = this.sim.state.tick;
    if (now - (this.last.get(kind) ?? -1e9) < every) return false;
    this.last.set(kind, now);
    return true;
  }

  /** One round of the war mayor's play, after the peaceful mayor's (every six game hours). */
  play(): void {
    if (!this.sim.state.war) return;
    // Raids go for power plants near the way in: new ones go further in.
    this.p.awayFromEntry = ENTRY_SAFE;
    this.record();
    // What the plan is saving for is worked out afresh each round (districts and goals wait for it).
    this.p.holdBack = 0;
    this.answerProposals();
    this.answerOffers();
    this.sueForPeace();
    if (this.sim.state.totals.population >= INSURE_FROM) this.insurePower();
    this.arm();
    this.defenceFunding();
    this.invest();
  }

  // ----- Watching -----

  /** Count the raids, wars and peace the city has seen (each once). */
  private record(): void {
    const w = this.sim.state.war!;
    for (const r of w.reports ?? []) {
      if (r.ours || this.seenReports.has(r.id)) continue;
      this.seenReports.add(r.id);
      this.tally.raids++;
      const o = r.outcome ?? 'unknown';
      this.tally.outcomes[o] = (this.tally.outcomes[o] ?? 0) + 1;
      this.tally.collapsed += r.collapsed.length;
      this.tally.homeless += r.homeless;
    }
    const d = w.diplomacy;
    for (const war of d?.wars ?? [])
      if (war.by === 'them' && !this.seenWars.has(war.id)) {
        this.seenWars.add(war.id);
        this.tally.warsOn++;
      }
    for (const [id, tick] of Object.entries(d?.ended ?? {})) {
      const key = `${id}:${tick}`;
      if (!this.seenPeace.has(key)) {
        this.seenPeace.add(key);
        this.tally.peaces++;
      }
    }
    this.tally.peakWeariness = Math.max(this.tally.peakWeariness, weariness(this.sim));
    // Every month the ledger has closed since the last round (it keeps two years).
    for (const m of this.sim.state.economy.history) {
      if (m.month <= this.ledgerSeen) continue;
      this.ledgerSeen = m.month;
      this.tally.dividends += m.lines.dividends ?? 0;
      for (const [k, v] of Object.entries(m.lines)) {
        if (v >= 0 || CAPITAL.has(k)) continue;
        this.tally.spending -= v;
        if (MILITARY.has(k)) this.tally.military -= v;
      }
    }
  }

  /** The war so far, for a yearly table. */
  snapshot(): WarSample {
    const sim = this.sim;
    const w = sim.state.war!;
    const t = this.tally;
    let stakes = 0;
    for (const n of sim.state.region.neighbours) {
      const held = w.economy?.stakes[n.id]?.share ?? 0;
      if (held && n.rival && !n.player) stakes += stakeWorth(n, held);
    }
    return {
      raids: t.raids,
      warsOn: t.warsOn,
      peaces: t.peaces,
      open: (w.diplomacy?.wars ?? []).filter((x) => fightingWith(sim, x.with)).length,
      weariness: Math.round(weariness(sim) * 1000) / 1000,
      dividends: t.dividends,
      military: t.military,
      spending: t.spending,
      stakes,
    };
  }

  // ----- Neighbours -----

  /** Computer neighbours that could still raid (not the city's vassals). */
  private rivals(): Neighbour[] {
    return this.sim.state.region.neighbours.filter((n) => n.rival && !n.player && !n.rival.vassal);
  }

  // ----- Defence -----

  /** The biggest raid a neighbour could mount: its share of its forces. */
  private threat(): number {
    let t = 0;
    for (const n of this.rivals()) t = Math.max(t, n.rival!.forces * RAIDS.share);
    return t;
  }

  /** Strength in training, counted as the city's own. */
  private queued(): number {
    let s = 0;
    for (const o of this.sim.state.war!.orders.values()) s += UNIT.get(o.kind)?.strength ?? 1;
    return s;
  }

  /** What the military costs a month now, and what the city's taxes bring (last month's, as the books close). */
  private costs(): { military: number; taxes: number } {
    const rates = monthlyRates(this.sim);
    return {
      military: -((rates.forces ?? 0) + (rates['upkeep:defence'] ?? 0)),
      taxes: monthlyTaxes(this.sim),
    };
  }

  /** Build the HQ and barracks, then forces and defences to meet the biggest raid, within a budget. */
  private arm(): void {
    const sim = this.sim;
    const pop = sim.state.totals.population;
    if (pop < WAR_FROM || sim.state.economy.bankrupt) return;
    const p = this.p;
    // The seat of the forces, then a place to train them.
    // (Districts and goals wait while the money for it is put by.)
    for (const def of ['militaryhq', 'barracks'] as const) {
      if (p.count(def)) continue;
      const cost = CIVIC.get(def)!.cost;
      // (Tried once a month when it can be paid for: a place without room is not searched every round.)
      if (sim.state.treasury >= cost + 1_000 && this.due(def, M)) p.place(def, 'industry');
      if (!p.count(def)) p.holdBack = Math.max(p.holdBack, cost + 5_000);
      return;
    }
    const hq = [...sim.state.civics.values()].find((c) => c.def === 'militaryhq');
    // Shelters for the people near what a raid goes for, one for every 4,000 residents.
    if (p.count('shelter') < Math.floor(pop / 4_000) && this.due('shelter', 2 * M) && hq)
      if (!p.placeNear('shelter', hq, 500)) p.place('shelter');
    const have = cityStrength(sim) + this.queued();
    const want = this.threat() * WANT;
    // Well short of the biggest raid: put money by for the defence before growing further.
    p.holdBack = Math.max(p.holdBack, EMERGENCY, have < want / 2 ? HOLD : 0);
    if (have >= want) return;
    const { military, taxes } = this.costs();
    if (military >= Math.max(BUDGET * taxes, BUDGET_FLOOR)) return;
    // Infantry squads where the barracks has room; bunkers beside the HQ for the rest of a ground
    // defence; anti-air once the city is big enough for it and a neighbour raids from the air.
    const barracks = militaryCivics(sim).filter((c) => c.def === 'barracks' && !c.build);
    for (const b of barracks) {
      const m = militaryOf(b)!;
      const load = baseLoad(sim, b.id);
      if (load.units + load.orders >= (m.holds ?? 0) || load.orders >= 2) continue;
      if (sim.dispatch({ type: 'trainUnit', base: b.id, kind: 'infantry' }).ok) {
        p.log.push(`m${p.month()}: infantry`);
        return;
      }
    }
    if (!hq) return;
    // Defences beside what the biggest raiders go for, taking the neighbours in turn: anti-air where
    // they come by air (once it is unlocked), bunkers where they come by land.
    const placed = p.count('bunker') + p.count('antiair');
    const foe = this.biggest()[placed % Math.max(1, this.biggest().length)];
    if (foe && this.due('defence', M)) {
      const at = this.spotOf(foe) ?? hq;
      const air = this.airShare(foe) > 0.3 && pop >= 5_000;
      if (air && p.count('antiair') < Math.ceil(pop / 5_000) + 1 && p.placeNear('antiair', at, 500)) return;
      if (
        p.count('bunker') < Math.ceil(pop / 2_500) &&
        (p.placeNear('bunker', at, 400) || p.place('bunker', 'industry'))
      )
        return;
    }
    // Barracks full and bunkers placed: another barracks for a bigger force.
    if (p.count('barracks') < 1 + Math.floor(pop / 12_000) && this.due('barracks2', 3 * M))
      p.place('barracks', 'industry');
  }

  /**
   * Where a neighbour goes for the power plants (the treacherous do), keep plants out of its reach
   * that carry most of the city: a coal plant is $16,000, and a city whose lights go out while its
   * bank is empty does not come back. Built beyond the border zone when a road there has room.
   */
  private insurePower(): void {
    const sim = this.sim;
    if (!this.rivals().some((n) => RIVAL_TARGET[n.rival!.personality] === 'power')) return;
    const p = this.p;
    const demand = p.stats().utilities.power.demand;
    let safe = 0;
    for (const c of sim.state.civics.values()) {
      const out = CIVIC.get(c.def)?.output?.power;
      if (out && DMath.hypot(c.x - p.c.x, c.z - p.c.z) >= SKIRMISH.border) safe += out;
    }
    const lack = SAFE_POWER * demand - safe;
    if (lack <= 0) return;
    const def = lack > 300 && !p.avoid.includes('coal') ? 'coal' : 'wind';
    p.holdBack = Math.max(p.holdBack, CIVIC.get(def)!.cost + 3_000);
    if (sim.state.treasury >= CIVIC.get(def)!.cost + 1_000 && this.due('safepower', M)) p.placeAway(def);
  }

  /** The neighbours that could raid, the strongest first. */
  private biggest(): Neighbour[] {
    return this.rivals().sort((a, b) => b.rival!.forces - a.rival!.forces || a.id - b.id);
  }

  /** Where a neighbour's raids go: the first thing it aims at (power plants, industry or the military). */
  private spotOf(n: Neighbour): { x: number; z: number } | undefined {
    const spots = objectiveSpots(this.sim, RIVAL_TARGET[n.rival!.personality] ?? 'military');
    return spots[Math.floor(spots.length / 2)];
  }

  /** The share of a neighbour's raiders that fly. */
  private airShare(n: Neighbour): number {
    const mix = rivalMix(n.rival!);
    let air = 0;
    let all = 0;
    for (const [kind, k] of Object.entries(mix)) {
      all += k!;
      if (UNIT.get(kind as UnitKind)?.domain === 'air') air += k!;
    }
    return all ? air / all : 0;
  }

  /** Defence funding: full, more while a war is on and the city is flush, less when it is short. */
  private defenceFunding(): void {
    const sim = this.sim;
    if (!this.due('funding', M)) return;
    const s = sim.state;
    const spend = monthlySpending(sim);
    const flush = s.treasury > 12 * spend;
    const short = s.treasury < 3 * spend;
    const want = short ? 80 : anyWarOpen(sim) && flush ? 120 : 100;
    if (Math.round(s.economy.funding.defence ?? 100) !== want)
      sim.dispatch({ type: 'setFunding', dept: 'defence', pct: want });
  }

  // ----- Diplomacy -----

  /** Take or refuse what neighbours put to the city. */
  private answerProposals(): void {
    const sim = this.sim;
    const d = sim.state.war!.diplomacy;
    if (!d) return;
    for (const pr of [...d.proposals]) {
      if (pr.from !== 'them') continue;
      const accept = this.fair(pr.with, pr.terms);
      const r = sim.dispatch({ type: 'answerProposal', proposal: pr.id, accept });
      // (A treaty that can't be signed now is turned down, so it doesn't linger.)
      if (!r.ok && accept) sim.dispatch({ type: 'answerProposal', proposal: pr.id, accept: false });
    }
  }

  /**
   * Is this treaty one to sign? Peace or a ceasefire when the war's score is against the city or it
   * is weary of war (or the neighbour pays); pacts of non-aggression and trade always; nothing that
   * gives up land or arms or that the city can't afford.
   */
  private fair(id: number, terms: Term[]): boolean {
    const sim = this.sim;
    const s = sim.state;
    const taxes = monthlyTaxes(sim);
    let pays = false;
    let truce = false;
    for (const t of terms) {
      switch (t.k) {
        case 'peace':
        case 'ceasefire':
          truce = true;
          break;
        case 'nonAggression':
        case 'trade':
          break;
        case 'reparations':
          if (t.payer === 'them') pays = true;
          else if (t.amount > 0.25 * s.treasury) return false;
          break;
        case 'tribute':
          if (t.payer === 'them') pays = true;
          else if (t.amount > 0.12 * taxes || t.amount * t.months > 0.5 * s.treasury) return false;
          break;
        case 'release':
          break;
        default:
          // Land, arms, embargoes, alliances and the rest are not for the mayor to sign.
          return false;
      }
    }
    if (!truce) return true;
    const war = warWith(sim, id);
    return !war || war.score <= 0 || weariness(sim) > WEARY || pays;
  }

  /** In a war going badly, or tiring, offer peace (once a few days), then peace for a little tribute. */
  private sueForPeace(): void {
    const sim = this.sim;
    const d = sim.state.war!.diplomacy;
    if (!d || !this.due('sue', 2 * M)) return;
    for (const war of d.wars) {
      if (!fightingWith(sim, war.with) || war.capitulated) continue;
      if (war.score > SUE && weariness(sim) <= WEARY + 0.1) continue;
      if (d.proposals.some((x) => x.with === war.with)) continue;
      const taxes = monthlyTaxes(sim);
      const terms: Term[] = [{ k: 'peace' }];
      // Having been refused once, add a little tribute (a tenth of a month's taxes for a year).
      if (this.last.has(`sued:${war.with}`))
        terms.push({
          k: 'tribute',
          payer: 'us',
          amount: Math.max(500, Math.round((taxes * 0.1) / 100) * 100),
          months: 12,
        });
      this.last.set(`sued:${war.with}`, sim.state.tick);
      sim.dispatch({ type: 'propose', neighbour: war.with, terms });
      return;
    }
  }

  // ----- Offers and money -----

  /**
   * An ally's arms offer when the stores hold the crates; a loan only when short of cash and the debt
   * it adds stays within a fifth of the city's taxes (a neighbour's loans are paid off in two years,
   * so a few stack up to a debt the city can't carry); an investment only when the bank is overdrawn
   * and none is out already (it sells a share of the industrial taxes for two years at about a
   * third off).
   */
  private answerOffers(): void {
    const sim = this.sim;
    const s = sim.state;
    const w = s.war!;
    const offers: Offer[] = [...(w.economy?.offers ?? [])];
    for (const o of offers) {
      const short = s.treasury < Math.min(cashFloor(sim), Math.max(10_000, monthlySpending(sim)));
      // Selling a share of the industrial taxes for two years is for a city going under, not one short.
      const broke = s.treasury < 0 || s.economy.negativeHours > 0;
      let accept = false;
      if (o.kind === 'arms') accept = w.stock.munitions >= o.crates;
      else if (o.kind === 'invest') accept = broke && !w.economy?.investors?.length;
      else {
        const service =
          s.economy.loans.reduce((a, l) => a + l.payment, 0) +
          (w.economy?.debts ?? []).reduce((a, d) => a + d.payment, 0) +
          annuity(o.amount, o.rate, o.months);
        accept = short && service <= LOAN_SERVICE * monthlyTaxes(sim);
      }
      const r = sim.dispatch({ type: 'answerOffer', offer: o.id, accept });
      if (!r.ok && accept) sim.dispatch({ type: 'answerOffer', offer: o.id, accept: false });
    }
  }

  /** Money piled up (over two years of spending in the bank) goes into friendly neighbours' industry. */
  private invest(): void {
    const sim = this.sim;
    const s = sim.state;
    if (!this.due('invest', M)) return;
    const spend = monthlySpending(sim);
    const surplus = Math.min(SURPLUS_MONTHS * spend, SURPLUS_CAP);
    if (spend <= 0 || s.treasury < surplus) return;
    const w = s.war!;
    const friends = this.rivals()
      .filter((n) => n.rival!.relation >= 20 && !warWith(sim, n.id))
      .sort((a, b) => b.rival!.relation - a.rival!.relation || a.id - b.id);
    // As much as the surplus allows, a step at a time (a few a round).
    for (let bought = 0; bought < 6 && s.treasury >= surplus;) {
      const n = friends.find((x) => (w.economy?.stakes[x.id]?.share ?? 0) < INVEST.maxShare);
      if (!n || !sim.dispatch({ type: 'buyStake', neighbour: n.id, share: INVEST.step }).ok) return;
      bought++;
      this.p.log.push(`m${this.p.month()}: stake in ${n.name}`);
    }
  }
}
