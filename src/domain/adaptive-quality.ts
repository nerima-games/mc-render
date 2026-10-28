import { type QualityPreset, stepQualityPreset } from './post-processing.js'

/** Runtime thresholds for frame-rate driven quality changes. */
export const ADAPTIVE_QUALITY_POLICY = {
  cooldownFrames: 20,
  downgradeBelowFps: 50,
  recoveryAtOrAboveFps: 60,
  sustainedFrames: 20,
} as const

const ZERO_QUALITY_FRAMES = 0
const ONE_QUALITY_FRAME = 1

export type AdaptiveQualityState = {
  readonly overBudgetFrames: number
  readonly cooldownFramesRemaining: number
}

export type AdaptiveQualityChange = 'downgrade' | 'recover' | 'none'

export type AdaptiveQualityResult = {
  readonly state: AdaptiveQualityState
  readonly preset: QualityPreset
  readonly change: AdaptiveQualityChange
}

export const createAdaptiveQualityState = (): AdaptiveQualityState => ({
  cooldownFramesRemaining: ZERO_QUALITY_FRAMES,
  overBudgetFrames: ZERO_QUALITY_FRAMES,
})

const noAdaptiveQualityChange = (preset: QualityPreset): AdaptiveQualityResult => ({
  change: 'none',
  preset,
  state: createAdaptiveQualityState(),
})

const advanceOverBudgetQuality = (
  state: AdaptiveQualityState,
  preset: QualityPreset,
): AdaptiveQualityResult => {
  const overBudgetFrames = Math.min(
    ADAPTIVE_QUALITY_POLICY.sustainedFrames,
    state.overBudgetFrames + ONE_QUALITY_FRAME,
  )
  const lowerPreset = stepQualityPreset(preset, 'lower')
  if (overBudgetFrames < ADAPTIVE_QUALITY_POLICY.sustainedFrames || lowerPreset === preset) {
    return {
      change: 'none',
      preset,
      state: { cooldownFramesRemaining: ZERO_QUALITY_FRAMES, overBudgetFrames },
    }
  }

  return {
    change: 'downgrade',
    preset: lowerPreset,
    state: {
      cooldownFramesRemaining: ADAPTIVE_QUALITY_POLICY.cooldownFrames,
      overBudgetFrames: ZERO_QUALITY_FRAMES,
    },
  }
}

const advanceRecoveryQuality = (preset: QualityPreset): AdaptiveQualityResult => {
  const higherPreset = stepQualityPreset(preset, 'higher')
  if (higherPreset === preset) {
    return noAdaptiveQualityChange(preset)
  }

  return {
    change: 'recover',
    preset: higherPreset,
    state: {
      cooldownFramesRemaining: ADAPTIVE_QUALITY_POLICY.cooldownFrames,
      overBudgetFrames: ZERO_QUALITY_FRAMES,
    },
  }
}

/**
 * Advance the frame-rate policy by one observed frame.
 *
 * A change is returned only after 20 consecutive frames below 50 FPS. Recovery
 * is one preset at 60 FPS or above. Either change suppresses further changes
 * for the next 20 observations.
 */
export const advanceAdaptiveQuality = (
  state: AdaptiveQualityState,
  preset: QualityPreset,
  fps: number,
): AdaptiveQualityResult => {
  if (state.cooldownFramesRemaining > ZERO_QUALITY_FRAMES) {
    return {
      change: 'none',
      preset,
      state: {
        cooldownFramesRemaining: state.cooldownFramesRemaining - ONE_QUALITY_FRAME,
        overBudgetFrames: ZERO_QUALITY_FRAMES,
      },
    }
  }

  if (!Number.isFinite(fps) || fps < ZERO_QUALITY_FRAMES) {
    return noAdaptiveQualityChange(preset)
  }

  if (fps < ADAPTIVE_QUALITY_POLICY.downgradeBelowFps) {
    return advanceOverBudgetQuality(state, preset)
  }

  if (fps >= ADAPTIVE_QUALITY_POLICY.recoveryAtOrAboveFps) {
    return advanceRecoveryQuality(preset)
  }

  return noAdaptiveQualityChange(preset)
}
