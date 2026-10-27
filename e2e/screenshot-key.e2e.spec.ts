import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

const WEB_ORIGIN = 'http://127.0.0.1:5182'
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

test('F2 downloads the rendered canvas as a PNG', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)

  await page.evaluate(async () => {
    type CanvasLike = {
      height: number
      style: { height: string; width: string }
      width: number
    }
    type RuntimeLike = { readonly dispose: () => void; readonly render: (camera: unknown) => void }
    type Browser = {
      readonly document: {
        readonly body: { appendChild: (element: CanvasLike) => unknown }
        readonly createElement: (tag: 'canvas') => CanvasLike
      }
      readonly location: { readonly href: string }
      __e2eRuntime?: RuntimeLike
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
    runtime.render({
      position: { x: 0, y: 3, z: 6 },
      rotation: { x: -0.45, y: 0, z: 0, order: 'YXZ' },
      sourceCapturedAtSecs: 0,
    })
    browser.__e2eRuntime = runtime
  })

  try {
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
    expect(bytes.subarray(0, PNG_SIGNATURE.byteLength)).toEqual(PNG_SIGNATURE)
  } finally {
    await page.evaluate(() => {
      type RuntimeLike = { readonly dispose: () => void }
      const browser = globalThis as unknown as { __e2eRuntime?: RuntimeLike }
      browser.__e2eRuntime?.dispose()
      delete browser.__e2eRuntime
    })
  }
})
