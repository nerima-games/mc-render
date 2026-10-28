# バージョニングと公開

## 1. 現状

| 項目 | 値 |
| --- | --- |
| `version` | `0.8.0` (`package.json`) |
| 公開状態 | [GitHub Packages](https://github.com/nerima-games/mc-render/pkgs/npm/mc-render) に `0.8.0` を公開済み |
| `main` / `types` / `exports` | root entry は `./dist/index.js` / `./dist/index.d.ts`。`exports` は root と `./browser` を公開する |
| ビルドパイプライン | `pnpm build` が `dist/` を掃除し、DOM-free root と browser entry を各 release tsconfig で出力する |
| `dependencies` | `mc-kernel@0.11.0` / `mc-meshing@0.4.0` / `mc-sim@0.6.0` / `mc-worldgen@0.7.0` / `effect@4.0.5` / `three@0.186.1` / `@types/three@0.186.0` |

## 2. なぜ `0.x` に留めるのか

mc-render `0.8.0` is published on GitHub Packages. The `0.x` series allows
breaking changes in minor releases; `1.0.0` marks a commitment to preserve the
published interface. The readiness conditions below define that decision.

mc-render depends on several published `@nerima-games/*` packages, so a release
requires checking compatibility with those package versions and confirming the
consumer contract. During development, the `mc-dev-meta` workspace resolves
packages with `workspace:*`, allowing integration without publishing mc-render.

## 3. `0.x` → `1.0.0` の条件

`1.0.0` は、公開した界面の互換性を保つ約束を示す。
mc-render が `1.0.0` を出せるのは、以下がすべて満たされたとき。

1. **The test and browser checks in [testing.md](./testing.md) pass.**
   `apps/preview-render/` provides an interactive terminal preview for input
   state and rendering policy. A separate browser job verifies the browser
   entry's fixture rendering and screenshot comparison.
2. **The maintainer approves the move to 1.0.0 at their discretion** ([RELEASE_STANDARD.md §4.2](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断)).
   The former time-based automatic gate (no API lock changes for four weeks) was
   retired across the organization
   ([RELEASE_STANDARD.md §4.1](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md#41-廃止する仕組み)).
   代替の定量基準は導入しない。判断材料は上位階層（`mc-playground-kit` / `mc-compose`）が
   実際に消費し動作確認したかどうかなど、都度異なってよい。
3. **mc-playground-kit が実際に消費して契約を確認している。**
   使われていない界面に「壊さない」と約束しても意味がない。
4. **[public-api.md](./public-api.md) §§8–9 の package entry と declaration が一致する。**
   root と browser の両方を build / package 検証し、固定 fixture の描画と screenshot comparison を
   [testing.md](./testing.md) の browser job で確認する。
5. **Direct mc-kernel dependency.** This condition is already met.
   mc-render imports shared vocabulary from `@nerima-games/mc-kernel` and does
   not redefine it. Render-specific LOD and meshing vocabulary remains in
   `src/domain/`.

### `0.x` semver policy

`0.x` では semver の互換保証が働かない（`^0.1.0` は `0.2.0` を受け入れない）。
mc-dev-meta workspace での開発中は影響しない。公開後、`1.0.0` 前は次のルールを使う。

- **破壊的変更 = minor bump**（`0.1.0` → `0.2.0`）
- **後方互換の追加・修正 = patch bump**（`0.1.0` → `0.1.1`）
- 下流は `~0.1.0` ではなく **`0.1.x` を明示ピン**して、意図しない minor 取り込みを防ぐ

## 4. GitHub Packages

`package.json`:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "public"
}
```

- スコープは `@nerima-games`。GitHub Organization `nerima-games` 配下のリポジトリと対応する。
- `access: public` sets the visibility for published versions. This setting
  does not publish a version by itself.
- 消費側は `.npmrc` に `@nerima-games:registry=https://npm.pkg.github.com` と
  `//npm.pkg.github.com/:_authToken=...` が要る。この repo 自身の `.npmrc` には
  すでに前者を書いてある。

## 5. `three` / `@types/three` and the browser entry

The root entry keeps the structural `ThreeSurface` adapter. The published
`./browser` entry imports Three.js directly, so `three` is a production
dependency. `@types/three` is also a package dependency because the browser
entry's published declarations expose Three.js types.

The root release build still compiles without DOM types. The browser entry has
its own release tsconfig, so browser types do not leak into the root declarations.

### Version alignment

`three` and `@types/three` must use the same major and minor version because
Three.js can introduce breaking changes in minor releases. The test suite checks
that both pins use the same minor version.

The current pins are `three@0.186.1` / `@types/three@0.186.0`.
The browser entry uses `three/addons/postprocessing/*` for
`EffectComposer` / `RenderPass` / `GTAOPass` / `UnrealBloomPass` / `BokehPass` / `SMAAPass` /
`OutputPass` を直接使っており（`src/browser.ts` の post-processing factory）、
addons のパス構成は THREE のバージョンで変わったことがある。

`GodRaysPass` と `CompositePass` は参照実装の**自作**で、別ライブラリではない。

## 6. mc-kernel direct dependency

mc-render pins `@nerima-games/mc-kernel` in `dependencies` and imports its
shared vocabulary directly instead of maintaining local mirrors. Render-owned
LOD and meshing types remain in `src/domain/`.

`index.ts` は mc-kernel の語彙を再 export しない。consumer が mc-render 経由で
kernel の語彙を取得すると真実の出所が二重になるためである。公開型の変更は
mc-kernel の API 差分としてレビューする。

## 7. ビルド / publish パイプライン

The package build clears `dist/`, then runs `tsc -p tsconfig.release.json` for
the DOM-free root entry and `tsc -p tsconfig.browser-release.json` for the
browser entry. `prepublishOnly` runs `pnpm verify && pnpm package:verify`.
`scripts/verify-package.mjs` installs the packed tarball in a consumer and checks
that every declared export target resolves.

| 項目 | 内容 |
| --- | --- |
| Build | `pnpm build`: clean dist, then emit root and browser declarations and ESM using their release tsconfigs |
| `exports` | Root entry at `./dist/index.*`; browser entry at `./dist/browser.*` |
| `files` | `dist` / `LICENSE` / `README.md`（npm が常に含める `package.json` を除く） |
| changesets | CLI と CI の status 検査は導入済み。release/publish 操作は未実施 |
| Node coverage 100% ゲート | `vitest.config.ts` の executable Node scope と CI の `pnpm test:coverage`; `src/browser.ts` は Playwright で検証 |

`.gitignore` は `dist/` `build/` `out/` を無視する。

This repository does not maintain an API lock file or API lock commands. Review
the source entry points and declaration diffs in pull requests.

## 8. 依存の固定

| 依存 | 現在 | 方針 |
| --- | --- | --- |
| `effect` | `4.0.5` (exact) | Keep Effect APIs and service types on one major version |
| `@nerima-games/*` | `mc-kernel 0.11.0` / `mc-meshing 0.4.0` / `mc-sim 0.6.0` / `mc-worldgen 0.7.0` | Pin published versions; keep exact versions aligned with package.json and lockfile |
| `three` / `@types/three` | `0.186.1` / `0.186.0` (exact; both package dependencies) | Keep runtime and declarations on the same minor version; the browser declarations expose Three.js types |
| `typescript` / `vitest` | `7.0.2` / `5.0.5` (exact) | Pin resolved development tools in the lockfile |
| `oxlint` | **package.json devDependency ではない** | `flake.nix` の devShell が `pkgs.oxlint`（org 全体で `nix flake lock --override-input` により 624af665 に固定）を入れる。16 リポジトリが各自 npm 解決で drift するのを防ぐため、Nix 側で一本化した単一ソース |
| `packageManager` | `pnpm@12.14.0` | Keep package manager resolution aligned with the lockfile |

`engines.node` remains `>=24.0.0`; the development shell uses Node.js 26.

`@effect/vitest` is pinned to `4.0.5` to match Effect 4 and Vitest 5.
