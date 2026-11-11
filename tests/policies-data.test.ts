import { describe, expect, it } from 'vitest';
import { POLICIES, POLICY, POLICY_EFFECTS, policyCost } from '../src/data/policies';
import { MILESTONES } from '../src/data/progression';

describe('policy data', () => {
  it('has unique ids', () => {
    expect(POLICIES).not.toEqual([]);
    const ids = new Set(POLICIES.map((p) => p.id));
    expect(ids.size).toEqual(POLICIES.length);
    expect(POLICY.size).toEqual(POLICIES.length);
  });

  it('names and describes every policy', () => {
    for (const p of POLICIES) {
      expect(p.name.trim(), p.id).not.toEqual('');
      expect(p.effect.trim(), p.id).not.toEqual('');
    }
  });

  it('unlocks every policy at a milestone', () => {
    const milestones = MILESTONES.map((m) => m.population);
    for (const p of POLICIES) {
      expect(milestones, p.id).toContain(p.unlockPopulation);
      expect(p.unlockPopulation, p.id).toBeGreaterThan(0);
    }
  });

  it('keeps costs in range', () => {
    for (const p of POLICIES) {
      expect(p.costBase, p.id).toBeGreaterThanOrEqual(0);
      expect(p.costBase, p.id).toBeLessThanOrEqual(1000);
      expect(p.costPerResident, p.id).toBeGreaterThanOrEqual(0);
      expect(p.costPerResident, p.id).toBeLessThanOrEqual(0.1);
      if (p.costBase === 0) {
        expect(p.costPerResident, p.id).toEqual(0);
      }
      expect(policyCost(p, 100_000), p.id).toBeLessThan(20_000);
    }
  });

  it('has a valid scope', () => {
    for (const p of POLICIES) {
      if (p.scope !== undefined) {
        expect(['city', 'district'], p.id).toContain(p.scope);
      }
    }
  });

  it('keeps effect strengths in range', () => {
    for (const [key, value] of Object.entries(POLICY_EFFECTS)) {
      if (key === 'freeTransitSeconds') {
        expect(value, key).toBeGreaterThan(0);
        expect(value, key).toBeLessThanOrEqual(900);
      } else {
        expect(POLICY.has(key as never), key).toBe(true);
        if (key === 'tourismCampaign') {
          expect(value, key).toBeGreaterThan(1);
          expect(value, key).toBeLessThanOrEqual(2);
        } else {
          expect(value, key).toBeGreaterThan(0);
          expect(value, key).toBeLessThan(1);
        }
      }
    }
  });
});
