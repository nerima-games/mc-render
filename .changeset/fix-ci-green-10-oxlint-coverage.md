---
"@nerima-games/mc-render": minor
---

Clear every `oxlint --deny-warnings` violation across `src/`, `apps/`, `scripts/`, and `test/`, and close the coverage gate (all four metrics now above the 99% threshold, up from below it since the 2026-08-01 org rollout).

`.oxlintrc.json` gained a small number of narrow, evidence-based base-rule refinements rather than per-file suppressions: an `id-length` exception for the graphics-domain vector/color vocabulary (`x`/`y`/`z`/`u`/`v`/`r`/`g`/`b`/`a`, matching Three.js's own field names), a `no-underscore-dangle` allowance for Effect's `_tag` discriminated-union field, and file-scoped `max-params` exemptions for published entry points confirmed (by inspecting the sibling `mc-compose` checkout) to be called positionally by real external code — `makeWorldRenderer`, `makeProductionWorldRenderer`, `syncWorld`, `buildChunkGeometry` — plus `src/domain/particle-pool.ts`, whose already-documented zero-allocation frame-path design predates this change.

Two previously-unused exported functions had their signatures reshaped from long positional argument lists into an options object, with zero known external callers (verified against this repo and the sibling `mc-compose`/`mc-playground-kit` checkouts):

- `attachChunkStoreRenderer(renderer, store, options?, config?)` → `attachChunkStoreRenderer(renderer, store, options?)`, where `options.config` now carries the mesh config.
- `preparePerspectiveFrustum(camera, verticalFovDegrees, aspect, nearPlane, farPlane)` → `preparePerspectiveFrustum(frustum: PerspectiveFrustum)`, reusing the file's own existing `PerspectiveFrustum` type.

No other exported function's signature or runtime behavior changed. The coverage work added real behavioral tests for previously-untested branches across `src/application/**` and `src/domain/**`; a handful of branches that proved genuinely unreachable through any public call path (documented in each case, e.g. `worker-pool.ts`'s post-`shift()` guard on a provably non-empty queue) remain uncovered rather than forced with `v8 ignore`.
