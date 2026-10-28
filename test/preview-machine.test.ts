import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref, Result } from 'effect'
import { MonotonicTimeSecs, PositionAxis, position } from '@nerima-games/mc-kernel'
import { cameraPoseOf } from '@nerima-games/mc-sim'
import { makeMachine, makePreviewPlayerService } from '../apps/preview-render/machine'

const makeMirrorMachine = () => makeMachine({ scenario: 'mirror-staleness', lockPort: 'unavailable' })

describe('preview render machine camera lifecycle', () => {
  it.effect('preserves position input errors from injected preview commands', () =>
    Effect.gen(function* () {
      const machine = yield* makeMirrorMachine()
      const error = yield* Effect.result(
        machine.inject({ kind: 'publishPose', x: Number.NaN, y: 0, z: 0 }),
      )

      expect(Result.isFailure(error)).toBe(true)
      if (Result.isFailure(error)) {
        expect(error.failure).toMatchObject({
          _tag: 'PlayerServiceInputError',
          reason: 'invalid-position',
          field: 'feetPosition.x',
        })
      }
      expect((yield* machine.view()).poseNeverPublished).toBe(true)
    }),
  )

  it.effect('maps applyLook failures and keeps the prior pose', () =>
    Effect.gen(function* () {
      const capturedAt = yield* Ref.make<MonotonicTimeSecs | undefined>(undefined)
      const player = yield* makePreviewPlayerService(capturedAt)
      const initial = yield* player.pose
      yield* player.restore(
        { ...initial, yawRadians: Number.MAX_VALUE },
        'overworld',
      )
      const before = yield* player.pose
      const invalidLook = yield* Effect.result(player.look(Number.MAX_VALUE, 0))

      expect(Result.isFailure(invalidLook)).toBe(true)
      if (Result.isFailure(invalidLook)) {
        expect(invalidLook.failure).toMatchObject({
          _tag: 'PlayerServiceInputError',
          reason: 'invalid-look',
          field: 'yawRadians',
        })
      }
      expect(yield* player.pose).toStrictEqual(before)
    }),
  )

  it('returns a Result failure for an invalid camera pose', () => {
    const result = cameraPoseOf(
      {
        feetPosition: position(PositionAxis(0), PositionAxis(0), PositionAxis(0)),
        yawRadians: Number.NaN,
        pitchRadians: 0,
      },
      MonotonicTimeSecs(0),
    )

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ _tag: 'BrandError' })
    }
  })

  it.effect('keeps the initial view pending before the first pose publication', () =>
    Effect.gen(function* () {
      const machine = yield* makeMirrorMachine()
      const first = yield* machine.view()
      const second = yield* machine.view()

      expect(first.poseNeverPublished).toBe(true)
      expect(first.playerPose).toBeUndefined()
      expect(first.mirrorLag).toBeUndefined()
      expect(first.mirrorStale).toBe(false)
      expect(second).toStrictEqual(first)
    }),
  )

  it.effect('mirrors a published position, yaw, and pitch during advance', () =>
    Effect.gen(function* () {
      const machine = yield* makeMirrorMachine()
      yield* machine.inject({
        kind: 'publishPose',
        x: 4,
        y: 10,
        z: -2,
        yawRadians: 0.75,
        pitchRadians: -0.25,
      })

      const beforeFrame = yield* machine.view()
      expect(beforeFrame.playerPose).toBeUndefined()
      expect(beforeFrame.mirrorLag).toBeUndefined()

      yield* machine.advance(1)
      const afterFrame = yield* machine.view()
      expect(afterFrame.poseNeverPublished).toBe(false)
      expect(afterFrame.playerPose?.position).toMatchObject({ x: 4, z: -2 })
      expect(afterFrame.playerPose?.position.y).toBeCloseTo(11.62, 10)
      expect(afterFrame.playerPose?.yawRadians).toBe(0.75)
      expect(afterFrame.playerPose?.pitchRadians).toBe(-0.25)
      expect(afterFrame.playerPose?.capturedAtSecs).toBe(0)
      expect(afterFrame.mirrored.position.x).toBe(4)
      expect(afterFrame.mirrored.position.y).toBeCloseTo(11.62, 10)
      expect(afterFrame.mirrored.position.z).toBe(-2)
      expect(afterFrame.mirrored.rotation).toStrictEqual({ x: -0.25, y: 0.75, z: 0, order: 'YXZ' })
      expect(afterFrame.mirrorLag).toBe(0)
    }),
  )

  it.effect('updates stale status from the injected clock at a frame boundary', () =>
    Effect.gen(function* () {
      const machine = yield* makeMachine({ scenario: 'rebinding', lockPort: 'unavailable' })
      yield* machine.inject({ kind: 'publishPose', x: 1, y: 2, z: 3 })
      yield* machine.advance(1)
      yield* machine.inject({ kind: 'advanceClock', seconds: 0.2 })
      yield* machine.advance(1)

      const view = yield* machine.view()
      expect(view.mirrorLag).toBeCloseTo(0.2, 10)
      expect(view.mirrorStale).toBe(true)
    }),
  )

  it.effect('does not change calculated camera state when view is repeated', () =>
    Effect.gen(function* () {
      const machine = yield* makeMirrorMachine()
      yield* machine.inject({ kind: 'publishPose', x: 7, y: 8, z: 9, yawRadians: 0.4, pitchRadians: 0.2 })
      yield* machine.advance(1)

      const before = yield* machine.view()
      const after = yield* machine.view()
      expect(after).toStrictEqual(before)
    }),
  )
})
