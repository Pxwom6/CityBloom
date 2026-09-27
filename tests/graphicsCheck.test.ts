import { describe, expect, it } from 'vitest';
import { CHECK, GRAPHICS_PRESETS, GraphicsCheck, choosePreset } from '../src/client/graphicsCheck';
import { DEFAULT_SETTINGS, parseSettings } from '../src/client/settings';

/** Feed a check frames `ms` apart until it answers (or `limit` ms pass). */
function run(
  check: GraphicsCheck,
  ms: number | ((k: number) => number),
  limit = 20_000,
  visible = () => true,
) {
  let t = 1000;
  for (let k = 0; t < limit; k++) {
    const r = check.frame(t, visible());
    if (r) return { result: r, at: t };
    t += typeof ms === 'number' ? ms : ms(k);
  }
  return { result: null, at: t };
}

describe('first-launch graphics check (M15)', () => {
  it('picks a preset from the median frame time, the renderer and the cores', () => {
    expect(
      choosePreset(16.7, 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)', 8).preset,
    ).toBe('high');
    expect(choosePreset(30, 'Intel(R) UHD Graphics 620', 4)).toEqual({
      preset: 'medium',
      reason: 'about 33 fps',
    });
    expect(choosePreset(70, 'Intel(R) HD Graphics 4000', 4).preset).toBe('low');
    // Smooth menu, but only two cores for the simulation.
    expect(choosePreset(16.7, 'Mesa Intel(R) HD Graphics 520', 2)).toEqual({
      preset: 'medium',
      reason: '2 processor cores',
    });
    // Software renderers are always the light preset, however fast the menu happened to draw.
    for (const gpu of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'llvmpipe (LLVM 15.0.7, 256 bits)',
      'Microsoft Basic Render Driver',
    ])
      expect(choosePreset(10, gpu, 16)).toEqual({ preset: 'low', reason: 'software rendering' });
  });

  it('times frames after a warm-up and answers once', () => {
    const check = new GraphicsCheck('Apple M2', 8);
    // Shader compiles make the first frames slow; they must not count.
    const { result, at } = run(check, (k) => (k < 5 ? 300 : 16.7));
    expect(result).toMatchObject({ preset: 'high', gpu: 'Apple M2' });
    expect(result!.frameMs).toBeCloseTo(16.7, 1);
    expect(result!.frames).toBeGreaterThanOrEqual(CHECK.minFrames);
    expect(at - 1000).toBeGreaterThanOrEqual(CHECK.warmupMs + CHECK.measureMs);
    expect(at - 1000).toBeLessThan(CHECK.maxMs);
    expect(check.frame(at + 100, true)).toBeNull();
  });

  it('judges a very slow device by the deadline, and skips frames while the tab is hidden', () => {
    const slow = run(new GraphicsCheck('Intel(R) HD Graphics 3000', 4), 1400);
    expect(slow.result!.preset).toBe('low');
    expect(slow.at - 1000).toBeGreaterThanOrEqual(CHECK.maxMs);
    // Hidden for a while (frames throttled to 1 s): those gaps are ignored, not taken as slow frames.
    let k = 0;
    const hidden = () => !(k++ >= 60 && k < 70);
    const check = new GraphicsCheck('Radeon Pro 560X', 8);
    let t = 1000;
    let r = null;
    for (let n = 0; !r && n < 2000; n++) {
      const visible = hidden();
      r = check.frame(t, visible);
      t += visible ? 20 : 1000;
    }
    expect(r!.preset).toBe('high');
    expect(r!.frameMs).toBe(20);
  });

  it('keeps its answer in the settings, and old settings records load without one', () => {
    expect(DEFAULT_SETTINGS.graphicsChecked).toBe(false);
    expect(parseSettings({ quality: 'medium' })).toMatchObject({
      graphicsChecked: false,
      autoGraphics: null,
    });
    expect(parseSettings({ graphicsChecked: true, autoGraphics: 'low' })).toMatchObject({
      graphicsChecked: true,
      autoGraphics: 'low',
    });
    expect(parseSettings({ autoGraphics: 'ultra' }).autoGraphics).toBeNull();
    expect(GRAPHICS_PRESETS.low).toEqual({ quality: 'low', shadows: false, drawDistance: 'near' });
  });
});
