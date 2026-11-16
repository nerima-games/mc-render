---
"@nerima-games/mc-render": minor
---

Add `ParticleServiceForPool(pool, { renderContext })` to provide a particle service over an existing pool. The package root's `makeProductionWorldRenderer` exposes `particlePool` without a particle service; hosts can use this layer to spawn requests into that pool. The required getter supplies the host's current dimension and entity snapshot for request validation and follow resolution.

`ParticleServiceLive` retains its existing optional render context. Both entrypoints share request validation and spawning behavior.
