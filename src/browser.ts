import * as THREE from 'three'
import {
  type GraphicsQuality,
  type PostProcessingPass,
  type PostProcessingStep,
  type QualityPreset,
} from './domain/post-processing.js'
import { createAdaptiveQualityState } from './domain/adaptive-quality.js'
import { createSsimAdaptiveQualityState } from './domain/ssim-adaptive-quality.js'
import {
  type PostProcessingRendererFactory,
} from './application/world-renderer.js'
import {
  type ProductionFrame,
  type ProductionWorldRenderer,
  type ProductionWorldRendererOptions,
  makeProductionWorldRenderer,
} from './application/world-renderer-production.js'
import { type RgbaAtlas, generateTerrainAtlas } from './domain/texture-atlas.js'
import {
  BROWSER_RENDER_DEFAULTS,
  advanceBrowserFpsQuality,
  advanceBrowserSsimQuality,
  browserDepthTextureOption,
  browserPostProcessingChainKey,
  browserPostProcessingChain,
  captureBrowserWaterVisibility,
  createBrowserCompositeShader,
  createBrowserGodRaysShader,
  hideBrowserWaterMeshes,
  assertBrowserRuntimeActive,
  isBrowserScreenshotShortcut,
  millisecondsFromGpuNanoseconds,
  measureBrowserStage,
  resolveBrowserBloomStrength,
  resolveBrowserDrawingBufferSize,
  resolveBrowserMaxPixelRatio,
  resolveBrowserPixelRatio,
  resolveBrowserQuality,
  resolveBrowserRenderTargetValue,
  resolveBrowserLatestGpuTime,
  resolveBrowserRefractionTargetSize,
  resolveBrowserViewport,
  requireBrowserRuntimeValue,
  restoreBrowserWaterVisibility,
  selectGpuTimer,
  shouldCaptureBrowserRefraction,
  setBrowserWaterRefractionUniforms,
  structuralSimilarity,
} from './domain/browser-render-policy.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { Context, Effect, Layer } from 'effect'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import type { MirroredCameraState } from './domain/camera-mirror.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { Viewport } from './domain/render-environment.js'
import { measureWaterVisibility } from './browser-water-visibility.js'

const requireRenderer = (value: unknown): THREE.WebGLRenderer => {
  if (value instanceof THREE.WebGLRenderer) { return value }
  throw new Error('Browser surface did not provide a THREE.WebGLRenderer')
}

const requireScene = (value: unknown): THREE.Scene => {
  if (value instanceof THREE.Scene) { return value }
  throw new Error('Browser surface did not provide a THREE.Scene')
}

const requirePerspectiveCamera = (value: unknown): THREE.PerspectiveCamera => {
  if (value instanceof THREE.PerspectiveCamera) { return value }
  throw new Error('Browser surface did not provide a THREE.PerspectiveCamera')
}

const DEFAULT_BLOOM_RADIUS = 0.4
const DEFAULT_BLOOM_THRESHOLD = 0.85
const EMPTY_WATER_MESH_COUNT = 0
const FRAME_NUMBER_INCREMENT = 1
const TIMER_QUERY_EXTENSION = 'EXT_disjoint_timer_query_webgl2'
const SCREENSHOT_FILENAME = 'mc-render-screenshot.png'

const isWebGl2Context = (
  context: WebGLRenderingContext | WebGL2RenderingContext,
): context is WebGL2RenderingContext =>
  'createQuery' in context &&
  'beginQuery' in context &&
  'endQuery' in context &&
  'getQueryParameter' in context

export type GpuTimerServiceFailure = { readonly cause: unknown }

export type GpuTimerServiceApi = {
  readonly supported: boolean
  readonly begin: Effect.Effect<void, GpuTimerServiceFailure>
  readonly end: Effect.Effect<void, GpuTimerServiceFailure>
  readonly poll: Effect.Effect<number | undefined, GpuTimerServiceFailure>
  readonly dispose: Effect.Effect<void, GpuTimerServiceFailure>
}

const GpuTimerServiceBase: Context.ServiceClass<
  GpuTimerService,
  '@nerima-games/mc-render/GpuTimerService',
  GpuTimerServiceApi
> = Context.Service<GpuTimerService, GpuTimerServiceApi>()(
  '@nerima-games/mc-render/GpuTimerService',
)

export class GpuTimerService extends GpuTimerServiceBase {}

const tryGpuTimerOperation = <A>(run: () => A): Effect.Effect<A, GpuTimerServiceFailure> =>
  Effect.try({
    try: run,
    catch: (cause) => ({ cause }),
  })

export const makeGpuTimerService = (gl: WebGL2RenderingContext): Effect.Effect<
  GpuTimerServiceApi,
  GpuTimerServiceFailure
> =>
  Effect.gen(function* makeGpuTimerServiceEffect() {
    const extensionValue: unknown = yield* tryGpuTimerOperation(() =>
      gl.getExtension(TIMER_QUERY_EXTENSION),
    )
    const timerSelection = selectGpuTimer(extensionValue)
    const extension = timerSelection.kind === 'query' ? timerSelection.extension : undefined
    let activeQuery: WebGLQuery | undefined = undefined
    let pendingQuery: WebGLQuery | undefined = undefined

    const begin = Effect.gen(function* beginGpuTimer() {
      if (!extension || activeQuery || pendingQuery) {
        return
      }
      const query = yield* tryGpuTimerOperation(() => gl.createQuery())
      if (query) {
        yield* tryGpuTimerOperation(() => gl.beginQuery(extension.TIME_ELAPSED_EXT, query))
        activeQuery = query
      }
    })

    const end = Effect.gen(function* endGpuTimer() {
      if (!extension || !activeQuery) {
        return
      }
      yield* tryGpuTimerOperation(() => gl.endQuery(extension.TIME_ELAPSED_EXT))
      pendingQuery = activeQuery
      activeQuery = undefined
    })

    const poll = Effect.gen(function* pollGpuTimer() {
      if (!extension || !pendingQuery) {
        return undefined
      }
      const query = pendingQuery
      const available: unknown = yield* tryGpuTimerOperation(() =>
        gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE),
      )
      if (available !== true) {
        return undefined
      }
      const disjoint: unknown = yield* tryGpuTimerOperation(() =>
        gl.getParameter(extension.GPU_DISJOINT_EXT),
      )
      if (disjoint === true) {
        yield* tryGpuTimerOperation(() => gl.deleteQuery(query))
        pendingQuery = undefined
        return undefined
      }
      const elapsedNanoseconds: unknown = yield* tryGpuTimerOperation(() =>
        gl.getQueryParameter(query, gl.QUERY_RESULT),
      )
      yield* tryGpuTimerOperation(() => gl.deleteQuery(query))
      pendingQuery = undefined
      return millisecondsFromGpuNanoseconds(elapsedNanoseconds)
    })

    const dispose = Effect.gen(function* disposeGpuTimer() {
      if (!extension) {
        return
      }
      const query = activeQuery
      if (query) {
        yield* tryGpuTimerOperation(() => gl.endQuery(extension.TIME_ELAPSED_EXT))
        yield* tryGpuTimerOperation(() => gl.deleteQuery(query))
        activeQuery = undefined
      }
      const pending = pendingQuery
      if (pending) {
        yield* tryGpuTimerOperation(() => gl.deleteQuery(pending))
        pendingQuery = undefined
      }
    })

    return { begin, dispose, end, poll, supported: extension !== undefined }
  })

export const GpuTimerServiceLayer = (
  gl: WebGL2RenderingContext,
): Layer.Layer<GpuTimerService, GpuTimerServiceFailure> =>
  Layer.effect(GpuTimerService, makeGpuTimerService(gl))

const runBrowserOperation = <A>(run: () => A): A =>
  Effect.runSync(Effect.try({ try: run, catch: (cause) => cause }))

export type BrowserFrame = {
  readonly camera: MirroredCameraState
  readonly frame?: ProductionFrame
}

export type BrowserWorldRuntimeOptions = {
  readonly canvas: HTMLCanvasElement
  readonly atlas?: THREE.Texture | RgbaAtlas | string
  readonly quality?: QualityPreset | GraphicsQuality
  readonly maxPixelRatio?: number
  readonly autoResize?: boolean
  /** Defaults to true so `captureScreenshot` remains valid after rendering. */
  readonly preserveDrawingBuffer?: boolean
  readonly waterGeometry?: THREE.BufferGeometry
  readonly world?: Omit<ProductionWorldRendererOptions, 'postProcessing' | 'preserveDrawingBuffer'>
}

export type BrowserWorldRuntime = {
  readonly quality: GraphicsQuality
  readonly qualityPreset: QualityPreset | undefined
  readonly world: ProductionWorldRenderer<THREE.ShaderMaterial>
  readonly threeRenderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
  readonly gpuTimingSupported: boolean
  readonly latestGpuTimeMs: number | undefined
  readonly latestSsim: number | undefined
  readonly waterMeshes: ReadonlyArray<THREE.Mesh>
  readonly attachWaterSurface: (geometry: THREE.BufferGeometry) => THREE.Mesh
  readonly detachWaterSurface: (mesh: THREE.Mesh) => void
  readonly resize: () => void
  readonly render: (camera: MirroredCameraState) => void
  readonly advanceFrame: (frame: ProductionFrame) => void
  readonly captureScreenshot: () => Promise<Blob>
  readonly start: (readFrame: () => BrowserFrame | undefined) => void
  readonly stop: () => void
  readonly dispose: () => void
}

const measureViewport = (canvas: HTMLCanvasElement): Viewport =>
  resolveBrowserViewport(canvas.clientWidth, canvas.clientHeight, canvas.width, canvas.height)

const configureAtlasTexture = (texture: THREE.Texture): void => {
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = false
}

const makeAtlasTexture = (atlas: RgbaAtlas): THREE.DataTexture => {
  const texture = new THREE.DataTexture(
    Uint8Array.from(atlas.data),
    atlas.width,
    atlas.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  )
  configureAtlasTexture(texture)
  texture.needsUpdate = true
  return texture
}

const resolveAtlas = async (
  source: BrowserWorldRuntimeOptions['atlas'],
): Promise<{ readonly owned: boolean; readonly texture: THREE.Texture }> => {
  if (source instanceof THREE.Texture) {
    return { owned: false, texture: source }
  }
  if (typeof source === 'string') {
    const texture = await new THREE.TextureLoader().loadAsync(source)
    configureAtlasTexture(texture)
    return { owned: true, texture }
  }
  return {
    owned: true,
    texture: makeAtlasTexture(source ?? generateTerrainAtlas()),
  }
}

type BrowserSurface = {
  readonly renderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
}

type ViewportPostProcessingPass = Extract<PostProcessingPass, 'bloom' | 'bokeh' | 'gtao'>

type ViewportPassContext = {
  readonly camera: THREE.PerspectiveCamera
  readonly quality: GraphicsQuality
  readonly scene: THREE.Scene
  readonly viewport: Viewport
}

const createViewportPass = (
  effect: ViewportPostProcessingPass,
  { camera, quality, scene, viewport }: ViewportPassContext,
): Pass => {
  switch (effect) {
    case 'bloom':
      return new UnrealBloomPass(
        new THREE.Vector2(viewport.width, viewport.height),
        resolveBrowserBloomStrength(quality.bloomStrength),
        DEFAULT_BLOOM_RADIUS,
        DEFAULT_BLOOM_THRESHOLD,
      )
    case 'bokeh':
      return new BokehPass(scene, camera, {
        aperture: BROWSER_RENDER_DEFAULTS.bokehAperture,
        aspect: viewport.width / viewport.height,
        focus: BROWSER_RENDER_DEFAULTS.bokehFocus,
        maxblur: BROWSER_RENDER_DEFAULTS.bokehMaxBlur,
      })
    case 'gtao':
      return new GTAOPass(scene, camera, viewport.width, viewport.height)
  }
}

const disposeComposerPasses = (composer: EffectComposer): void => {
  for (const pass of [...composer.passes]) {
    composer.removePass(pass)
    pass.dispose()
  }
}

type ComposerOptions = {
  readonly getPixelRatio: () => number
  readonly getViewport: () => Viewport
  readonly quality: GraphicsQuality
  readonly renderer: THREE.WebGLRenderer
}

type BrowserGpuTiming = {
  readonly service: GpuTimerServiceApi
  latestGpuTimeMs: number | undefined
}

type BrowserScreenshotFrame = {
  readonly height: number
  readonly pixels: Uint8Array
  readonly width: number
}

const createComposer = ({
  getPixelRatio,
  getViewport,
  quality,
  renderer,
}: ComposerOptions): EffectComposer => {
  const viewport = getViewport()
  const renderTarget = new THREE.WebGLRenderTarget(viewport.width, viewport.height, {
    type: resolveBrowserRenderTargetValue(quality, THREE.HalfFloatType, THREE.UnsignedByteType),
    ...browserDepthTextureOption(quality.dofEnabled, () => new THREE.DepthTexture(viewport.width, viewport.height)),
  })
  const composer = new EffectComposer(renderer, renderTarget)
  composer.setPixelRatio(getPixelRatio())
  composer.setSize(viewport.width, viewport.height)
  return composer
}

const createCompositePass = (
  effects: ReadonlyArray<PostProcessingPass>,
  { getPixelRatio, getViewport, quality, camera }: Omit<ComposerOptions, 'renderer'> & {
    readonly camera: THREE.PerspectiveCamera
  },
): ShaderPass => {
  const pass = new ShaderPass(
    createBrowserCompositeShader(
      effects,
      quality,
      getViewport(),
      camera,
      (x, y) => new THREE.Vector2(x, y),
    ),
  )
  const render = pass.render.bind(pass)
  pass.render = (...args) => {
    const depth = args[2].depthTexture
    const depthUniform = pass.uniforms['tDepth']
    if (depthUniform) {
      depthUniform.value = depth
    }
    render(...args)
  }
  const setSize = pass.setSize.bind(pass)
  pass.setSize = (width, height) => {
    setSize(width, height)
    const resolution = pass.uniforms['uResolution']?.value
    if (resolution instanceof THREE.Vector2) {
      resolution.set(width, height)
    }
  }
  const resolution = pass.uniforms['uResolution']?.value
  if (resolution instanceof THREE.Vector2) {
    const viewport = getViewport()
    resolution.set(viewport.width * getPixelRatio(), viewport.height * getPixelRatio())
  }
  return pass
}

const createPostProcessingFactory = ({
  getPixelRatio,
  getViewport,
  onSurface,
  getQuality,
  captureRefraction,
  onGpuTiming,
  onPresentedImage,
  onSsim,
}: Omit<ComposerOptions, 'quality' | 'renderer'> & {
  readonly getQuality: () => GraphicsQuality
  readonly onSurface: (surface: BrowserSurface) => void
  readonly captureRefraction: (surface: BrowserSurface) => void
  readonly onGpuTiming: (timing: BrowserGpuTiming) => void
  readonly onPresentedImage: (image: BrowserScreenshotFrame) => void
  readonly onSsim: (ssim: number) => void
}): PostProcessingRendererFactory => (surface) => {
  const renderer = requireRenderer(surface.renderer)
  const scene = requireScene(surface.scene)
  const camera = requirePerspectiveCamera(surface.camera)
  const browserSurface = { camera, renderer, scene }
  onSurface(browserSurface)
  const context = renderer.getContext()
  if (!isWebGl2Context(context)) {
    throw new Error('Browser renderer requires a WebGL2 context')
  }
  const gl = context
  const gpuTimerService = Effect.runSync(
    Effect.gen(function* acquireGpuTimerService() {
      return yield* GpuTimerService
    }).pipe(Effect.provide(GpuTimerServiceLayer(gl))),
  )
  const gpuTiming: BrowserGpuTiming = { latestGpuTimeMs: undefined, service: gpuTimerService }
  onGpuTiming(gpuTiming)

  const createComposerFor = (quality: GraphicsQuality): EffectComposer =>
    createComposer({ getPixelRatio, getViewport, quality, renderer })
  let composer = createComposerFor(getQuality())
  let composerQuality = getQuality()
  const referenceQuality = resolveBrowserQuality('ultra').quality
  const referenceComposer = createComposerFor(referenceQuality)
  referenceComposer.renderToScreen = false
  let readbackTarget: THREE.WebGLRenderTarget | undefined = undefined
  const copyMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(tDiffuse, vUv);
      }
    `,
  })
  const copyQuad = new FullScreenQuad(copyMaterial)
  let referenceKey = ''
  let currentKey = ''

  const createPass = (step: PostProcessingStep, quality: GraphicsQuality): Pass => {
    switch (step.pass) {
      case 'render':
        return new RenderPass(scene, camera)
      case 'gtao':
      case 'bloom':
      case 'bokeh':
        return createViewportPass(step.pass, { camera, quality, scene, viewport: getViewport() })
      case 'godRays':
        return new ShaderPass(
          createBrowserGodRaysShader(quality.godRaysSamples, (x, y) => new THREE.Vector2(x, y)),
        )
      case 'composite':
        return createCompositePass(step.effects, { getPixelRatio, getViewport, quality, camera })
      case 'smaa':
        return new SMAAPass()
      case 'output':
        return new OutputPass()
    }
  }

  const installChain = (
    target: EffectComposer,
    chain: ReadonlyArray<PostProcessingStep>,
    quality: GraphicsQuality,
    installedKey: string,
  ): string => {
    const key = browserPostProcessingChainKey(chain)
    if (key === installedKey) {
      return installedKey
    }
    disposeComposerPasses(target)
    for (const step of chain) {
      target.addPass(createPass(step, quality))
    }
    return key
  }

  const ensureComposerQuality = (): void => {
    const nextQuality = getQuality()
    if (nextQuality === composerQuality) {
      return
    }
    disposeComposerPasses(composer)
    composer.dispose()
    composer = createComposerFor(nextQuality)
    composerQuality = nextQuality
    currentKey = ''
  }

  const ensureReadbackTarget = (): {
    readonly height: number
    readonly target: THREE.WebGLRenderTarget
    readonly width: number
  } => {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2())
    const { height, width } = resolveBrowserDrawingBufferSize(size.x, size.y)
    let target: THREE.WebGLRenderTarget
    if (readbackTarget) {
      target = readbackTarget
      readbackTarget.setSize(width, height)
    } else {
      target = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: false,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
      })
      readbackTarget = target
    }
    return { height, target, width }
  }

  const readPresentedImage = (width: number, height: number): Uint8Array => {
    const pixels = new Uint8Array(width * height * 4)
    runBrowserOperation(() => renderer.setRenderTarget(null))
    runBrowserOperation(() =>
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels),
    )
    return pixels
  }

  const readReferenceImage = (
    readback: THREE.WebGLRenderTarget,
    width: number,
    height: number,
  ): Uint8Array => {
    const source = referenceComposer.readBuffer.texture
    const previousTarget = runBrowserOperation(() => renderer.getRenderTarget())
    try {
      const diffuseUniform = copyMaterial.uniforms['tDiffuse']
      if (diffuseUniform) {
        diffuseUniform.value = source
      }
      runBrowserOperation(() => renderer.setRenderTarget(readback))
      runBrowserOperation(() => renderer.clear(true, true, true))
      runBrowserOperation(() => copyQuad.render(renderer))
      const pixels = new Uint8Array(width * height * 4)
      runBrowserOperation(() =>
        renderer.readRenderTargetPixels(readback, 0, 0, width, height, pixels),
      )
      return pixels
    } finally {
      runBrowserOperation(() => renderer.setRenderTarget(previousTarget))
    }
  }

  const drawAndCompare = (chain: ReadonlyArray<PostProcessingStep>): void => {
    const priorSample = Effect.runSync(gpuTimerService.poll)
    gpuTiming.latestGpuTimeMs = resolveBrowserLatestGpuTime(gpuTiming.latestGpuTimeMs, priorSample)
    ensureComposerQuality()
    currentKey = installChain(composer, chain, composerQuality, currentKey)
    referenceKey = installChain(
      referenceComposer,
      browserPostProcessingChain(referenceQuality),
      referenceQuality,
      referenceKey,
    )
    const { height, target, width } = ensureReadbackTarget()
    Effect.runSync(gpuTimerService.begin)
    try {
      captureRefraction(browserSurface)
      composer.render()
      const activePixels = readPresentedImage(width, height)
      onPresentedImage({ height, pixels: activePixels, width })
      referenceComposer.render()
      const referencePixels = readReferenceImage(target, width, height)
      onSsim(structuralSimilarity(activePixels, referencePixels, width, height))
    } finally {
      Effect.runSync(gpuTimerService.end)
    }
  }

  return {
    dispose: () => {
      disposeComposerPasses(composer)
      composer.dispose()
      disposeComposerPasses(referenceComposer)
      referenceComposer.dispose()
      copyQuad.dispose()
      copyMaterial.dispose()
      readbackTarget?.dispose()
      Effect.runSync(gpuTimerService.dispose)
    },
    render: (chain) => {
      drawAndCompare(chain)
    },
    resize: (width, height) => {
      composer.setPixelRatio(getPixelRatio())
      composer.setSize(width, height)
      referenceComposer.setPixelRatio(getPixelRatio())
      referenceComposer.setSize(width, height)
      if (readbackTarget) {
        ensureReadbackTarget()
      }
    },
  }
}

type BrowserWorld = ProductionWorldRenderer<THREE.ShaderMaterial>
type BrowserWaterUniforms = BrowserWorld['waterUniforms']
type AtlasResource = Awaited<ReturnType<typeof resolveAtlas>>

type BrowserRuntimeState = {
  adaptiveQualityState: ReturnType<typeof createAdaptiveQualityState>
  maxPixelRatio: number
  pixelRatio: number
  quality: GraphicsQuality
  qualityPreset: QualityPreset | undefined
  skipSsimForCurrentFrame: boolean
  ssimAdaptiveQualityState: ReturnType<typeof createSsimAdaptiveQualityState>
  latestSsim: number | undefined
  lastPresentedFrame: BrowserScreenshotFrame | undefined
  viewport: Viewport
  waterMeshes: Set<THREE.Mesh>
}

type BrowserRuntimeActivity = {
  animationFrame: number | undefined
  disposed: boolean
  resizeObserver: ResizeObserver | undefined
}

type BrowserRefractionController = {
  readonly capture: (context: BrowserSurface) => void
  readonly dispose: () => void
  readonly resize: () => void
}

type BrowserWorldInitialization = {
  readonly applyPreset: (preset: QualityPreset) => void
  readonly gpuTiming: BrowserGpuTiming
  readonly refraction: BrowserRefractionController
  readonly surface: BrowserSurface
  readonly world: BrowserWorld
}

type BrowserWorldInitializationOptions = {
  readonly atlas: AtlasResource
  readonly options: BrowserWorldRuntimeOptions
  readonly state: BrowserRuntimeState
}

type BrowserRuntimeResources = {
  readonly atlas: AtlasResource
  readonly applyPreset: (preset: QualityPreset) => void
  readonly gpuTiming: BrowserGpuTiming
  readonly refraction: BrowserRefractionController
  readonly state: BrowserRuntimeState
  readonly surface: BrowserSurface
  readonly world: BrowserWorld
}

const makeRuntimeState = (
  canvas: HTMLCanvasElement,
  quality: GraphicsQuality,
  qualityPreset: QualityPreset | undefined,
  maxPixelRatio: number,
): BrowserRuntimeState => ({
  adaptiveQualityState: createAdaptiveQualityState(),
  latestSsim: undefined,
  lastPresentedFrame: undefined,
  maxPixelRatio,
  pixelRatio: resolveBrowserPixelRatio(maxPixelRatio, globalThis.devicePixelRatio),
  quality,
  qualityPreset,
  skipSsimForCurrentFrame: false,
  ssimAdaptiveQualityState: createSsimAdaptiveQualityState(),
  viewport: measureViewport(canvas),
  waterMeshes: new Set<THREE.Mesh>(),
})

const resolveRefractionTargetSize = (
  state: BrowserRuntimeState,
): { readonly height: number; readonly key: string; readonly width: number } =>
  resolveBrowserRefractionTargetSize(state.viewport, state.pixelRatio)

const createRefractionTarget = (
  quality: GraphicsQuality,
  size: { readonly height: number; readonly width: number },
): THREE.WebGLRenderTarget => {
  const target = new THREE.WebGLRenderTarget(size.width, size.height, {
    depthBuffer: true,
    format: THREE.RGBAFormat,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    stencilBuffer: false,
    type: resolveBrowserRenderTargetValue(quality, THREE.HalfFloatType, THREE.UnsignedByteType),
  })
  target.texture.generateMipmaps = false
  return target
}

const renderToRefractionTarget = (
  renderer: THREE.WebGLRenderer,
  context: BrowserSurface,
  target: THREE.WebGLRenderTarget,
): void => {
  renderer.setRenderTarget(target)
  renderer.clear()
  renderer.render(requireScene(context.scene), context.camera)
}

const renderRefractionScene = (
  context: BrowserSurface,
  target: THREE.WebGLRenderTarget,
  waterMeshes: ReadonlySet<THREE.Mesh>,
): boolean => {
  const renderer = requireRenderer(context.renderer)
  const previousTarget = runBrowserOperation(() => renderer.getRenderTarget())
  const visibility = captureBrowserWaterVisibility(waterMeshes)
  hideBrowserWaterMeshes(waterMeshes)
  try {
    runBrowserOperation(() => renderToRefractionTarget(renderer, context, target))
    return true
  } finally {
    runBrowserOperation(() => renderer.setRenderTarget(previousTarget))
    restoreBrowserWaterVisibility(visibility)
  }
}

type RefractionVisibilityContext = {
  readonly camera: THREE.Camera
  readonly frameNumber: number
  readonly state: BrowserRuntimeState
}

const shouldCaptureRefraction = ({
  camera,
  frameNumber,
  state,
}: RefractionVisibilityContext): boolean => {
  const { screenRatio, visibleMeshCount } = measureWaterVisibility(state.waterMeshes, camera)
  return shouldCaptureBrowserRefraction(state.quality, visibleMeshCount, screenRatio, frameNumber)
}

const createRefractionController = (
  state: BrowserRuntimeState,
  getUniforms: () => BrowserWaterUniforms,
): BrowserRefractionController => {
  let target: THREE.WebGLRenderTarget | undefined = undefined
  let targetKey = ''
  let targetQuality: GraphicsQuality | undefined = undefined
  let frameNumber = 0

  const ensureTarget = (): THREE.WebGLRenderTarget => {
    const size = resolveRefractionTargetSize(state)
    if (target && targetKey === size.key && targetQuality === state.quality) {
      return target
    }
    target?.dispose()
    target = createRefractionTarget(state.quality, size)
    targetKey = size.key
    targetQuality = state.quality
    return target
  }

  const capture = (context: BrowserSurface): void => {
    frameNumber += FRAME_NUMBER_INCREMENT
    const uniforms = getUniforms()
    if (state.waterMeshes.size === EMPTY_WATER_MESH_COUNT) {
      setBrowserWaterRefractionUniforms(uniforms, null, false)
      return
    }
    if (
      !shouldCaptureRefraction({
        camera: context.camera,
        frameNumber,
        state,
      })
    ) {
      return
    }
    const nextTarget = ensureTarget()
    const rendered = renderRefractionScene(context, nextTarget, state.waterMeshes)
    setBrowserWaterRefractionUniforms(uniforms, nextTarget.texture, rendered)
  }

  const resize = (): void => {
    if (!target) {
      return
    }
    const size = resolveRefractionTargetSize(state)
    target.setSize(size.width, size.height)
    targetKey = size.key
  }

  const dispose = (): void => {
    target?.dispose()
    target = undefined
    targetKey = ''
    targetQuality = undefined
  }

  return { capture, dispose, resize }
}

const createBrowserWorldOptions = (
  options: BrowserWorldRuntimeOptions,
  postProcessing: PostProcessingRendererFactory,
): ProductionWorldRendererOptions => ({
  ...options.world,
  postProcessing,
})

const initializeBrowserWorld = ({
  atlas,
  options,
  state,
}: BrowserWorldInitializationOptions): BrowserWorldInitialization => {
  const buildState: {
    gpuTiming: BrowserGpuTiming | undefined
    surface: BrowserSurface | undefined
    world: BrowserWorld | undefined
  } = { gpuTiming: undefined, surface: undefined, world: undefined }
  let world: BrowserWorld
  const refraction = createRefractionController(state, () => {
    const { world } = buildState
    if (!world) {
      throw new Error('browser world surface was not initialized')
    }
    return world.waterUniforms
  })
  const applyPreset = (preset: QualityPreset): void => {
    state.qualityPreset = preset
    state.quality = resolveBrowserQuality(preset).quality
    state.maxPixelRatio = resolveBrowserMaxPixelRatio(options.maxPixelRatio, state.quality.pixelRatioCap)
    state.pixelRatio = resolveBrowserPixelRatio(state.maxPixelRatio, globalThis.devicePixelRatio)
    buildState.surface?.renderer.setPixelRatio(state.pixelRatio)
    refraction.resize()
    Effect.runSync(world.setPostProcessingChain(browserPostProcessingChain(state.quality)))
    Effect.runSync(world.resize(state.viewport.width, state.viewport.height))
  }
  const postProcessing = createPostProcessingFactory({
    getPixelRatio: () => state.pixelRatio,
    getViewport: () => state.viewport,
    getQuality: () => state.quality,
    captureRefraction: refraction.capture,
    onSurface: (nextSurface) => {
      buildState.surface = nextSurface
    },
    onGpuTiming: (timing) => {
      buildState.gpuTiming = timing
    },
    onPresentedImage: (image) => {
      state.lastPresentedFrame = image
    },
    onSsim: (ssim) => {
      state.latestSsim = ssim
      const currentPreset = state.qualityPreset
      if (!currentPreset) {
        return
      }
      const result = advanceBrowserSsimQuality(
        state.ssimAdaptiveQualityState,
        currentPreset,
        ssim,
        state.skipSsimForCurrentFrame,
      )
      state.ssimAdaptiveQualityState = result.state
      state.skipSsimForCurrentFrame = result.skipSsim
      if (result.change !== 'none') {
        applyPreset(result.preset)
      }
    },
  })
  const worldOptions = createBrowserWorldOptions(options, postProcessing)
  world = Effect.runSync(
    makeProductionWorldRenderer<
      HTMLCanvasElement,
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial,
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >(THREE, options.canvas, state.viewport, atlas.texture, worldOptions),
  )
  buildState.world = world
  Effect.runSync(world.setPostProcessingChain(browserPostProcessingChain(state.quality)))
  const surface = requireBrowserRuntimeValue(
    buildState.surface,
    'browser world did not expose its Three surface',
  )
  const gpuTiming = requireBrowserRuntimeValue(
    buildState.gpuTiming,
    'browser world did not initialize GPU timing',
  )
  return { applyPreset, gpuTiming, refraction, surface, world }
}

const makeRuntimeActivity = (): BrowserRuntimeActivity => ({
  animationFrame: undefined,
  disposed: false,
  resizeObserver: undefined,
})

const createResizeHandler = (
  options: BrowserWorldRuntimeOptions,
  resources: BrowserRuntimeResources,
  activity: BrowserRuntimeActivity,
): (() => void) => (): void => {
  assertBrowserRuntimeActive(activity.disposed)
  resources.state.viewport = measureViewport(options.canvas)
  resources.state.pixelRatio = resolveBrowserPixelRatio(resources.state.maxPixelRatio, globalThis.devicePixelRatio)
  resources.surface.renderer.setPixelRatio(resources.state.pixelRatio)
  Effect.runSync(resources.world.resize(resources.state.viewport.width, resources.state.viewport.height))
  resources.refraction.resize()
}

type FrameHandlers = {
  readonly advanceFrame: (frame: ProductionFrame) => void
  readonly render: (camera: MirroredCameraState) => void
}

const createFrameHandlers = (
  resources: BrowserRuntimeResources,
  activity: BrowserRuntimeActivity,
): FrameHandlers => {
  const advanceFrame = (frame: ProductionFrame): void => {
    assertBrowserRuntimeActive(activity.disposed)
    measureBrowserStage(globalThis.performance, 'render.browser.advanceFrame', () => {
      Effect.runSync(resources.world.advanceFrame(frame))
      const currentPreset = resources.state.qualityPreset
      if (!currentPreset) {
        return
      }
      const fps = frame.deltaSecs > 0 ? 1 / frame.deltaSecs : Number.NaN
      const result = advanceBrowserFpsQuality(resources.state.adaptiveQualityState, currentPreset, fps)
      resources.state.adaptiveQualityState = result.state
      if (result.change !== 'none') {
        resources.state.skipSsimForCurrentFrame = result.skipSsim
        resources.applyPreset(result.preset)
      }
    })
  }
  const render = (camera: MirroredCameraState): void => {
    assertBrowserRuntimeActive(activity.disposed)
    measureBrowserStage(globalThis.performance, 'render.browser.draw', () => Effect.runSync(resources.world.draw(camera)))
  }
  return { advanceFrame, render }
}

type WaterHandlers = {
  readonly attachWaterSurface: (geometry: THREE.BufferGeometry) => THREE.Mesh
  readonly detachWaterSurface: (mesh: THREE.Mesh) => void
}

const createWaterHandlers = (
  resources: BrowserRuntimeResources,
  activity: BrowserRuntimeActivity,
): WaterHandlers => {
  const attachWaterSurface = (geometry: THREE.BufferGeometry): THREE.Mesh => {
    assertBrowserRuntimeActive(activity.disposed)
    const mesh = new THREE.Mesh(geometry, resources.world.waterMaterial)
    mesh.frustumCulled = false
    Effect.runSync(resources.world.attachSceneObject(mesh))
    resources.state.waterMeshes.add(mesh)
    return mesh
  }
  const detachWaterSurface = (mesh: THREE.Mesh): void => {
    if (!resources.state.waterMeshes.delete(mesh)) {
      return
    }
    Effect.runSync(resources.world.detachSceneObject(mesh))
  }
  return { attachWaterSurface, detachWaterSurface }
}

type AnimationHandlers = {
  readonly start: (readFrame: () => BrowserFrame | undefined) => void
  readonly stop: () => void
}

const createScreenshotHandler = (
  canvas: HTMLCanvasElement,
  activity: BrowserRuntimeActivity,
  preserveDrawingBuffer: boolean,
  getLastFrame: () => BrowserScreenshotFrame | undefined,
): (() => Promise<Blob>) => () => {
  assertBrowserRuntimeActive(activity.disposed)
  if (!preserveDrawingBuffer) {
    return Promise.reject(new Error('captureScreenshot requires preserveDrawingBuffer'))
  }
  const frame = getLastFrame()
  if (!frame) {
    return Promise.reject(new Error('captureScreenshot requires a rendered frame'))
  }
  const screenshotCanvas = canvas.ownerDocument.createElement('canvas')
  screenshotCanvas.width = frame.width
  screenshotCanvas.height = frame.height
  const context = screenshotCanvas.getContext('2d')
  if (!context) {
    return Promise.reject(new Error('could not create a 2D screenshot canvas'))
  }
  const image = context.createImageData(frame.width, frame.height)
  const rowSize = frame.width * 4
  for (let row = 0; row < frame.height; row += 1) {
    const sourceOffset = (frame.height - row - 1) * rowSize
    const targetOffset = row * rowSize
    image.data.set(frame.pixels.subarray(sourceOffset, sourceOffset + rowSize), targetOffset)
  }
  context.putImageData(image, 0, 0)
  return new Promise((resolve, reject) => {
    screenshotCanvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('screenshot canvas.toBlob returned no image'))
      } else {
        resolve(blob)
      }
    }, 'image/png')
  })
}

const installPngScreenshotShortcut = (
  document: Document,
  captureScreenshot: () => Promise<Blob>,
): (() => void) => {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isBrowserScreenshotShortcut(event)) {
      return
    }
    const target = event.target
    const view = document.defaultView
    if (view && target instanceof view.HTMLElement) {
      if (
        target.isContentEditable ||
        target.closest('input, textarea, select, [contenteditable="true"]') !== null
      ) {
        return
      }
    }
    event.preventDefault()
    void captureScreenshot()
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = objectUrl
        link.download = SCREENSHOT_FILENAME
        link.hidden = true
        document.body.append(link)
        try {
          link.click()
        } finally {
          link.remove()
          globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
        }
      })
      .catch((cause: unknown) => {
        console.error('Could not download the browser screenshot', cause)
      })
  }
  document.addEventListener('keydown', onKeyDown)
  return () => document.removeEventListener('keydown', onKeyDown)
}

const createAnimationHandlers = (
  activity: BrowserRuntimeActivity,
  advanceFrame: (frame: ProductionFrame) => void,
  render: (camera: MirroredCameraState) => void,
): AnimationHandlers => {
  const stop = (): void => {
    if (activity.animationFrame !== undefined) {
      globalThis.cancelAnimationFrame(activity.animationFrame)
      activity.animationFrame = undefined
    }
  }
  const start = (readFrame: () => BrowserFrame | undefined): void => {
    assertBrowserRuntimeActive(activity.disposed)
    stop()
    const loop = (): void => {
      activity.animationFrame = undefined
      if (activity.disposed) {
        return
      }
      const frame = readFrame()
      if (frame?.frame) {
        advanceFrame(frame.frame)
      }
      if (frame) {
        render(frame.camera)
      }
      activity.animationFrame = globalThis.requestAnimationFrame(loop)
    }
    activity.animationFrame = globalThis.requestAnimationFrame(loop)
  }
  return { start, stop }
}

const disposeWaterSurfaces = (resources: BrowserRuntimeResources): void => {
  for (const mesh of resources.state.waterMeshes) {
    Effect.runSync(resources.world.detachSceneObject(mesh))
  }
  resources.state.waterMeshes.clear()
}

const disposeAtlas = (atlas: AtlasResource): void => {
  if (atlas.owned) {
    atlas.texture.dispose()
  }
}

const createDisposeHandler = (
  activity: BrowserRuntimeActivity,
  resources: BrowserRuntimeResources,
  stop: () => void,
  removeScreenshotShortcut: () => void,
): (() => void) => (): void => {
  if (activity.disposed) {
    return
  }
  activity.disposed = true
  stop()
  removeScreenshotShortcut()
  activity.resizeObserver?.disconnect()
  disposeWaterSurfaces(resources)
  Effect.runSync(resources.world.dispose)
  resources.refraction.dispose()
  disposeAtlas(resources.atlas)
}

type RuntimeInstallationOptions = {
  readonly activity: BrowserRuntimeActivity
  readonly attachWaterSurface: (geometry: THREE.BufferGeometry) => THREE.Mesh
  readonly options: BrowserWorldRuntimeOptions
  readonly resize: () => void
}

const installRuntime = ({
  activity,
  attachWaterSurface,
  options,
  resize,
}: RuntimeInstallationOptions): void => {
  resize()
  if (options.waterGeometry) {
    attachWaterSurface(options.waterGeometry)
  }
  if (options.autoResize !== false && typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(options.canvas)
    activity.resizeObserver = resizeObserver
  }
}

const createBrowserWorldRuntime = (
  options: BrowserWorldRuntimeOptions,
  resources: BrowserRuntimeResources,
): BrowserWorldRuntime => {
  const activity = makeRuntimeActivity()
  const resize = createResizeHandler(options, resources, activity)
  const frameHandlers = createFrameHandlers(resources, activity)
  const waterHandlers = createWaterHandlers(resources, activity)
  const animationHandlers = createAnimationHandlers(activity, frameHandlers.advanceFrame, frameHandlers.render)
  const captureScreenshot = createScreenshotHandler(
    options.canvas,
    activity,
    options.preserveDrawingBuffer ?? true,
    () => resources.state.lastPresentedFrame,
  )
  const removeScreenshotShortcut = installPngScreenshotShortcut(
    options.canvas.ownerDocument,
    captureScreenshot,
  )
  const dispose = createDisposeHandler(
    activity,
    resources,
    animationHandlers.stop,
    removeScreenshotShortcut,
  )
  installRuntime({
    activity,
    attachWaterSurface: waterHandlers.attachWaterSurface,
    options,
    resize,
  })
  return {
    advanceFrame: frameHandlers.advanceFrame,
    attachWaterSurface: waterHandlers.attachWaterSurface,
    camera: resources.surface.camera,
    captureScreenshot,
    detachWaterSurface: waterHandlers.detachWaterSurface,
    dispose,
    render: frameHandlers.render,
    resize,
    scene: resources.surface.scene,
    start: animationHandlers.start,
    stop: animationHandlers.stop,
    threeRenderer: resources.surface.renderer,
    get gpuTimingSupported() {
      return resources.gpuTiming.service.supported
    },
    get latestGpuTimeMs() {
      return resources.gpuTiming.latestGpuTimeMs
    },
    get latestSsim() {
      return resources.state.latestSsim
    },
    get quality() {
      return resources.state.quality
    },
    get qualityPreset() {
      return resources.state.qualityPreset
    },
    get waterMeshes() {
      return [...resources.state.waterMeshes]
    },
    world: resources.world,
  }
}

export const makeBrowserWorldRuntime = async (
  options: BrowserWorldRuntimeOptions,
): Promise<BrowserWorldRuntime> => {
  const { quality, preset: qualityPreset } = resolveBrowserQuality(options.quality)
  const maxPixelRatio = resolveBrowserMaxPixelRatio(options.maxPixelRatio, quality.pixelRatioCap)
  const atlas = await resolveAtlas(options.atlas)
  const state = makeRuntimeState(options.canvas, quality, qualityPreset, maxPixelRatio)
  const initialized = initializeBrowserWorld({ atlas, options, state })
  const resources: BrowserRuntimeResources = {
    atlas,
    applyPreset: initialized.applyPreset,
    gpuTiming: initialized.gpuTiming,
    refraction: initialized.refraction,
    state,
    surface: initialized.surface,
    world: initialized.world,
  }
  return createBrowserWorldRuntime(options, resources)
}
