import * as THREE from 'three'
import {
  type GraphicsQuality,
  type PostProcessingPass,
  type PostProcessingStep,
  QUALITY_PRESETS,
  type QualityPreset,
  buildPostProcessingChain,
  chainEffects,
  qualityUsesHdrRenderTarget,
} from './domain/post-processing.js'
import {
  type PostProcessingRendererFactory,
  type WorldRenderContext,
} from './application/world-renderer.js'
import {
  type ProductionFrame,
  type ProductionWorldRenderer,
  type ProductionWorldRendererOptions,
  makeProductionWorldRenderer,
} from './application/world-renderer-production.js'
import { type RgbaAtlas, generateTerrainAtlas } from './domain/texture-atlas.js'
import { normalizeRefractionMinScreenRatio, refractionRunsOnFrame } from './domain/water-refraction.js'
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js'
import { Effect } from 'effect'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js'
import type { MirroredCameraState } from './domain/camera-mirror.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Pass } from 'three/addons/postprocessing/Pass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { Viewport } from './domain/render-environment.js'
import { measureWaterVisibility } from './browser-water-visibility.js'

const DEFAULT_MAX_PIXEL_RATIO = 2
const MIN_PIXEL_RATIO_CAP = 0.5
const MIN_VIEWPORT_SIZE = 1
const DEFAULT_GOD_RAY_DENSITY = 0.7
const DEFAULT_GOD_RAY_DECAY = 0.95
const DEFAULT_GOD_RAY_WEIGHT = 0.12
const DEFAULT_GOD_RAY_EXPOSURE = 0.25
const MIN_BLOOM_STRENGTH = 0
const MAX_BLOOM_STRENGTH = 1
const DEFAULT_BLOOM_RADIUS = 0.4
const DEFAULT_BLOOM_THRESHOLD = 0.85
const DEFAULT_BOKEH_FOCUS = 10
const DEFAULT_BOKEH_APERTURE = 0.00002
const DEFAULT_BOKEH_MAX_BLUR = 0.01
const DEFAULT_DEVICE_PIXEL_RATIO = 1
const DEFAULT_LIGHT_POSITION_COMPONENT = 0.5
const POSITIVE_NUMBER_BOUNDARY = 0
const REFRACTION_AVAILABLE = 1
const REFRACTION_UNAVAILABLE = 0
const EMPTY_WATER_MESH_COUNT = 0
const MIN_GOD_RAY_SAMPLES = 0
const MAX_GOD_RAY_SAMPLES = 40
const FRAME_NUMBER_INCREMENT = 1

const resolveGodRaySamples = (value: number): number => {
  if (!Number.isFinite(value)) {
    return MIN_GOD_RAY_SAMPLES
  }
  return Math.max(MIN_GOD_RAY_SAMPLES, Math.min(MAX_GOD_RAY_SAMPLES, Math.trunc(value)))
}

const resolveBloomStrength = (value: number): number => {
  if (!Number.isFinite(value)) {
    return MIN_BLOOM_STRENGTH
  }
  return Math.max(MIN_BLOOM_STRENGTH, Math.min(MAX_BLOOM_STRENGTH, value))
}

const createGodRaysShader = (samples: number) => ({
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
    uDecay: { value: DEFAULT_GOD_RAY_DECAY },
    uDensity: { value: DEFAULT_GOD_RAY_DENSITY },
    uExposure: { value: DEFAULT_GOD_RAY_EXPOSURE },
    uLightPosition: {
      value: new THREE.Vector2(DEFAULT_LIGHT_POSITION_COMPONENT, DEFAULT_LIGHT_POSITION_COMPONENT),
    },
    uSamples: { value: resolveGodRaySamples(samples) },
    uWeight: { value: DEFAULT_GOD_RAY_WEIGHT },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
})

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
  readonly world?: Omit<ProductionWorldRendererOptions, 'beforeRender' | 'postProcessing' | 'preserveDrawingBuffer'>
}

export type BrowserWorldRuntime = {
  readonly quality: GraphicsQuality
  readonly world: ProductionWorldRenderer<THREE.ShaderMaterial>
  readonly threeRenderer: THREE.WebGLRenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.PerspectiveCamera
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

const resolveQuality = (quality: BrowserWorldRuntimeOptions['quality']): GraphicsQuality => {
  if (typeof quality === 'string') {
    return QUALITY_PRESETS[quality]
  }
  if (quality) {
    return quality
  }
  return QUALITY_PRESETS.high
}

const measureViewport = (canvas: HTMLCanvasElement): Viewport => ({
  height: Math.max(MIN_VIEWPORT_SIZE, Math.floor(canvas.clientHeight || canvas.height || MIN_VIEWPORT_SIZE)),
  width: Math.max(MIN_VIEWPORT_SIZE, Math.floor(canvas.clientWidth || canvas.width || MIN_VIEWPORT_SIZE)),
})

const resolvePixelRatioCap = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_PIXEL_RATIO
  }
  return Math.max(MIN_PIXEL_RATIO_CAP, Math.min(DEFAULT_MAX_PIXEL_RATIO, value))
}

const resolveMaxPixelRatio = (value: number | undefined, qualityCap: number): number => {
  const cap = resolvePixelRatioCap(qualityCap)
  if (value !== undefined && Number.isFinite(value) && value > POSITIVE_NUMBER_BOUNDARY) {
    return Math.min(cap, value)
  }
  return cap
}

const resolvePixelRatio = (maxPixelRatio: number): number => {
  const { devicePixelRatio } = globalThis
  if (typeof devicePixelRatio === 'number' && devicePixelRatio > POSITIVE_NUMBER_BOUNDARY) {
    return Math.min(maxPixelRatio, devicePixelRatio)
  }
  return Math.min(maxPixelRatio, DEFAULT_DEVICE_PIXEL_RATIO)
}

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
        resolveBloomStrength(quality.bloomStrength),
        DEFAULT_BLOOM_RADIUS,
        DEFAULT_BLOOM_THRESHOLD,
      )
    case 'bokeh':
      return new BokehPass(scene, camera, {
        aperture: DEFAULT_BOKEH_APERTURE,
        aspect: viewport.width / viewport.height,
        focus: DEFAULT_BOKEH_FOCUS,
        maxblur: DEFAULT_BOKEH_MAX_BLUR,
      })
    case 'gtao':
      return new GTAOPass(scene, camera, viewport.width, viewport.height)
    default:
      throw new Error(`unsupported viewport post-processing pass: ${effect}`)
  }
}

const disposeComposerPasses = (composer: EffectComposer): void => {
  for (const pass of [...composer.passes]) {
    composer.removePass(pass)
    pass.dispose()
  }
}

const resolveRenderTargetType = (quality: GraphicsQuality): THREE.TextureDataType => {
  if (qualityUsesHdrRenderTarget(quality)) {
    return THREE.HalfFloatType
  }
  return THREE.UnsignedByteType
}

type ComposerOptions = {
  readonly getPixelRatio: () => number
  readonly getViewport: () => Viewport
  readonly quality: GraphicsQuality
  readonly renderer: THREE.WebGLRenderer
}

const createComposer = ({
  getPixelRatio,
  getViewport,
  quality,
  renderer,
}: ComposerOptions): EffectComposer => {
  const viewport = getViewport()
  const renderTarget = new THREE.WebGLRenderTarget(viewport.width, viewport.height, {
    type: resolveRenderTargetType(quality),
  })
  const composer = new EffectComposer(renderer, renderTarget)
  composer.setPixelRatio(getPixelRatio())
  composer.setSize(viewport.width, viewport.height)
  return composer
}

const createPostProcessingFactory = ({
  getPixelRatio,
  getViewport,
  onSurface,
  quality,
}: Omit<ComposerOptions, 'renderer'> & {
  readonly onSurface: (surface: BrowserSurface) => void
}): PostProcessingRendererFactory => (surface) => {
  const renderer = surface.renderer as unknown as THREE.WebGLRenderer
  const scene = surface.scene as unknown as THREE.Scene
  const camera = surface.camera as unknown as THREE.PerspectiveCamera
  onSurface({ camera, renderer, scene })
  const composer = createComposer({ getPixelRatio, getViewport, quality, renderer })
  let currentKey = ''

  const createPass = (effect: PostProcessingPass): Pass => {
    switch (effect) {
      case 'render':
        return new RenderPass(scene, camera)
      case 'gtao':
      case 'bloom':
      case 'bokeh':
        return createViewportPass(effect, { camera, quality, scene, viewport: getViewport() })
      case 'godRays':
        return new ShaderPass(createGodRaysShader(quality.godRaysSamples))
      case 'smaa':
        return new SMAAPass()
      case 'output':
        return new OutputPass()
      case 'composite':
        throw new Error('the executable pass chain must materialize composite effects')
      default:
        throw new Error(`unsupported post-processing pass: ${effect}`)
    }
  }

  const installChain = (chain: ReadonlyArray<PostProcessingStep>): void => {
    const effects = chainEffects(chain)
    const key = effects.join('|')
    if (key === currentKey) {
      return
    }
    disposeComposerPasses(composer)
    for (const effect of effects) {
      composer.addPass(createPass(effect))
    }
    currentKey = key
  }

  return {
    dispose: () => {
      disposeComposerPasses(composer)
      composer.dispose()
    },
    render: (chain) => {
      installChain(chain)
      composer.render()
    },
    resize: (width, height) => {
      composer.setPixelRatio(getPixelRatio())
      composer.setSize(width, height)
    },
  }
}

type BrowserWorld = ProductionWorldRenderer<THREE.ShaderMaterial>
type BrowserWaterUniforms = BrowserWorld['waterUniforms']
type AtlasResource = Awaited<ReturnType<typeof resolveAtlas>>

type BrowserRuntimeState = {
  maxPixelRatio: number
  pixelRatio: number
  quality: GraphicsQuality
  viewport: Viewport
  waterMeshes: Set<THREE.Mesh>
}

type BrowserRuntimeActivity = {
  animationFrame: number | undefined
  disposed: boolean
  resizeObserver: ResizeObserver | undefined
}

type BrowserRefractionController = {
  readonly capture: (context: WorldRenderContext) => void
  readonly dispose: () => void
  readonly resize: () => void
}

type BrowserWorldInitialization = {
  readonly refraction: BrowserRefractionController
  readonly surface: BrowserSurface
  readonly world: BrowserWorld
}

type BrowserWorldInitializationOptions = {
  readonly atlas: AtlasResource
  readonly options: BrowserWorldRuntimeOptions
  readonly quality: GraphicsQuality
  readonly state: BrowserRuntimeState
}

type BrowserRuntimeResources = {
  readonly atlas: AtlasResource
  readonly refraction: BrowserRefractionController
  readonly state: BrowserRuntimeState
  readonly surface: BrowserSurface
  readonly world: BrowserWorld
}

const makeRuntimeState = (
  canvas: HTMLCanvasElement,
  quality: GraphicsQuality,
  maxPixelRatio: number,
): BrowserRuntimeState => ({
  maxPixelRatio,
  pixelRatio: resolvePixelRatio(maxPixelRatio),
  quality,
  viewport: measureViewport(canvas),
  waterMeshes: new Set<THREE.Mesh>(),
})

const resolveRefractionTargetSize = (
  state: BrowserRuntimeState,
): { readonly height: number; readonly key: string; readonly width: number } => {
  const width = Math.max(MIN_VIEWPORT_SIZE, Math.floor(state.viewport.width * state.pixelRatio))
  const height = Math.max(MIN_VIEWPORT_SIZE, Math.floor(state.viewport.height * state.pixelRatio))
  return { height, key: `${width}x${height}`, width }
}

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
    type: resolveRenderTargetType(quality),
  })
  target.texture.generateMipmaps = false
  return target
}

const captureWaterVisibility = (
  waterMeshes: ReadonlySet<THREE.Mesh>,
): ReadonlyArray<readonly [THREE.Mesh, boolean]> =>
  [...waterMeshes].map((mesh) => [mesh, mesh.visible] as const)

const hideWaterMeshes = (waterMeshes: ReadonlySet<THREE.Mesh>): void => {
  for (const mesh of waterMeshes) {
    mesh.visible = false
  }
}

const restoreWaterVisibility = (
  visibility: ReadonlyArray<readonly [THREE.Mesh, boolean]>,
): void => {
  for (const [mesh, visible] of visibility) {
    mesh.visible = visible
  }
}

const renderToRefractionTarget = (
  renderer: THREE.WebGLRenderer,
  context: WorldRenderContext,
  target: THREE.WebGLRenderTarget,
): void => {
  renderer.setRenderTarget(target)
  renderer.clear()
  renderer.render(context.scene as unknown as THREE.Scene, context.camera as unknown as THREE.Camera)
}

const renderRefractionScene = (
  context: WorldRenderContext,
  target: THREE.WebGLRenderTarget,
  waterMeshes: ReadonlySet<THREE.Mesh>,
): boolean => {
  const renderer = context.renderer as unknown as THREE.WebGLRenderer
  const previousTarget = renderer.getRenderTarget()
  const visibility = captureWaterVisibility(waterMeshes)
  hideWaterMeshes(waterMeshes)
  try {
    renderToRefractionTarget(renderer, context, target)
    return true
  } finally {
    renderer.setRenderTarget(previousTarget)
    restoreWaterVisibility(visibility)
  }
}

const setRefractionUniforms = (
  uniforms: BrowserWaterUniforms,
  texture: THREE.Texture | null,
  rendered: boolean,
): void => {
  const map = uniforms['uRefractionMap']
  const valid = uniforms['uRefractionValid']
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

type RefractionVisibilityContext = {
  readonly camera: THREE.Camera
  readonly frameNumber: number
  readonly quality: GraphicsQuality
  readonly state: BrowserRuntimeState
}

const shouldCaptureRefraction = ({
  camera,
  frameNumber,
  quality,
  state,
}: RefractionVisibilityContext): boolean => {
  const { screenRatio, visibleMeshCount } = measureWaterVisibility(state.waterMeshes, camera)
  if (visibleMeshCount === EMPTY_WATER_MESH_COUNT) {
    return false
  }
  if (!refractionRunsOnFrame(quality.refractionThrottleFrames, frameNumber)) {
    return false
  }
  return screenRatio >= normalizeRefractionMinScreenRatio(quality.refractionMinScreenRatio)
}

const createRefractionController = (
  quality: GraphicsQuality,
  state: BrowserRuntimeState,
  getUniforms: () => BrowserWaterUniforms,
): BrowserRefractionController => {
  let target: THREE.WebGLRenderTarget | undefined = undefined
  let targetKey = ''
  let frameNumber = 0

  const ensureTarget = (): THREE.WebGLRenderTarget => {
    const size = resolveRefractionTargetSize(state)
    if (target && targetKey === size.key) {
      return target
    }
    target?.dispose()
    target = createRefractionTarget(quality, size)
    targetKey = size.key
    return target
  }

  const capture = (context: WorldRenderContext): void => {
    frameNumber += FRAME_NUMBER_INCREMENT
    const uniforms = getUniforms()
    if (state.waterMeshes.size === EMPTY_WATER_MESH_COUNT) {
      setRefractionUniforms(uniforms, null, false)
      return
    }
    if (
      !shouldCaptureRefraction({
        camera: context.camera as unknown as THREE.Camera,
        frameNumber,
        quality,
        state,
      })
    ) {
      return
    }
    const nextTarget = ensureTarget()
    const rendered = renderRefractionScene(context, nextTarget, state.waterMeshes)
    setRefractionUniforms(uniforms, nextTarget.texture, rendered)
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
  }

  return { capture, dispose, resize }
}

const createBrowserWorldOptions = (
  options: BrowserWorldRuntimeOptions,
  refraction: BrowserRefractionController,
  postProcessing: PostProcessingRendererFactory,
): ProductionWorldRendererOptions => ({
  ...options.world,
  beforeRender: refraction.capture,
  postProcessing,
  preserveDrawingBuffer: options.preserveDrawingBuffer ?? true,
})

const initializeBrowserWorld = ({
  atlas,
  options,
  quality,
  state,
}: BrowserWorldInitializationOptions): BrowserWorldInitialization => {
  const buildState: {
    surface: BrowserSurface | undefined
    world: BrowserWorld | undefined
  } = { surface: undefined, world: undefined }
  const refraction = createRefractionController(quality, state, () => {
    const { world } = buildState
    if (!world) {
      throw new Error('browser world surface was not initialized')
    }
    return world.waterUniforms
  })
  const postProcessing = createPostProcessingFactory({
    getPixelRatio: () => state.pixelRatio,
    getViewport: () => state.viewport,
    onSurface: (nextSurface) => {
      buildState.surface = nextSurface
    },
    quality,
  })
  const worldOptions = createBrowserWorldOptions(options, refraction, postProcessing)
  const world = Effect.runSync(
    makeProductionWorldRenderer<
      HTMLCanvasElement,
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial,
      THREE.InstancedBufferGeometry,
      THREE.ShaderMaterial
    >(THREE, options.canvas, state.viewport, atlas.texture, worldOptions),
  )
  buildState.world = world
  Effect.runSync(world.setPostProcessingChain(buildPostProcessingChain(quality)))
  if (!buildState.surface) {
    throw new Error('browser world did not expose its Three surface')
  }
  return { refraction, surface: buildState.surface, world }
}

const makeRuntimeActivity = (): BrowserRuntimeActivity => ({
  animationFrame: undefined,
  disposed: false,
  resizeObserver: undefined,
})

const ensureRuntimeActive = (activity: BrowserRuntimeActivity): void => {
  if (activity.disposed) {
    throw new Error('browser world runtime is disposed')
  }
}

const createResizeHandler = (
  options: BrowserWorldRuntimeOptions,
  resources: BrowserRuntimeResources,
  activity: BrowserRuntimeActivity,
): (() => void) => (): void => {
  ensureRuntimeActive(activity)
  resources.state.viewport = measureViewport(options.canvas)
  resources.state.pixelRatio = resolvePixelRatio(resources.state.maxPixelRatio)
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
    ensureRuntimeActive(activity)
    Effect.runSync(resources.world.advanceFrame(frame))
  }
  const render = (camera: MirroredCameraState): void => {
    ensureRuntimeActive(activity)
    Effect.runSync(resources.world.draw(camera))
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
    ensureRuntimeActive(activity)
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
): (() => Promise<Blob>) => () => {
  ensureRuntimeActive(activity)
  if (!preserveDrawingBuffer) {
    return Promise.reject(new Error('captureScreenshot requires preserveDrawingBuffer'))
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        reject(new Error('canvas.toBlob returned no image'))
      } else {
        resolve(blob)
      }
    }, 'image/png')
  })
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
    ensureRuntimeActive(activity)
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
): (() => void) => (): void => {
  if (activity.disposed) {
    return
  }
  activity.disposed = true
  stop()
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
  quality: GraphicsQuality,
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
  )
  const dispose = createDisposeHandler(activity, resources, animationHandlers.stop)
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
    quality,
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
  const quality = resolveQuality(options.quality)
  const maxPixelRatio = resolveMaxPixelRatio(options.maxPixelRatio, quality.pixelRatioCap)
  const atlas = await resolveAtlas(options.atlas)
  const state = makeRuntimeState(options.canvas, quality, maxPixelRatio)
  const initialized = initializeBrowserWorld({ atlas, options, quality, state })
  const resources: BrowserRuntimeResources = {
    atlas,
    refraction: initialized.refraction,
    state,
    surface: initialized.surface,
    world: initialized.world,
  }
  return createBrowserWorldRuntime(options, quality, resources)
}
