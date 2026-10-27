import { type QualityPreset, stepQualityPreset } from './post-processing.js'

/** Runtime thresholds for frame-rate driven quality changes. */
export const ADAPTIVE_QUALITY_POLICY = {
  downgradeBelowFps: 50,
  recoveryAtOrAboveFps: 60,
  sustainedFrames: 20,
  cooldownFrames: 20,
} as const

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
  overBudgetFrames: 0,
  cooldownFramesRemaining: 0,
})

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
  if (state.cooldownFramesRemaining > 0) {
    return {
      state: {
        overBudgetFrames: 0,
        cooldownFramesRemaining: state.cooldownFramesRemaining - 1,
      },
      preset,
      change: 'none',
    }
  }

  if (!Number.isFinite(fps) || fps < 0) {
    return { state: createAdaptiveQualityState(), preset, change: 'none' }
  }

  if (fps < ADAPTIVE_QUALITY_POLICY.downgradeBelowFps) {
    const overBudgetFrames = Math.min(
      ADAPTIVE_QUALITY_POLICY.sustainedFrames,
      state.overBudgetFrames + 1,
    )
    const lowerPreset = stepQualityPreset(preset, 'lower')
    if (overBudgetFrames < ADAPTIVE_QUALITY_POLICY.sustainedFrames || lowerPreset === preset) {
      return {
        state: { overBudgetFrames, cooldownFramesRemaining: 0 },
        preset,
        change: 'none',
      }
    }

    return {
      state: {
        overBudgetFrames: 0,
        cooldownFramesRemaining: ADAPTIVE_QUALITY_POLICY.cooldownFrames,
      },
      preset: lowerPreset,
      change: 'downgrade',
    }
  }

  if (fps >= ADAPTIVE_QUALITY_POLICY.recoveryAtOrAboveFps) {
    const higherPreset = stepQualityPreset(preset, 'higher')
    if (higherPreset === preset) {
      return { state: createAdaptiveQualityState(), preset, change: 'none' }
    }

    return {
      state: {
        overBudgetFrames: 0,
        cooldownFramesRemaining: ADAPTIVE_QUALITY_POLICY.cooldownFrames,
      },
      preset: higherPreset,
      change: 'recover',
    }
  }

  return { state: createAdaptiveQualityState(), preset, change: 'none' }
}
