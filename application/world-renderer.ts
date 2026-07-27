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
  COLOR_COMPONENTS,
  NORMAL_COMPONENTS,
  POSITION_COMPONENTS,
  UV_COMPONENTS,
  type ChunkGeometryBuffers,
} from '../domain/chunk-geometry'
import type {
  ThreeBufferGeometry,
  ThreeMaterial,
  ThreeMesh,
  ThreePerspectiveCamera,
  ThreeScene,
  ThreeSurface,
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
export const SKY_CLEAR_COLOR = 0x87ceeb

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

/** How a chunk's geometry is keyed while it is in the scene. */
export type ChunkKey = string

/**
 * The renderer, as its owner holds it.
 *
 * `DrawPort` is the part the FRAME needs; the rest is the part the chunk-sync
 * path needs, and they are one object because they share the scene. Splitting
 * them would mean two handles to one `Scene`, and the second one would be the
 * one somebody eventually adds a light to.
 */
export type WorldRenderer = DrawPort & {
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
  /** Frames actually submitted to the GPU by this renderer. */
  readonly framesRendered: Effect.Effect<number>
  /** Release the renderer, every chunk geometry, and the shared material. */
  readonly dispose: Effect.Effect<void>
}

/** Everything a caller may vary. Each field's default is documented above. */
export type WorldRendererOptions = {
  readonly fovDegrees?: number
  readonly nearPlane?: number
  readonly farPlane?: number
  readonly clearColor?: number
  /** Draw edges instead of filled faces. For diagnosing a geometry, not for play. */
  readonly wireframe?: boolean
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
>(
  three: ThreeSurface<TCanvas, TGeometry, TMaterial>,
  canvas: TCanvas,
  viewport: Viewport,
  options: WorldRendererOptions = {},
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
    renderer.setClearColor(options.clearColor ?? SKY_CLEAR_COLOR, SKY_CLEAR_ALPHA)

    const scene: ThreeScene = new three.Scene()
    const camera: ThreePerspectiveCamera = new three.PerspectiveCamera(
      options.fovDegrees ?? CAMERA_FOV_DEGREES,
      safeAspect(viewport),
      options.nearPlane ?? CAMERA_NEAR_PLANE,
      options.farPlane ?? CAMERA_FAR_PLANE,
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
    const material: TMaterial = new three.MeshBasicMaterial({
      vertexColors: true,
      wireframe: options.wireframe ?? false,
    })

    const chunks = yield* Ref.make(
      new Map<ChunkKey, { readonly mesh: ThreeMesh; readonly geometry: TGeometry }>(),
    )
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

    return {
      setChunk: (key, buffers) =>
        Ref.update(chunks, (current) => {
          const previous = current.get(key)
          if (previous !== undefined) {
            releaseChunk(previous)
          }
          const geometry = buildGeometry(buffers)
          const mesh = new three.Mesh(geometry, material)
          scene.add(mesh)
          const next = new Map(current)
          next.set(key, { mesh, geometry })
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
          renderer.render(scene, camera)
          yield* Ref.update(framesRendered, (drawn) => drawn + 1)
        }),

      resize: (width, height) =>
        Effect.sync(() => {
          renderer.setSize(width, height, UPDATE_CANVAS_STYLE)
          camera.aspect = safeAspect({ width, height })
          // Without this the projection matrix keeps the old aspect and the
          // world stretches. three does not recompute it on assignment.
          camera.updateProjectionMatrix()
        }),

      dispose: Ref.getAndSet(chunks, new Map()).pipe(
        Effect.map((current) => {
          for (const entry of current.values()) {
            releaseChunk(entry)
          }
          material.dispose()
          renderer.dispose()
        }),
      ),
    }
  })
