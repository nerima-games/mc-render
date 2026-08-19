# バージョニングと公開

## 1. 現状

| 項目 | 値 |
| --- | --- |
| `version` | `0.2.14` |
| 公開状態 | **未公開**。GitHub Packages にも上げていない |
| `main` / `types` / `exports` | `./dist/index.js` / `./dist/index.d.ts` を指す。`exports` はコアの `.` と Three/DOM 境界の `./browser` を ESM と型宣言で公開 |
| ビルド / package 検査 | `pnpm build` + `pnpm pack:check`（`tsdown`、`scripts/check-package.mjs`） |
| `dependencies` | `@nerima-games/mc-kernel` / `mc-meshing` / `mc-sim` / `mc-worldgen` / `effect` / `three` |

## 2. なぜ `0.x` に留めるのか

plan.md §6 Step 3 / §8:

> 界面が安定した（APIロック4週間無変更）リポジトリから GitHub Packages 等へ npm 公開 +
> changesets 運用に切り替え。それまでは dev-meta workspace 統合で開発。

> **新規構築初期は全界面が高churn** → npm公開を遅らせ dev-meta workspace で開発（§6 Step 0）。
> bump連鎖を構造的に回避

mc-render は `mc-playground-kit` の実行時依存ではなく、`mc-kernel` / `mc-meshing` /
`mc-sim` / `mc-worldgen` / `effect` を直接依存として宣言する。メッシング、シミュレーション、
ワールドデータの正をこのリポジトリへ複製せず、各パッケージの公開 API を直接利用する。

レンダラ本体には `WorldRenderer`、ダーティ通知とライトの同期、構造的な Three surface、
チャンクの shader/material 構築がある。`./browser` には実 Three namespace、canvas、
EffectComposer、アトラス転送を接続する実行入口もある。残る公開判断は、固定ワールドを使った
ブラウザ/GPU のスクリーンショット fixture、ゲーム固有のアセット配布・キャッシュ、実際の
レジストリ publish 手順の検証であり、これらを Node 専用のプレビューで済ませない。

開発中は `mc-dev-meta` workspace が 16 リポジトリの clone を `repos/` に並べ、
`workspace:*` 解決でモノレポ同等の DX を提供する（plan.md §6 Step 0-2）。
公開しなくても他リポジトリから使える状態はここで作る。

## 3. `0.x` → `1.0.0` の条件

`1.0.0` は「完成した」の意味ではなく「**この界面を壊さないと約束する**」の意味である。
mc-sim が `1.0.0` を出せるのは、以下がすべて満たされたとき。

1. **[testing.md](./testing.md) §2 の完了条件を満たしている。**
   テストと Node プレビューが green であることに加え、公開 `./browser` 入口またはホスト側の
   ブラウザ/GPU fixture が実 Three namespace、canvas、テクスチャ転送を接続して操作できる。
2. **maintainer(take)が昇格させてよいと裁量判断する**（[RELEASE_STANDARD.md §4.2](https://github.com/nerima-games/.github/blob/main/RELEASE_STANDARD.md#42-新しい昇格ポリシー人間による裁量判断)）。
   旧・日数計測ベースの自動ゲート（「APIロックファイルが4週間変更されていない」）は org 全体で
   廃止された（[API_STANDARD.md §4](https://github.com/nerima-games/.github/blob/main/API_STANDARD.md)）。
   代替の定量基準は導入しない。判断材料は上位階層（`mc-playground-kit` / `mc-compose`）が
   実際に消費し動作確認したかどうかなど、都度異なってよい。
3. **mc-playground-kit が実際に消費して契約を確認している。**
   使われていない界面に「壊さない」と約束しても意味がない。
4. **[public-api.md](./public-api.md) §7 の未実装範囲を確認し、ホスト境界を検証している。**
   `WorldRenderer`、`ChunkStore.subscribeDirty`、`./browser` の実行入口と品質プリセットの接続は
   実装済みである。残るのは固定ワールドを用いたブラウザ/GPU スクリーンショット、ゲーム固有の
   PNG/DataTexture 配布・キャッシュ、ホストまたは別パッケージとの接続を実証することだ。
5. ローカルの kernel vocabulary mirror が削除され、`@nerima-games/mc-kernel` を
   `dependencies` から直接参照している（§6 参照）。

### 3.1 現在の実装状態

- `package.json` の直接依存と source import は一致しており、mc-kernel の共有語彙や
  mc-meshing の quad をローカルにミラーしていない。
- `WorldRenderer` は chunk の opaque / water / transparent / cross / fluid geometry と
  packed lighting を受け取り、`ChunkStore.subscribeDirty` の changed / removed を同期する。
- `application/three-surface.ts` は実 Three namespace を受け取る構造的な surface で、Node の型検査と
  fake fixture で契約を検査する。`src/browser.ts` はその surface に実 Three/canvas と
  EffectComposer を接続する既定入口であり、固定ワールドの canvas/GPU fixture は別途必要である。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、coverage 100% gate、`pnpm build`、
  `pnpm pack:check` はこの tree で検証する。`./browser` の import/build は package gate に含めるが、
  固定ワールドを使ったブラウザ/GPU 描画結果、ゲーム固有の PNG 配布、実際のレジストリ publish は
  まだこの repository の検証対象にない。

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

## 5. `three` / `@types/three` の入れ方 —— runtime dependency と `"DOM"` 境界

参照実装は `three@^0.170.0` / `@types/three@^0.170.0` を使っていた（旧 `package.json:57,59`）。
plan.md §3.9 も THREE.js 描画一式を mc-render の責務としている。
現行の `three` は公開 `./browser` の実行時依存として `dependencies` にあり、型だけを
`@types/three` の `devDependencies` で補う。コアの出荷入口は構造的な surface を保ち、
ブラウザ入口だけが Three namespace と DOM を import する。

### 5.1 現在の境界

1. **`three` は `dependencies`、`@types/three` は `devDependencies`。**
   `src/index.ts` とコアの application/domain は実行時 Three.js を import しない。一方で
   公開 `src/browser.ts` は実際の Three renderer、scene、camera、EffectComposer を生成するため
   `three` を直接 import する。`application/three-surface.ts` は必要なコンストラクタとメンバを
   構造的な型として表し、`test/fixtures/three-surface.ts` は本物の `.d.ts` への適合を検査する。
   `test/three-surface.test.ts` はコアの非依存性と、意図した browser 境界を検査する。

2. **`tsconfig.base.json` の `lib` に `"DOM"` は入っていない。**
   `application/three-surface.ts` は必要なコンストラクタとメンバだけを構造的に表現し、
   `test/fixtures/three-surface.ts` が実際の Three namespace との適合を確認する。
   `src/browser.ts` と専用の package tsconfig は必要な DOM 型を境界内で使う。外部ホストが
   別の canvas/WebGL を供給する場合も、コアの構造的 surface を利用できる。

3. グローバル `types` に `"three"` は不要である。ブラウザ入口はモジュールとして Three の型を
   import し、コアと Node プレビューは `types: []` のまま保つ。

4. Node coverage は純粋な domain/application 契約を対象にし、`./browser` の import/build と
   実行境界は専用の型・package gate で検査する。固定ワールドのブラウザ/GPU 実描画、PNG の
   ゲーム固有配布、canvas capture はホスト fixture で検査し、`pnpm test:coverage` の代替にはしない。

### 5.2 バージョンを一致させること

`three` と `@types/three` は**同じ major/minor 系列**でなければならない。
THREE は minor でも破壊的変更を入れるので、`@types/three` が minor 1 つ先だと
「入っていないライブラリを記述した型」になる。`test/three-surface.test.ts` が
この系列一致を固定している。patch 番号は runtime と型定義で異なってもよい。

現行のバージョンは `three@0.185.1` / `@types/three@0.185.4` である。THREE は minor でも
破壊的変更を入れるため、依存更新時に再確認する。
参照実装は `three/addons/postprocessing/*` の
`EffectComposer` / `RenderPass` / `GTAOPass` / `UnrealBloomPass` / `BokehPass` / `SMAAPass` /
`OutputPass` を直接使っており（`session-post-processing.ts:3-9`）、
addons のパス構成は THREE のバージョンで変わったことがある。

`GodRaysPass` と `CompositePass` は参照実装の**自作**で、別ライブラリではない。

## 6. mc-kernel 直接依存

mc-render は共有語彙をローカルミラーせず、`@nerima-games/mc-kernel` から直接 import する。
現行 tree では次を満たしている:

1. `@nerima-games/mc-kernel` が `package.json#dependencies` に厳密な version である
2. ローカルの kernel vocabulary mirror と、それを固定する mirror test が存在しない
3. source にローカルミラーへの import が残っていない
4. `pnpm typecheck` と `pnpm test` が成功する

`index.ts` は mc-kernel の語彙を再 export しない。consumer が mc-render 経由で
kernel の語彙を取得すると真実の出所が二重になるためである。公開型の変更は
mc-kernel の API 差分としてレビューする。

## 7. ビルド / publish

各 source 用 tsconfig は型検査のため `noEmit: true` を維持し、配布用の出力は
`tsdown.config.ts` で一元的に生成する。`package.json` の `main` / `types` / `exports` は
`dist/` を指し、`files` は配布に必要な成果物、README、LICENSE、CHANGELOG に限定する。
runtime export が TS source の upstream (`mc-kernel` / `mc-meshing`) は JavaScript bundle に同梱し、
型宣言側では依存元の型を参照する。これにより Node 24 の package import が `node_modules` 配下の
TS source の型消去機能に依存しない。

現在の検証経路:

| 項目 | 内容 |
| --- | --- |
| ビルド | `pnpm build` が ESM、型宣言、source map を `dist/` に生成 |
| package 検査 | `pnpm pack:check` が一時 tarball の必須ファイルと `src/` 非同梱を検査 |
| changesets | plan.md §6 Step 3。bump とチェンジログの運用 |
| publish ワークフロー | **未導入**。レジストリ、タグ／changeset 起点、認証を決めてから追加する |
| カバレッジ 100% ゲート | `vitest.config.ts` と CI で維持（[testing.md](./testing.md) §5） |

`.gitignore` は既に `dist/` `build/` `out/` を無視するようにしてある。

**APIロック機構（`api-lock.md` / `scripts/api-lock.ts` / `pnpm api:check`）は org 全体で
廃止された**（[API_STANDARD.md §4](https://github.com/nerima-games/.github/blob/main/API_STANDARD.md)）。
公開面のレビューは PR 差分そのもので行い、日数計測ベースの自動ゲートには戻さない。

**mc-render 固有の追加項目**: アトラスの RGBA レイアウト生成と Three `DataTexture` / URL texture
の転送は `src/browser.ts` が提供する。ゲーム固有の PNG 配布、キャッシュ、アセット URL の解決は
ホスト境界に残し、`files` に隠して所有しない。固定ワールドのブラウザ fixture がこの境界を実証する。

## 8. 依存の固定

| 依存 | 現在 | 方針 |
| --- | --- | --- |
| `effect` | `^3.22.1` | 既存の Effect 3 系に揃える。Context / Layer の型が跨るため、メジャーを混ぜない |
| `@nerima-games/mc-kernel` | `0.2.18` | 直接依存を厳密ピン。共有語彙は kernel から直接読む |
| `@nerima-games/mc-meshing` | `0.1.4` | 直接依存を厳密ピン。公開 quad と `meshChunk` を直接利用する |
| `@nerima-games/mc-sim` | `0.1.42` | 直接依存を厳密ピン。カメラ姿勢と描画状態を読む |
| `@nerima-games/mc-worldgen` | `0.1.14` | 直接依存を厳密ピン。ChunkStore、dirty、light grid を読む |
| `three` / `@types/three` | `^0.185.1` / `^0.185.4`（runtime / **devDependencies**） | §5。コアは import せず、`./browser` が runtime import する。**major/minor を一致させる**（`test/three-surface.test.ts` が固定） |
| `typescript` / `vitest` | `^` 付き | ツールチェーンは揃えるが厳密ピンはしない |
| `oxlint` | **package.json devDependency ではない** | `flake.nix` の devShell が `pkgs.oxlint`（nixpkgs 追従）を入れる。16 リポジトリが各自 npm 解決で drift するのを防ぐため、Nix 側で一本化した単一ソース |
| `packageManager` | `pnpm@11.22.0` | Node 24 と組み合わせて利用 |

`engines.node` は `>=24.0.0`。`flake.nix` の devShell が `nodejs_24` を入れる。
