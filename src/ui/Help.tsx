/**
 * Allies sending help into a friend's live battle (M39 step 6, design call 7): the "Send help" button
 * an ally sees where a friend is fighting (the live bar, the friend's card in the Region panel and the
 * battle map it watches from), the small picker of units at home it opens, and the line that says how
 * the force is getting on. The region room decides whether the help goes in (the pacts it keeps), the
 * sim sends the units off and takes their losses back, `Game.live` ties the two (`sendHelp`).
 */
import { useState } from 'preact/hooks';
import { LIVE } from '../../relay/protocol';
import type { Game } from '../game';
import type { HelpView, LiveRunning } from '../client/liveBattles';
import { UNIT } from '../data/war';
import { useGameUpdates } from './hooks';

/** Which battle's picker is open on the map (the buttons elsewhere open the map and set this). */
export const helpUi: { open: string | null } = { open: null };

/** Seconds of play a battle step takes at the room's pace: 16 steps a second. */
const STEPS_PER_SECOND = 16;

/** A combatant this city could send help to. */
export interface HelpAlly {
  /** The neighbour in the city's own list, its place in the region, its name, and the side it fights on. */
  id: number;
  slot: number;
  name: string;
  side: 0 | 1;
}

/**
 * The combatant of a live battle this city has a pact of aid with, as its own mirror of the region's pacts
 * has it: an alliance with either, a defensive pact with the one attacked. None when it has pacts with both
 * (it can't take sides) or with neither; the room has the last word.
 */
export function helpAllies(game: Game, b: { from: number; to: number }): HelpAlly[] {
  const w = game.world.stats.war;
  const pacts = (w?.diplomacy?.pacts ?? []).filter((p) => p.room !== null);
  const out: HelpAlly[] = [];
  for (const [slot, side] of [
    [b.from, 0],
    [b.to, 1],
  ] as const) {
    const n = game.world.stats.region.neighbours.find((x) => x.player?.slot === slot);
    if (!n) continue;
    const kinds = pacts.filter((p) => p.with === n.id).map((p) => p.term.k);
    if (kinds.includes('alliance') || (side === 1 && kinds.includes('defensivePact')))
      out.push({ id: n.id, slot, name: n.name, side });
  }
  return out.length === 1 ? out : [];
}

/** Units fit to go: at home, mended, not a superweapon, on the ground or in the air. */
function ready(game: Game) {
  return (game.world.forces?.units ?? []).filter((u) => {
    const d = UNIT.get(u.kind);
    return (
      !u.away && u.hp >= 0.5 && !u.ready && !!d && !d.super && (d.domain === 'land' || d.domain === 'air')
    );
  });
}

const unitName = (kind: string, n: number) => {
  const d = UNIT.get(kind as never);
  return d ? (n === 1 ? d.name : d.plural) : kind;
};

/** "30 seconds" and the like, from steps of battle. */
const seconds = (steps: number) => Math.max(1, Math.ceil(steps / STEPS_PER_SECOND));

/** The force's progress, in words (or null when there is nothing to say). */
export function helpLine(h: HelpView, side: string): string {
  switch (h.state) {
    case 'asked':
      return `Asking the region to let your ${h.units} unit${h.units === 1 ? '' : 's'} in…`;
    case 'on':
      return `Your ${h.units} unit${h.units === 1 ? ' is' : 's are'} on the way to help ${side}${
        h.arrive !== null ? `: ${seconds(h.arrive - h.step)} seconds to go` : ''
      }.`;
    case 'fighting':
      return `Your force is fighting for ${side}${h.alive !== null ? `: ${h.alive} of ${h.units} standing` : ''}.`;
    case 'done':
      return h.late
        ? 'The battle ended before your force could get there: it is on its way home.'
        : h.lost
          ? `The battle is over: ${h.lost} of your ${h.units} units were knocked out, and the rest are on their way home.`
          : 'The battle is over: your force came through unharmed and is on its way home.';
    case 'refused':
      return `${h.reason ?? 'The help was turned down'}. Your force is home.`;
  }
}

/** The line about the force this city sent, in the map or beside the button. */
export function HelpStatus({ battle }: { battle?: string }) {
  const game = useGameUpdates(300);
  const h = game.live.helping();
  if (!h || (battle !== undefined && h.battle !== battle)) return null;
  const v = game.live.view();
  const side =
    h.side === null || !v || v.id !== h.battle
      ? 'your ally'
      : h.side === 0
        ? v.input.attacker.name
        : v.input.defender.name;
  return (
    <p class={`help-status ${h.state}`} data-testid="help-status" data-state={h.state} role="status">
      {helpLine(h, side)}
    </p>
  );
}

/** The picker: units at home, a number of each, and a note on how they fight once they are there. */
export function HelpPicker({
  battle,
  ally,
  onSent,
}: {
  battle: string;
  ally: HelpAlly;
  onSent?: () => void;
}) {
  const game = useGameUpdates(400);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [why, setWhy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const home = ready(game);
  const kinds = [...new Set(home.map((u) => u.kind))];
  const chosen = kinds.flatMap((k) =>
    home
      .filter((u) => u.kind === k)
      .slice(0, Math.min(picked[k] ?? 0, LIVE.helpUnits))
      .map((u) => ({ id: u.id, kind: u.kind })),
  );
  const send = async () => {
    if (busy || !chosen.length) return;
    setBusy(true);
    const bad = await game.live.sendHelp(battle, ally.id, chosen.slice(0, LIVE.helpUnits));
    setBusy(false);
    setWhy(bad);
    if (bad === null) {
      setPicked({});
      helpUi.open = null;
      game.openBattleMap();
      onSent?.();
    }
  };
  return (
    <div class="help-picker" data-testid="help-picker">
      <h3>Send help to {ally.name}</h3>
      <p class="muted">
        Units arrive about {seconds(LIVE.helpTravel.highway)} seconds after the region lets them in (more if
        they come by sea), so the sooner they go the more they can do. Once there they fight on their own
        judgement: you cannot command them, though {ally.name} can.
      </p>
      <div class="help-units">
        {kinds.length ? (
          kinds.map((k) => {
            const have = home.filter((u) => u.kind === k).length;
            return (
              <label key={k} class="help-unit">
                <span>
                  {unitName(k, have)} ({have} at home)
                </span>
                <input
                  type="number"
                  min={0}
                  max={have}
                  value={Math.min(picked[k] ?? 0, have)}
                  data-testid={`help-${k}`}
                  onInput={(e) =>
                    setPicked({
                      ...picked,
                      [k]: Math.max(0, Math.min(have, Number((e.target as HTMLInputElement).value) || 0)),
                    })
                  }
                />
              </label>
            );
          })
        ) : (
          <p class="muted" data-testid="help-none">
            No units at home can go: it takes mended land or air units.
          </p>
        )}
      </div>
      {why && (
        <p class="war-warn" data-testid="help-why">
          {why}
        </p>
      )}
      <div class="help-actions">
        <button
          class="btn primary"
          data-testid="help-send"
          disabled={!chosen.length || busy}
          onClick={() => void send()}
        >
          Send {chosen.length || ''} unit{chosen.length === 1 ? '' : 's'}
        </button>
        <button class="btn" data-testid="help-cancel" onClick={() => ((helpUi.open = null), game.notify())}>
          Not now
        </button>
      </div>
    </div>
  );
}

/**
 * "Send help": where an ally sees a friend in a live battle. It opens the battle map on that battle (the
 * city follows it there) with the picker open; nothing shows when the city has no pact of aid with the
 * friend, or its force is out already.
 */
export function HelpButton({ battle, small }: { battle: LiveRunning; small?: boolean }) {
  const game = useGameUpdates(500);
  const allies = helpAllies(game, battle);
  const h = game.live.helping();
  if (!allies.length) return null;
  if (h && h.battle === battle.id && h.state !== 'refused') return <HelpStatus battle={battle.id} />;
  if (h && h.state !== 'done' && h.state !== 'refused') return null;
  const ally = allies[0]!;
  return (
    <button
      class={`btn ${small ? 'small' : ''}`}
      data-testid={`help-${battle.id}`}
      title={`${ally.name} is your ally: send some of your units to fight beside it`}
      onClick={() => {
        helpUi.open = battle.id;
        game.watchLive(battle.id);
        game.notify();
      }}
    >
      Send help to {ally.name}
    </button>
  );
}

/**
 * In the battle map of a battle this city watches: the picker, or the force's progress (it stays when the
 * battle is over, to say how it came out), or the button.
 */
export function HelpSection({
  game,
  battle,
  from,
  to,
  over,
}: {
  game: Game;
  battle: string;
  from: number;
  to: number;
  over: boolean;
}) {
  const h = game.live.helping();
  const mine = h && h.battle === battle;
  if (mine && h.state !== 'refused') return <HelpStatus battle={battle} />;
  const allies = over ? [] : helpAllies(game, { from, to });
  if (!allies.length) return mine ? <HelpStatus battle={battle} /> : null;
  if (h && h.state !== 'done' && h.state !== 'refused') return null;
  const ally = allies[0]!;
  if (helpUi.open === battle) return <HelpPicker battle={battle} ally={ally} />;
  return (
    <div class="help-section">
      {mine && <HelpStatus battle={battle} />}
      <button
        class="btn small"
        data-testid="help-open"
        onClick={() => {
          helpUi.open = battle;
          game.notify();
        }}
      >
        Send help to {ally.name}
      </button>
    </div>
  );
}
