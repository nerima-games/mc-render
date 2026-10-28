---
"@nerima-games/mc-render": minor
---

Publish the browser runtime from `@nerima-games/mc-render/browser` with its own
DOM-aware release build. Expose the typed `ParticleService` request API and the
exhaustive `DomainEvent` particle mapper from the package root. Migrate to
mc-sim 0.6.0 and mc-worldgen 0.7.0, and validate public rendering inputs with
typed failures. Use the kernel brands `PositionAxis` and `DeltaTimeSecs` with
mc-render's `ParticleUvCoordinate`, `ParticleBurstCount`, and `ParticleTileIndex`
in the low-level particle API. Accept `ParticleSpawnSpecEncoded` for low-level
spawns and decode it with `ParticleSpawnSpecSchema` before writing to pool
buffers. The `spawnBurst`, `spawnBlockBurst`, and `advanceParticles` signatures
require branded values; callers that start from numbers must decode them with
the exported schemas.
