/**
 * Draw a fixture chunk through mc-render's textured path, and count the pixels.
 *
 * Lowered from mc-compose's `apps/render-preview`. It imports the source
 * modules it exercises directly so this fixture stays independent of the
 * package root's deferred simulation entry points.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 * ---------------------------------------------------------------------------
 *
 * PROVES: that `buildChunkGeometry` -> `setChunk` -> `draw` with a
 * `ShaderMaterial` produces non-background pixels in Chromium using the
 * SwiftShader WebGL renderer, and that the `tileIndex` attribute reaches the
 * fragment stage. Terrain faces use the checked-in block atlas. The
 * `presentation=1` view also draws the generated first-person arm and a
 * held block through the interaction renderer.
 *
 * THE DEFAULT TERRAIN QUADS ARE REAL. `terrain-fixture.json` is the output of
 * `generateChunkAt(20260728, cx, cz)` from mc-worldgen, meshed by mc-meshing's
 * `meshChunk` with its greedy merge, for radius 3 (49 chunks) — 13,218 quads.
 * The state views also use `meshChunk` output; the page does not author vertices.
 *
 * DOES NOT PROVE: that runtime world generation reaches the renderer. This
 * default preview fetches pre-generated terrain data instead of invoking worldgen.
 * `.oxlintrc.json` and `pnpm lint` enforce its direct-import boundary; browser
 * runtime paths are covered separately by E2E tests.
 *
 * `terrain-fixture.json` stores mesh quads without baked texture indices.
 * `fixtureTile` resolves each quad's block ID and face role against the
 * checked-in texture map, keeping the preview aligned with runtime meshing.
 */
import * as THREE from 'three'
import { Context, Effect, Layer, Result, Scope } from 'effect'
import { ChunkAxis, ChunkKey, PositionAxis, blockTypeOfId, chunkCoord, chunkCoordOfKey } from '@nerima-games/mc-kernel'
import {
  browserInputLayer,
} from '../../src/application/browser-input-adapter.js'
import { InputService } from '../../src/application/input-service.js'
import { makeChunkStoreMesher, type MeshingChunkStore } from '../../src/application/chunk-store-mesher.js'
import { createInteractionRenderer } from '../../src/application/interaction-renderer.js'
import { planEntityVisual } from '../../src/application/entity-visual-plan.js'
import {
  FIRST_PERSON_ARM_TEXTURE_HEIGHT,
  FIRST_PERSON_ARM_TEXTURE_WIDTH,
  makeFirstPersonArmTextureData,
} from '../../src/application/render-presentation-assets.js'
import { createSkyRenderer } from '../../src/application/sky-renderer.js'
import type { PresentationObject3D } from '../../src/application/render-presentation-surface.js'
import {
  makeChunkShaderMaterial,
  makeWorldRenderer,
  SKY_CLEAR_COLOR,
  type WorldRenderer,
} from '../../src/application/world-renderer.js'
import { chunkKeyOf, syncWorld, type ChunkRef } from '../../src/application/world-sync.js'
import { tileIndexForBlockName, type BlockTextureLookupError } from '../../src/domain/block-texture-map.js'
import type { GeometryQuad, MeshQuad } from '../../src/domain/meshing-vocabulary.js'
import type { MirroredCameraState } from '../../src/domain/camera-mirror.js'
import {
  ENTITY_MODEL_CATALOG,
} from '../../src/domain/entity-model-catalog.js'
import {
  ENTITY_MODEL_TEXTURE_ATLAS,
  entityTextureAtlasPixels,
} from '../../src/domain/entity-model-textures.js'
import { createStatePreviewChunk } from './state-fixture.js'

const VIEWPORT = { width: 640, height: 360 }
const ENTITY_GALLERY_VIEWPORT = { width: 256, height: 256 }
const ENTITY_GALLERY_COLUMNS = 16
const ENTITY_GALLERY_ROWS = 8
const ENTITY_GALLERY_EXPECTED_MODEL_COUNT = 128
const ENTITY_GALLERY_CELL_HEIGHT = 256
const ENTITY_GALLERY_LABEL_HEIGHT = 20
const ENTITY_GALLERY_FIELD_OF_VIEW = 34
const ENTITY_GALLERY_FRAME_MARGIN = 1.3
const ENTITY_GALLERY_CAMERA_ELEVATION_FACTOR = 0.3
const ENTITY_GALLERY_CAMERA_FAR_PLANE = 1_000
const ENTITY_GALLERY_LIGHT_LEVEL = 15
const ENTITY_GALLERY_ZERO = 0
const ENTITY_GALLERY_ONE = 1
const ENTITY_GALLERY_BACKGROUND_TOLERANCE = 2
const STATE_PREVIEW_POSE = { x: 8, y: 28, z: 15, yaw: 0, pitch: -0.65 }
const PIXEL_CHANNELS = 4
const SKY_PIXEL_TOLERANCE = 2

type StatePreviewMode = 'main' | 'rn6'

/**
 * A camera looking down at the fixture from one corner.
 *
 * CAST for the same reason `apps/shader-probe/main.ts` casts: `position` and
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
const PRESENTATION_DAY_START = 6_000
const PRESENTATION_DAWN_START = 0
const PRESENTATION_NIGHT_START = 18_000
const ANIMATION_TICKS_PER_SECOND = 20
const PRESENTATION_TICKS_PER_SECOND = 1_200
const PRESENTATION_MOON_PHASE = 5
const PRESENTATION_BLOCK_NAME = 'grass_block'
const PRESENTATION_CAMERA_PITCH = -0.4
const PRESENTATION_CAMERA_Z = 48
const ENTITY_PREVIEW_CAMERA_PITCH = 0
const ENTITY_PREVIEW_CAMERA_HEIGHT = 100
const ENTITY_PREVIEW_CAMERA_Z = 50
const ENTITY_PREVIEW_FOV_DEGREES = 45
const ENTITY_PREVIEW_HEIGHT = 99
const ENTITY_PREVIEW_DEPTH = 43
const ENTITY_PREVIEW_SIMULATION_TICK = 240
const ENTITY_PREVIEW_PARTIAL_TICK = 0.5
const ENTITY_PREVIEW_TIME_OF_DAY_TICKS = 7_000
const ENTITY_PREVIEW_BLOCK_LIGHT = 12
const ENTITY_PREVIEW_SKY_LIGHT = 15
const ENTITY_PREVIEW_WALK_PHASE_RADIANS = Math.PI / 2
const ENTITY_PREVIEW_WALK_AMOUNT = 0.65
const ENTITY_PREVIEW_ATTACK_PROGRESS = 0.25
const ENTITY_PREVIEW_OUTER_X_OFFSET = 3.3
const ENTITY_PREVIEW_INNER_X_OFFSET = 1.1
const NO_ENTITY_PROGRESS = 0
const NO_ENTITY_ROTATION = 0
const ENTITY_PREVIEW_MODELS = [
  { kind: 'boat', x: START_POSE.x - ENTITY_PREVIEW_OUTER_X_OFFSET, z: ENTITY_PREVIEW_DEPTH },
  { kind: 'horse', x: START_POSE.x - ENTITY_PREVIEW_INNER_X_OFFSET, z: ENTITY_PREVIEW_DEPTH },
  { kind: 'villager', x: START_POSE.x + ENTITY_PREVIEW_INNER_X_OFFSET, z: ENTITY_PREVIEW_DEPTH },
  { kind: 'tnt', x: START_POSE.x + ENTITY_PREVIEW_OUTER_X_OFFSET, z: ENTITY_PREVIEW_DEPTH },
] as const
const STARS_PREVIEW_CAMERA_PITCH = 1.2
const SKY_PREVIEW_CAMERA_HEIGHT = 188
const PRESENTATION_TARGET = {
  position: { x: 8, y: 38, z: 22 },
  shape: { boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0.5, z: 1 } }] },
} as const

const cameraFrom = (pose: typeof START_POSE, rollRadians = 0): MirroredCameraState =>
  ({
    position: { x: pose.x, y: pose.y, z: pose.z },
    rotation: { x: pose.pitch, y: pose.yaw, z: rollRadians, order: 'YXZ' },
    sourceCapturedAtSecs: 0,
  }) as unknown as MirroredCameraState

type FixtureQuad = MeshQuad

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

const fixtureTile = (quad: GeometryQuad): number => {
  const blockName = Result.getOrThrow(blockTypeOfId(quad.blockId))
  const tileIndex = tileIndexForBlockName(blockName, quad.role)
  if (Result.isFailure(tileIndex)) {
    throw tileIndex.failure
  }
  return tileIndex.success
}

const createPresentationArmTexture = (): THREE.DataTexture => {
  const texture = new THREE.DataTexture(
    makeFirstPersonArmTextureData(),
    FIRST_PERSON_ARM_TEXTURE_WIDTH,
    FIRST_PERSON_ARM_TEXTURE_HEIGHT,
  )
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  return texture
}

/** `SKY_CLEAR_COLOR` as the three bytes `readPixels` returns. */
const skyBytes = (): readonly [number, number, number] => [
  (SKY_CLEAR_COLOR >> 16) & 0xff,
  (SKY_CLEAR_COLOR >> 8) & 0xff,
  SKY_CLEAR_COLOR & 0xff,
]

const entityPreviewEntity = (id: string, kind: string, x: number, z: number) => ({
  attackProgress: ENTITY_PREVIEW_ATTACK_PROGRESS,
  blockLight: ENTITY_PREVIEW_BLOCK_LIGHT,
  bodyYawRadians: NO_ENTITY_ROTATION,
  deathProgress: NO_ENTITY_PROGRESS,
  headYawRadians: NO_ENTITY_ROTATION,
  hurtProgress: NO_ENTITY_PROGRESS,
  id,
  kind,
  pitchRadians: NO_ENTITY_ROTATION,
  position: { dimension: 'overworld', x, y: ENTITY_PREVIEW_HEIGHT, z },
  skyLight: ENTITY_PREVIEW_SKY_LIGHT,
  walkAmount: ENTITY_PREVIEW_WALK_AMOUNT,
  walkPhaseRadians: ENTITY_PREVIEW_WALK_PHASE_RADIANS,
})

const ENTITY_PREVIEW_FRAME = {
  entities: ENTITY_PREVIEW_MODELS.map(({ kind, x, z }) => entityPreviewEntity(`preview-${kind}`, kind, x, z)),
  partialTick: ENTITY_PREVIEW_PARTIAL_TICK,
  simulationTick: ENTITY_PREVIEW_SIMULATION_TICK,
  timeOfDayTicks: ENTITY_PREVIEW_TIME_OF_DAY_TICKS,
}

type EntityPreviewRenderer = Pick<
  WorldRenderer,
  'entityCount' | 'entityModelDiagnostics' | 'syncEntityFrame'
>

type EntityGalleryRenderer = Pick<WorldRenderer, 'draw' | 'entityCount' | 'entityModelDiagnostics' | 'syncEntities'>

const entityModelBounds = (parts: ReadonlyArray<{
  readonly size: readonly [number, number, number]
  readonly center: readonly [number, number, number]
  readonly rotation?: readonly [number, number, number]
}>): THREE.Box3 => {
  const bounds = new THREE.Box3()
  for (const part of parts) {
    const [sizeX, sizeY, sizeZ] = part.size
    const [centerX, centerY, centerZ] = part.center
    const [rotationX, rotationY, rotationZ] = part.rotation ?? [0, 0, 0]
    const rotation = new THREE.Euler(rotationX, rotationY, rotationZ, 'YXZ')
    for (const signX of [-1, 1]) {
      for (const signY of [-1, 1]) {
        for (const signZ of [-1, 1]) {
          bounds.expandByPoint(new THREE.Vector3(
            signX * sizeX / 2,
            signY * sizeY / 2,
            signZ * sizeZ / 2,
          ).applyEuler(rotation).add(new THREE.Vector3(centerX, centerY, centerZ)))
        }
      }
    }
  }
  return bounds
}

const configureEntityTexture = (texture: THREE.Texture): THREE.Texture => {
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = true
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  return texture
}

const loadEntityTexture = async (): Promise<THREE.Texture> => {
  const textureUrl = new URL('../../assets/entity-models/entity-textures.png', import.meta.url).href
  try {
    return configureEntityTexture(await new THREE.TextureLoader().loadAsync(textureUrl))
  } catch {
    document.body.setAttribute('data-entity-texture-fallback', 'generated-rgba')
    return configureEntityTexture(new THREE.DataTexture(
      entityTextureAtlasPixels(),
      ENTITY_MODEL_TEXTURE_ATLAS.width,
      ENTITY_MODEL_TEXTURE_ATLAS.height,
      THREE.RGBAFormat,
      THREE.UnsignedByteType,
    ))
  }
}

type EntityGalleryContext = Readonly<{
  readonly renderer: EntityGalleryRenderer
  readonly gl: WebGL2RenderingContext
  readonly context: CanvasRenderingContext2D
  readonly pixels: Uint8Array
  readonly cellStrideY: number
}>

const entityGalleryFailure = (report: HTMLElement, message: string): Result.Result<void, string> => {
  document.body.setAttribute('data-entity-gallery', 'failed')
  report.textContent = message
  return Result.fail(message)
}

const entityGalleryPose = (parts: Parameters<typeof entityModelBounds>[0]): typeof START_POSE => {
  const bounds = entityModelBounds(parts)
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const halfExtent = Math.max(size.x / 2, size.y / 2, size.z / 2)
  const distance = Math.max(
    ENTITY_GALLERY_ONE,
    halfExtent / Math.tan(THREE.MathUtils.degToRad(ENTITY_GALLERY_FIELD_OF_VIEW / 2)) * ENTITY_GALLERY_FRAME_MARGIN,
  )
  const cameraRise = distance * ENTITY_GALLERY_CAMERA_ELEVATION_FACTOR
  return {
    x: center.x,
    y: center.y + cameraRise,
    z: center.z + distance,
    yaw: ENTITY_GALLERY_ZERO,
    pitch: -Math.atan2(cameraRise, distance),
  }
}

const entityGalleryHasVisiblePixels = (pixels: Uint8Array): boolean => {
  const [skyRed, skyGreen, skyBlue] = skyBytes()
  let visiblePixels = 0
  for (let pixel = 0; pixel < pixels.length; pixel += 4) {
    const isSky = Math.abs((pixels[pixel] ?? 0) - skyRed) <= ENTITY_GALLERY_BACKGROUND_TOLERANCE &&
      Math.abs((pixels[pixel + 1] ?? 0) - skyGreen) <= ENTITY_GALLERY_BACKGROUND_TOLERANCE &&
      Math.abs((pixels[pixel + 2] ?? 0) - skyBlue) <= ENTITY_GALLERY_BACKGROUND_TOLERANCE
    if (!isSky) {
      visiblePixels += 1
    }
  }
  return visiblePixels > 0
}

const paintEntityGalleryCell = (
  { context, pixels, cellStrideY }: EntityGalleryContext,
  kind: string,
  index: number,
): void => {
  const image = context.createImageData(ENTITY_GALLERY_VIEWPORT.width, ENTITY_GALLERY_VIEWPORT.height)
  for (let y = 0; y < ENTITY_GALLERY_VIEWPORT.height; y += 1) {
    const sourceY = ENTITY_GALLERY_VIEWPORT.height - y - 1
    const sourceStart = sourceY * ENTITY_GALLERY_VIEWPORT.width * 4
    const targetStart = y * ENTITY_GALLERY_VIEWPORT.width * 4
    image.data.set(pixels.subarray(sourceStart, sourceStart + ENTITY_GALLERY_VIEWPORT.width * 4), targetStart)
  }
  const column = index % ENTITY_GALLERY_COLUMNS
  const row = Math.floor(index / ENTITY_GALLERY_COLUMNS)
  const targetX = column * ENTITY_GALLERY_VIEWPORT.width
  const targetY = row * cellStrideY
  context.putImageData(image, targetX, targetY)
  context.fillStyle = '#d8dee9'
  context.fillText(
    kind.replaceAll('_', ' '),
    targetX + ENTITY_GALLERY_VIEWPORT.width / 2,
    targetY + ENTITY_GALLERY_CELL_HEIGHT + ENTITY_GALLERY_LABEL_HEIGHT / 2,
  )
}

const drawEntityContactSheetCell = async (
  gallery: EntityGalleryContext,
  report: HTMLElement,
  model: (typeof ENTITY_MODEL_CATALOG)[number],
  index: number,
): Promise<Result.Result<void, string>> => {
  const { renderer, gl, pixels } = gallery
  const kind = String(model.kind)
  const feetPosition = {
    x: PositionAxis(ENTITY_GALLERY_ZERO),
    y: PositionAxis(ENTITY_GALLERY_ZERO),
    z: PositionAxis(ENTITY_GALLERY_ZERO),
  }
  const plannedVisual = planEntityVisual({ id: `gallery-${kind}`, kind, feetPosition })
  if (Result.isFailure(plannedVisual)) {
    return entityGalleryFailure(report, JSON.stringify({ kind, issue: plannedVisual.failure }))
  }
  await Effect.runPromise(renderer.syncEntities([{
    id: `gallery-${kind}`,
    kind,
    feetPosition,
    blockLight: ENTITY_GALLERY_LIGHT_LEVEL,
    skyLight: ENTITY_GALLERY_LIGHT_LEVEL,
  }]))
  const [entityCount, diagnostics] = await Effect.runPromise(Effect.all([
    renderer.entityCount,
    renderer.entityModelDiagnostics,
  ]))
  if (entityCount !== 1 || diagnostics.length !== 0) {
    return entityGalleryFailure(report, JSON.stringify({ kind, entityCount, diagnostics }))
  }
  await Effect.runPromise(renderer.draw(cameraFrom(entityGalleryPose(plannedVisual.success.parts))))
  gl.readPixels(
    0,
    0,
    ENTITY_GALLERY_VIEWPORT.width,
    ENTITY_GALLERY_VIEWPORT.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  )
  if (!entityGalleryHasVisiblePixels(pixels)) {
    return entityGalleryFailure(report, `${kind} produced no visible pixels in its gallery cell.`)
  }
  paintEntityGalleryCell(gallery, kind, index)
  return Result.succeed(undefined)
}

const drawEntityContactSheet = async (
  renderer: EntityGalleryRenderer,
  webglCanvas: HTMLCanvasElement,
  contactCanvas: HTMLCanvasElement,
  report: HTMLElement,
): Promise<boolean> => {
  const context = contactCanvas.getContext('2d')
  const gl = webglCanvas.getContext('webgl2')
  if (context === null || gl === null) {
    entityGalleryFailure(report, 'Contact sheet requires 2D canvas and WebGL2 contexts.')
    return false
  }

  const cellStrideY = ENTITY_GALLERY_CELL_HEIGHT + ENTITY_GALLERY_LABEL_HEIGHT
  contactCanvas.width = ENTITY_GALLERY_COLUMNS * ENTITY_GALLERY_VIEWPORT.width
  contactCanvas.height = ENTITY_GALLERY_ROWS * cellStrideY
  context.fillStyle = '#171a21'
  context.fillRect(0, 0, contactCanvas.width, contactCanvas.height)
  context.font = '10px ui-monospace, monospace'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  const gallery = {
    cellStrideY,
    context,
    gl,
    pixels: new Uint8Array(ENTITY_GALLERY_VIEWPORT.width * ENTITY_GALLERY_VIEWPORT.height * 4),
    renderer,
  }
  const allModelsRendered = await ENTITY_MODEL_CATALOG.reduce<Promise<boolean>>(
    (previous, model, index) => previous.then(async (wasComplete) => {
      if (!wasComplete) {
        return false
      }
      const rendered = await drawEntityContactSheetCell(gallery, report, model, index)
      return Result.isSuccess(rendered)
    }),
    Promise.resolve(true),
  )
  if (!allModelsRendered) {
    return false
  }
  if (ENTITY_MODEL_CATALOG.length !== ENTITY_GALLERY_EXPECTED_MODEL_COUNT) {
    entityGalleryFailure(report, `Expected ${String(ENTITY_GALLERY_EXPECTED_MODEL_COUNT)} entity models.`)
    return false
  }
  document.body.setAttribute('data-entity-gallery', 'drawn')
  document.body.setAttribute('data-entity-gallery-count', String(ENTITY_MODEL_CATALOG.length))
  report.textContent = `Rendered ${String(ENTITY_MODEL_CATALOG.length)} entity models through WorldRenderer.syncEntities with the generated CC0 texture atlas.`
  return true
}

const drawEntityPreview = async (renderer: EntityPreviewRenderer, report: HTMLElement): Promise<boolean> => {
  await Effect.runPromise(renderer.syncEntityFrame(ENTITY_PREVIEW_FRAME))
  const { count, diagnostics } = await Effect.runPromise(Effect.all({
    count: renderer.entityCount,
    diagnostics: renderer.entityModelDiagnostics,
  }))
  const rendered = count === ENTITY_PREVIEW_MODELS.length && diagnostics.length === 0
  document.body.setAttribute('data-render-entities', rendered ? 'drawn' : 'failed')
  document.body.setAttribute('data-entity-count', String(count))
  document.body.setAttribute('data-entity-kinds', ENTITY_PREVIEW_MODELS.map(({ kind }) => kind).join(','))
  if (!rendered) {
    document.body.setAttribute('data-render-preview', 'failed')
    report.textContent = JSON.stringify({ count, diagnostics })
    return false
  }
  return true
}

type PresentationAttachmentPort = {
  readonly attachSceneObject: (object: PresentationObject3D) => Effect.Effect<void>
  readonly detachSceneObject: (object: PresentationObject3D) => Effect.Effect<void>
  readonly attachCameraObject: (object: PresentationObject3D) => Effect.Effect<void>
  readonly detachCameraObject: (object: PresentationObject3D) => Effect.Effect<void>
}

type PreviewPresentation = {
  readonly enabled: boolean
  readonly startPose: typeof START_POSE
  readonly update: (pose: typeof START_POSE, elapsedSeconds: number) => Result.Result<number, unknown>
  readonly dispose: () => void
}

const createPreviewPresentation = async (
  renderer: PresentationAttachmentPort,
  atlasTexture: THREE.Texture,
): Promise<Result.Result<PreviewPresentation, BlockTextureLookupError>> => {
  const variant = new URLSearchParams(window.location.search).get('presentation')
  const enabled = variant === '1' || variant === 'sky' || variant === 'stars'
  const interactionFeedback = variant === '1'
  const faceTileIndices = Result.all({
    top: tileIndexForBlockName(PRESENTATION_BLOCK_NAME, 'top'),
    side: tileIndexForBlockName(PRESENTATION_BLOCK_NAME, 'side'),
    bottom: tileIndexForBlockName(PRESENTATION_BLOCK_NAME, 'bottom'),
  })
  if (Result.isFailure(faceTileIndices)) {
    return Result.fail(faceTileIndices.failure)
  }
  const skyView = variant === 'sky' || variant === 'stars'
  const startTicks = variant === 'stars'
    ? PRESENTATION_NIGHT_START
    : variant === 'sky'
      ? PRESENTATION_DAWN_START
      : PRESENTATION_DAY_START
  const startPose = !enabled
    ? START_POSE
    : skyView
      ? {
          ...START_POSE,
          y: SKY_PREVIEW_CAMERA_HEIGHT,
          pitch: variant === 'stars' ? STARS_PREVIEW_CAMERA_PITCH : 0,
          yaw: variant === 'sky' ? -Math.PI / 2 : START_POSE.yaw,
        }
      : { ...START_POSE, pitch: PRESENTATION_CAMERA_PITCH, z: PRESENTATION_CAMERA_Z }
  const sky = enabled
    ? createSkyRenderer<
        THREE.Texture,
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial,
        THREE.LineBasicMaterial,
        THREE.PointsMaterial
      >(THREE)
    : undefined
  const interaction = interactionFeedback
    ? (() => {
        const armTexture = createPresentationArmTexture()
        return {
          armTexture,
          renderer: createInteractionRenderer<
            THREE.Texture,
            THREE.BufferGeometry,
            THREE.MeshBasicMaterial,
            THREE.LineBasicMaterial,
            THREE.PointsMaterial
          >(THREE, { arm: armTexture, heldItem: atlasTexture }),
        }
      })()
    : undefined
  const interactionRenderer = interaction?.renderer

  if (sky !== undefined) {
    await Effect.runPromise(renderer.attachSceneObject(sky.sceneObject))
  }
  if (interactionRenderer !== undefined) {
    await Effect.runPromise(renderer.attachSceneObject(interactionRenderer.sceneObject))
    await Effect.runPromise(renderer.attachCameraObject(interactionRenderer.cameraObject))
  }
  if (enabled) {
    document.body.setAttribute('data-render-presentation', 'ready')
  }

  const interactionFrame = (elapsedSeconds: number) => ({
    ...(interactionFeedback ? { target: PRESENTATION_TARGET } : {}),
    ...(interactionFeedback ? { heldItem: { kind: 'block' as const, faceTileIndices: faceTileIndices.success } } : {}),
    miningProgress: interactionFeedback ? 0.6 : 0,
    action: interactionFeedback ? 'mine' : 'idle',
    actionProgress: interactionFeedback ? (elapsedSeconds * 0.75) % 1 : 0,
    movementIntensity: interactionFeedback ? 0.5 : 0,
    gaitPhaseRadians: interactionFeedback ? elapsedSeconds * 5 : 0,
    damageIntensity: interactionFeedback ? 0.25 : 0,
    damageDirection: { x: 1, y: 0.2 },
    reducedMotion: false,
  })

  const update = (
    pose: typeof START_POSE,
    elapsedSeconds: number,
  ): Result.Result<number, unknown> => {
    let rollRadians = 0
    if (sky !== undefined) {
      const skyResult = sky.update({
        cameraPosition: { x: pose.x, y: pose.y, z: pose.z },
        cameraPitchRadians: pose.pitch,
        cameraYawRadians: pose.yaw,
        dimension: 'overworld',
        moonPhase: PRESENTATION_MOON_PHASE,
        timeOfDayTicks: interactionFeedback
          ? Math.floor((startTicks + elapsedSeconds * PRESENTATION_TICKS_PER_SECOND) % 24_000)
          : startTicks,
        simulationTick: Math.floor(elapsedSeconds * ANIMATION_TICKS_PER_SECOND),
        partialTick: (elapsedSeconds * ANIMATION_TICKS_PER_SECOND) % 1,
      })
      if (Result.isFailure(skyResult)) {
        return Result.fail(skyResult.failure)
      }
    }
    if (interactionRenderer !== undefined) {
      const interactionResult = interactionRenderer.update(interactionFrame(elapsedSeconds))
      if (Result.isFailure(interactionResult)) {
        return Result.fail(interactionResult.failure)
      }
      rollRadians = interactionResult.success.damage.cameraRollRadians
    }
    return Result.succeed(rollRadians)
  }

  const dispose = (): void => {
    if (sky !== undefined) {
      Effect.runSync(renderer.detachSceneObject(sky.sceneObject))
      sky.dispose()
    }
    if (interaction !== undefined) {
      Effect.runSync(renderer.detachSceneObject(interaction.renderer.sceneObject))
      Effect.runSync(renderer.detachCameraObject(interaction.renderer.cameraObject))
      interaction.renderer.dispose()
      interaction.armTexture.dispose()
    }
  }

  return Result.succeed({ dispose, enabled, startPose, update })
}

type PreviewRequest = Readonly<{
  readonly canvas: HTMLCanvasElement
  readonly contactCanvas: HTMLCanvasElement | undefined
  readonly entityGallery: boolean
  readonly entityPreview: boolean
  readonly entityRendering: boolean
  readonly report: HTMLElement
  readonly viewport: Readonly<{ readonly width: number; readonly height: number }>
}>

type PreviewSetup = Readonly<{
  readonly atlasTexture: THREE.Texture
  readonly renderer: WorldRenderer
  readonly request: PreviewRequest
}>

const resolvePreviewRequest = (): PreviewRequest | undefined => {
  const search = new URLSearchParams(window.location.search)
  const entityPreview = search.get('entities') === '1'
  const entityGallery = search.get('entity-gallery') === '1'
  const entityRendering = entityPreview || entityGallery
  const canvas = document.getElementById('preview-canvas')
  const report = document.getElementById('preview-report')
  const contactCanvas = document.getElementById('entity-contact-sheet')
  if (!(canvas instanceof HTMLCanvasElement) || report === null ||
    (entityGallery && !(contactCanvas instanceof HTMLCanvasElement))) {
    document.body.setAttribute('data-render-preview', 'failed')
    return undefined
  }
  const viewport = entityGallery ? ENTITY_GALLERY_VIEWPORT : VIEWPORT
  canvas.width = viewport.width
  canvas.height = viewport.height
  if (entityGallery) {
    document.body.setAttribute('data-entity-gallery', 'running')
  }
  return {
    canvas,
    contactCanvas: contactCanvas instanceof HTMLCanvasElement ? contactCanvas : undefined,
    entityGallery,
    entityPreview,
    entityRendering,
    report,
    viewport,
  }
}


const drawStatePreview = async (
  renderer: WorldRenderer,
  canvas: HTMLCanvasElement,
  report: HTMLElement,
  mode: StatePreviewMode,
): Promise<void> => {
  const includeBlockStates = mode === 'rn6'
  const chunk = createStatePreviewChunk(includeBlockStates)
  const coordinate = chunkCoord(ChunkAxis(0), ChunkAxis(0))
  const store = {
    peek: () => Effect.succeed(chunk),
    neighbours: () => Effect.succeed({}),
  } satisfies MeshingChunkStore
  const resolvedTiles = new Set<number>()
  const tile = (quad: GeometryQuad): number => {
    const index = fixtureTile(quad)
    resolvedTiles.add(index)
    return index
  }
  const dirtySource = {
    drain: Effect.succeed({ changed: [coordinate], removed: [] }),
  }
  const mesher = makeChunkStoreMesher(store)
  await Effect.runPromise(syncWorld(renderer, dirtySource, mesher, { tile }))
  await Effect.runPromise(renderer.draw(cameraFrom(STATE_PREVIEW_POSE)))

  const stateLegend = document.getElementById('state-preview-legend')
  if (stateLegend !== null) {
    stateLegend.hidden = false
  }
  document.body.setAttribute('data-state-mode', mode)
  document.body.setAttribute('data-state-sidecar', includeBlockStates ? 'encoded' : 'omitted')

  const gl = canvas.getContext('webgl2')
  if (gl === null) {
    document.body.setAttribute('data-state-preview', 'failed')
    document.body.setAttribute('data-render-preview', 'failed')
    report.textContent = 'no webgl2 context'
    return
  }
  const pixels = new Uint8Array(VIEWPORT.width * VIEWPORT.height * PIXEL_CHANNELS)
  gl.readPixels(0, 0, VIEWPORT.width, VIEWPORT.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  const [skyR, skyG, skyB] = skyBytes()
  let drawn = 0
  for (let at = 0; at < pixels.length; at += PIXEL_CHANNELS) {
    const red = pixels[at] ?? 0
    const green = pixels[at + 1] ?? 0
    const blue = pixels[at + 2] ?? 0
    const isSky = Math.abs(red - skyR) <= SKY_PIXEL_TOLERANCE &&
      Math.abs(green - skyG) <= SKY_PIXEL_TOLERANCE &&
      Math.abs(blue - skyB) <= SKY_PIXEL_TOLERANCE
    if (!isSky) {
      drawn += 1
    }
  }

  const result = drawn > 0 ? 'drawn' : 'empty'
  report.textContent = [
    `states ${mode}; block-state sidecar ${includeBlockStates ? 'encoded per cell' : 'omitted'}`,
    `pixels drawn: ${String(drawn)} of ${String(VIEWPORT.width * VIEWPORT.height)}`,
    `distinct resolved atlas tiles: ${String(resolvedTiles.size)}`,
  ].join('\n')
  document.body.setAttribute('data-render-preview', result)
  document.body.setAttribute('data-state-preview', result)
  document.body.setAttribute('data-pixels-drawn', String(drawn))
  document.body.setAttribute('data-resolved-tile-count', String(resolvedTiles.size))
}


const loadBlockTextureAtlas = async (): Promise<THREE.Texture> => {
  const atlasUrl = new URL('../../src/assets/block-textures/atlas.png', import.meta.url).href
  const atlasTexture = await new THREE.TextureLoader().loadAsync(atlasUrl)
  atlasTexture.colorSpace = THREE.SRGBColorSpace
  atlasTexture.flipY = true
  atlasTexture.magFilter = THREE.NearestFilter
  atlasTexture.minFilter = THREE.NearestMipmapLinearFilter
  atlasTexture.generateMipmaps = true
  atlasTexture.wrapS = THREE.ClampToEdgeWrapping
  atlasTexture.wrapT = THREE.ClampToEdgeWrapping
  atlasTexture.needsUpdate = true
  return atlasTexture
}

const makePreviewRenderer = async (
  request: PreviewRequest,
  atlasTexture: THREE.Texture,
): Promise<WorldRenderer> => {
  const entityAtlasTexture = request.entityRendering ? await loadEntityTexture() : undefined
  let projectionOptions = {}
  if (request.entityGallery) {
    projectionOptions = { farPlane: ENTITY_GALLERY_CAMERA_FAR_PLANE, fovDegrees: ENTITY_GALLERY_FIELD_OF_VIEW }
  } else if (request.entityPreview) {
    projectionOptions = { fovDegrees: ENTITY_PREVIEW_FOV_DEGREES }
  }
  const entityOptions = entityAtlasTexture === undefined ? {} : {
    entityMaterial: () => new THREE.MeshBasicMaterial({ map: entityAtlasTexture, vertexColors: true }),
  }
  return Effect.runPromise(
    makeWorldRenderer<
      HTMLCanvasElement,
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial,
      THREE.ShaderMaterial
    >(THREE, request.canvas, request.viewport, {
      ...projectionOptions,
      ...entityOptions,
      material: () =>
        makeChunkShaderMaterial<
          HTMLCanvasElement,
          THREE.BufferGeometry,
          THREE.MeshBasicMaterial,
          THREE.ShaderMaterial
        >(THREE, atlasTexture).material,
    }),
  )
}

const initializePreview = async (): Promise<PreviewSetup | undefined> => {
  const request = resolvePreviewRequest()
  if (request === undefined) {
    return undefined
  }
  const atlasTexture = await loadBlockTextureAtlas()
  const renderer = await makePreviewRenderer(request, atlasTexture)
  if (request.entityGallery) {
    const { contactCanvas } = request
    if (contactCanvas === undefined) {
      document.body.setAttribute('data-entity-gallery', 'failed')
      return undefined
    }
    const complete = await drawEntityContactSheet(renderer, request.canvas, contactCanvas, request.report)
    await Effect.runPromise(renderer.dispose)
    if (!complete) {
      document.body.setAttribute('data-render-preview', 'failed')
    }
    return undefined
  }
  return { atlasTexture, renderer, request }
}

const main = async (): Promise<void> => {
  const previewSetup = await initializePreview()
  if (previewSetup === undefined) {
    return
  }
  const { atlasTexture, renderer, request } = previewSetup
  const { canvas, entityPreview, report } = request

  const stateMode = new URLSearchParams(window.location.search).get('states')
  if (stateMode === 'main' || stateMode === 'rn6') {
    await drawStatePreview(renderer, canvas, report, stateMode)
    return
  }

  const presentationSetupResult = await createPreviewPresentation(renderer, atlasTexture)
  if (Result.isFailure(presentationSetupResult)) {
    document.body.setAttribute('data-render-presentation', 'failed')
    report.textContent = JSON.stringify(presentationSetupResult.failure)
    return
  }
  const presentation = presentationSetupResult.success
  const previewPose = entityPreview
    ? {
        ...presentation.startPose,
        pitch: ENTITY_PREVIEW_CAMERA_PITCH,
        y: ENTITY_PREVIEW_CAMERA_HEIGHT,
        z: ENTITY_PREVIEW_CAMERA_Z,
      }
    : presentation.startPose

  // REAL GENERATED TERRAIN, loaded as data. See this file's header on why it
  // arrives as JSON rather than as a call into mc-worldgen.
  const fixtureUrl = new URL('./terrain-fixture.json', import.meta.url)
  const fixture = (await (await fetch(fixtureUrl)).json()) as TerrainFixture

  const quadsByKey = new Map<string, ReadonlyArray<FixtureQuad>>(
    fixture.chunks.map((chunk) => [
      chunkKeyOf(chunkCoord(ChunkAxis(chunk.cx), ChunkAxis(chunk.cz))),
      chunk.quads,
    ]),
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

  const resolvedTileIndices = new Set<number>()
  const resolveFixtureTile = (quad: GeometryQuad): number => {
    const tileIndex = fixtureTile(quad)
    resolvedTileIndices.add(tileIndex)
    return tileIndex
  }

  /** Chunks currently in the scene, so a batch can be a DIFFERENCE. */
  const loaded = new Set<ChunkKey>()

  /** Chunks within `STREAM_RADIUS_CHUNKS` of a world position. */
  const desiredAround = (x: number, z: number): ReadonlyArray<ChunkRef> => {
    const cx0 = Math.round(x / 16)
    const cz0 = Math.round(z / 16)
    const wanted: Array<ChunkRef> = []
    for (let cx = cx0 - STREAM_RADIUS_CHUNKS; cx <= cx0 + STREAM_RADIUS_CHUNKS; cx += 1) {
      for (let cz = cz0 - STREAM_RADIUS_CHUNKS; cz <= cz0 + STREAM_RADIUS_CHUNKS; cz += 1) {
        wanted.push(chunkCoord(ChunkAxis(cx), ChunkAxis(cz)))
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
        .map((key) => Result.getOrThrow(chunkCoordOfKey(key)))
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
    syncWorld(renderer, streamingSource(previewPose), fixtureMesher, { tile: resolveFixtureTile }),
  )
  const initialPresentation = presentation.update(previewPose, 0)
  if (Result.isFailure(initialPresentation)) {
    document.body.setAttribute('data-render-presentation', 'failed')
    throw new Error('render presentation preview received an invalid fixture frame')
  }
  if (entityPreview && !(await drawEntityPreview(renderer, report))) {
    return
  }
  await Effect.runPromise(renderer.draw(cameraFrom(previewPose, initialPresentation.success)))
  if (presentation.enabled) {
    document.body.setAttribute('data-render-presentation', 'drawn')
  }

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
  for (let at = 0; at < pixels.length; at += 4) {
    const r = pixels[at] ?? 0
    const g = pixels[at + 1] ?? 0
    const b = pixels[at + 2] ?? 0
    // A tolerance, because the sky is written as a float and read back as a
    // byte; exact equality would count rounding as geometry.
    const isSky = Math.abs(r - skyR) <= 2 && Math.abs(g - skyG) <= 2 && Math.abs(b - skyB) <= 2
    if (!isSky) {
      drawn += 1
    }
  }

  report.textContent = [
    `seed ${String(fixture.seed)} — ${String(fixture.chunks.length)} chunks generated, ` +
      `${String(fixture.totalQuads)} quads`,
    `streaming radius ${String(STREAM_RADIUS_CHUNKS)}; loaded now: ${String(loaded.size)}`,
    `pixels drawn: ${String(drawn)} of ${String(VIEWPORT.width * VIEWPORT.height)}`,
    `distinct resolved atlas tiles: ${String(resolvedTileIndices.size)}`,
    ...(entityPreview ? [
      `entity models: ${ENTITY_PREVIEW_MODELS.map(({ kind }) => kind).join(', ')}`,
      `entity meshes: ${String(ENTITY_PREVIEW_MODELS.length)}`,
    ] : []),
  ].join('\n')

  document.body.setAttribute('data-render-preview', drawn > 0 ? 'drawn' : 'empty')
  document.body.setAttribute('data-pixels-drawn', String(drawn))
  document.body.setAttribute('data-resolved-tile-count', String(resolvedTileIndices.size))

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
    runSync: Effect.runSync,
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

  const pose = { ...previewPose }
  let previous = 0
  let frames = 0
  let streamed = 0
  let dropped = 0
  let presentationStartMillis: number | undefined = undefined

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
      syncWorld(renderer, streamingSource(pose), fixtureMesher, { tile: resolveFixtureTile }),
    )
    streamed += syncReport.meshed
    dropped += syncReport.removed

    presentationStartMillis ??= nowMillis
    const presentationTimeSeconds = (nowMillis - presentationStartMillis) / 1000
    const presentationResult = presentation.update(pose, presentationTimeSeconds)
    if (Result.isFailure(presentationResult)) {
      document.body.setAttribute('data-render-presentation', 'failed')
      return
    }

    Effect.runSync(renderer.draw(cameraFrom(pose, presentationResult.success)))

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

  window.addEventListener('pagehide', presentation.dispose, { once: true })
}

main().catch((error: unknown) => {
  console.error('render preview failed:', error)
})
