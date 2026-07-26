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
| マテリアル | チャンク（不透明/水/透過固体）、水面、パーティクル、`forceSinglePass` 方針 | 方針のみ `domain/material-policy.ts` |
| カメラ | mc-sim のスナップショットを THREE カメラへミラー、視錐台カリング | ミラーは実装済 `domain/camera-mirror.ts` |
| パーティクル | インスタンス化パーティクルプール | 未実装 |
| 水面 | 水マテリアル・屈折 | 未実装 |
| `WorldRenderer` | chunk ダーティ購読 → メッシュ更新 | **未実装。ただし購読先は決まった**（`mc-worldgen` の `ChunkStore.subscribeDirty`。[public-api.md §3.1](./public-api.md)） |
| ワーカープール**実装** | 地形ワーカー / メッシングワーカーのプール（Port は各所有者） | 未実装 |
| **実行時入力サービス** | キーボード / マウス / ポインタロック / タッチ / キーリマッピング | ポート越しに実装済 `application/input-service.ts`（`window` アダプタは未） |
| **フレーム stage 登録** | `render:input` / `render:camera-mirror` / `render:chunk-sync` / `render:draw` / `render:post-fx` | 登録位置は確定済 `stages/`。本体は FIRST CUT |
| フレーム毎スクラッチ | 一時 `Map` の事前確保と再利用 | 実装済 `domain/frame-scratch.ts` |
| グラフィックス品質プリセット適用 | low / medium / high / ultra | ポストFX部分のみ `domain/post-processing.ts` |
| テクスチャアセット | アトラス画像を同梱（plan.md §5.3「独立アセットリポジトリは作らない」） | 未実装 |
| ライトグリッドの**適用** | worldgen が持つ 4bit ライトグリッドを描画に反映 | 未実装 |

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

### 3.1 境界が紛らわしい 5 件

**メッシング。** グリーディメッシングのアルゴリズムは mc-meshing（純粋関数）。
その結果を `BufferGeometry` にしてシーンに載せるのが mc-render。
参照実装では両方が `packages/rendering/infrastructure/meshing/`（2,993 LOC）に同居しており、
分割にあたって切り分けが要る（[porting.md](./porting.md) §3）。

**ワーカープール。** plan.md §3.7 は worldgen 側に「ワーカープールPort（実装は利用側が注入）」と書き、
§3.9 は render に「ワーカープール実装」と書く。つまり **Port の定義は使う側、実装はここ**。
参照実装の `packages/worker`（1,556 LOC）は Port と実装が同居しているので、分割時に分ける。

**ライティング。** データ（BFS光伝播・4bitパック・ライトグリッド）は mc-worldgen が所有し、
チャンクデータの一部。mc-render はそれをシェーダに渡して**適用**するだけ（plan.md §3.7 / §7）。
光の値を mc-render で再計算し始めたら境界を越えている。

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
