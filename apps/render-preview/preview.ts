/**
 * Draw a fixture chunk through mc-render's textured path, and count the pixels.
 *
 * Lowered from mc-compose's `apps/render-preview`. The only
 * change from the compose original is the import below: it now reads
 * `../../src/index.js`, this package's own source, rather than
 * `@nerima-games/mc-render` — the app lives beside the code it draws now,
 * instead of consuming it through the published package graph.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 *
 * PROVES: that `buildChunkGeometry` -> `setChunk` -> `draw` with a
 * `ShaderMaterial` produces non-background pixels on a real GPU, and that the
 * `tileIndex` attribute reaches the fragment stage — the atlas below gives every
 * tile a different colour, so a broken tile path renders one flat colour and
 * the tile-variety assertion fails.
 *
 * THE QUADS ARE REAL. `terrain-fixture.json` is the output of
 * `generateChunkAt(20260728, cx, cz)` from mc-worldgen, meshed by mc-meshing's
 * `meshChunk` with its greedy merge, for a 3x3 block of chunks — 2,181 quads.
 * Nothing on this page authored a vertex.
 *
 * DOES NOT PROVE: that a world reaches the renderer AT RUNTIME. The fixture is
 * loaded as DATA, by `fetch`, because this preview intentionally keeps the
 * generated-world path out of its fixture-only entry point. The direct-import
 * boundary is enforced by `.oxlintrc.json` and `pnpm lint`; the browser game
 * path is verified separately through the published package graph. So this is
 * exactly what docs/testing.md asks mc-render's preview to be — 「固定チャンクを
 * 読み込んで」, LOAD A FIXED CHUNK — and it is not a running world. Calling it
 * "the game renders" would be the green-lamp-with-nothing-behind-it that
 * docs/testing.md §3.4 rejects by name.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ATLAS IS GENERATED RATHER THAN LOADED
 * ---------------------------------------------------------------------------
 *
 * There is no atlas PNG in the organisation yet — `domain/block-texture-map.ts`
 * assigns 120 blocks to tile indices and the image itself is still outstanding.
 * A generated one is BETTER for this page than the real one would be: each tile
 * is a flat, distinct colour, so "which tile did this face sample" is readable
 * from a pixel rather than from an artist's texture. A photographic atlas would
 * make a tile-index bug look like a texture.
 */
import * as THREE from 'three'
import { Context, Effect, Layer, Scope } from 'effect'
import {
  ATLAS_COLUMNS,
  browserInputLayer,
  InputService,
  chunkKeyOf,
  makeChunkShaderMaterial,
  makeWorldRenderer,
  SKY_CLEAR_COLOR,
  syncWorld,
  type ChunkRef,
  type GeometryQuad,
  type MeshQuad,
  type MirroredCameraState,
} from '../../src/index.js'

const VIEWPORT = { width: 640, height: 360 }

/** Pixels per atlas tile in the generated image. Small; they are flat colours. */
const TILE_PIXELS = 16

/**
 * A camera looking down at the fixture from one corner.
 *
 * CAST for the same reason `apps/shader-probe/probe.ts` casts: `position` and
 * `sourceCapturedAtSecs` are kernel's branded types and mc-render deliberately
 * does not re-export kernel's vocabulary. A brand has no runtime
 * representation and the renderer reads six numbers off this.
 */
/**
 * Just above the terrain, looking across it.
 *
 * y = 62 is MEASURED, not guessed: the fixture's top faces sit at y 37-41
 * (median 39), with a few outcrops to 71. Three earlier attempts put the camera
 * at 96, 104 and 150 on the assumption that a Minecraft-like world has its
 * surface near y=64, and all three drew a handful of pixels or none — the
 * camera was between 55 and 110 metres above the ground, pitched down, with the
 * terrain far outside the frustum. Reading the fixture answered in one query
 * what three screenshots had not.
 */
const START_POSE = { x: 8, y: 48, z: 32, yaw: 0, pitch: -0.16 }

/** Metres per second the fly camera moves. Fast enough to cross a chunk. */
const FLY_SPEED_M_PER_S = 24

/** Radians of yaw/pitch per pixel of pointer movement. */
const LOOK_SENSITIVITY = 0.0022

/** Pitch is clamped just inside vertical; at exactly +-pi/2 the yaw basis degenerates. */
const MAX_PITCH = Math.PI / 2 - 0.01

/**
 * How far around the camera chunks are kept in the scene.
 *
 * Small on purpose: the fixture is a 7x7 square, so a radius of 2 means the
 * loaded set genuinely CHANGES as the camera crosses a chunk boundary. A radius
 * that covered the whole fixture would load everything once and never stream,
 * and the streaming assertion would pass without streaming.
 */
const STREAM_RADIUS_CHUNKS = 2

const cameraFrom = (pose: typeof START_POSE): MirroredCameraState =>
  ({
    position: { x: pose.x, y: pose.y, z: pose.z },
    rotation: { x: pose.pitch, y: pose.yaw, z: 0, order: 'YXZ' },
    sourceCapturedAtSecs: 0,
  }) as unknown as MirroredCameraState

const PREVIEW_CAMERA = cameraFrom(START_POSE)

/**
 * A quad as the fixture stores it: mc-meshing's `Quad`, plus its resolved tile.
 *
 * The TILE IS BAKED IN because resolving it needs `blockId -> name`, and the
 * names are mc-kernel's closed union. The published kernel package is
 * available to the project, while this fixture still stores the resolved tile
 * as data rather than importing the world-generation path. `domain/
 * block-texture-map.ts`'s `BlockNameLookup`
 * header is the same argument from mc-render's side: the vocabulary is carried
 * whole or not carried, and this page needs a number, not a union.
 */
type FixtureQuad = MeshQuad & { readonly tile: number }

type TerrainFixture = {
  readonly seed: number
  readonly radius: number
  readonly totalQuads: number
  readonly chunks: ReadonlyArray<{
    readonly cx: number
    readonly cz: number
    readonly quads: ReadonlyArray<FixtureQuad>
  }>
}

/** The tile the generator resolved, not one this page invents. */
// mc-render's QuadTile signature is `(quad: GeometryQuad) => number`, wider than
// the MeshQuad-only fixtures this preview builds; the cast below is unchanged,
// only the parameter type widened to satisfy that signature.
const fixtureTile = (quad: GeometryQuad): number => (quad as FixtureQuad).tile

/**
 * A 16x16 grid of flat, distinct colours, as a `THREE.Texture`.
 *
 * `NearestFilter` is not cosmetic: with the default linear filter the tiles
 * blend at their shared edges and the "how many distinct colours" count below
 * would read the blend as extra tiles.
 */
const generateAtlas = (): THREE.Texture => {
  const size = ATLAS_COLUMNS * TILE_PIXELS
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error('the atlas canvas has no 2d context')
  }
  for (let tile = 0; tile < ATLAS_COLUMNS * ATLAS_COLUMNS; tile += 1) {
    const column = tile % ATLAS_COLUMNS
    const row = Math.floor(tile / ATLAS_COLUMNS)
    // Spread the hue so adjacent tiles are far apart in colour.
    context.fillStyle = `hsl(${String((tile * 47) % 360)}, 70%, 55%)`
    context.fillRect(column * TILE_PIXELS, row * TILE_PIXELS, TILE_PIXELS, TILE_PIXELS)
  }
  const texture = new THREE.Texture(canvas)
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return texture
}

/** `SKY_CLEAR_COLOR` as the three bytes `readPixels` returns. */
const skyBytes = (): readonly [number, number, number] => [
  (SKY_CLEAR_COLOR >> 16) & 0xff,
  (SKY_CLEAR_COLOR >> 8) & 0xff,
  SKY_CLEAR_COLOR & 0xff,
]

const main = async (): Promise<void> => {
  const canvas = document.getElementById('preview-canvas')
  const report = document.getElementById('preview-report')
  if (!(canvas instanceof HTMLCanvasElement) || report === null) {
    document.body.setAttribute('data-render-preview', 'failed')
    return
  }
  canvas.width = VIEWPORT.width
  canvas.height = VIEWPORT.height

  const renderer = await Effect.runPromise(
    makeWorldRenderer<
      HTMLCanvasElement,
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial,
      THREE.ShaderMaterial
    >(THREE, canvas, VIEWPORT, {
      material: () =>
        makeChunkShaderMaterial<
          HTMLCanvasElement,
          THREE.BufferGeometry,
          THREE.MeshBasicMaterial,
          THREE.ShaderMaterial
        >(THREE, generateAtlas()).material,
    }),
  )

  // REAL GENERATED TERRAIN, loaded as data. See this file's header on why it
  // arrives as JSON rather than as a call into mc-worldgen.
  const fixtureUrl = new URL('./terrain-fixture.json', import.meta.url)
  const fixture = (await (await fetch(fixtureUrl)).json()) as TerrainFixture

  const quadsByKey = new Map<string, ReadonlyArray<FixtureQuad>>(
    fixture.chunks.map((chunk) => [chunkKeyOf(chunk), chunk.quads]),
  )

  /**
   * The mesher `syncWorld` calls. It LOOKS UP rather than meshes, because the
   * meshing already happened — in mc-meshing, at fixture-generation time. The
   * port does not care which: it asks for a chunk's quads and this answers.
   *
   * `undefined` for a coordinate outside the fixture, which is the port's
   * "ask again later" and is exactly right here — outside the generated square
   * there is no terrain yet, and claiming an empty chunk would put a permanent
   * hole in the world rather than a not-yet-loaded edge.
   */
  const fixtureMesher = (chunk: ChunkRef) =>
    Effect.sync(() => quadsByKey.get(chunkKeyOf(chunk)))

  /** Chunks currently in the scene, so a batch can be a DIFFERENCE. */
  const loaded = new Set<string>()

  /** Chunks within `STREAM_RADIUS_CHUNKS` of a world position. */
  const desiredAround = (x: number, z: number): ReadonlyArray<ChunkRef> => {
    const cx0 = Math.round(x / 16)
    const cz0 = Math.round(z / 16)
    const wanted: Array<ChunkRef> = []
    for (let cx = cx0 - STREAM_RADIUS_CHUNKS; cx <= cx0 + STREAM_RADIUS_CHUNKS; cx += 1) {
      for (let cz = cz0 - STREAM_RADIUS_CHUNKS; cz <= cz0 + STREAM_RADIUS_CHUNKS; cz += 1) {
        wanted.push({ cx, cz })
      }
    }
    return wanted
  }

  /**
   * A real `DirtySource`: it reports the DIFFERENCE between what should be
   * loaded around the camera and what is.
   *
   * This is the shape mc-worldgen's `ChunkStore.subscribeDirty` has — drain
   * returns everything that changed since the last drain and clears the pending
   * set — so swapping this for the real one is a one-line change. That the port
   * accepts both is the whole reason `syncWorld` takes one.
   */
  const streamingSource = (at: { readonly x: number; readonly z: number }) => ({
    drain: Effect.sync(() => {
      const wanted = desiredAround(at.x, at.z)
      const wantedKeys = new Set(wanted.map(chunkKeyOf))
      const changed = wanted.filter((chunk) => !loaded.has(chunkKeyOf(chunk)))
      const removed = [...loaded]
        .filter((key) => !wantedKeys.has(key))
        .map((key) => {
          const [cx, cz] = key.split(',')
          return { cx: Number(cx), cz: Number(cz) }
        })
      for (const chunk of changed) {
        if (quadsByKey.has(chunkKeyOf(chunk))) {
          loaded.add(chunkKeyOf(chunk))
        }
      }
      for (const chunk of removed) {
        loaded.delete(chunkKeyOf(chunk))
      }
      return { changed, removed }
    }),
  })

  // The first load, around the start pose, before anything is measured.
  await Effect.runPromise(
    syncWorld(renderer, streamingSource(START_POSE), fixtureMesher, { tile: fixtureTile }),
  )
  await Effect.runPromise(renderer.draw(PREVIEW_CAMERA))

  // `readPixels` in the SAME task as the draw. The drawing buffer is valid
  // until compositing, and `preserveDrawingBuffer` is false — so this must not
  // be deferred to a later frame or it reads a cleared buffer.
  const gl = canvas.getContext('webgl2')
  if (gl === null) {
    document.body.setAttribute('data-render-preview', 'failed')
    report.textContent = 'no webgl2 context'
    return
  }
  const pixels = new Uint8Array(VIEWPORT.width * VIEWPORT.height * 4)
  gl.readPixels(0, 0, VIEWPORT.width, VIEWPORT.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)

  const [skyR, skyG, skyB] = skyBytes()
  let drawn = 0
  const colours = new Set<string>()
  for (let at = 0; at < pixels.length; at += 4) {
    const r = pixels[at] ?? 0
    const g = pixels[at + 1] ?? 0
    const b = pixels[at + 2] ?? 0
    // A tolerance, because the sky is written as a float and read back as a
    // byte; exact equality would count rounding as geometry.
    const isSky = Math.abs(r - skyR) <= 2 && Math.abs(g - skyG) <= 2 && Math.abs(b - skyB) <= 2
    if (!isSky) {
      drawn += 1
      // Quantised, so that shading gradients within one tile do not inflate
      // the count — this is asking "how many TILES are visible".
      colours.add(`${String(r >> 4)},${String(g >> 4)},${String(b >> 4)}`)
    }
  }

  report.textContent = [
    `seed ${String(fixture.seed)} — ${String(fixture.chunks.length)} chunks generated, ` +
      `${String(fixture.totalQuads)} quads`,
    `streaming radius ${String(STREAM_RADIUS_CHUNKS)}; loaded now: ${String(loaded.size)}`,
    `pixels drawn: ${String(drawn)} of ${String(VIEWPORT.width * VIEWPORT.height)}`,
    `distinct tile colours: ${String(colours.size)}`,
  ].join('\n')

  document.body.setAttribute('data-render-preview', drawn > 0 ? 'drawn' : 'empty')
  document.body.setAttribute('data-pixels-drawn', String(drawn))
  document.body.setAttribute('data-tile-colours', String(colours.size))

  // -------------------------------------------------------------------------
  // Interactive: WASD + mouse-look, through mc-render's own InputService
  // -------------------------------------------------------------------------
  //
  // THE MEASUREMENT ABOVE IS TAKEN BEFORE THIS STARTS, deliberately. The pixel
  // assertions describe a KNOWN pose; once the operator can move, "how many
  // pixels are drawn" stops being a fact about the renderer and becomes a fact
  // about where they were looking. A test that read those attributes after the
  // loop began would be flaky for a reason no one would guess.
  //
  // `browserInputLayer` and not raw key listeners: the point of doing it this
  // way is that this exercises mc-render's `InputService` — the same one
  // `apps/web/main.ts` composes — including the binding table and the pointer
  // lock state machine. A hand-rolled `keydown` handler here would demonstrate
  // nothing about the module.
  const scope = Effect.runSync(Scope.make())
  const inputLayer = browserInputLayer({
    targets: { window, document },
    canvas,
    allowsPointerLock: () => true,
  })
  const inputContext = await Effect.runPromise(
    Effect.provideService(Layer.build(inputLayer), Scope.Scope, scope),
  )
  const input = Context.get(inputContext, InputService)

  canvas.addEventListener('click', () => {
    Effect.runPromise(input.requestPointerLock).catch((error: unknown) => {
      console.error('pointer lock request failed:', error)
    })
  })

  const pose = { ...START_POSE }
  let previous = 0
  let frames = 0
  let streamed = 0
  let dropped = 0

  const step = (nowMillis: number): void => {
    const dt = previous === 0 ? 0.016 : Math.min(0.05, (nowMillis - previous) / 1000)
    previous = nowMillis

    const snapshot = Effect.runSync(input.snapshot)

    // Yaw first, then pitch, and pitch clamped — the same 'YXZ' convention
    // `domain/camera-mirror.ts` pins into the surface type. Applying them in
    // the other order tilts the horizon when looking up while turning.
    pose.yaw -= snapshot.pointerDelta.x * LOOK_SENSITIVITY
    pose.pitch = Math.max(
      -MAX_PITCH,
      Math.min(MAX_PITCH, pose.pitch - snapshot.pointerDelta.y * LOOK_SENSITIVITY),
    )

    const active = (action: Parameters<typeof input.isActionActive>[0]): number =>
      Effect.runSync(input.isActionActive(action)) ? 1 : 0

    const forward = active('moveForward') - active('moveBackward')
    const strafe = active('moveRight') - active('moveLeft')
    const lift = active('jump') - active('sneak')

    // Movement is on the horizontal plane regardless of pitch — a fly camera,
    // not a free camera. Looking down and walking forward should not sink you
    // into the ground, which is the behaviour a player expects from WASD.
    const sinYaw = Math.sin(pose.yaw)
    const cosYaw = Math.cos(pose.yaw)
    const speed = FLY_SPEED_M_PER_S * dt
    pose.x += (-sinYaw * forward + cosYaw * strafe) * speed
    pose.z += (-cosYaw * forward - sinYaw * strafe) * speed
    pose.y += lift * speed

    // STREAM, then draw. `syncWorld` drains once per frame — see its header on
    // why one drain and not a loop: meshing a chunk can dirty its neighbours,
    // and a loop-until-empty has no bound on a frame's work.
    const syncReport = Effect.runSync(
      syncWorld(renderer, streamingSource(pose), fixtureMesher, { tile: fixtureTile }),
    )
    streamed += syncReport.meshed
    dropped += syncReport.removed

    Effect.runSync(renderer.draw(cameraFrom(pose)))

    frames += 1
    document.body.setAttribute('data-preview-frames', String(frames))
    // The POSE, not a pixel checksum. `preserveDrawingBuffer` is false, so a
    // `readPixels` from outside the draw task reads a cleared buffer — the
    // first cut of the interactive test compared two such reads and they were
    // trivially equal, which is a test that passes for the wrong reason in one
    // direction and fails for the wrong reason in the other. The pose is what
    // the input path actually produces; that the pose reaches the screen is
    // what the static pixel assertions above already establish.
    document.body.setAttribute(
      'data-preview-pos',
      `${pose.x.toFixed(2)},${pose.y.toFixed(2)},${pose.z.toFixed(2)}`,
    )
    document.body.setAttribute('data-chunks-loaded', String(loaded.size))
    document.body.setAttribute('data-chunks-streamed-in', String(streamed))
    document.body.setAttribute('data-chunks-dropped', String(dropped))
    window.requestAnimationFrame(step)
  }

  document.body.setAttribute('data-preview-interactive', 'ready')
  window.requestAnimationFrame(step)
}

main().catch((error: unknown) => {
  console.error('render preview failed:', error)
})
