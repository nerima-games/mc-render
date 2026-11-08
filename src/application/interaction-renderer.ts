import {
  type AtlasCoordinateError,
  type AtlasTileIndex,
  AtlasTileIndexSchema,
  tileUvBounds,
} from '../domain/texture-atlas.js'
import {
  type BlockSelectionShape,
  BlockSelectionShapeSchema,
  type CrackStagePlan,
  CrackStagePlanSchema,
  type DamageFeedbackPlan,
  DamageFeedbackPlanSchema,
  type FirstPersonAction,
  type FirstPersonPose,
  FirstPersonPoseSchema,
  type InteractionBox,
  type InteractionRadians,
  type InteractionUnitValue,
  type InteractionVector2,
  InteractionVector2Schema,
  type InteractionVector3,
  InteractionVector3Schema,
  type InteractionVisualInputError,
  type SelectionOutlinePlan,
  makeInteractionVector2,
  makeInteractionVector3,
  planCrackStage,
  planDamageFeedback,
  planFirstPersonPose,
  planSelectionOutline,
} from '../domain/interaction-visuals.js'
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
  setPresentationOpacity,
} from './render-presentation-surface.js'
import type { RenderPresentationTexture, RenderPresentationTextures } from './render-presentation-assets.js'
import { Result, Schema } from 'effect'

type Axis = 'x' | 'y' | 'z'
type Geometry = PresentationBufferGeometry
type BasicMaterial<TTexture extends RenderPresentationTexture> = PresentationBasicMaterial<TTexture>
type LineMaterial = PresentationMaterial

const setRenderOrder = (object: PresentationObject3D, order: number): void => {
  Object.assign(object, { renderOrder: order })
}

type DrawnObject<TGeometry extends Geometry, TMaterial extends PresentationMaterial> = Readonly<{
  object: PresentationObject3D
  geometry: TGeometry
  material: TMaterial
}>

type Surface<
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
> = RenderPresentationSurface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>

export type InteractionTarget = Readonly<{
  shape: BlockSelectionShape
  position: InteractionVector3
}>

export type TemporaryNonBlockCategory = 'tool' | 'weapon' | 'food' | 'potion' | 'utility'

export type HeldItemAtlasTileIndex = AtlasTileIndex
export type HeldItemAtlasFaceTileIndices = Readonly<{
  bottom: HeldItemAtlasTileIndex
  side: HeldItemAtlasTileIndex
  top: HeldItemAtlasTileIndex
}>

export type HeldItemDescriptor =
  | Readonly<{ kind: 'block'; faceTileIndices: HeldItemAtlasFaceTileIndices }>
  | Readonly<{ kind: 'temporary-non-block'; category: TemporaryNonBlockCategory }>

type HeldItemDescriptorEncoded =
  | Readonly<{
    faceTileIndices: Readonly<{
      bottom: number
      side: number
      top: number
    }>
    kind: 'block'
  }>
  | Readonly<{ kind: 'temporary-non-block'; category: TemporaryNonBlockCategory }>
type InteractionUnitValueEncoded = number
type InteractionRadiansEncoded = number

export const HeldItemDescriptorSchema: Schema.Codec<HeldItemDescriptor, HeldItemDescriptorEncoded> = Schema.Union([
  Schema.Struct({
    faceTileIndices: Schema.Struct({
      bottom: AtlasTileIndexSchema,
      side: AtlasTileIndexSchema,
      top: AtlasTileIndexSchema,
    }),
    kind: Schema.Literal('block'),
  }),
  Schema.Struct({
    category: Schema.Literals(['food', 'potion', 'tool', 'utility', 'weapon']),
    kind: Schema.Literal('temporary-non-block'),
  }),
])

export type InteractionFrameInput = Readonly<{
  action: FirstPersonAction
  actionProgress: InteractionUnitValue
  damageDirection: InteractionVector2
  damageIntensity: InteractionUnitValue
  gaitPhaseRadians: InteractionRadians
  heldItem?: HeldItemDescriptor | undefined
  miningProgress: InteractionUnitValue
  movementIntensity: InteractionUnitValue
  reducedMotion: boolean
  target?: InteractionTarget | undefined
}>

export type InteractionFrameResult = Readonly<{
  crackStage: CrackStagePlan
  damage: DamageFeedbackPlan
  handPose: FirstPersonPose
}>

type InteractionVector2Input = Readonly<{ x: number; y: number }>
type InteractionVector3Input = Readonly<{ x: number; y: number; z: number }>
export type InteractionFrameInputEncoded = Readonly<{
  action: FirstPersonAction
  actionProgress: InteractionUnitValueEncoded
  damageDirection: InteractionVector2Input
  damageIntensity: InteractionUnitValueEncoded
  gaitPhaseRadians: InteractionRadiansEncoded
  heldItem?: HeldItemDescriptorEncoded | undefined
  miningProgress: InteractionUnitValueEncoded
  movementIntensity: InteractionUnitValueEncoded
  reducedMotion: boolean
  target?: Readonly<{ position: InteractionVector3Input; shape: Schema.Codec.Encoded<typeof BlockSelectionShapeSchema> }> | undefined
}>

export const InteractionFrameInputSchema: Schema.Codec<InteractionFrameInput, InteractionFrameInputEncoded> = Schema.Struct({
  action: Schema.Literals(['idle', 'attack', 'mine', 'place']),
  actionProgress: Schema.Finite.pipe(Schema.brand('InteractionUnitValue')),
  damageDirection: InteractionVector2Schema,
  damageIntensity: Schema.Finite.pipe(Schema.brand('InteractionUnitValue')),
  gaitPhaseRadians: Schema.Finite.pipe(Schema.brand('InteractionRadians')),
  heldItem: Schema.optional(HeldItemDescriptorSchema),
  miningProgress: Schema.Finite.pipe(Schema.brand('InteractionUnitValue')),
  movementIntensity: Schema.Finite.pipe(Schema.brand('InteractionUnitValue')),
  reducedMotion: Schema.Boolean,
  target: Schema.optional(Schema.Struct({
    position: InteractionVector3Schema,
    shape: BlockSelectionShapeSchema,
  })),
})

export const InteractionFrameResultSchema: Schema.Codec<InteractionFrameResult, Readonly<{
  crackStage: Schema.Codec.Encoded<typeof CrackStagePlanSchema>
  damage: Schema.Codec.Encoded<typeof DamageFeedbackPlanSchema>
  handPose: Schema.Codec.Encoded<typeof FirstPersonPoseSchema>
}>> = Schema.Struct({
  crackStage: CrackStagePlanSchema,
  damage: DamageFeedbackPlanSchema,
  handPose: FirstPersonPoseSchema,
})

export type InteractionRendererError = InteractionVisualInputError | AtlasCoordinateError

export type InteractionRenderer = Readonly<{
  sceneObject: PresentationObject3D
  cameraObject: PresentationObject3D
  update: (frame: unknown) => Result.Result<InteractionFrameResult, InteractionRendererError>
  dispose: () => void
}>

const ZERO = 0
const ONE = 1
const TWO = 2
const THREE = 3
const UNIT_MIN = 0
const UNIT_MAX = 1
const HALF = 0.5
const { PI } = Math
const FACE_SIGN = { negative: -1, positive: 1 } as const
const SELECTION_RENDER_ORDER = 10
const CRACK_TEXTURE_RENDER_ORDER = 20
const CRACK_LINE_RENDER_ORDER = 21
const DAMAGE_OVERLAY_RENDER_ORDER = 100
const DAMAGE_INDICATOR_RENDER_ORDER = 101
const BOX_VERTEX_COUNT = 36
const FACE_VERTEX_COUNT = 6
const BOX_FACE_COUNT = 6
const CRACK_SURFACE_OFFSET = 0.003
const SELECTION_SURFACE_OFFSET = 0.002
const ARM_WIDTH = 0.15
const ARM_HEIGHT = 0.42
const ARM_DEPTH = 0.15
const ITEM_WIDTH = 0.13
const ITEM_HEIGHT = 0.24
const ITEM_DEPTH = 0.09
const TEMP_TOOL_WIDTH = 0.08
const TEMP_TOOL_HEIGHT = 0.3
const TEMP_TOOL_DEPTH = 0.07
const TEMP_WEAPON_WIDTH = 0.065
const TEMP_WEAPON_HEIGHT = 0.38
const TEMP_WEAPON_DEPTH = 0.035
const TEMP_FOOD_WIDTH = 0.18
const TEMP_FOOD_HEIGHT = 0.15
const TEMP_FOOD_DEPTH = 0.12
const TEMP_POTION_WIDTH = 0.11
const TEMP_POTION_HEIGHT = 0.25
const TEMP_POTION_DEPTH = 0.1
const TEMP_UTILITY_WIDTH = 0.16
const TEMP_UTILITY_HEIGHT = 0.17
const TEMP_UTILITY_DEPTH = 0.12
const DAMAGE_PLANE_HALF_EXTENT = 2
const DAMAGE_PLANE_DEPTH = -0.25
const INDICATOR_DEPTH = -0.24
const INDICATOR_RADIUS_X = 0.76
const INDICATOR_RADIUS_Y = 0.55
const INDICATOR_WIDTH = 0.09
const INDICATOR_HEIGHT = 0.12
const ITEM_OFFSET_Y = 0.22
const ITEM_OFFSET_Z = -0.04
const HAND_REST_X = 0.42
const HAND_REST_Y = -0.38
const HAND_REST_Z = -0.72
const SELECTION_COLOR = 0xfff5d6
const CRACK_COLOR = 0x3b2722
const ARM_COLOR = 0xc58b68
const ITEM_COLOR = 0xb69b6a
const ITEM_TEXTURE_COLOR = 0xffffff
const TEMP_TOOL_COLOR = 0xdd9a43
const TEMP_WEAPON_COLOR = 0xd7dce8
const TEMP_FOOD_COLOR = 0xd96b43
const TEMP_POTION_COLOR = 0x9a70d6
const TEMP_UTILITY_COLOR = 0x64c3bd
const DAMAGE_COLOR = 0xd92b21
const INDICATOR_COLOR = 0xff473d

const selectionOffset = (coordinate: number, blockAxis: number): number => {
  const direction = Math.sign(coordinate - blockAxis - HALF)
  if (direction === ZERO) {
    return SELECTION_SURFACE_OFFSET
  }
  return direction * SELECTION_SURFACE_OFFSET
}

type Face = Readonly<{
  axis: Axis
  sign: typeof FACE_SIGN[keyof typeof FACE_SIGN]
  u: Axis
  v: Axis
}>

const FACES: ReadonlyArray<Face> = [
  { axis: 'x', sign: FACE_SIGN.negative, u: 'z', v: 'y' },
  { axis: 'x', sign: FACE_SIGN.positive, u: 'z', v: 'y' },
  { axis: 'y', sign: FACE_SIGN.negative, u: 'x', v: 'z' },
  { axis: 'y', sign: FACE_SIGN.positive, u: 'x', v: 'z' },
  { axis: 'z', sign: FACE_SIGN.negative, u: 'x', v: 'y' },
  { axis: 'z', sign: FACE_SIGN.positive, u: 'x', v: 'y' },
]

const CRACK_UV_EDGE = 0.08
const CRACK_UV_NEAR_EDGE = 0.12
const CRACK_UV_QUARTER = 0.24
const CRACK_UV_LOWER_INTERIOR = 0.3
const CRACK_UV_LOWER_CENTER = 0.32
const CRACK_UV_CENTER_LEFT = 0.36
const CRACK_UV_LEFT_MID_EDGE = 0.4
const CRACK_UV_LOWER_SPLIT = 0.42
const CRACK_UV_VERTICAL_CENTER = 0.52
const CRACK_UV_UPPER_LEFT = 0.56
const CRACK_UV_UPPER_CENTER = 0.58
const CRACK_UV_INTERIOR = 0.7
const CRACK_UV_UPPER_RIGHT_INTERIOR = 0.76
const CRACK_UV_UPPER_RIGHT_EDGE = 0.8
const CRACK_UV_UPPER_RIGHT_CROSS = 0.82
const CRACK_UV_RIGHT_LOWER_INTERIOR = 0.86
const CRACK_UV_RIGHT_UPPER_INTERIOR = 0.88
const CRACK_UV_RIGHT_EDGE = 0.92
const CRACK_UV_LOWER_RIGHT_EDGE = 0.94

const crackUv = (x: number, y: number): InteractionVector2 => makeInteractionVector2({ x, y })

const CRACK_UV = {
  center: crackUv(HALF, HALF),
  lowerCenter: crackUv(CRACK_UV_CENTER_LEFT, CRACK_UV_LOWER_SPLIT),
  lowerLeft: crackUv(CRACK_UV_EDGE, CRACK_UV_EDGE),
  lowerLeftEdge: crackUv(CRACK_UV_EDGE, CRACK_UV_LEFT_MID_EDGE),
  lowerLeftInterior: crackUv(CRACK_UV_LOWER_INTERIOR, CRACK_UV_LOWER_CENTER),
  lowerRight: crackUv(CRACK_UV_LOWER_RIGHT_EDGE, CRACK_UV_QUARTER),
  lowerRightInterior: crackUv(CRACK_UV_INTERIOR, CRACK_UV_LOWER_INTERIOR),
  rightCenter: crackUv(CRACK_UV_RIGHT_EDGE, CRACK_UV_VERTICAL_CENTER),
  rightLowerInterior: crackUv(CRACK_UV_RIGHT_LOWER_INTERIOR, CRACK_UV_NEAR_EDGE),
  upperCenterRight: crackUv(CRACK_UV_UPPER_CENTER, CRACK_UV_INTERIOR),
  upperLeft: crackUv(CRACK_UV_NEAR_EDGE, CRACK_UV_UPPER_LEFT),
  upperLeftLowerInterior: crackUv(CRACK_UV_QUARTER, CRACK_UV_INTERIOR),
  upperLeftUpperInterior: crackUv(CRACK_UV_NEAR_EDGE, CRACK_UV_RIGHT_UPPER_INTERIOR),
  upperRight: crackUv(CRACK_UV_RIGHT_UPPER_INTERIOR, CRACK_UV_UPPER_RIGHT_CROSS),
  upperRightEdge: crackUv(CRACK_UV_UPPER_RIGHT_EDGE, CRACK_UV_LOWER_RIGHT_EDGE),
  upperRightInterior: crackUv(CRACK_UV_UPPER_RIGHT_INTERIOR, CRACK_UV_INTERIOR),
} as const

type CrackBranch = Readonly<{ start: InteractionVector2; end: InteractionVector2 }>

const CRACK_BRANCHES: ReadonlyArray<CrackBranch> = [
  { end: CRACK_UV.lowerLeft, start: CRACK_UV.center },
  { end: CRACK_UV.rightLowerInterior, start: CRACK_UV.center },
  { end: CRACK_UV.rightCenter, start: CRACK_UV.center },
  { end: CRACK_UV.upperLeftUpperInterior, start: CRACK_UV.center },
  { end: CRACK_UV.upperRightEdge, start: CRACK_UV.center },
  { end: CRACK_UV.lowerLeftEdge, start: CRACK_UV.lowerLeftInterior },
  { end: CRACK_UV.lowerRight, start: CRACK_UV.lowerRightInterior },
  { end: CRACK_UV.upperLeft, start: CRACK_UV.upperLeftLowerInterior },
  { end: CRACK_UV.upperRight, start: CRACK_UV.upperRightInterior },
  { end: CRACK_UV.upperCenterRight, start: CRACK_UV.lowerCenter },
]

type LineSegment = Readonly<{ start: InteractionVector3; end: InteractionVector3 }>

const writePoint = (positions: Float32Array, offset: number, point: InteractionVector3): void => {
  positions[offset] = point.x
  positions[offset + ONE] = point.y
  positions[offset + TWO] = point.z
}

const writeSegment = (positions: Float32Array, segmentIndex: number, { start, end }: LineSegment): void => {
  const offset = segmentIndex * TWO * THREE
  writePoint(positions, offset, start)
  writePoint(positions, offset + THREE, end)
}

const positionsFromSegments = (segments: ReadonlyArray<LineSegment>): Float32Array => {
  const positions = new Float32Array(segments.length * TWO * THREE)
  segments.forEach((segment, index) => writeSegment(positions, index, segment))
  return positions
}

const makeGeometry = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  positions: Float32Array,
): TGeometry => {
  const geometry = new surface.BufferGeometry()
  geometry.setAttribute('position', new surface.BufferAttribute(positions, makePresentationItemSize(THREE)))
  return geometry
}

const makeLineMesh = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  positions: Float32Array,
  material: TLineMaterial,
): DrawnObject<TGeometry, TLineMaterial> => {
  const geometry = makeGeometry(surface, positions)
  return { geometry, material, object: new surface.LineSegments(geometry, material) }
}

type BasicMeshInput<TBasicMaterial extends PresentationMaterial> = Readonly<{
  positions: Float32Array
  material: TBasicMaterial
  uv?: Float32Array
}>

const makeBasicMesh = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  { positions, material, uv }: BasicMeshInput<TBasicMaterial>,
): DrawnObject<TGeometry, TBasicMaterial> => {
  const geometry = makeGeometry(surface, positions)
  if (uv !== undefined) {
    geometry.setAttribute('uv', new surface.BufferAttribute(uv, makePresentationItemSize(TWO)))
  }
  return { geometry, material, object: new surface.Mesh(geometry, material) }
}

type FacePointInput = Readonly<{
  box: InteractionBox
  position: InteractionVector3
  face: Face
  u: number
  v: number
}>

const pointOnFace = ({ box, position, face, u, v }: FacePointInput): InteractionVector3 => {
  const coordinates: Record<Axis, number> = {
    x: position.x + box.min.x,
    y: position.y + box.min.y,
    z: position.z + box.min.z,
  }
  const axisMax = position[face.axis] + box.max[face.axis]
  const axisMin = position[face.axis] + box.min[face.axis]
  if (face.sign > ZERO) {
    coordinates[face.axis] = axisMax + CRACK_SURFACE_OFFSET
  } else {
    coordinates[face.axis] = axisMin - CRACK_SURFACE_OFFSET
  }
  coordinates[face.u] = position[face.u] + box.min[face.u] + u * (box.max[face.u] - box.min[face.u])
  coordinates[face.v] = position[face.v] + box.min[face.v] + v * (box.max[face.v] - box.min[face.v])
  return makeInteractionVector3(coordinates)
}

const crackLinePositions = (target: InteractionTarget, stage: number): Float32Array => {
  const segments: Array<LineSegment> = []
  for (const box of target.shape.boxes) {
    for (const face of FACES) {
      const branches = CRACK_BRANCHES.slice(ZERO, stage)
      for (const { start, end } of branches) {
        segments.push({
          end: pointOnFace({ box, face, position: target.position, u: end.x, v: end.y }),
          start: pointOnFace({ box, face, position: target.position, u: start.x, v: start.y }),
        })
      }
    }
  }
  return positionsFromSegments(segments)
}

type QuadCorners = readonly [InteractionVector3, InteractionVector3, InteractionVector3, InteractionVector3]

const faceCorners = (box: InteractionBox, position: InteractionVector3, face: Face): QuadCorners => [
  pointOnFace({ box, face, position, u: UNIT_MIN, v: UNIT_MIN }),
  pointOnFace({ box, face, position, u: UNIT_MAX, v: UNIT_MIN }),
  pointOnFace({ box, face, position, u: UNIT_MAX, v: UNIT_MAX }),
  pointOnFace({ box, face, position, u: UNIT_MIN, v: UNIT_MAX }),
]

const faceUvs = (): Float32Array => new Float32Array([
  UNIT_MIN, UNIT_MIN,
  UNIT_MAX, UNIT_MIN,
  UNIT_MAX, UNIT_MAX,
  UNIT_MIN, UNIT_MIN,
  UNIT_MAX, UNIT_MAX,
  UNIT_MIN, UNIT_MAX,
])

type UvBounds = Readonly<{ u0: number; v0: number; u1: number; v1: number }>
type CubeFaceUvBounds = readonly [UvBounds, UvBounds, UvBounds, UvBounds, UvBounds, UvBounds]

const FULL_TEXTURE_BOUNDS: UvBounds = { u0: UNIT_MIN, u1: UNIT_MAX, v0: UNIT_MIN, v1: UNIT_MAX }

const uvQuad = (bounds: UvBounds): ReadonlyArray<number> => [
  bounds.u0, bounds.v0,
  bounds.u1, bounds.v0,
  bounds.u1, bounds.v1,
  bounds.u0, bounds.v0,
  bounds.u1, bounds.v1,
  bounds.u0, bounds.v1,
]

const cubeUvsByFace = (bounds: CubeFaceUvBounds): Float32Array => {
  const uvs = new Float32Array(BOX_FACE_COUNT * FACE_VERTEX_COUNT * TWO)
  bounds.forEach((faceBounds, faceIndex) =>
    uvs.set(uvQuad(faceBounds), faceIndex * FACE_VERTEX_COUNT * TWO),
  )
  return uvs
}

const cubeUvs = (bounds: UvBounds): Float32Array =>
  cubeUvsByFace([bounds, bounds, bounds, bounds, bounds, bounds])

const heldItemCubeUvs = (bounds: Readonly<{ bottom: UvBounds; side: UvBounds; top: UvBounds }>): Float32Array =>
  // BOX_FACE_CORNERS orders faces as -Z, +Z, -Y, +Y, -X, +X.
  cubeUvsByFace([bounds.side, bounds.side, bounds.bottom, bounds.top, bounds.side, bounds.side])

const quadPositions = (corners: QuadCorners): Float32Array => {
  const [lowerLeft, lowerRight, upperRight, upperLeft] = corners
  const vertices = [lowerLeft, lowerRight, upperRight, lowerLeft, upperRight, upperLeft] as const
  const positions = new Float32Array(FACE_VERTEX_COUNT * THREE)
  vertices.forEach((corner, vertex) => {
    const offset = vertex * THREE
    positions[offset] = corner.x
    positions[offset + ONE] = corner.y
    positions[offset + TWO] = corner.z
  })
  return positions
}

const FOUR = 4
const FIVE = 5
const SIX = 6
const SEVEN = 7

type BoxCornerIndex = typeof ZERO | typeof ONE | typeof TWO | typeof THREE | typeof FOUR | typeof FIVE | typeof SIX | typeof SEVEN
type BoxFaceCornerIndices = readonly [BoxCornerIndex, BoxCornerIndex, BoxCornerIndex, BoxCornerIndex]
type CubeCorners = readonly [
  InteractionVector3,
  InteractionVector3,
  InteractionVector3,
  InteractionVector3,
  InteractionVector3,
  InteractionVector3,
  InteractionVector3,
  InteractionVector3,
]

const BOX_FACE_CORNERS: ReadonlyArray<BoxFaceCornerIndices> = [
  [ZERO, THREE, TWO, ONE],
  [FOUR, FIVE, SIX, SEVEN],
  [ZERO, ONE, FIVE, FOUR],
  [THREE, SEVEN, SIX, TWO],
  [ZERO, FOUR, SEVEN, THREE],
  [ONE, TWO, SIX, FIVE],
]

const cubePositions = (width: number, height: number, depth: number): Float32Array => {
  const x = width * HALF
  const y = height * HALF
  const z = depth * HALF
  const corners: CubeCorners = [
    makeInteractionVector3({ x: -x, y: -y, z: -z }),
    makeInteractionVector3({ x, y: -y, z: -z }),
    makeInteractionVector3({ x, y, z: -z }),
    makeInteractionVector3({ x: -x, y, z: -z }),
    makeInteractionVector3({ x: -x, y: -y, z }),
    makeInteractionVector3({ x, y: -y, z }),
    makeInteractionVector3({ x, y, z }),
    makeInteractionVector3({ x: -x, y, z }),
  ]
  const positions = new Float32Array(BOX_VERTEX_COUNT * THREE)
  BOX_FACE_CORNERS.forEach(([first, second, third, fourth], faceIndex) => {
    positions.set(
      quadPositions([corners[first], corners[second], corners[third], corners[fourth]]),
      faceIndex * FACE_VERTEX_COUNT * THREE,
    )
  })
  return positions
}

const makeQuadMesh = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  { positions, texture, opacity }: Readonly<{ positions: Float32Array; texture: TTexture; opacity: number }>,
): DrawnObject<TGeometry, TBasicMaterial> => {
  const geometry = makeGeometry(surface, positions)
  geometry.setAttribute('uv', new surface.BufferAttribute(faceUvs(), makePresentationItemSize(TWO)))
  const material = new surface.MeshBasicMaterial({
    color: makePresentationColor(CRACK_COLOR),
    depthTest: true,
    depthWrite: false,
    map: texture,
    opacity: makePresentationOpacity(opacity),
    side: RENDER_PRESENTATION_SIDE.double,
    transparent: true,
  })
  return { geometry, material, object: new surface.Mesh(geometry, material) }
}

const updateMaterialOpacity = (material: PresentationMaterial, opacity: number): void => {
  setPresentationOpacity(material, makePresentationOpacity(opacity))
}

const disposeObject = <TGeometry extends Geometry, TMaterial extends PresentationMaterial>(
  group: PresentationObject3D,
  drawn: DrawnObject<TGeometry, TMaterial> | undefined,
): void => {
  if (drawn !== undefined) {
    group.remove(drawn.object)
    drawn.geometry.dispose()
    drawn.material.dispose()
  }
}

const makeDamagePlane = (): Float32Array => new Float32Array([
  -DAMAGE_PLANE_HALF_EXTENT, -DAMAGE_PLANE_HALF_EXTENT, DAMAGE_PLANE_DEPTH,
  DAMAGE_PLANE_HALF_EXTENT, -DAMAGE_PLANE_HALF_EXTENT, DAMAGE_PLANE_DEPTH,
  DAMAGE_PLANE_HALF_EXTENT, DAMAGE_PLANE_HALF_EXTENT, DAMAGE_PLANE_DEPTH,
  -DAMAGE_PLANE_HALF_EXTENT, -DAMAGE_PLANE_HALF_EXTENT, DAMAGE_PLANE_DEPTH,
  DAMAGE_PLANE_HALF_EXTENT, DAMAGE_PLANE_HALF_EXTENT, DAMAGE_PLANE_DEPTH,
  -DAMAGE_PLANE_HALF_EXTENT, DAMAGE_PLANE_HALF_EXTENT, DAMAGE_PLANE_DEPTH,
])

const makeDirectionTriangle = (): Float32Array => new Float32Array([
  ZERO, INDICATOR_HEIGHT * HALF, INDICATOR_DEPTH,
  -INDICATOR_WIDTH * HALF, -INDICATOR_HEIGHT * HALF, INDICATOR_DEPTH,
  INDICATOR_WIDTH * HALF, -INDICATOR_HEIGHT * HALF, INDICATOR_DEPTH,
])

type InteractionWorldOverlayState<
  TGeometry extends Geometry,
  TBasicMaterial extends PresentationMaterial,
  TLineMaterial extends PresentationMaterial,
> = {
  crackFaceMeshes: Array<DrawnObject<TGeometry, TBasicMaterial>>
  crackLineMesh: DrawnObject<TGeometry, TLineMaterial> | undefined
  selectionMesh: DrawnObject<TGeometry, TLineMaterial> | undefined
  target: InteractionTarget | undefined
}

type InteractionWorldOverlayContext<
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
> = Readonly<{
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>
  textures: RenderPresentationTextures<TTexture>
  worldObject: PresentationObject3D
  state: InteractionWorldOverlayState<TGeometry, TBasicMaterial, TLineMaterial>
}>

type InteractionWorldOverlayController = Readonly<{
  clear: () => void
  updateSelection: (target: InteractionTarget, plan: SelectionOutlinePlan) => void
  updateCracks: (plan: CrackStagePlan) => void
}>

const clearWorldCracks = <
  TGeometry extends Geometry,
  TBasicMaterial extends PresentationMaterial,
  TLineMaterial extends PresentationMaterial,
>(
  worldObject: PresentationObject3D,
  state: InteractionWorldOverlayState<TGeometry, TBasicMaterial, TLineMaterial>,
): void => {
  disposeObject(worldObject, state.crackLineMesh)
  state.crackLineMesh = undefined
  state.crackFaceMeshes.forEach((mesh) => disposeObject(worldObject, mesh))
  state.crackFaceMeshes.length = ZERO
}

const clearWorldSelection = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(context: InteractionWorldOverlayContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>): void => {
  clearWorldCracks(context.worldObject, context.state)
  disposeObject(context.worldObject, context.state.selectionMesh)
  context.state.selectionMesh = undefined
  context.state.target = undefined
}

const offsetSelectionSegment = (
  segment: LineSegment,
  position: InteractionVector3,
): LineSegment => ({
  end: makeInteractionVector3({
    x: segment.end.x + selectionOffset(segment.end.x, position.x),
    y: segment.end.y + selectionOffset(segment.end.y, position.y),
    z: segment.end.z + selectionOffset(segment.end.z, position.z),
  }),
  start: makeInteractionVector3({
    x: segment.start.x + selectionOffset(segment.start.x, position.x),
    y: segment.start.y + selectionOffset(segment.start.y, position.y),
    z: segment.start.z + selectionOffset(segment.start.z, position.z),
  }),
})

const updateWorldSelection = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  context: InteractionWorldOverlayContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  target: InteractionTarget,
  plan: SelectionOutlinePlan,
): void => {
  clearWorldSelection(context)
  context.state.target = target
  const material = new context.surface.LineBasicMaterial({
    color: makePresentationColor(SELECTION_COLOR),
    depthTest: true,
    depthWrite: false,
    opacity: makePresentationOpacity(ONE),
    transparent: false,
  })
  context.state.selectionMesh = makeLineMesh(
    context.surface,
    positionsFromSegments(plan.segments.map((segment) => offsetSelectionSegment(segment, target.position))),
    material,
  )
  setRenderOrder(context.state.selectionMesh.object, SELECTION_RENDER_ORDER)
  context.worldObject.add(context.state.selectionMesh.object)
}

const drawTexturedCracks = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  context: InteractionWorldOverlayContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  target: InteractionTarget,
  opacity: number,
): void => {
  const texture = context.textures.cracks
  if (texture === undefined) {
    return
  }
  const meshes = target.shape.boxes.flatMap((box) => FACES.map((face) => makeQuadMesh(context.surface, {
    opacity,
    positions: quadPositions(faceCorners(box, target.position, face)),
    texture,
  })))
  meshes.forEach((mesh) => {
    setRenderOrder(mesh.object, CRACK_TEXTURE_RENDER_ORDER)
    context.worldObject.add(mesh.object)
  })
  context.state.crackFaceMeshes.push(...meshes)
}

const drawProceduralCracks = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  context: InteractionWorldOverlayContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  input: Readonly<{ target: InteractionTarget; stage: number; opacity: number }>,
): void => {
  const material = new context.surface.LineBasicMaterial({
    color: makePresentationColor(CRACK_COLOR),
    depthTest: true,
    depthWrite: false,
    opacity: makePresentationOpacity(input.opacity),
    transparent: true,
  })
  context.state.crackLineMesh = makeLineMesh(context.surface, crackLinePositions(input.target, input.stage), material)
  setRenderOrder(context.state.crackLineMesh.object, CRACK_LINE_RENDER_ORDER)
  context.worldObject.add(context.state.crackLineMesh.object)
}

const updateWorldCracks = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  context: InteractionWorldOverlayContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  plan: CrackStagePlan,
): void => {
  clearWorldCracks(context.worldObject, context.state)
  const { target } = context.state
  if (target !== undefined && plan.stage > ZERO) {
    drawTexturedCracks(context, target, plan.opacity)
    drawProceduralCracks(context, { opacity: plan.opacity, stage: plan.stage, target })
  }
}

const createWorldOverlayController = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  worldObject: PresentationObject3D,
  textures: RenderPresentationTextures<TTexture>,
): InteractionWorldOverlayController => {
  const context: InteractionWorldOverlayContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial> = {
    state: { crackFaceMeshes: [], crackLineMesh: undefined, selectionMesh: undefined, target: undefined },
    surface,
    textures,
    worldObject,
  }
  return {
    clear: () => clearWorldSelection(context),
    updateCracks: (plan) => updateWorldCracks(context, plan),
    updateSelection: (target, plan) => updateWorldSelection(context, target, plan),
  }
}

type HandOverlay<TGeometry extends Geometry, TBasicMaterial extends PresentationMaterial> = Readonly<{
  object: PresentationObject3D
  arm: DrawnObject<TGeometry, TBasicMaterial>
  heldItem: DrawnObject<TGeometry, TBasicMaterial>
  setHeldItem: (descriptor: HeldItemDescriptor | undefined) => Result.Result<void, AtlasCoordinateError>
}>

type TemporaryItemProfile = Readonly<{ color: number; depth: number; height: number; width: number }>

const TEMPORARY_ITEM_PROFILES: Readonly<Record<TemporaryNonBlockCategory, TemporaryItemProfile>> = {
  food: { color: TEMP_FOOD_COLOR, depth: TEMP_FOOD_DEPTH, height: TEMP_FOOD_HEIGHT, width: TEMP_FOOD_WIDTH },
  potion: { color: TEMP_POTION_COLOR, depth: TEMP_POTION_DEPTH, height: TEMP_POTION_HEIGHT, width: TEMP_POTION_WIDTH },
  tool: { color: TEMP_TOOL_COLOR, depth: TEMP_TOOL_DEPTH, height: TEMP_TOOL_HEIGHT, width: TEMP_TOOL_WIDTH },
  utility: { color: TEMP_UTILITY_COLOR, depth: TEMP_UTILITY_DEPTH, height: TEMP_UTILITY_HEIGHT, width: TEMP_UTILITY_WIDTH },
  weapon: { color: TEMP_WEAPON_COLOR, depth: TEMP_WEAPON_DEPTH, height: TEMP_WEAPON_HEIGHT, width: TEMP_WEAPON_WIDTH },
}

const heldItemKey = (descriptor: HeldItemDescriptor | undefined): string => {
  if (descriptor === undefined) {
    return 'empty'
  }
  if (descriptor.kind === 'block') {
    const { bottom, side, top } = descriptor.faceTileIndices
    return `block:${top}:${side}:${bottom}`
  }
  return `temporary:${descriptor.category}`
}

type HeldItemUpdateContext<
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
> = Readonly<{
  atlas: TTexture | undefined
  heldItem: DrawnObject<TGeometry, TBasicMaterial>
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>
}>

const updateHeldItemFaceGeometry = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  input: HeldItemUpdateContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  faceTileIndices: HeldItemAtlasFaceTileIndices,
): Result.Result<void, AtlasCoordinateError> => {
  const faceBounds = Result.all({
    bottom: tileUvBounds(faceTileIndices.bottom),
    side: tileUvBounds(faceTileIndices.side),
    top: tileUvBounds(faceTileIndices.top),
  })
  return Result.map(faceBounds, (bounds) => {
    input.heldItem.geometry.setAttribute('position', new input.surface.BufferAttribute(
      cubePositions(ITEM_WIDTH, ITEM_HEIGHT, ITEM_DEPTH),
      makePresentationItemSize(THREE),
    ))
    input.heldItem.geometry.setAttribute('uv', new input.surface.BufferAttribute(
      heldItemCubeUvs(bounds),
      makePresentationItemSize(TWO),
    ))
  })
}

const updateBlockHeldItem = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(input: HeldItemUpdateContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial> & Readonly<{ faceTileIndices: HeldItemAtlasFaceTileIndices }>): Result.Result<void, AtlasCoordinateError> => Result.map(updateHeldItemFaceGeometry(input, input.faceTileIndices), () => {
    input.heldItem.material.map = input.atlas ?? null
    if (input.atlas === undefined) {
      input.heldItem.material.color.set(makePresentationColor(ITEM_COLOR))
    } else {
      input.heldItem.material.color.set(makePresentationColor(ITEM_TEXTURE_COLOR))
    }
    input.heldItem.object.visible = true
  })
const updateTemporaryHeldItem = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(input: HeldItemUpdateContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial> & Readonly<{ category: TemporaryNonBlockCategory }>): void => {
  const profile = TEMPORARY_ITEM_PROFILES[input.category]
  input.heldItem.geometry.setAttribute('position', new input.surface.BufferAttribute(
    cubePositions(profile.width, profile.height, profile.depth),
    makePresentationItemSize(THREE),
  ))
  input.heldItem.material.map = null
  input.heldItem.material.color.set(makePresentationColor(profile.color))
  input.heldItem.object.visible = true
}

const updateHeldItemAppearance = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(input: HeldItemUpdateContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial> & Readonly<{ descriptor: HeldItemDescriptor | undefined }>): Result.Result<void, AtlasCoordinateError> => {
  if (input.descriptor === undefined) {
    input.heldItem.material.map = null
    input.heldItem.object.visible = false
    return Result.succeed(undefined)
  }
  if (input.descriptor.kind === 'block') {
    return updateBlockHeldItem({ ...input, faceTileIndices: input.descriptor.faceTileIndices })
  }
  updateTemporaryHeldItem({ ...input, category: input.descriptor.category })
  return Result.succeed(undefined)
}

const createHeldItemSetter = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(input: HeldItemUpdateContext<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>): Readonly<{
  setHeldItem: (descriptor: HeldItemDescriptor | undefined) => Result.Result<void, AtlasCoordinateError>
}> => {
  let lastItemKey = 'empty'
  const setHeldItem = (descriptor: HeldItemDescriptor | undefined): Result.Result<void, AtlasCoordinateError> => {
    const nextItemKey = heldItemKey(descriptor)
    if (lastItemKey === nextItemKey) {
      return Result.succeed(undefined)
    }
    return Result.map(updateHeldItemAppearance({ ...input, descriptor }), () => {
      lastItemKey = nextItemKey
    })
  }
  return { setHeldItem }
}

const createArmMesh = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>, textures: RenderPresentationTextures<TTexture>): DrawnObject<TGeometry, TBasicMaterial> =>
  makeBasicMesh(surface, {
    material: new surface.MeshBasicMaterial({
      color: makePresentationColor(ARM_COLOR),
      depthTest: true,
      depthWrite: true,
      map: textures.arm ?? null,
      transparent: false,
    }),
    positions: cubePositions(ARM_WIDTH, ARM_HEIGHT, ARM_DEPTH),
    uv: cubeUvs(FULL_TEXTURE_BOUNDS),
  })

const createHeldItemMesh = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>): DrawnObject<TGeometry, TBasicMaterial> => {
  const heldItem = makeBasicMesh(surface, {
    material: new surface.MeshBasicMaterial({
      color: makePresentationColor(ITEM_COLOR),
      depthTest: true,
      depthWrite: true,
      map: null,
      transparent: false,
    }),
    positions: cubePositions(ITEM_WIDTH, ITEM_HEIGHT, ITEM_DEPTH),
    uv: cubeUvs(FULL_TEXTURE_BOUNDS),
  })
  heldItem.object.visible = false
  return heldItem
}

const createHandOverlay = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  textures: RenderPresentationTextures<TTexture>,
): HandOverlay<TGeometry, TBasicMaterial> => {
  const object = new surface.Group()
  const arm = createArmMesh(surface, textures)
  const heldItem = createHeldItemMesh(surface)
  heldItem.object.position.set(ZERO, ITEM_OFFSET_Y, ITEM_OFFSET_Z)
  object.add(arm.object, heldItem.object)
  object.position.set(HAND_REST_X, HAND_REST_Y, HAND_REST_Z)
  return {
    arm,
    heldItem,
    object,
    ...createHeldItemSetter({ atlas: textures.heldItem, heldItem, surface }),
  }
}

type DamageOverlay<TGeometry extends Geometry, TBasicMaterial extends PresentationMaterial> = Readonly<{
  flash: DrawnObject<TGeometry, TBasicMaterial>
  direction: DrawnObject<TGeometry, TBasicMaterial>
}>

const createDamageOverlay = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
): DamageOverlay<TGeometry, TBasicMaterial> => {
  const flash = makeBasicMesh(surface, {
    material: new surface.MeshBasicMaterial({
      color: makePresentationColor(DAMAGE_COLOR),
      depthTest: false,
      depthWrite: false,
      opacity: makePresentationOpacity(ZERO),
      side: RENDER_PRESENTATION_SIDE.double,
      transparent: true,
    }),
    positions: makeDamagePlane(),
  })
  const direction = makeBasicMesh(surface, {
    material: new surface.MeshBasicMaterial({
      color: makePresentationColor(INDICATOR_COLOR),
      depthTest: false,
      depthWrite: false,
      opacity: makePresentationOpacity(ZERO),
      side: RENDER_PRESENTATION_SIDE.double,
      transparent: true,
    }),
    positions: makeDirectionTriangle(),
  })
  setRenderOrder(flash.object, DAMAGE_OVERLAY_RENDER_ORDER)
  setRenderOrder(direction.object, DAMAGE_INDICATOR_RENDER_ORDER)
  flash.object.visible = false
  direction.object.visible = false
  return { direction, flash }
}

const applyFirstPersonPose = <TGeometry extends Geometry, TBasicMaterial extends PresentationMaterial>(
  hand: HandOverlay<TGeometry, TBasicMaterial>,
  pose: FirstPersonPose,
): void => {
  hand.object.position.set(pose.offset.x, pose.offset.y, pose.offset.z)
  hand.object.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, 'XYZ')
}

const applyDamageFeedback = <TGeometry extends Geometry, TBasicMaterial extends PresentationMaterial>(
  overlays: DamageOverlay<TGeometry, TBasicMaterial>,
  input: Readonly<{ direction: InteractionVector2; intensity: number }>,
  plan: DamageFeedbackPlan,
): void => {
  updateMaterialOpacity(overlays.flash.material, plan.flashOpacity)
  overlays.flash.object.visible = plan.flashOpacity > UNIT_MIN
  const magnitude = Math.hypot(input.direction.x, input.direction.y)
  overlays.direction.object.visible = input.intensity > UNIT_MIN && magnitude > UNIT_MIN
  setPresentationOpacity(overlays.direction.material, makePresentationOpacity(input.intensity))
  if (magnitude > UNIT_MIN) {
    const directionX = input.direction.x / magnitude
    const directionY = input.direction.y / magnitude
    overlays.direction.object.position.set(directionX * INDICATOR_RADIUS_X, directionY * INDICATOR_RADIUS_Y, ZERO)
    overlays.direction.object.rotation.set(ZERO, ZERO, plan.directionAngleRadians - PI * HALF, 'XYZ')
  }
}

type PlannedInteractionTarget =
  | Readonly<{ target: undefined; selectionPlan: undefined }>
  | Readonly<{ target: InteractionTarget; selectionPlan: SelectionOutlinePlan }>

type PlannedInteractionFrame = Readonly<{
  frame: InteractionFrameInput
  result: InteractionFrameResult
  selection: PlannedInteractionTarget
}>

const decodeInteractionFrame = (input: unknown): Result.Result<InteractionFrameInput, InteractionVisualInputError> => {
  const decoded = Schema.decodeUnknownResult(InteractionFrameInputSchema, { onExcessProperty: 'error' })(input)
  if (Result.isFailure(decoded)) {
    return Result.fail({ _tag: 'InteractionVisualInputError', operation: 'interaction-frame', reason: 'invalid-input' })
  }
  return Result.succeed(decoded.success)
}

const planFrameHandPose = (frame: InteractionFrameInput): Result.Result<FirstPersonPose, InteractionVisualInputError> =>
  planFirstPersonPose({
    action: frame.action,
    actionProgress: frame.actionProgress,
    gaitPhaseRadians: frame.gaitPhaseRadians,
    movementIntensity: frame.movementIntensity,
    reducedMotion: frame.reducedMotion,
  })

const planFrameDamage = (frame: InteractionFrameInput): Result.Result<DamageFeedbackPlan, InteractionVisualInputError> =>
  planDamageFeedback({
    attackDirection: frame.damageDirection,
    intensity: frame.damageIntensity,
    reducedMotion: frame.reducedMotion,
  })

const planFrameTarget = (target: InteractionTarget | undefined): Result.Result<PlannedInteractionTarget, InteractionVisualInputError> => {
  if (target === undefined) {
    return Result.succeed({ selectionPlan: undefined, target: undefined })
  }
  const selection = planSelectionOutline(target.shape, target.position)
  if (Result.isFailure(selection)) {
    return Result.fail(selection.failure)
  }
  return Result.succeed({ selectionPlan: selection.success, target })
}

const planInteractionFrameVisuals = (frame: InteractionFrameInput): Result.Result<InteractionFrameResult, InteractionVisualInputError> => {
  const crackStage = planCrackStage(frame.miningProgress)
  if (Result.isFailure(crackStage)) {
    return Result.fail(crackStage.failure)
  }
  const handPose = planFrameHandPose(frame)
  if (Result.isFailure(handPose)) {
    return Result.fail(handPose.failure)
  }
  const damage = planFrameDamage(frame)
  if (Result.isFailure(damage)) {
    return Result.fail(damage.failure)
  }
  return Result.succeed({ crackStage: crackStage.success, damage: damage.success, handPose: handPose.success })
}

const planInteractionFrame = (input: unknown): Result.Result<PlannedInteractionFrame, InteractionVisualInputError> => {
  const decoded = decodeInteractionFrame(input)
  if (Result.isFailure(decoded)) {
    return Result.fail(decoded.failure)
  }
  const result = planInteractionFrameVisuals(decoded.success)
  if (Result.isFailure(result)) {
    return Result.fail(result.failure)
  }
  const selection = planFrameTarget(decoded.success.target)
  if (Result.isFailure(selection)) {
    return Result.fail(selection.failure)
  }
  return Result.succeed({
    frame: decoded.success,
    result: result.success,
    selection: selection.success,
  })
}

const updateFrameTarget = (
  world: InteractionWorldOverlayController,
  selection: PlannedInteractionTarget,
): void => {
  if (selection.target === undefined) {
    world.clear()
    return
  }
  world.updateSelection(selection.target, selection.selectionPlan)
}

const applyInteractionFrame = <
  TGeometry extends Geometry,
  TBasicMaterial extends PresentationMaterial,
>(
  input: Readonly<{
    frame: PlannedInteractionFrame
    world: InteractionWorldOverlayController
    hand: HandOverlay<TGeometry, TBasicMaterial>
    damageOverlays: DamageOverlay<TGeometry, TBasicMaterial>
  }>,
): Result.Result<InteractionFrameResult, InteractionRendererError> => Result.map(input.hand.setHeldItem(input.frame.frame.heldItem), () => {
    updateFrameTarget(input.world, input.frame.selection)
    input.world.updateCracks(input.frame.result.crackStage)
    applyFirstPersonPose(input.hand, input.frame.result.handPose)
    applyDamageFeedback(input.damageOverlays, {
      direction: input.frame.frame.damageDirection,
      intensity: input.frame.frame.damageIntensity,
    }, input.frame.result.damage)
    return input.frame.result
  })

export const createInteractionRenderer = <
  TTexture extends RenderPresentationTexture,
  TGeometry extends Geometry,
  TBasicMaterial extends BasicMaterial<TTexture>,
  TLineMaterial extends LineMaterial,
  TPointsMaterial extends PresentationMaterial,
>(
  surface: Surface<TTexture, TGeometry, TBasicMaterial, TLineMaterial, TPointsMaterial>,
  textures: RenderPresentationTextures<TTexture> = {},
): InteractionRenderer => {
  const worldObject = new surface.Group()
  const cameraObject = new surface.Group()
  const handOverlay = createHandOverlay(surface, textures)
  const damageOverlays = createDamageOverlay(surface)
  const worldOverlays = createWorldOverlayController(surface, worldObject, textures)
  cameraObject.add(handOverlay.object, damageOverlays.flash.object, damageOverlays.direction.object)
  let isDisposed = false

  const update = (input: unknown): Result.Result<InteractionFrameResult, InteractionRendererError> => {
    if (isDisposed) {
      return Result.fail({
        _tag: 'InteractionVisualInputError',
        operation: 'interaction-frame',
        reason: 'disposed',
      })
    }
    const planned = planInteractionFrame(input)
    if (Result.isFailure(planned)) {
      return Result.fail(planned.failure)
    }
    return applyInteractionFrame({
      damageOverlays,
      frame: planned.success,
      hand: handOverlay,
      world: worldOverlays,
    })
  }

  const dispose = (): void => {
    if (isDisposed) {
      return
    }
    isDisposed = true
    worldOverlays.clear()
    disposeObject(handOverlay.object, handOverlay.arm)
    disposeObject(handOverlay.object, handOverlay.heldItem)
    cameraObject.remove(handOverlay.object)
    disposeObject(cameraObject, damageOverlays.flash)
    disposeObject(cameraObject, damageOverlays.direction)
  }

  return {
    cameraObject,
    dispose,
    sceneObject: worldObject,
    update,
  }
}
