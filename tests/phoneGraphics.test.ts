import { describe, expect, it } from 'vitest';
import { GRAPHICS_PRESETS, GraphicsCheck, choosePreset, deviceKind } from '../src/client/graphicsCheck';
import { DEFAULT_SETTINGS, QUALITIES, QUALITY_PARAMS, parseSettings } from '../src/client/settings';
import { STILL_FPS, frameCap, frameDue } from '../src/client/frameCap';

/** Playwright's device profiles' user agents, and a desktop's. */
const UA = {
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1',
  pixel:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  androidTablet:
    'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ipad: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

describe('phones (M49): the Phone preset and the first-launch check', () => {
  it('tells phones, tablets and computers apart', () => {
    const d = (ua: string, touchPoints: number, coarse: boolean, w: number, h: number) =>
      deviceKind({ ua, touchPoints, coarse, screenW: w, screenH: h });
    expect(d(UA.iphone, 5, true, 390, 844)).toBe('phone');
    expect(d(UA.pixel, 5, true, 412, 915)).toBe('phone');
    // Held sideways it is still a phone.
    expect(d(UA.pixel, 5, true, 915, 412)).toBe('phone');
    expect(d(UA.androidTablet, 10, true, 800, 1280)).toBe('tablet');
    // iPadOS says it is a Mac; its touch screen gives it away.
    expect(d(UA.ipad, 5, true, 1024, 1366)).toBe('tablet');
    expect(d(UA.mac, 0, false, 1512, 982)).toBe('computer');
    // A touch-screen laptop is still a computer; a small touch screen of no known kind is a phone.
    expect(d(UA.windows, 10, true, 1920, 1080)).toBe('computer');
    expect(d(UA.windows, 10, true, 360, 740)).toBe('phone');
  });

  it('starts a phone on Phone at once, and a tablet at most on Medium', () => {
    expect(choosePreset(5, 'Apple GPU', 6, 'phone')).toEqual({ preset: 'phone', reason: 'a phone' });
    expect(choosePreset(16, 'Apple GPU', 8, 'tablet').preset).toBe('medium');
    expect(choosePreset(30, 'Adreno (TM) 650', 8, 'tablet').preset).toBe('low');
    expect(choosePreset(60, 'Mali-G52', 8, 'tablet').preset).toBe('phone');
    // A phone needs no timing: its first frame answers.
    const check = new GraphicsCheck('Apple GPU', 6, 'phone');
    expect(check.frame(0, true)).toMatchObject({ preset: 'phone', device: 'phone', frames: 0 });
    expect(GRAPHICS_PRESETS.phone).toEqual({ quality: 'phone', shadows: false, drawDistance: 'near' });
  });

  it('keeps Phone below Low in every knob that costs', () => {
    expect(QUALITIES[0]).toBe('phone');
    const p = QUALITY_PARAMS.phone;
    const l = QUALITY_PARAMS.low;
    expect(p.maxPixels).toBeLessThan(l.maxPixels);
    expect(p.crowd).toBeLessThan(l.crowd);
    expect(p.trees).toBeLessThan(l.trees);
    expect(p.effects).toBeLessThan(l.effects);
    expect(p.shadowMap).toBeLessThanOrEqual(l.shadowMap);
    expect(p.samples).toBeLessThanOrEqual(l.samples);
    expect(p.water).toBe(0);
    expect([p.ao, p.glow, p.ground]).toEqual([0, false, 0]);
    expect(p.units.near).toBeLessThan(l.units.near);
    expect(p.units.far).toBeLessThan(l.units.far);
    expect(p.units.atomPuffs).toBeLessThan(l.units.atomPuffs);
    // The other presets draw every tree and effect, as before.
    for (const q of ['low', 'medium', 'high'] as const)
      expect([QUALITY_PARAMS[q].trees, QUALITY_PARAMS[q].effects, QUALITY_PARAMS[q].water]).toEqual([
        1, 1, 1,
      ]);
  });

  it('stores the frame cap and the battery saver, and old records load without them', () => {
    expect(DEFAULT_SETTINGS).toMatchObject({ fpsCap: 0, batterySaver: false });
    expect(parseSettings({})).toMatchObject({ fpsCap: 0, batterySaver: false });
    expect(parseSettings({ fpsCap: 30, batterySaver: true, quality: 'phone' })).toMatchObject({
      fpsCap: 30,
      batterySaver: true,
      quality: 'phone',
    });
    expect(parseSettings({ fpsCap: 45 }).fpsCap).toBe(0);
    expect(parseSettings({ autoGraphics: 'phone' }).autoGraphics).toBe('phone');
  });
});

describe('frames a second (M49)', () => {
  it('caps at the setting, 30 with the battery saver, and fewer while the scene is still', () => {
    expect(frameCap({ fpsCap: 0, batterySaver: false, still: false })).toBe(0);
    expect(frameCap({ fpsCap: 30, batterySaver: false, still: false })).toBe(30);
    expect(frameCap({ fpsCap: 0, batterySaver: true, still: false })).toBe(30);
    expect(frameCap({ fpsCap: 60, batterySaver: true, still: false })).toBe(30);
    expect(frameCap({ fpsCap: 0, batterySaver: false, still: true })).toBe(STILL_FPS.normal);
    expect(frameCap({ fpsCap: 30, batterySaver: true, still: true })).toBe(STILL_FPS.saver);
  });

  it('draws every other frame of a 60 Hz screen at 30, and every fourth of a 120 Hz one', () => {
    const drawn = (hz: number, cap: number, seconds = 2) => {
      let at = -Infinity;
      let n = 0;
      for (let k = 0; k < hz * seconds; k++) {
        // Screen frames arrive a millisecond early or late.
        const now = (k * 1000) / hz + (k % 3) - 1;
        if (frameDue(now, at, cap)) {
          at = now;
          n++;
        }
      }
      return n / seconds;
    };
    expect(drawn(60, 30)).toBe(30);
    expect(drawn(120, 30)).toBe(30);
    expect(drawn(120, 60)).toBe(60);
    expect(drawn(60, 0)).toBe(60);
    expect(drawn(60, 10)).toBe(10);
  });
});
