/**
 * Who may do what in a shared city (M31). The host sets each player's permissions; the room turns
 * away what it can tell from the command alone, and the sim checks the rest (whose work it is, what
 * it costs) the same way on every machine. The host may do everything; single player has no rules.
 */
import type { Command } from './commands';
import { CIVIC } from '../data/civic';
import { formatInt } from './dmath';

export type Permission = 'bulldoze' | 'money' | 'policies' | 'projects' | 'spend' | 'speed';

export const PERMISSIONS: readonly { id: Permission; label: string; blurb: string }[] = [
  { id: 'bulldoze', label: 'Bulldoze others’ work', blurb: 'roads, buildings and stops someone else built' },
  { id: 'money', label: 'Taxes, budget and loans', blurb: 'tax rates, department funding, loans' },
  { id: 'policies', label: 'Policies', blurb: 'city and district policies, election promises' },
  { id: 'projects', label: 'Big projects', blurb: 'start a stadium, an expo and the like' },
  { id: 'spend', label: 'Spend above the limit', blurb: 'anything costing more than the limit at once' },
  { id: 'speed', label: 'Pause and speed', blurb: 'pause the city or change its speed' },
];

export interface SharedRules {
  /** Each player's permissions (the host's are ignored: they may do everything). */
  perms: Record<number, Permission[]>;
  host: number;
  /** The most a player without `spend` may spend on one action (null: no limit). */
  spendLimit: number | null;
}

/** New players' permissions: friends trust each other until the host says otherwise (DECISIONS). */
export const DEFAULT_PERMS: readonly Permission[] = [
  'bulldoze',
  'money',
  'policies',
  'projects',
  'spend',
  'speed',
];

const NEED: Partial<Record<Command['type'], Permission>> = {
  setTax: 'money',
  setFunding: 'money',
  takeLoan: 'money',
  repayLoan: 'money',
  issueBond: 'money',
  sendForce: 'spend',
  recallForce: 'spend',
  repayBond: 'money',
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
};

export function may(rules: SharedRules | null, player: number, p: Permission): boolean {
  if (!rules || !player || player === rules.host) return true;
  return (rules.perms[player] ?? DEFAULT_PERMS).includes(p);
}

/** Why the room should turn this command away before ordering it, or null. */
export function roomRefusal(rules: SharedRules | null, player: number, cmd: Command): string | null {
  const need = NEED[cmd.type];
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
