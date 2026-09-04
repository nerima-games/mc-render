---
"@nerima-games/mc-render": minor
---

Thread `@nerima-games/mc-kernel`'s `Dimension` through the environment planner and the weather environment builder, so the sky, fog and sun depend on which dimension the camera is in. `overworld` — the day/night sky driven by `daylight` — stays the default everywhere, so every existing caller's output is unchanged byte-for-byte; the two new presets are the nether (a fixed, sunless haze that ignores `daylight`, with a much tighter fog interval so it closes in well short of the far plane) and the end (a dark, sunless clear colour, deliberately not pure black — see `END_VOID_COLOR`'s note on why). Neither preset drives `sunIntensity` from `daylight`: there is no day/night cycle without an open sky.

`RenderEnvironmentPlan` gains a `dimension: Dimension` field echoing the resolved dimension, so a host can branch on it later (e.g. an end starfield, which is real rendering work — new geometry, not a colour swap — and is deliberately not part of this change).

Threaded through three existing entry points, each via a new optional parameter/field so nothing already calling them needs to change:

- `WorldRendererOptions.dimension?: Dimension` — the renderer's startup sky, alongside the existing `daylight` option.
- `WorldWeatherSnapshot.dimension?: Dimension` — the sky a planned weather frame renders, alongside the existing `daylight` field.
- `WeatherRenderer.stop(daylight?, dimension?)` — the sky restored when precipitation stops.

Also exports `planRenderEnvironment`, `NETHER_FOG_COLOR`, `END_VOID_COLOR`, and `DEFAULT_DIMENSION` from the package root, alongside the existing `DAY_SKY_COLOR`/`NIGHT_SKY_COLOR`/`DEFAULT_ENVIRONMENT_FAR_PLANE`. `Dimension` itself is not re-exported — consumers already import it from `@nerima-games/mc-kernel` directly, per this package's existing "vocabulary is not mirrored" policy (`src/index.ts`'s own closing note).
