import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import { WebGLRenderList } from 'three/src/renderers/webgl/WebGLRenderLists.js'
import { BLOCK_IDS, blockTypeOfId, chunkKeyOf } from '@nerima-games/mc-kernel'
import { buildChunkGeometry } from '../src/domain/chunk-geometry'
import { makeWorldRenderer } from '../src/application/world-renderer'
import { chunkCoord } from './support/kernel-brands'
import { FAKE_CANVAS, makeFakeThree } from './support/fake-three'

const VIEWPORT = { width: 640, height: 360 }
const NO_GEOMETRY = buildChunkGeometry([])
const GLASS_BLOCK = BLOCK_IDS.find((id) => Result.getOrThrow(blockTypeOfId(id)) === 'glass')
if (GLASS_BLOCK === undefined) {
  throw new Error('glass block id is required by the transparent-chunk fixture')
}

const glassFace = (lx: number) => ({
  ao: 0,
  blockId: GLASS_BLOCK,
  direction: 'zPos' as const,
  height: 1,
  lx,
  lz: 0,
  role: 'side' as const,
  width: 1,
  y: 0,
})

const boundingSphereCenterX = (positions: Float32Array): number => {
  let minimum = Number.POSITIVE_INFINITY
  let maximum = Number.NEGATIVE_INFINITY
  for (let vertex = 0; vertex < positions.length / 3; vertex += 1) {
    const x = positions[vertex * 3] ?? 0
    minimum = Math.min(minimum, x)
    maximum = Math.max(maximum, x)
  }
  return (minimum + maximum) / 2
}

type TransparentRenderItem = { readonly object: { readonly id: number } }
type RuntimeWebGLRenderList = {
  readonly transparent: ReadonlyArray<TransparentRenderItem>
  init: () => void
  push: (
    object: { readonly id: number; readonly renderOrder: number },
    geometry: unknown,
    material: { readonly transmission: number; readonly transparent: boolean },
    groupOrder: number,
    z: number,
    group: unknown,
    camera: { readonly reversedDepth: boolean },
  ) => void
  sort: (opaqueSort: null, transparentSort: null) => void
}

const ThreeRenderList = WebGLRenderList as unknown as new () => RuntimeWebGLRenderList

describe('transparent chunks use Three back-to-front render-list ordering', () => {
  it.effect('orders neighboring transparent chunk meshes far-to-near from either side', () =>
    Effect.gen(function* () {
      const three = makeFakeThree()
      const transparentMaterial = Object.assign(new three.MeshBasicMaterial({
        vertexColors: true,
        wireframe: false,
      }), { transmission: 0, transparent: true })
      const renderer = yield* makeWorldRenderer(three, FAKE_CANVAS, VIEWPORT, {
        transparentMaterial: () => transparentMaterial,
      })
      yield* renderer.setChunks([
        {
          buffers: NO_GEOMETRY,
          key: chunkKeyOf(chunkCoord(0, 0)),
          transparentSolidBuffers: buildChunkGeometry([glassFace(15)]),
        },
        {
          buffers: NO_GEOMETRY,
          key: chunkKeyOf(chunkCoord(1, 0)),
          transparentSolidBuffers: buildChunkGeometry([glassFace(16)]),
        },
      ])

      const transparentMeshes = three.meshes()
      expect(transparentMeshes).toHaveLength(2)

      for (const cameraX of [-8, 32]) {
        const list = new ThreeRenderList()
        list.init()
        for (const [id, mesh] of transparentMeshes.entries()) {
          const positions = mesh.geometry.attributes.get('position')?.array as Float32Array
          // Three projects each mesh geometry's bounding-sphere center before sorting its render-list item.
          const depth = Math.abs(boundingSphereCenterX(positions) - cameraX)
          const object = { ...mesh, id }
          list.push(object, mesh.geometry, transparentMaterial, 0, depth, null, { reversedDepth: false })
        }
        list.sort(null, null)

        let expectedOrder = [0, 1]
        if (cameraX < 0) {
          expectedOrder = [1, 0]
        }
        expect(list.transparent.map(({ object }) => object.id)).toStrictEqual(expectedOrder)
      }

      yield* renderer.dispose
    }),
  )
})
