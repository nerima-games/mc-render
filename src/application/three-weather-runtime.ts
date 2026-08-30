import type {
  PrecipitationKind,
  PrecipitationParticle,
} from '../domain/weather-rendering.js'
import type {
  ThreeBufferAttribute,
  ThreeBufferGeometry,
  ThreeMaterial,
  ThreeMesh,
  ThreeScene,
  ThreeSurface,
} from './three-surface.js'
import { Effect } from 'effect'
import type { WeatherPrecipitationResource } from './weather-renderer.js'

const VERTICES_PER_PARTICLE = 12
const POSITION_COMPONENTS = 3
const COLOR_COMPONENTS = 3

/* A vertex's X component sits at its buffer offset, Y at offset+1, Z at offset+2. */
const POSITION_X_OFFSET = 0
const POSITION_Y_OFFSET = 1
const POSITION_Z_OFFSET = 2

/* Precipitation particle size, by kind: snow renders as a small flat flake,
 * rain as a thin falling streak. */
const SNOW_PARTICLE_RADIUS = 0.12
const RAIN_PARTICLE_RADIUS = 0.025
const SNOW_PARTICLE_HEIGHT = 0.18
const RAIN_PARTICLE_HEIGHT = 0.9

/* Precipitation particle color, by kind. RGB byte components (0-255): snow is
 * near-white, rain is a pale blue. */
const SNOW_COLOR_RED = 245
const SNOW_COLOR_GREEN = 249
const SNOW_COLOR_BLUE = 255
const RAIN_COLOR_RED = 155
const RAIN_COLOR_GREEN = 203
const RAIN_COLOR_BLUE = 234

/** A capacity may not go negative; zero is the smallest legal buffer. */
const MIN_PARTICLE_CAPACITY = 0
/** Every draw range this file sets starts at the buffer's first vertex. */
const DRAW_RANGE_START = 0
/** No particles are live yet (initial draw range length). */
const EMPTY_DRAW_COUNT = 0
/** The particle-count boundary below which nothing is visible. */
const NO_PARTICLES = 0
/** Advancing the particle-write cursor by one particle slot. */
const INDEX_STEP = 1

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

type VertexOptions = {
  readonly positions: Float32Array
  readonly offset: number
  readonly x: number
  readonly y: number
  readonly z: number
}

const vertex = (options: VertexOptions): number => {
  const { positions, offset, x, y, z } = options
  positions[offset + POSITION_X_OFFSET] = x
  positions[offset + POSITION_Y_OFFSET] = y
  positions[offset + POSITION_Z_OFFSET] = z
  return offset + POSITION_COMPONENTS
}

const particleRadiusFor = (kind: PrecipitationKind): number => {
  if (kind === 'snow') {
    return SNOW_PARTICLE_RADIUS
  }
  return RAIN_PARTICLE_RADIUS
}

const particleHeightFor = (kind: PrecipitationKind): number => {
  if (kind === 'snow') {
    return SNOW_PARTICLE_HEIGHT
  }
  return RAIN_PARTICLE_HEIGHT
}

const particleColorFor = (kind: PrecipitationKind): readonly [number, number, number] => {
  if (kind === 'snow') {
    return [SNOW_COLOR_RED, SNOW_COLOR_GREEN, SNOW_COLOR_BLUE]
  }
  return [RAIN_COLOR_RED, RAIN_COLOR_GREEN, RAIN_COLOR_BLUE]
}

type ParticleCorner = {
  readonly x: number
  readonly y: number
  readonly z: number
}

type ParticleCornersOptions = {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly radius: number
  readonly height: number
}

/**
 * The 12 vertices of one particle billboard: a 3-sided pyramid (a `radius`-wide
 * base at `y`, an apex at `y + height`), written as 4 triangular faces —
 * apex/base-edge for each of the 3 sides, then the base itself.
 */
const particleCorners = (options: ParticleCornersOptions): ReadonlyArray<ParticleCorner> => {
  const { x, y, z, radius, height } = options
  const cornerA = { x: x - radius, y, z: z - radius }
  const cornerB = { x: x + radius, y, z: z - radius }
  const cornerC = { x, y: y + height, z }
  const cornerD = { x, y, z: z + radius }
  return [cornerA, cornerB, cornerC, cornerB, cornerD, cornerC, cornerD, cornerA, cornerC, cornerA, cornerD, cornerB]
}

type WriteParticleOptions = {
  readonly positions: Float32Array
  readonly offset: number
  readonly particle: PrecipitationParticle
  readonly kind: PrecipitationKind
}

const writeParticle = (options: WriteParticleOptions): void => {
  const { positions, offset, particle, kind } = options
  const radius = particleRadiusFor(kind)
  const height = particleHeightFor(kind)
  const { x, y, z } = particle
  const corners = particleCorners({ height, radius, x, y, z })
  corners.reduce((cursor, corner) => vertex({ offset: cursor, positions, ...corner }), offset)
}

type ParticleBuffers = {
  readonly positions: Float32Array
  readonly colors: Uint8Array
}

const buildParticleBuffers = (particleCapacity: number, kind: PrecipitationKind): ParticleBuffers => {
  const positions = new Float32Array(particleCapacity * VERTICES_PER_PARTICLE * POSITION_COMPONENTS)
  const colors = new Uint8Array(particleCapacity * VERTICES_PER_PARTICLE * COLOR_COMPONENTS)
  const color = particleColorFor(kind)
  for (let offset = 0; offset < colors.length; offset += COLOR_COMPONENTS) {
    colors.set(color, offset)
  }
  return { colors, positions }
}

type ParticleGeometryOptions<TCanvas, TGeometry extends ThreeBufferGeometry, TMaterial extends ThreeMaterial> = {
  readonly three: WeatherThreeSurface<TCanvas, TGeometry, TMaterial>
  readonly buffers: ParticleBuffers
}

type ParticleGeometry<TGeometry extends ThreeBufferGeometry> = {
  readonly geometry: TGeometry
  readonly positionAttribute: MutableAttribute
}

const buildParticleGeometry = <TCanvas, TGeometry extends ThreeBufferGeometry, TMaterial extends ThreeMaterial>(
  options: ParticleGeometryOptions<TCanvas, TGeometry, TMaterial>,
): ParticleGeometry<TGeometry> => {
  const { three, buffers } = options
  const geometry = new three.BufferGeometry()
  const positionAttribute = new three.BufferAttribute(
    buffers.positions,
    POSITION_COMPONENTS,
    false,
  ) as MutableAttribute
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute('color', new three.BufferAttribute(buffers.colors, COLOR_COMPONENTS, true))
  geometry.setDrawRange(DRAW_RANGE_START, EMPTY_DRAW_COUNT)
  return { geometry, positionAttribute }
}

type ParticleMeshOptions<TCanvas, TGeometry extends ThreeBufferGeometry, TMaterial extends ThreeMaterial> = {
  readonly three: WeatherThreeSurface<TCanvas, TGeometry, TMaterial>
  readonly scene: ThreeScene
  readonly geometry: TGeometry
}

type ParticleMesh<TMaterial extends ThreeMaterial> = {
  readonly mesh: ThreeMesh
  readonly material: TMaterial
}

const attachParticleMesh = <TCanvas, TGeometry extends ThreeBufferGeometry, TMaterial extends ThreeMaterial>(
  options: ParticleMeshOptions<TCanvas, TGeometry, TMaterial>,
): ParticleMesh<TMaterial> => {
  const { three, scene, geometry } = options
  const material = new three.MeshBasicMaterial({
    vertexColors: true,
    wireframe: false,
  })
  const mesh = new three.Mesh(geometry, material)
  mesh.visible = false
  mesh.frustumCulled = false
  scene.add(mesh)
  return { material, mesh }
}

type ThreeWeatherPrecipitationOptions<
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
> = {
  readonly three: WeatherThreeSurface<TCanvas, TGeometry, TMaterial>
  readonly scene: ThreeScene
  readonly kind: PrecipitationKind
  readonly capacity: number
}

export const makeThreeWeatherPrecipitation = <
  TCanvas,
  TGeometry extends ThreeBufferGeometry,
  TMaterial extends ThreeMaterial,
>(
  options: ThreeWeatherPrecipitationOptions<TCanvas, TGeometry, TMaterial>,
): WeatherPrecipitationResource => {
  const { three, scene, kind, capacity } = options
  const particleCapacity = Math.max(MIN_PARTICLE_CAPACITY, Math.trunc(capacity))
  const buffers = buildParticleBuffers(particleCapacity, kind)
  const { geometry, positionAttribute } = buildParticleGeometry({ buffers, three })
  const { mesh, material } = attachParticleMesh({ geometry, scene, three })
  let disposed = false

  return {
    dispose: Effect.sync(() => {
      if (disposed) {return}
      disposed = true
      scene.remove(mesh)
      geometry.dispose()
      material.dispose()
    }),
    resize: () => Effect.void,
    update: (particles) =>
      Effect.sync(() => {
        if (disposed) {return}
        const count = Math.min(particleCapacity, particles.length)
        for (let index = 0; index < count; index += INDEX_STEP) {
          const particle = particles[index]
          if (particle !== undefined) {
            writeParticle({
              kind,
              offset: index * VERTICES_PER_PARTICLE * POSITION_COMPONENTS,
              particle,
              positions: buffers.positions,
            })
          }
        }
        positionAttribute.needsUpdate = true
        geometry.setDrawRange(DRAW_RANGE_START, count * VERTICES_PER_PARTICLE)
        mesh.visible = count > NO_PARTICLES
      }),
  }
}
