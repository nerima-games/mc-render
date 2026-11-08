# Block textures

## Runtime path

- The browser loads the checked-in atlas at `src/assets/block-textures/atlas.png` by default. It also accepts an existing Three.js texture, an RGBA buffer, or a URL. RGBA input must match the atlas dimensions and byte length.
- `scripts/generate-block-textures.ts` reads the JSON recipes under `scripts/texture-recipes/` and writes the atlas PNG and manifest. `generateTerrainAtlas()` in `src/domain/texture-atlas.ts` remains a diagnostic atlas; it is not the browser default.
- Chunk geometry and particles use the coordinate helpers in `src/domain/texture-atlas.ts`. Keep both UV paths aligned when changing the atlas layout. `apps/render-preview/main.ts` loads the generated atlas for its fixture chunk.

## Art direction

Use an original, low-resolution pixel-art style built from authored palettes and deterministic shapes. Do not inspect, trace, or derive from any Minecraft texture or other game's block art.

- Draw each tile on a 16×16 pixel grid with hard pixel edges and no antialiasing.
- Fill each block face with material texture. Do not use a centered glyph or isolated symbol on a flat field; integrate functional details into the surface material.
- Use five purposeful swatches per material family: deep shade, shadow, base, light, and accent. Keep the palette recognizable at the block scale.
- Keep one light direction throughout: top faces use the light swatches, vertical faces use the base and shadow, and bottom faces use the deepest values.
- Build surfaces from readable clusters and material marks, not uniform per-pixel noise. Do not draw a full dark border around tiles; that would create seams when blocks repeat.
- Keep alpha behavior tied to the recipe: opaque pixels stay fully opaque, cutouts use only transparent or fully opaque pixels, and translucency is reserved for glass, fluids, and portal effects.
- Keep each block recognizable through its shape marks: stone clusters and seams, soil flecks, wood grain and end rings, ore deposits, plant silhouettes, and distinct fluid or energy patterns.
- Build stone from irregular 3–5 color patches, soil from fine grains, grass from a varied green top and a grassy dirt edge, and sand or gravel from dense grains. Draw planks with seams and grain, bark with vertical ridges, and log ends with rings.
- Use mineral clusters on a stone matrix, dense cutout foliage, framed transparent glass, and a woven cloth surface. Functional details such as a furnace opening or crafting grid belong inside a material-built face.

## Recipes and generation

- Keep one JSON recipe file per material group: `scripts/texture-recipes/stone.json`, `scripts/texture-recipes/soil-grass.json`, `scripts/texture-recipes/wood.json`, `scripts/texture-recipes/ore.json`, `scripts/texture-recipes/plants.json`, and `scripts/texture-recipes/liquids.json`.
- Each file has a `group`, `palettes`, and `recipes` field. Palettes contain five hex swatches. Each block recipe selects a palette, a drawing pattern, an alpha mode, and optional face-specific patterns, growth variants, or an animation group. The parser, schema checks, supported pattern names, and drawing functions are in `scripts/generate-block-textures.ts`; the JSON files provide working examples.
- The generator must produce the same PNG and manifest bytes for the same recipes. It derives its PRNG seed from stable block, face, variant, and frame identifiers; it does not use wall-clock time or ambient randomness.
- Generate the `top`, `side`, and `bottom` faces for every non-air kernel block. The `air` map entry uses transparent tile zero. Type the complete map against kernel `BLOCK_TYPES` so a kernel addition cannot silently render as another block.
- Assign base face tiles in kernel `BLOCK_TYPES` order, then `top`, `side`, and `bottom` order. Assign additional crop stages after all base faces, then animation frames. Crop stage zero reuses that crop's top-face tile. All other block faces, crop stages, and animation frames have distinct tile indices.
- The animation manifest groups frames by animation group and block name. The chunk shader selects water, lava, fire, portal, and gateway frames from the per-vertex block animation kind and simulation clock. Each kind has an explicit frames-per-second constant. A cauldron's liquid face uses its liquid animation kind while its vessel faces stay static. The pinned mc-kernel 0.14.0 registry contains `water_cauldron` but not `lava_cauldron`; the lava alias is ready for the registry to expose it. Animation membership never comes from the selected tile index.
- The checked-in outputs are `src/assets/block-textures/atlas.png` and `src/assets/block-textures/manifest.json`. The manifest contains `schemaVersion`, `layout`, `tileCount`, `blockFaces`, `variants`, `blockAlphaModes`, and `animations`; it has no timestamp.
- Run `pnpm textures:generate` after recipe changes. Run `pnpm textures:verify` to check that the checked-in PNG and manifest match fresh output.

## Atlas layout and sampling

- Keep source art at 16×16 pixels. Pack each tile in a 48×48 cell with 16px of edge extrusion on every side. Use 32 columns and 32 rows, producing a 1536×1536 atlas with 1024 cells and 11 mip levels.
- Atlas indices identify cells; UV bounds identify only the inner 16×16 image and include a half-texel inset. Keep the pixel-to-UV calculations in `src/domain/texture-atlas.ts` and use the same constants in the chunk shader and particle UV path.
- The browser uses nearest magnification and mipmaps with nearest texels and linear transitions between levels. At mip level 4, each 48px cell is 3px wide, with a 1px gutter on each side of its 1px art sample. Level 5 starts at 1.5px per cell, so cell borders no longer align with texels and neighboring colors can converge.

## API and verification

- `src/domain/block-texture-map.ts` exports `TILE_BY_BLOCK_NAME`, `BLOCK_TEXTURE_VARIANTS`, and `ANIMATED_TEXTURE_FRAMES`. The map covers every kernel block type; unknown names return a typed lookup failure.
- Chunk quads expose `top`, `side`, and `bottom` texture roles. All four horizontal directions use `side`; kernel block IDs do not carry a facing state, so a functional front detail currently appears on each vertical face.
- Coordinate helpers in `src/domain/texture-atlas.ts` return typed failures for invalid tile indices, mip levels, and UV coordinates rather than selecting tile zero.
- Tests cover map completeness, valid and invalid coordinate boundaries, generation determinism, checked-in asset freshness, mip levels, and tile-edge extrusion.
- Keep the version in `package.json` unchanged until release tooling applies the changeset.
