import { describe, expect, it, vi } from 'vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  type BrowserWaterMesh,
  BROWSER_RENDER_DEFAULTS,
  BrowserBooleanResultSchema,
  BrowserCompositeShaderResultSchema,
  BrowserGodRaysShaderResultSchema,
  BrowserGpuTimerSelectionResultSchema,
  BrowserNumberResultSchema,
  BrowserOptionalNumberResultSchema,
  BrowserQualityResultSchema,
  BrowserRefractionTargetSizeResultSchema,
  BrowserVoidResultSchema,
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

const expectSuccess = <Value, Failure>(result: Result.Result<Value, Failure>): Value => {
  if (Result.isFailure(result)) {
    throw new Error(JSON.stringify(result.failure))
  }
  return result.success
}

const expectFailure = <Value, Failure>(result: Result.Result<Value, Failure>): Failure => {
  if (Result.isSuccess(result)) {
    throw new Error(JSON.stringify(result.success))
  }
  return result.failure
}

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

  it('guards operations after runtime disposal with a typed failure', () => {
    const active = assertBrowserRuntimeActive(false)
    const inspectedActive = Schema.decodeUnknownResult(BrowserVoidResultSchema, { onExcessProperty: 'error' })(active)
    expect(Result.isSuccess(inspectedActive)).toBe(true)
    if (Result.isSuccess(inspectedActive)) {
      expect(inspectedActive.success).toStrictEqual({ _tag: 'Success', _op: 'Success', success: undefined })
    }
    const disposed = assertBrowserRuntimeActive(true)
    const inspected = Schema.decodeUnknownResult(BrowserVoidResultSchema, { onExcessProperty: 'error' })(disposed)
    expect(Result.isSuccess(inspected)).toBe(true)
    if (Result.isSuccess(inspected)) {
      expect(inspected.success).toStrictEqual({
        _tag: 'Failure',
        _op: 'Failure',
        failure: { _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'disposed' },
      })
    }
    expect(expectFailure(assertBrowserRuntimeActive(undefined))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'invalid-input',
    })
  })

  it('requires runtime surfaces and timer state captured during initialization', () => {
    const runtimeValue = { ready: true }
    expect(expectSuccess(requireBrowserRuntimeValue(runtimeValue, 'not ready'))).toBe(runtimeValue)
    expect(expectFailure(requireBrowserRuntimeValue(undefined, 'not ready'))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError',
      operation: 'runtime',
      reason: 'missing-value',
    })
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
    expect(expectSuccess(isBrowserScreenshotShortcut(shortcut))).toBe(true)
    expect(expectSuccess(isBrowserScreenshotShortcut({ ...shortcut, code: 'F3' }))).toBe(false)
    expect(expectSuccess(isBrowserScreenshotShortcut({ ...shortcut, repeat: true }))).toBe(false)
    expect(expectSuccess(isBrowserScreenshotShortcut({ ...shortcut, altKey: true }))).toBe(false)
    expect(expectSuccess(isBrowserScreenshotShortcut({ ...shortcut, ctrlKey: true }))).toBe(false)
    expect(expectSuccess(isBrowserScreenshotShortcut({ ...shortcut, metaKey: true }))).toBe(false)
    expect(expectSuccess(isBrowserScreenshotShortcut({ ...shortcut, shiftKey: true }))).toBe(false)
    expect(Result.isFailure(isBrowserScreenshotShortcut({ ...shortcut, extra: true }))).toBe(true)
  })

  it('resolves named, custom, and default quality selections', () => {
    const namedQuality = resolveBrowserQuality('ultra')
    const namedQualitySchema = Schema.decodeUnknownResult(BrowserQualityResultSchema, { onExcessProperty: 'error' })(namedQuality)
    expect(Result.isSuccess(namedQualitySchema)).toBe(true)
    expect(expectSuccess(namedQuality)).toStrictEqual({
      preset: 'ultra',
      quality: QUALITY_PRESETS.ultra,
    })
    const custom = { ...QUALITY_PRESETS.high, pixelRatioCap: 1.25 }
    expect(expectSuccess(resolveBrowserQuality(custom))).toStrictEqual({ preset: undefined, quality: custom })
    expect(expectSuccess(resolveBrowserQuality(undefined))).toStrictEqual({
      preset: 'high',
      quality: QUALITY_PRESETS.high,
    })
    expect(Result.isFailure(resolveBrowserQuality({ ...custom, extra: true }))).toBe(true)
    const invalidQuality = resolveBrowserQuality({ ...custom, refractionThrottleFrames: -1 })
    const invalidQualityResult = Schema.decodeUnknownResult(BrowserQualityResultSchema, { onExcessProperty: 'error' })(invalidQuality)
    expect(Result.isSuccess(invalidQualityResult)).toBe(true)
    if (Result.isSuccess(invalidQualityResult)) {
      expect(invalidQualityResult.success).toStrictEqual({
        _tag: 'Failure',
        _op: 'Failure',
        failure: { _tag: 'BrowserRenderPolicyError', operation: 'refraction', reason: 'invalid-refraction-input' },
      })
    }
    expect(expectFailure(resolveBrowserQuality('cinematic'))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'quality', reason: 'invalid-input',
    })
    expect(expectFailure(resolveBrowserQuality({ ...custom, godRaysSamples: -1 }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'god-ray-samples', reason: 'out-of-range',
    })
    expect(expectFailure(resolveBrowserQuality({ ...custom, refractionMinScreenRatio: 1.1 }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'refraction', reason: 'invalid-refraction-input',
    })
  })

  it('accepts valid pixel ratios and rejects invalid external values', () => {
    expect(expectFailure(resolveBrowserPixelRatioCap(Number.NaN))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'pixel-ratio', reason: 'not-finite',
    })
    expect(expectFailure(resolveBrowserPixelRatioCap(0.25))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'pixel-ratio', reason: 'out-of-range',
    })
    expect(expectSuccess(resolveBrowserPixelRatioCap(1.5))).toBe(1.5)
    expect(expectFailure(resolveBrowserPixelRatioCap(3))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'pixel-ratio', reason: 'out-of-range',
    })
    expect(expectSuccess(resolveBrowserMaxPixelRatio(1.25, 2))).toBe(1.25)
    expect(expectSuccess(resolveBrowserMaxPixelRatio(3, 1.5))).toBe(1.5)
    expect(expectSuccess(resolveBrowserMaxPixelRatio(undefined, 1.5))).toBe(1.5)
    expect(expectFailure(resolveBrowserMaxPixelRatio(Number.NaN, 1.5)).reason).toBe('not-finite')
    expect(expectFailure(resolveBrowserMaxPixelRatio(0, 1.5)).reason).toBe('out-of-range')
    expect(expectFailure(resolveBrowserMaxPixelRatio(undefined, Number.POSITIVE_INFINITY)).reason).toBe('not-finite')
    expect(expectSuccess(resolveBrowserPixelRatio(1.5, 1))).toBe(1)
    expect(expectFailure(resolveBrowserPixelRatio(1.5, Number.POSITIVE_INFINITY)).reason).toBe('not-finite')
    expect(expectSuccess(resolveBrowserPixelRatio(1.5, undefined))).toBe(1)
    expect(expectFailure(resolveBrowserPixelRatio(1.5, 0)).reason).toBe('out-of-range')
    expect(expectFailure(resolveBrowserPixelRatio(0.25, 1)).reason).toBe('out-of-range')
  })

  it('property: non-finite pixel caps produce strict typed failures', () => {
    FastCheck.assert(
      FastCheck.property(FastCheck.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY), (value) => {
        const actual = resolveBrowserPixelRatioCap(value)
        const decoded = Schema.decodeUnknownResult(BrowserNumberResultSchema, { onExcessProperty: 'error' })(actual)
        expect(Result.isSuccess(decoded)).toBe(true)
        if (Result.isFailure(decoded)) {
          return
        }
        expect(decoded.success).toStrictEqual({
          _tag: 'Failure',
          _op: 'Failure',
          failure: { _tag: 'BrowserRenderPolicyError', operation: 'pixel-ratio', reason: 'not-finite' },
        })
      }),
    )
  })

  it('resolves viewport and target dimensions while rejecting malformed sizes', () => {
    expect(expectSuccess(resolveBrowserViewport({ clientWidth: 320.9, clientHeight: 200.2, canvasWidth: 640, canvasHeight: 480 }))).toStrictEqual({ width: 320, height: 200 })
    expect(expectSuccess(resolveBrowserViewport({ clientWidth: 0, clientHeight: 0, canvasWidth: 64.8, canvasHeight: 0 }))).toStrictEqual({ width: 64, height: 1 })
    expect(expectSuccess(resolveBrowserViewport({ clientWidth: 0, clientHeight: 0, canvasWidth: 0, canvasHeight: 0 }))).toStrictEqual({ width: 1, height: 1 })
    expect(expectFailure(resolveBrowserViewport({ clientWidth: -1, clientHeight: 1, canvasWidth: 1, canvasHeight: 1 })).reason).toBe('out-of-range')
    expect(Result.isFailure(resolveBrowserViewport({ clientWidth: 1, clientHeight: 1, canvasWidth: 1, canvasHeight: 1, extra: true }))).toBe(true)
    const target = resolveBrowserRefractionTargetSize({ width: 320, height: 200 }, 1.5)
    const inspectedTarget = Schema.decodeUnknownResult(BrowserRefractionTargetSizeResultSchema, { onExcessProperty: 'error' })(target)
    expect(Result.isSuccess(inspectedTarget)).toBe(true)
    if (Result.isSuccess(inspectedTarget)) {
      expect(inspectedTarget.success).toStrictEqual({
        _tag: 'Success', _op: 'Success', success: { width: 480, height: 300, key: '480x300' },
      })
    }
    expect(expectFailure(resolveBrowserRefractionTargetSize({ width: 1, height: 1 }, 0)).reason).toBe('out-of-range')
    expect(expectFailure(resolveBrowserRefractionTargetSize(null, 1))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'refraction-target-size', reason: 'invalid-input',
    })
    expect(expectFailure(resolveBrowserRefractionTargetSize({ width: 1.5, height: 1 }, 1))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'refraction-target-size', reason: 'out-of-range',
    })
    expect(expectFailure(resolveBrowserRefractionTargetSize({ width: 1, height: 1 }, Number.NaN))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'refraction-target-size', reason: 'not-finite',
    })
    expect(expectSuccess(resolveBrowserDrawingBufferSize(320.9, 200.2))).toStrictEqual({ width: 320, height: 200 })
    expect(expectFailure(resolveBrowserDrawingBufferSize(0, 0)).reason).toBe('out-of-range')
    expect(expectFailure(resolveBrowserDrawingBufferSize(Number.NaN, 1))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'drawing-buffer-size', reason: 'not-finite',
    })
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

  it('measures browser stages with typed Effect failure and cleanup', () => {
    const marks = {
      clearMarks: vi.fn(),
      mark: vi.fn(),
      measure: vi.fn(),
    }
    expect(Effect.runSync(measureBrowserStage(undefined, 'render.none', () => 3))).toBe(3)
    expect(Effect.runSync(measureBrowserStage({}, 'render.missing-mark', () => 4))).toBe(4)
    expect(Effect.runSync(measureBrowserStage({ mark: marks.mark }, 'render.incomplete', () => 4))).toBe(4)
    expect(Effect.runSync(measureBrowserStage({ mark: marks.mark, measure: marks.measure }, 'render.missing-cleanup', () => 4))).toBe(4)
    const api = { mark: marks.mark, measure: marks.measure, clearMarks: marks.clearMarks }
    expect(Effect.runSync(measureBrowserStage(api, 'render.stage', () => 5))).toBe(5)
    expect(marks.mark.mock.calls).toEqual([['render.stage:start'], ['render.stage:end']])
    expect(marks.measure).toHaveBeenCalledWith('render.stage', 'render.stage:start', 'render.stage:end')
    expect(marks.clearMarks.mock.calls).toEqual([['render.stage:start'], ['render.stage:end']])
    const failed = Effect.runSyncExit(measureBrowserStage(api, 'render.failure', () => { throw new Error('render failed') }))
    expect(failed._tag).toBe('Failure')
    expect(marks.clearMarks).toHaveBeenCalledWith('render.failure:end')
    const failedWithoutPerformanceApi = Effect.runSyncExit(
      measureBrowserStage(undefined, 'render.failure-without-api', () => { throw new Error('render failed') }),
    )
    expect(failedWithoutPerformanceApi._tag).toBe('Failure')
  })

  it('validates shader sample and bloom parameters', () => {
    expect(expectFailure(resolveBrowserGodRaySamples(Number.NaN))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'god-ray-samples', reason: 'not-finite',
    })
    expect(expectFailure(resolveBrowserGodRaySamples(-2)).reason).toBe('out-of-range')
    expect(expectFailure(resolveBrowserGodRaySamples(3.9)).reason).toBe('invalid-integer')
    expect(expectFailure(resolveBrowserGodRaySamples(50)).reason).toBe('out-of-range')
    expect(expectFailure(resolveBrowserBloomStrength(Number.POSITIVE_INFINITY)).reason).toBe('not-finite')
    expect(expectFailure(resolveBrowserBloomStrength(-0.5)).reason).toBe('out-of-range')
    expect(expectSuccess(resolveBrowserBloomStrength(0.6))).toBe(0.6)
    expect(expectFailure(resolveBrowserBloomStrength(2)).reason).toBe('out-of-range')
  })

  it('selects render target precision and preset composite chains', () => {
    expect(browserRenderTargetKind(QUALITY_PRESETS.medium)).toBe('ldr')
    expect(browserRenderTargetKind(QUALITY_PRESETS.ultra)).toBe('hdr')
    expect(browserPostProcessingChain(QUALITY_PRESETS.low).map((step) => step.pass)).not.toContain('composite')
    expect(browserPostProcessingChain(QUALITY_PRESETS.medium).map((step) => step.pass)).not.toContain('composite')
    expect(browserPostProcessingChain(QUALITY_PRESETS.high).map((step) => step.pass)).toContain('composite')
    expect(browserPostProcessingChain(QUALITY_PRESETS.ultra).map((step) => step.pass)).toContain('composite')
  })

  it('builds valid shader descriptors and selects enabled composite effects', () => {
    const makeVector2 = (x: number, y: number) => ({ x, y })
    const godRays = expectSuccess(createBrowserGodRaysShader(40, makeVector2))
    expect(Schema.decodeUnknownResult(BrowserGodRaysShaderResultSchema, { onExcessProperty: 'error' })(Result.succeed(godRays))).toMatchObject({
      _tag: 'Success',
    })
    expect(godRays.uniforms.uSamples.value).toBe(40)
    expect(godRays.uniforms.uLightPosition.value).toStrictEqual({
      x: BROWSER_RENDER_DEFAULTS.lightPositionComponent,
      y: BROWSER_RENDER_DEFAULTS.lightPositionComponent,
    })
    expect(godRays.fragmentShader).toContain('index < 40')
    expect(expectFailure(createBrowserGodRaysShader(45, makeVector2)).reason).toBe('out-of-range')

    const enabled = expectSuccess(createBrowserCompositeShader({
      camera: { near: 0.1, far: 1000 },
      effects: ['bloom', 'godRays', 'bokeh'],
      makeVector2,
      quality: QUALITY_PRESETS.ultra,
      viewport: { width: 1920, height: 1080 },
    }))
    expect(Schema.decodeUnknownResult(BrowserCompositeShaderResultSchema, { onExcessProperty: 'error' })(Result.succeed(enabled))).toMatchObject({
      _tag: 'Success',
    })
    expect(enabled.uniforms.uBloomEnabled.value).toBe(true)
    expect(enabled.uniforms.uGodRaysEnabled.value).toBe(true)
    expect(enabled.uniforms.uBokehEnabled.value).toBe(true)
    expect(enabled.uniforms.uResolution.value).toStrictEqual({ x: 1920, y: 1080 })
    expect(enabled.uniforms.uNearClip.value).toBe(0.1)
    expect(enabled.uniforms.uFarClip.value).toBe(1000)

    const disabled = expectSuccess(createBrowserCompositeShader({
      camera: { near: 0.1, far: 10 },
      effects: [],
      makeVector2,
      quality: QUALITY_PRESETS.low,
      viewport: { width: 1, height: 1 },
    }))
    expect(disabled.uniforms.uBloomEnabled.value).toBe(false)
    expect(disabled.uniforms.uGodRaysEnabled.value).toBe(false)
    expect(disabled.uniforms.uBokehEnabled.value).toBe(false)
    expect(disabled.uniforms.uSamples.value).toBe(QUALITY_PRESETS.low.godRaysSamples)
    expect(Result.isFailure(createBrowserCompositeShader({
      camera: { near: 0.1, far: 10 },
      effects: [],
      makeVector2,
      quality: { ...QUALITY_PRESETS.low, bloomStrength: 2 },
      viewport: { width: 1, height: 1 },
    }))).toBe(true)
    expect(expectFailure(createBrowserGodRaysShader(20, () => { throw new Error('vector creation failed') }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'invalid-input',
    })
    expect(expectFailure(createBrowserCompositeShader({}))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'invalid-input',
    })
    const compositeInput = {
      camera: { near: 0.1, far: 10 },
      effects: [],
      makeVector2,
      quality: QUALITY_PRESETS.low,
      viewport: { width: 1, height: 1 },
    }
    expect(expectFailure(createBrowserCompositeShader({ ...compositeInput, camera: null }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'invalid-input',
    })
    expect(expectFailure(createBrowserCompositeShader({ ...compositeInput, viewport: { width: 0, height: 1 } }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'invalid-input',
    })
    expect(expectFailure(createBrowserCompositeShader({ ...compositeInput, makeVector2: () => { throw new Error('resolution failed') } }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'invalid-input',
    })
    let vectorCalls = 0
    expect(expectFailure(createBrowserCompositeShader({
      ...compositeInput,
      makeVector2: (x: number, y: number) => {
        vectorCalls += 1
        if (vectorCalls === 2) {
          throw new Error('light position creation failed')
        }
        return { x, y }
      },
    }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'invalid-input',
    })
  })

  it('chooses timer query support only for a complete extension and normalizes samples', () => {
    const extension = { GPU_DISJOINT_EXT: 1, TIME_ELAPSED_EXT: 2 }
    const inspectedExtension = Schema.decodeUnknownResult(BrowserGpuTimerSelectionResultSchema, { onExcessProperty: 'error' })(selectGpuTimer(extension))
    expect(Result.isSuccess(inspectedExtension)).toBe(true)
    if (Result.isSuccess(inspectedExtension)) {
      expect(inspectedExtension.success).toStrictEqual({
        _tag: 'Success', _op: 'Success', success: { kind: 'query', extension },
      })
    }
    expect(expectSuccess(selectGpuTimer(null))).toStrictEqual({ kind: 'fallback' })
    const validElapsed = millisecondsFromGpuNanoseconds(2_500_000)
    const inspectedElapsed = Schema.decodeUnknownResult(BrowserOptionalNumberResultSchema, { onExcessProperty: 'error' })(validElapsed)
    expect(Result.isSuccess(inspectedElapsed)).toBe(true)
    if (Result.isSuccess(inspectedElapsed)) {
      expect(inspectedElapsed.success).toStrictEqual({ _tag: 'Success', _op: 'Success', success: 2.5 })
    }
    expect(expectSuccess(millisecondsFromGpuNanoseconds(undefined))).toBeUndefined()
    const negativeElapsed = millisecondsFromGpuNanoseconds(-1)
    const inspectedNegative = Schema.decodeUnknownResult(BrowserOptionalNumberResultSchema, { onExcessProperty: 'error' })(negativeElapsed)
    expect(Result.isSuccess(inspectedNegative)).toBe(true)
    if (Result.isSuccess(inspectedNegative)) {
      expect(inspectedNegative.success).toStrictEqual({
        _tag: 'Failure', _op: 'Failure',
        failure: { _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'out-of-range' },
      })
    }
    expect(expectFailure(millisecondsFromGpuNanoseconds(Number.NaN))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'not-finite',
    })
  })

  it('property: malformed timer extensions produce strict typed failures', () => {
    const invalidExtension = FastCheck.oneof(
      FastCheck.string(),
      FastCheck.record({ GPU_DISJOINT_EXT: FastCheck.integer() }),
      FastCheck.record({ GPU_DISJOINT_EXT: FastCheck.integer(), TIME_ELAPSED_EXT: FastCheck.string() }),
    )
    FastCheck.assert(
      FastCheck.property(invalidExtension, (value) => {
        const actual = selectGpuTimer(value)
        const decoded = Schema.decodeUnknownResult(BrowserGpuTimerSelectionResultSchema, {
          onExcessProperty: 'error',
        })(actual)
        expect(Result.isSuccess(decoded)).toBe(true)
        if (Result.isFailure(decoded)) {
          return
        }
        expect(decoded.success).toStrictEqual({
          _tag: 'Failure',
          _op: 'Failure',
          failure: { _tag: 'BrowserRenderPolicyError', operation: 'runtime', reason: 'invalid-input' },
        })
      }),
    )
  })

  it('gates refraction by visible mesh count, configured ratio, and frame interval', () => {
    const { high } = QUALITY_PRESETS
    expect(expectSuccess(shouldCaptureBrowserRefraction({ quality: high, visibleWaterMeshCount: 0, waterScreenRatio: 1, frameNumber: 1 }))).toBe(false)
    expect(expectSuccess(shouldCaptureBrowserRefraction({ quality: high, visibleWaterMeshCount: 1, waterScreenRatio: 0.004, frameNumber: 1 }))).toBe(false)
    expect(expectSuccess(shouldCaptureBrowserRefraction({ quality: high, visibleWaterMeshCount: 1, waterScreenRatio: 0.005, frameNumber: 1 }))).toBe(true)
    expect(expectSuccess(shouldCaptureBrowserRefraction({ quality: high, visibleWaterMeshCount: 1, waterScreenRatio: 0.5, frameNumber: 2 }))).toBe(false)
    expect(expectSuccess(shouldCaptureBrowserRefraction({ quality: QUALITY_PRESETS.low, visibleWaterMeshCount: 1, waterScreenRatio: 1, frameNumber: 1 }))).toBe(false)
    const custom = { ...high, refractionMinScreenRatio: 0.75, refractionThrottleFrames: 1 }
    expect(expectSuccess(shouldCaptureBrowserRefraction({ quality: custom, visibleWaterMeshCount: 1, waterScreenRatio: 0.74, frameNumber: 1 }))).toBe(false)
    expect(expectSuccess(shouldCaptureBrowserRefraction({ quality: custom, visibleWaterMeshCount: 1, waterScreenRatio: 0.75, frameNumber: 1 }))).toBe(true)
    const actual = shouldCaptureBrowserRefraction({ quality: high, visibleWaterMeshCount: -1, waterScreenRatio: 1, frameNumber: 1 })
    const decoded = Schema.decodeUnknownResult(BrowserBooleanResultSchema, { onExcessProperty: 'error' })(actual)
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toStrictEqual({
        _tag: 'Failure', _op: 'Failure',
        failure: { _tag: 'BrowserRenderPolicyError', operation: 'refraction', reason: 'invalid-refraction-input' },
      })
    }
    expect(expectFailure(shouldCaptureBrowserRefraction({}))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'refraction', reason: 'invalid-input',
    })
    expect(expectFailure(shouldCaptureBrowserRefraction({
      quality: high,
      visibleWaterMeshCount: 1,
      waterScreenRatio: 0.5,
      frameNumber: -1,
    }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'refraction', reason: 'invalid-refraction-input',
    })
    expect(expectFailure(shouldCaptureBrowserRefraction({
      quality: { ...high, refractionThrottleFrames: -1 },
      visibleWaterMeshCount: 1,
      waterScreenRatio: 0.5,
      frameNumber: 1,
    }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'refraction', reason: 'invalid-refraction-input',
    })
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

  it('computes SSIM for valid RGBA data and rejects mismatched sizes', () => {
    const same = rgba(1, 1, 20)
    expect(expectSuccess(structuralSimilarity({ left: same, right: same, width: 1, height: 1 }))).toBe(1)
    const left = rgba(9, 9, 20)
    const right = rgba(9, 9, 120)
    expect(expectSuccess(structuralSimilarity({ left, right, width: 9, height: 9 }))).toBeLessThan(1)
    const paddedLeft = new Uint8Array(left.length + 8)
    const paddedRight = new Uint8Array(right.length + 8)
    paddedLeft.set(left, 4)
    paddedRight.set(right, 4)
    expect(expectSuccess(structuralSimilarity({
      left: paddedLeft.subarray(4, 4 + left.length),
      right: paddedRight.subarray(4, 4 + right.length),
      width: 9,
      height: 9,
    }))).toBeLessThan(1)
    const actual = structuralSimilarity({ left: new Uint8Array(4), right: new Uint8Array(8), width: 1, height: 1 })
    const decoded = Schema.decodeUnknownResult(BrowserNumberResultSchema, { onExcessProperty: 'error' })(actual)
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isSuccess(decoded)) {
      expect(decoded.success).toStrictEqual({
        _tag: 'Failure', _op: 'Failure',
        failure: { _tag: 'BrowserRenderPolicyError', operation: 'similarity', reason: 'size-mismatch' },
      })
    }
    expect(expectFailure(structuralSimilarity({}))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'similarity', reason: 'invalid-input',
    })
    expect(expectFailure(structuralSimilarity({
      left: new Uint8Array(0), right: new Uint8Array(0), width: 0, height: 1,
    }))).toStrictEqual({
      _tag: 'BrowserRenderPolicyError', operation: 'similarity', reason: 'invalid-input',
    })
  })
})
