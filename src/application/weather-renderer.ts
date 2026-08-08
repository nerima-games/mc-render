import { Effect, Option } from 'effect'
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
import { type RenderEnvironmentPlan, planRenderEnvironment } from '../domain/render-environment'
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

/** Neutral daylight value `stop` restores the environment to when the caller does not say otherwise. */
const DEFAULT_STOP_DAYLIGHT = 1

/** A live precipitation resource together with the kind it was built for. */
type ActivePrecipitation = {
  readonly kind: PrecipitationKind
  readonly resource: WeatherPrecipitationResource
}

/** Manage renderer resources while leaving their actual GPU representation to the host. */
export const makeWeatherRenderer = (
  ports: WeatherRendererPorts,
  options: WeatherFrameOptions = {},
): Effect.Effect<WeatherRenderer> =>
  Effect.sync(() => {
    let renderState = INITIAL_WEATHER_RENDER_STATE
    let activePrecipitation: Option.Option<ActivePrecipitation> = Option.none()
    let viewport: Option.Option<Viewport> = Option.none()

    const releaseEffect = Effect.gen(function* releasePrecipitationResource() {
      if (Option.isSome(activePrecipitation)) {
        yield* activePrecipitation.value.resource.dispose
      }
      activePrecipitation = Option.none()
    })

    const stop = (daylight: number = DEFAULT_STOP_DAYLIGHT): Effect.Effect<void> =>
      Effect.gen(function* stopWeatherRendererEffect() {
        yield* releaseEffect
        renderState = INITIAL_WEATHER_RENDER_STATE
        yield* ports.setEnvironment(planRenderEnvironment(daylight, options.farPlane))
      })

    /** Build a fresh resource for `kind`, releasing whatever was active first. */
    const refreshPrecipitationResource = (
      kind: PrecipitationKind,
    ): Effect.Effect<WeatherPrecipitationResource> =>
      Effect.gen(function* refreshPrecipitationResourceEffect() {
        yield* releaseEffect
        const resource = yield* ports.createPrecipitation(kind)
        if (Option.isSome(viewport)) {
          yield* resource.resize(viewport.value)
        }
        activePrecipitation = Option.some({ kind, resource })
        return resource
      })

    /** The resource for `kind`: the active one if it already matches, otherwise a fresh one. */
    const ensurePrecipitationResource = (
      kind: PrecipitationKind,
    ): Effect.Effect<WeatherPrecipitationResource> =>
      Effect.gen(function* ensurePrecipitationResourceEffect() {
        if (Option.isSome(activePrecipitation) && activePrecipitation.value.kind === kind) {
          return activePrecipitation.value.resource
        }
        return yield* refreshPrecipitationResource(kind)
      })

    return {
      dispose: stop(),

      frame: (snapshot, camera) =>
        Effect.gen(function* frameWeatherEffect() {
          const next = planWeatherFrame({ camera, options, previous: renderState, snapshot })
          renderState = next.state
          yield* ports.setEnvironment(next.plan.environment)

          if (typeof next.plan.precipitation === 'undefined') {
            yield* releaseEffect
            return next.plan
          }

          const resource = yield* ensurePrecipitationResource(next.plan.precipitation)
          yield* resource.update(next.plan.particles)
          return next.plan
        }),

      resize: (nextViewport) =>
        Effect.gen(function* resizeWeatherEffect() {
          viewport = Option.some(nextViewport)
          if (Option.isSome(activePrecipitation)) {
            yield* activePrecipitation.value.resource.resize(nextViewport)
          }
        }),

      state: Effect.sync(() => renderState),

      stop,
    }
  })
