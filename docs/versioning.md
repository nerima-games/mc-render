# バージョニングと公開

## 1. 現状

| 項目 | 値 |
| --- | --- |
| `version` | `0.8.0` (`package.json`) |
| 公開状態 | **未公開**。GitHub Packages にはまだ上げていない |
| `main` / `types` / `exports` | root entry は `./dist/index.js` / `./dist/index.d.ts`。`exports` は root と `./browser` を公開する |
| ビルドパイプライン | `pnpm build` が `dist/` を掃除し、DOM-free root と browser entry を各 release tsconfig で出力する |
| `dependencies` | `mc-kernel@0.11.0` / `mc-meshing@0.4.0` / `mc-sim@0.6.0` / `mc-worldgen@0.7.0` / `effect@4.0.5` / `three@0.186.1` |

## 2. なぜ `0.x` に留めるのか

plan.md §6 Step 3 / §8:

> 界面が安定した（APIロック4週間無変更）リポジトリから GitHub Packages 等へ npm 公開 +
> changesets 運用に切り替え。それまでは dev-meta workspace 統合で開発。

> **新規構築初期は全界面が高churn** → npm公開を遅らせ dev-meta workspace で開発（§6 Step 0）。
> bump連鎖を構造的に回避

mc-render の実行時依存元は mc-playground-kit だけだが、**mc-render 自身も複数の
`@nerima-games/*` パッケージに依存する**。したがって publish 時には、それらの公開版と
互換性を確認する必要がある（plan.md §6 Step 3 の bottom-up）。

root entry は Three.js を import せず、構造的な `ThreeSurface` 境界を保つ。
公開する `./browser` entry は Three.js を依存に持ち、canvas runtime を提供する。
固定ワールドデータのブラウザ fixture とスクリーンショット比較を、browser entry の検証に含める。

開発中は `mc-dev-meta` workspace が 16 リポジトリの clone を `repos/` に並べ、
`workspace:*` 解決でモノレポ同等の DX を提供する（plan.md §6 Step 0-2）。
公開しなくても他リポジトリから使える状態はここで作る。

## 3. `0.x` → `1.0.0` の条件

`1.0.0` は「完成した」の意味ではなく「**この界面を壊さないと約束する**」の意味である。
mc-render が `1.0.0` を出せるのは、以下がすべて満たされたとき。

1. **[testing.md](./testing.md) §2 の完了条件を満たしている。**
   テスト green **かつ**内蔵 fixture ビューアが操作可能。
   `apps/preview-render/` は入力状態と描画ポリシーを調べる terminal preview である。
   browser entry の fixture 描画と screenshot comparison は別の browser job で検証する。
2. **maintainer(take)が昇格させてよいと裁量判断する**（[RELEASE_STANDARD.md §4.2](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断)）。
   旧・日数計測ベースの自動ゲート（「APIロックファイルが4週間変更されていない」）は org 全体で
   廃止された（[API_STANDARD.md §4](https://github.com/nerima-games/.github/blob/main/API_STANDARD.md)）。
   代替の定量基準は導入しない。判断材料は上位階層（`mc-playground-kit` / `mc-compose`）が
   実際に消費し動作確認したかどうかなど、都度異なってよい。
3. **mc-playground-kit が実際に消費して契約を確認している。**
   使われていない界面に「壊さない」と約束しても意味がない。
4. **[public-api.md](./public-api.md) §§8–9 の package entry と declaration が一致する。**
   root と browser の両方を build / package 検証し、固定 fixture の描画と screenshot comparison を
   [testing.md](./testing.md) の browser job で確認する。
5. `@nerima-games/mc-kernel` を `dependencies` から直接参照し、kernel の語彙を
   再定義しない。render 固有の LOD / meshing 語彙は `src/domain/` の portable definitions
   として管理する（§6 参照）。

### 3.1 ブロッカーの連鎖 —— **2026-07-28 に前半が反証された**

かつてここには次の連鎖が書いてあった。

```
mc-worldgen の ChunkStore.subscribeDirty（決定済み）
  → mc-render の WorldRenderer が書ける
    → THREE.js アダプタが完成する
      → 内蔵 fixture ビューアが動く
        → 完了条件を満たす
          → maintainer の裁量判断
            → 1.0.0
```

**最初の 2 本の矢印は成立していなかった。** `WorldRenderer` も THREE シームも、
`subscribeDirty` が 1 行も無いまま着地している。理由は後から見ると単純で、
`setChunk(key, buffers)` は**誰が呼ぶかを知らなくても定義できる** ——
購読はレンダラの**引数の出どころ**であって、レンダラの設計への入力ではなかった。

依存を上流に描きすぎると、**実際には並行して進められる作業が直列に見える**。
このリポジトリはそれを 1 回やり、その間ずっと「1 行も無い」と書き続けていた。

現在の連鎖:

```
mc-render の公開 package が consumer に届く
  → mc-playground-kit が package を消費して契約を確認する
    → maintainer の裁量判断
      → 1.0.0
```

world data の取り込み、`WorldRenderer` の dirty subscription と lighting、
Three.js browser runtime、固定 fixture の描画と screenshot comparison は実装済みである。
したがって、現在の 1.0.0 readiness に残るのは公開 package の consumer 確認と maintainer の裁量判断である。

### 3.1 `0.x` の間の運用

`0.x` では semver の互換保証が働かない（`^0.1.0` は `0.2.0` を受け入れない）。
mc-dev-meta workspace で開発している間は問題にならないが、publish 後 `1.0.0` 前の期間は:

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
- `access: public`（org 全体の Wave 0 決定。パッケージは public 化済みで、`restricted`
  のままだと新規 publish が private に戻り、下流 CI が 403 になる）。plan.md §9 の
  未決事項「パッケージ公開先」は GitHub Packages で確定したものとして扱う。
- 消費側は `.npmrc` に `@nerima-games:registry=https://npm.pkg.github.com` と
  `//npm.pkg.github.com/:_authToken=...` が要る。この repo 自身の `.npmrc` には
  すでに前者を書いてある。

## 5. `three` / `@types/three` and the browser entry

The root entry keeps the structural `ThreeSurface` adapter. The published
`./browser` entry imports Three.js directly, so `three` is a production
dependency. `@types/three` remains a development dependency; the browser release
build resolves its declarations with DOM types scoped to that entry.

The root release build still compiles without DOM types. The browser entry has
its own release tsconfig, so browser types do not leak into the root declarations.

The browser API intentionally exposes Three.js types. Keep `three` and
`@types/three` on the same minor version.

### 5.2 バージョンを一致させること

`three` and `@types/three` must use the same major and minor version because
Three.js can introduce breaking changes in minor releases. The test suite checks
that both pins use the same minor version.

The current pins are `three@0.186.1` / `@types/three@0.186.0`.
The browser entry uses `three/addons/postprocessing/*` for
`EffectComposer` / `RenderPass` / `GTAOPass` / `UnrealBloomPass` / `BokehPass` / `SMAAPass` /
`OutputPass` を直接使っており（`src/browser.ts` の post-processing factory）、
addons のパス構成は THREE のバージョンで変わったことがある。

`GodRaysPass` と `CompositePass` は参照実装の**自作**で、別ライブラリではない。

## 6. mc-kernel 直接依存への移行

mc-kernel は公開済みなので、mc-render は共有語彙をローカルミラーせず
`@nerima-games/mc-kernel` から直接 import する。移行時には次を確認する:

1. `@nerima-games/mc-kernel` が `package.json#dependencies` に厳密な version である
2. `domain/kernel-vocabulary.ts` と `test/kernel-mirror.test.ts` が存在しない
3. source にローカルミラーへの import が残っていない
4. `pnpm typecheck` と `pnpm test` が成功する

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

The package exposes two entries. `src/index.ts` is the portable root entry;
`src/browser.ts` is published as `@nerima-games/mc-render/browser` and compiled
with `tsconfig.browser-release.json`. `docs/public-api.md` §9 documents its
canvas runtime. `scripts/verify-package.mjs` checks both export targets in the
packed package and resolves them from a consumer.

## 8. 依存の固定

| 依存 | 現在 | 方針 |
| --- | --- | --- |
| `effect` | `4.0.5` (exact) | Keep Effect APIs and service types on one major version |
| `@nerima-games/*` | `mc-kernel 0.11.0` / `mc-meshing 0.4.0` / `mc-sim 0.6.0` / `mc-worldgen 0.7.0` | Pin published versions; keep exact versions aligned with package.json and lockfile |
| `three` / `@types/three` | `0.186.1` / `0.186.0` (exact; runtime and development dependencies) | Keep the browser runtime and declarations on the same minor version |
| `typescript` / `vitest` | `7.0.2` / `5.0.5` (exact) | Pin resolved development tools in the lockfile |
| `oxlint` | **package.json devDependency ではない** | `flake.nix` の devShell が `pkgs.oxlint`（org 全体で `nix flake lock --override-input` により 624af665 に固定）を入れる。16 リポジトリが各自 npm 解決で drift するのを防ぐため、Nix 側で一本化した単一ソース |
| `packageManager` | `pnpm@12.14.0` | Keep package manager resolution aligned with the lockfile |

`engines.node` remains `>=24.0.0`; the development shell uses Node.js 26.

`@effect/vitest` is pinned to `4.0.5` to match Effect 4 and Vitest 5.
