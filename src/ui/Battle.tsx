/**
 * Battles on the page (M35): the top bar's raid countdown, the battle bar while the city is
 * fighting, and the war room's reports. DESIGN.md §3.29.
 */
import { useState } from 'preact/hooks';
import { CIVIC } from '../data/civic';
import { RAIDS, type BattleRoute, type BattleTarget, type Stance } from '../data/battle';
import { travelHours } from '../sim/systems/raids';
import { UNIT, type UnitKind } from '../data/war';
import type { BattleReport } from '../sim/systems/raids';
import { TICKS_PER_HOUR, TICKS_PER_MONTH, dateOf, formatDate } from '../sim/time';
import { formatNumber, useGameUpdates } from './hooks';

const TARGETS: Record<string, string> = {
  military: 'military buildings',
  industry: 'industry',
  power: 'power plants',
  cityhall: 'the city hall',
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
      title={`${r.from} is sending ${r.units} units against ${TARGETS[r.target] ?? r.target}`}
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
  if (!f || game.inMenu()) return null;
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
  const head = r.ours
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
            targets knocked out, {formatNumber(r.away.destroyed)} buildings down
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
  if (!w) return null;
  if (!rivals.length) return <p class="muted">No rival neighbours to raid.</p>;
  const home = (game.world.forces?.units ?? []).filter((u) => !u.away && u.hp >= 0.5);
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
  const hours = travelHours(
    route,
    n.side,
    chosen.map((id) => ({ kind: home.find((u) => u.id === id)!.kind })),
  );
  const send = async () => {
    const r = await game.dispatch({ type: 'sendForce', units: chosen, to: n.id, route, target, stance });
    setWhy(r.ok ? null : r.reason);
    if (r.ok) setPicked({});
    // A friend hears of it, if they're playing.
    if (r.ok && n.player) game.region?.forceOut(n.player.slot, chosen.length, hours);
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
            return (
              <label key={k} class="war-send-unit">
                <span>
                  {unitName(k, have)} ({have} at home)
                </span>
                <input
                  type="number"
                  min={0}
                  max={have}
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
      <p class="muted">
        {chosen.length
          ? `${chosen.length} units, ${hours} hours to get there; they come back the same way.`
          : 'Choose the units to send.'}
      </p>
      {why && (
        <p class="war-warn" data-testid="send-why">
          {why}
        </p>
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
                {e.units} units{' '}
                {e.state === 'out'
                  ? `on the way to ${e.name}: ${left.toFixed(1)} h`
                  : e.state === 'fighting'
                    ? `fighting in ${e.name}`
                    : `coming home from ${e.name}: ${left.toFixed(1)} h`}
                {e.state !== 'back' && (
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
  const recent = new Set(w.reports.filter((r) => tick - r.end < 3 * TICKS_PER_MONTH).map((r) => r.other));
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
          return (
            <g key={e.id} data-testid={`token-${e.id}`}>
              <rect x={q.x - 7} y={q.y - 7} width="14" height="14" rx="3" class="war-map-token ours" />
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
      <span>
        {f
          ? `Watching ${v.record.input.attacker.name}'s raid on ${v.record.input.defender.name}.`
          : `${v.record.input.defender.name} after the raid: crews are clearing up and repairing.`}{' '}
        Nothing here can be changed.
      </span>
      <button class="btn primary" data-testid="viewer-back" onClick={() => game.backToCity()}>
        Back to my city
      </button>
    </div>
  );
}
