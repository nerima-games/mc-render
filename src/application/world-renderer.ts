/**
 * The renderer: the only file in this repository that touches a GPU.
 *
 * `domain/chunk-geometry.ts` is the pure half — quads to typed arrays, testable
 * in Node. This is the half that cannot be pure: it acquires a WebGL2 context,
 * owns the live `Scene`, `PerspectiveCamera` and per-chunk `Mesh` objects, and
 * makes the one `renderer.render(scene, camera)` call that `render:draw` exists
 * to place in the frame.
 *
 * It reaches `three` through `application/three-surface.ts` and never imports
 * it. Read that file's header for why; the short version is that
 * `tsconfig.build.json` still compiles this file with `lib: ["ES2024"]` and
 * `types: []`, and a `three` import would need `"DOM"` for every module in the
 * repository including the pure ones.
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
} from '../domain/frustum-culling.js'
import {
  CHUNK_SHADER_ATTRIBUTES,
  CHUNK_SHADER_UNIFORMS,
  chunkShaderSource,
} from '../domain/chunk-shader.js'
import {
  COLOR_COMPONENTS,
  type ChunkGeometryBuffers,
  FLUID_DIRECTION_COMPONENTS,
  FLUID_FALLING_COMPONENTS,
  NORMAL_COMPONENTS,
  POSITION_COMPONENTS,
  TILE_INDEX_COMPONENTS,
  UV_COMPONENTS,
} from '../domain/chunk-geometry.js'
import {
  DAY_SKY_COLOR,
  type RenderEnvironmentPlan,
  planRenderEnvironment,
} from '../domain/render-environment.js'
import { Effect, Ref } from 'effect'
import {
  type MobAnimationInput,
  type MobVisualPartPlan,
  planMobVisual,
} from '../domain/mob-visual.js'
import { type ParticlePool, type ParticlePoolOptions, advanceParticles, makeParticlePool } from '../domain/particle-pool.js'
import { type ParticleSystem, makeParticleSystem } from './particle-system.js'
import type {
  ThreeBufferGeometry,
  ThreeCamera,
  ThreeEuler,
  ThreeInstancedBufferGeometry,
  ThreeInstancedSurface,
  ThreeMaterial,
  ThreeMesh,
  ThreePerspectiveCamera,
  ThreeScene,
  ThreeShaderSurface,
  ThreeSurface,
  ThreeUniform,
  ThreeVector3,
  ThreeWebGLRenderer,
} from './three-surface.js'
import { WATER_MATERIAL_SPEC, WATER_WRITES_DEPTH } from '../domain/water-surface.js'
import { type WeatherRenderer, makeWeatherRenderer } from './weather-renderer.js'
import {
  type WitherSkullVisualInput,
  type WitherVisualPartDescriptor,
  type WitherVisualPosition,
  type WitherVisualStateInput,
  planWitherSkullVisual,
  planWitherVisual,
} from '../domain/wither-visual.js'
import type { Dimension } from '@nerima-games/mc-kernel'
import type { MirroredCameraState } from '../domain/camera-mirror.js'
import type { PostProcessingStep } from '../domain/post-processing.js'
import type { WeatherFrameOptions } from '../domain/weather-rendering.js'
import { makeThreeWeatherPrecipitation } from './three-weather-runtime.js'
import { waterShaderSource } from '../domain/water-shader.js'
// oxlint-disable-next-line sort-imports
import { requiresForceSinglePass } from '../domain/material-policy.js'

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
 * and 300 is the FLOOR of that expression, not the value it usually takes. This
 * repository uses the floor, and says so rather than transcribing the formula,
 * because two of the formula's three inputs are unreachable from here:
 * `renderDistance` is a setting owned by mc-sim, and `CHUNK_SIZE`/`CHUNK_HEIGHT`
 * are mc-meshing's — neither is published (see `domain/chunk-geometry.ts`'s
 * header). Restating the formula with mirrored constants would produce a number
 * that looks derived and is not, which is the failure mode this project has
 * eight recorded instances of.
 *
 * So: 300 is a FLOOR STANDING IN FOR A COMPUTATION, and it is wrong in the safe
 * direction — a far plane that is too near clips distant terrain, which is
 * visible immediately, rather than costing depth precision, which is not.
 */
export const CAMERA_FAR_PLANE = 300

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

/**
 * Full daylight: the value `uSunIntensity` takes when nothing drives it.
 *
 * 1 and not 0, which is the difference between "no day/night cycle exists" and
 * "it is midnight". `SKY_CLEAR_COLOR` above already records the cycle as unowned
 * and takes its day value for the same reason; a sky-blue background over a
 * world lit at 0 would be a contradiction visible on the first frame.
 */
export const FULL_SUN_INTENSITY = 1

/**
 * The material for the textured, packed-light path.
 *
 * Takes the atlas texture AS A VALUE rather than loading one, which is what
 * keeps this function in the same Node-testable half as everything else here.
 * `TextureLoader` needs the DOM; `application/dom-surface.ts` is where that
 * belongs, and a host passes the result across. The type is `unknown` because
 * this file never reads the texture — it hands it to three, and enumerating
 * three's texture type would be a mirror maintained for no check (the same
 * argument `ThreeUniform.value` makes).
 *
 * THE UNIFORM RECORD IS RETURNED, not just the material, because the boxes are
 * the point: a host that wants a day/night cycle writes
 * `uniforms.uSunIntensity.value = 0.3` and every chunk sharing this material
 * follows on the next frame with no recompile. See `ThreeUniform`'s header.
 */
export type ChunkShaderMaterial<TShaderMaterial extends ThreeMaterial> = {
  readonly material: TShaderMaterial
  readonly uniforms: Record<string, ThreeUniform>
}

/** Update the shared shader's stable uniform boxes without rebuilding it. */
export const applyChunkShaderEnvironment = (
  uniforms: Record<string, ThreeUniform>,
  environment: RenderEnvironmentPlan,
): void => {
  const values: Readonly<Record<string, unknown>> = {
    [CHUNK_SHADER_UNIFORMS.sunIntensity]: environment.sunIntensity,
    [CHUNK_SHADER_UNIFORMS.fogColor]: [...environment.fogColor],
    [CHUNK_SHADER_UNIFORMS.fogNear]: environment.fogNear,
    [CHUNK_SHADER_UNIFORMS.fogFar]: environment.fogFar,
  }
  for (const [name, value] of Object.entries(values)) {
    const uniform = uniforms[name]
    if (uniform) {uniform.value = value}
  }
}

/**
 * Build the shader material and its uniform boxes.
 *
 * The GLSL comes from `domain/chunk-shader.ts`, which generates it from the
 * lighting constants — see that file's header on why the coefficients are
 * interpolated rather than typed. Nothing here restates a formula.
 */
export const makeChunkShaderMaterial = <
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
  TShaderMaterial extends ThreeMaterial,
>(
  three: ThreeShaderSurface<TCanvas, TGeometry, TMaterial, TShaderMaterial>,
  atlasTexture: unknown,
  sunIntensity: number = FULL_SUN_INTENSITY,
): ChunkShaderMaterial<TShaderMaterial> => {
  const source = chunkShaderSource()
  const defaultEnvironment = planRenderEnvironment(FULL_SUN_INTENSITY)
  const uniforms: Record<string, ThreeUniform> = {
    [CHUNK_SHADER_UNIFORMS.atlas]: { value: atlasTexture },
    [CHUNK_SHADER_UNIFORMS.sunIntensity]: { value: sunIntensity },
    [CHUNK_SHADER_UNIFORMS.fogColor]: { value: [...defaultEnvironment.fogColor] },
    [CHUNK_SHADER_UNIFORMS.fogNear]: { value: defaultEnvironment.fogNear },
    [CHUNK_SHADER_UNIFORMS.fogFar]: { value: defaultEnvironment.fogFar },
  }
  return {
    material: new three.ShaderMaterial({
      fragmentShader: source.fragmentShader,
      uniforms,
      // Required `true` by the parameter type, not defaulted here. See
      // `ThreeShaderMaterialParameters`: without it three does not define the
      // `color` attribute and the shader fails to link in the browser only.
      vertexColors: true,
      vertexShader: source.vertexShader,
    }),
    uniforms,
  }
}

/**
 * "Nothing has drawn into the refraction target yet."
 *
 * A FLOAT AND NOT A BOOL, because GLSL ES 1.00 uniforms are floats and the
 * fragment stage uses this as a `mix` weight rather than as a branch — see
 * `domain/water-shader.ts`. 0 means the tint alone; 1 means the sampled
 * refraction is real.
 *
 * The default is 0 for the same reason `NO_DRAW_TARGET` is the default
 * `DrawPort`: "there is no refraction here" is a true state and the common one,
 * and a shader that sampled an unfilled target would mirror uninitialised
 * memory — which looks like a driver fault rather than a missing pass.
 */
export const REFRACTION_UNAVAILABLE = 0

/**
 * The origin, as a `vec3` uniform's initial value.
 *
 * AN ARRAY AND NOT `null`, AND THAT DISTINCTION WAS A REAL DEFECT — the first
 * cut of `makeWaterMaterial` initialised `uCameraPosition` to `null`, on the
 * reasoning that "no camera has been supplied yet" is the honest state and that
 * `uRefractionMap: null` is fine for a sampler.
 *
 * It is not fine for a vector. three uploads a `vec3` by reading `.x` off the
 * value, so a null threw `TypeError: Cannot read properties of null (reading
 * 'x')` on the first render — and NOTHING IN THIS REPOSITORY COULD HAVE SEEN
 * IT. Every Node test passed: the material was constructed, the uniform record
 * had the right six keys, and the GLSL declared the right six names. The upload
 * is three's, it happens on a real driver, and the only check in this
 * organisation that runs one is mc-compose's `apps/shader-probe`, which caught
 * this on its first execution.
 *
 * A plain array rather than a `Vector3` because this repository cannot
 * construct one — `application/three-surface.ts` names no vector constructor,
 * and three accepts either (`setValueV3f` branches on `v.x === undefined` and
 * falls back to `uniform3fv`).
 */
/** Each component of the zero vector `UNIFORM_ORIGIN` starts from. */
const ORIGIN_COMPONENT = 0

export const UNIFORM_ORIGIN: ReadonlyArray<number> = [ORIGIN_COMPONENT, ORIGIN_COMPONENT, ORIGIN_COMPONENT]

/**
 * The water material, and the boxes a host writes into every frame.
 *
 * `PER_FRAME_WATER_UNIFORMS` in `domain/water-surface.ts` records WHICH of them
 * change per frame — `uTime`, `uCameraPosition`, `uSunIntensity` — and that
 * split is a performance contract invisible in the shader. This function hands
 * back the whole record rather than the three, because a host also has to
 * rebind `uResolution` on resize and `uRefractionMap` once; naming only the
 * per-frame three here would make the other two look optional.
 */
export const makeWaterMaterial = <
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
  TShaderMaterial extends ThreeMaterial,
>(
  three: ThreeShaderSurface<TCanvas, TGeometry, TMaterial, TShaderMaterial>,
  viewport: Viewport,
  sunIntensity: number = FULL_SUN_INTENSITY,
): ChunkShaderMaterial<TShaderMaterial> => {
  const source = waterShaderSource()
  const uniforms: Record<string, ThreeUniform> = {
    /* NOT `null`. See `UNIFORM_ORIGIN` — a null here is a TypeError inside
       three's uniform upload, on a real driver, and on no test in Node. */
    uCameraPosition: { value: [...UNIFORM_ORIGIN] },
    uRefractionMap: { value: null },
    uRefractionValid: { value: REFRACTION_UNAVAILABLE },
    uResolution: { value: [viewport.width, viewport.height] },
    uSunIntensity: { value: sunIntensity },
    uTime: { value: ORIGIN_COMPONENT },
  }
  return {
    material: new three.ShaderMaterial({
      depthWrite: WATER_WRITES_DEPTH,
      forceSinglePass: requiresForceSinglePass(WATER_MATERIAL_SPEC),
      fragmentShader: source.fragmentShader,
      transparent: WATER_MATERIAL_SPEC.transparent,
      uniforms,
      vertexColors: true,
      vertexShader: source.vertexShader,
    }),
    uniforms,
  }
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

/** Coarse render policy without importing simulation entity classes. */
export type EntityRenderCategory = 'hostile' | 'passive' | 'item'

/** The renderer-owned entity projection consumed by compose. */
export type RenderEntity = {
  readonly id: string
  readonly kind: string
  readonly feetPosition: {
    readonly x: number
    readonly y: number
    readonly z: number
  }
  readonly category?: EntityRenderCategory
  /** Horizontal world-space orientation, in radians. */
  readonly facingRadians?: number
  /** Pure animation input used to derive part transforms deterministically. */
  readonly animation?: MobAnimationInput
  /** State projection for a `wither` entity, compatible with mc-sim. */
  readonly witherState?: WitherVisualStateInput
  /** Projectile projection for a `wither_skull` entity, compatible with mc-sim. */
  readonly witherSkullProjectile?: WitherSkullVisualInput
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
  readonly farPlane?: number
  readonly clearColor?: number
  /** Initial daylight in the inclusive 0..1 range; invalid values are clamped by the planner. */
  readonly daylight?: number
  /** Initial dimension; absent means `overworld`, the sky every caller got before dimensions existed. */
  readonly dimension?: Dimension
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

/** The drawing surface's size in device-independent pixels. */
export type Viewport = {
  readonly width: number
  readonly height: number
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

type EntityVisualPartPlan = MobVisualPartPlan | WitherVisualPartDescriptor

type EntityVisualPlan = Readonly<{
  position: WitherVisualPosition
  facingRadians: number
  parts: ReadonlyArray<EntityVisualPartPlan>
}>

/** The item visual's part centre: slightly above the feet position, on no horizontal offset. */
const ITEM_CENTER_X = 0
const ITEM_CENTER_Y = 0.15
const ITEM_CENTER_Z = 0

/** The dropped-item colour: a warm gold, standing in for a real per-item texture. */
const ITEM_COLOR_RED = 225
const ITEM_COLOR_GREEN = 165
const ITEM_COLOR_BLUE = 65

/** No rotation on any axis: the item cube is drawn axis-aligned. */
const ITEM_ROTATION_X = 0
const ITEM_ROTATION_Y = 0
const ITEM_ROTATION_Z = 0

/** The item visual's cube size: smaller than a full block on every axis. */
const ITEM_SIZE_X = 0.3
const ITEM_SIZE_Y = 0.3
const ITEM_SIZE_Z = 0.3

const ITEM_VISUAL_PARTS: ReadonlyArray<EntityVisualPartPlan> = [
  {
    center: [ITEM_CENTER_X, ITEM_CENTER_Y, ITEM_CENTER_Z],
    color: [ITEM_COLOR_RED, ITEM_COLOR_GREEN, ITEM_COLOR_BLUE],
    id: 'item',
    role: 'body',
    rotation: [ITEM_ROTATION_X, ITEM_ROTATION_Y, ITEM_ROTATION_Z],
    size: [ITEM_SIZE_X, ITEM_SIZE_Y, ITEM_SIZE_Z],
  },
]

/** The facing this repository assumes for an entity that reports none. */
const DEFAULT_FACING_RADIANS = 0

const entityFacing = (entity: RenderEntity): number => {
  if (typeof entity.facingRadians === 'number' && Number.isFinite(entity.facingRadians)) {
    return entity.facingRadians
  }
  return DEFAULT_FACING_RADIANS
}

const facingDirection = (facingRadians: number): WitherVisualPosition => ({
  x: -Math.sin(facingRadians),
  y: 0,
  z: -Math.cos(facingRadians),
})

const planItemVisual = (entity: RenderEntity, facingRadians: number): EntityVisualPlan => ({
  facingRadians,
  parts: ITEM_VISUAL_PARTS,
  position: entity.feetPosition,
})

const planWitherEntityVisual = (entity: RenderEntity, facingRadians: number): EntityVisualPlan => {
  const state: WitherVisualStateInput = entity.witherState ?? {
    chargeRemainingSecs: 0,
    feetPosition: entity.feetPosition,
    healthPoints: 300,
    phase: 'airborne',
    velocity: facingDirection(facingRadians),
  }
  const visual = planWitherVisual(state)
  return {
    facingRadians: visual.yawRadians,
    parts: visual.parts,
    position: visual.position,
  }
}

const planWitherSkullEntityVisual = (entity: RenderEntity, facingRadians: number): EntityVisualPlan => {
  const projectile: WitherSkullVisualInput = entity.witherSkullProjectile ?? {
    destroysResistantBlocks: false,
    direction: facingDirection(facingRadians),
    explosivePower: 0,
    kind: 'wither_skull',
    origin: entity.feetPosition,
    speed: 0,
    variant: 'normal',
  }
  const visual = planWitherSkullVisual(projectile)
  return {
    facingRadians: visual.yawRadians,
    parts: visual.parts,
    position: visual.position,
  }
}

const planDefaultEntityVisual = (entity: RenderEntity, facingRadians: number): EntityVisualPlan => ({
  facingRadians,
  parts: planMobVisual(entity.kind, entity.animation).parts,
  position: entity.feetPosition,
})

const planEntityVisual = (entity: RenderEntity): EntityVisualPlan => {
  const facingRadians = entityFacing(entity)
  if (entity.category === 'item') {
    return planItemVisual(entity, facingRadians)
  }
  if (entity.kind === 'wither') {
    return planWitherEntityVisual(entity, facingRadians)
  }
  if (entity.kind === 'wither_skull') {
    return planWitherSkullEntityVisual(entity, facingRadians)
  }
  return planDefaultEntityVisual(entity, facingRadians)
}

/** The unit cube's extent from its centre along each axis: a block is one unit wide, centred on the origin. */
const CUBE_MIN = -0.5
const CUBE_MAX = 0.5

/** The unit cube's eight corners, in the winding order `unitCubeBuffers`'s index list assumes. */
const CUBE_VERTEX_0 = 0
const CUBE_VERTEX_1 = 1
const CUBE_VERTEX_2 = 2
const CUBE_VERTEX_3 = 3
const CUBE_VERTEX_4 = 4
const CUBE_VERTEX_5 = 5
const CUBE_VERTEX_6 = 6
const CUBE_VERTEX_7 = 7

/** Vertices in `unitCubeBuffers`'s position array: one per cube corner. */
const UNIT_CUBE_VERTEX_COUNT = 8

const unitCubeBuffers = (color: readonly [number, number, number]) => {
  const positions = new Float32Array([
    CUBE_MIN, CUBE_MIN, CUBE_MIN, CUBE_MAX, CUBE_MIN, CUBE_MIN, CUBE_MAX, CUBE_MAX, CUBE_MIN, CUBE_MIN, CUBE_MAX, CUBE_MIN,
    CUBE_MIN, CUBE_MIN, CUBE_MAX, CUBE_MAX, CUBE_MIN, CUBE_MAX, CUBE_MAX, CUBE_MAX, CUBE_MAX, CUBE_MIN, CUBE_MAX, CUBE_MAX,
  ])
  const colors = new Uint8Array(UNIT_CUBE_VERTEX_COUNT * COLOR_COMPONENTS)
  for (let offset = 0; offset < colors.length; offset += COLOR_COMPONENTS) {
    colors.set(color, offset)
  }
  return {
    colors,
    indices: new Uint32Array([
      CUBE_VERTEX_0, CUBE_VERTEX_2, CUBE_VERTEX_1, CUBE_VERTEX_0, CUBE_VERTEX_3, CUBE_VERTEX_2,
      CUBE_VERTEX_4, CUBE_VERTEX_5, CUBE_VERTEX_6, CUBE_VERTEX_4, CUBE_VERTEX_6, CUBE_VERTEX_7,
      CUBE_VERTEX_0, CUBE_VERTEX_4, CUBE_VERTEX_7, CUBE_VERTEX_0, CUBE_VERTEX_7, CUBE_VERTEX_3,
      CUBE_VERTEX_1, CUBE_VERTEX_2, CUBE_VERTEX_6, CUBE_VERTEX_1, CUBE_VERTEX_6, CUBE_VERTEX_5,
      CUBE_VERTEX_0, CUBE_VERTEX_1, CUBE_VERTEX_5, CUBE_VERTEX_0, CUBE_VERTEX_5, CUBE_VERTEX_4,
      CUBE_VERTEX_3, CUBE_VERTEX_7, CUBE_VERTEX_6, CUBE_VERTEX_3, CUBE_VERTEX_6, CUBE_VERTEX_2,
    ]),
    positions,
  }
}

/** `entity.category`, present only when the source entity has one. */
const copiedCategory = (entity: RenderEntity): Pick<RenderEntity, 'category'> => {
  if (typeof entity.category === 'undefined') {
    return {}
  }
  return { category: entity.category }
}

/** `entity.facingRadians`, present only when the source entity has one. */
const copiedFacingRadians = (entity: RenderEntity): Pick<RenderEntity, 'facingRadians'> => {
  if (typeof entity.facingRadians === 'undefined') {
    return {}
  }
  return { facingRadians: entity.facingRadians }
}

/** A detached copy of `entity.animation`, present only when the source entity has one. */
const copiedAnimation = (entity: RenderEntity): Pick<RenderEntity, 'animation'> => {
  if (typeof entity.animation === 'undefined') {
    return {}
  }
  return { animation: { ...entity.animation } }
}

/** A detached copy of `entity.witherState`, present only when the source entity has one. */
const copiedWitherState = (entity: RenderEntity): Pick<RenderEntity, 'witherState'> => {
  const { witherState } = entity
  if (typeof witherState === 'undefined') {
    return {}
  }
  return {
    witherState: {
      ...witherState,
      feetPosition: { ...witherState.feetPosition },
      velocity: { ...witherState.velocity },
    },
  }
}

/** A detached copy of `entity.witherSkullProjectile`, present only when the source entity has one. */
const copiedWitherSkullProjectile = (entity: RenderEntity): Pick<RenderEntity, 'witherSkullProjectile'> => {
  const { witherSkullProjectile } = entity
  if (typeof witherSkullProjectile === 'undefined') {
    return {}
  }
  return {
    witherSkullProjectile: {
      ...witherSkullProjectile,
      direction: { ...witherSkullProjectile.direction },
      origin: { ...witherSkullProjectile.origin },
    },
  }
}

const copyEntity = (entity: RenderEntity): RenderEntity => ({
  feetPosition: { ...entity.feetPosition },
  id: entity.id,
  kind: entity.kind,
  ...copiedCategory(entity),
  ...copiedFacingRadians(entity),
  ...copiedAnimation(entity),
  ...copiedWitherState(entity),
  ...copiedWitherSkullProjectile(entity),
})

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
      const farPlane = options.farPlane ?? CAMERA_FAR_PLANE
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
        stencil: false,
      })
      renderer.setSize(viewport.width, viewport.height, UPDATE_CANVAS_STYLE)
      const initialEnvironment = planRenderEnvironment(
        options.daylight ?? FULL_SUN_INTENSITY,
        settings.farPlane,
        options.dimension,
      )
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
     * saying why: `requiresForceSinglePass` fires on shared + two-pass + (cutout or flat),
     * and this material is shared but neither transparent nor a cutout. The
     * water material, when it exists, is the one that will need the audit.
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

    const [chunks, viewportAspect, entities, framesRendered, postProcessingChain] = yield* Effect.all([
      Ref.make(new Map<ChunkKey, ChunkEntry<TGeometry>>()),
      Ref.make(initialAspect),
      Ref.make(new Map<string, EntityEntry>()),
      Ref.make(INITIAL_FRAMES_RENDERED),
      Ref.make<ReadonlyArray<PostProcessingStep>>([]),
    ])
    const entityAssets: { readonly entityGeometries: Map<string, TGeometry>; entityMaterial: TMaterial | null } = {
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

      applyEntityPartTransform: (
        mesh: TransformableThreeMesh,
        visual: EntityVisualPlan,
        part: EntityVisualPartPlan,
      ): void => {
        const facing = visual.facingRadians
        const cosine = Math.cos(facing)
        const sine = Math.sin(facing)
        const [centerX, centerY, centerZ] = part.center
        const [sizeX, sizeY, sizeZ] = part.size
        mesh.position.set(
          visual.position.x + centerX * cosine + centerZ * sine,
          visual.position.y + centerY,
          visual.position.z - centerX * sine + centerZ * cosine,
        )
        mesh.scale.set(sizeX, sizeY, sizeZ)
        const [rotationX, rotationY, rotationZ] = part.rotation
        mesh.rotation.set(rotationX, rotationY + facing, rotationZ, 'YXZ')
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
          const mesh = new three.Mesh(ops.buildEntityGeometry(part.color), ops.getEntityMaterial())
          ops.applyEntityPartTransform(mesh, visual, part)
          scene.add(mesh)
          return { color: part.color, id: part.id, mesh }
        })
        return { entity, parts }
      },

      buildEntityCubeGeometry: (color: readonly [number, number, number]): TGeometry => {
        const buffers = unitCubeBuffers(color)
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

      buildEntityGeometry: (color: readonly [number, number, number]): TGeometry => {
        const key = color.join(',')
        const cached = entityAssets.entityGeometries.get(key)
        if (cached) {return cached}
        const geometry = ops.buildEntityCubeGeometry(color)
        entityAssets.entityGeometries.set(key, geometry)
        return geometry
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

      disposeChunksAndEntities: (
        currentChunks: ReadonlyMap<ChunkKey, ChunkEntry<TGeometry>>,
        currentEntities: ReadonlyMap<string, EntityEntry>,
      ): void => {
        for (const entry of currentChunks.values()) {
          ops.releaseChunk(entry)
        }
        for (const entry of currentEntities.values()) {
          ops.releaseEntity(entry)
        }
        for (const geometry of entityAssets.entityGeometries.values()) {geometry.dispose()}
        entityAssets.entityGeometries.clear()
      },

      disposeSharedMaterials: (): void => {
        entityAssets.entityMaterial?.dispose()
        entityAssets.entityMaterial = null
        material.dispose()
        renderer.dispose()
      },

      getEntityMaterial: (): TMaterial => {
        entityAssets.entityMaterial ??= new three.MeshBasicMaterial({ vertexColors: true, wireframe: false })
        return entityAssets.entityMaterial
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
          const part = entry.parts[index]!
          ops.applyEntityPartTransform(part.mesh, visual, plan)
        }
        return { ...entry, entity }
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
          ]).pipe(
            Effect.map(([currentChunks, currentEntities]) => {
              ops.disposeChunksAndEntities(currentChunks, currentEntities)
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
          ops.renderFrame(chain)
          yield* Ref.update(framesRendered, (drawn) => drawn + FRAME_STEP)
        }),
      entityCount: Ref.get(entities).pipe(Effect.map((current) => current.size)),
      entitySnapshot: Ref.get(entities).pipe(
        Effect.map((current) => [...current.values()].map(({ entity }) => copyEntity(entity))),
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
          const desired = new Map(incoming.map((entity) => [entity.id, copyEntity(entity)]))
          const next = new Map<string, EntityEntry>()
          const context: ReconcileContext = { current, next }
          for (const [id, entity] of desired) {
            ops.reconcileEntity(context, id, entity)
          }
          ops.releaseStaleEntities(current, desired)
          return next
        }),
      weather,
    }
  })

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
  readonly particles: ParticleSystem
  readonly advanceFrame: (frame: ProductionFrame) => Effect.Effect<void>
}

export type ProductionWorldRendererOptions = Omit<
  WorldRendererOptions<ThreeMaterial>,
  'material' | 'applyMaterialEnvironment'
> & {
  readonly particles?: ParticlePoolOptions
}

/** Assemble the atlas shader, animated water and instanced particles as one owned renderer. */
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
