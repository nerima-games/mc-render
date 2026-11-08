import { describe, expect, it } from '@effect/vitest'
import * as FastCheck from 'fast-check'
import { Effect, Result, Schema } from 'effect'
import {
  HeldItemDescriptorSchema,
  InteractionFrameInputSchema,
  InteractionFrameResultSchema,
  type InteractionFrameInputEncoded,
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
import { ATLAS_TILE_COUNT, tileUvBounds } from '../src/domain/texture-atlas'

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

const expectValidResult = (value: Result.Result<unknown, unknown>): void => {
  if (Result.isSuccess(value)) {
    const decoded = Schema.decodeUnknownResult(InteractionFrameResultSchema, { onExcessProperty: 'error' })(value.success)
    expect(Result.isSuccess(decoded)).toBe(true)
    return
  }
  const decoded = Schema.decodeUnknownResult(InteractionVisualInputErrorSchema, { onExcessProperty: 'error' })(value.failure)
  expect(Result.isSuccess(decoded)).toBe(true)
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

  it.effect('uses injected crack and held-item textures from the shared texture input', () =>
    Effect.sync(() => {
      const crackTexture = { isTexture: true, name: 'cracks' } satisfies FakeTexture
      const armTexture = { isTexture: true, name: 'generated-arm' } satisfies FakeTexture
      const atlasTexture = { isTexture: true, name: 'rn5-atlas' } satisfies FakeTexture
      const renderer = createInteractionRenderer(new FakeSurface(), {
        arm: armTexture,
        cracks: crackTexture,
        heldItem: atlasTexture,
      })
      const tileIndex = 47
      const result = renderer.update({
        ...FRAME,
        heldItem: { kind: 'block', tileIndex },
        target: { shape: FULL_CUBE, position: { x: 0, y: 0, z: 0 } },
      })
      const worldChildren = fakeMeshes(renderer.sceneObject)
      const [hand] = cameraChildren(renderer)
      const arm = fakeMesh(hand?.children[0])
      const heldItem = fakeMesh(hand?.children[1])
      const expectedTile = tileUvBounds(tileIndex)

      expect(Result.isSuccess(result)).toBe(true)
      expect(worldChildren).toHaveLength(8)
      expect(worldChildren.slice(1, 7).every((mesh) => mesh.material.map === crackTexture)).toBe(true)
      expect(worldChildren[7]?.geometry.attributes.get('position')?.count).toBe(60)
      expect(arm.material.map).toBe(armTexture)
      expect(arm.geometry.attributes.get('uv')?.count).toBe(36)
      expect(heldItem.material.map).toBe(atlasTexture)
      const itemUvs = heldItem.geometry.attributes.get('uv')
      expect(itemUvs?.count).toBe(36)
      expect(Array.from(itemUvs?.array.slice(0, 12) ?? [])).toStrictEqual([
        expectedTile.u0,
        expectedTile.v0,
        expectedTile.u1,
        expectedTile.v0,
        expectedTile.u1,
        expectedTile.v1,
        expectedTile.u0,
        expectedTile.v0,
        expectedTile.u1,
        expectedTile.v1,
        expectedTile.u0,
        expectedTile.v1,
      ])
      expect(worldChildren[1]?.material.opacity).toBeGreaterThan(0)
      renderer.update({ ...FRAME, heldItem: { kind: 'block', tileIndex }, miningProgress: 0.7 })
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
        heldItem: { kind: 'block', tileIndex: 47 },
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
      for (const tileIndex of [0, ATLAS_TILE_COUNT - 1]) {
        const valid = Schema.decodeUnknownResult(HeldItemDescriptorSchema, { onExcessProperty: 'error' })({
          kind: 'block',
          tileIndex,
        })
        expect(Result.isSuccess(valid)).toBe(true)
      }
      for (const tileIndex of [-1, ATLAS_TILE_COUNT]) {
        const invalid = Schema.decodeUnknownResult(HeldItemDescriptorSchema, { onExcessProperty: 'error' })({
          kind: 'block',
          tileIndex,
        })
        expect(Result.isFailure(invalid)).toBe(true)
      }

      const frameDecode = Schema.decodeUnknownResult(InteractionFrameInputSchema, { onExcessProperty: 'error' })({
        ...FRAME,
        heldItem: { kind: 'block', tileIndex: ATLAS_TILE_COUNT },
      })
      expect(Result.isFailure(frameDecode)).toBe(true)
    }),
  )

  it.effect('property-checks every public held-item descriptor against its schema', () =>
    Effect.sync(() => {
      const blockDescriptor = FastCheck.integer({ max: ATLAS_TILE_COUNT - 1, min: 0 })
        .map((tileIndex) => ({ kind: 'block' as const, tileIndex }))
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
