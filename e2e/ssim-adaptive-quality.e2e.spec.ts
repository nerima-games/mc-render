import { expect, test } from '@playwright/test'

const WEB_ORIGIN = 'http://127.0.0.1:5182'
const COMPARISONS_TO_DOWNGRADE = 20
const RENDERS_AFTER_DOWNGRADE = 3

test('sustained low SSIM downgrades medium quality by one preset exactly once', async ({ page }) => {
  await page.goto(`${WEB_ORIGIN}/apps/shader-probe/`)

  const result = await page.evaluate(async ({ comparisonsToDowngrade, rendersAfterDowngrade }) => {
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
    const canvas = browser.document.createElement('canvas')
    canvas.width = 32
    canvas.height = 24
    canvas.style.width = '32px'
    canvas.style.height = '24px'
    browser.document.body.appendChild(canvas)

    const runtime = await runtimeModule.makeBrowserWorldRuntime({
      autoResize: false,
      canvas,
      maxPixelRatio: 1,
      quality: 'medium',
    })
    const camera = {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, order: 'YXZ' },
      sourceCapturedAtSecs: 0,
    }

    const columns = 16
    const rows = 12
    const spacing = 0.56
    const squareGeometry = new three.PlaneGeometry(0.52, 0.52)
    const brightMaterial = new three.MeshBasicMaterial({
      color: new three.Color().setRGB(8, 8, 8),
      toneMapped: false,
    })
    const darkMaterial = new three.MeshBasicMaterial({ color: 0x080808 })
    const brightSquares = new three.InstancedMesh(squareGeometry, brightMaterial, columns * rows / 2)
    const darkSquares = new three.InstancedMesh(squareGeometry, darkMaterial, columns * rows / 2)
    const transform = new three.Matrix4()
    let brightIndex = 0
    let darkIndex = 0
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = (column - (columns - 1) / 2) * spacing
        const y = ((rows - 1) / 2 - row) * spacing
        transform.makeTranslation(x, y, -5)
        if ((row + column) % 2 === 0) {
          brightSquares.setMatrixAt(brightIndex, transform)
          brightIndex += 1
        } else {
          darkSquares.setMatrixAt(darkIndex, transform)
          darkIndex += 1
        }
      }
    }
    brightSquares.instanceMatrix.needsUpdate = true
    darkSquares.instanceMatrix.needsUpdate = true
    runtime.scene.background = new three.Color(0x000000)
    runtime.scene.add(brightSquares, darkSquares)

    try {
      const initialPreset = runtime.qualityPreset
      const ssims: Array<number | undefined> = []
      const presets: Array<string | undefined> = []
      for (let frame = 0; frame < comparisonsToDowngrade; frame += 1) {
        runtime.render(camera)
        ssims.push(runtime.latestSsim)
        presets.push(runtime.qualityPreset)
      }
      for (let frame = 0; frame < rendersAfterDowngrade; frame += 1) {
        runtime.render(camera)
        ssims.push(runtime.latestSsim)
        presets.push(runtime.qualityPreset)
      }
      return { initialPreset, presets, ssims }
    } finally {
      runtime.dispose()
      squareGeometry.dispose()
      brightMaterial.dispose()
      darkMaterial.dispose()
    }
  }, {
    comparisonsToDowngrade: COMPARISONS_TO_DOWNGRADE,
    rendersAfterDowngrade: RENDERS_AFTER_DOWNGRADE,
  })

  expect(result.initialPreset).toBe('medium')
  expect(result.ssims).toHaveLength(COMPARISONS_TO_DOWNGRADE + RENDERS_AFTER_DOWNGRADE)
  expect(result.presets).toHaveLength(result.ssims.length)
  for (let index = 0; index < COMPARISONS_TO_DOWNGRADE; index += 1) {
    const score = result.ssims[index]
    expect(score, `comparison ${index + 1} should report measured SSIM`).toEqual(expect.any(Number))
    expect(Number.isFinite(score)).toBe(true)
    expect(score).toBeLessThan(0.95)
    expect(result.presets[index]).toBe(index < COMPARISONS_TO_DOWNGRADE - 1 ? 'medium' : 'low')
  }
  for (let index = COMPARISONS_TO_DOWNGRADE; index < result.presets.length; index += 1) {
    expect(result.presets[index]).toBe('low')
  }
})
