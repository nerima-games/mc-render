/**
 * `application/world-renderer-production.ts` — the shipped composition, against
 * a fake `three`.
 *
 * This is the version `src/browser.ts` actually imports and hands to a real
 * canvas. It differs from the `makeProductionWorldRenderer` re-exported from
 * `application/world-renderer.ts` (and therefore from `src/index.ts`) by one
 * call: `assertRendererMaterialPolicies(water.material, particles.material)`,
 * right after the particle system is built. See the test below for that call
 * actually running on this path.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { ParticleRequestSchema } from '../src/application/particle-service'
import { makeProductionWorldRenderer } from '../src/application/world-renderer-production'
import {
  applyChunkShaderEnvironment,
  makeChunkShaderMaterial,
  makeWaterMaterial,
  RendererMaterialPolicyErrorSchema,
} from '../src/application/world-renderer-materials'
import { readSlot, spawnBurst } from '../src/domain/particle-pool'
import { planRenderEnvironment } from '../src/domain/render-environment'
import { FAKE_CANVAS, makeFakeThree } from './support/fake-three'

const VIEWPORT = { width: 1280, height: 720 }

describe('makeProductionWorldRenderer (the shipped composition)', () => {
  it.effect('uses the layer service pool for both accepted requests and rendered instances', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeProductionWorldRenderer(
        three,
        FAKE_CANVAS,
        VIEWPORT,
        { name: 'terrain-atlas' },
        { particles: { capacity: 4 } },
      )
      const request = Schema.decodeUnknownSync(ParticleRequestSchema)({
        kind: 'block-break',
        position: { dimension: 'overworld', x: 1, y: 2, z: 3 },
      })

      expect(yield* renderer.particleService.spawn(request)).toBe(1)
      expect(renderer.particlePool.activeCount()).toBe(4)
      yield* renderer.particles.sync
      expect(yield* renderer.particles.drawnInstances).toBe(4)
      expect(three.instancedGeometries()[0]?.instanceCount).toBe(4)

      yield* renderer.dispose
    }),
  )

  it.effect('resolves followed entities from the renderer snapshot and the current frame dimension', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeProductionWorldRenderer(
        three,
        FAKE_CANVAS,
        VIEWPORT,
        { name: 'terrain-atlas' },
        { particles: { capacity: 8 } },
      )
      const request = Schema.decodeUnknownSync(ParticleRequestSchema)({
        kind: 'entity-hit',
        position: { dimension: 'overworld', x: 12, y: 22, z: 32 },
        direction: { x: 1, y: 0, z: 0 },
        followEntity: 'mob-1',
      })

      yield* renderer.syncEntities([{ id: 'mob-1', kind: 'zombie', feetPosition: { x: 10, y: 20, z: 30 } }])
      yield* renderer.advanceFrame({
        elapsedSecs: 0,
        deltaSecs: 0,
        cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
      })
      expect(yield* renderer.particleService.spawn(request)).toBe(1)

      yield* renderer.syncEntities([{ id: 'mob-1', kind: 'zombie', feetPosition: { x: 11, y: 21, z: 31 } }])
      yield* renderer.advanceFrame({
        elapsedSecs: 0.1,
        deltaSecs: 0.1,
        cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
      })
      expect(readSlot(renderer.particlePool, 0)).toMatchObject({
        positionX: 13,
        positionY: 23,
        positionZ: 33,
      })

      yield* renderer.advanceFrame({
        elapsedSecs: 0.2,
        deltaSecs: 0.1,
        cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
        dimension: 'nether',
      })
      expect(readSlot(renderer.particlePool, 0)?.positionX).toBe(13)
      expect(readSlot(renderer.particlePool, 0)?.scale).toBe(0)
      expect(yield* renderer.particles.drawnInstances).toBe(0)

      yield* renderer.dispose
    }),
  )

  it.effect('owns the atlas shaders, animated water, and shared particle system', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const atlas = { name: 'terrain-atlas' }
      const renderer = yield* makeProductionWorldRenderer(three, FAKE_CANVAS, VIEWPORT, atlas, {
        particles: { capacity: 4 },
      })

      expect(three.materials()).toHaveLength(0)
      expect(three.shaderMaterials()).toHaveLength(3)
      expect(renderer.chunkMaterial.uniforms['uAtlas']?.value).toBe(atlas)
      expect(renderer.waterMaterial.transparent).toBe(true)
      expect(renderer.waterMaterial.depthWrite).toBe(false)
      expect(renderer.waterMaterial.forceSinglePass).toBe(true)
      expect(three.shaderMaterials()[2]?.uniforms['uAtlas']?.value).toBe(atlas)
      expect(three.scene().members()).toContain(renderer.particles.mesh)

      yield* renderer.setEnvironment(planRenderEnvironment(0.25))
      expect(renderer.chunkMaterial.uniforms['uSunIntensity']?.value).toBeCloseTo(0.25)
      expect(renderer.waterUniforms['uSunIntensity']?.value).toBeCloseTo(0.25)

      spawnBurst(renderer.particlePool, 1, 2, 3, 0, 0, 1)
      yield* renderer.advanceFrame({
        elapsedSecs: 2,
        deltaSecs: 0.1,
        cameraPosition: { worldX: 4, worldY: 5, worldZ: 6 },
      })
      expect(renderer.waterUniforms['uTime']?.value).toBe(2)
      expect(renderer.waterUniforms['uCameraPosition']?.value).toStrictEqual([4, 5, 6])
      expect(three.instancedGeometries()[0]?.instanceCount).toBe(1)

      yield* renderer.resize(640, 360)
      expect(renderer.waterUniforms['uResolution']?.value).toStrictEqual([640, 360])

      yield* renderer.dispose
      expect(three.scene().members()).toStrictEqual([])
      expect(three.shaderMaterials().every((material) => material.disposed())).toBe(true)
      expect(three.renderer().disposed()).toBe(true)
    }),
  )

  it.effect('tolerates optional water uniforms being absent', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeProductionWorldRenderer(
        three,
        FAKE_CANVAS,
        VIEWPORT,
        { name: 'terrain-atlas' },
        { particles: { capacity: 1 } },
      )

      delete renderer.waterUniforms['uSunIntensity']
      delete renderer.waterUniforms['uTime']
      delete renderer.waterUniforms['uCameraPosition']
      delete renderer.waterUniforms['uResolution']

      applyChunkShaderEnvironment({}, planRenderEnvironment(0.5))
      yield* renderer.setEnvironment(planRenderEnvironment(0.5))
      yield* renderer.advanceFrame({
        elapsedSecs: 1,
        deltaSecs: 0.01,
        cameraPosition: { worldX: 1, worldY: 2, worldZ: 3 },
      })
      yield* renderer.resize(320, 200)
      yield* renderer.dispose
    }),
  )

  it.effect(
    'REGRESSION: returns a typed failure if shared materials lost forceSinglePass',
    () =>
      Effect.gen(function* () {
        // The one call `makeProductionWorldRenderer` makes that the duplicate
        // exported from `application/world-renderer.ts` does not:
        // `assertRendererMaterialPolicies`. A `three` whose `ShaderMaterial`
        // never sets `forceSinglePass` reproduces the real regression this
        // guards — see `domain/material-policy.ts`.
        const three = makeFakeThree()
        const badThree = {
          ...three,
          ShaderMaterial: class extends three.ShaderMaterial {
            constructor(parameters: ConstructorParameters<typeof three.ShaderMaterial>[0]) {
              super({ ...parameters, forceSinglePass: false })
            }
          },
        }

        const outcome = yield* Effect.result(
          makeProductionWorldRenderer(badThree, FAKE_CANVAS, VIEWPORT, { name: 'terrain-atlas' }),
        )

        expect(Result.isFailure(outcome)).toBe(true)
        if (Result.isFailure(outcome)) {
          const decoded = Schema.decodeUnknownSync(RendererMaterialPolicyErrorSchema, {
            onExcessProperty: 'error',
          })(outcome.failure)
          expect(decoded._tag).toBe('RendererMaterialPolicyError')
          expect(decoded.violations.map(({ materialName }) => materialName)).toStrictEqual([
            'waterSurfaceMaterial',
            'particleMaterial',
          ])
          expect(decoded.violations.every(({ verdict }) => verdict.kind === 'must-force-single-pass')).toBe(true)
        }
      }),
  )
})

describe('makeChunkShaderMaterial and makeWaterMaterial default sun intensity', () => {
  it.effect('makeChunkShaderMaterial defaults sunIntensity to FULL_SUN_INTENSITY', () =>
    Effect.sync(() => {
      const three = makeFakeThree()
      const defaulted = makeChunkShaderMaterial(three, { name: 'atlas' })
      const explicit = makeChunkShaderMaterial(three, { name: 'atlas' }, 0.5)

      expect(defaulted.uniforms['uSunIntensity']?.value).toBe(1)
      expect(explicit.uniforms['uSunIntensity']?.value).toBe(0.5)
    }),
  )

  it.effect('makeWaterMaterial defaults sunIntensity to FULL_SUN_INTENSITY', () =>
    Effect.sync(() => {
      const three = makeFakeThree()
      const defaulted = makeWaterMaterial(three, VIEWPORT)
      const explicit = makeWaterMaterial(three, VIEWPORT, 0.5)

      expect(defaulted.uniforms['uSunIntensity']?.value).toBe(1)
      expect(explicit.uniforms['uSunIntensity']?.value).toBe(0.5)
    }),
  )
})
