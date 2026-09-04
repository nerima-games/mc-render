# 責務

出典: plan.md §3.9。以下は原文の責務記述を、スコープ / 非スコープの境界まで展開したもの。

## 1. 責務（plan.md §3.9 原文）

> THREE.js 描画一式（マテリアル/カメラ/ポストFX/パーティクル/水面）+ ワーカープール実装 +
> **実行時入力サービス**（キーボード/マウス/ポインタロック/タッチ/キーリマッピング）。テクスチャ同梱

plan.md §2.3-1 の分類でいう **名詞**。「どう見えるか」の仕組みと、
「どのキーが押されているか」という状態を持ち、「何が起きるか」のルールは持たない。

## 2. スコープ内

| 領域 | 具体 | 状態 |
| --- | --- | --- |
| ポストFXチェーン | パスの確定順序、品質プリセットごとの構成、CompositePass | 順序と検証は実装済 `domain/post-processing.ts`。既定の THREE 実体は公開ブラウザ入口 `src/browser.ts` が所有し、外部ホストは独自の `PostProcessingRenderer` を注入できる |
| マテリアル | チャンク（不透明/水/透過固体）、水面、パーティクル、`forceSinglePass` 方針 | 方針は `domain/material-policy.ts` の意味論 DTO。ShaderMaterial の生成と `forceSinglePass` の THREE 転送も実装済み。平面性を含む判定の境界は §2.1 |
| カメラ | mc-sim のスナップショットを THREE カメラへミラー、視錐台カリング | ミラーは実装済 `domain/camera-mirror.ts` |
| パーティクル | インスタンス化パーティクルプール | **実装済**。`domain/particle-pool.ts` と `application/particle-system.ts` が InstancedBufferGeometry / attributes / shader binding を所有する。 |
| 水面 | 水マテリアル・屈折 | **方針・算術・ShaderMaterial factory は実装済**。屈折プリパスの実行判定は `domain/water-refraction.ts`、実行とアトラス転送は既定の `src/browser.ts` が担う。**幾何（水面高さ・流向）は mc-meshing** |
| `WorldRenderer` | chunk ダーティ購読 → メッシュ更新 | **実装済** —— `application/world-renderer.ts` が `setChunk` / `removeChunk` / `draw` / `resize` / `setEnvironment` / `dispose` を所有し、`application/chunk-store-mesher.ts` の `attachChunkStoreRenderer` が dirty 通知を直列化する。純粋側は `domain/chunk-geometry.ts` と `domain/render-environment.ts`。 |
| ワーカープール**実装** | 地形ワーカー / メッシングワーカーのプール（Port は各所有者）と実ブラウザ Worker adapter | **実装済** `application/worker-pool.ts` + `application/browser-worker-port.ts` |
| **実行時入力サービス** | キーボード / マウス / ポインタロック / タッチ / ゲームパッド / キーリマッピング | ポート越しに実装済 `application/input-service.ts` + `window` アダプタ `application/browser-input-adapter.ts` + `application/gamepad-input-adapter.ts`。ブラウザの `GamepadList` 取得はホストの責務 |
| **フレーム stage 登録** | `render:input` / `render:camera-mirror` / `render:chunk-sync` / `render:draw` / `render:post-fx` | 登録位置は確定済 `stages/`。5 本とも実体。`render:post-fx` はチェーンを組み、既定の `src/browser.ts` または外部ホスト注入の `PostProcessingRenderer` が `EffectComposer` を実行する。 |
| フレーム毎スクラッチ | 一時 `Map` の事前確保と再利用 | 実装済 `domain/frame-scratch.ts` |
| グラフィックス品質プリセット適用 | low / medium / high / ultra | `domain/post-processing.ts` がポストFX、`composerRenderTarget`、屈折間引き、DPR 上限、bloom 強度、god-rays サンプル数を定義し、既定ブラウザが EffectComposer／水面屈折へ反映。カメラ描画距離は生の `farPlane`（`WorldRendererOptions`、既定 300、`application/world-renderer.ts:529,166`）で上書きできるが、`WorldRendererOptions` に `renderDistance` という名のフィールドは無い——参照実装のチャンク基準の `renderDistance` は mc-sim 所有で未公開であり、本パッケージから届かない（`application/world-renderer.ts:145-166`）。影解像度と実 Three のライトは現行 API の責務外 |
| テクスチャアセット | アトラス画像を同梱（plan.md §5.3「独立アセットリポジトリは作らない」） | **RGBAアトラス生成とレイアウト算術は実装済**。`domain/texture-atlas.ts` が512x512画像をDOM非依存で生成し、`src/browser.ts` が生成値・URLを Three の texture へ転送する。ゲーム固有アセットの配布・キャッシュはホストの責務 — §2.2 |
| ライトグリッドの**適用** | worldgen が持つ 4bit ライトグリッドを描画に反映 | **実装済** —— world adapter が sky/block light を geometry に運び、chunk shader が AO と合成する。`planRenderEnvironment` は同じ shader の日照、空色、距離フォグを決定的に同期する。
第 3 引数 `dimension`（`@nerima-games/mc-kernel` の `Dimension`）はどの次元かによって
空色/フォグ/日照の**プリセット**を選ぶが、worldgen の 4bit ライトグリッド適用そのものとは
独立している — 次元は空の見た目を選ぶだけで、ブロックごとの光は相変わらず worldgen が
計算し mc-render は再計算しない。 |

### 2.1 `forceSinglePass` は cutout と平面を同じ規則で分類する

`domain/material-policy.ts` の判定は
**`shared && transparent+DoubleSide && (cutout || flatSurface)`** である。
`MaterialSpec.flatSurface` は THREE のフラグから推論できないジオメトリ意味論で、
2 パスの背面→前面順序が解決すべき遠い壁を持たない場合に `true` とする。

水マテリアルは `alphaTest: 0` を忠実に保持し、グリーディメッシュされた単一平面なので
`flatSurface: true` を設定する。その結果 `describeMaterialPolicy` は直接
`must-force-single-pass` を返し、`src/application/world-renderer-materials.ts` と
`src/browser.ts` は同じ判定に従って `forceSinglePass: true` を転送する。

水面同士の深度順序はオブジェクト間ソートであり、`forceSinglePass` の責務外である。
`flatSurface: false` の閉じた透明体は `review-sharing` のままなので、平面性を理由に
全ての半透明物を単一パスへ変えることはない。回帰は
`test/material-policy.test.ts` と `test/water-surface.test.ts` が cutout、flat、真の透明体、
共有なし、FrontSide を固定する。

### 2.2 テクスチャアセットは純粋RGBAとして生成する

アトラスは分離できる 2 つのものである。

| | 中身 | ここで検査できるか |
| --- | --- | --- |
| **画像** | 512x512 の RGBA | **できる。** `generateTerrainAtlas` はDOM・Canvas・ファイルシステムを使わず、決定的な `Uint8ClampedArray` を返す |
| **レイアウト** | どのタイル番号がどの (列, 行) か、その UV 矩形は何か | **できる。** 整数 2 つの上の純粋な算術で、起こりうるバグは全部単体テストで見える |

全256タイルは番号由来のピクセルアートで識別できる。ブロックマッピングと同じ番号を使い、
water / lava / leaves / glass / cutout はパレットとアルファ値を分ける。テストは寸法、決定性、
全120ブロックの全face role、参照タイル間の差、素材別アルファを検証する。

`src/browser.ts` が生成済みRGBAを `DataTexture` に渡し、URL からの読み込みも扱う。残るのはゲーム固有アセットの配布・キャッシュであり、画像本体ではない。

### 2.3 THREE シームが**覆っている範囲**

`application/three-surface.ts` は、最小の `ThreeSurface` と、必要な機能だけを追加する
拡張 surface を持つ。コアの実行時 `three` 名前空間は構造的な surface として受け取り、
レンダラー本体はパッケージを直接 import しない。公開ブラウザ入口 `src/browser.ts` が
DOM・Three・EffectComposer を結ぶ明示的な実装境界である。

| surface | 構成子 | 用途 |
| --- | --- | --- |
| `ThreeSurface` | `WebGLRenderer`, `Scene`, `PerspectiveCamera`, `BufferGeometry`, `BufferAttribute`, `Mesh`, `MeshBasicMaterial` | 最小の unlit/fallback 描画経路 |
| `ThreeShaderSurface` | 上記 + `ShaderMaterial` | `makeChunkShaderMaterial` / `makeWaterMaterial` によるチャンク・水面の本番経路 |
| `ThreeInstancedSurface` | 上記 + `InstancedBufferGeometry`, `InstancedBufferAttribute` | `particle-system.ts` のインスタンシング経路 |

`makeProductionWorldRenderer` はこの拡張 surface を合成して、atlas-aware なチャンク shader、
アニメーション水面、インスタンス化パーティクルを構成する。`makeWorldRenderer` は
最小 surface だけでも動くフォールバックとして残る。

このシームに含めないものは、プラットフォームやアプリケーションが所有する。

| 項目 | 所有者・状態 |
| --- | --- |
| 実際の browser canvas / WebGL context / `three` の namespace | `src/browser.ts` が既定実装を提供。Node の構造テストでは代替 surface を使い、外部ホストはコア入口へ独自 surface を渡せる |
| PNG の読み込みと `DataTexture` / `TextureLoader` | 生成RGBA・URLアトラスは `src/browser.ts` が扱う。ゲーム固有の PNG 配布・キャッシュはホストアプリ |
| `EffectComposer` / 各 post-processing pass | `src/browser.ts` の既定実装、または外部ホストの post-processing chain |
| voxel-DDA レイキャスト | `mc-physics`。mc-render は視覚的な picking を所有しない |

シームを小さく保つのは、`test/three-surface.test.ts` で本物の `three` に対する構造的代入可能性を
証明し、ドメインを browser/GPU から独立させるためである（[testing.md](./testing.md) §12.1）。

## 3. 非スコープ（明示的に持たない）

| 持たないもの | 正しい置き場 | 根拠 |
| --- | --- | --- |
| **カメラ姿勢の正** | **mc-sim** | plan.md §3.8 / §4.3 / §5.1-2。ここはミラー専用。DN-06 |
| **グリーディメッシング本体** | mc-meshing | plan.md §3.3。ここはその結果をバッファとして受け取るだけ |
| **地形生成・バイオーム・カーバー・構造物** | mc-worldgen | plan.md §3.7 |
| **ライトグリッドの計算（BFS光伝播）** | mc-worldgen | plan.md §3.7 末尾。ここは**適用**のみ |
| **物理・衝突・レイキャスト（voxel-DDA）** | mc-physics（mc-render からは**推移依存で import 禁止**） | plan.md §3.4 |
| **セーブ / ロード** | mc-save（同じく推移依存で import 禁止） | plan.md §3.5 |
| **ゲーム状態全般**（インベントリ・体力・時刻・エンティティ台帳） | mc-sim | plan.md §3.8 |
| **「W を押したら歩く」** | mc-sim（状態遷移）+ mx-gameplay（ルール） | plan.md §2.3-1。ここは「キーが押されている」までしか答えない |
| **DOM UI 全般**（HUD / メニュー / インベントリ画面 / 設定画面 / 字幕表示） | mx-ui | plan.md §3.13。mx-ui は kit すら不要（DOM のみで起動） |
| **モーダルの開閉ロジック** | mx-ui + フレーム側 Escape ハンドラ | plan.md §3.13 末尾「モーダルの Escape は stopPropagation、閉じる責務はフレーム側単一ハンドラ」 |
| **サウンド・字幕発行** | mc-audio | plan.md §3.6 |
| **stage の全順序表** | mc-compose | plan.md §2.3-3 |
| **プレビュー共通ハーネス** | mc-playground-kit | plan.md §3.10。**依存してはならない**（devDependency 専用） |
| **QA/デバッグAPI・E2E** | mc-compose | plan.md §3.15 |
| **`three` 名前空間そのものを渡すこと** | **`src/browser.ts` または外部ホスト** | コア入口は `application/three-surface.ts` で構造的に記述し、ブラウザ入口が `window` / `document` / canvas と Three を接続する。外部ホストはコア入口を直接利用できる |
| **何を描くか** | **mc-render** | ホストは `getContext` も draw call も書かない。ライブラリを渡すのは配線、何を描くか決めるのはルール |

### 3.1 境界が紛らわしい 5 件

**メッシング。** グリーディメッシングのアルゴリズムは mc-meshing（純粋関数）。
その結果を `BufferGeometry` にしてシーンに載せるのが mc-render。
参照実装では両方が `packages/rendering/infrastructure/meshing/`（2,993 LOC）に同居しており、
分割にあたって切り分けが要る（[porting.md](./porting.md) §3）。

**2026-07-28: この境界に実装が入った。** `domain/chunk-geometry.ts` が
quad → 頂点バッファ、`application/world-renderer.ts` が
頂点バッファ → `BufferGeometry` → シーン、である。
2 つに割れているのは、前者が**純粋で Node でテストでき**、後者が GPU を要るから。

境界の向きについて 2 点、実装して初めて明確になったことがある:

- **quad は単位面ではない。** `width`/`height` は `tangentAxes(direction)` の順に走る
  extent であり、平坦な地形ではほぼ全部が merge 済みである。
  単位面を仮定した builder は「面数も法線も巻き順も正しく、形だけ違う」メッシュを作る。
- **AO は face ごとに 1 値であって vertex ごとに 4 値ではない。**
  これは mc-meshing 側の設計判断（`domain/ambient-occlusion.ts`）であり、
  mc-render はそれを 4 頂点に複製するだけである。**mc-render 側で per-vertex に
  「改善」してはならない** —— per-vertex AO と greedy merge は本質的に両立しない。

**`MeshQuad` は mc-meshing の公開型を直接利用する。**
`domain/chunk-geometry.ts` に残るのは、公開 quad をレンダラ固有の投影・頂点属性へ
変換する処理であり、mc-meshing のメッシュ規則を再実装するミラーではない。

**ワーカープール。** plan.md §3.7 は worldgen 側に「ワーカープールPort（実装は利用側が注入）」と書き、
§3.9 は render に「ワーカープール実装」と書く。つまり **Port の定義は使う側、実装はここ**。
参照実装の `packages/worker`（1,556 LOC）は Port と実装が同居しているので、分割時に分ける。

**ライティング。** データ（BFS光伝播・4bitパック・ライトグリッド）は mc-worldgen が所有し、
チャンクデータの一部。mc-render はそれをシェーダに渡して**適用**するだけ（plan.md §3.7 / §7）。
光の値を mc-render で再計算し始めたら境界を越えている。

現在の配線では `domain/chunk-geometry.ts` が quad の AO と、
`QuadColor` / `QuadShade` が返す packed lighting colour を頂点へ複製する。
`application/chunk-store-mesher.ts` は `ChunkStore.getLight` から cube / cross / fluid
quad のサンプル位置を集め、sky light と block light を `packedLightColor` へ渡す。
`application/world-renderer.ts` の chunk shader はその値を AO / sky / block の入力として
合成する。BFS 光伝播、4bit パック、ライトグリッドの所有権は mc-worldgen にあり、
mc-render はそれを再計算せず、メッシュの頂点属性と shader へ適用する。

同じ理由で、`SKY_CLEAR_COLOR` は定数である。参照は昼夜サイクルから駆動する
（`lighting-stage.ts:23`）。昼夜サイクルの所有者はまだ決まっていない。

**Escape キー。** 入力サービスはキーを**観測**するが、Escape の**意味**は決めない。
閉じるかどうかを決めるのはフレーム側の単一ハンドラ（plan.md §3.9 / §3.13 が対で言及）。
`domain/input-bindings.ts` の `ESCAPE_OWNER = 'frame-handler'` がこれを値として記録している。

**アクセシビリティ。** 色覚モード（feColorMatrix ダルトナイゼーション、**canvas のみに適用**）は
plan.md §3.13 で mx-ui の資産として挙げられている。色覚モードはゲームの描画データや
`WorldRenderer` の規則ではなく、ユーザー設定から canvas 全体へ適用する表示フィルタであるため、
設定を所有する mx-ui と、実 DOM / CSS または SVG filter を接続する browser host の責務とする。
mc-render は canvas を提供するが、設定状態やフィルタ資産を持たない。この境界で実装上の未決事項はない。

### 3.2 判断手順

1. **THREE / WebGL / canvas / `window` に触るか** → 触らないなら、たぶんここではない
2. **消したらゲームのルールが変わるか、見た目が変わるだけか** → ルールなら体験モジュール（§2.3-1）
3. **シミュレーションに問い合わせているか、シミュレーションから受け取っているか** →
   問い合わせているなら設計が逆転しかけている（DN-06）
4. **kit があれば動くが kit が無いと動かないか** → それは出荷ビルドで壊れる（§2.3-2）

## 4. 親と子

### 親（mc-render が直接依存する）

| リポジトリ | 使うもの | 現状 |
| --- | --- | --- |
| `mc-kernel` | 語彙全般（`CameraPoseSnapshot`、座標、`GameModule`、Clock Port） | 公開 package から直接 import |
| `mc-meshing` | `meshChunk(...) → opaque / water / transparentSolid / crossPlants / fluids` と quad の公開型 | 直接利用済み。`domain/chunk-geometry.ts` は投影・頂点バッファ化に固有のメタデータだけを持つ |
| `mc-sim` | `CameraPoseSnapshot`、描画対象の状態（**チャンクダーティ購読はここではない** — `mc-worldgen`） | 直接利用済み |
| `mc-worldgen` | `Chunk` データ、ライトグリッド、`ChunkStore` | 直接利用済み。dirty 通知を購読し、ライト値をメッシュへ運ぶ |

~~**mc-sim のチャンクダーティ通知が未設計であることが、`WorldRenderer` を書けない直接の原因である**~~ → 解消。購読先は **mc-worldgen** の `ChunkStore` である（mc-sim ではない）。[public-api.md §3.1](./public-api.md)
（mc-sim の `docs/public-api.md` §5 参照）。

**2026-07-28 追記**: そのうえで `WorldRenderer` は**書かれた**。
購読が無いことは「書けない」理由ではなかった —— `setChunk(key, buffers)` は
**誰が呼ぶかを知らないまま**正しく定義でき、実際そうなっている。
残っているのは呼び出し元であって、レンダラ側の設計ではない。
`test/world-renderer.test.ts` が押さえているのはその呼び出しプロトコル
（同一 key の再投入が**差し替え**であること、`removeChunk` が `dispose` すること、
`draw` が **mirrored** カメラを書くこと）で、
これらは購読が来た日に**変わらない**性質として選んである。

### 子（mc-render に依存する）

| リポジトリ | 何を使うか | 壊してはいけないもの |
| --- | --- | --- |
| `mc-playground-kit` | レンダラ生成、`InputService`、品質プリセット | 起動の速さ。plan.md §3.10 の 1 秒予算はここのコストに直接効く |
| `mx-gameplay` / `mx-redstone` | （kit 経由の devDependency として間接的に） | — |
| `mc-compose` | ホスト側でレンダラを組み立てる | この package の依存にはしない |

この package の実行時直接依存は、`package.json` に宣言された `mc-*` パッケージと `effect` である。
`mc-playground-kit` と `mc-compose` はこの package を利用するホスト側にあり、
レンダラの実行時依存にはしない。**ただしそれは界面が揺れてよいという意味ではない。**
kit が壊れると内蔵プレビューの操作可能性が止まる。
