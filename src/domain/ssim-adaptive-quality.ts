import {
  ADAPTIVE_QUALITY_POLICY,
  type AdaptiveQualityChange,
} from './adaptive-quality.js'
import { type QualityPreset, stepQualityPreset } from './post-processing.js'

export const SSIM_ADAPTIVE_QUALITY_THRESHOLD = 0.95

export type SsimAdaptiveQualityState = {
  readonly belowThresholdFrames: number
  readonly hasDowngraded: boolean
}

export type SsimAdaptiveQualityResult = {
  readonly state: SsimAdaptiveQualityState
  readonly preset: QualityPreset
  readonly change: Extract<AdaptiveQualityChange, 'downgrade' | 'none'>
}

export const createSsimAdaptiveQualityState = (): SsimAdaptiveQualityState => ({
  belowThresholdFrames: 0,
  hasDowngraded: false,
})

/**
 * Advance the SSIM policy by one comparison with the hidden reference target.
 *
 * Twenty consecutive scores below 0.95 lower the preset once per runtime.
 * A missing or non-finite score breaks the consecutive window.
 */
export const advanceSsimAdaptiveQuality = (
  state: SsimAdaptiveQualityState,
  preset: QualityPreset,
  ssim: number,
): SsimAdaptiveQualityResult => {
  if (state.hasDowngraded) {
    return { state, preset, change: 'none' }
  }

  if (!Number.isFinite(ssim) || ssim >= SSIM_ADAPTIVE_QUALITY_THRESHOLD) {
    return {
      state: { belowThresholdFrames: 0, hasDowngraded: false },
      preset,
      change: 'none',
    }
  }

  const belowThresholdFrames = Math.min(
    ADAPTIVE_QUALITY_POLICY.sustainedFrames,
    state.belowThresholdFrames + 1,
  )
  const lowerPreset = stepQualityPreset(preset, 'lower')
  if (
    belowThresholdFrames < ADAPTIVE_QUALITY_POLICY.sustainedFrames ||
    lowerPreset === preset
  ) {
    return {
      state: { belowThresholdFrames, hasDowngraded: false },
      preset,
      change: 'none',
    }
  }

  return {
    state: { belowThresholdFrames: 0, hasDowngraded: true },
    preset: lowerPreset,
    change: 'downgrade',
  }
}
