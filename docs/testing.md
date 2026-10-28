# テスト / 検証

## 1. Rendering verification

The rendering checks use both deterministic Node tests and Chromium with software
WebGL. The public `./browser` entry owns the Three.js runtime; the portable root
entry remains DOM-free.

| 検証 | 何を保証するか | 状態 |
| --- | --- | --- |
| Browser fixture rendering | 固定 terrain fixture が WebGL2 上で描画され、複数の atlas tile を使う | `pnpm test:browser` の render-preview テスト |
| Screenshot comparison | 固定 fixture が pinned baseline と十分一致する | fixture/baseline の SHA-256 と SSIM > 0.95 を同じ browser job で検査 |
| Shader probe | chunk、water、particle shader が compile して描画できる | `pnpm test:browser` |
| Terminal preview | 入力状態と render policy を人が操作して調べる | [`apps/preview-render/`](../apps/preview-render/README.md)、`pnpm preview` |
| Browser runtime | composite pass、refraction gate、GPU timer fallback、PNG capture を実行する | `pnpm test:browser` |

The browser regression job covers WebGL paths that Node cannot execute. Node
tests remain the primary proof for the deterministic domain and input state
machines. The terminal preview is a separate interactive diagnostic tool.

## 2. Preview and browser verification

`apps/preview-render/` is the terminal preview for stepping input and render
policies. `pnpm preview` starts it. `pnpm verify` typechecks and lints the
preview, but does not run its interactive UI.

### 2.1 Browser fixture and image comparison

The `./browser` entry imports Three.js and creates a runtime for a
host-owned canvas. Its DOM and WebGL declarations are compiled in a separate
browser release project; the root release build keeps `lib: ["ES2024"]` and
`types: []`.

`apps/render-preview/` loads the fixed terrain fixture and draws it through the
browser runtime. The browser regression suite checks that the fixture draws
multiple atlas tile colours and compares the canvas with the pinned PNG using
SSIM. It also checks the fixture and baseline hashes so an input change cannot
silently redefine the reference image. `apps/shader-probe/` compiles and draws
the chunk, water, and particle shaders under Chromium/SwiftShader.

`apps/preview-render/` remains the terminal preview for stepping input and
render policies. It complements the browser fixture rather than standing in
for it. See [`public-api.md`](./public-api.md) §9 and the command table below.

`apps/preview-render/` は、実装でモデル化した状態や描画ポリシーを確認するためのプレビューである。
ビューは `input`、`postfx`、`material`、`mirror`、`scratch`、`stages` の 6 種類。

**入力状態機械は Node tests で検証する。** Headless Playwright cannot exercise
pointer-lock transitions. `test/input.test.ts` drives those transitions in one
fiber; the browser tests exercise the real canvas and WebGL path.

ステップ可能なプレビューは、**イベント順序がつまみになる唯一の場所**である。
だから `readSnapshot` と `endFrame` もイベントと同格のステップになっている。
下の RND-1 / RND-2 はどちらも、テストがたまたま逆順で発行している 2 つのイベントを
入れ替えただけで出てくる。

レビューで見つかった問題と、それぞれを固定する回帰テストを次に示す。

| # | 内容 | 状態 | 固定しているテスト |
| --- | --- | --- | --- |
| RND-1 | `requested` は吸収状態。`blur` が保存し `requestPointerLock` は再送しない | **修正** | `test/input.test.ts` `REGRESSION: a blur ABANDONS a pending request rather than stranding the session` |
| RND-2 | `endFrame` がどのフレームにも報告していないホイール段を消費する | **修正** | `REGRESSION: endFrame consumes what the FRAME was told, not what arrived after it` ほか 4 件 |
| RND-3 | `blur` が `pointerLocked` を残すので、復帰クリックが `attack` になる | **修正** | `REGRESSION: blur ends the LOCKED SESSION, so the click that refocuses is not an attack` |
| RND-4 | ミラーの初期状態が自己矛盾（`UNSET` のポーズに `mirrorLagSecs = 0`） | **修正** | `test/stage-registration.test.ts`（未初期化は `undefined` として扱う） |
| RND-5 | `MIRROR_LAG_WARNING_SECS` の doc が「Milliseconds」と書いている | **修正** | `test/camera-mirror.test.ts`（秒として比較していることは既に固定済み） |
| RND-6 | `RenderRegistrationLayer` が `renderModule` の引数を捨てる | **修正（削除）** | `test/stage-registration.test.ts` `registers its stages against the InputService it itself provides` |
| RND-7 | `withScratch` が捕まえるのは同一性エスケープだけ | **修正** | `test/frame-scratch.test.ts`（lease 外の view / wrapper / closure / iterator / Effect と foreign handle） |
| RND-8 | `buildPostProcessingChain` が `high` と `ultra` に同一の配列を返す | **修正** | `test/post-processing.test.ts` `REGRESSION: \`high\` and \`ultra\` are DIFFERENT chains, and the composite step is why` |

保留分はない。RND-4 と RND-7 は実装と回帰テストで閉じた。

 - **RND-4**: `render:camera-mirror` が登録時要求の `PlayerService.cameraPose` を読み、
   `RenderFrameState` に authoritative pose を保持しない。時計を読むステージの責務は変わらない。
 - **RND-7**: `withScratch` は native `Map` を公開せず、scratch ごとに一度だけ作る
   lease-checked view を渡す。view / wrapper / closure / iterator / deferred Effect の
   lease 後アクセスを `ScratchMisuseError` にし、持ち出しは `snapshotScratch` に限定する。

全件の詳細は [`apps/preview-render/README.md`](../apps/preview-render/README.md)。

### 2.2 Browser fixture inputs

The browser fixture is `apps/render-preview/terrain-fixture.json`; its expected
image is `e2e/fixtures/render-preview-baseline.png`. The Playwright test pins
both inputs by SHA-256 before comparing the rendered canvas. Keep fixture
changes and baseline changes reviewable together.

### 2.3 プレビューの依存

`apps/preview-render/` is the terminal diagnostic app. It imports the published
mc-sim 0.6.0 API. `apps/render-preview/` is the browser fixture used by
Playwright. The terminal preview continues to use the injected
`MonotonicTimeSecs` clock.

## 3. GPU を必要としないテストを厚くする方針

The portable root modules stay independent of Three.js. The published
`./browser` entry contains the concrete Three.js and WebGL implementation, so
runtime browser behavior is tested in Playwright as well as through pure domain
tests.

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

### 3.2 Browser E2E coverage and its pointer-lock limit

The local browser suite runs Chromium with SwiftShader. Headless Playwright
cannot exercise pointer-lock state
transitions. The browser job does verify shader compilation, fixture rendering,
screenshot similarity, and the browser runtime under Chromium/SwiftShader.
Pointer-lock transitions remain in Node tests.
DN-09（ロック解除時にデルタを捨てる）のような知見は、
ポート越しの単体テストで検証する。そのため入力サービスは
DOM を import せず `InputEvent` を注入で受ける。

ロックの要求（DN-14）はこの制約の影響を強く受ける。`canvas.requestPointerLock()` を
サービスから直接呼ぶと、Headless Playwright ではポインタロックを要求できず、Node の単体テストでは
DOM を使わないため、どちらでも検証できない。そのため要求は `PointerLockPort` から出し、
拒否（`pointerlockerror`）も注入イベントとして扱う。ホイール単位の正規化（DN-13）は、
単体テストで検証できるようドメイン側に置く。

## 4. 現在のテスト

`pnpm test`（`vitest run`）が `test/**/*.test.ts` を実行する。すべて
`environment: 'node'` であり、テスト数は固定値として文書化せず、実行時の Vitest 出力を
一次資料とする。

| ファイル | 対応 |
| --- | --- |
| `test/post-processing.test.ts` | DN-01 / DN-07 |
| `test/input.test.ts` | DN-04 / DN-05 / DN-08 / DN-09 / DN-12 / DN-13 / DN-14 / W4-R5 focus state |
| `test/browser-input-adapter.test.ts` | DOM listener lifecycle, event translation, focus and click host callbacks |
| `test/touch-controls.test.ts` | タッチ入力と blur reset |
| `test/movement-keys.test.ts` | 移動キーの語彙 |
| `test/camera-mirror.test.ts` | DN-06 |
| `test/frame-scratch.test.ts` | DN-03 |
| `test/material-policy.test.ts` | DN-02 |
| `test/particle-pool.test.ts` | DN-17（容量・drop-oldest・シード付き乱数） |
| `test/water-surface.test.ts` | DN-18（水マテリアルと `forceSinglePass`）/ DN-02 |
| `test/water-refraction.test.ts` | DN-18（屈折プリパスのゲートと順序） |
| `test/texture-atlas.test.ts` | DN-19（レイアウト算術、RGBA生成、全マッピング、素材別 alpha） |
| `test/world-renderer.test.ts` | THREE seam call protocol |
| `test/chunk-geometry.test.ts` | merged extent and per-face AO |
| `test/three-surface.test.ts` | Structural assignability to `three` types |
| `test/adaptive-quality.test.ts` / `test/ssim-adaptive-quality.test.ts` | FPS and SSIM quality policy |
| `test/refraction-ratio-gate.test.ts` | refraction render-ratio gate |
| `test/browser-runtime.test.ts` | GPU timer service lifecycle and error handling |
| `test/public-api.test.ts` | root public focus DTO and callback exports |
| `test/stage-registration.test.ts` | `stages/` order and input-to-render wiring |

### 4.1 mc-kernel direct imports

mc-render imports shared vocabulary directly from the published mc-kernel package.
It keeps no local mirrors, so `pnpm typecheck` checks assignability against the
published types. Review mc-kernel changes as public API changes in that package.

### 4.2 Visual claims not covered by the current browser fixture

The current screenshot fixture covers terrain. The shader probe checks that
shader programs compile and draw, and the browser runtime test checks the
refraction gate. They do not establish the visual quality or gameplay workload
claims below.

| 主張 | なぜ検査不能か |
| --- | --- |
| パーティクルが**それらしく見える**か（0.1m のクォッドの大きさ、フェード曲線、壊したブロックのタイルが本当に出ているか） | 現在の fixture にパーティクルが無く、shader probe は見た目を比較しない |
| **容量 512 で足りる**か（速いツルハシで枯渇しないか） | gameplay workload の測定が無い。参照実装にも測定値は無い（`domain/particle-pool.ts` は「転記であって正当化ではない」と明記） |
| 水の**色が水に見える**か。パレット・空のグラデーション・`WATER_SURFACE_ALPHA = 0.86` | 現在の terrain fixture に水面が無く、shader probe は見た目を比較しない |
| 屈折の閾値 0.005 / 0.05 と、high の間隔 2 が**振り向きで遅れて見えないか** | 閾値ゲートは browser runtime test で検証するが、閾値付近の水面を動かす視覚 fixture は無い |

検査できる性質はデータにしてテストで固定する。対象は、リップルが有界であること、
フレネルが単調であること、
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

### 5.2 Node unit tests and browser E2E have separate jobs

`vitest.config.ts` は `environment: 'node'`。jsdom も入れていない。

Vitest stays in `environment: 'node'` so domain and service tests do not need
a browser simulator. Tests that need actual DOM, WebGL2, or the published
browser runtime run in the separate Playwright job instead of expanding the
Node test environment.

`window` 入力アダプタもこの規約で検査する（§8.1）。
`jsdom` と Playwright は不要である。アダプタが触る DOM メンバは 8 個に限られ、
（`application/dom-surface.ts`）、偽装は 40 行で済む。
`lib.DOM` を入れずに済ませたことがそのまま「偽装できる大きさ」を保証している（DN-15）。

The browser runtime is covered by the fixture, screenshot, shader-probe, and
runtime checks listed in §1. Node tests cover pointer-lock transitions because
the headless SwiftShader browser cannot request pointer lock.

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
33 は測定範囲の上端である
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

正しい答えだけを assert すると、共有述語を誰かが広げた日に食い違いを検出できない。
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

`vitest.config.ts` の coverage 対象は `src/**/*.ts` で、`.d.ts`、`*.config.ts`、
`*.test.ts`、`*.spec.ts` を除外する。branches / functions / lines / statements は
すべて 100% の閾値を持つ。`pnpm test:coverage` は coverage 検査と閾値判定を実行し、
CI でも実行する。ブラウザ E2E の実行結果は Node coverage に含めず、WebGL 経路は
`pnpm test:browser` で検査する。

ブラウザ E2E は Chromium/SwiftShader で固定 fixture を描画し、screenshot comparison、
shader、composite/refraction、GPU timer fallback、F2 capture の動作も検証する。

## 7. CI

ローカルで品質ゲートを再現する場合、`nix develop --command pnpm verify`
（`typecheck && lint && test`）がゲートの中核である。`pnpm lint` は Nix 提供の
oxlint と ast-grep（`.oxlintrc.json` / `sgconfig.yml`）の両方を実行するため、
`nix develop` の中で実行すること。

`.github/workflows/ci.yaml` は、`pnpm verify` の後段でカバレッジ・package 境界・
依存監査を個別のステップとして実行する。

```
install (GitHub Packages 認証込み)
  → verify (typecheck (build + test + preview + browser projects) → lint (oxlint + ast-grep) → test)
  → changeset status（PR かつ release/* ブランチでないときのみ）
  → coverage (100% 閾値、アーティファクト化)
  → package:verify（build → scripts/verify-package.mjs で packed tarball を検証）
  → audit
```

This package has no API lock file or API lock commands. Its public surface is
defined by `package.json` exports and declarations emitted from the release
TypeScript projects. `pnpm typecheck` and `pnpm build` validate the source
projects and declaration output. `pnpm package:verify` installs the packed
archive in a scratch consumer and checks every declared export at runtime and
through its declarations. Use `pnpm pack --dry-run` to inspect archive contents.
See [public-api.md](./public-api.md) for the package checks.


## 8. Test request status

The table tracks selected test requests from [design-notes.md](./design-notes.md).
It includes completed and outstanding work. “Condition met” records whether
the implementation prerequisite exists; it does not mean the requested test
has been implemented.

| テスト | 対応 | いつ | 条件は成立したか |
| --- | --- | --- | --- |
| `the THREE adapter adds passes in exactly buildPostProcessingChain order` | DN-01 | browser runtime の実装時 | The browser entry owns the Three.js composer; domain chain order is unit-tested and Chromium E2E executes the composite path |
| `every shared material built by the adapter passes auditMaterials` | DN-02 | 起動時アサーションとして | **成立した。** `makeWorldRenderer` は共有 `MeshBasicMaterial` を 1 枚作る。ただし `describeMaterialPolicy` の入力である `MaterialSpec` を組む所がまだ無い |
| `a full frame allocates no new Map` | DN-03 | シーム着地後 | **成立した。** `render:draw` は実体になった。未着手 |
| `no source file in this repository reads camera.position` | DN-06 | 走査テストで | **成立した。ただし優先度は下がった** —— `ThreeSurface` の `ThreeVector3` は `set` しか持たず、`ThreeCamera` は読み出し口を持たない。**読む書き方が型として存在しない**ので、走査テストは型が既に保証しているものの二重化になる。書くなら「シームに getter が生えていないこと」を見るほうが強い |
| `blur clears gamepad and touch state too` | DN-08 | それらの実装時 | **成立。** `test/touch-controls.test.ts`（25 件）と `test/gamepad-input.test.ts`（5 件）で、保持状態・軸・押下エッジを検証する |
| ワーカープールの Port 適合 / 死んだワーカーの置き換え | DN-10 | プール実装時 | まだ |
| terrain fixture rendering + screenshot comparison (SSIM > 0.95) | §2.1 | 完了 | `e2e/shader-probe.e2e.spec.ts` verifies fixed inputs, drawn pixels, multiple atlas tiles, and SSIM against the pinned baseline |
| 参照実装の入力テスト 1,261 LOC の移植 | — | 残り（[porting.md](./porting.md) §6） | — |

**Browser runtime property enforced by the current tests.** The explicit
`render` call lets the fixture draw and capture a frame without a wall-clock delay.

> レンダラは **1 フレームを明示的に描いて戻る入口**を持つこと。
> rAF ループを内部に抱えたまま「描きっぱなし」にしないこと。

This keeps the pinned image comparison independent of an animation-frame wait.

### 8.1 解消済み: `window` 入力アダプタの 5 本

かつてこの表にあった以下の回帰契約は `test/browser-input-adapter.test.ts` で実装済みである。

| テスト | 対応 |
| --- | --- |
| `the window adapter registers exactly LISTENER_PLAN` | DN-04 |
| `every listener is removed on finalizer` | DN-04（kit の 2 枚並列でリークする） |
| `the window adapter passes deltaMode through wheelDeltaModeForIndex` | DN-13 |
| `the wheel handler calls preventDefault exactly when shouldSuppressWheelScroll says so` | DN-13 |
| `the browser port calls canvas.requestPointerLock exactly once per ask` | DN-14 |

Node unit tests use a fake DOM to keep listener and event-translation checks
deterministic. The browser regression job exercises the renderer DOM and WebGL
path; headless SwiftShader still cannot exercise pointer-lock transitions.

追加で 2 本、**この設計自体**を守るテストがある（DN-15）。

| テスト | 何を守るか |
| --- | --- |
| `a real Window, Document and HTMLCanvasElement satisfy the adapter without a cast` | `test/fixtures/dom-surface.ts` を**本物の `lib.dom.d.ts`** に対してコンパイルし、診断 0 件を assert する。狭い構造的型が実物の部分集合であること |
| `the shipped project still compiles with NO DOM at all` | `tsconfig.build.json` の `lib` / `types` が後から緩められていないこと |

### 8.2 Keyboard focus boundary (DN-16, W4-R5)

`FocusTarget` is the public `{ group, index }` DTO owned by mc-render and carried
through `InputServiceApi`. mx-ui owns DOM membership, resolves focus elements to
that DTO, and moves focus within its groups. mc-render maps arrow key codes to
direction intent. It does not inspect a host roster or call `.focus()`.

| Coverage | What it protects | Location |
| --- | --- | --- |
| Focus state, pointer-lock masking, `focusout`, and frame retention | The input service retains a DTO, masks it while locked, and clears it when focus leaves managed UI | `test/input.test.ts` |
| Host callbacks and DOM event translation | `focusin` dispatches the callback's DTO; focus outside the host UI yields no DTO; unlocked arrows become direction intent while raw keys still reach the input service | `test/browser-input-adapter.test.ts` |
| Keyboard ownership | Tab remains browser-owned and is never suppressed or remapped; the renderer does not suppress arrow keys | `test/input.test.ts`, `test/browser-input-adapter.test.ts` |
| Public surface | The root entry exports `FocusTarget`, callback types, and key-to-direction helpers | `test/public-api.test.ts` |

The host's resolver and DOM focus movement are outside this repository's test
surface and belong to mx-ui. mc-render tests the scalar callback boundary with a
fake DOM. The browser regression job covers rendering paths that require
WebGL; it does not claim to verify host-owned focus behavior.

Click landing follows the same ownership boundary. mc-render checks exact canvas
identity first, then asks the host to classify other targets as `ui` or
`elsewhere`. The service records every unlocked click, while only a primary
click on the canvas can request pointer lock. Predicate, adapter, and stage
coverage live in `test/input.test.ts`, `test/browser-input-adapter.test.ts`, and
`test/stage-registration.test.ts` respectively.

## 9. `stages/` の検証範囲

`stages/` は現在の各検証に含まれている。

- `pnpm typecheck` は `stages/` を見る。`tsconfig.build.json` / `tsconfig.test.json` の
  `include` に足してあり、加えて `index.ts` が `stages/registration.ts` を re-export しているので、
  `include` が無くても tsc のプログラムには入る。
- `pnpm lint` は `stages/` を明示的に走査する。
- `pnpm test` は `stages/` を `test/stage-registration.test.ts` 経由で実行する。

## Appendix: THREE seam tests

These tests establish what the structural Three.js boundary and renderer calls
do and do not guarantee.

### `test/three-surface.test.ts`: type compatibility

`test/fixtures/three-surface.ts` を `lib: ["ES2022", "DOM"]` と**本物の `three`** に
対してコンパイルし、診断 0 件を主張する。`test/browser-input-adapter.test.ts` 末尾の
DOM 証明と同じ `inspectTypeScriptFixture` の機構である。

このテストが必要なのは、`application/three-surface.ts` の型が正しいかどうかを、
`pnpm typecheck` は原理的に判定できない。そのプロジェクトには `three` も DOM も無く、
**assignable であるべき「元」が存在しない**。実際、この 3 つはどれも
「素直な書き方」で書いて、このテストに落とされてから直したものである:

| 素直な書き方 | 落ちた理由 |
| --- | --- |
| `ThreeMesh` に `geometry` を持たせる | `Scene.add` が取るのは `Object3D` で、`Object3D` に `geometry` は無い |
| `ThreeMaterial` に `dispose` を持たせる | `Mesh` の第 2 引数は `Material \| Material[]` で、**配列に `dispose` は無い** |
| `ThreeCamera` に `aspect` を持たせる | `WebGLRenderer.render` が取るのは `Camera` で、`aspect` は `PerspectiveCamera` にしか無い |

The same test locks three adjacent facts: `tsconfig.build.json` stays on
`lib: ["ES2024"]` / `types: []`; no file in the portable root build imports
`three` (the grep is necessary because `skipLibCheck` would hide declaration
references); and the browser entry is a separate export whose published
`@types/three` dependency matches the pinned `three` major and minor version.

### `test/chunk-geometry.test.ts`: merged extent and per-face AO

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
片方だけでは定数実装が通る。

巻き順は**外積で計算して**法線と向きが揃うことを見る。転記した表と比べるのでは、
表を写し間違えたときに一緒に間違う。

golden は 1 quad 分を全バイト書き下してある。

### `test/world-renderer.test.ts`: call protocol

`test/support/fake-three.ts` を使う。**そのファイルのヘッダに、この fake が
何の代わりになっていて何の代わりにはなっていないかが書いてある。**
要点だけ再掲すると、GPU の挙動は一切モデル化していない ——
コンテキストが取れるか、何かが見えるか、巻き順・カリング・深度、
index がバッファをはみ出していないか、`dispose` が本当に解放したか。
ここでは、これらの GPU 上の性質は検証できない。

このテストは、ブラウザでは気づきにくい次の更新・解放・描画の約束を確認する。

- `setChunk` が同じ key で 2 回呼ばれたとき、mesh を**足す**のではなく**差し替える**
- `removeChunk` が `BufferGeometry.dispose()` を呼ぶ
- `draw` が **mirrored** カメラを書き込む。authoritative pose を渡す実装は
  「view bob だけが静かに効かなくなった正しく見える世界」を描く
