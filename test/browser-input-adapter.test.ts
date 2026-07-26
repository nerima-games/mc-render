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
import ts from 'typescript'
import {
  acquiresPointerLock,
  defaultBindings,
  GAMEPLAY_LISTENER_TARGET,
  HOTBAR_FOCUS_GROUP,
  MODAL_LISTENER_TARGET,
  WHEEL_LINES_PER_NOTCH,
  WHEEL_PIXELS_PER_NOTCH,
} from '../domain/input-bindings'
import {
  InputService,
  LISTENER_PLAN,
  makeInputService,
  type InputEvent,
} from '../application/input-service'
import {
  browserInputLayer,
  installInputListeners,
  listenerOptionsFor,
  makeBrowserPointerLockPort,
  mayPreventDefault,
  PREVENT_DEFAULT_EVENTS,
  resolveClickLanding,
  resolveFocusTarget,
  scopedInputListeners,
  translateDomEvent,
  TRANSLATED_DOM_EVENTS,
  type BrowserInputTargets,
} from '../application/browser-input-adapter'
import type { DomEventContext, FocusGroupTargets } from '../application/browser-input-adapter'
import type { DomInputEvent, DomListener, DomListenerOptions } from '../application/dom-surface'

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
      },
    },
    added,
    removed,
    live,
    fire: (type, event) => {
      const matching = live().filter((call) => call.type === type)
      for (const call of matching) {
        call.listener({
          preventDefault: () => {
            prevented += 1
          },
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
 * No lock, and no focusable UI named. The second half is the honest default for
 * a host that draws only a canvas — and it is what makes "a focusin on an
 * element nobody named reports NO focus" the case that runs by default rather
 * than the one somebody has to remember to write.
 */
const noContext: DomEventContext = { pointerLockHeld: false, focusGroups: [] }

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
          yield* scopedInputListeners(dom.targets, input)
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
      expect(
        translateDomEvent({ event: 'touchstart', target: 'document' }, { preventDefault: noop }, noContext),
      ).toBeUndefined()
    }),
  )

  it.effect('a keydown with no code is dropped — a handler must not throw', () =>
    Effect.sync(() => {
      expect(translateDomEvent(planned('keydown'), { preventDefault: noop }, noContext)).toBeUndefined()
      expect(translateDomEvent(planned('mousedown'), { preventDefault: noop }, noContext)).toBeUndefined()
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
// Keyboard focus
// ---------------------------------------------------------------------------

/**
 * Nine opaque objects standing in for mx-ui's nine hotbar slot elements.
 *
 * They are `{}` and not fakes of an element, which is the whole point of
 * `FocusGroupTargets.targets` being `ReadonlyArray<unknown>`: the adapter has no
 * way to read anything off them, so a test cannot accidentally exercise a path
 * a browser would not have. Identity is all there is, and identity is all the
 * adapter uses.
 */
const makeSlots = (count: number): ReadonlyArray<unknown> =>
  Array.from({ length: count }, (_unused, index) => ({ slot: index }))

describe('REGRESSION: focusin resolves the element the browser focused', () => {
  it.effect('an element in the roster becomes its group and its 0-based position', () =>
    Effect.sync(() => {
      // The conversion at the boundary, and it is the same KIND of conversion
      // `mouseButtonForIndex` is: an opaque thing the DOM handed over becomes a
      // name the pure model can carry. 0-based, because that is what
      // `HudView.setKeyboardFocus` takes.
      const slots = makeSlots(9)
      const hotbar: FocusGroupTargets = { group: HOTBAR_FOCUS_GROUP, targets: slots }

      expect(
        translateDomEvent(
          planned('focusin'),
          { preventDefault: noop, target: slots[3] },
          { pointerLockHeld: false, focusGroups: [hotbar] },
        ),
      ).toStrictEqual({ kind: 'focuschange', focus: { group: HOTBAR_FOCUS_GROUP, index: 3 } })
    }),
  )

  it.effect('an element NOBODY named reports no focus — never slot zero', () =>
    Effect.sync(() => {
      // The bug a careless `indexOf` clamp would produce: `-1` becomes `0`, and
      // the ring lights slot 0 every time the player Tabs to the address bar.
      const slots = makeSlots(9)
      const hotbar: FocusGroupTargets = { group: HOTBAR_FOCUS_GROUP, targets: slots }

      expect(
        translateDomEvent(
          planned('focusin'),
          { preventDefault: noop, target: { someOtherButton: true } },
          { pointerLockHeld: false, focusGroups: [hotbar] },
        ),
      ).toStrictEqual({ kind: 'focuschange', focus: undefined })
    }),
  )

  it.effect('focus that went to nothing at all reports no focus, not a dropped event', () =>
    Effect.sync(() => {
      // A DROPPED event would leave the ring lit on the slot the keyboard just
      // left, which is the opposite of the failure being fixed. So `undefined`
      // and `null` targets are REPORTS, not drops.
      expect(
        translateDomEvent(planned('focusin'), { preventDefault: noop }, noContext),
      ).toStrictEqual({ kind: 'focuschange', focus: undefined })
      expect(
        translateDomEvent(planned('focusin'), { preventDefault: noop, target: null }, noContext),
      ).toStrictEqual({ kind: 'focuschange', focus: undefined })
    }),
  )

  it.effect('focusout ALWAYS reports no focus, whatever element it came from', () =>
    Effect.sync(() => {
      // `focusout` fires on the element being LEFT. Resolving its target would
      // report the slot the keyboard just departed as the slot it is on — the
      // ring would lag one move behind, permanently.
      const slots = makeSlots(9)
      const hotbar: FocusGroupTargets = { group: HOTBAR_FOCUS_GROUP, targets: slots }

      expect(
        translateDomEvent(
          planned('focusout'),
          { preventDefault: noop, target: slots[3] },
          { pointerLockHeld: false, focusGroups: [hotbar] },
        ),
      ).toStrictEqual({ kind: 'focuschange', focus: undefined })
    }),
  )

  it.effect('the index is the position within its OWN group, not across all of them', () =>
    Effect.sync(() => {
      const hotbarSlots = makeSlots(9)
      const settingsControls = makeSlots(4)
      const groups: ReadonlyArray<FocusGroupTargets> = [
        { group: HOTBAR_FOCUS_GROUP, targets: hotbarSlots },
        { group: 'settings', targets: settingsControls },
      ]

      expect(resolveFocusTarget(groups, hotbarSlots[8])).toStrictEqual({
        group: HOTBAR_FOCUS_GROUP,
        index: 8,
      })
      expect(resolveFocusTarget(groups, settingsControls[1])).toStrictEqual({
        group: 'settings',
        index: 1,
      })
    }),
  )

  it.effect('a host with NO roster reports every focus change as no focus', () =>
    Effect.sync(() => {
      // The honest answer for a preview that draws only a canvas: there is no
      // focusable game UI, so the keyboard is never on any of it. It is a
      // coherent state, not a degenerate one — which is why the listeners are
      // registered anyway and `LISTENER_PLAN` does not vary per host.
      expect(resolveFocusTarget([], {})).toBeUndefined()
      expect(resolveFocusTarget([{ group: HOTBAR_FOCUS_GROUP, targets: [] }], {})).toBeUndefined()
    }),
  )

  it.effect('resolution is by IDENTITY, so an equal-looking element is not the same slot', () =>
    Effect.sync(() => {
      // The property that makes an attribute read unnecessary. Two slots that
      // carry the same `data-slot-index` — mx-ui's hotbar slot 0 and its
      // inventory slot 0 do — are still two different objects.
      const hotbarSlot0 = { 'data-slot-index': '0' }
      const inventorySlot0 = { 'data-slot-index': '0' }
      const groups: ReadonlyArray<FocusGroupTargets> = [
        { group: HOTBAR_FOCUS_GROUP, targets: [hotbarSlot0] },
      ]

      expect(resolveFocusTarget(groups, hotbarSlot0)).toStrictEqual({
        group: HOTBAR_FOCUS_GROUP,
        index: 0,
      })
      expect(resolveFocusTarget(groups, inventorySlot0)).toBeUndefined()
    }),
  )
})

describe('the adapter observes focus the way a browser would deliver it', () => {
  it.effect('a Tab into the hotbar is visible in the snapshot, end to end', () =>
    Effect.gen(function* () {
      // The whole feature, through the real listener: the browser moved focus
      // on Tab, `focusin` bubbled to `document`, and the snapshot now says
      // where it went. Nothing here pressed Tab, and nothing here moved focus.
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      const slots = makeSlots(9)
      installInputListeners(dom.targets, input, [
        { group: HOTBAR_FOCUS_GROUP, targets: slots },
      ])

      dom.fire('focusin', { target: slots[2] })

      expect((yield* input.snapshot).keyboardFocus).toStrictEqual({
        group: HOTBAR_FOCUS_GROUP,
        index: 2,
      })
    }),
  )

  it.effect('a move within the group settles on the ARRIVAL, not on the departure', () =>
    Effect.gen(function* () {
      // Exactly the pair of events a browser fires for one focus move, in the
      // order it fires them: focusout from the old element, then focusin on the
      // new one, in the same task. The intermediate "nowhere" is real and no
      // frame can observe it.
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      const slots = makeSlots(9)
      installInputListeners(dom.targets, input, [
        { group: HOTBAR_FOCUS_GROUP, targets: slots },
      ])
      dom.fire('focusin', { target: slots[0] })

      dom.fire('focusout', { target: slots[0] })
      dom.fire('focusin', { target: slots[5] })

      expect((yield* input.snapshot).keyboardFocus).toStrictEqual({
        group: HOTBAR_FOCUS_GROUP,
        index: 5,
      })
    }),
  )

  it.effect('Tabbing OUT of the group clears the report, so the ring goes with it', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      const slots = makeSlots(9)
      installInputListeners(dom.targets, input, [
        { group: HOTBAR_FOCUS_GROUP, targets: slots },
      ])
      dom.fire('focusin', { target: slots[8] })

      // The last slot, Tab again: the browser leaves the group entirely.
      dom.fire('focusout', { target: slots[8] })
      dom.fire('focusin', { target: { theBrowsersOwnChrome: true } })

      expect((yield* input.snapshot).keyboardFocus).toBeUndefined()
    }),
  )

  it.effect('REGRESSION: no focus handler EVER calls preventDefault', () =>
    Effect.gen(function* () {
      // The trap this feature is most likely to fall into, asserted through the
      // installed listeners rather than by reading the code. A canvas that eats
      // Tab is a keyboard trap: the player cannot reach the browser chrome, the
      // next control, or the settings screen that would let them rebind out of
      // it. Locked as well as unlocked, because "only while locked" is exactly
      // the narrowing the context menu and the scroll DID get and this must not.
      const dom = makeFakeDom()
      const input = yield* lockedInput
      const slots = makeSlots(9)
      installInputListeners(dom.targets, input, [
        { group: HOTBAR_FOCUS_GROUP, targets: slots },
      ])

      dom.fire('keydown', { code: 'Tab' })
      dom.fire('focusin', { target: slots[1] })
      dom.fire('focusout', { target: slots[1] })
      dom.fire('keyup', { code: 'Tab' })

      expect(dom.preventedDefaults()).toBe(0)
    }),
  )

  it.effect('the focus listeners make NO preventDefault claim — no passive: false on either', () =>
    Effect.gen(function* () {
      // NOT "they are passive": `focusin` is non-passive by default, like every
      // event except wheel/mousewheel/touchstart/touchmove, and this repository
      // does not ask for anything else. The assertion is that neither listener
      // carries the explicit `passive: false` that `listenerOptionsFor` puts on
      // exactly the handlers allowed to suppress a default — an option object
      // that said `passive: false` here would be a claim that a focus handler
      // might call `preventDefault()`, and it must never be able to make it.
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      const focusCalls = dom.added.filter((call) => call.type.startsWith('focus'))
      expect(focusCalls.map((call) => call.type).sort()).toStrictEqual(['focusin', 'focusout'])
      expect(focusCalls.every((call) => call.options?.passive === undefined)).toBe(true)
      expect(focusCalls.every((call) => call.where === 'document')).toBe(true)
    }),
  )

  it.effect('the roster travels through browserInputLayer and its listeners leave with the scope', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const slots = makeSlots(9)

      yield* Effect.gen(function* () {
        const input = yield* InputService

        dom.fire('focusin', { target: slots[6] })
        expect((yield* input.snapshot).keyboardFocus).toStrictEqual({
          group: HOTBAR_FOCUS_GROUP,
          index: 6,
        })
      }).pipe(
        Effect.provide(
          browserInputLayer({
            targets: dom.targets,
            bindings: defaultBindings(),
            focusGroups: [{ group: HOTBAR_FOCUS_GROUP, targets: slots }],
          }),
        ),
      )

      expect(dom.live()).toStrictEqual([])
      // A dead listener cannot report a focus that is not this page's any more.
      expect(dom.fire('focusin', { target: slots[6] })).toBe(0)
    }),
  )

  it.effect('a host that names no groups still registers the listeners and reports nothing', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      expect(dom.fire('focusin', { target: { anything: true } })).toBe(1)

      expect((yield* input.snapshot).keyboardFocus).toBeUndefined()
    }),
  )
})

// ---------------------------------------------------------------------------
// DN-16 §5(b): WHERE the click landed
// ---------------------------------------------------------------------------
//
// The adapter's half. `acquiresPointerLock` is a pure predicate over NAMES and
// stays testable in Node with fakes; turning an element into one of those names
// is a boundary conversion and lives here, next to `mouseButtonForIndex` and
// `resolveFocusTarget`. Each landing has its own test, so a failure says which
// one broke rather than "the pointer lock".

describe('REGRESSION: a mousedown carries WHERE it landed', () => {
  it.effect('the LOCK TARGET is recognised by identity, and only by identity', () =>
    Effect.sync(() => {
      // The canvas the host named — the same object `makeBrowserPointerLockPort`
      // will call `requestPointerLock()` on. The rule stated once: the element
      // that will receive the lock is the element you must click to ask for it.
      const canvas = { canvas: true }
      const lookalike = { canvas: true }

      expect(resolveClickLanding(canvas, [], canvas)).toBe('lock-target')
      // Structurally equal is not the same element. `===` is the only operation
      // this repository performs on a DOM object, and that is what keeps the
      // surface at `target?: unknown` (DN-15).
      expect(resolveClickLanding(canvas, [], lookalike)).toBe('elsewhere')
    }),
  )

  it.effect('a REGISTERED UI element is `ui`, which is the landing that never asks', () =>
    Effect.sync(() => {
      const canvas = { canvas: true }
      const slots = makeSlots(9)
      const hotbar: FocusGroupTargets = { group: HOTBAR_FOCUS_GROUP, targets: slots }

      expect(resolveClickLanding(canvas, [hotbar], slots[0])).toBe('ui')
      expect(resolveClickLanding(canvas, [hotbar], slots[8])).toBe('ui')
    }),
  )

  it.effect('an element in NEITHER is `elsewhere`, and that is a third answer and not a `ui`', () =>
    Effect.sync(() => {
      // The case that decides which predicate this is. A letterbox bar beside a
      // fixed-aspect canvas, a host-drawn header, `<body>` itself: none of them
      // are in the roster, because the roster exists for FOCUS and a decorative
      // bar is not focusable. Reporting them as `ui` would be a lie; granting
      // them the pointer — which "not UI" would do — is the hazard.
      const canvas = { canvas: true }
      const hotbar: FocusGroupTargets = { group: HOTBAR_FOCUS_GROUP, targets: makeSlots(9) }

      expect(resolveClickLanding(canvas, [hotbar], { letterbox: true })).toBe('elsewhere')
    }),
  )

  it.effect('a click on NOTHING is `elsewhere`, even when the host named no lock target', () =>
    Effect.sync(() => {
      // The trap in the obvious implementation: with `pointerLockTarget`
      // undefined and `event.target` undefined, a bare `===` says `lock-target`
      // — so every unplaceable click would take the pointer in exactly the
      // hosts that declared nothing. Both guards are here on purpose.
      expect(resolveClickLanding(undefined, [], undefined)).toBe('elsewhere')
      expect(resolveClickLanding(undefined, [], null)).toBe('elsewhere')
      expect(resolveClickLanding({ canvas: true }, [], null)).toBe('elsewhere')
      expect(resolveClickLanding(undefined, [], { anything: true })).toBe('elsewhere')
    }),
  )

  it.effect('the lock target WINS over a roster that also names it, so the tie is not silent', () =>
    Effect.sync(() => {
      // A host contradiction with no safe reading; the tie has to break
      // somewhere and it breaks toward the truth, because that element IS the
      // one `requestPointerLock` will be called on. No roster produces this by
      // accident — a query like `[data-mx-ui="slot"]` cannot return the canvas.
      const canvas = { canvas: true }
      const confused: FocusGroupTargets = { group: HOTBAR_FOCUS_GROUP, targets: [canvas] }

      expect(resolveClickLanding(canvas, [confused], canvas)).toBe('lock-target')
    }),
  )

  it.effect('the translation puts the landing on the event, and on mousedown only', () =>
    Effect.sync(() => {
      const canvas = { canvas: true }
      const slots = makeSlots(9)
      const context: DomEventContext = {
        pointerLockHeld: false,
        focusGroups: [{ group: HOTBAR_FOCUS_GROUP, targets: slots }],
        pointerLockTarget: canvas,
      }

      expect(
        translateDomEvent(planned('mousedown'), { preventDefault: noop, button: 0, target: canvas }, context),
      ).toStrictEqual({
        kind: 'mousedown',
        button: 'MouseLeft',
        target: GAMEPLAY_LISTENER_TARGET,
        landing: 'lock-target',
      })
      expect(
        translateDomEvent(planned('mousedown'), { preventDefault: noop, button: 0, target: slots[2] }, context),
      ).toStrictEqual({
        kind: 'mousedown',
        button: 'MouseLeft',
        target: GAMEPLAY_LISTENER_TARGET,
        landing: 'ui',
      })
      // `mouseup` has none, and must not grow one: a release is unconditional
      // (`withCodeUp`), and a button released after the lock was lost has to
      // come up wherever the cursor happens to be.
      expect(
        translateDomEvent(planned('mouseup'), { preventDefault: noop, button: 0, target: slots[2] }, context),
      ).toStrictEqual({ kind: 'mouseup', button: 'MouseLeft', target: GAMEPLAY_LISTENER_TARGET })
    }),
  )
})

describe('REGRESSION: clicking the HUD does not take the pointer', () => {
  /** A page with a canvas and a nine-slot hotbar over it, as a host builds one. */
  const makePage = () => {
    const canvas = makeFakeCanvas()
    const slots = makeSlots(9)
    return {
      canvas,
      slots,
      focusGroups: [{ group: HOTBAR_FOCUS_GROUP, targets: slots }] as ReadonlyArray<FocusGroupTargets>,
    }
  }

  it.effect('a click on a HOTBAR SLOT is a uiClick that does NOT ask for the lock', () =>
    Effect.gen(function* () {
      // The hazard end to end, through the listener the adapter really
      // registers. A DOM HUD drawn over the canvas is the TARGET of a click on
      // it — `event.target` is the deepest element the hit test found — so no
      // `contains` and no `composedPath` is needed to tell the two apart.
      const dom = makeFakeDom()
      const page = makePage()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input, page.focusGroups, page.canvas)

      // `tabindex="-1"` focuses on click, so this arrives first, and it is
      // correct — it is what lights the ring.
      dom.fire('focusin', { target: page.slots[3] })
      dom.fire('mousedown', { button: 0, target: page.slots[3] })

      const snapshot = yield* input.snapshot
      // Still a UI click: the menu that drew the slot wants to hear about it.
      expect([...snapshot.uiClicks]).toStrictEqual(['MouseLeft'])
      // ...and the frame can see that it must not ask.
      expect(snapshot.uiClickLandings).toStrictEqual([{ button: 'MouseLeft', landing: 'ui' }])
      expect(
        snapshot.uiClickLandings.some(({ button, landing }) =>
          acquiresPointerLock(button, snapshot.pointerLockState, landing),
        ),
      ).toBe(false)
    }),
  )

  it.effect('the ring the click LIT is still reported, because nothing locked', () =>
    Effect.gen(function* () {
      // The half the player sees. Before, the ring lit on `focusin` and was
      // masked one frame later by the lock the same `mousedown` had asked for.
      const dom = makeFakeDom()
      const page = makePage()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input, page.focusGroups, page.canvas)

      dom.fire('focusin', { target: page.slots[3] })
      dom.fire('mousedown', { button: 0, target: page.slots[3] })

      expect(yield* input.keyboardFocus).toStrictEqual({ group: HOTBAR_FOCUS_GROUP, index: 3 })
      expect(page.canvas.asks()).toBe(0)
    }),
  )

  it.effect('a click on the CANVAS does ask, so mouselook still works', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const page = makePage()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input, page.focusGroups, page.canvas)

      dom.fire('mousedown', { button: 0, target: page.canvas })

      const snapshot = yield* input.snapshot
      expect(snapshot.uiClickLandings).toStrictEqual([
        { button: 'MouseLeft', landing: 'lock-target' },
      ])
      expect(
        snapshot.uiClickLandings.some(({ button, landing }) =>
          acquiresPointerLock(button, snapshot.pointerLockState, landing),
        ),
      ).toBe(true)
    }),
  )

  it.effect('a click on NEITHER does not ask — the third case, through the real listener', () =>
    Effect.gen(function* () {
      const dom = makeFakeDom()
      const page = makePage()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input, page.focusGroups, page.canvas)

      dom.fire('mousedown', { button: 0, target: { letterbox: true } })

      const snapshot = yield* input.snapshot
      expect(snapshot.uiClickLandings).toStrictEqual([
        { button: 'MouseLeft', landing: 'elsewhere' },
      ])
      expect(
        snapshot.uiClickLandings.some(({ button, landing }) =>
          acquiresPointerLock(button, snapshot.pointerLockState, landing),
        ),
      ).toBe(false)
    }),
  )

  it.effect('browserInputLayer scopes the click to the canvas it was ALREADY given', () =>
    Effect.gen(function* () {
      // The reason this fix costs a browser host nothing. `canvas` is the field
      // a host already had to pass to be able to lock at all; it now also says
      // where a click has to land to be allowed to ask. No new declaration, and
      // no host that could not lock before changes behaviour.
      const dom = makeFakeDom()
      const page = makePage()

      yield* Effect.gen(function* () {
        const input = yield* InputService

        dom.fire('mousedown', { button: 0, target: page.slots[0] })
        dom.fire('mousedown', { button: 0, target: page.canvas })

        expect((yield* input.snapshot).uiClickLandings).toStrictEqual([
          { button: 'MouseLeft', landing: 'ui' },
          { button: 'MouseLeft', landing: 'lock-target' },
        ])
      }).pipe(
        Effect.provide(
          browserInputLayer({
            targets: dom.targets,
            canvas: page.canvas,
            focusGroups: page.focusGroups,
          }),
        ),
      )
    }),
  )

  it.effect('a host with NO canvas resolves every click as elsewhere, and could never lock anyway', () =>
    Effect.gen(function* () {
      // Not a regression for that host: with no canvas the port is
      // `UNAVAILABLE_POINTER_LOCK`, so its clicks never produced a lock before
      // either. What it keeps is `uiClicks`, which is all it ever read.
      const dom = makeFakeDom()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input)

      dom.fire('mousedown', { button: 0, target: { anything: true } })

      const snapshot = yield* input.snapshot
      expect([...snapshot.uiClicks]).toStrictEqual(['MouseLeft'])
      expect(snapshot.uiClickLandings).toStrictEqual([
        { button: 'MouseLeft', landing: 'elsewhere' },
      ])
    }),
  )

  it.effect('a click while LOCKED is a game action, and the landing decides nothing', () =>
    Effect.gen(function* () {
      // While locked the pointer is captured by the lock target and every event
      // goes there by definition, so the landing is not consulted — the click
      // joins the ordinary code space wherever the browser says it landed.
      const dom = makeFakeDom()
      const page = makePage()
      const input = yield* lockedInput
      installInputListeners(dom.targets, input, page.focusGroups, page.canvas)

      dom.fire('mousedown', { button: 0, target: page.slots[3] })

      expect(yield* input.wasButtonJustPressed('MouseLeft')).toBe(true)
      expect(yield* input.isActionActive('attack')).toBe(true)
      expect((yield* input.snapshot).uiClickLandings).toStrictEqual([])
    }),
  )

  it.effect('no click handler EVER calls preventDefault, whatever it landed on', () =>
    Effect.gen(function* () {
      // The landing is an OBSERVATION. Suppressing the default on a HUD click
      // would break the focus the click is supposed to move — and the
      // `preventDefault` list stays at wheel and contextmenu (DN-16 §1).
      const dom = makeFakeDom()
      const page = makePage()
      const input = yield* makeInputService()
      installInputListeners(dom.targets, input, page.focusGroups, page.canvas)

      dom.fire('mousedown', { button: 0, target: page.slots[3] })
      dom.fire('mousedown', { button: 0, target: page.canvas })
      dom.fire('mousedown', { button: 0, target: { letterbox: true } })

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
        const program = ts.createProgram({
          rootNames: [fixture],
          options: {
            noEmit: true,
            strict: true,
            exactOptionalPropertyTypes: true,
            noUncheckedIndexedAccess: true,
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            moduleDetection: ts.ModuleDetectionKind.Force,
            skipLibCheck: true,
            types: [],
            // THE POINT OF THE TEST: the real thing, not a hand-written stub.
            lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
          },
        })

        const diagnostics = [
          ...program.getSemanticDiagnostics(),
          ...program.getSyntacticDiagnostics(),
        ].filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)

        expect(
          diagnostics.map((diagnostic) =>
            ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
          ),
        ).toStrictEqual([])
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
      const config = ts.readConfigFile(path.join(repositoryRoot, 'tsconfig.build.json'), ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(
        config.config as unknown,
        ts.sys,
        repositoryRoot,
      )

      expect(parsed.options.lib).toStrictEqual(['lib.es2024.d.ts'])
      expect(parsed.options.types).toStrictEqual([])
      expect(parsed.fileNames.some((file) => file.endsWith('application/browser-input-adapter.ts'))).toBe(true)
      expect(parsed.fileNames.some((file) => file.includes('/test/fixtures/'))).toBe(false)
    }),
  )
})
