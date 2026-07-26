# @nerima-games/mc-render

## 責務

THREE.js 描画一式（マテリアル / カメラ / ポストFX / パーティクル / 水面）+ ワーカープール実装 +
**実行時入力サービス**（キーボード / マウス / ポインタロック / タッチ / キーリマッピング）。
テクスチャ同梱。

一見無関係な 2 つが同居しているのには理由がある。plan.md §2.3-2 のとおり、
mc-playground-kit は devDependency 専用で出荷ビルドに入らないため、
**入力を kit に置くと本番ゲームから入力処理が丸ごと消える**。
入力もブラウザプラットフォームの関心事であり、それを所有しているのがこのリポジトリである。

**そしてこのリポジトリはカメラの正ではない。** `CameraPoseSnapshot` の正は mc-sim が持ち、
ここはミラーするだけである。

詳細は [`docs/responsibility.md`](./docs/responsibility.md)（**非スコープの明示を含む**）。

## 依存

| 依存先 | 何をもらうか |
| --- | --- |
| `mc-kernel` | 共有語彙。どのリポジトリからも import 可（許可リストに書かずに import できる） |
| `mc-meshing` | `mesh(chunk, neighbors, config) → {opaque, water, transparentSolid}` |
| `mc-sim` | `CameraPoseSnapshot`、描画すべき状態 |
| `mc-worldgen` | チャンクデータ、**チャンクダーティ購読**（`ChunkStore.subscribeDirty`）、隣接チャンク |
| `mc-worldgen` | `Chunk` データ、ライトグリッド（計算は worldgen、**適用**がこちら） |

`mc-physics` と `mc-save` は **import できない**（`mc-sim` 経由の推移依存に過ぎない）。
レンダラは衝突判定をやり直さないし、セーブファイルも読まない。
`mc-playground-kit` には**依存しない**（devDependency 専用。§2.3-2）。

**現在の `dependencies` は `effect` のみ。** 上記 4 つはまだ publish されていないため
（plan.md §6 Step 3 の bottom-up publish-then-pin）、kernel の語彙は
`domain/kernel-vocabulary.ts` に暫定ミラーしてある。kernel 公開時に削除する。

**`three` / `@types/three` もまだ入れていない**（参照実装は `^0.170.0`）。
現在のソースが THREE.js を 1 行も import していないため。
最初の THREE.js アダプタと同じコミットで追加する
（[`docs/versioning.md`](./docs/versioning.md) §5）。

## このリポジトリの位置づけ

4 層アーキテクチャの**基盤**層。plan.md §7 の機能カバレッジ表で
「描画・ポストFX・パーティクル・投射物トレーサー」と
「実行時入力（キーボード/マウス/ポインタロック/タッチ/リマッピング）」の
**両方**を割り当てられている唯一のリポジトリである。

実行時依存元は `mc-playground-kit` のみ（`mc-compose` は推移的）。
**ただしそれは界面が揺れてよいという意味ではない。** kit は全プレビューの土台であり、
kit が壊れると 15 リポジトリの完了条件「内蔵プレビューが操作可能」が全部止まる。

依存グラフ全体・4 階層・名詞/動詞ルール・kit の devDependency 専用規則・stage 全順序の所有者は
[`docs/architecture.md`](./docs/architecture.md) を参照。

### 依存ルール（16 リポジトリ共通）

| ルール | 内容 |
| --- | --- |
| ハード失敗 | 違反があれば CI は必ず非ゼロ終了する。警告で済ませない |
| 循環禁止 | 循環依存は一切許可しない。「co-evolution ペア」のような例外リストは設けない |
| 推移閉包の禁止 | A→B、B→C のとき A は C を import できない |
| kernel は例外 | mc-kernel はどこからでも import 可（`dependencies` への記載は必要） |
| 宣言と実体の一致 | import する `@nerima-games/*` は `package.json` に記載必須 |
| mc-playground-kit は devDependency 専用 | `dependencies` に入れてはならない。**実行時依存になると出荷ビルドから入力処理が消える** |
| `Date.now()` 禁止 | 時刻はすべて注入された Clock Port から取得する |

`scripts/check-dependency-whitelist.ts` は 16 リポジトリ共通のテンプレートである。
冒頭で囲ってある `REPOSITORY_POLICY` 定数だけを書き換え、それ以外はそのままコピーする。
本リポジトリの版は **plan.md §2.1 の 16 リポジトリ全行**を保持しており、循環検査が全体を見る。

### `Date.now()` 禁止の実装方法

oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装しておらず、
`no-restricted-globals` は `oxlint --rules` の一覧に出るものの実装されていない
（mc-kernel で 0.12.0 に対し実測確認済み。3 ルールすべて設定した状態で `Date.now()` を書いても診断 0 件）。

そのため禁止は **`scripts/check-dependency-whitelist.ts` 側で実装**している。
対象は `Date.now()` / `new Date()` / `performance.now()` の 3 つ。
コメント・文字列リテラル・正規表現リテラルの中身はマスクされるので誤検知しない。

**この禁止が最も効くのがこのリポジトリである。** `performance.now()` は FPS 計測・
フレーム時間計測・アニメーション補間で自然に手が伸びる。
そして**ブラウザプラットフォームを所有する以上、Clock Port の実装アダプタはおそらくここに置かれる**。
だからエスケープハッチ（`mc-kernel-allow-time-source`）は**ファイル単位ではなく行単位**である。

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_22 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 22 以上と pnpm 9.15.0（`corepack` 推奨）を用意する。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` / `tsconfig.test.json` / `tsconfig.preview.json` の 3 プロジェクトを型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定。prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`oxlint.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API、`environment: 'node'`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測（閾値は未設定。後述） |
| `pnpm check:deps` | 依存ホワイトリスト + 循環検査 + `Date.now()` 禁止の検査 |
| `pnpm api:check` | `api-lock.md` が実際の公開 API と食い違えば非ゼロ終了（[`docs/public-api.md`](./docs/public-api.md) §8） |
| `pnpm api:update` | `api-lock.md` を書き直す。公開面を変える PR は結果を同じ PR に含める |
| `pnpm preview` | 内蔵プレビュー（入力状態機械とポリシー表のステッパ）。**`pnpm verify` には入らない**。[`apps/preview-render/README.md`](./apps/preview-render/README.md) |
| `pnpm verify` | `typecheck && lint && check:deps && api:check && test`。CI と同じ内容 |

## 現状

**このリポジトリはまだ叩き台（pre-audit first cut）である。しかも THREE.js が 1 行も入っていない。**

ドメインはすべて**純粋**である。ポストFXチェーンは配列、マテリアル方針は述語、
入力バインディングは表、スクラッチバッファはただの `Map`。WebGL は無い。

DOM に触るのは `window` 入力アダプタ 1 つだけで、**`tsconfig` の `lib` に `"DOM"` は入っていない**。
アダプタが実際に使う DOM メンバは 8 個しかないので、`application/dom-surface.ts` に
**構造的な型**として書いてある。実物の `Window` / `Document` / `HTMLCanvasElement` が
**キャスト無しで**適合することは、本物の `lib.dom.d.ts` に対してフィクスチャをコンパイルする
テストで証明している（[`docs/design-notes.md`](./docs/design-notes.md) DN-15）。

**これは手抜きではなく設計判断である。** 参照実装ではこれらの知識が
「builder 関数の文の並び順」や「`addEventListener` 2 行」にしか書かれておらず、
読むことでしか検査できず、GPU が無いとテストできなかった。データにすれば
`environment: 'node'` の単体テストで固定できる。

| 参照実装で読むしかなかった知識 | ここでの表現 |
| --- | --- |
| `composer.addPass()` の呼び出し順 | `POST_PROCESSING_PASS_ORDER` + `validatePostProcessingChain` |
| どのマテリアルに `forceSinglePass` が要るか | `requiresForceSinglePass` 述語（名指しせず規則で） |
| どのイベントをどこに登録するか | `LISTENER_PLAN` + `GAMEPLAY_LISTENER_TARGET` / `MODAL_LISTENER_TARGET` |
| フレーム毎の一時オブジェクト再利用 | `withScratch`（フレームを跨いだ参照漏れを実行時検出） |
| Escape キーの所有者 | `ESCAPE_OWNER = 'frame-handler'`（grep できる値） |
| `MouseEvent.button` の 0/1/2 が何を指すか | `MouseButton`（名前）+ 変換は `mouseButtonForIndex` 1 箇所 |
| ロック中のクリックとUIクリックの違い | `pressed` / `justPressed` と `uiClicks` の分離 |
| ホイールの `deltaY` が何単位か | `WheelDeltaMode` + `notchesForWheelDelta`（1 ノッチ = 100px / 3 行 / 1 ページ） |
| ロック要求が拒否されたのか未要求なのか | `PointerLockState`（`unlocked` / `requested` / `locked` / `refused`） |
| キーボードがどの UI に居るか | `FocusTarget`（`{ group, index }`）+ `HOTBAR_FOCUS_GROUP`。解決は `resolveFocusTarget` の**同一性照合** 1 箇所 |
| Tab を `preventDefault` してよいか | `FOCUS_NAVIGATION_OWNER = 'user-agent'` / `FOCUS_NAVIGATION_POLICY.preventDefault === false`（grep できる値。`remap` も Tab を拒否する） |

| 領域 | 実装 | 設計注意 |
| --- | --- | --- |
| フレーム stage 登録 | `stages/registration.ts` / `stages/stage-ids.ts` | 位置は確定、本体は FIRST CUT |
| ポストFXの確定順序 | `domain/post-processing.ts` | DN-01 |
| `forceSinglePass` 規則 | `domain/material-policy.ts` | DN-02 |
| フレーム毎スクラッチの再利用 | `domain/frame-scratch.ts` | DN-03 |
| 入力の window/document 遮蔽 | `domain/input-bindings.ts` / `application/input-service.ts` | DN-04 |
| Escape の単一所有 | 同上 | DN-05 |
| マウスボタン、ロック状態でのクリックの意味、`contextmenu` 抑止 | 同上 | DN-12 |
| ホイールはデルタ。単位の正規化とホットバー循環 | 同上 | DN-13 |
| ポインタロックの要求と拒否（`PointerLockPort`） | 同上 | DN-14 |
| `window` 入力アダプタ（登録 / 正確な解除 / イベント変換 / ロック要求の実行） | `application/browser-input-adapter.ts` | DN-04 / DN-12 / DN-13 / DN-14 |
| DOM を `lib` ではなく狭い構造的インターフェースで受ける | `application/dom-surface.ts` | DN-15 |
| キーボードフォーカスの**観測**（`focusin` / `focusout`、ロック中のマスク、Tab を奪わない） | 同上 + `domain/input-bindings.ts` / `application/input-service.ts` | DN-16 |
| カメラのミラー（書き戻し無し） | `domain/camera-mirror.ts` | DN-06 |

各 DN の参照実装証跡（file:line）と書くべき回帰テスト一覧は
[`docs/design-notes.md`](./docs/design-notes.md)。

### まだ無いもの

- **THREE.js アダプタ一式。** マテリアル / パーティクル / 水面 / テクスチャ / シーン。
- **`WorldRenderer`。** plan.md §3.9 の筆頭 API でありながら 1 行も無い。
  購読先は決まった（**mc-worldgen** の `ChunkStore.subscribeDirty`。mc-sim ではない）。
  [docs/public-api.md](./docs/public-api.md) §3.1 に骨格がある
  （[`docs/public-api.md`](./docs/public-api.md) §3）。
- **キーボードフォーカスの「移動」側。** 観測（`focusin` / `focusout` → `InputSnapshot.keyboardFocus`）は
  **入った**が、グループ**内**を矢印キーで動かす手段は無い。ホットバーはタブストップが 1 つなので、
  Tab で入れるのはスロット 0 だけである。閉じるには `dom-surface.ts` に `focus()` が要り、
  どのキーが移動するかとロック中の扱いを mx-ui と一緒に決める必要がある
  （[`docs/design-notes.md`](./docs/design-notes.md) DN-16 §5(a)、配線手順は
  [`docs/public-api.md`](./docs/public-api.md) §2.10.6）。
  **同 §5(b)（HUD の上のクリックがポインタロック要求になる）は閉じた**——
  `acquiresPointerLock` がクリックの落ちた先を受け取るようになり、
  mx-ui もホストも変わっていない（[`docs/public-api.md`](./docs/public-api.md) §2.11）。
- **ゲームパッドとタッチ入力。** 参照実装の `gamepad-input-state.ts` / `virtual-input-state.ts`
  相当（216 LOC）。`window` 入力アダプタ本体（キー / マウス / ホイール / ポインタロック /
  blur、登録と解除、`canvas.requestPointerLock()` に繋がる `PointerLockPort` の実装）は
  **入った**（[`docs/public-api.md`](./docs/public-api.md) §2.9）。
- **ワーカープール実装。** 参照実装 `packages/worker` の 1,373 LOC 相当。
- **内蔵 fixture ビューア。** plan.md §6 Step 2 の完了条件の半分。
- **グラフィックス品質プリセットの残り半分。** レンダースケール・影解像度・視界距離・
  `bloomStrength` / `godRaysSamples`・`composerRtType`。
- **ビルド／publish はまだない。** `exports` は TypeScript ソースを直接指している。
  `version` は `0.x` に留める（[`docs/versioning.md`](./docs/versioning.md)）。
- **カバレッジ閾値は未設定。** 99% ゲートは完了条件到達時に有効化する。
- **`domain/kernel-vocabulary.ts` は暫定ミラー。** mc-kernel 公開時に削除する。
  `index.ts` から re-export していないのは、真実の出所を 2 つにしないため。
  ミラーが kernel と食い違っても `tsc` は気づかない（ブランドも `Context.Tag` も**文字列**でキーされる）ので、
  `test/kernel-mirror.test.ts` がブランドの述語と `CameraPoseSnapshot` の形を kernel の定義に対して固定している
  （[`docs/testing.md`](./docs/testing.md) §4.1）。

## ドキュメント

[`docs/README.md`](./docs/README.md) が索引。

## License

MIT
