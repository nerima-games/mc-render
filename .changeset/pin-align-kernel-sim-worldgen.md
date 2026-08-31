---
"@nerima-games/mc-render": patch
---

Align pinned dependencies to the current published set: `@nerima-games/mc-kernel` 0.4.0 → 0.7.0, `@nerima-games/mc-sim` 0.2.1 → 0.4.1, `@nerima-games/mc-worldgen` 0.2.0 → 0.3.1. No source change was required: every kernel property this package reads (`opacity`, `collisionShape`, `renderKind`, `fluid`) is still consumed as its full multi-valued union rather than narrowed to a boolean, and this package never reads `BLOCK_ID_MAX` as a bitmask or storage bound. `pnpm verify`, `pnpm test:coverage` (100% on all four axes), `pnpm build`, and `pnpm package:verify` all pass against the new pins.
