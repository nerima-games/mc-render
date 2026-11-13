import { Effect } from 'effect'
import type { Dimension } from '@nerima-games/mc-kernel'
import { planRenderEnvironment, type RenderEnvironmentPlan } from '../../src/domain/render-environment'

export const renderEnvironmentPlan = (
  daylight: number,
  farPlane?: number | undefined,
  dimension?: Dimension | undefined,
): RenderEnvironmentPlan => Effect.runSync(Effect.fromResult(planRenderEnvironment(daylight, farPlane, dimension)))
