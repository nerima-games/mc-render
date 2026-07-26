# 移植元と実測 LOC

参照実装 `takeokunn/ts-minecraft`（凍結・仕様書兼テストオラクル）からの移植元一覧。
**LOC はすべて本ドキュメント作成時に `wc -l` で実測した値**であり、plan.md の見積りではない。

計測条件:

```console
# production LOC: .ts のうち *.test.ts / *.spec.ts を除く（node_modules / dist は対象外）
$ find <dir> -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' | xargs cat | wc -l
```

`packages/*/test/` 配下のヘルパ（`*-test-utils.ts` 等）は `.test.ts` ではないため
**production 側に計上される**。

## 1. サマリ

plan.md §3.9 の移植元:

> `packages/rendering`（meshing以外、~7k）+ `packages/worker` のプール実装 +
> `packages/presentation/input`（681 LOC）

| 移植元 | production | test | ファイル数(prod) | plan.md | 判定 |
| --- | ---: | ---: | ---: | --- | --- |
| `packages/rendering`（全体） | **9,812** | 9,875 | 65 | — | — |
| `packages/rendering` の meshing 以外 | **6,717** | — | — | 「~7k」 | **一致**（概数として） |
| `packages/worker`（全体） | **1,556** | 1,518 | 15 | 「プール実装」 | §4 で内訳 |
| `packages/presentation/input` | **681** | 1,261 | 6 | 「681 LOC」 | **完全一致** |
| **mc-render への移植量（概算）** | **約 8,500** | 約 12,600 | | | §1.1 |

### 1.1 plan.md の「681 LOC」は正確

plan.md §3.9 の `packages/presentation/input` = 681 LOC は**実測と完全に一致する**。
内訳:

| ファイル | LOC |
| --- | ---: |
| `input-service.ts` | 337 |
| `gamepad-input-state.ts` | 152 |
| `input-service-test-utils.ts` | 75 |
| `virtual-input-state.ts` | 64 |
| `screenshot-service.ts` | 50 |
| `index.ts` | 3 |
| **合計** | **681** |

（`input-service-test-utils.ts` が含まれている。`.test.ts` ではないので production 計数に入る。）

### 1.2 「meshing 以外 ~7k」の切り分け

`mesh|greedy` にマッチするファイルを meshing とみなすと:

| 区分 | production LOC |
| --- | ---: |
| `packages/rendering` 全体 | 9,812 |
| うち meshing 関連 | **3,095** |
| **meshing 以外（mc-render 取り分）** | **6,717** |

plan.md の「~7k」は 6,717 の丸めとして妥当。

**ただし meshing 3,095 のすべてが mc-meshing 行きではない。**
plan.md §3.3（mc-meshing）の移植元は
「greedy-meshing.ts + chunk-mesh-geometry + meshing-worker-config.ts（計 3,994 LOC）」であり、
`packages/rendering/infrastructure/meshing/`（ディレクトリ計 2,993 LOC）とは一致しない。
このディレクトリには **mc-render に残るべきもの**が混ざっている:

| ファイル | LOC | 行き先 | 理由 |
| --- | ---: | --- | --- |
| `chunk-mesh-materials.ts` | — | **mc-render** | THREE マテリアル。`forceSinglePass`（:164）はここ |
| `greedy-meshing-passes.ts` | 186 | mc-meshing | 純粋なメッシング |
| `block-mesh.ts` | 91 | 要判断 | |

**切り分けは移植時に確定させ、本文書に追記すること。** 純粋関数（チャンク → バッファ）が
mc-meshing、THREE オブジェクト（`BufferGeometry` / `Material` / `Mesh`）が mc-render。

## 2. `packages/rendering` の内訳（実測）

| ディレクトリ | production LOC | 行き先 |
| --- | ---: | --- |
| `packages/rendering/` (index など) | 41 | mc-render |
| `application/` | 17 | mc-render |
| `domain/` | 31 | mc-render |
| `infrastructure/camera/` | 63 | mc-render（**ミラー専用に作り替え**。DN-06） |
| `infrastructure/entity/` | **2,080** | mc-render |
| `infrastructure/meshing/` | **2,993** | 分割（§1.2） |
| `infrastructure/particles/` | 414 | mc-render（`forceSinglePass` は :60） |
| `infrastructure/perf/` | 345 | mc-render |
| `infrastructure/player/` | 384 | mc-render |
| `infrastructure/post-processing/` | 587 | mc-render（`water-material.ts:137` / `god-rays-pass.ts` / `composite-pass.ts`） |
| `infrastructure/raycasting/` | 89 | **要判断**（§2.1） |
| `infrastructure/renderer/` | **1,429** | mc-render。`WorldRenderer` 本体 |
| `infrastructure/scene/` | 16 | mc-render |
| `infrastructure/textures/` | 555 | mc-render（アセット同梱。plan.md §5.3） |
| `infrastructure/viewmodel/` | 119 | mc-render |
| `presentation/` | 353 | mc-render（`perf-hud-counters.ts` 等） |
| `test/` 配下のヘルパ | 296 | 移植先のテストへ |

### 2.1 `raycasting/` 89 LOC の扱い

plan.md §3.4 は「ブロック狙撃はレイキャストではなく voxel-DDA
（参照実装で 2.3ms→0.09ms、25倍）」として **mc-physics** に置いている。
この数値には出典がある —— 参照実装のコミット `101074e3` の
`frame:interaction 2.3ms -> 0.09ms`（"Performance (all browser-measured)"）。
計装済みステージに対するブラウザ実測で、ベンチマークスクリプトは無いため再実行はできない
（mc-physics の `docs/design-notes.md` P-7）。

`packages/rendering/infrastructure/raycasting/raycasting-service.ts` は THREE の `Raycaster` を使い、
`scratchNormal`（:25, :60-70）で法線から対象ブロック座標を求めている。
これは**遅いほう**の実装であり、ブロック狙撃としては mc-physics の voxel-DDA に置き換わる。

mc-render に残るのは、THREE シーングラフ上のオブジェクトを拾う用途（マウスピッキング、
デバッグ用の当たり判定）だけのはずである。**移植時に切り分けること。**

## 3. `packages/app` から mc-render へ来るもの

参照実装では描画設定が**合成層に置かれていた**。plan.md §3.15 が「ここにゲームルールを書いたら負け」と
書いているのと同じ問題の描画版であり、新実装ではここに引き取る。

| 移植元 | 内容 | 対応する設計注意 |
| --- | --- | --- |
| `packages/app/application/main/session-post-processing.ts` | **コンポーザ構築の全体**（:33-154）。パス順序の唯一の証跡 | DN-01 / DN-07 |
| `packages/app/application/main.config.ts:30-32` ほか | `GTAO_BLEND_INTENSITY = 0.8`、`BLOOM_*`、`BOKEH_*` | DN-01 |
| `packages/app/application/frame/stages/post-processing-stage.ts` | パスのリサイズ / サンプル数更新（:129-131） | DN-01 |
| `packages/app/application/frame/stages/post-processing-layout.ts` | 各パスの解像度決定（:76-79） | DN-01 |
| `packages/app/application/frame/stages/render-stage.ts` | 描画実行 + **攻撃スイングの生カメラ変形**（:41-48, :98-100） | **DN-06。この変形は `ViewOffset` に作り替える** |
| `packages/app/application/main/browser-runtime-resize-*.ts` | リサイズ時の各パスサイズ再計算 | DN-01 |
| `packages/app/application/frame/stages/camera-stage.ts:63-67` | `camera.rotation.set(pitch, yaw, 0, 'YXZ')` | **DN-06。ミラーの実体になる** |
| `packages/app/application/frame/stages/input-stage.ts:33` + `input-stage-menu.ts:6` | Escape の単一ハンドラ | **DN-05。mc-compose 行き**（フレーム側の責務） |

**`render-stage.ts` の 13 箇所のカメラ読み戻し（DN-06）は移植しない。構造ごと廃止する。**

## 4. `packages/worker` の内訳（実測）

plan.md §3.9 は「`packages/worker` のプール実装」とだけ書く。Port は使う側が持つ（§3.7）。

| ファイル | LOC | 行き先 |
| --- | ---: | --- |
| `application/terrain-worker-pool-port.ts` | 48 | **Port → mc-worldgen** |
| `application/meshing-worker-pool-port.ts` | 36 | **Port → mc-meshing または mc-render**（要判断） |
| `domain/terrain-worker-protocol.ts` | 66 | Port 側と同居 |
| `domain/meshing-worker-pool-types.ts` | 26 | 同上 |
| `infrastructure/terrain-worker-pool.ts` | 272 | **実装 → mc-render** |
| `infrastructure/terrain-worker-pool-helpers.ts` | 128 | 実装 → mc-render |
| `infrastructure/terrain-worker.ts` | 120 | 実装 → mc-render |
| `infrastructure/terrain-worker-pool-port-layer.ts` | 16 | 実装 → mc-render |
| `infrastructure/meshing/meshing-worker-pool.ts` | 307 | 実装 → mc-render |
| `infrastructure/meshing/meshing-worker.ts` | 196 | 実装 → mc-render |
| `infrastructure/meshing/meshing-worker-pool-protocol.ts` | 153 | 実装 → mc-render |
| `infrastructure/meshing/meshing-worker-sync.ts` | 117 | 実装 → mc-render |
| `infrastructure/meshing/meshing-worker-pool-port-layer.ts` | 22 | 実装 → mc-render |
| `infrastructure/meshing/meshing-worker-config.ts` | 42 | **plan.md §3.3 は mc-meshing 行きとしている**（§4.1） |
| `index.ts` | 7 | — |
| **合計** | **1,556** | |

概算: Port + protocol 176 LOC が使う側へ、実装 1,373 LOC が mc-render へ。

### 4.1 `meshing-worker-config.ts` の行き先が plan.md 内で矛盾

plan.md §3.3（mc-meshing の移植元）は
「greedy-meshing.ts + chunk-mesh-geometry + **meshing-worker-config.ts**（計 3,994 LOC）」と書く。
plan.md §3.9 は「`packages/worker` のプール実装」と書く。
このファイルはどちらにも該当しうる。**実装時に決めて両リポジトリの porting.md に記録すること。**

## 5. `three` のバージョン

参照実装 `package.json`:

```
"three": "^0.170.0"
"@types/three": "^0.170.0"
```

**まだ `dependencies` に入れていない**（[versioning.md](./versioning.md) §5）。
現在のソースは THREE.js を 1 行も import していないので、依存を宣言すると
「使っていないものへの依存」になる。最初の THREE.js アダプタと同じコミットで追加する。

参照実装は `three/addons/postprocessing/*` を直接使っている
（`EffectComposer` / `RenderPass` / `GTAOPass` / `UnrealBloomPass` / `BokehPass` / `SMAAPass` /
`OutputPass`。`session-post-processing.ts:3-9`）。別の postprocessing ライブラリは使っていない。
`GodRaysPass` と `CompositePass` は**自作**で、`packages/rendering/infrastructure/post-processing/`
にある（`god-rays-pass.ts` / `composite-pass.ts`、ディレクトリ計 587 LOC）。

`0.170.0` を採るかは移植時に再確認すること。THREE は minor でも破壊的変更を入れる。

## 6. テスト資産の移植

| 移植元テスト | LOC | 優先度 |
| --- | ---: | --- |
| `packages/rendering` の `*.test.ts` | 9,875 | 高 |
| `packages/presentation/input` の `*.test.ts` | 1,261 | **最高**（入力は回帰が痛い） |
| `packages/worker` の `*.test.ts` | 1,518 | 中 |

入力のテスト比が異常に高い（production 681 に対し test 1,261、**1.85 倍**）。
入力は「押しっぱなしになる」「モーダルと二重に反応する」といった、
コードを読んでも見つからない種類のバグの巣であり、テストがそれを反映している。
**この比率は移植先でも維持すること。**

## 7. 移植しないもの

| 参照実装の要素 | 理由 |
| --- | --- |
| カメラ読み戻し 13 箇所 | 構造ごと廃止（DN-06） |
| `render-stage.ts:41-48` の生カメラ変形 | `ViewOffset` として合成時に適用する形に作り替え（DN-06） |
| `session-post-processing.ts` が `packages/app` にあること | 描画設定は mc-render が持つ |
| 無効パスを構築して `enabled = false` にする扱い | 構築しない（DN-07） |
| `Effect.Service` によるサービス定義 | `Context.Tag` + 明示 Layer（[public-api.md](./public-api.md) §0） |
| `window` / `document` への直接 `addEventListener` | 注入された `InputEvent` に置き換え。`window` アダプタは別 Layer（`application/browser-input-adapter.ts`。DOM 型は `lib` ではなく `application/dom-surface.ts` の構造的な型で受ける——DN-15） |
| `raycasting-service.ts` のブロック狙撃用途 | mc-physics の voxel-DDA に置き換え（plan.md §3.4。25 倍の出典は参照実装のコミット `101074e3`、§2.1） |
