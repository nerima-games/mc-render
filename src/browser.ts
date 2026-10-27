import * as THREE from 'three'
import {
  BROWSER_RENDER_DEFAULTS,
  type TimerQueryExtensionShape,
  advanceBrowserFpsQuality,
  advanceBrowserSsimQuality,
  assertBrowserRuntimeActive,
  browserDepthTextureOption,
  browserPostProcessingChain,
  browserPostProcessingChainKey,
  captureBrowserWaterVisibility,
  createBrowserCompositeShader,
  createBrowserGodRaysShader,
  hideBrowserWaterMeshes,
  isBrowserScreenshotShortcut,
  measureBrowserStage,
  millisecondsFromGpuNanoseconds,
  requireBrowserRuntimeValue,
  resolveBrowserBloomStrength,
  resolveBrowserDrawingBufferSize,
  resolveBrowserLatestGpuTime,
  resolveBrowserMaxPixelRatio,
  resolveBrowserPixelRatio,
  resolveBrowserQuality,
  resolveBrowserRefractionTargetSize,
  resolveBrowserRenderTargetValue,
  resolveBrowserViewport,
  restoreBrowserWaterVisibility,
  selectGpuTimer,
  setBrowserWaterRefractionUniforms,
  shouldCaptureBrowserRefraction,
  structuralSimilarity,
} from './domain/browser-render-policy.js'
import { Context, Effect, Layer } from 'effect'
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js'
import {
  type GraphicsQuality,
  type PostProcessingPass,
  type PostProcessingStep,
  type QualityPreset,
} from './domain/post-processing.js'
import {
  type ProductionFrame,
  type ProductionWorldRenderer,
  type ProductionWorldRendererOptions,
  makeProductionWorldRenderer,
} from './application/world-renderer-production.js'
import { type RgbaAtlas, generateTerrainAtlas } from './domain/texture-atlas.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import type { MirroredCameraState } from './domain/camera-mirror.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { type PostProcessingRendererFactory } from './application/world-renderer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { Viewport } from './domain/render-environment.js'
import { createAdaptiveQualityState } from './domain/adaptive-quality.js'
import { createSsimAdaptiveQualityState } from './domain/ssim-adaptive-quality.js'
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
const ZERO_DELTA_SECONDS = 0
const ZERO_PIXEL_COORDINATE = 0
const RGBA_COMPONENT_COUNT = 4
const ZERO_INDEX = 0
const ONE_SECOND_IN_SECONDS = 1
const ZERO_DELAY_MILLISECONDS = 0
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

const tryGpuTimerOperation = <Result>(run: () => Result): Effect.Effect<Result, GpuTimerServiceFailure> =>
  Effect.try({
    catch: (cause) => ({ cause }),
    try: run,
  })

type GpuTimerQueryState = {
  activeQuery: WebGLQuery | undefined
  pendingQuery: WebGLQuery | undefined
}

const resolveGpuTimerExtension = (value: unknown): TimerQueryExtensionShape | undefined => {
  const selection = selectGpuTimer(value)
  if (selection.kind === 'query') {
    return selection.extension
  }
  return undefined
}

const pollReadyGpuQuery = ({
  extension,
  query,
  state,
  webglContext,
}: {
  readonly extension: TimerQueryExtensionShape
  readonly query: WebGLQuery
  readonly state: GpuTimerQueryState
  readonly webglContext: WebGL2RenderingContext
}): Effect.Effect<number | undefined, GpuTimerServiceFailure> => Effect.gen(function* pollReadyGpuQueryEffect() {
  const disjoint: unknown = yield* tryGpuTimerOperation(() =>
    webglContext.getParameter(extension.GPU_DISJOINT_EXT),
  )
  if (disjoint === true) {
    yield* tryGpuTimerOperation(() => webglContext.deleteQuery(query))
    state.pendingQuery = undefined
    return undefined
  }
  const elapsedNanoseconds: unknown = yield* tryGpuTimerOperation(() =>
    webglContext.getQueryParameter(query, webglContext.QUERY_RESULT),
  )
  yield* tryGpuTimerOperation(() => webglContext.deleteQuery(query))
  state.pendingQuery = undefined
  return millisecondsFromGpuNanoseconds(elapsedNanoseconds)
})

const disposeGpuTimerQueries = ({
  extension,
  state,
  webglContext,
}: {
  readonly extension: TimerQueryExtensionShape | undefined
  readonly state: GpuTimerQueryState
  readonly webglContext: WebGL2RenderingContext
}): Effect.Effect<void, GpuTimerServiceFailure> => Effect.gen(function* disposeGpuTimerQueriesEffect() {
  const { activeQuery, pendingQuery } = state
  if (extension && activeQuery) {
    yield* tryGpuTimerOperation(() => webglContext.endQuery(extension.TIME_ELAPSED_EXT))
    yield* tryGpuTimerOperation(() => webglContext.deleteQuery(activeQuery))
    state.activeQuery = undefined
  }
  if (pendingQuery) {
    yield* tryGpuTimerOperation(() => webglContext.deleteQuery(pendingQuery))
    state.pendingQuery = undefined
  }
})

const createGpuTimerOperations = ({
  extension,
  webglContext,
}: {
  readonly extension: TimerQueryExtensionShape | undefined
  readonly webglContext: WebGL2RenderingContext
}): GpuTimerServiceApi => {
  const state: GpuTimerQueryState = { activeQuery: undefined, pendingQuery: undefined }
  const begin = Effect.gen(function* beginGpuTimer() {
    if (!extension || state.activeQuery || state.pendingQuery) {
      return
    }
    const query = yield* tryGpuTimerOperation(() => webglContext.createQuery())
    if (query) {
      yield* tryGpuTimerOperation(() => webglContext.beginQuery(extension.TIME_ELAPSED_EXT, query))
      state.activeQuery = query
    }
  })
  const end = Effect.gen(function* endGpuTimer() {
  const { activeQuery } = state
    if (!extension || !activeQuery) {
      return
    }
    yield* tryGpuTimerOperation(() => webglContext.endQuery(extension.TIME_ELAPSED_EXT))
    state.pendingQuery = activeQuery
    state.activeQuery = undefined
  })
  const poll = Effect.gen(function* pollGpuTimer() {
    if (!extension || !state.pendingQuery) {
      return undefined
    }
    const query = state.pendingQuery
    const available: unknown = yield* tryGpuTimerOperation(() =>
      webglContext.getQueryParameter(query, webglContext.QUERY_RESULT_AVAILABLE),
    )
    if (available !== true) {
      return undefined
    }
    return yield* pollReadyGpuQuery({ extension, query, state, webglContext })
  })
  return {
    begin,
    dispose: disposeGpuTimerQueries({ extension, state, webglContext }),
    end,
    poll,
    supported: extension !== undefined,
  }
}

export const makeGpuTimerService = (webglContext: WebGL2RenderingContext): Effect.Effect<
  GpuTimerServiceApi,
  GpuTimerServiceFailure
> =>
  Effect.gen(function* makeGpuTimerServiceEffect() {
    const extensionValue: unknown = yield* tryGpuTimerOperation(() =>
      webglContext.getExtension(TIMER_QUERY_EXTENSION),
    )
    return createGpuTimerOperations({ extension: resolveGpuTimerExtension(extensionValue), webglContext })
  })

export const GpuTimerServiceLayer = (
  webglContext: WebGL2RenderingContext,
): Layer.Layer<GpuTimerService, GpuTimerServiceFailure> =>
  Layer.effect(GpuTimerService, makeGpuTimerService(webglContext))

const runBrowserOperation = <Result>(run: () => Result): Result =>
  Effect.runSync(Effect.try({ catch: (cause) => cause, try: run }))

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
  resolveBrowserViewport({
    canvasHeight: canvas.height,
    canvasWidth: canvas.width,
    clientHeight: canvas.clientHeight,
    clientWidth: canvas.clientWidth,
  })

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

const VIEWPORT_PASS_FACTORIES: Record<ViewportPostProcessingPass, (context: ViewportPassContext) => Pass> = {
  bloom: ({ quality, viewport }) =>
    new UnrealBloomPass(
      new THREE.Vector2(viewport.width, viewport.height),
      resolveBrowserBloomStrength(quality.bloomStrength),
      DEFAULT_BLOOM_RADIUS,
      DEFAULT_BLOOM_THRESHOLD,
    ),
  bokeh: ({ camera, scene, viewport }) =>
    new BokehPass(scene, camera, {
      aperture: BROWSER_RENDER_DEFAULTS.bokehAperture,
      aspect: viewport.width / viewport.height,
      focus: BROWSER_RENDER_DEFAULTS.bokehFocus,
      maxblur: BROWSER_RENDER_DEFAULTS.bokehMaxBlur,
    }),
  gtao: ({ camera, scene, viewport }) => new GTAOPass(scene, camera, viewport.width, viewport.height),
}

const createViewportPass = (effect: ViewportPostProcessingPass, context: ViewportPassContext): Pass =>
  VIEWPORT_PASS_FACTORIES[effect](context)

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

const bindCompositePassRender = (pass: ShaderPass): void => {
  const render = pass.render.bind(pass)
  pass.render = (...args: Parameters<ShaderPass['render']>): void => {
    const [, , readBuffer] = args
    const depth = readBuffer.depthTexture
    const depthUniform = pass.uniforms['tDepth']
    if (depthUniform) {
      depthUniform.value = depth
    }
    render(...args)
  }
}

const bindCompositePassSize = (
  pass: ShaderPass,
  getPixelRatio: () => number,
  getViewport: () => Viewport,
): void => {
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
}

const createCompositePass = (
  effects: ReadonlyArray<PostProcessingPass>,
  { camera, getPixelRatio, getViewport, quality }: Omit<ComposerOptions, 'renderer'> & {
    readonly camera: THREE.PerspectiveCamera
  },
): ShaderPass => {
  const pass = new ShaderPass(
    createBrowserCompositeShader(
      {
        camera,
        effects,
        makeVector2: (x, y) => new THREE.Vector2(x, y),
        quality,
        viewport: getViewport(),
      },
    ),
  )
  bindCompositePassRender(pass)
  bindCompositePassSize(pass, getPixelRatio, getViewport)
  return pass
}

type BrowserPostProcessingSurfaceInput = Parameters<PostProcessingRendererFactory>[number]

type BrowserPostProcessingFactoryOptions = Omit<ComposerOptions, 'quality' | 'renderer'> & {
  readonly getQuality: () => GraphicsQuality
  readonly onSurface: (surface: BrowserSurface) => void
  readonly captureRefraction: (surface: BrowserSurface) => void
  readonly onGpuTiming: (timing: BrowserGpuTiming) => void
  readonly onPresentedImage: (image: BrowserScreenshotFrame) => void
  readonly onSsim: (ssim: number) => void
}

type BrowserPostProcessingSurface = BrowserSurface & {
  readonly webglContext: WebGL2RenderingContext
}

type BrowserPostProcessingState = {
  composer: EffectComposer
  composerQuality: GraphicsQuality
  readonly copyMaterial: THREE.ShaderMaterial
  readonly copyQuad: FullScreenQuad
  currentKey: string
  readbackTarget: THREE.WebGLRenderTarget | undefined
  readonly referenceComposer: EffectComposer
  referenceKey: string
  readonly referenceQuality: GraphicsQuality
}

const requireBrowserPostProcessingSurface = ({
  onSurface,
  surface,
}: {
  readonly onSurface: (surface: BrowserSurface) => void
  readonly surface: BrowserPostProcessingSurfaceInput
}): BrowserPostProcessingSurface => {
  const renderer = requireRenderer(surface.renderer)
  const scene = requireScene(surface.scene)
  const camera = requirePerspectiveCamera(surface.camera)
  const browserSurface = { camera, renderer, scene }
  onSurface(browserSurface)
  const context = renderer.getContext()
  if (!isWebGl2Context(context)) {
    throw new Error('Browser renderer requires a WebGL2 context')
  }
  return { ...browserSurface, webglContext: context }
}

const createBrowserGpuTiming = ({
  onGpuTiming,
  surface,
}: {
  readonly onGpuTiming: (timing: BrowserGpuTiming) => void
  readonly surface: BrowserPostProcessingSurface
}): BrowserGpuTiming => {
  const service = Effect.runSync(
    Effect.gen(function* acquireGpuTimerService() {
      return yield* GpuTimerService
    }).pipe(Effect.provide(GpuTimerServiceLayer(surface.webglContext))),
  )
  const timing: BrowserGpuTiming = { latestGpuTimeMs: undefined, service }
  onGpuTiming(timing)
  return timing
}

const createReferenceCopyResources = (): {
  readonly copyMaterial: THREE.ShaderMaterial
  readonly copyQuad: FullScreenQuad
} => {
  const copyMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(tDiffuse, vUv);
      }
    `,
    toneMapped: false,
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
  })
  return { copyMaterial, copyQuad: new FullScreenQuad(copyMaterial) }
}

const createBrowserPostProcessingState = ({
  getPixelRatio,
  getQuality,
  getViewport,
  renderer,
}: {
  readonly getPixelRatio: () => number
  readonly getQuality: () => GraphicsQuality
  readonly getViewport: () => Viewport
  readonly renderer: THREE.WebGLRenderer
}): BrowserPostProcessingState => {
  const createComposerFor = (quality: GraphicsQuality): EffectComposer =>
    createComposer({ getPixelRatio, getViewport, quality, renderer })
  const composerQuality = getQuality()
  const composer = createComposerFor(composerQuality)
  const referenceQuality = resolveBrowserQuality('ultra').quality
  const referenceComposer = createComposerFor(referenceQuality)
  referenceComposer.renderToScreen = false
  const { copyMaterial, copyQuad } = createReferenceCopyResources()
  return {
    composer,
    composerQuality,
    copyMaterial,
    copyQuad,
    currentKey: '',
    readbackTarget: undefined,
    referenceComposer,
    referenceKey: '',
    referenceQuality,
  }
}

const createBrowserPostProcessingPass = ({
  camera,
  getPixelRatio,
  getViewport,
  scene,
}: {
  readonly camera: THREE.PerspectiveCamera
  readonly getPixelRatio: () => number
  readonly getViewport: () => Viewport
  readonly scene: THREE.Scene
}) => (step: PostProcessingStep, quality: GraphicsQuality): Pass => {
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
      return createCompositePass(step.effects, { camera, getPixelRatio, getViewport, quality })
    case 'smaa':
      return new SMAAPass()
    case 'output':
      return new OutputPass()
    default:
      throw new Error(`Unsupported post-processing pass: ${step.pass}`)
  }
}

const installBrowserPostProcessingChain = ({
  chain,
  createPass,
  installedKey,
  quality,
  target,
}: {
  readonly chain: ReadonlyArray<PostProcessingStep>
  readonly createPass: (step: PostProcessingStep, quality: GraphicsQuality) => Pass
  readonly installedKey: string
  readonly quality: GraphicsQuality
  readonly target: EffectComposer
}): string => {
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

const ensureBrowserComposerQuality = ({
  getPixelRatio,
  getQuality,
  getViewport,
  renderer,
  state,
}: {
  readonly getPixelRatio: () => number
  readonly getQuality: () => GraphicsQuality
  readonly getViewport: () => Viewport
  readonly renderer: THREE.WebGLRenderer
  readonly state: BrowserPostProcessingState
}): void => {
  const nextQuality = getQuality()
  if (nextQuality === state.composerQuality) {
    return
  }
  disposeComposerPasses(state.composer)
  state.composer.dispose()
  state.composer = createComposer({ getPixelRatio, getViewport, quality: nextQuality, renderer })
  state.composerQuality = nextQuality
  state.currentKey = ''
}

const ensureBrowserReadbackTarget = ({
  renderer,
  state,
}: {
  readonly renderer: THREE.WebGLRenderer
  readonly state: BrowserPostProcessingState
}): { readonly height: number; readonly target: THREE.WebGLRenderTarget; readonly width: number } => {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2())
  const { height, width } = resolveBrowserDrawingBufferSize(size.x, size.y)
  const target = state.readbackTarget ?? new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  })
  if (state.readbackTarget) {
    state.readbackTarget.setSize(width, height)
  } else {
    state.readbackTarget = target
  }
  return { height, target, width }
}

const readBrowserPresentedImage = ({
  height,
  renderer,
  webglContext,
  width,
}: {
  readonly height: number
  readonly renderer: THREE.WebGLRenderer
  readonly webglContext: WebGL2RenderingContext
  readonly width: number
}): Uint8Array => {
  const pixels = new Uint8Array(width * height * RGBA_COMPONENT_COUNT)
  runBrowserOperation(() => renderer.setRenderTarget(null))
  runBrowserOperation(() => webglContext.readPixels(
    ZERO_PIXEL_COORDINATE,
    ZERO_PIXEL_COORDINATE,
    width,
    height,
    webglContext.RGBA,
    webglContext.UNSIGNED_BYTE,
    pixels,
  ))
  return pixels
}

const renderBrowserReferenceCopy = ({
  copyMaterial,
  copyQuad,
  readback,
  renderer,
  source,
}: {
  readonly copyMaterial: THREE.ShaderMaterial
  readonly copyQuad: FullScreenQuad
  readonly readback: THREE.WebGLRenderTarget
  readonly renderer: THREE.WebGLRenderer
  readonly source: THREE.Texture
}): void => {
  const diffuseUniform = copyMaterial.uniforms['tDiffuse']
  if (diffuseUniform) {
    diffuseUniform.value = source
  }
  runBrowserOperation(() => renderer.setRenderTarget(readback))
  runBrowserOperation(() => renderer.clear(true, true, true))
  runBrowserOperation(() => copyQuad.render(renderer))
}

const readBrowserReferenceImage = ({
  copyMaterial,
  copyQuad,
  height,
  readback,
  referenceComposer,
  renderer,
  width,
}: {
  readonly copyMaterial: THREE.ShaderMaterial
  readonly copyQuad: FullScreenQuad
  readonly height: number
  readonly readback: THREE.WebGLRenderTarget
  readonly referenceComposer: EffectComposer
  readonly renderer: THREE.WebGLRenderer
  readonly width: number
}): Uint8Array => {
  const source = referenceComposer.readBuffer.texture
  const previousTarget = runBrowserOperation(() => renderer.getRenderTarget())
  try {
    renderBrowserReferenceCopy({ copyMaterial, copyQuad, readback, renderer, source })
    const pixels = new Uint8Array(width * height * RGBA_COMPONENT_COUNT)
    runBrowserOperation(() => renderer.readRenderTargetPixels(
      readback,
      ZERO_PIXEL_COORDINATE,
      ZERO_PIXEL_COORDINATE,
      width,
      height,
      pixels,
    ))
    return pixels
  } finally {
    runBrowserOperation(() => renderer.setRenderTarget(previousTarget))
  }
}

const ensureBrowserPostProcessingChains = ({
  chain,
  createPass,
  getPixelRatio,
  getQuality,
  getViewport,
  renderer,
  state,
}: {
  readonly chain: ReadonlyArray<PostProcessingStep>
  readonly createPass: (step: PostProcessingStep, quality: GraphicsQuality) => Pass
  readonly getPixelRatio: () => number
  readonly getQuality: () => GraphicsQuality
  readonly getViewport: () => Viewport
  readonly renderer: THREE.WebGLRenderer
  readonly state: BrowserPostProcessingState
}): void => {
  ensureBrowserComposerQuality({ getPixelRatio, getQuality, getViewport, renderer, state })
  state.currentKey = installBrowserPostProcessingChain({
    chain,
    createPass,
    installedKey: state.currentKey,
    quality: state.composerQuality,
    target: state.composer,
  })
  state.referenceKey = installBrowserPostProcessingChain({
    chain: browserPostProcessingChain(state.referenceQuality),
    createPass,
    installedKey: state.referenceKey,
    quality: state.referenceQuality,
    target: state.referenceComposer,
  })
}

const renderAndCompareBrowserImages = ({
  captureRefraction,
  height,
  onPresentedImage,
  onSsim,
  renderer,
  state,
  surface,
  target,
  webglContext,
  width,
}: {
  readonly captureRefraction: (surface: BrowserSurface) => void
  readonly height: number
  readonly onPresentedImage: (image: BrowserScreenshotFrame) => void
  readonly onSsim: (ssim: number) => void
  readonly renderer: THREE.WebGLRenderer
  readonly state: BrowserPostProcessingState
  readonly surface: BrowserSurface
  readonly target: THREE.WebGLRenderTarget
  readonly webglContext: WebGL2RenderingContext
  readonly width: number
}): void => {
  captureRefraction(surface)
  state.composer.render()
  const activePixels = readBrowserPresentedImage({ height, renderer, webglContext, width })
  onPresentedImage({ height, pixels: activePixels, width })
  state.referenceComposer.render()
  const referencePixels = readBrowserReferenceImage({
    copyMaterial: state.copyMaterial,
    copyQuad: state.copyQuad,
    height,
    readback: target,
    referenceComposer: state.referenceComposer,
    renderer,
    width,
  })
  onSsim(structuralSimilarity({ height, left: activePixels, right: referencePixels, width }))
}

const disposeBrowserPostProcessingState = ({
  gpuTiming,
  state,
}: {
  readonly gpuTiming: BrowserGpuTiming
  readonly state: BrowserPostProcessingState
}): void => {
  disposeComposerPasses(state.composer)
  state.composer.dispose()
  disposeComposerPasses(state.referenceComposer)
  state.referenceComposer.dispose()
  state.copyQuad.dispose()
  state.copyMaterial.dispose()
  state.readbackTarget?.dispose()
  Effect.runSync(gpuTiming.service.dispose)
}

const resizeBrowserPostProcessingState = ({
  getPixelRatio,
  height,
  renderer,
  state,
  width,
}: {
  readonly getPixelRatio: () => number
  readonly height: number
  readonly renderer: THREE.WebGLRenderer
  readonly state: BrowserPostProcessingState
  readonly width: number
}): void => {
  state.composer.setPixelRatio(getPixelRatio())
  state.composer.setSize(width, height)
  state.referenceComposer.setPixelRatio(getPixelRatio())
  state.referenceComposer.setSize(width, height)
  if (state.readbackTarget) {
    ensureBrowserReadbackTarget({ renderer, state })
  }
}

const createPostProcessingSession = ({
  gpuTiming,
  options,
  surface,
}: {
  readonly gpuTiming: BrowserGpuTiming
  readonly options: BrowserPostProcessingFactoryOptions
  readonly surface: BrowserPostProcessingSurface
}): ReturnType<PostProcessingRendererFactory> => {
  const state = createBrowserPostProcessingState({
    getPixelRatio: options.getPixelRatio,
    getQuality: options.getQuality,
    getViewport: options.getViewport,
    renderer: surface.renderer,
  })
  const createPass = createBrowserPostProcessingPass({
    camera: surface.camera,
    getPixelRatio: options.getPixelRatio,
    getViewport: options.getViewport,
    scene: surface.scene,
  })
  const draw = (chain: ReadonlyArray<PostProcessingStep>): void => {
    const priorSample = Effect.runSync(gpuTiming.service.poll)
    gpuTiming.latestGpuTimeMs = resolveBrowserLatestGpuTime(gpuTiming.latestGpuTimeMs, priorSample)
    ensureBrowserPostProcessingChains({
      chain,
      createPass,
      getPixelRatio: options.getPixelRatio,
      getQuality: options.getQuality,
      getViewport: options.getViewport,
      renderer: surface.renderer,
      state,
    })
    const { height, target, width } = ensureBrowserReadbackTarget({ renderer: surface.renderer, state })
    Effect.runSync(gpuTiming.service.begin)
    try {
      renderAndCompareBrowserImages({
        captureRefraction: options.captureRefraction,
        height,
        onPresentedImage: options.onPresentedImage,
        onSsim: options.onSsim,
        renderer: surface.renderer,
        state,
        surface,
        target,
        webglContext: surface.webglContext,
        width,
      })
    } finally {
      Effect.runSync(gpuTiming.service.end)
    }
  }
  return {
    dispose: () => disposeBrowserPostProcessingState({ gpuTiming, state }),
    render: draw,
    resize: (width, height) => resizeBrowserPostProcessingState({
      getPixelRatio: options.getPixelRatio,
      height,
      renderer: surface.renderer,
      state,
      width,
    }),
  }
}

const createPostProcessingFactory = (
  options: BrowserPostProcessingFactoryOptions,
): PostProcessingRendererFactory => (surface) => {
  const browserSurface = requireBrowserPostProcessingSurface({ onSurface: options.onSurface, surface })
  const gpuTiming = createBrowserGpuTiming({ onGpuTiming: options.onGpuTiming, surface: browserSurface })
  return createPostProcessingSession({ gpuTiming, options, surface: browserSurface })
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

type BrowserWorldBuildState = {
  gpuTiming: BrowserGpuTiming | undefined
  surface: BrowserSurface | undefined
  world: BrowserWorld | undefined
}

type BrowserWorldCallbacks = {
  readonly applyPreset: (preset: QualityPreset) => void
  readonly postProcessing: PostProcessingRendererFactory
  readonly refraction: BrowserRefractionController
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
  { canvas, quality, qualityPreset, maxPixelRatio }: {
    readonly canvas: HTMLCanvasElement
    readonly maxPixelRatio: number
    readonly quality: GraphicsQuality
    readonly qualityPreset: QualityPreset | undefined
  },
): BrowserRuntimeState => ({
  adaptiveQualityState: createAdaptiveQualityState(),
  lastPresentedFrame: undefined,
  latestSsim: undefined,
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
  return shouldCaptureBrowserRefraction({
    frameNumber,
    quality: state.quality,
    visibleWaterMeshCount: visibleMeshCount,
    waterScreenRatio: screenRatio,
  })
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

const createBrowserWorldCallbacks = ({
  buildState,
  options,
  state,
}: {
  readonly buildState: BrowserWorldBuildState
  readonly options: BrowserWorldRuntimeOptions
  readonly state: BrowserRuntimeState
}): BrowserWorldCallbacks => {
  const getWaterUniforms = (): BrowserWaterUniforms =>
    requireBrowserRuntimeValue(buildState.world, 'browser world surface was not initialized').waterUniforms
  const refraction = createRefractionController(state, getWaterUniforms)
  const applyPreset = (preset: QualityPreset): void => {
    const activeWorld = requireBrowserRuntimeValue(buildState.world, 'browser world surface was not initialized')
    state.qualityPreset = preset
    state.quality = resolveBrowserQuality(preset).quality
    state.maxPixelRatio = resolveBrowserMaxPixelRatio(options.maxPixelRatio, state.quality.pixelRatioCap)
    state.pixelRatio = resolveBrowserPixelRatio(state.maxPixelRatio, globalThis.devicePixelRatio)
    buildState.surface?.renderer.setPixelRatio(state.pixelRatio)
    refraction.resize()
    Effect.runSync(activeWorld.setPostProcessingChain(browserPostProcessingChain(state.quality)))
    Effect.runSync(activeWorld.resize(state.viewport.width, state.viewport.height))
  }
  const postProcessing = createPostProcessingFactory({
    captureRefraction: refraction.capture,
    getPixelRatio: () => state.pixelRatio,
    getQuality: () => state.quality,
    getViewport: () => state.viewport,
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
      const result = advanceBrowserSsimQuality({
        preset: currentPreset,
        skipSsim: state.skipSsimForCurrentFrame,
        ssim,
        state: state.ssimAdaptiveQualityState,
      })
      state.ssimAdaptiveQualityState = result.state
      state.skipSsimForCurrentFrame = result.skipSsim
      if (result.change !== 'none') {
        applyPreset(result.preset)
      }
    },
    onSurface: (surface) => {
      buildState.surface = surface
    },
  })
  return { applyPreset, postProcessing, refraction }
}

const initializeBrowserWorld = ({
  atlas,
  options,
  state,
}: BrowserWorldInitializationOptions): BrowserWorldInitialization => {
  const buildState: BrowserWorldBuildState = { gpuTiming: undefined, surface: undefined, world: undefined }
  const callbacks = createBrowserWorldCallbacks({ buildState, options, state })
  const worldOptions = createBrowserWorldOptions(options, callbacks.postProcessing)
  const initializedWorld = Effect.runSync(
    makeProductionWorldRenderer<
      HTMLCanvasElement,
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial,
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >(THREE, options.canvas, state.viewport, atlas.texture, worldOptions),
  )
  buildState.world = initializedWorld
  Effect.runSync(initializedWorld.setPostProcessingChain(browserPostProcessingChain(state.quality)))
  const surface = requireBrowserRuntimeValue(
    buildState.surface,
    'browser world did not expose its Three surface',
  )
  const gpuTiming = requireBrowserRuntimeValue(
    buildState.gpuTiming,
    'browser world did not initialize GPU timing',
  )
  return {
    applyPreset: callbacks.applyPreset,
    gpuTiming,
    refraction: callbacks.refraction,
    surface,
    world: initializedWorld,
  }
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

const resolveBrowserFrameFps = (deltaSeconds: number): number => {
  if (deltaSeconds > ZERO_DELTA_SECONDS) {
    return ONE_SECOND_IN_SECONDS / deltaSeconds
  }
  return Number.NaN
}

const advanceBrowserRuntimeQuality = (frame: ProductionFrame, resources: BrowserRuntimeResources): void => {
  const currentPreset = resources.state.qualityPreset
  if (!currentPreset) {
    return
  }
  const fps = resolveBrowserFrameFps(frame.deltaSecs)
  const result = advanceBrowserFpsQuality(resources.state.adaptiveQualityState, currentPreset, fps)
  resources.state.adaptiveQualityState = result.state
  if (result.change !== 'none') {
    resources.state.skipSsimForCurrentFrame = result.skipSsim
    resources.applyPreset(result.preset)
  }
}

const createFrameHandlers = (
  resources: BrowserRuntimeResources,
  activity: BrowserRuntimeActivity,
): FrameHandlers => {
  const advanceFrame = (frame: ProductionFrame): void => {
    assertBrowserRuntimeActive(activity.disposed)
    measureBrowserStage(globalThis.performance, 'render.browser.advanceFrame', () => {
      Effect.runSync(resources.world.advanceFrame(frame))
      advanceBrowserRuntimeQuality(frame, resources)
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

const createScreenshotCanvas = (canvas: HTMLCanvasElement, frame: BrowserScreenshotFrame): HTMLCanvasElement => {
  const screenshotCanvas = canvas.ownerDocument.createElement('canvas')
  screenshotCanvas.width = frame.width
  screenshotCanvas.height = frame.height
  return screenshotCanvas
}

const copyScreenshotPixels = (
  context: CanvasRenderingContext2D,
  frame: BrowserScreenshotFrame,
): void => {
  const image = context.createImageData(frame.width, frame.height)
  const rowSize = frame.width * RGBA_COMPONENT_COUNT
  for (let row = ZERO_INDEX; row < frame.height; row += FRAME_NUMBER_INCREMENT) {
    const sourceOffset = (frame.height - row - FRAME_NUMBER_INCREMENT) * rowSize
    const targetOffset = row * rowSize
    image.data.set(frame.pixels.subarray(sourceOffset, sourceOffset + rowSize), targetOffset)
  }
  context.putImageData(image, ZERO_PIXEL_COORDINATE, ZERO_PIXEL_COORDINATE)
}

const encodeScreenshotCanvas = (screenshotCanvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    screenshotCanvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('screenshot canvas.toBlob returned no image'))
      } else {
        resolve(blob)
      }
    }, 'image/png')
  })

const captureScreenshotFrame = (canvas: HTMLCanvasElement, frame: BrowserScreenshotFrame): Promise<Blob> => {
  const screenshotCanvas = createScreenshotCanvas(canvas, frame)
  const context = screenshotCanvas.getContext('2d')
  if (!context) {
    return Promise.reject(new Error('could not create a 2D screenshot canvas'))
  }
  copyScreenshotPixels(context, frame)
  return encodeScreenshotCanvas(screenshotCanvas)
}

const createScreenshotHandler = ({
  activity,
  canvas,
  getLastFrame,
  preserveDrawingBuffer,
}: {
  readonly activity: BrowserRuntimeActivity
  readonly canvas: HTMLCanvasElement
  readonly getLastFrame: () => BrowserScreenshotFrame | undefined
  readonly preserveDrawingBuffer: boolean
}): (() => Promise<Blob>) => () => {
  assertBrowserRuntimeActive(activity.disposed)
  if (!preserveDrawingBuffer) {
    return Promise.reject(new Error('captureScreenshot requires preserveDrawingBuffer'))
  }
  const frame = getLastFrame()
  if (!frame) {
    return Promise.reject(new Error('captureScreenshot requires a rendered frame'))
  }
  return captureScreenshotFrame(canvas, frame)
}

const reportScreenshotDownloadFailure = (cause: unknown): void => {
  globalThis.console.error('Could not download the browser screenshot', cause)
}

const installPngScreenshotShortcut = (
  document: Document,
  captureScreenshot: () => Promise<Blob>,
): (() => void) => {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isBrowserScreenshotShortcut(event)) {
      return
    }
    const { target } = event
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
    captureScreenshot()
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
          globalThis.setTimeout(() => URL.revokeObjectURL(objectUrl), ZERO_DELAY_MILLISECONDS)
        }
      })
      .catch((cause: unknown) => {
        reportScreenshotDownloadFailure(cause)
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

const createDisposeHandler = ({
  activity,
  removeScreenshotShortcut,
  resources,
  stop,
}: {
  readonly activity: BrowserRuntimeActivity
  readonly removeScreenshotShortcut: () => void
  readonly resources: BrowserRuntimeResources
  readonly stop: () => void
}): (() => void) => (): void => {
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
  const captureScreenshot = createScreenshotHandler({
    activity,
    canvas: options.canvas,
    getLastFrame: () => resources.state.lastPresentedFrame,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? true,
  })
  const removeScreenshotShortcut = installPngScreenshotShortcut(
    options.canvas.ownerDocument,
    captureScreenshot,
  )
  const dispose = createDisposeHandler({
    activity,
    removeScreenshotShortcut,
    resources,
    stop: animationHandlers.stop,
  })
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
    render: frameHandlers.render,
    resize,
    scene: resources.surface.scene,
    start: animationHandlers.start,
    stop: animationHandlers.stop,
    threeRenderer: resources.surface.renderer,
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
  const state = makeRuntimeState({ canvas: options.canvas, maxPixelRatio, quality, qualityPreset })
  const initialized = initializeBrowserWorld({ atlas, options, state })
  const resources: BrowserRuntimeResources = {
    applyPreset: initialized.applyPreset,
    atlas,
    gpuTiming: initialized.gpuTiming,
    refraction: initialized.refraction,
    state,
    surface: initialized.surface,
    world: initialized.world,
  }
  return createBrowserWorldRuntime(options, resources)
}
