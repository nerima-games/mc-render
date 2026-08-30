---
"@nerima-games/mc-render": minor
---

Repoint the LOD vocabulary (`CHUNK_SIZE`, `LOD_LEVELS`, `LodLevel`, `LodLevelSchema`, `STEP_FOR_LOD`) from the local `domain/lod-vocabulary.ts` mirror to `@nerima-games/mc-meshing`, now that mc-meshing has published it. The barrel no longer re-exports these names; consumers import them from `@nerima-games/mc-meshing` directly.
