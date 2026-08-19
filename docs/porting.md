# 移植元と実測 LOC

参照実装 `takeokunn/ts-minecraft`（凍結・仕様書兼テストオラクル）からの移植元一覧。
**LOC はすべて本ドキュメント作成時に `wc -l` で実測した値**であり、plan.md の見積りではない。

計測条件:

```console
# production LOC（基準A。本文書の既定）
$ find <dir> -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' | xargs cat | wc -l
```

`packages/*/test/` 配下のヘルパ（`*-test-utils.ts` 等）は `.test.ts` ではないため
**production 側に計上される**。これは意図的だが、数字を読むときに効いてくるので §1.3 で明示的に扱う。

`packages/rendering` に `dist/` と `node_modules/` は存在するが、**`.ts` ファイルは 1 つも無い**
（`find packages/rendering \( -path '*/dist/*' -o -path '*/node_modules/*' \) -name '*.ts' | wc -l`
→ `0`）。したがって上のコマンドがそれらを除外していなくても結果は変わらない。
将来 `.d.ts` が生成されるようになったら `-not -path '*/dist/*'` が必要になる。

**本文書の数値はすべて、隣に印字したコマンドで再現できる。** 再現できない数値を置かないこと。

## 1. サマリ

plan.md §3.9 の移植元:

> `packages/rendering`（meshing以外、~7k）+ `packages/worker` のプール実装 +
> `packages/presentation/input`（681 LOC）

数値はすべて**基準A**（`test/` 配下のヘルパを production に含む。§1.3 に基準B との対照）。

| 移植元 | production | test | ファイル数(prod) | plan.md | 判定 |
| --- | ---: | ---: | ---: | --- | --- |
| `packages/rendering`（全体） | **9,812** | 9,875 | 65 | — | — |
| `packages/rendering` の meshing 以外 | **6,717** | — | — | 「~7k」 | **一致**（概数として） |
| `packages/presentation/hud/first-person-held-item.ts` | **190** | — | 1 | — | §3.1。取りこぼし注意 |
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

| 区分 | production LOC | 再現コマンド |
| --- | ---: | --- |
| `packages/rendering` 全体 | 9,812 | §冒頭の基準A コマンド |
| うち meshing 関連 | **3,095** | 下記の内訳を合算 |
| **meshing 以外（mc-render 取り分）** | **6,717** | 9,812 − 3,095 |

plan.md の「~7k」は 6,717 の丸めとして妥当。

**3,095 の内訳（この数字の基準を取り違えないこと）:**

| 構成要素 | LOC | 再現コマンド |
| --- | ---: | --- |
| `infrastructure/meshing/` ディレクトリ | 2,993 | `find packages/rendering/infrastructure/meshing -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' \| xargs cat \| wc -l` |
| `test/greedy-meshing-test-utils.ts` | 102 | `wc -l packages/rendering/test/greedy-meshing-test-utils.ts` |
| **合計** | **3,095** | |

**注意: 3,095 は「ファイル名が `mesh|greedy` にマッチするもの」ではない。**
その基準で数えると **2,807** になる（`find packages/rendering -name '*.ts' -not -name '*.test.ts'
-not -name '*.spec.ts' | grep -E '[^/]*(mesh|greedy)[^/]*\.ts$' | xargs cat | wc -l`）。
2 つの基準は 2 ファイルで食い違う:

| ファイル | LOC | ディレクトリ基準 | ファイル名基準 |
| --- | ---: | --- | --- |
| `infrastructure/meshing/lod-simplification.ts` | 288 | 含む | **含まない**（名前に mesh/greedy が無い） |
| `test/greedy-meshing-test-utils.ts` | 102 | 含まない（`test/` 配下） | **含む** |

2,807 − 102 + 288 = 2,993（ディレクトリ）、2,993 + 102 = 3,095（本文書の基準）。
本文書は**ディレクトリ ∪ meshing 名のテストヘルパ**を採る。
`lod-simplification.ts` は LOD 簡略化であり meshing ディレクトリの住人なので、
ファイル名基準で落とすのは誤り。

**ただし meshing 3,095 のすべてが mc-meshing 行きではない。**
plan.md §3.3（mc-meshing）の移植元は
「greedy-meshing.ts + chunk-mesh-geometry + meshing-worker-config.ts（計 3,994 LOC）」であり、
`packages/rendering/infrastructure/meshing/`（ディレクトリ計 2,993 LOC）とは一致しない。
このディレクトリには **mc-render に残るべきもの**が混ざっている:

| ファイル | LOC | 行き先 | 理由 |
| --- | ---: | --- | --- |
| `chunk-mesh-materials.ts` | 238 | **mc-render** | THREE マテリアル。`forceSinglePass`（:164）はここ |
| `lod-simplification.ts` | 288 | **分割**（決着） | 下記。1 ファイルに関心が 2 つある |
| `greedy-meshing-passes.ts` | 186 | mc-meshing | 純粋なメッシング |
| `block-mesh.ts` | 91 | **mc-render**（決着） | `import * as THREE` + THREE 参照 8 箇所 + `MaterialCacheKey` を持つ `Effect.Service` |

切り分けの原則は**純粋関数（チャンク → バッファ）が mc-meshing、THREE オブジェクト
（`BufferGeometry` / `Material` / `Mesh`）が mc-render**。この 379 LOC はその原則で決着した。

#### `lod-simplification.ts` 288 LOC の分割（決着）

「要判断」だった理由は、**1 ファイルに関心が 2 つ入っていた**ことである。
mc-meshing の `docs/responsibility.md` は「距離の概念が要るので mc-render 寄りかも」と
書いていたが、実際に距離を取る記号は 1 つしかない。

| 記号 | 距離を取るか | 行き先 |
| --- | :-: | --- |
| `simplifyMesh` (`MeshedChunk → MeshedChunk`) | 取らない | **mc-meshing** |
| `packQuadKey` / `LodLevel` / `LOD_LEVELS` / `LodLevelSchema` | 取らない | **mc-meshing** |
| `lodForDistance` | **取る** | **mc-render** |
| `LOD1_DISTANCE_CHUNKS` = 4 / `LOD2_DISTANCE_CHUNKS` = 8 | 距離そのもの | **mc-render** |

決め手は mc-meshing の `responsibility.md` §3.3「このリポジトリは座標を持たない（意図的）」。
`lodForDistance` の引数は参照実装自身の doc comment が「プレイヤーのチャンクと対象チャンクの
L1 / L∞ ノルム」と書いており、座標の派生物である。全文は **mc-meshing の §3.4** にある
（決定は所有者側に 1 つだけ置き、こちらはそれを指す）。

**この行こそ、名前で責務を推測してはいけない実例である。** §1.3 のファイル名基準
（`mesh|greedy` にマッチ）は `lod-simplification.ts` を取りこぼす —— 288 LOC が
「meshing ではない」と静かに分類され、そのうち約 240 LOC は実際には mc-meshing のものだった。

### 1.3 2 つの計測基準（`test/` ヘルパを含むか）

`packages/rendering` の production LOC には**正当な基準が 2 つあり、296 LOC 食い違う**。
どちらも正しく、どちらを使うかを明示しないと数字が突き合わない。

| 基準 | 全体 | meshing | meshing 以外 | `test/` ヘルパ |
| --- | ---: | ---: | ---: | --- |
| **A（本文書の既定）** | **9,812** | 3,095 | **6,717** | 含む |
| **B（`test/` ディレクトリを除外）** | **9,516** | 2,993 | **6,523** | 除く |

差の 296 は `packages/rendering/test/` 配下の非 `.test.ts` ヘルパであり、
**テストの漏れ込みではなくスコープの違い**である。再現:

```console
# A: 9812
$ find packages/rendering -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' | xargs cat | wc -l
# B: 9516
$ find packages/rendering -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' \
    -not -path 'packages/rendering/test/*' | xargs cat | wc -l
# 差分 296
$ find packages/rendering/test -name '*.ts' -not -name '*.test.ts' -not -name '*.spec.ts' | xargs cat | wc -l
```

9,516 + 296 = 9,812。§2 の内訳表も最下行の「`test/` 配下のヘルパ 296」を含めて 9,812 に合う。

**基準 A を既定とする理由**は §冒頭のとおり、参照実装が `*-test-utils.ts` というファイル名規約を
採っており、これらは移植時に実際に書き直す対象だからである。移植工数の見積りには入れるべきものが入る。
一方、**「出荷されるコードは何行か」を問うときは基準 B** を使う。
plan.md §3.9 の「~7k」はどちらの基準でも丸めとして妥当（6,717 / 6,523）。

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
| `infrastructure/raycasting/` | 89 | **移植しない**（§2.1） |
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

mc-render ではこの 89 LOC を再実装しない。ブロック狙撃は mc-physics の voxel-DDA、
THREE シーングラフ上のオブジェクトを拾うマウスピッキング／デバッグ用当たり判定は
ホストの責務と確定した。現行 mc-render に raycasting source は存在しない。

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

### 3.1 `packages/presentation` から来るもの（`input/` 以外）

参照実装は一部の**描画コード**を HUD パッケージに置いている。新分割ではこれらは
mc-render の責務であり、`packages/presentation/input`（§1.1）だけを見ていると取りこぼす。

| 移植元 | LOC | 内容 | 対応する設計注意 |
| --- | ---: | --- | --- |
| `packages/presentation/hud/first-person-held-item.ts` | 190 | 一人称の手持ちアイテム描画。THREE の `BoxGeometry` / `PlaneGeometry` + `MeshBasicMaterial` を直接構築し、**`forceSinglePass: true`（:131）を立てている 4 番目の箇所** | **DN-02** |

`wc -l packages/presentation/hud/first-person-held-item.ts` → `190`。

この 4 番目の `forceSinglePass` は他の 3 箇所と性質が違う（マテリアルが**共有されていない**）。
詳細は [design-notes.md](./design-notes.md) DN-02 の適用箇所表を見ること。
`packages/presentation/hud/` の残りは mx-ui 行きであり、**このファイルだけが描画側に来る**。
HUD ディレクトリ全体を mx-ui に送ると失われるので、移植時に個別に拾うこと。

## 4. `packages/worker` の内訳（実測）

plan.md §3.9 は「`packages/worker` のプール実装」とだけ書く。Port は使う側が持つ（§3.7）。

| ファイル | LOC | 行き先 |
| --- | ---: | --- |
| `application/terrain-worker-pool-port.ts` | 48 | **Port → mc-worldgen** |
| `application/meshing-worker-pool-port.ts` | 36 | **Port → mc-meshing** |
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
| `infrastructure/meshing/meshing-worker-config.ts` | 42 | **mc-meshing**（§4.1で確定） |
| `index.ts` | 7 | — |
| **合計** | **1,556** | |

概算: Port + protocol 176 LOC が使う側へ、実装 1,373 LOC が mc-render へ。

### 4.1 `meshing-worker-config.ts` の行き先

plan.md §3.3（mc-meshing の移植元）は
「greedy-meshing.ts + chunk-mesh-geometry + **meshing-worker-config.ts**（計 3,994 LOC）」と書く。
plan.md §3.9 は「`packages/worker` のプール実装」と書く。
plan.md §3.9 は「`packages/worker` のプール実装」と書くが、設定値はメッシングの
プロトコルと共有する。したがって `meshing-worker-config.ts` は **mc-meshing** に置き、
mc-render は公開された設定型と Port を利用する。この判断を本書の表にも反映した。

## 5. `three` のバージョンと公開境界

参照実装の `package.json`（旧構成）:

```
"three": "^0.170.0"
"@types/three": "^0.170.0"
```

現行では `three@^0.185.1` を `dependencies`、`@types/three@^0.185.4` を
`devDependencies` に宣言している。`src/index.ts` とコア application/domain は実行時 Three を
import せず、`src/browser.ts` が公開 `./browser` 入口として Three namespace、canvas、
EffectComposer、アトラス texture を接続する。`test/fixtures/three-surface.ts` は構造的な
surface と実際の Three 型との適合を検査し、固定ワールドの GPU/screenshot fixture と
ゲーム固有の PNG 配布はホスト側に残る。

参照実装は `three/addons/postprocessing/*` を直接使っている
（`EffectComposer` / `RenderPass` / `GTAOPass` / `UnrealBloomPass` / `BokehPass` / `SMAAPass` /
`OutputPass`。`session-post-processing.ts:3-9`）。別の postprocessing ライブラリは使っていない。
`GodRaysPass` と `CompositePass` は**自作**で、`packages/rendering/infrastructure/post-processing/`
にある（`god-rays-pass.ts` / `composite-pass.ts`、ディレクトリ計 587 LOC）。

現行は `0.185.1`（型定義 `0.185.4`）。THREE は minor でも破壊的変更を入れるため、
依存更新時に再確認する。Node コア／プレビューは `DOM` 無しの tsconfig を保ち、ブラウザ入口は
専用の package/browser tsconfig で DOM 型を限定的に有効化する。

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
