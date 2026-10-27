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
  shouldRunRefractionRatioGate,
} from './water-refraction.js'

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

const clampBrowserGodRaySamples = (value: number): number => {
  if (!Number.isFinite(value)) {
    return MIN_GOD_RAY_SAMPLES
  }
  return Math.max(MIN_GOD_RAY_SAMPLES, Math.min(MAX_GOD_RAY_SAMPLES, Math.trunc(value)))
}

const clampBrowserBloomStrength = (value: number): number => {
  if (!Number.isFinite(value)) {
    return MIN_BLOOM_STRENGTH
  }
  return Math.max(MIN_BLOOM_STRENGTH, Math.min(MAX_BLOOM_STRENGTH, value))
}

export type BrowserScreenshotShortcutInput = {
  readonly code: string
  readonly repeat: boolean
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

export const isBrowserScreenshotShortcut = ({
  code,
  repeat,
  altKey,
  ctrlKey,
  metaKey,
  shiftKey,
}: BrowserScreenshotShortcutInput): boolean =>
  code === SCREENSHOT_SHORTCUT_CODE &&
  !repeat &&
  !altKey &&
  !ctrlKey &&
  !metaKey &&
  !shiftKey

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
  samples: number,
  makeVector2: BrowserVector2Factory<Vector2>,
): BrowserGodRaysShader<Vector2> => ({
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
    uLightPosition: {
      value: makeVector2(
        BROWSER_RENDER_DEFAULTS.lightPositionComponent,
        BROWSER_RENDER_DEFAULTS.lightPositionComponent,
      ),
    },
    uSamples: { value: clampBrowserGodRaySamples(samples) },
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

export const createBrowserCompositeShader = <Vector2>(
  options: {
    readonly camera: { readonly far: number; readonly near: number }
    readonly effects: ReadonlyArray<PostProcessingPass>
    readonly makeVector2: BrowserVector2Factory<Vector2>
    readonly quality: GraphicsQuality
    readonly viewport: BrowserViewport
  },
): BrowserCompositeShader<Vector2> => {
  const { camera, effects, makeVector2, quality, viewport } = options
  return {
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
    uBloomStrength: { value: clampBrowserBloomStrength(quality.bloomStrength) },
    uBloomThreshold: { value: 0.85 },
    uBokehEnabled: { value: effects.includes('bokeh') },
    uDecay: { value: BROWSER_RENDER_DEFAULTS.godRaysDecay },
    uDensity: { value: BROWSER_RENDER_DEFAULTS.godRaysDensity },
    uExposure: { value: BROWSER_RENDER_DEFAULTS.godRaysExposure },
    uFarClip: { value: camera.far },
    uFocus: { value: BROWSER_RENDER_DEFAULTS.bokehFocus },
    uGodRaysEnabled: { value: effects.includes('godRays') },
    uLightPosition: {
      value: makeVector2(
        BROWSER_RENDER_DEFAULTS.lightPositionComponent,
        BROWSER_RENDER_DEFAULTS.lightPositionComponent,
      ),
    },
    uMaxBlur: { value: BROWSER_RENDER_DEFAULTS.bokehMaxBlur },
    uNearClip: { value: camera.near },
    uResolution: { value: makeVector2(viewport.width, viewport.height) },
    uSamples: { value: clampBrowserGodRaySamples(quality.godRaysSamples) },
    uWeight: { value: BROWSER_RENDER_DEFAULTS.godRaysWeight },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  }
}

export type BrowserQualitySelection = QualityPreset | GraphicsQuality | undefined

export type ResolvedBrowserQuality = {
  readonly preset: QualityPreset | undefined
  readonly quality: GraphicsQuality
}

export const resolveBrowserQuality = (
  selection: BrowserQualitySelection,
): ResolvedBrowserQuality => {
  if (typeof selection === 'string') {
    return { preset: selection, quality: QUALITY_PRESETS[selection] }
  }
  if (selection !== undefined) {
    return { preset: undefined, quality: selection }
  }
  return { preset: DEFAULT_QUALITY_PRESET, quality: QUALITY_PRESETS[DEFAULT_QUALITY_PRESET] }
}

export const resolveBrowserPixelRatioCap = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_PIXEL_RATIO
  }
  return Math.max(MIN_PIXEL_RATIO_CAP, Math.min(DEFAULT_MAX_PIXEL_RATIO, value))
}

export const resolveBrowserMaxPixelRatio = (
  requestedRatio: number | undefined,
  qualityCap: number,
): number => {
  const cap = resolveBrowserPixelRatioCap(qualityCap)
  if (
    requestedRatio !== undefined &&
    Number.isFinite(requestedRatio) &&
    requestedRatio > POSITIVE_NUMBER_BOUNDARY
  ) {
    return Math.min(cap, requestedRatio)
  }
  return cap
}

export const resolveBrowserPixelRatio = (
  maxPixelRatio: number,
  devicePixelRatio: number | undefined,
): number => {
  if (typeof devicePixelRatio === 'number' && devicePixelRatio > POSITIVE_NUMBER_BOUNDARY) {
    return Math.min(maxPixelRatio, devicePixelRatio)
  }
  return Math.min(maxPixelRatio, DEFAULT_DEVICE_PIXEL_RATIO)
}

export const resolveBrowserGodRaySamples = (value: number): number => clampBrowserGodRaySamples(value)

export const resolveBrowserBloomStrength = (value: number): number => clampBrowserBloomStrength(value)

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

export const assertBrowserRuntimeActive = (disposed: boolean): void => {
  if (disposed) {
    throw new Error('browser world runtime is disposed')
  }
}

export const requireBrowserRuntimeValue = <Value>(value: Value | undefined, message: string): Value => {
  if (value === undefined) {
    throw new Error(message)
  }
  return value
}

export type BrowserViewport = { readonly width: number; readonly height: number }

export const resolveBrowserViewport = (
  { clientWidth, clientHeight, canvasWidth, canvasHeight }: {
    readonly canvasHeight: number
    readonly canvasWidth: number
    readonly clientHeight: number
    readonly clientWidth: number
  },
): BrowserViewport => {
  const width = Math.max(MIN_VIEWPORT_SIZE, Math.floor(clientWidth || canvasWidth || MIN_VIEWPORT_SIZE))
  const height = Math.max(MIN_VIEWPORT_SIZE, Math.floor(clientHeight || canvasHeight || MIN_VIEWPORT_SIZE))
  return { height, width }
}

export const resolveBrowserDrawingBufferSize = (
  width: number,
  height: number,
): BrowserViewport => ({
  height: Math.max(MIN_VIEWPORT_SIZE, Math.floor(height)),
  width: Math.max(MIN_VIEWPORT_SIZE, Math.floor(width)),
})

export type BrowserRefractionTargetSize = BrowserViewport & { readonly key: string }

export const resolveBrowserRefractionTargetSize = (
  viewport: BrowserViewport,
  pixelRatio: number,
): BrowserRefractionTargetSize => {
  const width = Math.max(MIN_VIEWPORT_SIZE, Math.floor(viewport.width * pixelRatio))
  const height = Math.max(MIN_VIEWPORT_SIZE, Math.floor(viewport.height * pixelRatio))
  return { height, key: `${width}x${height}`, width }
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

export const measureBrowserStage = <Result>(
  performanceApi: BrowserPerformanceApi | undefined,
  name: string,
  run: () => Result,
): Result => {
  if (!hasCompleteBrowserPerformanceApi(performanceApi)) {
    return run()
  }
  const startMark = `${name}:start`
  const endMark = `${name}:end`
  performanceApi.mark(startMark)
  try {
    return run()
  } finally {
    finishBrowserStageMeasurement({ endMark, name, performanceApi, startMark })
  }
}

export type TimerQueryExtensionShape = {
  readonly GPU_DISJOINT_EXT: number
  readonly TIME_ELAPSED_EXT: number
}

export type GpuTimerSelection =
  | { readonly kind: 'query'; readonly extension: TimerQueryExtensionShape }
  | { readonly kind: 'fallback' }

export const selectGpuTimer = (value: unknown): GpuTimerSelection => {
  if (
    typeof value === 'object' &&
    value !== null &&
    'GPU_DISJOINT_EXT' in value &&
    typeof value.GPU_DISJOINT_EXT === 'number' &&
    'TIME_ELAPSED_EXT' in value &&
    typeof value.TIME_ELAPSED_EXT === 'number'
  ) {
  return {
      extension: {
        GPU_DISJOINT_EXT: value.GPU_DISJOINT_EXT,
        TIME_ELAPSED_EXT: value.TIME_ELAPSED_EXT,
      },
      kind: 'query',
    }
  }
  return { kind: 'fallback' }
}

export const millisecondsFromGpuNanoseconds = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return Math.max(ZERO, value) / NANOSECONDS_PER_MILLISECOND
}

export const shouldCaptureBrowserRefraction = (
  { frameNumber, quality, visibleWaterMeshCount, waterScreenRatio }: {
    readonly frameNumber: number
    readonly quality: GraphicsQuality
    readonly visibleWaterMeshCount: number
    readonly waterScreenRatio: number
  },
): boolean =>
  shouldRunRefractionRatioGate(
    visibleWaterMeshCount,
    waterScreenRatio,
    quality.refractionMinScreenRatio,
  ) && refractionRunsOnFrame(quality.refractionThrottleFrames, frameNumber)

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
  { height, left, right, width }: {
    readonly height: number
    readonly left: Uint8Array
    readonly right: Uint8Array
    readonly width: number
  },
): number => {
  if (left.length !== right.length || left.length !== width * height * RGBA_CHANNEL_COUNT) {
    throw new Error('SSIM inputs must be equally sized RGBA images')
  }
  const leftPixels = new DataView(left.buffer, left.byteOffset, left.byteLength)
  const rightPixels = new DataView(right.buffer, right.byteOffset, right.byteLength)
  const c1 = (SSIM_K1 * SSIM_LUMINANCE_RANGE) ** SSIM_VARIANCE_POWER
  const c2 = (SSIM_K2 * SSIM_LUMINANCE_RANGE) ** SSIM_VARIANCE_POWER
  return averageSsimWindowScores({ c1, c2, height, leftPixels, rightPixels, width })
}
