import {
  type GraphicsQuality,
  type PostProcessingPass,
  type PostProcessingStep,
  type QualityPreset,
  QUALITY_PRESETS,
  buildPostProcessingChain,
  qualityUsesHdrRenderTarget,
} from './post-processing.js'
import {
  type AdaptiveQualityState,
  type AdaptiveQualityChange,
  advanceAdaptiveQuality,
} from './adaptive-quality.js'
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
const MIN_VIEWPORT_SIZE = 1
const REFRACTION_AVAILABLE = 1
const REFRACTION_UNAVAILABLE = 0
const SCREENSHOT_SHORTCUT_CODE = 'F2'

export const BROWSER_RENDER_DEFAULTS = {
  godRaysDensity: 0.7,
  godRaysDecay: 0.95,
  godRaysWeight: 0.12,
  godRaysExposure: 0.25,
  bokehFocus: 10,
  bokehAperture: 0.00002,
  bokehMaxBlur: 0.01,
  lightPositionComponent: 0.5,
}

export type BrowserVector2Factory<Vector2> = (x: number, y: number) => Vector2

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
    uSamples: { value: resolveBrowserGodRaySamples(samples) },
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
  effects: ReadonlyArray<PostProcessingPass>,
  quality: GraphicsQuality,
  viewport: BrowserViewport,
  camera: { readonly far: number; readonly near: number },
  makeVector2: BrowserVector2Factory<Vector2>,
): BrowserCompositeShader<Vector2> => ({
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
    tDiffuse: { value: null },
    tDepth: { value: null },
    uAperture: { value: BROWSER_RENDER_DEFAULTS.bokehAperture },
    uBloomEnabled: { value: effects.includes('bloom') },
    uBloomStrength: { value: resolveBrowserBloomStrength(quality.bloomStrength) },
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
    uSamples: { value: resolveBrowserGodRaySamples(quality.godRaysSamples) },
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

export const resolveBrowserGodRaySamples = (value: number): number => {
  if (!Number.isFinite(value)) {
    return MIN_GOD_RAY_SAMPLES
  }
  return Math.max(MIN_GOD_RAY_SAMPLES, Math.min(MAX_GOD_RAY_SAMPLES, Math.trunc(value)))
}

export const resolveBrowserBloomStrength = (value: number): number => {
  if (!Number.isFinite(value)) {
    return MIN_BLOOM_STRENGTH
  }
  return Math.max(MIN_BLOOM_STRENGTH, Math.min(MAX_BLOOM_STRENGTH, value))
}

export type BrowserRenderTargetKind = 'hdr' | 'ldr'

export const browserRenderTargetKind = (quality: GraphicsQuality): BrowserRenderTargetKind =>
  qualityUsesHdrRenderTarget(quality) ? 'hdr' : 'ldr'

export const resolveBrowserRenderTargetValue = <Value>(
  quality: GraphicsQuality,
  hdrValue: Value,
  ldrValue: Value,
): Value => (browserRenderTargetKind(quality) === 'hdr' ? hdrValue : ldrValue)

export const browserDepthTextureOption = <Texture>(
  enabled: boolean,
  makeTexture: () => Texture,
): { readonly depthTexture?: Texture } =>
  enabled ? { depthTexture: makeTexture() } : {}

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
  clientWidth: number,
  clientHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): BrowserViewport => ({
  height: Math.max(MIN_VIEWPORT_SIZE, Math.floor(clientHeight || canvasHeight || MIN_VIEWPORT_SIZE)),
  width: Math.max(MIN_VIEWPORT_SIZE, Math.floor(clientWidth || canvasWidth || MIN_VIEWPORT_SIZE)),
})

export const resolveBrowserDrawingBufferSize = (
  width: number,
  height: number,
): BrowserViewport => ({
  width: Math.max(MIN_VIEWPORT_SIZE, Math.floor(width)),
  height: Math.max(MIN_VIEWPORT_SIZE, Math.floor(height)),
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
export type BrowserWaterVisibility<T extends BrowserWaterMesh> = ReadonlyArray<readonly [T, boolean]>

export const captureBrowserWaterVisibility = <T extends BrowserWaterMesh>(
  waterMeshes: ReadonlySet<T>,
): BrowserWaterVisibility<T> =>
  [...waterMeshes].map((mesh): readonly [T, boolean] => [mesh, mesh.visible])

export const hideBrowserWaterMeshes = <T extends BrowserWaterMesh>(
  waterMeshes: ReadonlySet<T>,
): void => {
  for (const mesh of waterMeshes) {
    mesh.visible = false
  }
}

export const restoreBrowserWaterVisibility = <T extends BrowserWaterMesh>(
  visibility: BrowserWaterVisibility<T>,
): void => {
  for (const [mesh, visible] of visibility) {
    mesh.visible = visible
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

export const measureBrowserStage = <A>(
  performanceApi: BrowserPerformanceApi | undefined,
  name: string,
  run: () => A,
): A => {
  if (
    !performanceApi ||
    typeof performanceApi.mark !== 'function' ||
    typeof performanceApi.measure !== 'function' ||
    typeof performanceApi.clearMarks !== 'function'
  ) {
    return run()
  }
  const startMark = `${name}:start`
  const endMark = `${name}:end`
  performanceApi.mark(startMark)
  try {
    return run()
  } finally {
    performanceApi.mark(endMark)
    performanceApi.measure(name, startMark, endMark)
    performanceApi.clearMarks(startMark)
    performanceApi.clearMarks(endMark)
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
      kind: 'query',
      extension: {
        GPU_DISJOINT_EXT: value.GPU_DISJOINT_EXT,
        TIME_ELAPSED_EXT: value.TIME_ELAPSED_EXT,
      },
    }
  }
  return { kind: 'fallback' }
}

export const millisecondsFromGpuNanoseconds = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return Math.max(0, value) / 1_000_000
}

export const shouldCaptureBrowserRefraction = (
  quality: GraphicsQuality,
  visibleWaterMeshCount: number,
  waterScreenRatio: number,
  frameNumber: number,
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
    state: result.state,
    skipSsim: result.change !== 'none',
  }
}

export type BrowserSsimQualityTransition = {
  readonly change: 'downgrade' | 'none'
  readonly preset: QualityPreset
  readonly skipSsim: false
  readonly state: SsimAdaptiveQualityState
}

export const advanceBrowserSsimQuality = (
  state: SsimAdaptiveQualityState,
  preset: QualityPreset,
  ssim: number,
  skipSsim: boolean,
): BrowserSsimQualityTransition => {
  if (skipSsim) {
    return { change: 'none', preset, skipSsim: false, state }
  }
  const result = advanceSsimAdaptiveQuality(state, preset, ssim)
  return { ...result, skipSsim: false }
}

const luminanceAt = (pixels: DataView, offset: number): number =>
  0.2126 * pixels.getUint8(offset) +
  0.7152 * pixels.getUint8(offset + 1) +
  0.0722 * pixels.getUint8(offset + 2)

export const structuralSimilarity = (
  left: Uint8Array,
  right: Uint8Array,
  width: number,
  height: number,
): number => {
  if (left.length !== right.length || left.length !== width * height * 4) {
    throw new Error('SSIM inputs must be equally sized RGBA images')
  }
  const leftPixels = new DataView(left.buffer, left.byteOffset, left.byteLength)
  const rightPixels = new DataView(right.buffer, right.byteOffset, right.byteLength)
  const c1 = (SSIM_K1 * SSIM_LUMINANCE_RANGE) ** 2
  const c2 = (SSIM_K2 * SSIM_LUMINANCE_RANGE) ** 2
  let windowScoreTotal = 0
  let windowCount = 0
  for (let top = 0; top < height; top += SSIM_WINDOW_SIZE) {
    for (let leftEdge = 0; leftEdge < width; leftEdge += SSIM_WINDOW_SIZE) {
      const values: Array<readonly [number, number]> = []
      for (let y = top; y < Math.min(top + SSIM_WINDOW_SIZE, height); y += 1) {
        for (let x = leftEdge; x < Math.min(leftEdge + SSIM_WINDOW_SIZE, width); x += 1) {
          const offset = (y * width + x) * 4
          values.push([luminanceAt(leftPixels, offset), luminanceAt(rightPixels, offset)])
        }
      }
      const meanLeft = values.reduce((sum, [value]) => sum + value, 0) / values.length
      const meanRight = values.reduce((sum, [, value]) => sum + value, 0) / values.length
      let varianceLeft = 0
      let varianceRight = 0
      let covariance = 0
      for (const [valueLeft, valueRight] of values) {
        const deltaLeft = valueLeft - meanLeft
        const deltaRight = valueRight - meanRight
        varianceLeft += deltaLeft ** 2
        varianceRight += deltaRight ** 2
        covariance += deltaLeft * deltaRight
      }
      const divisor = Math.max(1, values.length - 1)
      varianceLeft /= divisor
      varianceRight /= divisor
      covariance /= divisor
      windowScoreTotal +=
        ((2 * meanLeft * meanRight + c1) * (2 * covariance + c2)) /
        ((meanLeft ** 2 + meanRight ** 2 + c1) * (varianceLeft + varianceRight + c2))
      windowCount += 1
    }
  }
  return windowScoreTotal / windowCount
}
