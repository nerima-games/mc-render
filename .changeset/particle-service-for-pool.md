---
"@nerima-games/mc-render": minor
---

Add `ParticleServiceForPool(pool, options)` to provide a particle service over an existing pool, including a renderer's `particlePool`. `ParticleServiceLive` delegates to this layer after creating its pool, so both entrypoints share request validation and spawning behavior.
