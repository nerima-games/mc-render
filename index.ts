/**
 * @nerima-games/mc-render — rendering, and the runtime input service.
 *
 * PRE-AUDIT FIRST CUT (叩き台). See README.md 現状.
 *
 * Two responsibilities that look unrelated and are not:
 *
 *   RENDERING (plan.md §3.9) — THREE.js materials, camera, post-FX, particles,
 *   water, the worker pool, and the textures.
 *
 *   RUNTIME INPUT (plan.md §2.3-2, §7) — keyboard, mouse, pointer lock, touch,
 *   key remapping. It lives here and NOT in mc-playground-kit, because kit is
 *   dev-only: input placed there would be absent from every shipped build. Both
 *   are browser-platform concerns, and this is the repository that owns the
 *   browser platform.
 *
 * What this repository is NOT allowed to be: the authority on the camera.
 * mc-sim owns `CameraPoseSnapshot`; `domain/camera-mirror.ts` consumes one and
 * produces renderer state, in that direction only. The dependency graph makes
 * the reverse a cycle, which `pnpm check:deps` rejects outright.
 *
 * The domain is PURE — no THREE.js, no DOM, no WebGL. The post-FX chain, the
 * material policy, the input bindings and the scratch buffers are all data and
 * pure functions, which is what lets them be tested in Node under
 * `environment: 'node'`.
 *
 * The `window` input adapter is here now, and it did NOT turn `"DOM"` on in
 * `tsconfig.base.json`: it describes the handful of DOM members it uses as
 * structural types in `application/dom-surface.ts`, which is one file, is
 * auditable in one read, and is proved against the real `lib.dom.d.ts` by a
 * test. `pnpm typecheck` therefore still compiles this entire shipped surface
 * with `lib: ["ES2024"]` and `types: []` — which is the property that keeps the
 * pointer-lock state machine testable at all (plan.md §3.10: Playwright runs on
 * SwiftShader and cannot do pointer lock). The THREE.js adapter is the next
 * commit and is where `"DOM"`/`"WebWorker"` get argued about again.
 */

// --- Domain: pure values, policies and orderings ---------------------------
export * from './domain/camera-mirror'
export * from './domain/frame-scratch'
export * from './domain/input-bindings'
export * from './domain/material-policy'
export * from './domain/post-processing'

// --- Application: Effect services ------------------------------------------
export * from './application/input-service'

// --- Application: the browser adapter for the input service ------------------
// The ONLY files in this repository that know what an `addEventListener` is.
// `dom-surface.ts` is the whole DOM dependency, structurally; see its header for
// why that is a narrow interface rather than `"lib": ["DOM"]`.
export * from './application/dom-surface'
export * from './application/browser-input-adapter'

// --- Stages: this repository's contribution to the frame --------------------
// `renderModule` is a full `GameModule` (plan.md §4.1): a Layer plus an
// Effect-valued `frameStages`. It is what closes the hole recorded in
// mc-compose/docs/architecture.md §5 — nothing in the roster could reach the
// renderer, so the shipped build had no input stage at all.
export * from './stages/registration'
export * from './stages/stage-ids'

// --- Provisional -------------------------------------------------------------
// `domain/kernel-vocabulary.ts` is a temporary local mirror of
// @nerima-games/mc-kernel and is NOT re-exported: consumers must take that
// vocabulary from kernel, not from mc-render, or the mirror would become a
// second source of truth and its scheduled deletion would break them.
