# テスト / 検証

## 1. plan.md が要求する検証（§3.9）

> **検証**: fixture描画 + スクリーンショット比較 +
> **内蔵ビューア（固定チャンクを読み込んでマテリアル/ポストFXを目視確認）**

3 本立てである。

| 検証 | 何を保証するか | 状態 |
| --- | --- | --- |
| fixture 描画 | 固定チャンクが描ける | 未実装（THREE.js アダプタが要る） |
| スクリーンショット比較 | 見た目が変わっていない | 未実装 |
| **内蔵ビューア** | **人間が操作して確かめられること** | 未実装 |

現在あるのはこの 3 つの**手前**、GPU を必要としない部分の単体テストだけである。
それが少ない話ではなく、§3 で述べるとおり**意図的にそこを厚くしている**。

## 2. 完了条件（plan.md §6 Step 2）

> 各リポジトリの完了条件: ユニット/シナリオテスト green + **内蔵プレビューが操作可能**

mc-render の場合、内蔵ビューアで固定チャンクを読み込み、マテリアルとポストFXを目視確認できること。
`apps/preview-*/` に置く。モジュール契約には含めない（plan.md §4.1 末尾）。

### 2.1 順序の都合

構築順は `worldgen → sim → render → kit`（plan.md §6 Step 2）。
mc-render のビューアは kit の**前**に作る必要がある——kit が mc-render に依存するので、
kit を待っていると永遠に始まらない。つまり mc-render のビューアだけは kit 無しで書く。
これは重複ではなく、kit の設計に対する最初のフィードバックになる。

### 2.2 fixture の入手元

参照実装の fixture を資産として移植する（plan.md §6 Step 2）。
チャンク fixture は `packages/rendering/test/` および mc-meshing 側のゴールデンテスト用と共通化できる。

## 3. GPU を必要としないテストを厚くする方針

**現在のソースには THREE.js が 1 行も無い。** これは設計判断で、根拠は 2 つある。

### 3.1 参照実装で「読むことでしか検査できなかった」知識をデータにする

| 知識 | 参照実装での表現 | 検査方法 | 新実装での表現 | 検査方法 |
| --- | --- | --- | --- | --- |
| ポストFXのパス順序 | `addPass` の文の並び | 目視 | `POST_PROCESSING_PASS_ORDER` 配列 | 単体テスト |
| `forceSinglePass` の要否 | 3 箇所のコメント | 目視 | `requiresForceSinglePass` 述語 | 単体テスト |
| イベント登録先の遮蔽関係 | `addEventListener` 2 行 + コメント | 目視 | `modalConsumedKeyReachesGameplay` | 単体テスト |
| フレーム毎バッファの寿命 | コメント | 目視 | `withScratch` の実行時検査 | 単体テスト |

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

## 4. 現在のテスト

`vitest run`。7 ファイル / 112 テスト。すべて `environment: 'node'`。

| ファイル | テスト数 | 対応 |
| --- | ---: | --- |
| `test/post-processing.test.ts` | 20 | DN-01 / DN-07 |
| `test/input.test.ts` | 25 | DN-04 / DN-05 / DN-08 / DN-09 |
| `test/camera-mirror.test.ts` | 13 | DN-06 |
| `test/frame-scratch.test.ts` | 12 | DN-03 |
| `test/material-policy.test.ts` | 10 | DN-02 |
| `test/kernel-mirror.test.ts` | 4 | `domain/kernel-vocabulary.ts` が mc-kernel と同形であること（§4.1） |
| `test/check-dependency-whitelist.test.ts` | 28 | DN-11 + 依存ホワイトリスト本体 |

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
している合図である。ブラウザ依存は THREE.js / `window` アダプタに閉じ込め、
アダプタの検証は §1 の 3 本立て（fixture / スクリーンショット / 内蔵ビューア）で行う。

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
  → test
  → coverage (閾値なし、アーティファクト化)
```

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
| `the window adapter registers exactly LISTENER_PLAN` | DN-04 | `window` アダプタ実装時 |
| `every listener is removed on finalizer` | DN-04 | 同上（kit の 2 枚並列でリークする） |
| `no source file in this repository reads camera.position` | DN-06 | アダプタ実装時。走査テストで |
| `blur clears gamepad and touch state too` | DN-08 | それらの実装時 |
| ワーカープールの Port 適合 / 死んだワーカーの置き換え | DN-10 | プール実装時 |
| APIロックの diff テスト | plan.md §6 Step 0-3 | publish 開始前（必須） |
| 参照実装の入力テスト 1,261 LOC の移植 | — | 入力アダプタ実装時（[porting.md](./porting.md) §6） |
