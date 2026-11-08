import {
  type PresentationBasicMaterial,
  type PresentationBufferGeometry,
  type PresentationMaterial,
  type PresentationObject3D,
  RENDER_PRESENTATION_SIDE,
  type RenderPresentationSurface,
  makePresentationColor,
  makePresentationItemSize,
  makePresentationOpacity,
  makePresentationPointSize,
  setPresentationOpacity,
} from './render-presentation-surface.js'
import type { RenderPresentationTexture, RenderPresentationTextures } from './render-presentation-assets.js'
import { Result, Schema } from 'effect'
import {
  SKY_STAR_DIRECTIONS,
  type SkyCloudLayerPlan,
  type SkyRenderInputError,
  SkyRenderInputErrorSchema,
  type SkyRenderPlan,
  planSkyFrame,
} from '../domain/sky-rendering.js'

export type SkyRendererError = Readonly<{
  _tag: 'SkyRendererError'
  reason: 'disposed'
}>

export type SkyRendererFailure = SkyRenderInputError | SkyRendererError

export type SkyRenderer = Readonly<{
  sceneObject: PresentationObject3D
  update: (frame: unknown) => Result.Result<void, SkyRendererFailure>
  dispose: () => void
}>

type SkyResultShape =
  | { readonly _tag: 'Success'; readonly _op: 'Success'; readonly success: undefined }
  | { readonly _tag: 'Failure'; readonly _op: 'Failure'; readonly failure: SkyRendererFailure }

export const SkyRendererErrorSchema: Schema.Codec<SkyRendererError> = Schema.Struct({
  _tag: Schema.Literal('SkyRendererError'),
  reason: Schema.Literal('disposed'),
})

export const SkyRendererResultSchema: Schema.Codec<SkyResultShape> = Schema.Union([
  Schema.Struct({ _op: Schema.Literal('Success'), _tag: Schema.Literal('Success'), success: Schema.Undefined }),
  Schema.Struct({
    _op: Schema.Literal('Failure'),
    _tag: Schema.Literal('Failure'),
    failure: Schema.Union([SkyRenderInputErrorSchema, SkyRendererErrorSchema]),
  }),
])

const SKY_RENDERER_DISPOSED_ERROR: SkyRendererError = {
  _tag: 'SkyRendererError',
  reason: 'disposed',
}

const ZERO = 0
const ONE = 1
const TWO = 2
const HALF = 0.5
const POSITION_COMPONENT_COUNT = 3
const DOME_RADIUS = 250
const DOME_AZIMUTH_SEGMENTS = 48
const DOME_LATITUDE_SEGMENTS = 12
const DOME_LATITUDE_START = ZERO
const DOME_LATITUDE_END = Math.PI / TWO
const HORIZON_LATITUDE_START = -0.12
const HORIZON_LATITUDE_END = 0.12
const HORIZON_LATITUDE_SEGMENTS = TWO
const SUN_RADIUS = 8
const MOON_RADIUS = 5
const MOON_SHADOW_DEPTH = 0.08
const SHADOW_OPACITY = 0.94
const DISK_SEGMENTS = 48
const STAR_POINT_SIZE = 0.78
const STAR_TWINKLE_BASE = 0.82
const STAR_TWINKLE_VARIATION = 0.18
const SUN_LAYER_ORDER = ONE
const MOON_LAYER_ORDER = ONE
const STAR_LAYER_ORDER = ONE
const CLOUD_LAYER_ORDER = TWO
const SKY_DOME_ORDER = -100
const HORIZON_ORDER = -99
const CLOUD_TILE_ROWS = 3
const CLOUD_TILE_COLUMNS = 3
const CLOUD_TILE_CENTER = ONE
const CLOUD_TILE_DISTANCE = 240
const CLOUD_PUFF_ROWS = 3
const CLOUD_PUFF_COLUMNS = 3
const CLOUD_PUFF_CENTER = ONE
const CLOUD_PUFF_SPACING_X = 15
const CLOUD_PUFF_SPACING_Z = 13
const CLOUD_PUFF_HALF_WIDTH_BASE = 8
const CLOUD_PUFF_HALF_WIDTH_STEP = TWO
const CLOUD_PUFF_HALF_DEPTH_BASE = 4
const CLOUD_PUFF_HALF_DEPTH_STEP = 1.5
const CLOUD_PUFF_VARIANTS = 3
const CLOUD_PUFFS_PER_TILE = CLOUD_PUFF_ROWS * CLOUD_PUFF_COLUMNS
const CLOUD_PUFF_COUNT = CLOUD_TILE_ROWS * CLOUD_TILE_COLUMNS * CLOUD_PUFFS_PER_TILE
const SUN_COLOR = 0xfff2ce
const MOON_COLOR = 0xe3e8ff
const CLOUD_BASE_COLOR = 0xe7f1f6
const CLOUD_FAR_COLOR = 0xd4e4ec
const SHADOW_COLOR = 0x172033
const STAR_COLOR = 0xe5ecff
const DOME_COLOR = 0x6fb6e7
const HORIZON_COLOR = 0xb9e3f4

type Surface<
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
> = RenderPresentationSurface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>

const setRenderOrder = (object: PresentationObject3D, order: number): void => {
  Object.assign(object, { renderOrder: order })
}

type SurfacePosition = readonly [number, number, number]
type TrianglePoints = readonly [SurfacePosition, SurfacePosition, SurfacePosition]
type QuadPoints = readonly [SurfacePosition, SurfacePosition, SurfacePosition, SurfacePosition]

type SkyBasicMaterials<TBasicMaterial extends PresentationMaterial> = readonly [
  TBasicMaterial,
  TBasicMaterial,
  TBasicMaterial,
  TBasicMaterial,
  TBasicMaterial,
  TBasicMaterial,
  TBasicMaterial,
]

type SkyMaterials<
  TBasicMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
> = Readonly<{
  basic: SkyBasicMaterials<TBasicMaterial>
  dome: TBasicMaterial
  horizon: TBasicMaterial
  sun: TBasicMaterial
  moon: TBasicMaterial
  moonShadow: TBasicMaterial
  nearCloud: TBasicMaterial
  farCloud: TBasicMaterial
  stars: TPointsMaterial
}>

type SkyCloudObjects = Readonly<{
  group: PresentationObject3D
  mesh: PresentationObject3D
}>

type SkyObjects = Readonly<{
  backdrop: Readonly<{ dome: PresentationObject3D; horizon: PresentationObject3D }>
  celestial: Readonly<{
    sunGroup: PresentationObject3D
    sunMesh: PresentationObject3D
    moonGroup: PresentationObject3D
    moonMesh: PresentationObject3D
    moonShadowMesh: PresentationObject3D
  }>
  stars: PresentationObject3D
  clouds: readonly [SkyCloudObjects, SkyCloudObjects]
}>

type SkyResources<
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
> = Readonly<{
  sceneObject: PresentationObject3D
  geometries: ReadonlyArray<TGeometry>
  materials: SkyMaterials<TBasicMaterial, TPointsMaterial>
  objects: SkyObjects
}>

const pushVertex = (vertices: Array<number>, [x, y, z]: SurfacePosition): void => {
  vertices.push(x, y, z)
}

const pushTriangle = (vertices: Array<number>, [first, second, third]: TrianglePoints): void => {
  for (const point of [first, second, third]) {
    pushVertex(vertices, point)
  }
}

const pushQuad = (vertices: Array<number>, [first, second, third, fourth]: QuadPoints): void => {
  pushTriangle(vertices, [first, second, third])
  pushTriangle(vertices, [first, third, fourth])
}

const geometryFromVertices = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  vertices: ReadonlyArray<number>,
  geometries: Array<TGeometry>,
): TGeometry => {
  const geometry = new surface.BufferGeometry()
  geometry.setAttribute(
    'position',
    new surface.BufferAttribute(new Float32Array(vertices), makePresentationItemSize(POSITION_COMPONENT_COUNT)),
  )
  geometry.computeBoundingSphere()
  geometries.push(geometry)
  return geometry
}

const diskVertices = (radius: number): ReadonlyArray<number> => {
  const vertices: Array<number> = []
  const segmentAngle = (Math.PI * TWO) / DISK_SEGMENTS
  for (let segment = ZERO; segment < DISK_SEGMENTS; segment += ONE) {
    const firstAngle = segment * segmentAngle
    const secondAngle = (segment + ONE) * segmentAngle
    pushTriangle(vertices, [
      [ZERO, ZERO, ZERO],
      [Math.cos(firstAngle) * radius, Math.sin(firstAngle) * radius, ZERO],
      [Math.cos(secondAngle) * radius, Math.sin(secondAngle) * radius, ZERO],
    ])
  }
  return vertices
}

const diskUvVertices = (): ReadonlyArray<number> => {
  const vertices: Array<number> = []
  const segmentAngle = (Math.PI * TWO) / DISK_SEGMENTS
  for (let segment = ZERO; segment < DISK_SEGMENTS; segment += ONE) {
    const firstAngle = segment * segmentAngle
    const secondAngle = (segment + ONE) * segmentAngle
    vertices.push(
      HALF,
      HALF,
      HALF + Math.cos(firstAngle) / TWO,
      HALF + Math.sin(firstAngle) / TWO,
      HALF + Math.cos(secondAngle) / TWO,
      HALF + Math.sin(secondAngle) / TWO,
    )
  }
  return vertices
}

const diskGeometry = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  radius: number,
  geometries: Array<TGeometry>,
): TGeometry => {
  const geometry = geometryFromVertices(surface, diskVertices(radius), geometries)
  geometry.setAttribute('uv', new surface.BufferAttribute(new Float32Array(diskUvVertices()), makePresentationItemSize(TWO)))
  return geometry
}

const domePoint = (azimuth: number, latitude: number, radius: number): SurfacePosition => {
  const horizontal = Math.cos(latitude) * radius
  return [Math.cos(azimuth) * horizontal, Math.sin(latitude) * radius, Math.sin(azimuth) * horizontal]
}

type DomeShape = Readonly<{
  latitudeEnd: number
  latitudeSegments: number
  latitudeStart: number
  radius: number
}>

const domeLatitudeBand = (shape: DomeShape, index: number): readonly [number, number] => {
  const step = (shape.latitudeEnd - shape.latitudeStart) / shape.latitudeSegments
  const lower = shape.latitudeStart + index * step
  return [lower, lower + step]
}

const domeAzimuthBand = (index: number): readonly [number, number] => {
  const step = (Math.PI * TWO) / DOME_AZIMUTH_SEGMENTS
  const first = index * step
  return [first, first + step]
}

const domeCellVertices = (shape: DomeShape, latitudeIndex: number, azimuthIndex: number): ReadonlyArray<number> => {
  const [lowerLatitude, upperLatitude] = domeLatitudeBand(shape, latitudeIndex)
  const [firstAzimuth, secondAzimuth] = domeAzimuthBand(azimuthIndex)
  const lowerLeft = domePoint(firstAzimuth, lowerLatitude, shape.radius)
  const upperLeft = domePoint(firstAzimuth, upperLatitude, shape.radius)
  const upperRight = domePoint(secondAzimuth, upperLatitude, shape.radius)
  const lowerRight = domePoint(secondAzimuth, lowerLatitude, shape.radius)
  return [...lowerLeft, ...upperLeft, ...upperRight, ...lowerLeft, ...upperRight, ...lowerRight]
}

const domeVertices = (shape: DomeShape): ReadonlyArray<number> =>
  Array.from({ length: shape.latitudeSegments * DOME_AZIMUTH_SEGMENTS }, (_unused, index) =>
    domeCellVertices(
      shape,
      Math.floor(index / DOME_AZIMUTH_SEGMENTS),
      index % DOME_AZIMUTH_SEGMENTS,
    ),
  ).flat()

type CloudPuffIndex = Readonly<{
  tileRow: number
  tileColumn: number
  puffRow: number
  puffColumn: number
}>

const cloudPuffVertices = ({ tileRow, tileColumn, puffRow, puffColumn }: CloudPuffIndex): ReadonlyArray<number> => {
  const puffIndex = puffRow * CLOUD_PUFF_COLUMNS + puffColumn
  const centerX = (tileColumn - CLOUD_TILE_CENTER) * CLOUD_TILE_DISTANCE + (puffColumn - CLOUD_PUFF_CENTER) * CLOUD_PUFF_SPACING_X
  const centerZ = (tileRow - CLOUD_TILE_CENTER) * CLOUD_TILE_DISTANCE + (puffRow - CLOUD_PUFF_CENTER) * CLOUD_PUFF_SPACING_Z
  const halfWidth = CLOUD_PUFF_HALF_WIDTH_BASE + (puffIndex % CLOUD_PUFF_VARIANTS) * CLOUD_PUFF_HALF_WIDTH_STEP
  const halfDepth = CLOUD_PUFF_HALF_DEPTH_BASE + (puffIndex % CLOUD_PUFF_VARIANTS) * CLOUD_PUFF_HALF_DEPTH_STEP
  const vertices: Array<number> = []
  pushQuad(vertices, [
    [centerX - halfWidth, ZERO, centerZ - halfDepth],
    [centerX + halfWidth, ZERO, centerZ - halfDepth],
    [centerX + halfWidth, ZERO, centerZ + halfDepth],
    [centerX - halfWidth, ZERO, centerZ + halfDepth],
  ])
  return vertices
}

const cloudPuffIndexFor = (index: number): CloudPuffIndex => {
  const tileIndex = Math.floor(index / CLOUD_PUFFS_PER_TILE)
  const puffIndex = index % CLOUD_PUFFS_PER_TILE
  return {
    puffColumn: puffIndex % CLOUD_PUFF_COLUMNS,
    puffRow: Math.floor(puffIndex / CLOUD_PUFF_COLUMNS),
    tileColumn: tileIndex % CLOUD_TILE_COLUMNS,
    tileRow: Math.floor(tileIndex / CLOUD_TILE_COLUMNS),
  }
}

const cloudVertices = (): ReadonlyArray<number> =>
  Array.from({ length: CLOUD_PUFF_COUNT }, (_unused, index) => cloudPuffVertices(cloudPuffIndexFor(index))).flat()

const addBasicMesh = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  geometry: TGeometry,
  material: TBasicMaterial,
): PresentationObject3D => new surface.Mesh(geometry, material)

const createSkyMaterials = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  textures: RenderPresentationTextures<TTexture>,
): SkyMaterials<TBasicMaterial, TPointsMaterial> => {
  const dome = new surface.MeshBasicMaterial({ color: makePresentationColor(DOME_COLOR), depthTest: false, depthWrite: false, side: RENDER_PRESENTATION_SIDE.double })
  const horizon = new surface.MeshBasicMaterial({ color: makePresentationColor(HORIZON_COLOR), depthTest: false, depthWrite: false, side: RENDER_PRESENTATION_SIDE.double })
  const sun = new surface.MeshBasicMaterial({ color: makePresentationColor(SUN_COLOR), depthTest: true, depthWrite: false, map: textures.sun ?? null, side: RENDER_PRESENTATION_SIDE.double, transparent: true })
  const moon = new surface.MeshBasicMaterial({ color: makePresentationColor(MOON_COLOR), depthTest: true, depthWrite: false, map: textures.moon ?? null, side: RENDER_PRESENTATION_SIDE.double, transparent: true })
  const moonShadow = new surface.MeshBasicMaterial({ color: makePresentationColor(SHADOW_COLOR), depthTest: false, depthWrite: false, opacity: makePresentationOpacity(SHADOW_OPACITY), side: RENDER_PRESENTATION_SIDE.double, transparent: true })
  const nearCloud = new surface.MeshBasicMaterial({ color: makePresentationColor(CLOUD_BASE_COLOR), depthTest: true, depthWrite: false, opacity: makePresentationOpacity(ZERO), side: RENDER_PRESENTATION_SIDE.double, transparent: true })
  const farCloud = new surface.MeshBasicMaterial({ color: makePresentationColor(CLOUD_FAR_COLOR), depthTest: true, depthWrite: false, opacity: makePresentationOpacity(ZERO), side: RENDER_PRESENTATION_SIDE.double, transparent: true })
  return {
    basic: [dome, horizon, sun, moon, moonShadow, nearCloud, farCloud],
    dome,
    farCloud,
    horizon,
    moon,
    moonShadow,
    nearCloud,
    stars: new surface.PointsMaterial({
      color: makePresentationColor(STAR_COLOR),
      depthTest: false,
      depthWrite: false,
      opacity: makePresentationOpacity(ZERO),
      size: makePresentationPointSize(STAR_POINT_SIZE),
      transparent: true,
    }),
    sun,
  }
}

const createBackdrop = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  geometries: Array<TGeometry>,
  materials: SkyMaterials<TBasicMaterial, TPointsMaterial>,
): SkyObjects['backdrop'] => ({
  dome: addBasicMesh(
    surface,
    geometryFromVertices(surface, domeVertices({
      latitudeEnd: DOME_LATITUDE_END,
      latitudeSegments: DOME_LATITUDE_SEGMENTS,
      latitudeStart: DOME_LATITUDE_START,
      radius: DOME_RADIUS,
    }), geometries),
    materials.dome,
  ),
  horizon: addBasicMesh(
    surface,
    geometryFromVertices(surface, domeVertices({
      latitudeEnd: HORIZON_LATITUDE_END,
      latitudeSegments: HORIZON_LATITUDE_SEGMENTS,
      latitudeStart: HORIZON_LATITUDE_START,
      radius: DOME_RADIUS,
    }), geometries),
    materials.horizon,
  ),
})

const createCelestialObjects = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  geometries: Array<TGeometry>,
  materials: SkyMaterials<TBasicMaterial, TPointsMaterial>,
): SkyObjects['celestial'] => {
  const sunGroup = new surface.Group()
  const sunMesh = addBasicMesh(surface, diskGeometry(surface, SUN_RADIUS, geometries), materials.sun)
  const moonGroup = new surface.Group()
  const moonMesh = addBasicMesh(surface, diskGeometry(surface, MOON_RADIUS, geometries), materials.moon)
  const moonShadowMesh = addBasicMesh(surface, diskGeometry(surface, MOON_RADIUS, geometries), materials.moonShadow)
  sunGroup.add(sunMesh)
  moonGroup.add(moonMesh, moonShadowMesh)
  return { moonGroup, moonMesh, moonShadowMesh, sunGroup, sunMesh }
}

const createCloudObjects = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  geometries: Array<TGeometry>,
  material: TBasicMaterial,
): SkyCloudObjects => {
  const group = new surface.Group()
  const mesh = addBasicMesh(surface, geometryFromVertices(surface, cloudVertices(), geometries), material)
  group.add(mesh)
  return { group, mesh }
}

const createSkyObjects = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  geometries: Array<TGeometry>,
  materials: SkyMaterials<TBasicMaterial, TPointsMaterial>,
): SkyObjects => ({
  backdrop: createBackdrop(surface, geometries, materials),
  celestial: createCelestialObjects(surface, geometries, materials),
  clouds: [
    createCloudObjects(surface, geometries, materials.nearCloud),
    createCloudObjects(surface, geometries, materials.farCloud),
  ],
  stars: new surface.Points(
    geometryFromVertices(
      surface,
      SKY_STAR_DIRECTIONS.flatMap(({ x, y, z }) => [x, y, z]),
      geometries,
    ),
    materials.stars,
  ),
})

const setSceneRenderOrders = (objects: SkyObjects): void => {
  const [nearCloud, farCloud] = objects.clouds
  setRenderOrder(objects.backdrop.dome, SKY_DOME_ORDER)
  setRenderOrder(objects.backdrop.horizon, HORIZON_ORDER)
  setRenderOrder(objects.celestial.sunGroup, SUN_LAYER_ORDER)
  setRenderOrder(objects.celestial.moonGroup, MOON_LAYER_ORDER)
  setRenderOrder(objects.stars, STAR_LAYER_ORDER)
  setRenderOrder(nearCloud.group, CLOUD_LAYER_ORDER)
  setRenderOrder(farCloud.group, CLOUD_LAYER_ORDER)
}

const createSceneObject = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  objects: SkyObjects,
): PresentationObject3D => {
  const sceneObject = new surface.Group()
  const [nearCloud, farCloud] = objects.clouds
  setSceneRenderOrders(objects)
  sceneObject.add(
    objects.backdrop.dome,
    objects.backdrop.horizon,
    objects.celestial.sunGroup,
    objects.celestial.moonGroup,
    objects.stars,
    nearCloud.group,
    farCloud.group,
  )
  return sceneObject
}

const createSkyResources = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  textures: RenderPresentationTextures<TTexture>,
): SkyResources<TGeometry, TBasicMaterial, TPointsMaterial> => {
  const geometries: Array<TGeometry> = []
  const materials = createSkyMaterials(surface, textures)
  const objects = createSkyObjects(surface, geometries, materials)
  return {
    geometries,
    materials,
    objects,
    sceneObject: createSceneObject(surface, objects),
  }
}

const setBillboardRotation = (object: PresentationObject3D, pitchRadians: number, yawRadians: number): void => {
  object.rotation.set(pitchRadians, yawRadians, ZERO, 'YXZ')
}

const applySunPlan = (materials: SkyResources<PresentationBufferGeometry, PresentationMaterial, PresentationMaterial>['materials'], objects: SkyObjects, plan: SkyRenderPlan): void => {
  materials.sun.color.set(makePresentationColor(plan.sun.color))
  setPresentationOpacity(materials.sun, makePresentationOpacity(plan.sun.opacity))
  objects.celestial.sunGroup.visible = plan.sun.visible
  objects.celestial.sunGroup.position.set(plan.sun.position.x, plan.sun.position.y, plan.sun.position.z)
  setBillboardRotation(objects.celestial.sunGroup, plan.cameraPitchRadians, plan.cameraYawRadians)
}

const applyMoonPlan = (materials: SkyResources<PresentationBufferGeometry, PresentationMaterial, PresentationMaterial>['materials'], objects: SkyObjects, plan: SkyRenderPlan): void => {
  materials.moon.color.set(makePresentationColor(plan.moon.color))
  setPresentationOpacity(materials.moon, makePresentationOpacity(plan.moon.opacity))
  objects.celestial.moonGroup.visible = plan.moon.visible
  objects.celestial.moonGroup.position.set(plan.moon.position.x, plan.moon.position.y, plan.moon.position.z)
  setBillboardRotation(objects.celestial.moonGroup, plan.cameraPitchRadians, plan.cameraYawRadians)
  objects.celestial.moonShadowMesh.position.set(plan.moon.shadowOffsetX * MOON_RADIUS, ZERO, MOON_SHADOW_DEPTH)
}

type CloudLayerUpdate = Readonly<{
  material: PresentationMaterial
  objects: SkyCloudObjects
  plan: SkyCloudLayerPlan
  anchorY: number
  visible: boolean
}>

const applyCloudLayer = ({ material, objects, plan, anchorY, visible }: CloudLayerUpdate): void => {
  objects.group.visible = visible
  setPresentationOpacity(material, makePresentationOpacity(plan.opacity))
  objects.group.position.set(plan.offsetX, plan.worldY - anchorY, plan.offsetZ)
}

const applyCloudPlans = (resources: SkyResources<PresentationBufferGeometry, PresentationMaterial, PresentationMaterial>, plan: SkyRenderPlan): void => {
  const [nearPlan, farPlan] = plan.clouds
  const [nearObjects, farObjects] = resources.objects.clouds
  const visible = plan.dimension === 'overworld'
  applyCloudLayer({
    anchorY: plan.anchor.y,
    material: resources.materials.nearCloud,
    objects: nearObjects,
    plan: nearPlan,
    visible,
  })
  applyCloudLayer({
    anchorY: plan.anchor.y,
    material: resources.materials.farCloud,
    objects: farObjects,
    plan: farPlan,
    visible,
  })
}

const applySkyPlan = (resources: SkyResources<PresentationBufferGeometry, PresentationMaterial, PresentationMaterial>, plan: SkyRenderPlan): void => {
  resources.sceneObject.position.set(plan.anchor.x, plan.anchor.y, plan.anchor.z)
  resources.materials.dome.color.set(makePresentationColor(plan.skyColor))
  resources.materials.horizon.color.set(makePresentationColor(plan.horizonColor))
  setPresentationOpacity(resources.materials.stars, makePresentationOpacity(plan.stars.opacity * (STAR_TWINKLE_BASE + plan.stars.twinkle * STAR_TWINKLE_VARIATION)))
  resources.objects.stars.visible = plan.stars.opacity > ZERO
  applySunPlan(resources.materials, resources.objects, plan)
  applyMoonPlan(resources.materials, resources.objects, plan)
  applyCloudPlans(resources, plan)
}

const detachSkyObjects = (resources: SkyResources<PresentationBufferGeometry, PresentationMaterial, PresentationMaterial>): void => {
  const { backdrop, celestial, clouds, stars } = resources.objects
  const [nearCloud, farCloud] = clouds
  resources.sceneObject.remove(backdrop.dome, backdrop.horizon, celestial.sunGroup, celestial.moonGroup, stars, nearCloud.group, farCloud.group)
  celestial.sunGroup.remove(celestial.sunMesh)
  celestial.moonGroup.remove(celestial.moonMesh, celestial.moonShadowMesh)
  nearCloud.group.remove(nearCloud.mesh)
  farCloud.group.remove(farCloud.mesh)
}

const disposeSkyResources = (resources: SkyResources<PresentationBufferGeometry, PresentationMaterial, PresentationMaterial>): void => {
  detachSkyObjects(resources)
  resources.geometries.forEach((geometry) => geometry.dispose())
  resources.materials.basic.forEach((material) => material.dispose())
  resources.materials.stars.dispose()
}

/** Create camera-anchored sky objects using the host's injected Three.js surface. */
export const createSkyRenderer = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends PresentationBufferGeometry,
  TBasicMaterial extends PresentationBasicMaterial<TTexture>,
  TLineMaterial extends PresentationMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  textures: RenderPresentationTextures<TTexture> = {},
): SkyRenderer => {
  const resources = createSkyResources(surface, textures)
  let disposed = false
  const update = (frame: unknown): Result.Result<void, SkyRendererFailure> => {
    if (disposed) {
      return Result.fail(SKY_RENDERER_DISPOSED_ERROR)
    }
    const planned = planSkyFrame(frame)
    if (Result.isFailure(planned)) {
      return Result.fail(planned.failure)
    }
    applySkyPlan(resources, planned.success)
    return Result.succeed(undefined)
  }
  const dispose = (): void => {
    if (disposed) {
      return
    }
    disposed = true
    disposeSkyResources(resources)
  }
  return { dispose, sceneObject: resources.sceneObject, update }
}
