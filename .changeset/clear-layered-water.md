---
'@nerima-games/mc-render': minor
---

Render nonempty opaque, cutout, blended, and water chunk layers with separate meshes and materials. Discard cutout fragments below the alpha threshold. Let Three.js sort blended and water meshes back-to-front using each chunk-layer mesh's bounding-sphere center, and render water fluid geometry with the water shader material.
