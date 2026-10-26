/**
 * The armed forces on screen (M34): a military building's section in the inspector (staff, power,
 * its units and training, and Train buttons), and the war room panel (forces, the war economy,
 * readiness and research), opened from the military HQ, the top bar or Shift+M.
 */
import { useState } from 'preact/hooks';
import { CIVIC } from '../data/civic';
import { PERSONALITY, UNIT, UNIT_CLASSES, UNIT_DEFS, WAR, type UnitKind } from '../data/war';
import type { MilitaryDetails } from '../sim/protocol';
import type { WarSummary } from '../sim/systems/war';
import { formatMoney, formatNumber, useGameUpdates } from './hooks';
import { IconWarRoom } from './icons';

/** Training time in the game's own terms: hours, or months for longer (a month is a day and night). */
export function trainingTime(hours: number): string {
  if (hours < 24) return `${Math.round(hours)} h`;
  const months = Math.round((hours / 24) * 10) / 10;
  return `${months} month${months === 1 ? '' : 's'}`;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

/** A small progress bar. */
function Bar({ value, tone }: { value: number; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div class={`war-bar ${tone ?? ''}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

const toneOf = (v: number) => (v >= 0.75 ? 'good' : v >= 0.4 ? 'warn' : 'bad');

/** A military building in the inspector (M34). */
export function MilitarySection({ civicId, m }: { civicId: number; m: MilitaryDetails }) {
  const game = useGameUpdates(300);
  const orders = game.world.ordersAt(civicId);
  const counts = new Map<UnitKind, number>();
  for (const u of m.units) counts.set(u.kind, (counts.get(u.kind) ?? 0) + 1);
  const act = (cmd: Parameters<typeof game.dispatch>[0], done?: string) =>
    void game.dispatch(cmd).then((r) => {
      if (r.ok) {
        game.audio?.play('place');
        if (done) game.toast(done, 'ok', 2500);
      } else game.toast(r.reason, 'bad');
    });
  return (
    <section class="military" data-testid="military">
      <dl>
        <dt>Staff</dt>
        <dd data-testid="military-staff">
          {formatNumber(m.staffed)} of {formatNumber(m.jobs)}
        </dd>
        <dt>Power</dt>
        <dd data-testid="military-power">
          {formatNumber(m.power)} units ({pct(m.powered)} served)
        </dd>
        {m.holds > 0 && (
          <>
            <dt>Keeps</dt>
            <dd data-testid="military-units">
              {m.units.length + m.training.length} of {m.holds} units
            </dd>
          </>
        )}
        {m.shelters > 0 && (
          <>
            <dt>Shelters</dt>
            <dd>{formatNumber(m.shelters)} residents in a raid</dd>
          </>
        )}
        {m.defends && (
          <>
            <dt>Defends</dt>
            <dd>
              against {m.defends.against.join(' and ')} forces, {m.defends.range} m round about
            </dd>
          </>
        )}
        {m.radar > 0 && (
          <>
            <dt>Radar</dt>
            <dd>sees forces coming {(m.radar / 1000).toFixed(0)} km out</dd>
          </>
        )}
        {(m.safety || m.noise > 0) && (
          <>
            <dt>Neighbours</dt>
            <dd data-testid="military-approval">
              {m.safety ? `Homes within ${m.safety.radius} m feel safer. ` : ''}
              {m.noise > 0 ? `Loud: homes within about ${m.noise} m mind the noise.` : ''}
            </dd>
          </>
        )}
      </dl>
      {m.stalled && (
        <p class="war-warn" data-testid="military-stalled">
          Training held up: {m.stalled}
        </p>
      )}
      {m.training.length > 0 && (
        <div class="war-training" data-testid="military-training">
          <h3>Training</h3>
          {m.training.map((t, i) => {
            const live = orders.find((o) => o.id === t.id);
            const done = live ? game.world.orderProgress(live) : t.done / t.hours;
            const name = UNIT.get(t.kind)?.name ?? t.kind;
            return (
              <div key={t.id} class="war-row" data-testid={`training-${t.id}`}>
                <span>
                  {name}
                  {i > 0 && <small class="muted"> (waiting)</small>}
                </span>
                <Bar value={done} tone={i === 0 && t.rate === 0 ? 'bad' : 'good'} />
                <button
                  class="btn small"
                  data-testid={`cancel-training-${t.id}`}
                  title="Call it off: the money for the training not yet done comes back"
                  onClick={() => act({ type: 'cancelTraining', order: t.id })}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      {m.units.length > 0 && (
        <div class="war-units" data-testid="military-unit-list">
          <h3>Units here</h3>
          {[...counts].map(([kind, n]) => {
            const last = [...m.units].reverse().find((u) => u.kind === kind)!;
            return (
              <div key={kind} class="war-row">
                <span>
                  {n} × {n === 1 ? UNIT.get(kind)?.name : UNIT.get(kind)?.plural}
                </span>
                <button
                  class="btn small"
                  data-testid={`disband-${kind}`}
                  title="Stand one down: it goes, and so does its upkeep"
                  onClick={() => act({ type: 'disbandUnit', unit: last.id })}
                >
                  Stand one down
                </button>
              </div>
            );
          })}
        </div>
      )}
      {m.trains.length > 0 && !game.readOnly && (
        <div class="war-train" data-testid="military-train">
          <h3>Train</h3>
          {m.trains.map((t) => {
            const u = UNIT.get(t.kind)!;
            const total = t.cost + t.imports;
            return (
              <div key={t.kind} class="module-row">
                <div>
                  <strong>{u.name}</strong>
                  <div class="muted">
                    {trainingTime(t.hours)} · {formatMoney(u.upkeep)}/month upkeep
                    {t.imports > 0 ? ` · ${formatMoney(t.imports)} of materials bought in` : ''}
                    {t.why ? `. ${t.why}.` : ''}
                  </div>
                </div>
                <button
                  class="btn small"
                  disabled={!!t.why}
                  title={
                    t.why ??
                    `${u.blurb} Takes ${u.goods} goods, ${u.ore} ore and ${u.oil} oil from the stores.`
                  }
                  data-testid={`train-${t.kind}`}
                  onClick={() =>
                    act({ type: 'trainUnit', base: civicId, kind: t.kind }, `${u.name} in training`)
                  }
                >
                  {formatMoney(total)}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {m.hq && (
        <button class="btn" data-testid="open-war-room" onClick={() => game.openWarRoom()}>
          <IconWarRoom /> Open the war room
        </button>
      )}
    </section>
  );
}

type Tab = 'forces' | 'economy' | 'readiness' | 'research';
const TABS: { id: Tab; name: string }[] = [
  { id: 'forces', name: 'Forces' },
  { id: 'economy', name: 'Upkeep' },
  { id: 'readiness', name: 'Readiness' },
  { id: 'research', name: 'Research' },
];

/** The war room (M34): the city's forces, what they cost, how ready they are, and research. */
export function WarRoomPanel() {
  const game = useGameUpdates(300);
  const [tab, setTab] = useState<Tab>('forces');
  const w = game.world.stats.war;
  if (game.panel !== 'war' || !w) return null;
  return (
    <aside class="advisors war-room panel" data-testid="war-room" role="dialog" aria-label="War room">
      <header>
        <h2>War room</h2>
        <span class="war-head muted" data-testid="war-summary">
          {formatNumber(w.units)} units · readiness {pct(w.readiness)}
        </span>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel('war')}>
          ×
        </button>
      </header>
      <nav class="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            class={`tab ${tab === t.id ? 'active' : ''}`}
            data-testid={`war-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </nav>
      <div class="tab-body advisors-list" data-testid={`war-${tab}`}>
        {tab === 'forces' && <Forces w={w} />}
        {tab === 'economy' && <Economy w={w} />}
        {tab === 'readiness' && <Readiness w={w} />}
        {tab === 'research' && <Research />}
      </div>
    </aside>
  );
}

function Forces({ w }: { w: WarSummary }) {
  const game = useGameUpdates(300);
  const forces = game.world.forces;
  const bases = [...game.world.civics.values()].filter((c) => CIVIC.get(c.def)?.military?.trains);
  const rivals = game.world.stats.region.neighbours.filter((n) => n.rival);
  return (
    <>
      <p data-testid="war-strength">
        {w.units ? (
          <>
            {formatNumber(w.units)} units, fighting strength {formatNumber(w.strength)}
            {w.training ? `, ${w.training} in training` : ''}.
          </>
        ) : w.training ? (
          `${w.training} in training. `
        ) : (
          'No units yet: train them at a barracks, vehicle depot, airfield or naval yard (click one).'
        )}
      </p>
      <div class="war-groups" data-testid="war-groups">
        {UNIT_CLASSES.map((g) => (
          <div
            key={g.id}
            class={`war-group ${w.byGroup[g.id] ? '' : 'none'}`}
            data-testid={`war-group-${g.id}`}
          >
            <strong>{w.byGroup[g.id]}</strong>
            <span>{g.name}</span>
          </div>
        ))}
      </div>
      {bases.map((c) => {
        const def = CIVIC.get(c.def)!;
        const units = forces?.units.filter((u) => u.base === c.id) ?? [];
        const orders = forces?.orders.filter((o) => o.base === c.id) ?? [];
        return (
          <section key={c.id} class="war-base" data-testid={`war-base-${c.id}`}>
            <h4>
              <button class="link" onClick={() => game.select({ kind: 'civic', id: c.id })}>
                {def.name}
              </button>{' '}
              <small class="muted">
                {units.length + orders.length} of {def.military?.holds ?? 0}
              </small>
            </h4>
            {orders.slice(0, 1).map((o) => (
              <div key={o.id} class="war-row">
                <span>{UNIT.get(o.kind)?.name}</span>
                <Bar value={game.world.orderProgress(o)} tone={o.rate === 0 ? 'bad' : 'good'} />
              </div>
            ))}
            {orders.length > 1 && <p class="muted">{orders.length - 1} more waiting to train</p>}
          </section>
        );
      })}
      {rivals.length > 0 && (
        <section class="war-rivals" data-testid="war-rivals">
          <h4>Neighbours</h4>
          {rivals.map((n) => (
            <p key={n.id} class="war-row">
              <span>
                <strong>{n.name}</strong>{' '}
                <small class="muted">{PERSONALITY[n.rival!.personality].name}</small>
              </span>
              <span>
                forces {Math.round(n.rival!.forces)} · defences {Math.round(n.rival!.defences)}
              </span>
            </p>
          ))}
          <p class="muted">
            Forces and defences in the same terms as your fighting strength. Your neighbours arm month by
            month, each in its own way.
          </p>
        </section>
      )}
    </>
  );
}

function Economy({ w }: { w: WarSummary }) {
  const game = useGameUpdates(300);
  const peak = game.world.stats.unlockAll ? Infinity : game.world.stats.peak;
  const act = (cmd: Parameters<typeof game.dispatch>[0], done: string) =>
    void game.dispatch(cmd).then((r) => (r.ok ? game.toast(done, 'ok', 3000) : game.toast(r.reason, 'bad')));
  return (
    <>
      <dl class="war-dl">
        <dt>Units’ upkeep</dt>
        <dd data-testid="war-upkeep-forces">{formatMoney(w.upkeep.forces)}/month</dd>
        <dt>Military buildings</dt>
        <dd data-testid="war-upkeep-buildings">{formatMoney(w.upkeep.buildings)}/month</dd>
        <dt>Defence funding</dt>
        <dd>
          <input
            type="range"
            min={0}
            max={150}
            step={5}
            value={w.funding}
            data-testid="war-funding"
            title="Scales the defence budget: readiness and how fast units train"
            onInput={(e) =>
              void game.dispatch({
                type: 'setFunding',
                dept: 'defence',
                pct: Number((e.target as HTMLInputElement).value),
              })
            }
          />{' '}
          {w.funding} %
        </dd>
      </dl>
      <h4>Stores</h4>
      <p class="muted">
        Units are built from goods, ore and oil. The stores fill a day at a time from your industry, mines and
        wells (paid for: they aren’t sold); an arms factory adds its own and holds more. What a unit needs
        beyond the stores is bought from the region at a higher price.
      </p>
      <div class="war-stores" data-testid="war-stores">
        {(['goods', 'ore', 'oil', 'munitions'] as const).map((k) => (
          <div key={k} class="war-row">
            <span class="war-store-name">{k[0]!.toUpperCase() + k.slice(1)}</span>
            <Bar value={w.capacity[k] ? w.stock[k] / w.capacity[k] : 0} />
            <span class="muted">
              {formatNumber(w.stock[k])}/{formatNumber(w.capacity[k])} · +{formatNumber(w.supply[k])}/day
            </span>
          </div>
        ))}
      </div>
      <h4>War bonds</h4>
      <p class="muted">
        Borrow from your own residents: more than the bank lends, at less interest, but owing them weighs on
        approval ({w.bondMood < 0 ? `now ${Math.round(w.bondMood * 100)} points` : 'none owed now'}).
      </p>
      {w.bonds.map((b) => (
        <div key={b.id} class="war-row" data-testid={`bond-${b.id}`}>
          <span>
            {formatMoney(b.principal)} at {(b.annualRate * 100).toFixed(1)} %
          </span>
          <span class="muted">
            {formatMoney(b.balance)} owed · {formatMoney(b.payment)}/month · {b.monthsLeft} months
          </span>
          <button
            class="btn small"
            data-testid={`repay-bond-${b.id}`}
            onClick={() => act({ type: 'repayBond', id: b.id }, 'War bond repaid')}
          >
            Repay
          </button>
        </div>
      ))}
      <div class="region-share-row">
        {WAR.bonds.map((o) => {
          const locked = peak < o.unlockPopulation;
          return (
            <button
              key={o.amount}
              class="btn"
              disabled={locked || w.bonds.length >= WAR.maxBonds || game.readOnly}
              data-testid={`issue-bond-${o.amount}`}
              title={
                locked
                  ? `Needs ${formatNumber(o.unlockPopulation)} residents`
                  : `${(o.annualRate * 100).toFixed(1)} % a year over ${o.months / 12} years`
              }
              onClick={() =>
                act({ type: 'issueBond', amount: o.amount }, `War bonds sold: ${formatMoney(o.amount)}`)
              }
            >
              Sell {formatMoney(o.amount)}
            </button>
          );
        })}
      </div>
      <button class="btn small" onClick={() => game.openPanel('budget')}>
        Open the budget
      </button>
    </>
  );
}

function Readiness({ w }: { w: WarSummary }) {
  const reasons: string[] = [];
  if (w.hq === null) reasons.push(`No military HQ: readiness can’t rise above ${pct(WAR.noHqReadiness)}.`);
  if (w.staff.jobs && w.staff.filled < w.staff.jobs)
    reasons.push(
      `${formatNumber(w.staff.jobs - w.staff.filled)} posts unfilled: the forces recruit the workers nearest their bases.`,
    );
  if (w.power.need && w.power.served < w.power.need * 0.999) reasons.push('Short of power at some bases.');
  if (w.funding < 100) reasons.push(`Defence funding at ${w.funding} %.`);
  return (
    <>
      <p>
        Readiness <strong data-testid="war-readiness">{pct(w.readiness)}</strong>, heading for {pct(w.target)}
        .
      </p>
      <Bar value={w.readiness} tone={toneOf(w.readiness)} />
      <p class="muted">
        How ready the forces are to fight: it follows staff, power and defence funding, a day at a time. A
        proving ground’s exercises add to it.
      </p>
      <dl class="war-dl">
        <dt>Posts filled</dt>
        <dd>
          {formatNumber(w.staff.filled)} of {formatNumber(w.staff.jobs)}
        </dd>
        <dt>Power</dt>
        <dd>
          {formatNumber(w.power.served)} of {formatNumber(w.power.need)} units
        </dd>
        <dt>Military buildings</dt>
        <dd>{w.bases}</dd>
      </dl>
      {reasons.length > 0 && (
        <ul class="war-reasons" data-testid="war-reasons">
          {reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function Research() {
  const locked = UNIT_DEFS.filter((u) => u.research);
  return (
    <>
      <p>
        Weapons research needs a weapons lab, which your engineers haven’t designed yet. When they have, it
        will unlock:
      </p>
      <ul data-testid="war-research-locked">
        {locked.map((u) => (
          <li key={u.id}>
            <strong>{u.name}</strong> <span class="muted">— {u.blurb}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The war room's button in the top bar (M34): once the city has a military HQ. */
export function WarRoomButton() {
  const game = useGameUpdates(500);
  if (game.world.stats.war?.hq == null) return null;
  return (
    <button
      class={`btn icon ${game.panel === 'war' ? 'active' : ''}`}
      data-testid="open-war"
      aria-label="War room"
      title="War room: forces, upkeep, readiness and research (Shift+M)"
      onClick={() => game.openPanel('war')}
    >
      <IconWarRoom />
    </button>
  );
}
