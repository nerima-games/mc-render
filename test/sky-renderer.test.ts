import { describe, expect, it } from 'vitest'
import { Result, Schema } from 'effect'
import * as FastCheck from 'fast-check'
import {
  type PresentationBasicMaterial,
  type PresentationBasicMaterialOptions,
  type PresentationBufferAttribute,
  type PresentationBufferGeometry,
  type PresentationMaterial,
  type PresentationObject3D,
  type PresentationVector3,
  type PresentationEuler,
  type RenderPresentationSurface,
  type PresentationLineMaterialOptions,
  type PresentationPointsMaterialOptions,
} from '../src/application/render-presentation-surface.js'
import {
  type RenderPresentationTexture,
  type RenderPresentationTextures,
} from '../src/application/render-presentation-assets.js'
import {
  SkyRendererResultSchema,
  createSkyRenderer,
} from '../src/application/sky-renderer.js'
import { SKY_DAY_LENGTH_TICKS } from '../src/domain/sky-rendering.js'

const CAMERA_X = 12
const CAMERA_Y = 70
const CAMERA_Z = -5
const CAMERA_PITCH = 0.25
const CAMERA_YAW = 1.2
const SUN_NOON_TICK = SKY_DAY_LENGTH_TICKS / 4
const MIDNIGHT_TICK = (SKY_DAY_LENGTH_TICKS * 3) / 4
const CLOUD_BASE_WORLD_Y = 192.33
const CLOUD_UPPER_WORLD_Y = 196.33

class FakeVector implements PresentationVector3 {
  x = 0
  y = 0
  z = 0

  set(x: number, y: number, z: number): unknown {
    this.x = x
    this.y = y
    this.z = z
    return undefined
  }
}

class FakeEuler implements PresentationEuler {
  x = 0
  y = 0
  z = 0

  set(x: number, y: number, z: number, _order: 'YXZ' | 'XYZ'): unknown {
    this.x = x
    this.y = y
    this.z = z
    return undefined
  }
}

class FakeObject implements PresentationObject3D {
  readonly position = new FakeVector()
  readonly rotation = new FakeEuler()
  readonly children: Array<PresentationObject3D> = []
  visible = true
  renderOrder = 0

  add(...objects: ReadonlyArray<PresentationObject3D>): unknown {
    this.children.push(...objects)
    return undefined
  }

  remove(...objects: ReadonlyArray<PresentationObject3D>): unknown {
    for (const object of objects) {
      const index = this.children.indexOf(object)
      if (index >= 0) {
        this.children.splice(index, 1)
      }
    }
    return undefined
  }
}

class FakeAttribute implements PresentationBufferAttribute {
  readonly count: number

  constructor(array: Float32Array, itemSize: number) {
    this.count = array.length / itemSize
  }
}

class FakeGeometry implements PresentationBufferGeometry {
  static readonly instances: Array<FakeGeometry> = []
  readonly attributes = new Map<string, PresentationBufferAttribute>()
  disposed = false
  boundingSphereComputations = 0
  indexValue: PresentationBufferAttribute | null = null
  drawRange: Readonly<{ start: number; count: number }> = { start: 0, count: 0 }

  constructor() {
    FakeGeometry.instances.push(this)
  }

  setAttribute(name: string, attribute: PresentationBufferAttribute): unknown {
    this.attributes.set(name, attribute)
    return undefined
  }

  setIndex(index: PresentationBufferAttribute | null): unknown {
    this.indexValue = index
    return undefined
  }

  setDrawRange(start: number, count: number): unknown {
    this.drawRange = { count, start }
    return undefined
  }

  computeBoundingSphere(): void {
    this.boundingSphereComputations += 1
  }

  dispose(): void {
    this.disposed = true
  }
}

class FakeMaterial implements PresentationMaterial {
  static readonly instances: Array<FakeMaterial> = []
  readonly color: { set: (value: number) => unknown }
  disposed = false
  opacity: number
  transparent: boolean
  depthWrite: boolean
  depthTest: boolean
  colorValue: number

  constructor(options: {
    readonly color?: number
    readonly opacity?: number
    readonly transparent?: boolean
    readonly depthWrite?: boolean
    readonly depthTest?: boolean
  } = {}) {
    this.colorValue = options.color ?? 0xffffff
    this.color = { set: (value) => { this.colorValue = value } }
    this.opacity = options.opacity ?? 1
    this.transparent = options.transparent ?? false
    this.depthWrite = options.depthWrite ?? true
    this.depthTest = options.depthTest ?? true
    FakeMaterial.instances.push(this)
  }

  dispose(): void {
    this.disposed = true
  }
}

class FakeBasicMaterial extends FakeMaterial implements PresentationBasicMaterial<RenderPresentationTexture> {
  map: RenderPresentationTexture | null

  constructor(options: PresentationBasicMaterialOptions<RenderPresentationTexture>) {
    super(options)
    this.map = options.map ?? null
  }
}

class FakeLineMaterial extends FakeMaterial {
  constructor(options: PresentationLineMaterialOptions = {}) {
    super(options)
  }
}

class FakePointsMaterial extends FakeMaterial {
  constructor(options: PresentationPointsMaterialOptions = {}) {
    super(options)
  }
}

class FakeMesh extends FakeObject {
  readonly geometry: FakeGeometry
  readonly material: FakeBasicMaterial | FakeLineMaterial | FakePointsMaterial

  constructor(geometry: FakeGeometry, material: FakeBasicMaterial | FakeLineMaterial | FakePointsMaterial) {
    super()
    this.geometry = geometry
    this.material = material
  }
}

type FakeSurface = RenderPresentationSurface<
  RenderPresentationTexture,
  FakeGeometry,
  FakeBasicMaterial,
  FakeLineMaterial,
  FakePointsMaterial
>

const fakeSurface: FakeSurface = {
  BufferAttribute: FakeAttribute,
  BufferGeometry: FakeGeometry,
  Group: FakeObject,
  LineBasicMaterial: FakeLineMaterial,
  LineSegments: FakeMesh,
  Mesh: FakeMesh,
  MeshBasicMaterial: FakeBasicMaterial,
  Points: FakeMesh,
  PointsMaterial: FakePointsMaterial,
}

const frame = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  cameraPosition: { x: CAMERA_X, y: CAMERA_Y, z: CAMERA_Z },
  cameraPitchRadians: CAMERA_PITCH,
  cameraYawRadians: CAMERA_YAW,
  dimension: 'overworld',
  moonPhase: 0,
  partialTick: 0,
  simulationTick: 0,
  timeOfDayTicks: SUN_NOON_TICK,
  ...overrides,
})

describe('sky renderer', () => {
  it('anchors the sky, faces celestial discs toward the camera, and positions both cloud layers', () => {
    FakeGeometry.instances.length = 0
    FakeMaterial.instances.length = 0
    const sunTexture: RenderPresentationTexture = { isTexture: true }
    const moonTexture: RenderPresentationTexture = { isTexture: true }
    const textures: RenderPresentationTextures<RenderPresentationTexture> = { moon: moonTexture, sun: sunTexture }
    const renderer = createSkyRenderer(fakeSurface, textures)
    const update = renderer.update(frame())

    expect(Result.isSuccess(update)).toBe(true)
    if (Result.isFailure(update)) {
      return
    }
    const { sceneObject } = renderer
    expect(sceneObject.position).toMatchObject({ x: CAMERA_X, y: CAMERA_Y, z: CAMERA_Z })
    expect(sceneObject instanceof FakeObject).toBe(true)
    if (!(sceneObject instanceof FakeObject)) {
      return
    }

    const [, , sunGroup, , , nearCloudGroup, farCloudGroup] = sceneObject.children
    if (!(sunGroup instanceof FakeObject) || !(nearCloudGroup instanceof FakeObject) || !(farCloudGroup instanceof FakeObject)) {
      return
    }
    expect(sunGroup.position.y).toBeCloseTo(160)
    expect(sunGroup.rotation.x).toBe(CAMERA_PITCH)
    expect(sunGroup.rotation.y).toBe(CAMERA_YAW)
    expect(nearCloudGroup.position.y).toBeCloseTo(CLOUD_BASE_WORLD_Y - CAMERA_Y)
    expect(farCloudGroup.position.y).toBeCloseTo(CLOUD_UPPER_WORLD_Y - CAMERA_Y)
    const [, , sunMaterial, moonMaterial] = FakeMaterial.instances
    expect(sunMaterial).toMatchObject({ map: sunTexture })
    expect(moonMaterial).toMatchObject({ map: moonTexture })
    expect(FakeGeometry.instances.every(({ boundingSphereComputations }) => boundingSphereComputations === 1)).toBe(true)

    renderer.dispose()
  })

  it('shows night objects, hides celestial objects in other dimensions, and disposes once', () => {
    FakeGeometry.instances.length = 0
    FakeMaterial.instances.length = 0
    const renderer = createSkyRenderer(fakeSurface)
    const night = renderer.update(frame({ timeOfDayTicks: MIDNIGHT_TICK }))

    expect(Result.isSuccess(night)).toBe(true)
    if (Result.isFailure(night)) {
      return
    }
    const { sceneObject } = renderer
    if (!(sceneObject instanceof FakeObject)) {
      return
    }
    expect(sceneObject.children[2]?.visible).toBe(false)
    expect(sceneObject.children[3]?.visible).toBe(true)
    expect(sceneObject.children[4]?.visible).toBe(true)

    const nether = renderer.update(frame({ dimension: 'nether', timeOfDayTicks: MIDNIGHT_TICK }))
    expect(Result.isSuccess(nether)).toBe(true)
    expect(sceneObject.children[3]?.visible).toBe(false)
    expect(sceneObject.children[4]?.visible).toBe(false)
    expect(sceneObject.children[5]?.visible).toBe(false)
    expect(sceneObject.children[6]?.visible).toBe(false)

    renderer.dispose()
    renderer.dispose()
    expect(FakeGeometry.instances.every(({ disposed }) => disposed)).toBe(true)
    expect(FakeMaterial.instances.every(({ disposed }) => disposed)).toBe(true)
    expect(renderer.update(frame())).toMatchObject({ _tag: 'Failure', failure: { reason: 'disposed' } })
  })

  it('applies independently calculated cloud offsets for generated simulation ticks', () => {
    const renderer = createSkyRenderer(fakeSurface)
    const validFrame = FastCheck.record({
      cameraPitchRadians: FastCheck.integer({ max: 314, min: -314 }).map((value) => value / 100),
      cameraPosition: FastCheck.record({
        x: FastCheck.integer({ max: 500, min: -500 }),
        y: FastCheck.integer({ max: 500, min: -500 }),
        z: FastCheck.integer({ max: 500, min: -500 }),
      }),
      cameraYawRadians: FastCheck.integer({ max: 628, min: -628 }).map((value) => value / 100),
      dimension: FastCheck.constantFrom('overworld', 'nether', 'end'),
      moonPhase: FastCheck.integer({ max: 7, min: 0 }),
      partialTick: FastCheck.integer({ max: 999, min: 0 }).map((value) => value / 1000),
      simulationTick: FastCheck.integer({ max: 1_000_000, min: 0 }),
      timeOfDayTicks: FastCheck.integer({ max: SKY_DAY_LENGTH_TICKS - 1, min: 0 }),
    })
    const wrap = (offset: number): number => ((offset % 240) + 240) % 240

    try {
      FastCheck.assert(FastCheck.property(validFrame, (input) => {
        const updated = renderer.update(input)
        expect(Result.isSuccess(updated)).toBe(true)
        if (Result.isFailure(updated)) {
          return false
        }

        const scene = renderer.sceneObject
        expect(scene instanceof FakeObject).toBe(true)
        if (!(scene instanceof FakeObject)) {
          return false
        }
        const nearClouds = scene.children[5]
        const farClouds = scene.children[6]
        expect(nearClouds instanceof FakeObject).toBe(true)
        expect(farClouds instanceof FakeObject).toBe(true)
        if (!(nearClouds instanceof FakeObject) || !(farClouds instanceof FakeObject)) {
          return false
        }
        const animationSeconds = (input.simulationTick + input.partialTick) / 20
        expect(scene.position).toMatchObject(input.cameraPosition)
        expect(nearClouds.position.x).toBeCloseTo(wrap(-0.78 * animationSeconds - input.cameraPosition.x), 8)
        expect(nearClouds.position.y).toBeCloseTo(192.33 - input.cameraPosition.y, 8)
        expect(nearClouds.position.z).toBeCloseTo(wrap(-input.cameraPosition.z), 8)
        expect(farClouds.position.x).toBeCloseTo(wrap(-0.43 * animationSeconds - input.cameraPosition.x), 8)
        expect(farClouds.position.y).toBeCloseTo(196.33 - input.cameraPosition.y, 8)
        expect(farClouds.position.z).toBeCloseTo(wrap(-input.cameraPosition.z), 8)
        expect(nearClouds.visible).toBe(input.dimension === 'overworld')
        expect(farClouds.visible).toBe(input.dimension === 'overworld')
      }))
    } finally {
      renderer.dispose()
    }
  })

  it('returns schema-decodable results for arbitrary update inputs without throwing', () => {
    const renderer = createSkyRenderer(fakeSurface)
    FastCheck.assert(
      FastCheck.property(FastCheck.anything(), (input) => {
        const actual = renderer.update(input)
        const decoded = Schema.decodeUnknownResult(SkyRendererResultSchema, { onExcessProperty: 'error' })(actual)
        return Result.isSuccess(decoded)
      }),
    )
    renderer.dispose()
  })

  it('rejects boundary times and invalid phases without changing into a silent default', () => {
    const renderer = createSkyRenderer(fakeSurface)

    expect(renderer.update(frame({ timeOfDayTicks: -1 }))).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'time-out-of-range' },
    })
    expect(renderer.update(frame({ timeOfDayTicks: SKY_DAY_LENGTH_TICKS }))).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'time-out-of-range' },
    })
    expect(renderer.update(frame({ moonPhase: 8 }))).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'phase-out-of-range' },
    })
    renderer.dispose()
  })
})
