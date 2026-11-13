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

`three@0.186.1` is a runtime dependency for the published browser entry.
`@types/three@0.186.0` stays in `devDependencies`; tests check that both pins
share a major and minor version. The portable root entry still uses the
structural `application/three-surface.ts` adapter and compiles without DOM
types. The browser entry has a separate release tsconfig with DOM types.

## Package entry points

`@nerima-games/mc-render` is the portable root entry. It exports domain,
application, input-service, and stage APIs without importing DOM or Three.js.

`@nerima-games/mc-render/browser` exports the Three.js browser runtime for a
host-owned canvas. Its `BrowserWorldRuntime` provides rendering, quality
measurements, water surfaces, screenshots, and lifecycle controls. mx-ui owns
focus DOM membership and resolution; mc-render exports the `FocusTarget`
`{ group, index }` DTO and arrow-key intent vocabulary. See
[`docs/public-api.md`](./docs/public-api.md) for both entry surfaces.

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
$ direnv allow          # flake.nix の devShell で Node.js 26 + corepack + oxlint + ast-grep が入る
$ NODE_AUTH_TOKEN=$(gh auth token) pnpm install
```

Nix を使わない場合は Node.js 24 以上と pnpm 12.14.0（`corepack` 推奨）を用意する。
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
| `pnpm typecheck` | root、test、terminal preview、browser application の各 TypeScript project を検査 |
| `pnpm lint` | `nix develop --command pnpm lint` として実行すること。oxlint（`.oxlintrc.json`、`--deny-warnings` 付きで `warn` もビルドを落とす）と ast-grep（`sgconfig.yml` / `.ast-grep/rules/*`）の両方を実行する。oxlint と ast-grep は Nix の devShell が供給し、どちらも npm の devDependency ではない。`no-restricted-imports` は Wave 0 で `error` に統一した（D.9） |
| `pnpm lint:fix` | oxlint の自動修正（ast-grep には自動修正がない） |
| `pnpm test` | vitest（`@effect/vitest` の `it.effect` が主 API、`environment: 'node'`） |
| `pnpm test:watch` | vitest watch |
| `pnpm test:coverage` | Node-executed source is held to 100% statements, branches, functions, and lines; `src/browser.ts` is verified by the Playwright browser job |
| `pnpm test:browser` | Chromium/SwiftShader shader, fixed-fixture, screenshot, adaptive-quality, and browser-runtime checks |
| `pnpm build` | Cleans `dist/`, then emits declarations and ESM for root and `./browser` release entries |
| `pnpm package:verify` | `pnpm build` の後、`scripts/verify-package.mjs` が packed tarball を実際に `npm install` して import し、`exports` と実体の一致を検証する |
| `pnpm pack --dry-run` | package に含まれる生成物が `dist` / `LICENSE` / `README.md`（および npm 必須の `package.json`）だけであることを確認 |
| `pnpm preview` | 内蔵プレビュー（入力状態機械とポリシー表のステッパ）。**`pnpm verify` には入らない**。[`apps/preview-render/README.md`](./apps/preview-render/README.md) |
| `pnpm benchmark` | チャンク更新の逐次処理とバッチ処理を同一条件で測定し、JSON の中央値と速度比を出力 |
| `pnpm verify` | `typecheck && lint && test`。package build と coverage は別途実行 |

## 現状

The pure domain modules remain separate from the browser runtime. The root entry
uses structural ports, while `src/browser.ts` owns the Three.js and WebGL
implementation behind the `./browser` package entry.

Root and terminal-preview TypeScript projects do not include `"DOM"` in
`lib`. The root input adapter uses a narrow structural DOM surface with eight
members in `application/dom-surface.ts`; a compile-time fixture verifies that
real `Window`, `Document`, and `HTMLCanvasElement` values satisfy it without
casts ([`docs/design-notes.md`](./docs/design-notes.md) DN-15). The published
`./browser` entry uses DOM types in its separate browser release project.

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
| Keyboard focus boundary | mc-render exports `FocusTarget` (`{ group, index }`) and key-to-intent conversion; mx-ui resolves DOM membership and moves focus |
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
| キーボードフォーカスの DTO と矢印 intent | `domain/input-bindings.ts` / `domain/focus-navigation.ts` / `application/browser-input-adapter.ts` | W4-R5。DOM 解決とフォーカス移動は mx-ui |
| カメラのミラー（書き戻し無し） | `domain/camera-mirror.ts` | DN-06 |

各 DN の参照実装証跡（file:line）と書くべき回帰テスト一覧は
[`docs/design-notes.md`](./docs/design-notes.md)。

### 実装済みの機能と残作業

- **対話型 terrain fixture viewer。** `apps/render-preview/` の固定 terrain fixture と
  screenshot comparison は `pnpm test:browser` で自動検証できるが、チャンクを
  対話的に選んで探索する viewer はまだない。`apps/preview-render/` は入力状態と
  render policy を調べる terminal preview で、固定 terrain viewer とは別の用途である。
- **`WorldRenderer` のダーティ購読と照明同期は入った。**
  `attachChunkStoreRenderer` が mc-worldgen の `ChunkStore.subscribeDirty` を購読し、
  ダーティチャンクを再メッシュする。各面の外側セルをワールド座標で `getLight` し、
  AO / 天空光 / ブロック光を頂点カラーの R / G / B に格納するため、チャンク境界も
  隣接チャンク側の光を参照できる。未ロード・範囲外は暗さ 0 とし、光レベルは 0..15 に
  クランプする。既存の `color` または `colorForChunk` を指定すれば、この既定動作を上書きできる。
- **エンティティの描画入力。** フレーム入力を使うホストは `WorldRenderer.syncEntityFrame(input)` に
  位置と次元、体と頭の yaw、pitch、ブロック光と天空光、歩行位相と量、攻撃・被ダメージ・死亡の進行度を渡す。
  `syncEntityFrame` は入力を検証し、設定された次元のエンティティだけを `syncEntities` に渡して描画を同期する。
  現行の `mc-host-web` は `playerSessionRuntime.syncRenderedEntities` から
  `worldRenderer.syncEntities` を呼ぶ。`sampleEntityRenderFrame` はアニメーション秒を
  `(simulationTick + partialTick) / 20` で返し、描画アニメーションには入力の歩行位相と進行度を使う。
  型と入力例は [`docs/public-api.md`](./docs/public-api.md) §3.6 を参照。
- **128種のエンティティモデル。** `ENTITY_MODEL_CATALOG` は現行の `mc-kernel` の128種すべてを収録し、
  `UNSUPPORTED_ENTITY_MODEL_KINDS` は空である。種類ごとに異なるパーツ形状・配置・配色を持ち、
  歩行位相、攻撃・被ダメージ・死亡の入力でパーツが動く。カタログにない非アイテムの種類は
  `WorldRenderer.entityModelDiagnostics` に `UnsupportedEntityModel` と `entityId` を記録して描画を省き、
  既定モデルへ置き換えない。モデル元データから `scripts/entity-models/generate.ts` がJSONを決定的に生成し、
  `assets/entity-models/manifest.json` に CC0-1.0 と来歴を記録する。詳細は
  [`docs/public-api.md`](./docs/public-api.md) §3.7 を参照。
- **`syncEntities` はrenderer DTOを実行時検証する。** 未知のキーや不正な数値がある入力は
  `Schema.SchemaError` で失敗し、メッシュ同期の前に検出する。ブロック光と天空光は両方省略すると全輝度になり、
  指定する場合は両方とも整数 0..15 を渡す。向き・アニメーション・Wither・projectileの制約と省略時の既定値は
  [`docs/public-api.md`](./docs/public-api.md) §3.8 を参照。
- **空・日照・地形フォグは同じ決定的 plan で同期する。**
  `planRenderEnvironment(daylight, farPlane, dimension)` は Schema で入力を検証し、
  有効なら空色、日照強度、フォグ色と距離を `Result` で返す。不正な値は
  `Schema.SchemaError` になり、省略した `farPlane` と `dimension` だけ既定値を使う。
  `WorldRenderer.setEnvironment` は clear color と既存の chunk shader uniform を更新し、
  material や GPU resource を再生成しない。
- **キーボードフォーカスは mx-ui と mc-render の間で分担する。** mx-ui が DOM
  membership を解決してフォーカスを移動し、mc-render は `FocusTarget` の
  `{ group, index }` DTO を `InputServiceApi` で運び、矢印キーを navigation intent に変換する。
  入力アダプタは mx-ui の resolver / intent callback を受け取るが、DOM 要素を調べず、
  `.focus()` や `preventDefault()` を呼ばない。詳細は
  [`docs/public-api.md`](./docs/public-api.md) §2.10。
  **同 §2.11（UI click が pointer lock を要求しないこと）も閉じた**——
  `acquiresPointerLock` が click landing を受け取り、mx-ui の分類 callback を使う。
- **ゲームパッドとタッチ入力。** `domain/gamepad-input.ts` と
  `application/gamepad-input-adapter.ts` が、押下エッジ・解放・軸のデッドゾーン・切断時の
  解放を実装する。タッチ入力も `browser-input-adapter.ts` と
  `test/touch-controls.test.ts` に実装済み。ブラウザの `GamepadList` 取得と毎フレームの
  `poll` 呼び出しはホストの責務で、DOM API は mc-render の型境界に入れない。
- **描画距離、LOD、worker pool、パーティクル、色補正、天候（実装済み）。**
  描画距離はグラフィックス品質プリセットとは別に設定し、ホストは `WorldRenderer` と
  `makeChunkStoreMesher` の双方に同じ `renderDistance` を渡す。
  前者はチャンクの表示範囲を制限し、後者は `cameraChunk` との距離で LOD を選ぶ。
  カメラが別チャンクへ移動すると、常駐チャンクの LOD を再評価し、LOD が変わった
  チャンクだけを再メッシュする。
  worker pool は browser entry から起動し、パーティクルは
  `runtime.world.particleService.spawn` で要求する。色補正は生成時か
  `setColorVisionCorrection` で設定し、水中状態は `setUnderwater` で更新する。
  雨、雪、雷は `runtime.world.weather.frame` に天候スナップショットを渡して更新する。
  `seed` または `lightningSequence` が不正な値なら、`frame` は `Schema.SchemaError` で失敗する。

```typescript
import { Effect } from 'effect'
import { makeChunkStoreMesher } from '@nerima-games/mc-render'
import { makeBrowserWorldRuntime, startBrowserMeshingWorkerPool } from '@nerima-games/mc-render/browser'

const workers = await Effect.runPromise(startBrowserMeshingWorkerPool())
const mesher = makeChunkStoreMesher(store, config, {
  cameraChunk: () => cameraChunk,
  renderDistance: settings.renderDistance,
  workerPool: workers,
})
const runtime = await Effect.runPromise(makeBrowserWorldRuntime({
  canvas,
  colorVisionCorrection: settings.colorVisionCorrection,
  world: {
    renderDistance: settings.renderDistance,
    weather: { particleCapacity: weatherParticleCapacity },
  },
}))
await Effect.runPromise(runtime.world.particleService.spawn({ kind: 'fire', position }))
await Effect.runPromise(runtime.setColorVisionCorrection(settings.colorVisionCorrection))
await Effect.runPromise(runtime.setUnderwater(isUnderwater))
await Effect.runPromise(runtime.world.weather.frame(weatherSnapshot, cameraPosition))
```

`BrowserFrame` の形は変わらない。ホストは従来どおり `advanceFrame` または `start` でフレームを渡す。
UI で色補正を変更したら `setColorVisionCorrection` を、水中状態が変わったら `setUnderwater` を呼ぶ。
各実装経路は
`src/application/world-renderer.ts:911,1375-1379,1772-1776`、
`src/application/chunk-store-mesher.ts:389-405,466-494,567-605`、
`src/application/world-sync.ts:428-432`、`src/browser-meshing-workers.mts:25-29,55-63`、
`src/application/world-renderer-production.ts:113`、`src/application/weather-renderer.ts:126-133`、
`src/browser.ts:1912-1925,2085,2116-2123` にある。詳細と呼び出し例は
[`docs/public-api.md`](./docs/public-api.md) を参照。
- **ビルドは実装済みだが、publish はまだ運用していない。** `pnpm build` が `dist/index.js` と宣言ファイルを生成し、
  `package.json` の `exports` はその生成物を指す。`version` は `0.x` に留める（[`docs/versioning.md`](./docs/versioning.md)）。
- **Node coverage 閾値は全指標 100% に設定済み。** `src/browser.ts` は Chromium 上で実行するため Vitest V8 の数値対象から除外し、Playwright の browser job で挙動を検査する。
- **共有語彙は出所を分離している。** `mc-kernel` の定数は公開 package から直接 import し、
  mc-meshing と共有する可搬なメッシュ表現・LOD 定義はこのリポジトリの domain vocabulary として所有する。
  公開型との assignability は `pnpm typecheck` と各 domain test が検査する。

## ドキュメント

[`docs/README.md`](./docs/README.md) が索引。

## License

MIT
