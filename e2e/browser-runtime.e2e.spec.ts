import { type Page, expect, test } from '@playwright/test'
import type { Effect } from 'effect'

const WEB_ORIGIN = 'http://127.0.0.1:5182'
const ZERO = 0
const ONE = 1
const TWO = 2
const CANVAS_WIDTH = 320
const CANVAS_HEIGHT = 240
const PIXEL_RATIO = 1
const FRAME_RATE = 60
const FRAME_COUNT = 12
const GPU_TIMER_POLL_FRAME_LIMIT = 60
const FRAME_DELTA_SECS = ONE / FRAME_RATE
const NO_QUERY_RESULT = -1
const BELOW_THRESHOLD_WATER_SIZE = 0.01
const VISIBLE_WATER_SIZE = 16
const HALF_TURN_RADIANS = Math.PI / TWO
const CAMERA = {
  position: { x: ZERO, y: 3, z: 6 },
  rotation: { order: 'YXZ', x: -0.45, y: ZERO, z: ZERO },
  sourceCapturedAtSecs: ZERO,
}
const FRAME_CAMERA_POSITION = { worldX: ZERO, worldY: 3, worldZ: 6 }

type CanvasLike = {
  height: number
  style: { height: string; width: string }
  width: number
}

type BrowserBase = {
  readonly document: {
    readonly body: { appendChild: (element: CanvasLike) => unknown }
    readonly createElement: (tag: 'canvas') => CanvasLike
  }
  readonly location: { readonly href: string }
}

type BrowserWithPerformance = BrowserBase & {
  readonly performance: {
    getEntriesByName: (name: string) => ReadonlyArray<{ readonly duration: number }>
  }
}

type BrowserWithAnimationFrame = BrowserBase & {
  readonly requestAnimationFrame: (callback: (timestamp: number) => void) => number
}

type ExtensionProvider = {
  getExtension: (this: object, name: string) => unknown
}

type BrowserWithWebGL = {
  readonly WebGL2RenderingContext?: { readonly prototype: ExtensionProvider }
}

type BrowserRuntimeOptions = Readonly<{
  camera: typeof CAMERA
  canvasHeight: number
  canvasWidth: number
  maxPixelRatio: number
  one: number
  zero: number
}>

type CompositeRuntimeOptions = BrowserRuntimeOptions & Readonly<{
  cameraPosition: typeof FRAME_CAMERA_POSITION
  deltaSecs: number
  elapsedSecs: number
}>

type RefractionRuntimeOptions = BrowserRuntimeOptions & Readonly<{
  belowThresholdSize: number
  halfTurnRadians: number
  noQueryResult: number
  visibleSize: number
}>

type RuntimeDiagnostics = Readonly<{
  shaderDiagnostics: ReadonlyArray<string>
  uncaughtErrors: ReadonlyArray<string>
}>

type CompositeRuntimeResult = Readonly<{
  compiledPrograms: number
  compositeEnabled: boolean
  measures: ReadonlyArray<Readonly<{ durations: ReadonlyArray<number>; name: string }>>
  pngBytes: number
  pngType: string
  rendererCalls: number
}>

type CompositeRuntime = Readonly<{
  advanceFrame: (frame: Readonly<{
    cameraPosition: typeof FRAME_CAMERA_POSITION
    deltaSecs: number
    elapsedSecs: number
  }>) => Effect.Effect<void, unknown>
  captureScreenshot: () => Effect.Effect<Blob, unknown>
  dispose: () => Effect.Effect<void, unknown>
  quality: Readonly<{ useCompositePass: boolean }>
  render: (camera: typeof CAMERA) => Effect.Effect<void, unknown>
  threeRenderer: Readonly<{
    info: Readonly<{
      programs: ReadonlyArray<unknown> | undefined
      render: Readonly<{ calls: number }>
    }>
  }>
}>

type GpuTimerResult = Readonly<{
  gpuTimingSupported: boolean
  latestGpuTimeMs: number | undefined
}>

type RefractionResult = Readonly<{
  belowThreshold: number
  visible: number
}>

const inspectCompositeRuntime = async (options: CompositeRuntimeOptions): Promise<CompositeRuntimeResult> => {
  const browser = globalThis as unknown as BrowserWithPerformance
  const [runtimeModule, effectModule] = await Promise.all([
    import(new URL('/src/browser.ts', browser.location.href).href),
    import(new URL('/node_modules/.vite/deps/effect.js', browser.location.href).href),
  ])
  const tools = {
    createCanvas: (): CanvasLike => {
      const canvas = Object.assign(browser.document.createElement('canvas'), {
        height: options.canvasHeight,
        style: { height: `${options.canvasHeight}px`, width: `${options.canvasWidth}px` },
        width: options.canvasWidth,
      })
      browser.document.body.appendChild(canvas)
      return canvas
    },
    renderAndInspect: async (runtime: CompositeRuntime) => {
      await effectModule.Effect.runPromise(runtime.advanceFrame({
        cameraPosition: options.cameraPosition,
        deltaSecs: options.deltaSecs,
        elapsedSecs: options.elapsedSecs,
      }))
      await effectModule.Effect.runPromise(runtime.render(options.camera))
      const screenshot = await effectModule.Effect.runPromise(runtime.captureScreenshot())
      const measures = ['render.browser.advanceFrame', 'render.browser.draw'].map((name) => ({
        durations: browser.performance.getEntriesByName(name).map((entry) => entry.duration),
        name,
      }))
      return {
        compiledPrograms: runtime.threeRenderer.info.programs?.length ?? options.zero,
        compositeEnabled: runtime.quality.useCompositePass,
        measures,
        pngBytes: screenshot.size,
        pngType: screenshot.type,
        rendererCalls: runtime.threeRenderer.info.render.calls,
      }
    },
  }
  const canvas = tools.createCanvas()
  const runtime = await effectModule.Effect.runPromise(runtimeModule.makeBrowserWorldRuntime({
    autoResize: false,
    canvas,
    maxPixelRatio: options.maxPixelRatio,
    quality: 'ultra',
  }))
  try {
    return await tools.renderAndInspect(runtime)
  } finally {
    await effectModule.Effect.runPromise(runtime.dispose())
  }
}

const inspectRefraction = async (options: RefractionRuntimeOptions): Promise<RefractionResult> => {
  const browser = globalThis as unknown as BrowserBase
  const [runtimeModule, effectModule, three] = await Promise.all([
    import(new URL('/src/browser.ts', browser.location.href).href),
    import(new URL('/node_modules/.vite/deps/effect.js', browser.location.href).href),
    import(new URL('/node_modules/three/build/three.module.js', browser.location.href).href),
  ])
  const tools = {
    sample: async (size: number): Promise<number> => {
      const canvas = Object.assign(browser.document.createElement('canvas'), {
        height: options.canvasHeight,
        style: { height: `${options.canvasHeight}px`, width: `${options.canvasWidth}px` },
        width: options.canvasWidth,
      })
      browser.document.body.appendChild(canvas)
      const waterGeometry = new three.PlaneGeometry(size, size).rotateX(-options.halfTurnRadians)
      const runtime = await effectModule.Effect.runPromise(runtimeModule.makeBrowserWorldRuntime({
        autoResize: false,
        canvas,
        maxPixelRatio: options.maxPixelRatio,
        quality: 'ultra',
        waterGeometry,
      }))
      try {
        await effectModule.Effect.runPromise(runtime.render(options.camera))
        return runtime.world.waterUniforms['uRefractionValid']?.value ?? options.noQueryResult
      } finally {
        try {
          await effectModule.Effect.runPromise(runtime.dispose())
        } finally {
          waterGeometry.dispose()
        }
      }
    },
  }
  return {
    belowThreshold: await tools.sample(options.belowThresholdSize),
    visible: await tools.sample(options.visibleSize),
  }
}

const inspectGpuTimer = async (options: BrowserRuntimeOptions & Readonly<{ frameCount: number; maxPollFrames: number }>): Promise<GpuTimerResult> => {
  const browser = globalThis as unknown as BrowserWithAnimationFrame
  const [runtimeModule, effectModule] = await Promise.all([
    import(new URL('/src/browser.ts', browser.location.href).href),
    import(new URL('/node_modules/.vite/deps/effect.js', browser.location.href).href),
  ])
  const canvas = Object.assign(browser.document.createElement('canvas'), {
    height: options.canvasHeight,
    style: { height: `${options.canvasHeight}px`, width: `${options.canvasWidth}px` },
    width: options.canvasWidth,
  })
  browser.document.body.appendChild(canvas)
  const runtime = await effectModule.Effect.runPromise(runtimeModule.makeBrowserWorldRuntime({
    autoResize: false,
    canvas,
    maxPixelRatio: options.maxPixelRatio,
    quality: 'low',
  }))
  const tools = {
    nextFrame: (): Promise<void> => new Promise<void>((resolve) => {
      browser.requestAnimationFrame(() => {
        resolve()
      })
    }),
    renderFrames: async (remaining: number): Promise<void> => {
      if (remaining === options.zero) {
        return
      }
      await tools.nextFrame()
      await effectModule.Effect.runPromise(runtime.render(options.camera))
      await tools.renderFrames(remaining - options.one)
    },
    pollForGpuTime: async (remaining: number): Promise<void> => {
      if (
        remaining === options.zero ||
        !runtime.gpuTimingSupported ||
        runtime.latestGpuTimeMs !== undefined
      ) {
        return
      }
      await tools.nextFrame()
      await effectModule.Effect.runPromise(runtime.render(options.camera))
      await tools.pollForGpuTime(remaining - options.one)
    },
  }
  try {
    if (runtime.gpuTimingSupported) {
      await tools.pollForGpuTime(options.maxPollFrames)
    } else {
      await tools.renderFrames(options.frameCount)
    }
    return {
      gpuTimingSupported: runtime.gpuTimingSupported,
      latestGpuTimeMs: runtime.latestGpuTimeMs,
    }
  } finally {
    await effectModule.Effect.runPromise(runtime.dispose())
  }
}

const disableGpuTimerExtension = (): void => {
  const browser = globalThis as unknown as BrowserWithWebGL
  const { WebGL2RenderingContext } = browser
  const prototype = WebGL2RenderingContext?.prototype
  if (!prototype) {
    return
  }
  const { getExtension } = prototype
  prototype.getExtension = function (this: object, name: string): unknown {
    if (name === 'EXT_disjoint_timer_query_webgl2') {
      return null
    }
    return getExtension.call(this, name)
  }
}

const inspectGpuFallback = async (options: BrowserRuntimeOptions): Promise<GpuTimerResult> => {
  const browser = globalThis as unknown as BrowserBase
  const [runtimeModule, effectModule] = await Promise.all([
    import(new URL('/src/browser.ts', browser.location.href).href),
    import(new URL('/node_modules/.vite/deps/effect.js', browser.location.href).href),
  ])
  const canvas = Object.assign(browser.document.createElement('canvas'), {
    height: options.canvasHeight,
    style: { height: `${options.canvasHeight}px`, width: `${options.canvasWidth}px` },
    width: options.canvasWidth,
  })
  browser.document.body.appendChild(canvas)
  const runtime = await effectModule.Effect.runPromise(runtimeModule.makeBrowserWorldRuntime({
    autoResize: false,
    canvas,
    maxPixelRatio: options.maxPixelRatio,
    quality: 'low',
  }))
  try {
    await effectModule.Effect.runPromise(runtime.render(options.camera))
    return {
      gpuTimingSupported: runtime.gpuTimingSupported,
      latestGpuTimeMs: runtime.latestGpuTimeMs,
    }
  } finally {
    await effectModule.Effect.runPromise(runtime.dispose())
  }
}

const watchBrowserErrors = (page: Page): RuntimeDiagnostics => {
  const shaderDiagnostics: Array<string> = []
  const uncaughtErrors: Array<string> = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /WebGLProgram|Shader Error|shader error/i.test(message.text())) {
      shaderDiagnostics.push(message.text())
    }
  })
  page.on('pageerror', (error) => uncaughtErrors.push(error.message))
  return { shaderDiagnostics, uncaughtErrors }
}

const expectCompositeResult = (result: CompositeRuntimeResult): void => {
  expect(result.compositeEnabled).toBe(true)
  expect(result.compiledPrograms).toBeGreaterThan(ZERO)
  expect(result.rendererCalls).toBeGreaterThan(ZERO)
  expect(result.pngType).toBe('image/png')
  expect(result.pngBytes).toBeGreaterThan(ZERO)
}

const expectMeasurements = (result: CompositeRuntimeResult): void => {
  expect(result.measures).toHaveLength(TWO)
  for (const measure of result.measures) {
    expect(measure.durations.length).toBeGreaterThan(ZERO)
    for (const duration of measure.durations) {
      expect(Number.isFinite(duration)).toBe(true)
      expect(duration).toBeGreaterThanOrEqual(ZERO)
    }
  }
}

const expectNoBrowserErrors = (diagnostics: RuntimeDiagnostics): void => {
  expect(diagnostics.shaderDiagnostics).toEqual([])
  expect(diagnostics.uncaughtErrors).toEqual([])
}

test('ultra renders its composite chain and exposes browser stage measures', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)
  const diagnostics = watchBrowserErrors(page)
  const result = await page.evaluate(inspectCompositeRuntime, {
    camera: CAMERA,
    cameraPosition: FRAME_CAMERA_POSITION,
    canvasHeight: CANVAS_HEIGHT,
    canvasWidth: CANVAS_WIDTH,
    deltaSecs: FRAME_DELTA_SECS,
    elapsedSecs: FRAME_DELTA_SECS,
    maxPixelRatio: PIXEL_RATIO,
    one: ONE,
    zero: ZERO,
  })
  expectCompositeResult(result)
  expectMeasurements(result)
  expectNoBrowserErrors(diagnostics)
})

test('visible water captures refraction while sub-threshold water is skipped', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)
  const result = await page.evaluate(inspectRefraction, {
    belowThresholdSize: BELOW_THRESHOLD_WATER_SIZE,
    camera: CAMERA,
    canvasHeight: CANVAS_HEIGHT,
    canvasWidth: CANVAS_WIDTH,
    halfTurnRadians: HALF_TURN_RADIANS,
    maxPixelRatio: PIXEL_RATIO,
    noQueryResult: NO_QUERY_RESULT,
    one: ONE,
    visibleSize: VISIBLE_WATER_SIZE,
    zero: ZERO,
  })
  expect(result.visible).toBe(ONE)
  expect(result.belowThreshold).toBe(ZERO)
})

test('GPU timer uses a completed query when available and keeps rendering without the extension', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)
  const result = await page.evaluate(inspectGpuTimer, {
    camera: CAMERA,
    canvasHeight: CANVAS_HEIGHT,
    canvasWidth: CANVAS_WIDTH,
    frameCount: FRAME_COUNT,
    maxPollFrames: GPU_TIMER_POLL_FRAME_LIMIT,
    maxPixelRatio: PIXEL_RATIO,
    one: ONE,
    zero: ZERO,
  })
  if (result.gpuTimingSupported) {
    expect(result.latestGpuTimeMs).toBeDefined()
    if (result.latestGpuTimeMs !== undefined) {
      expect(Number.isFinite(result.latestGpuTimeMs)).toBe(true)
      expect(result.latestGpuTimeMs).toBeGreaterThanOrEqual(ZERO)
    }
  } else {
    expect(result.gpuTimingSupported).toBe(false)
    expect(result.latestGpuTimeMs).toBeUndefined()
  }
})

test('GPU timer falls back cleanly when WebGL2 lacks the timer-query extension', async ({ page }) => {
  await page.addInitScript(disableGpuTimerExtension)
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)
  const result = await page.evaluate(inspectGpuFallback, {
    camera: CAMERA,
    canvasHeight: CANVAS_HEIGHT,
    canvasWidth: CANVAS_WIDTH,
    maxPixelRatio: PIXEL_RATIO,
    one: ONE,
    zero: ZERO,
  })
  expect(result.gpuTimingSupported).toBe(false)
  expect(result.latestGpuTimeMs).toBeUndefined()
})
