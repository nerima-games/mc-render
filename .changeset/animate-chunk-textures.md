---
"@nerima-games/mc-render": minor
---

Require each render frame to carry `simulationTick`, `partialTick`, and `timeOfDayTicks`. Derive animated texture seconds as `(simulationTick + partialTick) / 20` and export that conversion for RN4; do not accumulate frame elapsed time. Validate all three clock values before updating uniforms. Motion tags follow block identity, so water, lava, fire, Nether portals, and End portals animate while ice remains static even when it shares lava's current atlas tile.
