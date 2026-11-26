/**
 * How much memory a city takes, and how much a device may give it (M49). Phones close a tab that uses
 * too much memory (iPhones especially), so before a phone opens a city bigger than it can hold, the
 * game says so and asks. Measured in Playwright's phone emulation at the Phone preset (PROGRESS,
 * "Performance (M49)": the renderer's private memory plus the GPU's): a 21k city about 500 MB, the
 * 110k bench city about 920 MB, so about 400 MB and 5 MB a thousand residents.
 */
import type { DeviceKind } from './graphicsCheck';

export const MEMORY = {
  /** What any city takes (MB), and each thousand residents more. */
  baseMb: 400,
  perThousandMb: 5,
  /** A phone's budget (MB): one with 6 GB or more (where the browser says), and a tablet's. */
  phoneMb: 700,
  bigPhoneMb: 1200,
  tabletMb: 1400,
};

/** About what a city of this many residents takes (MB). */
export function cityMemoryMb(population: number): number {
  return MEMORY.baseMb + (MEMORY.perThousandMb * Math.max(0, population)) / 1000;
}

/** What this device may give a city (MB), or null for a computer (no warning). */
export function deviceBudgetMb(kind: DeviceKind, deviceMemoryGb?: number): number | null {
  if (kind === 'computer') return null;
  if (kind === 'tablet') return MEMORY.tabletMb;
  return deviceMemoryGb !== undefined && deviceMemoryGb >= 6 ? MEMORY.bigPhoneMb : MEMORY.phoneMb;
}

/** Is a city of this many residents too big for this device? */
export function tooBigFor(population: number, kind: DeviceKind, deviceMemoryGb?: number): boolean {
  const budget = deviceBudgetMb(kind, deviceMemoryGb);
  return budget !== null && cityMemoryMb(population) > budget;
}

/** The browser's guess at the device's memory (GB; Chrome on Android), if it gives one. */
export function deviceMemory(): number | undefined {
  const m = (typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : null)
    ?.deviceMemory;
  return typeof m === 'number' && m > 0 ? m : undefined;
}
