---
"@nerima-games/mc-render": minor
---

The browser frame payload carries `simulationTick`, `partialTick`, and `timeOfDayTicks`. `animationTimeSeconds` derives animation seconds from `(simulationTick + partialTick) / 20`; this calculation does not accumulate frame elapsed time or use `timeOfDayTicks`.
Invalid clock fields return `AnimationClockInputError` before uniforms update. Per-vertex `ChunkAnimationKind` tags follow block identity: water, lava, fire, Nether portals, and End portals animate, while ice stays static even when it shares lava's atlas tile.
The package root exports `ChunkAnimationKind` and the clock types `AnimationClockInput`, `AnimationClockInputError`, `AnimationSeconds`, `PartialTick`, and `TimeOfDayTicks`.
