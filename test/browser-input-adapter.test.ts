/**
 * The `window` input adapter: registration, teardown, translation and the
 * pointer-lock port.
 *
 * Runs under `environment: 'node'` with a FAKE DOM, and that is the point of
 * keeping the DOM surface narrow (`application/dom-surface.ts`): eight members
 * are cheap to fake, and plan.md §3.10 records that the real thing cannot be
 * driven anyway — Playwright runs on SwiftShader and cannot do pointer lock
 * headless, so the browser test that would "really" cover this file does not
 * exist and cannot be written.
 *
 * The three tests docs/testing.md §8 asks for by name are here:
 *   `the window adapter registers exactly LISTENER_PLAN`               (DN-04)
 *   `every listener is removed on finalizer`                           (DN-04)
 *   `the window adapter passes deltaMode through wheelDeltaModeForIndex` (DN-13)
 * along with the two DN-12/DN-13/DN-14 rows next to them:
 *   `the wheel handler calls preventDefault exactly when shouldSuppressWheelScroll says so`
 *   `the window adapter calls preventDefault exactly when shouldSuppressContextMenu says so`
 *   `the browser port calls canvas.requestPointerLock exactly once per ask`
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { inspectTypeScriptFixture, parseTypeScriptConfig } from './typescript-project'
import {
  acquiresPointerLock,
  defaultBindings,
  GAMEPLAY_LISTENER_TARGET,
  HOTBAR_FOCUS_GROUP,
  MODAL_LISTENER_TARGET,
  WHEEL_LINES_PER_NOTCH,
  WHEEL_PIXELS_PER_NOTCH,
} from '../src/domain/input-bindings'
import {
  InputService,
  LISTENER_PLAN,
  makeInputService,
  type InputEvent,
  type InputServiceApi,
} from '../src/application/input-service'
import {
  browserInputLayer as browserInputLayerWithRunner,
  installInputListeners as installInputListenersWithRunner,
  listenerOptionsFor,
  makeBrowserPointerLockPort,
  mayPreventDefault,
  PREVENT_DEFAULT_EVENTS,
  resolveClickLanding,
  scopedInputListeners,
  translateDomEvent,
  TRANSLATED_DOM_EVENTS,
  type BrowserInputTargets,
  type DomEventContext,
  type TouchControlTarget,
} from '../src/application/browser-input-adapter'
import type { DomInputEvent, DomListener, DomListenerOptions } from '../src/application/dom-surface'

const browserInputLayer = (
  options: Omit<Parameters<typeof browserInputLayerWithRunner>[0], 'runSync'>,
) => browserInputLayerWithRunner({ ...options, runSync: Effect.runSync })

const installInputListeners = (
  targets: Parameters<typeof installInputListenersWithRunner>[0],
  input: Parameters<typeof installInputListenersWithRunner>[1],
  options: Omit<Parameters<typeof installInputListenersWithRunner>[2], 'runSync'> = {},
) => installInputListenersWithRunner(targets, input, { ...options, runSync: Effect.runSync })

// ---------------------------------------------------------------------------
// The fake DOM
// ---------------------------------------------------------------------------

/**
 * One `addEventListener` / `removeEventListener` call, recorded verbatim.
 *
 * `options` is kept by REFERENCE as well as by value: the browser matches a
 * removal on type, function identity and the capture flag, so a test that
 * compared only the strings would pass while a real listener leaked.
 */
type ListenerCall = {
  readonly where: 'window' | 'document'
  readonly type: string
  readonly listener: DomListener
  readonly options: DomListenerOptions | undefined
}

type FakeDom = {
  readonly targets: BrowserInputTargets
  readonly added: ReadonlyArray<ListenerCall>
  readonly removed: ReadonlyArray<ListenerCall>
  /** Registrations that were added and not yet removed. Must be empty after teardown. */
  readonly live: () => ReadonlyArray<ListenerCall>
  /** Dispatch to every LIVE listener for `type`, as a browser would. */
  readonly fire: (type: string, event?: Partial<DomInputEvent>) => number
  readonly setPointerLockElement: (element: unknown) => void
  /** How many times any handler called `preventDefault()`. */
  readonly preventedDefaults: () => number
}

const sameRegistration = (left: ListenerCall, right: ListenerCall): boolean =>
  left.where === right.where &&
  left.type === right.type &&
  left.listener === right.listener &&
  (left.options?.capture ?? false) === (right.options?.capture ?? false)

const makeFakeDom = (): FakeDom => {
  const added: Array<ListenerCall> = []
  const removed: Array<ListenerCall> = []
  let pointerLockElement: unknown = null
  let prevented = 0

  const targetFor = (where: 'window' | 'document') => ({
    addEventListener: (type: string, listener: DomListener, options?: DomListenerOptions): void => {
      added.push({ where, type, listener, options })
    },
    removeEventListener: (type: string, listener: DomListener, options?: DomListenerOptions): void => {
      removed.push({ where, type, listener, options })
    },
  })

  const live = (): ReadonlyArray<ListenerCall> =>
    added.filter((call) => !removed.some((gone) => sameRegistration(call, gone)))

  return {
    targets: {
      window: targetFor('window'),
      document: {
        ...targetFor('document'),
        get pointerLockElement(): unknown {
          return pointerLockElement
        },
        get activeElement(): unknown {
          throw new Error('The browser adapter must not read document.activeElement')
        },
      },
    },
    added,
    removed,
    live,
    fire: (type, event) => {
      const matching = live().filter((call) => call.type === type)
      // Hoisted out of the loop below rather than allocated fresh per listener:
      // it closes over `prevented` (this `makeFakeDom` instance's own counter),
      // not over anything the loop iterates, so every dispatched event can
      // safely share the one function instead of each getting its own.
      const preventDefault = (): void => {
        prevented += 1
      }
      for (const call of matching) {
        call.listener({
          preventDefault,
          ...event,
        })
      }
      return matching.length
    },
    setPointerLockElement: (element) => {
      pointerLockElement = element
    },
    preventedDefaults: () => prevented,
  }
}

/** A plan entry by name. Every test that needs a target reads it from the plan. */
const planned = (event: string) => {
  const entry = LISTENER_PLAN.find((candidate) => candidate.event === event)
  if (entry === undefined) {
    throw new Error(`LISTENER_PLAN has no entry for '${event}'`)
  }
  return entry
}

/**
 * No lock. The host's focus and click classifiers are absent by default.
 */
const noContext: DomEventContext = { pointerLockHeld: false }

/** A `preventDefault` that records nothing. Translation never calls it. */
const noop = (): void => undefined

/** A service whose pointer is locked, so the lock-dependent branches are live. */
const lockedInput = Effect.gen(function* () {
  const input = yield* makeInputService()
  yield* input.dispatch({ kind: 'pointerlockchange', locked: true })
  return input
})

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe('REGRESSION: the window adapter registers what LISTENER_PLAN says', () => {
  it.effect('the window adapter registers exactly LISTENER_PLAN', () =>
    Effect.gen(function* () {
      // DN-04's missing test. The plan is DATA precisely so that this comparison
      // can exist without a browser; an adapter that restated the table would
      // have made "input registers on window" a fact about two files.
      const dom = makeFakeDom()
      const input = yield* makeInputService()

      installInputListeners(dom.targets, input)

      expect(dom.added.map((call) => ({ event: call.type, target: call.where }))).toStrictEqual(
        LISTENER_PLAN.map((entry) => ({ event: entry.event, target: entry.target })),
      )
    }),
  )

  it.effect('nothing outside the plan is registered, and nothing in it is skipped', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()

      const installed = installInputListeners(dom.targets, input)

      expect(installed.registrations).toHaveLength(LISTENER_PLAN.length)
      expect(dom.added).toHaveLength(LISTENER_PLAN.length)
      expect(new Set(dom.added.map((call) => call.type)).size).toBe(LISTENER_PLAN.length)
    }),
  )

  it.effect('gameplay codes go on window, and nothing puts one on the modal target', () =>
    Effect.gen(function* () {
      // The shielding rule, as the adapter actually applies it: a key or button
      // listener on `document` could not be shielded by a modal that also stops
      // propagation at `document` — whether it was shielded would depend on
      // registration order.
      const dom = makeFakeDom()
      const input = yield* makeInputService()

      installInputListeners(dom.targets, input)

      const gameplay = dom.added.filter((call) =>
        ['keydown', 'keyup', 'mousedown', 'mouseup', 'blur'].includes(call.type),
      )
      expect(gameplay).toHaveLength(5)
      expect(gameplay.every((call) => call.where === GAMEPLAY_LISTENER_TARGET)).toBe(true)
      expect(gameplay.some((call) => call.where === MODAL_LISTENER_TARGET)).toBe(false)
    }),
  )

  it.effect('passive: false is set on exactly the listeners that may preventDefault', () =>
    Effect.gen(function* () {
      // A non-passive listener on a scroll path costs real frame time: the
      // browser must wait for the handler before it knows whether it may
      // scroll. So it goes where `preventDefault()` is possible, and nowhere
      // else.
      const dom = makeFakeDom()
      const input = yield* makeInputService()

      installInputListeners(dom.targets, input)

      const nonPassive = dom.added.filter((call) => call.options?.passive === false).map((call) => call.type)
      expect(nonPassive.sort()).toStrictEqual([...PREVENT_DEFAULT_EVENTS].sort())
      expect(nonPassive).toContain('wheel')
      expect(mayPreventDefault('wheel')).toBe(true)
      expect(mayPreventDefault('contextmenu')).toBe(true)
      expect(mayPreventDefault('keydown')).toBe(false)
      expect(mayPreventDefault('mousedown')).toBe(false)
    }),
  )

  it.effect('every registration states its capture flag, because removal matches on it', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()

      installInputListeners(dom.targets, input)

      expect(dom.added.every((call) => call.options?.capture === false)).toBe(true)
      expect(listenerOptionsFor('keydown')).toStrictEqual({ capture: false })
      expect(listenerOptionsFor('wheel')).toStrictEqual({ capture: false, passive: false })
    }),
  )

  it.effect('the plan and the translation table agree in BOTH directions', () =>
    Effect.sync(() => {
      // An entry added to LISTENER_PLAN without a case in `translateDomEvent`
      // would register, fire, and silently drop every event it received.
      expect([...TRANSLATED_DOM_EVENTS].sort()).toStrictEqual(
        LISTENER_PLAN.map((entry) => entry.event).sort(),
      )
    }),
  )

  it.effect('two services on one page get two independent sets of listeners', () =>
    Effect.gen(function* () {
      // mc-playground-kit puts two previews side by side. If the adapter kept
      // any module-level state, the second preview would drive the first.
      const dom = makeFakeDom()
      const first = yield* makeInputService()
      const second = yield* makeInputService()

      const a = installInputListeners(dom.targets, first)
      const b = installInputListeners(dom.targets, second)

      expect(dom.live()).toHaveLength(LISTENER_PLAN.length * 2)
      expect(a.registrations[0]?.listener).not.toBe(b.registrations[0]?.listener)

      dom.fire('keydown', { code: 'KeyW' })
      expect(yield* first.isActionActive('moveForward')).toBe(true)
      expect(yield* second.isActionActive('moveForward')).toBe(true)

      a.remove()
      dom.fire('keyup', { code: 'KeyW' })
      // Only the second is still listening, so only the second sees the release.
      expect(yield* first.isActionActive('moveForward')).toBe(true)
      expect(yield* second.isActionActive('moveForward')).toBe(false)
    }),
  )
})

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

describe('REGRESSION: teardown removes exactly what setup added', () => {
  it.effect('every listener is removed on finalizer', () =>
    Effect.gen(function* () {
      // DN-04's other missing test. plan.md §3.8 records leftover fibers on a
      // SECOND world load as the reference's worst bug class; a leaked listener
      // is the same failure in another form.
      const dom = makeFakeDom()
      const input = yield* makeInputService()

      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* scopedInputListeners(dom.targets, input, { runSync: Effect.runSync })
          expect(dom.live()).toHaveLength(LISTENER_PLAN.length)
        }),
      )

      expect(dom.live()).toStrictEqual([])
      expect(dom.removed).toHaveLength(LISTENER_PLAN.length)
    }),
  )

  it.effect('the removal matches the registration: same target, same function, same flags', () =>
    Effect.gen(function* () {
      // `removeEventListener` matches on type, function identity and the capture
      // flag. Miss any of the three and the call silently does nothing — the
      // failure mode with no error message.
      const dom = makeFakeDom()
      const input = yield* makeInputService()

      installInputListeners(dom.targets, input).remove()

      expect(dom.removed).toHaveLength(dom.added.length)
      for (const [index, call] of dom.added.entries()) {
        const gone = dom.removed[index]
        expect(gone?.where).toBe(call.where)
        expect(gone?.type).toBe(call.type)
        expect(gone?.listener).toBe(call.listener)
        expect(gone?.options).toBe(call.options)
      }
    }),
  )

  it.effect('a removed adapter receives nothing — a dead listener cannot walk the player', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()

      const installed = installInputListeners(dom.targets, input)
      installed.remove()

      expect(dom.fire('keydown', { code: 'KeyW' })).toBe(0)
      expect(yield* input.isActionActive('moveForward')).toBe(false)
    }),
  )

  it.effect('remove is idempotent, so a manual teardown plus a finalizer is safe', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()

      const installed = installInputListeners(dom.targets, input)
      installed.remove()
      installed.remove()
      installed.remove()

      expect(dom.removed).toHaveLength(LISTENER_PLAN.length)
    }),
  )

  it.effect('REGRESSION: a second world load leaks nothing', () =>
    Effect.gen(function* () {
      // Load, unload, load again — the shape of the reference's worst bug.
      const dom = makeFakeDom()
      const first = yield* makeInputService()
      const second = yield* makeInputService()

      installInputListeners(dom.targets, first).remove()
      const reload = installInputListeners(dom.targets, second)

      expect(dom.live()).toHaveLength(LISTENER_PLAN.length)
      expect(dom.fire('keydown', { code: 'KeyW' })).toBe(1)
      expect(yield* first.isActionActive('moveForward')).toBe(false)
      expect(yield* second.isActionActive('moveForward')).toBe(true)

      reload.remove()
      expect(dom.live()).toStrictEqual([])
    }),
  )

  it.effect('browserInputLayer takes its listeners down with the scope', () =>
    Effect.gen(function* () {
      // The Layer exists because this is the teardown nobody performs by hand.
      const dom = makeFakeDom()

      yield* Effect.gen(function* () {
        const input = yield* InputService
        expect(dom.live()).toHaveLength(LISTENER_PLAN.length)

        // ...and the Layer really does provide a service the listeners feed.
        dom.fire('keydown', { code: 'KeyW' })
        expect(yield* input.isActionActive('moveForward')).toBe(true)
      }).pipe(Effect.provide(browserInputLayer({ targets: dom.targets })))

      expect(dom.live()).toStrictEqual([])
    }),
  )
})

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

describe('every DOM event kind translates to the right InputEvent', () => {
  it.effect('keydown and keyup carry the code and the GAMEPLAY target', () =>
    Effect.sync(() => {
      expect(translateDomEvent(planned('keydown'), { preventDefault: noop, code: 'KeyW' }, noContext)).toStrictEqual(
        { kind: 'keydown', code: 'KeyW', target: GAMEPLAY_LISTENER_TARGET } satisfies InputEvent,
      )
      expect(translateDomEvent(planned('keyup'), { preventDefault: noop, code: 'KeyW' }, noContext)).toStrictEqual(
        { kind: 'keyup', code: 'KeyW', target: GAMEPLAY_LISTENER_TARGET } satisfies InputEvent,
      )
    }),
  )

  it.effect('the target comes from the PLAN, so moving an entry moves the shielding', () =>
    Effect.sync(() => {
      // Hard-coding `window` here would have made the modal-shielding rule a
      // fact about two files that a one-word edit could desynchronise.
      const moved = translateDomEvent(
        { event: 'keydown', target: MODAL_LISTENER_TARGET },
        { preventDefault: noop, code: 'KeyW' },
        noContext,
      )

      expect(moved).toStrictEqual({ kind: 'keydown', code: 'KeyW', target: MODAL_LISTENER_TARGET })
    }),
  )

  it.effect('MouseEvent.button is named by mouseButtonForIndex, and a thumb button is dropped', () =>
    Effect.sync(() => {
      const down = (button: number) =>
        translateDomEvent(planned('mousedown'), { preventDefault: noop, button }, noContext)

      // `landing: 'elsewhere'` because `noContext` names no lock target and no
      // roster, and the event carries no `target`. That is the correct answer
      // for a host that declared nothing — and it is the direction the default
      // has to fall: a click nobody can place must not take the pointer.
      expect(down(0)).toStrictEqual({
        kind: 'mousedown',
        button: 'MouseLeft',
        target: GAMEPLAY_LISTENER_TARGET,
        landing: 'elsewhere',
      })
      expect(down(1)).toStrictEqual({
        kind: 'mousedown',
        button: 'MouseMiddle',
        target: GAMEPLAY_LISTENER_TARGET,
        landing: 'elsewhere',
      })
      expect(down(2)).toStrictEqual({
        kind: 'mousedown',
        button: 'MouseRight',
        target: GAMEPLAY_LISTENER_TARGET,
        landing: 'elsewhere',
      })
      // 3 and 4 are the browser's back/forward thumb buttons. The reference
      // recorded them and nothing ever read them (:120); here they are dropped
      // at the boundary rather than becoming state that cannot become an action.
      expect(down(3)).toBeUndefined()
      expect(down(-1)).toBeUndefined()
    }),
  )

  it.effect('mouseup names the same buttons, or a held button sticks', () =>
    Effect.sync(() => {
      expect(translateDomEvent(planned('mouseup'), { preventDefault: noop, button: 0 }, noContext)).toStrictEqual({
        kind: 'mouseup',
        button: 'MouseLeft',
        target: GAMEPLAY_LISTENER_TARGET,
      })
    }),
  )

  it.effect('mousemove becomes pointermove — the DOM name and the model name differ', () =>
    Effect.sync(() => {
      expect(
        translateDomEvent(planned('mousemove'), { preventDefault: noop, movementX: 4, movementY: -3 }, noContext),
      ).toStrictEqual({ kind: 'pointermove', deltaX: 4, deltaY: -3 })
    }),
  )

  it.effect('a non-finite movement is DROPPED rather than poisoning the accumulated delta', () =>
    Effect.sync(() => {
      // `pointerDelta` accumulates raw, so one NaN disables mouselook for the
      // rest of the session — the same failure `notchesForWheelDelta` guards
      // against on its own side.
      expect(
        translateDomEvent(planned('mousemove'), { preventDefault: noop, movementX: Number.NaN }, noContext),
      ).toBeUndefined()
      expect(
        translateDomEvent(
          planned('mousemove'),
          { preventDefault: noop, movementX: 2, movementY: Number.POSITIVE_INFINITY },
          noContext,
        ),
      ).toStrictEqual({ kind: 'pointermove', deltaX: 2, deltaY: 0 })
      // The other axis of the same guard: `deltaY` finite and `deltaX` the one
      // that falls back to zero. The case above only ever forced `deltaY`'s
      // fallback; without this one `deltaX`'s own `?? NO_POINTER_DELTA` never
      // runs.
      expect(
        translateDomEvent(
          planned('mousemove'),
          { preventDefault: noop, movementX: Number.POSITIVE_INFINITY, movementY: -7 },
          noContext,
        ),
      ).toStrictEqual({ kind: 'pointermove', deltaX: 0, deltaY: -7 })
      expect(translateDomEvent(planned('mousemove'), { preventDefault: noop }, noContext)).toBeUndefined()
    }),
  )

  it.effect('the window adapter passes deltaMode through wheelDeltaModeForIndex', () =>
    Effect.sync(() => {
      // DN-13's missing test. The adapter does the NUMBER→NAME step and nothing
      // more: how many pixels make a notch stays in the domain, where
      // `environment: 'node'` can test it.
      const wheel = (deltaMode: number) =>
        translateDomEvent(planned('wheel'), { preventDefault: noop, deltaY: 120, deltaMode }, noContext)

      expect(wheel(0)).toStrictEqual({ kind: 'wheel', deltaY: 120, deltaMode: 'pixel' })
      expect(wheel(1)).toStrictEqual({ kind: 'wheel', deltaY: 120, deltaMode: 'line' })
      expect(wheel(2)).toStrictEqual({ kind: 'wheel', deltaY: 120, deltaMode: 'page' })
      // An unnamed unit is dropped: mis-scaling a scroll by 33x is worse than
      // ignoring it.
      expect(wheel(3)).toBeUndefined()
      expect(translateDomEvent(planned('wheel'), { preventDefault: noop, deltaY: 120 }, noContext)).toBeUndefined()
      expect(translateDomEvent(planned('wheel'), { preventDefault: noop, deltaMode: 0 }, noContext)).toBeUndefined()
    }),
  )

  it.effect('the adapter passes deltaY RAW — normalisation is the domain\'s job', () =>
    Effect.sync(() => {
      const translated = translateDomEvent(
        planned('wheel'),
        { preventDefault: noop, deltaY: WHEEL_PIXELS_PER_NOTCH, deltaMode: 0 },
        noContext,
      )

      expect(translated).toStrictEqual({ kind: 'wheel', deltaY: WHEEL_PIXELS_PER_NOTCH, deltaMode: 'pixel' })
    }),
  )

  it.effect('contextmenu translates to an event that carries NO button', () =>
    Effect.sync(() => {
      // `mousedown` already captured button 2. Carrying it again is the
      // reference's :137-139 trap: `use` fires twice for one right-click.
      const translated = translateDomEvent(planned('contextmenu'), { preventDefault: noop, button: 2 }, noContext)

      expect(translated).toStrictEqual({ kind: 'contextmenu', target: MODAL_LISTENER_TARGET })
      expect(JSON.stringify(translated)).not.toContain('Mouse')
    }),
  )

  it.effect('pointerlockchange reads the DOCUMENT, not the event', () =>
    Effect.sync(() => {
      expect(
        translateDomEvent(planned('pointerlockchange'), { preventDefault: noop }, { ...noContext, pointerLockHeld: true }),
      ).toStrictEqual({ kind: 'pointerlockchange', locked: true })
      expect(
        translateDomEvent(planned('pointerlockchange'), { preventDefault: noop }, { ...noContext, pointerLockHeld: false }),
      ).toStrictEqual({ kind: 'pointerlockchange', locked: false })
    }),
  )

  it.effect('pointerlockerror is its own event — never a pointerlockchange(false)', () =>
    Effect.sync(() => {
      // Collapsing them would make every Escape look to the UI like a browser
      // refusal (DN-14).
      expect(translateDomEvent(planned('pointerlockerror'), { preventDefault: noop }, noContext)).toStrictEqual({
        kind: 'pointerlockerror',
      })
    }),
  )

  it.effect('blur translates, because the browser sends no keyup while unfocused', () =>
    Effect.sync(() => {
      expect(translateDomEvent(planned('blur'), { preventDefault: noop }, noContext)).toStrictEqual({ kind: 'blur' })
    }),
  )

  it.effect('an event name the switch does not know is dropped, not guessed at', () =>
    Effect.sync(() => {
      // `PlannedListener.event` is `string`, not the closed union the switch
      // matches on — an entry `LISTENER_PLAN` grows without a case here is a
      // value this function can actually receive, not a cast-only input. The
      // name below must NOT be one of `TRANSLATED_DOM_EVENTS`, or this would
      // silently exercise that event's own case instead of `default`.
      expect(TRANSLATED_DOM_EVENTS).not.toContain('gamepadconnected')
      expect(
        translateDomEvent({ event: 'gamepadconnected', target: 'document' }, { preventDefault: noop }, noContext),
      ).toBeUndefined()
    }),
  )

  it.effect('a keydown with no code is dropped — a handler must not throw', () =>
    Effect.sync(() => {
      expect(translateDomEvent(planned('keydown'), { preventDefault: noop }, noContext)).toBeUndefined()
      expect(translateDomEvent(planned('mousedown'), { preventDefault: noop }, noContext)).toBeUndefined()
    }),
  )

  it.effect('translateTouchEdge falls back to no roster at all when the context omits one', () =>
    Effect.sync(() => {
      // `installInputListeners` always supplies `touchControls` (defaulting to
      // `[]`, see `installInputListeners`'s own default), so real listener
      // traffic never reaches `translateTouchEdge` with the field OMITTED —
      // that path is short-circuited by `dispatchTouchEvent` before
      // `translateDomEvent` even runs (see "multi-touch dispatch" below).
      // `translateDomEvent` is exported and callable directly, though, and a
      // caller that does not thread a full `DomEventContext` through must
      // still get "no control resolves" rather than a crash on `undefined`.
      expect(noContext.touchControls).toBeUndefined()
      expect(
        translateDomEvent(planned('touchstart'), { preventDefault: noop, target: { name: 'anything' } }, noContext),
      ).toBeUndefined()
    }),
  )
})

// ---------------------------------------------------------------------------
// preventDefault
// ---------------------------------------------------------------------------

describe('REGRESSION: preventDefault is called exactly where the predicates say', () => {
  it.effect('the wheel handler calls preventDefault exactly when shouldSuppressWheelScroll says so', () =>
    Effect.gen(function* () {
      // DN-13's missing test. Unlocked, the wheel is scrolling the chat log or
      // the settings list; swallowing it means a player who cannot reach the
      // bottom of their own settings screen.
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      dom.fire('wheel', { deltaY: WHEEL_PIXELS_PER_NOTCH, deltaMode: 0 })
      expect(yield* input.shouldSuppressWheelScroll).toBe(false)
      expect(dom.preventedDefaults()).toBe(0)

      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })

      dom.fire('wheel', { deltaY: WHEEL_PIXELS_PER_NOTCH, deltaMode: 0 })
      expect(yield* input.shouldSuppressWheelScroll).toBe(true)
      expect(dom.preventedDefaults()).toBe(1)
    }),
  )

  it.effect('the window adapter calls preventDefault exactly when shouldSuppressContextMenu says so', () =>
    Effect.gen(function* () {
      // DN-12's missing test. Locked, right-click places a block and the browser
      // menu would also take the pointer lock with it. Unlocked, the menu is the
      // platform behaviour — no "copy" on a chat line without it.
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      dom.fire('contextmenu', { button: 2 })
      expect(dom.preventedDefaults()).toBe(0)

      yield* input.dispatch({ kind: 'pointerlockchange', locked: true })

      dom.fire('contextmenu', { button: 2 })
      expect(dom.preventedDefaults()).toBe(1)
    }),
  )

  it.effect('no OTHER handler ever calls preventDefault, locked or not', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* lockedInput
      installInputListeners(dom.targets, input)

      dom.fire('keydown', { code: 'Space' })
      dom.fire('keyup', { code: 'Space' })
      dom.fire('mousedown', { button: 0 })
      dom.fire('mouseup', { button: 0 })
      dom.fire('mousemove', { movementX: 1, movementY: 1 })
      dom.fire('pointerlockchange')
      dom.fire('pointerlockerror')
      dom.fire('blur')

      expect(dom.preventedDefaults()).toBe(0)
    }),
  )

  it.effect('a wheel whose unit cannot be named is still suppressed while locked', () =>
    Effect.gen(function* () {
      // The event is dropped, but the page must not scroll out from under a
      // locked canvas because of a unit this adapter could not read.
      const dom = makeFakeDom()
      const input = yield* lockedInput
      installInputListeners(dom.targets, input)

      dom.fire('wheel', { deltaY: 10, deltaMode: 7 })

      expect(dom.preventedDefaults()).toBe(1)
      expect((yield* input.snapshot).wheelNotches).toBe(0)
    }),
  )
})

// ---------------------------------------------------------------------------
// The pointer lock port
// ---------------------------------------------------------------------------

type FakeCanvas = {
  readonly requestPointerLock: () => unknown
  readonly asks: () => number
}

const makeFakeCanvas = (result: () => unknown = () => undefined): FakeCanvas => {
  let asks = 0
  return {
    requestPointerLock: () => {
      asks += 1
      return result()
    },
    asks: () => asks,
  }
}

describe('REGRESSION: the pointer lock port performs the ask and reports only that', () => {
  it.effect('the browser port calls canvas.requestPointerLock exactly once per ask', () =>
    Effect.gen(function* () {
      // DN-14's missing test. The service claims the state transition before
      // asking, so a second click inside one frame must not reach the browser —
      // a request sent while another is pending is one of the ways a browser
      // refuses.
      const canvas = makeFakeCanvas()
      const port = makeBrowserPointerLockPort({ canvas })
      const input = yield* makeInputService(defaultBindings(), port)

      expect(yield* input.requestPointerLock).toBe('requested')
      expect(canvas.asks()).toBe(1)

      expect(yield* input.requestPointerLock).toBe('requested')
      expect(canvas.asks()).toBe(1)
    }),
  )

  it.effect('the ask reports only that it WENT OUT — the answer arrives as an event', () =>
    Effect.gen(function* () {
      const canvas = makeFakeCanvas()

      expect(yield* makeBrowserPointerLockPort({ canvas }).request).toBe('sent')
    }),
  )

  it.effect('a refused lock surfaces as pointerlockerror, through the real listener', () =>
    Effect.gen(function* () {
      // End to end: the ask goes out, the browser says no, the DOM event lands
      // on the adapter's listener, and the state says `refused` — which is what
      // a UI can draw. The reference has a console.warn here (:150-153), in a
      // place no player has ever looked.
      const dom = makeFakeDom()
      const canvas = makeFakeCanvas()
      const input = yield* makeInputService(defaultBindings(), makeBrowserPointerLockPort({ canvas }))
      installInputListeners(dom.targets, input)

      expect(yield* input.requestPointerLock).toBe('requested')

      dom.fire('pointerlockerror')

      expect(yield* input.pointerLockState).toBe('refused')
      expect((yield* input.snapshot).pointerLocked).toBe(false)
    }),
  )

  it.effect('a GRANTED lock arrives as pointerlockchange with the document holding an element', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      dom.setPointerLockElement({ tagName: 'CANVAS' })
      dom.fire('pointerlockchange')

      expect(yield* input.pointerLockState).toBe('locked')

      dom.setPointerLockElement(null)
      dom.fire('pointerlockchange')

      // An ordinary unlock is `unlocked`, never `refused` — Escape is not a
      // browser refusal.
      expect(yield* input.pointerLockState).toBe('unlocked')
    }),
  )

  it.effect('an element with no requestPointerLock is unavailable, not sent', () =>
    Effect.gen(function* () {
      // `unavailable` exists because no event will ever answer. Reporting `sent`
      // would strand the state machine in `requested` for the session.
      const port = makeBrowserPointerLockPort({ canvas: {} })

      expect(yield* port.request).toBe('unavailable')
    }),
  )

  it.effect('a permissions policy that forbids the lock is unavailable, and is not asked', () =>
    Effect.gen(function* () {
      // The reference's :258-262 feature-policy check, reachable without
      // `featurePolicy` appearing in this repository's DOM surface at all.
      const canvas = makeFakeCanvas()
      const port = makeBrowserPointerLockPort({ canvas, allowsPointerLock: () => false })

      expect(yield* port.request).toBe('unavailable')
      expect(canvas.asks()).toBe(0)
    }),
  )

  it.effect('an unavailable port resolves to refused at once rather than hanging', () =>
    Effect.gen(function* () {
      const input = yield* makeInputService(defaultBindings(), makeBrowserPointerLockPort({ canvas: {} }))

      expect(yield* input.requestPointerLock).toBe('refused')
      // ...and the refusal is retryable, which is the point: a click is the user
      // gesture the browser wanted.
      expect(yield* input.pointerLockState).toBe('refused')
    }),
  )

  it.effect('a THROWING requestPointerLock is unavailable — the ask did not go out', () =>
    Effect.gen(function* () {
      const port = makeBrowserPointerLockPort({
        canvas: {
          requestPointerLock: () => {
            throw new Error('SecurityError')
          },
        },
      })

      expect(yield* port.request).toBe('unavailable')
    }),
  )

  it.effect('a REJECTED promise still counts as sent, and does not escape as an unhandled rejection', () =>
    Effect.gen(function* () {
      // Modern browsers reject the promise AND fire `pointerlockerror`. The
      // EVENT is the answer, so the rejection must not become `unavailable`;
      // it is swallowed only so that it cannot take the host down.
      //
      // A real Promise, not a fake thenable, because the failure being guarded
      // against is Node's and the browser's own unhandled-rejection machinery.
      const unhandled: Array<unknown> = []
      const record = (reason: unknown): void => {
        unhandled.push(reason)
      }
      process.on('unhandledRejection', record)

      const rejection = Promise.reject(new Error('SecurityError: not from a user gesture'))
      const port = makeBrowserPointerLockPort({ canvas: { requestPointerLock: () => rejection } })
      const outcome = yield* port.request

      // Unhandled rejections are reported a turn later, so give the loop one.
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            setImmediate(resolve)
          }),
      )
      process.off('unhandledRejection', record)

      expect(outcome).toBe('sent')
      expect(unhandled).toStrictEqual([])
    }),
  )

  it.effect('browserInputLayer with no canvas never asks — a preview may just watch input', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()

      yield* Effect.gen(function* () {
        const input = yield* InputService
        expect(yield* input.requestPointerLock).toBe('refused')
      }).pipe(Effect.provide(browserInputLayer({ targets: dom.targets })))
    }),
  )

  it.effect('browserInputLayer routes its OWN allowsPointerLock into the port it builds', () =>
    Effect.gen(function* () {
      // `pointerLockPortFor`'s other branch. Every test above reaches
      // `allowsPointerLock` by calling `makeBrowserPointerLockPort` directly;
      // this is the one path that goes through `BrowserInputOptions` and the
      // layer's own wiring, which has a canvas AND a caller-supplied
      // predicate at the same time.
      const dom = makeFakeDom()
      const canvas = makeFakeCanvas()

      yield* Effect.gen(function* () {
        const input = yield* InputService
        expect(yield* input.requestPointerLock).toBe('refused')
      }).pipe(
        Effect.provide(
          browserInputLayer({ targets: dom.targets, canvas, allowsPointerLock: () => false }),
        ),
      )
      // Refused because the policy said no, not because the request was
      // never sent — the same distinction `a permissions policy that forbids
      // the lock` draws for the direct constructor.
      expect(canvas.asks()).toBe(0)
    }),
  )
})

// ---------------------------------------------------------------------------
// End to end, through the fake DOM
// ---------------------------------------------------------------------------

describe('the adapter drives the service the way a browser would', () => {
  it.effect('a keypress becomes a held action and a one-frame edge', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      dom.fire('keydown', { code: 'KeyW' })

      expect(yield* input.isActionActive('moveForward')).toBe(true)
      expect(yield* input.wasActionJustTriggered('moveForward')).toBe(true)

      yield* input.endFrame()
      expect(yield* input.wasActionJustTriggered('moveForward')).toBe(false)
      expect(yield* input.isActionActive('moveForward')).toBe(true)

      dom.fire('keyup', { code: 'KeyW' })
      expect(yield* input.isActionActive('moveForward')).toBe(false)
    }),
  )

  it.effect('a locked left click is attack; an unlocked one is a UI click and breaks nothing', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      dom.fire('mousedown', { button: 0 })
      expect(yield* input.wasActionJustTriggered('attack')).toBe(false)
      expect(yield* input.wasUiClick('MouseLeft')).toBe(true)

      yield* input.endFrame()
      dom.setPointerLockElement({ tagName: 'CANVAS' })
      dom.fire('pointerlockchange')
      dom.fire('mousedown', { button: 0 })

      expect(yield* input.wasActionJustTriggered('attack')).toBe(true)
    }),
  )

  it.effect('a flick of the wheel accumulates in notches, whatever unit it arrived in', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* lockedInput
      installInputListeners(dom.targets, input)

      dom.fire('wheel', { deltaY: WHEEL_PIXELS_PER_NOTCH, deltaMode: 0 })
      dom.fire('wheel', { deltaY: WHEEL_LINES_PER_NOTCH, deltaMode: 1 })

      expect((yield* input.snapshot).wheelSteps).toBe(2)
    }),
  )

  it.effect('a mousemove is a pointer delta while locked and nothing while not', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      dom.fire('mousemove', { movementX: 5, movementY: 5 })
      expect((yield* input.snapshot).pointerDelta).toStrictEqual({ x: 0, y: 0 })

      dom.setPointerLockElement({ tagName: 'CANVAS' })
      dom.fire('pointerlockchange')
      dom.fire('mousemove', { movementX: 5, movementY: -2 })

      expect((yield* input.snapshot).pointerDelta).toStrictEqual({ x: 5, y: -2 })
    }),
  )

  it.effect('REGRESSION: blur clears held input, because no keyup arrives while unfocused', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      dom.fire('keydown', { code: 'KeyW' })
      dom.fire('blur')

      expect(yield* input.isActionActive('moveForward')).toBe(false)
    }),
  )

  it.effect('losing the lock through the DOM drops the delta, so the view does not spin', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      dom.setPointerLockElement({ tagName: 'CANVAS' })
      dom.fire('pointerlockchange')
      dom.fire('mousemove', { movementX: 50, movementY: 50 })

      dom.setPointerLockElement(null)
      dom.fire('pointerlockchange')

      expect((yield* input.snapshot).pointerDelta).toStrictEqual({ x: 0, y: 0 })
    }),
  )
})

// ---------------------------------------------------------------------------
// Multi-touch: the per-finger accounting `dispatchTouchPress`/
// `dispatchTouchRelease` do that `translateDomEvent`'s touch case does not
// need, because a real `touchstart`/`touchend` always carries `changedTouches`
// and goes through THIS dispatcher, never through `translateDomEvent`'s own
// (guard-less) touch case.
// ---------------------------------------------------------------------------

const touchJumpButton = { name: 'touch-jump' }
const touchAttackButton = { name: 'touch-attack' }
const touchUndeclared = { name: 'touch-undeclared-decoration' }

describe('multi-touch dispatch: per-finger guards', () => {
  it.effect('a second touchstart for a finger already down is dropped, not re-targeted', () =>
    Effect.gen(function* () {
      // The identifier-keyed guard `dispatchTouchPress` opens with. A
      // duplicate `touchstart` for a finger this adapter already tracks — a
      // platform quirk, or two listeners racing — must not let that finger
      // switch which action it holds.
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      const controls: ReadonlyArray<TouchControlTarget> = [
        { action: 'jump', target: touchJumpButton },
        { action: 'attack', target: touchAttackButton },
      ]
      installInputListeners(dom.targets, input, { touchControls: controls })

      dom.fire('touchstart', { changedTouches: [{ identifier: 1, target: touchJumpButton }] })
      expect(yield* input.isActionActive('jump')).toBe(true)

      // Same identifier, now landing on a DIFFERENT control — dropped.
      dom.fire('touchstart', { changedTouches: [{ identifier: 1, target: touchAttackButton }] })
      expect(yield* input.isActionActive('attack')).toBe(false)
      expect(yield* input.isActionActive('jump')).toBe(true)

      // Releasing that identifier releases `jump` — the action it actually
      // holds — which is what proves the second press never re-targeted it.
      dom.fire('touchend', { changedTouches: [{ identifier: 1, target: touchAttackButton }] })
      expect(yield* input.isActionActive('jump')).toBe(false)
    }),
  )

  it.effect('a touchstart on an element outside the roster is dropped by this dispatcher too', () =>
    Effect.gen(function* () {
      // `translateDomEvent`'s touch case only runs when `changedTouches` is
      // ABSENT (see "a tap on something nobody declared is DROPPED" in
      // touch-controls.test.ts); every real touch carries it, so this guard —
      // not that one — is what an actual undeclared tap goes through.
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      const controls: ReadonlyArray<TouchControlTarget> = [{ action: 'jump', target: touchJumpButton }]
      installInputListeners(dom.targets, input, { touchControls: controls })

      dom.fire('touchstart', { changedTouches: [{ identifier: 7, target: touchUndeclared }] })
      dom.fire('touchstart', { changedTouches: [{ identifier: Number.NaN, target: touchJumpButton }] })

      expect(yield* input.isActionActive('jump')).toBe(false)
      expect((yield* input.snapshot).pressed.size).toBe(0)
    }),
  )

  it.effect('a second release for a finger already let go is dropped, not a phantom release', () =>
    Effect.gen(function* () {
      // `dispatchTouchRelease`'s own identifier guard. The platform is not
      // supposed to fire a second release for one finger, but `touchcancel`
      // racing a `touchend` can — and by then this identifier is untracked,
      // so it must be a no-op rather than a second `touchrelease` for an
      // action nothing still holds.
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      const dispatched: Array<InputEvent> = []
      const spying: InputServiceApi = {
        ...input,
        dispatch: (event) =>
          Effect.andThen(
            Effect.sync(() => {
              dispatched.push(event)
            }),
            input.dispatch(event),
          ),
      }
      const controls: ReadonlyArray<TouchControlTarget> = [{ action: 'jump', target: touchJumpButton }]
      installInputListeners(dom.targets, spying, { touchControls: controls })

      dom.fire('touchstart', { changedTouches: [{ identifier: 3, target: touchJumpButton }] })
      dom.fire('touchend', { changedTouches: [{ identifier: 3, target: touchJumpButton }] })
      expect(dispatched.map((event) => event.kind)).toStrictEqual(['touchpress', 'touchrelease'])

      dom.fire('touchcancel', { changedTouches: [{ identifier: 3, target: touchJumpButton }] })

      expect(dispatched.map((event) => event.kind)).toStrictEqual(['touchpress', 'touchrelease'])
      expect(yield* input.isActionActive('jump')).toBe(false)
    }),
  )
})

// ---------------------------------------------------------------------------
// Keyboard focus and navigation
// ---------------------------------------------------------------------------

describe('focus DTO and navigation intent stay at the host boundary', () => {
  it.effect('forwards the host focus DTO through the input service', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      const hotbarSlot = { slot: 3 }
      const focus = { group: HOTBAR_FOCUS_GROUP, index: 3 }
      const resolved: Array<unknown> = []
      installInputListeners(dom.targets, input, {
        focusTargetForElement: (target) => {
          resolved.push(target)
          if (target === hotbarSlot) {
            return focus
          }
          return undefined
        },
      })

      dom.fire('focusin', { target: hotbarSlot })
      expect(resolved).toStrictEqual([hotbarSlot])
      expect(yield* input.keyboardFocus).toStrictEqual(focus)

      dom.fire('focusout', { target: hotbarSlot })
      expect(yield* input.keyboardFocus).toBeUndefined()
    }),
  )

  it.effect('focus outside the host UI reports no focus without resolving a missing target', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      let resolverCalls = 0
      installInputListeners(dom.targets, input, {
        focusTargetForElement: () => {
          resolverCalls += 1
          return undefined
        },
      })

      dom.fire('focusin', {})
      dom.fire('focusin', { target: null })

      expect(resolverCalls).toBe(0)
      expect(yield* input.keyboardFocus).toBeUndefined()
    }),
  )

  it.effect('dispatches raw key events and sends unlocked arrow directions to the host', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      const directions: Array<string> = []
      installInputListeners(dom.targets, input, {
        onFocusNavigationDirection: (direction) => directions.push(direction),
      })

      dom.fire('keydown', { code: 'ArrowUp' })
      dom.fire('keydown', { code: 'ArrowLeft' })
      dom.fire('keydown', { code: 'ArrowRight' })
      dom.fire('keydown', { code: 'Tab' })
      dom.setPointerLockElement({ canvas: true })
      dom.fire('keydown', { code: 'ArrowDown' })

      expect(directions).toStrictEqual(['up', 'left', 'right'])
      const snapshot = yield* input.snapshot
      expect(snapshot.pressed.has('ArrowRight')).toBe(true)
      expect(snapshot.pressed.has('Tab')).toBe(true)
      expect(snapshot.pressed.has('ArrowDown')).toBe(true)
      expect(dom.preventedDefaults()).toBe(0)
    }),
  )
})

// ---------------------------------------------------------------------------
// Click landing scalar DTO
// ---------------------------------------------------------------------------

describe('click landing is classified by the host and dispatched as a scalar DTO', () => {
  it.effect('the canvas identity wins, and non-canvas membership is delegated', () =>
    Effect.sync(() => {
      const canvas = { canvas: true }
      const slot = { slot: true }
      let classifications = 0
      const classify = (target: unknown) => {
        classifications += 1
        if (target === slot) {
          return 'ui' as const
        }
        return 'elsewhere' as const
      }

      expect(resolveClickLanding(canvas, canvas, classify)).toBe('lock-target')
      expect(classifications).toBe(0)
      expect(resolveClickLanding(canvas, slot, classify)).toBe('ui')
      expect(resolveClickLanding(canvas, { letterbox: true }, classify)).toBe('elsewhere')
      expect(resolveClickLanding(canvas, null, classify)).toBe('elsewhere')
      expect(classifications).toBe(2)
      expect(resolveClickLanding(undefined, slot)).toBe('elsewhere')
    }),
  )

  it.effect('mousedown forwards the host classification and the service records its landing', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const canvas = { canvas: true }
      const slot = { slot: true }
      const focus = { group: HOTBAR_FOCUS_GROUP, index: 2 }
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input, {
        clickLandingForTarget: (target) => {
          if (target === slot) {
            return 'ui'
          }
          return 'elsewhere'
        },
        focusTargetForElement: (target) => {
          if (target === slot) {
            return focus
          }
          return undefined
        },
        pointerLockTarget: canvas,
      })

      dom.fire('focusin', { target: slot })
      dom.fire('mousedown', { button: 0, target: slot })
      dom.fire('mousedown', { button: 0, target: canvas })
      dom.fire('mousedown', { button: 0, target: { letterbox: true } })

      const snapshot = yield* input.snapshot
      expect(snapshot.keyboardFocus).toStrictEqual(focus)
      expect(snapshot.uiClickLandings).toStrictEqual([
        { button: 'MouseLeft', landing: 'ui' },
        { button: 'MouseLeft', landing: 'lock-target' },
        { button: 'MouseLeft', landing: 'elsewhere' },
      ])
      expect(snapshot.uiClickLandings.some(({ button, landing }) =>
        acquiresPointerLock(button, snapshot.pointerLockState, landing),
      )).toBe(true)
    }),
  )

  it.effect('browserInputLayer forwards focus, click, and navigation callbacks to listeners', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const canvas = makeFakeCanvas()
      const slot = { slot: true }
      const focus = { group: HOTBAR_FOCUS_GROUP, index: 4 }
      const directions: Array<string> = []

      yield* Effect.gen(function* () {
        const input = yield* InputService
        dom.fire('focusin', { target: slot })
        dom.fire('mousedown', { button: 0, target: slot })
        dom.fire('keydown', { code: 'ArrowDown' })

        const snapshot = yield* input.snapshot
        expect(snapshot.keyboardFocus).toStrictEqual(focus)
        expect(snapshot.uiClickLandings).toStrictEqual([{ button: 'MouseLeft', landing: 'ui' }])
        expect(directions).toStrictEqual(['down'])
      }).pipe(Effect.provide(browserInputLayer({
        targets: dom.targets,
        canvas,
        clickLandingForTarget: (target) => {
          if (target === slot) {
            return 'ui'
          }
          return 'elsewhere'
        },
        focusTargetForElement: (target) => {
          if (target === slot) {
            return focus
          }
          return undefined
        },
        onFocusNavigationDirection: (direction) => directions.push(direction),
      })))
    }),
  )

  it.effect('locked clicks remain gameplay input and click handlers do not suppress defaults', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* lockedInput
      const canvas = { canvas: true }
      installInputListeners(dom.targets, input, {
        clickLandingForTarget: () => 'ui',
        pointerLockTarget: canvas,
      })
      dom.setPointerLockElement(canvas)

      dom.fire('mousedown', { button: 0, target: canvas })

      expect(yield* input.wasButtonJustPressed('MouseLeft')).toBe(true)
      expect(yield* input.isActionActive('attack')).toBe(true)
      expect(dom.preventedDefaults()).toBe(0)
      expect(PREVENT_DEFAULT_EVENTS).toStrictEqual(['wheel', 'contextmenu'])
    }),
  )
})

// ---------------------------------------------------------------------------
// The property this whole design rests on
// ---------------------------------------------------------------------------

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('REGRESSION: the DOM surface is a real subset of the real DOM', () => {
  it.effect(
    'a real Window, Document and HTMLCanvasElement satisfy the adapter without a cast',
    () =>
      Effect.sync(() => {
        // The claim `application/dom-surface.ts` makes, checked rather than
        // asserted. It is NOT obvious and NOT stable under a careless edit:
        // `strictFunctionTypes` makes listener parameters contravariant, so
        // making `DomInputEvent.code` required — or splitting the shape per
        // event kind — makes `Window` unassignable to `DomEventTarget`. Nothing
        // in `pnpm typecheck` would notice, because that project has no DOM to
        // be assignable FROM; the first person to notice would be a browser
        // consumer, and the fix they would reach for is `as unknown as`.
        const fixture = path.join(repositoryRoot, 'test', 'fixtures', 'dom-surface.ts')
        const inspection = inspectTypeScriptFixture(repositoryRoot, fixture, ['ES2022', 'DOM'])

        expect(inspection.errors).toStrictEqual([])
      }),
    30_000,
  )

  it.effect('the shipped project still compiles with NO DOM at all', () =>
    Effect.sync(() => {
      // The other half of the proof, and the load-bearing one: `pnpm typecheck`
      // runs `tsconfig.build.json`, which must still say `lib: ["ES2024"]` and
      // `types: []`. If a later change adds "DOM" there, every pure module
      // silently becomes able to reach `document` and the reason
      // `environment: 'node'` can test the pointer-lock machine at all is gone.
      const parsed = parseTypeScriptConfig(
        repositoryRoot,
        path.join(repositoryRoot, 'tsconfig.build.json'),
      )

      expect(parsed.options['lib']).toStrictEqual(['lib.es2024.d.ts'])
      expect(parsed.options['types']).toStrictEqual([])
      expect(parsed.fileNames.some((file) => file.endsWith('application/browser-input-adapter.ts'))).toBe(true)
      expect(parsed.fileNames.some((file) => file.includes('/test/fixtures/'))).toBe(false)
    }),
  )
})
