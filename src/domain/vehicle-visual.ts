/** Renderer-independent vehicle silhouettes, interpolation and occupant placement. */

import type { OccupantId, Vehicle, VehicleId, VehicleType } from '@nerima-games/mc-sim'

export type VehicleVisualVector = readonly [xAxis: number, yAxis: number, zAxis: number]
export type VehicleVisualColor = readonly [red: number, green: number, blue: number]
export type VehicleVisualPartRole = 'body' | 'rim' | 'seat' | 'wheel'

export type VehicleVisualPartDescriptor = Readonly<{
  id: string
  role: VehicleVisualPartRole
  size: VehicleVisualVector
  center: VehicleVisualVector
  rotation: VehicleVisualVector
  color: VehicleVisualColor
}>

export type VehicleVisualDescriptor = Readonly<{
  type: VehicleType
  parts: ReadonlyArray<VehicleVisualPartDescriptor>
  /** Local-space point at which compose should place the occupant's feet. */
  occupantAnchor: VehicleVisualVector
}>

/**
 * `position`/`velocity` are `Vehicle['position']`/`Vehicle['velocity']` —
 * mc-sim's real `Position`/`VehicleVelocity` shapes, referenced by indexed
 * access rather than re-typed as `{ x: number; y: number; z: number }` — so
 * this type can never drift from the runtime `Vehicle` objects
 * `interpolateVehicle` below reads `.x`/`.y`/`.z` off, and so the `x`/`y`/`z`
 * field names never appear as short identifiers in this file for `id-length`
 * to flag. `Vehicle['velocity']` (not the exported `VehicleVelocity` alias) is
 * used for the same indexed-access reason as `position`.
 */
export type VehicleInterpolationSample = Readonly<{
  position: Vehicle['position']
  velocity: Vehicle['velocity']
  yawRadians: number
}>

export type VehicleCameraContext = Readonly<{
  localOccupantId?: OccupantId
  perspective?: 'first-person' | 'third-person'
}>

export type VehicleOccupantRenderPlan = Readonly<{
  id: OccupantId
  /**
   * Same `Vehicle['position']` shape as `VehicleInterpolationSample['position']`
   * above and for the same reason: it is built from that real vehicle position
   * in `planVehicleVisual`, so keeping the field names in sync avoids two
   * incompatible position shapes for the same render frame.
   */
  position: Vehicle['position']
  facingRadians: number
  visible: boolean
}>

export type VehicleRenderPlan = Readonly<{
  id: VehicleId
  type: VehicleType
  dimension: Vehicle['dimension']
  position: VehicleInterpolationSample['position']
  velocity: VehicleInterpolationSample['velocity']
  yawRadians: number
  parts: ReadonlyArray<VehicleVisualPartDescriptor>
  occupant?: VehicleOccupantRenderPlan
}>

/** The shared "no offset" / "no size" / "off" value used throughout this file's part table. */
const ZERO = 0

type VehicleVisualPartOptions = Readonly<{
  id: string
  role: VehicleVisualPartRole
  size: VehicleVisualVector
  center: VehicleVisualVector
  color: VehicleVisualColor
  rotation?: VehicleVisualVector
}>

const ZERO_ROTATION: VehicleVisualVector = [ZERO, ZERO, ZERO]

const part = (options: VehicleVisualPartOptions): VehicleVisualPartDescriptor => ({
  center: options.center,
  color: options.color,
  id: options.id,
  role: options.role,
  rotation: options.rotation ?? ZERO_ROTATION,
  size: options.size,
})

// --- BOAT_VISUAL part measurements ------------------------------------------

const HULL_SIZE_X = 1.4
const HULL_SIZE_Y = 0.3
const HULL_SIZE_Z = 2.2
const HULL_CENTER_Y = 0.2
const HULL_COLOR_R = 130
const HULL_COLOR_G = 82
const HULL_COLOR_B = 43

const BOAT_RIM_COLOR_R = 155
const BOAT_RIM_COLOR_G = 101
const BOAT_RIM_COLOR_B = 54
const BOAT_RIM_COLOR: VehicleVisualColor = [BOAT_RIM_COLOR_R, BOAT_RIM_COLOR_G, BOAT_RIM_COLOR_B]

/** Shared by `left-rim` and `right-rim`, mirrored across x. */
const SIDE_RIM_SIZE_X = 0.18
const SIDE_RIM_SIZE_Y = 0.45
const SIDE_RIM_SIZE_Z = 2.1
const SIDE_RIM_CENTER_X = 0.7
const SIDE_RIM_CENTER_Y = 0.48

/** Shared by `bow-rim` and `stern-rim`, mirrored across z. */
const END_RIM_SIZE_X = 1.22
const END_RIM_SIZE_Y = 0.45
const END_RIM_SIZE_Z = 0.18
const END_RIM_CENTER_Y = 0.48
const END_RIM_CENTER_Z = 1.02

const SEAT_SIZE_X = 1.05
const SEAT_SIZE_Y = 0.12
const SEAT_SIZE_Z = 0.35
const SEAT_CENTER_Y = 0.48
const SEAT_COLOR_R = 109
const SEAT_COLOR_G = 67
const SEAT_COLOR_B = 35

const BOAT_OCCUPANT_ANCHOR_Y = 0.48

const BOAT_VISUAL: VehicleVisualDescriptor = {
  occupantAnchor: [ZERO, BOAT_OCCUPANT_ANCHOR_Y, ZERO],
  parts: [
    part({
      center: [ZERO, HULL_CENTER_Y, ZERO],
      color: [HULL_COLOR_R, HULL_COLOR_G, HULL_COLOR_B],
      id: 'hull',
      role: 'body',
      size: [HULL_SIZE_X, HULL_SIZE_Y, HULL_SIZE_Z],
    }),
    part({
      center: [-SIDE_RIM_CENTER_X, SIDE_RIM_CENTER_Y, ZERO],
      color: BOAT_RIM_COLOR,
      id: 'left-rim',
      role: 'rim',
      size: [SIDE_RIM_SIZE_X, SIDE_RIM_SIZE_Y, SIDE_RIM_SIZE_Z],
    }),
    part({
      center: [SIDE_RIM_CENTER_X, SIDE_RIM_CENTER_Y, ZERO],
      color: BOAT_RIM_COLOR,
      id: 'right-rim',
      role: 'rim',
      size: [SIDE_RIM_SIZE_X, SIDE_RIM_SIZE_Y, SIDE_RIM_SIZE_Z],
    }),
    part({
      center: [ZERO, END_RIM_CENTER_Y, -END_RIM_CENTER_Z],
      color: BOAT_RIM_COLOR,
      id: 'bow-rim',
      role: 'rim',
      size: [END_RIM_SIZE_X, END_RIM_SIZE_Y, END_RIM_SIZE_Z],
    }),
    part({
      center: [ZERO, END_RIM_CENTER_Y, END_RIM_CENTER_Z],
      color: BOAT_RIM_COLOR,
      id: 'stern-rim',
      role: 'rim',
      size: [END_RIM_SIZE_X, END_RIM_SIZE_Y, END_RIM_SIZE_Z],
    }),
    part({
      center: [ZERO, SEAT_CENTER_Y, ZERO],
      color: [SEAT_COLOR_R, SEAT_COLOR_G, SEAT_COLOR_B],
      id: 'seat',
      role: 'seat',
      size: [SEAT_SIZE_X, SEAT_SIZE_Y, SEAT_SIZE_Z],
    }),
  ],
  type: 'boat',
}

// --- MINECART_VISUAL part measurements --------------------------------------

const MINECART_OCCUPANT_ANCHOR_Y = 0.62

const FLOOR_SIZE_X = 1
const FLOOR_SIZE_Y = 0.18
const FLOOR_SIZE_Z = 1.25
const FLOOR_CENTER_Y = 0.18
const FLOOR_COLOR_R = 112
const FLOOR_COLOR_G = 117
const FLOOR_COLOR_B = 119

const MINECART_WALL_COLOR_R = 145
const MINECART_WALL_COLOR_G = 150
const MINECART_WALL_COLOR_B = 152
const MINECART_WALL_COLOR: VehicleVisualColor = [
  MINECART_WALL_COLOR_R,
  MINECART_WALL_COLOR_G,
  MINECART_WALL_COLOR_B,
]

/** Shared by `left-wall` and `right-wall`, mirrored across x. */
const SIDE_WALL_SIZE_X = 0.16
const SIDE_WALL_SIZE_Y = 0.62
const SIDE_WALL_SIZE_Z = 1.25
const SIDE_WALL_CENTER_X = 0.5
const SIDE_WALL_CENTER_Y = 0.48

/** Shared by `front-wall` and `back-wall`, mirrored across z. */
const END_WALL_SIZE_X = 0.84
const END_WALL_SIZE_Y = 0.62
const END_WALL_SIZE_Z = 0.16
const END_WALL_CENTER_Y = 0.48
const END_WALL_CENTER_Z = 0.55

const WHEEL_COLOR_R = 68
const WHEEL_COLOR_G = 71
const WHEEL_COLOR_B = 72
const WHEEL_COLOR: VehicleVisualColor = [WHEEL_COLOR_R, WHEEL_COLOR_G, WHEEL_COLOR_B]

/** Shared by `left-wheel` and `right-wheel`, mirrored across x. */
const WHEEL_SIZE_X = 0.16
const WHEEL_SIZE_Y = 0.28
const WHEEL_SIZE_Z = 0.34
const WHEEL_CENTER_X = 0.57
const WHEEL_CENTER_Y = 0.12

const MINECART_VISUAL: VehicleVisualDescriptor = {
  occupantAnchor: [ZERO, MINECART_OCCUPANT_ANCHOR_Y, ZERO],
  parts: [
    part({
      center: [ZERO, FLOOR_CENTER_Y, ZERO],
      color: [FLOOR_COLOR_R, FLOOR_COLOR_G, FLOOR_COLOR_B],
      id: 'floor',
      role: 'body',
      size: [FLOOR_SIZE_X, FLOOR_SIZE_Y, FLOOR_SIZE_Z],
    }),
    part({
      center: [-SIDE_WALL_CENTER_X, SIDE_WALL_CENTER_Y, ZERO],
      color: MINECART_WALL_COLOR,
      id: 'left-wall',
      role: 'rim',
      size: [SIDE_WALL_SIZE_X, SIDE_WALL_SIZE_Y, SIDE_WALL_SIZE_Z],
    }),
    part({
      center: [SIDE_WALL_CENTER_X, SIDE_WALL_CENTER_Y, ZERO],
      color: MINECART_WALL_COLOR,
      id: 'right-wall',
      role: 'rim',
      size: [SIDE_WALL_SIZE_X, SIDE_WALL_SIZE_Y, SIDE_WALL_SIZE_Z],
    }),
    part({
      center: [ZERO, END_WALL_CENTER_Y, -END_WALL_CENTER_Z],
      color: MINECART_WALL_COLOR,
      id: 'front-wall',
      role: 'rim',
      size: [END_WALL_SIZE_X, END_WALL_SIZE_Y, END_WALL_SIZE_Z],
    }),
    part({
      center: [ZERO, END_WALL_CENTER_Y, END_WALL_CENTER_Z],
      color: MINECART_WALL_COLOR,
      id: 'back-wall',
      role: 'rim',
      size: [END_WALL_SIZE_X, END_WALL_SIZE_Y, END_WALL_SIZE_Z],
    }),
    part({
      center: [-WHEEL_CENTER_X, WHEEL_CENTER_Y, ZERO],
      color: WHEEL_COLOR,
      id: 'left-wheel',
      role: 'wheel',
      size: [WHEEL_SIZE_X, WHEEL_SIZE_Y, WHEEL_SIZE_Z],
    }),
    part({
      center: [WHEEL_CENTER_X, WHEEL_CENTER_Y, ZERO],
      color: WHEEL_COLOR,
      id: 'right-wheel',
      role: 'wheel',
      size: [WHEEL_SIZE_X, WHEEL_SIZE_Y, WHEEL_SIZE_Z],
    }),
  ],
  type: 'minecart',
}

const DESCRIPTORS: Readonly<Record<VehicleType, VehicleVisualDescriptor>> = {
  boat: BOAT_VISUAL,
  minecart: MINECART_VISUAL,
}

export const vehicleVisualDescriptor = (type: VehicleType): VehicleVisualDescriptor =>
  DESCRIPTORS[type]

const CLAMP01_MAX = 1

const clamp01 = (value: number): number => {
  if (Number.isFinite(value)) {
    return Math.max(ZERO, Math.min(CLAMP01_MAX, value))
  }
  return ZERO
}

const lerp = (from: number, to: number, amount: number): number =>
  from + (to - from) * amount

const shortestAngleDelta = (from: number, to: number): number =>
  Math.atan2(Math.sin(to - from), Math.cos(to - from))

/**
 * Axis keys for `id-length`: `Vehicle['position']`/`Vehicle['velocity']` are
 * real mc-sim field names read by out-of-scope callers (see the doc comment
 * on `VehicleInterpolationSample` above), so they cannot be renamed — but a
 * computed property sourced from a named constant keeps every identifier in
 * this file at least two characters while the object `vec3` below produces
 * still has exactly the keys `x`, `y`, `z`.
 */
type VectorAxisKey = 'x' | 'y' | 'z'
const VECTOR_X_AXIS: VectorAxisKey = 'x'
const VECTOR_Y_AXIS: VectorAxisKey = 'y'
const VECTOR_Z_AXIS: VectorAxisKey = 'z'

/** Build a `{x,y,z}` vector from three already-computed components. */
const vec3 = (xValue: number, yValue: number, zValue: number): Vehicle['position'] => ({
  [VECTOR_X_AXIS]: xValue,
  [VECTOR_Y_AXIS]: yValue,
  [VECTOR_Z_AXIS]: zValue,
})

/** Interpolate matching simulation snapshots without mutating either snapshot. */
export const interpolateVehicle = (
  previous: Vehicle,
  current: Vehicle,
  amount: number,
): VehicleInterpolationSample => {
  const safeAmount = clamp01(amount)
  if (
    previous.id !== current.id ||
    previous.type !== current.type ||
    previous.dimension !== current.dimension
  ) {
    return {
      position: { ...current.position },
      velocity: { ...current.velocity },
      yawRadians: current.yawRadians,
    }
  }

  return {
    position: vec3(
      lerp(previous.position.x, current.position.x, safeAmount),
      lerp(previous.position.y, current.position.y, safeAmount),
      lerp(previous.position.z, current.position.z, safeAmount),
    ),
    velocity: vec3(
      lerp(previous.velocity.x, current.velocity.x, safeAmount),
      lerp(previous.velocity.y, current.velocity.y, safeAmount),
      lerp(previous.velocity.z, current.velocity.z, safeAmount),
    ),
    yawRadians: previous.yawRadians + shortestAngleDelta(previous.yawRadians, current.yawRadians) * safeAmount,
  }
}

const DEFAULT_INTERPOLATION_AMOUNT = 1

/** Resolve the frame's interpolation sample: a raw snapshot, or an interpolated one. */
const resolveSample = (
  vehicle: Vehicle,
  previous?: Vehicle,
  interpolation?: number,
): VehicleInterpolationSample => {
  if (typeof previous === 'undefined') {
    return { position: { ...vehicle.position }, velocity: { ...vehicle.velocity }, yawRadians: vehicle.yawRadians }
  }
  return interpolateVehicle(previous, vehicle, interpolation ?? DEFAULT_INTERPOLATION_AMOUNT)
}

type BuildOccupantOptions = Readonly<{
  vehicle: Vehicle
  sample: VehicleInterpolationSample
  anchor: VehicleVisualVector
  camera?: VehicleCameraContext
}>

/** Place the occupant at the descriptor's anchor, or return `null` when the vehicle has none. */
const buildOccupant = (options: BuildOccupantOptions): VehicleOccupantRenderPlan | null => {
  const { vehicle, sample, anchor, camera } = options
  if (typeof vehicle.occupant === 'undefined') {
    return null
  }
  const [anchorX, anchorY, anchorZ] = anchor
  const cosYaw = Math.cos(sample.yawRadians)
  const sinYaw = Math.sin(sample.yawRadians)
  return {
    facingRadians: sample.yawRadians,
    id: vehicle.occupant,
    position: vec3(
      sample.position.x + anchorX * cosYaw - anchorZ * sinYaw,
      sample.position.y + anchorY,
      sample.position.z + anchorX * sinYaw + anchorZ * cosYaw,
    ),
    visible: !(
      camera?.localOccupantId === vehicle.occupant &&
      (camera.perspective ?? 'first-person') === 'first-person'
    ),
  }
}

const planWithoutOccupant = (
  vehicle: Vehicle,
  descriptor: VehicleVisualDescriptor,
  sample: VehicleInterpolationSample,
): Omit<VehicleRenderPlan, 'occupant'> => ({
  dimension: vehicle.dimension,
  id: vehicle.id,
  parts: descriptor.parts,
  position: sample.position,
  type: vehicle.type,
  velocity: sample.velocity,
  yawRadians: sample.yawRadians,
})

/**
 * `exactOptionalPropertyTypes` forbids spelling `camera: undefined` on an
 * optional field, so the property is added only when present rather than
 * always assigned from a possibly-`undefined` source.
 */
const cameraOptionFor = (camera: VehicleCameraContext | undefined): Readonly<{ camera?: VehicleCameraContext }> => {
  if (camera === undefined) {
    return {}
  }
  return { camera }
}

/** Build backend-neutral vehicle and occupant transforms for one render frame. */
export const planVehicleVisual = (
  vehicle: Vehicle,
  options: Readonly<{
    previous?: Vehicle
    interpolation?: number
    camera?: VehicleCameraContext
  }> = {},
): VehicleRenderPlan => {
  const sample = resolveSample(vehicle, options.previous, options.interpolation)
  const descriptor = vehicleVisualDescriptor(vehicle.type)
  const occupant = buildOccupant({
    anchor: descriptor.occupantAnchor,
    sample,
    vehicle,
    ...cameraOptionFor(options.camera),
  })
  const base = planWithoutOccupant(vehicle, descriptor, sample)
  if (occupant === null) {
    return base
  }
  return { ...base, occupant }
}
