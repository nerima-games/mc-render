# テスト / 検証

## 1. plan.md が要求する検証（§3.9）

> **検証**: fixture描画 + スクリーンショット比較 +
> **内蔵ビューア（固定チャンクを読み込んでマテリアル/ポストFXを目視確認）**

3 本立てである。

| 検証 | 何を保証するか | 状態 |
| --- | --- | --- |
| fixture 描画 | 固定チャンクが描ける | 構造的な Three surface、Node プレビュー、公開 `./browser` runtime は実装済み。固定ワールドデータを結んだブラウザ/GPU fixture は未実装。§2.2 |
| スクリーンショット比較 | 見た目が変わっていない | `./browser` の `captureScreenshot` は実装済み。参照画像との比較は未実装。ただし**決定性は実測で片付いた**（§2.5） |
| **内蔵プレビュー** | **人間が操作して確かめられること** | 実装済（[`apps/preview-render/`](../apps/preview-render/README.md)）。ただしターミナル。§2.2 |
| ── うち固定チャンクの目視 | マテリアル / ポストFX の**絵**を見る | GPU が要る。`./browser` runtime または外部ホストが Three namespace と canvas を接続し、固定ワールドデータを用意して実施する。 |

> Node 上の構造・型・呼び出し契約と、GPU 上の見た目は別の検証面である。
> 前者は本リポジトリのテストで検証し、後者は `./browser` runtime または Three namespace と
> canvas を接続するブラウザ/QA ホストで検証する。

GPU を必要としない部分の単体テストは、§3 で述べるとおり**意図的に厚くしてある**。
内蔵プレビューはその厚みの上に立っており、同じ理由で端末に描く。

## 2. 完了条件（plan.md §6 Step 2）

> 各リポジトリの完了条件: ユニット/シナリオテスト green + **内蔵プレビューが操作可能**

プレビューは `apps/preview-<name>/` に置く。モジュール契約には含めない（plan.md §4.1 末尾）。
本リポジトリのそれは [`apps/preview-render/`](../apps/preview-render/README.md) であり、
`pnpm preview` で起動する。`pnpm verify` には入らないが、`pnpm typecheck`
（`tsconfig.preview.json`）と `pnpm lint` の対象には入っている。

### 2.1 順序の都合

構築順は `worldgen → sim → render → kit`（plan.md §6 Step 2）。
mc-render のプレビューは kit の**前**に作る必要がある——kit が mc-render に依存するので、
kit を待っていると永遠に始まらない。つまり mc-render のプレビューだけは kit 無しで書く。
これは重複ではなく、kit の設計に対する最初のフィードバックになる。**そうした。**

### 2.2 「固定チャンクの目視」がまだ無い理由と、Node プレビューが見せるもの

コア入口は Three.js の実装に依存せず、構造的な surface に namespace を注入する。
`./browser` は Three.js を使う明示的な実装入口であり、Node プレビューは GPU 描画ではなく、
データと状態遷移を確認する。

#### 変わったこと

`application/three-surface.ts`、`application/world-renderer.ts`、
`application/world-renderer-production.ts` があり、
`render:draw` は `DrawPort` を呼ぶ。`domain/chunk-geometry.ts` は mc-meshing の
quad を interleave した頂点バッファにする。**`tsconfig.base.json` の `lib` は
`["ES2024"]` のまま、`types` は `[]` のままである** —— 予告では `"DOM"` が要ると
書いてあったが、要らなかった（[versioning.md](./versioning.md) §5.1）。
つまり上の段落が守りたかった機構的保証は**そのまま残っている**。

`three` はブラウザ入口が使う runtime dependency で、`@types/three` は型検証用の
`devDependency` である。コア入口と Node preview は直接 import せず、`src/browser.ts` が
出荷物の明示的な Three 境界になる。

#### この repo が所有しないこと ——「固定チャンクの目視」

`apps/preview-render/` はターミナルプレビューである。`./browser` は実際の Three namespace、
canvas、GPU コンテキストを接続できるが、固定ワールドデータとスクリーンショット受入れを
含む fixture はホストアプリまたは CI が所有する。

判定はコミットメッセージではなくツリーとテストで行う。
`application/three-surface.ts`、`application/world-renderer.ts`、
`application/world-renderer-production.ts`、
`test/three-surface.test.ts` が構造面の一次資料である。

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

`--stats` はかつて **8 件の発見**を出していた。**7 件は修正済み、1 件は「直さない」と決めて
テストで固定した。** どちらの場合も `test/` にテストがあり、そこでしか主張は CI で落ちない
—— `--stats` の行はピンではない。

| # | 内容 | 状態 | 固定しているテスト |
| --- | --- | --- | --- |
| RND-1 | `requested` は吸収状態。`blur` が保存し `requestPointerLock` は再送しない | **修正** | `test/input.test.ts` `REGRESSION: a blur ABANDONS a pending request rather than stranding the session` |
| RND-2 | `endFrame` がどのフレームにも報告していないホイール段を消費する | **修正** | `REGRESSION: endFrame consumes what the FRAME was told, not what arrived after it` ほか 4 件 |
| RND-3 | `blur` が `pointerLocked` を残すので、復帰クリックが `attack` になる | **修正** | `REGRESSION: blur ends the LOCKED SESSION, so the click that refocuses is not an attack` |
| RND-4 | ミラーの初期状態が未発行を明示しない（`UNSET` のポーズに発行元 timestamp が無い） | **修正** | `test/stage-registration.test.ts` `before a pose arrives, startup mirror and gauge agree on unpublished state` |
| RND-5 | `MIRROR_LAG_WARNING_SECS` の doc が「Milliseconds」と書いている | **修正** | `test/camera-mirror.test.ts`（秒として比較していることは既に固定済み） |
| RND-6 | `RenderRegistrationLayer` が `renderModule` の引数を捨てる | **修正（削除）** | `test/stage-registration.test.ts` `registers its stages against the InputService it itself provides` |
| RND-7 | `withScratch` は非公開 native `Map` と lease facade で、返却後の wrapper / closure / 遅延 Effect / iterator の利用も捕まえる | **修正** | `test/frame-scratch.test.ts`（18 件） |
| RND-8 | `buildPostProcessingChain` が `high` と `ultra` に同一の配列を返す | **修正** | `test/post-processing.test.ts` `REGRESSION: \`high\` and \`ultra\` are DIFFERENT chains, and the composite step is why` |

RND-7 は保留せず修正した。native `Map` は `ScratchMap` から非公開にし、scratch ごとに
1 つだけ再利用する lease facade を `withScratch` の callback に渡す。借用中の map 操作と
iterator の `next()` は有効期間を検査し、lease を直接返す場合だけでなく、wrapper / closure /
遅延 Effect / iterator に閉じ込めて返却後に利用する場合も `ScratchMisuseError` になる。
フレーム境界の外へ持ち出す値は `snapshotScratch` でコピーする。facade は borrow ごとに
作らず、native `Map` は `clear()` して再利用する。

全件の詳細は [`apps/preview-render/README.md`](../apps/preview-render/README.md)。

### 2.3 fixture の入手元

固定チャンクの fixture は、ホストアプリが所有するワールドデータまたは
mc-meshing のゴールデンデータから提供する。`apps/preview-render/` はその代わりではなく、
GPU 無しで確かめられる入力・マテリアル・状態機械の確認場所である。

### 2.4 プレビューの依存

`apps/preview-render/` は Node プレビューであり、実 Three namespace や DOM を直接 import しない。
プレビューも `typecheck` と `lint` の対象で、ミラーの陳腐化は注入した
`MonotonicTimeSecs` を操作者が動かして測る。依存境界は直接依存宣言と TypeScript の
import graph で検証する。

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

**コア入口と Node preview のソースには THREE.js の runtime import が無い。**
`src/browser.ts` は意図的なブラウザ境界として import する。これは設計判断で、根拠は 2 つある。

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

`vitest run` は `test/**/*.{test,spec}.ts` を Node 環境で実行する。テストは次の責務で分かれる。

| 責務 | 主なテスト |
| --- | --- |
| 入力と DOM 境界 | `input`, `browser-input-adapter`, `touch-controls`, `gamepad-input`, `movement-keys` |
| カメラ・描画ポリシー | `camera-mirror`, `post-processing`, `material-policy`, `chunk-shader`, `water-shader`, `water-surface`, `water-refraction`, `texture-atlas`, `block-texture-map` |
| ジオメトリ・照明・同期 | `chunk-geometry`, `fluid-geometry`, `voxel-lighting`, `chunk-shader-geometry`, `chunk-store-lighting`, `chunk-store-mesher`, `world-sync`, `world-renderer`, `three-surface` |
| シミュレーション由来の描画データ | `mob-visual`, `vehicle-visual`, `wither-visual`, `weather-renderer`, `weather-rendering`, `render-environment`, `level-of-detail` |
| 実行基盤 | `frame-scratch`, `particle-pool`, `particle-system`, `worker-pool`, `frustum-culling`, `stage-registration` |

Three surface tests establish structural assignability against real `three` types; they do not replace a browser/GPU visual fixture.

### 4.1 公開済み mc-kernel の直接利用

mc-kernel の語彙は公開 package から直接 import している。ローカルミラーと専用テストを
残さないことで、実装と型契約の二重化を避け、`pnpm typecheck` が公開型との
assignability を直接検査する。mc-kernel の変更は package の公開 API 差分としてレビューする。

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

`test/water-surface.test.ts` は、水面の `alphaTest: 0` を cutout と偽らず、
`flatSurface: true` を意味論として与えた場合に `must-force-single-pass` になることを
assert している。同時に `flatSurface: false` の閉じた透明体が `review-sharing` に残ることも
固定している。[responsibility.md §2.1](./responsibility.md) の判定
`shared && transparent+DoubleSide && (cutout || flatSurface)` と一致するため、
旧来の `KNOWN GAP` は解消済みである。

`alphaTest: 0` だけで水面を cutout 扱いすることはしない。平面性は Three のマテリアル
フラグから復元できないので、`MaterialSpec.flatSurface` を供給側が明示する。

### 5.8 参照実装が書いた数値は、測れるなら**引用せず測る**

`WAVE_APPROX_MAX_ERROR` の 0.056 は、参照実装のコメントから写したのではなく
`test/water-surface.test.ts` が定義域を掃いて測っている。

それをやったので、参照実装の `~0.056` が
**貼られている関数の性質ではない**ことが分かった（DN-18）。写していたら分からなかった。

同じ扱いをした値: フレネル F0 = 0.02 は屈折率 1.333 からの導出と一致することを確認している。
逆に、**測れないものは測れないと書く** —— §4.2。

## 6. カバレッジ

`pnpm test:coverage` は v8 を使い、`src/index.ts`、`src/domain`、
`src/application`、`src/stages` の実行可能コードを計測する。`three-surface.ts` は
純粋な型シームとして除外し、実 Three の型宣言に対する TypeScript の検査と
`test/three-surface.test.ts` で契約を確認する。

`vitest.config.ts` は statements / branches / functions / lines の 4 指標に 100% の閾値を設定する。
このカバレッジはブラウザ/GPU 出力、テクスチャ転送、スクリーンショット比較を検証しない。

## 7. CI

`.github/workflows/ci.yaml` は、依存関係をインストールした後に型検査、Nix 上の lint、
テスト、PR の changeset 検査、カバレッジ、package 検査を実行する。ローカルでは
ツールチェーンを揃えるため `nix develop --command pnpm verify`、カバレッジまで含める場合は
`nix develop --command pnpm test:coverage`、配布物まで含める場合は
`nix develop --command pnpm pack:check` を使う。

```
install --frozen-lockfile
  → typecheck (build + test + preview + browser)
  → lint (Nix 提供の oxlint)
  → test
  → changeset status (pull request のみ)
  → coverage (4 指標 100% ゲート)
  → package check (build + tarball contents + manifest/exports + core/browser import probes)
```

`check:deps` や API lock の独立ゲートは現在の構成にはない。直接依存宣言、TypeScript の
import graph、`src/index.ts`、振る舞いテストがそれぞれの境界を検証する。

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

本リポジトリで残るテスト課題は、実装済みの structural/Node paths と
host-owned visual paths を分けて扱う。

| テスト | 状態 |
| --- | --- |
| production `WorldRenderer` の shader / water / instanced construction | Node 側の constructor / port contract tests と `./browser` の実装は済み。GPU 上の見た目は固定データを持つホスト/CI fixture で検証する |
| browser fixture + screenshot | `./browser` runtime は実装済み。固定データ、canvas、GPU、スクリーンショット受入れを組み合わせる fixture はホスト/CI 側の残課題 |
| worker-pool Port 適合 / dead worker replacement | `test/worker-pool.test.ts` で失敗通知、ワーカー交換、待機ジョブ解放を検証済み。`test/browser-worker-port.test.ts` で実 DOM `Worker` 型適合、message/error/terminate/transfer の adapter 経路を検証済み。実ブラウザ Worker の end-to-end 実行は host fixture の残課題 |
| キーボードフォーカスのグループ内移動 | `focusNavigation` の direction / current / consumption 契約は実装済み。実 DOM の `focus()` と mx-ui の移動規則は host fixture で検証する |
| 入力回帰 | 現在の state machine は既存テストでカバー済み |

レンダラは **1 フレームを明示的に描いて戻る入口**を持つこと。rAF ループを内部に抱えたまま
描き続ける設計は、スクリーンショットを決定的に駆動できない。

### 8.1 解消済み: `window` 入力アダプタ

`test/browser-input-adapter.test.ts` が、window アダプタのリスナー、wheel、pointer lock を
**実装済み**として検証する。

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

`test/input.test.ts` と `test/browser-input-adapter.test.ts` が、フォーカスを
level として扱うこと、ロック中に視覚状態をマスクすること、Tab を奪わないことを検証する。
矢印キーは `focusNavigation` を通じて host-owned の移動へ委譲し、消費されたときだけ
ブラウザ既定動作を抑止する。
全表は [design-notes.md](./design-notes.md) DN-16 にある。

| テスト | 何を守るか |
| --- | --- |
| `REGRESSION: no focus handler EVER calls preventDefault` | Tab を奪えばキーボードトラップ（WCAG 2.1 SC 2.1.2）。実リスナ越しに、ロック中でも 0 件であることを assert する |
| `REGRESSION: the lock MASKS the focus, it does not forget it` | ロック中に消すと、明けたときリングとブラウザのフォーカスがずれる |
| `endFrame does NOT clear it: focus is a LEVEL, like pressed and unlike justPressed` | フレーム境界の一貫性。エッジ扱いにするとリングがリフレッシュレートで点滅する |
| `a consumed arrow delegates the move and suppresses only that browser default` | host が現在位置を受け取り、移動を消費した矢印だけを抑止する |
| `an unconsumed or unrelated key stays on the ordinary input path` | 境界キーと通常キーを入力サービスへ残す |
| `arrow navigation is disabled while locked and outside declared focus groups` | ロック中または対象外では host 移動を呼ばない |
| `maps every supported browser code to its semantic direction` | `Arrow*` と意味方向の対応を固定する |

`focusin` / `focusout` も偽 DOM で駆動している。フォーカスは Playwright なら実在するが、
**ロック中の分岐は相変わらず届かない**（§3.2）ので、
「ロック中はリングを出さない」は node 側でしか押さえられない。

矢印キーの repo 内の契約には、意図的な空白はない。`focusNavigation` は direction と現在の
`FocusTarget` を host に渡し、`true` のときだけその keydown を消費する。callback が次の要素を
選び、実際に `focus()` を呼び、mx-ui の inventory / hotbar 規則へ接続する部分は host の責務である。
実ブラウザのフォーカス移動と mx-ui への配線は、GPU / browser fixture と同じ host 側受入れに残る。

| host-owned の残る確認 | 理由 |
| --- | --- |
| 実 DOM で矢印キーが次の要素へ `focus()` する | focusable element と移動トポロジーは host / mx-ui の契約であり、mc-render は DOM 要素の配列を所有しない |
| inventory / hotbar が矢印を二重処理しない | mx-ui が inventory の keydown を所有する場合、host は同じキーの所有者を一つに定める必要がある |

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

前者はフィクスチャを `ts.createProgram` で**テストの中からコンパイル**する。
この検査には compiler API が必要なため、`typescript-compiler-api`（TypeScript 6 の
npm alias）を使う。TypeScript 7 の公開 runtime package は version metadata だけを公開し、
`createProgram` や `readConfigFile` を提供しないためである。通常の型検査・ビルドは
TypeScript 7 を使い、compiler API を直接呼ぶテストだけを TypeScript 6 に固定する。
この二重化は互換層ではなく、異なる公開 API を持つツール境界である。
フィクスチャは `tsconfig.json` / `tsconfig.test.json` から `test/fixtures/**` として除外してある。
DOM 型を名指しするのが目的のファイルであり、DOM の無いプロジェクトに入れれば落ちるだけで、
出荷プロジェクトに入れれば `"DOM"` が裏口から入ったのと同じになる。

公開面の検証は API lock ファイルではなく、`src/index.ts` と各パッケージの
`typecheck`、および振る舞いテストで行う。ブラウザ/GPU/PNG の検証だけは
Three namespace と canvas を所有するホスト fixture に残る。

## 9. 現行 lint/typecheck の対象

`package.json` の `lint` / `lint:fix` は `src apps scripts test` を対象にする。
`typecheck` は build / test / preview / browser の各 tsconfig を実行し、公開 index から到達する stages も検査する。
依存境界は package.json の直接依存宣言と TypeScript import graph で検証し、別の `check:deps` スクリプトは持たない。

## 12. Three surface と renderer path のテスト

構造的 Three surface、ジオメトリ、WorldRenderer のテストは、
それぞれ異なる契約を検証する。

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

同じテストが 3 つの周辺事実も固定している: コア用 `tsconfig.build.json` が
`lib: ["ES2024"]` / `types: []` のままであること、コア出荷面に `three` の import が
無く、**`src/browser.ts` を root とする browser entry graph だけが意図した runtime 境界であること**（grep。
`src/browser-water-visibility.ts` など、その graph から到達する Three import は含む。`skipLibCheck` が
あるので型検査では見えない）、`three` と `@types/three` のバージョン文字列が一致していること。

### 12.2 chunk geometry と voxel lighting

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

Cross-plant と fluid の geometry は同じ projection path で検証し、
`voxel-lighting.test.ts` と `block-texture-map.test.ts` がサンプル位置、
面方向、テクスチャ役割を検証する。

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

### 12.4 ブラウザ/GPU の検証

Node の fake surface は実 Three のアップロード、WebGL context、カリング、深度、
dispose、スクリーンショットを検証しない。`./browser` runtime は実 Three と canvas を
接続するが、固定ワールドデータ、GPU、スクリーンショット受入れを所有するホスト fixture が
その検証を担当する。このリポジトリでは fixture の入力契約と Node 側の呼び出し契約までを
検証する。
