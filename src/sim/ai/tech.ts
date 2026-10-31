/**
 * Computer neighbours' weapons (M37, `docs/plans/M37-design.md` call 12). Their tech
 * (`RivalNeighbour.tech`, 0–4) moves on only once the city researches (`intelMonth`), and reaches
 * their battles here: their raiders' modifiers in a raid on the city, their defenders' in a battle in
 * their town, heavier units in their raids, and hardened buildings in their towns. With no tech they
 * have none of it, and their battles are as on M36.
 */
import { RIVAL_MIX } from '../../data/battle';
import { TIER, type TierKey } from '../../data/research';
import type { UnitDomain, UnitKind } from '../../data/war';
import { S, TAG, type BattleLayout, type BattleMods } from '../battle/types';
import type { RivalNeighbour } from '../systems/region';

/** The tiers whose battle modifiers a neighbour's tech brings: 1 at tech 1, 3 as well at tech 3. */
const TECH_TIERS: { at: number; keys: TierKey[] }[] = [
  { at: 1, keys: ['land1', 'air1', 'sea1'] },
  { at: 3, keys: ['land3', 'air3', 'sea3'] },
];

/** Heavy tanks and bombers join some characters' raids at tech 2. */
export const RIVAL_MIX_TECH: Record<string, Partial<Record<UnitKind, number>>> = {
  aggressive: { heavytank: 2 },
  honourable: { heavytank: 1, bomber: 1 },
  treacherous: { bomber: 2 },
};

/** A computer neighbour's battle modifiers from its tech (none below tech 1). */
export function rivalMods(rival: RivalNeighbour): BattleMods | undefined {
  const tech = rival.tech ?? 0;
  if (tech < 1) return undefined;
  const out: BattleMods = {};
  for (const step of TECH_TIERS) {
    if (tech < step.at) continue;
    for (const key of step.keys)
      for (const [d, m] of Object.entries(TIER.get(key)?.mods ?? {}) as [
        UnitDomain,
        NonNullable<BattleMods[UnitDomain]>,
      ][]) {
        const o = (out[d] ??= {});
        if (m.hp !== undefined) o.hp = (o.hp ?? 1) * m.hp;
        if (m.attack !== undefined) o.attack = (o.attack ?? 1) * m.attack;
        if (m.armour !== undefined) o.armour = (o.armour ?? 0) + m.armour;
        if (m.evade !== undefined) o.evade = (o.evade ?? 0) + m.evade;
      }
  }
  return Object.keys(out).length ? out : undefined;
}

/** What a computer neighbour's raids are made of: its character's mix, heavier from tech 2. */
export function rivalMix(rival: RivalNeighbour): Partial<Record<UnitKind, number>> {
  const base = RIVAL_MIX[rival.personality] ?? RIVAL_MIX.honourable!;
  if ((rival.tech ?? 0) < 2) return base;
  return { ...base, ...(RIVAL_MIX_TECH[rival.personality] ?? {}) };
}

/** From tech 3 a neighbour's buildings are hardened, as Hardened buildings makes the city's. */
export function rivalHardened(layout: BattleLayout, rival: RivalNeighbour): void {
  if ((rival.tech ?? 0) < 3) return;
  const hard = TIER.get('defence1')!.hardened!;
  for (let k = 0; k < layout.structs.length / S.stride; k++) {
    const civic = (layout.structs[k * S.stride + S.tags]! & TAG.civic) !== 0;
    const i = k * S.stride + S.hp;
    layout.structs[i] = Math.round(layout.structs[i]! * (civic ? hard.civic : hard.other));
  }
}
