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

`@nerima-games/mc-kernel` は公開済みの直接依存で、共有語彙を同パッケージから直接 import している。
`mc-meshing` はチャンクメッシュ生成を担う application adapter から直接利用し、
`mc-sim` / `mc-worldgen` との境界は Port と構造ミラーで保つ。

**`three` / `@types/three` は `devDependencies` に入った**（現在はそれぞれ `^0.185.1` / `^0.185.4`）。
メジャー・マイナーを揃え、patch 差だけを許すことをテストで検査する。
`dependencies` ではない。**出荷ソースは THREE.js を 1 行も import していない** ——
`application/three-surface.ts` が使う 7 個のコンストラクタを構造的な型として書き、
ホストが本物の名前空間を渡す。`three` が要るのは
`test/fixtures/three-surface.ts` を**本物の `three` の `.d.ts` に対してコンパイルする**
テスト（`test/three-surface.test.ts`）のためであり、それがこの型が正しいことの唯一の証拠である。
`tsconfig.base.json` の `lib` は `["ES2024"]` のまま、`types` は `[]` のまま
（[`docs/versioning.md`](./docs/versioning.md) §5）。

## このリポジトリの位置づけ

4 層アーキテクチャの**基盤**層。plan.md §7 の機能カバレッジ表で
「描画・ポストFX・パーティクル・投射物トレーサー」と
「実行時入力（キーボード/マウス/ポインタロック/タッチ/リマッピング）」の
**両方**を割り当てられている唯一のリポジトリである。

この package は `mc-kernel`、`mc-meshing`、`mc-sim`、`mc-worldgen` を直接依存として宣言する。
`mc-meshing` はメッシュアルゴリズムのアダプタ、その他は共有データとシミュレーション結果の
入力として使う。`mc-playground-kit` は統合側の開発依存であり、この package の出荷依存ではない。

依存グラフ全体・4 階層・名詞/動詞ルール・kit の devDependency 専用規則・stage 全順序の所有者は
[`docs/architecture.md`](./docs/architecture.md) を参照。

### 依存ルール（この package の境界）

| ルール | 内容 |
| --- | --- |
| 直接依存の宣言 | import する `@nerima-games/*` は `package.json` の直接依存に記載する |
| kernel | `mc-kernel` は共有語彙として利用する。出荷依存への記載は必要 |
| 可搬な定義 | チャンク寸法、LOD、メッシュの基本表現は `src/domain/` が所有する |
| アルゴリズム境界 | `mc-meshing` の import は `src/application/chunk-store-mesher.ts` のアダプタに限定する |
| 時刻 | ドメイン処理は注入された時刻値を使い、グローバル時計を読まない |

依存境界は `.oxlintrc.json` の `no-restricted-imports` で検査する。
`pnpm lint` はソース、アプリ、スクリプト、テストを対象にし、警告も失敗として扱う。
循環検査や API lock の生成スクリプトはこのリポジトリの現行ツールチェーンには含めない。

## 開発

### セットアップ

```console
$ direnv allow          # flake.nix の devShell で nodejs_24 + corepack + oxlint + ast-grep が入る
$ NODE_AUTH_TOKEN=$(gh auth token) pnpm install
```

Nix を使わない場合は Node.js 24 以上と pnpm 11.24.0（`corepack` 推奨）を用意する。
asdf を使う場合は、リポジトリ直下の `.tool-versions` をそのまま読み込む。
`@nerima-games/*` の依存は GitHub Packages から解決するため、`pnpm install` には
`packages: read` スコープを持つトークンが要る（`.npmrc` はレジストリのマッピングのみ
持ち、トークンは持たない）。

> **注意**: ツールチェーンは `devenv.nix` から `flake.nix` + `flake.lock` に移行済みである。
> `flake.lock` はコミットされているので、`nix develop`（`.envrc` は `use flake`）は
> 誰の手元でも同じ nixpkgs に解決される。`devenv.nix` / `devenv.lock` はもう存在しない。

### コマンド

| コマンド | 内容 |
| --- | --- |
| `pnpm typecheck` | `tsconfig.build.json` / `tsconfig.test.json` / `tsconfig.preview.json` の 3 プロジェクトを型検査 |
| `pnpm lint` | `nix develop --command pnpm lint` として実行すること。oxlint（`.oxlintrc.json`、`--deny-warnings` 付きで `warn` もビルドを落とす）と ast-grep（`sgconfig.yml` / `.ast-grep/rules/*`）の両方を実行する。oxlint と ast-grep は Nix の devShell が供給し、どちらも npm の devDependency ではない。`no-restricted-imports` は Wave 0 で `error` に統一した（D.9） |
| `pnpm lint:fix` | oxlint の自動修正（ast-grep には自動修正がない） |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API、`environment: 'node'`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | 全指標 100% の閾値付きカバレッジ計測（`coverage.include` は `src/**/*.ts` 全体） |
| `pnpm build` | `scripts/clean-dist.mjs` で `dist/` を掃除し、`tsc -p tsconfig.release.json` で宣言ファイルと ESM を emit（esbuild によるバンドルは Wave 0 で廃止） |
| `pnpm package:verify` | `pnpm build` の後、`scripts/verify-package.mjs` が packed tarball を実際に `npm install` して import し、`exports` と実体の一致を検証する |
| `pnpm pack --dry-run` | package に含まれる生成物が `dist` / `LICENSE` / `README.md`（および npm 必須の `package.json`）だけであることを確認 |
| `pnpm preview` | 内蔵プレビュー（入力状態機械とポリシー表のステッパ）。**`pnpm verify` には入らない**。[`apps/preview-render/README.md`](./apps/preview-render/README.md) |
| `pnpm benchmark` | チャンク更新の逐次処理とバッチ処理を同一条件で測定し、JSON の中央値と速度比を出力 |
| `pnpm verify` | `typecheck && lint && test`。package build と coverage は別途実行 |

## 現状

**このリポジトリは純粋な domain と注入可能な browser / THREE 境界を中心に実装されている。**

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
| キーボードフォーカスの**移動**（グループ内を矢印キーで、ロック中は動かない） | `domain/focus-navigation.ts` / `application/browser-input-adapter.ts` / `application/dom-surface.ts` | DN-16 §5(a) |
| カメラのミラー（書き戻し無し） | `domain/camera-mirror.ts` | DN-06 |

各 DN の参照実装証跡（file:line）と書くべき回帰テスト一覧は
[`docs/design-notes.md`](./docs/design-notes.md)。

### まだ無いもの

- **内蔵 fixture ビューア。** THREE.js のホストアダプタ、シーンとチャンク描画、
  `ShaderMaterial` によるチャンク/水面、InstancedBuffer によるパーティクル、
  `EffectComposer` によるポストFX実行は mc-compose 側に入った。アトラス転送は
  注入可能なテクスチャ資産としてホストが担当する。
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
- **キーボードフォーカスの「移動」側も入った。** 観測（`focusin` / `focusout` →
  `InputSnapshot.keyboardFocus`）に加え、グループ**内**を矢印キー（`ArrowLeft`/`ArrowUp` で
  前へ、`ArrowRight`/`ArrowDown` で次へ、循環する）で動かす手段が入った。
  `dom-surface.ts` に `FocusableTarget`（`focus(): void`）が増え、
  `resolveFocusNavigationTarget` がロック中は動かさない
  （[`docs/design-notes.md`](./docs/design-notes.md) DN-16 §5(a)）。
  `event.preventDefault()` は呼ばない——`ARROW_FOCUS_NAVIGATION_POLICY.owner` は
  `'host'` で、抑止するかどうかはホストの判断のままである。
  **mx-ui 側のコード変更は要らない**（`HudView.setKeyboardFocus` は既存のまま呼ばれる回数が
  増えるだけ）が、**この挙動を mx-ui のオーナーとまだ確認していない**——DN-16 §5(a) の
  「まだ残っている 1 点」。
  **同 §5(b)（HUD の上のクリックがポインタロック要求になる）も閉じた**——
  `acquiresPointerLock` がクリックの落ちた先を受け取るようになり、
  mx-ui もホストも変わっていない（[`docs/public-api.md`](./docs/public-api.md) §2.11）。
- **ゲームパッドとタッチ入力。** `domain/gamepad-input.ts` と
  `application/gamepad-input-adapter.ts` が、押下エッジ・解放・軸のデッドゾーン・切断時の
  解放を実装する。タッチ入力も `browser-input-adapter.ts` と
  `test/touch-controls.test.ts` に実装済み。ブラウザの `GamepadList` 取得と毎フレームの
  `poll` 呼び出しはホストの責務で、DOM API は mc-render の型境界に入れない。
- **グラフィックス品質プリセットの残り半分。** レンダースケール・影解像度・視界距離・
  `bloomStrength` / `godRaysSamples`・`composerRtType`。
- **ビルドは実装済みだが、publish はまだ運用していない。** `pnpm build` が `dist/index.js` と宣言ファイルを生成し、
  `package.json` の `exports` はその生成物を指す。`version` は `0.x` に留める（[`docs/versioning.md`](./docs/versioning.md)）。
- **カバレッジ閾値は全指標 100% に設定済み。** 未達時は `pnpm test:coverage` が失敗する。
- **共有語彙は出所を分離している。** `mc-kernel` の定数は公開 package から直接 import し、
  mc-meshing と共有する可搬なメッシュ表現・LOD 定義はこのリポジトリの domain vocabulary として所有する。
  公開型との assignability は `pnpm typecheck` と各 domain test が検査する。

## ドキュメント

[`docs/README.md`](./docs/README.md) が索引。

## License

MIT
