import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Vector4,
} from 'three'
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

type TransparentRenderItem = { readonly object: Mesh }
type RuntimeWebGLRenderList = {
  readonly transparent: ReadonlyArray<TransparentRenderItem>
  init: () => void
  push: (
    object: Mesh,
    geometry: BufferGeometry,
    material: MeshBasicMaterial,
    groupOrder: number,
    z: number,
    group: null,
    camera: PerspectiveCamera,
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
      const material = new MeshBasicMaterial({ transparent: true })
      const renderedMeshes = transparentMeshes.map((sourceMesh, index) => {
        const positions = sourceMesh.geometry.attributes.get('position')?.array
        if (!(positions instanceof Float32Array)) {
          throw new Error('transparent chunk geometry must contain float positions')
        }
        const geometry = new BufferGeometry()
        geometry.setAttribute('position', new BufferAttribute(positions, 3))
        geometry.computeBoundingSphere()
        const mesh = new Mesh(geometry, material)
        mesh.name = `chunk-${index}`
        mesh.updateMatrixWorld(true)
        return mesh
      })

      const views = [
        { position: { x: -8, y: 0, z: 0 }, expectedOrder: ['chunk-1', 'chunk-0'] },
        { position: { x: 32, y: 0, z: 0 }, expectedOrder: ['chunk-0', 'chunk-1'] },
      ]
      for (const { expectedOrder, position } of views) {
        const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 1000)
        camera.position.set(position.x, position.y, position.z)
        camera.lookAt(16, 0, 0)
        camera.updateMatrixWorld(true)
        const list = new ThreeRenderList()
        list.init()
        for (const mesh of renderedMeshes) {
          const center = mesh.geometry.boundingSphere?.center
          if (center === undefined) {
            throw new Error('transparent chunk geometry must have a bounding sphere')
          }
          // Match WebGLRenderer.projectObject: project each mesh's bounding-sphere center into clip space.
          const projectedCenter = new Vector4(center.x, center.y, center.z, 1)
            .applyMatrix4(mesh.matrixWorld)
            .applyMatrix4(camera.matrixWorldInverse)
            .applyMatrix4(camera.projectionMatrix)
          list.push(mesh, mesh.geometry, material, 0, projectedCenter.z, null, camera)
        }
        list.sort(null, null)

        expect(list.transparent.map(({ object }) => object.name)).toStrictEqual(expectedOrder)
      }

      renderedMeshes.forEach((mesh) => mesh.geometry.dispose())
      material.dispose()
      yield* renderer.dispose
    }),
  )
})
