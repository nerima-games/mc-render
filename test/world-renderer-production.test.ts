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
import * as THREE from 'three'
import { mirroredCameraState } from '../src/domain/camera-mirror'
import type { AnimationClockInputError } from '../src/domain/animation-clock'
import { ParticleRequestSchema } from '../src/application/particle-service'
import { makeProductionWorldRenderer, type ProductionFrame } from '../src/application/world-renderer-production'
import { chunkKeyOf } from '../src/application/world-sync'
import {
  applyChunkShaderEnvironment,
  makeChunkShaderMaterial,
  makeWaterMaterial,
  RendererMaterialPolicyErrorSchema,
} from '../src/application/world-renderer-materials'
import {
  ParticlePoolInputErrorSchema,
  ParticleBurstCountSchema,
  ParticleDeltaSecsSchema,
  type ParticlePoolInputError,
  ParticleUvCoordinateSchema,
  ParticleWorldCoordinateSchema,
  readSlot,
  spawnBurst as spawnBurstResult,
} from '../src/domain/particle-pool'
import { planRenderEnvironment } from '../src/domain/render-environment'
import { buildChunkGeometry, type MeshQuad } from '../src/domain/chunk-geometry'
import {
  FAKE_CANVAS,
  makeFakeThree,
  type FakeCanvas,
  type FakeGeometry,
  type FakeInstancedGeometry,
  type FakeMaterial,
  type FakeShaderMaterial,
} from './support/fake-three'
import { makeAnimationClockInput } from './support/animation-clock'
import { blockId, chunkCoord } from './support/kernel-brands'

const VIEWPORT = { width: 1280, height: 720 }
const presentationSurface = {
  ...THREE,
  BufferGeometry: class extends THREE.BufferGeometry<THREE.NormalBufferAttributes> {},
}
const quad = (): MeshQuad => ({
  ao: 0,
  blockId: blockId(1),
  direction: 'yPos',
  height: 1,
  lx: 0,
  lz: 0,
  role: 'top',
  width: 1,
  y: 0,
})
const decodePosition = Schema.decodeUnknownSync(ParticleWorldCoordinateSchema)
const decodeUv = Schema.decodeUnknownSync(ParticleUvCoordinateSchema)
const decodeCount = Schema.decodeUnknownSync(ParticleBurstCountSchema)
const decodeDelta = Schema.decodeUnknownSync(ParticleDeltaSecsSchema)
const chunkTimeUniforms = (three: ReturnType<typeof makeFakeThree>): ReadonlyArray<unknown> => three.shaderMaterials()
  .filter(({ uniforms }) => uniforms['uAlphaTest'] !== undefined)
  .map(({ uniforms }) => uniforms['uTime']?.value)
const findChunkMaterials = (three: ReturnType<typeof makeFakeThree>) => {
  const shaderMaterials = three.shaderMaterials()
  const cutoutMaterial = shaderMaterials.find(({ uniforms }) => uniforms['uAlphaTest']?.value === 0.1)
  const transparentSolidMaterial = shaderMaterials.find(({ transparent, uniforms }) =>
    transparent === true && uniforms['uAlphaTest']?.value === 0,
  )
  if (cutoutMaterial === undefined || transparentSolidMaterial === undefined) {
    throw new Error('the production renderer must build cutout and blended chunk materials')
  }
  return { cutoutMaterial, transparentSolidMaterial }
}
const advanceFrameWithRawInput = (
  advanceFrame: (frame: ProductionFrame) => Effect.Effect<void, ParticlePoolInputError | AnimationClockInputError>,
  frame: unknown,
): Effect.Effect<void, ParticlePoolInputError | AnimationClockInputError> =>
  Function.prototype.apply.call(advanceFrame, undefined, [frame])
const spawnBurst = (pool: Parameters<typeof spawnBurstResult>[0], x: number, y: number, z: number, u: number, v: number, count: number) =>
  Result.getOrThrow(spawnBurstResult(
    pool,
    decodePosition(x),
    decodePosition(y),
    decodePosition(z),
    decodeUv(u),
    decodeUv(v),
    decodeCount(count),
  ))
const isParticlePoolInputFailure = (
  error: unknown,
  operation: 'pool' | 'advance',
  reason: 'invalid-capacity' | 'invalid-delta',
): boolean => {
  const decoded = Schema.decodeUnknownResult(ParticlePoolInputErrorSchema, {
    onExcessProperty: 'error',
  })(error)
  return Result.isSuccess(decoded) && decoded.success.operation === operation &&
    decoded.success.reason === reason
}

describe('makeProductionWorldRenderer (the shipped composition)', () => {
  it.effect('uses the layer service pool for both accepted requests and rendered instances', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeProductionWorldRenderer(
        three,
        FAKE_CANVAS,
        VIEWPORT,
        { isTexture: true },
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
        { isTexture: true },
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
        ...makeAnimationClockInput(0, 0, 0),
        deltaSecs: decodeDelta(0),
        cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
      })
      expect(yield* renderer.particleService.spawn(request)).toBe(1)

      yield* renderer.syncEntities([{ id: 'mob-1', kind: 'zombie', feetPosition: { x: 11, y: 21, z: 31 } }])
      yield* renderer.advanceFrame({
        ...makeAnimationClockInput(2, 0, 2),
        deltaSecs: decodeDelta(0.1),
        cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
      })
      expect(readSlot(renderer.particlePool, 0)).toMatchObject({
        positionX: 13,
        positionY: 23,
        positionZ: 33,
      })

      yield* renderer.advanceFrame({
        ...makeAnimationClockInput(4, 0, 4),
        deltaSecs: decodeDelta(0.1),
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
      const atlas = { isTexture: true as const }
      const renderer = yield* makeProductionWorldRenderer(three, FAKE_CANVAS, VIEWPORT, atlas, {
        particles: { capacity: 4 },
      })

      expect(three.materials()).toHaveLength(0)
      expect(three.shaderMaterials()).toHaveLength(5)
      const { cutoutMaterial, transparentSolidMaterial } = findChunkMaterials(three)
      expect(renderer.chunkMaterial.uniforms['uAtlas']?.value).toBe(atlas)
      expect(cutoutMaterial.alphaTest).toBe(0.1)
      expect(cutoutMaterial.uniforms['uAlphaTest']?.value).toBe(0.1)
      expect(cutoutMaterial.transparent).toBe(false)
      expect(transparentSolidMaterial.transparent).toBe(true)
      expect(transparentSolidMaterial.depthWrite).toBe(false)
      expect(transparentSolidMaterial.uniforms['uAlphaTest']?.value).toBe(0)
      expect(renderer.waterMaterial.transparent).toBe(true)
      expect(renderer.waterMaterial.depthWrite).toBe(false)
      expect(renderer.waterMaterial.forceSinglePass).toBe(true)
      expect(three.shaderMaterials()[4]?.uniforms['uAtlas']?.value).toBe(atlas)
      expect(three.scene().members()).toContain(renderer.particles.mesh)

      const fluidBuffers = buildChunkGeometry([quad()])
      yield* renderer.setChunks([{
        buffers: buildChunkGeometry([]),
        key: chunkKeyOf(chunkCoord(0, 0)),
        transparentSolidBuffers: fluidBuffers,
        waterBuffers: fluidBuffers,
      }])
      const translucentMeshes = three.meshes().filter(({ material }) =>
        material === transparentSolidMaterial,
      )
      expect(translucentMeshes.map(({ material }) => material)).toStrictEqual([transparentSolidMaterial])
      expect(translucentMeshes[0]?.renderOrder).toBe(0)

      yield* renderer.setEnvironment(planRenderEnvironment(0.25))
      expect(renderer.chunkMaterial.uniforms['uSunIntensity']?.value).toBeCloseTo(0.25)
      expect(cutoutMaterial.uniforms['uSunIntensity']?.value).toBeCloseTo(0.25)
      expect(transparentSolidMaterial.uniforms['uSunIntensity']?.value).toBeCloseTo(0.25)
      expect(renderer.waterUniforms['uSunIntensity']?.value).toBeCloseTo(0.25)

      spawnBurst(renderer.particlePool, 1, 2, 3, 0, 0, 1)
      yield* renderer.advanceFrame({
        ...makeAnimationClockInput(40, 0, 6000),
        deltaSecs: decodeDelta(0.1),
        cameraPosition: { worldX: 4, worldY: 5, worldZ: 6 },
      })
      expect(renderer.waterUniforms['uTime']?.value).toBe(2)
      expect(transparentSolidMaterial.uniforms['uTime']?.value).toBe(2)
      expect(chunkTimeUniforms(three)).toStrictEqual([2, 2, 2])
      expect(renderer.waterUniforms['uCameraPosition']?.value).toStrictEqual([4, 5, 6])
      expect(transparentSolidMaterial.uniforms['uCameraPosition']?.value).toStrictEqual([4, 5, 6])
      expect(three.instancedGeometries()[0]?.instanceCount).toBe(1)

      const pausedChunkTimes = chunkTimeUniforms(three)
      yield* renderer.advanceFrame({
        ...makeAnimationClockInput(40, 0, 6000),
        deltaSecs: decodeDelta(0.1),
        cameraPosition: { worldX: 4, worldY: 5, worldZ: 6 },
      })
      expect(chunkTimeUniforms(three)).toStrictEqual(pausedChunkTimes)
      expect(renderer.waterUniforms['uTime']?.value).toBe(2)

      yield* renderer.resize(640, 360)
      expect(renderer.waterUniforms['uResolution']?.value).toStrictEqual([640, 360])
      expect(transparentSolidMaterial.uniforms['uResolution']?.value).toStrictEqual([640, 360])

      delete renderer.waterUniforms['uResolution']
      delete transparentSolidMaterial.uniforms['uResolution']
      yield* renderer.resize(320, 180)
      expect(renderer.waterUniforms['uResolution']).toBeUndefined()
      expect(transparentSolidMaterial.uniforms['uResolution']).toBeUndefined()

      yield* renderer.dispose
      expect(three.scene().members()).toStrictEqual([])
      expect(three.shaderMaterials().every((material) => material.disposed())).toBe(true)
      expect(three.renderer().disposed()).toBe(true)
    }),
  )

  it.effect('updates and draws sky and interaction visuals on each production frame', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const atlas = new THREE.Texture()
      const renderer = yield* makeProductionWorldRenderer<
        FakeCanvas,
        FakeGeometry,
        FakeMaterial,
        FakeInstancedGeometry,
        FakeShaderMaterial,
        THREE.Texture,
        THREE.BufferGeometry<THREE.NormalBufferAttributes>,
        THREE.MeshBasicMaterial,
        THREE.LineBasicMaterial,
        THREE.PointsMaterial
      >(
        three,
        FAKE_CANVAS,
        VIEWPORT,
        atlas,
        { particles: { capacity: 2 } },
        presentationSurface,
      )
      const interactionFrame = (targetX: number, miningProgress: number, damageIntensity: number) => ({
        action: 'mine' as const,
        actionProgress: miningProgress,
        damageDirection: { x: 1, y: 0 },
        damageIntensity,
        gaitPhaseRadians: 0.5,
        heldItem: { kind: 'block' as const, tileIndex: 1 },
        miningProgress,
        movementIntensity: 0.5,
        reducedMotion: false,
        target: {
          position: { x: targetX, y: 64, z: 0 },
          shape: { boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }] },
        },
      })
      const frame = (simulationTick: number, timeOfDayTicks: number, targetX: number, progress: number, damage: number) => ({
        ...makeAnimationClockInput(simulationTick, 0, timeOfDayTicks),
        deltaSecs: decodeDelta(0.1),
        cameraPosition: { worldX: 0, worldY: 64, worldZ: 0 },
        interaction: interactionFrame(targetX, progress, damage),
      })

      yield* renderer.draw(mirroredCameraState(undefined))
      expect(three.renderer().renderCalls()).toBe(1)

      yield* renderer.advanceFrame(frame(2_000, 6_000, 3, 0.2, 0))
      yield* renderer.draw(mirroredCameraState(undefined))

      const scene = three.scene()
      const sky = scene.members().find((object): object is THREE.Group =>
        object instanceof THREE.Group && object.children.length === 7,
      )
      const interaction = scene.members().find((object): object is THREE.Group =>
        object instanceof THREE.Group && object.children.length === 2,
      )
      expect(sky).toBeDefined()
      expect(interaction).toBeDefined()
      if (!sky || !interaction) {
        yield* renderer.dispose
        atlas.dispose()
        return
      }

      const [, , sun, , stars, nearCloud] = sky.children
      expect(sun?.position.y).toBeCloseTo(160)
      expect(stars?.visible).toBe(false)
      const firstCloudOffset = nearCloud?.position.x

      const [selection, cracks] = interaction.children
      if (!(selection instanceof THREE.LineSegments) || !(cracks instanceof THREE.LineSegments)) {
        yield* renderer.dispose
        atlas.dispose()
        throw new Error('expected production interaction meshes to be line segments')
      }
      const selectionFirstX = selection.geometry.getAttribute('position').getX(0)
      const firstCrackVertexCount = cracks.geometry.getAttribute('position').count

      const cameraOverlay = three.cameras()[0]?.cameraObjects()[0]
      expect(cameraOverlay).toBeInstanceOf(THREE.Group)
      if (!(cameraOverlay instanceof THREE.Group)) {
        yield* renderer.dispose
        atlas.dispose()
        return
      }
      const [hand] = cameraOverlay.children
      expect(hand).toBeInstanceOf(THREE.Group)
      if (!(hand instanceof THREE.Group)) {
        yield* renderer.dispose
        atlas.dispose()
        return
      }
      const [arm, heldBlock] = hand.children
      expect(arm).toBeInstanceOf(THREE.Mesh)
      expect(heldBlock).toBeInstanceOf(THREE.Mesh)
      if (!(arm instanceof THREE.Mesh) || !(heldBlock instanceof THREE.Mesh)) {
        yield* renderer.dispose
        atlas.dispose()
        return
      }
      expect((arm.material as THREE.MeshBasicMaterial).map?.isTexture).toBe(true)
      expect((heldBlock.material as THREE.MeshBasicMaterial).map).toBe(atlas)

      yield* renderer.advanceFrame(frame(2_200, 18_000, 5, 0.8, 1))
      yield* renderer.draw(mirroredCameraState(undefined))

      expect(three.renderer().renderCalls()).toBe(3)
      expect(sun?.position.y).toBeCloseTo(-160)
      expect(stars?.visible).toBe(true)
      expect(nearCloud?.position.x).not.toBe(firstCloudOffset)
      const [updatedSelection, updatedCracks] = interaction.children
      expect(updatedSelection).toBeInstanceOf(THREE.LineSegments)
      expect(updatedCracks).toBeInstanceOf(THREE.LineSegments)
      if (!(updatedSelection instanceof THREE.LineSegments) || !(updatedCracks instanceof THREE.LineSegments)) {
        yield* renderer.dispose
        atlas.dispose()
        throw new Error('expected updated production interaction meshes to be line segments')
      }
      expect(updatedSelection.geometry.getAttribute('position').getX(0)).not.toBe(selectionFirstX)
      expect(updatedCracks.geometry.getAttribute('position').count).toBeGreaterThan(firstCrackVertexCount)
      expect(cameraOverlay.children[1]?.visible).toBe(true)

      yield* renderer.dispose
      atlas.dispose()
    }),
  )

  it.effect('tolerates optional water uniforms being absent', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeProductionWorldRenderer(
        three,
        FAKE_CANVAS,
        VIEWPORT,
        { isTexture: true },
        { particles: { capacity: 1 } },
      )

      delete renderer.waterUniforms['uSunIntensity']
      delete renderer.waterUniforms['uTime']
      delete renderer.waterUniforms['uCameraPosition']
      delete renderer.waterUniforms['uResolution']
      const chunkMaterials = three.shaderMaterials().filter(({ uniforms }) => uniforms['uAlphaTest'] !== undefined)
      for (const { uniforms } of chunkMaterials) {
        delete uniforms['uTime']
      }

      applyChunkShaderEnvironment({}, planRenderEnvironment(0.5))
      yield* renderer.setEnvironment(planRenderEnvironment(0.5))
      yield* renderer.advanceFrame({
        ...makeAnimationClockInput(20, 0, 1200),
        deltaSecs: decodeDelta(0.01),
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
          makeProductionWorldRenderer(badThree, FAKE_CANVAS, VIEWPORT, { isTexture: true }),
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

  it.effect('propagates invalid pool configuration and frame delta as typed Effect failures', () =>
    Effect.gen(function* () {
      const invalidPoolResult = yield* Effect.result(makeProductionWorldRenderer(
        makeFakeThree(),
        FAKE_CANVAS,
        VIEWPORT,
        { isTexture: true },
        { particles: { capacity: 0 } },
      ))
      expect(Result.isFailure(invalidPoolResult)).toBe(true)
      if (Result.isFailure(invalidPoolResult)) {
        expect(isParticlePoolInputFailure(invalidPoolResult.failure, 'pool', 'invalid-capacity')).toBe(true)
      }

      const renderer = yield* makeProductionWorldRenderer(
        makeFakeThree(),
        FAKE_CANVAS,
        VIEWPORT,
        { isTexture: true },
        { particles: { capacity: 2 } },
      )
      const invalidStepResult = yield* Effect.result(advanceFrameWithRawInput(renderer.advanceFrame, {
        simulationTick: 20,
        partialTick: 0,
        timeOfDayTicks: 1200,
        deltaSecs: -0.01,
        cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
      }))
      expect(Result.isFailure(invalidStepResult)).toBe(true)
      if (Result.isFailure(invalidStepResult)) {
        expect(isParticlePoolInputFailure(invalidStepResult.failure, 'advance', 'invalid-delta')).toBe(true)
      }
      expect(renderer.waterUniforms['uTime']?.value).toBe(0)
      yield* renderer.dispose
    }),
  )

  it.effect('rejects invalid simulation clock input before particle or animation uniform writes', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeProductionWorldRenderer(three, FAKE_CANVAS, VIEWPORT, { isTexture: true }, {
        particles: { capacity: 2 },
      })
      spawnBurst(renderer.particlePool, 1, 2, 3, 0, 0, 1)
      const initialParticle = readSlot(renderer.particlePool, 0)
      const animationTimes = (): ReadonlyArray<unknown> => [
        ...three.shaderMaterials()
          .filter(({ uniforms }) => uniforms['uAlphaTest'] !== undefined)
          .map(({ uniforms }) => uniforms['uTime']?.value),
        renderer.waterUniforms['uTime']?.value,
      ]
      const initialTimes = animationTimes()

      for (const [simulationTick, partialTick, timeOfDayTicks, reason] of [
        [-1, 0, 0, 'invalid-simulation-tick'],
        [Number.NaN, 0, 0, 'invalid-simulation-tick'],
        [1, Number.NaN, 0, 'invalid-partial-tick'],
        [1, 1, 0, 'invalid-partial-tick'],
        [1, 0, 24_000, 'invalid-time-of-day-ticks'],
      ] as const) {
        const result = yield* Effect.result(advanceFrameWithRawInput(renderer.advanceFrame, {
          simulationTick,
          partialTick,
          timeOfDayTicks,
          deltaSecs: decodeDelta(0.1),
          cameraPosition: { worldX: 0, worldY: 0, worldZ: 0 },
        }))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure).toStrictEqual({ _tag: 'AnimationClockInputError', reason })
        }
        expect(readSlot(renderer.particlePool, 0)).toStrictEqual(initialParticle)
        expect(animationTimes()).toStrictEqual(initialTimes)
      }

      yield* renderer.dispose
    }),
  )
})
