---
'@nerima-games/mc-render': minor
---

Harden the renderer's strict TypeScript and browser input boundaries, including runtime decoding for persisted input settings and worker responses. ScratchMap and ParticlePool construction now use opaque brands, so hand-built values are rejected by the public types.
