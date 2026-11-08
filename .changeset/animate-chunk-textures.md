---
"@nerima-games/mc-render": minor
---

The browser frame payload carries `simulationTick`, `partialTick`, and `timeOfDayTicks`; the last is available to time-of-day rendering. Texture animation uses the exported `animationTimeSeconds` conversion, `(simulationTick + partialTick) / 20`, without accumulating frame elapsed time.
Invalid clock fields return `AnimationClockInputError` before uniforms update. Per-vertex `ChunkAnimationKind` tags follow block identity: water, lava, fire, Nether portals, and End portals animate, while ice stays static even when it shares lava's atlas tile.
The package root exports `ChunkAnimationKind` and the clock types `AnimationClockInput`, `AnimationClockInputError`, `AnimationSeconds`, `PartialTick`, and `TimeOfDayTicks`.
