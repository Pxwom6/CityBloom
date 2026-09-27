import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { ELECTIONS } from '../src/data/elections';
import { Sim } from '../src/sim/sim';
import { campaignOpen, monthsToVote, projectedShare } from '../src/sim/systems/elections';
import { dateOf, TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, newSim, serveTown } from './helpers';

/** A served town whose next vote is `months` months away (instead of four years). */
function townBeforeVote(months: number, seed = 'vote') {
  const sim = newSim({ seed });
  buildTown(sim);
  serveTown(sim);
  sim.advance(3 * TICKS_PER_MONTH);
  sim.state.election.nextMonth = dateOf(sim.state.tick).totalMonths + months;
  return sim;
}

/** Run to the tick before the vote, set approval, and hold the vote. */
function vote(sim: Sim, approval: number) {
  const target = (sim.state.election.nextMonth * TICKS_PER_MONTH - 7 * 60) as number;
  sim.advance(target - sim.state.tick - 1);
  sim.state.totals.approval = approval;
  sim.advance(2);
  return sim.state.election.results[sim.state.election.results.length - 1]!;
}

describe('elections (M17)', () => {
  it('come every four years, with a six-month campaign; none in sandbox or when switched off', () => {
    const sim = newSim({ seed: 'e1' });
    expect(sim.state.election.nextMonth).toBe(48);
    expect(campaignOpen(sim)).toBe(false);
    expect(monthsToVote(sim)).toBeCloseTo(48 - 7 / 24, 6);
    expect(sim.dispatch({ type: 'promise', promise: 'jobs', on: true })).toMatchObject({ ok: false });
    expect(newSim({ seed: 'e2', sandbox: true }).state.election.nextMonth).toBe(-1);
    const off = newSim({ seed: 'e3', elections: false });
    expect(off.state.election.nextMonth).toBe(-1);
    expect(off.dispatch({ type: 'promise', promise: 'jobs', on: true })).toMatchObject({
      ok: false,
      reason: 'This city has no elections',
    });
  });

  it('take up to two promises during the campaign, judged against where the city stood', () => {
    const sim = townBeforeVote(4);
    expect(campaignOpen(sim)).toBe(true);
    expect(sim.dispatch({ type: 'promise', promise: 'taxes', on: true }).ok).toBe(true);
    expect(sim.dispatch({ type: 'promise', promise: 'hospital', on: true }).ok).toBe(true);
    expect(sim.dispatch({ type: 'promise', promise: 'jobs', on: true })).toMatchObject({ ok: false });
    expect(sim.state.election.promises.map((p) => p.id)).toEqual(['taxes', 'hospital']);
    // Withdrawn and replaced.
    expect(sim.dispatch({ type: 'promise', promise: 'hospital', on: false }).ok).toBe(true);
    expect(sim.dispatch({ type: 'promise', promise: 'jobs', on: true }).ok).toBe(true);
    // Raising a tax breaks the tax promise: the projected share drops by the broken-promise cost.
    const kept = projectedShare(sim);
    sim.dispatch({ type: 'setTax', zone: 'R', wealth: 0, rate: sim.state.economy.taxes.R[0]! + 1 });
    expect(projectedShare(sim)).toBeCloseTo(kept - ELECTIONS.kept + ELECTIONS.broken, 3);
  });

  it('a win brings the region’s grant and a year’s goodwill, and the next vote four years on', () => {
    const sim = townBeforeVote(3, 'vote2');
    const month = sim.state.election.nextMonth;
    sim.dispatch({ type: 'promise', promise: 'taxes', on: true });
    const before = sim.state.treasury;
    const r = vote(sim, 0.75);
    expect(r.won).toBe(true);
    expect(r.share).toBeGreaterThan(0.6);
    expect(r.promises).toEqual([{ id: 'taxes', kept: true }]);
    expect(sim.state.election.nextMonth).toBe(month + 48);
    expect(sim.state.election.promises).toEqual([]);
    expect(sim.state.economy.month.grants).toBeGreaterThan(0);
    expect(sim.state.treasury).toBeGreaterThan(before);
    expect(sim.state.election.term).toMatchObject({ won: true });
    expect(sim.state.chronicle.events.some((e) => e.kind === 'election' && e.ref === 'won')).toBe(true);
  });

  it('a loss never ends the game, but the council blocks tax rises and new loans for a year', () => {
    const sim = townBeforeVote(2, 'vote3');
    const r = vote(sim, 0.3);
    expect(r.won).toBe(false);
    expect(sim.state.economy.bankrupt).toBe(false);
    const rate = sim.state.economy.taxes.R[0]!;
    const up = sim.dispatch({ type: 'setTax', zone: 'R', wealth: 0, rate: rate + 1 });
    expect(up.ok).toBe(false);
    expect(up.ok ? '' : up.reason).toMatch(
      /council blocks tax rises until \w+, Year \d+, after the lost election/,
    );
    expect(sim.dispatch({ type: 'setTax', zone: 'R', wealth: 0, rate: rate - 1 }).ok).toBe(true);
    expect(sim.dispatch({ type: 'takeLoan', amount: 25_000 })).toMatchObject({ ok: false });
    // A year later the limits lift.
    sim.advance(ELECTIONS.term * TICKS_PER_MONTH + 10);
    expect(sim.dispatch({ type: 'setTax', zone: 'R', wealth: 0, rate: rate + 1 }).ok).toBe(true);
  });

  it('can be switched off and back on in a city; never in sandbox', () => {
    const sim = townBeforeVote(4, 'vote5');
    sim.dispatch({ type: 'promise', promise: 'jobs', on: true });
    expect(sim.dispatch({ type: 'setElections', on: false }).ok).toBe(true);
    expect(sim.state.election).toMatchObject({ nextMonth: -1, promises: [] });
    expect(sim.state.options.elections).toBe(false);
    sim.advance(6 * TICKS_PER_MONTH);
    expect(sim.state.election.results).toEqual([]);
    // Back on: the next four-year mark with a full campaign ahead.
    expect(sim.dispatch({ type: 'setElections', on: true }).ok).toBe(true);
    const month = dateOf(sim.state.tick).totalMonths;
    expect(sim.state.election.nextMonth % 48).toBe(0);
    expect(sim.state.election.nextMonth - month).toBeGreaterThan(ELECTIONS.campaign);
    expect(campaignOpen(sim)).toBe(false);
    const sandbox = newSim({ seed: 'e4', sandbox: true });
    expect(sandbox.dispatch({ type: 'setElections', on: true })).toMatchObject({ ok: false });
  });

  it('survive save and load, and older saves get elections from their next four-year mark', () => {
    const sim = townBeforeVote(3, 'vote4');
    sim.dispatch({ type: 'promise', promise: 'jobs', on: true });
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.hash()).toBe(sim.hash());
    sim.advance(4 * TICKS_PER_MONTH);
    loaded.advance(4 * TICKS_PER_MONTH);
    expect(loaded.state.election.results).toEqual(sim.state.election.results);
    expect(loaded.hash()).toBe(sim.hash());
    const old = Sim.fromSave(decodeSave(readFileSync('Saves/Ashton.citybloom')));
    const month = dateOf(old.state.tick).totalMonths;
    expect(old.state.options.elections).toBe(true);
    expect(old.state.election.nextMonth).toBeGreaterThan(month);
    expect(old.state.election.nextMonth % 48).toBe(0);
    expect(old.state.matchDay).toBeNull();
    old.testMode = true;
    old.advance(TICKS_PER_MONTH);
  });
});
