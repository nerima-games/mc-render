import type { PrecipitationKind, PrecipitationParticle } from '../domain/weather-rendering.js'
import type {
  ThreeBufferAttribute,
  ThreeBufferGeometry,
  ThreeMaterial,
  ThreeMesh,
  ThreeScene,
  ThreeSurface,
} from './three-surface.js'
import { Effect } from 'effect'
import type { LightningBoltPlan } from '../domain/lightning-bolt.js'
import type { WeatherPrecipitationResource } from './weather-renderer.js'

const VERTICES_PER_PARTICLE = 12
const POSITION_COMPONENTS = 3
const COLOR_COMPONENTS = 3
const LIGHTNING_SEGMENTS_PER_STRAND = 8
const LIGHTNING_STRAND_COUNT = 3
const LIGHTNING_RIBBON_COUNT = 2
const LIGHTNING_VERTICES_PER_RIBBON = 12
const LIGHTNING_VERTEX_COUNT =
  LIGHTNING_SEGMENTS_PER_STRAND * LIGHTNING_STRAND_COUNT * LIGHTNING_RIBBON_COUNT * LIGHTNING_VERTICES_PER_RIBBON

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
const LIGHTNING_HALF_WIDTH = 0.08
const ZERO_LENGTH = 0
const LIGHTNING_RED = 222
const LIGHTNING_GREEN = 244
const LIGHTNING_BLUE = 255
const MAX_LIGHTNING_FLASH = 1
const FIRST_COLOR_COMPONENT_OFFSET = 0
const SECOND_COLOR_COMPONENT_OFFSET = 1
const THIRD_COLOR_COMPONENT_OFFSET = 2
const FIRST_LIGHTNING_RIBBON = 0
const FALLBACK_DIRECTION_X = 1
const FALLBACK_DIRECTION_Y = 0
const FALLBACK_DIRECTION_Z = 0
const ONE_OVER_LENGTH_NUMERATOR = 1

type MutableAttribute = ThreeBufferAttribute & { needsUpdate?: boolean }

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
  const positionAttribute: MutableAttribute = new three.BufferAttribute(
    buffers.positions,
    POSITION_COMPONENTS,
    false,
  )
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute('color', new three.BufferAttribute(buffers.colors, COLOR_COMPONENTS, true))
  geometry.setDrawRange(DRAW_RANGE_START, EMPTY_DRAW_COUNT)
  return { geometry, positionAttribute }
}

type LightningBuffers = {
  readonly positions: Float32Array
  readonly colors: Uint8Array
}

const buildLightningBuffers = (): LightningBuffers => ({
  colors: new Uint8Array(LIGHTNING_VERTEX_COUNT * COLOR_COMPONENTS),
  positions: new Float32Array(LIGHTNING_VERTEX_COUNT * POSITION_COMPONENTS),
})

type LightningVector = Readonly<{ readonly x: number; readonly y: number; readonly z: number }>

type LightningSegmentOptions = {
  readonly positions: Float32Array
  readonly offset: number
  readonly start: LightningVector
  readonly end: LightningVector
  readonly ribbon: number
}

const add = (left: LightningVector, right: LightningVector): LightningVector => ({
  x: left.x + right.x,
  y: left.y + right.y,
  z: left.z + right.z,
})

const subtract = (left: LightningVector, right: LightningVector): LightningVector => ({
  x: left.x - right.x,
  y: left.y - right.y,
  z: left.z - right.z,
})

const scale = (vector: LightningVector, amount: number): LightningVector => ({
  x: vector.x * amount,
  y: vector.y * amount,
  z: vector.z * amount,
})

const cross = (left: LightningVector, right: LightningVector): LightningVector => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
})

const normalized = (vector: LightningVector): LightningVector => {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (length === ZERO_LENGTH) {
    return { x: FALLBACK_DIRECTION_X, y: FALLBACK_DIRECTION_Y, z: FALLBACK_DIRECTION_Z }
  }
  return scale(vector, ONE_OVER_LENGTH_NUMERATOR / length)
}

const lightningRibbonOffset = (start: LightningVector, end: LightningVector, ribbon: number): LightningVector => {
  const direction = subtract(end, start)
  const horizontalSide = normalized({ x: -direction.z, y: ZERO_LENGTH, z: direction.x })
  if (ribbon === FIRST_LIGHTNING_RIBBON) {
    return scale(horizontalSide, LIGHTNING_HALF_WIDTH)
  }
  return scale(normalized(cross(direction, horizontalSide)), LIGHTNING_HALF_WIDTH)
}

type TwoSidedRibbonOptions = Readonly<{
  readonly positions: Float32Array
  readonly offset: number
  readonly start: LightningVector
  readonly end: LightningVector
  readonly side: LightningVector
}>

const writeTwoSidedRibbon = ({ end, offset, positions, side, start }: TwoSidedRibbonOptions): number => {
  const positiveStart = add(start, side)
  const negativeStart = subtract(start, side)
  const positiveEnd = add(end, side)
  const negativeEnd = subtract(end, side)
  const front = [positiveStart, negativeStart, positiveEnd, positiveEnd, negativeStart, negativeEnd]
  const back = [positiveStart, positiveEnd, negativeStart, positiveEnd, negativeEnd, negativeStart]
  const afterFront = front.reduce((cursor, point) => vertex({
    offset: cursor,
    positions,
    x: point.x,
    y: point.y,
    z: point.z,
  }), offset)
  return back.reduce((cursor, point) => vertex({
    offset: cursor,
    positions,
    x: point.x,
    y: point.y,
    z: point.z,
  }), afterFront)
}

const writeLightningSegment = ({
  end,
  offset,
  positions,
  ribbon,
  start,
}: LightningSegmentOptions): number =>
  writeTwoSidedRibbon({
    end,
    offset,
    positions,
    side: lightningRibbonOffset(start, end, ribbon),
    start,
  })

const writeLightningBolt = (positions: Float32Array, bolt: LightningBoltPlan): number => {
  let offset = 0
  for (const strand of bolt.strands) {
    for (let segment = 0; segment < LIGHTNING_SEGMENTS_PER_STRAND; segment += INDEX_STEP) {
      const start = strand[segment]
      const end = strand[segment + INDEX_STEP]
      if (start !== undefined && end !== undefined) {
        for (let ribbon = 0; ribbon < LIGHTNING_RIBBON_COUNT; ribbon += INDEX_STEP) {
          offset = writeLightningSegment({ end, offset, positions, ribbon, start })
        }
      }
    }
  }
  return offset / POSITION_COMPONENTS
}

const fillLightningColor = (colors: Uint8Array, brightness: number): void => {
  const red = Math.round(LIGHTNING_RED * brightness)
  const green = Math.round(LIGHTNING_GREEN * brightness)
  const blue = Math.round(LIGHTNING_BLUE * brightness)
  for (let offset = 0; offset < colors.length; offset += COLOR_COMPONENTS) {
    colors[offset + FIRST_COLOR_COMPONENT_OFFSET] = red
    colors[offset + SECOND_COLOR_COMPONENT_OFFSET] = green
    colors[offset + THIRD_COLOR_COMPONENT_OFFSET] = blue
  }
}

type LightningFrameOptions<TGeometry extends ThreeBufferGeometry> = Readonly<{
  readonly bolt: LightningBoltPlan | undefined
  readonly buffers: LightningBuffers
  readonly colorAttribute: MutableAttribute
  readonly disposed: boolean
  readonly flash: number
  readonly geometry: TGeometry
  readonly mesh: ThreeMesh
  readonly positionAttribute: MutableAttribute
}>

const hideLightning = <TGeometry extends ThreeBufferGeometry>(geometry: TGeometry, mesh: ThreeMesh): void => {
  geometry.setDrawRange(DRAW_RANGE_START, EMPTY_DRAW_COUNT)
  mesh.visible = false
}

type LightningGeometryFrameOptions<TGeometry extends ThreeBufferGeometry> = Omit<
  LightningFrameOptions<TGeometry>,
  'disposed' | 'bolt'
> & { readonly bolt: LightningBoltPlan }

const writeLightningGeometryFrame = <TGeometry extends ThreeBufferGeometry>({
  bolt,
  buffers,
  colorAttribute,
  flash,
  geometry,
  mesh,
  positionAttribute,
}: LightningGeometryFrameOptions<TGeometry>): void => {
  const vertexCount = writeLightningBolt(buffers.positions, bolt)
  fillLightningColor(buffers.colors, Math.min(MAX_LIGHTNING_FLASH, Math.max(NO_PARTICLES, flash)))
  positionAttribute.needsUpdate = true
  colorAttribute.needsUpdate = true
  geometry.setDrawRange(DRAW_RANGE_START, vertexCount)
  mesh.visible = vertexCount > NO_PARTICLES
}

const updateLightningFrame = <TGeometry extends ThreeBufferGeometry>({
  bolt,
  buffers,
  colorAttribute,
  disposed,
  flash,
  geometry,
  mesh,
  positionAttribute,
}: LightningFrameOptions<TGeometry>): void => {
  if (disposed) {
    return
  }
  if (bolt === undefined || flash <= NO_PARTICLES) {
    hideLightning(geometry, mesh)
    return
  }
  writeLightningGeometryFrame({ bolt, buffers, colorAttribute, flash, geometry, mesh, positionAttribute })
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

type LightningGeometry<TGeometry extends ThreeBufferGeometry> = {
  readonly geometry: TGeometry
  readonly positionAttribute: MutableAttribute
  readonly colorAttribute: MutableAttribute
}

const buildLightningGeometry = <TCanvas, TGeometry extends ThreeBufferGeometry, TMaterial extends ThreeMaterial>(
  three: WeatherThreeSurface<TCanvas, TGeometry, TMaterial>,
  buffers: LightningBuffers,
): LightningGeometry<TGeometry> => {
  const geometry = new three.BufferGeometry()
  const positionAttribute: MutableAttribute = new three.BufferAttribute(buffers.positions, POSITION_COMPONENTS, false)
  const colorAttribute: MutableAttribute = new three.BufferAttribute(buffers.colors, COLOR_COMPONENTS, true)
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute('color', colorAttribute)
  geometry.setDrawRange(DRAW_RANGE_START, EMPTY_DRAW_COUNT)
  return { colorAttribute, geometry, positionAttribute }
}

type LightningMeshOptions<TCanvas, TGeometry extends ThreeBufferGeometry, TMaterial extends ThreeMaterial> = Readonly<{
  readonly geometry: TGeometry
  readonly material: TMaterial
  readonly scene: ThreeScene
  readonly three: WeatherThreeSurface<TCanvas, TGeometry, TMaterial>
}>

const attachLightningMesh = <TCanvas, TGeometry extends ThreeBufferGeometry, TMaterial extends ThreeMaterial>({
  geometry,
  material,
  scene,
  three,
}: LightningMeshOptions<TCanvas, TGeometry, TMaterial>): ThreeMesh => {
  const mesh = new three.Mesh(geometry, material)
  mesh.visible = false
  mesh.frustumCulled = false
  scene.add(mesh)
  return mesh
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
  const lightningBuffers = buildLightningBuffers()
  const lightning = buildLightningGeometry(three, lightningBuffers)
  const lightningMesh = attachLightningMesh({ geometry: lightning.geometry, material, scene, three })
  let disposed = false

  return {
    dispose: Effect.sync(() => {
      if (disposed) {return}
      disposed = true
      scene.remove(mesh)
      scene.remove(lightningMesh)
      geometry.dispose()
      lightning.geometry.dispose()
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
    updateLightning: (bolt, flash) =>
      Effect.sync(() => updateLightningFrame({
        bolt,
        buffers: lightningBuffers,
        colorAttribute: lightning.colorAttribute,
        disposed,
        flash,
        geometry: lightning.geometry,
        mesh: lightningMesh,
        positionAttribute: lightning.positionAttribute,
      })),
  }
}
