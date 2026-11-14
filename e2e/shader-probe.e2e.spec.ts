import { type Page, expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const WEB_ORIGIN = process.env['WEB_ORIGIN'] ?? 'http://127.0.0.1:5182'
const ZERO = 0
const ONE = 1
const TWO = 2
const THREE = 3
const TEN = 10
const TWENTY = 20
const FOUR = 4
const ENTITY_GALLERY_SEGMENTS = 4
const MIN_VISIBLE_ENTITY_PIXELS = 100
const VISIBLE_PIXEL_RGB_DISTANCE = 48
const ENTITY_GALLERY_CELL_HORIZONTAL_INSET = 0.125
const ENTITY_GALLERY_CELL_VERTICAL_TOP_INSET = 0.25
const ENTITY_GALLERY_CELL_VERTICAL_BOTTOM_INSET = 0.125
const ENTITY_GALLERY_PIXEL_CONSTANTS = {
  four: FOUR,
  horizontalInset: ENTITY_GALLERY_CELL_HORIZONTAL_INSET,
  one: ONE,
  two: TWO,
  verticalBottomInset: ENTITY_GALLERY_CELL_VERTICAL_BOTTOM_INSET,
  verticalTopInset: ENTITY_GALLERY_CELL_VERTICAL_TOP_INSET,
  zero: ZERO,
}
const ITEM_ICON_ANIMATION_SECONDS = 0.25
const ITEM_ICON_BOB_END_SECONDS = 0.75
const ARROW_MIN_ASPECT_RATIO = 1.5
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
const PARTIAL_TICK_BEFORE_BOUNDARY = 0.99
const SSIM_CONSTANTS = {
  four: FOUR,
  lumaBlue: LUMA_BLUE,
  lumaGreen: LUMA_GREEN,
  lumaRed: LUMA_RED,
  one: ONE,
  ssimC1: SSIM_C1,
  ssimC2: SSIM_C2,
  three: THREE,
  two: TWO,
  windowSize: WINDOW_SIZE,
  zero: ZERO,
}

// The image was captured at baseline commit 3b1e59d with this exact fixture and 640x360 canvas.
const RENDER_FIXTURE_SHA256 = '761ba3fc0d699fdcde85fb2f763ee2d18f61d320ebe1ce10714bf13f8cbb1693'
const RENDER_BASELINE_SHA256 = '9c6d775c841c9ff9009999d3e7d46bb5ef478dd19205c42066953ed532fb00ae'

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

type EntityGalleryPixelsOptions = Readonly<{
  constants: typeof ENTITY_GALLERY_PIXEL_CONSTANTS
  imageBase64: string
  segmentCount: number
  visibleColorDistance: number
}>

type AtlasMipReadback = Readonly<{
  actual: ReadonlyArray<number>
  framebufferComplete: boolean
  glError: number
  sourcePixels: ReadonlyArray<number>
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

const countEntityGalleryPixels = async (options: EntityGalleryPixelsOptions): Promise<ReadonlyArray<number>> => {
  const browser = globalThis as unknown as BrowserImageTools
  const tools = {
    cellBounds: (values: Readonly<{ imageHeight: number; imageWidth: number; segmentIndex: number }>) => {
      const segmentWidth = values.imageWidth / options.segmentCount
      return {
        bottom: Math.floor(values.imageHeight * (options.constants.one - options.constants.verticalBottomInset)),
        left: Math.floor(values.segmentIndex * segmentWidth + segmentWidth * options.constants.horizontalInset),
        right: Math.floor((values.segmentIndex + options.constants.one) * segmentWidth - segmentWidth * options.constants.horizontalInset),
        top: Math.floor(values.imageHeight * options.constants.verticalTopInset),
      }
    },
    countVisibleSegmentPixels: (values: Readonly<{
      background: ReadonlyArray<number>
      image: ImagePixels
      segmentIndex: number
    }>): number => {
      const bounds = tools.cellBounds({ imageHeight: values.image.height, imageWidth: values.image.width, segmentIndex: values.segmentIndex })
      let visiblePixels = options.constants.zero
      for (let pixelY = bounds.top; pixelY < bounds.bottom; pixelY += options.constants.one) {
        for (let pixelX = bounds.left; pixelX < bounds.right; pixelX += options.constants.one) {
          const offset = (pixelY * values.image.width + pixelX) * options.constants.four
          const distance = Math.abs((values.image.data[offset] ?? options.constants.zero) - (values.background[options.constants.zero] ?? options.constants.zero)) +
            Math.abs((values.image.data[offset + options.constants.one] ?? options.constants.zero) - (values.background[options.constants.one] ?? options.constants.zero)) +
            Math.abs((values.image.data[offset + options.constants.two] ?? options.constants.zero) - (values.background[options.constants.two] ?? options.constants.zero))
          visiblePixels += Number(distance > options.visibleColorDistance)
        }
      }
      return visiblePixels
    },
    readPixels: async (imageBase64: string): Promise<ImagePixels> => {
      const decoded = Uint8Array.from(browser.atob(imageBase64), (character) => character.charCodeAt(options.constants.zero))
      const image = await browser.createImageBitmap(new browser.Blob([decoded], { type: 'image/png' }))
      const canvas = browser.document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')
      if (context === null) {
        throw new Error('entity preview pixel canvas has no 2D context')
      }
      context.drawImage(image, options.constants.zero, options.constants.zero)
      return context.getImageData(options.constants.zero, options.constants.zero, canvas.width, canvas.height)
    },
  }

  const image = await tools.readPixels(options.imageBase64)
  const background = [image.data[options.constants.zero] ?? options.constants.zero, image.data[options.constants.one] ?? options.constants.zero, image.data[options.constants.two] ?? options.constants.zero]
  return Array.from(Array.from({ length: options.segmentCount }).keys(), (segmentIndex) =>
    tools.countVisibleSegmentPixels({ background, image, segmentIndex }))
}

const expectEntityGalleryVisible = async (page: Page): Promise<void> => {
  const image = await page.locator('#preview-canvas').screenshot()
  const visiblePixels = await page.evaluate(countEntityGalleryPixels, {
    constants: ENTITY_GALLERY_PIXEL_CONSTANTS,
    imageBase64: image.toString('base64'),
    segmentCount: ENTITY_GALLERY_SEGMENTS,
    visibleColorDistance: VISIBLE_PIXEL_RGB_DISTANCE,
  })
  expect(visiblePixels).toHaveLength(ENTITY_GALLERY_SEGMENTS)
  for (const segmentPixels of visiblePixels) {
    expect(segmentPixels).toBeGreaterThan(MIN_VISIBLE_ENTITY_PIXELS)
  }
}

const expectMipReadbackMatchesAverage = (mipPixel: AtlasMipReadback): void => {
  expect(mipPixel.framebufferComplete).toBe(true)
  expect(mipPixel.glError).toBe(ZERO)
  expect(mipPixel.sourcePixels).toHaveLength(FOUR * FOUR)
  expect(mipPixel.actual).toHaveLength(FOUR)
  for (let channel = ZERO; channel < FOUR; channel += ONE) {
    const sourceChannelValues = [
      mipPixel.sourcePixels[channel] ?? Number.NaN,
      mipPixel.sourcePixels[channel + FOUR] ?? Number.NaN,
      mipPixel.sourcePixels[channel + TWO * FOUR] ?? Number.NaN,
      mipPixel.sourcePixels[channel + THREE * FOUR] ?? Number.NaN,
    ]
    const expected = Math.round(sourceChannelValues.reduce((sum, value) => sum + value, ZERO) / FOUR)
    if (channel === ZERO) {
      expect(sourceChannelValues).not.toContain(expected)
    }
    expect(Math.abs((mipPixel.actual[channel] ?? Number.NaN) - expected)).toBeLessThanOrEqual(ONE)
  }
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

test('WebGL mip level pixels match the atlas input 2x2 average', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)

  const mipPixel = await page.evaluate(async (constants: typeof SSIM_CONSTANTS) => {
    const browser = globalThis as unknown as AtlasMipBrowser
    const tools = {
      configureTexture: (resources: AtlasMipResources): void => {
        const { gl, texture } = resources
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, constants.one)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      },
      createResources: (): AtlasMipResources => {
        const canvas = browser.document.createElement('canvas')
        const gl = canvas.getContext('webgl2')
        if (gl === null) {
          throw new Error('WebGL2 is unavailable for atlas mip verification')
        }
        const texture = gl.createTexture()
        const framebuffer = gl.createFramebuffer()
        if (texture === null || framebuffer === null) {
          throw new Error('WebGL could not allocate the atlas mip probe objects')
        }
        return { framebuffer, gl, texture }
      },
      loadImage: async (): Promise<AtlasMipImage> => {
        const image = new browser.Image()
        image.src = '/src/assets/block-textures/atlas.png'
        await image.decode()
        return image
      },
      loadManifest: async (): Promise<AtlasMipManifest> => {
        const response = await browser.fetch('/src/assets/block-textures/manifest.json')
        if (!response.ok) {
          throw new Error('atlas manifest could not be loaded')
        }
        return await response.json() as AtlasMipManifest
      },
      readImagePixels: (image: AtlasMipImage): AtlasMipSource => {
        const canvas = browser.document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const context = canvas.getContext('2d')
        if (context === null) {
          throw new Error('atlas source canvas has no 2D context')
        }
        context.drawImage(image, constants.zero, constants.zero)
        const imageData = context.getImageData(constants.zero, constants.zero, image.width, image.height)
        return { height: image.height, pixels: imageData.data, width: image.width }
      },
      readLevelPixel: (sample: AtlasMipSample, resources: AtlasMipResources) => {
        const { framebuffer, gl, texture } = resources
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, constants.one)
        const framebufferComplete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
        const target = new Uint8Array(constants.four)
        gl.readPixels(sample.targetX, sample.targetY, constants.one, constants.one, gl.RGBA, gl.UNSIGNED_BYTE, target)
        const glError = gl.getError()
        gl.deleteFramebuffer(framebuffer)
        gl.deleteTexture(texture)
        return { actual: Array.from(target), framebufferComplete, glError }
      },
      sampleSource: (source: AtlasMipSource, manifest: AtlasMipManifest): AtlasMipSample => {
        const stoneTop = manifest.blockFaces['stone']?.top
        if (stoneTop === undefined) {
          throw new Error('stone top tile is missing from the atlas manifest')
        }
        const tileColumn = stoneTop % manifest.layout.columns
        const tileRow = Math.floor(stoneTop / manifest.layout.columns)
        // The first 2x2 patch is flat; this offset selects the varied stone sample.
        const sampleX = tileColumn * manifest.layout.cellPixels + manifest.layout.gutterPixels + constants.two * constants.three
        const sourceY = tileRow * manifest.layout.cellPixels + manifest.layout.gutterPixels
        const points = [
          [sampleX, sourceY],
          [sampleX + constants.one, sourceY],
          [sampleX, sourceY + constants.one],
          [sampleX + constants.one, sourceY + constants.one],
        ] as const
        const sourcePixels = points.flatMap(([x, y]) => {
          const offset = (y * source.width + x) * constants.four
          return Array.from(source.pixels.slice(offset, offset + constants.four))
        })
        return { sourcePixels, targetX: sampleX / constants.two, targetY: sourceY / constants.two }
      },
      uploadAtlas: (source: AtlasMipSource, resources: AtlasMipResources): void => {
        const { gl, texture } = resources
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texImage2D(gl.TEXTURE_2D, constants.zero, gl.RGBA8, source.width, source.height, constants.zero, gl.RGBA, gl.UNSIGNED_BYTE, source.pixels)
        gl.generateMipmap(gl.TEXTURE_2D)
      },
    }
    const image = await tools.loadImage()
    const source = tools.readImagePixels(image)
    const manifest = await tools.loadManifest()
    const sample = tools.sampleSource(source, manifest)
    const resources = tools.createResources()
    tools.configureTexture(resources)
    tools.uploadAtlas(source, resources)
    return { ...tools.readLevelPixel(sample, resources), sourcePixels: sample.sourcePixels }
  }, SSIM_CONSTANTS)

  expectMipReadbackMatchesAverage(mipPixel)
})

test('render preview draws the fixed fixture with more than one atlas tile', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/render-preview/`)

  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-render-preview', 'drawn')
  await expect.poll(async () => Number(await body.getAttribute('data-pixels-drawn'))).toBeGreaterThan(ZERO)
  await expect
    .poll(async () => Number(await body.getAttribute('data-resolved-tile-count')))
    .toBeGreaterThan(ONE)
})

test('render preview draws generated entity models through the host frame API', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/render-preview/?entities=1`)

  const body = page.locator('body')
  await expect(body).toHaveAttribute('data-render-preview', 'drawn')
  await expect(body).toHaveAttribute('data-render-entities', 'drawn')
  await expect(body).toHaveAttribute('data-entity-count', '4')
  await expect(body).toHaveAttribute('data-entity-kinds', 'boat,horse,villager,tnt')
  await expectEntityGalleryVisible(page)
})

test('render preview state views draw and differ with encoded block states', async ({ page }) => {
  const sidecarByMode = { main: 'omitted', rn6: 'encoded' } as const
  const screenshotFor = async (mode: 'main' | 'rn6'): Promise<Buffer> => {
    await page.goto(`${WEB_ORIGIN}/apps/render-preview/?states=${mode}`)
    const body = page.locator('body')
    await expect(body).toHaveAttribute('data-state-preview', 'drawn')
    await expect(body).toHaveAttribute('data-state-mode', mode)
    await expect(body).toHaveAttribute('data-state-sidecar', sidecarByMode[mode])
    await expect.poll(async () => Number(await body.getAttribute('data-pixels-drawn'))).toBeGreaterThan(ZERO)
    return page.locator('#preview-canvas').screenshot()
  }

  const mainScreenshot = await screenshotFor('main')
  const rn6Screenshot = await screenshotFor('rn6')
  await writeFile(new URL('../docs/screenshots/rn6-after-render.png', import.meta.url), rn6Screenshot)
  const similarity = await page.evaluate(compareScreenshotSsim, {
    actualBase64: rn6Screenshot.toString('base64'),
    constants: SSIM_CONSTANTS,
    referenceBase64: mainScreenshot.toString('base64'),
  })

  expect(similarity).toBeLessThan(SSIM_CONSTANTS.one)
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

type AnimationPixelSample = Readonly<{
  readonly expectedTileIndex: number
  readonly expected: ReadonlyArray<ReadonlyArray<number>>
  readonly actual: ReadonlyArray<ReadonlyArray<number>>
}>

type AnimationPixelProbeResult = Readonly<{
  readonly blockType: string
  readonly boundaryTick: number
  readonly beforeTick: number
  readonly beforePartialTick: number
  readonly afterTick: number
  readonly afterPartialTick: number
  readonly repeatedTick: number
  readonly repeatedPartialTick: number
  readonly before: AnimationPixelSample
  readonly after: AnimationPixelSample
  readonly repeated: AnimationPixelSample
}>

type TextureManifest = Readonly<{
  readonly blockFaces: Readonly<Record<string, Readonly<{ readonly top: number }>>>
  readonly animations: Readonly<{
    readonly water: Readonly<{ readonly water: ReadonlyArray<number> }>
    readonly lava: Readonly<{ readonly lava: ReadonlyArray<number> }>
    readonly fire: Readonly<{ readonly fire: ReadonlyArray<number> }>
    readonly portal: Readonly<{
      readonly nether_portal: ReadonlyArray<number>
      readonly end_portal: ReadonlyArray<number>
      readonly end_gateway: ReadonlyArray<number>
    }>
  }>
}>

type AtlasMipImage = { readonly height: number; src: string; readonly width: number; decode: () => Promise<void> }
type AtlasMipBytes = Readonly<ArrayLike<number>> & Readonly<{
  slice: (start: number, end: number) => ReadonlyArray<number>
}>
type AtlasMipImageData = Readonly<{ data: AtlasMipBytes }>
type AtlasMipCanvas2d = Readonly<{
  drawImage: (image: AtlasMipImage, x: number, y: number) => void
  getImageData: (...coordinates: [x: number, y: number, width: number, height: number]) => AtlasMipImageData
}>
type AtlasMipWebGl = Readonly<{
  readonly TEXTURE_2D: number
  readonly UNPACK_ALIGNMENT: number
  readonly TEXTURE_MIN_FILTER: number
  readonly NEAREST_MIPMAP_NEAREST: number
  readonly TEXTURE_MAG_FILTER: number
  readonly NEAREST: number
  readonly TEXTURE_WRAP_S: number
  readonly TEXTURE_WRAP_T: number
  readonly CLAMP_TO_EDGE: number
  readonly RGBA8: number
  readonly RGBA: number
  readonly UNSIGNED_BYTE: number
  readonly FRAMEBUFFER: number
  readonly COLOR_ATTACHMENT0: number
  readonly FRAMEBUFFER_COMPLETE: number
  createTexture: () => object | null
  createFramebuffer: () => object | null
  bindTexture: (target: number, texture: object) => void
  pixelStorei: (parameter: number, value: number) => void
  texParameteri: (target: number, parameter: number, value: number) => void
  texImage2D: (...parameters: [
    target: number,
    level: number,
    internalFormat: number,
    width: number,
    height: number,
    border: number,
    format: number,
    type: number,
    pixels: ArrayLike<number>,
  ]) => void
  generateMipmap: (target: number) => void
  bindFramebuffer: (target: number, framebuffer: object) => void
  framebufferTexture2D: (...parameters: [
    target: number,
    attachment: number,
    textureTarget: number,
    texture: object,
    level: number,
  ]) => void
  checkFramebufferStatus: (target: number) => number
  readPixels: (...parameters: [
    x: number,
    y: number,
    width: number,
    height: number,
    format: number,
    type: number,
    pixels: Uint8Array,
  ]) => void
  getError: () => number
  deleteFramebuffer: (framebuffer: object) => void
  deleteTexture: (texture: object) => void
}>
type AtlasMipCanvas = {
  height: number
  width: number
  getContext: {
    (kind: '2d'): AtlasMipCanvas2d | null
    (kind: 'webgl2'): AtlasMipWebGl | null
  }
}
type AtlasMipBrowser = Readonly<{
  Image: new () => AtlasMipImage
  document: Readonly<{ createElement: (tag: 'canvas') => AtlasMipCanvas }>
  fetch: (url: string) => Promise<Readonly<{ ok: boolean; json: () => Promise<unknown> }>>
}>
type AtlasMipSource = Readonly<{ height: number; pixels: AtlasMipBytes; width: number }>
type AtlasMipManifest = Readonly<{
  readonly blockFaces: Readonly<Record<string, Readonly<{ readonly top: number }>>>
  readonly layout: Readonly<{
    readonly columns: number
    readonly cellPixels: number
    readonly gutterPixels: number
  }>
}>
type AtlasMipSample = Readonly<{ sourcePixels: ReadonlyArray<number>; targetX: number; targetY: number }>
type AtlasMipResources = Readonly<{ framebuffer: object; gl: AtlasMipWebGl; texture: object }>

const ANIMATION_BOUNDARY_TICKS: Readonly<Record<string, number>> = {
  end_gateway: TWENTY,
  end_portal: TWENTY,
  fire: TEN,
  lava: TWENTY,
  nether_portal: TWENTY,
  water: TWENTY,
}

const expectedFrameSequences = (manifest: TextureManifest): Readonly<Record<string, ReadonlyArray<number>>> => ({
  end_gateway: manifest.animations.portal.end_gateway,
  end_portal: manifest.animations.portal.end_portal,
  fire: manifest.animations.fire.fire,
  lava: manifest.animations.lava.lava,
  nether_portal: manifest.animations.portal.nether_portal,
  water: manifest.animations.water.water,
})

const readAnimationProbe = async (page: Page): Promise<Readonly<{
  readonly manifest: TextureManifest
  readonly results: ReadonlyArray<AnimationPixelProbeResult>
}>> => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/?chunk-animation-pixels`)
  const body = page.locator('body')
  await expect.poll(async () => body.getAttribute('data-chunk-animation-probe'), { timeout: 30_000 }).toBe('passed')
  const encodedResults = await body.getAttribute('data-chunk-animation-probe-result')
  expect(encodedResults).not.toBeNull()
  const manifestContents = await readFile(new URL('../src/assets/block-textures/manifest.json', import.meta.url), 'utf8')
  return {
    manifest: JSON.parse(manifestContents) as TextureManifest,
    results: JSON.parse(encodedResults ?? 'null') as ReadonlyArray<AnimationPixelProbeResult>,
  }
}

const verifyTickBoundary = (result: AnimationPixelProbeResult, boundaryTick: number): void => {
  expect(result.boundaryTick).toBe(boundaryTick)
  expect(result.beforeTick).toBe(boundaryTick - ONE)
  expect(result.beforePartialTick).toBe(PARTIAL_TICK_BEFORE_BOUNDARY)
  expect(result.afterTick).toBe(boundaryTick)
  expect(result.afterPartialTick).toBe(ZERO)
  expect(result.repeatedTick).toBe(result.afterTick)
  expect(result.repeatedPartialTick).toBe(result.afterPartialTick)
}

const verifyTilePixel = (sample: AnimationPixelSample, tileIndex: number): void => {
  expect(sample.expectedTileIndex).toBe(tileIndex)
  expect(sample.expected.length).toBeGreaterThan(ZERO)
  expect(sample.actual).toEqual(sample.expected)
}

const verifyAnimatedPixelProbe = (
  result: AnimationPixelProbeResult,
  frames: ReadonlyArray<number>,
  boundaryTick: number,
): void => {
  const [firstFrame, secondFrame] = frames
  if (firstFrame === undefined || secondFrame === undefined) {
    throw new Error(`${result.blockType} manifest animation needs at least two frames`)
  }
  verifyTickBoundary(result, boundaryTick)
  verifyTilePixel(result.before, firstFrame)
  verifyTilePixel(result.after, secondFrame)
  verifyTilePixel(result.repeated, secondFrame)
  expect(result.before.expected).not.toEqual(result.after.expected)
  expect(result.after.actual).not.toEqual(result.before.actual)
  expect(result.repeated.actual).toEqual(result.after.actual)
}

const verifyStaticPixelProbe = (result: AnimationPixelProbeResult, tileIndex: number): void => {
  expect(result.boundaryTick).toBe(TWENTY)
  expect(result.beforeTick).toBe(ZERO)
  expect(result.afterTick).toBe(TWENTY)
  expect(result.repeatedTick).toBe(result.afterTick)
  verifyTilePixel(result.before, tileIndex)
  verifyTilePixel(result.after, tileIndex)
  verifyTilePixel(result.repeated, tileIndex)
  expect(result.after.actual).toEqual(result.before.actual)
  expect(result.repeated.actual).toEqual(result.after.actual)
}

const verifyAnimatedBlockResults = (
  resultsByBlock: ReadonlyMap<string, AnimationPixelProbeResult>,
  framesByBlock: Readonly<Record<string, ReadonlyArray<number>>>,
): void => {
  for (const [blockType, frames] of Object.entries(framesByBlock)) {
    const result = resultsByBlock.get(blockType)
    const boundaryTick = ANIMATION_BOUNDARY_TICKS[blockType]
    if (result === undefined || boundaryTick === undefined) {
      throw new Error(`missing WebGL probe data for ${blockType}`)
    }
    verifyAnimatedPixelProbe(result, frames, boundaryTick)
  }
}

const verifyIceResult = (
  resultsByBlock: ReadonlyMap<string, AnimationPixelProbeResult>,
  manifest: TextureManifest,
): void => {
  const ice = resultsByBlock.get('ice')
  const iceFaces = manifest.blockFaces['ice']
  if (ice === undefined || iceFaces === undefined) {
    throw new Error('missing static ice WebGL probe data')
  }
  verifyStaticPixelProbe(ice, iceFaces.top)
}

const verifyAnimationProbeResults = (
  results: ReadonlyArray<AnimationPixelProbeResult>,
  manifest: TextureManifest,
): void => {
  const framesByBlock = expectedFrameSequences(manifest)
  const resultsByBlock = new Map(results.map((result) => [result.blockType, result]))
  expect([...resultsByBlock.keys()].sort()).toEqual([...Object.keys(framesByBlock), 'ice'].sort())
  verifyAnimatedBlockResults(resultsByBlock, framesByBlock)
  verifyIceResult(resultsByBlock, manifest)
}

test('chunk animation pixels follow simulation tick boundaries in WebGL', async ({ page }) => {
  const probe = await readAnimationProbe(page)
  verifyAnimationProbeResults(probe.results, probe.manifest)
})

type ItemIconProbeResult = Readonly<{
  readonly distinctIconPixels: number
  readonly bookshelfVisiblePixels: number
  readonly diamondVisiblePixels: number
  readonly rotationOnlyPixelChanges: number
  readonly rotationOnlyHeightDeltaPixels: number
  readonly bobOnlyCenterYDeltaPixels: number
  readonly arrowVisiblePixels: number
  readonly arrowWarmPixels: number
  readonly arrowNeutralPixels: number
  readonly arrowWidthPixels: number
  readonly arrowHeightPixels: number
  readonly enderEyeVisiblePixels: number
  readonly enderEyeGreenPixels: number
  readonly enderEyePupilPixels: number
  readonly animationSeconds: readonly [number, number, number, number]
}>

const expectIconPixels = (result: ItemIconProbeResult, diagnostic: string): void => {
  expect(result.bookshelfVisiblePixels, diagnostic).toBeGreaterThan(ZERO)
  expect(result.diamondVisiblePixels, diagnostic).toBeGreaterThan(ZERO)
  expect(result.distinctIconPixels, diagnostic).toBeGreaterThan(ZERO)
}

const expectItemMotionPixels = (result: ItemIconProbeResult, diagnostic: string): void => {
  expect(result.rotationOnlyPixelChanges, diagnostic).toBeGreaterThan(ZERO)
  expect(result.rotationOnlyHeightDeltaPixels, diagnostic).toBeLessThanOrEqual(ONE)
  expect(result.bobOnlyCenterYDeltaPixels, diagnostic).toBeGreaterThanOrEqual(TWO)
}

const expectArrowPixels = (result: ItemIconProbeResult, diagnostic: string): void => {
  expect(result.arrowVisiblePixels, diagnostic).toBeGreaterThan(ZERO)
  expect(result.arrowWarmPixels, diagnostic).toBeGreaterThan(ZERO)
  expect(result.arrowNeutralPixels, diagnostic).toBeGreaterThan(ZERO)
  expect(result.arrowHeightPixels, diagnostic).toBeGreaterThan(ZERO)
  expect(result.arrowWidthPixels / result.arrowHeightPixels, diagnostic).toBeGreaterThanOrEqual(
    ARROW_MIN_ASPECT_RATIO,
  )
}

const expectEnderEyePixels = (result: ItemIconProbeResult, diagnostic: string): void => {
  expect(result.enderEyeVisiblePixels, diagnostic).toBeGreaterThan(ZERO)
  expect(result.enderEyeGreenPixels, diagnostic).toBeGreaterThan(ZERO)
  expect(result.enderEyePupilPixels, diagnostic).toBeGreaterThan(ZERO)
}

const expectItemIconProbeResult = (result: ItemIconProbeResult): void => {
  const diagnostic = `item-icon WebGL probe metrics: ${JSON.stringify(result)}`
  expect(result.animationSeconds, diagnostic).toStrictEqual([
    ZERO,
    TWO,
    ITEM_ICON_ANIMATION_SECONDS,
    ITEM_ICON_BOB_END_SECONDS,
  ])
  expectIconPixels(result, diagnostic)
  expectItemMotionPixels(result, diagnostic)
  expectArrowPixels(result, diagnostic)
  expectEnderEyePixels(result, diagnostic)
}

test('item icons, arrows, and ender eyes render distinct animated pixels in WebGL', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/?item-icon-pixels`)
  const body = page.locator('body')
  await expect.poll(async () => {
    const state = await body.getAttribute('data-item-icon-probe')
    return state === 'passed' || state === 'failed'
  }, { timeout: 30_000 }).toBe(true)
  const probeState = await body.getAttribute('data-item-icon-probe')
  expect(probeState, await body.innerText()).toBe('passed')
  const encodedResult = await body.getAttribute('data-item-icon-probe-result')
  expect(encodedResult).not.toBeNull()
  const result = JSON.parse(encodedResult ?? 'null') as ItemIconProbeResult
  expectItemIconProbeResult(result)
})
