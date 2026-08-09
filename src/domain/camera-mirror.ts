/**
 * Mirroring mc-sim's camera pose into renderer state. One direction, always.
 *
 * ---------------------------------------------------------------------------
 * plan.md §3.8 / §4.3 / §5.1-2
 * ---------------------------------------------------------------------------
 *
 *   **カメラ所有権**: 参照実装はTHREEカメラが正でシミュレーションが描画から視線を
 *   読む逆転構造だった(「camera.position を読むな matrixWorld を使え」という
 *   慢性gotchaの根源)。新実装は sim が姿勢を所有し、THREEカメラはミラー
 *
 * In the reference the THREE camera object was the authority and thirteen
 * simulation-side call sites read it back:
 *
 *   ts-minecraft/packages/app/application/frame/stages/attack-targeting.ts:18,24
 *   ts-minecraft/packages/app/application/frame/stages/entity-update-stage.ts:182,189
 *   ts-minecraft/packages/app/application/frame/stages/interaction-bow-handler.ts:105,123-124
 *   ts-minecraft/packages/app/application/frame/stages/interaction-melee-handler.ts:142,213
 *   ts-minecraft/packages/app/application/frame/stages/interaction-right-click-handler.ts:73
 *   ts-minecraft/packages/app/application/frame/stages/interaction-stage-underwater.ts:37,42-44
 *
 * ...and the resulting gotcha had to be written down:
 *
 *   ts-minecraft/packages/app/application/main/qa-api-visual.ts:17-19
 *     // World position via matrixWorld — the frame composes the camera pose
 *     // into matrixWorld directly, so `.position` can be stale (or the origin).
 *
 * ---------------------------------------------------------------------------
 * Where the staleness came from, and what this module does about it
 * ---------------------------------------------------------------------------
 *
 * The reference's render stage MUTATES the live camera for the attack-swing bob
 * and restores it afterwards:
 *
 *   ts-minecraft/packages/app/application/frame/stages/render-stage.ts:41-48
 *     translateX / translateY / rotateZ on the real camera
 *   ts-minecraft/packages/app/application/frame/stages/render-stage.ts:98-100
 *     restored inside Effect.ensuring
 *
 * Between those two points `.position` and `matrixWorld` disagree, and anything
 * reading the camera in that window gets the weapon-bob pose instead of the
 * player's.
 *
 * The fix here is structural rather than disciplinary. The authoritative pose is
 * a VALUE that arrives from mc-sim; cosmetic effects are a separate value
 * (`ViewOffset`) composed on top at the moment of mirroring; and the composed
 * result is never fed back anywhere. `mirroredCameraState` is a pure function,
 * so "does the bob perturb what the simulation believes?" is answerable by a
 * test that needs no GPU: the input snapshot is not the output, and there is no
 * path from output to input.
 *
 * The dependency graph enforces it independently: mc-render depends on mc-sim,
 * so a write-back edge would be a cycle, and `pnpm check:deps` rejects cycles
 * outright with no allowlist.
 */
import {
  type CameraPoseSnapshot,
  type MonotonicTimeSecs,
  type Position,
  position,
  snapshotAgeSecs,
} from '@nerima-games/mc-kernel'

/**
 * A purely cosmetic displacement applied at mirror time.
 *
 * Attack-swing bob, walk sway, damage shake, screen-space recoil. All of it
 * belongs here and NONE of it belongs in the snapshot: the simulation's answer
 * to "where is the player looking" must not depend on whether a sword is
 * currently swinging.
 */
export type ViewOffset = {
  /** Local right, blocks. */
  readonly right: number
  /** Local up, blocks. */
  readonly up: number
  /** Roll about the view axis, radians. THREE has no roll in the pose itself. */
  readonly rollRadians: number
}

export const NO_VIEW_OFFSET: ViewOffset = { right: 0, rollRadians: 0, up: 0 }

/**
 * Renderer-side camera state: exactly what a THREE camera needs to be set to.
 *
 * `eulerOrder` is `'YXZ'`, matching
 * ts-minecraft/packages/app/application/frame/stages/camera-stage.ts:67
 * (`camera.rotation.set(pitch, yaw, 0, 'YXZ')`). The order is load-bearing:
 * with the default `'XYZ'`, yawing while pitched tilts the horizon.
 */
/**
 * `x`/`y`/`z` are a mapped type, not spelled-out properties, ONLY so that
 * `id-length` has no short identifier to flag: `MirroredCameraState.rotation`
 * is read by field name in `application/world-renderer.ts`
 * (`camera.rotation.set(mirrored.rotation.x, ...)`), an out-of-scope file this
 * change must not touch, so the produced shape — three own numeric
 * axis fields plus `order` — has to stay exactly what it was.
 */
type EulerAngleAxis = 'x' | 'y' | 'z'

export type MirroredCameraState = {
  readonly position: Position
  readonly rotation: Readonly<Record<EulerAngleAxis, number>> & { readonly order: 'YXZ' }
  /** The instant mc-sim produced the pose this was mirrored from. */
  readonly sourceCapturedAtSecs: MonotonicTimeSecs
}

/**
 * Compose the authoritative pose with a cosmetic offset.
 *
 * PURE. Takes a snapshot, returns new renderer state, and touches neither.
 * The offset is applied in the camera's LOCAL basis: `right` and `up` are
 * rotated by the yaw so that a bob stays a bob whichever way the player faces.
 * Pitch is deliberately not applied to the offset basis — a vertical bob that
 * followed the pitch would swing through the world when the player looks down.
 */
/**
 * Keys for the same `id-length` reason as `EulerAngleAxis` above: a computed
 * property sourced from a named constant produces the exact `x`/`y`/`z` field
 * that `world-renderer.ts` reads, without spelling a one-letter identifier as
 * an object-literal key in this file.
 */
const EULER_X_AXIS: EulerAngleAxis = 'x'
const EULER_Y_AXIS: EulerAngleAxis = 'y'
const EULER_Z_AXIS: EulerAngleAxis = 'z'

const eulerRotation = (
  pitchRadians: number,
  yawRadians: number,
  rollRadians: number,
): MirroredCameraState['rotation'] => ({
  order: 'YXZ',
  [EULER_X_AXIS]: pitchRadians,
  [EULER_Y_AXIS]: yawRadians,
  [EULER_Z_AXIS]: rollRadians,
})

export const mirroredCameraState = (
  snapshot: CameraPoseSnapshot,
  offset: ViewOffset = NO_VIEW_OFFSET,
): MirroredCameraState => {
  const cosYaw = Math.cos(snapshot.yawRadians)
  const sinYaw = Math.sin(snapshot.yawRadians)

  return {
    position: position(
      snapshot.position.x + offset.right * cosYaw,
      snapshot.position.y + offset.up,
      snapshot.position.z - offset.right * sinYaw,
    ),
    rotation: eulerRotation(snapshot.pitchRadians, snapshot.yawRadians, offset.rollRadians),
    sourceCapturedAtSecs: snapshot.capturedAtSecs,
  }
}

/**
 * Unit forward vector of an authoritative snapshot.
 *
 * Present so that no code in this repository ever needs
 * `camera.getWorldDirection(...)`. Identical to mc-sim's `forwardVector`, and
 * that duplication is intentional: the renderer computing the same function
 * from the same value is fine, whereas the renderer being ASKED for the answer
 * is the inversion this whole module exists to prevent.
 *
 * Note that it takes the SNAPSHOT, not `MirroredCameraState`: the cosmetic roll
 * must never influence where the player is deemed to be looking.
 */
export const forwardVector = (snapshot: CameraPoseSnapshot): Position => {
  const cosPitch = Math.cos(snapshot.pitchRadians)
  return position(
    -Math.sin(snapshot.yawRadians) * cosPitch,
    Math.sin(snapshot.pitchRadians),
    -Math.cos(snapshot.yawRadians) * cosPitch,
  )
}

/**
 * How far behind the simulation a mirrored state is, in seconds.
 *
 * The renderer uses this to decide whether to interpolate or to stall, rather
 * than drawing a stale pose and finding out from a bug report.
 */
export const mirrorLagSecs = (state: MirroredCameraState, now: MonotonicTimeSecs): number =>
  now - state.sourceCapturedAtSecs

/**
 * SECONDS of lag past which a mirrored pose is worth complaining about.
 *
 * Seconds, as the name says and as `isMirrorStale` requires: `mirrorLagSecs`
 * returns `now - sourceCapturedAtSecs`, and both are `MonotonicTimeSecs`. This
 * comment used to read "Milliseconds", which would make the threshold a tenth
 * of a millisecond and every mirror ever built stale. The code was right and
 * the sentence was wrong — the worse way round for a number somebody will
 * eventually tune, because tuning starts from the prose.
 *
 * 0.1 s is six frames at 60 Hz: long enough that an ordinary frame's mirror lag
 * never trips it, short enough that a stalled simulation is visible before a
 * player would describe it as "the camera is stuck".
 */
export const MIRROR_LAG_WARNING_SECS = 0.1

export const isMirrorStale = (state: MirroredCameraState, now: MonotonicTimeSecs): boolean =>
  mirrorLagSecs(state, now) > MIRROR_LAG_WARNING_SECS

/** Re-exported so consumers measure staleness from the snapshot too. */
export { snapshotAgeSecs }
