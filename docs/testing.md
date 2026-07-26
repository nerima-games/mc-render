# テスト / 検証

## 1. plan.md が要求する検証（§3.9）

> **検証**: fixture描画 + スクリーンショット比較 +
> **内蔵ビューア（固定チャンクを読み込んでマテリアル/ポストFXを目視確認）**

3 本立てである。

| 検証 | 何を保証するか | 状態 |
| --- | --- | --- |
| fixture 描画 | 固定チャンクが描ける | 未実装（THREE.js アダプタが要る） |
| スクリーンショット比較 | 見た目が変わっていない | 未実装 |
| **内蔵プレビュー** | **人間が操作して確かめられること** | 実装済（[`apps/preview-render/`](../apps/preview-render/README.md)） |
| ── うち固定チャンクの目視 | マテリアル / ポストFX の**絵**を見る | **GPU が要る。§2.2 を見ること** |

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

§3 の方針の直接の帰結である。**現在のソースには THREE.js が 1 行も無く、
`tsconfig.base.json` の `lib` に `"DOM"` も無い。**
固定チャンクを描くにはそのどちらも要る。プレビューにだけ THREE を足すことは、
ポストFXの順序・ホイールのモデル・ポインタロックの 4 値状態機械が Node で検証できる
という**機構的保証を、どこかの tsconfig が守る約束に格下げする**ことである。

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

`--stats` は数値レポートで、**8 件の発見**に file:line と再現コマンドを付けて出す。

| # | 内容 | 場所 |
| --- | --- | --- |
| RND-1 | `requested` は吸収状態。`blur` が保存し `requestPointerLock` は再送しない | `application/input-service.ts:581-585`, `:634-642` |
| RND-2 | `endFrame` がどのフレームにも報告していないホイール段を消費する | `application/input-service.ts:600`, `:672` |
| RND-3 | `blur` が `pointerLocked` を残すので、復帰クリックが `attack` になる | `application/input-service.ts:581-585` |
| RND-4 | ミラーの初期状態が自己矛盾（`UNSET` のポーズに `mirrorLagSecs = 0`） | `stages/registration.ts:170-173` |
| RND-5 | `MIRROR_LAG_WARNING_SECS` の doc が「Milliseconds」と書いている | `domain/camera-mirror.ts:160` |
| RND-6 | `RenderRegistrationLayer` が `renderModule` の引数を捨てる | `stages/registration.ts:410` |
| RND-7 | `withScratch` が捕まえるのは同一性エスケープだけ | `domain/frame-scratch.ts:167-196` |
| RND-8 | `buildPostProcessingChain` が `high` と `ultra` に同一の配列を返す | `domain/post-processing.ts:235-266` |

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

`vitest run`。10 ファイル / 277 テスト。すべて `environment: 'node'`。

| ファイル | テスト数 | 対応 |
| --- | ---: | --- |
| `test/post-processing.test.ts` | 20 | DN-01 / DN-07 |
| `test/input.test.ts` | 87 | DN-04 / DN-05 / DN-08 / DN-09 / DN-12 / DN-13 / DN-14 |
| `test/browser-input-adapter.test.ts` | 49 | `window` アダプタ。DN-04（登録と解除）/ DN-12 / DN-13 / DN-14 / DN-15 |
| `test/camera-mirror.test.ts` | 13 | DN-06 |
| `test/frame-scratch.test.ts` | 12 | DN-03 |
| `test/material-policy.test.ts` | 10 | DN-02 |
| `test/stage-registration.test.ts` | 20 | `stages/` のフレーム位置と順序制約（public-api.md §6-2）+ クリック→ロック要求（DN-14） |
| `test/kernel-mirror.test.ts` | 12 | `domain/kernel-vocabulary.ts` が mc-kernel と同形であること（§4.1） |
| `test/check-dependency-whitelist.test.ts` | 28 | DN-11 + 依存ホワイトリスト本体 |
| `test/api-lock.test.ts` | 26 | APIロック生成器 `scripts/api-lock.ts` の機構（§8 / public-api.md §8） |

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

スクリーンショット比較を入れる際は、**SwiftShader の非決定性**に注意すること。
参照実装の `playwright.config.ts` は `retries: 1` を全体に入れており、その理由をコメントしている:

```
// One retry everywhere: with 2 local workers, parallel game instances can
// starve the render loop and drop synthetic key presses across frame
// boundaries — a retry absorbs that without masking deterministic failures.
```

## 8. これから必要なテスト

[design-notes.md](./design-notes.md) の「（要追加）」印を参照。特に重要な未実装:

| テスト | 対応 | いつ |
| --- | --- | --- |
| `the THREE adapter adds passes in exactly buildPostProcessingChain order` | DN-01 | アダプタ実装時 |
| `every shared material built by the adapter passes auditMaterials` | DN-02 | 同上（起動時アサーションとして） |
| `a full frame allocates no new Map` | DN-03 | 同上 |
| `no source file in this repository reads camera.position` | DN-06 | アダプタ実装時。走査テストで |
| `blur clears gamepad and touch state too` | DN-08 | それらの実装時 |
| ワーカープールの Port 適合 / 死んだワーカーの置き換え | DN-10 | プール実装時 |
| 参照実装の入力テスト 1,261 LOC の移植 | — | 残り（[porting.md](./porting.md) §6） |

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
