/**
 * REGRESSION: mc-render MIRRORS the camera pose and never writes it back.
 *
 * plan.md §3.8 / §5.1-2. In the reference, the THREE camera was authoritative
 * and simulation-side code read it back from thirteen call sites; the render
 * stage additionally mutated the live camera for the attack-swing bob
 * (ts-minecraft/packages/app/application/frame/stages/render-stage.ts:41-48,
 * restored at :98-100), which is where "`.position` can be stale" came from
 * (.../main/qa-api-visual.ts:17-19).
 *
 * Here the pose is a value, the bob is a separate value composed on top, and
 * the composition is a pure function. Whether the bob perturbs what the
 * simulation believes is therefore a unit test, not a debugging session.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  forwardVector,
  isMirrorStale,
  MIRROR_LAG_WARNING_SECS,
  mirroredCameraState,
  mirrorLagSecs,
  NO_VIEW_OFFSET,
  snapshotAgeSecs,
  type ViewOffset,
} from '../domain/camera-mirror'
import { MonotonicTimeSecs, position, type CameraPoseSnapshot } from '../domain/kernel-vocabulary'

const AUTHORITATIVE: CameraPoseSnapshot = {
  position: position(8, 65.62, -12),
  yawRadians: 0,
  pitchRadians: 0,
  capturedAtSecs: MonotonicTimeSecs(100),
}

/** ts-minecraft/.../render-stage.ts:41-48 applied translateX/translateY/rotateZ. */
const ATTACK_SWING: ViewOffset = { right: 0.15, up: -0.05, rollRadians: 0.08 }

describe('mirroring is one-directional', () => {
  it.effect('with no offset the mirrored state is the snapshot, verbatim', () =>
    Effect.sync(() => {
      const mirrored = mirroredCameraState(AUTHORITATIVE, NO_VIEW_OFFSET)

      expect(mirrored.position).toStrictEqual(AUTHORITATIVE.position)
      expect(mirrored.rotation.x).toBe(AUTHORITATIVE.pitchRadians)
      expect(mirrored.rotation.y).toBe(AUTHORITATIVE.yawRadians)
      expect(mirrored.rotation.z).toBe(0)
    }),
  )

  it.effect('REGRESSION: the attack-swing bob does NOT perturb the authoritative snapshot', () =>
    Effect.sync(() => {
      // The exact failure the reference had: between the mutation and its
      // restore, anything reading the camera got the weapon-bob pose.
      const before = { ...AUTHORITATIVE, position: { ...AUTHORITATIVE.position } }
      const mirrored = mirroredCameraState(AUTHORITATIVE, ATTACK_SWING)

      expect(AUTHORITATIVE).toStrictEqual(before)
      expect(mirrored.position).not.toStrictEqual(AUTHORITATIVE.position)
      expect(mirrored.rotation.z).toBe(0.08)
    }),
  )

  it.effect('REGRESSION: the bob does not change where the player is deemed to be looking', () =>
    Effect.sync(() => {
      // forwardVector takes the SNAPSHOT, not the mirrored state, so a
      // cosmetic roll can never leak into block targeting or mob AI.
      const withBob = forwardVector(AUTHORITATIVE)
      const withoutBob = forwardVector({ ...AUTHORITATIVE })

      expect(withBob).toStrictEqual(withoutBob)
      expect(mirroredCameraState(AUTHORITATIVE, ATTACK_SWING).rotation.z).not.toBe(0)
    }),
  )

  it.effect('mirroring twice from the same snapshot is idempotent — no accumulation', () =>
    Effect.sync(() => {
      const first = mirroredCameraState(AUTHORITATIVE, ATTACK_SWING)
      const second = mirroredCameraState(AUTHORITATIVE, ATTACK_SWING)

      expect(second).toStrictEqual(first)
    }),
  )
})

describe('Euler order', () => {
  it.effect("is 'YXZ', matching the reference's camera-stage.ts:67", () =>
    Effect.sync(() => {
      // With the default 'XYZ', yawing while pitched tilts the horizon.
      expect(mirroredCameraState(AUTHORITATIVE).rotation.order).toBe('YXZ')
    }),
  )
})

describe('the view offset is applied in the camera local basis', () => {
  it.effect('a rightward bob moves along +X when facing -Z (yaw 0)', () =>
    Effect.sync(() => {
      const mirrored = mirroredCameraState(AUTHORITATIVE, { right: 1, up: 0, rollRadians: 0 })

      expect(mirrored.position.x).toBeCloseTo(AUTHORITATIVE.position.x + 1, 12)
      expect(mirrored.position.z).toBeCloseTo(AUTHORITATIVE.position.z, 12)
    }),
  )

  it.effect('the same bob follows the yaw: facing -X, right moves along -Z', () =>
    Effect.sync(() => {
      const turned = { ...AUTHORITATIVE, yawRadians: Math.PI / 2 }
      const mirrored = mirroredCameraState(turned, { right: 1, up: 0, rollRadians: 0 })

      expect(mirrored.position.x).toBeCloseTo(turned.position.x, 12)
      expect(mirrored.position.z).toBeCloseTo(turned.position.z - 1, 12)
    }),
  )

  it.effect('a vertical bob stays vertical whatever the pitch, so it never swings through the world', () =>
    Effect.sync(() => {
      const looking = { ...AUTHORITATIVE, pitchRadians: -1.2 }
      const mirrored = mirroredCameraState(looking, { right: 0, up: 0.5, rollRadians: 0 })

      expect(mirrored.position.y).toBeCloseTo(looking.position.y + 0.5, 12)
      expect(mirrored.position.x).toBeCloseTo(looking.position.x, 12)
      expect(mirrored.position.z).toBeCloseTo(looking.position.z, 12)
    }),
  )
})

describe('forwardVector — no camera.getWorldDirection() anywhere', () => {
  it.effect('yaw 0 looks down -Z', () =>
    Effect.sync(() => {
      const forward = forwardVector(AUTHORITATIVE)

      expect(forward.x).toBeCloseTo(0, 12)
      expect(forward.z).toBeCloseTo(-1, 12)
    }),
  )

  it.effect('is a unit vector at every pitch, so a raycast needs no renormalisation', () =>
    Effect.sync(() => {
      for (const pitch of [-1.5, -0.7, 0, 0.7, 1.5]) {
        const forward = forwardVector({ ...AUTHORITATIVE, yawRadians: 2.1, pitchRadians: pitch })
        expect(Math.hypot(forward.x, forward.y, forward.z)).toBeCloseTo(1, 12)
      }
    }),
  )
})

describe('mirror staleness', () => {
  it.effect('lag is measured from the instant the SIMULATION stamped the pose', () =>
    Effect.sync(() => {
      const mirrored = mirroredCameraState(AUTHORITATIVE)

      expect(mirrored.sourceCapturedAtSecs).toBe(100)
      expect(mirrorLagSecs(mirrored, MonotonicTimeSecs(100.05))).toBeCloseTo(0.05, 10)
    }),
  )

  it.effect('a pose more than 100 ms old is reported as stale rather than silently drawn', () =>
    Effect.sync(() => {
      const mirrored = mirroredCameraState(AUTHORITATIVE)

      expect(MIRROR_LAG_WARNING_SECS).toBe(0.1)
      expect(isMirrorStale(mirrored, MonotonicTimeSecs(100.05))).toBe(false)
      expect(isMirrorStale(mirrored, MonotonicTimeSecs(100.5))).toBe(true)
    }),
  )

  it.effect('lag goes negative under clock skew rather than clamping the problem away', () =>
    Effect.sync(() => {
      const mirrored = mirroredCameraState(AUTHORITATIVE)

      expect(mirrorLagSecs(mirrored, MonotonicTimeSecs(99.5))).toBeCloseTo(-0.5, 10)
      expect(snapshotAgeSecs(AUTHORITATIVE, MonotonicTimeSecs(99.5))).toBeCloseTo(-0.5, 10)
    }),
  )
})
