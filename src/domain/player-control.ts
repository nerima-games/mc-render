import { Effect } from 'effect'

export type MovementIntent = {
  readonly forward: number
  readonly strafe: number
}

/** Structural port from device input to the simulation's player controller. */
export type PlayerControlPort = {
  readonly setMovementIntent: (intent: MovementIntent) => Effect.Effect<void>
  readonly setJumpIntent: (pressed: boolean) => Effect.Effect<void>
}

export const NO_PLAYER_CONTROL: PlayerControlPort = {
  setMovementIntent: () => Effect.succeed(undefined),
  setJumpIntent: () => Effect.succeed(undefined),
}
