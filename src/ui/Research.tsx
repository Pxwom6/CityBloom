/**
 * The war room's Research tab (M37): the weapons labs and what they make, the queue, the six
 * branches of four tiers (each with what it gives, its state and its price), and prototypes waiting
 * for their trial at the proving ground. Every figure comes from the sim's research summary.
 */
import { CIVIC } from '../data/civic';
import { SPY_OP } from '../data/intel';
import { useState } from 'preact/hooks';
import {
  BRANCHES,
  RESEARCH,
  SPINOFFS,
  TIERS,
  type Branch,
  type TierDef,
  type TierKey,
} from '../data/research';
import { UNIT, type UnitKind } from '../data/war';
import type { ResearchSummary } from '../sim/systems/research';
import { formatMoney, formatNumber, useGameUpdates } from './hooks';

/** Hours as the war room says them: hours under a day, else days (a game month is a day). */
export function warHours(h: number): string {
  if (h < 24) return `${Math.max(1, Math.round(h))} h`;
  const d = Math.round((h / 24) * 10) / 10;
  return `${d} day${d === 1 ? '' : 's'}`;
}

/** What a tier gives, in chips: units (each a prototype first), buildings, spy missions, a spin-off. */
function chips(t: TierDef): string[] {
  const out: string[] = [];
  for (const u of t.unlocks?.units ?? []) {
    const d = UNIT.get(u);
    out.push(d?.super ? `Superweapon: ${d.name}` : `Unlocks: ${d?.name ?? u}, after a trial`);
  }
  for (const c of t.unlocks?.civics ?? []) {
    const d = CIVIC.get(c);
    out.push(d?.military?.superweapon ? `Superweapon: ${d.name}` : `Unlocks: ${d?.name ?? c}`);
  }
  for (const op of t.unlocks?.ops ?? []) out.push(`Spies: ${SPY_OP[op].name.toLowerCase()}`);
  if (t.spinoff) out.push(`Spin-off: ${SPINOFFS[t.spinoff].name}`);
  return out;
}

function Tier({
  t,
  r,
  act,
  busy,
}: {
  t: TierDef;
  r: ResearchSummary;
  act: (k: TierKey) => void;
  busy: boolean;
}) {
  const done = r.done.includes(t.key);
  const at = r.queue.indexOf(t.key);
  const pts = r.points[t.key] ?? 0;
  const blocked = r.blocked[t.key];
  const left = r.rate > 0 ? (t.points - pts) / r.rate : Infinity;
  const state = done ? 'done' : at === 0 ? 'working' : at > 0 ? 'queued' : blocked ? 'locked' : 'open';
  return (
    <div class={`research-tier ${state}`} data-testid={`research-tier-${t.key}`}>
      <div class="research-tier-head">
        <strong>{t.name}</strong>
        {t.park && <small class="research-chip super">Superweapon</small>}
      </div>
      <p class="muted">{t.blurb}</p>
      {chips(t).map((c) => (
        <small key={c} class="research-chip">
          {c}
        </small>
      ))}
      {done && <p class="research-state dip-good">Done</p>}
      {at === 0 && (
        <>
          <div class="war-bar good">
            <span style={{ width: `${Math.min(100, (pts / t.points) * 100)}%` }} />
          </div>
          <p class="research-state muted">
            {formatNumber(Math.floor(pts))} of {formatNumber(t.points)} points
            {Number.isFinite(left) ? ` · about ${warHours(left)} left` : ' · the labs are idle'}
          </p>
        </>
      )}
      {at > 0 && <p class="research-state muted">Queued #{at + 1}</p>}
      {at >= 0 && !done && (
        <button
          class="btn small"
          data-testid={`research-stop-${t.key}`}
          disabled={busy}
          title="Take it out of the queue: its points and its payment are kept"
          onClick={() => act(t.key)}
        >
          Take out
        </button>
      )}
      {at < 0 && !done && (
        <button
          class="btn small"
          data-testid={`research-start-${t.key}`}
          disabled={!!blocked || busy}
          title={
            blocked ??
            `${formatNumber(t.points)} points; ${formatMoney(t.cost)} paid when the labs start on it${r.paid.includes(t.key) ? ' (paid already)' : ''}`
          }
          onClick={() => act(t.key)}
        >
          Research {r.paid.includes(t.key) ? '' : formatMoney(t.cost)}
        </button>
      )}
      {at < 0 && !done && blocked && <p class="research-why muted">{blocked}</p>}
    </div>
  );
}

export function Research() {
  const game = useGameUpdates(500);
  const [branch, setBranch] = useState<Branch>('land');
  const r = game.world.stats.war?.research ?? null;
  const labs = [...game.world.civics.values()].filter((c) => CIVIC.get(c.def)?.military?.lab);
  const grounds = [...game.world.civics.values()]
    .filter((c) => c.def === 'provingground')
    .sort((a, b) => a.id - b.id);
  const act = (cmd: Parameters<typeof game.dispatch>[0], ok?: string) =>
    void game.dispatch(cmd).then((res) => {
      if (res.ok) {
        game.audio?.play('place');
        if (ok) game.toast(ok, 'ok', 2500);
      } else game.toast(res.reason, 'bad');
    });
  const needLab = (
    <p data-testid="research-none">
      Weapons research needs a weapons lab (Military, from{' '}
      {formatNumber(CIVIC.get('militarylab')?.unlockPopulation ?? 0)} residents). Up to {RESEARCH.maxLabs}{' '}
      labs work together, and a research park speeds them up.
    </p>
  );
  // No research yet: only how to start. Research done and the labs gone since: what's done stays,
  // and its prototypes can still be tried at a proving ground.
  if (!r) return needLab;
  const head = r.queue[0];
  const queueLeft = r.queue.reduce(
    (a, k) => a + Math.max(0, TIERS.find((t) => t.key === k)!.points - (r.points[k] ?? 0)),
    0,
  );
  const toggle = (k: TierKey) =>
    r.queue.includes(k)
      ? act({ type: 'unqueueResearch', key: k })
      : act({ type: 'queueResearch', key: k }, `${TIERS.find((t) => t.key === k)!.name} queued`);
  const free = grounds.filter((g) => !r.trials.some((t) => t.ground === g.id));
  return (
    <>
      {labs.length ? (
        <p data-testid="research-head">
          {r.labs} lab{r.labs === 1 ? '' : 's'} · {formatNumber(r.rate)} points an hour
          {r.park > 1 ? ` · research park ×${r.park}` : ''}
        </p>
      ) : (
        needLab
      )}
      {r.waiting && (
        <p class="war-warn" data-testid="research-waiting">
          {r.waiting}
        </p>
      )}
      <div class="research-queue" data-testid="research-queue">
        {r.queue.length ? (
          <>
            <span class="muted">Queue:</span>
            {r.queue.map((k, i) => (
              <span key={k} class={`research-chip ${i === 0 ? 'head' : ''}`}>
                {i + 1}. {TIERS.find((t) => t.key === k)!.name}
              </span>
            ))}
            {r.rate > 0 && <span class="muted">· about {warHours(queueLeft / r.rate)} in all</span>}
          </>
        ) : (
          <span class="muted">Nothing queued: pick research below (up to {RESEARCH.queueMax} at once).</span>
        )}
      </div>
      {!r.supers && (
        <p class="muted" data-testid="research-supers-off">
          Your region’s rules turn superweapons off: their research is open, but they can’t be built or used.
        </p>
      )}
      {(r.prototypes.length > 0 || r.trials.length > 0) && (
        <section class="research-protos" data-testid="research-prototypes">
          <h4>Prototypes</h4>
          <p class="muted">Each is tried at a proving ground before it can be built.</p>
          {r.trials.map((t) => {
            const g = game.world.civics.get(t.ground);
            return (
              <div key={t.ground} class="research-proto" data-testid={`trial-${t.kind}`}>
                <span>
                  <strong>{UNIT.get(t.kind)?.name}</strong> on trial{' '}
                  <span class="muted">
                    {'●'.repeat(t.runs)}
                    {'○'.repeat(Math.max(0, 3 - t.runs))} · {warHours(t.hours - t.done)} left
                  </span>
                </span>
                <div class="war-bar good">
                  <span style={{ width: `${Math.min(100, (t.done / t.hours) * 100)}%` }} />
                </div>
                {g && (
                  <button
                    class="btn small"
                    data-testid={`trial-watch-${t.kind}`}
                    onClick={() => game.select({ kind: 'civic', id: g.id })}
                  >
                    Watch
                  </button>
                )}
              </div>
            );
          })}
          {r.prototypes
            .filter((k) => !r.trials.some((t) => t.kind === k))
            .map((k: UnitKind) => {
              const terms = r.terms[k];
              const ground = free[0];
              return (
                <div key={k} class="research-proto" data-testid={`prototype-${k}`}>
                  <strong>{UNIT.get(k)?.name}</strong>
                  <button
                    class="btn small"
                    data-testid={`trial-start-${k}`}
                    disabled={!ground || game.readOnly}
                    title={
                      ground
                        ? undefined
                        : grounds.length
                          ? 'Every proving ground is busy'
                          : 'Build a proving ground'
                    }
                    onClick={() =>
                      ground &&
                      act({ type: 'startTrial', ground: ground.id, kind: k }, `${UNIT.get(k)?.name} on trial`)
                    }
                  >
                    Trial{terms ? ` (${formatMoney(terms.cost)}, ${warHours(terms.hours)})` : ''}
                  </button>
                </div>
              );
            })}
        </section>
      )}
      {/* The six branches as chips (how far each has got), the chosen one's four tiers below. */}
      <div class="research-branches" role="tablist" data-testid="research-grid">
        {BRANCHES.map((b) => {
          const n = r.done.filter((k) => k.startsWith(b.id)).length;
          return (
            <button
              key={b.id}
              role="tab"
              aria-selected={branch === b.id}
              class={`research-branch-chip ${branch === b.id ? 'active' : ''}`}
              data-testid={`research-branch-${b.id}`}
              title={b.blurb}
              onClick={() => setBranch(b.id)}
            >
              {b.name} <small>{n}/4</small>
            </button>
          );
        })}
      </div>
      <section class="research-branch" data-testid={`research-tiers-${branch}`}>
        <p class="muted">{BRANCHES.find((b) => b.id === branch)!.blurb}</p>
        {TIERS.filter((t) => t.branch === branch).map((t) => (
          <Tier key={t.key} t={t} r={r} act={toggle} busy={game.readOnly} />
        ))}
      </section>
      {head === undefined && r.done.length === 0 && (
        <p class="muted">
          Each tier needs the one before it. The money is paid when the labs start on it; points are kept if
          it’s taken out of the queue. Units a tier unlocks are prototypes until a proving ground tries them.
        </p>
      )}
    </>
  );
}
