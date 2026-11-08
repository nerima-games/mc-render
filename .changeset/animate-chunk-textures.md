---
"@nerima-games/mc-render": minor
---

Drive animated water, lava, fire, Nether portal, and End portal UVs from `simulationTick` and `partialTick` at 20 ticks per second. Export the shared tick-to-seconds conversion for RN4 and validate the simulation tick, partial tick, and time-of-day tick before updating uniforms. Motion tags come from block identity, so ice remains static even while it shares lava's current atlas tile.
