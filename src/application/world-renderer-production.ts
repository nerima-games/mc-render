import {
  type AnimationClockInput,
  type AnimationClockInputError,
  animationTimeSeconds,
} from '../domain/animation-clock.js'
import {
  DEFAULT_DIMENSION,
  type RenderEnvironmentPlan,
} from '../domain/render-environment.js'
import { type DeltaTimeSecs, type Dimension } from '@nerima-games/mc-kernel'
import {
  type ParticleFrameSnapshot,
  type ParticlePool,
  type ParticlePoolInputError,
  type ParticlePoolOptions,
  advanceParticles,
} from '../domain/particle-pool.js'
import { ParticleService, ParticleServiceLive, ParticleServicePoolAccess } from './particle-service.js'
import { type ParticleSystem, makeParticleSystem } from './particle-system.js'
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
import { Effect } from 'effect'
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

export type ProductionFrame = AnimationClockInput & {
  readonly deltaSecs: DeltaTimeSecs
  readonly cameraPosition: Readonly<{ worldX: number; worldY: number; worldZ: number }>
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
  'material' | 'cutoutMaterial' | 'transparentMaterial' | 'applyMaterialEnvironment'
> & {
  readonly particles?: ParticlePoolOptions
}

// oxlint-disable max-params -- The public factory keeps its structural inputs explicit.
export const makeProductionWorldRenderer = <
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
  TInstancedGeometry extends ThreeInstancedBufferGeometry,
  TShaderMaterial extends ThreeMaterial,
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
  atlasTexture: unknown,
  options: ProductionWorldRendererOptions = {},
): Effect.Effect<
  ProductionWorldRenderer<TShaderMaterial>,
  RendererMaterialPolicyError | ParticlePoolInputError
> => {
  let activeDimension = options.dimension ?? DEFAULT_DIMENSION
  let particleFrame: ParticleFrameSnapshot = { dimension: activeDimension, entities: [] }
  const buildRenderer = Effect.gen(function* buildProductionRenderer() {
    const chunkMaterials = {
      cutout: makeChunkShaderMaterialVariant({ atlasTexture, three, variant: 'cutout' }),
      opaque: makeChunkShaderMaterial(three, atlasTexture),
      transparent: makeTranslucentChunkMaterial({ atlasTexture, three, viewport }),
    }
    const water = makeWaterMaterial(three, viewport)
    const particleService = yield* ParticleService
    const particlePool = yield* ParticleServicePoolAccess
    const particles = yield* makeParticleSystem(three, particlePool, atlasTexture).pipe(
      Effect.tap((particleSystem) => Effect.fromResult(assertRendererMaterialPolicies(water.material, particleSystem.material))),
    )
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
      cutoutMaterial: () => chunkMaterials.cutout.material,
      material: () => chunkMaterials.opaque.material,
      transparentMaterial: () => chunkMaterials.transparent.material,
    })
    yield* renderer.attachSceneObject(particles.mesh)

    const advanceParticleFrame = (frame: ProductionFrame) => Effect.gen(function* advanceParticleFrameEffect() {
      activeDimension = frame.dimension ?? activeDimension
      const entities = yield* renderer.entitySnapshot
      particleFrame = {
        dimension: activeDimension,
        entities: entities.map(({ feetPosition, id }) => ({ feetPosition, id })),
      }
      yield* Effect.fromResult(advanceParticles(particlePool, frame.deltaSecs, particleFrame))
    })

    return {
      ...renderer,
      advanceFrame: (frame: ProductionFrame) => Effect.gen(function* advanceProductionFrame() {
        const animationSecs = yield* Effect.fromResult(animationTimeSeconds(frame))
        yield* advanceParticleFrame(frame)
        applyChunkShaderTime(Object.values(chunkMaterials), animationSecs)
        applyWaterFrameUniforms(water.uniforms, animationSecs, frame.cameraPosition)
        applyWaterFrameUniforms(chunkMaterials.transparent.uniforms, animationSecs, frame.cameraPosition)
      }).pipe(Effect.andThen(particles.sync)),
      chunkMaterial: chunkMaterials.opaque.material,
      dispose: renderer.detachSceneObject(particles.mesh).pipe(
        Effect.andThen(renderer.dispose),
        Effect.andThen(particles.dispose),
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
        Effect.tap(() => Effect.sync(() => { activeDimension = environment.dimension })),
      ),
      waterMaterial: water.material,
      waterUniforms: water.uniforms,
    }
  })
  return buildRenderer.pipe(Effect.provide(ParticleServiceLive({
    pool: options.particles,
    renderContext: () => particleFrame,
  })))
}
// oxlint-enable max-params
