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
import type { LiveRunning } from '../client/liveBattles';
import { UNIT } from '../data/war';
import { useGameUpdates } from './hooks';
import { helpAlliesOf, helpLine, pickUnits, seconds, type HelpAlly } from './helpView';

export type { HelpAlly } from './helpView';

/** Which battle's picker is open on the map (the buttons elsewhere open the map and set this). */
export const helpUi: { open: string | null } = { open: null };

/** The combatant of a live battle this city has a pact of aid with (the room has the last word). */
export function helpAllies(game: Game, b: { from: number; to: number }): HelpAlly[] {
  return helpAlliesOf(
    {
      pacts: game.world.stats.war?.diplomacy?.pacts ?? [],
      neighbours: game.world.stats.region.neighbours,
    },
    b,
  );
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
  // (A force takes at most `LIVE.helpUnits` in all: what is shown, labelled and sent is the same list.)
  const { chosen, taken } = pickUnits(home, picked);
  const left = LIVE.helpUnits - chosen.length;
  const send = async () => {
    if (busy || !chosen.length) return;
    setBusy(true);
    const bad = await game.live.sendHelp(
      battle,
      ally.id,
      chosen.map((u) => ({ id: u.id, kind: u.kind })),
    );
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
            const mine = taken[k] ?? 0;
            // (What the others take is not available here: up to the force's cap in all.)
            const most = Math.min(have, mine + left);
            return (
              <label key={k} class="help-unit">
                <span>
                  {unitName(k, have)} ({have} at home)
                </span>
                <input
                  type="number"
                  min={0}
                  max={most}
                  value={mine}
                  data-testid={`help-${k}`}
                  onInput={(e) =>
                    setPicked({
                      ...picked,
                      [k]: Math.max(
                        0,
                        Math.min(most, Math.floor(Number((e.target as HTMLInputElement).value) || 0)),
                      ),
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
      {kinds.length > 0 && (
        <p class="muted" data-testid="help-count" data-full={left === 0}>
          {chosen.length} of at most {LIVE.helpUnits} units
        </p>
      )}
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
