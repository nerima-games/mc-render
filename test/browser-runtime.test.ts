import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import * as THREE from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GpuTimerService,
  GpuTimerServiceLayer,
  BrowserRuntimeUnknownResultSchema,
  makeBrowserWorldRuntime as makeBrowserWorldRuntimeEffect,
  makeGpuTimerService,
} from '../src/browser.js'
import { mirroredCameraState } from '../src/domain/camera-mirror.js'
import { ParticleDeltaSecsSchema } from '../src/domain/particle-pool.js'
import { QUALITY_PRESETS, type PostProcessingStep } from '../src/domain/post-processing.js'

const testCamera = mirroredCameraState(undefined)
const decodeDelta = Schema.decodeUnknownSync(ParticleDeltaSecsSchema)

const makeBrowserWorldRuntime = (options: Parameters<typeof makeBrowserWorldRuntimeEffect>[0]) =>
  Effect.runPromise(makeBrowserWorldRuntimeEffect(options))

const browserRuntimeFailureFromResult = (actual: unknown): unknown => {
  const inspected = Schema.decodeUnknownResult(BrowserRuntimeUnknownResultSchema, {
    onExcessProperty: 'error',
  })(actual)
  if (Result.isFailure(inspected)) {
    throw new Error(inspected.failure.message)
  }
  if (inspected.success._tag === 'Success') {
    throw new Error(JSON.stringify(inspected.success))
  }
  return inspected.success.failure
}

const browserRuntimeFailure = <Value, Failure>(effect: Effect.Effect<Value, Failure>): unknown =>
  browserRuntimeFailureFromResult(Effect.runSync(Effect.result(effect)))

const browserRuntimeFailureAsync = async <Value, Failure>(effect: Effect.Effect<Value, Failure>): Promise<unknown> =>
  browserRuntimeFailureFromResult(await Effect.runPromise(Effect.result(effect)))

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
    getQueryParameter: vi.fn((_query: unknown, parameter: number) => {
      if (parameter === queryResultAvailable) {
        return available
      }
      return elapsedNanoseconds
    }),
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

  it('preserves an invalid timer extension as a typed Effect failure', () => {
    const { gl } = makeTimerContext({ extension: 'extension' })

    expect(browserRuntimeFailure(makeGpuTimerService(gl))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError',
      operation: 'runtime',
      reason: 'invalid-input',
    })
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

  it('waits for query availability and rejects invalid elapsed values', () => {
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
    expect(browserRuntimeFailure(invalidService.poll)).toStrictEqual({
      _tag: 'BrowserRenderPolicyError',
      operation: 'runtime',
      reason: 'not-finite',
    })
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
    failAtlasDataTextureCreation: false,
    failAtlasUrlLoad: false,
    failRefractionTargetRender: false,
    failScreenshotCanvasCreation: false,
    failScreenshotImageData: false,
    failScreenshotLinkClick: false,
    failScreenshotLinkCreation: false,
    failScreenshotListenerInstall: false,
    failScreenshotToBlob: false,
    failReferenceReadback: false,
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
    disposed = false
    dispose(): void { this.disposed = true }
  }

  class FakeDataTexture extends FakeTexture {
    constructor(..._args: ReadonlyArray<unknown>) {
      super()
      if (browserMocks.settings.failAtlasDataTextureCreation) {
        throw new Error('atlas texture allocation failed')
      }
    }
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
    disposed = false
    dispose(): void { this.disposed = true }
  }

  class FakeShaderMaterial {
    readonly uniforms: Record<string, { value: unknown }>
    constructor(options: { readonly uniforms?: Record<string, { value: unknown }> }) {
      this.uniforms = options.uniforms ?? {}
      if (browserMocks.settings.omitCopyDiffuseUniform) {
        delete this.uniforms['tDiffuse']
      }
    }
    disposed = false
    dispose(): void { this.disposed = true }
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
      if (!value) {
        browserMocks.settings.hiddenWaterWasRendered = true
      }
    }
    worldMatrixUpdated = false
    updateWorldMatrix(_updateParents: boolean, _updateChildren: boolean): void {
      this.worldMatrixUpdated = true
    }
  }

  class FakeScene {}
  class FakeCamera {}
  class FakePerspectiveCamera extends FakeCamera {
    far = 1000
    near = 0.1
    matrixWorldUpdated = false
    updateMatrixWorld(): void { this.matrixWorldUpdated = true }
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
    boundingBoxComputed = false
    computeBoundingBox(): void { this.boundingBoxComputed = true }
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
      getExtension: () => {
        if (browserMocks.settings.gpuTimerExtension) {
          return { GPU_DISJOINT_EXT: 1, TIME_ELAPSED_EXT: 2 }
        }
        return null
      },
      getParameter: () => false,
      getQueryParameter: (_query: unknown, parameter: number) => {
        if (parameter === 6) {
          return true
        }
        return 2_500_000
      },
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

    getContext(): unknown {
      if (browserMocks.settings.webgl2) {
        return this.context
      }
      return {}
    }
    drawingBufferSize = new FakeVector2(8, 8)
    getDrawingBufferSize(target: FakeVector2): FakeVector2 {
      this.drawingBufferSize = target.set(8, 8)
      return this.drawingBufferSize
    }
    getRenderTarget(): unknown {
      if (browserMocks.settings.throwOnGetTarget) {
        throw new Error('render target query failed')
      }
      return this.target
    }
    readRenderTargetPixels(
      target: unknown,
      _x: number,
      _y: number,
      _width: number,
      _height: number,
      pixels: Uint8Array,
    ): void {
      if (browserMocks.settings.failReferenceReadback) {
        throw new Error('reference readback failed')
      }
      this.lastReadTarget = target
      this.lastReadPixels = pixels
      pixels.fill(browserMocks.settings.referencePixel)
    }
    lastReadTarget: unknown
    lastReadPixels: Uint8Array | undefined
    lastRenderedScene: unknown
    lastRenderedCamera: unknown
    render(scene: unknown, camera: unknown): void {
      if (browserMocks.settings.failRefractionTargetRender) {
        throw new Error('refraction render failed')
      }
      this.lastRenderedScene = scene
      this.lastRenderedCamera = camera
    }
    pixelRatio = 1
    setPixelRatio(ratio: number): void { this.pixelRatio = ratio }
    setRenderTarget(target: unknown): void { this.target = target }
    clearCount = 0
    clear(): void { this.clearCount += 1 }
  }

  class FakeTextureLoader {
    loadedUrl: string | undefined
    async loadAsync(url: string): Promise<FakeTexture> {
      this.loadedUrl = url
      if (browserMocks.settings.failAtlasUrlLoad) {
        throw new Error('atlas URL load failed')
      }
      return new FakeTexture()
    }
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
vi.mock('three/addons/postprocessing/BokehPass.js', () => {
  class BokehPass {
    disposed = false
    dispose(): void { this.disposed = true }
  }
  return { BokehPass }
})
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
    disposed = false
    dispose(): void { this.disposed = true }
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
    pixelRatio = 1
    setPixelRatio(ratio: number): void { this.pixelRatio = ratio }
    setSize(width: number, height: number): void {
      for (const pass of this.passes) {
        pass.setSize?.(width, height)
      }
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
vi.mock('three/addons/postprocessing/GTAOPass.js', () => {
  class GTAOPass {
    disposed = false
    dispose(): void { this.disposed = true }
  }
  return { GTAOPass }
})
vi.mock('three/addons/postprocessing/OutputPass.js', () => {
  class OutputPass {
    disposed = false
    dispose(): void { this.disposed = true }
  }
  return { OutputPass }
})
vi.mock('three/addons/postprocessing/Pass.js', () => {
  class FullScreenQuad {
    readonly material: unknown
    constructor(material: unknown) { this.material = material }
    disposed = false
    dispose(): void { this.disposed = true }
    lastRenderer: unknown
    render(renderer: unknown): void { this.lastRenderer = renderer }
  }
  class Pass {
    disposed = false
    dispose(): void { this.disposed = true }
  }
  return { FullScreenQuad, Pass }
})
vi.mock('three/addons/postprocessing/RenderPass.js', () => {
  class RenderPass {
    disposed = false
    dispose(): void { this.disposed = true }
  }
  return { RenderPass }
})
vi.mock('three/addons/postprocessing/SMAAPass.js', () => {
  class SMAAPass {
    disposed = false
    dispose(): void { this.disposed = true }
  }
  return { SMAAPass }
})
vi.mock('three/addons/postprocessing/ShaderPass.js', () => ({
  ShaderPass: class {
    readonly uniforms: Record<string, { value: unknown }>
    constructor(shader: { readonly uniforms: Record<string, { value: unknown }> }) {
      this.uniforms = shader.uniforms
      if (browserMocks.settings.omitCompositeDepthUniform) {
        delete this.uniforms['tDepth']
      }
      if (browserMocks.settings.invalidCompositeResolution && this.uniforms['uResolution']) {
        this.uniforms['uResolution'].value = {}
      }
    }
    disposed = false
    dispose(): void { this.disposed = true }
    lastRender: ReadonlyArray<unknown> = []
    render(...args: ReadonlyArray<unknown>): void { this.lastRender = args }
    size = { width: 0, height: 0 }
    setSize(width: number, height: number): void { this.size = { width, height } }
  },
}))
vi.mock('three/addons/postprocessing/UnrealBloomPass.js', () => {
  class UnrealBloomPass {
    disposed = false
    dispose(): void { this.disposed = true }
  }
  return { UnrealBloomPass }
})

let originalDocument: PropertyDescriptor | undefined = undefined
let originalCanvasConstructor: PropertyDescriptor | undefined = undefined
let originalDevicePixelRatio: PropertyDescriptor | undefined = undefined
let originalResizeObserver: PropertyDescriptor | undefined = undefined
let originalAnimationFrame: PropertyDescriptor | undefined = undefined
let originalCancelAnimationFrame: PropertyDescriptor | undefined = undefined
let originalUrl: PropertyDescriptor | undefined = undefined
let frameCallbacks: Map<number, () => void> = new Map()
let cancelledFrames: Array<number> = []
let nextFrameId = 1
let downloadedFiles: Array<string> = []
let revokedUrls: Array<string> = []
let appendedElements: Array<unknown> = []
let screenshotPixel: number | undefined = undefined
let screenshotContextAvailable = true
let screenshotBlobAvailable = true
let observerState = { disconnected: false, observed: false }

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

let fakeDocument: FakeDocument | undefined = undefined

const requireFakeDocument = (): FakeDocument => {
  if (!fakeDocument) {
    throw new Error('fake document was not initialized')
  }
  return fakeDocument
}

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
  appendedElements = []
  screenshotPixel = undefined
  screenshotContextAvailable = true
  screenshotBlobAvailable = true
  observerState = { disconnected: false, observed: false }
  fakeDocument = {
    body: { append: (element) => { appendedElements.push(element) } },
    defaultView: { HTMLElement: FakeHtmlElement },
    listeners: new Map(),
    addEventListener(type, listener) {
      if (browserMocks.settings.failScreenshotListenerInstall) {
        throw new Error('screenshot listener installation failed')
      }
      this.listeners.set(type, listener)
    },
    createElement(name) {
      if (name === 'canvas') {
        if (browserMocks.settings.failScreenshotCanvasCreation) {
          throw new Error('screenshot canvas creation failed')
        }
        return {
          width: 0,
          height: 0,
          getContext(type: string) {
            if (type !== '2d' || !screenshotContextAvailable) {
              return null
            }
            return {
              createImageData(width: number, height: number) {
                if (browserMocks.settings.failScreenshotImageData) {
                  throw new Error('screenshot image allocation failed')
                }
                return { data: new Uint8ClampedArray(width * height * 4) }
              },
              putImageData(image: { readonly data: Uint8ClampedArray }) {
                const [firstPixel] = image.data
                screenshotPixel = firstPixel
              },
            }
          },
          toBlob(callback: (blob: Blob | null) => void, type: string) {
            if (browserMocks.settings.failScreenshotToBlob) {
              throw new Error('screenshot encoding failed')
            }
            if (screenshotBlobAvailable) {
              callback(new Blob([], { type }))
              return
            }
            callback(null)
          },
        }
      }
      if (name === 'a' && browserMocks.settings.failScreenshotLinkCreation) {
        throw new Error('screenshot link creation failed')
      }
      const link = {
        download: '',
        hidden: false,
        href: '',
        click() {
          if (browserMocks.settings.failScreenshotLinkClick) {
            throw new Error('screenshot link click failed')
          }
          downloadedFiles.push(this.download)
        },
        removed: false,
        remove() { this.removed = true },
      }
      return link
    },
    removeEventListener(type, listener) {
      if (this.listeners.get(type) === listener) {
        this.listeners.delete(type)
      }
    },
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  const initializedDocument = requireFakeDocument()
  Object.defineProperty(globalThis, 'HTMLCanvasElement', {
    configurable: true,
    value: class {
      readonly ownerDocument = initializedDocument
      readonly clientWidth = 8
      readonly clientHeight = 8
      width = 8
      height = 8
    },
  })
  Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
      value: class FakeResizeObserver {
        readonly callback: () => void
        constructor(callback: () => void) { this.callback = callback }
        observedTarget: unknown
        disconnected = false
        observe(target: unknown): void {
          this.observedTarget = target
          observerState.observed = true
        }
        disconnect(): void {
          this.disconnected = true
          observerState.disconnected = true
        }
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
  browserMocks.settings.failAtlasDataTextureCreation = false
  browserMocks.settings.failAtlasUrlLoad = false
  browserMocks.settings.failRefractionTargetRender = false
  browserMocks.settings.failScreenshotCanvasCreation = false
  browserMocks.settings.failScreenshotImageData = false
  browserMocks.settings.failScreenshotLinkClick = false
  browserMocks.settings.failScreenshotLinkCreation = false
  browserMocks.settings.failScreenshotListenerInstall = false
  browserMocks.settings.failScreenshotToBlob = false
  browserMocks.settings.failReferenceReadback = false
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
  it('property: invalid custom pixel caps fail the public runtime Effect with tagged details', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, 0.25, 3), (pixelRatioCap) => {
        const actual = Effect.runSync(Effect.result(makeBrowserWorldRuntimeEffect({
          atlas: new THREE.Texture(),
          autoResize: false,
          canvas: new HTMLCanvasElement(),
          quality: { ...QUALITY_PRESETS.high, pixelRatioCap },
        })))
        const inspected = Schema.decodeUnknownResult(BrowserRuntimeUnknownResultSchema, {
          onExcessProperty: 'error',
        })(actual)
        expect(Result.isSuccess(inspected)).toBe(true)
        if (Result.isFailure(inspected)) {
          return
        }
        let operation: 'pixel-ratio' | 'quality' = 'quality'
        let reason: 'out-of-range' | 'invalid-input' = 'invalid-input'
        if (Number.isFinite(pixelRatioCap)) {
          operation = 'pixel-ratio'
          reason = 'out-of-range'
        }
        expect(inspected.success).toStrictEqual({
          _tag: 'Failure',
          _op: 'Failure',
          failure: {
            _tag: 'BrowserRenderPolicyError',
            operation,
            reason,
          },
        })
      }),
    )
  })

  it('returns typed failures when runtime pixel ratio or viewport inputs are invalid', () => {
    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 0 })
    expect(browserRuntimeFailure(makeBrowserWorldRuntimeEffect({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError',
      operation: 'pixel-ratio',
      reason: 'out-of-range',
    })

    Object.defineProperty(globalThis, 'devicePixelRatio', { configurable: true, value: 1 })
    const canvas = new HTMLCanvasElement()
    Object.defineProperty(canvas, 'clientWidth', { configurable: true, value: Number.NaN })
    expect(browserRuntimeFailure(makeBrowserWorldRuntimeEffect({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas,
    }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError',
      operation: 'viewport',
      reason: 'invalid-input',
    })
  })

  it('maps atlas loader and texture allocation failures to initialization errors', async () => {
    browserMocks.settings.failAtlasUrlLoad = true
    const urlFailure = await browserRuntimeFailureAsync(makeBrowserWorldRuntimeEffect({
      atlas: 'https://assets.test/missing-atlas.png',
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    }))
    expect(urlFailure).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'initialization',
      reason: 'operation-failed',
    })

    browserMocks.settings.failAtlasUrlLoad = false
    browserMocks.settings.failAtlasDataTextureCreation = true
    const textureFailure = browserRuntimeFailure(makeBrowserWorldRuntimeEffect({
      atlas: { data: new Uint8ClampedArray([1, 2, 3, 4]), height: 1, width: 1 },
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    }))
    expect(textureFailure).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'initialization',
      reason: 'operation-failed',
    })
  })

  it('reports a malformed post-processing pass from the runtime boundary', async () => {
    const runtime = await makeBrowserWorldRuntime({ canvas: new HTMLCanvasElement(), atlas: new THREE.Texture() })
    try {
      Effect.runSync(runtime.world.setPostProcessingChain(JSON.parse('[{"effects":[],"pass":"unsupported"}]')))
      expect(browserRuntimeFailure(runtime.render(testCamera))).toMatchObject({
        _tag: 'BrowserRuntimeError',
        operation: 'runtime',
        reason: 'operation-failed',
      })
    } finally {
      Effect.runSync(runtime.dispose())
    }
  })

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
    expect(browserRuntimeFailure(runtime.captureScreenshot())).toStrictEqual({
      _tag: 'BrowserRuntimeError',
      operation: 'screenshot',
      reason: 'not-rendered',
      cause: undefined,
    })
    Effect.runSync(runtime.render(testCamera))
    expect(runtime.latestSsim).toBeLessThan(0.95)
    expect(browserMocks.settings.hiddenWaterWasRendered).toBe(true)
    expect(runtime.waterMeshes[0]?.visible).toBe(true)
    const blob = await Effect.runPromise(runtime.captureScreenshot())
    expect(blob.type).toBe('image/png')
    expect(screenshotPixel).toBe(0)

    const keydown = requireFakeDocument().listeners.get('keydown')
    if (typeof keydown !== 'function') {
      throw new Error('screenshot shortcut listener was not installed')
    }
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
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 0)
    })
    expect(revokedUrls).toEqual(['blob:runtime-test', 'blob:runtime-test'])

    for (let frame = 0; frame < 19; frame += 1) {
      expect(runtime.qualityPreset).toBe('high')
      Effect.runSync(runtime.render(testCamera))
    }
    expect(runtime.qualityPreset).toBe('medium')
    expect(runtime.quality).toStrictEqual(QUALITY_PRESETS.medium)

    const [waterMesh] = runtime.waterMeshes
    if (!waterMesh) {
      throw new Error('initial water mesh was not attached')
    }
    Effect.runSync(runtime.detachWaterSurface(waterMesh))
    Effect.runSync(runtime.detachWaterSurface(waterMesh))
    Effect.runSync(runtime.attachWaterSurface(new THREE.BufferGeometry()))

    Effect.runSync(runtime.resize())
    expect(observerState.observed).toBe(true)
    const frame = {
      camera: testCamera,
      frame: {
        elapsedSecs: 1,
        deltaSecs: decodeDelta(0.021),
        cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
      },
    }
    Effect.runSync(runtime.advanceFrame({ ...frame.frame, deltaSecs: decodeDelta(0) }))
    Effect.runSync(runtime.start(() => frame))
    const firstAnimation = frameCallbacks.get(nextFrameId - 1)
    if (!firstAnimation) {
      throw new Error('animation frame was not scheduled')
    }
    firstAnimation()
    Effect.runSync(runtime.stop())
    expect(cancelledFrames.length).toBeGreaterThan(0)
    Effect.runSync(runtime.start(() => undefined))
    const emptyAnimation = frameCallbacks.get(nextFrameId - 1)
    if (!emptyAnimation) {
      throw new Error('animation frame was not scheduled')
    }
    emptyAnimation()
    Effect.runSync(runtime.stop())
    Effect.runSync(runtime.start(() => undefined))
    const staleAnimation = frameCallbacks.get(nextFrameId - 1)
    if (!staleAnimation) {
      throw new Error('animation frame was not scheduled')
    }
    Effect.runSync(runtime.dispose())
    expect(observerState.disconnected).toBe(true)
    staleAnimation()
    expect(requireFakeDocument().listeners.has('keydown')).toBe(false)
    expect(runtime.latestGpuTimeMs).toBe(2.5)
    expect(browserRuntimeFailure(runtime.render(testCamera))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError',
      operation: 'runtime',
      reason: 'disposed',
    })
    expect(browserRuntimeFailure(runtime.start(() => undefined))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'disposed',
    })
    expect(browserRuntimeFailure(runtime.resize())).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'disposed',
    })
    Effect.runSync(runtime.dispose())
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
      deltaSecs: decodeDelta(0.021),
      cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
    }
    for (let index = 0; index < 20; index += 1) {
      Effect.runSync(runtime.advanceFrame(frame))
    }
    expect(runtime.qualityPreset).toBe('medium')
    Effect.runSync(runtime.dispose())

    browserMocks.settings.activePixel = browserMocks.settings.referencePixel
    const customRuntime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: { ...QUALITY_PRESETS.high, pixelRatioCap: 1.25 },
    })
    for (let index = 0; index < 20; index += 1) {
      Effect.runSync(customRuntime.advanceFrame(frame))
    }
    expect(customRuntime.qualityPreset).toBeUndefined()
    Effect.runSync(customRuntime.render(testCamera))
    Effect.runSync(customRuntime.dispose())
  })

  it('reports screenshot failures when drawing-buffer capture is disabled or unavailable', async () => {
    const disabled = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      preserveDrawingBuffer: false,
      quality: 'low',
    })
    expect(browserRuntimeFailure(disabled.captureScreenshot())).toStrictEqual({
      _tag: 'BrowserRuntimeError',
      operation: 'screenshot',
      reason: 'unavailable',
      cause: undefined,
    })
    const screenshotError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const failedShortcut = requireFakeDocument().listeners.get('keydown')
    if (typeof failedShortcut !== 'function') {
      throw new Error('screenshot shortcut listener was not installed')
    }
    failedShortcut({ code: 'F2', repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, target: null, preventDefault: () => undefined })
    await vi.waitFor(() => expect(screenshotError).toHaveBeenCalledOnce())
    Effect.runSync(disabled.dispose())

    const missingContext = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    Effect.runSync(missingContext.render(testCamera))
    screenshotContextAvailable = false
    expect(browserRuntimeFailure(missingContext.captureScreenshot())).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'screenshot',
      reason: 'unavailable',
    })
    Effect.runSync(missingContext.dispose())

    screenshotContextAvailable = true
    const missingBlob = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    Effect.runSync(missingBlob.render(testCamera))
    screenshotBlobAvailable = false
    expect(await browserRuntimeFailureAsync(missingBlob.captureScreenshot())).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'screenshot',
      reason: 'encoding-failed',
    })
    Effect.runSync(missingBlob.dispose())
  })

  it('maps screenshot canvas, pixel-copy, and encoding exceptions to typed failures', async () => {
    const runtime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    Effect.runSync(runtime.render(testCamera))

    browserMocks.settings.failScreenshotCanvasCreation = true
    expect(browserRuntimeFailure(runtime.captureScreenshot())).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'screenshot',
      reason: 'operation-failed',
    })

    browserMocks.settings.failScreenshotCanvasCreation = false
    browserMocks.settings.failScreenshotImageData = true
    expect(browserRuntimeFailure(runtime.captureScreenshot())).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'screenshot',
      reason: 'operation-failed',
    })

    browserMocks.settings.failScreenshotImageData = false
    browserMocks.settings.failScreenshotToBlob = true
    expect(await browserRuntimeFailureAsync(runtime.captureScreenshot())).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'screenshot',
      reason: 'encoding-failed',
    })
    Effect.runSync(runtime.dispose())
  })

  it('reports screenshot URL and click failures while releasing a created download link', async () => {
    const runtime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    Effect.runSync(runtime.render(testCamera))
    const screenshotError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const shortcut = requireFakeDocument().listeners.get('keydown')
    if (typeof shortcut !== 'function') {
      throw new Error('screenshot shortcut listener was not installed')
    }
    const pressShortcut = (): void => shortcut({
      altKey: false,
      code: 'F2',
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
      repeat: false,
      shiftKey: false,
      target: null,
    })

    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      throw new Error('object URL creation failed')
    })
    pressShortcut()
    await vi.waitFor(() => expect(screenshotError).toHaveBeenCalledOnce())
    expect(createObjectUrl).toHaveBeenCalledOnce()
    createObjectUrl.mockRestore()

    screenshotError.mockClear()
    browserMocks.settings.failScreenshotLinkClick = true
    pressShortcut()
    await vi.waitFor(() => expect(screenshotError).toHaveBeenCalledOnce())
    expect(appendedElements).toHaveLength(1)
    expect(appendedElements[0]).toMatchObject({ removed: true })
    await vi.waitFor(() => expect(revokedUrls).toEqual(['blob:runtime-test']))
    Effect.runSync(runtime.dispose())
  })

  it('validates Three surface instances and requires WebGL2', async () => {
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const renderer = new THREE.WebGLRenderer()
    const cases = [
      { surface: { renderer: {}, scene, camera } },
      { surface: { renderer, scene: {}, camera } },
      { surface: { renderer, scene, camera: {} } },
      { surface: { renderer, scene, camera: new THREE.Camera() } },
    ]

    const validationFailures = cases.map(({ surface }) => {
      browserMocks.worldFactory.mockImplementationOnce((_three, _canvas, _viewport, _atlas, options) => {
        options.postProcessing(surface)
        return Effect.succeed({})
      })
      return browserRuntimeFailure(makeBrowserWorldRuntimeEffect({
        atlas: new THREE.Texture(),
        autoResize: false,
        canvas: new HTMLCanvasElement(),
      }))
    })
    expect(validationFailures).toHaveLength(cases.length)
    for (const failure of validationFailures) {
      expect(failure).toMatchObject({
        _tag: 'BrowserRuntimeError',
        operation: 'initialization',
        reason: 'operation-failed',
      })
    }

    browserMocks.settings.webgl2 = false
    browserMocks.worldFactory.mockImplementationOnce((_three, _canvas, _viewport, _atlas, options) => {
      options.postProcessing({ renderer, scene, camera })
      return Effect.succeed({})
    })
    const unsupportedWebGl = makeBrowserWorldRuntimeEffect({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    })
    expect(browserRuntimeFailure(unsupportedWebGl)).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'initialization',
    })
  })

  it('loads URL atlases and creates owned atlas textures from RGBA data', async () => {
    const loaded = await makeBrowserWorldRuntime({
      atlas: 'https://assets.test/atlas.png',
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    Effect.runSync(loaded.dispose())

    const generated = await makeBrowserWorldRuntime({
      atlas: { data: new Uint8ClampedArray([1, 2, 3, 4]), width: 1, height: 1 },
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    Effect.runSync(generated.dispose())

    const defaultAtlas = await makeBrowserWorldRuntime({
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'low',
    })
    Effect.runSync(defaultAtlas.dispose())
  })

  it('builds the individual viewport and god-rays passes when the composite policy is disabled', async () => {
    const runtime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: { ...QUALITY_PRESETS.ultra, useCompositePass: false },
    })
    Effect.runSync(runtime.render(testCamera))
    expect(runtime.latestSsim).toBeLessThan(0.95)
    Effect.runSync(runtime.dispose())
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

    expect(() => Effect.runSync(runtime.render(testCamera))).not.toThrow()
    Effect.runSync(runtime.dispose())
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
    expect(() => Effect.runSync(runtime.render(testCamera))).not.toThrow()
    expect(runtime.latestGpuTimeMs).toBeUndefined()
    Effect.runSync(runtime.dispose())
  })

  it('rejects a production world that does not provide its Three surface', async () => {
    browserMocks.worldFactory.mockImplementationOnce(() => Effect.succeed({
      setPostProcessingChain: () => Effect.void,
    }))
    expect(browserRuntimeFailure(makeBrowserWorldRuntimeEffect({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    }))).toStrictEqual({ _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'missing-value' })
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
    expect(browserRuntimeFailure(failedRender.render(testCamera))).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'runtime',
      reason: 'operation-failed',
    })
    browserMocks.settings.throwOnGetTarget = false
    Effect.runSync(failedRender.dispose())

    browserMocks.worldFactory.mockImplementationOnce(() =>
      Effect.succeed({ setPostProcessingChain: () => Effect.void }),
    )
    expect(browserRuntimeFailure(makeBrowserWorldRuntimeEffect({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    }))).toMatchObject({ _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'missing-value' })
  })

  it('maps refraction setup, refraction rendering, and reference readback exceptions', async () => {
    const setupFailure = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'high',
      waterGeometry: new THREE.BufferGeometry(),
    })
    const [setupFailureMesh] = setupFailure.waterMeshes
    if (!setupFailureMesh) {
      throw new Error('water mesh was not attached')
    }
    Object.defineProperty(setupFailureMesh, 'visible', {
      configurable: true,
      get: () => true,
      set: () => { throw new Error('water visibility update failed') },
    })
    expect(browserRuntimeFailure(setupFailure.render(testCamera))).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'runtime',
      reason: 'operation-failed',
    })
    Effect.runSync(setupFailure.dispose())

    const renderFailure = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'high',
      waterGeometry: new THREE.BufferGeometry(),
    })
    browserMocks.settings.failRefractionTargetRender = true
    expect(browserRuntimeFailure(renderFailure.render(testCamera))).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'runtime',
      reason: 'operation-failed',
    })
    browserMocks.settings.failRefractionTargetRender = false
    Effect.runSync(renderFailure.dispose())

    const readbackFailure = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      quality: 'high',
    })
    browserMocks.settings.failReferenceReadback = true
    expect(browserRuntimeFailure(readbackFailure.render(testCamera))).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'runtime',
      reason: 'operation-failed',
    })
    browserMocks.settings.failReferenceReadback = false
    Effect.runSync(readbackFailure.dispose())
  })

  it('rejects invalid water surface method arguments at the public runtime boundary', async () => {
    const runtime = await makeBrowserWorldRuntime({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    })

    const invalidAttach = browserRuntimeFailure(Reflect.apply(
      Reflect.get(runtime, 'attachWaterSurface'),
      runtime,
      [{}],
    ))
    expect(invalidAttach).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'runtime',
      reason: 'invalid-input',
    })

    const invalidDetach = browserRuntimeFailure(Reflect.apply(
      Reflect.get(runtime, 'detachWaterSurface'),
      runtime,
      [{}],
    ))
    expect(invalidDetach).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'runtime',
      reason: 'invalid-input',
    })
    Effect.runSync(runtime.dispose())
  })

  it('maps world option assembly and runtime installation exceptions to initialization failures', () => {
    const world = Object.defineProperty({}, 'invalidOption', {
      enumerable: true,
      get: () => { throw new Error('world option inspection failed') },
    })
    expect(browserRuntimeFailure(makeBrowserWorldRuntimeEffect({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
      world,
    }))).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'initialization',
      reason: 'operation-failed',
    })

    browserMocks.settings.failScreenshotListenerInstall = true
    expect(browserRuntimeFailure(makeBrowserWorldRuntimeEffect({
      atlas: new THREE.Texture(),
      autoResize: false,
      canvas: new HTMLCanvasElement(),
    }))).toMatchObject({
      _tag: 'BrowserRuntimeError',
      operation: 'initialization',
      reason: 'operation-failed',
    })
  })
})
