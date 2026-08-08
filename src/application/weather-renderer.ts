import { Effect } from 'effect'
import type { RenderEnvironmentPlan } from '../domain/render-environment'
import { planRenderEnvironment } from '../domain/render-environment'
import {
  INITIAL_WEATHER_RENDER_STATE,
  type PrecipitationKind,
  type PrecipitationParticle,
  type WeatherCameraPosition,
  type WeatherFrameOptions,
  type WeatherRenderPlan,
  type WeatherRenderState,
  type WorldWeatherSnapshot,
  planWeatherFrame,
} from '../domain/weather-rendering'
import type { Viewport } from './world-renderer'

export type WeatherPrecipitationResource = {
  readonly update: (particles: ReadonlyArray<PrecipitationParticle>) => Effect.Effect<void>
  readonly resize: (viewport: Viewport) => Effect.Effect<void>
  readonly dispose: Effect.Effect<void>
}

export type WeatherRendererPorts = {
  readonly setEnvironment: (environment: RenderEnvironmentPlan) => Effect.Effect<void>
  readonly createPrecipitation: (
    kind: PrecipitationKind,
  ) => Effect.Effect<WeatherPrecipitationResource>
}

export type WeatherRenderer = {
  readonly frame: (
    snapshot: WorldWeatherSnapshot,
    camera: WeatherCameraPosition,
  ) => Effect.Effect<WeatherRenderPlan>
  readonly resize: (viewport: Viewport) => Effect.Effect<void>
  /** Stop precipitation and restore an ordinary clear environment. Idempotent. */
  readonly stop: (daylight?: number) => Effect.Effect<void>
  readonly state: Effect.Effect<WeatherRenderState>
  readonly dispose: Effect.Effect<void>
}

/** Manage renderer resources while leaving their actual GPU representation to the host. */
export const makeWeatherRenderer = (
  ports: WeatherRendererPorts,
  options: WeatherFrameOptions = {},
): Effect.Effect<WeatherRenderer> =>
  Effect.sync(() => {
    let renderState = INITIAL_WEATHER_RENDER_STATE
    let resource: WeatherPrecipitationResource | undefined
    let resourceKind: PrecipitationKind | undefined
    let viewport: Viewport | undefined

    const release = Effect.gen(function* () {
      if (resource !== undefined) {yield* resource.dispose}
      resource = undefined
      resourceKind = undefined
    })

    const stop = (daylight: number = 1): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* release
        renderState = INITIAL_WEATHER_RENDER_STATE
        yield* ports.setEnvironment(planRenderEnvironment(daylight, options.farPlane))
      })

    return {
      dispose: stop(),

      frame: (snapshot, camera) =>
        Effect.gen(function* () {
          const next = planWeatherFrame(snapshot, camera, renderState, options)
          renderState = next.state
          yield* ports.setEnvironment(next.plan.environment)

          if (next.plan.precipitation === undefined) {
            yield* release
          } else {
            if (resource === undefined || resourceKind !== next.plan.precipitation) {
              yield* release
              resource = yield* ports.createPrecipitation(next.plan.precipitation)
              resourceKind = next.plan.precipitation
              if (viewport !== undefined) yield* resource.resize(viewport)
            }
            yield* resource.update(next.plan.particles)
          }
          return next.plan
        }),

      resize: (nextViewport) =>
        Effect.gen(function* () {
          viewport = nextViewport
          if (resource !== undefined) yield* resource.resize(nextViewport)
        }),

      state: Effect.sync(() => renderState),

      stop,
    }
  })
