import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import * as FastCheck from 'fast-check'
import { makeThreeWeatherPrecipitation } from '../src/application/three-weather-runtime'
import type {
  ThreeBufferAttribute,
  ThreeBufferGeometry,
  ThreeDynamicBufferAttribute,
  ThreeCamera,
  ThreeMaterial,
  ThreeMesh,
  ThreeObject3D,
  ThreePerspectiveCamera,
  ThreeRendererParameters,
  ThreeWebGLRenderer,
  ThreeScene,
  ThreeSurface,
} from '../src/application/three-surface'
import { planLightningBolt } from '../src/domain/lightning-bolt'

type FakeAttribute = ThreeDynamicBufferAttribute & {
  readonly array: Float32Array | Uint8Array | Uint32Array
  readonly itemSize: number
  readonly normalized: boolean
}

class FakeBufferAttribute implements FakeAttribute {
  needsUpdate = false
  readonly array: Float32Array | Uint8Array | Uint32Array
  readonly itemSize: number
  readonly normalized: boolean

  constructor(
    array: Float32Array | Uint8Array | Uint32Array,
    itemSize: number,
    normalized: boolean,
  ) {
    this.array = array
    this.itemSize = itemSize
    this.normalized = normalized
  }
}

class FakeBufferGeometry implements ThreeBufferGeometry {
  readonly attributes = new Map<string, ThreeBufferAttribute>()
  private drawCount = 0
  private isDisposed = false
  private boundingSphereComputationCount = 0

  setAttribute(name: string, attribute: ThreeBufferAttribute): unknown {
    this.attributes.set(name, attribute)
    return this
  }

  setIndex(_index: ThreeBufferAttribute | null): unknown {
    return this
  }

  setDrawRange(_start: number, count: number): unknown {
    this.drawCount = count
    return this
  }

  readonly computeBoundingSphere = (): void => {
    this.boundingSphereComputationCount += 1
  }
  readonly dispose = (): void => { this.isDisposed = true }

  drawRange(): number {
    return this.drawCount
  }

  disposed(): boolean {
    return this.isDisposed
  }
}

class FakeMaterial implements ThreeMaterial {
  private isDisposed = false
  readonly vertexColors: boolean
  readonly wireframe: boolean

  constructor(vertexColors: boolean, wireframe: boolean) {
    this.vertexColors = vertexColors
    this.wireframe = wireframe
  }

  readonly dispose = (): void => { this.isDisposed = true }

  disposed(): boolean {
    return this.isDisposed
  }
}

class FakeMeshBasicMaterial extends FakeMaterial {
  constructor(parameters: { readonly vertexColors: boolean; readonly wireframe: boolean }) {
    super(parameters.vertexColors, parameters.wireframe)
  }
}

class FakeMesh implements ThreeMesh {
  visible = false
  frustumCulled = true
  readonly children: Array<ThreeObject3D> = []
  readonly geometry: FakeBufferGeometry
  readonly material: FakeMaterial
  readonly position = { set: (_x: number, _y: number, _z: number): unknown => undefined }
  readonly rotation = { set: (_x: number, _y: number, _z: number, _order: 'YXZ' | 'XYZ'): unknown => undefined }

  constructor(geometry: FakeBufferGeometry, material: FakeMaterial) {
    this.geometry = geometry
    this.material = material
  }

  readonly add = (...objects: ReadonlyArray<ThreeObject3D>): unknown => {
    this.children.push(...objects)
    return this
  }

  readonly remove = (...objects: ReadonlyArray<ThreeObject3D>): unknown => {
    for (const object of objects) {
      const index = this.children.indexOf(object)
      if (index >= 0) {
        this.children.splice(index, 1)
      }
    }
    return this
  }
}

class FakeScene implements ThreeScene {
  readonly objects: Array<ThreeObject3D> = []

  add(object: ThreeObject3D): unknown {
    this.objects.push(object)
    return this
  }

  remove(object: ThreeObject3D): unknown {
    const index = this.objects.indexOf(object)
    if (index >= 0) {
      this.objects.splice(index, 1)
    }
    return this
  }
}

class FakePerspectiveCamera implements ThreePerspectiveCamera {
  readonly position = { set: (_x: number, _y: number, _z: number): unknown => undefined }
  readonly rotation = { set: (_x: number, _y: number, _z: number, _order: 'YXZ'): unknown => undefined }
  aspect: number
  private projectionUpdateCount = 0
  readonly children: Array<ThreeObject3D> = []

  constructor(_fov: number, aspect: number, _near: number, _far: number) {
    this.aspect = aspect
  }

  readonly updateProjectionMatrix = (): void => {
    this.projectionUpdateCount += 1
  }

  readonly add = (...objects: ReadonlyArray<ThreeObject3D>): unknown => {
    this.children.push(...objects)
    return this
  }

  readonly remove = (...objects: ReadonlyArray<ThreeObject3D>): unknown => {
    for (const object of objects) {
      const index = this.children.indexOf(object)
      if (index >= 0) {
        this.children.splice(index, 1)
      }
    }
    return this
  }
}

class FakeWebGLRenderer implements ThreeWebGLRenderer {
  private lastRender: Readonly<{ readonly scene: ThreeScene; readonly camera: ThreeCamera }> | undefined
  private lastSize: Readonly<{ readonly width: number; readonly height: number; readonly updateStyle: boolean }> | undefined
  private lastClearColor: Readonly<{ readonly color: number; readonly alpha: number }> | undefined
  private disposed = false
  readonly parameters: ThreeRendererParameters<unknown>

  constructor(parameters: ThreeRendererParameters<unknown>) {
    this.parameters = parameters
  }

  readonly render = (scene: ThreeScene, camera: ThreeCamera): unknown => {
    this.lastRender = { camera, scene }
    return this.lastRender
  }

  readonly setSize = (width: number, height: number, updateStyle: boolean): unknown => {
    this.lastSize = { height, updateStyle, width }
    return this.lastSize
  }

  readonly setClearColor = (color: number, alpha: number): unknown => {
    this.lastClearColor = { alpha, color }
    return this.lastClearColor
  }

  readonly dispose = (): void => {
    if (!this.disposed) {
      this.disposed = true
    }
  }
}

type FakeWeatherSurface = Omit<ThreeSurface<unknown, FakeBufferGeometry, FakeMaterial>, 'Mesh'> & {
  readonly Mesh: new (geometry: FakeBufferGeometry, material: FakeMaterial) => FakeMesh
}

const fakeThree = (): FakeWeatherSurface => ({
  BufferAttribute: FakeBufferAttribute,
  BufferGeometry: FakeBufferGeometry,
  Mesh: FakeMesh,
  MeshBasicMaterial: FakeMeshBasicMaterial,
  PerspectiveCamera: FakePerspectiveCamera,
  Scene: FakeScene,
  WebGLRenderer: FakeWebGLRenderer,
})

describe('Three precipitation resource lightning lifecycle', () => {
  it.effect('uploads visible ribbon geometry, hides it on expiry, and disposes every owned object', () =>
    Effect.sync(() => {
      const scene = new FakeScene()
      const three = fakeThree()
      const resource = makeThreeWeatherPrecipitation({ capacity: 1, kind: 'rain', scene, three })
      const [particleMesh, lightningMesh] = scene.objects as unknown as ReadonlyArray<FakeMesh>
      expect(scene.objects).toHaveLength(2)
      expect(particleMesh).toBeDefined()
      expect(lightningMesh).toBeDefined()

      const plan = planLightningBolt({ origin: { x: 2, y: 10, z: -3 }, seed: 5, sequence: 8 })
      Effect.runSync(resource.updateLightning?.(plan, 1) ?? Effect.void)
      expect(lightningMesh?.visible).toBe(true)
      expect(lightningMesh?.geometry.drawRange()).toBe(576)
      const positions = lightningMesh?.geometry.attributes.get('position') as FakeAttribute | undefined
      const colors = lightningMesh?.geometry.attributes.get('color') as FakeAttribute | undefined
      expect(positions?.array).toBeInstanceOf(Float32Array)
      expect((positions?.array as Float32Array | undefined)?.every(Number.isFinite)).toBe(true)
      expect(colors?.normalized).toBe(true)
      expect((colors?.array as Uint8Array | undefined)?.some((value) => value > 0)).toBe(true)

      Effect.runSync(resource.updateLightning?.(undefined, 0) ?? Effect.void)
      expect(lightningMesh?.visible).toBe(false)
      expect(lightningMesh?.geometry.drawRange()).toBe(0)
      Effect.runSync(resource.dispose)
      Effect.runSync(resource.dispose)
      expect(scene.objects).toHaveLength(0)
      expect(particleMesh?.geometry.disposed()).toBe(true)
      expect(lightningMesh?.geometry.disposed()).toBe(true)
      expect(particleMesh?.material.disposed()).toBe(true)
    }),
  )

  it.effect('property: arbitrary sequence and seed values still upload finite fixed-size geometry', () =>
    Effect.sync(() => {
      FastCheck.assert(
        FastCheck.property(FastCheck.integer(), FastCheck.integer(), (seed, sequence) => {
          const scene = new FakeScene()
          const resource = makeThreeWeatherPrecipitation({ capacity: 0, kind: 'rain', scene, three: fakeThree() })
          const plan = planLightningBolt({ origin: { x: 0, y: 0, z: 0 }, seed, sequence })
          Effect.runSync(resource.updateLightning?.(plan, 0.5) ?? Effect.void)
          const [, lightningMesh] = scene.objects as unknown as ReadonlyArray<FakeMesh>
          const positions = lightningMesh?.geometry.attributes.get('position') as FakeAttribute | undefined
          const valid = lightningMesh?.visible === true &&
            lightningMesh.geometry.drawRange() === 576 &&
            (positions?.array as Float32Array | undefined)?.every(Number.isFinite) === true
          Effect.runSync(resource.dispose)
          return valid
        }),
        { numRuns: 100 },
      )
    }),
  )
})
