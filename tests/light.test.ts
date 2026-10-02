import { ShaderChunk } from 'three';
import { describe, expect, it } from 'vitest';
import { QUALITY_PARAMS } from '../src/client/settings';
import '../src/render/lightChunks';

/** M26: the light patches and each effect's cost switch. */
describe('light and sky', () => {
  it("patches three.js's lighting with bounced light and its fog with a gentle haze", () => {
    // Patterns, not exact text: a new three.js with other whitespace still matches, and one
    // that changed these chunks fails here rather than drawing without the light.
    expect(ShaderChunk.lights_fragment_begin).toContain('bounceDir');
    expect(ShaderChunk.lights_fragment_begin.match(/bounceDir/g)!.length).toBeGreaterThan(1);
    expect(ShaderChunk.fog_fragment).toMatch(/fogFactor = max\( fogFactor, 0\.2 \* smoothstep/);
  });

  it('gives every new effect a cost switch: full at High, cheaper at Medium, off at Low', () => {
    const { low, medium, high } = QUALITY_PARAMS;
    expect(high.ao).toBeGreaterThan(medium.ao);
    expect(medium.ao).toBeGreaterThan(0);
    expect(low.ao).toBe(0);
    expect(high.aoBlur).toBe(true);
    expect(medium.aoBlur).toBe(false);
    expect([high.glow, medium.glow, low.glow]).toEqual([true, true, false]);
    expect([high.cascades, medium.cascades, low.cascades]).toEqual([2, 1, 1]);
  });
});
