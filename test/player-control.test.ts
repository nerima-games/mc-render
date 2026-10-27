import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { NO_PLAYER_CONTROL } from '../src/domain/player-control.js'

describe('NO_PLAYER_CONTROL', () => {
  it.effect('accepts movement and jump intents without changing control state', () =>
    Effect.gen(function* () {
      const movement = yield* NO_PLAYER_CONTROL.setMovementIntent({ forward: 1, strafe: -1 })
      const jump = yield* NO_PLAYER_CONTROL.setJumpIntent(true)

      expect(movement).toBeUndefined()
      expect(jump).toBeUndefined()
    }),
  )
})
