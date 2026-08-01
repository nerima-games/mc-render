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
import { Effect } from 'effect'
import { mirroredCameraState } from '../src/domain/camera-mirror'
import { buildChunkGeometry, type MeshQuad } from '../src/domain/chunk-geometry'
import { MonotonicTimeSecs, position, type CameraPoseSnapshot } from '../src/domain/kernel-vocabulary'
import {
  CAMERA_FAR_PLANE,
  CAMERA_FOV_DEGREES,
  CAMERA_NEAR_PLANE,
  makeWorldRenderer,
  NO_DRAW_TARGET,
  SKY_CLEAR_ALPHA,
  SKY_CLEAR_COLOR,
} from '../src/application/world-renderer'
import { FAKE_CANVAS, makeFakeThree } from './support/fake-three'
import { planRenderEnvironment } from '../src/domain/render-environment'
import { planMobVisual } from '../src/domain/mob-visual'

const VIEWPORT = { width: 1280, height: 720 }

const quad = (overrides: Partial<MeshQuad> = {}): MeshQuad => ({
  blockId: 1,
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
  yawRadians: yaw,
  pitchRadians: pitch,
  capturedAtSecs: MonotonicTimeSecs(1),
})

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
      const night = planRenderEnvironment(0, CAMERA_FAR_PLANE)

      yield* renderer.setEnvironment(night)

      expect(applied).toStrictEqual([planRenderEnvironment(1, CAMERA_FAR_PLANE), night])
      expect(three.renderer().clearColors()).toStrictEqual([
        [SKY_CLEAR_COLOR, SKY_CLEAR_ALPHA],
        [night.skyColor, SKY_CLEAR_ALPHA],
      ])
    }),
  )

  it.effect('builds the camera from the transcribed constants and the real aspect', () =>
    Effect.gen(function* () {
      // fov 75 / near 0.1 from `session-bootstrap-scene.ts:47,49`; far 300 is
      // the FLOOR of that file's :50 expression, which this repository cannot
      // evaluate because two of its three inputs live in unpublished siblings.
      // `world-renderer.ts` says so at the constant rather than presenting 300
      // as derived.
      const three = makeFakeThree()
      yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      expect(three.camera().fov).toBe(CAMERA_FOV_DEGREES)
      expect(three.camera().near).toBe(CAMERA_NEAR_PLANE)
      expect(three.camera().far).toBe(CAMERA_FAR_PLANE)
      expect(three.camera().aspect).toBe(1280 / 720)
      expect([CAMERA_FOV_DEGREES, CAMERA_NEAR_PLANE, CAMERA_FAR_PLANE]).toStrictEqual([75, 0.1, 300])
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

      yield* renderer.setChunk('0,0', buildChunkGeometry([quad()]))
      yield* renderer.setChunk('1,0', buildChunkGeometry([quad()]))

      expect(three.materials()).toHaveLength(1)
      expect(three.materials()[0]?.vertexColors).toBe(true)
      expect(three.materials()[0]?.wireframe).toBe(false)
      expect(three.meshes().map((mesh) => mesh.material)).toStrictEqual([
        three.materials()[0],
        three.materials()[0],
      ])
    }),
  )
})

describe('chunk geometry in the scene', () => {
  it.effect('setChunk builds the five attributes with the reference item sizes and flags', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)
      const buffers = buildChunkGeometry([quad()])

      yield* renderer.setChunk('0,0', buffers)

      const geometry = three.geometries()[0]
      expect([...(geometry?.attributes.keys() ?? [])]).toStrictEqual([
        'position',
        'normal',
        'color',
        'uv',
        // Uploaded on BOTH material paths although only the shader samples it.
        // A missing attribute does not fail: GL feeds 0 to an unbound one, so
        // the whole world would draw from atlas tile 0 with nothing reported.
        'tileIndex',
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
      expect(geometry?.index()).toStrictEqual({
        array: buffers.indices,
        itemSize: 1,
        normalized: false,
      })
    }),
  )

  it.effect('the bounding sphere is computed before the geometry is ever rendered', () =>
    Effect.gen(function* () {
      // Not lazily. three computes it on demand and warns "Computed radius is
      // NaN" for an empty position attribute — and an empty chunk is the normal
      // case at the edge of the loaded world, not an error.
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk('0,0', buildChunkGeometry([]))

      expect(three.geometries()[0]?.boundingSphereComputations()).toBe(1)
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

      yield* renderer.setChunk('0,0', buildChunkGeometry([quad()]))
      const first = three.geometries()[0]
      yield* renderer.setChunk('0,0', buildChunkGeometry([quad({ ao: 2 })]))

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

      yield* renderer.setChunk('0,0', buildChunkGeometry([quad()]))
      yield* renderer.removeChunk('0,0')

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

      yield* renderer.setChunk('0,0', buildChunkGeometry([quad()]))
      yield* renderer.removeChunk('9,9')

      expect(three.scene().members()).toHaveLength(1)
      expect(yield* renderer.chunkKeys).toStrictEqual(['0,0'])
      expect(three.geometries()[0]?.disposed()).toBe(false)
    }),
  )

  it.effect('several chunks coexist, one mesh each', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk('0,0', buildChunkGeometry([quad()]))
      yield* renderer.setChunk('1,0', buildChunkGeometry([quad()]))
      yield* renderer.setChunk('0,1', buildChunkGeometry([quad()]))

      expect(three.scene().members()).toHaveLength(3)
      expect((yield* renderer.chunkKeys).toSorted()).toStrictEqual(['0,0', '0,1', '1,0'])
    }),
  )
})

describe('entity meshes in the scene', () => {
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
        (total, kind) => total + planMobVisual(kind).parts.length,
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

  it.effect('removes missing ids while retaining shared resources until renderer disposal', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk('0,0', buildChunkGeometry([quad()]))
      yield* renderer.syncEntities([
        { id: 'z', kind: 'zombie', feetPosition: { x: 0, y: 64, z: 0 } },
      ])
      const entityGeometries = three.geometries().slice(1)
      const entityMaterial = three.materials()[1]
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
      const entityMaterial = three.materials()[1]
      yield* renderer.syncEntities([
        { id: 'same', kind: 'creeper', feetPosition: { x: 1, y: 0, z: 0 } },
      ])

      const currentMeshes = three.scene().members()
      expect(previousMeshes).toHaveLength(planMobVisual('zombie').parts.length)
      expect(currentMeshes).toHaveLength(planMobVisual('creeper').parts.length)
      expect(currentMeshes.every((mesh) => !previousMeshes.includes(mesh))).toBe(true)
      expect(previousGeometries.every((geometry) => !geometry.disposed())).toBe(true)
      expect(three.materials()[1]).toBe(entityMaterial)
    }),
  )

  it.effect('renders unknown kinds through the stable fallback silhouette', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.syncEntities([
        { id: 'future', kind: 'not-yet-supported', feetPosition: { x: 4, y: 5, z: 6 } },
      ])

      const fallback = planMobVisual('not-yet-supported')
      expect(fallback.descriptorKind).toBe('unknown')
      expect(three.scene().members()).toHaveLength(fallback.parts.length)
      expect(three.meshes()[0]?.positions()).toStrictEqual([[4, 5.65, 6]])
    }),
  )
})

describe('drawing', () => {
  it.effect('manually culls a batch of chunk AABBs and disables Three sphere culling', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, { width: 100, height: 100 })

      yield* renderer.setChunk('front', buildChunkGeometry([quad({ lz: -10 })]))
      yield* renderer.setChunk('behind', buildChunkGeometry([quad({ lz: 10 })]))
      yield* renderer.setChunk('side', buildChunkGeometry([quad({ lx: 20, lz: -10 })]))
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

  it.effect('re-evaluates empty chunks and viewport aspect before each draw', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, { width: 100, height: 100 })

      yield* renderer.setChunk('edge', buildChunkGeometry([quad({ lx: 10, lz: -10 })]))
      yield* renderer.setChunk('empty', buildChunkGeometry([]))
      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 0, 0, 0)))
      expect(three.meshes().map(({ visible }) => visible)).toStrictEqual([false, false])

      yield* renderer.resize(200, 100)
      yield* renderer.draw(mirroredCameraState(poseAt(0, 0, 0, 0, 0)))
      expect(three.meshes().map(({ visible }) => visible)).toStrictEqual([true, false])
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
      expect(three.geometries()).toHaveLength(1)
      expect(three.materials()).toHaveLength(2)
      expect(three.scene().members()).toHaveLength(1)
      const geometry = three.geometries()[0]
      const position = geometry?.attributes.get('position')
      expect(geometry?.drawRanges()).toStrictEqual([
        [0, 0],
        [0, 24],
      ])
      expect(position?.needsUpdate).toBe(true)

      yield* renderer.weather.frame(rain, { x: 10, y: 64, z: -5 })
      expect(three.geometries()).toHaveLength(1)
      expect(geometry?.attributes.get('position')?.array).toBe(position?.array)
      expect(geometry?.drawRanges().at(-1)).toStrictEqual([0, 24])

      yield* renderer.resize(800, 600)
      yield* renderer.weather.frame(
        { ...rain, mode: 'clear' as const },
        { x: 10, y: 64, z: -5 },
      )
      expect(geometry?.disposed()).toBe(true)
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
      expect(three.geometries()[0]?.disposed()).toBe(true)
      expect(three.scene().members()).toStrictEqual([])
    }),
  )
})

describe('teardown', () => {
  it.effect('dispose releases every chunk geometry, the material and the renderer', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk('0,0', buildChunkGeometry([quad()]))
      yield* renderer.setChunk('1,0', buildChunkGeometry([quad()]))
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

      yield* renderer.setChunk('0,0', buildChunkGeometry([quad()]))
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

      expect(Object.keys(NO_DRAW_TARGET).toSorted()).toStrictEqual(['draw', 'resize'])
    }),
  )
})
