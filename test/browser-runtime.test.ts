import { Effect } from 'effect'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GpuTimerService,
  GpuTimerServiceLayer,
  makeBrowserWorldRuntime,
  makeGpuTimerService,
} from '../src/browser.js'
import { mirroredCameraState } from '../src/domain/camera-mirror.js'
import { QUALITY_PRESETS, type PostProcessingStep } from '../src/domain/post-processing.js'

const testCamera = mirroredCameraState(undefined)

const DEFAULT_EXTENSION = {
  GPU_DISJOINT_EXT: 0x8fbb,
  TIME_ELAPSED_EXT: 0x88bf,
}

const makeTimerContext = ({
  available = true,
  disjoint = false,
  elapsedNanoseconds = 2_500_000,
  extension = DEFAULT_EXTENSION,
  beginFailure,
  queryResult = {},
}: {
  readonly available?: boolean
  readonly disjoint?: boolean
  readonly elapsedNanoseconds?: unknown
  readonly extension?: unknown
  readonly beginFailure?: Error
  readonly queryResult?: object | null
} = {}) => {
  const query = queryResult
  const queryResultAvailable = 0x8867
  const queryResultParameter = 0x8866
  const gl = {
    QUERY_RESULT: queryResultParameter,
    QUERY_RESULT_AVAILABLE: queryResultAvailable,
    beginQuery: vi.fn(() => {
      if (beginFailure) {
        throw beginFailure
      }
    }),
    createQuery: vi.fn(() => query),
    deleteQuery: vi.fn(),
    endQuery: vi.fn(),
    getExtension: vi.fn(() => extension),
    getParameter: vi.fn(() => disjoint),
    getQueryParameter: vi.fn((_query: unknown, parameter: number) =>
      parameter === queryResultAvailable ? available : elapsedNanoseconds,
    ),
  } as unknown as WebGL2RenderingContext
  return { gl, query }
}

const acquireTimerService = (gl: WebGL2RenderingContext) =>
  Effect.runSync(
    Effect.gen(function* acquireService() {
      return yield* GpuTimerService
    }).pipe(Effect.provide(GpuTimerServiceLayer(gl))),
  )

describe('browser GPU timer service', () => {
  it('provides an Effect service and converts available nanoseconds to milliseconds', () => {
    const { gl, query } = makeTimerContext()
    const service = acquireTimerService(gl)

    expect(service.supported).toBe(true)
    Effect.runSync(service.begin)
    Effect.runSync(service.end)

    expect(Effect.runSync(service.poll)).toBe(2.5)
    expect(gl.beginQuery).toHaveBeenCalledWith(DEFAULT_EXTENSION.TIME_ELAPSED_EXT, query)
    expect(gl.endQuery).toHaveBeenCalledWith(DEFAULT_EXTENSION.TIME_ELAPSED_EXT)
    expect(gl.deleteQuery).toHaveBeenCalledWith(query)
    Effect.runSync(service.dispose)
  })

  it('keeps drawing available when the timer extension is missing', () => {
    const { gl } = makeTimerContext({ extension: null })
    const service = Effect.runSync(makeGpuTimerService(gl))

    expect(service.supported).toBe(false)
    Effect.runSync(service.begin)
    Effect.runSync(service.end)
    expect(Effect.runSync(service.poll)).toBeUndefined()
    expect(gl.createQuery).not.toHaveBeenCalled()
    Effect.runSync(service.dispose)
  })

  it('does not start overlapping queries and disposes an unfinished query', () => {
    const { gl, query } = makeTimerContext({ available: false })
    const service = Effect.runSync(makeGpuTimerService(gl))

    Effect.runSync(service.begin)
    Effect.runSync(service.begin)
    expect(gl.createQuery).toHaveBeenCalledTimes(1)
    Effect.runSync(service.end)
    Effect.runSync(service.begin)
    expect(gl.createQuery).toHaveBeenCalledTimes(1)
    expect(Effect.runSync(service.poll)).toBeUndefined()
    expect(gl.deleteQuery).not.toHaveBeenCalled()

    Effect.runSync(service.dispose)
    expect(gl.deleteQuery).toHaveBeenCalledWith(query)
  })

  it('disposes an active query and tolerates a failed query allocation', () => {
    const active = makeTimerContext()
    const activeService = Effect.runSync(makeGpuTimerService(active.gl))
    Effect.runSync(activeService.begin)
    Effect.runSync(activeService.dispose)
    expect(active.gl.endQuery).toHaveBeenCalledWith(DEFAULT_EXTENSION.TIME_ELAPSED_EXT)
    expect(active.gl.deleteQuery).toHaveBeenCalledWith(active.query)

    const unavailable = makeTimerContext({ queryResult: null })
    const unavailableService = Effect.runSync(makeGpuTimerService(unavailable.gl))
    Effect.runSync(unavailableService.begin)
    expect(unavailable.gl.createQuery).toHaveBeenCalledTimes(1)
    expect(unavailable.gl.beginQuery).not.toHaveBeenCalled()
  })

  it('waits for query availability and ignores invalid elapsed values', () => {
    const unavailable = makeTimerContext({ available: false })
    const service = Effect.runSync(makeGpuTimerService(unavailable.gl))
    Effect.runSync(service.begin)
    Effect.runSync(service.end)
    expect(Effect.runSync(service.poll)).toBeUndefined()
    expect(unavailable.gl.deleteQuery).not.toHaveBeenCalled()

    const invalid = makeTimerContext({ elapsedNanoseconds: Number.NaN })
    const invalidService = Effect.runSync(makeGpuTimerService(invalid.gl))
    Effect.runSync(invalidService.begin)
    Effect.runSync(invalidService.end)
    expect(Effect.runSync(invalidService.poll)).toBeUndefined()
    expect(invalid.gl.deleteQuery).toHaveBeenCalledWith(invalid.query)
  })

  it('does not publish a disjoint query result', () => {
    const { gl, query } = makeTimerContext({ disjoint: true })
    const service = acquireTimerService(gl)

    Effect.runSync(service.begin)
    Effect.runSync(service.end)

    expect(Effect.runSync(service.poll)).toBeUndefined()
    expect(gl.deleteQuery).toHaveBeenCalledWith(query)
  })

  it('preserves a WebGL query failure as an Effect failure', () => {
    const failure = new Error('begin query failed')
    const { gl } = makeTimerContext({ beginFailure: failure })
    const service = acquireTimerService(gl)

    expect(() => Effect.runSync(service.begin)).toThrow()
  })
})
const browserMocks = vi.hoisted(() => ({
  settings: {
    activePixel: 0,
    gpuTimerExtension: true,
    hiddenWaterWasRendered: false,
    invalidCompositeResolution: false,
    omitCompositeDepthUniform: false,
    omitCopyDiffuseUniform: false,
    referencePixel: 255,
    throwOnGetTarget: false,
    webgl2: true,
  },
  worldFactory: vi.fn(),
}))

vi.mock('../src/application/world-renderer-production.js', () => ({
  makeProductionWorldRenderer: (...args: ReadonlyArray<unknown>) => browserMocks.worldFactory(...args),
}))

vi.mock('three', () => {
  class FakeVector2 {
    x: number
    y: number
    constructor(x = 0, y = 0) {
      this.x = x
      this.y = y
    }
    set(x: number, y: number): this { this.x = x; this.y = y; return this }
  }

  class FakeTexture {
    colorSpace = ''
    flipY = true
    generateMipmaps = true
    magFilter = 0
    minFilter = 0
    wrapS = 0
    wrapT = 0
    dispose(): void {}
  }

  class FakeDataTexture extends FakeTexture {
    constructor(..._args: ReadonlyArray<unknown>) { super() }
  }

  class FakeDepthTexture extends FakeTexture {
    constructor(..._args: ReadonlyArray<unknown>) { super() }
  }

  class FakeRenderTarget {
    readonly texture = new FakeTexture()
    width: number
    height: number
    options: Record<string, unknown>
    constructor(width: number, height: number, options: Record<string, unknown> = {}) {
      this.width = width
      this.height = height
      this.options = options
    }
    setSize(width: number, height: number): void { this.width = width; this.height = height }
    dispose(): void {}
  }

  class FakeShaderMaterial {
    readonly uniforms: Record<string, { value: unknown }>
    constructor(options: { readonly uniforms?: Record<string, { value: unknown }> }) {
      this.uniforms = options.uniforms ?? {}
      if (browserMocks.settings.omitCopyDiffuseUniform) delete this.uniforms['tDiffuse']
    }
    dispose(): void {}
  }

  class FakeMesh {
    frustumCulled = true
    matrixWorld = {}
    private visibleState = true
    geometry: unknown
    material: unknown
    constructor(geometry: unknown, material: unknown) {
      this.geometry = geometry
      this.material = material
    }
    get visible(): boolean { return this.visibleState }
    set visible(value: boolean) {
      this.visibleState = value
      if (!value) browserMocks.settings.hiddenWaterWasRendered = true
    }
    updateWorldMatrix(_updateParents: boolean, _updateChildren: boolean): void {}
  }

  class FakeScene {}
  class FakeCamera {}
  class FakePerspectiveCamera extends FakeCamera {
    far = 1000
    near = 0.1
    updateMatrixWorld(): void {}
  }

  class FakeVector3 {
    x: number
    y: number
    z: number
    constructor(x: number, y: number, z: number) {
      this.x = x
      this.y = y
      this.z = z
    }
    applyMatrix4(_matrix: unknown): this { return this }
    project(_camera: unknown): this { return this }
  }

  class FakeBufferGeometry {
    readonly boundingBox = {
      max: { x: 0.5, y: 0.5, z: 0.5 },
      min: { x: -0.5, y: -0.5, z: -0.5 },
    }
    computeBoundingBox(): void {}
  }

  class FakeWebGLRenderer {
    private target: unknown = null
    readonly context = {
      GPU_DISJOINT_EXT: 1,
      QUERY_RESULT: 5,
      QUERY_RESULT_AVAILABLE: 6,
      RGBA: 7,
      TIME_ELAPSED_EXT: 2,
      UNSIGNED_BYTE: 8,
      beginQuery: () => undefined,
      createQuery: () => ({}),
      deleteQuery: () => undefined,
      endQuery: () => undefined,
      getExtension: () => browserMocks.settings.gpuTimerExtension
        ? ({ GPU_DISJOINT_EXT: 1, TIME_ELAPSED_EXT: 2 })
        : null,
      getParameter: () => false,
      getQueryParameter: (_query: unknown, parameter: number) => parameter === 6 ? true : 2_500_000,
      readPixels: (
        _x: number,
        _y: number,
        _width: number,
        _height: number,
        _format: number,
        _type: number,
        pixels: Uint8Array,
      ) => pixels.fill(browserMocks.settings.activePixel),
    }

    getContext(): unknown { return browserMocks.settings.webgl2 ? this.context : {} }
    getDrawingBufferSize(target: FakeVector2): FakeVector2 { return target.set(8, 8) }
    getRenderTarget(): unknown {
      if (browserMocks.settings.throwOnGetTarget) throw new Error('render target query failed')
      return this.target
    }
    readRenderTargetPixels(
      _target: unknown,
      _x: number,
      _y: number,
      _width: number,
      _height: number,
      pixels: Uint8Array,
    ): void { pixels.fill(browserMocks.settings.referencePixel) }
    render(_scene: unknown, _camera: unknown): void {}
    setPixelRatio(_ratio: number): void {}
    setRenderTarget(target: unknown): void { this.target = target }
    clear(): void {}
  }

  class FakeTextureLoader {
    async loadAsync(_url: string): Promise<FakeTexture> { return new FakeTexture() }
  }

  return {
    Camera: FakeCamera,
    ClampToEdgeWrapping: 1,
    DataTexture: FakeDataTexture,
    DepthTexture: FakeDepthTexture,
    HalfFloatType: 2,
    LinearFilter: 3,
    Mesh: FakeMesh,
    NearestFilter: 4,
    BufferGeometry: FakeBufferGeometry,
    PerspectiveCamera: FakePerspectiveCamera,
    RGBAFormat: 5,
    SRGBColorSpace: 'srgb',
    Scene: FakeScene,
    ShaderMaterial: FakeShaderMaterial,
    Texture: FakeTexture,
    TextureLoader: FakeTextureLoader,
    UnsignedByteType: 6,
    Vector2: FakeVector2,
    Vector3: FakeVector3,
    WebGLRenderer: FakeWebGLRenderer,
    WebGLRenderTarget: FakeRenderTarget,
  }
})

vi.mock('three/addons/postprocessing/BokehPass.js', () => ({
  BokehPass: class { dispose(): void {} },
}))
vi.mock('three/addons/postprocessing/EffectComposer.js', () => ({
  EffectComposer: class {
    readonly passes: Array<{
      dispose?: () => void
      render?: (...args: ReadonlyArray<unknown>) => void
      setSize?: (width: number, height: number) => void
    }> = []
    readonly readBuffer = { texture: { id: 'composer-read-buffer' } }
    renderToScreen = true
    readonly renderer: unknown
    readonly renderTarget: unknown
    constructor(renderer: unknown, renderTarget: unknown) {
      this.renderer = renderer
      this.renderTarget = renderTarget
    }
    dispose(): void {}
    removePass(pass: {
      dispose?: () => void
      render?: (...args: ReadonlyArray<unknown>) => void
      setSize?: (width: number, height: number) => void
    }): void {
      this.passes.splice(this.passes.indexOf(pass), 1)
    }
    render(): void {
      for (const pass of this.passes) {
        pass.render?.(this.renderer, {}, { depthTexture: { id: 'depth' } }, 0, false)
      }
    }
    setPixelRatio(_ratio: number): void {}
    setSize(width: number, height: number): void {
      for (const pass of this.passes) pass.setSize?.(width, height)
    }
    addPass(pass: {
      dispose?: () => void
      render?: (...args: ReadonlyArray<unknown>) => void
      setSize?: (width: number, height: number) => void
    }): void {
      this.passes.push(pass)
      pass.setSize?.(8, 8)
    }
  },
}))
vi.mock('three/addons/postprocessing/GTAOPass.js', () => ({
  GTAOPass: class { dispose(): void {} },
}))
vi.mock('three/addons/postprocessing/OutputPass.js', () => ({
  OutputPass: class { dispose(): void {} },
}))
vi.mock('three/addons/postprocessing/Pass.js', () => ({
  FullScreenQuad: class {
    constructor(_material: unknown) {}
    dispose(): void {}
    render(_renderer: unknown): void {}
  },
  Pass: class { dispose(): void {} },
}))
vi.mock('three/addons/postprocessing/RenderPass.js', () => ({
  RenderPass: class { dispose(): void {} },
}))
vi.mock('three/addons/postprocessing/SMAAPass.js', () => ({
  SMAAPass: class { dispose(): void {} },
}))
vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({
  ShaderPass: class {
    readonly uniforms: Record<string, { value: unknown }>
    constructor(shader: { readonly uniforms: Record<string, { value: unknown }> }) {
      this.uniforms = shader.uniforms
      if (browserMocks.settings.omitCompositeDepthUniform) delete this.uniforms['tDepth']
      if (browserMocks.settings.invalidCompositeResolution && this.uniforms['uResolution']) {
        this.uniforms['uResolution'].value = {}
      }
    }
    dispose(): void {}
    render(_renderer: unknown, _write: unknown, _read: unknown): void {}
    setSize(_width: number, _height: number): void {}
  },
}))
vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => ({
  UnrealBloomPass: class { dispose(): void {} },
}))

let originalDocument: PropertyDescriptor | undefined
let originalCanvasConstructor: PropertyDescriptor | undefined
let originalDevicePixelRatio: PropertyDescriptor | undefined
let originalResizeObserver: PropertyDescriptor | undefined
let originalAnimationFrame: PropertyDescriptor | undefined
let originalCancelAnimationFrame: PropertyDescriptor | undefined
let originalUrl: PropertyDescriptor | undefined
let frameCallbacks: Map<number, () => void>
let cancelledFrames: Array<number>
let nextFrameId: number
let downloadedFiles: Array<string>
let revokedUrls: Array<string>
let screenshotPixel: number | undefined
let screenshotContextAvailable: boolean
let screenshotBlobAvailable: boolean
let observerState: { disconnected: boolean; observed: boolean }

class FakeHtmlElement {
  closestResult: unknown = null
  isContentEditable = false
  closest(_selector: string): unknown { return this.closestResult }
}

type FakeDocument = {
  readonly body: { append: (element: unknown) => void }
  readonly defaultView: { readonly HTMLElement: typeof FakeHtmlElement }
  readonly listeners: Map<string, unknown>
  addEventListener: (type: string, listener: unknown) => void
  createElement: (name: string) => unknown
  removeEventListener: (type: string, listener: unknown) => void
}

let fakeDocument: FakeDocument

const restoreGlobal = (name: string, original: PropertyDescriptor | undefined): void => {
  if (original) {
    Object.defineProperty(globalThis, name, original)
  } else {
    Reflect.deleteProperty(globalThis, name)
  }
}

beforeEach(() => {
  originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  originalCanvasConstructor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement')
  originalDevicePixelRatio = Object.getOwnPropertyDescriptor(globalThis, 'devicePixelRatio')
  originalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver')
  originalAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame')
  originalCancelAnimationFrame = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame')
  originalUrl = Object.getOwnPropertyDescriptor(globalThis, 'URL')
  frameCallbacks = new Map()
  cancelledFrames = []
  nextFrameId = 1
  downloadedFiles = []
  revokedUrls = []
  screenshotPixel = undefined
  screenshotContextAvailable = true
  screenshotBlobAvailable = true
  observerState = { disconnected: false, observed: false }
  fakeDocument = {
    body: { append: () => undefined },
    defaultView: { HTMLElement: FakeHtmlElement },
    listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener) },
    createElement(name) {
      if (name === 'canvas') {
        return {
          width: 0,
          height: 0,
          getContext(type: string) {
            if (type !== '2d' || !screenshotContextAvailable) return null
            return {
              createImageData(width: number, height: number) {
                return { data: new Uint8ClampedArray(width * height * 4) }
              },
              putImageData(image: { readonly data: Uint8ClampedArray }) {
                screenshotPixel = image.data[0]
              },
            }
          },
          toBlob(callback: (blob: Blob | null) => void, type: string) {
            callback(screenshotBlobAvailable ? new Blob([], { type }) : null)
          },
        }
      }
      const link = {
        download: '',
        hidden: false,
        href: '',
        click() { downloadedFiles.push(this.download) },
        remove() {},
      }
      return link
    },
    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) this.listeners.delete(type)
    },
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  Object.defineProperty(globalThis, 'HTMLCanvasElement', {
    configurable: true,
    value: class {
      readonly ownerDocument = fakeDocument
      readonly clientWidth = 8
      readonly clientHeight = 8
      width = 8
      height = 8
    },
  })
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      constructor(_callback: () => void) {}
      observe(_target: unknown): void { observerState.observed = true }
      disconnect(): void { observerState.disconnected = true }
    },
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: () => void) => {
      const id = nextFrameId
      nextFrameId += 1
      frameCallbacks.set(id, callback)
      return id
    },
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number) => { cancelledFrames.push(id) },
  })
  Object.defineProperty(globalThis, 'URL', {
    configurable: true,
    value: class {
      static createObjectURL(_blob: Blob): string { return 'blob:runtime-test' }
      static revokeObjectURL(url: string): void { revokedUrls.push(url) }
    },
  })
  browserMocks.settings.activePixel = 0
  browserMocks.settings.gpuTimerExtension = true
  browserMocks.settings.hiddenWaterWasRendered = false
  browserMocks.settings.invalidCompositeResolution = false
  browserMocks.settings.omitCompositeDepthUniform = false
  browserMocks.settings.omitCopyDiffuseUniform = false
  browserMocks.settings.referencePixel = 255
  browserMocks.settings.throwOnGetTarget = false
  browserMocks.settings.webgl2 = true
  browserMocks.worldFactory.mockReset()
  browserMocks.worldFactory.mockImplementation((_three, _canvas, _viewport, _atlas, options) => {
    const renderer = new THREE.WebGLRenderer()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const postProcessing = options.postProcessing({ renderer, scene, camera })
    let chain: ReadonlyArray<PostProcessingStep> = []
    const world = {
      waterMaterial: new THREE.ShaderMaterial({}),
      waterUniforms: {},
      advanceFrame: (_frame: unknown) => Effect.sync(() => undefined),
      attachSceneObject: (_object: unknown) => Effect.sync(() => undefined),
      detachSceneObject: (_object: unknown) => Effect.sync(() => undefined),
      draw: (_camera: unknown) => Effect.sync(() => postProcessing.render(chain)),
      dispose: Effect.sync(() => postProcessing.dispose()),
      resize: (width: number, height: number) => Effect.sync(() => postProcessing.resize(width, height)),
      setPostProcessingChain: (nextChain: ReadonlyArray<PostProcessingStep>) => Effect.sync(() => { chain = nextChain }),
    }
    return Effect.succeed(Object.assign(world, { camera, renderer, scene }))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  restoreGlobal('document', originalDocument)
  restoreGlobal('HTMLCanvasElement', originalCanvasConstructor)
  restoreGlobal('devicePixelRatio', originalDevicePixelRatio)
  restoreGlobal('ResizeObserver', originalResizeObserver)
  restoreGlobal('requestAnimationFrame', originalAnimationFrame)
  restoreGlobal('cancelAnimationFrame', originalCancelAnimationFrame)
  restoreGlobal('URL', originalUrl)
})

describe('browser world runtime', () => {
  it('initializes the public runtime, renders against a hidden ultra reference, adapts quality, and disposes', async () => {
    const canvas = new HTMLCanvasElement()
    const runtime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      canvas,
      quality: 'high',
      waterGeometry: new THREE.BufferGeometry(),
    })

    expect(runtime.qualityPreset).toBe('high')
    expect(runtime.gpuTimingSupported).toBe(true)
    await expect(runtime.captureScreenshot()).rejects.toThrow('captureScreenshot requires a rendered frame')
    runtime.render(testCamera)
    expect(runtime.latestSsim).toBeLessThan(0.95)
    expect(browserMocks.settings.hiddenWaterWasRendered).toBe(true)
    expect(runtime.waterMeshes[0]?.visible).toBe(true)
    const blob = await runtime.captureScreenshot()
    expect(blob.type).toBe('image/png')
    expect(screenshotPixel).toBe(0)

    const keydown = fakeDocument.listeners.get('keydown')
    if (typeof keydown !== 'function') throw new Error('screenshot shortcut listener was not installed')
    const editable = new FakeHtmlElement()
    editable.isContentEditable = true
    const ignoredEvent = { code: 'F2', repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: editable, preventDefault: vi.fn() }
    keydown(ignoredEvent)
    expect(ignoredEvent.preventDefault).not.toHaveBeenCalled()
    const input = new FakeHtmlElement()
    input.closestResult = {}
    const inputEvent = { code: 'F2', repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: input, preventDefault: vi.fn() }
    keydown(inputEvent)
    expect(inputEvent.preventDefault).not.toHaveBeenCalled()
    const otherElement = new FakeHtmlElement()
    const otherElementEvent = { code: 'F2', repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: otherElement, preventDefault: vi.fn() }
    keydown(otherElementEvent)
    expect(otherElementEvent.preventDefault).toHaveBeenCalledOnce()
    const downloadEvent = { code: 'F2', repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null, preventDefault: vi.fn() }
    keydown(downloadEvent)
    expect(downloadEvent.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(downloadedFiles).toEqual(['mc-render-screenshot.png', 'mc-render-screenshot.png']))
    const unrelatedEvent = { code: 'F3', repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null, preventDefault: vi.fn() }
    keydown(unrelatedEvent)
    expect(unrelatedEvent.preventDefault).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(revokedUrls).toEqual(['blob:runtime-test', 'blob:runtime-test'])

    for (let frame = 0; frame < 19; frame += 1) {
      expect(runtime.qualityPreset).toBe('high')
      runtime.render(testCamera)
    }
    expect(runtime.qualityPreset).toBe('medium')
    expect(runtime.quality).toStrictEqual(QUALITY_PRESETS.medium)

    const waterMesh = runtime.waterMeshes[0]
    if (!waterMesh) throw new Error('initial water mesh was not attached')
    runtime.detachWaterSurface(waterMesh)
    runtime.detachWaterSurface(waterMesh)
    runtime.attachWaterSurface(new THREE.BufferGeometry())

    runtime.resize()
    expect(observerState.observed).toBe(true)
    const frame = {
      camera: testCamera,
      frame: {
        elapsedSecs: 1,
        deltaSecs: 0.021,
        cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
      },
    }
    runtime.advanceFrame({ ...frame.frame, deltaSecs: 0 })
    runtime.start(() => frame)
    const firstAnimation = frameCallbacks.get(nextFrameId - 1)
    if (!firstAnimation) throw new Error('animation frame was not scheduled')
    firstAnimation()
    runtime.stop()
    expect(cancelledFrames.length).toBeGreaterThan(0)
    runtime.start(() => undefined)
    const emptyAnimation = frameCallbacks.get(nextFrameId - 1)
    if (!emptyAnimation) throw new Error('animation frame was not scheduled')
    emptyAnimation()
    runtime.stop()
    runtime.start(() => undefined)
    const staleAnimation = frameCallbacks.get(nextFrameId - 1)
    if (!staleAnimation) throw new Error('animation frame was not scheduled')
    runtime.dispose()
    expect(observerState.disconnected).toBe(true)
    staleAnimation()
    expect(fakeDocument.listeners.has('keydown')).toBe(false)
    expect(runtime.latestGpuTimeMs).toBe(2.5)
    expect(() => runtime.render(testCamera)).toThrow('browser world runtime is disposed')
    expect(() => runtime.start(() => undefined)).toThrow('browser world runtime is disposed')
    expect(() => runtime.resize()).toThrow('browser world runtime is disposed')
    runtime.dispose()
  })

  it('downgrades after sustained low FPS and skips adaptation for custom quality', async () => {
    const runtime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'high',
    })
    const frame = {
      elapsedSecs: 1,
      deltaSecs: 0.021,
      cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
    }
    for (let index = 0; index < 20; index += 1) runtime.advanceFrame(frame)
    expect(runtime.qualityPreset).toBe('medium')
    runtime.dispose()

    browserMocks.settings.activePixel = browserMocks.settings.referencePixel
    const customRuntime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: { ...QUALITY_PRESETS.high, pixelRatioCap: 1.25 },
    })
    for (let index = 0; index < 20; index += 1) customRuntime.advanceFrame(frame)
    expect(customRuntime.qualityPreset).toBeUndefined()
    customRuntime.render(testCamera)
    customRuntime.dispose()
  })

  it('reports screenshot failures when drawing-buffer capture is disabled or unavailable', async () => {
    const disabled = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      preserveDrawingBuffer: false,
      quality: 'low',
    })
    await expect(disabled.captureScreenshot()).rejects.toThrow('captureScreenshot requires preserveDrawingBuffer')
    const screenshotError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failedShortcut = fakeDocument.listeners.get('keydown')
    if (typeof failedShortcut !== 'function') throw new Error('screenshot shortcut listener was not installed')
    failedShortcut({ code: 'F2', repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null, preventDefault: () => undefined })
    await vi.waitFor(() => expect(screenshotError).toHaveBeenCalledOnce())
    disabled.dispose()

    const missingContext = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    missingContext.render(testCamera)
    screenshotContextAvailable = false
    await expect(missingContext.captureScreenshot()).rejects.toThrow('could not create a 2D screenshot canvas')
    missingContext.dispose()

    screenshotContextAvailable = true
    const missingBlob = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    missingBlob.render(testCamera)
    screenshotBlobAvailable = false
    await expect(missingBlob.captureScreenshot()).rejects.toThrow('screenshot canvas.toBlob returned no image')
    missingBlob.dispose()
  })

  it('validates Three surface instances and requires WebGL2', async () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const renderer = new THREE.WebGLRenderer()
    const cases = [
      { surface: { renderer: {}, scene, camera }, message: 'Browser surface did not provide a THREE.WebGLRenderer' },
      { surface: { renderer, scene: {}, camera }, message: 'Browser surface did not provide a THREE.Scene' },
      { surface: { renderer, scene, camera: {} }, message: 'Browser surface did not provide a THREE.PerspectiveCamera' },
      { surface: { renderer, scene, camera: new THREE.Camera() }, message: 'Browser surface did not provide a THREE.PerspectiveCamera' },
    ]

    for (const { surface, message } of cases) {
      browserMocks.worldFactory.mockImplementationOnce((_three, _canvas, _viewport, _atlas, options) => {
        options.postProcessing(surface)
        return Effect.succeed({})
      })
      const result = await makeBrowserWorldRuntime({
        atlas: new THREE.Texture(),
        autoResize: false,
        canvas: new HTMLCanvasElement(),
      }).then(() => 'unexpected success', (cause: unknown) => cause instanceof Error ? cause.message : String(cause))
      expect(result).toBe(message)
    }

    browserMocks.settings.webgl2 = false
    browserMocks.worldFactory.mockImplementationOnce((_three, _canvas, _viewport, _atlas, options) => {
      options.postProcessing({ renderer, scene, camera })
      return Effect.succeed({})
    })
    await expect(makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    })).rejects.toThrow('Browser renderer requires a WebGL2 context')
  })

  it('loads URL atlases and creates owned atlas textures from RGBA data', async () => {
    const loaded = await makeBrowserWorldRuntime({
      atlas: 'https://assets.test/atlas.png',
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    loaded.dispose()

    const generated = await makeBrowserWorldRuntime({
      atlas: { data: new Uint8ClampedArray([1, 2, 3, 4]), width: 1, height: 1 },
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    generated.dispose()

    const defaultAtlas = await makeBrowserWorldRuntime({
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    defaultAtlas.dispose()
  })

  it('builds the individual viewport and god-rays passes when the composite policy is disabled', async () => {
    const runtime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: { ...QUALITY_PRESETS.ultra, useCompositePass: false },
    })
    runtime.render(testCamera)
    expect(runtime.latestSsim).toBeLessThan(0.95)
    runtime.dispose()
  })

  it('keeps rendering when optional composite uniforms are absent or not vector values', async () => {
    browserMocks.settings.invalidCompositeResolution = true
    browserMocks.settings.omitCompositeDepthUniform = true
    browserMocks.settings.omitCopyDiffuseUniform = true
    const runtime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'ultra',
    })

    expect(() => runtime.render(testCamera)).not.toThrow()
    runtime.dispose()
  })

  it('renders without GPU timing when the timer extension is unavailable', async () => {
    browserMocks.settings.gpuTimerExtension = false
    const runtime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })

    expect(runtime.gpuTimingSupported).toBe(false)
    expect(() => runtime.render(testCamera)).not.toThrow()
    expect(runtime.latestGpuTimeMs).toBeUndefined()
    runtime.dispose()
  })

  it('rejects a production world that does not provide its Three surface', async () => {
    browserMocks.worldFactory.mockImplementationOnce(() => Effect.succeed({
      setPostProcessingChain: () => Effect.void,
    }))
    await expect(makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    })).rejects.toThrow('browser world did not expose its Three surface')
  })

  it('keeps WebGL failures typed and rejects capture before the world is initialized', async () => {
    const failedRender = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'high',
      waterGeometry: new THREE.BufferGeometry(),
    })
    browserMocks.settings.throwOnGetTarget = true
    expect(() => failedRender.render(testCamera)).toThrow('render target query failed')
    browserMocks.settings.throwOnGetTarget = false
    failedRender.dispose()

    browserMocks.worldFactory.mockImplementationOnce((_three, _canvas, _viewport, _atlas, options) => {
      const postProcessing = options.postProcessing({
        renderer: new THREE.WebGLRenderer(),
        scene: new THREE.Scene(),
        camera: new THREE.PerspectiveCamera(),
      })
      postProcessing.render([])
      return Effect.succeed({})
    })
    await expect(makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    })).rejects.toThrow('browser world surface was not initialized')
  })
})
