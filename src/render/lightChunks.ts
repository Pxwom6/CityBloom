import { ShaderChunk } from 'three';

/**
 * Light that bounces (phase 3, M26): sunlight thrown back off the ground and the walls opposite
 * lights the side of things away from the sun a little, tinted by the ground (green in summer,
 * white with snow). A patch to three.js's lighting for every lit material, before any compiles:
 * it reads only the sun and the hemisphere light the renderer already has, so no material needs
 * a uniform of its own.
 */

/** The end of the hemisphere lights' loop (whatever the whitespace: three's builds differ). */
const HEMI_LOOP =
  /irradiance\s*\+=\s*getHemisphereLightIrradiance\(\s*hemisphereLights\[\s*i\s*\]\s*,\s*geometryNormal\s*\);\s*\}\s*#pragma unroll_loop_end/;

const BOUNCE = `
		#if NUM_SUN_LIGHTS > 0
		{
			// From opposite the sun, a little above the horizon.
			vec3 upV = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
			vec3 sunV = sunLights[ 0 ].direction;
			vec3 across = sunV - upV * dot( sunV, upV );
			vec3 bounceDir = normalize( - across + upV * ( 0.35 * length( across ) + 0.05 ) );
			vec3 ground = hemisphereLights[ 0 ].groundColor;
			vec3 tint = ground / max( max( ground.r, ground.g ), max( ground.b, 1e-3 ) );
			irradiance += sunLights[ 0 ].color * tint * ( 0.09 * max( dot( geometryNormal, bounceDir ), 0.0 ) );
		}
		#endif
`;

if (!ShaderChunk.lights_fragment_begin.includes('bounceDir')) {
  const m = HEMI_LOOP.exec(ShaderChunk.lights_fragment_begin);
  if (!m) throw new Error('lightChunks: three.js lighting chunk has changed');
  ShaderChunk.lights_fragment_begin = ShaderChunk.lights_fragment_begin.replace(m[0], `${m[0]}\n${BOUNCE}\n`);
}

/**
 * Haze (M26): the distance softens gently before the fog closes in, the way a toy town's far
 * side fades a little into the sky (at most a fifth of the way, from a third of the fog's start).
 */
const FOG_LINEAR = /float fogFactor\s*=\s*smoothstep\(\s*fogNear\s*,\s*fogFar\s*,\s*vFogDepth\s*\);/;
if (!ShaderChunk.fog_fragment.includes('0.2 * smoothstep')) {
  const m = FOG_LINEAR.exec(ShaderChunk.fog_fragment);
  if (!m) throw new Error('lightChunks: three.js fog chunk has changed');
  ShaderChunk.fog_fragment = ShaderChunk.fog_fragment.replace(
    m[0],
    `${m[0]}\n\t\tfogFactor = max( fogFactor, 0.2 * smoothstep( fogNear * 0.3, fogFar, vFogDepth ) );`,
  );
}
