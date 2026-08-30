/**
 * Production renderer composition.
 *
 * The base renderer owns the platform-neutral scene protocol. This module
 * assembles the atlas shader, animated water and instanced particles that a
 * browser-facing world uses on top of that protocol.
 */
import { type ParticlePool, type ParticlePoolOptions, advanceParticles, makeParticlePool } from '../domain/particle-pool.js'
import { type ParticleSystem, makeParticleSystem } from './particle-system.js'
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
  type Viewport,
  applyChunkShaderEnvironment,
  assertRendererMaterialPolicies,
  makeChunkShaderMaterial,
  makeWaterMaterial,
} from './world-renderer-materials.js'
import {
  type WorldRenderer,
  type WorldRendererOptions,
  makeWorldRenderer,
} from './world-renderer.js'
import { Effect } from 'effect'

type TransformableThreeMesh = ThreeMesh & {
  readonly position: ThreeVector3
  readonly rotation: ThreeEuler
  readonly scale: ThreeVector3
}

export type ProductionFrame = {
  readonly elapsedSecs: number
  readonly deltaSecs: number
  readonly cameraPosition: Readonly<{ worldX: number; worldY: number; worldZ: number }>
}

export type ProductionWorldRenderer<TShaderMaterial extends ThreeMaterial> = WorldRenderer & {
  readonly chunkMaterial: TShaderMaterial
  readonly waterMaterial: TShaderMaterial
  readonly waterUniforms: Record<string, ThreeUniform>
  readonly particlePool: ParticlePool
  readonly particles: ParticleSystem<TShaderMaterial>
  readonly advanceFrame: (frame: ProductionFrame) => Effect.Effect<void>
}

export type ProductionWorldRendererOptions = Omit<
  WorldRendererOptions<ThreeMaterial>,
  'material' | 'applyMaterialEnvironment'
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
): Effect.Effect<ProductionWorldRenderer<TShaderMaterial>> =>
  Effect.gen(function* buildProductionRenderer() {
    const chunk = makeChunkShaderMaterial(three, atlasTexture)
    const water = makeWaterMaterial(three, viewport)
    const particlePool = makeParticlePool(options.particles)
    const particles = yield* makeParticleSystem(three, particlePool, atlasTexture)
    assertRendererMaterialPolicies(water.material, particles.material)
    const { particles: _particles, ...rendererOptions } = options
    const renderer = yield* makeWorldRenderer(three, canvas, viewport, {
      ...rendererOptions,
      applyMaterialEnvironment: (environment) => {
        applyChunkShaderEnvironment(chunk.uniforms, environment)
        const sun = water.uniforms['uSunIntensity']
        if (sun) {sun.value = environment.sunIntensity}
      },
      material: () => chunk.material,
    })
    yield* renderer.attachSceneObject(particles.mesh)

    return {
      ...renderer,
      advanceFrame: (frame) => Effect.sync(() => {
        advanceParticles(particlePool, frame.deltaSecs)
        const time = water.uniforms['uTime']
        const cameraPosition = water.uniforms['uCameraPosition']
        if (time) {time.value = frame.elapsedSecs}
        if (cameraPosition) {
          cameraPosition.value = [frame.cameraPosition.worldX, frame.cameraPosition.worldY, frame.cameraPosition.worldZ]
        }
      }).pipe(Effect.andThen(particles.sync)),
      chunkMaterial: chunk.material,
      dispose: renderer.detachSceneObject(particles.mesh).pipe(
        Effect.andThen(renderer.dispose),
        Effect.andThen(particles.dispose),
        Effect.andThen(Effect.sync(() => water.material.dispose())),
      ),
      particlePool,
      particles,
      resize: (width, height) => renderer.resize(width, height).pipe(Effect.tap(() => Effect.sync(() => {
        const resolution = water.uniforms['uResolution']
        if (resolution) {resolution.value = [width, height]}
      }))),
      waterMaterial: water.material,
      waterUniforms: water.uniforms,
    }
  })
// oxlint-enable max-params
