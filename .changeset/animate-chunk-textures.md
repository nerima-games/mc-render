---
"@nerima-games/mc-render": minor
---

Scroll the water, lava, fire, Nether portal, and End portal tile UVs from cumulative frame elapsed time (`elapsedSecs`); reject negative and non-finite elapsed times. Tile 18 is shared by lava and ice, so both receive the lava UV offset.
