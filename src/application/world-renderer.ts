/**
 * The renderer: the only file in this repository that touches a GPU.
 *
 * PRE-AUDIT FIRST CUT (叩き台).
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
import { Effect, Ref } from 'effect'
import type { MirroredCameraState } from '../domain/camera-mirror'
import {
  aabbIntersectsPerspectiveFrustum,
  boundsFromPositions,
  type AxisAlignedBounds,
} from '../domain/frustum-culling'
import {
  COLOR_COMPONENTS,
  NORMAL_COMPONENTS,
  POSITION_COMPONENTS,
  TILE_INDEX_COMPONENTS,
  UV_COMPONENTS,
  type ChunkGeometryBuffers,
} from '../domain/chunk-geometry'
import {
  CHUNK_SHADER_ATTRIBUTES,
  CHUNK_SHADER_UNIFORMS,
  chunkShaderSource,
} from '../domain/chunk-shader'
import { waterShaderSource } from '../domain/water-shader'
import {
  DAY_SKY_COLOR,
  planRenderEnvironment,
  type RenderEnvironmentPlan,
} from '../domain/render-environment'
import type {
  ThreeBufferGeometry,
  ThreeMaterial,
  ThreeMesh,
  ThreePerspectiveCamera,
  ThreeScene,
  ThreeShaderSurface,
  ThreeSurface,
  ThreeUniform,
  ThreeVector3,
  ThreeWebGLRenderer,
} from './three-surface'

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
    if (uniform !== undefined) uniform.value = value
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
  const defaultEnvironment = planRenderEnvironment(1)
  const uniforms: Record<string, ThreeUniform> = {
    [CHUNK_SHADER_UNIFORMS.atlas]: { value: atlasTexture },
    [CHUNK_SHADER_UNIFORMS.sunIntensity]: { value: sunIntensity },
    [CHUNK_SHADER_UNIFORMS.fogColor]: { value: [...defaultEnvironment.fogColor] },
    [CHUNK_SHADER_UNIFORMS.fogNear]: { value: defaultEnvironment.fogNear },
    [CHUNK_SHADER_UNIFORMS.fogFar]: { value: defaultEnvironment.fogFar },
  }
  return {
    material: new three.ShaderMaterial({
      vertexShader: source.vertexShader,
      fragmentShader: source.fragmentShader,
      uniforms,
      // Required `true` by the parameter type, not defaulted here. See
      // `ThreeShaderMaterialParameters`: without it three does not define the
      // `color` attribute and the shader fails to link in the browser only.
      vertexColors: true,
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
export const UNIFORM_ORIGIN: ReadonlyArray<number> = [0, 0, 0]

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
    uTime: { value: 0 },
    uRefractionMap: { value: null },
    // NOT `null`. See `UNIFORM_ORIGIN` — a null here is a TypeError inside
    // three's uniform upload, on a real driver, and on no test in Node.
    uCameraPosition: { value: [...UNIFORM_ORIGIN] },
    uResolution: { value: [viewport.width, viewport.height] },
    uRefractionValid: { value: REFRACTION_UNAVAILABLE },
    uSunIntensity: { value: sunIntensity },
  }
  return {
    material: new three.ShaderMaterial({
      vertexShader: source.vertexShader,
      fragmentShader: source.fragmentShader,
      uniforms,
      vertexColors: true,
    }),
    uniforms,
  }
}

/** How a chunk's geometry is keyed while it is in the scene. */
export type ChunkKey = string

/** Coarse render policy without importing simulation entity classes. */
export type EntityRenderCategory = 'hostile' | 'item'

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
  /** Number of entity meshes currently owned by the renderer. */
  readonly entityCount: Effect.Effect<number>
  /** Last reconciled renderer DTOs, detached from caller-owned values. */
  readonly entitySnapshot: Effect.Effect<ReadonlyArray<RenderEntity>>
  /** Frames actually submitted to the GPU by this renderer. */
  readonly framesRendered: Effect.Effect<number>
  /** Release the renderer, every chunk geometry, and the shared material. */
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
}

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
const safeAspect = (viewport: Viewport): number =>
  viewport.width > 0 && viewport.height > 0 ? viewport.width / viewport.height : 1

type PositionedThreeMesh = ThreeMesh & { readonly position: ThreeVector3 }

type EntityStyle = {
  readonly width: number
  readonly height: number
  readonly depth: number
  readonly color: readonly [number, number, number]
}

const entityStyle = (entity: RenderEntity): EntityStyle => {
  if (entity.category === 'item') {
    return { width: 0.3, height: 0.3, depth: 0.3, color: [225, 165, 65] }
  }
  switch (entity.kind) {
    case 'creeper':
      return { width: 0.55, height: 1.7, depth: 0.55, color: [75, 180, 70] }
    case 'enderman':
      return { width: 0.5, height: 2.9, depth: 0.5, color: [40, 35, 45] }
    case 'zombie':
      return { width: 0.65, height: 1.8, depth: 0.45, color: [100, 160, 95] }
    default:
      return { width: 0.6, height: 1.8, depth: 0.5, color: [165, 85, 55] }
  }
}

const entityBuffers = (style: EntityStyle) => {
  const x = style.width / 2
  const z = style.depth / 2
  const positions = new Float32Array([
    -x, 0, -z, x, 0, -z, x, style.height, -z, -x, style.height, -z,
    -x, 0, z, x, 0, z, x, style.height, z, -x, style.height, z,
  ])
  const colors = new Uint8Array(8 * COLOR_COMPONENTS)
  for (let offset = 0; offset < colors.length; offset += COLOR_COMPONENTS) {
    colors.set(style.color, offset)
  }
  return {
    positions,
    colors,
    indices: new Uint32Array([
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 4, 7, 0, 7, 3,
      1, 2, 6, 1, 6, 5, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2,
    ]),
  }
}

const copyEntity = (entity: RenderEntity): RenderEntity => ({
  id: entity.id,
  kind: entity.kind,
  feetPosition: { ...entity.feetPosition },
  ...(entity.category === undefined ? {} : { category: entity.category }),
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
    ) => PositionedThreeMesh
  },
  canvas: TCanvas,
  viewport: Viewport,
  options: WorldRendererOptions<TUsedMaterial> = {},
): Effect.Effect<WorldRenderer> =>
  Effect.gen(function* () {
    const renderer: ThreeWebGLRenderer = new three.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    })

    renderer.setSize(viewport.width, viewport.height, UPDATE_CANVAS_STYLE)
    const fovDegrees = options.fovDegrees ?? CAMERA_FOV_DEGREES
    const nearPlane = options.nearPlane ?? CAMERA_NEAR_PLANE
    const farPlane = options.farPlane ?? CAMERA_FAR_PLANE
    const initialAspect = safeAspect(viewport)
    const initialEnvironment = planRenderEnvironment(options.daylight ?? 1, farPlane)
    renderer.setClearColor(options.clearColor ?? initialEnvironment.skyColor, SKY_CLEAR_ALPHA)
    options.applyMaterialEnvironment?.(initialEnvironment)

    const scene: ThreeScene = new three.Scene()
    const camera: ThreePerspectiveCamera = new three.PerspectiveCamera(
      fovDegrees,
      initialAspect,
      nearPlane,
      farPlane,
    )

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
     * saying why: `requiresForceSinglePass` fires on shared + two-pass + cutout,
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

    const chunks = yield* Ref.make(
      new Map<
        ChunkKey,
        {
          readonly mesh: ThreeMesh
          readonly geometry: TGeometry
          readonly bounds: AxisAlignedBounds | undefined
        }
      >(),
    )
    const viewportAspect = yield* Ref.make(initialAspect)
    type EntityEntry = {
      readonly entity: RenderEntity
      readonly mesh: PositionedThreeMesh
      readonly geometry: TGeometry
      readonly material: TMaterial
    }
    const entities = yield* Ref.make(new Map<string, EntityEntry>())
    const framesRendered = yield* Ref.make(0)

    const buildGeometry = (buffers: ChunkGeometryBuffers): TGeometry => {
      const geometry = new three.BufferGeometry()
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
      // UPLOADED ON BOTH PATHS, though only the shader reads it. An unused
      // attribute costs one buffer per chunk; a MISSING one costs a world drawn
      // entirely from atlas tile 0, because GL supplies 0 for an attribute no
      // buffer is bound to and reports nothing. The name comes from
      // `CHUNK_SHADER_ATTRIBUTES` rather than a literal so the two cannot drift
      // — `test/chunk-shader-geometry.test.ts` asserts that they have not.
      geometry.setAttribute(
        CHUNK_SHADER_ATTRIBUTES.tileIndex,
        new three.BufferAttribute(buffers.tileIndices, TILE_INDEX_COMPONENTS, false),
      )
      geometry.setIndex(new three.BufferAttribute(buffers.indices, 1, false))
      // Before the first render, not lazily. See `ThreeBufferGeometry`: three
      // computes this on demand and warns on an empty position attribute, and
      // an empty chunk is the normal case at the edge of the loaded world.
      geometry.computeBoundingSphere()
      return geometry
    }

    const releaseChunk = (entry: { readonly mesh: ThreeMesh; readonly geometry: TGeometry }): void => {
      scene.remove(entry.mesh)
      entry.geometry.dispose()
    }

    const buildEntity = (entity: RenderEntity): EntityEntry => {
      const buffers = entityBuffers(entityStyle(entity))
      const geometry = new three.BufferGeometry()
      geometry.setAttribute(
        'position',
        new three.BufferAttribute(buffers.positions, POSITION_COMPONENTS, false),
      )
      geometry.setAttribute(
        'color',
        new three.BufferAttribute(buffers.colors, COLOR_COMPONENTS, true),
      )
      geometry.setIndex(new three.BufferAttribute(buffers.indices, 1, false))
      geometry.computeBoundingSphere()
      const entityMaterial = new three.MeshBasicMaterial({ vertexColors: true, wireframe: false })
      const mesh = new three.Mesh(geometry, entityMaterial)
      mesh.position.set(entity.feetPosition.x, entity.feetPosition.y, entity.feetPosition.z)
      scene.add(mesh)
      return { entity, mesh, geometry, material: entityMaterial }
    }

    const releaseEntity = (entry: EntityEntry): void => {
      scene.remove(entry.mesh)
      entry.geometry.dispose()
      entry.material.dispose()
    }

    return {
      setEnvironment: (environment) =>
        Effect.sync(() => {
          renderer.setClearColor(environment.skyColor, SKY_CLEAR_ALPHA)
          options.applyMaterialEnvironment?.(environment)
        }),

      setChunk: (key, buffers) =>
        Ref.update(chunks, (current) => {
          const previous = current.get(key)
          if (previous !== undefined) {
            releaseChunk(previous)
          }
          const geometry = buildGeometry(buffers)
          const mesh = new three.Mesh(geometry, material)
          const bounds = boundsFromPositions(buffers.positions)
          mesh.frustumCulled = false
          mesh.visible = bounds !== undefined
          scene.add(mesh)
          const next = new Map(current)
          next.set(key, { mesh, geometry, bounds })
          return next
        }),

      removeChunk: (key) =>
        Ref.update(chunks, (current) => {
          const entry = current.get(key)
          if (entry === undefined) {
            return current
          }
          releaseChunk(entry)
          const next = new Map(current)
          next.delete(key)
          return next
        }),

      chunkKeys: Ref.get(chunks).pipe(Effect.map((current) => [...current.keys()])),

      syncEntities: (incoming) =>
        Ref.update(entities, (current) => {
          const desired = new Map(incoming.map((entity) => [entity.id, copyEntity(entity)]))
          const next = new Map<string, EntityEntry>()
          for (const [id, entity] of desired) {
            const previous = current.get(id)
            if (
              previous !== undefined &&
              previous.entity.kind === entity.kind &&
              previous.entity.category === entity.category
            ) {
              previous.mesh.position.set(
                entity.feetPosition.x,
                entity.feetPosition.y,
                entity.feetPosition.z,
              )
              next.set(id, { ...previous, entity })
            } else {
              if (previous !== undefined) {
                releaseEntity(previous)
              }
              next.set(id, buildEntity(entity))
            }
          }
          for (const [id, entry] of current) {
            if (!desired.has(id)) {
              releaseEntity(entry)
            }
          }
          return next
        }),

      entityCount: Ref.get(entities).pipe(Effect.map((current) => current.size)),

      entitySnapshot: Ref.get(entities).pipe(
        Effect.map((current) => [...current.values()].map(({ entity }) => copyEntity(entity))),
      ),

      framesRendered: Ref.get(framesRendered),

      draw: (mirrored: MirroredCameraState) =>
        Effect.gen(function* () {
          // The copy, in the one direction that is allowed. `rotation.order` is
          // pinned to 'YXZ' by the surface's type, so a mirror that changed the
          // order would not compile — see `domain/camera-mirror.ts` on why the
          // order is load-bearing.
          camera.position.set(mirrored.position.x, mirrored.position.y, mirrored.position.z)
          camera.rotation.set(
            mirrored.rotation.x,
            mirrored.rotation.y,
            mirrored.rotation.z,
            mirrored.rotation.order,
          )
          const [currentChunks, aspect] = yield* Effect.all([
            Ref.get(chunks),
            Ref.get(viewportAspect),
          ])
          for (const entry of currentChunks.values()) {
            entry.mesh.visible =
              entry.bounds !== undefined &&
              aabbIntersectsPerspectiveFrustum(entry.bounds, {
                camera: mirrored,
                verticalFovDegrees: fovDegrees,
                aspect,
                nearPlane,
                farPlane,
              })
          }
          renderer.render(scene, camera)
          yield* Ref.update(framesRendered, (drawn) => drawn + 1)
        }),

      resize: (width, height) =>
        Effect.gen(function* () {
          renderer.setSize(width, height, UPDATE_CANVAS_STYLE)
          const aspect = safeAspect({ width, height })
          camera.aspect = aspect
          // Without this the projection matrix keeps the old aspect and the
          // world stretches. three does not recompute it on assignment.
          camera.updateProjectionMatrix()
          yield* Ref.set(viewportAspect, aspect)
        }),

      dispose: Effect.all([
        Ref.getAndSet(chunks, new Map()),
        Ref.getAndSet(entities, new Map()),
      ]).pipe(
        Effect.map(([currentChunks, currentEntities]) => {
          for (const entry of currentChunks.values()) {
            releaseChunk(entry)
          }
          for (const entry of currentEntities.values()) {
            releaseEntity(entry)
          }
          material.dispose()
          renderer.dispose()
        }),
      ),
    }
  })
