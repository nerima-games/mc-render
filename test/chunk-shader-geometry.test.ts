/**
 * THE SEAM BETWEEN THE SHADER AND THE GEOMETRY, which is the one place neither
 * file's own suite could look.
 *
 * This file exists because of a defect it now prevents, and the defect is worth
 * stating precisely because the shape recurs (docs' §6.3, "green suites that
 * execute code but ask nothing"):
 *
 *   `domain/chunk-shader.ts` declared `attribute float tileIndex` and resolved
 *   the atlas tile ENTIRELY from it. `domain/chunk-geometry.ts` emitted
 *   position, normal, colour and uv — four arrays, no tile. Both suites were
 *   green, because `chunk-shader.test.ts` asserts things about a string and
 *   `chunk-geometry.test.ts` asserts things about buffers, and nothing compared
 *   the two.
 *
 * WHAT IT WOULD HAVE COST is the reason this is not a pedantic check. An
 * unbound GL attribute is not an error: the driver feeds 0, so `vTileIndex` is
 * 0 at every vertex and the entire world samples atlas tile 0. That renders as
 * a real texture on every surface — the failure this project's notes record as
 * the worst kind, because it looks like a mistake in the atlas assignment
 * rather than a missing buffer, and the same notes already have one instance of
 * exactly that misreading.
 *
 * THE NAMES ARE READ, NOT RESTATED. Every assertion below derives the attribute
 * and uniform names from `chunkShaderSource()`, so a shader that grows a fifth
 * attribute fails here until the geometry supplies it. A hand-written list
 * would be a second copy of the shader's requirements and would drift — the
 * failure docs' §6.2 records six instances of.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { buildChunkGeometry, TILE_INDEX_COMPONENTS, VERTICES_PER_QUAD, type MeshQuad } from '../domain/chunk-geometry'
import { chunkShaderSource, CHUNK_SHADER_UNIFORMS } from '../domain/chunk-shader'
import { MISSING_TILE, quadTileForLookup, tileIndexForBlockName } from '../domain/block-texture-map'
import {
  FULL_SUN_INTENSITY,
  UNIFORM_ORIGIN,
  makeChunkShaderMaterial,
  makeWaterMaterial,
  makeWorldRenderer,
} from '../application/world-renderer'
import { FAKE_CANVAS, makeFakeThree } from './support/fake-three'

const VIEWPORT = { width: 1280, height: 720 }

const quad = (overrides: Partial<MeshQuad> = {}): MeshQuad => ({
  blockId: 1,
  direction: 'yPos',
  role: 'top',
  lx: 0,
  y: 0,
  lz: 0,
  width: 1,
  height: 1,
  ao: 0,
  ...overrides,
})

/**
 * three defines these four itself for any `BufferGeometry` that has them, so a
 * shader may reference them without declaring an `attribute`. They are exactly
 * the ones the geometry already supplied before `tileIndex` existed, which is
 * why the gap was invisible: every name the shader DECLARED was the one name
 * nobody produced.
 */
const THREE_BUILTIN_ATTRIBUTES = ['position', 'normal', 'uv', 'color']

describe('the geometry supplies every attribute the shader declares', () => {
  it.effect('every declared attribute name is bound by setChunk', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT)

      yield* renderer.setChunk('0,0', buildChunkGeometry([quad()]))

      const bound = new Set(three.geometries()[0]?.attributes.keys() ?? [])
      // Derived from the shader, not typed out. This is the assertion whose
      // absence let `tileIndex` be declared and never produced.
      for (const declared of chunkShaderSource().attributeNames) {
        expect(bound.has(declared)).toBe(true)
      }
    }),
  )

  it.effect('REGRESSION: the shader declares at least one attribute three does not provide', () =>
    Effect.sync(() => {
      // Guards the test above from becoming vacuous. If every declared name
      // were a three built-in, the loop would pass without the geometry
      // supplying anything — a green that asks nothing, which is the genre this
      // file was written to close rather than to join.
      const declared = chunkShaderSource().attributeNames
      expect(declared.length).toBeGreaterThan(0)
      expect(declared.some((name) => !THREE_BUILTIN_ATTRIBUTES.includes(name))).toBe(true)
    }),
  )

  it.effect('the tile buffer is one float per vertex, not per quad', () =>
    Effect.sync(() => {
      // The off-by-four that would compile, upload and draw: an attribute
      // sized per QUAD is a valid buffer of the wrong length, and GL reads past
      // it as 0 — so the first quarter of the world would texture correctly and
      // the rest would be tile 0. Sized here from the same constants the
      // builder uses.
      const buffers = buildChunkGeometry([quad(), quad({ lx: 1 }), quad({ lx: 2 })])

      expect(buffers.vertexCount).toBe(3 * VERTICES_PER_QUAD)
      expect(buffers.tileIndices).toHaveLength(buffers.vertexCount * TILE_INDEX_COMPONENTS)
    }),
  )
})

describe('the tile a quad draws', () => {
  it.effect('all four vertices of a quad carry the same tile', () =>
    Effect.sync(() => {
      // The fragment stage rounds the interpolated varying back with
      // `floor(vTileIndex + 0.5)`, which is only sound because the four corners
      // agree — interpolating between two different tiles would sample a third.
      const buffers = buildChunkGeometry([quad({ blockId: 7 })], 0, 0, undefined, () => 42)

      expect([...buffers.tileIndices]).toStrictEqual([42, 42, 42, 42])
    }),
  )

  it.effect('the role decides the tile, so a grass block is not uniform', () =>
    Effect.sync(() => {
      // THE FIELD MOST LIKELY TO BE DROPPED. A caller who resolves on `blockId`
      // alone gets a plausible world with flat grass, which is why
      // `quadTileFromResolver` names both fields in one place. grass_block is
      // the block that proves it: three roles, three different tiles.
      const grassTop = tileIndexForBlockName('grass_block', 'top')
      const grassSide = tileIndexForBlockName('grass_block', 'side')
      const grassBottom = tileIndexForBlockName('grass_block', 'bottom')

      expect(new Set([grassTop, grassSide, grassBottom]).size).toBe(3)

      const tile = quadTileForLookup(() => 'grass_block')
      const buffers = buildChunkGeometry(
        [quad({ role: 'top' }), quad({ role: 'side', lx: 1 })],
        0,
        0,
        undefined,
        tile,
      )

      expect(buffers.tileIndices[0]).toBe(grassTop)
      expect(buffers.tileIndices[VERTICES_PER_QUAD]).toBe(grassSide)
    }),
  )

  it.effect('the default is the untextured tile, and an unknown block is the missing one', () =>
    Effect.sync(() => {
      // Same number, two different claims — see `UNTEXTURED_TILE`'s header.
      // Asserted together so that a future change to either is forced to decide
      // whether it meant both.
      const untextured = buildChunkGeometry([quad()])
      expect([...untextured.tileIndices]).toStrictEqual([0, 0, 0, 0])

      const unknown = buildChunkGeometry([quad()], 0, 0, undefined, quadTileForLookup(() => 'no_such_block'))
      expect([...unknown.tileIndices]).toStrictEqual([MISSING_TILE, MISSING_TILE, MISSING_TILE, MISSING_TILE])
    }),
  )
})

describe('the shader material the renderer can be given', () => {
  it.effect('binds exactly the uniforms the shader declares, and no others', () =>
    Effect.sync(() => {
      const three = makeFakeThree()
      const atlas = { id: 'atlas-texture' }

      const { material, uniforms } = makeChunkShaderMaterial(three, atlas)

      // Both directions. A missing uniform is a link failure in the browser; an
      // extra one is a name nobody set that reads as 0 and shades the world
      // black. `uniformNames` is derived from the same record the source
      // interpolates, so neither can be satisfied by editing this test.
      expect(Object.keys(uniforms).sort()).toStrictEqual([...chunkShaderSource().uniformNames].sort())
      expect(uniforms[CHUNK_SHADER_UNIFORMS.atlas]?.value).toBe(atlas)
      expect(uniforms[CHUNK_SHADER_UNIFORMS.sunIntensity]?.value).toBe(FULL_SUN_INTENSITY)
      expect(material.vertexColors).toBe(true)
    }),
  )

  it.effect('the sun uniform is a box a host can turn without rebuilding the material', () =>
    Effect.sync(() => {
      // The property the boxes exist for. If this file ever copied the record
      // instead of sharing it, every chunk would keep the construction-time sun
      // and the day/night cycle would silently do nothing.
      const three = makeFakeThree()
      const { material, uniforms } = makeChunkShaderMaterial(three, { id: 'atlas' })

      const box = uniforms[CHUNK_SHADER_UNIFORMS.sunIntensity]
      if (box === undefined) {
        throw new Error('the sun uniform was not bound')
      }
      box.value = 0.3

      expect(material.uniforms[CHUNK_SHADER_UNIFORMS.sunIntensity]?.value).toBe(0.3)
    }),
  )

  it.effect('a supplied material factory replaces the basic material entirely', () =>
    Effect.gen(function* () {
      // "Replaces", not "in addition to": the renderer shares ONE material
      // across every chunk (a draw-call decision, see `makeWorldRenderer`), so a
      // host on the shader path must not also be paying for a basic one.
      const three = makeFakeThree()
      const { material } = makeChunkShaderMaterial(three, { id: 'atlas' })

      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        material: () => material,
      })
      yield* renderer.setChunk('0,0', buildChunkGeometry([quad()]))
      yield* renderer.setChunk('1,0', buildChunkGeometry([quad()]))

      expect(three.materials()).toHaveLength(0)
      expect(three.shaderMaterials()).toHaveLength(1)
      expect(three.meshes().map((mesh) => mesh.material)).toStrictEqual([material, material])
    }),
  )

  it.effect('REGRESSION: no vector uniform starts as null, because three reads .x off it', () =>
    Effect.sync(() => {
      // FOUND ON A REAL DRIVER, NOT HERE. `makeWaterMaterial` shipped with
      // `uCameraPosition: { value: null }` and every Node test passed — the
      // material built, the record had six keys, the GLSL declared six names.
      // three uploads a vec3 by reading `.x`, so the first render threw
      // `TypeError: Cannot read properties of null (reading 'x')`.
      //
      // This test cannot compile GLSL and does not try. What it CAN pin is the
      // shape: a uniform the shader declares as a vector must start as
      // something with numbers in it. `uRefractionMap` is exempt because a null
      // sampler is legal — three binds a default texture.
      const three = makeFakeThree()
      const { uniforms } = makeWaterMaterial(three, { width: 8, height: 8 })

      const vectorUniforms = ['uCameraPosition', 'uResolution']
      for (const name of vectorUniforms) {
        const value = uniforms[name]?.value
        expect(value).not.toBeNull()
        expect(Array.isArray(value)).toBe(true)
        expect((value as ReadonlyArray<number>).every((n) => Number.isFinite(n))).toBe(true)
      }

      expect(uniforms['uCameraPosition']?.value).toStrictEqual([...UNIFORM_ORIGIN])
    }),
  )

  it.effect('the renderer disposes the material it was given', () =>
    Effect.gen(function* () {
      // The lifetime `MaterialFactory`'s header claims. A thunk is taken rather
      // than an instance precisely so this is the renderer's job; if it were
      // not disposed, the seam would be leaking the one object it shares.
      const three = makeFakeThree()
      const { material } = makeChunkShaderMaterial(three, { id: 'atlas' })
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        material: () => material,
      })

      yield* renderer.dispose

      expect(material.disposed()).toBe(true)
    }),
  )
})
