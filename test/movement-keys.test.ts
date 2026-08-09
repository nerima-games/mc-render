/**
 * PORTED E2E: the sprint key and the jump key.
 *
 * Reference: ts-minecraft/e2e/gameplay/player-controls.e2e.ts
 *   `sprint key (ControlLeft) does not crash game` (:206-242)
 *   `jump key (Space) does not crash game`         (:244-266)
 *
 * mc-compose/docs/e2e-triage.md §3.5 rows #23 and #24 send both here, with the
 * one-line reason "mc-render の入力バインディングテスト。ブラウザ不要" — these are
 * binding tests, and a binding needs no browser.
 *
 * ---------------------------------------------------------------------------
 * What the reference could ask, and what it meant to ask
 * ---------------------------------------------------------------------------
 *
 * Both reference tests assert the same two things: the FPS counter is still
 * above zero afterwards, and no fatal error reached the console. The sprint
 * test says out loud why it settles for that:
 *
 *   // Pointer lock is unavailable in headless mode, so there is no
 *   // camera-delta to measure.
 *
 * So the browser could deliver the key and could observe only that the frame
 * loop survived it. "Sprint works" was never asserted; it was inferred from the
 * game not falling over. That is the whole reason plan.md §3.10 exists.
 *
 * Here the `InputService` is a `Ref`-backed state machine fed through
 * `dispatch`, so the question the reference wanted to ask — did holding Control
 * while walking forward actually leave the player sprinting AND walking — is a
 * direct read. The tests below ask that instead of asking about FPS, because
 * FPS is mc-compose's question (triage rows #25-#28) and was only ever this
 * test's proxy for it.
 *
 * ---------------------------------------------------------------------------
 * What breaks in the game if these go red
 * ---------------------------------------------------------------------------
 *
 * A modifier key is the one key a binding layer is most likely to mishandle,
 * because every layer above it treats Control as a decoration on another key
 * rather than as a key. Get it wrong and the player holds W to run, presses
 * Control to sprint, and stops dead — the sprint is applied and the forward
 * motion is gone, on the exact input the player uses most.
 *
 * Space fails the other way. An edge that re-fires while the key is held is a
 * player who jumps on every frame the bar is down, which is not a jump: it is
 * flight, and it is how a survival world stops being one.
 */
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import {
  actionForKey,
  bindingFor,
  defaultBindings,
  GAMEPLAY_LISTENER_TARGET,
  type KeyCode,
} from '../src/domain/input-bindings'
import { makeInputService, type InputEvent } from '../src/application/input-service'

const SPRINT_KEY: KeyCode = 'ControlLeft'
const JUMP_KEY: KeyCode = 'Space'
const FORWARD_KEY: KeyCode = 'KeyW'

/**
 * The reference pressed these through `page.keyboard`, which reaches the
 * gameplay listener on `window`. `GAMEPLAY_LISTENER_TARGET` is the same
 * statement without the browser — a key tagged `document` is one a modal
 * consumed, and the service is required to ignore it.
 */
const down = (code: KeyCode): InputEvent => ({
  kind: 'keydown',
  code,
  target: GAMEPLAY_LISTENER_TARGET,
})

const up = (code: KeyCode): InputEvent => ({
  kind: 'keyup',
  code,
  target: GAMEPLAY_LISTENER_TARGET,
})

describe('sprint (ControlLeft)', () => {
  it.effect('ControlLeft means sprint, and it is the only thing it means', () =>
    Effect.sync(() => {
      const bindings = defaultBindings()

      expect(bindingFor(bindings, 'sprint')).toBe(SPRINT_KEY)
      expect(actionForKey(bindings, SPRINT_KEY)).toBe('sprint')
    }),
  )

  it.effect('a modifier key reaches the service like any other key', () =>
    Effect.gen(function* () {
      // The reference could only observe this as "the game did not crash while
      // Control was down". A modifier that the binding layer swallows — because
      // something upstream treated it as a decoration on the next key rather
      // than as a key of its own — produces exactly that same non-crash.
      const input = yield* makeInputService()

      yield* input.dispatch(down(SPRINT_KEY))

      expect(yield* input.isActionActive('sprint')).toBe(true)
      expect(yield* input.wasActionJustTriggered('sprint')).toBe(true)
      expect((yield* input.snapshot).pressed.has(SPRINT_KEY)).toBe(true)
    }),
  )

  it.effect('sprint and forward are held TOGETHER, not one instead of the other', () =>
    Effect.gen(function* () {
      // The reference's gesture, in its order:
      //   keyboard.down('Control'); keyboard.down('w')
      // If the chord displaced the movement key the player would press sprint
      // and stop walking — the most-used input in the game, broken by the
      // second-most-used.
      const input = yield* makeInputService()

      yield* input.dispatch(down(SPRINT_KEY))
      yield* input.dispatch(down(FORWARD_KEY))

      expect(yield* input.isActionActive('sprint')).toBe(true)
      expect(yield* input.isActionActive('moveForward')).toBe(true)
    }),
  )

  it.effect('the hold survives frame boundaries; only its edge is spent', () =>
    Effect.gen(function* () {
      // `holdKey(page, 'KeyW', 600)` in the reference spans dozens of frames.
      // A level cleared at the frame boundary would make a held key a single
      // step, so the player taps forward and travels one frame's worth.
      const input = yield* makeInputService()

      yield* input.dispatch(down(SPRINT_KEY))
      yield* input.dispatch(down(FORWARD_KEY))

      for (let frame = 0; frame < 5; frame += 1) {
        yield* input.endFrame()
        // The browser repeats keydown for a held key; the service sees it again
        // every frame and must not read it as a new press.
        yield* input.dispatch(down(SPRINT_KEY))
        yield* input.dispatch(down(FORWARD_KEY))

        expect(yield* input.isActionActive('sprint')).toBe(true)
        expect(yield* input.isActionActive('moveForward')).toBe(true)
        expect(yield* input.wasActionJustTriggered('sprint')).toBe(false)
      }
    }),
  )

  it.effect('releasing sprint mid-run leaves the player still running', () =>
    Effect.gen(function* () {
      // The reference releases in the order `up('w')` then `up('Control')`; the
      // interesting half is the other order, which is what a player does when
      // they stop sprinting but keep walking.
      const input = yield* makeInputService()

      yield* input.dispatch(down(SPRINT_KEY))
      yield* input.dispatch(down(FORWARD_KEY))
      yield* input.dispatch(up(SPRINT_KEY))

      expect(yield* input.isActionActive('sprint')).toBe(false)
      expect(yield* input.isActionActive('moveForward')).toBe(true)
    }),
  )
})

describe('jump (Space)', () => {
  it.effect('Space means jump, and the service triggers jump from it', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService()

      expect(actionForKey(defaultBindings(), JUMP_KEY)).toBe('jump')

      yield* input.dispatch(down(JUMP_KEY))

      expect(yield* input.wasActionJustTriggered('jump')).toBe(true)
      expect(yield* input.isActionActive('jump')).toBe(true)
    }),
  )

  it.effect('one press is one jump, however long the bar is held', () =>
    Effect.gen(function* () {
      // `keyboard.down(' ')` … `waitForTimeout(120)` … `up(' ')` in the
      // reference. 120ms is several frames of auto-repeat, and the reference
      // could only tell that the game survived them. What matters is that they
      // produce ONE jump: an edge that re-fires while the bar is held is not a
      // jump at all, it is flight.
      const input = yield* makeInputService()

      yield* input.dispatch(down(JUMP_KEY))
      let edges = 0
      if (yield* input.wasActionJustTriggered('jump')) {
        edges = 1
      }

      for (let frame = 0; frame < 6; frame += 1) {
        yield* input.endFrame()
        yield* input.dispatch(down(JUMP_KEY))
        if (yield* input.wasActionJustTriggered('jump')) {
          edges += 1
        }
      }

      expect(edges).toBe(1)
    }),
  )

  it.effect('the jump re-arms after the bar comes up, so the second jump happens', () =>
    Effect.gen(function* () {
      // The other side of the edge rule, and the one a fix for the first can
      // break: a guard that suppresses the repeat by remembering "jump already
      // fired" without clearing it on release leaves the player able to jump
      // once per session.
      const input = yield* makeInputService()

      yield* input.dispatch(down(JUMP_KEY))
      yield* input.endFrame()
      yield* input.dispatch(up(JUMP_KEY))

      expect(yield* input.isActionActive('jump')).toBe(false)

      yield* input.endFrame()
      yield* input.dispatch(down(JUMP_KEY))

      expect(yield* input.wasActionJustTriggered('jump')).toBe(true)
    }),
  )

  it.effect('jumping while sprinting forward disturbs neither', () =>
    Effect.gen(function* () {
      // The two reference tests as one gesture, which is how they are played.
      const input = yield* makeInputService()

      yield* input.dispatch(down(SPRINT_KEY))
      yield* input.dispatch(down(FORWARD_KEY))
      yield* input.dispatch(down(JUMP_KEY))

      expect(yield* input.wasActionJustTriggered('jump')).toBe(true)
      expect(yield* input.isActionActive('sprint')).toBe(true)
      expect(yield* input.isActionActive('moveForward')).toBe(true)

      yield* input.dispatch(up(JUMP_KEY))

      expect(yield* input.isActionActive('jump')).toBe(false)
      expect(yield* input.isActionActive('sprint')).toBe(true)
      expect(yield* input.isActionActive('moveForward')).toBe(true)
    }),
  )

  it.effect('the full reference gesture leaves nothing held and nothing pending', () =>
    Effect.gen(function* () {
      // `repeated left and right clicks do not accumulate errors` (triage #18)
      // stays in mc-compose because it needs the composed frame. Its keyboard
      // half does not: after the reference's own down/up sequence the service
      // must be back where it started, or a key the player released goes on
      // driving the avatar.
      const input = yield* makeInputService()

      yield* input.dispatch(down(SPRINT_KEY))
      yield* input.dispatch(down(FORWARD_KEY))
      yield* input.dispatch(down(JUMP_KEY))
      yield* input.dispatch(up(JUMP_KEY))
      yield* input.dispatch(up(FORWARD_KEY))
      yield* input.dispatch(up(SPRINT_KEY))
      yield* input.endFrame()

      const settled = yield* input.snapshot

      expect([...settled.pressed]).toStrictEqual([])
      expect([...settled.justPressed]).toStrictEqual([])
      expect(yield* input.isActionActive('sprint')).toBe(false)
      expect(yield* input.isActionActive('moveForward')).toBe(false)
      expect(yield* input.isActionActive('jump')).toBe(false)
    }),
  )
})
