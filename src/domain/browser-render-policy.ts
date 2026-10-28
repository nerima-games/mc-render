import { Effect, Result, Schema } from 'effect'
import {
  type AdaptiveQualityChange,
  type AdaptiveQualityState,
  advanceAdaptiveQuality,
} from './adaptive-quality.js'
import {
  type GraphicsQuality,
  type PostProcessingPass,
  type PostProcessingStep,
  QUALITY_PRESETS,
  type QualityPreset,
  buildPostProcessingChain,
  qualityUsesHdrRenderTarget,
} from './post-processing.js'
import {
  type SsimAdaptiveQualityState,
  advanceSsimAdaptiveQuality,
} from './ssim-adaptive-quality.js'
import {
  refractionRunsOnFrame,
  normalizeRefractionMinScreenRatio,
  shouldRunRefractionRatioGate,
} from './water-refraction.js'

export type BrowserRenderPolicyError = {
  readonly _tag: 'BrowserRenderPolicyError'
  readonly operation:
    | 'runtime'
    | 'quality'
    | 'pixel-ratio'
    | 'god-ray-samples'
    | 'bloom-strength'
    | 'viewport'
    | 'drawing-buffer-size'
    | 'refraction-target-size'
    | 'similarity'
    | 'refraction'
  readonly reason:
    | 'invalid-input'
    | 'missing-value'
    | 'disposed'
    | 'not-finite'
    | 'out-of-range'
    | 'invalid-integer'
    | 'size-mismatch'
    | 'invalid-refraction-input'
}

type BrowserResultShape<Success, Failure> =
  | { readonly _tag: 'Success'; readonly _op: 'Success'; readonly success: Success }
  | { readonly _tag: 'Failure'; readonly _op: 'Failure'; readonly failure: Failure }

export const BrowserRenderPolicyErrorSchema: Schema.Codec<BrowserRenderPolicyError> = Schema.Struct({
  _tag: Schema.Literal('BrowserRenderPolicyError'),
  operation: Schema.Literals([
    'runtime',
    'quality',
    'pixel-ratio',
    'god-ray-samples',
    'bloom-strength',
    'viewport',
    'drawing-buffer-size',
    'refraction-target-size',
    'similarity',
    'refraction',
  ]),
  reason: Schema.Literals([
    'invalid-input',
    'missing-value',
    'disposed',
    'not-finite',
    'out-of-range',
    'invalid-integer',
    'size-mismatch',
    'invalid-refraction-input',
  ]),
})

const browserRenderPolicyError = (
  operation: BrowserRenderPolicyError['operation'],
  reason: BrowserRenderPolicyError['reason'],
): BrowserRenderPolicyError => ({ _tag: 'BrowserRenderPolicyError', operation, reason })

export const BrowserNumberResultSchema: Schema.Codec<BrowserResultShape<number, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Success'), _op: Schema.Literal('Success'), success: Schema.Finite }),
  Schema.Struct({ _tag: Schema.Literal('Failure'), _op: Schema.Literal('Failure'), failure: BrowserRenderPolicyErrorSchema }),
])

export const BrowserOptionalNumberResultSchema: Schema.Codec<BrowserResultShape<number | undefined, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Success'), _op: Schema.Literal('Success'), success: Schema.UndefinedOr(Schema.Finite) }),
  Schema.Struct({ _tag: Schema.Literal('Failure'), _op: Schema.Literal('Failure'), failure: BrowserRenderPolicyErrorSchema }),
])

export const BrowserBooleanResultSchema: Schema.Codec<BrowserResultShape<boolean, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Success'), _op: Schema.Literal('Success'), success: Schema.Boolean }),
  Schema.Struct({ _tag: Schema.Literal('Failure'), _op: Schema.Literal('Failure'), failure: BrowserRenderPolicyErrorSchema }),
])
export const BrowserVoidResultSchema: Schema.Codec<BrowserResultShape<void, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Success'), _op: Schema.Literal('Success'), success: Schema.Undefined }),
  Schema.Struct({ _tag: Schema.Literal('Failure'), _op: Schema.Literal('Failure'), failure: BrowserRenderPolicyErrorSchema }),
])
export const BrowserUnknownResultSchema: Schema.Codec<BrowserResultShape<unknown, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Success'), _op: Schema.Literal('Success'), success: Schema.Unknown }),
  Schema.Struct({ _tag: Schema.Literal('Failure'), _op: Schema.Literal('Failure'), failure: BrowserRenderPolicyErrorSchema }),
])

const GraphicsQualitySchema: Schema.Codec<GraphicsQuality> = Schema.Struct({
  composerRenderTarget: Schema.Literals(['ldr', 'hdr']),
  godRaysSamples: Schema.Finite,
  bloomStrength: Schema.Finite,
  refractionThrottleFrames: Schema.Finite,
  refractionMinScreenRatio: Schema.Finite,
  pixelRatioCap: Schema.Finite,
  ssaoEnabled: Schema.Boolean,
  godRaysEnabled: Schema.Boolean,
  bloomEnabled: Schema.Boolean,
  dofEnabled: Schema.Boolean,
  smaaEnabled: Schema.Boolean,
  useCompositePass: Schema.Boolean,
})
type BrowserRefractionCaptureInput = {
  readonly frameNumber: number
  readonly quality: GraphicsQuality
  readonly visibleWaterMeshCount: number
  readonly waterScreenRatio: number
}

const BrowserRefractionCaptureInputSchema: Schema.Codec<BrowserRefractionCaptureInput> = Schema.Struct({
  frameNumber: Schema.Finite,
  quality: GraphicsQualitySchema,
  visibleWaterMeshCount: Schema.Finite,
  waterScreenRatio: Schema.Finite,
})
type BrowserSsimInput = {
  readonly height: number
  readonly left: Uint8Array
  readonly right: Uint8Array
  readonly width: number
}

const BrowserSsimInputSchema: Schema.Codec<BrowserSsimInput> = Schema.Struct({
  height: Schema.Int,
  left: Schema.Uint8Array,
  right: Schema.Uint8Array,
  width: Schema.Int,
})

const DEFAULT_QUALITY_PRESET: QualityPreset = 'high'
const DEFAULT_MAX_PIXEL_RATIO = 2
const MIN_PIXEL_RATIO_CAP = 0.5
const POSITIVE_NUMBER_BOUNDARY = 0
const DEFAULT_DEVICE_PIXEL_RATIO = 1
const MIN_GOD_RAY_SAMPLES = 0
const MAX_GOD_RAY_SAMPLES = 40
const MIN_BLOOM_STRENGTH = 0
const MAX_BLOOM_STRENGTH = 1
const SSIM_WINDOW_SIZE = 8
const SSIM_LUMINANCE_RANGE = 255
const SSIM_K1 = 0.01
const SSIM_K2 = 0.03
const SSIM_RED_LUMINANCE_WEIGHT = 0.2126
const SSIM_GREEN_LUMINANCE_WEIGHT = 0.7152
const SSIM_BLUE_LUMINANCE_WEIGHT = 0.0722
const SSIM_VARIANCE_DIVISOR_FLOOR = 1
const SSIM_LUMINANCE_FACTOR = 2
const SSIM_COVARIANCE_FACTOR = 2
const SSIM_VARIANCE_POWER = 2
const RGBA_CHANNEL_COUNT = 4
const PIXEL_INDEX_INCREMENT = 1
const RED_CHANNEL_OFFSET = 0
const GREEN_CHANNEL_OFFSET = 1
const BLUE_CHANNEL_OFFSET = 2
const ZERO = 0
const NANOSECONDS_PER_MILLISECOND = 1_000_000
const MIN_VIEWPORT_SIZE = 1
const REFRACTION_AVAILABLE = 1
const REFRACTION_UNAVAILABLE = 0
const SCREENSHOT_SHORTCUT_CODE = 'F2'

export const BROWSER_RENDER_DEFAULTS = {
  bokehAperture: 0.00002,
  bokehFocus: 10,
  bokehMaxBlur: 0.01,
  godRaysDecay: 0.95,
  godRaysDensity: 0.7,
  godRaysExposure: 0.25,
  godRaysWeight: 0.12,
  lightPositionComponent: 0.5,
}

export type BrowserVector2Factory<Vector2> = (x: number, y: number) => Vector2

const makeBrowserVector2 = <Vector2>(
  factory: BrowserVector2Factory<Vector2>,
  x: number,
  y: number,
): Result.Result<Vector2, BrowserRenderPolicyError> => Result.try({
  try: () => factory(x, y),
  catch: () => browserRenderPolicyError('runtime', 'invalid-input'),
})

const isBrowserVector2Factory = (value: unknown): value is BrowserVector2Factory<unknown> =>
  typeof value === 'function'

const validateBrowserGodRaySamples = (value: unknown): Result.Result<number, BrowserRenderPolicyError> => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Result.fail(browserRenderPolicyError('god-ray-samples', 'not-finite'))
  }
  if (!Number.isInteger(value)) {
    return Result.fail(browserRenderPolicyError('god-ray-samples', 'invalid-integer'))
  }
  if (value < MIN_GOD_RAY_SAMPLES || value > MAX_GOD_RAY_SAMPLES) {
    return Result.fail(browserRenderPolicyError('god-ray-samples', 'out-of-range'))
  }
  return Result.succeed(value)
}

const validateBrowserBloomStrength = (value: unknown): Result.Result<number, BrowserRenderPolicyError> => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Result.fail(browserRenderPolicyError('bloom-strength', 'not-finite'))
  }
  if (value < MIN_BLOOM_STRENGTH || value > MAX_BLOOM_STRENGTH) {
    return Result.fail(browserRenderPolicyError('bloom-strength', 'out-of-range'))
  }
  return Result.succeed(value)
}

export type BrowserScreenshotShortcutInput = {
  readonly code: string
  readonly repeat: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

export const BrowserScreenshotShortcutInputSchema: Schema.Codec<BrowserScreenshotShortcutInput> = Schema.Struct({
  code: Schema.String,
  repeat: Schema.Boolean,
  altKey: Schema.Boolean,
  ctrlKey: Schema.Boolean,
  metaKey: Schema.Boolean,
  shiftKey: Schema.Boolean,
})

export const isBrowserScreenshotShortcut = (
  input: unknown,
): Result.Result<boolean, BrowserRenderPolicyError> => {
  const decoded = Schema.decodeUnknownResult(BrowserScreenshotShortcutInputSchema, { onExcessProperty: 'error' })(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(browserRenderPolicyError('runtime', 'invalid-input'))
  }
  const { code, repeat, altKey, ctrlKey, metaKey, shiftKey } = decoded.success
  return Result.succeed(
    code === SCREENSHOT_SHORTCUT_CODE &&
    !repeat &&
    !altKey &&
    !ctrlKey &&
    !metaKey &&
    !shiftKey,
  )
}

type BrowserUniform<Value> = { value: Value }

type BrowserGodRaysShader<Vector2> = {
  readonly fragmentShader: string
  readonly uniforms: {
    readonly tDiffuse: BrowserUniform<null>
    readonly uDecay: BrowserUniform<number>
    readonly uDensity: BrowserUniform<number>
    readonly uExposure: BrowserUniform<number>
    readonly uLightPosition: BrowserUniform<Vector2>
    readonly uSamples: BrowserUniform<number>
    readonly uWeight: BrowserUniform<number>
  }
  readonly vertexShader: string
}

export const BrowserGodRaysShaderSchema: Schema.Codec<BrowserGodRaysShader<unknown>> = Schema.Struct({
  fragmentShader: Schema.String,
  uniforms: Schema.Struct({
    tDiffuse: Schema.Struct({ value: Schema.Null }),
    uDecay: Schema.Struct({ value: Schema.Finite }),
    uDensity: Schema.Struct({ value: Schema.Finite }),
    uExposure: Schema.Struct({ value: Schema.Finite }),
    uLightPosition: Schema.Struct({ value: Schema.Unknown }),
    uSamples: Schema.Struct({ value: Schema.Int }),
    uWeight: Schema.Struct({ value: Schema.Finite }),
  }),
  vertexShader: Schema.String,
})

export const BrowserGodRaysShaderResultSchema: Schema.Codec<BrowserResultShape<BrowserGodRaysShader<unknown>, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('Success'),
    _op: Schema.Literal('Success'),
    success: BrowserGodRaysShaderSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal('Failure'),
    _op: Schema.Literal('Failure'),
    failure: BrowserRenderPolicyErrorSchema,
  }),
])

export const BrowserCompositeShaderSchema: Schema.Codec<BrowserCompositeShader<unknown>> = Schema.Struct({
  fragmentShader: Schema.String,
  uniforms: Schema.Struct({
    tDiffuse: Schema.Struct({ value: Schema.Null }),
    tDepth: Schema.Struct({ value: Schema.Null }),
    uAperture: Schema.Struct({ value: Schema.Finite }),
    uBloomEnabled: Schema.Struct({ value: Schema.Boolean }),
    uBloomStrength: Schema.Struct({ value: Schema.Finite }),
    uBloomThreshold: Schema.Struct({ value: Schema.Finite }),
    uBokehEnabled: Schema.Struct({ value: Schema.Boolean }),
    uDecay: Schema.Struct({ value: Schema.Finite }),
    uDensity: Schema.Struct({ value: Schema.Finite }),
    uExposure: Schema.Struct({ value: Schema.Finite }),
    uFarClip: Schema.Struct({ value: Schema.Finite }),
    uFocus: Schema.Struct({ value: Schema.Finite }),
    uGodRaysEnabled: Schema.Struct({ value: Schema.Boolean }),
    uLightPosition: Schema.Struct({ value: Schema.Unknown }),
    uMaxBlur: Schema.Struct({ value: Schema.Finite }),
    uNearClip: Schema.Struct({ value: Schema.Finite }),
    uResolution: Schema.Struct({ value: Schema.Unknown }),
    uSamples: Schema.Struct({ value: Schema.Int }),
    uWeight: Schema.Struct({ value: Schema.Finite }),
  }),
  vertexShader: Schema.String,
})
export const BrowserCompositeShaderResultSchema: Schema.Codec<BrowserResultShape<BrowserCompositeShader<unknown>, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Success'), _op: Schema.Literal('Success'), success: BrowserCompositeShaderSchema }),
  Schema.Struct({ _tag: Schema.Literal('Failure'), _op: Schema.Literal('Failure'), failure: BrowserRenderPolicyErrorSchema }),
])

type BrowserCompositeShader<Vector2> = {
  readonly fragmentShader: string
  readonly uniforms: {
    readonly tDiffuse: BrowserUniform<null>
    readonly tDepth: BrowserUniform<null>
    readonly uAperture: BrowserUniform<number>
    readonly uBloomEnabled: BrowserUniform<boolean>
    readonly uBloomStrength: BrowserUniform<number>
    readonly uBloomThreshold: BrowserUniform<number>
    readonly uBokehEnabled: BrowserUniform<boolean>
    readonly uDecay: BrowserUniform<number>
    readonly uDensity: BrowserUniform<number>
    readonly uExposure: BrowserUniform<number>
    readonly uFarClip: BrowserUniform<number>
    readonly uFocus: BrowserUniform<number>
    readonly uGodRaysEnabled: BrowserUniform<boolean>
    readonly uLightPosition: BrowserUniform<Vector2>
    readonly uMaxBlur: BrowserUniform<number>
    readonly uNearClip: BrowserUniform<number>
    readonly uResolution: BrowserUniform<Vector2>
    readonly uSamples: BrowserUniform<number>
    readonly uWeight: BrowserUniform<number>
  }
  readonly vertexShader: string
}

export const createBrowserGodRaysShader = <Vector2>(
  samples: unknown,
  makeVector2: BrowserVector2Factory<Vector2>,
): Result.Result<BrowserGodRaysShader<Vector2>, BrowserRenderPolicyError> => {
  const resolvedSamples = validateBrowserGodRaySamples(samples)
  if (Result.isFailure(resolvedSamples)) {
    return Result.fail(resolvedSamples.failure)
  }
  const lightPosition = makeBrowserVector2<Vector2>(
    makeVector2,
    BROWSER_RENDER_DEFAULTS.lightPositionComponent,
    BROWSER_RENDER_DEFAULTS.lightPositionComponent,
  )
  if (Result.isFailure(lightPosition)) {
    return Result.fail(lightPosition.failure)
  }
  return Result.succeed({
    fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uDecay;
    uniform float uDensity;
    uniform float uExposure;
    uniform vec2 uLightPosition;
    uniform int uSamples;
    uniform float uWeight;
    varying vec2 vUv;
    void main() {
      float sampleCount = max(float(uSamples), 1.0);
      vec2 delta = (vUv - uLightPosition) * (uDensity / sampleCount);
      vec2 sampleUv = vUv;
      float illumination = 1.0;
      vec4 color = texture2D(tDiffuse, sampleUv);
      for (int index = 0; index < ${MAX_GOD_RAY_SAMPLES}; index += 1) {
        if (index >= uSamples) {
          break;
        }
        sampleUv -= delta;
        illumination *= uDecay;
        color += texture2D(tDiffuse, sampleUv) * illumination * uWeight;
      }
      gl_FragColor = color * uExposure + texture2D(tDiffuse, vUv);
    }
  `,
    uniforms: {
      tDiffuse: { value: null },
      uDecay: { value: BROWSER_RENDER_DEFAULTS.godRaysDecay },
      uDensity: { value: BROWSER_RENDER_DEFAULTS.godRaysDensity },
      uExposure: { value: BROWSER_RENDER_DEFAULTS.godRaysExposure },
      uLightPosition: { value: lightPosition.success },
      uSamples: { value: resolvedSamples.success },
      uWeight: { value: BROWSER_RENDER_DEFAULTS.godRaysWeight },
    },
    vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  })
}

type BrowserCompositeShaderInput = {
  readonly camera: unknown
  readonly effects: ReadonlyArray<PostProcessingPass>
  readonly makeVector2: unknown
  readonly quality: GraphicsQuality
  readonly viewport: { readonly width: number; readonly height: number }
}

const BrowserCompositeShaderInputSchema: Schema.Codec<BrowserCompositeShaderInput> = Schema.Struct({
  camera: Schema.Unknown,
  effects: Schema.Array(Schema.Literals(['render', 'gtao', 'godRays', 'bloom', 'bokeh', 'composite', 'smaa', 'output'])),
  makeVector2: Schema.Unknown,
  quality: GraphicsQualitySchema,
  viewport: Schema.Struct({ width: Schema.Finite, height: Schema.Finite }),
})

export const createBrowserCompositeShader = (
  options: unknown,
): Result.Result<BrowserCompositeShader<unknown>, BrowserRenderPolicyError> => {
  const decoded = Schema.decodeUnknownResult(BrowserCompositeShaderInputSchema, { onExcessProperty: 'error' })(options)
  if (Result.isFailure(decoded)) {
    return Result.fail(browserRenderPolicyError('runtime', 'invalid-input'))
  }
  const cameraClips = Schema.decodeUnknownResult(Schema.Struct({ far: Schema.Finite, near: Schema.Finite }))(
    decoded.success.camera,
  )
  if (Result.isFailure(cameraClips)) {
    return Result.fail(browserRenderPolicyError('runtime', 'invalid-input'))
  }
  const { effects, makeVector2, quality: inputQuality, viewport } = decoded.success
  const camera = cameraClips.success
  const resolvedQuality = resolveBrowserQuality(inputQuality)
  if (Result.isFailure(resolvedQuality)) {
    return Result.fail(resolvedQuality.failure)
  }
  const { quality } = resolvedQuality.success
  if (
    camera.near <= 0 ||
    camera.far <= camera.near ||
    !Number.isInteger(viewport.width) ||
    !Number.isInteger(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    !isBrowserVector2Factory(makeVector2)
  ) {
    return Result.fail(browserRenderPolicyError('runtime', 'invalid-input'))
  }
  const resolution = makeBrowserVector2<unknown>(makeVector2, viewport.width, viewport.height)
  if (Result.isFailure(resolution)) {
    return Result.fail(resolution.failure)
  }
  const lightPosition = makeBrowserVector2<unknown>(
    makeVector2,
    BROWSER_RENDER_DEFAULTS.lightPositionComponent,
    BROWSER_RENDER_DEFAULTS.lightPositionComponent,
  )
  if (Result.isFailure(lightPosition)) {
    return Result.fail(lightPosition.failure)
  }
  return Result.succeed({
  fragmentShader: `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform vec2 uResolution;
    uniform vec2 uLightPosition;
    uniform float uBloomStrength;
    uniform float uBloomThreshold;
    uniform float uDecay;
    uniform float uDensity;
    uniform float uExposure;
    uniform float uWeight;
    uniform float uFocus;
    uniform float uAperture;
    uniform float uMaxBlur;
    uniform float uNearClip;
    uniform float uFarClip;
    uniform int uSamples;
    uniform bool uBloomEnabled;
    uniform bool uGodRaysEnabled;
    uniform bool uBokehEnabled;
    varying vec2 vUv;

    vec3 applyBloom(vec2 uv, vec3 baseColor) {
      vec3 bloom = vec3(0.0);
      for (int x = -1; x <= 1; x += 1) {
        for (int y = -1; y <= 1; y += 1) {
          vec2 offset = vec2(float(x), float(y)) / uResolution;
          vec3 sampleColor = texture2D(tDiffuse, uv + offset).rgb;
          float brightness = max(max(sampleColor.r, sampleColor.g), sampleColor.b);
          bloom += sampleColor * max(brightness - uBloomThreshold, 0.0);
        }
      }
      return baseColor + bloom * (uBloomStrength / 9.0);
    }

    vec3 applyGodRays(vec2 uv, vec3 baseColor) {
      float sampleCount = max(float(uSamples), 1.0);
      vec2 delta = (uv - uLightPosition) * (uDensity / sampleCount);
      vec2 sampleUv = uv;
      float illumination = 1.0;
      vec3 rays = texture2D(tDiffuse, sampleUv).rgb;
      for (int index = 0; index < ${MAX_GOD_RAY_SAMPLES}; index += 1) {
        if (index >= uSamples) {
          break;
        }
        sampleUv -= delta;
        illumination *= uDecay;
        rays += texture2D(tDiffuse, sampleUv).rgb * illumination * uWeight;
      }
      return baseColor + rays * uExposure;
    }

    vec3 applyBokeh(vec2 uv, vec3 baseColor) {
      float depth = texture2D(tDepth, uv).x;
      float viewZ = (uNearClip * uFarClip) / ((uFarClip - uNearClip) * depth - uFarClip);
      float blur = clamp((uFocus + viewZ) * uAperture, -uMaxBlur, uMaxBlur);
      vec2 aspectCorrect = vec2(1.0, uResolution.y / uResolution.x);
      vec2 radius = vec2(blur) * aspectCorrect;
      vec3 center = texture2D(tDiffuse, uv).rgb;
      vec3 color = center;
      color += texture2D(tDiffuse, uv + radius * vec2(0.0, 0.4)).rgb;
      color += texture2D(tDiffuse, uv + radius * vec2(0.4, 0.0)).rgb;
      color += texture2D(tDiffuse, uv + radius * vec2(0.0, -0.4)).rgb;
      color += texture2D(tDiffuse, uv + radius * vec2(-0.4, 0.0)).rgb;
      color += texture2D(tDiffuse, uv + radius * vec2(0.29, 0.29)).rgb;
      color += texture2D(tDiffuse, uv + radius * vec2(-0.29, 0.29)).rgb;
      color += texture2D(tDiffuse, uv + radius * vec2(0.29, -0.29)).rgb;
      color += texture2D(tDiffuse, uv + radius * vec2(-0.29, -0.29)).rgb;
      return (color / 9.0) + baseColor - center;
    }

    void main() {
      vec4 source = texture2D(tDiffuse, vUv);
      vec3 color = source.rgb;
      if (uBloomEnabled) {
        color = applyBloom(vUv, color);
      }
      if (uGodRaysEnabled) {
        color = applyGodRays(vUv, color);
      }
      if (uBokehEnabled) {
        color = applyBokeh(vUv, color);
      }
      gl_FragColor = vec4(color, source.a);
    }
  `,
  uniforms: {
    tDepth: { value: null },
    tDiffuse: { value: null },
    uAperture: { value: BROWSER_RENDER_DEFAULTS.bokehAperture },
    uBloomEnabled: { value: effects.includes('bloom') },
    uBloomStrength: { value: quality.bloomStrength },
    uBloomThreshold: { value: 0.85 },
    uBokehEnabled: { value: effects.includes('bokeh') },
    uDecay: { value: BROWSER_RENDER_DEFAULTS.godRaysDecay },
    uDensity: { value: BROWSER_RENDER_DEFAULTS.godRaysDensity },
    uExposure: { value: BROWSER_RENDER_DEFAULTS.godRaysExposure },
    uFarClip: { value: camera.far },
    uFocus: { value: BROWSER_RENDER_DEFAULTS.bokehFocus },
    uGodRaysEnabled: { value: effects.includes('godRays') },
    uLightPosition: { value: lightPosition.success },
    uMaxBlur: { value: BROWSER_RENDER_DEFAULTS.bokehMaxBlur },
    uNearClip: { value: camera.near },
    uResolution: { value: resolution.success },
    uSamples: { value: quality.godRaysSamples },
    uWeight: { value: BROWSER_RENDER_DEFAULTS.godRaysWeight },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  })
}

export type BrowserQualitySelection = QualityPreset | GraphicsQuality | undefined

const QualityPresetSchema: Schema.Codec<QualityPreset> = Schema.Literals(['low', 'medium', 'high', 'ultra'])
type ResolvedBrowserQuality = { readonly preset: QualityPreset | undefined; readonly quality: GraphicsQuality }
const ResolvedBrowserQualitySchema: Schema.Codec<ResolvedBrowserQuality> = Schema.Struct({
  preset: Schema.UndefinedOr(QualityPresetSchema),
  quality: GraphicsQualitySchema,
})
export const BrowserQualityResultSchema: Schema.Codec<BrowserResultShape<ResolvedBrowserQuality, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Success'), _op: Schema.Literal('Success'), success: ResolvedBrowserQualitySchema }),
  Schema.Struct({ _tag: Schema.Literal('Failure'), _op: Schema.Literal('Failure'), failure: BrowserRenderPolicyErrorSchema }),
])
export const resolveBrowserQuality = (
  selection: unknown,
): Result.Result<ResolvedBrowserQuality, BrowserRenderPolicyError> => {
  if (selection === undefined) {
    return Result.succeed({ preset: DEFAULT_QUALITY_PRESET, quality: QUALITY_PRESETS[DEFAULT_QUALITY_PRESET] })
  }
  if (typeof selection === 'string') {
    const preset = Schema.decodeUnknownResult(QualityPresetSchema)(selection)
    if (Result.isFailure(preset)) {
      return Result.fail(browserRenderPolicyError('quality', 'invalid-input'))
    }
    return Result.succeed({ preset: preset.success, quality: QUALITY_PRESETS[preset.success] })
  }
  const quality = Schema.decodeUnknownResult(GraphicsQualitySchema, { onExcessProperty: 'error' })(selection)
  if (Result.isFailure(quality)) {
    return Result.fail(browserRenderPolicyError('quality', 'invalid-input'))
  }
  const bloomStrength = validateBrowserBloomStrength(quality.success.bloomStrength)
  if (Result.isFailure(bloomStrength)) {
    return Result.fail(bloomStrength.failure)
  }
  const godRaySamples = validateBrowserGodRaySamples(quality.success.godRaysSamples)
  if (Result.isFailure(godRaySamples)) {
    return Result.fail(godRaySamples.failure)
  }
  const pixelRatioCap = resolveBrowserPixelRatioCap(quality.success.pixelRatioCap)
  if (Result.isFailure(pixelRatioCap)) {
    return Result.fail(pixelRatioCap.failure)
  }
  const minScreenRatio = normalizeRefractionMinScreenRatio(quality.success.refractionMinScreenRatio)
  if (Result.isFailure(minScreenRatio)) {
    return Result.fail(browserRenderPolicyError('refraction', 'invalid-refraction-input'))
  }
  if (!Number.isInteger(quality.success.refractionThrottleFrames) || quality.success.refractionThrottleFrames < 0) {
    return Result.fail(browserRenderPolicyError('refraction', 'invalid-refraction-input'))
  }
  return Result.succeed({ preset: undefined, quality: quality.success })
}

export const resolveBrowserPixelRatioCap = (value: unknown): Result.Result<number, BrowserRenderPolicyError> => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Result.fail(browserRenderPolicyError('pixel-ratio', 'not-finite'))
  }
  if (value < MIN_PIXEL_RATIO_CAP || value > DEFAULT_MAX_PIXEL_RATIO) {
    return Result.fail(browserRenderPolicyError('pixel-ratio', 'out-of-range'))
  }
  return Result.succeed(value)
}

export const resolveBrowserMaxPixelRatio = (
  requestedRatio: unknown,
  qualityCap: unknown,
): Result.Result<number, BrowserRenderPolicyError> => {
  const cap = resolveBrowserPixelRatioCap(qualityCap)
  if (Result.isFailure(cap)) {
    return cap
  }
  if (requestedRatio === undefined) {
    return cap
  }
  if (typeof requestedRatio !== 'number' || !Number.isFinite(requestedRatio)) {
    return Result.fail(browserRenderPolicyError('pixel-ratio', 'not-finite'))
  }
  if (requestedRatio <= POSITIVE_NUMBER_BOUNDARY) {
    return Result.fail(browserRenderPolicyError('pixel-ratio', 'out-of-range'))
  }
  return Result.succeed(Math.min(cap.success, requestedRatio))
}

export const resolveBrowserPixelRatio = (
  maxPixelRatio: unknown,
  devicePixelRatio: unknown,
): Result.Result<number, BrowserRenderPolicyError> => {
  const cap = resolveBrowserPixelRatioCap(maxPixelRatio)
  if (Result.isFailure(cap)) {
    return cap
  }
  if (devicePixelRatio === undefined) {
    return Result.succeed(Math.min(cap.success, DEFAULT_DEVICE_PIXEL_RATIO))
  }
  if (typeof devicePixelRatio !== 'number' || !Number.isFinite(devicePixelRatio)) {
    return Result.fail(browserRenderPolicyError('pixel-ratio', 'not-finite'))
  }
  if (devicePixelRatio <= POSITIVE_NUMBER_BOUNDARY) {
    return Result.fail(browserRenderPolicyError('pixel-ratio', 'out-of-range'))
  }
  return Result.succeed(Math.min(cap.success, devicePixelRatio))
}

export const resolveBrowserGodRaySamples = (value: unknown): Result.Result<number, BrowserRenderPolicyError> =>
  validateBrowserGodRaySamples(value)

export const resolveBrowserBloomStrength = (value: unknown): Result.Result<number, BrowserRenderPolicyError> =>
  validateBrowserBloomStrength(value)

export type BrowserRenderTargetKind = 'hdr' | 'ldr'

export const browserRenderTargetKind = (quality: GraphicsQuality): BrowserRenderTargetKind => {
  if (qualityUsesHdrRenderTarget(quality)) {
    return 'hdr'
  }
  return 'ldr'
}

export const resolveBrowserRenderTargetValue = <Value>(
  quality: GraphicsQuality,
  hdrValue: Value,
  ldrValue: Value,
): Value => {
  if (browserRenderTargetKind(quality) === 'hdr') {
    return hdrValue
  }
  return ldrValue
}

export const browserDepthTextureOption = <Texture>(
  enabled: boolean,
  makeTexture: () => Texture,
): { readonly depthTexture?: Texture } => {
  if (enabled) {
    return { depthTexture: makeTexture() }
  }
  return {}
}

export const browserPostProcessingChain = (
  quality: GraphicsQuality,
): ReadonlyArray<PostProcessingStep> => buildPostProcessingChain(quality)

export const browserPostProcessingChainKey = (
  chain: ReadonlyArray<PostProcessingStep>,
): string => chain.map(({ effects, pass }) => `${pass}:${effects.join(',')}`).join('|')

export const resolveBrowserLatestGpuTime = (
  current: number | undefined,
  sample: number | undefined,
): number | undefined => sample ?? current

export const assertBrowserRuntimeActive = (disposed: unknown): Result.Result<void, BrowserRenderPolicyError> => {
  if (typeof disposed !== 'boolean') {
    return Result.fail(browserRenderPolicyError('runtime', 'invalid-input'))
  }
  return disposed
    ? Result.fail(browserRenderPolicyError('runtime', 'disposed'))
    : Result.succeed(undefined)
}

export const requireBrowserRuntimeValue = <Value>(
  value: Value | undefined,
  _message: string,
): Result.Result<Value, BrowserRenderPolicyError> => {
  if (value === undefined) {
    return Result.fail(browserRenderPolicyError('runtime', 'missing-value'))
  }
  return Result.succeed(value)
}

type BrowserViewport = { readonly width: number; readonly height: number }
export const BrowserViewportSchema: Schema.Codec<BrowserViewport> = Schema.Struct({ width: Schema.Finite, height: Schema.Finite })
export const BrowserViewportResultSchema: Schema.Codec<BrowserResultShape<BrowserViewport, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Success'), _op: Schema.Literal('Success'), success: BrowserViewportSchema }),
  Schema.Struct({ _tag: Schema.Literal('Failure'), _op: Schema.Literal('Failure'), failure: BrowserRenderPolicyErrorSchema }),
])
type BrowserViewportInput = { readonly clientWidth: number; readonly clientHeight: number; readonly canvasWidth: number; readonly canvasHeight: number }
const BrowserViewportInputSchema: Schema.Codec<BrowserViewportInput> = Schema.Struct({
  clientWidth: Schema.Finite,
  clientHeight: Schema.Finite,
  canvasWidth: Schema.Finite,
  canvasHeight: Schema.Finite,
})

export const resolveBrowserViewport = (
  input: unknown,
): Result.Result<BrowserViewport, BrowserRenderPolicyError> => {
  const decoded = Schema.decodeUnknownResult(BrowserViewportInputSchema, { onExcessProperty: 'error' })(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(browserRenderPolicyError('viewport', 'invalid-input'))
  }
  const { clientWidth, clientHeight, canvasWidth, canvasHeight } = decoded.success
  if (![clientWidth, clientHeight, canvasWidth, canvasHeight].every((value) => Number.isFinite(value) && value >= 0)) {
    return Result.fail(browserRenderPolicyError('viewport', 'out-of-range'))
  }
  const width = Math.max(MIN_VIEWPORT_SIZE, Math.floor(clientWidth || canvasWidth || MIN_VIEWPORT_SIZE))
  const height = Math.max(MIN_VIEWPORT_SIZE, Math.floor(clientHeight || canvasHeight || MIN_VIEWPORT_SIZE))
  return Result.succeed({ height, width })
}

export const resolveBrowserDrawingBufferSize = (
  width: unknown,
  height: unknown,
): Result.Result<BrowserViewport, BrowserRenderPolicyError> => {
  if (typeof width !== 'number' || typeof height !== 'number' || !Number.isFinite(width) || !Number.isFinite(height)) {
    return Result.fail(browserRenderPolicyError('drawing-buffer-size', 'not-finite'))
  }
  if (width <= 0 || height <= 0) {
    return Result.fail(browserRenderPolicyError('drawing-buffer-size', 'out-of-range'))
  }
  return Result.succeed({ height: Math.max(MIN_VIEWPORT_SIZE, Math.floor(height)), width: Math.max(MIN_VIEWPORT_SIZE, Math.floor(width)) })
}

type BrowserRefractionTargetSize = { readonly width: number; readonly height: number; readonly key: string }
export const BrowserRefractionTargetSizeSchema: Schema.Codec<BrowserRefractionTargetSize> = Schema.Struct({
  width: Schema.Finite,
  height: Schema.Finite,
  key: Schema.String,
})
export const BrowserRefractionTargetSizeResultSchema: Schema.Codec<BrowserResultShape<BrowserRefractionTargetSize, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Success'), _op: Schema.Literal('Success'), success: BrowserRefractionTargetSizeSchema }),
  Schema.Struct({ _tag: Schema.Literal('Failure'), _op: Schema.Literal('Failure'), failure: BrowserRenderPolicyErrorSchema }),
])
export const resolveBrowserRefractionTargetSize = (
  viewport: unknown,
  pixelRatio: unknown,
): Result.Result<BrowserRefractionTargetSize, BrowserRenderPolicyError> => {
  const decodedViewport = Schema.decodeUnknownResult(BrowserViewportSchema, { onExcessProperty: 'error' })(viewport)
  if (Result.isFailure(decodedViewport)) {
    return Result.fail(browserRenderPolicyError('refraction-target-size', 'invalid-input'))
  }
  if (
    !Number.isInteger(decodedViewport.success.width) ||
    !Number.isInteger(decodedViewport.success.height) ||
    decodedViewport.success.width <= 0 ||
    decodedViewport.success.height <= 0
  ) {
    return Result.fail(browserRenderPolicyError('refraction-target-size', 'out-of-range'))
  }
  if (typeof pixelRatio !== 'number' || !Number.isFinite(pixelRatio)) {
    return Result.fail(browserRenderPolicyError('refraction-target-size', 'not-finite'))
  }
  if (pixelRatio <= 0) {
    return Result.fail(browserRenderPolicyError('refraction-target-size', 'out-of-range'))
  }
  const width = Math.max(MIN_VIEWPORT_SIZE, Math.floor(decodedViewport.success.width * pixelRatio))
  const height = Math.max(MIN_VIEWPORT_SIZE, Math.floor(decodedViewport.success.height * pixelRatio))
  return Result.succeed({ height, key: `${width}x${height}`, width })
}

export type BrowserWaterMesh = { visible: boolean }
export type BrowserWaterVisibility<MeshType extends BrowserWaterMesh> = ReadonlyArray<readonly [MeshType, boolean]>

export const captureBrowserWaterVisibility = <MeshType extends BrowserWaterMesh>(
  waterMeshes: ReadonlySet<MeshType>,
): BrowserWaterVisibility<MeshType> =>
  [...waterMeshes].map((mesh): readonly [MeshType, boolean] => [mesh, mesh.visible])

export const hideBrowserWaterMeshes = <MeshType extends BrowserWaterMesh>(
  waterMeshes: ReadonlySet<MeshType>,
): void => {
  for (const mesh of waterMeshes) {
    mesh.visible = false
  }
}

export const restoreBrowserWaterVisibility = <MeshType extends BrowserWaterMesh>(
  visibility: BrowserWaterVisibility<MeshType>,
): void => {
  for (const [waterMesh, visible] of visibility) {
    waterMesh.visible = visible
  }
}

export type BrowserWaterRefractionUniforms = {
  readonly uRefractionMap?: { value: unknown }
  readonly uRefractionValid?: { value: number }
}

export const setBrowserWaterRefractionUniforms = (
  uniforms: BrowserWaterRefractionUniforms,
  texture: unknown,
  rendered: boolean,
): void => {
  const map = uniforms.uRefractionMap
  const valid = uniforms.uRefractionValid
  if (!map || !valid) {
    return
  }
  if (rendered) {
    map.value = texture
    valid.value = REFRACTION_AVAILABLE
    return
  }
  map.value = null
  valid.value = REFRACTION_UNAVAILABLE
}

export type BrowserPerformanceApi = {
  readonly mark?: (markName: string) => void
  readonly measure?: (measureName: string, startMark: string, endMark: string) => void
  readonly clearMarks?: (markName: string) => void
}

type CompleteBrowserPerformanceApi = Required<Pick<BrowserPerformanceApi, 'mark' | 'measure' | 'clearMarks'>>

const hasCompleteBrowserPerformanceApi = (
  performanceApi: BrowserPerformanceApi | undefined,
): performanceApi is CompleteBrowserPerformanceApi =>
  performanceApi !== undefined &&
  typeof performanceApi.mark === 'function' &&
  typeof performanceApi.measure === 'function' &&
  typeof performanceApi.clearMarks === 'function'

const finishBrowserStageMeasurement = ({
  endMark,
  name,
  performanceApi,
  startMark,
}: {
  readonly endMark: string
  readonly name: string
  readonly performanceApi: CompleteBrowserPerformanceApi
  readonly startMark: string
}): void => {
  performanceApi.mark(endMark)
  performanceApi.measure(name, startMark, endMark)
  performanceApi.clearMarks(startMark)
  performanceApi.clearMarks(endMark)
}

export const measureBrowserStage = <Value>(
  performanceApi: BrowserPerformanceApi | undefined,
  name: string,
  run: () => Value,
): Effect.Effect<Value, BrowserRenderPolicyError> => {
  if (!hasCompleteBrowserPerformanceApi(performanceApi)) {
    return Effect.try({
      try: run,
      catch: () => browserRenderPolicyError('runtime', 'invalid-input'),
    })
  }
  const startMark = `${name}:start`
  const endMark = `${name}:end`
  return Effect.acquireUseRelease(
    Effect.sync(() => performanceApi.mark(startMark)),
    () => Effect.try({
      try: run,
      catch: () => browserRenderPolicyError('runtime', 'invalid-input'),
    }),
    () => Effect.sync(() => finishBrowserStageMeasurement({ endMark, name, performanceApi, startMark })),
  )
}

export type TimerQueryExtensionShape = {
  readonly GPU_DISJOINT_EXT: number
  readonly TIME_ELAPSED_EXT: number
}

export type GpuTimerSelection =
  | { readonly kind: 'query'; readonly extension: TimerQueryExtensionShape }
  | { readonly kind: 'fallback' }

const TimerQueryExtensionSchema: Schema.Codec<TimerQueryExtensionShape> = Schema.Struct({
  GPU_DISJOINT_EXT: Schema.Int,
  TIME_ELAPSED_EXT: Schema.Int,
})
const GpuTimerSelectionSchema: Schema.Codec<GpuTimerSelection> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('query'), extension: TimerQueryExtensionSchema }),
  Schema.Struct({ kind: Schema.Literal('fallback') }),
])
export const BrowserGpuTimerSelectionResultSchema: Schema.Codec<BrowserResultShape<GpuTimerSelection, BrowserRenderPolicyError>> = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Success'), _op: Schema.Literal('Success'), success: GpuTimerSelectionSchema }),
  Schema.Struct({ _tag: Schema.Literal('Failure'), _op: Schema.Literal('Failure'), failure: BrowserRenderPolicyErrorSchema }),
])

export const selectGpuTimer = (value: unknown): Result.Result<GpuTimerSelection, BrowserRenderPolicyError> => {
  if (value === undefined || value === null) {
    return Result.succeed({ kind: 'fallback' })
  }
  const decoded = Schema.decodeUnknownResult(TimerQueryExtensionSchema)(value)
  if (Result.isFailure(decoded)) {
    return Result.fail(browserRenderPolicyError('runtime', 'invalid-input'))
  }
  return Result.succeed({ extension: decoded.success, kind: 'query' })
}

export const millisecondsFromGpuNanoseconds = (
  value: unknown,
): Result.Result<number | undefined, BrowserRenderPolicyError> => {
  if (value === undefined) {
    return Result.succeed(undefined)
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Result.fail(browserRenderPolicyError('runtime', 'not-finite'))
  }
  if (value < ZERO) {
    return Result.fail(browserRenderPolicyError('runtime', 'out-of-range'))
  }
  return Result.succeed(value / NANOSECONDS_PER_MILLISECOND)
}

export const shouldCaptureBrowserRefraction = (
  input: unknown,
): Result.Result<boolean, BrowserRenderPolicyError> => {
  const decoded = Schema.decodeUnknownResult(BrowserRefractionCaptureInputSchema, { onExcessProperty: 'error' })(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(browserRenderPolicyError('refraction', 'invalid-input'))
  }
  const { frameNumber, visibleWaterMeshCount, waterScreenRatio } = decoded.success
  const resolvedQuality = resolveBrowserQuality(decoded.success.quality)
  if (Result.isFailure(resolvedQuality)) {
    return Result.fail(resolvedQuality.failure)
  }
  const { quality } = resolvedQuality.success
  const ratioGate = shouldRunRefractionRatioGate(
    visibleWaterMeshCount,
    waterScreenRatio,
    quality.refractionMinScreenRatio,
  )
  if (Result.isFailure(ratioGate)) {
    return Result.fail(browserRenderPolicyError('refraction', 'invalid-refraction-input'))
  }
  if (!ratioGate.success) {
    return Result.succeed(false)
  }
  const frameGate = refractionRunsOnFrame(quality.refractionThrottleFrames, frameNumber)
  if (Result.isFailure(frameGate)) {
    return Result.fail(browserRenderPolicyError('refraction', 'invalid-refraction-input'))
  }
  return Result.succeed(frameGate.success)
}

export type BrowserQualityTransition = {
  readonly change: AdaptiveQualityChange
  readonly preset: QualityPreset
  readonly state: AdaptiveQualityState
  readonly skipSsim: boolean
}

export const advanceBrowserFpsQuality = (
  state: AdaptiveQualityState,
  preset: QualityPreset,
  fps: number,
): BrowserQualityTransition => {
  const result = advanceAdaptiveQuality(state, preset, fps)
  return {
    change: result.change,
    preset: result.preset,
    skipSsim: result.change !== 'none',
    state: result.state,
  }
}

export type BrowserSsimQualityTransition = {
  readonly change: 'downgrade' | 'none'
  readonly preset: QualityPreset
  readonly skipSsim: false
  readonly state: SsimAdaptiveQualityState
}

export const advanceBrowserSsimQuality = (
  { preset, skipSsim, ssim, state }: {
    readonly preset: QualityPreset
    readonly skipSsim: boolean
    readonly ssim: number
    readonly state: SsimAdaptiveQualityState
  },
): BrowserSsimQualityTransition => {
  if (skipSsim) {
    return { change: 'none', preset, skipSsim: false, state }
  }
  const result = advanceSsimAdaptiveQuality(state, preset, ssim)
  return { ...result, skipSsim: false }
}

const luminanceAt = (pixels: DataView, offset: number): number =>
  SSIM_RED_LUMINANCE_WEIGHT * pixels.getUint8(offset + RED_CHANNEL_OFFSET) +
  SSIM_GREEN_LUMINANCE_WEIGHT * pixels.getUint8(offset + GREEN_CHANNEL_OFFSET) +
  SSIM_BLUE_LUMINANCE_WEIGHT * pixels.getUint8(offset + BLUE_CHANNEL_OFFSET)

type SsimPixelPair = readonly [number, number]

type SsimMoments = {
  readonly covariance: number
  readonly meanLeft: number
  readonly meanRight: number
  readonly varianceLeft: number
  readonly varianceRight: number
}

const meanSsimValues = (values: ReadonlyArray<SsimPixelPair>): Pick<SsimMoments, 'meanLeft' | 'meanRight'> => {
  const total = values.reduce((sum, [valueLeft, valueRight]) => ({
    left: sum.left + valueLeft,
    right: sum.right + valueRight,
  }), { left: ZERO, right: ZERO })
  return { meanLeft: total.left / values.length, meanRight: total.right / values.length }
}

const varianceSsimValues = (
  values: ReadonlyArray<SsimPixelPair>,
  means: Pick<SsimMoments, 'meanLeft' | 'meanRight'>,
): Omit<SsimMoments, 'meanLeft' | 'meanRight'> => {
  const sums = values.reduce((result, [valueLeft, valueRight]) => {
    const deltaLeft = valueLeft - means.meanLeft
    const deltaRight = valueRight - means.meanRight
    return {
      covariance: result.covariance + deltaLeft * deltaRight,
      varianceLeft: result.varianceLeft + deltaLeft ** SSIM_VARIANCE_POWER,
      varianceRight: result.varianceRight + deltaRight ** SSIM_VARIANCE_POWER,
    }
  }, { covariance: ZERO, varianceLeft: ZERO, varianceRight: ZERO })
  const divisor = Math.max(SSIM_VARIANCE_DIVISOR_FLOOR, values.length - SSIM_VARIANCE_DIVISOR_FLOOR)
  return {
    covariance: sums.covariance / divisor,
    varianceLeft: sums.varianceLeft / divisor,
    varianceRight: sums.varianceRight / divisor,
  }
}

const scoreSsimWindow = (moments: SsimMoments, c1: number, c2: number): number => {
  const luminance = (
    SSIM_LUMINANCE_FACTOR * moments.meanLeft * moments.meanRight + c1
  ) / (moments.meanLeft ** SSIM_LUMINANCE_FACTOR + moments.meanRight ** SSIM_LUMINANCE_FACTOR + c1)
  const contrast = (
    SSIM_COVARIANCE_FACTOR * moments.covariance + c2
  ) / (moments.varianceLeft + moments.varianceRight + c2)
  return luminance * contrast
}

const collectSsimWindowValues = (options: {
  readonly height: number
  readonly leftEdge: number
  readonly leftPixels: DataView
  readonly rightPixels: DataView
  readonly top: number
  readonly width: number
}): ReadonlyArray<SsimPixelPair> => {
  const { height, leftEdge, leftPixels, rightPixels, top, width } = options
  const values: Array<SsimPixelPair> = []
  for (let y = top; y < Math.min(top + SSIM_WINDOW_SIZE, height); y += PIXEL_INDEX_INCREMENT) {
    for (let x = leftEdge; x < Math.min(leftEdge + SSIM_WINDOW_SIZE, width); x += PIXEL_INDEX_INCREMENT) {
      const offset = (y * width + x) * RGBA_CHANNEL_COUNT
      values.push([luminanceAt(leftPixels, offset), luminanceAt(rightPixels, offset)])
    }
  }
  return values
}

const computeSsimWindowScore = (options: {
  readonly c1: number
  readonly c2: number
  readonly height: number
  readonly leftEdge: number
  readonly leftPixels: DataView
  readonly rightPixels: DataView
  readonly top: number
  readonly width: number
}): number => {
  const values = collectSsimWindowValues(options)
  const means = meanSsimValues(values)
  const variances = varianceSsimValues(values, means)
  return scoreSsimWindow({ ...means, ...variances }, options.c1, options.c2)
}

const averageSsimWindowScores = (options: {
  readonly c1: number
  readonly c2: number
  readonly height: number
  readonly leftPixels: DataView
  readonly rightPixels: DataView
  readonly width: number
}): number => {
  let windowScoreTotal = ZERO
  let windowCount = ZERO
  for (let top = 0; top < options.height; top += SSIM_WINDOW_SIZE) {
    for (let leftEdge = 0; leftEdge < options.width; leftEdge += SSIM_WINDOW_SIZE) {
      windowScoreTotal += computeSsimWindowScore({ ...options, leftEdge, top })
      windowCount += PIXEL_INDEX_INCREMENT
    }
  }
  return windowScoreTotal / windowCount
}

export const structuralSimilarity = (
  input: unknown,
): Result.Result<number, BrowserRenderPolicyError> => {
  const decoded = Schema.decodeUnknownResult(BrowserSsimInputSchema, { onExcessProperty: 'error' })(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(browserRenderPolicyError('similarity', 'invalid-input'))
  }
  const { height, left, right, width } = decoded.success
  if (width <= 0 || height <= 0) {
    return Result.fail(browserRenderPolicyError('similarity', 'invalid-input'))
  }
  if (left.length !== right.length || left.length !== width * height * RGBA_CHANNEL_COUNT) {
    return Result.fail(browserRenderPolicyError('similarity', 'size-mismatch'))
  }
  const leftPixels = new DataView(left.buffer, left.byteOffset, left.byteLength)
  const rightPixels = new DataView(right.buffer, right.byteOffset, right.byteLength)
  const c1 = (SSIM_K1 * SSIM_LUMINANCE_RANGE) ** SSIM_VARIANCE_POWER
  const c2 = (SSIM_K2 * SSIM_LUMINANCE_RANGE) ** SSIM_VARIANCE_POWER
  return Result.succeed(averageSsimWindowScores({ c1, c2, height, leftPixels, rightPixels, width }))
}
