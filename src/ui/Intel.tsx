/**
 * The war room's Intelligence tab (M37): the spy agency's agents and counter-intelligence, a form
 * to send an agent (where, what, and the odds in words and numbers), missions under way, neighbours
 * revealed lately, and what the agents brought home or the city caught. The sim decides everything;
 * the odds shown are its own (`IntelSummary.rivals`).
 */
import { useState } from 'preact/hooks';
import { INTEL, SPY_OP, SPY_OPS, spyOdds, type SabotageTarget, type SpyOp } from '../data/intel';
import { BRANCHES, type Branch } from '../data/research';
import { CIVIC } from '../data/civic';
import { UNIT, type UnitKind } from '../data/war';
import { formatMoney, formatNumber, useGameUpdates } from './hooks';
import { warHours } from './Research';

type SpyCmd = Extract<Parameters<ReturnType<typeof useGameUpdates>['dispatch']>[0], { type: 'spyMission' }>;

/** A share per thousand in words: "about 3 in 4". */
export function inWords(permille: number): string {
  if (permille >= 900) return 'almost surely';
  if (permille <= 60) return 'hardly ever';
  for (const d of [2, 3, 4, 5, 6, 8, 10]) {
    const n = Math.round((permille / 1000) * d);
    if (n > 0 && Math.abs(n / d - permille / 1000) < 0.04) return `about ${n} in ${d}`;
  }
  return `about ${Math.round(permille / 10)} in 100`;
}

/** A superweapon in a dossier: a unit's kind, or one of the three buildings. */
const SUPER_BUILDING: Record<string, string> = {
  dome: 'dome shield',
  tower: 'blackout tower',
  gate: 'express gate',
};
function superName(k: string): string {
  return SUPER_BUILDING[k] ?? UNIT.get(k as UnitKind)?.name.toLowerCase() ?? k;
}

/** Counter-intelligence in a word. */
export function counterWord(c: number): string {
  return c >= 600 ? 'formidable' : c >= 400 ? 'sharp' : c >= 250 ? 'fair' : 'weak';
}

export function Intelligence() {
  const game = useGameUpdates(500);
  const w = game.world.stats.war;
  const i = w?.intel ?? null;
  const rivals = game.world.stats.region.neighbours.filter((n) => n.rival || n.player);
  const [to, setTo] = useState<number | null>(rivals[0]?.id ?? null);
  const [op, setOp] = useState<SpyOp>('reveal');
  const [target, setTarget] = useState<SabotageTarget>('power');
  const [branch, setBranch] = useState<Branch>('land');
  const [why, setWhy] = useState<string | null>(null);
  const [breaks, setBreaks] = useState<{ text: string; cmd: SpyCmd; form: string } | null>(null);
  if (!w || !i) return null;
  const agency = [...game.world.civics.values()].some((c) => c.def === 'spyagency');
  if (!agency) {
    return (
      <p data-testid="intel-none">
        Spies need a spy agency, which needs Spy agency research (Intelligence branch). Without one the city
        still has a little counter-intelligence ({i.counter} in a thousand of a spy being caught, before the
        odds).
      </p>
    );
  }
  const n = rivals.find((x) => x.id === to) ?? rivals[0];
  const form = JSON.stringify([n?.id, op, target, branch]);
  // A friend's odds as the region room works them out (M37, step 9): the city's Intelligence tiers
  // against the counter-intelligence in the friend's last report.
  const intelTier = (w.research?.done ?? []).filter((k) => k.startsWith('intel')).length;
  const friend = n?.player;
  const odds = n
    ? friend
      ? spyOdds(op, intelTier, friend.counter ?? 0, false, intelTier >= 3)
      : i.rivals[n.id]?.odds[op]
    : undefined;
  const counter = friend ? (friend.counter ?? 0) : n ? i.rivals[n.id]?.counter : undefined;
  const def = SPY_OP[op];
  const send = async (asked?: NonNullable<typeof breaks>) => {
    if (!n) return;
    const cmd: SpyCmd = asked
      ? { ...asked.cmd, breakPact: true }
      : {
          type: 'spyMission',
          neighbour: n.id,
          op,
          ...(op === 'sabotage' ? { target } : {}),
          ...(op === 'steal' ? { branch } : {}),
        };
    const r = await game.dispatch(cmd);
    if (!r.ok && r.info?.breaks) {
      setBreaks({ text: r.reason, cmd, form });
      return;
    }
    setBreaks(null);
    setWhy(r.ok ? null : r.reason);
    if (r.ok) {
      game.audio?.play('place');
      game.toast(`An agent is on the way to ${n.name}`, 'ok', 2500);
    }
  };
  const name = (id: number) =>
    game.world.stats.region.neighbours.find((x) => x.id === id)?.name ?? 'a neighbour';
  return (
    <>
      <dl class="war-dl" data-testid="intel-agency">
        <dt>Agents</dt>
        <dd data-testid="intel-agents">
          {i.free} of {i.agents} free
        </dd>
        <dt>Counter-intelligence</dt>
        <dd data-testid="intel-counter">
          {counterWord(i.counter)} ({formatNumber(i.counter)} ‰)
        </dd>
      </dl>
      <p class="muted">
        Counter-intelligence catches neighbours’ spies: a staffed, powered spy agency and the Intelligence
        branch’s research raise it, and war with a neighbour raises it against that one.
      </p>
      {rivals.length > 0 && n && (
        <section class="dip-builder" data-testid="intel-send">
          <label>
            Send an agent to{' '}
            <select
              data-testid="intel-to"
              value={n.id}
              onChange={(e) => setTo(Number((e.target as HTMLSelectElement).value))}
            >
              {rivals.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <div class="segmented" role="radiogroup" data-testid="intel-op">
            {SPY_OPS.map((o) => (
              <button
                key={o}
                class={`btn small ${op === o ? 'active' : ''}`}
                aria-pressed={op === o}
                data-testid={`intel-op-${o}`}
                disabled={!i.ops[o]}
                title={i.ops[o] ? undefined : 'Needs its research'}
                onClick={() => setOp(o)}
              >
                {SPY_OP[o].name}
              </button>
            ))}
          </div>
          {op === 'sabotage' && (
            <label>
              Sabotage its{' '}
              <select
                data-testid="intel-target"
                value={target}
                onChange={(e) => setTarget((e.target as HTMLSelectElement).value as SabotageTarget)}
              >
                <option value="power">power</option>
                <option value="depot">vehicle depot</option>
              </select>
            </label>
          )}
          {op === 'steal' && (
            <label>
              Steal its{' '}
              <select
                data-testid="intel-branch"
                value={branch}
                onChange={(e) => setBranch((e.target as HTMLSelectElement).value as Branch)}
              >
                {BRANCHES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name.toLowerCase()}
                  </option>
                ))}
              </select>{' '}
              research
            </label>
          )}
          <p class="muted" data-testid="intel-odds">
            {formatMoney(def.cost)} · {warHours(def.hours)} there and back.{' '}
            {odds && counter !== undefined
              ? `${inWords(odds.success)[0]!.toUpperCase()}${inWords(odds.success).slice(1)} to succeed (${odds.success} ‰), ${inWords(odds.caught)} to be caught (${odds.caught} ‰): ${n.name}’s counter-intelligence is ${counterWord(counter)}.${friend ? ' The region rolls the dice when the agent gets there.' : ''}`
              : 'The region decides how a mission to a friend’s city goes.'}
          </p>
          {why && (
            <p class="dip-why" data-testid="intel-why">
              {why}
            </p>
          )}
          {breaks?.form === form && (
            <div class="dip-confirm" role="alertdialog" data-testid="intel-breaks">
              <p>{breaks.text}. Your reputation will suffer, and its allies will turn against the city.</p>
              <div class="dip-actions">
                <button class="btn danger" data-testid="intel-breaks-yes" onClick={() => void send(breaks)}>
                  Send the agent anyway
                </button>
                <button class="btn" onClick={() => setBreaks(null)}>
                  Keep the city’s word
                </button>
              </div>
            </div>
          )}
          <button
            class="btn primary"
            data-testid="intel-send-go"
            disabled={game.readOnly || i.free <= 0}
            title={i.free <= 0 ? 'Every agent is out' : undefined}
            onClick={() => void send()}
          >
            Send the agent
          </button>
        </section>
      )}
      {i.missions.length > 0 && (
        <section data-testid="intel-missions">
          <h4>Agents out</h4>
          {i.missions.map((m) => (
            <p key={m.id} class="war-row" data-testid={`mission-${m.id}`}>
              <span>
                Agent {m.agent}: {SPY_OP[m.op].name.toLowerCase()} in {m.name}
              </span>
              <span class="muted">
                {m.state === 'out'
                  ? `arrives in ${warHours(m.arrive - i.clock)}`
                  : m.state === 'arrived'
                    ? 'there, waiting for the region’s word'
                    : `${m.outcome === 'success' ? 'done' : 'came away empty'}, home in ${warHours(m.home - i.clock)}`}
              </span>
            </p>
          ))}
        </section>
      )}
      {i.revealed.length > 0 && (
        <section data-testid="intel-revealed">
          <h4>Revealed</h4>
          {i.revealed.map((id) => {
            const r = game.world.stats.region.neighbours.find((x) => x.id === id)?.rival;
            const left = i.revealedLeft[id] ?? 0;
            return (
              <div key={id} class="dip-neighbour" data-testid={`dossier-${id}`}>
                <p>
                  <strong>{name(id)}</strong>{' '}
                  <small class="muted">
                    revealed {warHours(INTEL.revealHours - left)} ago, good for {warHours(left)} more
                  </small>
                </p>
                {r && (
                  <p class="muted">
                    Forces {Math.round(r.forces)} · defences {Math.round(r.defences)} · weapons tech{' '}
                    {r.tech ?? 0} of 4. Forces there fight readier, and its raids are seen sooner.
                  </p>
                )}
              </div>
            );
          })}
        </section>
      )}
      {Object.keys(i.seen ?? {}).length > 0 && (
        <section data-testid="intel-seen">
          <h4>Friends looked round</h4>
          {Object.entries(i.seen).map(([slot, d]) => {
            const units = Object.entries(d.forces).filter(([, k]) => (k ?? 0) > 0);
            const defences = Object.entries(d.defences).filter(([, k]) => k > 0);
            return (
              <div key={slot} class="dip-neighbour" data-testid={`seen-${slot}`}>
                <p>
                  <strong>
                    {game.world.stats.region.neighbours.find((x) => x.player?.slot === Number(slot))?.name ??
                      'A friend'}
                  </strong>{' '}
                  <small class="muted">good for {warHours(d.until - i.clock)} more</small>
                </p>
                <p class="muted">
                  Forces:{' '}
                  {units.length
                    ? units
                        .map(([k, v]) => `${v} ${UNIT.get(k as UnitKind)?.name.toLowerCase() ?? k}`)
                        .join(', ')
                    : 'none'}
                  . Defences:{' '}
                  {defences.length
                    ? defences.map(([k, v]) => `${v} ${CIVIC.get(k)?.name.toLowerCase() ?? k}`).join(', ')
                    : 'none'}
                  .
                </p>
                <p class="muted">
                  Research:{' '}
                  {BRANCHES.map((b, k) => `${b.name.toLowerCase()} ${d.tiers[k] ?? 0}/4`).join(' · ')}
                  {d.supers.length ? ` · superweapons: ${d.supers.map(superName).join(', ')}` : ''}
                  {d.dome !== undefined ? ` · dome ${Math.floor(d.dome * 100)} % charged` : ''}
                </p>
              </div>
            );
          })}
        </section>
      )}
      {i.results.length > 0 && (
        <section data-testid="intel-log">
          <h4>What the agents found</h4>
          <ul class="dip-log">
            {[...i.results].reverse().map((r, k) => (
              <li key={k} class={r.tone ? `dip-${r.tone}` : ''}>
                {r.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
