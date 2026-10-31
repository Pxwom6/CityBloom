/**
 * Who may do what in a shared city (M31). The host sets each player's permissions; the room turns
 * away what it can tell from the command alone, and the sim checks the rest (whose work it is, what
 * it costs) the same way on every machine. The host may do everything; single player has no rules.
 */
import type { Command } from './commands';
import { CIVIC } from '../data/civic';
import { formatInt } from './dmath';

export type Permission =
  'bulldoze' | 'money' | 'policies' | 'projects' | 'spend' | 'speed' | 'war' | 'treaties' | 'defence';

/**
 * The roles of a city at war (M39): who may wage war, who may make treaties and who may spend on
 * defence. Rules set before they existed name none of them, and read as allowing all three.
 */
export const ROLES: readonly Permission[] = ['war', 'treaties', 'defence'];

export const PERMISSIONS: readonly { id: Permission; label: string; blurb: string }[] = [
  { id: 'bulldoze', label: 'Bulldoze others’ work', blurb: 'roads, buildings and stops someone else built' },
  { id: 'money', label: 'Taxes, budget and loans', blurb: 'tax rates, department funding, loans' },
  { id: 'policies', label: 'Policies', blurb: 'city and district policies, election promises' },
  { id: 'projects', label: 'Big projects', blurb: 'start a stadium, an expo and the like' },
  { id: 'spend', label: 'Spend above the limit', blurb: 'anything costing more than the limit at once' },
  { id: 'speed', label: 'Pause and speed', blurb: 'pause the city or change its speed' },
  { id: 'war', label: 'Wage war', blurb: 'declare war, send and recall forces, spies and superweapons' },
  {
    id: 'treaties',
    label: 'Treaties',
    blurb: 'propose and answer treaties, end pacts, neutrality, sanctions',
  },
  {
    id: 'defence',
    label: 'Defence spending',
    blurb: 'military buildings, training units, research and trials, defence funding',
  },
];

export interface SharedRules {
  /** Each player's permissions (the host's are ignored: they may do everything). */
  perms: Record<number, Permission[]>;
  host: number;
  /** The most a player without `spend` may spend on one action (null: no limit). */
  spendLimit: number | null;
  /**
   * Set once the host has set anyone's permissions on a page that knows the roles of war (M39):
   * from then on every list is read as it stands. Before, a list naming no role allows them all.
   */
  roles?: true;
}

/** New players' permissions: friends trust each other until the host says otherwise (DECISIONS). */
export const DEFAULT_PERMS: readonly Permission[] = [
  'bulldoze',
  'money',
  'policies',
  'projects',
  'spend',
  'speed',
  'war',
  'treaties',
  'defence',
];

const NEED: Partial<Record<Command['type'], Permission>> = {
  trainUnit: 'defence',
  cancelTraining: 'defence',
  disbandUnit: 'defence',
  setTax: 'money',
  setFunding: 'money',
  takeLoan: 'money',
  repayLoan: 'money',
  issueBond: 'money',
  sendForce: 'war',
  helpSend: 'war',
  recallForce: 'war',
  // Diplomacy (M36), with the roles M39 brought: waging war is `war`, treaties and pacts `treaties`, building
  // up the forces `defence` (a list set before the roles existed reads as allowing all three, see `permsOf`).
  declareWar: 'war',
  setNeutral: 'treaties',
  queueResearch: 'defence',
  unqueueResearch: 'defence',
  startTrial: 'defence',
  stopTrial: 'defence',
  useBlackout: 'war',
  spyMission: 'war',
  setDome: 'defence',
  propose: 'treaties',
  answerProposal: 'treaties',
  withdrawProposal: 'treaties',
  endPact: 'treaties',
  buyBack: 'money',
  repayBond: 'money',
  // The war economy (M38): investing and lending are the city's money.
  buyStake: 'money',
  sellStake: 'money',
  lendAlly: 'money',
  fundAlly: 'money',
  // Arms trade (M38): selling munitions and units is the city's money; sanctions are diplomacy.
  setArmsDeal: 'money',
  sellUnit: 'money',
  setSanction: 'treaties',
  // An offer from a neighbour (M38) is a loan, an investment or an arms deal: the city's money.
  answerOffer: 'money',
  setPolicy: 'policies',
  setDistrictPolicy: 'policies',
  promise: 'policies',
};

const WORDS: Record<Permission, string> = {
  bulldoze: 'bulldoze what others built',
  money: 'change taxes, the budget or loans',
  policies: 'change policies',
  projects: 'start big projects',
  spend: `spend that much at once`,
  speed: 'pause or change the speed',
  war: 'wage war',
  treaties: 'make or answer treaties',
  defence: 'spend on defence',
};

/**
 * A player's permissions as they stand: the defaults if the host never set them, and the roles of
 * war added to a list set before the roles existed (it names none of them).
 */
export function permsOf(rules: SharedRules, player: number): readonly Permission[] {
  const list = rules.perms[player];
  if (!list) return DEFAULT_PERMS;
  if (!rules.roles && !list.some((p) => ROLES.includes(p))) return [...list, ...ROLES];
  return list;
}

/**
 * The host sets a player's permissions (the room does this). A host on a page that knows the roles of
 * war sets lists in full, so lists set before the roles existed first get the roles they were read
 * as allowing: nobody loses one unasked.
 */
export function setPerms(rules: SharedRules, player: number, perms: Permission[]): void {
  if (!rules.roles) {
    for (const k of Object.keys(rules.perms)) rules.perms[Number(k)] = [...permsOf(rules, Number(k))];
    rules.roles = true;
  }
  rules.perms[player] = perms;
}

export function may(rules: SharedRules | null, player: number, p: Permission): boolean {
  if (!rules || !player || player === rules.host) return true;
  return permsOf(rules, player).includes(p);
}

/** What a command needs beyond `NEED`: defence funding is defence, and so is a military building. */
function needOf(cmd: Command): Permission | undefined {
  if (cmd.type === 'setFunding' && cmd.dept === 'defence') return 'defence';
  if (cmd.type === 'placeBuilding' && CIVIC.get(cmd.def)?.category === 'military') return 'defence';
  return NEED[cmd.type];
}

/** Why the room should turn this command away before ordering it, or null. */
export function roomRefusal(rules: SharedRules | null, player: number, cmd: Command): string | null {
  const need = needOf(cmd);
  if (need && !may(rules, player, need)) return `The host hasn't let you ${WORDS[need]}`;
  if (cmd.type === 'placeBuilding' && CIVIC.get(cmd.def)?.project && !may(rules, player, 'projects'))
    return `The host hasn't let you ${WORDS.projects}`;
  return null;
}

/**
 * Why the sim turns this command away: the room's checks, plus whose work a bulldozer would take
 * and what the action costs.
 */
export function simRefusal(
  rules: SharedRules | null,
  player: number,
  cmd: Command,
  builder: (id: number) => number | undefined,
  cost: number,
): string | null {
  if (!rules || !player) return null;
  const r = roomRefusal(rules, player, cmd);
  if (r) return r;
  if (cmd.type === 'bulldoze' && !may(rules, player, 'bulldoze')) {
    const by = builder(cmd.target.id);
    if (by !== undefined && by !== player) return `The host hasn't let you ${WORDS.bulldoze}`;
  }
  if (rules.spendLimit !== null && cost > rules.spendLimit && !may(rules, player, 'spend'))
    return `Spending over $${formatInt(rules.spendLimit)} at once needs the host's say-so`;
  return null;
}
