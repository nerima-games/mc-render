import {
  type AnimationClockInput,
  type AnimationClockInputError,
  AnimationClockInputSchema,
  animationTimeSeconds,
} from '../domain/animation-clock.js'
import {
  DEFAULT_DIMENSION,
  type RenderEnvironmentPlan,
} from '../domain/render-environment.js'
import { type DeltaTimeSecs, type Dimension } from '@nerima-games/mc-kernel'
import { Effect, Schema } from 'effect'
import {
  FIRST_PERSON_ARM_TEXTURE_HEIGHT,
  FIRST_PERSON_ARM_TEXTURE_WIDTH,
  type RenderPresentationTexture,
  makeFirstPersonArmTextureData,
} from './render-presentation-assets.js'
import {
  type InteractionFrameInputEncoded,
  type InteractionRenderer,
  createInteractionRenderer,
} from './interaction-renderer.js'
import {
  ParticleDeltaSecsSchema,
  type ParticleFrameSnapshot,
  type ParticlePool,
  type ParticlePoolInputError,
  type ParticlePoolOptions,
  advanceParticles,
} from '../domain/particle-pool.js'
import { ParticleService, ParticleServiceLive, ParticleServicePoolAccess } from './particle-service.js'
import { type ParticleSystem, makeParticleSystem } from './particle-system.js'
import type {
  PresentationBasicMaterial,
  PresentationMaterial,
  RenderPresentationSurface,
} from './render-presentation-surface.js'
import {
  type RendererMaterialPolicyError,
  type Viewport,
  applyChunkShaderEnvironment,
  applyWaterFrameUniforms,
  assertRendererMaterialPolicies,
  makeChunkShaderMaterial,
  makeChunkShaderMaterialVariant,
  makeTranslucentChunkMaterial,
  makeWaterMaterial,
} from './world-renderer-materials.js'
import { SKY_DAY_LENGTH_TICKS, SKY_MOON_PHASE_COUNT } from '../domain/sky-rendering.js'
import { type SkyRenderer, createSkyRenderer } from './sky-renderer.js'
import type {
  ThreeBufferGeometry,
  ThreeEuler,
  ThreeInstancedBufferGeometry,
  ThreeInstancedSurface,
  ThreeMaterial,
  ThreeMesh,
  ThreeShaderSurface,
  ThreeUniform,
  ThreeVector3,
} from './three-surface.js'
import {
  type WorldRenderer,
  type WorldRendererOptions,
  makeWorldRenderer,
} from './world-renderer.js'
import { CHUNK_SHADER_UNIFORMS } from '../domain/chunk-shader.js'
import type { MirroredCameraState } from '../domain/camera-mirror.js'
/**
 * Production renderer composition.
 *
 * The base renderer owns the platform-neutral scene protocol. This module
 * assembles the atlas shader, animated water and instanced particles that a
 * browser-facing world uses on top of that protocol.
 */

type TransformableThreeMesh = ThreeMesh & {
  readonly position: ThreeVector3
  readonly rotation: ThreeEuler
  readonly scale: ThreeVector3
}

const applyChunkShaderTime = (
  chunkMaterials: ReadonlyArray<{ readonly uniforms: Record<string, ThreeUniform> }>,
  animationSecs: number,
): void => {
  for (const chunkMaterial of chunkMaterials) {
    const time = chunkMaterial.uniforms[CHUNK_SHADER_UNIFORMS.time]
    if (time) {time.value = animationSecs}
  }
}

type ProductionWorldCoordinateEncoded = number

export type ProductionFrame = AnimationClockInput & {
  readonly deltaSecs: DeltaTimeSecs
  readonly cameraPosition: Readonly<{
    worldX: ProductionWorldCoordinateEncoded
    worldY: ProductionWorldCoordinateEncoded
    worldZ: ProductionWorldCoordinateEncoded
  }>
  readonly interaction?: InteractionFrameInputEncoded | undefined
  /** Defaults to the renderer's current dimension, initially `overworld`. */
  readonly dimension?: Dimension | undefined
}

export type ProductionWorldRenderer<TShaderMaterial extends ThreeMaterial> = WorldRenderer & {
  readonly chunkMaterial: TShaderMaterial
  readonly waterMaterial: TShaderMaterial
  readonly waterUniforms: Record<string, ThreeUniform>
  readonly particlePool: ParticlePool
  readonly particleService: ParticleService['Service']
  readonly particles: ParticleSystem<TShaderMaterial>
  readonly setEnvironment: (environment: RenderEnvironmentPlan) => Effect.Effect<void>
  readonly advanceFrame: (frame: ProductionFrame) => Effect.Effect<void, ParticlePoolInputError | AnimationClockInputError>
}

export type ProductionWorldRendererOptions = Omit<
  WorldRendererOptions<ThreeMaterial>,
  'material' | 'cutoutMaterial' | 'transparentMaterial' | 'applyMaterialEnvironment' | 'beforeDraw'
> & {
  readonly particles?: ParticlePoolOptions
}

type UpdatablePresentationTexture = RenderPresentationTexture & {
  readonly dispose: () => void
  generateMipmaps: boolean
  magFilter: number
  minFilter: number
  needsUpdate: boolean
}

type ProductionPresentation<TTexture extends RenderPresentationTexture> = Readonly<{
  armTexture: TTexture & UpdatablePresentationTexture
  interaction: InteractionRenderer
  sky: SkyRenderer
}>

const ZERO = 0

const IDLE_INTERACTION_FRAME: InteractionFrameInputEncoded = {
  action: 'idle',
  actionProgress: ZERO,
  damageDirection: { x: ZERO, y: ZERO },
  damageIntensity: ZERO,
  gaitPhaseRadians: ZERO,
  miningProgress: ZERO,
  movementIntensity: ZERO,
  reducedMotion: false,
}

const INITIAL_FRAME: ProductionFrame = {
  ...Schema.decodeUnknownSync(AnimationClockInputSchema)({
    partialTick: ZERO,
    simulationTick: ZERO,
    timeOfDayTicks: ZERO,
  }),
  cameraPosition: { worldX: ZERO, worldY: ZERO, worldZ: ZERO },
  deltaSecs: Schema.decodeUnknownSync(ParticleDeltaSecsSchema)(ZERO),
}

const createProductionPresentation = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends ThreeBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: ProductionPresentationSurface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial> | undefined,
  atlasTexture: TTexture,
): ProductionPresentation<TTexture> | undefined => {
  if (!surface) {
    return undefined
  }
  const armTexture = new surface.DataTexture(
    makeFirstPersonArmTextureData(),
    FIRST_PERSON_ARM_TEXTURE_WIDTH,
    FIRST_PERSON_ARM_TEXTURE_HEIGHT,
  )
  armTexture.magFilter = surface.NearestFilter
  armTexture.minFilter = surface.NearestFilter
  armTexture.generateMipmaps = false
  armTexture.needsUpdate = true
  return {
    armTexture,
    interaction: createInteractionRenderer(surface, { arm: armTexture, heldItem: atlasTexture }),
    sky: createSkyRenderer(surface),
  }
}

const drawProductionPresentation = <TTexture extends RenderPresentationTexture>(
  presentation: ProductionPresentation<TTexture>,
  input: Readonly<{
    camera: MirroredCameraState
    dimension: Dimension
    frame: ProductionFrame | undefined
  }>,
): Effect.Effect<void, unknown> =>
  Effect.gen(function* updatePresentationFrame() {
    const { camera, dimension, frame } = input
    const currentFrame = frame ?? INITIAL_FRAME
    const { timeOfDayTicks } = currentFrame
    yield* Effect.fromResult(presentation.sky.update({
      cameraPitchRadians: camera.rotation.x,
      cameraPosition: {
        x: camera.position.x,
        y: camera.position.y,
        z: camera.position.z,
      },
      cameraYawRadians: camera.rotation.y,
      dimension: currentFrame.dimension ?? dimension,
      moonPhase: Math.floor(timeOfDayTicks / (SKY_DAY_LENGTH_TICKS / SKY_MOON_PHASE_COUNT)),
      partialTick: currentFrame.partialTick,
      simulationTick: currentFrame.simulationTick,
      timeOfDayTicks,
    }))
    yield* Effect.fromResult(presentation.interaction.update(frame?.interaction ?? IDLE_INTERACTION_FRAME))
  })

const makeBeforeDraw = (
  presentation: ProductionPresentation<RenderPresentationTexture> | undefined,
  readFrame: () => ProductionFrame | undefined,
  readDimension: () => Dimension,
): WorldRendererOptions['beforeDraw'] => {
  if (!presentation) {
    return undefined
  }
  return (camera) => drawProductionPresentation(presentation, {
    camera,
    dimension: readDimension(),
    frame: readFrame(),
  })
}

const attachPresentation = <TTexture extends RenderPresentationTexture>(
  renderer: WorldRenderer,
  presentation: ProductionPresentation<TTexture> | undefined,
): Effect.Effect<void> => {
  if (!presentation) {
    return Effect.void
  }
  return Effect.gen(function* attachPresentationObjects() {
    yield* renderer.attachSceneObject(presentation.sky.sceneObject)
    yield* renderer.attachSceneObject(presentation.interaction.sceneObject)
    yield* renderer.attachCameraObject(presentation.interaction.cameraObject)
  })
}

const detachPresentation = <TTexture extends RenderPresentationTexture>(
  renderer: WorldRenderer,
  presentation: ProductionPresentation<TTexture> | undefined,
): Effect.Effect<void> => {
  if (!presentation) {
    return Effect.void
  }
  return Effect.gen(function* detachPresentationObjects() {
    yield* renderer.detachSceneObject(presentation.sky.sceneObject)
    yield* renderer.detachSceneObject(presentation.interaction.sceneObject)
    yield* renderer.detachCameraObject(presentation.interaction.cameraObject)
  })
}

const disposePresentation = (presentation: ProductionPresentation<RenderPresentationTexture> | undefined): void => {
  if (!presentation) {
    return
  }
  presentation.sky.dispose()
  presentation.interaction.dispose()
  presentation.armTexture.dispose()
}

export type ProductionPresentationSurface<
  TTexture extends RenderPresentationTexture,
  TGeometry extends ThreeBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
> = RenderPresentationSurface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial> & {
  readonly DataTexture: new (
    data: Uint8Array | Uint8ClampedArray,
    width: number,
    height: number,
  ) => TTexture & UpdatablePresentationTexture
  readonly NearestFilter: number
}

// oxlint-disable max-params -- The public factory keeps its structural inputs explicit.
export const makeProductionWorldRenderer = <
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
  TInstancedGeometry extends ThreeInstancedBufferGeometry,
  TShaderMaterial extends ThreeMaterial,
  TTexture extends RenderPresentationTexture = RenderPresentationTexture,
  TPresentationGeometry extends ThreeBufferGeometry = TGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture> = PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial = PresentationMaterial,
  TPointsMaterial extends PresentationMaterial = PresentationMaterial,
>(
  three: ThreeShaderSurface<TCanvas, TGeometry, TMaterial, TShaderMaterial> &
    ThreeInstancedSurface<TCanvas, TGeometry, TMaterial, TInstancedGeometry> & {
      readonly Mesh: new (
        geometry: TGeometry | TInstancedGeometry,
        material: TMaterial | TShaderMaterial,
      ) => TransformableThreeMesh
    },
  canvas: TCanvas,
  viewport: Viewport,
  atlasTexture: TTexture,
  options: ProductionWorldRendererOptions = {},
  presentationSurface?: ProductionPresentationSurface<
    TTexture,
    TPresentationGeometry,
    TBasicMaterial,
    TLineMaterial,
    TPointsMaterial
  >,
): Effect.Effect<
  ProductionWorldRenderer<TShaderMaterial>,
  RendererMaterialPolicyError | ParticlePoolInputError | Schema.SchemaError
> => {
  const frameState: {
    activeDimension: Dimension
    latestFrame: ProductionFrame | undefined
    particleFrame: ParticleFrameSnapshot
  } = {
    activeDimension: options.dimension ?? DEFAULT_DIMENSION,
    latestFrame: undefined,
    particleFrame: { dimension: options.dimension ?? DEFAULT_DIMENSION, entities: [] },
  }
  const buildRenderer = Effect.gen(function* buildProductionRenderer() {
    const chunkMaterials = {
      cutout: makeChunkShaderMaterialVariant({ atlasTexture, three, variant: 'cutout' }),
      opaque: makeChunkShaderMaterial(three, atlasTexture),
      transparent: makeTranslucentChunkMaterial({ atlasTexture, three, viewport }),
    }
    const water = makeWaterMaterial(three, viewport)
    const { particleService, particlePool, particles } = yield* Effect.gen(function* makeProductionParticles() {
      const service = yield* ParticleService
      const pool = yield* ParticleServicePoolAccess
      const system = yield* makeParticleSystem(three, pool, atlasTexture).pipe(
        Effect.tap((particleSystem) => Effect.fromResult(assertRendererMaterialPolicies(water.material, particleSystem.material))),
      )
      return { particlePool: pool, particleService: service, particles: system }
    })
    const presentation = createProductionPresentation(presentationSurface, atlasTexture)
    const beforeDraw = makeBeforeDraw(presentation, () => frameState.latestFrame, () => frameState.activeDimension)
    const { particles: _particles, ...rendererOptions } = options
    const renderer = yield* makeWorldRenderer(three, canvas, viewport, {
      ...rendererOptions,
      applyMaterialEnvironment: (environment) => {
        applyChunkShaderEnvironment(chunkMaterials.opaque.uniforms, environment)
        applyChunkShaderEnvironment(chunkMaterials.cutout.uniforms, environment)
        applyChunkShaderEnvironment(chunkMaterials.transparent.uniforms, environment)
        const sun = water.uniforms['uSunIntensity']
        if (sun) {sun.value = environment.sunIntensity}
      },
      beforeDraw,
      cutoutMaterial: () => chunkMaterials.cutout.material,
      material: () => chunkMaterials.opaque.material,
      transparentMaterial: () => chunkMaterials.transparent.material,
    })
    yield* renderer.attachSceneObject(particles.mesh).pipe(
      Effect.andThen(attachPresentation(renderer, presentation)),
    )

    const advanceParticleFrame = (frame: ProductionFrame) => Effect.gen(function* advanceParticleFrameEffect() {
      frameState.activeDimension = frame.dimension ?? frameState.activeDimension
      const entities = yield* renderer.entitySnapshot
      frameState.particleFrame = {
        dimension: frameState.activeDimension,
        entities: entities.map(({ feetPosition, id }) => ({ feetPosition, id })),
      }
      yield* Effect.fromResult(advanceParticles(particlePool, frame.deltaSecs, frameState.particleFrame))
    })

    return {
      ...renderer,
      advanceFrame: (frame: ProductionFrame) => Effect.gen(function* advanceProductionFrame() {
        const animationSecs = yield* Effect.fromResult(animationTimeSeconds(frame))
        frameState.latestFrame = frame
        yield* advanceParticleFrame(frame)
        applyChunkShaderTime(Object.values(chunkMaterials), animationSecs)
        applyWaterFrameUniforms(water.uniforms, animationSecs, frame.cameraPosition)
        applyWaterFrameUniforms(chunkMaterials.transparent.uniforms, animationSecs, frame.cameraPosition)
      }).pipe(Effect.andThen(particles.sync)),
      chunkMaterial: chunkMaterials.opaque.material,
      dispose: detachPresentation(renderer, presentation).pipe(
        Effect.andThen(renderer.detachSceneObject(particles.mesh)),
        Effect.andThen(renderer.dispose),
        Effect.andThen(particles.dispose),
        Effect.andThen(Effect.sync(() => disposePresentation(presentation))),
        Effect.andThen(Effect.sync(() => water.material.dispose())),
      ),
      particlePool,
      particleService,
      particles,
      resize: (width: number, height: number) => renderer.resize(width, height).pipe(Effect.tap(() => Effect.sync(() => {
        const resolution = water.uniforms['uResolution']
        const transparentResolution = chunkMaterials.transparent.uniforms['uResolution']
        if (resolution) {resolution.value = [width, height]}
        if (transparentResolution) {transparentResolution.value = [width, height]}
      }))),
      setEnvironment: (environment: RenderEnvironmentPlan) => renderer.setEnvironment(environment).pipe(
        Effect.tap(() => Effect.sync(() => { frameState.activeDimension = environment.dimension })),
      ),
      waterMaterial: water.material,
      waterUniforms: water.uniforms,
    }
  })
  return buildRenderer.pipe(Effect.provide(ParticleServiceLive({
    pool: options.particles,
    renderContext: () => frameState.particleFrame,
  })))
}
// oxlint-enable max-params
