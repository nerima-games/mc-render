---
'@nerima-games/mc-render': minor
---

Follow mc-kernel 0.8.0, mc-meshing 0.3.0, mc-worldgen 0.5.0, and mc-sim 0.5.0. The renderer now requires the published versions and reads the authoritative camera pose from mc-sim's `PlayerService.cameraPose`; the `authoritativePose` and `initialPose` render inputs are removed. Chunk keys and chunk block storage now use the kernel and meshing contracts, and the fixed-step simulation quantities remain owned by their upstream packages.
