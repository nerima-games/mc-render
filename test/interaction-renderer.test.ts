import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Effect, Result, Schema } from 'effect'
import {
  HeldItemDescriptorSchema,
  InteractionFrameInputSchema,
  InteractionFrameResultSchema,
  type InteractionFrameInputEncoded,
  type InteractionRendererError,
  createInteractionRenderer,
  type TemporaryNonBlockCategory,
} from '../src/application/interaction-renderer'
import { InteractionVisualInputErrorSchema } from '../src/domain/interaction-visuals'
import type {
  PresentationBasicMaterial,
  PresentationBasicMaterialOptions,
  PresentationBufferAttribute,
  PresentationBufferGeometry,
  PresentationObject3D,
  RenderPresentationSurface,
} from '../src/application/render-presentation-surface'
import {
  FIRST_PERSON_ARM_TEXTURE_HEIGHT,
  FIRST_PERSON_ARM_TEXTURE_WIDTH,
  makeFirstPersonArmTextureData,
  type RenderPresentationTexture,
} from '../src/application/render-presentation-assets'
import { ATLAS_TILE_COUNT } from '../src/domain/texture-atlas'

type FakeTexture = RenderPresentationTexture & Readonly<{ name: string }>

class FakeAttribute implements PresentationBufferAttribute {
  readonly count: number
  readonly array: Float32Array
  readonly itemSize: number

  constructor(array: Float32Array, itemSize: number) {
    this.array = array
    this.itemSize = itemSize
    this.count = array.length / itemSize
  }
}

class FakeGeometry implements PresentationBufferGeometry {
  readonly attributes = new Map<string, FakeAttribute>()
  disposed = false
  index: PresentationBufferAttribute | null = null
  drawRange: Readonly<{ start: number; count: number }> = { count: 0, start: 0 }
  boundingSphereComputations = 0

  setAttribute(name: string, attribute: PresentationBufferAttribute): void {
    if (attribute instanceof FakeAttribute) {
      this.attributes.set(name, attribute)
    }
  }

  setIndex(index: PresentationBufferAttribute | null): void {
    this.index = index
  }

  setDrawRange(start: number, count: number): void {
    this.drawRange = { count, start }
  }

  computeBoundingSphere(): void {
    this.boundingSphereComputations += 1
  }

  dispose(): void {
    this.disposed = true
  }
}

class FakeMaterial implements PresentationBasicMaterial<FakeTexture> {
  map: FakeTexture | null
  opacity: number
  transparent: boolean
  depthWrite: boolean
  depthTest: boolean
  disposed = false
  readonly color: { value: number; set: (value: number) => unknown }
  readonly side: 0 | 2 | undefined

  constructor(options: PresentationBasicMaterialOptions<FakeTexture>) {
    this.map = options.map ?? null
    this.opacity = options.opacity ?? 1
    this.transparent = options.transparent ?? false
    this.depthWrite = options.depthWrite ?? true
    this.depthTest = options.depthTest ?? true
    this.color = {
      value: options.color ?? 0,
      set: (value: number): number => {
        this.color.value = value
        return value
      },
    }
    this.side = options.side
  }

  dispose(): void {
    this.disposed = true
  }
}

class FakeObject implements PresentationObject3D {
  readonly position = {
    x: 0,
    y: 0,
    z: 0,
    set: (x: number, y: number, z: number): void => {
      this.position.x = x
      this.position.y = y
      this.position.z = z
    },
  }
  readonly rotation = {
    x: 0,
    y: 0,
    z: 0,
      set: (x: number, y: number, z: number, _order: 'YXZ' | 'XYZ'): void => {
      this.rotation.x = x
      this.rotation.y = y
      this.rotation.z = z
    },
  }
  readonly children: PresentationObject3D[] = []
  visible = true
  renderOrder = 0

  add(...objects: ReadonlyArray<PresentationObject3D>): void {
    this.children.push(...objects)
  }

  remove(...objects: ReadonlyArray<PresentationObject3D>): void {
    for (const object of objects) {
      const index = this.children.indexOf(object)
      if (index >= 0) {
        this.children.splice(index, 1)
      }
    }
  }
}

class FakeMesh extends FakeObject {
  readonly geometry: FakeGeometry
  readonly material: FakeMaterial

  constructor(geometry: FakeGeometry, material: FakeMaterial) {
    super()
    this.geometry = geometry
    this.material = material
  }
}

class FakeSurface implements RenderPresentationSurface<FakeTexture, FakeGeometry, FakeMaterial, FakeMaterial, FakeMaterial> {
  readonly Group = FakeObject
  readonly BufferGeometry = FakeGeometry
  readonly BufferAttribute = FakeAttribute
  readonly MeshBasicMaterial = FakeMaterial
  readonly LineBasicMaterial = FakeMaterial
  readonly PointsMaterial = FakeMaterial
  readonly Mesh = FakeMesh
  readonly LineSegments = FakeMesh
  readonly Points = FakeMesh
}

const FULL_CUBE = {
  boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } }],
} as const

const HALF_BLOCK = {
  boxes: [{ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 0.5, z: 1 } }],
} as const

const FRAME: InteractionFrameInputEncoded = {
  action: 'attack',
  actionProgress: 0.5,
  damageDirection: { x: 1, y: 0 },
  damageIntensity: 1,
  gaitPhaseRadians: 1,
  miningProgress: 0.5,
  movementIntensity: 0.6,
  reducedMotion: false,
  target: { shape: HALF_BLOCK, position: { x: 3, y: 12, z: -2 } },
}

const TEMPORARY_ITEM_TINTS: Readonly<Record<TemporaryNonBlockCategory, number>> = {
  food: 0xd96b43,
  potion: 0x9a70d6,
  tool: 0xdd9a43,
  utility: 0x64c3bd,
  weapon: 0xd7dce8,
}

const TEMPORARY_ITEM_CATEGORIES: ReadonlyArray<TemporaryNonBlockCategory> = [
  'tool',
  'weapon',
  'food',
  'potion',
  'utility',
]

const GRASS_BLOCK_FACE_TILE_INDICES = { bottom: 12, side: 11, top: 10 } as const
const GRASS_BLOCK_SIDE_FACE_UVS = [
  0.3544921875, 0.9794921875,
  0.3642578125, 0.9794921875,
  0.3642578125, 0.9892578125,
  0.3544921875, 0.9794921875,
  0.3642578125, 0.9892578125,
  0.3544921875, 0.9892578125,
] as const
const GRASS_BLOCK_BOTTOM_FACE_UVS = [
  0.3857421875, 0.9794921875,
  0.3955078125, 0.9794921875,
  0.3955078125, 0.9892578125,
  0.3857421875, 0.9794921875,
  0.3955078125, 0.9892578125,
  0.3857421875, 0.9892578125,
] as const
const GRASS_BLOCK_TOP_FACE_UVS = [
  0.3232421875, 0.9794921875,
  0.3330078125, 0.9794921875,
  0.3330078125, 0.9892578125,
  0.3232421875, 0.9794921875,
  0.3330078125, 0.9892578125,
  0.3232421875, 0.9892578125,
] as const

const fakeObject = (object: PresentationObject3D | undefined): FakeObject => {
  if (object instanceof FakeObject) {
    return object
  }
  throw new Error('expected a fake scene object')
}

const fakeMesh = (object: PresentationObject3D | undefined): FakeMesh => {
  if (object instanceof FakeMesh) {
    return object
  }
  throw new Error('expected a fake mesh')
}

const fakeMeshes = (object: PresentationObject3D): ReadonlyArray<FakeMesh> =>
  fakeObject(object).children.map(fakeMesh)

const cameraChildren = (renderer: ReturnType<typeof createInteractionRenderer>): ReadonlyArray<FakeObject> =>
  fakeObject(renderer.cameraObject).children.map(fakeObject)

const expectValidResult = (value: Result.Result<unknown, InteractionRendererError>): void => {
  if (Result.isSuccess(value)) {
    const decoded = Schema.decodeUnknownResult(InteractionFrameResultSchema, { onExcessProperty: 'error' })(value.success)
    expect(Result.isSuccess(decoded)).toBe(true)
    return
  }
  if (value.failure._tag === 'AtlasCoordinateError') {
    expect(value.failure.operation).toBeDefined()
    expect(value.failure.reason).toBeDefined()
    return
  }
  const decoded = Schema.decodeUnknownResult(InteractionVisualInputErrorSchema, { onExcessProperty: 'error' })(value.failure)
  expect(Result.isSuccess(decoded)).toBe(true)
}

const unitBoundsArbitrary = FastCheck.integer({ max: 9, min: 0 }).chain((min) =>
  FastCheck.integer({ max: 10 - min, min: 1 }).map((size) => ({ max: (min + size) / 10, min: min / 10 })),
)

const expectedCuboidSelectionVertices = (
  bounds: Readonly<{ x: Readonly<{ min: number; max: number }>; y: Readonly<{ min: number; max: number }>; z: Readonly<{ min: number; max: number }> }>,
  position: Readonly<{ x: number; y: number; z: number }>,
): ReadonlyArray<string> => {
  const corners = Array.from({ length: 8 }, (_unused, index) => ({
    x: position.x + bounds.x.min + (index & 1) * (bounds.x.max - bounds.x.min),
    y: position.y + bounds.y.min + ((index >> 1) & 1) * (bounds.y.max - bounds.y.min),
    z: position.z + bounds.z.min + ((index >> 2) & 1) * (bounds.z.max - bounds.z.min),
  }))
  const vertices: Array<string> = []
  for (const [firstIndex, start] of corners.entries()) {
    for (const end of corners.slice(firstIndex + 1)) {
      const changedAxes = Number(start.x !== end.x) + Number(start.y !== end.y) + Number(start.z !== end.z)
      if (changedAxes === 1) {
        for (const point of [start, end]) {
          vertices.push([
            point.x + (Math.sign(point.x - position.x - 0.5) || 1) * 0.002,
            point.y + (Math.sign(point.y - position.y - 0.5) || 1) * 0.002,
            point.z + (Math.sign(point.z - position.z - 0.5) || 1) * 0.002,
          ].map((coordinate) => coordinate.toFixed(3)).join(','))
        }
      }
    }
  }
  return vertices.sort()
}

describe('interaction renderer', () => {
  it.effect('renders shape-aligned selection and cracks, animates the hand, and disposes its meshes', () =>
    Effect.sync(() => {
      const renderer = createInteractionRenderer(new FakeSurface())
      const scene = fakeObject(renderer.sceneObject)
      const camera = fakeObject(renderer.cameraObject)
      const result = renderer.update(FRAME)

      expect(Result.isSuccess(result)).toBe(true)
      expect(scene.children).toHaveLength(2)
      expect(camera.children).toHaveLength(3)
      const hand = fakeObject(camera.children[0])
      const selection = fakeMesh(scene.children[0])
      const cracks = fakeMesh(scene.children[1])
      expect(hand.position.x).toBeCloseTo(0.42 + Math.cos(1) * 0.018)
      expect(fakeMesh(hand.children[0]).geometry.attributes.get('position')?.count).toBe(36)
      expect(selection.geometry.attributes.get('position')?.count).toBe(24)
      expect(cracks.geometry.attributes.get('position')?.count).toBeGreaterThan(0)
      expect(camera.rotation.z).toBe(0)
      expect(camera.children[1]?.visible).toBe(true)
      expect(camera.children[2]?.visible).toBe(true)
      expectValidResult(result)
      if (Result.isSuccess(result)) {
        expect(result.success.crackStage.stage).toBe(5)
        expect(result.success.damage.cameraRollRadians).toBeLessThan(0)
      }

      renderer.dispose()
      renderer.dispose()

      expect(scene.children).toHaveLength(0)
      expect(camera.children).toHaveLength(0)
    }),
  )

  it.effect('uses grass block top, side and bottom atlas tiles on the matching held-item faces', () =>
    Effect.sync(() => {
      const crackTexture = { isTexture: true, name: 'cracks' } satisfies FakeTexture
      const armTexture = { isTexture: true, name: 'generated-arm' } satisfies FakeTexture
      const atlasTexture = { isTexture: true, name: 'rn5-atlas' } satisfies FakeTexture
      const renderer = createInteractionRenderer(new FakeSurface(), {
        arm: armTexture,
        cracks: crackTexture,
        heldItem: atlasTexture,
      })
      const result = renderer.update({
        ...FRAME,
        heldItem: { kind: 'block', faceTileIndices: GRASS_BLOCK_FACE_TILE_INDICES },
        target: { shape: FULL_CUBE, position: { x: 0, y: 0, z: 0 } },
      })
      const worldChildren = fakeMeshes(renderer.sceneObject)
      const [hand] = cameraChildren(renderer)
      const arm = fakeMesh(hand?.children[0])
      const heldItem = fakeMesh(hand?.children[1])

      expect(Result.isSuccess(result)).toBe(true)
      expect(worldChildren).toHaveLength(8)
      expect(worldChildren.slice(1, 7).every((mesh) => mesh.material.map === crackTexture)).toBe(true)
      expect(worldChildren[7]?.geometry.attributes.get('position')?.count).toBe(60)
      expect(arm.material.map).toBe(armTexture)
      expect(arm.geometry.attributes.get('uv')?.count).toBe(36)
      expect(heldItem.material.map).toBe(atlasTexture)
      const itemUvs = heldItem.geometry.attributes.get('uv')
      expect(itemUvs?.count).toBe(36)
      const faceUvs = Array.from({ length: 6 }, (_unused, faceIndex) =>
        Array.from(itemUvs?.array.slice(faceIndex * 12, (faceIndex + 1) * 12) ?? []),
      )
      expect(faceUvs).toStrictEqual([
        GRASS_BLOCK_SIDE_FACE_UVS,
        GRASS_BLOCK_SIDE_FACE_UVS,
        GRASS_BLOCK_BOTTOM_FACE_UVS,
        GRASS_BLOCK_TOP_FACE_UVS,
        GRASS_BLOCK_SIDE_FACE_UVS,
        GRASS_BLOCK_SIDE_FACE_UVS,
      ])
      expect(worldChildren[1]?.material.opacity).toBeGreaterThan(0)
      renderer.update({
        ...FRAME,
        heldItem: { kind: 'block', faceTileIndices: GRASS_BLOCK_FACE_TILE_INDICES },
        miningProgress: 0.7,
      })
      const updatedChildren = fakeMeshes(renderer.sceneObject)
      expect(updatedChildren[7]?.geometry.attributes.get('position')?.count).toBe(84)
      renderer.dispose()
    }),
  )

  it.effect('uses the fallback color without an atlas and hides a cleared held item', () =>
    Effect.sync(() => {
      const renderer = createInteractionRenderer(new FakeSurface())
      const [hand] = cameraChildren(renderer)
      const heldItem = fakeMesh(hand?.children[1])
      const shown = renderer.update({
        ...FRAME,
        heldItem: { kind: 'block', faceTileIndices: GRASS_BLOCK_FACE_TILE_INDICES },
      })

      expect(Result.isSuccess(shown)).toBe(true)
      expect(heldItem.material.map).toBeNull()
      expect(heldItem.material.color.value).toBe(0xb69b6a)
      expect(heldItem.visible).toBe(true)

      const cleared = renderer.update({ ...FRAME, heldItem: undefined })

      expect(Result.isSuccess(cleared)).toBe(true)
      expect(heldItem.material.map).toBeNull()
      expect(heldItem.visible).toBe(false)
      renderer.dispose()
    }),
  )

  it.effect('renders temporary non-block item categories with distinct silhouettes and tints', () =>
    Effect.sync(() => {
      const renderer = createInteractionRenderer(new FakeSurface())
      const [hand] = cameraChildren(renderer)
      const heldItem = fakeMesh(hand?.children[1])
      const silhouettes: Array<string> = []

      for (const category of TEMPORARY_ITEM_CATEGORIES) {
        const result = renderer.update({
          ...FRAME,
          heldItem: { category, kind: 'temporary-non-block' },
        })
        const positions = heldItem.geometry.attributes.get('position')?.array
        expect(Result.isSuccess(result)).toBe(true)
        expect(heldItem.material.map).toBeNull()
        expect(heldItem.material.color.value).toBe(TEMPORARY_ITEM_TINTS[category])
        expect(positions).toBeDefined()
        if (positions !== undefined) {
          silhouettes.push(Array.from(positions).join(','))
        }
      }

      expect(new Set(silhouettes).size).toBe(TEMPORARY_ITEM_CATEGORIES.length)
      renderer.dispose()
    }),
  )

  it.effect('validates held-item atlas tile boundaries and the public descriptor schema', () =>
    Effect.sync(() => {
      const valid = Schema.decodeUnknownResult(HeldItemDescriptorSchema, { onExcessProperty: 'error' })({
        kind: 'block',
        faceTileIndices: {
          bottom: ATLAS_TILE_COUNT - 1,
          side: 0,
          top: ATLAS_TILE_COUNT - 1,
        },
      })
      expect(Result.isSuccess(valid)).toBe(true)

      const invalidTop = Schema.decodeUnknownResult(HeldItemDescriptorSchema, { onExcessProperty: 'error' })({
        kind: 'block',
        faceTileIndices: {
          bottom: 0,
          side: ATLAS_TILE_COUNT - 1,
          top: -1,
        },
      })
      expect(Result.isFailure(invalidTop)).toBe(true)

      const invalidSide = Schema.decodeUnknownResult(HeldItemDescriptorSchema, { onExcessProperty: 'error' })({
        kind: 'block',
        faceTileIndices: {
          bottom: 0,
          side: ATLAS_TILE_COUNT,
          top: ATLAS_TILE_COUNT - 1,
        },
      })
      expect(Result.isFailure(invalidSide)).toBe(true)

      const frameDecode = Schema.decodeUnknownResult(InteractionFrameInputSchema, { onExcessProperty: 'error' })({
        ...FRAME,
        heldItem: {
          kind: 'block',
          faceTileIndices: {
            bottom: 0,
            side: 1,
            top: ATLAS_TILE_COUNT,
          },
        },
      })
      expect(Result.isFailure(frameDecode)).toBe(true)
    }),
  )

  it.effect('property-checks every public held-item descriptor against its schema', () =>
    Effect.sync(() => {
      const tileIndex = FastCheck.integer({ max: ATLAS_TILE_COUNT - 1, min: 0 })
      const blockDescriptor = FastCheck.tuple(tileIndex, tileIndex, tileIndex)
        .map(([top, side, bottom]) => ({
          faceTileIndices: { bottom, side, top },
          kind: 'block' as const,
        }))
      const temporaryDescriptor = FastCheck.constantFrom(...TEMPORARY_ITEM_CATEGORIES)
        .map((category) => ({ category, kind: 'temporary-non-block' as const }))
      FastCheck.assert(
        FastCheck.property(FastCheck.oneof(blockDescriptor, temporaryDescriptor), (descriptor) => {
          const decoded = Schema.decodeUnknownResult(HeldItemDescriptorSchema, { onExcessProperty: 'error' })(descriptor)
          expect(Result.isSuccess(decoded)).toBe(true)
        }),
      )
    }),
  )

  it.effect('exposes deterministic row-major RGBA arm pixels for a DataTexture', () =>
    Effect.sync(() => {
      const first = makeFirstPersonArmTextureData()
      const second = makeFirstPersonArmTextureData()

      expect(FIRST_PERSON_ARM_TEXTURE_WIDTH).toBe(16)
      expect(FIRST_PERSON_ARM_TEXTURE_HEIGHT).toBe(32)
      expect(first).toHaveLength(FIRST_PERSON_ARM_TEXTURE_WIDTH * FIRST_PERSON_ARM_TEXTURE_HEIGHT * 4)
      expect(first).toStrictEqual(second)
      for (let alphaOffset = 3; alphaOffset < first.length; alphaOffset += 4) {
        expect(first[alphaOffset]).toBe(255)
      }
    }),
  )

  it.effect('rejects an invalid frame before changing the current scene objects', () =>
    Effect.sync(() => {
      const renderer = createInteractionRenderer(new FakeSurface())
      renderer.update(FRAME)
      const scene = fakeObject(renderer.sceneObject)
      const camera = fakeObject(renderer.cameraObject)
      const beforeScene = [...scene.children]
      const beforeRoll = camera.rotation.z
      const invalid = renderer.update({ ...FRAME, miningProgress: 1.1 })

      expect(Result.isFailure(invalid)).toBe(true)
      expect(scene.children).toStrictEqual(beforeScene)
      expect(camera.rotation.z).toBe(beforeRoll)

      const invalidTarget = renderer.update({
        ...FRAME,
        target: { shape: HALF_BLOCK, position: { x: 0.5, y: 12, z: -2 } },
      })

      expect(Result.isFailure(invalidTarget)).toBe(true)
      expect(scene.children).toStrictEqual(beforeScene)

      const invalidPose = renderer.update({ ...FRAME, actionProgress: 1.1 })

      expect(Result.isFailure(invalidPose)).toBe(true)
      expect(scene.children).toStrictEqual(beforeScene)

      const invalidDamage = renderer.update({ ...FRAME, damageDirection: { x: 0, y: 0 } })

      expect(Result.isFailure(invalidDamage)).toBe(true)
      expect(scene.children).toStrictEqual(beforeScene)

      const noDamageDirection = renderer.update({
        ...FRAME,
        damageDirection: { x: 0, y: 0 },
        damageIntensity: 0,
      })

      expect(Result.isSuccess(noDamageDirection)).toBe(true)
      expect(camera.children[2]?.visible).toBe(false)
      expectValidResult(noDamageDirection)
      renderer.dispose()
    }),
  )

  it.effect('clears world overlays when the frame has no target', () =>
    Effect.sync(() => {
      const renderer = createInteractionRenderer(new FakeSurface())
      renderer.update(FRAME)
      const cleared = renderer.update({ ...FRAME, target: undefined })

      expect(Result.isSuccess(cleared)).toBe(true)
      expect(fakeObject(renderer.sceneObject).children).toHaveLength(0)
      expectValidResult(cleared)
      renderer.dispose()
    }),
  )

  it.effect('returns a typed failure and keeps the scene empty after disposal', () =>
    Effect.sync(() => {
      const renderer = createInteractionRenderer(new FakeSurface())
      renderer.update(FRAME)
      renderer.dispose()

      const afterDispose = renderer.update(FRAME)
      const scene = fakeObject(renderer.sceneObject)
      const camera = fakeObject(renderer.cameraObject)

      expect(Result.isFailure(afterDispose)).toBe(true)
      if (Result.isFailure(afterDispose)) {
        expect(afterDispose.failure).toStrictEqual({
          _tag: 'InteractionVisualInputError',
          operation: 'interaction-frame',
          reason: 'disposed',
        })
      }
      expect(scene.children).toHaveLength(0)
      expect(camera.children).toHaveLength(0)
      expectValidResult(afterDispose)
    }),
  )

  it.effect('draws generated interaction frames using independently calculated visual values', () =>
    Effect.sync(() => {
      const bounds = FastCheck.record({ x: unitBoundsArbitrary, y: unitBoundsArbitrary, z: unitBoundsArbitrary })
      const target = FastCheck.record({
        bounds,
        position: FastCheck.record({
          x: FastCheck.integer({ max: 20, min: -20 }),
          y: FastCheck.integer({ max: 20, min: -20 }),
          z: FastCheck.integer({ max: 20, min: -20 }),
        }),
      }).map(({ bounds: box, position }) => ({
        position,
        shape: { boxes: [{
          min: { x: box.x.min, y: box.y.min, z: box.z.min },
          max: { x: box.x.max, y: box.y.max, z: box.z.max },
        }] },
      }))
      const direction = FastCheck.tuple(
        FastCheck.integer({ max: 20, min: -20 }),
        FastCheck.integer({ max: 20, min: -20 }),
      ).filter(([x, y]) => x !== 0 || y !== 0).map(([x, y]) => ({ x, y }))
      const unit = FastCheck.integer({ max: 100, min: 0 }).map((value) => value / 100)
      const generatedFrame = FastCheck.record({
        action: FastCheck.constantFrom('idle', 'attack', 'mine', 'place'),
        actionProgress: unit,
        damageDirection: direction,
        damageIntensity: unit,
        gaitPhaseRadians: FastCheck.integer({ max: 628, min: -628 }).map((value) => value / 100),
        miningProgress: unit,
        movementIntensity: unit,
        reducedMotion: FastCheck.boolean(),
        target,
      })
      const renderer = createInteractionRenderer(new FakeSurface())

      try {
        FastCheck.assert(FastCheck.property(generatedFrame, (input) => {
          const result = renderer.update(input)
          expect(Result.isSuccess(result)).toBe(true)
          if (Result.isFailure(result)) {
            return false
          }

          const stage = Math.ceil(input.miningProgress * 10) * Number(input.miningProgress > 0)
          const expectedCrackOpacity = Number(stage > 0) * (0.16 + (stage / 10) * 0.64)
          expect(result.success.crackStage).toStrictEqual({ stage, opacity: expectedCrackOpacity })

          const profile = {
            attack: { drop: 0.12, forward: 0.12, swing: 0.85, twist: 0.15 },
            idle: { drop: 0, forward: 0, swing: 0, twist: 0 },
            mine: { drop: 0.18, forward: 0.07, swing: 1.1, twist: 0 },
            place: { drop: 0.025, forward: 0.11, swing: 0.28, twist: -0.08 },
          }[input.action]
          const movement = input.movementIntensity * Number(!input.reducedMotion)
          const gaitX = Math.cos(input.gaitPhaseRadians) * movement
          const gaitY = Math.sin(input.gaitPhaseRadians * 2) * movement
          const actionSwing = Math.sin(input.actionProgress * Math.PI) * (1 - Number(input.reducedMotion) * 0.5)
          const expectedPose = {
            offset: {
              x: 0.42 + gaitX * 0.018,
              y: -0.38 + gaitY * 0.035 - actionSwing * profile.drop,
              z: -0.72 - actionSwing * profile.forward,
            },
            rotation: {
              x: actionSwing * profile.swing,
              y: gaitX * 0.025,
              z: gaitX * 0.025 + actionSwing * profile.twist,
            },
          }
          expect(result.success.handPose.offset.x).toBeCloseTo(expectedPose.offset.x, 10)
          expect(result.success.handPose.offset.y).toBeCloseTo(expectedPose.offset.y, 10)
          expect(result.success.handPose.offset.z).toBeCloseTo(expectedPose.offset.z, 10)
          expect(result.success.handPose.rotation.x).toBeCloseTo(expectedPose.rotation.x, 10)
          expect(result.success.handPose.rotation.y).toBeCloseTo(expectedPose.rotation.y, 10)
          expect(result.success.handPose.rotation.z).toBeCloseTo(expectedPose.rotation.z, 10)

          const magnitude = Math.hypot(input.damageDirection.x, input.damageDirection.y)
          const normalizedX = input.damageDirection.x / magnitude
          const angle = Math.atan2(input.damageDirection.y, input.damageDirection.x)
          const expectedRollMagnitude = normalizedX * 0.14 * input.damageIntensity * (1 - Number(input.reducedMotion) * 0.75)
          const expectedDamage = {
            cameraRollRadians: -expectedRollMagnitude,
            directionAngleRadians: angle,
            flashOpacity: 0.48 * input.damageIntensity,
          }
          expect(result.success.damage.cameraRollRadians).toBeCloseTo(expectedDamage.cameraRollRadians, 10)
          expect(result.success.damage.directionAngleRadians).toBeCloseTo(expectedDamage.directionAngleRadians, 10)
          expect(result.success.damage.flashOpacity).toBeCloseTo(expectedDamage.flashOpacity, 10)

          const worldMeshes = fakeMeshes(renderer.sceneObject)
          expect(worldMeshes).toHaveLength(1 + Number(stage > 0))
          const selectionAttribute = fakeMesh(worldMeshes[0]).geometry.attributes.get('position')
          expect(selectionAttribute?.count).toBe(24)
          if (selectionAttribute === undefined) {
            return false
          }
          const actualSelectionVertices = Array.from({ length: selectionAttribute.count }, (_unused, index) => {
            const offset = index * selectionAttribute.itemSize
            return [
              selectionAttribute.array[offset]?.toFixed(3),
              selectionAttribute.array[offset + 1]?.toFixed(3),
              selectionAttribute.array[offset + 2]?.toFixed(3),
            ].join(',')
          }).sort()
          const box = input.target.shape.boxes[0]!
          expect(actualSelectionVertices).toStrictEqual(expectedCuboidSelectionVertices({
            x: { min: box.min.x, max: box.max.x },
            y: { min: box.min.y, max: box.max.y },
            z: { min: box.min.z, max: box.max.z },
          }, input.target.position))
          if (stage > 0) {
            expect(fakeMesh(worldMeshes[1]).geometry.attributes.get('position')?.count).toBe(stage * 12)
          }

          const [hand, flashObject, directionObject] = cameraChildren(renderer)
          expect(hand?.position.x).toBeCloseTo(expectedPose.offset.x, 10)
          expect(hand?.position.y).toBeCloseTo(expectedPose.offset.y, 10)
          expect(hand?.position.z).toBeCloseTo(expectedPose.offset.z, 10)
          expect(hand?.rotation.x).toBeCloseTo(expectedPose.rotation.x, 10)
          expect(hand?.rotation.y).toBeCloseTo(expectedPose.rotation.y, 10)
          expect(hand?.rotation.z).toBeCloseTo(expectedPose.rotation.z, 10)
          const flash = fakeMesh(flashObject)
          const indicator = fakeMesh(directionObject)
          expect(flash.visible).toBe(input.damageIntensity > 0)
          expect(flash.material.opacity).toBeCloseTo(expectedDamage.flashOpacity, 10)
          expect(indicator.visible).toBe(input.damageIntensity > 0)
          expect(indicator.material.opacity).toBeCloseTo(input.damageIntensity, 10)
          expect(indicator.position.x).toBeCloseTo((input.damageDirection.x / magnitude) * 0.76, 10)
          expect(indicator.position.y).toBeCloseTo((input.damageDirection.y / magnitude) * 0.55, 10)
          expect(indicator.rotation.z).toBeCloseTo(angle - Math.PI / 2, 10)
          return true
        }))
      } finally {
        renderer.dispose()
      }
    }),
  )

  it.effect('property-checks that arbitrary frame inputs return a valid result or typed failure', () =>
    Effect.sync(() => {
      const renderer = createInteractionRenderer(new FakeSurface())
      FastCheck.assert(
        FastCheck.property(FastCheck.anything(), (input) => {
          expectValidResult(renderer.update(input))
        }),
      )
      renderer.dispose()
    }),
  )
})
