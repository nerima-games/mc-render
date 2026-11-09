/**
 * Compile mc-render's three generated shaders on a real GL driver.
 *
 * Lowered from mc-compose's `apps/shader-probe`. The only
 * change from the compose original is the import below: it now reads
 * `../../src/index.js`, this package's own source, rather than
 * `@nerima-games/mc-render` — the app lives beside the code it draws now,
 * instead of consuming it through the published package graph.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * `domain/chunk-shader.ts`, `domain/water-shader.ts` and
 * `domain/particle-shader.ts` each generate GLSL from constants, and each is
 * covered by a Node suite that asserts things about the STRING — that the
 * coefficients are interpolated, that no bare integer sits in an arithmetic
 * position, that the declared uniforms match the domain's list. Every one of
 * those headers then says the same thing: none of it compiles GLSL, because
 * there is no GL context in Node, and mc-compose's Playwright run is where the
 * source is actually compiled.
 *
 * That sentence named a check that did not exist. This page is the check.
 *
 * ---------------------------------------------------------------------------
 * WHY IT GOES THROUGH `ShaderMaterial` AND NOT `gl.compileShader`
 * ---------------------------------------------------------------------------
 *
 * Handing the raw source to `gl.compileShader` would FAIL, and would fail for a
 * reason that says nothing about mc-render: three.js prepends a preamble
 * declaring `position`, `normal`, `uv`, `color`, `projectionMatrix`,
 * `modelViewMatrix`, `modelMatrix`, `viewMatrix` and `normalMatrix`, and the
 * generated sources use those without declaring them — correctly, because
 * they are written to be three's.
 *
 * So the probe builds the real materials through mc-render's own factories and
 * asks three to compile them. That also means a passing run proves slightly
 * more than "the GLSL is valid": it proves the ATTRIBUTE and UNIFORM names the
 * geometry binds are the ones the linked program actually wants.
 *
 * ---------------------------------------------------------------------------
 * HOW A FAILURE IS DETECTED
 * ---------------------------------------------------------------------------
 *
 * three does not throw on a shader error. With
 * `renderer.debug.checkShaderErrors` (default true) it logs the driver's error
 * text through `console.error` and carries on with a broken program — which is
 * exactly why a shader defect reaches a browser as a blank canvas rather than
 * as an exception, and why this had to be checked somewhere.
 *
 * `console.error` is therefore intercepted for the duration of the compile and
 * anything it receives is a failure. The report is written to the DOM so that
 * Playwright reads a value rather than scraping a log, and so that a human
 * opening the page sees the same thing the test does.
 */
import * as THREE from 'three'
import { Effect, Result, Schema } from 'effect'
import { BLOCK_IDS, BlockId, ChunkKey, blockTypeOfId } from '@nerima-games/mc-kernel'
import { makeParticleSystem } from '../../src/application/particle-system.js'
import {
  CAMERA_FOV_DEGREES,
  makeChunkShaderMaterial,
  makeWaterMaterial,
  makeWorldRenderer,
  type WorldRenderer,
} from '../../src/application/world-renderer.js'
import {
  buildChunkGeometry,
  type ChunkGeometryBuffers,
  type MeshQuad,
} from '../../src/domain/chunk-geometry.js'
import type { MirroredCameraState } from '../../src/domain/camera-mirror.js'
import { animationTimeSeconds } from '../../src/domain/animation-clock.js'
import { ANIMATED_TEXTURE_FRAMES, tileIndexForBlockName } from '../../src/domain/block-texture-map.js'
import { CHUNK_ANIMATION_KIND } from '../../src/domain/chunk-animation-kind.js'
import { CHUNK_SHADER_ATTRIBUTES, CHUNK_SHADER_UNIFORMS } from '../../src/domain/chunk-shader.js'
import {
  makeParticlePool,
  ParticleBurstCountSchema,
  ParticleUvCoordinateSchema,
  ParticleWorldCoordinateSchema,
  spawnBurst,
} from '../../src/domain/particle-pool.js'
import {
  ATLAS_COLUMNS,
  TILE_CELL_PIXELS,
  TILE_GUTTER_PIXELS,
  TILE_PIXELS,
} from '../../src/domain/texture-atlas.js'

const VIEWPORT = { width: 320, height: 180 }
const ANIMATION_PROBE_SIZE = 8
const ANIMATION_PROBE_HALF_SIZE = ANIMATION_PROBE_SIZE / 2
const ANIMATION_PROBE_CAMERA_EXTENT = 1.1
const ANIMATION_PROBE_CAMERA_DISTANCE = 8
const ANIMATION_PROBE_QUAD_EXTENT = 2
const ANIMATION_PROBE_PARTIAL_TICK = 0.99
const ANIMATION_PROBE_UV_BELOW_ONE = 0.999999
const ANIMATION_PROBE_TIME_OF_DAY_TICKS = 0
const ANIMATION_PROBE_QUERY = 'chunk-animation-pixels'
const ITEM_ICON_PROBE_QUERY = 'item-icon-pixels'
const ITEM_ICON_PROBE_WIDTH = 320
const ITEM_ICON_PROBE_HEIGHT = 240
const ITEM_ICON_PROBE_DISTANCE = 2.5
const ITEM_ICON_PROBE_CENTER_X = ITEM_ICON_PROBE_WIDTH / 2
const ITEM_ICON_PROBE_CENTER_Y = ITEM_ICON_PROBE_HEIGHT / 2
const ITEM_ICON_PROBE_HALF_REGION = 12
const ITEM_ICON_PROBE_HALF_VIEW_ANGLE_TANGENT = Math.tan((CAMERA_FOV_DEGREES * Math.PI / 180) / 2)
const ITEM_ICON_PROBE_CAMERA: MirroredCameraState = {
  position: { x: 0, y: 0.2, z: ITEM_ICON_PROBE_DISTANCE },
  rotation: { x: 0, y: 0, z: 0, order: 'YXZ' },
  sourceCapturedAtSecs: 0,
} as unknown as MirroredCameraState
const ITEM_ICON_ATLAS_URL = new URL('../../src/assets/item-icons/atlas.png', import.meta.url).href
const ITEM_ICON_PIXEL_THRESHOLD = 12
const ITEM_ICON_TEST_ENTITIES = [
  { id: 'bookshelf', itemId: 'bookshelf', x: -0.28 },
  { id: 'diamond', itemId: 'diamond', x: 0.28 },
] as const
const ANIMATION_PROBE_UNOCCLUDED_COLOR = [255, 255, 255] as const
const ANIMATION_PROBE_MIN_VISIBLE_ALPHA = 0
const ANIMATION_PROBE_ALPHA_TEST_UNIFORM = 'uAlphaTest'
const ANIMATION_PROBE_COLOR_CHANNELS = 3
const ANIMATION_PROBE_UV_CHANNELS = 2
const ANIMATION_PROBE_RGBA_CHANNELS = 4
const ANIMATION_PROBE_READBACK_X = ANIMATION_PROBE_HALF_SIZE
const ANIMATION_PROBE_READBACK_Y = ANIMATION_PROBE_HALF_SIZE
const ANIMATION_TEXTURE_URL = new URL('../../src/assets/block-textures/atlas.png', import.meta.url).href

type AnimationPixel = readonly [number, number, number, number]
type AnimationPixelSample = Readonly<{
  readonly expectedTileIndex: number
  readonly expected: ReadonlyArray<AnimationPixel>
  readonly actual: ReadonlyArray<AnimationPixel>
}>
type AnimationPixelProbeResult = Readonly<{
  readonly blockType: string
  readonly boundaryTick: number
  readonly beforeTick: number
  readonly beforePartialTick: number
  readonly afterTick: number
  readonly afterPartialTick: number
  readonly repeatedTick: number
  readonly repeatedPartialTick: number
  readonly before: AnimationPixelSample
  readonly after: AnimationPixelSample
  readonly repeated: AnimationPixelSample
}>

type AnimationProbeCase = Readonly<{
  readonly blockType: string
  readonly firstChangeTick: number
  readonly frames: readonly number[]
}>

const ANIMATION_PROBE_CASES: readonly AnimationProbeCase[] = [
  { blockType: 'water', firstChangeTick: 20, frames: ANIMATED_TEXTURE_FRAMES.water.water },
  { blockType: 'lava', firstChangeTick: 20, frames: ANIMATED_TEXTURE_FRAMES.lava.lava },
  { blockType: 'fire', firstChangeTick: 10, frames: ANIMATED_TEXTURE_FRAMES.fire.fire },
  { blockType: 'nether_portal', firstChangeTick: 20, frames: ANIMATED_TEXTURE_FRAMES.portal.nether_portal },
  { blockType: 'end_portal', firstChangeTick: 20, frames: ANIMATED_TEXTURE_FRAMES.portal.end_portal },
  { blockType: 'end_gateway', firstChangeTick: 20, frames: ANIMATED_TEXTURE_FRAMES.portal.end_gateway },
]

/** One visible face, so the chunk geometry is not empty. */
const QUAD: MeshQuad = {
  blockId: BlockId(1),
  direction: 'yPos',
  role: 'top',
  lx: 0,
  y: 0,
  lz: 0,
  width: 2,
  height: 2,
  ao: 0,
}

/**
 * A pose to draw from. CAST, once, and the cast is the honest option here.
 *
 * `MirroredCameraState.position` is kernel's branded `Position` and
 * `sourceCapturedAtSecs` is its branded `MonotonicTimeSecs`. mc-render
 * deliberately does NOT re-export kernel's vocabulary — `index.ts` says so and
 * says why: consumers take it from the published `@nerima-games/mc-kernel`
 * package. Local sibling resolution remains an optional Vite overlay, not the
 * package boundary.
 *
 * The alternative to the cast would be reconstructing the chunk material and
 * its attribute binding by hand in this file, which would test a
 * reconstruction rather than `makeWorldRenderer`. A brand carries no runtime
 * representation and the renderer only reads six numbers off this, so the cast
 * is inert — and the thing being probed is the shader, not the pose.
 */
const PROBE_CAMERA = {
  position: { x: 0, y: 8, z: 8 },
  rotation: { x: 0, y: 0, z: 0, order: 'YXZ' },
  sourceCapturedAtSecs: 0,
} as unknown as MirroredCameraState

type ProbeResult = {
  readonly name: string
  readonly compiled: boolean
  readonly errors: ReadonlyArray<string>
}

/**
 * Run `compile` with `console.error` intercepted.
 *
 * Restored in a `finally`, because a probe that swallowed console.error
 * permanently would make every later failure on the page invisible — including
 * the ones this file is not looking for.
 */
const captureErrors = async (compile: () => Promise<void> | void): Promise<ReadonlyArray<string>> => {
  const captured: Array<string> = []
  const original = console.error
  console.error = (...args: ReadonlyArray<unknown>): void => {
    captured.push(args.map((arg) => String(arg)).join(' '))
    original(...args)
  }
  try {
    await compile()
  } finally {
    console.error = original
  }
  return captured
}

const probeChunkShader = async (canvas: HTMLCanvasElement): Promise<ProbeResult> => {
  const errors = await captureErrors(async () => {
    // THE REAL PATH, not a reconstruction of it: `makeWorldRenderer` with a
    // material factory is exactly what a textured host does, and `setChunk`
    // is what binds the `tileIndex` attribute the vertex stage declares.
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
          >(THREE, new THREE.Texture()).material,
      }),
    )
    await Effect.runPromise(renderer.setChunk(Result.getOrThrow(ChunkKey('0,0')), buildChunkGeometry([QUAD], 0, 0)))
    // Drawing is what forces the program to link. `compile()` would do for a
    // scene this file owned, but the scene here is the renderer's.
    await Effect.runPromise(renderer.draw(PROBE_CAMERA))
    await Effect.runPromise(renderer.dispose)
  })
  return { name: 'chunk', compiled: errors.length === 0, errors }
}

type TextureSamplePoint = Readonly<{
  readonly u: number
  readonly v: number
  readonly frameColors: ReadonlyArray<AnimationPixel>
}>

const blockIdForType = (blockType: string): BlockId => {
  const blockId = BLOCK_IDS.find((candidate) => Result.getOrThrow(blockTypeOfId(candidate)) === blockType)
  if (blockId === undefined) {
    throw new Error(`The kernel registry does not contain block type ${blockType}`)
  }
  return blockId
}

const atlasPixel = (image: ImageData, tileIndex: number, x: number, y: number): AnimationPixel => {
  const atlasX = (tileIndex % ATLAS_COLUMNS) * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS + x
  const atlasY = Math.floor(tileIndex / ATLAS_COLUMNS) * TILE_CELL_PIXELS + TILE_GUTTER_PIXELS + y
  const offset = (atlasY * image.width + atlasX) * ANIMATION_PROBE_RGBA_CHANNELS
  return [
    image.data[offset] ?? 0,
    image.data[offset + 1] ?? 0,
    image.data[offset + 2] ?? 0,
    image.data[offset + 3] ?? 0,
  ]
}

const colorsDiffer = (left: AnimationPixel, right: AnimationPixel): boolean =>
  left[0] !== right[0] || left[1] !== right[1] || left[2] !== right[2] || left[3] !== right[3]

const atlasTilesDiffer = (image: ImageData, firstTileIndex: number, secondTileIndex: number): boolean => {
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) {
      if (colorsDiffer(atlasPixel(image, firstTileIndex, x, y), atlasPixel(image, secondTileIndex, x, y))) {
        return true
      }
    }
  }
  return false
}

const findAnimationSamplePoints = (image: ImageData, frames: readonly number[]): ReadonlyArray<TextureSamplePoint> => {
  const [firstTile, secondTile] = frames
  if (firstTile === undefined || secondTile === undefined) {
    throw new Error('animated atlas frame sequence must contain at least two tiles')
  }
  const candidates: Array<TextureSamplePoint> = []
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) {
      const frameColors = frames.map((tileIndex) => atlasPixel(image, tileIndex, x, y))
      candidates.push({
        frameColors,
        u: Math.min(x / (TILE_PIXELS - 1), ANIMATION_PROBE_UV_BELOW_ONE),
        v: Math.min(1 - y / (TILE_PIXELS - 1), ANIMATION_PROBE_UV_BELOW_ONE),
      })
    }
  }

  const framePairs: Array<readonly [number, number]> = []
  for (let firstIndex = 0; firstIndex < frames.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < frames.length; secondIndex += 1) {
      framePairs.push([firstIndex, secondIndex])
    }
  }
  const boundaryCandidate = candidates.find((candidate) => {
    const [firstColor, secondColor] = candidate.frameColors
    return firstColor !== undefined &&
      secondColor !== undefined &&
      firstColor[3] > ANIMATION_PROBE_MIN_VISIBLE_ALPHA &&
      secondColor[3] > ANIMATION_PROBE_MIN_VISIBLE_ALPHA &&
      colorsDiffer(firstColor, secondColor)
  }) ?? candidates.find((candidate) => {
    const [firstColor, secondColor] = candidate.frameColors
    return firstColor !== undefined && secondColor !== undefined && colorsDiffer(firstColor, secondColor)
  })
  if (boundaryCandidate === undefined) {
    throw new Error(`animation frames ${String(firstTile)} and ${String(secondTile)} have no opaque color difference`)
  }

  const selected = [boundaryCandidate]
  let unresolvedPairs = framePairs.filter(([firstIndex, secondIndex]) => {
    const firstColor = boundaryCandidate.frameColors[firstIndex]
    const secondColor = boundaryCandidate.frameColors[secondIndex]
    return firstColor === undefined || secondColor === undefined || !colorsDiffer(firstColor, secondColor)
  })
  while (unresolvedPairs.length > 0) {
    let bestCandidate: TextureSamplePoint | undefined = undefined
    let bestPairCount = 0
    for (const candidate of candidates) {
      if (!selected.includes(candidate)) {
        const pairCount = unresolvedPairs.filter(([firstIndex, secondIndex]) => {
          const firstColor = candidate.frameColors[firstIndex]
          const secondColor = candidate.frameColors[secondIndex]
          return firstColor !== undefined && secondColor !== undefined && colorsDiffer(firstColor, secondColor)
        }).length
        if (pairCount > bestPairCount) {
          bestCandidate = candidate
          bestPairCount = pairCount
        }
      }
    }
    if (bestCandidate === undefined) {
      break
    }
    selected.push(bestCandidate)
    unresolvedPairs = unresolvedPairs.filter(([firstIndex, secondIndex]) => {
      const firstColor = bestCandidate.frameColors[firstIndex]
      const secondColor = bestCandidate.frameColors[secondIndex]
      return firstColor === undefined || secondColor === undefined || !colorsDiffer(firstColor, secondColor)
    })
  }
  const unresolvedDistinctPair = unresolvedPairs.find(([firstIndex, secondIndex]) => {
    const firstFrameTile = frames[firstIndex]
    const secondFrameTile = frames[secondIndex]
    return firstFrameTile !== undefined &&
      secondFrameTile !== undefined &&
      atlasTilesDiffer(image, firstFrameTile, secondFrameTile)
  })
  if (unresolvedDistinctPair !== undefined) {
    throw new Error('animation probe cannot distinguish all visually different frames')
  }
  return selected
}

const findStaticSamplePoint = (image: ImageData, tileIndex: number): TextureSamplePoint => {
  for (let y = 0; y < TILE_PIXELS; y += 1) {
    for (let x = 0; x < TILE_PIXELS; x += 1) {
      const color = atlasPixel(image, tileIndex, x, y)
      if (color[3] > ANIMATION_PROBE_MIN_VISIBLE_ALPHA && (color[0] > 0 || color[1] > 0 || color[2] > 0)) {
        return {
          frameColors: [color],
          u: Math.min(x / (TILE_PIXELS - 1), ANIMATION_PROBE_UV_BELOW_ONE),
          v: Math.min(1 - y / (TILE_PIXELS - 1), ANIMATION_PROBE_UV_BELOW_ONE),
        }
      }
    }
  }
  throw new Error(`static atlas tile ${String(tileIndex)} has no opaque pixels`)
}

const chunkProbeGeometry = (
  blockType: string,
  point: TextureSamplePoint,
  staticTileIndex?: number,
): THREE.BufferGeometry => {
  const blockId = blockIdForType(blockType)
  const quad: MeshQuad = {
    ao: 0,
    blockId,
    direction: 'yPos',
    height: ANIMATION_PROBE_QUAD_EXTENT,
    lx: 0,
    lz: 0,
    role: 'top',
    width: ANIMATION_PROBE_QUAD_EXTENT,
    y: 0,
  }
  const baseTile = staticTileIndex ?? Result.getOrThrow(tileIndexForBlockName(blockType, 'top'))
  const buffers: ChunkGeometryBuffers = buildChunkGeometry(
    [quad],
    0,
    0,
    () => ANIMATION_PROBE_UNOCCLUDED_COLOR,
    () => baseTile,
  )
  if (staticTileIndex !== undefined) {
    buffers.animationKinds.fill(CHUNK_ANIMATION_KIND.none)
    buffers.tileIndices.fill(staticTileIndex)
  }
  const uvs = new Float32Array(buffers.uvs.length)
  for (let offset = 0; offset < uvs.length; offset += ANIMATION_PROBE_UV_CHANNELS) {
    uvs[offset] = point.u
    uvs[offset + 1] = point.v
  }

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3))
  geometry.setAttribute('normal', new THREE.BufferAttribute(buffers.normals, 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, ANIMATION_PROBE_UV_CHANNELS))
  geometry.setAttribute('color', new THREE.BufferAttribute(buffers.colors, ANIMATION_PROBE_COLOR_CHANNELS, true))
  geometry.setAttribute(CHUNK_SHADER_ATTRIBUTES.tileIndex, new THREE.BufferAttribute(buffers.tileIndices, 1))
  geometry.setAttribute(CHUNK_SHADER_ATTRIBUTES.animationKind, new THREE.BufferAttribute(buffers.animationKinds, 1))
  geometry.setIndex(Array.from(buffers.indices))
  return geometry
}

const makeAnimationSample = (
  renderer: THREE.WebGLRenderer,
  gl: ReturnType<THREE.WebGLRenderer['getContext']>,
  scene: THREE.Scene,
  camera: THREE.Camera,
  uniforms: Readonly<Record<string, { value: unknown }>>,
  renderBlock: (blockType: string, point: TextureSamplePoint, staticTileIndex?: number) => void,
  blockType: string,
  points: ReadonlyArray<TextureSamplePoint>,
  simulationTick: number,
  partialTick: number,
  expectedTileIndex: number,
): AnimationPixelSample => {
  const time = Result.getOrThrow(animationTimeSeconds({
    partialTick,
    simulationTick,
    timeOfDayTicks: ANIMATION_PROBE_TIME_OF_DAY_TICKS,
  }))
  const timeUniform = uniforms[CHUNK_SHADER_UNIFORMS.time]
  if (timeUniform === undefined) {
    throw new Error('chunk material has no tick-derived time uniform')
  }
  timeUniform.value = time
  const readPoint = (point: TextureSamplePoint, staticTileIndex?: number): AnimationPixel => {
    renderBlock(blockType, point, staticTileIndex)
    renderer.render(scene, camera)
    const rgba = new Uint8Array(ANIMATION_PROBE_RGBA_CHANNELS)
    gl.readPixels(
      ANIMATION_PROBE_READBACK_X,
      ANIMATION_PROBE_READBACK_Y,
      1,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rgba,
    )
    return [rgba[0] ?? 0, rgba[1] ?? 0, rgba[2] ?? 0, rgba[3] ?? 0] as const
  }
  const actual = points.map((point) => readPoint(point))
  // Read the expected tile through WebGL too; Canvas 2D can round translucent PNG RGB bytes.
  const expected = points.map((point) => readPoint(point, expectedTileIndex))
  return {
    actual,
    expected,
    expectedTileIndex,
  }
}

const probeChunkAnimationPixels = async (): Promise<ReadonlyArray<AnimationPixelProbeResult>> => {
  const atlasTexture = await new THREE.TextureLoader().loadAsync(ANIMATION_TEXTURE_URL)
  atlasTexture.flipY = true
  atlasTexture.colorSpace = THREE.NoColorSpace
  atlasTexture.generateMipmaps = false
  atlasTexture.magFilter = THREE.NearestFilter
  atlasTexture.minFilter = THREE.NearestFilter
  atlasTexture.needsUpdate = true

  const imageCanvas = document.createElement('canvas')
  imageCanvas.width = atlasTexture.image.width
  imageCanvas.height = atlasTexture.image.height
  const imageContext = imageCanvas.getContext('2d')
  if (imageContext === null) {
    atlasTexture.dispose()
    throw new Error('atlas image has no 2D readback context')
  }
  imageContext.drawImage(atlasTexture.image, 0, 0)
  const atlasImage = imageContext.getImageData(0, 0, imageCanvas.width, imageCanvas.height)

  const canvas = document.createElement('canvas')
  canvas.width = ANIMATION_PROBE_SIZE
  canvas.height = ANIMATION_PROBE_SIZE
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, canvas })
  renderer.setSize(ANIMATION_PROBE_SIZE, ANIMATION_PROBE_SIZE, false)
  renderer.setClearColor(0x000000, 1)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(
    -ANIMATION_PROBE_CAMERA_EXTENT,
    ANIMATION_PROBE_CAMERA_EXTENT,
    ANIMATION_PROBE_CAMERA_EXTENT,
    -ANIMATION_PROBE_CAMERA_EXTENT,
    0.1,
    ANIMATION_PROBE_CAMERA_DISTANCE * 2,
  )
  camera.up.set(0, 0, -1)
  camera.position.set(1, ANIMATION_PROBE_CAMERA_DISTANCE, 1)
  camera.lookAt(1, 0, 1)
  const { material, uniforms } = makeChunkShaderMaterial<
    HTMLCanvasElement,
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial,
    THREE.ShaderMaterial
  >(THREE, atlasTexture)
  const alphaTestUniform = uniforms[ANIMATION_PROBE_ALPHA_TEST_UNIFORM]
  if (alphaTestUniform === undefined) {
    renderer.dispose()
    material.dispose()
    atlasTexture.dispose()
    throw new Error('chunk material has no alpha-test uniform')
  }
  // Read transparent frame pixels too; otherwise fire's disjoint shapes have no comparable sample.
  alphaTestUniform.value = ANIMATION_PROBE_MIN_VISIBLE_ALPHA
  const gl = renderer.getContext()
  const results: Array<AnimationPixelProbeResult> = []
  const geometries: Array<THREE.BufferGeometry> = []

  try {
    const errors = await captureErrors(async () => {
      const renderBlock = (blockType: string, point: TextureSamplePoint, staticTileIndex?: number): void => {
        scene.clear()
        const geometry = chunkProbeGeometry(blockType, point, staticTileIndex)
        geometries.push(geometry)
        scene.add(new THREE.Mesh(geometry, material))
      }
      const sample = (
        blockType: string,
        points: ReadonlyArray<TextureSamplePoint>,
        simulationTick: number,
        partialTick: number,
        expectedTileIndex: number,
      ): AnimationPixelSample =>
        makeAnimationSample(
          renderer,
          gl,
          scene,
          camera,
          uniforms,
          renderBlock,
          blockType,
          points,
          simulationTick,
          partialTick,
          expectedTileIndex,
        )

      for (const probe of ANIMATION_PROBE_CASES) {
        const points = findAnimationSamplePoints(atlasImage, probe.frames)
        const [beforeTile, afterTile] = probe.frames
        if (beforeTile === undefined || afterTile === undefined) {
          throw new Error(`${probe.blockType} animation has no boundary frame pair`)
        }
        const beforeTick = probe.firstChangeTick - 1
        const afterTick = probe.firstChangeTick
        results.push({
          after: sample(probe.blockType, points, afterTick, 0, afterTile),
          before: sample(probe.blockType, points, beforeTick, ANIMATION_PROBE_PARTIAL_TICK, beforeTile),
          boundaryTick: probe.firstChangeTick,
          blockType: probe.blockType,
          beforeTick,
          beforePartialTick: ANIMATION_PROBE_PARTIAL_TICK,
          afterTick,
          afterPartialTick: 0,
          repeatedTick: afterTick,
          repeatedPartialTick: 0,
          repeated: sample(probe.blockType, points, afterTick, 0, afterTile),
        })
      }

      const iceTile = Result.getOrThrow(tileIndexForBlockName('ice', 'top'))
      const icePoint = findStaticSamplePoint(atlasImage, iceTile)
      const icePoints = [icePoint]
      results.push({
        after: sample('ice', icePoints, 20, 0, iceTile),
        before: sample('ice', icePoints, 0, 0, iceTile),
        boundaryTick: 20,
        blockType: 'ice',
        beforeTick: 0,
        beforePartialTick: 0,
        afterTick: 20,
        afterPartialTick: 0,
        repeatedTick: 20,
        repeatedPartialTick: 0,
        repeated: sample('ice', icePoints, 20, 0, iceTile),
      })
    })

    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
    return results
  } finally {
    for (const geometry of geometries) {
      geometry.dispose()
    }
    renderer.dispose()
    material.dispose()
    atlasTexture.dispose()
  }
}

const reportChunkAnimationPixelProbe = async (): Promise<void> => {
  const report = document.createElement('pre')
  report.id = 'chunk-animation-probe-report'
  document.body.append(report)
  document.body.setAttribute('data-chunk-animation-probe', 'running')
  try {
    const result = await probeChunkAnimationPixels()
    report.textContent = JSON.stringify(result, null, 2)
    document.body.setAttribute('data-chunk-animation-probe-result', JSON.stringify(result))
    document.body.setAttribute('data-chunk-animation-probe', 'passed')
  } catch (error) {
    report.textContent = String(error)
    document.body.setAttribute('data-chunk-animation-probe', 'failed')
  }
}

type ItemIconPixelProbeResult = Readonly<{
  readonly animatedPixelChanges: number
  readonly distinctIconPixels: number
  readonly bookshelfVisiblePixels: number
  readonly diamondVisiblePixels: number
  readonly animationSeconds: readonly [number, number]
}>

const iconProbeRegion = (pixels: Uint8Array, centerX: number): Uint8Array => {
  const samples: Array<number> = []
  const left = Math.floor(centerX) - ITEM_ICON_PROBE_HALF_REGION
  const right = Math.floor(centerX) + ITEM_ICON_PROBE_HALF_REGION
  const top = ITEM_ICON_PROBE_CENTER_Y - ITEM_ICON_PROBE_HALF_REGION
  const bottom = ITEM_ICON_PROBE_CENTER_Y + ITEM_ICON_PROBE_HALF_REGION
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * ITEM_ICON_PROBE_WIDTH + x) * ANIMATION_PROBE_RGBA_CHANNELS
      samples.push(
        pixels[offset] ?? 0,
        pixels[offset + 1] ?? 0,
        pixels[offset + 2] ?? 0,
        pixels[offset + 3] ?? 0,
      )
    }
  }
  return Uint8Array.from(samples)
}

const visibleIconPixels = (pixels: Uint8Array): number => {
  let visible = 0
  for (let offset = 0; offset < pixels.length; offset += ANIMATION_PROBE_RGBA_CHANNELS) {
    if ((pixels[offset] ?? 0) + (pixels[offset + 1] ?? 0) + (pixels[offset + 2] ?? 0) > ITEM_ICON_PIXEL_THRESHOLD) {
      visible += 1
    }
  }
  return visible
}

const differentPixelCount = (left: Uint8Array, right: Uint8Array): number => {
  let different = 0
  for (let offset = 0; offset < left.length; offset += ANIMATION_PROBE_RGBA_CHANNELS) {
    const changed = [0, 1, 2].some((channel) =>
      Math.abs((left[offset + channel] ?? 0) - (right[offset + channel] ?? 0)) > ITEM_ICON_PIXEL_THRESHOLD,
    )
    if (changed) {
      different += 1
    }
  }
  return different
}

const readItemIconProbePixels = (canvas: HTMLCanvasElement): Uint8Array => {
  const gl = canvas.getContext('webgl2')
  if (gl === null) {
    throw new Error('item icon probe WebGL2 context is unavailable')
  }
  const pixels = new Uint8Array(ITEM_ICON_PROBE_WIDTH * ITEM_ICON_PROBE_HEIGHT * ANIMATION_PROBE_RGBA_CHANNELS)
  gl.readPixels(0, 0, ITEM_ICON_PROBE_WIDTH, ITEM_ICON_PROBE_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  if (gl.getError() !== gl.NO_ERROR) {
    throw new Error('item icon probe pixel readback failed')
  }
  return pixels
}

const probeItemIconPixels = async (): Promise<ItemIconPixelProbeResult> => {
  const atlasTexture = await new THREE.TextureLoader().loadAsync(ITEM_ICON_ATLAS_URL)
  atlasTexture.flipY = true
  atlasTexture.colorSpace = THREE.SRGBColorSpace
  atlasTexture.magFilter = THREE.NearestFilter
  atlasTexture.minFilter = THREE.NearestMipmapLinearFilter
  atlasTexture.generateMipmaps = true
  atlasTexture.needsUpdate = true

  const canvas = document.createElement('canvas')
  canvas.width = ITEM_ICON_PROBE_WIDTH
  canvas.height = ITEM_ICON_PROBE_HEIGHT
  canvas.style.width = `${String(ITEM_ICON_PROBE_WIDTH)}px`
  canvas.style.height = `${String(ITEM_ICON_PROBE_HEIGHT)}px`
  canvas.setAttribute('data-item-icon-canvas', 'true')
  document.body.append(canvas)

  let renderer: WorldRenderer | undefined = undefined
  try {
    const activeRenderer = await Effect.runPromise(makeWorldRenderer<
      HTMLCanvasElement,
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial
    >(THREE, canvas, { width: ITEM_ICON_PROBE_WIDTH, height: ITEM_ICON_PROBE_HEIGHT }, {
      clearColor: 0x000000,
      itemIconAtlasTexture: atlasTexture,
    }))
    renderer = activeRenderer
    let result: ItemIconPixelProbeResult | undefined = undefined
    const errors = await captureErrors(async () => {
      const cameraScale = ITEM_ICON_PROBE_WIDTH /
        (2 * ITEM_ICON_PROBE_DISTANCE * ITEM_ICON_PROBE_HALF_VIEW_ANGLE_TANGENT *
          (ITEM_ICON_PROBE_WIDTH / ITEM_ICON_PROBE_HEIGHT))
      await Effect.runPromise(activeRenderer.syncEntities(ITEM_ICON_TEST_ENTITIES.map((item) => ({
        category: 'item' as const,
        feetPosition: { x: item.x, y: 0, z: 0 },
        id: item.id,
        itemId: item.itemId,
        kind: 'dropped_item',
      }))))
      const atZero = Result.getOrThrow(animationTimeSeconds({
        partialTick: 0,
        simulationTick: 0,
        timeOfDayTicks: 0,
      }))
      await Effect.runPromise(activeRenderer.setEntityAnimationTimeSeconds(atZero))
      await Effect.runPromise(activeRenderer.draw(ITEM_ICON_PROBE_CAMERA))
      const initialPixels = readItemIconProbePixels(canvas)
      const screenOffset = ITEM_ICON_TEST_ENTITIES[1].x * cameraScale
      const bookshelfRegion = iconProbeRegion(initialPixels, ITEM_ICON_PROBE_CENTER_X - screenOffset)
      const diamondRegion = iconProbeRegion(initialPixels, ITEM_ICON_PROBE_CENTER_X + screenOffset)
      const animatedTime = Result.getOrThrow(animationTimeSeconds({
        partialTick: 0,
        simulationTick: 5,
        timeOfDayTicks: 0,
      }))
      await Effect.runPromise(activeRenderer.setEntityAnimationTimeSeconds(animatedTime))
      await Effect.runPromise(activeRenderer.draw(ITEM_ICON_PROBE_CAMERA))
      const animatedPixels = readItemIconProbePixels(canvas)
      const animatedBookshelfRegion = iconProbeRegion(animatedPixels, ITEM_ICON_PROBE_CENTER_X - screenOffset)
      const animatedDiamondRegion = iconProbeRegion(animatedPixels, ITEM_ICON_PROBE_CENTER_X + screenOffset)
      const probeResult = {
        animatedPixelChanges: differentPixelCount(bookshelfRegion, animatedBookshelfRegion) +
          differentPixelCount(diamondRegion, animatedDiamondRegion),
        animationSeconds: [atZero, animatedTime] as const,
        bookshelfVisiblePixels: visibleIconPixels(bookshelfRegion),
        diamondVisiblePixels: visibleIconPixels(diamondRegion),
        distinctIconPixels: differentPixelCount(bookshelfRegion, diamondRegion),
      }
      if (probeResult.bookshelfVisiblePixels === 0 || probeResult.diamondVisiblePixels === 0 ||
        probeResult.distinctIconPixels === 0 || probeResult.animatedPixelChanges === 0) {
        throw new Error(`item icon pixels did not prove distinct and animated cards: ${JSON.stringify(probeResult)}`)
      }
      result = probeResult
    })
    if (errors.length > 0) {
      throw new Error(errors.join('\n'))
    }
    if (result === undefined) {
      throw new Error('item icon pixel probe completed without a result')
    }
    return result
  } finally {
    if (renderer !== undefined) {
      await Effect.runPromise(renderer.dispose)
    }
    atlasTexture.dispose()
  }
}

const reportItemIconPixelProbe = async (): Promise<void> => {
  const report = document.createElement('pre')
  report.id = 'item-icon-probe-report'
  document.body.append(report)
  document.body.setAttribute('data-item-icon-probe', 'running')
  try {
    const result = await probeItemIconPixels()
    report.textContent = JSON.stringify(result, null, 2)
    document.body.setAttribute('data-item-icon-probe-result', JSON.stringify(result))
    document.body.setAttribute('data-item-icon-probe', 'passed')
  } catch (error) {
    report.textContent = String(error)
    document.body.setAttribute('data-item-icon-probe', 'failed')
  }
}

const probeWaterShader = async (canvas: HTMLCanvasElement): Promise<ProbeResult> => {
  const errors = await captureErrors(() => {
    const renderer = new THREE.WebGLRenderer({ canvas })
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300)

    const { material } = makeWaterMaterial<
      HTMLCanvasElement,
      THREE.BufferGeometry,
      THREE.MeshBasicMaterial,
      THREE.ShaderMaterial
    >(THREE, VIEWPORT)

    // A plane with the attributes the water vertex stage reads. `color` is
    // present because the material is built with `vertexColors: true`, which
    // makes three declare the attribute whether or not this shader samples it.
    const geometry = new THREE.PlaneGeometry(4, 4)
    geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(geometry.attributes['position']!.count * 3), 3),
    )
    const mesh = new THREE.Mesh(geometry, material)
    scene.add(mesh)

    renderer.render(scene, camera)

    geometry.dispose()
    material.dispose()
    renderer.dispose()
  })
  return { name: 'water', compiled: errors.length === 0, errors }
}

const probeParticleShader = async (canvas: HTMLCanvasElement): Promise<ProbeResult> => {
  const poolResult = makeParticlePool({ capacity: 16 })
  if (Result.isFailure(poolResult)) {
    return {
      name: 'particle',
      compiled: false,
      errors: [`particle pool input failed: ${poolResult.failure.reason}`],
    }
  }

  const pool = poolResult.success
  const decodePosition = Schema.decodeUnknownSync(ParticleWorldCoordinateSchema)
  const decodeUv = Schema.decodeUnknownSync(ParticleUvCoordinateSchema)
  const decodeCount = Schema.decodeUnknownSync(ParticleBurstCountSchema)
  const spawnResult = spawnBurst(
    pool,
    decodePosition(0),
    decodePosition(0),
    decodePosition(-4),
    decodeUv(0),
    decodeUv(0),
    decodeCount(4),
  )
  if (Result.isFailure(spawnResult)) {
    return {
      name: 'particle',
      compiled: false,
      errors: [`particle spawn input failed: ${spawnResult.failure.reason}`],
    }
  }
  if (spawnResult.success !== 4) {
    return {
      name: 'particle',
      compiled: false,
      errors: [`particle probe expected 4 spawned instances, received ${String(spawnResult.success)}`],
    }
  }

  const errors = await captureErrors(async () => {
    const renderer = new THREE.WebGLRenderer({ canvas })
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 300)

    // A live particle, so `instanceCount` is non-zero and the instanced
    // attributes are actually consumed by a draw.
    const system = await Effect.runPromise(
      makeParticleSystem<
        HTMLCanvasElement,
        THREE.BufferGeometry,
        THREE.MeshBasicMaterial,
        THREE.InstancedBufferGeometry,
        THREE.ShaderMaterial
      >(THREE, pool, new THREE.Texture()),
    )
    await Effect.runPromise(system.sync)

    scene.add(system.mesh as unknown as THREE.Object3D)
    renderer.render(scene, camera)

    await Effect.runPromise(system.dispose)
    renderer.dispose()
  })
  return { name: 'particle', compiled: errors.length === 0, errors }
}

const main = async (): Promise<void> => {
  const canvas = document.getElementById('probe-canvas')
  const report = document.getElementById('probe-report')
  if (!(canvas instanceof HTMLCanvasElement) || report === null) {
    document.body.setAttribute('data-shader-probe', 'failed')
    return
  }
  canvas.width = VIEWPORT.width
  canvas.height = VIEWPORT.height

  const results: Array<ProbeResult> = []
  try {
    // Each probe gets its OWN canvas. A WebGL context is bound to a canvas for
    // its lifetime, and three refuses to build a second renderer on one that
    // already has a context — which would make probes 2 and 3 report a
    // context-creation failure and look like shader failures.
    results.push(await probeChunkShader(canvas))
    results.push(await probeWaterShader(document.createElement('canvas')))
    results.push(await probeParticleShader(document.createElement('canvas')))
  } catch (thrown) {
    results.push({ name: 'probe', compiled: false, errors: [String(thrown)] })
  }

  const failed = results.filter((result) => !result.compiled)

  report.textContent = results
    .map((result) =>
      result.compiled
        ? `OK    ${result.name}`
        : `FAIL  ${result.name}\n${result.errors.join('\n')}`,
    )
    .join('\n')
  report.className = failed.length === 0 ? 'ok' : 'fail'

  document.body.setAttribute('data-shader-probe', failed.length === 0 ? 'passed' : 'failed')
  document.body.setAttribute('data-shader-probe-compiled', String(results.length - failed.length))
  document.body.setAttribute('data-shader-probe-total', String(results.length))
  if (new URLSearchParams(location.search).has(ANIMATION_PROBE_QUERY)) {
    await reportChunkAnimationPixelProbe()
  }
  if (new URLSearchParams(location.search).has(ITEM_ICON_PROBE_QUERY)) {
    await reportItemIconPixelProbe()
  }
}

main().catch((error: unknown) => {
  console.error('shader probe failed:', error)
})
