import { useEffect, useState } from 'preact/hooks';
import { BIG_CITY, DEPTS, LOAN_OPTIONS, MAX_LOANS, TAX_MAX, ledgerLabel, type Dept } from '../data/economy';
import type { BudgetReport } from '../sim/protocol';
import { formatMonth, shortMonthLabel } from '../sim/time';
import { BarChart, LineChart } from './charts';
import { formatMoney, useGameUpdates } from './hooks';

type Tab = 'overview' | 'taxes' | 'funding' | 'loans' | 'history';
const TABS: { id: Tab; name: string }[] = [
  { id: 'overview', name: 'Overview' },
  { id: 'taxes', name: 'Taxes' },
  { id: 'funding', name: 'Services' },
  { id: 'loans', name: 'Loans' },
  { id: 'history', name: 'History' },
];
const WEALTH = ['Low', 'Medium', 'High'];
const TIERS = ['Heavy', 'Manufacturing', 'High-tech'];

function Lines({ rows, title }: { rows: [string, number, number | undefined][]; title: string }) {
  const total = rows.reduce((s, r) => s + r[1], 0);
  const totalP = rows.reduce((s, r) => s + (r[2] ?? 0), 0);
  return (
    <table class="ledger">
      <thead>
        <tr>
          <th>{title}</th>
          <th>This month</th>
          <th>Per month</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr>
            <td colSpan={3} class="muted">
              None yet
            </td>
          </tr>
        )}
        {rows.map(([k, v, p]) => (
          <tr key={k}>
            <td>{ledgerLabel(k)}</td>
            <td class={v < 0 ? 'neg' : ''}>{formatMoney(v)}</td>
            <td class={(p ?? 0) < 0 ? 'neg' : ''}>{p === undefined ? '—' : formatMoney(p)}</td>
          </tr>
        ))}
        <tr class="total">
          <td>Total</td>
          <td class={total < 0 ? 'neg' : ''}>{formatMoney(total)}</td>
          <td class={totalP < 0 ? 'neg' : ''}>{formatMoney(totalP)}</td>
        </tr>
      </tbody>
    </table>
  );
}

/** A big city's running costs (Phase 2 review): how much more it pays, and why. */
function BigCityNote({ factor }: { factor: number }) {
  if (!(factor > 1)) return null;
  return (
    <p class="note" data-testid="big-city">
      Big-city costs: every department and the roads cost {factor.toFixed(2)}× what they would in a town. Past{' '}
      {BIG_CITY.from.toLocaleString('en-US')} residents, wages, land and overheads rise with the city, so a
      big city needs higher taxes (or other income) to break even.
    </p>
  );
}

/** Budget panel: every ledger line, taxes, department funding, loans and history charts. */
export function BudgetPanel() {
  const game = useGameUpdates(250);
  const [tab, setTab] = useState<Tab>('overview');
  const [b, setB] = useState<BudgetReport | null>(null);
  const open = game.panel === 'budget';
  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = () => void game.client.query<BudgetReport>({ type: 'budget' }).then((r) => live && setB(r));
    load();
    const t = setInterval(load, 700);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [open, game]);
  if (!open || !b) return null;
  const refresh = () => void game.client.query<BudgetReport>({ type: 'budget' }).then(setB);
  const keys = [...new Set([...Object.keys(b.month), ...Object.keys(b.projection)])].sort();
  const rows = keys.map((k) => [k, b.month[k] ?? 0, b.projection[k]] as [string, number, number | undefined]);
  const income = rows.filter((r) => (r[2] ?? r[1]) > 0 || (r[2] === undefined && r[1] > 0));
  const expense = rows.filter((r) => !income.includes(r));
  const net = Object.values(b.projection).reduce((s, v) => s + v, 0);
  const term = game.world.stats.election?.term;
  const council = term && !term.won ? formatMonth(term.until) : null;
  return (
    <aside class="budget panel" data-testid="budget">
      <header>
        <h2>Budget</h2>
        <div class="budget-summary">
          <span>Treasury {formatMoney(b.treasury)}</span>
          <span class={net < 0 ? 'neg' : 'pos'}>
            {net >= 0 ? '+' : ''}
            {formatMoney(net)} / month
          </span>
        </div>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel(null)}>
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
            data-testid={`budget-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </nav>
      {tab === 'overview' && (
        <div class="tab-body">
          <Lines rows={income} title="Income" />
          <Lines rows={expense} title="Expenses" />
          <BigCityNote factor={b.bigCity} />
          <p class="note">
            Month so far: started at {formatMoney(b.monthStartTreasury)}, booked{' '}
            {formatMoney(Object.values(b.month).reduce((s, v) => s + v, 0))}, now {formatMoney(b.treasury)}.
          </p>
        </div>
      )}
      {tab === 'taxes' && (
        <div class="tab-body">
          <p class="note">
            Higher taxes raise money but cool demand for that zone and wealth level, and residents notice
            them.
          </p>
          {council && (
            <p class="note warn" data-testid="council-block">
              After the lost election the council blocks tax rises and new loans until {council}.
            </p>
          )}
          {(['R', 'C', 'I'] as const).map((z) => (
            <div key={z} class="tax-zone">
              <h3>{{ R: 'Residential', C: 'Commercial', I: 'Industrial' }[z]}</h3>
              {[0, 1, 2].map((w) => {
                const v = b.taxes[z][w]!;
                const rev = b.projection[`tax${z}${w}`] ?? 0;
                return (
                  <label key={w} class="slider-row">
                    <span>{z === 'I' ? TIERS[w] : WEALTH[w]}</span>
                    <input
                      type="range"
                      min={0}
                      max={TAX_MAX}
                      step={1}
                      value={v}
                      data-testid={`tax-${z}${w}`}
                      onInput={(e) => {
                        void game
                          .dispatch({
                            type: 'setTax',
                            zone: z,
                            wealth: w as 0 | 1 | 2,
                            rate: Number((e.target as HTMLInputElement).value),
                          })
                          .then((r) => {
                            if (!r.ok) game.toast(r.reason, 'bad');
                            refresh();
                          });
                      }}
                    />
                    <span class="val">{v}%</span>
                    <span class="rev">{formatMoney(rev)}/mo</span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {tab === 'funding' && (
        <div class="tab-body">
          <p class="note">
            Funding scales each department's cost and effectiveness (0–150 %). Above 100 % has diminishing
            returns.
          </p>
          <BigCityNote factor={b.bigCity} />
          {DEPTS.map((d) => {
            const v = b.funding[d.id] ?? 100;
            const cost =
              d.id === 'roads' ? (b.projection.roadUpkeep ?? 0) : (b.projection[`upkeep:${d.id}`] ?? 0);
            return (
              <label key={d.id} class="slider-row" title={d.effect}>
                <span>{d.name}</span>
                <input
                  type="range"
                  min={0}
                  max={150}
                  step={5}
                  value={v}
                  data-testid={`funding-${d.id}`}
                  onInput={(e) => {
                    void game
                      .dispatch({
                        type: 'setFunding',
                        dept: d.id as Dept,
                        pct: Number((e.target as HTMLInputElement).value),
                      })
                      .then(refresh);
                  }}
                />
                <span class="val">{v}%</span>
                <span class="rev">{formatMoney(cost)}/mo</span>
              </label>
            );
          })}
        </div>
      )}
      {tab === 'loans' && (
        <div class="tab-body">
          {b.loans.length === 0 && (
            <p class="note">No loans. Borrow to build ahead of your income; interest is charged monthly.</p>
          )}
          {b.loans.map((l) => (
            <div key={l.id} class="loan">
              <div>
                <strong>{formatMoney(l.principal)}</strong> at {(l.annualRate * 100).toFixed(1)}% · {l.months}{' '}
                months
                <div class="muted">
                  Owed {formatMoney(l.balance)} · paying {formatMoney(l.payment)}/month
                </div>
              </div>
              <button
                class="btn"
                onClick={() =>
                  void game
                    .dispatch({ type: 'repayLoan', id: l.id })
                    .then((r) => (r.ok ? refresh() : game.toast(r.reason, 'bad')))
                }
              >
                Repay now
              </button>
            </div>
          ))}
          <h3>Borrow</h3>
          <div class="loan-options">
            {LOAN_OPTIONS.map((o) => {
              const locked = !game.world.stats.unlockAll && game.world.stats.peak < o.unlockPopulation;
              return (
                <button
                  key={o.amount}
                  class="btn"
                  data-testid={`loan-${o.amount}`}
                  disabled={locked || b.loans.length >= MAX_LOANS}
                  title={
                    locked
                      ? `Needs ${o.unlockPopulation.toLocaleString('en-US')} residents`
                      : `${(o.annualRate * 100).toFixed(1)}% a year over ${o.months} months`
                  }
                  onClick={() =>
                    void game
                      .dispatch({ type: 'takeLoan', amount: o.amount })
                      .then((r) =>
                        r.ok
                          ? (refresh(), game.toast(`Borrowed ${formatMoney(o.amount)}`, 'ok'))
                          : game.toast(r.reason, 'bad'),
                      )
                  }
                >
                  {formatMoney(o.amount)} · {(o.annualRate * 100).toFixed(1)}%
                </button>
              );
            })}
          </div>
        </div>
      )}
      {tab === 'history' && (
        <div class="tab-body">
          <h3>Treasury at month end</h3>
          <LineChart
            title="Treasury at the end of each month"
            points={b.history.map((h) => ({ label: shortMonthLabel(h.month), value: h.treasury }))}
          />
          <h3>Net income per month</h3>
          <BarChart
            title="Net income per month"
            points={b.history.map((h) => ({
              label: shortMonthLabel(h.month),
              value: Object.values(h.lines).reduce((s, v) => s + v, 0),
            }))}
          />
        </div>
      )}
    </aside>
  );
}
