# アーキテクチャ

## 1. 4階層

plan.md §2.2 の 4 階層。**リポジトリ = 検証・リリースの単位**であり、パッケージ（依存境界）や
プレビュー（起動）とは別の単位である（plan.md §2.4。混同しないこと）。

| 階層 | リポジトリ | 性質 |
| --- | --- | --- |
| 安定ライブラリ | kernel / noise / meshing / physics / save / audio | 純粋関数・狭い界面・変更頻度が低い。相互独立で並行構築可能 |
| **基盤** | worldgen / sim / **render** / kit | 状態とサービス（**名詞**）。体験モジュールが乗る土台 |
| 体験モジュール | gameplay / redstone / ui / multiplayer | ルールとUI（**動詞**）。互いを知らず、基盤サービス経由でのみ会話 |
| 合成 | compose | Layerマージ + stage順序表 + E2E。ロジックを持たない |

mc-render は**基盤**。plan.md §7 の機能カバレッジ表で「描画・ポストFX・パーティクル・投射物トレーサー」と
「実行時入力（キーボード/マウス/ポインタロック/タッチ/リマッピング）」の**両方**を割り当てられている唯一のリポジトリである。

## 2. 依存グラフ全体（16リポジトリ）

実線 = 実行時依存（`dependencies`）、点線 = プレビュー起動時のみ（`devDependencies`）。
`mc-kernel` はどこからでも import 可能なため、矢印は引くが許可リストには書かない。

```mermaid
graph BT
  kernel["mc-kernel<br/>core + block + Chunk型 + 能力フラグ"]
  noise["mc-noise<br/>ノイズ/密度関数"]
  meshing["mc-meshing<br/>グリーディメッシング"]
  physics["mc-physics<br/>Euler + AABB"]
  save["mc-save<br/>永続化ツールキット"]
  audio["mc-audio<br/>WebAudio + キュー + 字幕"]
  worldgen["mc-worldgen<br/>地形/構造物生成"]
  sim["mc-sim<br/>entity + inventory + game"]
  render["mc-render<br/>描画 + 入力サービス"]
  kit["mc-playground-kit<br/>共通操作ハーネス"]
  gameplay["mx-gameplay<br/>採掘 / Mob / 流体 / 昼夜"]
  redstone["mx-redstone<br/>レッドストーン"]
  ui["mx-ui<br/>HUD / メニュー / インベントリUI"]
  multiplayer["mx-multiplayer<br/>ネットワーク同期"]
  compose["mc-compose<br/>合成 + QA + E2E"]
  devmeta["mc-dev-meta<br/>開発用 workspace"]

  noise --> kernel
  meshing --> kernel
  physics --> kernel
  save --> kernel
  audio --> kernel
  worldgen --> kernel
  worldgen --> noise
  worldgen --> save
  sim --> kernel
  sim --> physics
  sim --> save
  sim --> worldgen
  render --> kernel
  render --> meshing
  render --> sim
  render --> worldgen
  kit --> kernel
  kit --> worldgen
  kit --> sim
  kit --> render
  gameplay --> sim
  gameplay --> worldgen
  gameplay --> audio
  gameplay -.-> kit
  redstone --> sim
  redstone --> worldgen
  redstone -.-> kit
  ui --> sim
  ui --> audio
  multiplayer --> sim
  compose --> gameplay
  compose --> redstone
  compose --> ui
  compose --> multiplayer
  compose --> render

  style render fill:#ffd,stroke:#a80,stroke-width:3px
```

### 15 と 16 の数え方

plan.md の見出しと §2.4 は「**15 リポジトリで固定**」と書き、§6 Step 0 が別途
`mc-dev-meta` workspace の作成を指示している。つまり:

- **ゲームを構成するリポジトリ = 15**（kernel / noise / meshing / physics / save / audio /
  worldgen / sim / render / kit / gameplay / redstone / ui / multiplayer / compose）
- **依存ホワイトリストが知るべきリポジトリ = 16**（上記 + `mc-dev-meta`）

`REPOSITORY_POLICY.dependencyGraph` は後者の 16 行を持つ。dev-meta は依存を 1 つも持たず
（`repos/` に clone を並べるだけ）、誰からも依存されないため、循環検査には影響しない。
行を置くのは「16 リポジトリ全部について、意図が記録されている」状態にするためである。

`mc-dev-meta` は 15 リポジトリの clone を `repos/` に並べて 1 つの pnpm workspace として
束ねる薄いリポジトリで、開発中は `workspace:*` 解決でモノレポ同等の DX を得る。
npm 公開・バージョン bump 運用は界面安定（APIロック 4 週間無変更）まで開始しない（plan.md §6 Step 0-2）。

このリポジトリは組織全体の依存グラフを生成・検査しない。ここで守る直接依存の境界は
`package.json` と `.oxlintrc.json` にあり、`pnpm lint` が禁止された package import を検査する。
組織全体のグラフを更新した場合は、その変更を行ったリポジトリ側の検証結果を別途確認する。

## 3. mc-render の位置

### 3.1 親（mc-render が import してよいもの）

| 依存先 | 何をもらうか |
| --- | --- |
| `mc-kernel` | 共有語彙。**どのリポジトリからも import 可**。ただし `package.json` の `dependencies` への記載は必要 |
| `mc-meshing` | `mesh(chunk, neighbors, config) → {opaque, water, transparentSolid}` |
| `mc-sim` | `CameraPoseSnapshot`、描画すべき状態（チャンクダーティ購読は mc-worldgen） |
| `mc-worldgen` | `Chunk` データ、ライトグリッド（BFS光伝播の結果。**適用**がこちらの責務） |

### 3.2 子（mc-render に依存するもの）

`mc-playground-kit` と **`mc-compose`**。

compose のエッジは縦切りスパイクで足されたものである。それ以前は kit だけが mc-render を
依存に持ち、kit は devDependency 専用なので実行時エッジを作らない。つまり
**mc-render は動いているゲームからどこからも到達できなかった**。

それは抽象的な問題ではなかった。`InputService.endFrame` はフレーム毎にちょうど 1 回
呼ばれなければならず、それは定義上 stage である。ところがロスター全体で登録されていた入力 stage は
kit の `input:sample` だけで、**出荷ビルドには入力 stage が存在しなかった**。
plan.md §2.3-2 が防ぐために書かれた失敗そのものである。詳細は
`mc-compose/docs/architecture.md` §5 と、本リポジトリの `stages/stage-ids.ts`。

kit のほうも「界面が安定しなくてよい」という意味ではない。kit は全プレビューの土台であり、
kit が壊れると 15 リポジトリの完了条件（「内蔵プレビューが操作可能」）が全部止まる。

### 3.3 推移閉包は禁止

`mc-render → mc-sim` だが、**mc-render は mc-physics を import できない**。
レンダラはシミュレーションが「真である」と言ったものを描くのであって、
衝突判定をやり直さない。やり直せば「描かれている世界」と「シミュレートされている世界」が
同じ問いへの独立した 2 つの答えになり、必ず食い違う。

同様に `mc-save` も推移依存であり import 禁止。レンダラはセーブファイルを読まない。
`.oxlintrc.json` の restricted-imports と package の型検査が、この境界を検証する。

## 4. 構成の成立条件（plan.md §2.3）

### 4.1 §2.3-1 基盤 = 名詞、体験 = 動詞

mc-render は**名詞**の側。「どう見えるか」の仕組みを持ち、「何が起きるか」のルールは持たない。

| 置く（名詞） | 置かない（動詞。mx-gameplay 等へ） |
| --- | --- |
| `InputService`（キーが押されているという**状態**） | 「W を押したら歩く」 |
| `WorldRenderer`（チャンクをメッシュにして描く） | 「掘ったらブロックが消える」 |
| ポストFXチェーン（品質設定に応じたパスの並び） | 「夜になったら暗くなる」 |
| パーティクルの描画機構 | 「爆発したらパーティクルを出す」 |

**入力の扱いに注意。** `InputService` が答えるのは「`moveForward` に割り当てられたキーが今押されているか」
までであり、「だから前に進む」は mc-sim（状態遷移）と mx-gameplay（ルール）の仕事である。
plan.md §4.2 の stage 順序 `input → simulation → ...` は、この境界が実行順序として現れたものである。

### 4.2 §2.3-2 mc-playground-kit は devDependency 専用 — **本リポジトリの存在理由**

plan.md §2.3-2 の原文:

> **実行時入力サービスは mc-render が所有。** kit は devDependency 専用のため、
> kit に入力を置くと本番ゲームから入力が消える。kit の役割は
> 「ミニ世界 + カメラ + レンダラ + 入力を1秒で束ねる糊」に限定

kit は出荷ビルドに入らない。もし実行時入力サービスが kit にあったら、リリースビルドは
**ビルドが通り、起動し、描画し、キーボードを完全に無視する**。コンパイル時に無音で、
実行時に全損。これが最悪の組み合わせであり、だから機械的に防いでいる。

| 違反 | 現行の検証 |
| --- | --- |
| 出荷依存に kit がある | `package.json` の依存宣言をレビューする |
| 出荷ソースから kit を import | `pnpm lint` の restricted-imports と `pnpm typecheck` |

kit は実行時エッジを作らないため依存グラフの循環には参加しない。
この package は kit を依存に持たず、preview の統合は `apps/preview-render/` に閉じている。

**逆向きの誤解に注意**: 制約は「誰が kit に依存してよいか」についてのものである。
kit 自身が mc-render に依存するのは正常な実行時依存であり、何も問題はない。

### 4.3 §2.3-3 stage 実行順序表は compose が唯一所有

各モジュールは `StageRegistration` で**順序制約（`after`）を宣言するだけ**であり、
全順序は mc-compose が解決する（plan.md §4.1 / §4.2）。

標準 stage 順序（plan.md §4.2）:

```
input → simulation(physics → interactions → entities → fluids → redstone → time/weather)
      → camera-mirror → chunk-sync → render → post-fx → hud-sync
```

**この 8 段のうち 5 段が mc-render の担当**（`input` / `camera-mirror` / `chunk-sync` /
`render` / `post-fx`）だが、**mc-render はこの表を持たない**。`after` 制約を宣言するだけである。

読み取れることが 2 つある。

1. **`camera-mirror` は `simulation` の後**。姿勢は sim が確定させてから render がミラーする。
   逆順にすると 1 フレーム古い姿勢を描くことになり、参照実装の逆転構造が実行順序の形で復活する。
2. **`post-fx` は `render` の直前にチェーンを選択する独立段**。`domain/post-processing.ts` の
   チェーン順序はこの段の**内部**の話で、選択済みの計画を `DrawPort` へ渡す。実際の
   `EffectComposer` pass 生成・実行はブラウザ adapter の責務であり、stage 順序表とは別物である。

### 4.4 §2.3-4 プレビューは検証対象と同居

mc-render の内蔵プレビューは **fixture ビューア**（固定チャンクを読み込んでマテリアル / ポストFX を
目視確認）であり、`apps/preview-*/` に置く。UI だけの独立リポジトリは作らない。

## 5. カメラ所有権 — mc-render は正ではない

plan.md §5.1-2「カメラ姿勢は sim 所有」。詳細と参照実装の証跡は
[design-notes.md](./design-notes.md) の DN-06。ここでは構造だけ。

```
【参照実装（誤り）】                     【新設計】
  sim ──yaw/pitch──▶ THREE.Camera        sim ──CameraPoseSnapshot──▶ render
   ▲                      │                                            │
   └──position/direction──┘                                       THREEカメラへ
       （13箇所が読み戻す）                                  ミラーするだけ（書き戻し無し）
```

構造的保証は**依存の向き**である。`mc-render → mc-sim` があるため `mc-sim → mc-render` は循環になり、
package の依存境界レビューで許可しない。mc-sim には「レンダラに問い合わせる」という選択肢が
そもそも存在しない。

攻撃スイングのバンプのような演出は、ミラーした姿勢の**上に**適用し、mc-sim には戻さない。
`domain/camera-mirror.ts` の `ViewOffset` がその置き場である。

## 6. なぜ出荷ソースは THREE.js を直接 import しないのか

**意図的**である。`src/domain/` は純粋な値と関数を持ち、`src/application/` は
Three.js の実装型を構造的な port の裏側に閉じ込める。GPU を使う実装境界を分離することで、
Node の型検査と単体テストを保てる。

| 本来 THREE.js に埋まっている知識 | ここでの表現 | 効果 |
| --- | --- | --- |
| `composer.addPass()` の呼び出し順 | `POST_PROCESSING_PASS_ORDER` 配列 + 検証関数 | 順序バグが GPU 無しの単体テストで落ちる |
| どのマテリアルに `forceSinglePass` が要るか | `requiresForceSinglePass` 述語 | マテリアルを名指しせず**規則**で表現できる |
| どのイベントをどこに登録するか | `LISTENER_PLAN` + `GAMEPLAY_LISTENER_TARGET` | window/document の遮蔽関係を DOM 無しで assert できる |
| フレーム毎の一時オブジェクト再利用 | `withScratch` | 「バッファがフレームを跨いで逃げた」を実行時に検出できる |

これらは全部、参照実装では**文の並び順**にしか書かれておらず、読むことでしか検査できず、
GPU が無いとテストできなかった知識である。データにすると `environment: 'node'` で固定できる。

THREE.js アダプタの仕事は、これらのデータを読んで `composer.addPass` を呼ぶだけになる。
順序を間違えるには、GPU 不要のテストを落とすしかない。

`tsconfig.base.json` の `lib` に **`"DOM"` は入っていない。`window` 入力アダプタが入った後もである。**
アダプタが実際に触る DOM メンバは 8 個しかないので、`application/dom-surface.ts` に
**構造的な型**として書いてある。1 つのアダプタのために全ファイルから
「`environment: 'node'` で検査できる」という歯止めを外すのは高すぎ、
しかも plan.md §3.10 によりブラウザ側にも逃げ場が無い（Playwright はポインタロック不可）。
実物の `Window` が**キャスト無しで**適合することはテストで証明してある
（[design-notes.md](./design-notes.md) DN-15、[testing.md](./testing.md) §8.1）。

`"DOM"` / `"WebWorker"` を入れるかどうかは最初の THREE.js アダプタで改めて議論する。
THREE のクラス階層は「メンバ 8 個」ではない（[versioning.md](./versioning.md) §5）。
