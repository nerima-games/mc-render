import { expect, test } from '@playwright/test'

const WEB_ORIGIN = 'http://127.0.0.1:5182'

test('ultra renders its composite chain and exposes browser stage measures', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)

  const shaderDiagnostics: Array<string> = []
  const uncaughtErrors: Array<string> = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /WebGLProgram|Shader Error|shader error/i.test(message.text())) {
      shaderDiagnostics.push(message.text())
    }
  })
  page.on('pageerror', (error) => uncaughtErrors.push(error.message))

  const result = await page.evaluate(async () => {
    type CanvasLike = {
      height: number
      style: { height: string; width: string }
      width: number
    }
    type Browser = {
      readonly document: {
        readonly body: { appendChild: (element: CanvasLike) => unknown }
        readonly createElement: (tag: 'canvas') => CanvasLike
      }
      readonly location: { readonly href: string }
      readonly performance: {
        getEntriesByName: (name: string) => ReadonlyArray<{ readonly duration: number }>
      }
    }

    const browser = globalThis as unknown as Browser
    const runtimeModule = await import(new URL('/src/browser.ts', browser.location.href).href)
    const canvas = browser.document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    canvas.style.width = '320px'
    canvas.style.height = '240px'
    browser.document.body.appendChild(canvas)

    const runtime = await runtimeModule.makeBrowserWorldRuntime({
      autoResize: false,
      canvas,
      maxPixelRatio: 1,
      quality: 'ultra',
    })
    const camera = {
      position: { x: 0, y: 3, z: 6 },
      rotation: { x: -0.45, y: 0, z: 0, order: 'YXZ' },
      sourceCapturedAtSecs: 0,
    }

    try {
      runtime.advanceFrame({
        cameraPosition: { worldX: 0, worldY: 3, worldZ: 6 },
        deltaSecs: 1 / 60,
        elapsedSecs: 1 / 60,
      })
      runtime.render(camera)
      const screenshot = await runtime.captureScreenshot()
      const measures = ['render.browser.advanceFrame', 'render.browser.draw'].map((name) => ({
        durations: browser.performance.getEntriesByName(name).map((entry) => entry.duration),
        name,
      }))
      return {
        compiledPrograms: runtime.threeRenderer.info.programs?.length ?? 0,
        compositeEnabled: runtime.quality.useCompositePass,
        measures,
        pngBytes: screenshot.size,
        pngType: screenshot.type,
        rendererCalls: runtime.threeRenderer.info.render.calls,
      }
    } finally {
      runtime.dispose()
    }
  })

  expect(result.compositeEnabled).toBe(true)
  expect(result.compiledPrograms).toBeGreaterThan(0)
  expect(result.rendererCalls).toBeGreaterThan(0)
  expect(result.pngType).toBe('image/png')
  expect(result.pngBytes).toBeGreaterThan(0)
  expect(result.measures).toHaveLength(2)
  for (const measure of result.measures) {
    expect(measure.durations.length).toBeGreaterThan(0)
    for (const duration of measure.durations) {
      expect(Number.isFinite(duration)).toBe(true)
      expect(duration).toBeGreaterThanOrEqual(0)
    }
  }
  expect(shaderDiagnostics).toEqual([])
  expect(uncaughtErrors).toEqual([])
})

test('visible water captures refraction while sub-threshold water is skipped', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)

  const result = await page.evaluate(async () => {
    type CanvasLike = {
      height: number
      style: { height: string; width: string }
      width: number
    }
    type Browser = {
      readonly document: {
        readonly body: { appendChild: (element: CanvasLike) => unknown }
        readonly createElement: (tag: 'canvas') => CanvasLike
      }
      readonly location: { readonly href: string }
    }

    const browser = globalThis as unknown as Browser
    const [runtimeModule, three] = await Promise.all([
      import(new URL('/src/browser.ts', browser.location.href).href),
      import(new URL('/node_modules/three/build/three.module.js', browser.location.href).href),
    ])
    const camera = {
      position: { x: 0, y: 3, z: 6 },
      rotation: { x: -0.45, y: 0, z: 0, order: 'YXZ' },
      sourceCapturedAtSecs: 0,
    }

    const sampleRefraction = async (size: number): Promise<number> => {
      const canvas = browser.document.createElement('canvas')
      canvas.width = 320
      canvas.height = 240
      canvas.style.width = '320px'
      canvas.style.height = '240px'
      browser.document.body.appendChild(canvas)

      const waterGeometry = new three.PlaneGeometry(size, size)
      waterGeometry.rotateX(-Math.PI / 2)
      const runtime = await runtimeModule.makeBrowserWorldRuntime({
        autoResize: false,
        canvas,
        maxPixelRatio: 1,
        quality: 'ultra',
        waterGeometry,
      })
      try {
        runtime.render(camera)
        return runtime.world.waterUniforms['uRefractionValid']?.value ?? -1
      } finally {
        runtime.dispose()
        waterGeometry.dispose()
      }
    }

    return {
      belowThreshold: await sampleRefraction(0.01),
      visible: await sampleRefraction(16),
    }
  })

  expect(result.visible).toBe(1)
  expect(result.belowThreshold).toBe(0)
})

test('GPU timer uses a completed query when available and keeps rendering without the extension', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)

  const result = await page.evaluate(async () => {
    type CanvasLike = {
      height: number
      style: { height: string; width: string }
      width: number
    }
    type Browser = {
      readonly document: {
        readonly body: { appendChild: (element: CanvasLike) => unknown }
        readonly createElement: (tag: 'canvas') => CanvasLike
      }
      readonly location: { readonly href: string }
      readonly requestAnimationFrame: (callback: (timestamp: number) => void) => number
    }

    const browser = globalThis as unknown as Browser
    const runtimeModule = await import(new URL('/src/browser.ts', browser.location.href).href)
    const canvas = browser.document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    canvas.style.width = '320px'
    canvas.style.height = '240px'
    browser.document.body.appendChild(canvas)
    const runtime = await runtimeModule.makeBrowserWorldRuntime({
      autoResize: false,
      canvas,
      maxPixelRatio: 1,
      quality: 'low',
    })
    const camera = {
      position: { x: 0, y: 3, z: 6 },
      rotation: { x: -0.45, y: 0, z: 0, order: 'YXZ' },
      sourceCapturedAtSecs: 0,
    }

    try {
      for (let frame = 0; frame < 12; frame += 1) {
        await new Promise<void>((resolve) => browser.requestAnimationFrame(() => resolve()))
        runtime.render(camera)
      }
      return {
        gpuTimingSupported: runtime.gpuTimingSupported,
        latestGpuTimeMs: runtime.latestGpuTimeMs,
      }
    } finally {
      runtime.dispose()
    }
  })

  if (result.gpuTimingSupported) {
    if (result.latestGpuTimeMs !== undefined) {
      expect(Number.isFinite(result.latestGpuTimeMs)).toBe(true)
      expect(result.latestGpuTimeMs).toBeGreaterThanOrEqual(0)
    }
  } else {
    expect(result.latestGpuTimeMs).toBeUndefined()
  }
})

test('GPU timer falls back cleanly when WebGL2 lacks the timer-query extension', async ({ page }) => {
  await page.addInitScript(() => {
    type ExtensionProvider = {
      getExtension: (this: object, name: string) => unknown
    }
    type BrowserWithWebGL = {
      readonly WebGL2RenderingContext?: { readonly prototype: ExtensionProvider }
    }

    const browser = globalThis as unknown as BrowserWithWebGL
    const prototype = browser.WebGL2RenderingContext?.prototype
    if (!prototype) {
      return
    }
    const getExtension = prototype.getExtension
    prototype.getExtension = function (this: object, name: string): unknown {
      if (name === 'EXT_disjoint_timer_query_webgl2') {
        return null
      }
      return getExtension.call(this, name)
    }
  })
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)

  const result = await page.evaluate(async () => {
    type CanvasLike = {
      height: number
      style: { height: string; width: string }
      width: number
    }
    type Browser = {
      readonly document: {
        readonly body: { appendChild: (element: CanvasLike) => unknown }
        readonly createElement: (tag: 'canvas') => CanvasLike
      }
      readonly location: { readonly href: string }
    }

    const browser = globalThis as unknown as Browser
    const runtimeModule = await import(new URL('/src/browser.ts', browser.location.href).href)
    const canvas = browser.document.createElement('canvas')
    canvas.width = 320
    canvas.height = 240
    canvas.style.width = '320px'
    canvas.style.height = '240px'
    browser.document.body.appendChild(canvas)
    const runtime = await runtimeModule.makeBrowserWorldRuntime({
      autoResize: false,
      canvas,
      maxPixelRatio: 1,
      quality: 'low',
    })

    try {
      runtime.render({
        position: { x: 0, y: 3, z: 6 },
        rotation: { x: -0.45, y: 0, z: 0, order: 'YXZ' },
        sourceCapturedAtSecs: 0,
      })
      return {
        gpuTimingSupported: runtime.gpuTimingSupported,
        latestGpuTimeMs: runtime.latestGpuTimeMs,
      }
    } finally {
      runtime.dispose()
    }
  })

  expect(result.gpuTimingSupported).toBe(false)
  expect(result.latestGpuTimeMs).toBeUndefined()
})
