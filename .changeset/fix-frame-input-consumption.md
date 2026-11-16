---
'@nerima-games/mc-render': patch
---

Preserve input delivered after a frame snapshot when ending that frame. Repeated and overlapping readings consume each key edge, click, pointer delta, and whole wheel step once. Keep clearHeld immediate and prevent stale readings from consuming input accumulated after a reset.
