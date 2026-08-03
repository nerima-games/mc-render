/**
 * A FAKE `three`. READ THIS BEFORE BELIEVING ANY TEST THAT USES IT.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT STANDS IN FOR
 * ---------------------------------------------------------------------------
 *
 * The CALL PROTOCOL of `application/three-surface.ts`, and nothing else. It
 * records which constructors ran, with which arguments, in which order, and
 * which methods were called on the results. So a test using it can honestly
 * assert:
 *
 *   - that `makeWorldRenderer` constructs exactly one renderer, one scene, one
 *     camera and one material, and passes the transcribed parameters
 *     (`antialias: false`, `failIfMajorPerformanceCaveat: false`, fov 75, ...);
 *   - that `setChunk` builds five attributes with the right item sizes and the
 *     right `normalized` flags, and adds ONE mesh to the scene;
 *   - that `setChunk` on a key that already has a mesh REPLACES it — removes
 *     the old one from the scene and disposes its geometry — rather than
 *     leaking a mesh per edit;
 *   - that `draw` writes the mirrored pose onto the camera IN THAT DIRECTION
 *     and then calls `render(scene, camera)`;
 *   - that `dispose` releases every chunk geometry, the shared material and the
 *     renderer, and leaves the scene empty.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES **NOT** STAND IN FOR. NOTHING HERE IS EVIDENCE ABOUT A GPU
 * ---------------------------------------------------------------------------
 *
 * It models NO GPU behaviour whatsoever, and a fake that pretended to would be
 * worse than none — it would make the whole class of failures below look
 * covered. Specifically, a green test against this fake says NOTHING about:
 *
 *   - whether a WebGL2 context can be acquired at all, under SwiftShader or
 *     anywhere else. `new WebGLRenderer(...)` here allocates an object;
 *     there it negotiates a context and can throw;
 *   - whether anything is VISIBLE. Winding, culling, depth, the projection
 *     matrix, whether the camera is inside the geometry, whether the near plane
 *     eats the world — none of it is simulated, and every one of them produces
 *     a blank screen with every call in this file made correctly;
 *   - whether the buffers are VALID to upload. An index that overruns the
 *     position attribute is a WebGL error and is not detectable here;
 *   - whether `dispose()` actually released GPU memory;
 *   - shader compilation, texture upload, or anything about `vertexColors`
 *     beyond the flag having been passed.
 *
 * The claims in that list have exactly one check in this organisation, and it
 * is not a unit test: `mc-compose`'s `pnpm e2e:browser`, on Chromium with
 * SwiftShader. `docs/testing.md` §3.4's rule is the reason this header is this
 * long — a suite composed of fakes verifies the fakes, and the defence is to
 * say in the fake which assertions it cannot carry.
 *
 * ---------------------------------------------------------------------------
 * It is a fake and not a mock
 * ---------------------------------------------------------------------------
 *
 * Nothing here throws on an unexpected call and nothing asserts. It records,
 * and the test does the asserting — the same shape as `makeFakeDom` in
 * `test/browser-input-adapter.test.ts`, and for the same reason: a double that
 * fails inside itself reports the failure at the wrong stack frame.
 */
import type {
  ThreeBufferAttribute,
  ThreeBufferGeometry,
  ThreeMaterial,
  ThreeMesh,
  ThreePerspectiveCamera,
  ThreeRendererParameters,
  ThreeInstancedBufferAttribute,
  ThreeInstancedBufferGeometry,
  ThreeScene,
  ThreeShaderMaterialParameters,
  ThreeInstancedSurface,
  ThreeShaderSurface,
  ThreeSurface,
  ThreeUniform,
  ThreeWebGLRenderer,
} from '../../src/application/three-surface'

/** One `new BufferAttribute(array, itemSize, normalized)`, recorded verbatim. */
export type RecordedAttribute = {
  readonly array: Float32Array | Uint8Array | Uint32Array
  readonly itemSize: number
  readonly normalized: boolean
  needsUpdate?: boolean
}

export type FakeGeometry = ThreeBufferGeometry & {
  /**
   * Attributes by name, in the order `setAttribute` was called.
   *
   * The value is a UNION because the instanced geometry below is a
   * `FakeGeometry` too, and `Map` is invariant in its value — a narrower map
   * here would make `FakeInstancedGeometry` fail to be a subtype, and the
   * `Mesh` constructor would then need a second overload for no reason three
   * has one.
   */
  readonly attributes: Map<string, RecordedAttribute | FakeInstancedAttribute>
  readonly index: () => RecordedAttribute | undefined
  readonly boundingSphereComputations: () => number
  readonly drawRanges: () => ReadonlyArray<readonly [number, number]>
  readonly disposed: () => boolean
}

export type FakeMaterial = ThreeMaterial & {
  readonly vertexColors: boolean
  readonly wireframe: boolean
  readonly disposed: () => boolean
}

/**
 * A `ShaderMaterial`, recorded with the source it was handed.
 *
 * SEPARATE FROM `FakeMaterial` for the same reason `ThreeShaderSurface` takes a
 * fourth type parameter rather than reusing the third: they are not the same
 * material. Collapsing them here would let a test pass that the type system is
 * specifically arranged to reject — see `application/three-surface.ts`'s header
 * on the first cut that obliged `MeshBasicMaterial` to return a
 * `ShaderMaterial`.
 *
 * The uniform record is held BY REFERENCE, which is what lets a test assert the
 * property the boxes exist for: writing `uniforms.uSunIntensity.value` after
 * construction is visible through the material without a rebuild.
 */
export type FakeShaderMaterial = ThreeMaterial & {
  readonly vertexShader: string
  readonly fragmentShader: string
  readonly uniforms: Record<string, ThreeUniform>
  readonly vertexColors: true
  readonly transparent?: boolean
  readonly depthWrite?: boolean
  readonly forceSinglePass?: boolean
  readonly disposed: () => boolean
}

/**
 * One `new InstancedBufferAttribute(array, itemSize)`, holding the array BY
 * REFERENCE so a test can prove the pool's buffer is the uploaded one.
 */
export type FakeInstancedAttribute = ThreeInstancedBufferAttribute & {
  readonly array: Float32Array
  readonly itemSize: number
}

export type FakeInstancedGeometry = FakeGeometry & ThreeInstancedBufferGeometry

export type FakeMesh = ThreeMesh & {
  readonly geometry: FakeGeometry
  readonly material: FakeMaterial | FakeShaderMaterial
  readonly positions: () => ReadonlyArray<readonly [number, number, number]>
  readonly scales: () => ReadonlyArray<readonly [number, number, number]>
  readonly rotations: () => ReadonlyArray<readonly [number, number, number, 'YXZ']>
  readonly position: { readonly set: (x: number, y: number, z: number) => void }
  readonly scale: { readonly set: (x: number, y: number, z: number) => void }
  readonly rotation: {
    readonly set: (x: number, y: number, z: number, order: 'YXZ') => void
  }
}

/** One `camera.position.set` / `camera.rotation.set`, recorded verbatim. */
export type RecordedPose = {
  readonly position: readonly [number, number, number]
  readonly rotation: readonly [number, number, number, 'YXZ']
}

export type FakeCamera = ThreePerspectiveCamera & {
  readonly fov: number
  readonly near: number
  readonly far: number
  readonly poses: () => ReadonlyArray<RecordedPose>
  readonly projectionUpdates: () => number
}

export type FakeRenderer = ThreeWebGLRenderer & {
  readonly parameters: ThreeRendererParameters<FakeCanvas>
  readonly sizes: () => ReadonlyArray<readonly [number, number, boolean]>
  readonly clearColors: () => ReadonlyArray<readonly [number, number]>
  readonly renderCalls: () => number
  readonly disposed: () => boolean
}

export type FakeScene = ThreeScene & {
  /** Meshes currently in the scene, in insertion order. */
  readonly members: () => ReadonlyArray<ThreeMesh>
}

/** The host's canvas, reduced to nothing. The renderer only hands it back. */
export type FakeCanvas = { readonly id: string }

export type FakeThree = ThreeSurface<FakeCanvas, FakeGeometry, FakeMaterial> &
  ThreeShaderSurface<FakeCanvas, FakeGeometry, FakeMaterial, FakeShaderMaterial> &
  ThreeInstancedSurface<FakeCanvas, FakeGeometry, FakeMaterial, FakeInstancedGeometry> & {
  readonly Mesh: new (
    geometry: FakeGeometry,
    material: FakeMaterial | FakeShaderMaterial,
  ) => FakeMesh
  readonly renderers: () => ReadonlyArray<FakeRenderer>
  readonly scenes: () => ReadonlyArray<FakeScene>
  readonly cameras: () => ReadonlyArray<FakeCamera>
  readonly materials: () => ReadonlyArray<FakeMaterial>
  readonly shaderMaterials: () => ReadonlyArray<FakeShaderMaterial>
  readonly instancedGeometries: () => ReadonlyArray<FakeInstancedGeometry>
  readonly instancedAttributes: () => ReadonlyArray<FakeInstancedAttribute>
  readonly geometries: () => ReadonlyArray<FakeGeometry>
  readonly meshes: () => ReadonlyArray<FakeMesh>
  /** The one renderer / scene / camera, for the common case of exactly one. */
  readonly renderer: () => FakeRenderer
  readonly scene: () => FakeScene
  readonly camera: () => FakeCamera
}

const theOnly = <A>(what: string, values: ReadonlyArray<A>): A => {
  const first = values[0]
  if (first === undefined || values.length !== 1) {
    throw new Error(`expected exactly one ${what}, found ${String(values.length)}`)
  }
  return first
}

export const makeFakeThree = (): FakeThree => {
  const renderers: Array<FakeRenderer> = []
  const scenes: Array<FakeScene> = []
  const cameras: Array<FakeCamera> = []
  const materials: Array<FakeMaterial> = []
  const shaderMaterials: Array<FakeShaderMaterial> = []
  const instancedGeometries: Array<FakeInstancedGeometry> = []
  const instancedAttributes: Array<FakeInstancedAttribute> = []
  const geometries: Array<FakeGeometry> = []
  const meshes: Array<FakeMesh> = []

  const WebGLRenderer = class {
    constructor(parameters: ThreeRendererParameters<FakeCanvas>) {
      const sizes: Array<readonly [number, number, boolean]> = []
      const clearColors: Array<readonly [number, number]> = []
      let renderCalls = 0
      let disposed = false
      const self: FakeRenderer = {
        parameters,
        sizes: () => sizes,
        clearColors: () => clearColors,
        renderCalls: () => renderCalls,
        disposed: () => disposed,
        setSize: (width, height, updateStyle) => sizes.push([width, height, updateStyle]),
        setClearColor: (color, alpha) => clearColors.push([color, alpha]),
        render: () => {
          renderCalls += 1
        },
        dispose: () => {
          disposed = true
        },
      }
      renderers.push(self)
      return self
    }
  } as unknown as new (parameters: ThreeRendererParameters<FakeCanvas>) => ThreeWebGLRenderer

  const Scene = class {
    constructor() {
      const members: Array<ThreeMesh> = []
      const self: FakeScene = {
        members: () => members,
        add: (object) => members.push(object),
        remove: (object) => {
          const at = members.indexOf(object)
          if (at >= 0) {
            members.splice(at, 1)
          }
        },
      }
      scenes.push(self)
      return self
    }
  } as unknown as new () => ThreeScene

  const PerspectiveCamera = class {
    constructor(fov: number, aspect: number, near: number, far: number) {
      const poses: Array<RecordedPose> = []
      let pendingPosition: readonly [number, number, number] = [0, 0, 0]
      let projectionUpdates = 0
      const self: FakeCamera = {
        fov,
        near,
        far,
        aspect,
        poses: () => poses,
        projectionUpdates: () => projectionUpdates,
        position: {
          set: (x, y, z) => {
            pendingPosition = [x, y, z]
          },
        },
        rotation: {
          // The pose is recorded when the ROTATION lands, because
          // `WorldRenderer.draw` sets the position first and a pose is only a
          // pose once both halves are in. Recording on the position instead
          // would make a renderer that forgot `rotation.set` look correct.
          set: (x, y, z, order) => {
            poses.push({ position: pendingPosition, rotation: [x, y, z, order] })
          },
        },
        updateProjectionMatrix: () => {
          projectionUpdates += 1
        },
      }
      cameras.push(self)
      return self
    }
  } as unknown as new (
    fov: number,
    aspect: number,
    near: number,
    far: number,
  ) => ThreePerspectiveCamera

  const BufferGeometry = class {
    constructor() {
      const attributes = new Map<string, RecordedAttribute>()
      let index: RecordedAttribute | undefined
      let boundingSphereComputations = 0
      const drawRanges: Array<readonly [number, number]> = []
      let disposed = false
      const self: FakeGeometry = {
        attributes,
        index: () => index,
        boundingSphereComputations: () => boundingSphereComputations,
        drawRanges: () => drawRanges,
        disposed: () => disposed,
        setAttribute: (name, attribute) => {
          attributes.set(name, attribute as RecordedAttribute)
        },
        setIndex: (attribute) => {
          index = attribute === null ? undefined : (attribute as RecordedAttribute)
        },
        setDrawRange: (start, count) => {
          drawRanges.push([start, count])
        },
        computeBoundingSphere: () => {
          boundingSphereComputations += 1
        },
        dispose: () => {
          disposed = true
        },
      }
      geometries.push(self)
      return self
    }
  } as unknown as new () => FakeGeometry

  const BufferAttribute = class {
    constructor(
      array: Float32Array | Uint8Array | Uint32Array,
      itemSize: number,
      normalized: boolean,
    ) {
      const self: RecordedAttribute = { array, itemSize, normalized }
      return self
    }
  } as unknown as new (
    array: Float32Array | Uint8Array | Uint32Array,
    itemSize: number,
    normalized: boolean,
  ) => ThreeBufferAttribute

  const MeshBasicMaterial = class {
    constructor(parameters: { readonly vertexColors: boolean; readonly wireframe: boolean }) {
      let disposed = false
      const self: FakeMaterial = {
        vertexColors: parameters.vertexColors,
        wireframe: parameters.wireframe,
        disposed: () => disposed,
        dispose: () => {
          disposed = true
        },
      }
      materials.push(self)
      return self
    }
  } as unknown as new (parameters: {
    readonly vertexColors: boolean
    readonly wireframe: boolean
  }) => FakeMaterial

  const InstancedBufferAttribute = class {
    constructor(array: Float32Array, itemSize: number) {
      const self: FakeInstancedAttribute = {
        // The POOL'S array by reference, not a copy — the aliasing that
        // `application/particle-system.ts`'s header defends. A fake that copied
        // would make the one property worth testing untestable.
        array,
        itemSize,
        needsUpdate: false,
      }
      instancedAttributes.push(self)
      return self
    }
  } as unknown as new (array: Float32Array, itemSize: number) => ThreeInstancedBufferAttribute

  const InstancedBufferGeometry = class {
    constructor() {
      const attributes = new Map<string, RecordedAttribute | FakeInstancedAttribute>()
      const drawRanges: Array<readonly [number, number]> = []
      let index: RecordedAttribute | undefined
      let disposed = false
      const self: FakeInstancedGeometry = {
        instanceCount: 0,
        attributes,
        index: () => index,
        boundingSphereComputations: () => 0,
        drawRanges: () => drawRanges,
        disposed: () => disposed,
        setAttribute: (name: string, attribute: unknown) => {
          attributes.set(name, attribute as RecordedAttribute)
        },
        setIndex: (attribute: unknown) => {
          index = (attribute ?? undefined) as RecordedAttribute | undefined
        },
        setDrawRange: (start, count) => {
          drawRanges.push([start, count])
        },
        computeBoundingSphere: () => {},
        dispose: () => {
          disposed = true
        },
      }
      instancedGeometries.push(self)
      return self
    }
  } as unknown as new () => FakeInstancedGeometry

  const ShaderMaterial = class {
    constructor(parameters: ThreeShaderMaterialParameters) {
      let disposed = false
      const self: FakeShaderMaterial = {
        vertexShader: parameters.vertexShader,
        fragmentShader: parameters.fragmentShader,
        // The SAME object, not a copy. A copy would make the uniform boxes
        // untestable — the whole reason they are boxes is that a host mutates
        // `.value` and every sharer sees it.
        uniforms: parameters.uniforms,
        vertexColors: parameters.vertexColors,
        ...(parameters.transparent === undefined ? {} : { transparent: parameters.transparent }),
        ...(parameters.depthWrite === undefined ? {} : { depthWrite: parameters.depthWrite }),
        ...(parameters.forceSinglePass === undefined ? {} : { forceSinglePass: parameters.forceSinglePass }),
        disposed: () => disposed,
        dispose: () => {
          disposed = true
        },
      }
      shaderMaterials.push(self)
      return self
    }
  } as unknown as new (parameters: ThreeShaderMaterialParameters) => FakeShaderMaterial

  const Mesh = class {
    constructor(geometry: FakeGeometry, material: FakeMaterial | FakeShaderMaterial) {
      const positions: Array<readonly [number, number, number]> = []
      const scales: Array<readonly [number, number, number]> = []
      const rotations: Array<readonly [number, number, number, 'YXZ']> = []
      const self: FakeMesh = {
        frustumCulled: true,
        visible: true,
        geometry,
        material,
        positions: () => positions,
        scales: () => scales,
        rotations: () => rotations,
        position: { set: (x, y, z) => positions.push([x, y, z]) },
        scale: { set: (x, y, z) => scales.push([x, y, z]) },
        rotation: { set: (x, y, z, order) => rotations.push([x, y, z, order]) },
      }
      meshes.push(self)
      return self
    }
    // Accepts EITHER material, mirroring `ThreeShaderSurface`'s widened `Mesh`.
    // The real `THREE.Mesh` takes any `Material`; narrowing the fake to one of
    // them would make the shader path untestable here for a reason three does
    // not have.
  } as unknown as new (
    geometry: FakeGeometry,
    material: FakeMaterial | FakeShaderMaterial,
  ) => FakeMesh

  return {
    WebGLRenderer,
    Scene,
    PerspectiveCamera,
    BufferGeometry,
    BufferAttribute,
    Mesh,
    MeshBasicMaterial,
    ShaderMaterial,
    InstancedBufferGeometry,
    InstancedBufferAttribute,
    renderers: () => renderers,
    scenes: () => scenes,
    cameras: () => cameras,
    materials: () => materials,
    shaderMaterials: () => shaderMaterials,
    instancedGeometries: () => instancedGeometries,
    instancedAttributes: () => instancedAttributes,
    geometries: () => geometries,
    meshes: () => meshes,
    renderer: () => theOnly('renderer', renderers),
    scene: () => theOnly('scene', scenes),
    camera: () => theOnly('camera', cameras),
  }
}

/** A canvas that is only ever handed back to `three`. */
export const FAKE_CANVAS: FakeCanvas = { id: 'game-canvas' }
