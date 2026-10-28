import {
  ADAPTIVE_QUALITY_POLICY,
  type AdaptiveQualityChange,
} from './adaptive-quality.js'
import { type QualityPreset, stepQualityPreset } from './post-processing.js'

export const SSIM_ADAPTIVE_QUALITY_THRESHOLD = 0.95
const ONE_ADAPTIVE_FRAME = 1

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

const noSsimQualityChange = (
  preset: QualityPreset,
  state: SsimAdaptiveQualityState,
): SsimAdaptiveQualityResult => ({
  change: 'none',
  preset,
  state,
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
    return noSsimQualityChange(preset, state)
  }

  if (!Number.isFinite(ssim) || ssim >= SSIM_ADAPTIVE_QUALITY_THRESHOLD) {
    return {
      change: 'none',
      preset,
      state: { belowThresholdFrames: 0, hasDowngraded: false },
    }
  }

  const belowThresholdFrames = Math.min(
    ADAPTIVE_QUALITY_POLICY.sustainedFrames,
    state.belowThresholdFrames + ONE_ADAPTIVE_FRAME,
  )
  const lowerPreset = stepQualityPreset(preset, 'lower')
  if (
    belowThresholdFrames < ADAPTIVE_QUALITY_POLICY.sustainedFrames ||
    lowerPreset === preset
  ) {
    return {
      change: 'none',
      preset,
      state: { belowThresholdFrames, hasDowngraded: false },
    }
  }

  return {
    change: 'downgrade',
    preset: lowerPreset,
    state: { belowThresholdFrames: 0, hasDowngraded: true },
  }
}
