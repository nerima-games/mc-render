/**
 * The instanced particle path, from the pool's typed arrays to the geometry.
 *
 * READ `test/support/fake-three.ts`'s HEADER FIRST. Nothing here is evidence
 * about a GPU; what it can carry is the call protocol and, more importantly,
 * the ALIASING — that the buffers bound to the geometry are the pool's own and
 * not copies of them, which is the property the whole no-allocation design
 * rests on and the one that a copy would silently destroy.
 *
 * The shader/adapter pairing is checked by reading BOTH sides, because this
 * repository found the same defect twice in the same week: `tileIndex`
 * declared with nothing producing it, and `WATER_UNIFORM_NAMES` declared with
 * no adapter binding it. Both times every suite was green. The assertions below
 * derive their names from `particleShaderSource()` rather than restating them.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeParticleSystem } from '../src/application/particle-system'
import {
  PARTICLE_INSTANCE_ATTRIBUTES,
  PARTICLE_QUAD_INDICES,
  PARTICLE_QUAD_POSITIONS,
  particleShaderSource,
} from '../src/domain/particle-shader'
import {
  PARTICLE_UV_STRIDE,
  PARTICLE_VECTOR_STRIDE,
  makeParticlePool,
  spawnBurst,
} from '../src/domain/particle-pool'
import { makeFakeThree, type FakeInstancedAttribute } from './support/fake-three'

const ATLAS = { id: 'atlas-texture' }

const instancedAttribute = (
  geometry: { readonly attributes: Map<string, unknown> },
  name: string,
): FakeInstancedAttribute => {
  const attribute = geometry.attributes.get(name)
  if (attribute === undefined) {
    throw new Error(`the geometry has no attribute named ${name}`)
  }
  return attribute as FakeInstancedAttribute
}

describe('the geometry binds every attribute the shader declares', () => {
  it.effect('each declared instance attribute is bound, at the declared stride', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const pool = makeParticlePool({ capacity: 8 })

      yield* makeParticleSystem(three, pool, ATLAS)

      const [geometry] = three.instancedGeometries()
      if (geometry === undefined) {
        throw new Error('no instanced geometry was built')
      }

      // Derived from the shader, not typed out. A name the shader declares and
      // nothing binds reads as 0 in GL and reports nothing.
      for (const name of particleShaderSource().attributeNames) {
        expect(geometry.attributes.has(name)).toBe(true)
      }
    }),
  )

  it.effect('REGRESSION: the strides are the pool’s, not all the same number', () =>
    Effect.gen(function* () {
      // The failure this guards is silent in every layer. Binding `uvOffsets`
      // at stride 3 does not throw and does not fail to link — it reads each
      // particle's V from the next particle's U, which renders as a diagonal
      // smear through the atlas and looks like a texture authoring problem.
      const three = makeFakeThree()
      const pool = makeParticlePool({ capacity: 8 })

      yield* makeParticleSystem(three, pool, ATLAS)
      const [geometry] = three.instancedGeometries()
      if (geometry === undefined) {
        throw new Error('no instanced geometry was built')
      }

      expect(
        instancedAttribute(geometry, PARTICLE_INSTANCE_ATTRIBUTES.position.name).itemSize,
      ).toBe(PARTICLE_VECTOR_STRIDE)
      expect(instancedAttribute(geometry, PARTICLE_INSTANCE_ATTRIBUTES.scale.name).itemSize).toBe(1)
      expect(
        instancedAttribute(geometry, PARTICLE_INSTANCE_ATTRIBUTES.uvOffset.name).itemSize,
      ).toBe(PARTICLE_UV_STRIDE)

      // And that they are not all equal, which is what makes the three
      // assertions above independent rather than one assertion written thrice.
      expect(new Set([PARTICLE_VECTOR_STRIDE, 1, PARTICLE_UV_STRIDE]).size).toBe(3)
    }),
  )
})

describe('the pool is aliased, not copied', () => {
  it.effect('the bound arrays ARE the pool’s arrays', () =>
    Effect.gen(function* () {
      // Identity, not contents. This is the property the whole design rests on:
      // `advanceParticles` integrating in place is already the update, so a
      // copy here would mean particles that never move on screen while every
      // CPU-side test still passes.
      const three = makeFakeThree()
      const pool = makeParticlePool({ capacity: 8 })

      yield* makeParticleSystem(three, pool, ATLAS)
      const [geometry] = three.instancedGeometries()
      if (geometry === undefined) {
        throw new Error('no instanced geometry was built')
      }

      expect(instancedAttribute(geometry, PARTICLE_INSTANCE_ATTRIBUTES.position.name).array).toBe(
        pool.positions,
      )
      expect(instancedAttribute(geometry, PARTICLE_INSTANCE_ATTRIBUTES.scale.name).array).toBe(
        pool.scales,
      )
      expect(instancedAttribute(geometry, PARTICLE_INSTANCE_ATTRIBUTES.uvOffset.name).array).toBe(
        pool.uvOffsets,
      )
    }),
  )

  it.effect('a spawn is visible through the bound attribute without re-binding', () =>
    Effect.gen(function* () {
      // The consequence of the aliasing, stated as behaviour rather than as
      // object identity — this is what a reader actually cares about.
      const three = makeFakeThree()
      const pool = makeParticlePool({ capacity: 8 })
      const system = yield* makeParticleSystem(three, pool, ATLAS)
      const [geometry] = three.instancedGeometries()
      if (geometry === undefined) {
        throw new Error('no instanced geometry was built')
      }
      const bound = instancedAttribute(geometry, PARTICLE_INSTANCE_ATTRIBUTES.position.name)

      spawnBurst(pool, 3, 64, -7, 0, 0, 1)
      yield* system.sync

      expect(pool.activeCount()).toBe(1)
      expect(bound.array.slice(0, PARTICLE_VECTOR_STRIDE)).toStrictEqual(
        Float32Array.from([3, 64, -7]),
      )
    }),
  )
})

describe('sync', () => {
  it.effect('draws the live prefix, not the capacity', () =>
    Effect.gen(function* () {
      // A system that reported capacity would draw 512 quads every frame, and
      // the dead ones would sit wherever they last were.
      const three = makeFakeThree()
      const pool = makeParticlePool({ capacity: 16 })
      const system = yield* makeParticleSystem(three, pool, ATLAS)
      const [geometry] = three.instancedGeometries()
      if (geometry === undefined) {
        throw new Error('no instanced geometry was built')
      }

      // Before any spawn: nothing live, so nothing drawn.
      yield* system.sync
      expect(geometry.instanceCount).toBe(0)

      spawnBurst(pool, 0, 0, 0, 0, 0, 3)
      yield* system.sync

      expect(geometry.instanceCount).toBe(3)
      expect(geometry.instanceCount).toBeLessThan(pool.capacity)
      expect(yield* system.drawnInstances).toBe(3)
    }),
  )

  it.effect('flags every instance attribute for re-upload', () =>
    Effect.gen(function* () {
      // Three has no way to notice that a Float32Array it already uploaded has
      // different bytes now. Missing one of the three would pin that quantity
      // at its first-frame value — particles that fade but never move, or move
      // but never fade.
      const three = makeFakeThree()
      const pool = makeParticlePool({ capacity: 8 })
      const system = yield* makeParticleSystem(three, pool, ATLAS)

      expect(three.instancedAttributes().map((a) => a.needsUpdate)).toStrictEqual([
        false,
        false,
        false,
      ])

      yield* system.sync

      expect(three.instancedAttributes().map((a) => a.needsUpdate)).toStrictEqual([true, true, true])
    }),
  )
})

describe('the base quad', () => {
  it.effect('is one centred unit quad shared by every instance', () =>
    Effect.gen(function* () {
      // Centred, so the corners read as directions and the billboard is a
      // scale-and-add. A corner-anchored quad offsets every particle half a
      // size up and right of where the pool says it is.
      const three = makeFakeThree()
      const pool = makeParticlePool({ capacity: 8 })

      yield* makeParticleSystem(three, pool, ATLAS)
      const [geometry] = three.instancedGeometries()
      if (geometry === undefined) {
        throw new Error('no instanced geometry was built')
      }

      const xs = PARTICLE_QUAD_POSITIONS.filter((_, at) => at % 3 === 0)
      const ys = PARTICLE_QUAD_POSITIONS.filter((_, at) => at % 3 === 1)

      expect(xs.reduce((sum, x) => sum + x, 0)).toBe(0)
      expect(ys.reduce((sum, y) => sum + y, 0)).toBe(0)
      expect(geometry.index()?.array).toStrictEqual(Uint32Array.from(PARTICLE_QUAD_INDICES))
    }),
  )

  it.effect('one material and one mesh, whatever the capacity', () =>
    Effect.gen(function* () {
      // The instancing claim, as a count. `domain/particle-pool.ts`'s header
      // states it: one geometry, one material, one draw call, N transforms.
      const three = makeFakeThree()
      const pool = makeParticlePool({ capacity: 512 })

      yield* makeParticleSystem(three, pool, ATLAS)

      expect(three.instancedGeometries()).toHaveLength(1)
      expect(three.shaderMaterials()).toHaveLength(1)
      expect(three.meshes()).toHaveLength(1)
    }),
  )
})

describe('dispose', () => {
  it.effect('releases the geometry and the material', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const pool = makeParticlePool({ capacity: 8 })
      const system = yield* makeParticleSystem(three, pool, ATLAS)

      yield* system.dispose

      expect(three.instancedGeometries()[0]?.disposed()).toBe(true)
      expect(three.shaderMaterials()[0]?.disposed()).toBe(true)
    }),
  )
})
