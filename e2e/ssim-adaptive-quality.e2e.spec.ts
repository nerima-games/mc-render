import { expect, test } from '@playwright/test'

const WEB_ORIGIN = 'http://127.0.0.1:5182'
const ZERO = 0
const ONE = 1
const TWO = 2
const COMPARISONS_TO_DOWNGRADE = 20
const RENDERS_AFTER_DOWNGRADE = 3
const CANVAS_WIDTH = 32
const CANVAS_HEIGHT = 24
const PIXEL_RATIO = 1
const TILE_COLUMNS = 16
const TILE_ROWS = 12
const TILE_SPACING = 0.56
const TILE_SIZE = 0.52
const TILE_DEPTH = -5
const BRIGHTNESS = 8
const BLACK = 0x000000
const DARK_TILE_COLOR = 0x080808
const SSIM_THRESHOLD = 0.95
const CAMERA = {
  position: { x: ZERO, y: ZERO, z: ZERO },
  rotation: { order: 'YXZ', x: ZERO, y: ZERO, z: ZERO },
  sourceCapturedAtSecs: ZERO,
}

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

type AdaptiveScenarioOptions = Readonly<{
  black: number
  brightness: number
  camera: typeof CAMERA
  canvasHeight: number
  canvasWidth: number
  comparisonsToDowngrade: number
  darkTileColor: number
  maxPixelRatio: number
  one: number
  rendersAfterDowngrade: number
  tileColumns: number
  tileDepth: number
  tileRows: number
  tileSize: number
  tileSpacing: number
  two: number
  zero: number
}>

type AdaptiveResult = Readonly<{
  initialPreset: string | undefined
  presets: ReadonlyArray<string | undefined>
  ssims: ReadonlyArray<number | undefined>
}>

type FixtureResources = Readonly<{
  brightMaterial: { dispose: () => void }
  darkMaterial: { dispose: () => void }
  squareGeometry: { dispose: () => void }
}>

const runAdaptiveScenario = async (options: AdaptiveScenarioOptions): Promise<AdaptiveResult> => {
  const browser = globalThis as unknown as Browser
  const [runtimeModule, three] = await Promise.all([
    import(new URL('/src/browser.ts', browser.location.href).href),
    import(new URL('/node_modules/three/build/three.module.js', browser.location.href).href),
  ])
  const canvas = Object.assign(browser.document.createElement('canvas'), {
    height: options.canvasHeight,
    style: { height: `${options.canvasHeight}px`, width: `${options.canvasWidth}px` },
    width: options.canvasWidth,
  })
  browser.document.body.appendChild(canvas)
  const runtime = await runtimeModule.makeBrowserWorldRuntime({
    autoResize: false,
    canvas,
    maxPixelRatio: options.maxPixelRatio,
    quality: 'medium',
  })
  const tools = {
    addTile: (tile: Readonly<{
      brightSquares: InstanceType<typeof three.InstancedMesh>
      column: number
      darkSquares: InstanceType<typeof three.InstancedMesh>
      options: AdaptiveScenarioOptions
      row: number
      transform: InstanceType<typeof three.Matrix4>
    }>): void => {
      const x = (tile.column - (tile.options.tileColumns - tile.options.one) / tile.options.two) * tile.options.tileSpacing
      const y = ((tile.options.tileRows - tile.options.one) / tile.options.two - tile.row) * tile.options.tileSpacing
      const index = tile.row * (tile.options.tileColumns / tile.options.two) + Math.floor(tile.column / tile.options.two)
      tile.transform.makeTranslation(x, y, tile.options.tileDepth)
      if ((tile.row + tile.column) % tile.options.two === tile.options.zero) {
        tile.brightSquares.setMatrixAt(index, tile.transform)
      } else {
        tile.darkSquares.setMatrixAt(index, tile.transform)
      }
    },
    createFixture: (fixture: Readonly<{
      options: AdaptiveScenarioOptions
      scene: typeof runtime.scene
      three: typeof three
    }>) => {
      const squareGeometry = new fixture.three.PlaneGeometry(fixture.options.tileSize, fixture.options.tileSize)
      const brightMaterial = new fixture.three.MeshBasicMaterial({
        color: new fixture.three.Color().setRGB(
          fixture.options.brightness,
          fixture.options.brightness,
          fixture.options.brightness,
        ),
        toneMapped: false,
      })
      const darkMaterial = new fixture.three.MeshBasicMaterial({ color: fixture.options.darkTileColor })
      const brightSquares = new fixture.three.InstancedMesh(
        squareGeometry,
        brightMaterial,
        fixture.options.tileColumns * fixture.options.tileRows / fixture.options.two,
      )
      const darkSquares = new fixture.three.InstancedMesh(
        squareGeometry,
        darkMaterial,
        fixture.options.tileColumns * fixture.options.tileRows / fixture.options.two,
      )
      fixture.scene.background = new fixture.three.Color(fixture.options.black)
      tools.fillCheckerboard({ brightSquares, darkSquares, options: fixture.options, three: fixture.three })
      fixture.scene.add(brightSquares, darkSquares)
      return { brightMaterial, darkMaterial, squareGeometry }
    },
    createResult: (input: Readonly<{
      options: AdaptiveScenarioOptions
      runtime: typeof runtime
    }>): AdaptiveResult => {
      const initialPreset = input.runtime.qualityPreset
      const samples = tools.renderFrames({
        camera: input.options.camera,
        frameCount: input.options.comparisonsToDowngrade + input.options.rendersAfterDowngrade,
        one: input.options.one,
        runtime: input.runtime,
        zero: input.options.zero,
      })
      return { initialPreset, ...samples }
    },
    dispose: (input: Readonly<{
      fixture: FixtureResources
      runtime: typeof runtime
    }>): void => {
      input.runtime.dispose()
      input.fixture.squareGeometry.dispose()
      input.fixture.brightMaterial.dispose()
      input.fixture.darkMaterial.dispose()
    },
    fillCheckerboard: (board: Readonly<{
      brightSquares: InstanceType<typeof three.InstancedMesh>
      darkSquares: InstanceType<typeof three.InstancedMesh>
      options: AdaptiveScenarioOptions
      three: typeof three
    }>): void => {
      const transform = new board.three.Matrix4()
      for (let row = board.options.zero; row < board.options.tileRows; row += board.options.one) {
        for (let column = board.options.zero; column < board.options.tileColumns; column += board.options.one) {
          tools.addTile({
            brightSquares: board.brightSquares,
            column,
            darkSquares: board.darkSquares,
            options: board.options,
            row,
            transform,
          })
        }
      }
      board.brightSquares.instanceMatrix.needsUpdate = true
      board.darkSquares.instanceMatrix.needsUpdate = true
    },
    renderFrames: (frameSet: Readonly<{
      camera: typeof CAMERA
      frameCount: number
      one: number
      runtime: typeof runtime
      zero: number
    }>) => {
      const ssims: Array<number | undefined> = []
      const presets: Array<string | undefined> = []
      for (let frame = frameSet.zero; frame < frameSet.frameCount; frame += frameSet.one) {
        frameSet.runtime.render(frameSet.camera)
        ssims.push(frameSet.runtime.latestSsim)
        presets.push(frameSet.runtime.qualityPreset)
      }
      return { presets, ssims }
    },
  }
  const fixture = tools.createFixture({ options, scene: runtime.scene, three })
  try {
    return tools.createResult({ options, runtime })
  } finally {
    tools.dispose({ fixture, runtime })
  }
}

const expectDowngradeSequence = (result: AdaptiveResult): void => {
  for (let index = ZERO; index < COMPARISONS_TO_DOWNGRADE; index += ONE) {
    const score = result.ssims[index]
    expect(score, `comparison ${index + ONE} should report measured SSIM`).toEqual(expect.any(Number))
    expect(Number.isFinite(score)).toBe(true)
    expect(score).toBeLessThan(SSIM_THRESHOLD)
    if (index === COMPARISONS_TO_DOWNGRADE - ONE) {
      expect(result.presets[index]).toBe('low')
    } else {
      expect(result.presets[index]).toBe('medium')
    }
  }
}

const expectStableLowQuality = (result: AdaptiveResult): void => {
  for (let index = COMPARISONS_TO_DOWNGRADE; index < result.presets.length; index += ONE) {
    expect(result.presets[index]).toBe('low')
  }
}

test('sustained low SSIM downgrades medium quality by one preset exactly once', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)
  const result = await page.evaluate(runAdaptiveScenario, {
    black: BLACK,
    brightness: BRIGHTNESS,
    camera: CAMERA,
    canvasHeight: CANVAS_HEIGHT,
    canvasWidth: CANVAS_WIDTH,
    comparisonsToDowngrade: COMPARISONS_TO_DOWNGRADE,
    darkTileColor: DARK_TILE_COLOR,
    maxPixelRatio: PIXEL_RATIO,
    one: ONE,
    rendersAfterDowngrade: RENDERS_AFTER_DOWNGRADE,
    tileColumns: TILE_COLUMNS,
    tileDepth: TILE_DEPTH,
    tileRows: TILE_ROWS,
    tileSize: TILE_SIZE,
    tileSpacing: TILE_SPACING,
    two: TWO,
    zero: ZERO,
  })

  expect(result.initialPreset).toBe('medium')
  expect(result.ssims).toHaveLength(COMPARISONS_TO_DOWNGRADE + RENDERS_AFTER_DOWNGRADE)
  expect(result.presets).toHaveLength(result.ssims.length)
  expectDowngradeSequence(result)
  expectStableLowQuality(result)
})
