import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { makeMachine } from '../apps/preview-render/machine'

const makeMirrorMachine = () =>
  Effect.promise(() => makeMachine({ scenario: 'mirror-staleness', lockPort: 'unavailable' }))

describe('preview render machine camera lifecycle', () => {
  it.effect('keeps the initial view pending before the first pose publication', () =>
    Effect.gen(function* () {
      const machine = yield* makeMirrorMachine()
      const first = yield* Effect.promise(() => machine.view())
      const second = yield* Effect.promise(() => machine.view())

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
      yield* Effect.promise(() =>
        machine.inject({
          kind: 'publishPose',
          x: 4,
          y: 10,
          z: -2,
          yawRadians: 0.75,
          pitchRadians: -0.25,
        }),
      )

      const beforeFrame = yield* Effect.promise(() => machine.view())
      expect(beforeFrame.playerPose).toBeUndefined()
      expect(beforeFrame.mirrorLag).toBeUndefined()

      yield* Effect.promise(() => machine.advance(1))
      const afterFrame = yield* Effect.promise(() => machine.view())
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
      const machine = yield* Effect.promise(() =>
        makeMachine({ scenario: 'rebinding', lockPort: 'unavailable' }),
      )
      yield* Effect.promise(() => machine.inject({ kind: 'publishPose', x: 1, y: 2, z: 3 }))
      yield* Effect.promise(() => machine.advance(1))
      yield* Effect.promise(() => machine.inject({ kind: 'advanceClock', seconds: 0.2 }))
      yield* Effect.promise(() => machine.advance(1))

      const view = yield* Effect.promise(() => machine.view())
      expect(view.mirrorLag).toBeCloseTo(0.2, 10)
      expect(view.mirrorStale).toBe(true)
    }),
  )

  it.effect('does not change calculated camera state when view is repeated', () =>
    Effect.gen(function* () {
      const machine = yield* makeMirrorMachine()
      yield* Effect.promise(() =>
        machine.inject({ kind: 'publishPose', x: 7, y: 8, z: 9, yawRadians: 0.4, pitchRadians: 0.2 }),
      )
      yield* Effect.promise(() => machine.advance(1))

      const before = yield* Effect.promise(() => machine.view())
      const after = yield* Effect.promise(() => machine.view())
      expect(after).toStrictEqual(before)
    }),
  )
})
