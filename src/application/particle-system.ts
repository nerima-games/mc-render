/**
 * The particle system: `domain/particle-pool.ts`'s five typed arrays, bound to
 * an instanced geometry, uploaded once and re-flagged every frame.
 *
 * THE POOL IS NOT COPIED. `InstancedBufferAttribute` is constructed over the
 * pool's OWN `Float32Array`s, so `advanceParticles` integrating in place is
 * already the update — there is no per-frame copy, no scratch buffer and no
 * marshalling step. `sync` below does two things and neither of them is
 * arithmetic: it sets `needsUpdate` so three re-uploads the bytes, and it sets
 * `instanceCount` so the dead tail is not drawn.
 *
 * That aliasing is the whole reason `ParticlePool` exposes its arrays rather
 * than accessors, and it is worth stating because it looks like leaked
 * encapsulation. It is the same decision the pool's own header defends about
 * capacity: the buffers are fixed at construction precisely so that something
 * downstream can hold them for the lifetime of the system.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * IT DOES NOT INTEGRATE. `advanceParticles` is the pool's, is pure, and is
 * tested in Node without any of this. A frame calls that and then calls `sync`;
 * putting the integration here would put physics behind a GPU seam and make it
 * untestable for no gain.
 *
 * IT DOES NOT OWN THE ATLAS. `uAtlas` is bound by the host, from the same
 * texture the chunk material samples — particles are chips off blocks and
 * sample the same tiles, which is why `ParticlePool.uvOffsets` holds an atlas
 * origin rather than a colour.
 *
 * IT DOES NOT USE `THREE.InstancedMesh` (DN-20). `domain/particle-pool.ts`'s
 * header names the reference's choice of `InstancedMesh`, but the property
 * that actually matters — one geometry, one material, one draw call — is a
 * property of the GEOMETRY, not of the mesh class: `ThreeInstancedBufferGeometry`
 * above already says so (`instanceCount` is what tells three "draw the first N
 * instances"). `InstancedMesh` is `Mesh` PLUS an `instanceMatrix` convenience
 * built on that same instanced-geometry mechanism, so skipping it does not cost
 * a draw call — this file already had the one draw call before this question
 * was even asked. What `InstancedMesh` would add is `instanceMatrix`, and nothing
 * here needs it, at a real cost:
 *
 *   - `InstancedMesh.instanceMatrix` is a `Float32Array(count * 16)` — a full
 *     `Matrix4` per instance, 64 bytes, because a mesh instance can rotate and
 *     shear. A particle here needs `instancePosition` (3), `instanceScale` (1)
 *     and `instanceUvOffset` (2) — 24 bytes (`PARTICLE_INSTANCE_ATTRIBUTES`,
 *     `domain/particle-shader.ts`) — because the billboard rotation happens in
 *     the vertex shader, in view space, from the camera basis
 *     (`domain/particle-shader.ts` "WHY THE QUAD IS BILLBOARDED IN THE VERTEX
 *     STAGE"). `InstancedMesh` would carry 40 bytes/instance nobody reads, and
 *     `instanceMatrix` still has no slot for `instanceUvOffset` — the atlas
 *     tile origin would need its OWN `InstancedBufferAttribute` bolted on
 *     alongside it regardless, which is the attribute this file already
 *     builds directly. Adopting `InstancedMesh` would not remove a custom
 *     attribute; it would add a second one next to the ones already required.
 *   - Writing a `Matrix4` per instance means calling `setMatrixAt(i, matrix)`
 *     in a loop, once per particle, every frame that has a live particle. THE
 *     POOL IS NOT COPIED (above) is exactly the property that loop would
 *     undo — `advanceParticles` already leaves the final bytes sitting in the
 *     pool's own arrays, and `InstancedBufferAttribute` reads them in place.
 *
 * If a later change needs true per-instance rotation or non-uniform scale,
 * that is the point to re-open this, not before — the two costs above are the
 * price of a capability nothing here uses yet.
 */
import { Effect, Ref } from 'effect'
import {
  PARTICLE_ALPHA_TEST,
  PARTICLE_WRITES_DEPTH,
  type ParticlePool,
} from '../domain/particle-pool.js'
import {
  PARTICLE_INSTANCE_ATTRIBUTES,
  PARTICLE_QUAD_INDICES,
  PARTICLE_QUAD_POSITIONS,
  PARTICLE_QUAD_UVS,
  PARTICLE_SHADER_UNIFORMS,
  particleShaderSource,
} from '../domain/particle-shader.js'
import {
  POSITION_COMPONENTS,
  UV_COMPONENTS,
} from '../domain/chunk-geometry.js'
import {
  THREE_DOUBLE_SIDE,
  type ThreeBufferAttribute,
  type ThreeBufferGeometry,
  type ThreeInstancedBufferAttribute,
  type ThreeInstancedBufferGeometry,
  type ThreeInstancedSurface,
  type ThreeMaterial,
  type ThreeMesh,
  type ThreeShaderMaterialParameters,
  type ThreeUniform,
} from './three-surface.js'

/**
 * `depthWrite: false`, re-exported at the layer that can act on it.
 *
 * `domain/particle-pool.ts` states the flag and its reason (particles that
 * write depth occlude each other in spawn order rather than depth order). It is
 * repeated here as a named constant rather than a literal for the same reason
 * every other constant in this repository is: the value a material is built
 * with should be traceable to the file that decided it.
 */
export const PARTICLE_DEPTH_WRITE = PARTICLE_WRITES_DEPTH

/* Two literal quantities that are genuinely just numbers, not vectors: three's
 * index buffer holds one value per entry (`itemSize` 1, unlike the 2- and
 * 3-component uv/position attributes above it), and a freshly built particle
 * system has drawn nothing yet. */
const INDEX_COMPONENTS = 1
const INITIAL_DRAWN_INSTANCES = 0

/** The live particle system, as its owner holds it. */
export type ParticleSystem<TShaderMaterial extends ThreeMaterial = ThreeMaterial> = {
  /**
   * Tell the GPU the pool's bytes changed, and how many slots are live.
   *
   * CALLED EVERY FRAME AFTER `advanceParticles`, and cheap by construction: no
   * allocation, no copy, three boolean writes and one integer.
   */
  readonly sync: Effect.Effect<void>
  /** How many instances the last `sync` asked the GPU to draw. */
  readonly drawnInstances: Effect.Effect<number>
  /** The mesh, for a host to add to its scene. */
  readonly mesh: ThreeMesh
  /** The shared material, for renderer-level policy checks. */
  readonly material: TShaderMaterial
  /** Release the geometry and the material. */
  readonly dispose: Effect.Effect<void>
}

/**
 * Build the instanced geometry, the material, and the mesh.
 *
 * `three` is the namespace, and it has to satisfy BOTH the instanced surface
 * and the shader one — the intersection in the signature is not a trick, it is
 * the honest statement that this path needs constructors from two of the three
 * seams `application/three-surface.ts` declares.
 *
 * THE INSTANCE ATTRIBUTES ARE BOUND BY ITERATING THE SHADER'S OWN RECORD, not
 * by three `setAttribute` calls with string literals. `PARTICLE_INSTANCE_ATTRIBUTES`
 * carries the name AND the stride for each, so a mismatch between what the
 * shader declares and what this binds is not expressible here — which is the
 * defect this repository found twice in `tileIndex` and `WATER_UNIFORM_NAMES`
 * and is deliberately not leaving a third instance of.
 */
/**
 * The slice of `three` each geometry helper below actually calls: the two
 * attribute constructors, named narrowly rather than through
 * `ThreeInstancedSurface`'s full generic signature.
 *
 * NOT GENERIC OVER `makeParticleSystem`'s type parameters, and deliberately
 * so: `BufferAttribute` and `InstancedBufferAttribute` both return the OPAQUE
 * `ThreeBufferAttribute`/`ThreeInstancedBufferAttribute` types regardless of
 * which concrete geometry or material `three` was instantiated with, so
 * reintroducing `TCanvas`/`TGeometry`/`TMaterial`/`TInstancedGeometry` here
 * would ask the compiler to unify two independent generic scopes that carry
 * no relationship — which is exactly what made `test/three-surface.test.ts`
 * fail the first time this was written with its own type parameter list.
 */
type ParticleAttributeConstructors = {
  readonly BufferAttribute: new (
    array: Float32Array | Uint8Array | Uint32Array,
    itemSize: number,
    normalized: boolean,
  ) => ThreeBufferAttribute
  readonly InstancedBufferAttribute: new (
    array: Float32Array,
    itemSize: number,
  ) => ThreeInstancedBufferAttribute
}

/**
 * The base quad's three attributes: four corners, shared by every instance.
 *
 * `Float32Array.from` rather than the readonly arrays directly — three uploads
 * a typed array and the domain declares plain numbers, which is the right way
 * round: the domain should not know what a GPU wants.
 */
const attachParticleQuadGeometry = (
  three: ParticleAttributeConstructors,
  geometry: ThreeInstancedBufferGeometry,
): void => {
  geometry.setAttribute(
    'position',
    new three.BufferAttribute(Float32Array.from(PARTICLE_QUAD_POSITIONS), POSITION_COMPONENTS, false),
  )
  geometry.setAttribute(
    'uv',
    new three.BufferAttribute(Float32Array.from(PARTICLE_QUAD_UVS), UV_COMPONENTS, false),
  )
  geometry.setIndex(
    new three.BufferAttribute(Uint32Array.from(PARTICLE_QUAD_INDICES), INDEX_COMPONENTS, false),
  )
}

/**
 * The per-instance attributes, over the POOL'S OWN ARRAYS. See the file header
 * on why the pool's arrays are bound directly rather than copied.
 */
const attachParticleInstanceAttributes = (
  three: ParticleAttributeConstructors,
  geometry: ThreeInstancedBufferGeometry,
  pool: ParticlePool,
): ReadonlyArray<ThreeInstancedBufferAttribute> => {
  const bindings: ReadonlyArray<{
    readonly spec: { readonly name: string; readonly stride: number }
    readonly array: Float32Array
  }> = [
    { array: pool.positions, spec: PARTICLE_INSTANCE_ATTRIBUTES.position },
    { array: pool.scales, spec: PARTICLE_INSTANCE_ATTRIBUTES.scale },
    { array: pool.uvOffsets, spec: PARTICLE_INSTANCE_ATTRIBUTES.uvOffset },
  ]
  return bindings.map(({ spec, array }) => {
    const attribute = new three.InstancedBufferAttribute(array, spec.stride)
    geometry.setAttribute(spec.name, attribute)
    return attribute
  })
}

export const makeParticleSystem = <
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
  TInstancedGeometry extends ThreeInstancedBufferGeometry,
  TShaderMaterial extends ThreeMaterial,
>(
  three: ThreeInstancedSurface<TCanvas, TGeometry, TMaterial, TInstancedGeometry> & {
    readonly ShaderMaterial: new (parameters: ThreeShaderMaterialParameters) => TShaderMaterial
    readonly Mesh: new (geometry: TInstancedGeometry, material: TShaderMaterial) => ThreeMesh
  },
  pool: ParticlePool,
  atlasTexture: unknown,
): Effect.Effect<ParticleSystem<TShaderMaterial>> =>
  Effect.gen(function* () {
    const geometry = new three.InstancedBufferGeometry()
    attachParticleQuadGeometry(three, geometry)
    const instanced = attachParticleInstanceAttributes(three, geometry, pool)

    const source = particleShaderSource()
    const uniforms: Record<string, ThreeUniform> = {
      [PARTICLE_SHADER_UNIFORMS.atlas]: { value: atlasTexture },
    }
    const material = new three.ShaderMaterial({
      alphaTest: PARTICLE_ALPHA_TEST,
      depthWrite: PARTICLE_DEPTH_WRITE,
      forceSinglePass: true,
      fragmentShader: source.fragmentShader,
      side: THREE_DOUBLE_SIDE,
      transparent: true,
      uniforms,
      vertexColors: true,
      vertexShader: source.vertexShader,
    })

    const mesh = new three.Mesh(geometry, material)
    const drawn = yield* Ref.make(INITIAL_DRAWN_INSTANCES)

    return {
      dispose: Effect.sync(() => {
        geometry.dispose()
        material.dispose()
      }),

      drawnInstances: Ref.get(drawn),

      material,

      mesh,

      sync: Effect.gen(function* () {
        for (const attribute of instanced) {
          attribute.needsUpdate = true
        }
        // The live prefix, not the capacity. A pool that reported its capacity
        // Here would draw 512 quads every frame and the dead ones would sit at
        // Whatever position they last held — which is the failure the pool's
        // `scales` zero already guards against, and this is the cheaper guard.
        const active = pool.activeCount()
        geometry.instanceCount = active
        yield* Ref.set(drawn, active)
      }),
    }
  })
