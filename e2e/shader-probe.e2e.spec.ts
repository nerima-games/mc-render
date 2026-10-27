import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

const WEB_ORIGIN = 'http://127.0.0.1:5182'
// The image was captured at baseline commit 3b1e59d with this exact fixture and 640x360 canvas.
const RENDER_FIXTURE_SHA256 = '761ba3fc0d699fdcde85fb2f763ee2d18f61d320ebe1ce10714bf13f8cbb1693'
const RENDER_BASELINE_SHA256 = 'fa4d57837b9f7bc85c8ea2d21db33c0e5b7e5b4127501f943d99f5d2ed0510aa'

test('shader probe compiles and draws each generated shader on WebGL2', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)

  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-shader-probe', 'passed')
  await expect(body).toHaveAttribute('data-shader-probe-compiled', '3')
  await expect(body).toHaveAttribute('data-shader-probe-total', '3')
  await expect(page.locator('#probe-report')).toContainText(
    /OK\s+chunk[\s\S]*OK\s+water[\s\S]*OK\s+particle/u,
  )
})

test('render preview draws the fixed fixture with more than one atlas tile', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/render-preview/`)

  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-render-preview', 'drawn')
  await expect.poll(async () => Number(await body.getAttribute('data-pixels-drawn'))).toBeGreaterThan(0)
  await expect.poll(async () => Number(await body.getAttribute('data-tile-colours'))).toBeGreaterThan(1)
})

test('render preview stays above 0.95 SSIM against the pinned baseline', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/render-preview/`)
  await expect(page.locator('body')).toHaveAttribute('data-render-preview', 'drawn')

  const renderFixture = await readFile(new URL('../apps/render-preview/terrain-fixture.json', import.meta.url))
  expect(createHash('sha256').update(renderFixture).digest('hex')).toBe(RENDER_FIXTURE_SHA256)
  const reference = await readFile(new URL('./fixtures/render-preview-baseline.png', import.meta.url))
  expect(createHash('sha256').update(reference).digest('hex')).toBe(RENDER_BASELINE_SHA256)
  const actual = await page.locator('#preview-canvas').screenshot()

  const ssim = await page.evaluate(async ({ actualBase64, referenceBase64 }) => {
    type ImagePixels = { readonly width: number; readonly height: number; readonly data: ArrayLike<number> }
    type ImageBitmapLike = { readonly width: number; readonly height: number }
    type CanvasContext2DLike = {
      drawImage: (image: ImageBitmapLike, x: number, y: number) => void
      getImageData: (x: number, y: number, width: number, height: number) => ImagePixels
    }
    type CanvasLike = {
      width: number
      height: number
      getContext: (kind: '2d') => CanvasContext2DLike | null
    }
    type BrowserImageTools = {
      readonly atob: (value: string) => string
      readonly Blob: new (parts: ReadonlyArray<Uint8Array>, options: { readonly type: string }) => unknown
      readonly createImageBitmap: (blob: unknown) => Promise<ImageBitmapLike>
      readonly document: { readonly createElement: (tag: 'canvas') => CanvasLike }
    }

    const browser = globalThis as unknown as BrowserImageTools
    const decodeBase64 = (value: string): Uint8Array => {
      const binary = browser.atob(value)
      return Uint8Array.from(binary, (character) => character.charCodeAt(0))
    }
    const [actualImage, referenceImage] = await Promise.all([
      browser.createImageBitmap(new browser.Blob([decodeBase64(actualBase64)], { type: 'image/png' })),
      browser.createImageBitmap(new browser.Blob([decodeBase64(referenceBase64)], { type: 'image/png' })),
    ])
    if (actualImage.width !== referenceImage.width || actualImage.height !== referenceImage.height) {
      throw new Error('render preview and pinned baseline dimensions differ')
    }

    const canvas = browser.document.createElement('canvas')
    canvas.width = actualImage.width
    canvas.height = actualImage.height
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('SSIM comparison canvas has no 2D context')
    }
    context.drawImage(actualImage, 0, 0)
    const actualPixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    context.drawImage(referenceImage, 0, 0)
    const referencePixels = context.getImageData(0, 0, canvas.width, canvas.height).data

    const WINDOW_SIZE = 8
    const LUMA_RANGE = 255
    const LUMA_RED = 0.299
    const LUMA_GREEN = 0.587
    const LUMA_BLUE = 0.114
    const C1 = (0.01 * LUMA_RANGE) ** 2
    const C2 = (0.03 * LUMA_RANGE) ** 2
    let totalSsim = 0
    let windows = 0
    for (let top = 0; top < canvas.height; top += WINDOW_SIZE) {
      for (let left = 0; left < canvas.width; left += WINDOW_SIZE) {
        const currentValues: Array<number> = []
        const referenceValues: Array<number> = []
        for (let y = top; y < top + WINDOW_SIZE; y += 1) {
          for (let x = left; x < left + WINDOW_SIZE; x += 1) {
            const offset = (y * canvas.width + x) * 4
            const currentR = actualPixels[offset] ?? 0
            const currentG = actualPixels[offset + 1] ?? 0
            const currentB = actualPixels[offset + 2] ?? 0
            const referenceR = referencePixels[offset] ?? 0
            const referenceG = referencePixels[offset + 1] ?? 0
            const referenceB = referencePixels[offset + 2] ?? 0
            currentValues.push(LUMA_RED * currentR + LUMA_GREEN * currentG + LUMA_BLUE * currentB)
            referenceValues.push(LUMA_RED * referenceR + LUMA_GREEN * referenceG + LUMA_BLUE * referenceB)
          }
        }

        const count = currentValues.length
        const meanCurrent = currentValues.reduce((sum, value) => sum + value, 0) / count
        const meanReference = referenceValues.reduce((sum, value) => sum + value, 0) / count
        let varianceCurrent = 0
        let varianceReference = 0
        let covariance = 0
        for (let index = 0; index < count; index += 1) {
          const current = (currentValues[index] ?? 0) - meanCurrent
          const reference = (referenceValues[index] ?? 0) - meanReference
          varianceCurrent += current * current
          varianceReference += reference * reference
          covariance += current * reference
        }
        varianceCurrent /= count
        varianceReference /= count
        covariance /= count
        totalSsim +=
          ((2 * meanCurrent * meanReference + C1) * (2 * covariance + C2)) /
          ((meanCurrent ** 2 + meanReference ** 2 + C1) * (varianceCurrent + varianceReference + C2))
        windows += 1
      }
    }
    return totalSsim / windows
  }, {
    actualBase64: actual.toString('base64'),
    referenceBase64: reference.toString('base64'),
  })

  expect(ssim).toBeGreaterThan(0.95)
})
