/**
 * Battles on the page (M35): the top bar's raid countdown, the battle bar while the city is
 * fighting, and the war room's reports. DESIGN.md §3.29.
 */
import { useState } from 'preact/hooks';
import { CIVIC } from '../data/civic';
import { RAIDS, type BattleRoute, type BattleTarget, type Stance } from '../data/battle';
import { travelHours } from '../sim/systems/raids';
import { UNIT, type UnitKind } from '../data/war';
import { BRANCHES } from '../data/research';
import type { BattleReport } from '../sim/systems/raids';
import type { Command } from '../sim/commands';
import { TICKS_PER_HOUR, TICKS_PER_MONTH, dateOf, formatDate } from '../sim/time';
import { HelpButton } from './Help';
import { helpForceLine } from './helpView';
import { formatNumber, useGameUpdates } from './hooks';

const TARGETS: Record<string, string> = {
  military: 'military buildings',
  industry: 'industry',
  power: 'power plants',
  cityhall: 'the HQ, the seat of power',
};

/** The top bar's warning: a raid on its way (with a countdown), or a battle on now. */
export function RaidChip() {
  const game = useGameUpdates(250);
  const w = game.world.stats.war;
  if (!w || (!w.incoming && !w.battle)) return null;
  if (w.battle)
    return (
      <button
        class="btn raid-chip fighting"
        data-testid="raid-chip"
        title="A battle in the city: click to watch it"
        onClick={() => game.followBattle()}
      >
        Battle: {w.battle.from}
      </button>
    );
  const r = w.incoming!;
  const hours = Math.max(0, (r.arrive - game.world.displayTick) / TICKS_PER_HOUR);
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return (
    <button
      class="btn raid-chip"
      data-testid="raid-chip"
      title={`${r.from} is sending ${r.units} unit${r.units === 1 ? '' : 's'} against ${TARGETS[r.target] ?? r.target}`}
      onClick={() => game.openPanel('war')}
    >
      Raid from {r.from} in{' '}
      <strong data-testid="raid-eta">
        {h}:{String(m).padStart(2, '0')}
      </strong>
    </button>
  );
}

/** While the city is fighting: both sides, what they're after, and a way to watch. */
export function BattleBar() {
  const game = useGameUpdates(250);
  const f = game.world.battle;
  // (The battle map has the same facts, and covers the same part of the screen.)
  if (!f || game.inMenu() || game.panel === 'battleMap') return null;
  const live = game.live.view();
  const [them, us] = f.sides;
  const colour = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
  return (
    <div class="battle-bar panel" data-testid="battle-bar" role="status" aria-live="polite">
      <div class="battle-sides">
        <span class="battle-side" data-testid="battle-attacker">
          <i style={{ background: colour(them?.color ?? 0xcc3333) }} /> {them?.name}: {them?.alive} of{' '}
          {them?.total}
        </span>
        <span class="battle-vs">against</span>
        <span class="battle-side" data-testid="battle-defender">
          <i class="ours" /> {us?.name}: {us?.alive} of {us?.total}
        </span>
      </div>
      {f.targets.length > 0 && (
        <div class="battle-targets" data-testid="battle-targets">
          {f.targets.map((t) => {
            const c = game.world.civics.get(t.id);
            const name = (c && CIVIC.get(c.def)?.name) ?? 'Target';
            return (
              <button key={t.id} class="battle-target" title={name} onClick={() => game.flyTo(t)}>
                <span>{name}</span>
                <span class="bar">
                  <span style={{ width: `${Math.round(t.hp * 100)}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div class="battle-actions">
        <button class="btn" data-testid="battle-follow" onClick={() => game.followBattle()}>
          Follow the fighting
        </button>
        {live?.role === 'defender' && !live.over && (
          <button
            class="btn primary"
            data-testid="battle-command"
            title="Command your defences on the battle map (O)"
            onClick={() => game.openBattleMap()}
          >
            Command
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * A live battle with a friend (M39) on a page with no battle bar of its own: the attacker's, which
 * fights in a friend's town and sees it only on the map, and anyone's chance to watch two other cities
 * fight. The defender's way in is the battle bar's Command button.
 */
export function LiveBar() {
  const game = useGameUpdates(300);
  const [hidden, setHidden] = useState<string[]>([]);
  if (game.inMenu() || game.panel === 'battleMap') return null;
  const v = game.live.view();
  if (v && v.role === 'attacker' && !v.over)
    return (
      <div class="battle-bar live-bar panel" data-testid="live-bar" role="status" aria-live="polite">
        <div class="battle-sides">
          <span>
            Your force is fighting in <strong>{v.input.defender.name}</strong>: a live battle.
          </span>
        </div>
        <div class="battle-actions">
          <button
            class="btn primary"
            data-testid="live-command"
            title="Command your force on the battle map (O)"
            onClick={() => game.openBattleMap()}
          >
            Command
          </button>
        </div>
      </div>
    );
  // (A battle this page has finished is no reason not to offer another.)
  if (v && !v.over) return null;
  const b = game.live.runningBattles().find((x) => !hidden.includes(x.id));
  if (!b || game.live.watchingId()) return null;
  const name = (slot: number) =>
    game.region?.view?.cities.find((c) => c.slot === slot)?.name ?? 'A neighbour';
  return (
    <div class="battle-bar live-bar panel" data-testid="live-spectacle" role="status" aria-live="polite">
      <div class="battle-sides">
        <span>
          <strong>{name(b.from)}</strong> and <strong>{name(b.to)}</strong> are fighting a live battle.
        </span>
      </div>
      <div class="battle-actions">
        <button class="btn primary" data-testid="live-watch" onClick={() => game.watchLive(b.id)}>
          Watch
        </button>
        <HelpButton battle={b} />
        <button class="btn" data-testid="live-dismiss" onClick={() => setHidden([...hidden, b.id])}>
          Not now
        </button>
      </div>
    </div>
  );
}

const unitName = (kind: string, n: number) => {
  const d = UNIT.get(kind as UnitKind);
  return d ? (n === 1 ? d.name : d.plural) : kind;
};

/** One battle's report: what happened, what it cost, what's being repaired. */
export function ReportCard({ r }: { r: BattleReport }) {
  const game = useGameUpdates(1000);
  const head = r.help
    ? `Our force helped ${r.other}: ${r.outcome === 'repelled' ? 'the defence held' : r.outcome === 'raided' ? 'the attack hit its targets' : 'the attackers pulled out'}`
    : r.ours
      ? r.outcome === 'raided'
        ? `Our raid on ${r.other} hit ${TARGETS[r.target] ?? r.target}`
        : r.outcome === 'repelled'
          ? `Our raid on ${r.other} was beaten off`
          : `Our force pulled back from ${r.other}`
      : r.outcome === 'repelled'
        ? `${r.other}'s raid was beaten off`
        : r.outcome === 'withdrew'
          ? `${r.other}'s force pulled back`
          : `${r.other}'s raiders hit ${TARGETS[r.target] ?? r.target}`;
  const lost = Object.entries(r.lost).filter(([, n]) => (n ?? 0) > 0);
  const day = formatDate(dateOf(r.end));
  if (r.help)
    return (
      <li class="war-report" data-testid={`report-${r.id}`}>
        <strong>{head}</strong>
        {day && <span class="muted"> · {day}</span>}
        <ul>
          <li data-testid={`report-${r.id}-lost`}>
            Our units lost:{' '}
            {lost.length ? lost.map(([k, n]) => `${n} ${unitName(k, n ?? 0)}`).join(', ') : 'none'}
          </li>
        </ul>
      </li>
    );
  if (r.ours && r.away)
    return (
      <li class="war-report" data-testid={`report-${r.id}`}>
        <strong>{head}</strong>
        {day && <span class="muted"> · {day}</span>}
        {r.replay && (
          <button class="btn" data-testid={`watch-${r.id}`} onClick={() => void game.watchBattle(r.replay!)}>
            Watch
          </button>
        )}
        <ul>
          <li>
            In {r.other}: {formatNumber(r.away.objectives.down)} of {formatNumber(r.away.objectives.aimed)}{' '}
            targets knocked out, {formatNumber(r.away.destroyed)} building{r.away.destroyed === 1 ? '' : 's'}{' '}
            down
          </li>
          <li>
            Their defenders lost {formatNumber(r.theirLost)} of {formatNumber(r.theirTotal)} strength
          </li>
          <li data-testid={`report-${r.id}-lost`}>
            Our units lost:{' '}
            {lost.length ? lost.map(([k, n]) => `${n} ${unitName(k, n ?? 0)}`).join(', ') : 'none'}
          </li>
        </ul>
      </li>
    );
  return (
    <li class="war-report" data-testid={`report-${r.id}`}>
      <strong>{head}</strong>
      {day && <span class="muted"> · {day}</span>}
      {r.replay && (
        <button class="btn" data-testid={`watch-${r.id}`} onClick={() => void game.watchBattle(r.replay!)}>
          Watch
        </button>
      )}
      <ul>
        <li>
          Their force: {r.theirLost} of {r.theirTotal} knocked out
        </li>
        <li data-testid={`report-${r.id}-lost`}>
          Our units lost:{' '}
          {lost.length ? lost.map(([k, n]) => `${n} ${unitName(k, n ?? 0)}`).join(', ') : 'none'}
        </li>
        <li data-testid={`report-${r.id}-damage`}>
          {r.collapsed.length
            ? `${formatNumber(r.collapsed.length)} buildings knocked down (${formatNumber(r.homeless)} residents moved out)`
            : 'No buildings knocked down'}
          {r.burning.length ? `, ${formatNumber(r.burning.length)} set on fire` : ''}
          {r.craters ? `, ${formatNumber(r.craters)} roads cratered` : ''}
        </li>
        {r.civics.length > 0 && (
          <li>
            Under repair:{' '}
            {r.civics.map((c, k) => (
              <span key={c.id}>
                {k > 0 && ', '}
                <button class="link" onClick={() => game.flyToId(c.id)}>
                  {CIVIC.get(c.def)?.name ?? c.def}
                </button>
                {c.wrecked ? ' (wrecked)' : ''}
              </span>
            ))}
          </li>
        )}
        {r.near > 0 && (
          <li>
            Shelters took {formatNumber(r.sheltered)} of the {formatNumber(r.near)} residents nearby
          </li>
        )}
      </ul>
    </li>
  );
}

/** The war room's battle reports, newest first. */
export function Reports({ reports }: { reports: BattleReport[] }) {
  if (!reports.length)
    return (
      <p class="muted" data-testid="war-reports-none">
        No battles yet. When a neighbour raids the city, the report of what happened is kept here.
      </p>
    );
  return (
    <ul class="war-reports" data-testid="war-reports-list">
      {reports.map((r) => (
        <ReportCard key={r.id} r={r} />
      ))}
    </ul>
  );
}

const ROUTE_NAMES: Record<BattleRoute, string> = {
  highway: 'By road',
  rail: 'By rail',
  sea: 'By sea',
  air: 'By air',
};
const ROUTE_DOMAINS: Record<BattleRoute, string[]> = {
  highway: ['land', 'air'],
  rail: ['land'],
  sea: ['sea', 'air'],
  air: ['air'],
};

/** The war room's Send tab (M35): choose a neighbour, what to strike, the way, and the units. */
type SendCmd = Extract<Command, { type: 'sendForce' }>;

export function SendForce() {
  const game = useGameUpdates(400);
  const w = game.world.stats.war;
  // Computer rivals, and friends' cities where the region's rules allow war.
  const war = !!game.region?.view?.rules.war;
  const rivals = game.world.stats.region.neighbours.filter(
    (n) => (n.rival && !n.player) || (n.player && war),
  );
  const [to, setTo] = useState<number | null>(rivals[0]?.id ?? null);
  const [target, setTarget] = useState<BattleTarget>('military');
  const [route, setRoute] = useState<BattleRoute>('highway');
  const [stance, setStance] = useState<Stance>('bold');
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [why, setWhy] = useState<string | null>(null);
  const [gate, setGate] = useState(false);
  // A pact in the way (M36): the warning and the very command it was about.
  const [breaks, setBreaks] = useState<{
    text: string;
    cmd: SendCmd;
    slot: number | null;
    hours: number;
    form: string;
  } | null>(null);
  if (!w) return null;
  if (!rivals.length) return <p class="muted">No rival neighbours to raid.</p>;
  // At home and fit to go; a superweapon winding up waits (M37).
  const home = (game.world.forces?.units ?? []).filter((u) => !u.away && u.hp >= 0.5 && !u.ready);
  const gateState = w?.supers?.gate ?? null;
  const kinds = [...new Set(home.map((u) => u.kind))].filter((k) =>
    ROUTE_DOMAINS[route].includes(UNIT.get(k)?.domain ?? 'land'),
  );
  const chosen = kinds.flatMap((k) =>
    home
      .filter((u) => u.kind === k)
      .slice(0, picked[k] ?? 0)
      .map((u) => u.id),
  );
  const n = rivals.find((x) => x.id === to) ?? rivals[0]!;
  // As the sim works it out: Supply lines (M37), a superweapon's slow way, or the gate's hour.
  const picks = chosen.map((id) => ({ kind: home.find((u) => u.id === id)!.kind }));
  const slow = Math.max(1, ...picks.map((p) => UNIT.get(p.kind)?.super?.travel ?? 1));
  const hours = gate && gateState ? 1 : travelHours(route, n.side, picks, (w?.research?.travel ?? 1) * slow);
  // The form as it stands: a warning about another choice of force is no longer shown.
  const form = JSON.stringify([n.id, target, route, stance, chosen, gate]);
  const send = async (asked?: NonNullable<typeof breaks>) => {
    const cmd: SendCmd = asked
      ? { ...asked.cmd, breakPact: true }
      : {
          type: 'sendForce',
          units: chosen,
          to: n.id,
          route,
          target,
          stance,
          ...(gate ? { gate: true } : {}),
        };
    const slot = asked ? asked.slot : (n.player?.slot ?? null);
    const time = asked ? asked.hours : hours;
    const r = await game.dispatch(cmd);
    // A pact in the way (M36): asked first, about this very force.
    if (!r.ok && r.info?.breaks) {
      setBreaks({ text: r.reason, cmd, slot, hours: time, form });
      return;
    }
    setBreaks(null);
    setWhy(r.ok ? null : r.reason);
    if (r.ok) setPicked({});
    // M37: the gate opens, and a superweapon sets off with its own sound.
    if (r.ok && cmd.gate) game.audio?.play('gate');
    const sup = r.ok
      ? cmd.units
          .map((id) => game.world.forces?.units.find((u) => u.id === id)?.kind)
          .find((k) => k !== undefined && UNIT.get(k)?.super)
      : undefined;
    if (sup)
      game.audio?.play(
        sup === 'windupbot' ? 'superRobot' : sup === 'skyfortress' ? 'superFortress' : 'superWhale',
      );
    // A friend hears of it, if they're playing: a superweapon or the gate named.
    if (r.ok && slot !== null)
      game.region?.forceOut(slot, cmd.units.length, time, {
        ...(sup ? { super: sup } : {}),
        ...(cmd.gate ? { gate: true } : {}),
      });
  };
  return (
    <div class="war-send" data-testid="war-send-form">
      {game.away.scouting && (
        <p class="muted" data-testid="war-scouting">
          Scouting {game.away.scouting.name}’s streets: {formatNumber(game.away.scouting.population)} of about{' '}
          {formatNumber(game.away.scouting.target)} residents mapped…
        </p>
      )}
      <label>
        Raid{' '}
        <select
          data-testid="send-to"
          value={n.id}
          onChange={(e) => setTo(Number((e.target as HTMLSelectElement).value))}
        >
          {rivals.map((r) => (
            <option key={r.id} value={r.id}>
              {r.rival
                ? `${r.name} (forces ${formatNumber(r.rival.forces)}, defences ${formatNumber(r.rival.defences)})`
                : `${r.name} (${r.player?.mayor ?? 'a friend'}’s city)`}
            </option>
          ))}
        </select>
      </label>
      <label>
        Strike{' '}
        <select
          data-testid="send-target"
          value={target}
          onChange={(e) => setTarget((e.target as HTMLSelectElement).value as BattleTarget)}
        >
          <option value="military">its military buildings</option>
          <option value="industry">its industry near the border</option>
          <option value="power">its power plants near the border</option>
          <option value="cityhall">its HQ, the seat of power (in a declared war)</option>
        </select>
      </label>
      <label>
        Go{' '}
        <select
          data-testid="send-route"
          value={route}
          onChange={(e) => setRoute((e.target as HTMLSelectElement).value as BattleRoute)}
        >
          {(['highway', 'rail', 'sea', 'air'] as const).map((r) => (
            <option key={r} value={r}>
              {ROUTE_NAMES[r]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Pull back{' '}
        <select
          data-testid="send-stance"
          value={stance}
          onChange={(e) => setStance((e.target as HTMLSelectElement).value as Stance)}
        >
          <option value="bold">after heavy losses (bold)</option>
          <option value="cautious">at the first losses (cautious)</option>
        </select>
      </label>
      <div class="war-send-units">
        {kinds.length ? (
          kinds.map((k) => {
            const have = home.filter((u) => u.kind === k).length;
            const v = Math.min(picked[k] ?? 0, have);
            const sup = !!UNIT.get(k)?.super;
            return (
              <label key={k} class={`war-send-unit ${sup ? 'super' : ''}`}>
                <span>
                  {unitName(k, have)} ({sup ? 'superweapon, one a force' : `${have} at home`})
                </span>
                <input
                  type="number"
                  min={0}
                  max={sup ? 1 : have}
                  value={v}
                  data-testid={`send-${k}`}
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
          <p class="muted">No units at home can go this way.</p>
        )}
      </div>
      {gateState && (
        <label class="war-send-gate">
          <input
            type="checkbox"
            data-testid="send-gate"
            checked={gate}
            disabled={gateState.wait > 0}
            onChange={(e) => setGate((e.target as HTMLInputElement).checked)}
          />{' '}
          Through the express gate: arrives in an hour
          {gateState.wait > 0 ? ` (recharging: ${Math.ceil(gateState.wait)} h)` : ''}
        </label>
      )}
      {(game.world.forces?.units ?? []).some((u) => !u.away && u.ready) && (
        <p class="muted" data-testid="send-winding">
          {(game.world.forces?.units ?? [])
            .filter((u) => !u.away && u.ready)
            .map((u) => `${UNIT.get(u.kind)?.name} winding up: ${Math.ceil(u.ready!)} h`)
            .join(' · ')}
        </p>
      )}
      <p class="muted">
        {chosen.length
          ? `${chosen.length} unit${chosen.length === 1 ? '' : 's'}, ${hours} hours to get there; ${chosen.length === 1 ? 'it comes' : 'they come'} back the same way.`
          : 'Choose the units to send.'}
      </p>
      {why && (
        <p class="war-warn" data-testid="send-why">
          {why}
        </p>
      )}
      {breaks?.form === form && (
        <div class="dip-confirm" role="alertdialog" data-testid="send-breaks">
          <p>{breaks.text}. Your reputation will suffer, and its allies will turn against the city.</p>
          <div class="dip-actions">
            <button class="btn danger" data-testid="send-breaks-yes" onClick={() => void send(breaks)}>
              Send it anyway
            </button>
            <button class="btn" onClick={() => setBreaks(null)}>
              Keep the city’s word
            </button>
          </div>
        </div>
      )}
      <button
        class="btn primary"
        data-testid="send-force"
        disabled={!chosen.length}
        onClick={() => void send()}
      >
        Send the force
      </button>
      {w.expeditions.length > 0 && (
        <ul class="war-expeditions" data-testid="war-expeditions">
          {w.expeditions.map((e) => {
            const left = Math.max(
              0,
              ((e.state === 'back' ? e.home : e.arrive) - game.world.displayTick) / TICKS_PER_HOUR,
            );
            return (
              <li key={e.id} data-testid={`expedition-${e.id}`}>
                {e.units} unit{e.units === 1 ? '' : 's'}{' '}
                {e.help
                  ? // A force that went to help a friend is not a raid: the page knows how it is getting on.
                    helpForceLine(e, game.live.helping(), left)
                  : e.state === 'out'
                    ? `on the way to ${e.name}: ${left.toFixed(1)} h`
                    : e.state === 'fighting'
                      ? e.settling
                        ? `fought in ${e.name}: waiting for the region to take the battle`
                        : `fighting in ${e.name}`
                      : `coming home from ${e.name}: ${left.toFixed(1)} h`}
                {e.state !== 'back' && !e.settling && !e.help && (
                  <button
                    class="btn"
                    data-testid={`recall-${e.id}`}
                    onClick={() => void game.dispatch({ type: 'recallForce', expedition: e.id })}
                  >
                    Call back
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The war room's map (M35): the city, its neighbours, the ways between, forces on the move, fronts. */
export function RegionMap() {
  const game = useGameUpdates(400);
  const w = game.world.stats.war;
  if (!w) return null;
  const tick = game.world.displayTick;
  const ns = game.world.stats.region.neighbours;
  const at: Record<string, { x: number; y: number }> = {};
  const sides: Record<string, typeof ns> = { north: [], south: [], west: [] };
  for (const n of ns) sides[n.side]?.push(n);
  const place = (side: string, k: number, of: number) => {
    const t = (k + 1) / (of + 1);
    return side === 'north'
      ? { x: 60 + t * 240, y: 36 }
      : side === 'south'
        ? { x: 60 + t * 240, y: 222 }
        : { x: 46, y: 50 + t * 180 };
  };
  for (const [side, list] of Object.entries(sides))
    list.forEach((n, k) => (at[n.id] = place(side, k, list.length)));
  const me = { x: 210, y: 140 };
  // (Help given to a friend is no fight with it: its report makes no front on the road between the two.)
  const recent = new Set(
    w.reports.filter((r) => !r.help && tick - r.end < 3 * TICKS_PER_MONTH).map((r) => r.other),
  );
  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  return (
    <div class="war-map" data-testid="war-map">
      <svg
        viewBox="0 0 360 280"
        role="img"
        aria-label="The region: the city, its neighbours, forces on the move"
      >
        <rect x="0" y="0" width="360" height="280" rx="10" class="war-map-bg" />
        {ns.map((n) => {
          const p = at[n.id]!;
          const hours = travelHours('highway', n.side, []);
          const front = (n.rival && n.rival.relation <= -40) || recent.has(n.name);
          const mid = lerp(p, me, 0.5);
          // A front's label goes beside the road, on the side away from the air route drawn up and
          // right of it; the hours by the town, on the side away from its road (above a town to the
          // north, under one to the south or west).
          const len = Math.hypot(me.x - p.x, me.y - p.y) || 1;
          let nx = -(me.y - p.y) / len;
          let ny = (me.x - p.x) / len;
          if (nx * 6 - ny * 6 > 0) [nx, ny] = [-nx, -ny];
          const label =
            n.side === 'north'
              ? { x: p.x, y: p.y - 18, anchor: 'middle' }
              : n.side === 'south'
                ? { x: p.x, y: p.y + (n.rival ? 48 : 37), anchor: 'middle' }
                : { x: 6, y: p.y + (n.rival ? 48 : 37), anchor: 'start' };
          return (
            <g key={n.id} data-testid={`map-${n.id}`}>
              <line x1={p.x} y1={p.y} x2={me.x} y2={me.y} class={`war-map-route ${front ? 'front' : ''}`} />
              <line x1={p.x} y1={p.y} x2={me.x} y2={me.y} class="war-map-air" transform="translate(6 -6)" />
              {w.routes.sea && (
                <line x1={p.x} y1={p.y} x2={me.x} y2={me.y} class="war-map-sea" transform="translate(-6 6)" />
              )}
              <text x={label.x} y={label.y} class="war-map-hours" text-anchor={label.anchor}>
                road {hours} h{w.routes.rail && ` · rail ${travelHours('rail', n.side, [])} h`}
                {w.routes.sea && ` · sea ${travelHours('sea', n.side, [])} h`} · air{' '}
                {travelHours('air', n.side, [])} h
              </text>
              <circle
                cx={p.x}
                cy={p.y}
                r={n.rival ? 13 : 10}
                class={`war-map-town ${n.rival ? 'rival' : ''}`}
              />
              <text x={p.x} y={p.y + 26} class="war-map-name">
                {n.name}
              </text>
              {n.rival && (
                <text x={p.x} y={p.y + 37} class="war-map-note town">
                  {n.rival.personality} · {formatNumber(n.rival.forces)}
                </text>
              )}
              {front && (
                <text x={mid.x - nx * 14} y={mid.y - ny * 14 + 3} class="war-map-front">
                  front
                </text>
              )}
              {/* M37: a friend's research, from its last report: a bar per branch, a step per tier. */}
              {n.player?.tiers && (
                <g class="war-map-tiers" data-testid={`map-tiers-${n.id}`}>
                  <title>
                    Research:{' '}
                    {BRANCHES.map((b, k) => `${b.name.toLowerCase()} ${n.player!.tiers![k] ?? 0}/4`).join(
                      ', ',
                    )}
                  </title>
                  {BRANCHES.map((b, k) => (
                    <g key={b.id}>
                      <rect
                        x={p.x - 13 + k * 4.5}
                        y={p.y + 30}
                        width={3}
                        height={10}
                        class="war-map-tier-bg"
                      />
                      <rect
                        x={p.x - 13 + k * 4.5}
                        y={p.y + 40 - 2.5 * (n.player!.tiers![k] ?? 0)}
                        width={3}
                        height={2.5 * (n.player!.tiers![k] ?? 0)}
                        class="war-map-tier"
                      />
                    </g>
                  ))}
                </g>
              )}
              {/* M37: an eye on a neighbour the city's spies looked round lately; one it blacked out, dark. */}
              {w.supers?.darkened.some((d) => d.id === n.id) && (
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={n.rival ? 16 : 13}
                  class="war-map-dark"
                  data-testid={`map-dark-${n.id}`}
                />
              )}
              {w.intel?.revealed.includes(n.id) && (
                <text x={p.x + 15} y={p.y - 10} class="war-map-eye" data-testid={`map-eye-${n.id}`}>
                  ◉
                </text>
              )}
            </g>
          );
        })}
        <circle cx={me.x} cy={me.y} r={18} class="war-map-town mine" />
        <text x={me.x} y={me.y + 34} class="war-map-name">
          {game.world.stats.cityName}
        </text>
        {w.expeditions.map((e) => {
          const p = at[e.to];
          if (!p) return null;
          const t =
            e.state === 'out'
              ? Math.min(1, Math.max(0, (tick - e.depart) / Math.max(1, e.arrive - e.depart)))
              : e.state === 'fighting'
                ? 1
                : 1 -
                  Math.min(
                    1,
                    Math.max(0, (tick - (e.home - (e.arrive - e.depart))) / Math.max(1, e.arrive - e.depart)),
                  );
          const q = lerp(me, p, t);
          // A superweapon (M37) has its own token: the robot striding, the fortress drifting, the
          // whale under the water; a force through the gate leaps along a sparkling arc.
          const stride = Math.floor(tick / 20) % 2 ? 2 : -2;
          return (
            <g key={e.id} data-testid={`token-${e.id}`}>
              {e.gate && (
                <path
                  d={`M ${me.x} ${me.y} Q ${(me.x + p.x) / 2} ${Math.min(me.y, p.y) - 60} ${p.x} ${p.y}`}
                  class="war-map-gate"
                  data-testid={`gate-arc-${e.id}`}
                />
              )}
              {e.super === 'windupbot' ? (
                <g class="war-map-super robot" data-testid={`super-token-${e.id}`}>
                  <rect x={q.x - 6} y={q.y - 12} width="12" height="14" rx="2" />
                  <line x1={q.x - 3} y1={q.y + 2} x2={q.x - 3 + stride} y2={q.y + 9} />
                  <line x1={q.x + 3} y1={q.y + 2} x2={q.x + 3 - stride} y2={q.y + 9} />
                </g>
              ) : e.super === 'skyfortress' ? (
                <ellipse
                  cx={q.x}
                  cy={q.y - 10 + Math.sin(tick / 30) * 2}
                  rx="14"
                  ry="6"
                  class="war-map-super fortress"
                  data-testid={`super-token-${e.id}`}
                />
              ) : e.super === 'clockworkwhale' ? (
                <ellipse
                  cx={q.x}
                  cy={q.y}
                  rx="13"
                  ry="5"
                  class="war-map-super whale"
                  data-testid={`super-token-${e.id}`}
                />
              ) : (
                <rect x={q.x - 7} y={q.y - 7} width="14" height="14" rx="3" class="war-map-token ours" />
              )}
              <text x={q.x + 10} y={q.y + 4} class="war-map-note">
                {e.units}
              </text>
            </g>
          );
        })}
        {w.incoming &&
          (() => {
            const n = ns.find((x) => x.name === w.incoming!.from);
            const p = n && at[n.id];
            if (!p) return null;
            const left = Math.max(0, (w.incoming.arrive - tick) / TICKS_PER_HOUR);
            const t = 1 - Math.min(1, left / Math.max(1, travelHours('highway', n.side, [])));
            const q = lerp(p, me, t);
            return (
              <g data-testid="token-incoming">
                <rect x={q.x - 7} y={q.y - 7} width="14" height="14" rx="3" class="war-map-token theirs" />
                <text x={q.x + 10} y={q.y + 4} class="war-map-note">
                  {w.incoming.units} · {left.toFixed(1)} h
                </text>
              </g>
            );
          })()}
      </svg>
      <p class="muted">
        Lines are the roads between the towns (dotted: the air route; dashed blue: the sea lane, with ships),
        with the hours a force takes each way, and by rail with a rail link. Squares are forces on the move:
        ours in blue, theirs in red. A front is where there's been fighting lately or feelings are hostile.
      </p>
      <p class="muted" data-testid="war-threat">
        {w.threat.open
          ? 'Your neighbours may raid the city: the more they outgun you and the worse their feelings, the sooner.'
          : `Neighbours leave a city alone until it has ${formatNumber(RAIDS.minPopulation)} residents and is a year old.`}
        {w.threat.answering.length > 0 &&
          ` ${ns
            .filter((n) => w.threat.answering.includes(n.id))
            .map((n) => n.name)
            .join(' and ')} may answer your raid within ${RAIDS.retaliate} months of it.`}
      </p>
    </div>
  );
}

/** While watching a battle in a neighbour's town (M35): what this is, and the way home. */
export function ViewerBar() {
  const game = useGameUpdates(500);
  const v = game.viewing;
  if (!v) return null;
  const f = game.world.battle;
  return (
    <div class="viewer-bar panel" data-testid="viewer-bar" role="status">
      <div class="viewer-text">
        <span>
          {f
            ? `Watching ${v.record.input.attacker.name}'s raid on ${v.record.input.defender.name}.`
            : `${v.record.input.defender.name} after the raid: crews are clearing up and repairing.`}{' '}
          Nothing here can be changed.
        </span>
        {v.record.region && <ReplayNote />}
      </div>
      <button class="btn primary" data-testid="viewer-back" onClick={() => game.backToCity()}>
        Back to my city
      </button>
    </div>
  );
}

/** A region replay in the viewer (M39 step 7): whether its run ends where the battle ended when it was fought. */
function ReplayNote() {
  const game = useGameUpdates(500);
  const want = game.viewing?.record.region?.expect;
  const check = game.replayCheck;
  if (!want)
    return (
      <span class="viewer-check" data-testid="viewer-check">
        Nobody finished this battle, so there is nothing to check the replay against.
      </span>
    );
  if (!check)
    return (
      <span class="viewer-check" data-testid="viewer-check">
        Checking the replay against the battle as it was fought…
      </span>
    );
  return check.verdict === 'checked' ? (
    <span class="viewer-check checked" data-testid="viewer-check">
      Replay checked: it ends exactly as the battle did.
    </span>
  ) : (
    <span class="viewer-check differs" data-testid="viewer-check">
      Replay differs from the battle as it was fought:{' '}
      {check.step === check.want
        ? 'it ended at the same step, but not the same way.'
        : `it ended at step ${check.step}, the battle at step ${check.want}.`}{' '}
      The two cities may be playing different versions of the game.
    </span>
  );
}
