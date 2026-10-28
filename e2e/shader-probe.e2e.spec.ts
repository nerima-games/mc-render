import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const WEB_ORIGIN = 'http://127.0.0.1:5182'
const ZERO = 0
const ONE = 1
const TWO = 2
const FOUR = 4
const WINDOW_SIZE = 8
const LUMA_RANGE = 255
const LUMA_RED = 0.299
const LUMA_GREEN = 0.587
const LUMA_BLUE = 0.114
const SSIM_K1 = 0.01
const SSIM_K2 = 0.03
const SSIM_C1 = (SSIM_K1 * LUMA_RANGE) ** TWO
const SSIM_C2 = (SSIM_K2 * LUMA_RANGE) ** TWO
const SSIM_THRESHOLD = 0.95
const SSIM_CONSTANTS = {
  four: FOUR,
  lumaBlue: LUMA_BLUE,
  lumaGreen: LUMA_GREEN,
  lumaRed: LUMA_RED,
  one: ONE,
  ssimC1: SSIM_C1,
  ssimC2: SSIM_C2,
  two: TWO,
  windowSize: WINDOW_SIZE,
  zero: ZERO,
}

// The image was captured at baseline commit 3b1e59d with this exact fixture and 640x360 canvas.
const RENDER_FIXTURE_SHA256 = '761ba3fc0d699fdcde85fb2f763ee2d18f61d320ebe1ce10714bf13f8cbb1693'
const RENDER_BASELINE_SHA256 = 'fa4d57837b9f7bc85c8ea2d21db33c0e5b7e5b4127501f943d99f5d2ed0510aa'

type ImagePixels = Readonly<{
  data: ArrayLike<number>
  height: number
  width: number
}>

type ImageBitmapLike = Readonly<{ height: number; width: number }>

type CanvasContext2DLike = {
  drawImage: (image: ImageBitmapLike, x: number, y: number) => void
  getImageData: (...coordinates: [x: number, y: number, width: number, height: number]) => ImagePixels
}

type CanvasLike = {
  getContext: (kind: '2d') => CanvasContext2DLike | null
  height: number
  width: number
}

type BrowserImageTools = {
  readonly Blob: new (parts: ReadonlyArray<Uint8Array>, options: { readonly type: string }) => unknown
  readonly atob: (value: string) => string
  readonly createImageBitmap: (blob: unknown) => Promise<ImageBitmapLike>
  readonly document: { readonly createElement: (tag: 'canvas') => CanvasLike }
}

type CompareImagesOptions = Readonly<{
  actualBase64: string
  constants: typeof SSIM_CONSTANTS
  referenceBase64: string
}>

const compareScreenshotSsim = async (images: CompareImagesOptions): Promise<number> => {
  const browser = globalThis as unknown as BrowserImageTools
  const { constants } = images

  const tools = {
    compare: async ({ actualBase64, referenceBase64 }: CompareImagesOptions): Promise<number> => {
      const [actualImage, referenceImage] = await Promise.all([
        tools.decodeImage(actualBase64),
        tools.decodeImage(referenceBase64),
      ])
      if (actualImage.width !== referenceImage.width || actualImage.height !== referenceImage.height) {
        throw new Error('render preview and pinned baseline dimensions differ')
      }
      const actualPixels = tools.readPixels(actualImage)
      const referencePixels = tools.readPixels(referenceImage)
      return tools.scoreImage({ actualPixels, referencePixels })
    },
    decodeBase64: (value: string): Uint8Array => {
      const binary = browser.atob(value)
      return Uint8Array.from(binary, (character) => character.charCodeAt(constants.zero))
    },
    decodeImage: (value: string): Promise<ImageBitmapLike> =>
      browser.createImageBitmap(new browser.Blob([tools.decodeBase64(value)], { type: 'image/png' })),
    luminanceAt: (pixels: ArrayLike<number>, offset: number): number => {
      const red = pixels[offset] ?? constants.zero
      const green = pixels[offset + constants.one] ?? constants.zero
      const blue = pixels[offset + constants.two] ?? constants.zero
      return constants.lumaRed * red + constants.lumaGreen * green + constants.lumaBlue * blue
    },
    mean: (values: ReadonlyArray<number>): number =>
      values.reduce((sum, value) => sum + value, constants.zero) / values.length,
    moments: (values: Readonly<{
      current: ReadonlyArray<number>
      reference: ReadonlyArray<number>
    }>) => {
      const means = {
        current: tools.mean(values.current),
        reference: tools.mean(values.reference),
      }
      const sums = values.current.reduce((sum, currentValue, index) => {
        const currentDelta = currentValue - means.current
        const referenceDelta = (values.reference[index] ?? constants.zero) - means.reference
        return {
          covariance: sum.covariance + currentDelta * referenceDelta,
          currentVariance: sum.currentVariance + currentDelta * currentDelta,
          referenceVariance: sum.referenceVariance + referenceDelta * referenceDelta,
        }
      }, { covariance: constants.zero, currentVariance: constants.zero, referenceVariance: constants.zero })
      const count = values.current.length
      return {
        covariance: sums.covariance / count,
        currentVariance: sums.currentVariance / count,
        referenceVariance: sums.referenceVariance / count,
      }
    },
    readPixels: (image: ImageBitmapLike): ImagePixels => {
      const canvas = browser.document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      if (context === null) {
        throw new Error('SSIM comparison canvas has no 2D context')
      }
      context.drawImage(image, constants.zero, constants.zero)
      return context.getImageData(constants.zero, constants.zero, canvas.width, canvas.height)
    },
    sampleWindow: (window: Readonly<{
      left: number
      pixels: ImagePixels
      top: number
    }>): ReadonlyArray<number> => {
      const values: Array<number> = []
      for (let y = window.top; y < window.top + constants.windowSize; y += constants.one) {
        for (let x = window.left; x < window.left + constants.windowSize; x += constants.one) {
          const offset = (y * window.pixels.width + x) * constants.four
          values.push(tools.luminanceAt(window.pixels.data, offset))
        }
      }
      return values
    },
    scoreImage: (pixels: Readonly<{
      actualPixels: ImagePixels
      referencePixels: ImagePixels
    }>): number => {
      let totalSsim = constants.zero
      let windowCount = constants.zero
      for (let top = constants.zero; top < pixels.actualPixels.height; top += constants.windowSize) {
        for (let left = constants.zero; left < pixels.actualPixels.width; left += constants.windowSize) {
          const current = tools.sampleWindow({ left, pixels: pixels.actualPixels, top })
          const reference = tools.sampleWindow({ left, pixels: pixels.referencePixels, top })
          totalSsim += tools.scoreWindow({ current, reference })
          windowCount += constants.one
        }
      }
      return totalSsim / windowCount
    },
    scoreWindow: (values: Readonly<{
      current: ReadonlyArray<number>
      reference: ReadonlyArray<number>
    }>): number => {
      const currentMean = tools.mean(values.current)
      const referenceMean = tools.mean(values.reference)
      const { covariance, currentVariance, referenceVariance } = tools.moments(values)
      return ((constants.two * currentMean * referenceMean + constants.ssimC1) *
        (constants.two * covariance + constants.ssimC2)) /
        ((currentMean ** constants.two + referenceMean ** constants.two + constants.ssimC1) *
          (currentVariance + referenceVariance + constants.ssimC2))
    },
  }

  return tools.compare(images)
}

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
  await expect.poll(async () => Number(await body.getAttribute('data-pixels-drawn'))).toBeGreaterThan(ZERO)
  await expect.poll(async () => Number(await body.getAttribute('data-tile-colours'))).toBeGreaterThan(ONE)
})

test('render preview stays above 0.95 SSIM against the pinned baseline', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/render-preview/`)
  await expect(page.locator('body')).toHaveAttribute('data-render-preview', 'drawn')

  const renderFixture = await readFile(new URL('../apps/render-preview/terrain-fixture.json', import.meta.url))
  expect(createHash('sha256').update(renderFixture).digest('hex')).toBe(RENDER_FIXTURE_SHA256)
  const reference = await readFile(new URL('./fixtures/render-preview-baseline.png', import.meta.url))
  expect(createHash('sha256').update(reference).digest('hex')).toBe(RENDER_BASELINE_SHA256)
  const actual = await page.locator('#preview-canvas').screenshot()
  const ssim = await page.evaluate(compareScreenshotSsim, {
    actualBase64: actual.toString('base64'),
    constants: SSIM_CONSTANTS,
    referenceBase64: reference.toString('base64'),
  })

  expect(ssim).toBeGreaterThan(SSIM_THRESHOLD)
})
