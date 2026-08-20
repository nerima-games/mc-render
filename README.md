# @nerima-games/mc-render

## 責務

THREE.js 描画一式（マテリアル / カメラ / ポストFX / パーティクル / 水面）+ ワーカープール実装 +
**実行時入力サービス**（キーボード / マウス / ポインタロック / タッチ / キーリマッピング）。
テクスチャアトラスの生成とレイアウト契約を提供し、画像の転送・同梱はホスト境界で行う。

一見無関係な 2 つが同居しているのには理由がある。ホスト側の `mc-playground-kit` は
開発・プレビュー層に置くため、出荷ランタイムへ入力を置けない。
**入力を kit に置くと本番ゲームから入力処理が丸ごと消える**。
入力もブラウザプラットフォームの関心事であり、それを所有しているのがこのリポジトリである。

**そしてこのリポジトリはカメラの正ではない。** `CameraPoseSnapshot` の正は mc-sim が持ち、
ここはミラーするだけである。

詳細は [`docs/responsibility.md`](./docs/responsibility.md)（**非スコープの明示を含む**）。

## 依存

| 依存先 | 何をもらうか |
| --- | --- |
| `mc-kernel` | 共有語彙。どのリポジトリからも import 可（許可リストに書かずに import できる） |
| `mc-meshing` | `meshChunk(...)` の `opaque` / `water` / `transparentSolid` / `crossPlants` / `fluids` |
| `mc-sim` | `CameraPoseSnapshot`、描画すべき状態 |
| `mc-worldgen` | チャンクデータ、**チャンクダーティ購読**（`ChunkStore.subscribeDirty`）、隣接チャンク、ライトグリッド（計算は worldgen、**適用**がこちら） |

`mc-physics` と `mc-save` は **import できない**（`mc-sim` 経由の推移依存に過ぎない）。
レンダラは衝突判定をやり直さないし、セーブファイルも読まない。
`mc-playground-kit` には**依存しない**（プレビューを提供するホスト層。§2.3-2）。

`@nerima-games/mc-kernel` は公開済みの直接依存で、共有語彙を同パッケージから直接 import している。
`@nerima-games/mc-meshing` / `@nerima-games/mc-sim` / `@nerima-games/mc-worldgen` も
現在は公開 API を使う直接依存である。メッシング、シミュレーション、ワールドデータの正を
このリポジトリに複製せず、各パッケージの型と実装をそのまま利用する。

**`three` は `dependencies`、`@types/three` は `devDependencies` に入っている**
（それぞれ `^0.185.1` / `^0.185.4`）。コア入口は
`application/three-surface.ts` の構造的な型境界を使い、明示的な `./browser` 入口だけが
本物の名前空間、WebGL、テクスチャローダー、`EffectComposer` を import する。
`@types/three` が要るのは `test/fixtures/three-surface.ts` を**本物の `three` の `.d.ts` に
対してコンパイルする**テストのためであり、ブラウザ入口の型検査にも使われる。
`tsconfig.base.json` の `lib` は `["ES2024"]` のまま、`types` は `[]` のまま
（[`docs/versioning.md`](./docs/versioning.md) §5）。

## このリポジトリの位置づけ

4 層アーキテクチャの**基盤**層。plan.md §7 の機能カバレッジ表で
「描画・ポストFX・パーティクル・投射物トレーサー」と
「実行時入力（キーボード/マウス/ポインタロック/タッチ/リマッピング）」の
**両方**を割り当てられている唯一のリポジトリである。

このパッケージの実行時直接依存は `mc-kernel` / `mc-meshing` / `mc-sim` /
`mc-worldgen` / `effect` である。`mc-playground-kit` と `mc-compose` は依存先ではなく、
レンダラを利用するホスト側にある。
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
| mc-playground-kit はホスト層 | `dependencies` に入れず、実行時入力はこの package の API を使う |
| `Date.now()` 禁止 | 時刻はすべて注入された Clock Port から取得する |

依存の実体は `package.json` の直接依存宣言と TypeScript / oxlint の検査対象で管理する。
このリポジトリには `check-dependency-whitelist.ts`、`check:deps`、`api:check`、`api:update` の
スクリプトは存在しない。公開 API の変更は `pnpm typecheck` とテストで検証する。

### `Date.now()` 禁止の実装方法

時刻を読むドメインコードは `Clock` Port などの注入された値を受け取る。
ブラウザやホストの単調時計を使うアダプタは、その境界でだけ実装する。

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_24 + corepack が入る
$ pnpm install
```

Nix を使わない場合は Node.js 24 以上と pnpm 11 以上（`corepack` 推奨）を用意する。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | コア・テスト・Node プレビュー・ブラウザ入口の 4 プロジェクトを型検査 |
| `pnpm lint` | oxlint（このリポジトリ唯一の lint / format 設定。prettier も biome も .editorconfig も置かない）。**`--deny-warnings` 付きで走る**ため、`warn` のルールもビルドを落とす（`.oxlintrc.json` は 5 カテゴリすべてと個別 67 ルールが `warn`、`error` は 4 つだけ。このフラグが無かった頃は実質その 4 つしかゲートになっていなかった） |
| `pnpm lint:fix` | oxlint の自動修正 |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API、`environment: 'node'`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | カバレッジ計測。`vitest.config.ts` の branches / functions / lines / statements 100% 閾値を適用 |
| `pnpm preview` | 内蔵プレビュー（入力状態機械とポリシー表のステッパ）。**`pnpm verify` には入らない**。[`apps/preview-render/README.md`](./apps/preview-render/README.md) |
| `pnpm build` | `tsdown` で ESM、型宣言、source map を `dist/` に出力 |
| `pnpm pack:check` | 一時 tarball を作成し、公開物の必須ファイル、`src/` 非同梱、manifest の `main` / `types` / `exports`、ビルド済み core / browser の import と browser runtime entry を検査 |
| `pnpm verify` | `typecheck && lint && test && build` |

## 現状

**現在は、純粋なドメイン層、コアの構造的 surface、実行可能なブラウザ入口を持つ実装段階である。**

ポストFXチェーン、マテリアル方針、入力バインディング、スクラッチ、チャンク形状、
ボクセル照明、環境表現は決定的な値としてテストできる。`WorldRenderer` は Three surface を
受け取り、mc-meshing の cube / cross-plant / fluid レイヤーを同期して描画する。
実際の WebGL コンテキスト、URL からの `Texture` 読み込み、`ShaderMaterial`、屈折用
render target、`EffectComposer` の既定構成は `@nerima-games/mc-render/browser` が担う。
独自の Three ホストは、コアの `postProcessing` / `beforeRender` フックを注入して差し替えられる。

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
| フレーム stage 登録 | `stages/registration.ts` / `stages/stage-ids.ts` | 順序と依存境界を固定し、各 stage を実装済み |
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
| キーボードフォーカスの**観測と矢印キー委譲**（`focusin` / `focusout`、ロック中のマスク、Tab を奪わない、消費時だけ host へ委譲） | 同上 + `domain/input-bindings.ts` / `domain/focus-navigation.ts` / `application/input-service.ts` | DN-16 |
| カメラのミラー（書き戻し無し） | `domain/camera-mirror.ts` | DN-06 |

各 DN の参照実装証跡（file:line）と書くべき回帰テスト一覧は
[`docs/design-notes.md`](./docs/design-notes.md)。

### 現在の境界と残る範囲

- **mc-render 単体のブラウザ/GPU fixture ビューアとスクリーンショット検証。**
  実行可能な `./browser` 入口と `captureScreenshot` はあるが、実 GPU 上での見た目の受入れ、
  fixture のワールドデータ接続、スクリーンショット比較は別途必要である。
- **テクスチャ資産の配布。** `./browser` は生成済み RGBA アトラス、外部 `Texture`、URL の
  読み込みを扱うが、ゲーム固有の PNG 同梱・キャッシュ・アセット選択は利用側の責務である。
- **`WorldRenderer` のダーティ購読と照明同期は入った。**
  `attachChunkStoreRenderer` が mc-worldgen の `ChunkStore.subscribeDirty` を購読し、
  ダーティチャンクを再メッシュする。各面の外側セルをワールド座標で `getLight` し、
  AO / 天空光 / ブロック光を頂点カラーの R / G / B に格納するため、チャンク境界も
  隣接チャンク側の光を参照できる。未ロード・範囲外は暗さ 0 とし、光レベルは 0..15 に
  クランプする。既存の `color` または `colorForChunk` を指定すれば、この既定動作を上書きできる。
- **空・日照・地形フォグは同じ決定的 plan で同期する。**
  `planRenderEnvironment(daylight, farPlane)` は純粋関数として空色、日照強度、
  フォグ色と距離を返す。`WorldRenderer.setEnvironment` は clear color と既存の
  chunk shader uniform を更新し、material や GPU resource を再生成しない。
- **キーボードフォーカスの移動境界。** 観測（`focusin` / `focusout` →
  `InputSnapshot.keyboardFocus`）と、矢印キーを host の `focusNavigation` へ委譲する境界は
  **入った**。host callback が次の要素を決めて実際の `focus()` を呼び、mx-ui の inventory /
  hotbar 規則へ接続する部分は host の責務である。Tab は引き続きユーザーエージェントの所有で、
  callback は矢印が移動を消費したときだけ既定動作を抑止する
  （[`docs/design-notes.md`](./docs/design-notes.md) DN-16、配線手順は
  [`docs/public-api.md`](./docs/public-api.md) §2.10.6）。
- **HUD の上のクリックがポインタロック要求になる境界は閉じた。**
  `acquiresPointerLock` がクリックの落ちた先を受け取るようになり、
  mx-ui もホストも変わっていない（[`docs/public-api.md`](./docs/public-api.md) §2.11）。
- **ゲームパッドとタッチ入力。** `domain/gamepad-input.ts` と
  `application/gamepad-input-adapter.ts` が、押下エッジ・解放・軸のデッドゾーン・切断時の
  解放を実装する。タッチ入力も `browser-input-adapter.ts` と
  `test/touch-controls.test.ts` に実装済み。ブラウザの `GamepadList` 取得と毎フレームの
  `poll` 呼び出しはホストの責務で、DOM API は mc-render の型境界に入れない。
- **グラフィックス品質プリセットのうち renderer が所有する範囲。**
  `GraphicsQuality.composerRenderTarget` は low/medium の LDR と high/ultra の HDR として
  既定ブラウザの EffectComposer／水面屈折へ反映される。`pixelRatioCap` は DPR 上限、
  `bloomStrength` / `godRaysSamples` は bloom / god-rays の強度とサンプル数、
  `refractionThrottleFrames` / `refractionMinScreenRatio` は水面屈折の実行条件を制御する。
  `WorldRendererOptions.renderDistance` は mc-meshing のチャンク寸法からカメラの描画距離へ反映する。
  影解像度と実 Three のライトは、現行の renderer の責務外である（基底 renderer の
  `MeshBasicMaterial` はフォールバックであり、本番チャンク描画は専用シェーダーを使う）。
- **ビルド／package 検査は導入済み。** `tsdown` が `dist/` を生成し、`pnpm pack:check` が
  公開 tarball の内容を検査する。レジストリへの publish workflow はまだこの repository に置いていない。
  `version` は `0.x` に留める（[`docs/versioning.md`](./docs/versioning.md)）。
- **カバレッジ閾値は 100%。** branches / functions / lines / statements の 4 指標を
  `vitest.config.ts` でゲートしている。
- **mc-kernel の語彙は公開 package から直接 import。** ローカルミラーと専用テストは削除済み。
  `index.ts` から re-export していないのは、真実の出所を 2 つにしないため。
  公開型との assignability は `pnpm typecheck` と各 domain test が検査する。

## ドキュメント

[`docs/README.md`](./docs/README.md) が索引。

## License

MIT
