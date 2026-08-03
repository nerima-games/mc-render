/**
 * The water surface's GLSL, GENERATED from `./water-surface.ts`'s constants.
 *
 * Same discipline as `./chunk-shader.ts` and for the same reason, which that
 * file's header states and this one will not restate: every number that appears
 * in the emitted source is interpolated from the declaration the CPU path also
 * reads, so the two cannot disagree. Read that header first.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS BEING WRITTEN NOW, WHICH IS AN ANSWER ABOUT PROCESS
 * ---------------------------------------------------------------------------
 *
 * `./water-surface.ts` has declared `WATER_UNIFORM_NAMES` since it landed, and
 * its comment says the list exists 「for an adapter to assert its own set
 * against」. THERE WAS NO ADAPTER. The only consumer was
 * `test/water-surface.test.ts`, which asserted the list equalled a second copy
 * of the same six strings written out by hand — a test that cannot fail for any
 * reason a reader would care about, and simultaneously an instance of the two
 * defects this project's notes count separately (a green that asks nothing, and
 * a hand-written list duplicating another).
 *
 * The same shape had just been found one file over: `./chunk-shader.ts`
 * declared `attribute float tileIndex` and `./chunk-geometry.ts` produced no
 * such buffer, and both suites were green because each checked its own half.
 * A declaration with no counterpart is not a partial implementation — it is a
 * claim nobody is positioned to falsify.
 *
 * So `waterShaderSource()` below derives its uniform list from
 * `WATER_UNIFORM_NAMES` rather than declaring six of its own, and
 * `test/water-shader.test.ts` checks the EMITTED SOURCE declares exactly those
 * — which is a question about this file, answerable, and currently answered
 * yes.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS NOT HERE
 * ---------------------------------------------------------------------------
 *
 * NO GLSL IS COMPILED IN THIS REPOSITORY. There is no GL context in Node and
 * docs/testing.md §1 says to name what needs a browser rather than to give it a
 * weaker test that resembles coverage. mc-compose's Playwright run is where
 * this source is actually compiled, and a shader that fails to link there takes
 * the canvas with it, so that check is real and this one is not a substitute
 * for it.
 *
 * NO REFRACTION MAP IS RENDERED. `uRefractionMap` is bound by whoever owns the
 * render target, and `uRefractionValid` exists precisely because the honest
 * answer on the first frame — and on any frame where the target has not been
 * filled — is "there is no refraction to sample". The fragment stage branches
 * on it and falls back to the tint alone. A shader that sampled an unfilled
 * target would show the water as a mirror of whatever memory happened to hold,
 * which is the kind of failure that looks like a driver bug.
 */
import {
  BHASKARA_LINEAR,
  BHASKARA_QUADRATIC,
  RIPPLE_AMPLITUDE_UV,
  RIPPLE_LAYERS_U,
  RIPPLE_LAYERS_V,
  TWO_PI,
  WATER_DEEP_COLOR,
  WATER_DEPTH_FACTOR_FLOOR,
  WATER_DEPTH_FACTOR_RANGE,
  WATER_FRESNEL_F0,
  WATER_SHALLOW_COLOR,
  WATER_SUN_FLOOR,
  WATER_SUN_RANGE,
  WATER_SURFACE_ALPHA,
  WATER_UNIFORM_NAMES,
  type RippleLayer,
  type WaterColor,
} from './water-surface'
import { glslFloat } from './chunk-shader'

/**
 * A `WaterColor` as a GLSL `vec4` literal.
 *
 * Alpha included rather than dropped: `WATER_SHALLOW_COLOR` and
 * `WATER_DEEP_COLOR` carry different alphas (0.84 and 0.92) and the mix between
 * them is what `WATER_SURFACE_ALPHA` then overrides. Emitting `vec3` here would
 * make that override look like the only alpha in the file and hide that the
 * palette has an opinion which is being discarded — `WATER_SURFACE_ALPHA`'s own
 * comment is about exactly that surprise.
 */
export const glslVec4 = (color: WaterColor): string =>
  `vec4(${glslFloat(color.r)}, ${glslFloat(color.g)}, ${glslFloat(color.b)}, ${glslFloat(color.a)})`

/**
 * One ripple layer as a GLSL term.
 *
 * `driver` is the world coordinate this axis is driven by, and it is the
 * CROSSOVER that `rippleOffset`'s comment defends: U is driven by world Z and V
 * by world X. Passing it in rather than deriving it here keeps the crossover
 * stated once, at the call site, where it can be read against that comment.
 */
const rippleTerm = (layer: RippleLayer, driver: string, wave: string): string =>
  `${wave}(${driver} * ${glslFloat(layer.spatialFrequency)} + uTime * ${glslFloat(layer.temporalSpeed)}) * ${glslFloat(RIPPLE_AMPLITUDE_UV * layer.amplitudeScale)}`

/** The layers of one axis, summed. */
const rippleAxis = (layers: ReadonlyArray<RippleLayer>, driver: string, wave: string): string =>
  layers.map((layer) => rippleTerm(layer, driver, wave)).join('\n    + ')

/**
 * The vertex stage: hand the fragment stage a world position and a screen UV.
 *
 * `vScreenUv` is computed from `gl_Position` rather than passed in, because the
 * refraction map is a full-screen target and the fragment's coordinate in it is
 * its own clip position — there is no attribute that could carry it. The
 * `* 0.5 + 0.5` is the NDC-to-UV remap, and it is applied AFTER the perspective
 * divide in the fragment stage rather than here: interpolating a pre-divided UV
 * across a large quad is affine and the distortion would visibly shear on
 * water seen at a glancing angle, which is the angle water is usually seen at.
 */
export const waterVertexShader = (): string => `
varying vec3 vWorldPosition;
varying vec4 vClipPosition;
varying vec3 vNormal;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  vNormal = normalize(normalMatrix * normal);

  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  vClipPosition = gl_Position;
}
`

/**
 * The fragment stage: ripple the screen UV, sample the refraction, tint by
 * Fresnel, attenuate by the sun.
 *
 * `waveApprox` is emitted as a GLSL function rather than inlined four times,
 * and its body is the same reduction `./water-surface.ts` documents at length —
 * into `[0, 2π)` and then CENTRED into `[-π, π)`, not into `[0, 2π)` and
 * shifted. That distinction is the one that makes the reference's version
 * compute `-sin`, and it is worth having the two implementations look alike so
 * that a reader comparing them is comparing shapes rather than deriving
 * algebra. GLSL's `mod` already returns a non-negative result for a positive
 * modulus, so the `((a % n) + n) % n` dance the TypeScript needs has no
 * counterpart here — which is itself the reason the TypeScript needs a comment
 * and this does not.
 *
 * `gl_FrontFacing` flips the normal because the water is `DoubleSide`
 * (`WATER_MATERIAL_SPEC`) and a player underwater sees the back of it. Without
 * the flip the Fresnel term is computed against a normal pointing away and the
 * surface reads as uniformly dark from below.
 */
export const waterFragmentShader = (): string => `
uniform float uTime;
uniform sampler2D uRefractionMap;
uniform vec3 uCameraPosition;
uniform vec2 uResolution;
uniform float uRefractionValid;
uniform float uSunIntensity;

varying vec3 vWorldPosition;
varying vec4 vClipPosition;
varying vec3 vNormal;

const vec4 SHALLOW = ${glslVec4(WATER_SHALLOW_COLOR)};
const vec4 DEEP = ${glslVec4(WATER_DEEP_COLOR)};

// Bhaskara's parabolic sine. Coefficients from water-surface.ts; see this
// file's header on why they are interpolated and not typed.
float waveApprox(float x) {
  float wrapped = mod(x, ${glslFloat(TWO_PI)});
  float centred = wrapped > ${glslFloat(TWO_PI / 2)}
    ? wrapped - ${glslFloat(TWO_PI)}
    : wrapped;
  return centred * (${glslFloat(BHASKARA_LINEAR)} - ${glslFloat(BHASKARA_QUADRATIC)} * abs(centred));
}

float waveApproxCos(float x) {
  return waveApprox(x + ${glslFloat(TWO_PI / 4)});
}

void main() {
  // DoubleSide: underwater, the geometry's own normal points away from us.
  vec3 normal = gl_FrontFacing ? normalize(vNormal) : -normalize(vNormal);
  vec3 viewDir = normalize(uCameraPosition - vWorldPosition);

  // Schlick, as the quintic f2*f2*base rather than pow() — the reference's
  // stated reason is avoiding a GPU transcendental, and water-surface.ts's
  // schlickFresnel is written the same way so the two read as one expression.
  float cosTheta = max(dot(viewDir, normal), 0.0);
  float base = 1.0 - cosTheta;
  float squared = base * base;
  float fresnel = ${glslFloat(WATER_FRESNEL_F0)}
    + (1.0 - ${glslFloat(WATER_FRESNEL_F0)}) * squared * squared * base;

  // Low Fresnel is the face-on, DEEP case. The direction inverts easily while
  // reading; water-surface.ts's waterDepthFactor carries the argument.
  float depthFactor = clamp(
    ${glslFloat(WATER_DEPTH_FACTOR_FLOOR)} + (1.0 - fresnel) * ${glslFloat(WATER_DEPTH_FACTOR_RANGE)},
    0.0,
    1.0
  );
  vec4 tint = mix(SHALLOW, DEEP, depthFactor);

  // The axis crossover is deliberate: U is driven by world Z and V by world X.
  // rippleOffset's comment in water-surface.ts defends it.
  float rippleU = ${rippleAxis(RIPPLE_LAYERS_U, 'vWorldPosition.z', 'waveApprox')};
  float rippleV = ${rippleAxis(RIPPLE_LAYERS_V, 'vWorldPosition.x', 'waveApproxCos')};

  // Perspective divide HERE, not in the vertex stage. See waterVertexShader.
  vec2 screenUv = (vClipPosition.xy / vClipPosition.w) * 0.5 + 0.5;
  vec2 distorted = clamp(screenUv + vec2(rippleU, rippleV), 0.0, 1.0);

  // uRefractionValid is 0 until something has actually drawn into the target.
  // Sampling it regardless would mirror uninitialised memory.
  vec3 refracted = texture2D(uRefractionMap, distorted).rgb;
  vec3 body = mix(tint.rgb, refracted * tint.rgb, uRefractionValid);

  // Floor of 0.30 at midnight, NOT zero: water that goes black is water the
  // player walks into. water-surface.ts's waterSunAttenuation owns the number.
  float sun = ${glslFloat(WATER_SUN_FLOOR)}
    + ${glslFloat(WATER_SUN_RANGE)} * clamp(uSunIntensity, 0.0, 1.0);

  gl_FragColor = vec4(body * sun, ${glslFloat(WATER_SURFACE_ALPHA)});
}
`

/** Everything needed to construct the water material, as one value. */
export type WaterShaderSource = {
  readonly vertexShader: string
  readonly fragmentShader: string
  readonly uniformNames: ReadonlyArray<string>
}

/**
 * The pair, plus the uniforms a host has to bind.
 *
 * `uniformNames` is `WATER_UNIFORM_NAMES` ITSELF and not a copy of it. That is
 * the whole point of this function existing rather than the two strings being
 * exported directly: a host that iterates it binds exactly what the source
 * declares, and `test/water-shader.test.ts` closes the loop from the other end
 * by parsing the emitted GLSL. Neither the list nor the source can move alone.
 */
export const waterShaderSource = (): WaterShaderSource => ({
  vertexShader: waterVertexShader(),
  fragmentShader: waterFragmentShader(),
  uniformNames: WATER_UNIFORM_NAMES,
})
