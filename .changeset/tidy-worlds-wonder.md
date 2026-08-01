---
"@nerima-games/mc-render": patch
---

Migrate to the org's `src/` package layout (PACKAGE_STANDARD.md) and add the
previously-undeclared `@nerima-games/mc-sim` runtime dependency, aligning
`package.json#dependencies` with the Tier2 dependency graph declared in
DEPENDENCY_POLICY.md and `docs/architecture.md` §3.1. No shipped import from
`mc-sim` exists yet (the `CameraPoseSnapshot` type it conceptually owns is
still provisionally mirrored in `src/domain/kernel-vocabulary.ts`); this only
corrects the declared dependency to match the documented graph ahead of that
mirror being retired.
