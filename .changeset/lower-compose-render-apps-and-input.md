---
"@nerima-games/mc-render": minor
---

Move mc-compose's `apps/render-preview` and `apps/shader-probe` fixture/probe pages into this repository's own `apps/`, now importing this package's source directly and built with a new `vite` dev/build setup (`pnpm dev:web` / `pnpm build:web` / `pnpm preview:web`). Also lowers the game-rule logic mc-compose carried alongside them (Wave 1, W1-L5): a multi-finger touch-look controller and touch-control roster builder in `browser-input-adapter.ts`, a native mouse-click queue in `input-service.ts`, a chunk-light resolution tracker in `domain/voxel-lighting.ts`, a software-rasterizer quality helper in `domain/post-processing.ts`, and a frame-budgeted `DirtySource` decorator (`makeBudgetedDirtySource`) in `application/world-sync.ts`.
