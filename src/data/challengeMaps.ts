/**
 * The weekly challenges' maps (M44), made by `npx tsx scripts/challengeMaps.ts`: seeds on which the
 * balance mayor grows a real town in three years, with Standard money and with the tight budget's.
 * The generator picks each week's map from these. Regenerate after changes that alter growth.
 */
import type { MapPreset } from './world';

export const CHALLENGE_MAPS: { seed: string; preset: MapPreset; budget?: true }[] = [
  { seed: 'cr0', preset: 'river' },
  { seed: 'cr3', preset: 'river' },
  { seed: 'cr7', preset: 'river' },
  { seed: 'cr8', preset: 'river' },
  { seed: 'cr9', preset: 'river' },
  { seed: 'cr15', preset: 'river' },
  { seed: 'cr19', preset: 'river' },
  { seed: 'cc6', preset: 'coast' },
  { seed: 'cc18', preset: 'coast' },
  { seed: 'cl1', preset: 'lakes' },
  { seed: 'cl13', preset: 'lakes' },
];
