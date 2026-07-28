# テスト / 検証

## 1. plan.md が要求する検証（§3.9）

> **検証**: fixture描画 + スクリーンショット比較 +
> **内蔵ビューア（固定チャンクを読み込んでマテリアル/ポストFXを目視確認）**

3 本立てである。

| 検証 | 何を保証するか | 状態 |
| --- | --- | --- |
| fixture 描画 | 固定チャンクが描ける | **未実装。ただし塞いでいるものが変わった** —— THREE アダプタは**着地済み**（§12）。残っているのは**描く対象**、すなわちこのリポジトリが所有していないワールドデータと、それを載せるブラウザページ。§2.2 |
| スクリーンショット比較 | 見た目が変わっていない | 未実装。ただし**決定性は実測で片付いた**（§2.5） |
| **内蔵プレビュー** | **人間が操作して確かめられること** | 実装済（[`apps/preview-render/`](../apps/preview-render/README.md)）。ただしターミナル。§2.2 |
| ── うち固定チャンクの目視 | マテリアル / ポストFX の**絵**を見る | **GPU が要る。§2.2 を見ること**。現状もっとも近いのは mc-compose の `pnpm e2e:browser`（空は出るがジオメトリは届かない） |

> **この表は 1 度、実装より古くなったまま放置された。** 行は
> 「未実装（THREE.js アダプタが要る。**まだ無い**）」と書いてあり、
> 同じファイルの §2.2 と §12 は**同じ日付でアダプタの着地を詳述していた** ——
> つまり矛盾は外部の情報ではなく、**このファイルの中で閉じていた**。
> 表を直すときは §2.2 / §12 と突き合わせること。片方だけ直すのが、この状態の作り方である。

GPU を必要としない部分の単体テストは、§3 で述べるとおり**意図的に厚くしてある**。
内蔵プレビューはその厚みの上に立っており、同じ理由で端末に描く。

## 2. 完了条件（plan.md §6 Step 2）

> 各リポジトリの完了条件: ユニット/シナリオテスト green + **内蔵プレビューが操作可能**

プレビューは `apps/preview-<name>/` に置く。モジュール契約には含めない（plan.md §4.1 末尾）。
本リポジトリのそれは [`apps/preview-render/`](../apps/preview-render/README.md) であり、
`pnpm preview` で起動する。`pnpm verify` には入らないが、`pnpm typecheck`
（`tsconfig.preview.json`）と `pnpm lint` と `pnpm check:deps` の対象には入っている。

### 2.1 順序の都合

構築順は `worldgen → sim → render → kit`（plan.md §6 Step 2）。
mc-render のプレビューは kit の**前**に作る必要がある——kit が mc-render に依存するので、
kit を待っていると永遠に始まらない。つまり mc-render のプレビューだけは kit 無しで書く。
これは重複ではなく、kit の設計に対する最初のフィードバックになる。**そうした。**

### 2.2 「固定チャンクの目視」がまだ無い理由と、代わりに何を見せているか

**この節の前提は 2026-07-28 に変わった。THREE シームは着地した。**
以下、変わった部分と変わらなかった部分を分けて書く。

#### 変わったこと

`application/three-surface.ts` と `application/world-renderer.ts` があり、
`render:draw` は `DrawPort` を呼ぶ。`domain/chunk-geometry.ts` は mc-meshing の
quad を interleave した頂点バッファにする。**`tsconfig.base.json` の `lib` は
`["ES2024"]` のまま、`types` は `[]` のままである** —— 予告では `"DOM"` が要ると
書いてあったが、要らなかった（[versioning.md](./versioning.md) §5.1）。
つまり上の段落が守りたかった機構的保証は**そのまま残っている**。

`three` は `devDependencies` にある。出荷ソースは 1 行も import しない。

#### 変わっていないこと ——「固定チャンクの目視」は依然この repo に無い

`apps/preview-render/` はターミナルプレビューのままである。ブラウザプレビューを
足すには vite（もう 1 つの devDependency）と、このリポジトリが所有していない
ワールドデータが要る。**代わりに、目視は mc-compose の `pnpm e2e:browser` にある** ——
そこでは実際に WebGL2 コンテキストが取得され、フレームが回る
（docs/e2e-triage.md #1、2026-07-28 に `fixme` を外した）。
ただし**画面はスカイブルー 1 色である**。mc-worldgen も mc-meshing も
mc-compose の vite alias で解決できる 3 つの兄弟に入っていないので、
ジオメトリがページに到達しない。「コンテキストが無い」と「中身が無い」の区別が
ついた、というのがこの変更の到達点である。

#### 判定方法についての注意は生きている

一度「アダプタは着地済み」として扱われかけたことがある。
`c99ac01` の**コミットメッセージ本文**は THREE シームを詳細に述べていた
（narrow structural surface、mc-meshing の merged quads からのジオメトリ構築、`WorldRenderer`）。
**その diff にシームは入っていなかった** —— 13 ファイルは
`domain/particle-pool.ts` / `texture-atlas.ts` / `water-surface.ts` / `water-refraction.ts` と
対応するテスト、および docs である。件名の「the **three** deferred mesh layers」の
`three` は THREE.js ではなく**数の 3**（この 3 つのメッシュ層）を指す。

したがって判定はコミットメッセージではなく**ツリー**で行うこと。
現在なら `application/three-surface.ts` と `application/world-renderer.ts` が存在し、
`test/three-surface.test.ts` が green であることが一次資料である。
DN-02 §「数値の出所」は**コミットメッセージを見なかったことによる誤判定**を記録しているが、
`c99ac01` は逆向きの失敗である。**どちらの方向にも、一次資料はツリーとテストであってメッセージではない。**

そこで `apps/preview-render/` は、**実際にデータとしてモデル化されているもの**を出す。
6 つのビューがある —— `input` / `postfx` / `material` / `mirror` / `scratch` / `stages`。

**主役は入力状態機械である。** plan.md §3.10 は Playwright が SwiftShader 上で動き
**ポインタロックを一切扱えない**と記録しており、`application/input-service.ts:209-214` は
そこから「サービス内の `requestPointerLock()` は何にもテストできない挙動になる」と結論している。
帰結はもっと鋭い: ロック状態は 4 値の機械で、その遷移が**すべてのボタン押下について
ゲーム操作か UI クリックかを決める**。ブラウザテストはこれを駆動できず、
`test/input.test.ts` は 1 つの fiber の中で、テスト作者が思いついた順序で駆動する。

ステップ可能なプレビューは、**イベント順序がつまみになる唯一の場所**である。
だから `readSnapshot` と `endFrame` もイベントと同格のステップになっている。
下の RND-1 / RND-2 はどちらも、テストがたまたま逆順で発行している 2 つのイベントを
入れ替えただけで出てくる。

`--stats` はかつて **8 件の発見**を出していた。**6 件は修正済み、2 件は「直さない」と決めて
テストで固定した。** どちらの場合も `test/` にテストがあり、そこでしか主張は CI で落ちない
—— `--stats` の行はピンではない。

| # | 内容 | 状態 | 固定しているテスト |
| --- | --- | --- | --- |
| RND-1 | `requested` は吸収状態。`blur` が保存し `requestPointerLock` は再送しない | **修正** | `test/input.test.ts` `REGRESSION: a blur ABANDONS a pending request rather than stranding the session` |
| RND-2 | `endFrame` がどのフレームにも報告していないホイール段を消費する | **修正** | `REGRESSION: endFrame consumes what the FRAME was told, not what arrived after it` ほか 4 件 |
| RND-3 | `blur` が `pointerLocked` を残すので、復帰クリックが `attack` になる | **修正** | `REGRESSION: blur ends the LOCKED SESSION, so the click that refocuses is not an attack` |
| RND-4 | ミラーの初期状態が自己矛盾（`UNSET` のポーズに `mirrorLagSecs = 0`） | **保留（ピン）** | `test/stage-registration.test.ts` `KNOWN GAP: before a pose arrives, the two staleness answers DISAGREE` |
| RND-5 | `MIRROR_LAG_WARNING_SECS` の doc が「Milliseconds」と書いている | **修正** | `test/camera-mirror.test.ts`（秒として比較していることは既に固定済み） |
| RND-6 | `RenderRegistrationLayer` が `renderModule` の引数を捨てる | **修正（削除）** | `test/stage-registration.test.ts` `registers its stages against the InputService it itself provides` |
| RND-7 | `withScratch` が捕まえるのは同一性エスケープだけ | **保留（ピン）** | `test/frame-scratch.test.ts` `KNOWN GAP: withScratch catches only the identity escape`（6 件） |
| RND-8 | `buildPostProcessingChain` が `high` と `ultra` に同一の配列を返す | **修正** | `test/post-processing.test.ts` `REGRESSION: \`high\` and \`ultra\` are DIFFERENT chains, and the composite step is why` |

保留 2 件の理由:

- **RND-4**: ゲージに入れる正直な値が無い。`makeRenderFrameState` は時計を持たない
  （ステージではなくコンストラクタで、plan.md §5.1-3 がグローバル時計の読み取りを禁じている）し、
  `Infinity` を入れても矛盾が `mirroredCamera.sourceCapturedAtSecs` に移るだけである
  —— 消費側が実際に読むのはそちらだ。両者を一致させるには
  `MirroredCameraState` 自身で「未設定」と「陳腐化」を区別する必要があり、
  それは mc-sim を pin して `authoritativePose` が `PlayerService.cameraPose` になるときの仕事である。
  そのとき窓は構造的に閉じる。いまの窓は「最初のフレームより前」だけで、
  リポジトリ内の読み手は診断ゲージ 1 つだけ。
- **RND-7**: 検出するには生の `Map` を渡すのをやめるしかない（lease 付き facade、または
  `buffer` の非公開化）。どちらも公開型を変え、facade はこのモジュールが
  無アロケーションに保つためのホットパスに分岐とラッパーを載せる —— それは
  plan.md §5.2 が**名指しで**認めている逸脱であり、局所的に決めてよい話ではない。
  出荷されている呼び出し口（`render:chunk-sync`）は同期で、だから誰も踏んでいない。

全件の詳細は [`apps/preview-render/README.md`](../apps/preview-render/README.md)。

### 2.3 fixture の入手元（THREE アダプタ着手時）

参照実装の fixture を資産として移植する（plan.md §6 Step 2）。
チャンク fixture は `packages/rendering/test/` および mc-meshing 側のゴールデンテスト用と共通化できる。
そのときの目視テストは mc-playground-kit を要する。**現在のプレビューはその代わりではない。**
GPU 無しで確かめられる半分であり、入力状態機械にいたっては他に置き場所が無い。

### 2.4 プレビューの依存

`apps/preview-render/` は**このリポジトリ自身のモジュールと `effect` しか import しない**。
org パッケージも新規 npm 依存も THREE も無い。
`scripts/check-dependency-whitelist.ts` の `SCAN_ROOTS` に `'apps'` が入っており、
`isToolingOrTestPath` が `apps/` を tooling 扱いする
（`index.ts` / `domain/` / `application/` / `stages/` 以外はすべて tooling）。
`Date.now()` 禁止も `apps/` に効く —— ミラーの陳腐化は注入した
`MonotonicTimeSecs` を操作者が動かして測るので抵触しない。

### 2.5 スクリーンショット比較の決定性 —— **実測して片付けた**

アダプタが無くても、**比較側の未知**は先に潰せる。潰した。以下はすべて実測値である
（Apple M4 Max / macOS、Playwright 1.59.1、640x480、`deviceScaleFactor: 1`、
参照実装 `playwright.config.ts` と同じ launch フラグ、THREE 0.170.0 の
`MeshLambertMaterial` + 平行光 + 環境光、16x16 チャンクを greedy merge した
169 quad / 1690 三角形、カメラ固定）。

#### 測定 1: SwiftShader は**ビット単位で決定的**である

| 条件 | 取得枚数 | 相異なる画像 | 差分ピクセル | 最大チャンネル差 |
| --- | --- | --- | --- | --- |
| 逐次起動 | 5 | **1** | **0** | **0** |
| **6 並列**起動（CPU を飢えさせる） | 6 | **1** | **0** | **0** |
| GL フラグ無し（既定） | 1 | 同上 | **0** | **0** |
| Chromium 147 と 148 | 2 | **1** | **0** | **0** |

**計 15 枚が単一の sha256 に落ちる。** MSAA 有効時も 5 枚が別の単一ハッシュに落ちる
（MSAA 無効とは当然違う画になるが、それ自体は 5 回とも同一）。
Chromium のメジャーバージョンをまたいでも 1 バイトも動かない —— つまり
「依存を上げたら基準画像が壊れる」という定番の反論は、**少なくとも 147→148 では起きない**。

#### 測定 2: 非決定なのは**ラスタライザではなくフレームループ**である

同じシーンを rAF ループで回し、壁時計で 600ms 待ってから撮ると:

| 条件 | 取得枚数 | 相異なる画像 | 最悪差分ピクセル | 最大チャンネル差 |
| --- | --- | --- | --- | --- |
| rAF ループ + 固定待ち | 5 | **5** | 3,674（1.196%） | 103 |

**これが §7 の「SwiftShader の非決定性」の正体である。**
参照実装の `retries: 1` のコメントが述べているのは
「並列インスタンスがレンダーループを飢えさせ、**合成キー入力がフレーム境界で落ちる**」であって、
**ピクセルの非決定性ではない**。入力とタイミングの話をラスタライザの話として一般化していた。
§7 を訂正した。

#### 帰結（アダプタ実装者への拘束条件）

- **fixture 描画は「1 フレームを明示的に描いて止まる」入口を持つこと。**
  rAF ループを回して撮ってはいけない。測定 2 のばらつき（最大 103、1.196%）は
  **本物の回帰と同じ桁**であり、これを吸収する許容差は何でも通す。
- **許容差はゼロでよい。** 15 枚が同一ハッシュなのだから、緩める根拠が無い。
  「緩めておけば安全」は、ここでは**テストを消すのと同じ**である。次項がその実測である。

#### なぜ「±1 くらいなら安全」が**間違い**か —— ミューテーション 5 件

基準画像に対し、レンダラで起こりうる 1 トークンの変更を入れて撮り直した:

| ミューテーション | 差分ピクセル | 最大チャンネル差 | 許容差 0 | 許容差 ±1 |
| --- | --- | --- | --- | --- |
| 環境光 0.55 → 0.56（1.8%） | 63,955（20.8%） | **1** | 検出 | **見逃す** |
| 平行光強度 1.1 → 1.101（0.09%） | 10,158（3.3%） | **1** | 検出 | **見逃す** |
| FOV 55 → 55.05（0.09%） | 702（0.23%） | 103 | 検出 | 検出 |
| **merged quad をやめて unit face にする** | 2,450（0.80%） | 103 | 検出 | 検出 |
| 光源 x 12 → 12.01（0.08%） | **0** | **0** | **見逃す** | 見逃す |

**上 2 件が決定的である。** 画面の 3%〜21% を動かす本物の照明回帰が、
最大チャンネル差 **1** として出る —— 8bit 量子化のせいで、
広い面積がそれぞれ 1 段だけずれるからである。
**「±1 は丸め誤差だから安全」という最も控えめな許容差ですら、この 2 件を丸ごと飲み込む。**
許容差は「緩いほど危ない」のではなく、**1 でもう危ない**。

4 件目は c99ac01 のコミットメッセージが「やらかしていたら平地の 99.8% で間違う」と
述べていたまさにそのバグで、**ゼロ許容差なら捕まる**。

5 件目は正直に書いておく: **この比較の検出限界**である。
光源をこの量だけ動かしても、陰影の変化がどのピクセルでも量子化幅を超えない。
スクリーンショット比較はジオメトリと光の**微小な**移動には目が無い。
そこは単体テスト側（`domain/`）の仕事であって、絵で捕るものではない。

#### バックエンドが違うときは、許容差では吸収できない

SwiftShader と Metal（実 GPU、ANGLE Metal Renderer: Apple M4 Max）の同一シーン比較:

| 指標 | 値 |
| --- | --- |
| 差分ピクセル | 125 / 307,200（**0.041%**） |
| 最大チャンネル差 | **103** |
| 差の分布 | 1-2:**0** / 3-8:9 / 9-16:12 / 17-32:30 / 33-64:14 / 65 以上:**60** |
| 差分点の 83% | 輝度エッジに隣接（104/125）。連結成分 120 個・平均サイズ **1.0** |

**チャンネル許容差という道具ではこれを表現できない。**
差は 1-2 のような「わずかな色ズレ」ではなく、**孤立 1 ピクセルが全く別の色になる**形で出る
（シルエット上のラスタライズのタイブレーク）。吸収するには許容差 103 以上が要り、
それは 0-255 の 40% —— 草の緑が土の茶になっても通る値である。**それはテストではない。**

正しい構造は許容差ではなく**環境の固定**である:

- `WEBGL_debug_renderer_info` の `UNMASKED_RENDERER_WEBGL` に `SwiftShader` が
  含まれることを**アサートする**。
- 含まれなければ **skip する**（fail でも、黙って pass でもない）。
  実 GPU で撮った画像を基準画像と比べる意味は無く、その事実を許容差に押し込むと
  **回帰検出能力そのものが消える**。
- これは `check:mirrors` / `check:repoint` と同じ「自分の環境要件を自分で述べるゲート」である。

再現手順とスクリプトは本コミットには含めていない（描く対象がまだ無いため）。
アダプタ着地時に上記の数値を**引用せず測り直すこと**（§5.8）。

## 3. GPU を必要としないテストを厚くする方針

**現在のソースには THREE.js が 1 行も無い。** これは設計判断で、根拠は 2 つある。

### 3.1 参照実装で「読むことでしか検査できなかった」知識をデータにする

| 知識 | 参照実装での表現 | 検査方法 | 新実装での表現 | 検査方法 |
| --- | --- | --- | --- | --- |
| ポストFXのパス順序 | `addPass` の文の並び | 目視 | `POST_PROCESSING_PASS_ORDER` 配列 | 単体テスト |
| `forceSinglePass` の要否 | 3 箇所のコメント | 目視 | `requiresForceSinglePass` 述語 | 単体テスト |
| イベント登録先の遮蔽関係 | `addEventListener` 2 行 + コメント | 目視 | `modalConsumedKeyReachesGameplay` | 単体テスト |
| フレーム毎バッファの寿命 | コメント | 目視 | `withScratch` の実行時検査 | 単体テスト |
| ホイールの単位（`deltaMode`） | どこにも無い（生の `deltaY` を加算） | 検査不能 | `notchesForWheelDelta` + 定数 3 つ | 単体テスト |
| ポインタロック要求の失敗 | `console.warn` と boolean | コンソールを見る | `PointerLockState` の 4 状態 | 単体テスト |

ポストFXの順序バグは、参照実装では
「ultra プリセットの誰かのマシンで god rays が光らなくなった」という形でしか観測できない。
データにすると単体テストの失敗になる。

### 3.2 ブラウザでしか試せないものは、ブラウザでも試せない

plan.md §3.10 が記録している E2E 環境の制約:

> Playwright は SwiftShader、ヘッドレスではポインタロック不可

参照実装の `playwright.config.ts` がそれを裏づけている:

```
process.env['PLAYWRIGHT_USE_SWIFTSHADER'] = '1'
launchOptions.args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl',
                     '--enable-webgl2', '--ignore-gpu-blocklist',
                     '--enable-unsafe-swiftshader', '--no-sandbox', ...]
```

つまり **E2E でポインタロックの挙動は検証できない。**
DN-09（ロック解除時にデルタを捨てる）のような知見は、
**ポート越しの単体テストで押さえるしかない**。だから入力サービスは
DOM を import せず `InputEvent` を注入で受ける。

**ロックの「要求」側（DN-14）はこの論法が最も強く効く箇所である。**
`canvas.requestPointerLock()` をサービスから直接呼べば、その挙動は
E2E でも（ポインタロックが使えないので）単体でも（DOM が無いので）検査できない——
**この世のどのテストからも押さえられなくなる。** だから要求は `PointerLockPort` から出す。
拒否（`pointerlockerror`）も同じ理由でイベントとして注入する。
ホイールの単位正規化（DN-13）がアダプタではなくドメインにあるのも同じ論法である。

## 4. 現在のテスト

`vitest run`。**19 ファイル / 555 テスト**（2026-07-28 実測）。すべて `environment: 'node'`。

| ファイル | テスト数 | 対応 |
| --- | ---: | --- |
| `test/post-processing.test.ts` | 22 | DN-01 / DN-07 |
| `test/input.test.ts` | 128 | DN-04 / DN-05 / DN-08 / DN-09 / DN-12 / DN-13 / DN-14 |
| `test/browser-input-adapter.test.ts` | 77 | `window` アダプタ。DN-04（登録と解除）/ DN-12 / DN-13 / DN-14 / DN-15 |
| `test/touch-controls.test.ts` | 23 | タッチ入力（DN-16 周辺） |
| `test/movement-keys.test.ts` | 10 | 移動キーの語彙 |
| `test/camera-mirror.test.ts` | 14 | DN-06 |
| `test/frame-scratch.test.ts` | 18 | DN-03 |
| `test/material-policy.test.ts` | 10 | DN-02 |
| **`test/particle-pool.test.ts`** | **36** | **DN-17**（容量・drop-oldest・シード付き乱数） |
| **`test/water-surface.test.ts`** | **31** | **DN-18**（水マテリアルと `forceSinglePass` の穴）/ DN-02 |
| **`test/water-refraction.test.ts`** | **29** | **DN-18**（屈折プリパスのゲート 6 つとその順序） |
| **`test/texture-atlas.test.ts`** | **15** | **DN-19**（アトラスのレイアウト算術とハーフテクセル） |
| **`test/world-renderer.test.ts`** | **20** | THREE シーム。呼び出しプロトコルのみ（§12.3） |
| **`test/chunk-geometry.test.ts`** | **21** | merged extent と per-face AO（§12.2） |
| **`test/three-surface.test.ts`** | **4** | 本物の `three` に対する構造的代入可能性の証明（§12.1） |
| `test/stage-registration.test.ts` | 29 | `stages/` のフレーム位置と順序制約（public-api.md §6-2）+ クリック→ロック要求（DN-14）+ `render:draw` の `DrawPort` 呼び出し |
| `test/kernel-mirror.test.ts` | 12 | `domain/kernel-vocabulary.ts` が mc-kernel と同形であること（§4.1） |
| `test/check-dependency-whitelist.test.ts` | 30 | DN-11 + 依存ホワイトリスト本体 |
| `test/api-lock.test.ts` | 26 | APIロック生成器 `scripts/api-lock.ts` の機構（§8 / public-api.md §8） |

### 4.2 パーティクル / 水面で**押さえられなかった**もの

§3.2 の論法と同じで、正直に書いておく。以下は
「**本物のスクリーンショットが要るので、ここでは検査できない**」であって、
弱い assertion を置いて覆っているつもりになってはならない。

| 主張 | なぜ検査不能か |
| --- | --- |
| パーティクルが**それらしく見える**か（0.1m のクォッドの大きさ、フェード曲線、壊したブロックのタイルが本当に出ているか） | GPU が要る。§1 の fixture / スクリーンショット行 |
| **容量 512 で足りる**か（速いツルハシで枯渇しないか） | 同上。参照実装も測定を残していない（`domain/particle-pool.ts` は「転記であって正当化ではない」と明記） |
| 水の**色が水に見える**か。パレット・空のグラデーション・`WATER_SURFACE_ALPHA = 0.86` | 参照実装の根拠が「湖が水平線のヘイズに溶けないこと」という**画についての判断**であり、画を見ないと決まらない |
| 屈折の閾値 0.005 / 0.05 と、high の間隔 2 が**振り向きで遅れて見えないか** | 実 GPU で閾値サイズの水を見るしかない |

検査**できた**ほうは、逆に全部データにしてある ——
リップルが有界であること、フレネルが単調であること、
正弦近似の誤差が 0.056 を超えないこと（**参照実装の数値を引用せず、この場で測っている**）、
屈折ゲート 6 つの順序が答えを変えないこと（720 通り全数）。

### 4.1 `test/kernel-mirror.test.ts` が守っているもの

`domain/kernel-vocabulary.ts` は「削除して import を publish 済みパッケージに向け直せば型検査が通る」と
約束している。**その約束は何にも強制されておらず、ロスターの他所では既に破られていた。**

- mc-sim の同じミラーは `ClockService` を 1 フィールドで持っていた（kernel は 2 フィールド）
- mc-physics は `DeltaTimeSecs` をフレームループのクランプ `[0.001, 0.05]` に refine していた
  （kernel は「有限かつ非負」）

**どちらも `tsc` には見えない。** ブランドは**文字列**でキーされるので
（`Brand.Brand<'DeltaTimeSecs'>`）、検証の中身がどれだけ違ってもミラーと kernel の原本は同じ型である。
`Context.Tag` も文字列でキーされるので、Port の 2 つのミラーは実行時には同じサービスである。
どちらも型検査器が構造的に捕まえられない失敗であり、だからテストで assert している。

mc-render のミラーは Port を持たないので、ここで固定するのは**ブランドの述語**と
`CameraPoseSnapshot` の形である。同種のテストが mc-sim と mc-playground-kit にもあり、
あちらは Tag キーと `ClockService` の形も固定している。

## 5. テストの書き方（本リポジトリの規約）

### 5.1 `@effect/vitest` の `it.effect`

```typescript
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

it.effect('name', () => Effect.sync(() => { expect(...).toBe(...) }))
it.effect('name', () => Effect.gen(function* () { ... }))
```

純粋な assertion だけの場合も `Effect.sync` で包む（実行モデルを 1 つに保つため）。
`it.effect` は TestClock を提供する。

### 5.2 `environment: 'node'` 固定 — **ブラウザや WebGL を要するテストを書かない**

`vitest.config.ts` は `environment: 'node'`。jsdom も入れていない。

これは制約に見えて、**設計を守る仕掛け**である。
DOM を要するテストを書きたくなったら、それは DOM を domain/application に持ち込もうと
している合図である。ブラウザ依存は THREE.js / `window` アダプタに閉じ込める。

**`window` 入力アダプタはこの規約の中に収まった**（§8.1）。
`jsdom` も Playwright も要らない——アダプタが触る DOM メンバは 8 個しかなく
（`application/dom-surface.ts`）、偽装は 40 行で済む。
`lib.DOM` を入れずに済ませたことがそのまま「偽装できる大きさ」を保証している（DN-15）。

THREE.js アダプタは違う。あちらの検証は §1 の 3 本立て
（fixture / スクリーンショット / 内蔵ビューア）で行う。

### 5.3 全数テストできるものは全数テストする

`test/post-processing.test.ts` の
`every one of the 64 on/off combinations produces a canonical chain` は
6 個の boolean を全数展開している。サンプリングではない。

理由: 1 つの組合せでだけ壊れる順序バグは、まさに開発者より先にプレイヤーに届く種類のバグである。
64 通りなら全部試せる。試せるなら試す。

### 5.4 定数は算術ではなくリテラルで assert する

`expect(MIRROR_LAG_WARNING_SECS).toBe(0.1)` と書く。
参照実装で確定した値（`forceSinglePass` 方針、`'YXZ'`、`'Escape'`、`'window'`）は
すべてリテラルで固定する。

`forceSinglePass` の根拠となる `p95 33ms → 9.2ms` は実測値である
（参照実装のコミット `d51c5ba7`、"Measured before/after (idle, settled world)"）。
ただし**元の測定は `p95 25-33ms → 9.2ms` という範囲**であり、
33 は plan.md §3.9 が範囲の悪いほうの端だけを取った表記である
（[design-notes.md](./design-notes.md) DN-02）。
そして本リポジトリでは**再測定できない**（ベンチマークも計測出力もコミットされていない）ので、
**数値そのものを閾値として assert してはならない。**
テストが固定してよいのは「診断メッセージにこの文字列が入っていること」だけである（§5.6）。

### 5.5 「逆にしたら壊れる」ことも assert する

`swapping the two targets breaks the shielding — which is why they are constants`
のようなテストを置く。正しい側だけを assert すると、
「そもそもこの関数は常に false を返すだけでは？」を排除できない。

### 5.6 診断メッセージの内容も assert する

`the diagnostic names the measurement, not just the rule` は、
`describeMaterialPolicy` のメッセージに `33ms -> 9.2ms` が含まれることを assert する。

これに当たった開発者は「これは実測されたスタッターであってスタイルの好みではない」と
知る必要がある。知らないと、次の人が「整理」して消す。
（実測の正確な範囲と出典コミットは [design-notes.md](./design-notes.md) DN-02。
assert しているのは文字列の存在であって、数値の再現ではない。）

### 5.7 規則が自分の書いた基準より狭いときは、**両方**を固定する

`test/water-surface.test.ts` に `KNOWN GAP:` で始まるテストがある。
`domain/material-policy.ts` の述語が水マテリアルを `review-sharing` と判定すること
——**参照実装がフラグを立てている**マテリアルについて —— を assert している。

正しい答えのほうだけを assert するのが自然に見えるが、それをやると
**食い違いが消える**。共有述語を誰かが広げた日に、
このテストが落ちて [responsibility.md §2.1](./responsibility.md) に導かれるのが望ましい挙動であり、
「合成した側だけ緑」だとその日は静かに過ぎる。

規則は書き換えていない。データも偽っていない（水面の `alphaTest` は本当に 0 である）。
欠けた条項を値として置き、合成した。**3 つとも別々のテストで固定してある。**

### 5.8 参照実装が書いた数値は、測れるなら**引用せず測る**

`WAVE_APPROX_MAX_ERROR` の 0.056 は、参照実装のコメントから写したのではなく
`test/water-surface.test.ts` が定義域を掃いて測っている。

それをやったので、参照実装の `~0.056` が
**貼られている関数の性質ではない**ことが分かった（DN-18）。写していたら分からなかった。

同じ扱いをした値: フレネル F0 = 0.02 は屈折率 1.333 からの導出と一致することを確認している。
逆に、**測れないものは測れないと書く** —— §4.2。

## 6. カバレッジ

**閾値は現在設定していない。意図的である。**

参照実装は branches / functions / lines / statements の 99% を強制している。
スケルトンに 99% を課しても意味がない。

- 計測とレポートは常に動く（`pnpm test:coverage`、CI でもアーティファクト化）。
- **99% ゲートは完了条件（§2）到達時に `vitest.config.ts` と CI の両方で有効化する。**
  `vitest.config.ts` の `coverage.thresholds` にコメントアウトした形で置いてある。

THREE.js アダプタが入ると、カバレッジの意味が変わる点に注意。
GPU を要するコードは Node のカバレッジ計測から漏れる。
**99% ゲートを入れる時点で「何を分母にするか」を決め直す必要がある。**
おそらく `domain/` + `application/` に限定し、アダプタは fixture 描画とスクリーンショット比較で
担保することになる。

## 7. CI

`.github/workflows/ci.yaml`。`pnpm verify` と同じ内容 + カバレッジ。

```
typecheck (build + test の 2 プロジェクト)
  → lint (oxlint)
  → check:deps (依存ホワイトリスト + 循環 + Date.now() 禁止)  ← ハードゲート
  → api:check (api-lock.md が公開 API と一致するか)          ← ハードゲート
  → test
  → coverage (閾値なし、アーティファクト化)
```

`API lock` を `verify` 経由だけでなく独立ステップにしてあるのは、ステップ名を見ただけで
落ちた理由が分かるようにするため（[public-api.md](./public-api.md) §8）。

スクリーンショット比較を入れる際の注意。**以前ここには「SwiftShader の非決定性に注意」と
書いてあったが、それは誤りだった**（§2.5 で実測）。根拠として引いていたのは
参照実装 `playwright.config.ts` の `retries: 1` のコメントである:

```
// One retry everywhere: with 2 local workers, parallel game instances can
// starve the render loop and drop synthetic key presses across frame
// boundaries — a retry absorbs that without masking deterministic failures.
```

**このコメントが述べているのは「合成キー入力がフレーム境界で落ちる」ことであって、
ピクセルが揺れることではない。** 入力とタイミングの問題を、
ラスタライザの問題として一般化していた。実測では SwiftShader の出力は
逐次・6 並列・Chromium 147/148 をまたいで **15 枚が同一 sha256**、差分 0 ピクセルである。

正しい注意は 2 つに分かれる:

- **フレームループを撮るな。** rAF を回して壁時計で待って撮ると 5 枚が 5 種類になり、
  最悪 1.196% のピクセル・最大チャンネル差 103 が出る。1 フレームを明示的に描いて止める。
- **バックエンドを固定しろ。** SwiftShader と実 GPU の差は許容差では吸収できない
  （§2.5）。`UNMASKED_RENDERER_WEBGL` を見て、SwiftShader でなければ skip する。

`retries` はスクリーンショット比較には**入れないこと**。上の 2 つを守れば決定的であり、
決定的なテストに retry を付けると、壊れた瞬間を隠す方向にしか働かない。

## 8. これから必要なテスト

[design-notes.md](./design-notes.md) の「（要追加）」印を参照。特に重要な未実装:

**「いつ」の列は 2026-07-28 に監査した。** 「アダプタ実装時」と書かれた 4 行のうち
**2 行は条件が成立している**（シームは着地した）。条件が静かに真になった行を放置するのが、
この表が信用されなくなる経路なので、成否を明示する。

| テスト | 対応 | いつ | 条件は成立したか |
| --- | --- | --- | --- |
| `the THREE adapter adds passes in exactly buildPostProcessingChain order` | DN-01 | `EffectComposer` がシームに入ったとき | **まだ。** シームに `EffectComposer` も `Pass` も無い（[responsibility.md](./responsibility.md) §2.3）。`render:post-fx` が FIRST CUT なのと同じ理由 |
| `every shared material built by the adapter passes auditMaterials` | DN-02 | 起動時アサーションとして | **成立した。** `makeWorldRenderer` は共有 `MeshBasicMaterial` を 1 枚作る。ただし `describeMaterialPolicy` の入力である `MaterialSpec` を組む所がまだ無い |
| `a full frame allocates no new Map` | DN-03 | シーム着地後 | **成立した。** `render:draw` は実体になった。未着手 |
| `no source file in this repository reads camera.position` | DN-06 | 走査テストで | **成立した。ただし優先度は下がった** —— `ThreeSurface` の `ThreeVector3` は `set` しか持たず、`ThreeCamera` は読み出し口を持たない。**読む書き方が型として存在しない**ので、走査テストは型が既に保証しているものの二重化になる。書くなら「シームに getter が生えていないこと」を見るほうが強い |
| `blur clears gamepad and touch state too` | DN-08 | それらの実装時 | **タッチのみ成立。** `test/touch-controls.test.ts`（23 件）がある。ゲームパッドは未実装 |
| ワーカープールの Port 適合 / 死んだワーカーの置き換え | DN-10 | プール実装時 | まだ |
| fixture 描画 + スクリーンショット比較（許容差 0、SwiftShader 限定 skip 付き） | §2.5 | 描く対象が届いたとき | **アダプタ条件は成立、データ条件は未成立。** §1 の表と §2.2 を見ること。塞いでいるのはワールドデータであってアダプタではない |
| 参照実装の入力テスト 1,261 LOC の移植 | — | 残り（[porting.md](./porting.md) §6） | — |

**アダプタを書き始める前に決めておくこと（テストではなく設計制約）。**
§2.5 の測定から出た要求は 1 つだけで、しかし**後から入れると高くつく**:

> レンダラは **1 フレームを明示的に描いて戻る入口**を持つこと。
> rAF ループを内部に抱えたまま「描きっぱなし」にしないこと。

自前の rAF ループを持つレンダラは**テストから決定的に駆動できない**。
ループを埋め込んだ後でフレームステップの入口を後付けするには、
生存期間と順序の前提を全体にわたって解きほぐすことになる。
だからこれは「スクリーンショットテストを書く人の要望」ではなく
**アダプタの仕様に最初から入れる制約**である。
測定 2（rAF + 固定待ちで 5 回とも別画像、最悪 1.196% / 最大チャンネル差 103）がその根拠。

### 8.1 解消済み: `window` 入力アダプタの 5 本

かつてこの表にあった以下は `test/browser-input-adapter.test.ts`（49 テスト）で**実装済み**である。

| テスト | 対応 |
| --- | --- |
| `the window adapter registers exactly LISTENER_PLAN` | DN-04 |
| `every listener is removed on finalizer` | DN-04（kit の 2 枚並列でリークする） |
| `the window adapter passes deltaMode through wheelDeltaModeForIndex` | DN-13 |
| `the wheel handler calls preventDefault exactly when shouldSuppressWheelScroll says so` | DN-13 |
| `the browser port calls canvas.requestPointerLock exactly once per ask` | DN-14 |

DOM は**偽物**で駆動している。§5.2 の「ブラウザを要するテストを書かない」に反していない——
アダプタが触る DOM メンバは 8 個しかなく（`application/dom-surface.ts`）、
偽装は 40 行で済む。そしてこれは妥協ではなく §3.2 の論法そのものである:
実ブラウザでもポインタロックは駆動できない（Playwright は SwiftShader）ので、
「本物の DOM で試す」という選択肢は最初から存在しない。

追加で 2 本、**この設計自体**を守るテストがある（DN-15）。

| テスト | 何を守るか |
| --- | --- |
| `a real Window, Document and HTMLCanvasElement satisfy the adapter without a cast` | `test/fixtures/dom-surface.ts` を**本物の `lib.dom.d.ts`** に対してコンパイルし、診断 0 件を assert する。狭い構造的型が実物の部分集合であること |
| `the shipped project still compiles with NO DOM at all` | `tsconfig.build.json` の `lib` / `types` が後から緩められていないこと |

### 8.2 キーボードフォーカス（DN-16）

`test/input.test.ts` に 3 describe、`test/browser-input-adapter.test.ts` に 2 describe。
全表は [design-notes.md](./design-notes.md) DN-16 にある。**この 3 本が要**である。

| テスト | 何を守るか |
| --- | --- |
| `REGRESSION: no focus handler EVER calls preventDefault` | Tab を奪えばキーボードトラップ（WCAG 2.1 SC 2.1.2）。実リスナ越しに、ロック中でも 0 件であることを assert する |
| `REGRESSION: the lock MASKS the focus, it does not forget it` | ロック中に消すと、明けたときリングとブラウザのフォーカスがずれる |
| `endFrame does NOT clear it: focus is a LEVEL, like pressed and unlike justPressed` | フレーム境界の一貫性。エッジ扱いにするとリングがリフレッシュレートで点滅する |

`focusin` / `focusout` も偽 DOM で駆動している。フォーカスは Playwright なら実在するが、
**ロック中の分岐は相変わらず届かない**（§3.2）ので、
「ロック中はリングを出さない」は node 側でしか押さえられない。

**このうち 1 つには意図的にテストが無い**（[design-notes.md](./design-notes.md) DN-16 §5(a)）。
無いのは実装が無いからであり、テストの穴ではない。ここに書いておくのは、
§8.2 の表を「フォーカスまわりは全部押さえてある」と読まれないようにするためである。

| 未実装 | なぜ今テストが無いか |
| --- | --- |
| 矢印キーでグループ**内**を移動する | `focus()` を呼ぶ主体がまだ無い。入れるには `dom-surface.ts` に動詞が 1 つ増え、DN-15 の代入可能性の証明をやり直すことになる。どのキーが移動するか、ロック中はどう振る舞うかは mx-ui と一緒に決める |

**もう 1 つ（HUD の上のクリックがロック要求になる）は閉じた**（DN-16 §5(b)）。
`acquiresPointerLock` は `(button, state, landing)` になり、`landing` は
`resolveClickLanding` がアダプタの境界で `event.target` を `===` 照合して付ける。
テストは 3 つの層に分かれていて、名前が**どちらの半分が壊れたか**を言うようにしてある:

| 層 | 何を押さえるか | 場所 |
| --- | --- | --- |
| 述語 | 3 つの着地 × 4 状態 × 3 ボタン。第 3 の場合（`elsewhere`）を含む | `test/input.test.ts` |
| 境界 | 要素 → 着地の解決。同一性、ロスタ、どちらでもない、宣言なしホスト、優先順位 | `test/browser-input-adapter.test.ts` |
| フレーム | `render:input` が実際に要求する / しない。リングがマスクされない | `test/stage-registration.test.ts` |

**DOM 面は増えていない**ので `a real Window, Document and HTMLCanvasElement satisfy the adapter
without a cast` はそのまま通る。フィクスチャには「ロック対象を `===` でしか触らない」ハンドラを
1 つ足してあり、`contains` に手を伸ばした瞬間にそこが落ちる。

前者はフィクスチャを `ts.createProgram` で**テストの中からコンパイル**する
（`typescript` は既に devDependency で、`test/api-lock.test.ts` と同じ手である）。
フィクスチャは `tsconfig.json` / `tsconfig.test.json` から `test/fixtures/**` として除外してある。
DOM 型を名指しするのが目的のファイルであり、DOM の無いプロジェクトに入れれば落ちるだけで、
出荷プロジェクトに入れれば `"DOM"` が裏口から入ったのと同じになる。

**APIロックの diff はこの表から外れた。** 実装済みで、しかも vitest のテストではない。
「コミット済みの `api-lock.md` が現在の公開面と一致するか」は `pnpm api:check` が見る。
vitest 側の `test/api-lock.test.ts` が見ているのは生成器 `scripts/api-lock.ts` の機構そのもの
（並びのロケール非依存性、可搬性ガード、スナップショットの往復、失敗時の diff）であり、
16 リポジトリに byte-identical で vendor されている。詳細は [public-api.md](./public-api.md) §8。

## 9. 解消済みのギャップ: `pnpm lint` は `stages/` を見る

かつてここには「`package.json` の `lint` スクリプトに `stages` が入っていない」と書かれていた。
**現在の `package.json` は入っている**（`lint` / `lint:fix` の両方）ので、記録だけ残す。

以下は当時の影響範囲の分析であり、`stages/` が他のゲートに掛かっていることの説明として
なお有用なので残してある。

- `pnpm typecheck` は `stages/` を見る。`tsconfig.build.json` / `tsconfig.test.json` の
  `include` に足してあり、加えて `index.ts` が `stages/registration.ts` を re-export しているので、
  `include` が無くても tsc のプログラムには入る。
- `pnpm check:deps` は `stages/` を見る。`scripts/check-dependency-whitelist.ts` の
  `SCAN_ROOTS` に足してあり、`isToolingOrTestPath` は `stages/` を**出荷ソース**として分類する
  （これが「mc-playground-kit を出荷ソースから import してはならない」を stage 登録にも効かせている）。
- `pnpm test` は `stages/` を `test/stage-registration.test.ts` 経由で実行する。

当時必要だった差分は 1 語で、**適用済み**である:

```diff
-"lint": "oxlint --deny-warnings index.ts domain application scripts test",
+"lint": "oxlint --deny-warnings index.ts domain application stages scripts test",
```

`lint:fix` も同様。mx-* の 3 リポジトリも `stages` を含む形で書かれている。

## 12. THREE シームのテスト（2026-07-28）

3 ファイル増えた。それぞれ**何を主張し、何を主張しないか**が違う。

### 12.1 `test/three-surface.test.ts` —— 型の証明であって、実行の証明ではない

`test/fixtures/three-surface.ts` を `lib: ["ES2022", "DOM"]` と**本物の `three`** に
対してコンパイルし、診断 0 件を主張する。`test/browser-input-adapter.test.ts` 末尾の
DOM 証明と同じ機構である（`ts.createProgram` を直接叩く）。

**これが必要な理由は 1 つ**: `application/three-surface.ts` の型が正しいかどうかを、
`pnpm typecheck` は原理的に判定できない。そのプロジェクトには `three` も DOM も無く、
**assignable であるべき「元」が存在しない**。実際、この 3 つはどれも
「素直な書き方」で書いて、このテストに落とされてから直したものである:

| 素直な書き方 | 落ちた理由 |
| --- | --- |
| `ThreeMesh` に `geometry` を持たせる | `Scene.add` が取るのは `Object3D` で、`Object3D` に `geometry` は無い |
| `ThreeMaterial` に `dispose` を持たせる | `Mesh` の第 2 引数は `Material \| Material[]` で、**配列に `dispose` は無い** |
| `ThreeCamera` に `aspect` を持たせる | `WebGLRenderer.render` が取るのは `Camera` で、`aspect` は `PerspectiveCamera` にしか無い |

同じテストが 3 つの周辺事実も固定している: `tsconfig.build.json` が
`lib: ["ES2024"]` / `types: []` のままであること、**出荷ファイルに `three` の import が
1 つも無いこと**（grep。`skipLibCheck` があるので型検査では見えない）、
`three` と `@types/three` のバージョン文字列が一致していること。

### 12.2 `test/chunk-geometry.test.ts` —— merged extent と per-face AO

**この 2 つが load-bearing である。**

`width`/`height` は `tangentAxes(direction)` の順に走るが、**参照実装のスキャン順は
x 面 2 方向でこれと逆である**（`greedy-meshing-algorithms.ts:24, :63` は `u = lz, v = y`）。
参照の頂点式をそのまま写すと、**merged な側面がすべて転置される** ——
面数も巻き順も法線も正しいまま、形だけが動く。だからテストは
「式をもう一度書いて比べる」のではなく、**軸ごとに emit された extent を測る**。
式から書いたテストは、式が間違っていることを検出できない。

AO は quad ごとに 1 値である（mc-meshing `domain/ambient-occlusion.ts`。
per-vertex AO と greedy merge は本質的に両立しない）。テストは
「4 頂点が同じ shade を持つ」と「shade が level に追従する」を**両方**主張する。
片方だけなら定数実装が通る。

巻き順は**外積で計算して**法線と向きが揃うことを見る。転記した表と比べるのでは、
表を写し間違えたときに一緒に間違う。

golden は 1 quad 分を全バイト書き下してある（plan.md §3.3 はハッシュを要求しているが、
ハッシュは「何かが動いた」しか言わない）。

### 12.3 `test/world-renderer.test.ts` —— 呼び出しプロトコルだけ

`test/support/fake-three.ts` を使う。**そのファイルのヘッダに、この fake が
何の代わりになっていて何の代わりにはなっていないかが書いてある。**
要点だけ再掲すると、GPU の挙動は一切モデル化していない ——
コンテキストが取れるか、何かが見えるか、巻き順・カリング・深度、
index がバッファをはみ出していないか、`dispose` が本当に解放したか。
**そのどれもここでは green になる。**

ここで意味があるのは、ブラウザでは「しばらく壊れていても気づかない」種類の帳簿である:

- `setChunk` が同じ key で 2 回呼ばれたとき、mesh を**足す**のではなく**差し替える**
  （docs/public-api.md §3.1: 落下する砂の柱は 1 tick に同じチャンクを 32 回汚す。
  症状はメモリ曲線であって絵ではない）
- `removeChunk` が `BufferGeometry.dispose()` を呼ぶ
- `draw` が **mirrored** カメラを書き込む。authoritative pose を渡す実装は
  「view bob だけが静かに効かなくなった正しく見える世界」を描く

### 12.4 目視の実測（2026-07-28）

fake が「主張できない」と書いた側 —— バッファが本当にアップロードでき、
巻き順が正しく、AO が実際に見えるか —— は、mc-compose のページに
一時的にジオメトリを流し込んで**スクリーンショットで確認した**（コミットには含まれない）。
merged な 16x15 の床が正しい遠近で出て、ao=0 の壁が白、ao=3 の壁が濃いグレー、
ao=1 の `xNeg` 壁が薄いグレーで、いずれもカリングされずに出た。

**この確認は自動化されていない。** ワールドデータが mc-compose に届くようになった時点で、
`docs/e2e-triage.md` にピクセル主張の行を足すべきである。
