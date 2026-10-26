/**
 * Battles on the page (M35): the top bar's raid countdown, the battle bar while the city is
 * fighting, and the war room's reports. DESIGN.md §3.29.
 */
import { CIVIC } from '../data/civic';
import { UNIT, type UnitKind } from '../data/war';
import type { BattleReport } from '../sim/systems/raids';
import { TICKS_PER_HOUR, dateOf, formatDate } from '../sim/time';
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
  const head =
    r.outcome === 'repelled'
      ? `${r.other}'s raid was beaten off`
      : r.outcome === 'withdrew'
        ? `${r.other}'s force pulled back`
        : `${r.other}'s raiders hit ${TARGETS[r.target] ?? r.target}`;
  const lost = Object.entries(r.lost).filter(([, n]) => (n ?? 0) > 0);
  const day = formatDate(dateOf(r.end));
  return (
    <li class="war-report" data-testid={`report-${r.id}`}>
      <strong>{head}</strong>
      {day && <span class="muted"> · {day}</span>}
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
