/**
 * The base renderer: the GPU-owning scene and mesh boundary.
 *
 * `domain/chunk-geometry.ts` is the pure half — quads to typed arrays, testable
 * in Node. This is the half that cannot be pure: it acquires a WebGL2 context,
 * owns the live `Scene`, `PerspectiveCamera` and per-chunk `Mesh` objects, and
 * makes the one `renderer.render(scene, camera)` call that `render:draw` exists
 * to place in the frame.
 *
 * The core remains platform-neutral through `application/three-surface.ts`.
 * The concrete browser entry in `src/browser.ts` supplies Three's namespace and
 * may install an EffectComposer without pulling DOM or Three types into this
 * core project.
 * Production composition lives in `world-renderer-production.ts`; it adds the
 * atlas shader, water and instanced-particle resources on this base contract.
 *
 * ---------------------------------------------------------------------------
 * THE DIRECTION OF THE CAMERA COPY, WHICH IS THE WHOLE POINT OF THE REPOSITORY
 * ---------------------------------------------------------------------------
 *
 * `draw` takes a `MirroredCameraState` and WRITES it onto the live camera. It
 * never reads the live camera and never hands it out — `ThreeSurface` does not
 * even expose a way to read one back, which is not an accident of the seven
 * members chosen but the reason those seven are the ones chosen.
 *
 * plan.md §3.8 records the inversion this prevents as the reference's worst
 * structural bug: the reference mutates the live camera for the attack-swing
 * bob and restores it afterwards, so everything reading the camera in between
 * gets the bob pose. `domain/camera-mirror.ts` composes the offset into a
 * VALUE, and this file consumes the value. There is no window in which the live
 * camera is a source of truth about anything, because nothing can ask it.
 *
 * ---------------------------------------------------------------------------
 * Why `DrawPort` has a do-nothing default
 * ---------------------------------------------------------------------------
 *
 * Exactly the reason `UNAVAILABLE_POINTER_LOCK` does. `render:draw` is a stage
 * and stages run in Node — in `test/stage-registration.test.ts`, in
 * `apps/preview-render`, and in any consumer that composes the module to
 * inspect the frame order. "There is no GPU here" is a real state and it is the
 * common one; a stage that required a renderer would make the module
 * unregisterable outside a browser, which is the property `renderModule` was
 * built to avoid.
 *
 * `NO_DRAW_TARGET` therefore counts frames and draws nothing, and the stage
 * body is identical in both cases. What a browser host adds is a port, not a
 * branch.
 */
import {
  type AxisAlignedBounds,
  aabbIntersectsPreparedPerspectiveFrustum,
  boundsFromPositions,
  preparePerspectiveFrustum,
} from '../domain/frustum-culling'
import { CHUNK_HEIGHT, CHUNK_SIZE } from '@nerima-games/mc-meshing'
import {
  COLOR_COMPONENTS,
  type ChunkGeometryBuffers,
  FLUID_DIRECTION_COMPONENTS,
  FLUID_FALLING_COMPONENTS,
  NORMAL_COMPONENTS,
  POSITION_COMPONENTS,
  TILE_INDEX_COMPONENTS,
  UV_COMPONENTS,
} from '../domain/chunk-geometry'
import {
  DAY_SKY_COLOR,
  type RenderEnvironmentPlan,
  planRenderEnvironment,
} from '../domain/render-environment'
import { Effect, Ref } from 'effect'
import {
  FULL_SUN_INTENSITY,
  type Viewport,
} from './world-renderer-materials'
import {
  type RenderEntity,
  copyRenderEntity,
  planEntityVisual,
} from './entity-visual-plan'
import type {
  ThreeBufferGeometry,
  ThreeCamera,
  ThreeEuler,
  ThreeMaterial,
  ThreeMesh,
  ThreePerspectiveCamera,
  ThreeScene,
  ThreeSurface,
  ThreeVector3,
  ThreeWebGLRenderer,
} from './three-surface'
import {
  type VehicleCameraContext,
  type VehicleRenderPlan,
  planVehicleVisual,
} from '../domain/vehicle-visual'
import { type WeatherRenderer, makeWeatherRenderer } from './weather-renderer'
import { CHUNK_SHADER_ATTRIBUTES } from '../domain/chunk-shader'
import type { MirroredCameraState } from '../domain/camera-mirror'
import type { PostProcessingStep } from '../domain/post-processing'
import type { Vehicle } from '@nerima-games/mc-sim'
import type { WeatherFrameOptions } from '../domain/weather-rendering'
import { makeThreeWeatherPrecipitation } from './three-weather-runtime'
import { makeUnitCubeBuffers } from './world-renderer-geometry'

export {
  FULL_SUN_INTENSITY,
  REFRACTION_UNAVAILABLE,
  UNIFORM_ORIGIN,
  applyChunkShaderEnvironment,
  makeChunkShaderMaterial,
  makeWaterMaterial,
} from './world-renderer-materials'
export type { ChunkShaderMaterial, Viewport } from './world-renderer-materials'

/**
 * Vertical field of view, in degrees.
 *
 * TRANSCRIBED from ts-minecraft
 * `packages/app/application/main/session-bootstrap-scene.ts:47` (`fov: 75`),
 * which is also the default of its settings service
 * (`packages/game/application/settings-service.ts:27`) and the centre of the
 * range its schema permits, 30-110
 * (`packages/game/application/settings.schema.ts:53`).
 *
 * It is a CONSTANT here and a setting there, and that is a statement about what
 * is missing rather than a decision: FOV belongs to the settings service, which
 * is mc-sim's, and mc-sim is not published. When it is, this becomes the
 * fallback for a value read from it.
 */
export const CAMERA_FOV_DEGREES = 75

/**
 * Near plane.
 *
 * TRANSCRIBED from `session-bootstrap-scene.ts:49` (`near: 0.1`).
 * TRANSCRIBED, NOT JUSTIFIED: nothing in this repository has established what
 * the near plane should be, and 0.1 world units is one tenth of a block. The
 * measurement that would justify it is the closest a first-person camera can
 * legally get to a block face, which is a collision-hull question and therefore
 * mc-physics'.
 */
export const CAMERA_NEAR_PLANE = 0.1

/**
 * Far plane.
 *
 * The reference computes this rather than fixing it —
 * `session-bootstrap-scene.ts:50`:
 *
 *   far: Math.max(initialSettings.renderDistance * CHUNK_SIZE * 1.5 + CHUNK_HEIGHT, 300)
 *
 * and 300 is the FLOOR of that expression, not the value it usually takes.
 * `renderDistance` is accepted at this renderer boundary so mc-sim can pass its
 * setting without making this package depend on the simulation layer. The chunk
 * dimensions come from mc-meshing's published constants. An explicit `farPlane`
 * still wins when a host needs a different projection.
 */
export const CAMERA_FAR_PLANE = 300

const RENDER_DISTANCE_FAR_PLANE_MARGIN = 1.5
const MIN_RENDER_DISTANCE = 0

/**
 * Resolve the camera far plane from the number of visible chunk columns.
 * Invalid and negative values retain the conservative renderer floor.
 */
export const cameraFarPlaneForRenderDistance = (renderDistance: number): number => {
  if (!Number.isFinite(renderDistance)) {
    return CAMERA_FAR_PLANE
  }
  const normalizedRenderDistance = Math.max(MIN_RENDER_DISTANCE, Math.trunc(renderDistance))
  return Math.max(
    normalizedRenderDistance * CHUNK_SIZE * RENDER_DISTANCE_FAR_PLANE_MARGIN + CHUNK_HEIGHT,
    CAMERA_FAR_PLANE,
  )
}

/** The fewest weather particles a capacity is ever clamped down to: none. */
const MIN_WEATHER_CAPACITY = 0

/** The weather particle capacity used when a host does not specify one. */
const DEFAULT_WEATHER_CAPACITY = 96

/** No frames have been submitted to the GPU yet. */
const INITIAL_FRAMES_RENDERED = 0

/** `BufferAttribute`'s item size for an index buffer: one index per slot. */
const INDEX_ITEM_SIZE = 1

/** No chunk updates: `setChunks` has nothing to do. */
const EMPTY_UPDATE_COUNT = 0

/**
 * What the frame is cleared to.
 *
 * TRANSCRIBED from ts-minecraft
 * `packages/app/application/main.config.ts:14`
 * (`export const SKY_COLOR_DAY = 0x87ceeb  // sky blue`). The reference drives
 * the clear colour from its day/night cycle
 * (`packages/app/application/frame/stages/lighting-stage.ts:23`,
 * `lights.renderer.setClearColor(lights.skyCurrent)`), interpolating between
 * this and `SKY_COLOR_NIGHT = 0x232a45`. There is no day/night cycle here and
 * no owner for one, so the day value is fixed.
 *
 * It is not a neutral choice and should not be made one. A canvas cleared to
 * black is indistinguishable from a canvas that failed to draw; a canvas
 * cleared to sky blue says the context was acquired and the frame ran.
 */
export const SKY_CLEAR_COLOR = DAY_SKY_COLOR

/** Opacity of the clear. Fully opaque: there is nothing behind the world. */
export const SKY_CLEAR_ALPHA = 1

/**
 * The one thing `render:draw` needs from a platform.
 *
 * Same shape and same discipline as `PointerLockPort` in
 * `application/input-service.ts`: an Effect-valued record, so that the stage
 * body is a `yield*` in both the real and the absent case and no stage ever
 * asks "is there a renderer".
 */
export type DrawPort = {
  /** Draw one frame from the mirrored pose. Never reads the live camera. */
  readonly draw: (camera: MirroredCameraState) => Effect.Effect<void>
  /** Tell the renderer the drawing surface changed size. */
  readonly resize: (width: number, height: number) => Effect.Effect<void>
  /** Select the immutable post-FX plan used by the next draw. */
  readonly setPostProcessingChain: (chain: ReadonlyArray<PostProcessingStep>) => Effect.Effect<void>
}
export type { EntityRenderCategory, RenderEntity } from './entity-visual-plan'

/**
 * "This platform has no GPU." The default, and true in Node and in every
 * preview that has not wired a canvas.
 *
 * Deliberately NOT a fake that pretends to draw. It is the honest absence, in
 * the same sense `UNAVAILABLE_POINTER_LOCK` is: a stage that runs against this
 * has genuinely not drawn, and nothing downstream is told otherwise.
 */
export const NO_DRAW_TARGET: DrawPort = {
  draw: () => Effect.void,
  resize: () => Effect.void,
  setPostProcessingChain: () => Effect.void,
}

/** How a chunk's geometry is keyed while it is in the scene. */
export type ChunkKey = string

/** One chunk replacement in an atomic renderer registry update. */
export type ChunkGeometryUpdate = {
  readonly key: ChunkKey
  readonly buffers: ChunkGeometryBuffers
}

/** A chunk's live scene mesh, its disposable geometry, and the bounds culling reads. */
type ChunkEntry<TGeometry> = {
  readonly mesh: ThreeMesh
  readonly geometry: TGeometry
  readonly bounds: AxisAlignedBounds | undefined
}

/**
 * The renderer, as its owner holds it.
 *
 * `DrawPort` is the part the FRAME needs; the rest is the part the chunk-sync
 * path needs, and they are one object because they share the scene. Splitting
 * them would mean two handles to one `Scene`, and the second one would be the
 * one somebody eventually adds a light to.
 */
export type WorldRenderer = DrawPort & {
  /** Canvas weather runtime. Call once per simulation frame. */
  readonly weather: WeatherRenderer
  /** Apply a precomputed sky, sun and fog state without recreating GPU resources. */
  readonly setEnvironment: (environment: RenderEnvironmentPlan) => Effect.Effect<void>
  /**
   * Put a chunk's geometry in the scene, replacing whatever was there.
   *
   * Replacing, not adding: mc-worldgen's dirty-chunk notification reports a
   * coordinate CHANGED, and the same coordinate changes repeatedly — a falling
   * column of sand dirties one chunk many times (docs/public-api.md §3.1). An
   * `addChunk` would leak a mesh per edit.
   */
  readonly setChunk: (key: ChunkKey, buffers: ChunkGeometryBuffers) => Effect.Effect<void>
  /**
   * Replace many chunks while copying the chunk registry only once.
   *
   * Updates are applied in order, so duplicate keys retain `setChunk`'s
   * replacement semantics and the final entry wins.
   */
  readonly setChunks: (updates: ReadonlyArray<ChunkGeometryUpdate>) => Effect.Effect<void>
  /**
   * Take a chunk out of the scene and release its GPU buffers.
   *
   * `BufferGeometry` needs an explicit `dispose()` — docs/public-api.md §3.3
   * lists "ジオメトリの破棄タイミング" as an open design question and this is the
   * half of the answer that is not open: whoever removes the mesh disposes the
   * geometry, in the same call, because there is no other moment at which the
   * renderer can know the geometry is unreferenced.
   */
  readonly removeChunk: (key: ChunkKey) => Effect.Effect<void>
  /** Which chunks are currently in the scene. Diagnostics and tests. */
  readonly chunkKeys: Effect.Effect<ReadonlyArray<ChunkKey>>
  /** Reconcile the complete visible entity set by stable entity id. */
  readonly syncEntities: (entities: ReadonlyArray<RenderEntity>) => Effect.Effect<void>
  /** Number of logical entities currently owned by the renderer. */
  readonly entityCount: Effect.Effect<number>
  /** Last reconciled renderer DTOs, detached from caller-owned values. */
  readonly entitySnapshot: Effect.Effect<ReadonlyArray<RenderEntity>>
  /** Reconcile renderer-owned boat and minecart meshes by stable vehicle id. */
  readonly syncVehicles: (
    vehicles: ReadonlyArray<Vehicle>,
    options?: VehicleSyncOptions,
  ) => Effect.Effect<void>
  /** Number of logical vehicles currently owned by the renderer. */
  readonly vehicleCount: Effect.Effect<number>
  /** Last reconciled vehicle snapshots, detached from caller-owned values. */
  readonly vehicleSnapshot: Effect.Effect<ReadonlyArray<Vehicle>>
  /** Frames actually submitted to the GPU by this renderer. */
  readonly framesRendered: Effect.Effect<number>
  /** The latest post-processing plan supplied by the frame pipeline. */
  readonly postProcessingChain: Effect.Effect<ReadonlyArray<PostProcessingStep>>
  /** Add a renderer-adjacent mesh, such as the shared particle pool. */
  readonly attachSceneObject: (object: ThreeMesh) => Effect.Effect<void>
  /** Remove an attached mesh without assuming ownership of its resources. */
  readonly detachSceneObject: (object: ThreeMesh) => Effect.Effect<void>
  /** Release the renderer, all cached geometry, and every shared material. */
  readonly dispose: Effect.Effect<void>
}

/** Pose data used to build one vehicle frame from the current simulation snapshot. */
export type VehicleSyncOptions = Readonly<{
  /** Matching previous snapshots used for interpolation. */
  readonly previous?: ReadonlyArray<Vehicle>
  /** Interpolation amount, clamped by the pure vehicle planner. */
  readonly interpolation?: number
  /** Camera context used to decide whether a local occupant is visible. */
  readonly camera?: VehicleCameraContext
}>

/**
 * How the one shared material gets built.
 *
 * A THUNK AND NOT A MATERIAL, so that the renderer still owns the lifetime. The
 * material is disposed in `dispose` alongside the geometries, and a caller that
 * handed over an already-constructed instance would have no way to know whether
 * it may still use it — `WorldRenderer` would be taking ownership of a value it
 * did not create, which is the one arrangement `DrawPort` and `LightSampler`
 * both avoid.
 *
 * The host closes over its own `three` namespace to write one. That is why this
 * takes no arguments: a factory parameterised by the surface would have to name
 * WHICH surface, and the textured path's is `ThreeShaderSurface` — a different
 * type with a fourth parameter. A thunk is agnostic to which one the host holds.
 */
export type MaterialFactory<TMaterial extends ThreeMaterial> = () => TMaterial

/** Everything a caller may vary. Each field's default is documented above. */
export type WorldRendererOptions<TMaterial extends ThreeMaterial = ThreeMaterial> = {
  readonly fovDegrees?: number
  readonly nearPlane?: number
  /** Chunk-column render distance used to derive the camera far plane. */
  readonly renderDistance?: number
  readonly farPlane?: number
  readonly clearColor?: number
  /** Initial daylight in the inclusive 0..1 range; invalid values are clamped by the planner. */
  readonly daylight?: number
  /** Port used by a shader material to receive the same plan as the canvas clear colour. */
  readonly applyMaterialEnvironment?: (environment: RenderEnvironmentPlan) => void
  /** Draw edges instead of filled faces. For diagnosing a geometry, not for play. */
  readonly wireframe?: boolean
  /**
   * Build the shared material. Defaults to the unlit `MeshBasicMaterial`.
   *
   * THIS IS THE SWITCH BETWEEN THE TWO LIGHTING PATHS, and it is a port rather
   * than a `textured: boolean` for the reason `DrawPort`'s header gives: what a
   * richer host adds is a port, not a branch. Supplying
   * `chunkShaderMaterialFactory` puts the renderer on the packed-light path that
   * `domain/chunk-shader.ts` decodes; supplying nothing leaves it on the grey
   * unlit one, which is what Node, `apps/preview-render` and every consumer
   * without an atlas image are honestly in.
   *
   * `wireframe` is ignored when this is supplied, because a `ShaderMaterial`
   * has no such flag — its rasterisation is its own source. That is a real
   * asymmetry and not an oversight: the wireframe option exists to diagnose a
   * geometry, and the geometry is the same on both paths.
   */
  readonly material?: MaterialFactory<TMaterial>
  readonly weather?: WeatherFrameOptions
  /** Optional host-owned compositor; absent in headless and preview renders. */
  readonly postProcessing?: PostProcessingRendererFactory
  /** Run after culling and immediately before the host or raw renderer draws. */
  readonly beforeRender?: (context: WorldRenderContext) => void
  /** Keep the WebGL drawing buffer for host-side screenshots. */
  readonly preserveDrawingBuffer?: boolean
}

export type PostProcessingRenderer = {
  readonly render: (chain: ReadonlyArray<PostProcessingStep>) => void
  readonly resize: (width: number, height: number) => void
  readonly dispose: () => void
}

export type PostProcessingRendererFactory = (surface: {
  readonly renderer: ThreeWebGLRenderer
  readonly scene: ThreeScene
  readonly camera: ThreeCamera
  readonly viewport: Viewport
}) => PostProcessingRenderer

export type WorldRenderContext = {
  readonly renderer: ThreeWebGLRenderer
  readonly scene: ThreeScene
  readonly camera: ThreeCamera
  readonly chain: ReadonlyArray<PostProcessingStep>
}

/**
 * `setSize`'s third argument, spelled out because the value is load-bearing.
 *
 * FALSE means "do not write an inline style on the canvas". ts-minecraft
 * `packages/rendering/infrastructure/renderer/renderer-service.ts:19-22`
 * carries the reason verbatim: "the canvas display size is owned by the CSS
 * 100vw/100vh rule. Letting three.js write a fixed-px inline style would freeze
 * clientWidth and break window-resize detection." mc-compose's `index.html`
 * sets exactly that rule on `#game-canvas`.
 */
const UPDATE_CANVAS_STYLE = false

/**
 * An aspect ratio that cannot produce a degenerate projection.
 *
 * A canvas that is not laid out yet reports `clientWidth === 0`, and 0/0 is
 * NaN. `PerspectiveCamera` accepts the NaN silently and every vertex projects
 * to nothing — a black screen with no error anywhere, which is the single
 * hardest renderer failure to attribute. One is the identity aspect and is
 * visibly wrong only in being square.
 */
/** The smallest usable viewport dimension: below this, the aspect ratio would be degenerate. */
const DEGENERATE_DIMENSION = 0
/** The identity aspect ratio: the safe fallback for a viewport that has no real size yet. */
const IDENTITY_ASPECT = 1

const safeAspect = (viewport: Viewport): number => {
  if (viewport.width > DEGENERATE_DIMENSION && viewport.height > DEGENERATE_DIMENSION) {
    return viewport.width / viewport.height
  }
  return IDENTITY_ASPECT
}

/** One frame's advance on the submitted-frame counter. */
const FRAME_STEP = 1

/**
 * Whether a chunk mesh should be drawn this frame: it has bounds (an empty
 * chunk has none) and those bounds intersect the frustum.
 */
const isBoundsVisible = (
  bounds: AxisAlignedBounds | undefined,
  frustum: ReturnType<typeof preparePerspectiveFrustum>,
): boolean => {
  if (!bounds) {
    return false
  }
  return aabbIntersectsPreparedPerspectiveFrustum(bounds, frustum)
}

type TransformableThreeMesh = ThreeMesh & {
  readonly position: ThreeVector3
  readonly rotation: ThreeEuler
  readonly scale: ThreeVector3
}

type VisualPosition = Readonly<{
  readonly x: number
  readonly y: number
  readonly z: number
}>

type VisualPartTransform = Readonly<{
  readonly center: readonly [number, number, number]
  readonly rotation: readonly [number, number, number]
  readonly size: readonly [number, number, number]
}>

/** One entity visual part's live mesh, keyed for reconciliation against the next plan. */
type EntityPartEntry = {
  readonly id: string
  readonly color: readonly [number, number, number]
  readonly mesh: TransformableThreeMesh
}

/** A synced entity's own projection and its current live parts. */
type EntityEntry = {
  readonly entity: RenderEntity
  readonly parts: ReadonlyArray<EntityPartEntry>
}

/** Working state for one `syncEntities` reconciliation pass. */
type ReconcileContext = {
  readonly current: ReadonlyMap<string, EntityEntry>
  readonly next: Map<string, EntityEntry>
}

/** One vehicle visual part's live mesh, keyed for reconciliation. */
type VehiclePartEntry = {
  readonly id: string
  readonly color: readonly [number, number, number]
  readonly mesh: TransformableThreeMesh
}

/** A synced vehicle's detached source snapshot and current live parts. */
type VehicleEntry = {
  readonly vehicle: Vehicle
  readonly parts: ReadonlyArray<VehiclePartEntry>
}

/** Working state for one `syncVehicles` reconciliation pass. */
type VehicleReconcileContext = {
  readonly current: ReadonlyMap<string, VehicleEntry>
  readonly next: Map<string, VehicleEntry>
}

/** Detach the nested vectors before the renderer stores a simulation snapshot. */
const copyVehicle = (vehicle: Vehicle): Vehicle => {
  const copy = {
    dimension: vehicle.dimension,
    id: vehicle.id,
    position: { ...vehicle.position },
    type: vehicle.type,
    velocity: { ...vehicle.velocity },
    yawRadians: vehicle.yawRadians,
  }
  if (vehicle.occupant === undefined) {
    return copy
  }
  return { ...copy, occupant: vehicle.occupant }
}

const indexVehicles = (vehicles: ReadonlyArray<Vehicle>): Map<string, Vehicle> => {
  const indexed = new Map<string, Vehicle>()
  for (const vehicle of vehicles) {
    indexed.set(vehicle.id, vehicle)
  }
  return indexed
}

/** Build only the vehicle planner options whose values are actually present. */
const vehiclePlanOptions = (
  previous: Vehicle | undefined,
  options: VehicleSyncOptions,
): {
  previous?: Vehicle
  interpolation?: number
  camera?: VehicleCameraContext
} => {
  const planOptions: {
    previous?: Vehicle
    interpolation?: number
    camera?: VehicleCameraContext
  } = {}
  if (previous !== undefined) {
    planOptions.previous = previous
  }
  if (options.interpolation !== undefined) {
    planOptions.interpolation = options.interpolation
  }
  if (options.camera !== undefined) {
    planOptions.camera = options.camera
  }
  return planOptions
}

/** Apply the shared local-part transform used by entities and vehicles. */
const applyVisualPartTransform = (
  mesh: TransformableThreeMesh,
  position: VisualPosition,
  facingRadians: number,
  part: VisualPartTransform,
): void => {
  const cosine = Math.cos(facingRadians)
  const sine = Math.sin(facingRadians)
  const [centerX, centerY, centerZ] = part.center
  const [sizeX, sizeY, sizeZ] = part.size
  mesh.position.set(
    position.x + centerX * cosine + centerZ * sine,
    position.y + centerY,
    position.z - centerX * sine + centerZ * cosine,
  )
  mesh.scale.set(sizeX, sizeY, sizeZ)
  const [rotationX, rotationY, rotationZ] = part.rotation
  mesh.rotation.set(rotationX, rotationY + facingRadians, rotationZ, 'YXZ')
}

/**
 * Build a renderer on a canvas.
 *
 * `three` is the namespace, supplied by the HOST — see
 * `application/three-surface.ts` on why this repository does not import it. In
 * a browser the call is `makeWorldRenderer(THREE, canvas, viewport)`.
 *
 * ACQUIRING THE CONTEXT IS THIS CALL. `new WebGLRenderer({ canvas })` creates a
 * WebGL2 context on the element, which is what makes
 * `canvas.getContext('webgl2')` non-null for anybody who asks afterwards —
 * a browser returns the existing context for a matching type rather than a
 * second one. mc-compose's smoke test #1 asks exactly that question.
 *
 * The parameters passed to it are transcribed from ts-minecraft
 * `packages/rendering/infrastructure/renderer/renderer-service.ts:12-18`:
 * `antialias: false` (post-processing does SMAA instead — plan.md §3.9 and
 * `domain/post-processing.ts`), `stencil: false` (nothing uses a stencil
 * buffer), `powerPreference: 'high-performance'`, and
 * `failIfMajorPerformanceCaveat: false` — which is the one that matters for
 * this project's own test harness: SwiftShader IS a major performance caveat,
 * and `true` would refuse to create a context under Playwright.
 *
 * It is an `Effect` rather than a plain function because it is an acquisition
 * with a `dispose`, and because `makeRenderFrameState` established the rule in
 * `stages/registration.ts`: plan.md §3.8 records app-scope singletons among the
 * reference's worst bug sources, and a renderer is the component most likely to
 * be started twice.
 */
export const makeWorldRenderer = <
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
  /**
   * The material the renderer ACTUALLY MESHES WITH, which is `TMaterial` unless
   * a factory supplies something else. Defaulted, so every existing call site
   * is unchanged and infers it from `MeshBasicMaterial` exactly as before.
   */
  TUsedMaterial extends ThreeMaterial = TMaterial,
>(
  three: Omit<ThreeSurface<TCanvas, TGeometry, TMaterial>, 'Mesh'> & {
    readonly Mesh: new (
      geometry: TGeometry,
      material: TUsedMaterial | TMaterial,
    ) => TransformableThreeMesh
  },
  canvas: TCanvas,
  viewport: Viewport,
  options: WorldRendererOptions<TUsedMaterial> = {},
): Effect.Effect<WorldRenderer> =>
  Effect.gen(function* buildRenderer() {
    /** The camera and weather settings resolved from `options`, before any GPU resource exists. */
    const resolveRenderSettings = (): {
      readonly fovDegrees: number
      readonly nearPlane: number
      readonly farPlane: number
      readonly weatherCapacity: number
      readonly initialAspect: number
    } => {
      const { farPlane: explicitFarPlane, renderDistance } = options
      let farPlane = CAMERA_FAR_PLANE
      if (explicitFarPlane !== undefined) {
        farPlane = explicitFarPlane
      } else if (renderDistance !== undefined) {
        farPlane = cameraFarPlaneForRenderDistance(renderDistance)
      }
      const weatherCapacity = Math.max(
        MIN_WEATHER_CAPACITY,
        Math.trunc(options.weather?.particleCapacity ?? DEFAULT_WEATHER_CAPACITY),
      )
      return {
        farPlane,
        fovDegrees: options.fovDegrees ?? CAMERA_FOV_DEGREES,
        initialAspect: safeAspect(viewport),
        nearPlane: options.nearPlane ?? CAMERA_NEAR_PLANE,
        weatherCapacity,
      }
    }

    /**
     * The GPU-owning surface: a sized, cleared renderer plus the scene and
     * camera it draws, the host's optional post-processing compositor, and
     * the settings they were built from.
     */
    const createRendererSurface = (): {
      readonly renderer: ThreeWebGLRenderer
      readonly scene: ThreeScene
      readonly camera: ThreePerspectiveCamera
      readonly postProcessing: PostProcessingRenderer | undefined
      readonly fovDegrees: number
      readonly nearPlane: number
      readonly farPlane: number
      readonly weatherCapacity: number
      readonly initialAspect: number
    } => {
      const settings = resolveRenderSettings()
      const renderer: ThreeWebGLRenderer = new three.WebGLRenderer({
        antialias: false,
        canvas,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
        stencil: false,
      })
      renderer.setSize(viewport.width, viewport.height, UPDATE_CANVAS_STYLE)
      const initialEnvironment = planRenderEnvironment(options.daylight ?? FULL_SUN_INTENSITY, settings.farPlane)
      renderer.setClearColor(options.clearColor ?? initialEnvironment.skyColor, SKY_CLEAR_ALPHA)
      options.applyMaterialEnvironment?.(initialEnvironment)
      const scene: ThreeScene = new three.Scene()
      const camera: ThreePerspectiveCamera = new three.PerspectiveCamera(
        settings.fovDegrees,
        settings.initialAspect,
        settings.nearPlane,
        settings.farPlane,
      )
      const postProcessing = options.postProcessing?.({ camera, renderer, scene, viewport })
      return { ...settings, camera, postProcessing, renderer, scene }
    }

    const { fovDegrees, nearPlane, farPlane, weatherCapacity, initialAspect, renderer, scene, camera, postProcessing } =
      createRendererSurface()

    /**
     * ONE material for every chunk, which is a draw-call decision and not a
     * tidiness one. ts-minecraft
     * `packages/rendering/infrastructure/meshing/chunk-mesh-geometry.ts:38`
     * lists "Single shared MeshLambertMaterial (atlas texture) across ALL
     * opaque chunks" first among its draw-call reduction techniques.
     *
     * `MeshBasicMaterial` and not Lambert, because Lambert needs a light and
     * there is no light in this scene — adding one would mean choosing its
     * colour, intensity and direction, and all three belong to the day/night
     * cycle that `SKY_CLEAR_COLOR` already records as unowned. Unlit means the
     * vertex colours ARE the shading, which is what makes the AO in
     * `domain/chunk-geometry.ts` the only thing visible in the mesh.
     *
     * `domain/material-policy.ts`'s rule does not bite here and it is worth
     * saying why: `requiresForceSinglePass` fires on shared + two-pass +
     * cutout-or-flat, and this material is shared but neither transparent nor
     * a cutout/flat surface. Water and particles are checked at their concrete
     * material construction boundary.
     */
    /**
     * THE ONE ASSERTION IN THIS FILE, and it is confined to the branch where it
     * is a tautology. `TUsedMaterial` DEFAULTS to `TMaterial`, so on the path
     * where no factory was supplied the two are the same type — but that is a
     * fact about the default, and a default is not a constraint the checker can
     * use inside the body. There is no signature that expresses "when this
     * optional argument is absent, these two parameters are equal"; the
     * alternative is an overload pair whose bodies are this same expression
     * twice.
     *
     * It is safe in the direction that matters: a caller who supplies a factory
     * never reaches this branch, and a caller who does not has `TUsedMaterial =
     * TMaterial` by construction.
     */
    const material: TUsedMaterial =
      options.material?.() ??
      (new three.MeshBasicMaterial({
        vertexColors: true,
        wireframe: options.wireframe ?? false,
      }) as unknown as TUsedMaterial)

    const [chunks, viewportAspect, entities, vehicles, framesRendered, postProcessingChain] = yield* Effect.all([
      Ref.make(new Map<ChunkKey, ChunkEntry<TGeometry>>()),
      Ref.make(initialAspect),
      Ref.make(new Map<string, EntityEntry>()),
      Ref.make(new Map<string, VehicleEntry>()),
      Ref.make(INITIAL_FRAMES_RENDERED),
      Ref.make<ReadonlyArray<PostProcessingStep>>([]),
    ])
    const visualAssets: { readonly entityGeometries: Map<string, TGeometry>; entityMaterial: TMaterial | null } = {
      entityGeometries: new Map<string, TGeometry>(),
      entityMaterial: null,
    }

    /**
     * Every operation `makeWorldRenderer` needs, bundled as one namespace
     * rather than ~20 separate closures: each still does one small thing and
     * calls its neighbours by name (`ops.xxx`, resolved only when a method
     * actually runs, never while this object is being built), but the
     * bundling is what keeps this acquisition function itself a short
     * allocate-refs-then-return body instead of a wall of declarations.
     */
    const ops = {
      applyCameraPose: (mirrored: MirroredCameraState): void => {
        camera.position.set(mirrored.position.x, mirrored.position.y, mirrored.position.z)
        /* The copy, in the one direction that is allowed. `rotation.order` is
           pinned to 'YXZ' by the surface's type, so a mirror that changed the
           order would not compile — see `domain/camera-mirror.ts` on why the
           order is load-bearing. */
        camera.rotation.set(
          mirrored.rotation.x,
          mirrored.rotation.y,
          mirrored.rotation.z,
          mirrored.rotation.order,
        )
      },

      applyChunkUpdate: (next: Map<ChunkKey, ChunkEntry<TGeometry>>, update: ChunkGeometryUpdate): void => {
        const { key, buffers } = update
        const previous = next.get(key)
        if (previous) {
          ops.releaseChunk(previous)
        }
        next.set(key, ops.buildChunkEntry(buffers))
      },

      attachChunkGeometryAttributes: (geometry: TGeometry, buffers: ChunkGeometryBuffers): void => {
        geometry.setAttribute(
          'position',
          new three.BufferAttribute(buffers.positions, POSITION_COMPONENTS, false),
        )
        geometry.setAttribute(
          'normal',
          new three.BufferAttribute(buffers.normals, NORMAL_COMPONENTS, false),
        )
        // `normalized: true` — the colours are 0-255 bytes and the shader wants
        // 0-1. ts-minecraft `chunk-mesh-geometry.ts:56` passes `true` here and
        // `false` on every other attribute, which is the same distinction.
        geometry.setAttribute('color', new three.BufferAttribute(buffers.colors, COLOR_COMPONENTS, true))
        geometry.setAttribute('uv', new three.BufferAttribute(buffers.uvs, UV_COMPONENTS, false))
        geometry.setAttribute('fluidDirection', new three.BufferAttribute(buffers.fluidDirections, FLUID_DIRECTION_COMPONENTS, false))
        geometry.setAttribute('fluidFalling', new three.BufferAttribute(buffers.fluidFalling, FLUID_FALLING_COMPONENTS, false))
        /* UPLOADED ON BOTH PATHS, though only the shader reads it. An unused
           attribute costs one buffer per chunk; a MISSING one costs a world drawn
           entirely from atlas tile 0, because GL supplies 0 for an attribute no
           buffer is bound to and reports nothing. The name comes from
           `CHUNK_SHADER_ATTRIBUTES` rather than a literal so the two cannot drift
           — `test/chunk-shader-geometry.test.ts` asserts that they have not. */
        geometry.setAttribute(
          CHUNK_SHADER_ATTRIBUTES.tileIndex,
          new three.BufferAttribute(buffers.tileIndices, TILE_INDEX_COMPONENTS, false),
        )
      },

      buildChunkEntry: (buffers: ChunkGeometryBuffers): ChunkEntry<TGeometry> => {
        const geometry = ops.buildGeometry(buffers)
        const mesh = new three.Mesh(geometry, material)
        const bounds = boundsFromPositions(buffers.positions)
        mesh.frustumCulled = false
        mesh.visible = Boolean(bounds)
        scene.add(mesh)
        return { bounds, geometry, mesh }
      },

      buildEntity: (entity: RenderEntity): EntityEntry => {
        const visual = planEntityVisual(entity)
        const parts = visual.parts.map((part): EntityPartEntry => {
          const mesh = new three.Mesh(ops.buildVisualGeometry(part.color), ops.getVisualMaterial())
          applyVisualPartTransform(mesh, visual.position, visual.facingRadians, part)
          scene.add(mesh)
          return { color: part.color, id: part.id, mesh }
        })
        return { entity, parts }
      },

      buildGeometry: (buffers: ChunkGeometryBuffers): TGeometry => {
        const geometry = new three.BufferGeometry()
        ops.attachChunkGeometryAttributes(geometry, buffers)
        geometry.setIndex(new three.BufferAttribute(buffers.indices, INDEX_ITEM_SIZE, false))
        /* Before the first render, not lazily. See `ThreeBufferGeometry`: three
           computes this on demand and warns on an empty position attribute, and
           an empty chunk is the normal case at the edge of the loaded world. */
        geometry.computeBoundingSphere()
        return geometry
      },

      buildVehicle: (
        vehicle: Vehicle,
        previous: Vehicle | undefined,
        syncOptions: VehicleSyncOptions,
      ): VehicleEntry => {
        const plan: VehicleRenderPlan = planVehicleVisual(vehicle, vehiclePlanOptions(previous, syncOptions))
        const parts = plan.parts.map((part): VehiclePartEntry => {
          const mesh = new three.Mesh(ops.buildVisualGeometry(part.color), ops.getVisualMaterial())
          applyVisualPartTransform(mesh, plan.position, plan.yawRadians, part)
          scene.add(mesh)
          return { color: part.color, id: part.id, mesh }
        })
        return { parts, vehicle }
      },

      buildVisualCubeGeometry: (color: readonly [number, number, number]): TGeometry => {
        const buffers = makeUnitCubeBuffers(color)
        const geometry = new three.BufferGeometry()
        geometry.setAttribute(
          'position',
          new three.BufferAttribute(buffers.positions, POSITION_COMPONENTS, false),
        )
        geometry.setAttribute(
          'color',
          new three.BufferAttribute(buffers.colors, COLOR_COMPONENTS, true),
        )
        geometry.setIndex(new three.BufferAttribute(buffers.indices, INDEX_ITEM_SIZE, false))
        geometry.computeBoundingSphere()
        return geometry
      },

      buildVisualGeometry: (color: readonly [number, number, number]): TGeometry => {
        const key = color.join(',')
        const cached = visualAssets.entityGeometries.get(key)
        if (cached) {return cached}
        const geometry = ops.buildVisualCubeGeometry(color)
        visualAssets.entityGeometries.set(key, geometry)
        return geometry
      },

      disposeChunksEntitiesAndVehicles: (
        currentChunks: ReadonlyMap<ChunkKey, ChunkEntry<TGeometry>>,
        currentEntities: ReadonlyMap<string, EntityEntry>,
        currentVehicles: ReadonlyMap<string, VehicleEntry>,
      ): void => {
        for (const entry of currentChunks.values()) {
          ops.releaseChunk(entry)
        }
        for (const entry of currentEntities.values()) {
          ops.releaseEntity(entry)
        }
        for (const entry of currentVehicles.values()) {
          ops.releaseVehicle(entry)
        }
        for (const geometry of visualAssets.entityGeometries.values()) {geometry.dispose()}
        visualAssets.entityGeometries.clear()
      },

      disposeSharedMaterials: (): void => {
        visualAssets.entityMaterial?.dispose()
        visualAssets.entityMaterial = null
        material.dispose()
        renderer.dispose()
      },

      getVisualMaterial: (): TMaterial => {
        visualAssets.entityMaterial ??= new three.MeshBasicMaterial({ vertexColors: true, wireframe: false })
        return visualAssets.entityMaterial
      },

      reconcileEntity: (context: ReconcileContext, id: string, entity: RenderEntity): void => {
        const { current, next } = context
        const previous = current.get(id)
        if (previous && previous.entity.kind === entity.kind && previous.entity.category === entity.category) {
          next.set(id, ops.updateEntity(previous, entity))
          return
        }
        if (previous) {
          ops.releaseEntity(previous)
        }
        next.set(id, ops.buildEntity(entity))
      },

      reconcileVehicle: (
        context: VehicleReconcileContext,
        id: string,
        vehicle: Vehicle,
        previous: Vehicle | undefined,
        syncOptions: VehicleSyncOptions,
      ): void => {
        const { current, next } = context
        const existing = current.get(id)
        if (existing && existing.vehicle.type === vehicle.type) {
          next.set(id, ops.updateVehicle(existing, vehicle, previous, syncOptions))
          return
        }
        if (existing) {
          ops.releaseVehicle(existing)
        }
        next.set(id, ops.buildVehicle(vehicle, previous, syncOptions))
      },

      releaseChunk: (entry: ChunkEntry<TGeometry>): void => {
        scene.remove(entry.mesh)
        entry.geometry.dispose()
      },

      releaseEntity: (entry: EntityEntry): void => {
        for (const part of entry.parts) {scene.remove(part.mesh)}
      },

      releaseStaleEntities: (
        current: ReadonlyMap<string, EntityEntry>,
        desired: ReadonlyMap<string, RenderEntity>,
      ): void => {
        for (const [id, entry] of current) {
          if (!desired.has(id)) {
            ops.releaseEntity(entry)
          }
        }
      },

      releaseStaleVehicles: (
        current: ReadonlyMap<string, VehicleEntry>,
        desired: ReadonlyMap<string, Vehicle>,
      ): void => {
        for (const [id, entry] of current) {
          if (!desired.has(id)) {
            ops.releaseVehicle(entry)
          }
        }
      },

      releaseVehicle: (entry: VehicleEntry): void => {
        for (const part of entry.parts) {scene.remove(part.mesh)}
      },

      renderFrame: (chain: ReadonlyArray<PostProcessingStep>): void => {
        if (postProcessing) {
          postProcessing.render(chain)
        } else {
          renderer.render(scene, camera)
        }
      },

      setChunks: (updates: ReadonlyArray<ChunkGeometryUpdate>): Effect.Effect<void> => {
        if (updates.length === EMPTY_UPDATE_COUNT) {
          return Effect.void
        }
        return Ref.update(chunks, (current) => {
          const next = new Map(current)
          for (const update of updates) {
            ops.applyChunkUpdate(next, update)
          }
          return next
        })
      },

      setEnvironment: (environment: RenderEnvironmentPlan) =>
        Effect.sync(() => {
          renderer.setClearColor(environment.skyColor, SKY_CLEAR_ALPHA)
          options.applyMaterialEnvironment?.(environment)
        }),

      updateChunkVisibility: (
        currentChunks: ReadonlyMap<ChunkKey, ChunkEntry<TGeometry>>,
        frustum: ReturnType<typeof preparePerspectiveFrustum>,
      ): void => {
        for (const entry of currentChunks.values()) {
          entry.mesh.visible = isBoundsVisible(entry.bounds, frustum)
        }
      },

      updateEntity: (entry: EntityEntry, entity: RenderEntity): EntityEntry => {
        const visual = planEntityVisual(entity)
        const plans = visual.parts
        if (
          plans.length !== entry.parts.length ||
          plans.some((plan, index) => {
            const previous = entry.parts[index]
            return !previous ||
              plan.id !== previous.id ||
              plan.color.some((component, colorIndex) => component !== previous.color[colorIndex])
          })
        ) {
          ops.releaseEntity(entry)
          return ops.buildEntity(entity)
        }
        for (const [index, plan] of plans.entries()) {
          const part = entry.parts[index]
          if (part) {applyVisualPartTransform(part.mesh, visual.position, visual.facingRadians, plan)}
        }
        return { ...entry, entity }
      },

      updateVehicle: (
        entry: VehicleEntry,
        vehicle: Vehicle,
        previous: Vehicle | undefined,
        syncOptions: VehicleSyncOptions,
      ): VehicleEntry => {
        const plan = planVehicleVisual(vehicle, vehiclePlanOptions(previous, syncOptions))
        for (const [index, part] of plan.parts.entries()) {
          const mesh = entry.parts[index]!
          applyVisualPartTransform(mesh.mesh, plan.position, plan.yawRadians, part)
        }
        return { ...entry, vehicle }
      },
    }

    const weather = yield* makeWeatherRenderer(
      {
        createPrecipitation: (kind) =>
          Effect.sync(() =>
            makeThreeWeatherPrecipitation({
              capacity: weatherCapacity,
              kind,
              scene,
              three,
            }),
          ),
        setEnvironment: ops.setEnvironment,
      },
      { ...options.weather, farPlane },
    )
    yield* weather.resize(viewport)

    return {
      attachSceneObject: (object) => Effect.sync(() => scene.add(object)),
      chunkKeys: Ref.get(chunks).pipe(Effect.map((current) => [...current.keys()])),
      detachSceneObject: (object) => Effect.sync(() => scene.remove(object)),
      dispose: weather.dispose.pipe(
        Effect.andThen(
          Effect.all([
            Ref.getAndSet(chunks, new Map()),
            Ref.getAndSet(entities, new Map()),
            Ref.getAndSet(vehicles, new Map()),
          ]).pipe(
            Effect.map(([currentChunks, currentEntities, currentVehicles]) => {
              ops.disposeChunksEntitiesAndVehicles(currentChunks, currentEntities, currentVehicles)
              ops.disposeSharedMaterials()
            }),
          ),
        ),
        Effect.andThen(Effect.sync(() => postProcessing?.dispose())),
      ),
      draw: (mirrored: MirroredCameraState) =>
        Effect.gen(function* drawFrame() {
          ops.applyCameraPose(mirrored)
          const [currentChunks, aspect] = yield* Effect.all([
            Ref.get(chunks),
            Ref.get(viewportAspect),
          ])
          const frustum = preparePerspectiveFrustum({
            aspect,
            camera: mirrored,
            farPlane,
            nearPlane,
            verticalFovDegrees: fovDegrees,
          })
          ops.updateChunkVisibility(currentChunks, frustum)
          const chain = yield* Ref.get(postProcessingChain)
          options.beforeRender?.({ camera, chain, renderer, scene })
          ops.renderFrame(chain)
          yield* Ref.update(framesRendered, (drawn) => drawn + FRAME_STEP)
        }),
      entityCount: Ref.get(entities).pipe(Effect.map((current) => current.size)),
      entitySnapshot: Ref.get(entities).pipe(
        Effect.map((current) => [...current.values()].map(({ entity }) => copyRenderEntity(entity))),
      ),
      framesRendered: Ref.get(framesRendered),
      postProcessingChain: Ref.get(postProcessingChain),
      removeChunk: (key) =>
        Ref.update(chunks, (current) => {
          const entry = current.get(key)
          if (!entry) {
            return current
          }
          ops.releaseChunk(entry)
          const next = new Map(current)
          next.delete(key)
          return next
        }),
      resize: (width, height) =>
        Effect.gen(function* applyResize() {
          renderer.setSize(width, height, UPDATE_CANVAS_STYLE)
          const aspect = safeAspect({ height, width })
          camera.aspect = aspect
          /* Without this the projection matrix keeps the old aspect and the
             world stretches. three does not recompute it on assignment. */
          camera.updateProjectionMatrix()
          yield* Ref.set(viewportAspect, aspect)
          yield* weather.resize({ height, width })
          postProcessing?.resize(width, height)
        }),
      setChunk: (key, buffers) => ops.setChunks([{ buffers, key }]),
      setChunks: ops.setChunks,
      setEnvironment: ops.setEnvironment,
      setPostProcessingChain: (chain) => Ref.set(postProcessingChain, chain),
      syncEntities: (incoming) =>
        Ref.update(entities, (current) => {
          const desired = new Map(incoming.map((entity) => [entity.id, copyRenderEntity(entity)]))
          const next = new Map<string, EntityEntry>()
          const context: ReconcileContext = { current, next }
          for (const [id, entity] of desired) {
            ops.reconcileEntity(context, id, entity)
          }
          ops.releaseStaleEntities(current, desired)
          return next
        }),
      syncVehicles: (incoming, syncOptions = {}) =>
        Ref.update(vehicles, (current) => {
          const desired = new Map(incoming.map((vehicle) => [vehicle.id, copyVehicle(vehicle)]))
          const previous = indexVehicles(syncOptions.previous ?? [])
          const next = new Map<string, VehicleEntry>()
          const context: VehicleReconcileContext = { current, next }
          for (const [id, vehicle] of desired) {
            ops.reconcileVehicle(context, id, vehicle, previous.get(id), syncOptions)
          }
          ops.releaseStaleVehicles(current, desired)
          return next
        }),
      vehicleCount: Ref.get(vehicles).pipe(Effect.map((current) => current.size)),
      vehicleSnapshot: Ref.get(vehicles).pipe(
        Effect.map((current) => [...current.values()].map(({ vehicle }) => copyVehicle(vehicle))),
      ),
      weather,
    }
  })
