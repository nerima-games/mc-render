import { describe, expect, it, vi } from 'vitest'
import {
  type BrowserWaterMesh,
  BROWSER_RENDER_DEFAULTS,
  advanceBrowserFpsQuality,
  advanceBrowserSsimQuality,
  assertBrowserRuntimeActive,
  browserDepthTextureOption,
  browserPostProcessingChainKey,
  browserPostProcessingChain,
  browserRenderTargetKind,
  captureBrowserWaterVisibility,
  createBrowserCompositeShader,
  createBrowserGodRaysShader,
  hideBrowserWaterMeshes,
  isBrowserScreenshotShortcut,
  millisecondsFromGpuNanoseconds,
  measureBrowserStage,
  restoreBrowserWaterVisibility,
  resolveBrowserBloomStrength,
  resolveBrowserGodRaySamples,
  resolveBrowserMaxPixelRatio,
  resolveBrowserPixelRatio,
  resolveBrowserPixelRatioCap,
  resolveBrowserLatestGpuTime,
  resolveBrowserQuality,
  resolveBrowserRenderTargetValue,
  resolveBrowserDrawingBufferSize,
  resolveBrowserRefractionTargetSize,
  resolveBrowserViewport,
  requireBrowserRuntimeValue,
  selectGpuTimer,
  setBrowserWaterRefractionUniforms,
  shouldCaptureBrowserRefraction,
  structuralSimilarity,
} from '../src/domain/browser-render-policy.js'
import { createAdaptiveQualityState } from '../src/domain/adaptive-quality.js'
import { createSsimAdaptiveQualityState } from '../src/domain/ssim-adaptive-quality.js'
import { QUALITY_PRESETS } from '../src/domain/post-processing.js'

const rgba = (width: number, height: number, value: number): Uint8Array => {
  const pixels = new Uint8Array(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = value
    pixels[offset + 1] = value
    pixels[offset + 2] = value
    pixels[offset + 3] = 255
  }
  return pixels
}

describe('browser render policy', () => {
  it('selects render target and depth texture options from quality policy', () => {
    expect(resolveBrowserRenderTargetValue(QUALITY_PRESETS.medium, 'hdr', 'ldr')).toBe('ldr')
    expect(resolveBrowserRenderTargetValue(QUALITY_PRESETS.ultra, 'hdr', 'ldr')).toBe('hdr')

    const makeTexture = vi.fn(() => ({ id: 'depth' }))
    expect(browserDepthTextureOption(false, makeTexture)).toStrictEqual({})
    expect(makeTexture).not.toHaveBeenCalled()
    expect(browserDepthTextureOption(true, makeTexture)).toStrictEqual({
      depthTexture: { id: 'depth' },
    })
    expect(makeTexture).toHaveBeenCalledTimes(1)
  })

  it('keys post-processing chain updates and preserves the latest known GPU sample', () => {
    expect(browserPostProcessingChainKey([
      { pass: 'render', effects: ['render'] },
      { pass: 'composite', effects: ['bloom', 'godRays'] },
    ])).toBe('render:render|composite:bloom,godRays')
    expect(resolveBrowserLatestGpuTime(undefined, undefined)).toBeUndefined()
    expect(resolveBrowserLatestGpuTime(2, undefined)).toBe(2)
    expect(resolveBrowserLatestGpuTime(2, 3)).toBe(3)
  })

  it('guards operations after runtime disposal', () => {
    expect(() => assertBrowserRuntimeActive(false)).not.toThrow()
    expect(() => assertBrowserRuntimeActive(true)).toThrow('browser world runtime is disposed')
  })

  it('requires runtime surfaces and timer state captured during initialization', () => {
    const runtimeValue = { ready: true }
    expect(requireBrowserRuntimeValue(runtimeValue, 'not ready')).toBe(runtimeValue)
    expect(() => requireBrowserRuntimeValue(undefined, 'not ready')).toThrow('not ready')
  })

  it('accepts an unmodified F2 keydown and rejects repeats or modifiers', () => {
    const shortcut = {
      code: 'F2',
      repeat: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    }
    expect(isBrowserScreenshotShortcut(shortcut)).toBe(true)
    expect(isBrowserScreenshotShortcut({ ...shortcut, code: 'F3' })).toBe(false)
    expect(isBrowserScreenshotShortcut({ ...shortcut, repeat: true })).toBe(false)
    expect(isBrowserScreenshotShortcut({ ...shortcut, altKey: true })).toBe(false)
    expect(isBrowserScreenshotShortcut({ ...shortcut, ctrlKey: true })).toBe(false)
    expect(isBrowserScreenshotShortcut({ ...shortcut, metaKey: true })).toBe(false)
    expect(isBrowserScreenshotShortcut({ ...shortcut, shiftKey: true })).toBe(false)
  })

  it('resolves named, custom, and default quality selections', () => {
    expect(resolveBrowserQuality('ultra')).toStrictEqual({
      preset: 'ultra',
      quality: QUALITY_PRESETS.ultra,
    })
    const custom = { ...QUALITY_PRESETS.high, pixelRatioCap: 1.25 }
    expect(resolveBrowserQuality(custom)).toStrictEqual({ preset: undefined, quality: custom })
    expect(resolveBrowserQuality(undefined)).toStrictEqual({
      preset: 'high',
      quality: QUALITY_PRESETS.high,
    })
  })

  it('bounds pixel ratio inputs and honors a positive requested cap', () => {
    expect(resolveBrowserPixelRatioCap(Number.NaN)).toBe(2)
    expect(resolveBrowserPixelRatioCap(0.25)).toBe(0.5)
    expect(resolveBrowserPixelRatioCap(1.5)).toBe(1.5)
    expect(resolveBrowserPixelRatioCap(3)).toBe(2)
    expect(resolveBrowserMaxPixelRatio(1.25, 2)).toBe(1.25)
    expect(resolveBrowserMaxPixelRatio(3, 1.5)).toBe(1.5)
    expect(resolveBrowserMaxPixelRatio(undefined, 1.5)).toBe(1.5)
    expect(resolveBrowserMaxPixelRatio(Number.NaN, 1.5)).toBe(1.5)
    expect(resolveBrowserMaxPixelRatio(0, 1.5)).toBe(1.5)
    expect(resolveBrowserMaxPixelRatio(undefined, Number.POSITIVE_INFINITY)).toBe(2)
    expect(resolveBrowserPixelRatio(1.5, 1)).toBe(1)
    expect(resolveBrowserPixelRatio(1.5, Number.POSITIVE_INFINITY)).toBe(1.5)
    expect(resolveBrowserPixelRatio(1.5, undefined)).toBe(1)
    expect(resolveBrowserPixelRatio(1.5, 0)).toBe(1)
  })

  it('resolves canvas dimensions and refraction target dimensions', () => {
    expect(resolveBrowserViewport({ clientWidth: 320.9, clientHeight: 200.2, canvasWidth: 640, canvasHeight: 480 })).toStrictEqual({ width: 320, height: 200 })
    expect(resolveBrowserViewport({ clientWidth: 0, clientHeight: 0, canvasWidth: 64.8, canvasHeight: 0 })).toStrictEqual({ width: 64, height: 1 })
    expect(resolveBrowserViewport({ clientWidth: 0, clientHeight: 0, canvasWidth: 0, canvasHeight: 0 })).toStrictEqual({ width: 1, height: 1 })
    expect(resolveBrowserRefractionTargetSize({ width: 320, height: 200 }, 1.5)).toStrictEqual({
      width: 480,
      height: 300,
      key: '480x300',
    })
    expect(resolveBrowserRefractionTargetSize({ width: 1, height: 1 }, 0)).toStrictEqual({
      width: 1,
      height: 1,
      key: '1x1',
    })
    expect(resolveBrowserDrawingBufferSize(320.9, 200.2)).toStrictEqual({ width: 320, height: 200 })
    expect(resolveBrowserDrawingBufferSize(0, 0)).toStrictEqual({ width: 1, height: 1 })
  })

  it('captures, hides, and restores water mesh visibility', () => {
    const visible = { visible: true }
    const hidden = { visible: false }
    const meshes = new Set([visible, hidden])
    const snapshot = captureBrowserWaterVisibility(meshes)
    hideBrowserWaterMeshes(meshes)
    expect([...meshes].every((mesh) => !mesh.visible)).toBe(true)
    restoreBrowserWaterVisibility(snapshot)
    expect(visible.visible).toBe(true)
    expect(hidden.visible).toBe(false)
    hideBrowserWaterMeshes(new Set<BrowserWaterMesh>())
    restoreBrowserWaterVisibility([])
  })

  it('updates refraction uniforms only when both uniforms exist', () => {
    const texture = { id: 'water-refraction' }
    setBrowserWaterRefractionUniforms({}, texture, true)
    setBrowserWaterRefractionUniforms({ uRefractionMap: { value: null } }, texture, true)
    const uniforms = { uRefractionMap: { value: null }, uRefractionValid: { value: 0 } }
    setBrowserWaterRefractionUniforms(uniforms, texture, true)
    expect(uniforms).toStrictEqual({ uRefractionMap: { value: texture }, uRefractionValid: { value: 1 } })
    setBrowserWaterRefractionUniforms(uniforms, texture, false)
    expect(uniforms).toStrictEqual({ uRefractionMap: { value: null }, uRefractionValid: { value: 0 } })
  })

  it('measures browser stages and preserves cleanup when the stage throws', () => {
    const marks = {
      clearMarks: vi.fn(),
      mark: vi.fn(),
      measure: vi.fn(),
    }
    expect(measureBrowserStage(undefined, 'render.none', () => 3)).toBe(3)
    expect(measureBrowserStage({}, 'render.missing-mark', () => 4)).toBe(4)
    expect(measureBrowserStage({ mark: marks.mark }, 'render.incomplete', () => 4)).toBe(4)
    expect(measureBrowserStage({ mark: marks.mark, measure: marks.measure }, 'render.missing-cleanup', () => 4)).toBe(4)
    const api = { mark: marks.mark, measure: marks.measure, clearMarks: marks.clearMarks }
    expect(measureBrowserStage(api, 'render.stage', () => 5)).toBe(5)
    expect(marks.mark.mock.calls).toEqual([['render.stage:start'], ['render.stage:end']])
    expect(marks.measure).toHaveBeenCalledWith('render.stage', 'render.stage:start', 'render.stage:end')
    expect(marks.clearMarks.mock.calls).toEqual([['render.stage:start'], ['render.stage:end']])
    expect(() => measureBrowserStage(api, 'render.failure', () => { throw new Error('render failed') })).toThrow(
      'render failed',
    )
    expect(marks.clearMarks).toHaveBeenCalledWith('render.failure:end')
  })

  it('clamps shader sample and bloom parameters', () => {
    expect(resolveBrowserGodRaySamples(Number.NaN)).toBe(0)
    expect(resolveBrowserGodRaySamples(-2)).toBe(0)
    expect(resolveBrowserGodRaySamples(3.9)).toBe(3)
    expect(resolveBrowserGodRaySamples(50)).toBe(40)
    expect(resolveBrowserBloomStrength(Number.POSITIVE_INFINITY)).toBe(0)
    expect(resolveBrowserBloomStrength(-0.5)).toBe(0)
    expect(resolveBrowserBloomStrength(0.6)).toBe(0.6)
    expect(resolveBrowserBloomStrength(2)).toBe(1)
  })

  it('selects render target precision and preset composite chains', () => {
    expect(browserRenderTargetKind(QUALITY_PRESETS.medium)).toBe('ldr')
    expect(browserRenderTargetKind(QUALITY_PRESETS.ultra)).toBe('hdr')
    expect(browserPostProcessingChain(QUALITY_PRESETS.low).map((step) => step.pass)).not.toContain('composite')
    expect(browserPostProcessingChain(QUALITY_PRESETS.medium).map((step) => step.pass)).not.toContain('composite')
    expect(browserPostProcessingChain(QUALITY_PRESETS.high).map((step) => step.pass)).toContain('composite')
    expect(browserPostProcessingChain(QUALITY_PRESETS.ultra).map((step) => step.pass)).toContain('composite')
  })

  it('builds shader descriptors and selects enabled composite effects', () => {
    const makeVector2 = (x: number, y: number) => ({ x, y })
    const godRays = createBrowserGodRaysShader(45, makeVector2)
    expect(godRays.uniforms.uSamples.value).toBe(40)
    expect(godRays.uniforms.uLightPosition.value).toStrictEqual({
      x: BROWSER_RENDER_DEFAULTS.lightPositionComponent,
      y: BROWSER_RENDER_DEFAULTS.lightPositionComponent,
    })
    expect(godRays.fragmentShader).toContain('index < 40')

    const enabled = createBrowserCompositeShader({
      camera: { near: 0.1, far: 1000 },
      effects: ['bloom', 'godRays', 'bokeh'],
      makeVector2,
      quality: QUALITY_PRESETS.ultra,
      viewport: { width: 1920, height: 1080 },
    })
    expect(enabled.uniforms.uBloomEnabled.value).toBe(true)
    expect(enabled.uniforms.uGodRaysEnabled.value).toBe(true)
    expect(enabled.uniforms.uBokehEnabled.value).toBe(true)
    expect(enabled.uniforms.uResolution.value).toStrictEqual({ x: 1920, y: 1080 })
    expect(enabled.uniforms.uNearClip.value).toBe(0.1)
    expect(enabled.uniforms.uFarClip.value).toBe(1000)

    const disabled = createBrowserCompositeShader({
      camera: { near: 0.1, far: 10 },
      effects: [],
      makeVector2,
      quality: QUALITY_PRESETS.low,
      viewport: { width: 1, height: 1 },
    })
    expect(disabled.uniforms.uBloomEnabled.value).toBe(false)
    expect(disabled.uniforms.uGodRaysEnabled.value).toBe(false)
    expect(disabled.uniforms.uBokehEnabled.value).toBe(false)
    expect(disabled.uniforms.uSamples.value).toBe(QUALITY_PRESETS.low.godRaysSamples)
  })

  it('chooses timer query support only for a complete extension and normalizes samples', () => {
    const extension = { GPU_DISJOINT_EXT: 1, TIME_ELAPSED_EXT: 2 }
    expect(selectGpuTimer(extension)).toStrictEqual({ kind: 'query', extension })
    expect(selectGpuTimer(null)).toStrictEqual({ kind: 'fallback' })
    expect(selectGpuTimer('extension')).toStrictEqual({ kind: 'fallback' })
    expect(selectGpuTimer({ GPU_DISJOINT_EXT: 1 })).toStrictEqual({ kind: 'fallback' })
    expect(selectGpuTimer({ GPU_DISJOINT_EXT: '1', TIME_ELAPSED_EXT: 2 })).toStrictEqual({ kind: 'fallback' })
    expect(selectGpuTimer({ GPU_DISJOINT_EXT: 1, TIME_ELAPSED_EXT: undefined })).toStrictEqual({ kind: 'fallback' })
    expect(millisecondsFromGpuNanoseconds(2_500_000)).toBe(2.5)
    expect(millisecondsFromGpuNanoseconds(-1)).toBe(0)
    expect(millisecondsFromGpuNanoseconds(undefined)).toBeUndefined()
    expect(millisecondsFromGpuNanoseconds(Number.NaN)).toBeUndefined()
  })

  it('gates refraction by visible mesh count, configured ratio, and frame interval', () => {
    const { high } = QUALITY_PRESETS
    expect(shouldCaptureBrowserRefraction({ quality: high, visibleWaterMeshCount: 0, waterScreenRatio: 1, frameNumber: 1 })).toBe(false)
    expect(shouldCaptureBrowserRefraction({ quality: high, visibleWaterMeshCount: 1, waterScreenRatio: 0.004, frameNumber: 1 })).toBe(false)
    expect(shouldCaptureBrowserRefraction({ quality: high, visibleWaterMeshCount: 1, waterScreenRatio: 0.005, frameNumber: 1 })).toBe(true)
    expect(shouldCaptureBrowserRefraction({ quality: high, visibleWaterMeshCount: 1, waterScreenRatio: 0.5, frameNumber: 2 })).toBe(false)
    expect(shouldCaptureBrowserRefraction({ quality: QUALITY_PRESETS.low, visibleWaterMeshCount: 1, waterScreenRatio: 1, frameNumber: 1 })).toBe(false)
    const custom = { ...high, refractionMinScreenRatio: 0.75, refractionThrottleFrames: 1 }
    expect(shouldCaptureBrowserRefraction({ quality: custom, visibleWaterMeshCount: 1, waterScreenRatio: 0.74, frameNumber: 1 })).toBe(false)
    expect(shouldCaptureBrowserRefraction({ quality: custom, visibleWaterMeshCount: 1, waterScreenRatio: 0.75, frameNumber: 1 })).toBe(true)
  })

  it('wraps FPS transitions with the SSIM skip signal', () => {
    let result = advanceBrowserFpsQuality(createAdaptiveQualityState(), 'ultra', 49)
    for (let frame = 1; frame < 20; frame += 1) {
      result = advanceBrowserFpsQuality(result.state, result.preset, 49)
    }
    expect(result.change).toBe('downgrade')
    expect(result.preset).toBe('high')
    expect(result.skipSsim).toBe(true)
    result = advanceBrowserFpsQuality(result.state, 'high', 60)
    expect(result.change).toBe('none')
    expect(result.skipSsim).toBe(false)
    const recovery = advanceBrowserFpsQuality(createAdaptiveQualityState(), 'medium', 60)
    expect(recovery.change).toBe('recover')
    expect(recovery.preset).toBe('high')
    expect(recovery.skipSsim).toBe(true)
    const invalid = advanceBrowserFpsQuality(createAdaptiveQualityState(), 'medium', Number.NaN)
    expect(invalid.change).toBe('none')
    expect(invalid.skipSsim).toBe(false)
  })

  it('skips SSIM after an FPS change and downgrades once after sustained low scores', () => {
    const initial = createSsimAdaptiveQualityState()
    const skipped = advanceBrowserSsimQuality({ state: initial, preset: 'ultra', ssim: 0.5, skipSsim: true })
    expect(skipped).toStrictEqual({
      change: 'none',
      preset: 'ultra',
      skipSsim: false,
      state: initial,
    })
    let result = advanceBrowserSsimQuality({ state: initial, preset: 'ultra', ssim: 0.94, skipSsim: false })
    for (let frame = 1; frame < 20; frame += 1) {
      result = advanceBrowserSsimQuality({ state: result.state, preset: result.preset, ssim: 0.94, skipSsim: false })
    }
    expect(result.change).toBe('downgrade')
    expect(result.preset).toBe('high')
    expect(result.skipSsim).toBe(false)
    const latched = advanceBrowserSsimQuality({ state: result.state, preset: result.preset, ssim: 0.1, skipSsim: false })
    expect(latched.change).toBe('none')
    expect(latched.preset).toBe('high')
  })

  it('computes SSIM for identical, changed, partial-window, and offset-backed RGBA data', () => {
    const same = rgba(1, 1, 20)
    expect(structuralSimilarity({ left: same, right: same, width: 1, height: 1 })).toBe(1)
    const left = rgba(9, 9, 20)
    const right = rgba(9, 9, 120)
    expect(structuralSimilarity({ left, right, width: 9, height: 9 })).toBeLessThan(1)
    const paddedLeft = new Uint8Array(left.length + 8)
    const paddedRight = new Uint8Array(right.length + 8)
    paddedLeft.set(left, 4)
    paddedRight.set(right, 4)
    expect(
      structuralSimilarity({
        left: paddedLeft.subarray(4, 4 + left.length),
        right: paddedRight.subarray(4, 4 + right.length),
        width: 9,
        height: 9,
      }),
    ).toBeLessThan(1)
    expect(() => structuralSimilarity({ left: new Uint8Array(4), right: new Uint8Array(8), width: 1, height: 1 })).toThrow(
      'SSIM inputs must be equally sized RGBA images',
    )
  })
})
