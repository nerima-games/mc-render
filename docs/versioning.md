# バージョニングと公開

## 1. 現状

| 項目 | 値 |
| --- | --- |
| `version` | `0.2.14` |
| 公開状態 | **未公開**。GitHub Packages にはまだ上げていない |
| `main` / `types` / `exports` | `./dist/index.js` / `./dist/index.d.ts`。`exports` は ESM のビルド成果物を指す |
| ビルドパイプライン | `pnpm build` が `dist/` を掃除し、宣言ファイルを出力して esbuild で ESM を生成する |
| `dependencies` | `mc-kernel@0.4.0` / `mc-meshing@0.1.4` / `mc-sim@0.1.42` / `mc-worldgen@0.1.14` / `effect@^3.22.1` |

## 2. なぜ `0.x` に留めるのか

plan.md §6 Step 3 / §8:

> 界面が安定した（APIロック4週間無変更）リポジトリから GitHub Packages 等へ npm 公開 +
> changesets 運用に切り替え。それまでは dev-meta workspace 統合で開発。

> **新規構築初期は全界面が高churn** → npm公開を遅らせ dev-meta workspace で開発（§6 Step 0）。
> bump連鎖を構造的に回避

mc-render の実行時依存元は mc-playground-kit だけだが、**mc-render 自身も複数の
`@nerima-games/*` パッケージに依存する**。したがって publish 時には、それらの公開版と
互換性を確認する必要がある（plan.md §6 Step 3 の bottom-up）。

Three.js の実行時依存は出荷ソースから分離されており、構造的な `ThreeSurface` 境界として
実装済みである。残る検証上の課題は、固定ワールドデータを読み込むブラウザ fixture と
スクリーンショット比較である。

開発中は `mc-dev-meta` workspace が 16 リポジトリの clone を `repos/` に並べ、
`workspace:*` 解決でモノレポ同等の DX を提供する（plan.md §6 Step 0-2）。
公開しなくても他リポジトリから使える状態はここで作る。

## 3. `0.x` → `1.0.0` の条件

`1.0.0` は「完成した」の意味ではなく「**この界面を壊さないと約束する**」の意味である。
mc-sim が `1.0.0` を出せるのは、以下がすべて満たされたとき。

1. **[testing.md](./testing.md) §2 の完了条件を満たしている。**
   テスト green **かつ**内蔵 fixture ビューアが操作可能。
   ビューアには THREE.js アダプタが要るので、これが最大の関門である。
2. **maintainer(take)が昇格させてよいと裁量判断する**（[RELEASE_STANDARD.md §4.2](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断)）。
   旧・日数計測ベースの自動ゲート（「APIロックファイルが4週間変更されていない」）は org 全体で
   廃止された（[API_STANDARD.md §4](https://github.com/nerima-games/.github/blob/main/API_STANDARD.md)）。
   代替の定量基準は導入しない。判断材料は上位階層（`mc-playground-kit` / `mc-compose`）が
   実際に消費し動作確認したかどうかなど、都度異なってよい。
3. **mc-playground-kit が実際に消費して契約を確認している。**
   使われていない界面に「壊さない」と約束しても意味がない。
4. **[public-api.md](./public-api.md) §7 の未設計 API が埋まっている。**
   `WorldRenderer` と dirty chunk の同期は実装済みである。残る完了条件は、固定チャンクを
   ブラウザで描画して目視できる fixture とスクリーンショット比較である。
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
mc-worldgen / mc-meshing が publish される（または vite alias に入る）
  → ワールドデータが mc-render に届く
    → 内蔵 fixture ビューアが動く / ライトグリッドの適用が書ける
      → 完了条件を満たす
        → maintainer の裁量判断
          → 1.0.0
```

**最上流は「未設計」ではなく「未 publish」である。** これは設計待ちではなく順序待ちで、
plan.md §6 Step 3 のボトムアップ publish がそのまま解く。
それとは独立に進む作業がシーム側に残っている（[responsibility.md](./responsibility.md) §2.3 の
`InstancedMesh` / `ShaderMaterial` / `EffectComposer` / `TextureLoader`）。

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
  "access": "restricted"
}
```

- スコープは `@nerima-games`。GitHub Organization `nerima-games` 配下のリポジトリと対応する。
- `access: restricted`（private）。plan.md §9 の未決事項「パッケージ公開先」は
  GitHub Packages で確定したものとして扱う。
- 消費側は `.npmrc` に `@nerima-games:registry=https://npm.pkg.github.com` と
  `//npm.pkg.github.com/:_authToken=...` が要る。**現在の `.npmrc` にはまだ書いていない**
  （公開物が無いため）。最初の publish と同時に 16 リポジトリ分を揃える。

## 5. `three` / `@types/three` —— `devDependencies`、`"DOM"` 無し

現行 package は `three@^0.185.1` / `@types/three@^0.185.4` を開発時だけ使用する。
出荷ソースは THREE.js を直接 import せず、`src/application/three-surface.ts` が
構造的な型でホストの実装を受け取る。`test/three-surface.test.ts` は本物の THREE の
declaration に対して fixture をコンパイルし、この境界を検証する。

`tsconfig.base.json` の `lib` に `"DOM"` は入っていない。公開 declaration は
`tsconfig.build.json` で生成し、GPU に依存する surface の型シームは Vitest のコードカバレッジ
から除外する代わりに、fixture の診断と解決済みソースを検査する。

`types` に `"three"` は追加しない。package の公開面に THREE の型を漏らさず、ホスト側の
実装を構造的に受け取るためである。

### 5.2 バージョンを一致させること

`three` と `@types/three` は**メジャー・マイナーを揃える**。Three.js は minor でも
破壊的変更を入れるためである。patch は npm の型定義側の追従差を許容し、
`test/three-surface.test.ts` が両方の minor version を検査している。

現在は `three@^0.185.1` / `@types/three@^0.185.4` である。
THREE は minor でも破壊的変更を入れる。参照実装は `three/addons/postprocessing/*` の
`EffectComposer` / `RenderPass` / `GTAOPass` / `UnrealBloomPass` / `BokehPass` / `SMAAPass` /
`OutputPass` を直接使っており（`session-post-processing.ts:3-9`）、
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

ビルドと package 境界は実装済みである。`pnpm build` は `dist/` を先に削除し、
`tsconfig.build.json` で宣言ファイルを生成した後、esbuild で `src/index.ts` を ESM に
バンドルする。`package.json` の `main` / `types` / `exports` / `files` は `dist/` を
指し、`prepublishOnly` からこの build を呼ぶ。

| 項目 | 内容 |
| --- | --- |
| ビルド | `pnpm build`: clean dist + declaration emit + esbuild ESM |
| `exports` | `{ ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } }` |
| `files` | `dist` / `LICENSE` / `README.md`（npm が常に含める `package.json` を除く） |
| changesets | CLI と CI の status 検査は導入済み。release/publish 操作は未実施 |
| カバレッジ 100% ゲート | `vitest.config.ts` と CI の `pnpm test:coverage` |

`.gitignore` は `dist/` `build/` `out/` を無視する。

このリポジトリには API lock の生成物・スクリプト・コマンドは置かない。公開面は
`src/index.ts`、生成された declaration、PR 差分をレビューし、日数計測ベースの自動ゲートには戻さない。

## 8. 依存の固定

| 依存 | 現在 | 方針 |
| --- | --- | --- |
| `effect` | `^3.22.1` | Effect の major を揃え、Context / Layer の型を同じ系統で合成する |
| `@nerima-games/*` | `mc-kernel 0.4.0` / `mc-meshing 0.1.4` / `mc-sim 0.1.42` / `mc-worldgen 0.1.14` | 公開後も互換性を確認し、下流 publish の順序を守る |
| `three` / `@types/three` | `^0.185.1` / `^0.185.4`（**devDependencies**） | §5。出荷ソースは import せず、メジャー・マイナーをテストで揃える |
| `typescript` / `vitest` | `^7.0.2` / `^3.2.7` | 開発ツールとして更新し、lockfile で実解決を固定する |
| `oxlint` | **package.json devDependency ではない** | `flake.nix` の devShell が `pkgs.oxlint`（nixpkgs 追従）を入れる。16 リポジトリが各自 npm 解決で drift するのを防ぐため、Nix 側で一本化した単一ソース |
| `packageManager` | `pnpm@11.21.0` | lockfile と package manager の解決を揃える |

`engines.node` は `>=24.0.0`。`flake.nix` の devShell が `nodejs_24` を入れる。

Vitest は `@effect/vitest@0.30.0` の peer dependency が `vitest ^3.2.0` を要求するため、Vitest 4 対応が公開されるまで 3.2 系に固定する。
