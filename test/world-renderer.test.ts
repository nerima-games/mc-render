/**
 * `application/world-renderer.ts` — the call protocol, against a fake `three`.
 *
 * READ `test/support/fake-three.ts`'s HEADER BEFORE READING ANY ASSERTION HERE.
 * It says at length what the fake stands in for (which constructors ran, with
 * which arguments, in which order) and what it does NOT (anything about a GPU:
 * context acquisition, visibility, winding, culling, buffer validity, whether
 * `dispose` freed anything). Everything in that second list is checked in
 * mc-compose's `pnpm e2e:browser` and nowhere else.
 *
 * What IS worth checking here is the part that is pure bookkeeping and is
 * therefore invisible in a browser until it has been wrong for a while:
 * geometry leaks on re-mesh, disposal on removal, and the DIRECTION of the
 * camera copy.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import { vi } from 'vitest'
import * as entityVisualPlanner from '../src/application/entity-visual-plan'
import { EntityRenderFrameInputSchema } from '../src/index'
import { ENTITY_MODEL_CATALOG } from '../src/domain/entity-model-catalog'
import { ENTITY_MODEL_TEXTURE_ATLAS } from '../src/domain/entity-model-textures.js'
import { mirroredCameraState } from '../src/domain/camera-mirror'
import type { AnimationClockInputError } from '../src/domain/animation-clock'
import {
  buildChunkGeometry,
  buildFluidGeometry,
  combineChunkGeometry,
  type ChunkGeometryBuffers,
  type FluidQuad,
  type MeshQuad,
} from '../src/domain/chunk-geometry'
import {
  BLOCK_IDS,
  blockTypeOfId,
  chunkKeyOf,
  MonotonicTimeSecs,
  RenderDistanceChunks,
  type BlockId,
  type CameraPoseSnapshot,
} from '@nerima-games/mc-kernel'
import { CHUNK_SIZE } from '@nerima-games/mc-meshing'
import { CHUNK_HEIGHT } from '@nerima-games/mc-worldgen'
import {
  applyChunkShaderEnvironment,
  CAMERA_FAR_PLANE,
  CAMERA_FOV_DEGREES,
  CAMERA_NEAR_PLANE,
  RenderDistanceCullingErrorSchema,
  decodeRenderEntities,
  makeProductionWorldRenderer,
  makeWorldRenderer,
  NO_DRAW_TARGET,
  type ProductionFrame,
  ProductionFrameElapsedSecsSchema,
  ProductionFrameInputErrorSchema,
  SKY_CLEAR_ALPHA,
  SKY_CLEAR_COLOR,
  validateProductionFrameElapsedSecs,
  type WorldRenderer,
} from '../src/application/world-renderer'
import {
  ParticleBurstCountSchema,
  ParticleDeltaSecsSchema,
  type ParticlePoolInputError,
  ParticlePoolInputErrorSchema,
  ParticleUvCoordinateSchema,
  ParticleWorldCoordinateSchema,
  readSlot,
  spawnBurst as spawnBurstResult,
} from '../src/domain/particle-pool'
import { FAKE_CANVAS, makeFakeThree, type FakeMesh } from './support/fake-three'
import { END_VOID_COLOR, planRenderEnvironment } from '../src/domain/render-environment'
import { renderEnvironmentPlan } from './support/render-environment'
import { planMobVisual } from '../src/domain/mob-visual'
import { buildPostProcessingChain, QUALITY_PRESETS } from '../src/domain/post-processing'
import { planWitherSkullVisual, planWitherVisual } from '../src/domain/wither-visual'
import { makeThreeWeatherPrecipitation } from '../src/application/three-weather-runtime'
import type { ThreeObject3D, ThreeScene } from '../src/application/three-surface'
import { angleRadians, blockId, chunkCoord, position } from './support/kernel-brands'
import { makeAnimationClockInput } from './support/animation-clock'

const requiredTestValue = <Value>(value: Value | undefined): Value => {
  if (typeof value === 'undefined') {
    throw new Error('expected a weather resource to exist')
  }
  return value
}

const readWeatherResources = (three: ReturnType<typeof makeFakeThree>) => {
  const [particleGeometry, lightningGeometry] = three.geometries()
  const [particleMesh, lightningMesh] = three.meshes()
  const particlePositionAttribute = requiredTestValue(particleGeometry?.attributes.get('position'))
  const lightningPositionAttribute = requiredTestValue(lightningGeometry?.attributes.get('position'))
  return {
    lightningGeometry: requiredTestValue(lightningGeometry),
    lightningMesh: requiredTestValue(lightningMesh),
    lightningPositionAttribute,
    particleGeometry: requiredTestValue(particleGeometry),
    particleMesh: requiredTestValue(particleMesh),
    particlePositionAttribute,
  }
}

const VIEWPORT = { width: 1280, height: 720 }
const entityColorBytes = (mesh: FakeMesh | undefined): ReadonlyArray<number> | undefined => {
  if (mesh === undefined) {
    return undefined
  }
  const attribute = mesh.geometry.attributes.get('color')
  if (attribute === undefined || !(attribute.array instanceof Uint8Array)) {
    return undefined
  }
  return Array.from(attribute.array.slice(0, 3))
}
const decodePosition = Schema.decodeUnknownSync(ParticleWorldCoordinateSchema)
const decodeUv = Schema.decodeUnknownSync(ParticleUvCoordinateSchema)
const decodeCount = Schema.decodeUnknownSync(ParticleBurstCountSchema)
const decodeDelta = Schema.decodeUnknownSync(ParticleDeltaSecsSchema)
const advanceFrameWithRawInput = (
  advanceFrame: (frame: ProductionFrame) => Effect.Effect<void, ParticlePoolInputError | AnimationClockInputError>,
  frame: unknown,
): Effect.Effect<void, ParticlePoolInputError | AnimationClockInputError> =>
  Function.prototype.apply.call(advanceFrame, undefined, [frame])
const syncEntitiesWithRawInput = (
  syncEntities: (entities: unknown) => Effect.Effect<void, Schema.SchemaError>,
  entities: unknown,
): Effect.Effect<void, Schema.SchemaError> =>
  Function.prototype.apply.call(syncEntities, undefined, [entities])
const resolvedMobPlan = (kind: string) => Result.getOrThrow(planMobVisual(kind))
const resolvedWitherPlan = (input: unknown) => Result.getOrThrow(planWitherVisual(input))
const resolvedSkullPlan = (input: unknown) => Result.getOrThrow(planWitherSkullVisual(input))
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

const blockIdForType = (blockType: string): BlockId => {
  const match = BLOCK_IDS.find((candidate) => Result.getOrThrow(blockTypeOfId(candidate)) === blockType)
  if (match === undefined) {
    throw new Error(`block type not found: ${blockType}`)
  }
  return match
}

describe('validateProductionFrameElapsedSecs', () => {
  it.effect('rejects invalid and negative time without throwing for arbitrary input', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.anything(),
          (elapsedSecs) => {
            const decoded = validateProductionFrameElapsedSecs(elapsedSecs)
            if (Result.isSuccess(decoded)) {
              expect(Result.isSuccess(Schema.decodeUnknownResult(ProductionFrameElapsedSecsSchema)(decoded.success))).toBe(true)
              return
            }

            const error = Schema.decodeUnknownResult(ProductionFrameInputErrorSchema, { onExcessProperty: 'error' })(decoded.failure)
            expect(Result.isSuccess(error)).toBe(true)
          },
        ),
        { seed: 0, numRuns: 200 },
      )

      expect(Result.isSuccess(validateProductionFrameElapsedSecs(0))).toBe(true)
      expect(Result.isSuccess(validateProductionFrameElapsedSecs(Number.MIN_VALUE))).toBe(true)
      expect(Result.isSuccess(validateProductionFrameElapsedSecs(Number.MAX_VALUE))).toBe(true)
      const numericString = validateProductionFrameElapsedSecs('1')
      expect(Result.isFailure(numericString)).toBe(true)
      if (Result.isFailure(numericString)) {
        expect(numericString.failure.reason).toBe('not-number')
      }
      const justBelowZero = validateProductionFrameElapsedSecs(-Number.MIN_VALUE)
      expect(Result.isFailure(justBelowZero)).toBe(true)
      if (Result.isFailure(justBelowZero)) {
        expect(justBelowZero.failure.reason).toBe('negative-elapsed-secs')
      }
      for (const nonFinite of [Number.NaN, Number.POSITIVE_INFINITY]) {
        const result = validateProductionFrameElapsedSecs(nonFinite)
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(result.failure.reason).toBe('non-finite-elapsed-secs')
        }
      }
    }),
  )
})

const quad = (overrides: Partial<MeshQuad> = {}): MeshQuad => ({
  blockId: blockId(1),
  direction: 'yPos',
  role: 'top',
  lx: 0,
  y: 0,
  lz: 0,
  width: 4,
  height: 3,
  ao: 0,
  ...overrides,
})

const poseAt = (x: number, y: number, z: number, yaw: number, pitch: number): CameraPoseSnapshot => ({
  position: position(x, y, z),
  yawRadians: angleRadians(yaw),
  pitchRadians: angleRadians(pitch),
  capturedAtSecs: MonotonicTimeSecs(1),
})

const setChunkWithRuntimeKey = (
  renderer: WorldRenderer,
  key: unknown,
  buffers: ChunkGeometryBuffers,
): Effect.Effect<void> => Function.prototype.apply.call(renderer.setChunk, renderer, [key, buffers])

describe('acquiring the renderer', () => {
  it.effect('constructs exactly one renderer, scene, camera and material', () =>
    Effect.gen(function* () {
      // "Exactly one" and not "at least one": plan.md §3.8 records app-scope
      // singletons among the reference's worst bug sources, and the failure
      // that produced the rule was a second world load inheriting the first
      // one's objects. A renderer that built two scenes would draw into one and
      // add meshes to the other, which looks exactly like "the mesher produced
      // nothing".
      const three = makeFakeThree()
      yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      expect(three.renderers()).toHaveLength(1)
      expect(three.scenes()).toHaveLength(1)
      expect(three.cameras()).toHaveLength(1)
      expect(three.materials()).toHaveLength(1)
    }),
  )

  it.effect('passes the transcribed WebGLRenderer parameters, canvas included', () =>
    Effect.gen(function* () {
      // ts-minecraft
      // `packages/rendering/infrastructure/renderer/renderer-service.ts:12-18`.
      // `failIfMajorPerformanceCaveat: false` is the one that decides whether
      // this project's own browser harness can run at all — SwiftShader IS a
      // major performance caveat, and `true` refuses to create a context under
      // Playwright. It is asserted by name for that reason.
      const three = makeFakeThree()
      yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      expect(three.renderer().parameters).toStrictEqual({
        canvas: FAKE_CANVAS,
        antialias: false,
        stencil: false,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      })
    }),
  )

  it.effect('sizes the drawing buffer without writing an inline style', () =>
    Effect.gen(function* () {
      // `updateStyle: false`. The canvas display size is owned by the host's
      // CSS — mc-compose's `index.html` sets `#game-canvas` to 100vw/100vh —
      // and `renderer-service.ts:19-22` records what happens otherwise: three
      // writes a fixed-px inline style, `clientWidth` freezes, and window
      // resize detection stops working.
      const three = makeFakeThree()
      yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      expect(three.renderer().sizes()).toStrictEqual([[1280, 720, false]])
    }),
  )

  it.effect('clears to the reference sky colour, opaque', () =>
    Effect.gen(function* () {
      // `SKY_COLOR_DAY = 0x87ceeb`, ts-minecraft
      // `packages/app/application/main.config.ts:14`. Not black, and that is
      // deliberate: a canvas cleared to black is indistinguishable from a
      // canvas that failed to draw.
      const three = makeFakeThree()
      yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      expect(three.renderer().clearColors()).toStrictEqual([[SKY_CLEAR_COLOR, SKY_CLEAR_ALPHA]])
      expect(SKY_CLEAR_COLOR).toBe(0x87ceeb)
    }),
  )

  it.effect('applies one daylight plan to the sky and injected material updater', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const applied: unknown[] = []
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        applyMaterialEnvironment: (environment) => applied.push(environment),
      })
      const night = renderEnvironmentPlan(0, CAMERA_FAR_PLANE)

      yield* renderer.setEnvironment(night)

      expect(applied).toStrictEqual([renderEnvironmentPlan(1, CAMERA_FAR_PLANE), night])
      expect(three.renderer().clearColors()).toStrictEqual([
        [SKY_CLEAR_COLOR, SKY_CLEAR_ALPHA],
        [night.skyColor, SKY_CLEAR_ALPHA],
      ])
    }),
  )

  it.effect('honours an initial `dimension` option for the startup clear colour, without changing the default', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, { dimension: 'end' })

      expect(three.renderer().clearColors()).toStrictEqual([[END_VOID_COLOR, SKY_CLEAR_ALPHA]])
    }),
  )

  it.effect('builds the camera from the transcribed constants and the real aspect', () =>
    Effect.gen(function* () {
      // fov 75 / near 0.1 from `session-bootstrap-scene.ts:47,49`; far 300 is
      // the FLOOR of that file's :50 expression. The renderer keeps the
      // transcribed fallback explicit because the source inputs are sibling
      // package values, not renderer-owned state.
      const three = makeFakeThree()
      yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      expect(three.camera().fov).toBe(CAMERA_FOV_DEGREES)
      expect(three.camera().near).toBe(CAMERA_NEAR_PLANE)
      expect(three.camera().far).toBe(CAMERA_FAR_PLANE)
      expect(three.camera().aspect).toBe(1280 / 720)
      expect([CAMERA_FOV_DEGREES, CAMERA_NEAR_PLANE, CAMERA_FAR_PLANE]).toStrictEqual([75, 0.1, 300])
    }),
  )

  it.effect('extends the camera far plane from the host render distance', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderDistance = RenderDistanceChunks(8)
      yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, { renderDistance })

      expect(three.camera().far).toBe(Math.max(
        CAMERA_FAR_PLANE,
        renderDistance * CHUNK_SIZE * 1.5 + CHUNK_HEIGHT,
      ))
    }),
  )

  it.effect('honors explicitly configured camera frustum options', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        farPlane: 900,
        fovDegrees: 82,
        nearPlane: 0.25,
      })

      expect(three.camera().fov).toBe(82)
      expect(three.camera().near).toBe(0.25)
      expect(three.camera().far).toBe(900)
    }),
  )

  it.effect('a zero-sized canvas gets aspect 1 rather than NaN', () =>
    Effect.gen(function* () {
      // A canvas that has not been laid out reports `clientWidth === 0`, and
      // 0/0 is NaN. `PerspectiveCamera` takes the NaN without complaint and
      // every vertex then projects to nothing — a black screen with no error
      // anywhere, which is the hardest renderer failure to attribute.
      const three = makeFakeThree()
      yield* makeWorldRenderer(three, FAKE_CANVAS, { width: 0, height: 0 })

      expect(three.camera().aspect).toBe(1)
      expect(Number.isNaN(three.camera().aspect)).toBe(false)
    }),
  )

  it.effect('the shared material is unlit and takes its shading from vertex colours', () =>
    Effect.gen(function* () {
      // ONE material for every chunk —
      // `chunk-mesh-geometry.ts:38` lists that first among the reference's
      // draw-call reduction techniques. `vertexColors: true` is what makes the
      // AO in `domain/chunk-geometry.ts` the only thing visible in the mesh;
      // without it every face draws flat white and the AO tests here and in
      // `test/chunk-geometry.test.ts` would still pass.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad()]))
      yield* renderer.setChunk(chunkKeyOf(chunkCoord(1, 0)), buildChunkGeometry([quad()]))

      expect(three.materials()).toHaveLength(1)
      expect(three.materials()[0]?.vertexColors).toBe(true)
      expect(three.materials()[0]?.wireframe).toBe(false)
      expect(three.meshes().map((mesh) => mesh.material)).toStrictEqual([
        three.materials()[0],
        three.materials()[0],
      ])
    }),
  )

  it.effect('routes nonempty layers to their materials and creates no mesh for empty layers', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const makeMaterial = () => new three.MeshBasicMaterial({ vertexColors: true, wireframe: false })
      const materials = {
        cutout: makeMaterial(),
        opaque: makeMaterial(),
        transparent: makeMaterial(),
      }
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        cutoutMaterial: () => materials.cutout,
        material: () => materials.opaque,
        transparentMaterial: () => materials.transparent,
      })
      const nonempty = buildChunkGeometry([quad()])
      const empty = buildChunkGeometry([])

      yield* renderer.setChunks([
        {
          buffers: nonempty,
          cutoutBuffers: nonempty,
          key: chunkKeyOf(chunkCoord(0, 0)),
          transparentSolidBuffers: nonempty,
          waterBuffers: nonempty,
        },
        {
          buffers: nonempty,
          cutoutBuffers: empty,
          key: chunkKeyOf(chunkCoord(1, 0)),
          transparentSolidBuffers: empty,
          waterBuffers: empty,
        },
      ])

      expect(three.meshes()).toHaveLength(4)
      expect(three.scene().members()).toHaveLength(4)
      expect(three.meshes().map(({ material }) => material)).toStrictEqual([
        materials.opaque,
        materials.cutout,
        materials.transparent,
        materials.opaque,
      ])
      expect(three.meshes()[2]?.renderOrder).toBe(three.meshes()[3]?.renderOrder)
      expect(three.meshes()[2]?.renderOrder).toBe(0)
      expect(three.geometries().every((geometry) => geometry.boundingSphereComputations() === 1)).toBe(true)

      yield* renderer.dispose
    }),
  )

  it.effect('sorts glass and water faces together back-to-front from either camera side', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const glassBuffers = buildChunkGeometry([
        quad({ blockId: blockIdForType('glass'), direction: 'zPos', lz: -1 }),
      ])
      const waterFace: FluidQuad = {
        ao: 0,
        blockId: blockIdForType('water'),
        direction: 'zPos',
        vertices: [[1, 0, 2], [1, 1, 2], [0, 1, 2], [0, 0, 2]],
      }
      const lavaFace: FluidQuad = {
        ao: 0,
        blockId: blockIdForType('lava'),
        direction: 'zPos',
        vertices: [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]],
      }
      const transparentSolidBuffers = combineChunkGeometry(
        glassBuffers,
        buildFluidGeometry([lavaFace]),
      )
      const waterBuffers = buildFluidGeometry([waterFace])

      yield* renderer.setChunks([{
        buffers: buildChunkGeometry([]),
        key: chunkKeyOf(chunkCoord(0, 0)),
        transparentSolidBuffers,
        waterBuffers,
      }])

      const [transparentGeometry] = three.geometries()
      const indexAttribute = transparentGeometry?.index()
      const readIndices = (): ReadonlyArray<number> => Array.from(transparentGeometry?.index()?.array ?? [])

      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 4, 0, 0)))
      expect(readIndices()).toStrictEqual([
        0, 1, 2, 0, 2, 3,
        4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11,
      ])
      expect(Array.from(transparentGeometry?.attributes.get('waterSurface')?.array ?? [])).toStrictEqual([
        0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
      ])
      expect(indexAttribute?.needsUpdate).toBeUndefined()

      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 4, 0, 0)))
      expect(readIndices()).toStrictEqual([
        0, 1, 2, 0, 2, 3,
        4, 5, 6, 4, 6, 7,
        8, 9, 10, 8, 10, 11,
      ])

      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, -4, Math.PI, 0)))
      expect(readIndices()).toStrictEqual([
        8, 9, 10, 8, 10, 11,
        4, 5, 6, 4, 6, 7,
        0, 1, 2, 0, 2, 3,
      ])
      expect(indexAttribute?.needsUpdate).toBe(true)
      expect(transparentGeometry?.index()).toBe(indexAttribute)

      yield* renderer.setChunks([{
        buffers: buildChunkGeometry([]),
        key: chunkKeyOf(chunkCoord(0, 0)),
        waterBuffers,
      }])
      const waterOnlyGeometry = three.geometries().at(-1)
      expect(Array.from(waterOnlyGeometry?.attributes.get('waterSurface')?.array ?? [])).toStrictEqual([1, 1, 1, 1])

      yield* renderer.dispose
    }),
  )

  it.effect('keeps the source order when transparent faces have equal camera depth', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const glassBuffers = buildChunkGeometry([
        quad({ blockId: blockIdForType('glass'), direction: 'zPos', lz: 1 }),
      ])
      const waterFace: FluidQuad = {
        ao: 0,
        blockId: blockIdForType('water'),
        direction: 'zPos',
        vertices: [[1, 0, 2], [1, 1, 2], [0, 1, 2], [0, 0, 2]],
      }

      yield* renderer.setChunks([{
        buffers: buildChunkGeometry([]),
        key: chunkKeyOf(chunkCoord(0, 0)),
        transparentSolidBuffers: glassBuffers,
        waterBuffers: buildFluidGeometry([waterFace]),
      }])
      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 4, 0, 0)))

      const [transparentGeometry] = three.geometries()
      expect(Array.from(transparentGeometry?.index()?.array ?? [])).toStrictEqual([
        0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7,
      ])

      yield* renderer.dispose
    }),
  )

  it.effect('keeps valid chunk bounds when a later layer has non-finite positions', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, { width: 100, height: 100 })
      const opaque = buildChunkGeometry([quad({ lz: -10 })])

      yield* renderer.setChunks([{
        buffers: opaque,
        key: chunkKeyOf(chunkCoord(0, 0)),
        transparentSolidBuffers: {
          ...opaque,
          positions: Float32Array.from(opaque.positions, () => Number.NaN),
        },
      }])
      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 0, 0, 0)))

      expect(three.meshes().map(({ visible }) => visible)).toStrictEqual([true, true])
      expect(three.renderer().renderCalls()).toBe(1)
    }),
  )

  it.effect('preserves layer material overrides and fallbacks for every optional factory combination', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(
          FastCheck.boolean(),
          FastCheck.boolean(),
          (hasCutout, hasTransparent) => {
            const three = makeFakeThree()
            const materials = {
              cutout: new three.MeshBasicMaterial({ vertexColors: true, wireframe: false }),
              opaque: new three.MeshBasicMaterial({ vertexColors: true, wireframe: false }),
              transparent: new three.MeshBasicMaterial({ vertexColors: true, wireframe: false }),
            }
            const factoryOptions: {
              cutoutMaterial?: () => typeof materials.cutout
              transparentMaterial?: () => typeof materials.transparent
            } = {}
            if (hasCutout) {
              factoryOptions.cutoutMaterial = () => materials.cutout
            }
            if (hasTransparent) {
              factoryOptions.transparentMaterial = () => materials.transparent
            }
            const renderer = Effect.runSync(makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
              ...factoryOptions,
              material: () => materials.opaque,
            }))
            const buffers = buildChunkGeometry([quad()])
            Effect.runSync(renderer.setChunks([{
              buffers,
              cutoutBuffers: buffers,
              key: chunkKeyOf(chunkCoord(0, 0)),
              transparentSolidBuffers: buffers,
              waterBuffers: buffers,
            }]))
            const expected = [materials.opaque]
            if (hasCutout) {
              expected.push(materials.cutout)
            } else {
              expected.push(materials.opaque)
            }
            if (hasTransparent) {
              expected.push(materials.transparent)
            } else {
              expected.push(materials.opaque)
            }
            const assigned = three.meshes().map(({ material }) => material)
            Effect.runSync(renderer.dispose)
            return assigned.length === expected.length && assigned.every((material, index) => material === expected[index])
          },
        ),
        { seed: 0x1a7e, numRuns: 100 },
      )
    }),
  )
})

describe('chunk geometry in the scene', () => {
  it.effect('setChunks commits a batch while preserving replacement semantics', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunks([
        { key: chunkKeyOf(chunkCoord(0, 0)), buffers: buildChunkGeometry([quad()]) },
        { key: chunkKeyOf(chunkCoord(1, 0)), buffers: buildChunkGeometry([quad()]) },
        { key: chunkKeyOf(chunkCoord(0, 0)), buffers: buildChunkGeometry([quad({ ao: 2 })]) },
      ])

      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0', '1,0'])
      expect(three.scene().members()).toHaveLength(2)
      expect(three.geometries()[0]?.disposed()).toBe(true)
      expect(three.geometries()[1]?.disposed()).toBe(false)
      expect(three.geometries()[2]?.disposed()).toBe(false)
    }),
  )

  it.effect('setChunk builds all geometry attributes with the reference item sizes and flags', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const buffers = buildChunkGeometry([quad()])

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buffers)

      const [geometry] = three.geometries()
      expect([...(geometry?.attributes.keys() ?? [])]).toStrictEqual([
        'position',
        'normal',
        'color',
        'uv',
        // The fluid attributes are uploaded on both material paths.
        'fluidDirection',
        'fluidFalling',
        'tileIndex',
        'animationKind',
      ])
      expect(geometry?.attributes.get('position')).toStrictEqual({
        array: buffers.positions,
        itemSize: 3,
        normalized: false,
      })
      // `normalized: true` on the colours ALONE: they are 0-255 bytes and the
      // shader wants 0-1. `chunk-mesh-geometry.ts:56` passes `true` here and
      // `false` on every other attribute.
      expect(geometry?.attributes.get('color')).toStrictEqual({
        array: buffers.colors,
        itemSize: 3,
        normalized: true,
      })
      expect(geometry?.attributes.get('uv')?.itemSize).toBe(2)
      // itemSize 1 and `normalized: false`: GLSL ES has no integer attributes,
      // so the index crosses as a float the fragment stage rounds back. A
      // `normalized: true` here would divide it by 255 and every tile but 0
      // would resolve wrong.
      expect(geometry?.attributes.get('tileIndex')).toStrictEqual({
        array: buffers.tileIndices,
        itemSize: 1,
        normalized: false,
      })
      expect(geometry?.attributes.get('animationKind')).toStrictEqual({
        array: buffers.animationKinds,
        itemSize: 1,
        normalized: false,
      })
      expect(geometry?.attributes.get('fluidDirection')).toStrictEqual({
        array: buffers.fluidDirections,
        itemSize: 2,
        normalized: false,
      })
      expect(geometry?.attributes.get('fluidFalling')).toStrictEqual({
        array: buffers.fluidFalling,
        itemSize: 1,
        normalized: false,
      })
      expect(geometry?.index()).toStrictEqual({
        array: buffers.indices,
        itemSize: 1,
        normalized: false,
      })
    }),
  )

  it.effect('skips empty geometry before allocating a mesh or bounding sphere', () =>
    Effect.gen(function* () {
      // Empty layers have no renderable. Constructing one would make three
      // compute a NaN sphere lazily and would add a draw call with no indices.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([]))

      expect(three.geometries()).toHaveLength(0)
      expect(three.meshes()).toHaveLength(0)
      expect(three.scene().members()).toHaveLength(0)
      expect(three.renderer().renderCalls()).toBe(0)
    }),
  )

  it.effect('REGRESSION: re-meshing a chunk replaces its mesh instead of leaking one', () =>
    Effect.gen(function* () {
      // THE ONE THAT MATTERS. docs/public-api.md §3.1 records that mc-worldgen
      // reports a coordinate CHANGED and that the same coordinate changes
      // repeatedly — "落下する砂の柱は 1 tick に同じチャンクを 32 回汚す". An
      // `addChunk` would put 32 meshes in the scene for one chunk, each holding
      // GPU buffers, and the symptom would be a memory curve rather than a
      // wrong picture.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad()]))
      const [first] = three.geometries()
      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad({ ao: 2 })]))

      expect(three.scene().members()).toHaveLength(1)
      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
      // The old geometry is gone from the scene AND released.
      expect(first?.disposed()).toBe(true)
      expect(three.geometries()[1]?.disposed()).toBe(false)
    }),
  )

  it.effect('removeChunk takes the mesh out of the scene and disposes its geometry', () =>
    Effect.gen(function* () {
      // docs/public-api.md §3.3 lists geometry disposal timing as an open
      // question; this is the half that is not open. `BufferGeometry` needs an
      // explicit `dispose()`, and removal is the only moment the renderer can
      // know the geometry is unreferenced.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad()]))
      yield* renderer.removeChunk(chunkKeyOf(chunkCoord(0, 0)))

      expect(three.scene().members()).toStrictEqual([])
      expect(yield* renderer.chunkKeys).toStrictEqual([])
      expect(three.geometries()[0]?.disposed()).toBe(true)
    }),
  )

  it.effect('removing a chunk that was never added does nothing at all', () =>
    Effect.gen(function* () {
      // `removed` and `changed` are separate sets in mc-worldgen's dirty
      // notification, and a chunk can appear in `removed` having never been
      // meshed — it was unloaded in the same window it was created. That must
      // not disturb the scene.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad()]))
      yield* renderer.removeChunk(chunkKeyOf(chunkCoord(9, 9)))

      expect(three.scene().members()).toHaveLength(1)
      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
      expect(three.geometries()[0]?.disposed()).toBe(false)
    }),
  )

  it.effect('several chunks coexist, one mesh each', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad()]))
      yield* renderer.setChunk(chunkKeyOf(chunkCoord(1, 0)), buildChunkGeometry([quad()]))
      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 1)), buildChunkGeometry([quad()]))

      expect(three.scene().members()).toHaveLength(3)
      expect((yield* renderer.chunkKeys).toSorted()).toStrictEqual(['0,0', '0,1', '1,0'])
    }),
  )
})

describe('entity meshes in the scene', () => {
  it.effect('uses the host entity material and atlas UVs on six cube faces', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const entityMaterial = new three.MeshBasicMaterial({ vertexColors: true, wireframe: false })
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        entityMaterial: () => entityMaterial,
      })

      yield* renderer.syncEntities([
        { id: 'textured-zombie', kind: 'zombie', feetPosition: { x: 1, y: 2, z: 3 } },
      ])

      const [unverifiedFirstMesh] = three.meshes()
      const firstMesh = requiredTestValue(unverifiedFirstMesh)
      const uvAttribute = firstMesh?.geometry.attributes.get('uv')
      const zombieTexture = ENTITY_MODEL_TEXTURE_ATLAS.entries.find(({ kind }) => kind === 'zombie')
      expect(firstMesh?.material).toBe(entityMaterial)
      expect(uvAttribute?.itemSize).toBe(2)
      expect(uvAttribute?.array).toHaveLength(48)
      expect(Array.from(uvAttribute?.array.slice(0, 2) ?? [])).toStrictEqual(zombieTexture?.uv.slice(0, 2))
      yield* renderer.dispose
    }),
  )

  it.effect('creates one transformed mesh per visual part from renderer DTOs', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.syncEntities([
        { id: 'z', kind: 'zombie', category: 'hostile', feetPosition: { x: 1, y: 64, z: 2 } },
        { id: 'c', kind: 'creeper', category: 'hostile', feetPosition: { x: 3, y: 64, z: 4 } },
        { id: 'e', kind: 'enderman', category: 'hostile', feetPosition: { x: 5, y: 64, z: 6 } },
        { id: 'i', kind: 'coal', category: 'item', feetPosition: { x: 7, y: 64, z: 8 } },
      ])

      expect(yield* renderer.entityCount).toBe(4)
      const mobPartCount = ['zombie', 'creeper', 'enderman'].reduce(
        (total, kind) => total + resolvedMobPlan(kind).parts.length,
        0,
      )
      expect(three.scene().members()).toHaveLength(mobPartCount + 1)
      expect(three.meshes()[0]?.positions()).toStrictEqual([[1, 65.55, 2]])
      expect(three.meshes()[0]?.scales()).toStrictEqual([[0.5, 0.5, 0.5]])
      expect(three.meshes().at(-1)?.positions()).toStrictEqual([[7, 64.15, 8]])
      expect(three.meshes().at(-1)?.scales()).toStrictEqual([[0.3, 0.3, 0.3]])
      expect(new Set(three.meshes().map(({ material }) => material))).toHaveLength(1)
    }),
  )

  it.effect('renders generic catalog models with frame pose, byte lighting, and role animation', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, { daylight: 0.5 })
      const frame: Schema.Codec.Encoded<typeof EntityRenderFrameInputSchema> = {
        simulationTick: 12,
        partialTick: 0.5,
        timeOfDayTicks: 6000,
        entities: [
          {
            id: 'player',
            kind: 'player',
            position: { dimension: 'overworld', x: 4, y: 10, z: -2 },
            bodyYawRadians: Math.PI / 2,
            headYawRadians: Math.PI / 4,
            pitchRadians: Math.PI / 6,
            blockLight: 3,
            skyLight: 12,
            walkPhaseRadians: Math.PI / 2,
            walkAmount: 0.5,
            attackProgress: 0.5,
            hurtProgress: 0,
            deathProgress: 0,
          },
          {
            id: 'dragon',
            kind: 'ender_dragon',
            position: { dimension: 'overworld', x: -10, y: 30, z: 5 },
            bodyYawRadians: 0,
            headYawRadians: 0,
            pitchRadians: 0,
            blockLight: 3,
            skyLight: 12,
            walkPhaseRadians: Math.PI / 2,
            walkAmount: 0.5,
            attackProgress: 0,
            hurtProgress: 0,
            deathProgress: 0,
          },
        ],
      }

      yield* renderer.syncEntityFrame(frame)

      const meshes = three.meshes()
      const [unverifiedPlayerHead, , , , unverifiedPlayerBody, unverifiedLeftArm, unverifiedRightArm, , , unverifiedLeftLeg, unverifiedRightLeg] = meshes
      const playerHead = requiredTestValue(unverifiedPlayerHead)
      const playerBody = requiredTestValue(unverifiedPlayerBody)
      const leftArm = requiredTestValue(unverifiedLeftArm)
      const rightArm = requiredTestValue(unverifiedRightArm)
      const leftLeg = requiredTestValue(unverifiedLeftLeg)
      const rightLeg = requiredTestValue(unverifiedRightLeg)
      expect(meshes).toHaveLength(52)
      expect(playerHead.positions()[0]).toStrictEqual([4, 11.55, -2])
      expect(requiredTestValue(playerHead.rotations()[0])).toStrictEqual([Math.PI / 6, Math.PI / 4, 0, 'YXZ'])
      expect(requiredTestValue(playerBody.rotations()[0])).toStrictEqual([0, Math.PI / 2, 0, 'YXZ'])
      expect(requiredTestValue(leftArm.rotations()[0])[0]).toBeCloseTo(0.225 - Math.PI / 4, 12)
      expect(requiredTestValue(rightArm.rotations()[0])[0]).toBeCloseTo(-0.225 + Math.PI / 4, 12)
      expect(requiredTestValue(leftLeg.rotations()[0])[0]).toBeCloseTo(0.325, 12)
      expect(requiredTestValue(rightLeg.rotations()[0])[0]).toBeCloseTo(-0.325, 12)
      expect(entityColorBytes(playerHead)).toStrictEqual([137, 103, 70])

      const dragon = requiredTestValue(ENTITY_MODEL_CATALOG.find(({ kind }) => kind === 'ender_dragon'))
      const player = requiredTestValue(ENTITY_MODEL_CATALOG.find(({ kind }) => kind === 'player'))
      const wingRootIndex = dragon.parts.findIndex(({ id }) => id === 'left-wing-root')
      const tailBaseIndex = dragon.parts.findIndex(({ id }) => id === 'tail-base')
      const wingRoot = requiredTestValue(meshes[player.parts.length + wingRootIndex])
      const tailBase = requiredTestValue(meshes[player.parts.length + tailBaseIndex])
      expect(requiredTestValue(wingRoot.rotations()[0])[2]).toBeCloseTo(-0.325, 6)
      expect(requiredTestValue(tailBase.rotations()[0])[1]).toBeCloseTo(0.175, 6)
      expect(yield* renderer.entityModelDiagnostics).toStrictEqual([])
      yield* renderer.dispose
    }),
  )

  it.effect('does not render unsupported or empty kinds and retains typed diagnostics', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.syncEntities([{ id: 'same-id', kind: 'player', feetPosition: { x: 1, y: 2, z: 3 } }])
      expect(three.scene().members()).toHaveLength(13)

      yield* renderer.syncEntities([
        { id: 'same-id', kind: 'future_entity', feetPosition: { x: 1, y: 2, z: 3 } },
        { id: 'empty-kind', kind: '', feetPosition: { x: 4, y: 5, z: 6 } },
      ])

      expect(three.scene().members()).toHaveLength(0)
      expect(yield* renderer.entityCount).toBe(0)
      expect(yield* renderer.entityModelDiagnostics).toStrictEqual([
        { entityId: 'same-id', issue: { _tag: 'UnsupportedEntityModel', kind: 'future_entity' } },
        { entityId: 'empty-kind', issue: { _tag: 'InvalidEntityModelKind', reason: 'empty' } },
      ])
      yield* renderer.dispose
    }),
  )

  it('accepts generated finite entity poses, orientation, animation, and paired light', () => {
    const finitePosition = FastCheck.double({ min: -1000, max: 1000, noNaN: true, noDefaultInfinity: true })
    const yaw = FastCheck.double({ min: -Math.PI, max: Math.PI, noNaN: true, noDefaultInfinity: true })
    const pitch = FastCheck.double({ min: -Math.PI / 2, max: Math.PI / 2, noNaN: true, noDefaultInfinity: true })
    const phase = FastCheck.double({ min: 0, max: 2 * Math.PI - 1e-12, noNaN: true, noDefaultInfinity: true })
    const progress = FastCheck.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })

    FastCheck.assert(FastCheck.property(
      FastCheck.record({
        blockLight: FastCheck.integer({ min: 0, max: 15 }),
        phase,
        pitch,
        progress,
        skyLight: FastCheck.integer({ min: 0, max: 15 }),
        x: finitePosition,
        y: finitePosition,
        yaw,
        z: finitePosition,
      }),
      ({ blockLight, phase: phaseRadians, pitch: pitchRadians, progress: motionProgress, skyLight, x, y, yaw: yawRadians, z }) =>
        Result.isSuccess(decodeRenderEntities([{
          animation: {
            attackProgress: motionProgress,
            deathProgress: motionProgress,
            hurtProgress: motionProgress,
            phaseRadians,
            progress: motionProgress,
            state: 'walk',
            walkAmount: motionProgress,
          },
          blockLight,
          bodyYawRadians: yawRadians,
          feetPosition: { x, y, z },
          headYawRadians: yawRadians,
          id: 'generated-entity',
          kind: 'horse',
          pitchRadians,
          skyLight,
        }])),
    ))
  })

  it.effect('accepts entity numeric boundaries and applies defaults only to omitted optional fields', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      const boundary = yield* Effect.result(syncEntitiesWithRawInput(renderer.syncEntities, [{
        animation: {
          attackProgress: 1,
          deathProgress: 0,
          hurtProgress: 1,
          phaseRadians: 0,
          progress: 1,
          state: 'walk',
          walkAmount: 0,
        },
        blockLight: 0,
        bodyYawRadians: -Math.PI,
        feetPosition: { x: 0, y: -0, z: Number.MAX_VALUE },
        headYawRadians: Math.PI,
        id: 'boundary',
        kind: 'horse',
        pitchRadians: -Math.PI / 2,
        skyLight: 15,
      }]))
      expect(Result.isSuccess(boundary)).toBe(true)
      yield* renderer.syncEntities([{ id: 'minimal', kind: 'horse', feetPosition: { x: 1, y: 2, z: 3 } }])
      expect(yield* renderer.entitySnapshot).toStrictEqual([
        { feetPosition: { x: 1, y: 2, z: 3 }, id: 'minimal', kind: 'horse' },
      ])
      expect(yield* renderer.entityModelDiagnostics).toStrictEqual([])
      yield* renderer.dispose
    }),
  )

  it.effect('rejects invalid numeric entity DTOs as SchemaError before reconciliation', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const valid = { id: 'stable', kind: 'horse', feetPosition: { x: 1, y: 2, z: 3 } }
      yield* renderer.syncEntities([valid])
      const beforeSnapshot = yield* renderer.entitySnapshot
      const beforeMeshes = three.meshes()

      const wither = {
        ...valid,
        kind: 'wither',
        witherState: {
          chargeRemainingSecs: 1,
          feetPosition: { x: 1, y: 2, z: 3 },
          healthPoints: 300,
          phase: 'airborne',
          velocity: { x: 0, y: 0, z: -1 },
        },
      }
      const skull = {
        ...valid,
        kind: 'wither_skull',
        witherSkullProjectile: {
          destroysResistantBlocks: false,
          direction: { x: 0, y: 0, z: -1 },
          explosivePower: 1,
          kind: 'wither_skull',
          origin: { x: 1, y: 2, z: 3 },
          speed: 1,
          variant: 'normal',
        },
      }
      const invalidInputs: ReadonlyArray<Readonly<{ name: string; entities: unknown }>> = [
        { entities: [{ ...valid, feetPosition: { ...valid.feetPosition, x: Number.NaN } }], name: 'NaN position' },
        { entities: [{ ...valid, feetPosition: { ...valid.feetPosition, y: Number.POSITIVE_INFINITY } }], name: 'infinite position' },
        { entities: [{ ...valid, facingRadians: Math.PI + 0.01 }], name: 'out-of-range facing' },
        { entities: [{ ...valid, bodyYawRadians: Number.NaN }], name: 'NaN body yaw' },
        { entities: [{ ...valid, headYawRadians: Number.NEGATIVE_INFINITY }], name: 'infinite head yaw' },
        { entities: [{ ...valid, pitchRadians: Math.PI / 2 + 0.01 }], name: 'out-of-range pitch' },
        { entities: [{ ...valid, animation: { state: 'walk', phaseRadians: Number.NaN } }], name: 'NaN animation phase' },
        { entities: [{ ...valid, animation: { state: 'walk', phaseRadians: 2 * Math.PI } }], name: 'exclusive animation phase endpoint' },
        { entities: [{ ...valid, animation: { state: 'walk', progress: 1.01 } }], name: 'out-of-range progress' },
        { entities: [{ ...valid, animation: { state: 'walk', walkAmount: -0.01 } }], name: 'negative walk amount' },
        { entities: [{ ...valid, animation: { state: 'walk', attackProgress: Number.POSITIVE_INFINITY } }], name: 'infinite attack progress' },
        { entities: [{ ...valid, animation: { state: 'walk', hurtProgress: Number.NaN } }], name: 'NaN hurt progress' },
        { entities: [{ ...valid, animation: { state: 'walk', deathProgress: 1.01 } }], name: 'out-of-range death progress' },
        { entities: [{ ...valid, blockLight: 8 }], name: 'unpaired light field' },
        { entities: [{ ...valid, blockLight: 16, skyLight: 0 }], name: 'out-of-range block light' },
        { entities: [{ ...valid, blockLight: 0, skyLight: 1.5 }], name: 'fractional sky light' },
        { entities: [{ ...wither, witherState: { ...wither.witherState, chargeRemainingSecs: Number.NaN } }], name: 'NaN Wither timer' },
        { entities: [{ ...wither, witherState: { ...wither.witherState, healthPoints: -1 } }], name: 'negative Wither health' },
        { entities: [{ ...wither, witherState: { ...wither.witherState, velocity: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 } } }], name: 'infinite Wither velocity' },
        { entities: [{ ...skull, witherSkullProjectile: { ...skull.witherSkullProjectile, speed: Number.POSITIVE_INFINITY } }], name: 'infinite projectile speed' },
        { entities: [{ ...skull, witherSkullProjectile: { ...skull.witherSkullProjectile, explosivePower: -1 } }], name: 'negative projectile power' },
        { entities: [{ ...skull, witherSkullProjectile: { ...skull.witherSkullProjectile, origin: { x: 0, y: Number.NaN, z: 0 } } }], name: 'NaN projectile origin' },
        { entities: [{ ...valid, facingRadians: undefined }], name: 'present undefined facing' },
      ]

      for (const { entities, name } of invalidInputs) {
        const result = yield* Effect.result(syncEntitiesWithRawInput(renderer.syncEntities, entities))
        if (Result.isSuccess(result) || !Schema.isSchemaError(result.failure)) {
          throw new Error(`${name} must fail with SchemaError`)
        }
      }

      expect(yield* renderer.entitySnapshot).toStrictEqual(beforeSnapshot)
      expect(three.meshes()).toStrictEqual(beforeMeshes)
      expect(yield* renderer.entityModelDiagnostics).toStrictEqual([])
      yield* renderer.dispose
    }),
  )

  it.effect('propagates planner SchemaError without partially reconciling entities', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const decoded = Schema.decodeUnknownResult(Schema.String)(1)
      expect(Result.isFailure(decoded)).toBe(true)
      if (Result.isSuccess(decoded)) {
        yield* renderer.dispose
        return
      }
      const planner = vi.spyOn(entityVisualPlanner, 'planEntityVisual').mockReturnValue(Result.fail(decoded.failure))

      try {
        const result = yield* Effect.result(syncEntitiesWithRawInput(renderer.syncEntities, [
          { id: 'planner-error', kind: 'horse', feetPosition: { x: 1, y: 2, z: 3 } },
        ]))
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result)) {
          expect(Schema.isSchemaError(result.failure)).toBe(true)
        }
        expect(three.meshes()).toHaveLength(0)
        expect(yield* renderer.entityCount).toBe(0)
      } finally {
        planner.mockRestore()
        yield* renderer.dispose
      }
    }),
  )

  it.effect('reuses every part mesh for an unchanged id and updates its animation transform', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const feetPosition = { x: 0, y: 64, z: 0 }

      yield* renderer.syncEntities([{ id: 'z', kind: 'zombie', feetPosition }])
      const firstMeshes = [...three.meshes()]
      feetPosition.x = 99
      yield* renderer.syncEntities([
        {
          id: 'z',
          kind: 'zombie',
          feetPosition: { x: 2, y: 65, z: 3 },
          facingRadians: Math.PI / 2,
          animation: { state: 'walk', phaseRadians: Math.PI / 2 },
        },
      ])

      expect(three.meshes()).toStrictEqual(firstMeshes)
      expect(firstMeshes.every((mesh) => mesh.positions().length === 2)).toBe(true)
      expect(firstMeshes.every((mesh) => mesh.scales().length === 2)).toBe(true)
      expect(firstMeshes.every((mesh) => mesh.rotations().length === 2)).toBe(true)
      expect(firstMeshes[2]?.rotations().at(-1)?.[0]).toBeCloseTo(0.65, 12)
      expect(yield* renderer.entitySnapshot).toStrictEqual([
        {
          id: 'z',
          kind: 'zombie',
          feetPosition: { x: 2, y: 65, z: 3 },
          facingRadians: Math.PI / 2,
          animation: { state: 'walk', phaseRadians: Math.PI / 2 },
        },
      ])
    }),
  )

  it.effect('syncs a validated frame into dimension-filtered body and head pose and attack gait', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const frame: Schema.Codec.Encoded<typeof EntityRenderFrameInputSchema> = {
        simulationTick: 37,
        partialTick: 0.25,
        timeOfDayTicks: 6000,
        entities: [
          {
            id: 'mob',
            kind: 'zombie',
            position: { dimension: 'overworld', x: 4, y: 10, z: -2 },
            bodyYawRadians: Math.PI / 2,
            headYawRadians: Math.PI / 4,
            pitchRadians: Math.PI / 6,
            blockLight: 7,
            skyLight: 14,
            walkPhaseRadians: Math.PI / 2,
            walkAmount: 0.5,
            attackProgress: 0.5,
            hurtProgress: 0,
            deathProgress: 0,
          },
          {
            id: 'other-dimension',
            kind: 'cow',
            position: { dimension: 'nether', x: 80, y: 10, z: -2 },
            bodyYawRadians: 0,
            headYawRadians: 0,
            pitchRadians: 0,
            blockLight: 0,
            skyLight: 0,
            walkPhaseRadians: 0,
            walkAmount: 0,
            attackProgress: 0,
            hurtProgress: 0,
            deathProgress: 0,
          },
        ],
      }

      yield* renderer.syncEntityFrame(frame)

      expect(yield* renderer.entityCount).toBe(1)
      expect(yield* renderer.entitySnapshot).toMatchObject([
        {
          id: 'mob',
          kind: 'zombie',
          dimension: 'overworld',
          feetPosition: { x: 4, y: 10, z: -2 },
          bodyYawRadians: Math.PI / 2,
          headYawRadians: Math.PI / 4,
          pitchRadians: Math.PI / 6,
          blockLight: 7,
          skyLight: 14,
          animation: {
            phaseRadians: Math.PI / 2,
            walkAmount: 0.5,
            attackProgress: 0.5,
            hurtProgress: 0,
            deathProgress: 0,
          },
        },
      ])

      const [head, body, leftArm, rightArm] = three.meshes()
      expect(head?.positions()[0]).toStrictEqual([4, 11.55, -2])
      expect(head?.rotations()[0]).toStrictEqual([Math.PI / 6, Math.PI / 4, 0, 'YXZ'])
      expect(body?.positions()[0]).toStrictEqual([4, 10.95, -2])
      expect(body?.rotations()[0]).toStrictEqual([0, Math.PI / 2, 0, 'YXZ'])
      expect(leftArm?.positions()[0]).toStrictEqual([4, 10.95, -1.6])
      expect(rightArm?.positions()[0]).toStrictEqual([4, 10.95, -2.4])
      expect(leftArm?.rotations()[0]?.[0]).toBeCloseTo(0.325 + Math.PI / 2, 12)
      expect(rightArm?.rotations()[0]?.[0]).toBeCloseTo(-0.325 - Math.PI / 2, 12)

      const [mob, otherDimension] = frame.entities
      if (mob === undefined || otherDimension === undefined) {
        throw new Error('entity frame fixture is incomplete')
      }
      yield* renderer.syncEntityFrame({
        ...frame,
        entities: [{ ...mob, hurtProgress: 0.5, deathProgress: 0.25 }, otherDimension],
      })
      const expectedHurtAndDeathLean = 0.24 * 0.5 + Math.PI / 2 * 0.25
      expect(body?.rotations().at(-1)?.[2]).toBeCloseTo(expectedHurtAndDeathLean, 12)

      const invalidClock = yield* Effect.result(renderer.syncEntityFrame({ ...frame, partialTick: 1 }))
      expect(Result.isFailure(invalidClock)).toBe(true)
      if (Result.isFailure(invalidClock)) {
        expect(invalidClock.failure).toStrictEqual({
          _tag: 'AnimationClockInputError',
          reason: 'invalid-partial-tick',
        })
      }
      const invalidEntityNumber = yield* Effect.result(renderer.syncEntityFrame({
        ...frame,
        entities: [{ ...mob, walkAmount: 1.01 }, otherDimension],
      }))
      expect(Result.isFailure(invalidEntityNumber)).toBe(true)
      if (Result.isFailure(invalidEntityNumber)) {
        expect(Schema.isSchemaError(invalidEntityNumber.failure)).toBe(true)
      }
      expect(yield* renderer.entityCount).toBe(1)
      yield* renderer.dispose
    }),
  )

  it.effect('applies separate block and sky light to vertex colors and refreshes them with the environment', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, { daylight: 0.5 })
      const frame: Schema.Codec.Encoded<typeof EntityRenderFrameInputSchema> = {
        simulationTick: 0,
        partialTick: 0,
        timeOfDayTicks: 0,
        entities: [
          {
            id: 'sky-lit',
            kind: 'zombie',
            position: { dimension: 'overworld', x: 1, y: 10, z: 1 },
            bodyYawRadians: 0,
            headYawRadians: 0,
            pitchRadians: 0,
            blockLight: 3,
            skyLight: 12,
            walkPhaseRadians: 0,
            walkAmount: 0,
            attackProgress: 0,
            hurtProgress: 0,
            deathProgress: 0,
          },
          {
            id: 'block-lit',
            kind: 'zombie',
            position: { dimension: 'overworld', x: 2, y: 10, z: 1 },
            bodyYawRadians: 0,
            headYawRadians: 0,
            pitchRadians: 0,
            blockLight: 12,
            skyLight: 3,
            walkPhaseRadians: 0,
            walkAmount: 0,
            attackProgress: 0,
            hurtProgress: 0,
            deathProgress: 0,
          },
        ],
      }

      yield* renderer.syncEntityFrame(frame)

      // At sun intensity 0.5, the effective levels are max(12/15 * 0.5, 3/15) = 0.4
      // and max(3/15 * 0.5, 12/15) = 0.8. The corresponding red/green/blue bytes
      // for the zombie head (95, 155, 85) round to (64, 104, 57) and (85, 138, 76).
      expect(entityColorBytes(three.meshes()[0])).toStrictEqual([64, 104, 57])
      expect(entityColorBytes(three.meshes()[6])).toStrictEqual([85, 138, 76])

      yield* renderer.setEnvironment(Result.getOrThrow(planRenderEnvironment(1, CAMERA_FAR_PLANE, 'overworld')))
      const liveMeshes = three.meshes().filter((mesh) => three.scene().members().includes(mesh))
      const skyHead = liveMeshes.find((mesh) => {
        const meshPosition = mesh.positions().at(-1)
        return meshPosition?.[0] === 1 && meshPosition[1] === 11.55
      })
      const blockHead = liveMeshes.find((mesh) => {
        const meshPosition = mesh.positions().at(-1)
        return meshPosition?.[0] === 2 && meshPosition[1] === 11.55
      })
      expect(entityColorBytes(skyHead)).toStrictEqual([85, 138, 76])
      expect(entityColorBytes(blockHead)).toStrictEqual([85, 138, 76])
      yield* renderer.dispose
    }),
  )

  it.effect('removes missing ids while retaining shared resources until renderer disposal', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad()]))
      yield* renderer.syncEntities([
        { id: 'z', kind: 'zombie', feetPosition: { x: 0, y: 64, z: 0 } },
      ])
      const entityGeometries = three.geometries().slice(1)
      const [, entityMaterial] = three.materials()
      yield* renderer.syncEntities([])

      expect(yield* renderer.entityCount).toBe(0)
      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
      expect(three.scene().members()).toHaveLength(1)
      expect(three.geometries()[0]?.disposed()).toBe(false)
      expect(entityGeometries.every((geometry) => !geometry.disposed())).toBe(true)
      expect(entityMaterial?.disposed()).toBe(false)

      yield* renderer.dispose
      expect(entityGeometries.every((geometry) => geometry.disposed())).toBe(true)
      expect(entityMaterial?.disposed()).toBe(true)
    }),
  )

  it.effect('rebuilds all parts when an id changes visual identity', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.syncEntities([
        { id: 'same', kind: 'zombie', feetPosition: { x: 0, y: 0, z: 0 } },
      ])
      const previousMeshes = [...three.scene().members()]
      const previousGeometries = [...three.geometries()]
      const [, entityMaterial] = three.materials()
      yield* renderer.syncEntities([
        { id: 'same', kind: 'creeper', feetPosition: { x: 1, y: 0, z: 0 } },
      ])

      const currentMeshes = three.scene().members()
      expect(previousMeshes).toHaveLength(resolvedMobPlan('zombie').parts.length)
      expect(currentMeshes).toHaveLength(resolvedMobPlan('creeper').parts.length)
      expect(currentMeshes.every((mesh) => !previousMeshes.includes(mesh))).toBe(true)
      expect(previousGeometries.every((geometry) => !geometry.disposed())).toBe(true)
      expect(three.materials()[1]).toBe(entityMaterial)
    }),
  )

  it.effect('does not render unknown kinds through the stable fallback silhouette', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.syncEntities([
        { id: 'future', kind: 'not-yet-supported', feetPosition: { x: 4, y: 5, z: 6 } },
      ])

      const fallback = resolvedMobPlan('not-yet-supported')
      expect(fallback.descriptorKind).toBe('unknown')
      expect(three.scene().members()).toHaveLength(0)
      expect(yield* renderer.entityCount).toBe(0)
      expect(yield* renderer.entityModelDiagnostics).toStrictEqual([
        { entityId: 'future', issue: { _tag: 'UnsupportedEntityModel', kind: 'not-yet-supported' } },
      ])
    }),
  )

  it.effect('renders Wither state at its authoritative position and facing', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const witherState = {
        phase: 'airborne' as const,
        healthPoints: 300,
        chargeRemainingSecs: 0,
        feetPosition: { x: 10, y: 20, z: 30 },
        velocity: { x: 1, y: 0, z: 0 },
      }
      const visual = resolvedWitherPlan(witherState)
      const [firstPart] = visual.parts

      yield* renderer.syncEntities([
        {
          id: 'wither',
          kind: 'wither',
          feetPosition: { x: 0, y: 0, z: 0 },
          facingRadians: 0,
          witherState,
        },
      ])

      expect(firstPart).toBeDefined()
      expect(three.scene().members()).toHaveLength(visual.parts.length)
      expect(three.meshes()[0]?.positions()[0]?.[0]).toBeCloseTo(
        visual.position.x + (firstPart?.center[2] ?? 0) * -1,
        12,
      )
      expect(three.meshes()[0]?.positions()[0]?.[1]).toBeCloseTo(
        visual.position.y + (firstPart?.center[1] ?? 0),
        12,
      )
      expect(three.meshes()[0]?.positions()[0]?.[2]).toBeCloseTo(
        visual.position.z + (firstPart?.center[0] ?? 0),
        12,
      )
      expect(three.meshes()[0]?.rotations()[0]?.[1]).toBeCloseTo(-Math.PI / 2, 12)
    }),
  )

  it.effect('rebuilds charging colors and removes every part once the Wither is dead', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const baseState = {
        healthPoints: 300,
        feetPosition: { x: 0, y: 64, z: 0 },
        velocity: { x: 0, y: 0, z: -1 },
      }

      yield* renderer.syncEntities([
        {
          id: 'wither',
          kind: 'wither',
          feetPosition: baseState.feetPosition,
          witherState: { ...baseState, phase: 'charging', chargeRemainingSecs: 1.125 },
        },
      ])
      const unlitMeshes = [...three.scene().members()]

      yield* renderer.syncEntities([
        {
          id: 'wither',
          kind: 'wither',
          feetPosition: baseState.feetPosition,
          witherState: { ...baseState, phase: 'charging', chargeRemainingSecs: 1 },
        },
      ])
      const litMeshes = [...three.scene().members()]
      expect(litMeshes).toHaveLength(unlitMeshes.length)
      expect(litMeshes.every((mesh) => !unlitMeshes.includes(mesh))).toBe(true)

      yield* renderer.syncEntities([
        {
          id: 'wither',
          kind: 'wither',
          feetPosition: baseState.feetPosition,
          witherState: { ...baseState, phase: 'dead', chargeRemainingSecs: 0 },
        },
      ])
      expect(yield* renderer.entityCount).toBe(1)
      expect(three.scene().members()).toStrictEqual([])
    }),
  )

  it.effect('renders a blue Wither skull at its origin with direction-derived angles', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const witherSkullProjectile = {
        kind: 'wither_skull' as const,
        variant: 'blue' as const,
        origin: { x: 3, y: 7, z: 11 },
        direction: { x: 1, y: 1, z: 0 },
        speed: 20,
        explosivePower: 1,
        destroysResistantBlocks: true,
      }
      const visual = resolvedSkullPlan(witherSkullProjectile)

      yield* renderer.syncEntities([
        {
          id: 'blue-skull',
          kind: 'wither_skull',
          feetPosition: { x: 0, y: 0, z: 0 },
          witherSkullProjectile,
        },
      ])

      expect(three.scene().members()).toHaveLength(visual.parts.length)
      expect(three.meshes()[0]?.positions()[0]).toStrictEqual([3, 7, 11])
      expect(three.meshes()[0]?.rotations()[0]?.[0]).toBeCloseTo(Math.PI / 4, 12)
      expect(three.meshes()[0]?.rotations()[0]?.[1]).toBeCloseTo(-Math.PI / 2, 12)
    }),
  )

  it.effect('defaults Wither visual state from feet position and facing when the entity carries none', () =>
    Effect.gen(function* () {
      // `planWitherEntityVisual` (application/world-renderer.ts) builds a
      // default `WitherVisualStateInput` from `entity.witherState ?? {...}`
      // when mc-sim hasn't attached state yet. Every OTHER Wither test in this
      // file supplies `witherState` explicitly, so that fallback object has
      // never been built. The default's `velocity` comes from `facingRadians`
      // via `facingDirection`, so `facingRadians` is chosen here to give sin
      // and cos a distinguishable, non-zero pair -- proving the derivation
      // actually ran rather than merely returning zeroes by coincidence.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const facingRadians = Math.PI / 2
      const feetPosition = { x: 5, y: 6, z: 7 }
      const expectedDefaultState = {
        phase: 'airborne' as const,
        healthPoints: 300,
        chargeRemainingSecs: 0,
        feetPosition,
        velocity: { x: -Math.sin(facingRadians), y: 0, z: -Math.cos(facingRadians) },
      }
      const visual = resolvedWitherPlan(expectedDefaultState)
      const [firstPart] = visual.parts

      yield* renderer.syncEntities([
        {
          id: 'wither-no-state',
          kind: 'wither',
          feetPosition,
          facingRadians,
        },
      ])

      expect(three.scene().members()).toHaveLength(visual.parts.length)
      expect(three.meshes()[0]?.rotations()[0]?.[1]).toBeCloseTo(visual.yawRadians, 12)
      expect(three.meshes()[0]?.positions()[0]?.[1]).toBeCloseTo(
        visual.position.y + (firstPart?.center[1] ?? 0),
        12,
      )
    }),
  )

  it.effect('defaults Wither-skull direction from facing when the entity carries no projectile', () =>
    Effect.gen(function* () {
      // Same fallback shape as above, for `planWitherSkullEntityVisual`'s
      // `entity.witherSkullProjectile ?? {...}`. Every other skull test in
      // this file supplies `witherSkullProjectile` explicitly.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const facingRadians = Math.PI / 2
      const feetPosition = { x: 1, y: 2, z: 3 }
      const expectedDefaultProjectile = {
        kind: 'wither_skull' as const,
        variant: 'normal' as const,
        origin: feetPosition,
        direction: { x: -Math.sin(facingRadians), y: 0, z: -Math.cos(facingRadians) },
        speed: 0,
        explosivePower: 0,
        destroysResistantBlocks: false,
      }
      const visual = resolvedSkullPlan(expectedDefaultProjectile)

      yield* renderer.syncEntities([
        {
          id: 'skull-no-projectile',
          kind: 'wither_skull',
          feetPosition,
          facingRadians,
        },
      ])

      expect(three.scene().members()).toHaveLength(visual.parts.length)
      expect(three.meshes()[0]?.positions()[0]).toStrictEqual([feetPosition.x, feetPosition.y, feetPosition.z])
      expect(three.meshes()[0]?.rotations()[0]?.[1]).toBeCloseTo(visual.yawRadians, 12)
    }),
  )
})

describe('drawing', () => {
  it.effect('retains the post-processing plan supplied by the draw port', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const quality = {
        ...QUALITY_PRESETS.high,
        ssaoEnabled: true,
        godRaysEnabled: false,
        bloomEnabled: true,
        dofEnabled: false,
        smaaEnabled: true,
        useCompositePass: true,
      }
      const chain = buildPostProcessingChain(quality)

      yield* renderer.setPostProcessingChain(chain)

      expect(yield* renderer.postProcessingChain).toStrictEqual(chain)
    }),
  )

  it.effect('manually culls a batch of chunk AABBs and disables Three sphere culling', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, { width: 100, height: 100 })

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad({ lz: -10 })]))
      yield* renderer.setChunk(chunkKeyOf(chunkCoord(1, 0)), buildChunkGeometry([quad({ lz: 10 })]))
      yield* renderer.setChunk(chunkKeyOf(chunkCoord(2, 0)), buildChunkGeometry([quad({ lx: 20, lz: -10 })]))
      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 0, 0, 0)))

      expect(three.meshes().map(({ frustumCulled }) => frustumCulled)).toStrictEqual([
        false,
        false,
        false,
      ])
      expect(three.meshes().map(({ visible }) => visible)).toStrictEqual([true, false, false])
      expect(three.renderer().renderCalls()).toBe(1)
    }),
  )

  it.effect('uses the supplied host distance during every chunk visibility update', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        renderDistance: RenderDistanceChunks(2),
      })
      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad({ lz: -10 })]))
      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 0, 0, 0)))

      expect(three.meshes().map(({ visible }) => visible)).toStrictEqual([true])
    }),
  )

  it.effect('propagates render-distance key failures through draw as typed results', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        renderDistance: RenderDistanceChunks(2),
      })
      const setMalformedChunk = setChunkWithRuntimeKey(renderer,
        'not-a-chunk-key',
        buildChunkGeometry([quad()]),
      )
      yield* setMalformedChunk

      const drawResult = yield* Effect.result(renderer.draw(mirroredCameraState(poseAt(0, 64, 0, 0, 0))))
      expect(Result.isFailure(drawResult)).toBe(true)
      if (Result.isFailure(drawResult)) {
        const decoded = Schema.decodeUnknownResult(RenderDistanceCullingErrorSchema)(drawResult.failure)
        expect(Result.isSuccess(decoded)).toBe(true)
        if (Result.isSuccess(decoded)) {
          expect(decoded.success.reason).toBe('invalid-chunk-key')
        }
      }
    }),
  )

  it.effect('re-evaluates empty chunks and viewport aspect before each draw', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, { width: 100, height: 100 })

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad({ lx: 10, lz: -10 })]))
      yield* renderer.setChunk(chunkKeyOf(chunkCoord(1, 0)), buildChunkGeometry([]))
      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 0, 0, 0)))
      expect(three.meshes().map(({ visible }) => visible)).toStrictEqual([false])

      yield* renderer.resize(200, 100)
      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 0, 0, 0)))
      expect(three.meshes().map(({ visible }) => visible)).toStrictEqual([true])
    }),
  )

  it.effect('the camera is WRITTEN from the mirrored pose, and cannot be read back', () =>
    Effect.gen(function* () {
      // plan.md §3.8's inversion, checked at the one place it could reappear.
      // The pose arrives as a VALUE from `domain/camera-mirror.ts` and lands on
      // the live camera; nothing in `ThreeSurface` can read a camera, so there
      // is no expressible way for the live object to become a source of truth.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const mirrored = mirroredCameraState(poseAt(10, 64, -20, 0.5, -0.25))

      yield* renderer.draw(mirrored)

      expect(three.camera().poses()).toStrictEqual([
        { position: [10, 64, -20], rotation: [-0.25, 0.5, 0, 'YXZ'] },
      ])
    }),
  )

  it.effect("the euler order is 'YXZ', which is what keeps the horizon level", () =>
    Effect.gen(function* () {
      // `domain/camera-mirror.ts` carries the citation (ts-minecraft
      // `camera-stage.ts:67`) and the consequence: with the default 'XYZ',
      // yawing while pitched tilts the horizon. The surface's type pins the
      // literal, so this test is the runtime half of a claim the compiler
      // already makes — worth having because a future `DrawPort` that is not
      // this renderer would not be type-checked against the surface at all.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 0, 1, 1)))

      expect(three.camera().poses()[0]?.rotation[3]).toBe('YXZ')
    }),
  )

  it.effect('every draw submits exactly one frame, and the count is observable', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const mirrored = mirroredCameraState(poseAt(0, 0, 0, 0, 0))

      expect(yield* renderer.framesRendered).toBe(0)
      yield* renderer.draw(mirrored)
      yield* renderer.draw(mirrored)
      yield* renderer.draw(mirrored)

      expect(three.renderer().renderCalls()).toBe(3)
      expect(yield* renderer.framesRendered).toBe(3)
    }),
  )

  it.effect('resize updates the drawing buffer AND the projection matrix', () =>
    Effect.gen(function* () {
      // three does not recompute the projection on assignment to `aspect`.
      // Without `updateProjectionMatrix` the world stretches on every resize
      // and nothing errors.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.resize(800, 600)

      expect(three.renderer().sizes()).toStrictEqual([
        [1280, 720, false],
        [800, 600, false],
      ])
      expect(three.camera().aspect).toBe(800 / 600)
      expect(three.camera().projectionUpdates()).toBe(1)
    }),
  )
})

describe('canvas weather', () => {
  it.effect('rejects invalid environment options before acquiring a renderer', () =>
    Effect.gen(function* () {
      for (const environment of [
        { daylight: Number.NaN },
        { daylight: 1 + Number.EPSILON },
        { farPlane: Number.POSITIVE_INFINITY },
        { farPlane: 0 },
        { dimension: 'moon' },
        { dimension: null },
      ]) {
        const three = makeFakeThree()
        const result = yield* Effect.result(makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, environment as never))
        expect(Result.isFailure(result)).toBe(true)
        expect(three.renderers()).toHaveLength(0)
      }
    }),
  )

  it.effect('rejects invalid weather options before acquiring a renderer', () =>
    Effect.gen(function* () {
      for (const weather of [
        { particleCapacity: Number.NaN },
        { particleCapacity: null },
        null,
      ]) {
        const three = makeFakeThree()
        const result = yield* Effect.result(makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
          weather: weather as never,
        }))
        expect(Result.isFailure(result)).toBe(true)
        expect(three.renderers()).toHaveLength(0)
      }
    }),
  )

  it.effect('reuses a bounded GPU buffer and clears it without residue', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        weather: { particleCapacity: 2 },
      })
      const rain = {
        mode: 'rain' as const,
        intensity: 1,
        daylight: 1,
        temperature: 0.8,
        seed: 42,
      }

      const first = yield* renderer.weather.frame(rain, { x: 10, y: 64, z: -5 })
      expect(first.particles).toHaveLength(2)
      // The resource owns a particle buffer and a separately preallocated
      // lightning buffer; rain keeps the latter attached but hidden.
      expect(three.geometries()).toHaveLength(2)
      expect(three.materials()).toHaveLength(2)
      expect(three.scene().members()).toHaveLength(2)
      const {
        lightningGeometry,
        lightningMesh,
        lightningPositionAttribute,
        particleGeometry,
        particleMesh,
        particlePositionAttribute,
      } = readWeatherResources(three)
      expect(particlePositionAttribute.array).toHaveLength(2 * 12 * 3)
      expect(lightningPositionAttribute.array).toHaveLength(3 * 8 * 2 * 12 * 3)
      expect(particleMesh.visible).toBe(true)
      expect(lightningMesh.visible).toBe(false)
      expect(particleGeometry.drawRanges()).toStrictEqual([
        [0, 0],
        [0, 24],
      ])
      expect(lightningGeometry.drawRanges()).toStrictEqual([
        [0, 0],
        [0, 0],
      ])
      expect(particlePositionAttribute.needsUpdate).toBe(true)

      yield* renderer.weather.frame(rain, { x: 10, y: 64, z: -5 })
      expect(three.geometries()).toHaveLength(2)
      expect(particleGeometry.attributes.get('position')?.array).toBe(particlePositionAttribute.array)
      expect(lightningGeometry.attributes.get('position')?.array).toBe(lightningPositionAttribute.array)
      expect(particleGeometry.drawRanges().at(-1)).toStrictEqual([0, 24])
      expect(lightningGeometry.drawRanges().at(-1)).toStrictEqual([0, 0])

      yield* renderer.resize(800, 600)
      yield* renderer.weather.frame(
        { ...rain, mode: 'clear' as const },
        { x: 10, y: 64, z: -5 },
      )
      expect(particleGeometry.disposed()).toBe(true)
      expect(lightningGeometry.disposed()).toBe(true)
      expect(three.materials()[1]?.disposed()).toBe(true)
      expect(three.scene().members()).toStrictEqual([])
    }),
  )

  it.effect('disposes active thunder precipitation with the world renderer', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      yield* renderer.weather.frame(
        {
          mode: 'thunder',
          intensity: 1,
          daylight: 0.5,
          temperature: 0.8,
          seed: 9,
          lightningSequence: 1,
        },
        { x: 0, y: 70, z: 0 },
      )

      yield* renderer.dispose
      expect(three.geometries().map((geometry) => geometry.disposed())).toStrictEqual([true, true])
      expect(three.scene().members()).toStrictEqual([])
    }),
  )
})

describe('optional host-owned post-processing compositor', () => {
  it.effect('routes draw, resize and dispose through the supplied compositor instead of rendering directly', () =>
    Effect.gen(function* () {
      // `options.postProcessing` (application/world-renderer.ts:556) is the
      // port a host with a real compositor supplies. Every OTHER test in this
      // file is headless and omits it, so `createRendererSurface`'s
      // `options.postProcessing?.(...)` call and every `if (postProcessing)` /
      // `postProcessing?.` branch downstream have never taken their
      // "supplied" side. This test supplies one and checks that the direct
      // `renderer.render` path is bypassed, not merely that nothing throws.
      const three = makeFakeThree()
      let renderCallCount = 0
      let lastRenderChain: unknown = undefined
      const resizeCalls: Array<readonly [number, number]> = []
      let disposeCalls = 0
      let constructedViewport: { readonly width: number; readonly height: number } | undefined =
        undefined

      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        postProcessing: (surface) => {
          constructedViewport = surface.viewport
          return {
            render: (chain) => {
              renderCallCount += 1
              lastRenderChain = chain
            },
            resize: (width, height) => {
              resizeCalls.push([width, height])
            },
            dispose: () => {
              disposeCalls += 1
            },
          }
        },
      })

      expect(constructedViewport).toStrictEqual(VIEWPORT)

      const chain = yield* renderer.postProcessingChain
      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 0, 0, 0)))

      expect(renderCallCount).toBe(1)
      expect(lastRenderChain).toBe(chain)
      // The compositor took the frame -- three's own `render` must not have.
      expect(three.renderer().renderCalls()).toBe(0)

      yield* renderer.resize(800, 600)
      expect(resizeCalls).toStrictEqual([[800, 600]])

      yield* renderer.dispose
      expect(disposeCalls).toBe(1)
    }),
  )
})

describe('three-weather-runtime: direct precipitation resource construction', () => {
  it.effect(
    'builds snow particles at the snow radius/height, colored near-white -- "canvas weather" above only ever drives kind "rain"',
    () =>
      Effect.gen(function* () {
        // `particleRadiusFor`/`particleHeightFor`/`particleColorFor`
        // (application/three-weather-runtime.ts) each branch on `kind`, and
        // every "canvas weather" test above reaches this module only through
        // `mode: 'rain'` or `'thunder'`, both of which resolve to `kind:
        // 'rain'` (domain/weather-rendering.ts's `precipitationFor`). This
        // constructs the resource directly with `kind: 'snow'` to exercise
        // the other side of each branch, and checks the actual buffer bytes
        // written rather than only that the call does not throw.
        const three = makeFakeThree()
        const scene = new three.Scene()
        const resource = makeThreeWeatherPrecipitation({
          capacity: 1,
          kind: 'snow',
          scene,
          three,
        })

        yield* resource.update([
          { id: 1, kind: 'snow', velocityY: -2.4, opacity: 1, x: 0, y: 0, z: 0 },
        ])

        const [geometry] = three.geometries()
        const positions = geometry?.attributes.get('position')?.array
        const colors = geometry?.attributes.get('color')?.array
        // The particle's first written corner is (x - radius, y, z - radius);
        // snow's radius is 0.12, distinct from rain's 0.025. Precision 6, not
        // the 12 used elsewhere in this file for `number` math: `positions`
        // is a `Float32Array`, whose ~7 significant decimal digits cannot
        // hold `-0.12` exactly.
        expect(positions?.[0] ?? Number.NaN).toBeCloseTo(-0.12, 6)
        expect(positions?.[2] ?? Number.NaN).toBeCloseTo(-0.12, 6)
        // Snow's near-white color (245, 249, 255), distinct from rain's pale blue.
        expect(Array.from(colors?.slice(0, 3) ?? [])).toStrictEqual([245, 249, 255])
      }),
  )

  it.effect('dispose is idempotent: a second dispose does not re-release the scene', () =>
    Effect.gen(function* () {
      // Guards `three-weather-runtime.ts`'s `if (disposed) {return}` in
      // `dispose`. The resource owns both the particle mesh and the lightning
      // mesh, so the first dispose removes two distinct objects exactly once.
      const three = makeFakeThree()
      const scene = new three.Scene()
      let removeCalls = 0
      const removedObjects: Array<ThreeObject3D> = []
      const originalRemove = scene.remove
      const countingScene: ThreeScene = {
        add: scene.add,
        remove: (object) => {
          removeCalls += 1
          removedObjects.push(object)
          originalRemove(object)
        },
      }
      const resource = makeThreeWeatherPrecipitation({
        capacity: 4,
        kind: 'rain',
        scene: countingScene,
        three,
      })
      const ownedMeshes = [...three.meshes()]
      expect(ownedMeshes).toHaveLength(2)
      expect(three.scene().members()).toHaveLength(2)

      yield* resource.dispose
      expect(removeCalls).toBe(2)
      expect(removedObjects).toStrictEqual(ownedMeshes)
      expect(three.geometries().map((geometry) => geometry.disposed())).toStrictEqual([true, true])
      expect(three.scene().members()).toStrictEqual([])

      yield* resource.dispose
      expect(removeCalls).toBe(2)
    }),
  )

  it.effect('update after dispose is a no-op: it does not resurrect the mesh or extend the draw range', () =>
    Effect.gen(function* () {
      // Guards `three-weather-runtime.ts`'s `if (disposed) {return}` in
      // `update`. Without it, updating with a non-empty particle list would
      // set `mesh.visible = true` and push a new draw range.
      const three = makeFakeThree()
      const scene = new three.Scene()
      const resource = makeThreeWeatherPrecipitation({
        capacity: 4,
        kind: 'rain',
        scene,
        three,
      })
      const [geometry] = three.geometries()
      const [mesh] = three.meshes()
      const drawRangeCountBeforeUpdate = geometry?.drawRanges().length

      yield* resource.dispose
      yield* resource.update([
        { id: 1, kind: 'rain', velocityY: -18, opacity: 1, x: 1, y: 2, z: 3 },
      ])

      expect(mesh?.visible).toBe(false)
      expect(geometry?.drawRanges().length).toBe(drawRangeCountBeforeUpdate)
    }),
  )

  it.effect('skips holes in a sparse particle list', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const scene = new three.Scene()
      const resource = makeThreeWeatherPrecipitation({
        capacity: 2,
        kind: 'rain',
        scene,
        three,
      })
      const particle = { id: 1, kind: 'rain' as const, velocityY: -2, opacity: 1, x: 0, y: 0, z: 0 }
      const particles = new Array<typeof particle>(2)
      particles[1] = particle

      yield* resource.update(particles)

      expect(three.meshes()[0]?.visible).toBe(true)
      yield* resource.dispose
    }),
  )
})

describe('teardown', () => {
  it.effect('dispose releases every chunk geometry, the material and the renderer', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad()]))
      yield* renderer.setChunk(chunkKeyOf(chunkCoord(1, 0)), buildChunkGeometry([quad()]))
      yield* renderer.dispose

      expect(three.geometries().map((geometry) => geometry.disposed())).toStrictEqual([true, true])
      expect(three.materials()[0]?.disposed()).toBe(true)
      expect(three.renderer().disposed()).toBe(true)
      expect(three.scene().members()).toStrictEqual([])
      expect(yield* renderer.chunkKeys).toStrictEqual([])
    }),
  )

  it.effect('dispose releases entity geometry and material with the renderer', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.syncEntities([
        { id: 'z', kind: 'zombie', feetPosition: { x: 0, y: 64, z: 0 } },
      ])
      yield* renderer.dispose

      expect(three.geometries().every((geometry) => geometry.disposed())).toBe(true)
      expect(three.materials()[1]?.disposed()).toBe(true)
      expect(three.scene().members()).toStrictEqual([])
      expect(yield* renderer.entityCount).toBe(0)
      expect(yield* renderer.entitySnapshot).toStrictEqual([])
    }),
  )

  it.effect('dispose is idempotent: a second call releases nothing twice', () =>
    Effect.gen(function* () {
      // A page can unload while a teardown is already running, and a double
      // release of a GPU resource is the kind of thing that works everywhere
      // except the one driver a player has.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk(chunkKeyOf(chunkCoord(0, 0)), buildChunkGeometry([quad()]))
      yield* renderer.dispose
      yield* renderer.dispose

      expect(three.geometries()).toHaveLength(1)
      expect(yield* renderer.chunkKeys).toStrictEqual([])
    }),
  )
})

describe('NO_DRAW_TARGET', () => {
  it.effect('does nothing, and says so by doing nothing', () =>
    Effect.gen(function* () {
      // The honest absence, on the same terms as `UNAVAILABLE_POINTER_LOCK`. It
      // is deliberately NOT a fake that counts frames or pretends to draw: a
      // stage running against this has genuinely not drawn, and nothing
      // downstream is told otherwise. `RenderFrameState.framesDrawn` counts the
      // STAGE; `WorldRenderer.framesRendered` counts the GPU; the difference
      // between them is exactly the headless frames.
      yield* NO_DRAW_TARGET.draw(mirroredCameraState(poseAt(0, 0, 0, 0, 0)))
      yield* NO_DRAW_TARGET.resize(1, 1)
      yield* NO_DRAW_TARGET.setPostProcessingChain([])

      expect(Object.keys(NO_DRAW_TARGET).toSorted()).toStrictEqual([
        'draw',
        'resize',
        'setPostProcessingChain',
      ])
    }),
  )
})

describe('makeProductionWorldRenderer', () => {
  it.effect('owns the atlas shaders, animated water, and shared particle system', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const atlas = { name: 'terrain-atlas' }
      const renderer = yield* makeProductionWorldRenderer(three, FAKE_CANVAS, VIEWPORT, atlas, {
        particles: { capacity: 4 },
      })

      expect(three.materials()).toHaveLength(0)
      expect(three.shaderMaterials()).toHaveLength(5)
      const shaderMaterials = three.shaderMaterials()
      const cutoutMaterial = shaderMaterials.find(({ uniforms }) => uniforms['uAlphaTest']?.value === 0.1)
      const transparentSolidMaterial = shaderMaterials.find(({ transparent, uniforms }) =>
        transparent === true && uniforms['uAlphaTest']?.value === 0,
      )
      if (cutoutMaterial === undefined || transparentSolidMaterial === undefined) {
        throw new Error('the production renderer must build cutout and blended chunk materials')
      }
      expect(renderer.chunkMaterial.uniforms['uAtlas']?.value).toBe(atlas)
      expect(cutoutMaterial.alphaTest).toBe(0.1)
      expect(cutoutMaterial.uniforms['uAlphaTest']?.value).toBe(0.1)
      expect(transparentSolidMaterial.transparent).toBe(true)
      expect(transparentSolidMaterial.depthWrite).toBe(false)
      expect(renderer.waterMaterial.transparent).toBe(true)
      expect(renderer.waterMaterial.depthWrite).toBe(false)
      expect(renderer.waterMaterial.forceSinglePass).toBe(true)
      expect(three.shaderMaterials()[4]?.uniforms['uAtlas']?.value).toBe(atlas)
      expect(three.scene().members()).toContain(renderer.particles.mesh)

      const layerBuffers = buildChunkGeometry([quad()])
      yield* renderer.setChunks([{
        buffers: buildChunkGeometry([]),
        key: chunkKeyOf(chunkCoord(0, 0)),
        transparentSolidBuffers: layerBuffers,
        waterBuffers: layerBuffers,
      }])
      const translucentMeshes = three.meshes().filter(({ material }) =>
        material === transparentSolidMaterial,
      )
      expect(translucentMeshes.map(({ material }) => material)).toStrictEqual([transparentSolidMaterial])

      yield* renderer.setEnvironment(renderEnvironmentPlan(0.25))
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
      const chunkTimeUniforms = (): ReadonlyArray<unknown> => three.shaderMaterials()
        .filter(({ uniforms }) => uniforms['uAlphaTest'] !== undefined)
        .map(({ uniforms }) => uniforms['uTime']?.value)
      expect(chunkTimeUniforms()).toStrictEqual([2, 2, 2])
      expect(renderer.waterUniforms['uCameraPosition']?.value).toStrictEqual([4, 5, 6])
      expect(transparentSolidMaterial.uniforms['uCameraPosition']?.value).toStrictEqual([4, 5, 6])
      expect(three.instancedGeometries()[0]?.instanceCount).toBe(1)

      const pausedChunkTimes = chunkTimeUniforms()
      yield* renderer.advanceFrame({
        ...makeAnimationClockInput(40, 0, 6000),
        deltaSecs: decodeDelta(0),
        cameraPosition: { worldX: 4, worldY: 5, worldZ: 6 },
      })
      expect(chunkTimeUniforms()).toStrictEqual(pausedChunkTimes)
      expect(renderer.waterUniforms['uTime']?.value).toBe(2)

      yield* renderer.resize(640, 360)
      expect(renderer.waterUniforms['uResolution']?.value).toStrictEqual([640, 360])
      expect(transparentSolidMaterial.uniforms['uResolution']?.value).toStrictEqual([640, 360])

      delete transparentSolidMaterial.uniforms['uResolution']
      yield* renderer.resize(320, 180)
      expect(transparentSolidMaterial.uniforms['uResolution']).toBeUndefined()

      yield* renderer.dispose
      expect(three.scene().members()).toStrictEqual([])
      expect(three.shaderMaterials().every((material) => material.disposed())).toBe(true)
      expect(three.renderer().disposed()).toBe(true)
    }),
  )

  it.effect('tolerates optional water uniforms being absent', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeProductionWorldRenderer(three, FAKE_CANVAS, VIEWPORT, { name: 'terrain-atlas' }, {
        particles: { capacity: 1 },
      })

      delete renderer.waterUniforms['uSunIntensity']
      delete renderer.waterUniforms['uTime']
      delete renderer.waterUniforms['uCameraPosition']
      delete renderer.waterUniforms['uResolution']
      const chunkMaterials = three.shaderMaterials().filter(({ uniforms }) => uniforms['uAlphaTest'] !== undefined)
      for (const { uniforms } of chunkMaterials) {
        delete uniforms['uTime']
      }

      applyChunkShaderEnvironment({}, renderEnvironmentPlan(0.5))
      yield* renderer.setEnvironment(renderEnvironmentPlan(0.5))
      yield* renderer.advanceFrame({
        ...makeAnimationClockInput(20, 0, 1200),
        deltaSecs: decodeDelta(0.01),
        cameraPosition: { worldX: 1, worldY: 2, worldZ: 3 },
      })
      yield* renderer.resize(320, 200)
      yield* renderer.dispose
    }),
  )

  it.effect('propagates invalid pool configuration and frame delta as typed Effect failures', () =>
    Effect.gen(function* () {
      const invalidPoolResult = yield* Effect.result(makeProductionWorldRenderer(
        makeFakeThree(),
        FAKE_CANVAS,
        VIEWPORT,
        { name: 'terrain-atlas' },
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
        { name: 'terrain-atlas' },
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
      const renderer = yield* makeProductionWorldRenderer(three, FAKE_CANVAS, VIEWPORT, { name: 'terrain-atlas' }, {
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
