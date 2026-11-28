/**
 * Opening a quick match from the address (M43), before the city is founded: `?match=new&…` founds the
 * host's city on a new seed with the settings it chose on the Quick match screen; `?match=<invite>`
 * reads the match's settings from its region (as a visitor) and founds this player's city on its seed;
 * `&again=1` is the reload a rematch makes, back into the region as the same city (its place kept in
 * this tab's session storage), and a peer-to-peer host opens the region again from its record.
 */
import {
  MATCH,
  MATCH_MODES,
  MATCH_PRESETS,
  cleanMatchSettings,
  matchSeed,
  type MatchSettings,
} from '../data/match';
import type { GameOptions } from '../sim/state';
import type { RegionMeta } from '../../relay/region';
import { codeKind, parseInvite, inviteProblem } from '../../relay/protocol';
import { fetchRegionView } from '../net/regionLink';
import type { Link } from '../net/link';
import { loadMatchSession, type MatchSession } from './matchClient';

export interface MatchPlan {
  kind: 'online' | 'p2p';
  settings: MatchSettings;
  round: number;
  city: string;
  /** The city to found. */
  options: Partial<GameOptions>;
  /** The match's invite (unknown yet for a host opening a new one). */
  invite: string | null;
  /** This page opens the match (a new one, or a peer-to-peer host's region again). */
  host: boolean;
  /** Back into the region as this city (a rematch's reload). */
  rejoin?: { slot: number; secret: string };
  /** A peer-to-peer host's region record, to open it again from. */
  hub?: unknown;
}

const TOWN_ENDS = ['ton', 'ville', 'bury', 'field', 'ford', 'wick'];

/** The player's town's name in a match: their name and an ending, the same for every round. */
export function matchCityName(mayor: string, random: () => number): string {
  const base = mayor.replace(/[^\p{L}\p{N} ]/gu, '').trim() || 'Quick';
  return `${base}${TOWN_ENDS[Math.floor(random() * TOWN_ENDS.length)]}`.slice(0, 40);
}

/** A match city's founding: the match's map, the fast start, no disasters, elections, war or neighbours. */
export function matchOptions(settings: MatchSettings, city: string): Partial<GameOptions> {
  return {
    seed: settings.seed,
    preset: settings.preset,
    difficulty: 'normal',
    sandbox: false,
    disasters: false,
    elections: false,
    region: false,
    cityName: city,
    match: { ...MATCH.fastStart },
  };
}

/** The Quick match screen's choices, as the address carries them for a new match. */
export function newMatchQuery(kind: 'online' | 'p2p', s: Omit<MatchSettings, 'seed' | 'minPop'>): string {
  const q = new URLSearchParams({
    match: 'new',
    mkind: kind,
    mode: s.mode,
    minutes: String(s.minutes),
    target: String(s.target),
    preset: s.preset,
    chat: s.chat ? '1' : '0',
  });
  return q.toString();
}

/**
 * Work out the match to open from the address. `connect` reaches a region by its invite; `mayor` is
 * the player's name. Rejects with a reason a player can read.
 */
export async function planMatch(
  params: URLSearchParams,
  test: boolean,
  mayor: string,
  connect: (invite: { code: string; key: string | null }) => () => Promise<Link>,
  status: (text: string) => void = () => undefined,
): Promise<MatchPlan> {
  const param = params.get('match') ?? '';
  const session = loadMatchSession();
  if (param === 'new') {
    const kind = params.get('mkind') === 'p2p' ? 'p2p' : 'online';
    const mode = MATCH_MODES.find((m) => m === params.get('mode')) ?? 'race';
    const preset = MATCH_PRESETS.find((p) => p === params.get('preset')) ?? 'river';
    const settings = cleanMatchSettings(
      {
        mode,
        minutes: Number(params.get('minutes') ?? 20),
        target: Number(params.get('target') ?? MATCH.raceTarget),
        preset,
        chat: params.get('chat') === '1',
        seed: matchSeed(Math.random),
      },
      test,
    );
    if (!settings) throw new Error('Those match settings aren’t ones a match can have');
    const city = matchCityName(mayor, Math.random);
    return {
      kind,
      settings,
      round: 1,
      city,
      options: matchOptions(settings, city),
      invite: null,
      host: true,
    };
  }
  const inv = parseInvite(param);
  const why = inviteProblem(inv);
  if (why || !inv) throw new Error(why?.replace('a room', 'a match') ?? 'That isn’t a match’s invite');
  const kind = codeKind(inv.code);
  const again = params.get('again') === '1' && session?.invite === param ? session : null;
  // A peer-to-peer host back for a rematch: the region is opened again from its record, in this page.
  const hubMatch = again?.hub ? (again.hub as RegionMeta).match : undefined;
  if (again && hubMatch) {
    return {
      kind,
      settings: hubMatch.settings,
      round: hubMatch.round,
      city: again.city,
      options: matchOptions(hubMatch.settings, again.city),
      invite: param,
      host: true,
      rejoin: { slot: again.slot, secret: again.secret },
      hub: again.hub,
    };
  }
  status(kind === 'p2p' ? 'Looking for the match’s host…' : `Finding match ${inv.code}…`);
  // A host's browser reloading for a rematch takes a few seconds to be there again: a few tries.
  let view: Awaited<ReturnType<typeof fetchRegionView>> | null = null;
  let last: unknown = null;
  for (let k = 0; k < (again ? 4 : 1) && !view; k++) {
    try {
      view = await fetchRegionView(connect(inv), mayor);
    } catch (err) {
      last = err;
      if (again) await new Promise((r) => setTimeout(r, 1500));
    }
  }
  if (!view) throw last instanceof Error ? last : new Error('The match couldn’t be reached');
  const m = view.match;
  if (!m) throw new Error('That code is a region’s, not a quick match’s');
  if (!again && m.phase !== 'lobby')
    throw new Error('That match has already started: ask for a place in the next one');
  const city = again?.city ?? matchCityName(mayor, Math.random);
  return {
    kind,
    settings: m.settings,
    round: m.round,
    city,
    options: matchOptions(m.settings, city),
    invite: param,
    host: false,
    ...(again ? { rejoin: { slot: again.slot, secret: again.secret } } : {}),
  };
}

/** What a tab keeps for the next round, from the plan it opened with (the place comes from the link). */
export function sessionFor(plan: MatchPlan, invite: string, slot: number, secret: string): MatchSession {
  return { invite, kind: plan.kind, slot, secret, city: plan.city, round: plan.round };
}
