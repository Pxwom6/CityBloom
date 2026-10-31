import { required, type BudgetReport } from './checks';
import { COVER_KEYS, type Cover } from './types';
import type { Soak } from './world';

/** What the soak found, as a record (the JSON the runner writes) and as the lines it prints. */
export interface SoakResult {
  ok: boolean;
  mode: string;
  seed: string;
  minutes: number;
  /** Room minutes actually played, drain included. */
  played: number;
  failures: { at: number; kind: string; text: string; times: number }[];
  coverage: Record<string, number>;
  coverageMissing: string[];
  battles: {
    live: number;
    agreed: number;
    explained: number;
    failed: number;
    unfinished: number;
    list: {
      id: string;
      attacker: string;
      defender: string;
      verdict: string;
      orders: number;
      helpers: string[];
    }[];
  };
  applications: { liveTakenByDefender: number; reported: number; standIns: number };
  simEvents: Record<string, number>;
  regionHistory: Record<string, number>;
  budget: BudgetReport;
  misses: string[];
  behind: number;
}

export function result(w: Soak): SoakResult {
  const c = w.checks;
  const need = required(w.opts);
  const missing: string[] = [];
  for (const [k, n] of need) if (w.cover[k] < n) missing.push(`${k} ${w.cover[k]} < ${n}`);
  for (const m of missing) w.fail('coverage', `the story did not cover ${m}`);
  const battles = [...c.battles.values()];
  const budget = c.budget();
  // The plan is judged on runs long enough to have a rate: a few minutes include the start-up rows.
  if (!budget.ok && w.opts.minutes >= 30)
    w.fail(
      'budget',
      `an evening of this play would use more of the free plan than allowed (see the budget lines)`,
    );
  const history: Record<string, number> = {};
  for (const e of c.history.values()) history[e.kind] = (history[e.kind] ?? 0) + 1;
  const events: Record<string, number> = {};
  for (const [k, n] of [...c.simEvents].sort((a, b) => b[1] - a[1]).slice(0, 25)) events[k] = n;
  return {
    ok: w.failures.length === 0,
    mode: w.opts.mode,
    seed: w.opts.seed,
    minutes: w.opts.minutes,
    played: (w.now() - w.start) / 60_000,
    failures: w.failures.map((f) => ({ ...f })),
    coverage: Object.fromEntries(COVER_KEYS.map((k) => [k, w.cover[k]])),
    coverageMissing: missing,
    battles: {
      live: battles.length,
      agreed: battles.filter((b) => b.judged?.ok && !b.judged.explained).length,
      explained: battles.filter((b) => b.judged?.ok && b.judged.explained).length,
      failed: battles.filter((b) => b.judged && !b.judged.ok).length,
      unfinished: battles.filter((b) => !b.judged).length,
      list: battles.map((b) => ({
        id: b.id,
        attacker: b.attackerName,
        defender: b.defenderName,
        verdict: b.judged
          ? b.judged.ok
            ? (b.judged.explained ?? 'agreed')
            : `FAILED: ${b.judged.problem}`
          : 'not judged',
        orders: b.orders.attacker + b.orders.defender,
        helpers: b.helpedBy,
      })),
    },
    applications: {
      standIns: c.standIns,
      liveTakenByDefender: battles.filter((b) => c.taken.has(`${b.defenderName}:${b.id}`)).length,
      reported: battles.filter((b) => {
        const n = Number(/-(\d+)$/.exec(b.id)?.[1] ?? -1);
        return c.reported.has(`${b.attackerName}:${n}`);
      }).length,
    },
    simEvents: events,
    regionHistory: history,
    budget,
    misses: w.misses,
    behind: w.behind,
  };
}

export function lines(r: SoakResult, w: Soak): string[] {
  const out: string[] = [];
  const cov = (k: Cover) => `${k} ${r.coverage[k]}`;
  out.push('', `=== soak (${r.mode}, seed ${r.seed}): ${r.ok ? 'PASSED' : 'FAILED'} ===`);
  out.push(
    `played ${r.played.toFixed(1)} min of room time (asked for ${r.minutes}); ${r.behind ? `the machine fell behind the game's pace ${r.behind} times` : 'the cities kept their pace'}`,
  );
  out.push(
    `covered: ${(['raids', 'raidsRefused', 'recalled', 'liveBattles', 'oldBattles', 'orders', 'handovers', 'helpSent', 'helpBooked'] as Cover[]).map(cov).join(', ')}`,
    `         ${(['declared', 'warsOpened', 'proposals', 'declined', 'treaties', 'pacts', 'capitulations', 'conquests', 'vassalDues', 'freed'] as Cover[]).map(cov).join(', ')}`,
    `         ${(['drops', 'outages', 'reloads', 'leaves'] as Cover[]).map(cov).join(', ')}`,
  );
  if (r.coverageMissing.length) out.push(`NOT COVERED: ${r.coverageMissing.join('; ')}`);
  const b = r.battles;
  out.push(
    `live battles: ${b.live} (${b.agreed} agreed, ${b.explained} explained, ${b.failed} failed, ${b.unfinished} not judged); taken once by their defenders ${r.applications.liveTakenByDefender}, reported by their attackers ${r.applications.reported}; ${r.applications.standIns} records stood in for a battle the city was hosting`,
  );
  for (const x of b.list)
    out.push(
      `  ${x.id}: ${x.attacker} -> ${x.defender}, ${x.orders} orders${x.helpers.length ? `, help from ${x.helpers.join(', ')}` : ''}: ${x.verdict}`,
    );
  out.push(
    `region history: ${
      Object.entries(r.regionHistory)
        .map(([k, n]) => `${k} ${n}`)
        .join(', ') || 'none'
    }`,
  );
  out.push(
    `sim events: ${Object.entries(r.simEvents)
      .slice(0, 12)
      .map(([k, n]) => `${k} ${n}`)
      .join(', ')}`,
  );
  out.push(
    ...r.budget.lines.map((l) => `budget: ${l}`),
    `budget: ${r.budget.ok ? 'within the free plan' : 'OVER the allowance chosen for an evening'}`,
  );
  if (r.misses.length)
    out.push(`story misses (${r.misses.length}):`, ...r.misses.slice(0, 20).map((m) => `  ${m}`));
  if (r.failures.length) {
    out.push(`FAILURES (${r.failures.length}):`);
    for (const f of r.failures)
      out.push(`  [${Math.round(f.at / 1000)} s] ${f.kind}${f.times > 1 ? ` x${f.times}` : ''}: ${f.text}`);
  } else out.push('no failures');
  void w;
  return out;
}
