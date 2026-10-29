/**
 * The war room's Trade tab (M38): the war economy with computer neighbours. Stakes in their
 * industries (bought in steps, sold back, frozen in war), loans to allies, money for an ally's war,
 * munitions and units sold to allies, and sanctions both ways. The sim decides everything and says
 * why a control can't be used (`WarEconomySummary`); the tab shows its words beside the control.
 */
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { ARMS, INVEST, LENDING, WAR_AID } from '../data/warEconomy';
import { PERSONALITY, type Personality } from '../data/war';
import type { Command } from '../sim/commands';
import type { WarEconomySummary } from '../sim/systems/warEconomy';
import { relationWord } from './Diplomacy';
import { TICKS_PER_MONTH } from '../sim/time';
import { formatMoney, formatNumber, useGameUpdates } from './hooks';

type Row = WarEconomySummary['neighbours'][number];

/** A rate a month, signed as the ledger shows it. */
const perMonth = (v: number) => `${v > 0 ? '+' : ''}${formatMoney(v)}/month`;
const pct = (r: number) => `${(r * 100).toFixed(1)} %`;

/** The steps a deal or a fund can be set to: 0 (none) up to `max`. */
function steps(step: number, max: number): number[] {
  const out: number[] = [];
  for (let v = 0; v <= max; v += step) out.push(v);
  return out;
}

/** The sim's words on why a control can't be used, shown beside it. */
function Why({ text, id }: { text: string | null; id: string }) {
  if (!text) return null;
  return (
    <p class="muted trade-why" data-testid={id}>
      {text}.
    </p>
  );
}

export function Trade() {
  const game = useGameUpdates(400);
  const e = game.world.stats.war?.economy ?? null;
  const [asked, setAsked] = useState<{ at: string; text: string } | null>(null);
  const [lend, setLend] = useState<Record<number, number>>({});
  const [unit, setUnit] = useState<number | null>(null);
  const [buyer, setBuyer] = useState<number | null>(null);
  if (!e) return null;
  const run = async (cmd: Command, at: string, done: string) => {
    const r = await game.dispatch(cmd);
    setAsked(r.ok ? null : { at, text: r.reason });
    if (r.ok) {
      game.audio?.play('place');
      game.toast(done, 'ok', 2500);
    }
  };
  const feedback = (at: string) =>
    asked?.at === at ? (
      <p class="dip-why" role="alert" data-testid="trade-refused">
        {asked.text}
      </p>
    ) : null;
  const r = e.rates;
  const income = r.dividends + r.allyInterest + r.allyRepaid + r.armsSales;
  const buyers = e.neighbours.filter((n) => n.sellUnits === null);
  const sellable = e.units.filter((u) => u.why === null);
  const u = sellable.find((x) => x.id === unit) ?? sellable[0];
  const to = buyers.find((x) => x.id === buyer) ?? buyers[0];
  return (
    <div class="dip trade" data-testid="trade">
      <dl class="war-dl" data-testid="trade-summary">
        <dt>Dividends</dt>
        <dd data-testid="trade-dividends">{perMonth(r.dividends)}</dd>
        <dt>Allies’ repayments</dt>
        <dd data-testid="trade-repaid">
          {perMonth(r.allyInterest + r.allyRepaid)}
          {r.allyInterest > 0 ? <span class="muted"> ({formatMoney(r.allyInterest)} interest)</span> : null}
        </dd>
        <dt>Munitions sold</dt>
        <dd data-testid="trade-arms-sales">{perMonth(r.armsSales)}</dd>
        <dt>War aid sent</dt>
        <dd data-testid="trade-aid-sent">{perMonth(r.warAid)}</dd>
        <dt>In all</dt>
        <dd>
          <strong data-testid="trade-net">{perMonth(income + r.warAid)}</strong>
        </dd>
        {e.offers.investors.length > 0 && (
          <>
            <dt>Investors’ share</dt>
            <dd data-testid="trade-investors-share">
              {perMonth(-e.offers.investors.reduce((a, i) => a + i.perMonth, 0))} ({e.offers.sold} % of
              industrial taxes)
            </dd>
          </>
        )}
        {e.offers.debts.length > 0 && (
          <>
            <dt>Owed to neighbours</dt>
            <dd data-testid="trade-debts-owed">{formatMoney(e.offers.owed)}</dd>
          </>
        )}
        <dt>Stakes worth</dt>
        <dd data-testid="trade-worth">{formatMoney(e.worth)}</dd>
        <dt>Allies owe</dt>
        <dd data-testid="trade-owed">{formatMoney(e.owed)}</dd>
        <dt>Munitions</dt>
        <dd data-testid="trade-munitions">
          {formatNumber(e.munitions)} crates in the stores · an ally pays {formatMoney(e.cratePrice)} a crate
        </dd>
      </dl>
      <p class="muted">
        Buy into a neighbour’s industry ({INVEST.step} % at a time, up to {INVEST.maxShare} %) for a monthly
        dividend; a war or sanctions between you freeze it. Allies borrow, buy munitions and units, and an
        ally fighting at your side can be paid to fight harder.
      </p>
      <Offers o={e.offers} run={run} feedback={feedback} />
      {e.neighbours.length === 0 && (
        <p data-testid="trade-none">The city has no computer neighbours to trade with.</p>
      )}
      {e.neighbours.map((n) => (
        <Neighbour
          key={n.id}
          n={n}
          lendAmount={lend[n.id] ?? LENDING.amounts[0]!}
          setLendAmount={(v) => setLend({ ...lend, [n.id]: v })}
          run={run}
          feedback={feedback}
        />
      ))}
      <section class="dip-neighbour" data-testid="trade-units">
        <h4>Sell a unit to an ally</h4>
        {buyers.length === 0 ? (
          <p class="muted">
            Only an ally (an alliance or a defensive pact) buys units, and not while trade with it is stopped.
          </p>
        ) : sellable.length === 0 ? (
          <p class="muted">No unit can be sold now: units at home and not in a battle, superweapons apart.</p>
        ) : (
          <div class="dip-actions">
            <select
              data-testid="trade-unit"
              value={u?.id}
              onChange={(ev) => setUnit(Number((ev.target as HTMLSelectElement).value))}
            >
              {sellable.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name} #{x.id} ({Math.round(x.hp * 100)} %): {formatMoney(x.price)}
                </option>
              ))}
            </select>
            <span>to</span>
            <select
              data-testid="trade-unit-to"
              value={to?.id}
              onChange={(ev) => setBuyer(Number((ev.target as HTMLSelectElement).value))}
            >
              {buyers.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <button
              class="btn"
              data-testid="trade-unit-sell"
              disabled={!u || !to}
              onClick={() =>
                u &&
                to &&
                void run(
                  { type: 'sellUnit', unit: u.id, neighbour: to.id },
                  'units',
                  `${u.name} sold to ${to.name} for ${formatMoney(u.price)}`,
                )
              }
            >
              Sell for {formatMoney(u?.price ?? 0)}
            </button>
          </div>
        )}
        {u && (
          <p class="muted">
            {to?.name ?? 'The ally'}’s forces rise by {formatNumber(u.strength)}; an ally pays{' '}
            {Math.round(ARMS.unitShare * 100)} % of a unit’s price, less for a hurt one.
          </p>
        )}
        {feedback('units')}
      </section>
    </div>
  );
}

/** Days (game months) left until a tick, at least 1. */
const daysTo = (tick: number, now: number) => Math.max(1, Math.ceil((tick - now) / TICKS_PER_MONTH));
const days = (n: number) => `${n} day${n === 1 ? '' : 's'}`;

/**
 * Computer neighbours' offers to the city (M38): to buy munitions, to invest in it for a share of its
 * industrial taxes, or to lend it money. Each is open a few days; the sim says why one can't be taken.
 * Below them, what the city has taken: investors' shares and loans from neighbours.
 */
function Offers({
  o,
  run,
  feedback,
}: {
  o: WarEconomySummary['offers'];
  run: (cmd: Command, at: string, done: string) => Promise<void>;
  feedback: (at: string) => JSX.Element | null;
}) {
  const game = useGameUpdates(400);
  const now = game.world.displayTick;
  if (!o.offers.length && !o.investors.length && !o.debts.length) return null;
  return (
    <>
      {o.offers.length > 0 && (
        <section data-testid="trade-offers">
          <h4>Offers</h4>
          {o.offers.map((x) => (
            <div key={x.id} class="dip-proposal" data-testid={`offer-${x.id}`}>
              <p>{x.text}.</p>
              <p class="muted">Open {days(daysTo(x.expires, now))} more.</p>
              <div class="dip-actions">
                <button
                  class="btn primary"
                  data-testid={`offer-accept-${x.id}`}
                  disabled={!!x.why}
                  title={x.why ?? undefined}
                  onClick={() =>
                    void run(
                      { type: 'answerOffer', offer: x.id, accept: true },
                      `offer${x.id}`,
                      `${x.name}’s offer taken`,
                    )
                  }
                >
                  Accept
                </button>
                <button
                  class="btn"
                  data-testid={`offer-decline-${x.id}`}
                  onClick={() =>
                    void run(
                      { type: 'answerOffer', offer: x.id, accept: false },
                      `offer${x.id}`,
                      `${x.name}’s offer turned down`,
                    )
                  }
                >
                  Turn down
                </button>
              </div>
              <Why text={x.why} id={`offer-why-${x.id}`} />
              {feedback(`offer${x.id}`)}
            </div>
          ))}
        </section>
      )}
      {o.investors.length > 0 && (
        <section data-testid="trade-investors">
          <h4>Investors in the city</h4>
          {o.investors.map((i) => (
            <p key={i.id} class="war-row" data-testid={`investor-${i.id}`}>
              <span>{i.name}</span>
              <span class="muted">
                paid {formatMoney(i.amount)} for {i.share} % of industrial taxes: {formatMoney(i.perMonth)} a
                month now, for {days(daysTo(i.until, now))} more
              </span>
            </p>
          ))}
        </section>
      )}
      {o.debts.length > 0 && (
        <section data-testid="trade-debts">
          <h4>Loans from neighbours</h4>
          {o.debts.map((d) => (
            <p key={d.id} class="war-row" data-testid={`debt-${d.id}`}>
              <span>{d.name}</span>
              <span class="muted">
                {formatMoney(d.balance)} of {formatMoney(d.principal)} owed at {pct(d.annualRate)}:{' '}
                {formatMoney(d.payment)} a month, {d.monthsLeft} months left
              </span>
            </p>
          ))}
        </section>
      )}
    </>
  );
}

function Neighbour({
  n,
  lendAmount,
  setLendAmount,
  run,
  feedback,
}: {
  n: Row;
  lendAmount: number;
  setLendAmount: (v: number) => void;
  run: (cmd: Command, at: string, done: string) => Promise<void>;
  feedback: (at: string) => JSX.Element | null;
}) {
  const at = `n${n.id}`;
  const character = PERSONALITY[n.personality as Personality]?.name ?? n.personality;
  const status: string[] = [];
  if (n.allied) status.push('Ally');
  if (n.helping) status.push('fighting at your side');
  return (
    <section class="dip-neighbour" data-testid={`trade-${n.id}`}>
      <p>
        <strong>{n.name}</strong>{' '}
        <span class="muted">
          {n.kind} · {character} · {relationWord(n.relation)} ({n.relation}) · {formatNumber(n.population)}{' '}
          residents
        </span>
      </p>
      {status.length > 0 && <p class="dip-good">{status.join(' · ')}</p>}
      {n.sanctionedBy && (
        <p class="dip-bad" data-testid={`trade-sanctioned-${n.id}`}>
          {n.sanctionedBy.text}
        </p>
      )}
      {n.sanctioning && (
        <p class="dip-bad" data-testid={`trade-sanctioning-${n.id}`}>
          You sanction {n.name}: no trade between you, and it grows and arms more slowly.
        </p>
      )}
      {n.stopped && !n.sanctionedBy && !n.sanctioning && (
        <p class="dip-bad" data-testid={`trade-stopped-${n.id}`}>
          {n.stopped}
        </p>
      )}

      <h4>Industry</h4>
      <p class="muted">
        Worth {formatMoney(n.industry)}, earning {formatMoney(n.earnings)} a month.
      </p>
      <p data-testid={`trade-stake-${n.id}`}>
        {n.held > 0 ? (
          <>
            You hold {n.held} % ({formatMoney(n.paid)} paid), worth {formatMoney(n.worth)}:{' '}
            {n.frozen ? (
              <span class="dip-bad">{n.frozen}</span>
            ) : (
              <span class="dip-good">{perMonth(n.dividend)}</span>
            )}
          </>
        ) : (
          'No stake.'
        )}
      </p>
      <div class="dip-actions">
        <button
          class="btn"
          data-testid={`trade-buy-${n.id}`}
          disabled={!!n.buy}
          title={n.buy ?? undefined}
          onClick={() =>
            void run(
              { type: 'buyStake', neighbour: n.id, share: INVEST.step },
              at,
              `Bought ${INVEST.step} % of ${n.name}’s industry`,
            )
          }
        >
          Buy {INVEST.step} % for {formatMoney(n.price)}
        </button>
        {n.held > 0 && (
          <button
            class="btn"
            data-testid={`trade-sell-${n.id}`}
            disabled={!!n.sell}
            title={n.sell ?? undefined}
            onClick={() =>
              void run({ type: 'sellStake', neighbour: n.id }, at, `Sold the stake in ${n.name}`)
            }
          >
            Sell for {formatMoney(n.sale)}
          </button>
        )}
      </div>
      {n.buy !== n.stopped && <Why text={n.buy} id={`trade-buy-why-${n.id}`} />}
      {n.held > 0 && n.sell !== n.buy && n.sell !== n.frozen && (
        <Why text={n.sell} id={`trade-sell-why-${n.id}`} />
      )}

      {(n.allied || n.loan) && (
        <>
          <h4>Loan</h4>
          {n.loan ? (
            <p data-testid={`trade-loan-${n.id}`}>
              Owes {formatMoney(n.loan.balance)} of {formatMoney(n.loan.principal)} at{' '}
              {pct(n.loan.annualRate)}:{' '}
              {n.loan.frozen ? (
                <span class="dip-bad">repayments frozen</span>
              ) : (
                <>
                  {formatMoney(n.loan.payment)} a month, {n.loan.monthsLeft} months left
                </>
              )}
            </p>
          ) : (
            <div class="dip-actions">
              <select
                data-testid={`trade-lend-amount-${n.id}`}
                value={lendAmount}
                onChange={(ev) => setLendAmount(Number((ev.target as HTMLSelectElement).value))}
              >
                {LENDING.amounts.map((a) => (
                  <option key={a} value={a}>
                    {formatMoney(a)}
                  </option>
                ))}
              </select>
              <button
                class="btn"
                data-testid={`trade-lend-${n.id}`}
                disabled={!!n.lend}
                title={n.lend ?? undefined}
                onClick={() =>
                  void run(
                    { type: 'lendAlly', neighbour: n.id, amount: lendAmount },
                    at,
                    `Lent ${formatMoney(lendAmount)} to ${n.name}`,
                  )
                }
              >
                Lend at {pct(n.rate)} over {LENDING.months} months
              </button>
            </div>
          )}
          {!n.loan && <Why text={n.lend} id={`trade-lend-why-${n.id}`} />}
        </>
      )}

      {(n.helping || n.aid > 0) && (
        <>
          <h4>War aid</h4>
          <div class="dip-actions">
            <select
              data-testid={`trade-aid-${n.id}`}
              value={n.aid}
              disabled={!!n.fund && n.aid === 0}
              onChange={(ev) => {
                const v = Number((ev.target as HTMLSelectElement).value);
                void run(
                  { type: 'fundAlly', neighbour: n.id, perMonth: v },
                  at,
                  v ? `${n.name}’s war funded: ${formatMoney(v)} a month` : `Stopped funding ${n.name}’s war`,
                );
              }}
            >
              {steps(WAR_AID.step, WAR_AID.max).map((v) => (
                <option key={v} value={v}>
                  {v ? `${formatMoney(v)} a month` : 'None'}
                </option>
              ))}
            </select>
            {n.aid > 0 && (
              <span class="muted" data-testid={`trade-aid-effect-${n.id}`}>
                arming and fighting {Math.round(n.effect * 100)} % harder
              </span>
            )}
          </div>
          {n.aid === 0 && <Why text={n.fund} id={`trade-aid-why-${n.id}`} />}
        </>
      )}

      {(n.allied || n.arms) && (
        <>
          <h4>Munitions</h4>
          {n.armsMax > 0 || n.arms ? (
            <div class="dip-actions">
              <select
                data-testid={`trade-arms-${n.id}`}
                value={n.arms?.amount ?? 0}
                disabled={!n.arms && !!n.armsBuy}
                onChange={(ev) => {
                  const v = Number((ev.target as HTMLSelectElement).value);
                  void run(
                    { type: 'setArmsDeal', neighbour: n.id, crates: v },
                    at,
                    v ? `${n.name} buys ${v} crates a month` : `The arms deal with ${n.name} ends`,
                  );
                }}
              >
                {steps(ARMS.step, Math.max(n.armsMax, n.arms?.amount ?? 0)).map((v) => (
                  <option key={v} value={v}>
                    {v ? `${v} crates a month (${formatMoney(v * ARMS.price)})` : 'No deal'}
                  </option>
                ))}
              </select>
              {n.arms && (
                <span class="muted" data-testid={`trade-arms-sold-${n.id}`}>
                  {formatNumber(n.arms.sold)} sold this month · {formatNumber(n.arms.last)} last month
                </span>
              )}
            </div>
          ) : (
            <p class="muted">{n.name} is too small to buy munitions.</p>
          )}
          {!n.arms && n.armsMax > 0 && <Why text={n.armsBuy} id={`trade-arms-why-${n.id}`} />}
        </>
      )}

      <div class="dip-actions">
        <button
          class="btn"
          data-testid={`trade-sanction-${n.id}`}
          disabled={!!n.sanction}
          title={n.sanction ?? undefined}
          onClick={() =>
            void run(
              { type: 'setSanction', neighbour: n.id, on: !n.sanctioning },
              at,
              n.sanctioning ? `Sanctions on ${n.name} lifted` : `${n.name} is under the city’s sanctions`,
            )
          }
        >
          {n.sanctioning ? 'Lift the sanctions' : `Sanction ${n.name}`}
        </button>
      </div>
      {feedback(at)}
    </section>
  );
}
