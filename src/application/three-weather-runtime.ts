import { Effect } from 'effect'

import type {
  PrecipitationKind,
  PrecipitationParticle,
} from '../domain/weather-rendering'
import type { WeatherPrecipitationResource } from './weather-renderer'
import type {
  ThreeBufferAttribute,
  ThreeBufferGeometry,
  ThreeMaterial,
  ThreeMesh,
  ThreeScene,
  ThreeSurface,
} from './three-surface'

const VERTICES_PER_PARTICLE = 12
const POSITION_COMPONENTS = 3
const COLOR_COMPONENTS = 3

type MutableAttribute = ThreeBufferAttribute & { needsUpdate: boolean }

type WeatherThreeSurface<
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
> = Omit<
  ThreeSurface<TCanvas, TGeometry, TMaterial>,
  'Mesh'
> & {
  readonly Mesh: new (geometry: TGeometry, material: TMaterial) => ThreeMesh
}

const vertex = (
  positions: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
): number => {
  positions[offset] = x
  positions[offset + 1] = y
  positions[offset + 2] = z
  return offset + POSITION_COMPONENTS
}

const writeParticle = (
  positions: Float32Array,
  offset: number,
  particle: PrecipitationParticle,
  kind: PrecipitationKind,
): void => {
  const radius = kind === 'snow' ? 0.12 : 0.025
  const height = kind === 'snow' ? 0.18 : 0.9
  const { x, y, z } = particle
  let cursor = offset
  cursor = vertex(positions, cursor, x - radius, y, z - radius)
  cursor = vertex(positions, cursor, x + radius, y, z - radius)
  cursor = vertex(positions, cursor, x, y + height, z)
  cursor = vertex(positions, cursor, x + radius, y, z - radius)
  cursor = vertex(positions, cursor, x, y, z + radius)
  cursor = vertex(positions, cursor, x, y + height, z)
  cursor = vertex(positions, cursor, x, y, z + radius)
  cursor = vertex(positions, cursor, x - radius, y, z - radius)
  cursor = vertex(positions, cursor, x, y + height, z)
  cursor = vertex(positions, cursor, x - radius, y, z - radius)
  cursor = vertex(positions, cursor, x, y, z + radius)
  vertex(positions, cursor, x + radius, y, z - radius)
}

export const makeThreeWeatherPrecipitation = <
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
>(
  three: WeatherThreeSurface<TCanvas, TGeometry, TMaterial>,
  scene: ThreeScene,
  kind: PrecipitationKind,
  capacity: number,
): WeatherPrecipitationResource => {
  const particleCapacity = Math.max(0, Math.trunc(capacity))
  const positions = new Float32Array(
    particleCapacity * VERTICES_PER_PARTICLE * POSITION_COMPONENTS,
  )
  const colors = new Uint8Array(
    particleCapacity * VERTICES_PER_PARTICLE * COLOR_COMPONENTS,
  )
  const color = kind === 'snow' ? [245, 249, 255] : [155, 203, 234]
  for (let offset = 0; offset < colors.length; offset += COLOR_COMPONENTS) {
    colors.set(color, offset)
  }
  const geometry = new three.BufferGeometry()
  const positionAttribute = new three.BufferAttribute(
    positions,
    POSITION_COMPONENTS,
    false,
  ) as MutableAttribute
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute(
    'color',
    new three.BufferAttribute(colors, COLOR_COMPONENTS, true),
  )
  geometry.setDrawRange(0, 0)
  const material = new three.MeshBasicMaterial({
    vertexColors: true,
    wireframe: false,
  })
  const mesh = new three.Mesh(geometry, material)
  mesh.visible = false
  mesh.frustumCulled = false
  scene.add(mesh)
  let disposed = false

  return {
    update: (particles) =>
      Effect.sync(() => {
        if (disposed) return
        const count = Math.min(particleCapacity, particles.length)
        for (let index = 0; index < count; index += 1) {
          const particle = particles[index]
          if (particle !== undefined) {
            writeParticle(
              positions,
              index * VERTICES_PER_PARTICLE * POSITION_COMPONENTS,
              particle,
              kind,
            )
          }
        }
        positionAttribute.needsUpdate = true
        geometry.setDrawRange(0, count * VERTICES_PER_PARTICLE)
        mesh.visible = count > 0
      }),
    resize: () => Effect.void,
    dispose: Effect.sync(() => {
      if (disposed) return
      disposed = true
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
    }),
  }
}
