import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EXTRAS, firstDownload, sizeText } from '../scripts/vite-pwa';
import { MEMORY, cityMemoryMb, deviceBudgetMb, tooBigFor } from '../src/client/memoryBudget';
import { ALIVE_MAX_AGE_MS, clearAlive, markAlive, takeAlive } from '../src/client/alive';
import { saveAccept } from '../src/client/saves';
import { phoneLayout } from '../src/ui/layout';

/** A localStorage for Node. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe('phones (M49): the layout, memory, data and the closed-page marker', () => {
  it('lays a touch screen whose short side is under 600 px out as a phone, either way up', () => {
    expect(phoneLayout(390, 664, true)).toBe(true);
    expect(phoneLayout(844, 390, true)).toBe(true);
    expect(phoneLayout(820, 1180, true)).toBe(false);
    // A narrow desktop window with a mouse keeps the desktop layout.
    expect(phoneLayout(390, 800, false)).toBe(false);
  });

  it('warns a phone before a city too big for it, never a computer', () => {
    expect(cityMemoryMb(21_000)).toBeCloseTo(MEMORY.baseMb + 105, 0);
    // The measured cities: the 20k city fits a phone, the 110k bench city does not.
    expect(tooBigFor(21_134, 'phone')).toBe(false);
    expect(tooBigFor(110_174, 'phone')).toBe(true);
    // A phone with 8 GB, and a tablet, hold it; a computer is never warned.
    expect(tooBigFor(110_174, 'phone', 8)).toBe(false);
    expect(tooBigFor(110_174, 'tablet')).toBe(false);
    expect(tooBigFor(5_000_000, 'computer')).toBe(false);
    expect(deviceBudgetMb('computer')).toBeNull();
    expect(deviceBudgetMb('phone', 4)).toBe(MEMORY.phoneMb);
  });

  it('keeps the scenarios and lessons for when they are first opened, and counts the rest as the first download', () => {
    const files = [
      'index.html',
      'assets/main-abc12345.js',
      'scenarios/holdline.citybloom',
      'lessons/traffic.citybloom',
    ];
    expect(files.filter((f) => EXTRAS.some((re) => re.test(f)))).toEqual([
      'scenarios/holdline.citybloom',
      'lessons/traffic.citybloom',
    ]);
    const dir = mkdtempSync(join(tmpdir(), 'pwa-'));
    mkdirSync(join(dir, 'assets'));
    mkdirSync(join(dir, 'scenarios'));
    mkdirSync(join(dir, 'lessons'));
    const body = (n: number) => Buffer.from('x'.repeat(n));
    for (const f of files) writeFileSync(join(dir, f), body(f.startsWith('assets') ? 5000 : 3000));
    const core = ['index.html', 'assets/main-abc12345.js'].reduce(
      (a, f) => a + gzipSync(readFileSync(join(dir, f)), { level: 9 }).length,
      0,
    );
    expect(firstDownload(dir, files)).toBe(core);
    expect(sizeText(1_634_000)).toBe('1.6 MB');
    expect(sizeText(512_000)).toBe('512 KB');
  });

  it('lets an iPhone pick any file in Files (it greys out types it does not know)', () => {
    expect(saveAccept(true)).toBeUndefined();
    expect(saveAccept(false)).toContain('.citybloom');
  });

  describe('the closed-page marker', () => {
    beforeEach(() => {
      (globalThis as { localStorage?: Storage }).localStorage = fakeStorage();
    });
    afterEach(() => {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    });

    it('is found once after a page that closed while a city showed, and not after a proper close', () => {
      const now = 1_800_000_000_000;
      markAlive({ at: now - 60_000, build: 'b1', population: 12_345, quality: 'phone' });
      expect(takeAlive(now)).toEqual({ at: now - 60_000, build: 'b1', population: 12_345, quality: 'phone' });
      // Taken away as it was read.
      expect(takeAlive(now)).toBeNull();
      markAlive({ at: now, build: 'b1', population: 1, quality: 'low' });
      clearAlive();
      expect(takeAlive(now)).toBeNull();
      // Too old, or damaged: nothing.
      markAlive({ at: now - ALIVE_MAX_AGE_MS - 1, build: 'b1', population: 1, quality: 'low' });
      expect(takeAlive(now)).toBeNull();
      localStorage.setItem('citybloom.alive', '{not json');
      expect(takeAlive(now)).toBeNull();
    });
  });
});
