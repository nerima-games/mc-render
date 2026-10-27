import { type Page, expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const WEB_ORIGIN = 'http://127.0.0.1:5182'
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const CANVAS_WIDTH = 320
const CANVAS_HEIGHT = 240
const PIXEL_RATIO = 1
const ZERO_SECONDS = 0
const BUFFER_START = 0

type CanvasLike = {
  height: number
  style: { height: string; width: string }
  width: number
}

type RuntimeLike = { readonly dispose: () => void; readonly render: (camera: unknown) => void }

type BrowserWithRuntime = {
  readonly document: {
    readonly body: { appendChild: (element: CanvasLike) => unknown }
    readonly createElement: (tag: 'canvas') => CanvasLike
  }
  readonly location: { readonly href: string }
  e2eRuntime?: RuntimeLike
}

type InstallRuntimeOptions = Readonly<{
  canvasHeight: number
  canvasWidth: number
  maxPixelRatio: number
  zeroSeconds: number
}>

const installBrowserRuntime = async (options: InstallRuntimeOptions): Promise<void> => {
  const browser = globalThis as unknown as BrowserWithRuntime
  const runtimeModule = await import(new URL('/src/browser.ts', browser.location.href).href)
  const canvas = browser.document.createElement('canvas')
  Object.assign(canvas, {
    height: options.canvasHeight,
    style: { height: `${options.canvasHeight}px`, width: `${options.canvasWidth}px` },
    width: options.canvasWidth,
  })
  browser.document.body.appendChild(canvas)
  const runtime = await runtimeModule.makeBrowserWorldRuntime({
    autoResize: false,
    canvas,
    maxPixelRatio: options.maxPixelRatio,
    quality: 'low',
  })
  runtime.render({
    position: { x: 0, y: 3, z: 6 },
    rotation: { order: 'YXZ', x: -0.45, y: 0, z: 0 },
    sourceCapturedAtSecs: options.zeroSeconds,
  })
  browser.e2eRuntime = runtime
}

const disposeBrowserRuntime = async (): Promise<void> => {
  const browser = globalThis as unknown as BrowserWithRuntime
  browser.e2eRuntime?.dispose()
  delete browser.e2eRuntime
}

const expectPngDownload = async (page: Page): Promise<void> => {
  const downloadPromise = page.waitForEvent('download')
  await page.keyboard.press('F2')
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('mc-render-screenshot.png')

  const filePath = await download.path()
  if (filePath === null) {
    throw new Error('the PNG download has no local file')
  }
  const bytes = await readFile(filePath)
  expect(bytes.byteLength).toBeGreaterThan(PNG_SIGNATURE.byteLength)
  expect(bytes.subarray(BUFFER_START, PNG_SIGNATURE.byteLength)).toEqual(PNG_SIGNATURE)
}

test('F2 downloads the rendered canvas as a PNG', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)
  await page.evaluate(installBrowserRuntime, {
    canvasHeight: CANVAS_HEIGHT,
    canvasWidth: CANVAS_WIDTH,
    maxPixelRatio: PIXEL_RATIO,
    zeroSeconds: ZERO_SECONDS,
  })

  try {
    await expectPngDownload(page)
  } finally {
    await page.evaluate(disposeBrowserRuntime)
  }
})
