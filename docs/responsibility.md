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
| ポストFXチェーン | パスの確定順序、品質プリセットごとの構成、CompositePass | 順序と検証は実装済 `domain/post-processing.ts`。THREE 実体はホスト側 `mc-compose/apps/web/post-processing.ts` が所有 |
| マテリアル | チャンク（不透明/水/透過固体）、水面、パーティクル、`forceSinglePass` 方針 | 方針は `domain/material-policy.ts` と水面の合成判定。ShaderMaterial の生成と `forceSinglePass` の THREE 転送も実装済み。共有述語が水面を分類できない理由は §2.1 |
| カメラ | mc-sim のスナップショットを THREE カメラへミラー、視錐台カリング | ミラーは実装済 `domain/camera-mirror.ts` |
| パーティクル | インスタンス化パーティクルプール | **実装済**。`domain/particle-pool.ts` と `application/particle-system.ts` が InstancedBufferGeometry / attributes / shader binding を所有する。 |
| 水面 | 水マテリアル・屈折 | **方針・算術・ShaderMaterial factory は実装済**。屈折プリパスの実行判定は `domain/water-refraction.ts`。アトラスの THREE 転送はホスト側アダプタの残課題。**幾何（水面高さ・流向）は mc-meshing** |
| `WorldRenderer` | chunk ダーティ購読 → メッシュ更新 | **実装済** —— `application/world-renderer.ts` が `setChunk` / `removeChunk` / `draw` / `resize` / `setEnvironment` / `dispose` を所有し、`application/world-sync.ts` の `attachChunkStoreRenderer` が dirty 通知を直列化する。純粋側は `domain/chunk-geometry.ts` と `domain/render-environment.ts`。 |
| ワーカープール**実装** | 地形ワーカー / メッシングワーカーのプール（Port は各所有者） | **実装済** `application/worker-pool.ts` |
| **実行時入力サービス** | キーボード / マウス / ポインタロック / タッチ / ゲームパッド / キーリマッピング | ポート越しに実装済 `application/input-service.ts` + `window` アダプタ `application/browser-input-adapter.ts` + `application/gamepad-input-adapter.ts`。ブラウザの `GamepadList` 取得はホストの責務 |
| **フレーム stage 登録** | `render:input` / `render:camera-mirror` / `render:chunk-sync` / `render:draw` / `render:post-fx` | 登録位置は確定済 `stages/`。5 本とも実体。`render:post-fx` はチェーンを組み、ホスト注入の `PostProcessingRenderer` が `EffectComposer` を実行する。 |
| フレーム毎スクラッチ | 一時 `Map` の事前確保と再利用 | 実装済 `domain/frame-scratch.ts` |
| グラフィックス品質プリセット適用 | low / medium / high / ultra | ポストFX部分のみ `domain/post-processing.ts` |
| テクスチャアセット | アトラス画像を同梱（plan.md §5.3「独立アセットリポジトリは作らない」） | **RGBAアトラス生成とレイアウト算術は実装済**。`domain/texture-atlas.ts` が512x512画像をDOM非依存で生成する。THREEへの転送はホスト側アダプタの責務 — §2.2 |
| ライトグリッドの**適用** | worldgen が持つ 4bit ライトグリッドを描画に反映 | **実装済** —— world adapter が sky/block light を geometry に運び、chunk shader が AO と合成する。`planRenderEnvironment` は同じ shader の日照、空色、距離フォグを決定的に同期する。 |

### 2.1 `forceSinglePass` の共有述語は水面を分類しない（設計上の境界）

`domain/material-policy.ts` の規則は **`shared && transparent+DoubleSide && cutout`** である。
水マテリアルは共有・transparent・DoubleSide だが `alphaTest` が 0（`ShaderMaterial` の既定）なので
**cutout ではない**。したがって `describeMaterialPolicy` の判定は `review-sharing` になり、
その処方は「共有をやめるか、コストを承知で受け入れよ」である。

**参照実装はそのどちらもしていない。** `forceSinglePass: true` を立てており
（`water-material.ts:137`）、`material-policy.ts:67-68` はその行を規則の**正しい適用例 4 件のひとつ**として
列挙している。つまり述語と、その周りの散文が食い違っている。

正しいのは散文のほうである。`material-policy.ts:62-63` は基準を
「cutout **または平面**であって順序が何も買わないもの」と書いており、
`:92-96` で **cutout の側だけ**を述語にした。平面の側は `MaterialSpec` に表現が無い。
水面はまさにその穴に落ちる —— グリーディメッシュされた水面は閉じた体積ではなく単一の平面で、
どの瞬間もカメラに向いている面は 2 面のうち 1 面だけなので、
背面→前面の 2 パス順序が解決するものが無い。水面同士の前後関係は**オブジェクト間ソート**であり、
`forceSinglePass` はそこに影響しない。

**とった対処**: 共有述語は**書き換えていない**。`MaterialSpec` に `flat` を足すのは
他の 4 マテリアルの判定を変える共有ファイルの決定であって、水面についての決定ではない。
また水面の `alphaTest` を 0 以外に**偽らせてもいない**。
欠けている条項を `WATER_SURFACE_IS_FLAT` という値として置き、
`waterForceSinglePassVerdict` で共有規則と合成した。
アダプタは正しい答えを得て、`material-policy.ts` は自分の答えを保ち、食い違いは見えたまま残る。
生成された水マテリアルには `forceSinglePass: true` を設定し、`test/water-surface.test.ts` と
`test/world-renderer.test.ts` で判定と THREE 転送の両方を固定してある。

**述語を広げる決定は未決。** 広げるなら `MaterialSpec` に平面性を足し、
4 マテリアル分の判定を通し直すこと。そのとき上記テストの前半が落ちて、この節に導かれる。

### 2.2 テクスチャアセットは純粋RGBAとして生成する

アトラスは分離できる 2 つのものである。

| | 中身 | ここで検査できるか |
| --- | --- | --- |
| **画像** | 512x512 の RGBA | **できる。** `generateTerrainAtlas` はDOM・Canvas・ファイルシステムを使わず、決定的な `Uint8ClampedArray` を返す |
| **レイアウト** | どのタイル番号がどの (列, 行) か、その UV 矩形は何か | **できる。** 整数 2 つの上の純粋な算術で、起こりうるバグは全部単体テストで見える |

全256タイルは番号由来のピクセルアートで識別できる。ブロックマッピングと同じ番号を使い、
water / lava / leaves / glass / cutout はパレットとアルファ値を分ける。テストは寸法、決定性、
全120ブロックの全face role、参照タイル間の差、素材別アルファを検証する。

残るのは生成済みRGBAを `DataTexture` 等へ渡すホスト側の接続であり、画像本体ではない。

### 2.3 THREE シームが**覆っている範囲**（2026-07-28）

上の表が「THREE アダプタ待ち」と書いていた行が複数あり、そのうち**着地したのは一部だけ**である。
「アダプタが無い」と「アダプタはあるがこの構成子を持たない」を混ぜると、
残作業の見積もりが毎回ずれる。シームが実際に露出しているものを列挙する。

`application/three-surface.ts` が持つ構成子は **7 つで全部**である:

| 構成子 | 何に使われているか |
| --- | --- |
| `WebGLRenderer` | `makeWorldRenderer` がコンテキストを取得する 1 箇所 |
| `Scene` | チャンク mesh の入れ物 |
| `PerspectiveCamera` | ミラーの書き込み先 |
| `BufferGeometry` | チャンク 1 つぶんのジオメトリ |
| `BufferAttribute` | position / normal / color / uv / index の 5 本 |
| `Mesh` | ジオメトリ + 共有マテリアル |
| `MeshBasicMaterial` | **全チャンク共有の 1 枚**。`vertexColors: true`、光源なし |

**この表に無いものは、アダプタ着地では解けていない。** 具体的には:

| 表の「THREE アダプタ待ち」だった項目 | 実際 |
| --- | --- |
| パーティクルの `InstancedMesh` | シームに `InstancedMesh` が無い。**残っている** |
| 水面の `ShaderMaterial` | シームに `ShaderMaterial` が無い。構成できるマテリアルは `MeshBasicMaterial` 1 種。**残っている** |
| ポストFXの `EffectComposer` / 各 `Pass` | **ホスト側に実装済み**。`mc-compose/apps/web/post-processing.ts` が `RenderPass` / `GTAOPass` / `Bloom` / `Bokeh` / `SMAA` / `OutputPass` を chain 順に構築する |
| 生成RGBAを受け取る `DataTexture` | シームに無い。§2.2。**残っている** |
| チャンクのジオメトリ構築と描画 | **着地した**（`world-renderer.ts` / `chunk-geometry.ts`） |

シームが小さいのは事故ではなく、`test/three-surface.test.ts` が
**本物の `three` に対して構造的代入可能性を証明できる大きさ**に保つためである
（[testing.md](./testing.md) §12.1）。構成子を足すたびにその証明が 1 件増える。
だから「THREE アダプタ待ち」という書き方をこれ以上使わないこと ——
**待っているのは特定の構成子であって、アダプタではない。**

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
| **`three` 名前空間そのものを渡すこと** | **ホスト**（mc-compose の `apps/web/main.ts`） | `window` / `document` / canvas と同じ扱い。mc-render は `application/three-surface.ts` で構造的に記述するだけで `three` を import しない |
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

**`MeshQuad` はミラーである。** mc-meshing は依存グラフ上は親だが、
publish されていないので import できない（`domain/kernel-vocabulary.ts` と同じ事情）。
加えて mc-compose の vite alias が解決するのは 3 兄弟だけなので、
import するとブラウザでページが起動しなくなる。publish 時に削除する。

**ワーカープール。** plan.md §3.7 は worldgen 側に「ワーカープールPort（実装は利用側が注入）」と書き、
§3.9 は render に「ワーカープール実装」と書く。つまり **Port の定義は使う側、実装はここ**。
参照実装の `packages/worker`（1,556 LOC）は Port と実装が同居しているので、分割時に分ける。

**ライティング。** データ（BFS光伝播・4bitパック・ライトグリッド）は mc-worldgen が所有し、
チャンクデータの一部。mc-render はそれをシェーダに渡して**適用**するだけ（plan.md §3.7 / §7）。
光の値を mc-render で再計算し始めたら境界を越えている。

その帰結が `domain/chunk-geometry.ts` の頂点カラーに出ている。
参照実装は `R = AO, G = sky light, B = block light` を詰めるが
（`greedy-meshing-accumulator.ts:131-134`）、ここは 3 チャンネルとも AO を書いている。
**これは色の選択ではなく、まだ届いていないものについての記述である。**
グリッドが来たら G と B がそのまま置き換わる。

**2026-07-28 の訂正**: ここにはかつて「**読むライトグリッドがまだ無い**」と書いてあった。
**それはもう正しくない。** mc-worldgen の `domain/light.ts` にライトグリッドは存在する ——
`ChunkLight`（sky / block の 2 面）、4bit パック（`LIGHT_BYTE_LENGTH = CHUNK_VOLUME / 2`、
`getLightAt` / `setLightAt`）、BFS 伝播（`computeChunkLight`）、そして `setBlock` による無効化。
`index.ts` から export もされている。

**塞いでいるのは存在ではなく到達可能性である。** mc-worldgen は未 publish なので import できず
（`domain/kernel-vocabulary.ts` と同じ事情）、mc-compose の vite alias が解決する 3 兄弟
（mc-render / mx-ui / mx-redstone）にも入っていない。この 2 つのどちらかが外れた日に、
`chunk-geometry.ts` の G と B は**そのまま置き換えられる** —— 置き換え先が既にあるので、
これは設計課題ではなく配線待ちである。

**この区別を潰さないこと。** 「無い」と「あるが届かない」は、
次に読む人が着手できるかどうかを分ける。本文書は前者を 1 回書き損じている。

同じ理由で、`SKY_CLEAR_COLOR` は定数である。参照は昼夜サイクルから駆動する
（`lighting-stage.ts:23`）。昼夜サイクルの所有者はまだ決まっていない。

**Escape キー。** 入力サービスはキーを**観測**するが、Escape の**意味**は決めない。
閉じるかどうかを決めるのはフレーム側の単一ハンドラ（plan.md §3.9 / §3.13 が対で言及）。
`domain/input-bindings.ts` の `ESCAPE_OWNER = 'frame-handler'` がこれを値として記録している。

**アクセシビリティ。** 色覚モード（feColorMatrix ダルトナイゼーション、**canvas のみに適用**）は
plan.md §3.13 で mx-ui の資産として挙げられているが、適用対象が canvas である以上
mc-render 側の実装が要る可能性が高い。**未決。** 実装時に決めて本文書に追記すること。

### 3.2 判断手順

1. **THREE / WebGL / canvas / `window` に触るか** → 触らないなら、たぶんここではない
2. **消したらゲームのルールが変わるか、見た目が変わるだけか** → ルールなら体験モジュール（§2.3-1）
3. **シミュレーションに問い合わせているか、シミュレーションから受け取っているか** →
   問い合わせているなら設計が逆転しかけている（DN-06）
4. **kit があれば動くが kit が無いと動かないか** → それは出荷ビルドで壊れる（§2.3-2）

## 4. 親と子

### 親（mc-render が依存する）

| リポジトリ | 使うもの | 未公開のため現状 |
| --- | --- | --- |
| `mc-kernel` | 語彙全般（`CameraPoseSnapshot`、座標、`GameModule`、Clock Port） | `domain/kernel-vocabulary.ts` に暫定ミラー |
| `mc-meshing` | `mesh(chunk, neighbors, config) → {opaque, water, transparentSolid}` | **未使用だが型は消費している** —— `domain/chunk-geometry.ts` が `MeshQuad` / `FaceDirection` / `FaceRole` / `tangentAxes` を**構造ミラー**として持ち、`test/chunk-geometry.test.ts` が mc-meshing の `domain/mesh.ts:149-169` に対して固定している。publish 時に削除して import に置き換える |
| `mc-sim` | `CameraPoseSnapshot`、描画対象の状態（**チャンクダーティ購読はここではない** — `mc-worldgen`） | 未使用（`domain/camera-mirror.ts` は構造ミラーのみ） |
| `mc-worldgen` | `Chunk` データ、ライトグリッド | 未使用 |

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
| `mc-compose` | 推移的に全部 | — |

実行時依存に持つのは kit のみ。**ただしそれは界面が揺れてよいという意味ではない。**
kit が壊れると 15 リポジトリの完了条件「内蔵プレビューが操作可能」が全部止まる。
