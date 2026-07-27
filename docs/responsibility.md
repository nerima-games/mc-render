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
| ポストFXチェーン | パスの確定順序、品質プリセットごとの構成、CompositePass | 順序と検証は実装済 `domain/post-processing.ts`（THREE 実体は未） |
| マテリアル | チャンク（不透明/水/透過固体）、水面、パーティクル、`forceSinglePass` 方針 | 方針は `domain/material-policy.ts`。**ただし述語は水面を分類できない** — §2.1 |
| カメラ | mc-sim のスナップショットを THREE カメラへミラー、視錐台カリング | ミラーは実装済 `domain/camera-mirror.ts` |
| パーティクル | インスタンス化パーティクルプール | **プール本体は実装済** `domain/particle-pool.ts`。容量 512 / drop-oldest / シード付き乱数、フレーム経路で無アロケーション。`InstancedMesh` への束ねは THREE アダプタ待ち |
| 水面 | 水マテリアル・屈折 | **方針・算術は実装済**。マテリアルは `domain/water-surface.ts`、屈折プリパスの実行判定は `domain/water-refraction.ts`。`ShaderMaterial` 実体は THREE アダプタ、**幾何（水面高さ・流向）は mc-meshing** |
| `WorldRenderer` | chunk ダーティ購読 → メッシュ更新 | **未実装。ただし購読先は決まった**（`mc-worldgen` の `ChunkStore.subscribeDirty`。[public-api.md §3.1](./public-api.md)） |
| ワーカープール**実装** | 地形ワーカー / メッシングワーカーのプール（Port は各所有者） | 未実装 |
| **実行時入力サービス** | キーボード / マウス / ポインタロック / タッチ / キーリマッピング | ポート越しに実装済 `application/input-service.ts` + `window` アダプタ `application/browser-input-adapter.ts`（ゲームパッド / タッチは未） |
| **フレーム stage 登録** | `render:input` / `render:camera-mirror` / `render:chunk-sync` / `render:draw` / `render:post-fx` | 登録位置は確定済 `stages/`。本体は FIRST CUT |
| フレーム毎スクラッチ | 一時 `Map` の事前確保と再利用 | 実装済 `domain/frame-scratch.ts` |
| グラフィックス品質プリセット適用 | low / medium / high / ultra | ポストFX部分のみ `domain/post-processing.ts` |
| テクスチャアセット | アトラス画像を同梱（plan.md §5.3「独立アセットリポジトリは作らない」） | **半分だけ実装済**。レイアウト算術（タイル→UV、ハーフテクセル）は `domain/texture-atlas.ts`。**アトラス PNG 本体とそのローダは未実装** — §2.2 |
| ライトグリッドの**適用** | worldgen が持つ 4bit ライトグリッドを描画に反映 | 未実装 |

### 2.1 `forceSinglePass` の述語は水面を分類できない（**既知の穴**）

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
両方が `test/water-surface.test.ts` で固定してある。

**述語を広げる決定は未決。** 広げるなら `MaterialSpec` に平面性を足し、
4 マテリアル分の判定を通し直すこと。そのとき上記テストの前半が落ちて、この節に導かれる。

### 2.2 テクスチャアセットを「半分」にした理由

アトラスは分離できる 2 つのものである。

| | 中身 | ここで検査できるか |
| --- | --- | --- |
| **画像** | 512x512 の PNG。バイナリ資産 | **できない。** 読み込みに `TextureLoader` / `CanvasTexture` すなわち DOM が要り、`tsconfig.base.json` はそれを持たない（持たせない）。見た目が正しいかは Node では誰も確かめられない |
| **レイアウト** | どのタイル番号がどの (列, 行) か、その UV 矩形は何か | **できる。** 整数 2 つの上の純粋な算術で、起こりうるバグは全部単体テストで見える |

レイアウトだけを `domain/texture-atlas.ts` に入れた。§3.1 の方針
（機械的に検査できる半分はデータと述語にし、スクリーンショットが要る半分は
「要る」と書く）をそのまま適用したものである。
レイアウト側は飾りではなく、パーティクルが破壊したブロックのタイルをサンプルするのに
UV オフセットを必要とするので、パーティクル作業の**依存**である。

**PNG 本体は残っている作業**であり、THREE アダプタと同時に入れるのが自然である
（ローダがそちら側にあるため）。

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
（`greedy-meshing-accumulator.ts:131-134`）、**読むライトグリッドがまだ無い**ので
3 チャンネルとも AO を書いている。**これは色の選択ではなく、
まだ無いものについての記述である。** グリッドが来たら G と B がそのまま置き換わる。

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
| `mc-meshing` | `mesh(chunk, neighbors, config) → {opaque, water, transparentSolid}` | 未使用 |
| `mc-sim` | `CameraPoseSnapshot`、描画対象の状態（**チャンクダーティ購読はここではない** — `mc-worldgen`） | 未使用（`domain/camera-mirror.ts` は構造ミラーのみ） |
| `mc-worldgen` | `Chunk` データ、ライトグリッド | 未使用 |

~~**mc-sim のチャンクダーティ通知が未設計であることが、`WorldRenderer` を書けない直接の原因である**~~ → 解消。購読先は **mc-worldgen** の `ChunkStore` である（mc-sim ではない）。[public-api.md §3.1](./public-api.md)
（mc-sim の `docs/public-api.md` §5 参照）。

### 子（mc-render に依存する）

| リポジトリ | 何を使うか | 壊してはいけないもの |
| --- | --- | --- |
| `mc-playground-kit` | レンダラ生成、`InputService`、品質プリセット | 起動の速さ。plan.md §3.10 の 1 秒予算はここのコストに直接効く |
| `mx-gameplay` / `mx-redstone` | （kit 経由の devDependency として間接的に） | — |
| `mc-compose` | 推移的に全部 | — |

実行時依存に持つのは kit のみ。**ただしそれは界面が揺れてよいという意味ではない。**
kit が壊れると 15 リポジトリの完了条件「内蔵プレビューが操作可能」が全部止まる。
