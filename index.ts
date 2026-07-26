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
 * Everything exported here is CURRENTLY PURE — no THREE.js, no DOM, no WebGL.
 * The post-FX chain, the material policy, the input bindings and the scratch
 * buffers are all data and pure functions, which is what lets them be tested in
 * Node under `environment: 'node'`. The THREE.js and `window` adapters are the
 * next commit, and they are what turns `"DOM"` on in `tsconfig.base.json`.
 */

// --- Domain: pure values, policies and orderings ---------------------------
export * from './domain/camera-mirror'
export * from './domain/frame-scratch'
export * from './domain/input-bindings'
export * from './domain/material-policy'
export * from './domain/post-processing'

// --- Application: Effect services ------------------------------------------
export * from './application/input-service'

// --- Provisional -------------------------------------------------------------
// `domain/kernel-vocabulary.ts` is a temporary local mirror of
// @nerima-games/mc-kernel and is NOT re-exported: consumers must take that
// vocabulary from kernel, not from mc-render, or the mirror would become a
// second source of truth and its scheduled deletion would break them.
