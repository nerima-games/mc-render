# apps/preview-render

mc-render の**内蔵プレビュー**。plan.md §6 Step 2 の「内蔵プレビューが操作可能」に対する回答。

plan.md §2.3-4「プレビューは検証対象と同居する」に従い、
**このリポジトリの中の dev アプリケーション**である。
パッケージではない。`index.ts` からは公開されない。利用側から import できない。

```console
$ pnpm preview                                              # 対話モード
$ pnpm preview --help                                       # キー割り当てとオプション
$ pnpm preview --list                                       # シナリオ一覧
$ pnpm preview --stats                                      # 数値レポート（発見はここ）
$ pnpm preview --view postfx --once --ascii                 # ポストFXチェーンを標準出力へ
$ pnpm preview --scenario stranded-request --at 10 --once --ascii
```

`pnpm verify` はこれを実行しない。ただし `pnpm typecheck`（`tsconfig.preview.json`）と
`pnpm lint` の対象には**入っている**。

## なぜ「固定チャンクのビューア」ではないのか

[docs/testing.md](../../docs/testing.md) はこのリポジトリのプレビューを
**「固定チャンクを読み込んでマテリアルとポストFXを目視」**と定めている。
それには THREE.js アダプタと canvas と GPU が要る。mc-render の THREE.js アダプタは
`src/application/three-surface.ts` に着地しているが、preview-render は意図的に terminal-only
であり、ブラウザ描画と固定チャンクの fixture は別の検証タスクとして残っている。

`tsconfig.base.json` の `lib` に `"DOM"` が無い。これが偶然ではないのは、
ポストFXの順序も、ホイールのモデルも、ポインタロックの 4 値状態機械も、
**それゆえに Node で検証できる**からである。
プレビューにだけ THREE を足すことは、その機構的保証を
「どこかの tsconfig が守ってくれる約束」に格下げすることである
（mc-worldgen のプレビューが同じ論証を長々と書いて同じ結論に達している）。

だからこのアプリは、**実際にデータとしてモデル化されているもの**をプレビューする。
それは大量にある。

## 入力状態機械が主役である理由

plan.md §3.10 は **Playwright が SwiftShader 上で動き、ポインタロックを一切扱えない**
と記録している。`application/input-service.ts:209-214` はそれを引いて、
サービス内の `canvas.requestPointerLock()` は「**何にもテストできない挙動**になる」
と結論している。

プレビューにとっての帰結はもっと鋭い。ロック状態は 4 値の機械で、その遷移が
**すべてのマウスボタン押下について、それがゲーム操作なのか UI クリックなのかを決める**
（`withButtonDown`, input-service.ts:432-435）。ブラウザテストはこの機械を駆動できない。
`test/input.test.ts` は見事に駆動しているが、**1 つの fiber の中で、テスト作者が思いついた順序で**である。

ステップ可能なプレビューは、**イベントの順序がつまみになる唯一の場所**である。
このアプリの発見のうち 2 件は、テストがたまたま逆順で発行している 2 つのイベントを
入れ替えただけのものである。

だから `readSnapshot` と `endFrame` も**イベントと同格のステップ**であり、
タイムラインにどこで落ちたかが出る。

## 6 つのビュー

| ビュー | キー | 何が見えるか |
| --- | --- | --- |
| `input` | `1` | ロック機械 / pressed / justPressed / uiClicks（**落ちた先つき**）/ ポインタ差分 / ホイール台帳 / Escape 所有 |
| `postfx` | `2` | 正典順の 8 パス、4 プリセット、composite の包含、バリデータの棄却例 |
| `material` | `3` | `forceSinglePass` の判定表と `auditMaterials` |
| `mirror` | `4` | カメラミラーの陳腐化。**クロックは操作者が動かす** |
| `scratch` | `5` | borrow / return 規律で、実際に捕まるものと捕まらないもの |
| `stages` | `6` | 5 つのステージと `after` 辺、リスナ計画 |

## `hud-click` シナリオ —— DN-16 §5(b)

`l` / `r` / `m` はどれも **canvas 上の**クリックである。`u` は**ホットバーのスロット上**、
`n` は**どちらでもない場所**（レターボックスなど）。3 つとも `uiClicks` に入るが、
`acquiresPointerLock` が作用するのは 1 つ目だけである。

`input` ビューの「a left click」行が両方を並べて出す:
`on the canvas -> yes` / `on a HUD slot -> no`。
`--scenario hud-click` はその往復を歩く——スロットにフォーカスが入り（リング点灯）、
スロットをクリックしてもロックを取らず、canvas をクリックすると取り、
ロック中はリングが**マスク**され、Escape で**同じスロットに戻る**。

## 見つけたもの

`--stats` が全部を数値で出す。**8 件のうち 6 件は修正済み、2 件は「直さない」と決めて
テストで固定した。** `--stats` の数字は、見つけるための数字から、戻っていないことを確かめる
数字になった —— そして `--stats` の行はピンではないので、保留分にも `test/` のテストがある。

| # | 内容 | 状態 |
| --- | --- | --- |
| RND-1 | **`requested` は吸収状態だった。** `blur` が保存し、`requestPointerLock` は再送しない。セッション中もう二度とマウスルックに入れない | **修正** |
| RND-2 | **`endFrame` が、どのフレームにも報告していないホイール段を消費していた。** `Math.trunc` を 2 回別々の瞬間に取っていた | **修正** |
| RND-3 | **`blur` が `pointerLocked` を残していた。** タブに戻るためのクリックが `attack` になる | **修正** |
| RND-4 | ミラーの初期状態が自己矛盾。最初の pose が届く前を `undefined` で表さず、`UNSET_CAMERA_POSE`（`capturedAtSecs` 0）を新鮮と表示していた | **修正** |
| RND-5 | `MIRROR_LAG_WARNING_SECS` の doc が「Milliseconds」と書いていた。名前は `_SECS`、値は `0.1`、比較対象は秒 | **修正** |
| RND-6 | **`RenderRegistrationLayer` が `renderModule` の引数を捨てていた。** ステージが別インスタンスに結び付く | **修正（削除）** |
| RND-7 | `withScratch` が捕まえるのは同一性エスケープだけ。包んで返す / クロージャ / 遅延コールバック / 直接読みはすべて素通り | **修正** |
| RND-8 | **`buildPostProcessingChain` が `high` と `ultra` に同一の配列を返していた。** composite の入力が型に無い | **修正** |

各行がどのテストに固定されたかは [`docs/testing.md`](../../docs/testing.md) §2.2 にある。

### RND-1 —— 一番重かったもの

このリポジトリは**このハザードを名前で知っていた**。`PointerLockRequestOutcome` の doc は
`unavailable` という値が存在する理由を
「答えの返りようがない要求は、状態機械をセッション中ずっと `requested` に置き去りにするから」
と書いており、`test/input.test.ts` はそのパスを
「Leaving the machine in `requested` would strand it for the session.」というコメント付きで固定していた。

**`sent` のパスには同じ穴が空いていて、何も守っていなかった。**

```console
$ pnpm preview --stats | sed -n '/LOCK-MACHINE/,/^$/p'

   after requesting, then...         state         re-ask gives
   (nothing)                         requested     requested
   blur                              unlocked      requested      <- 以前は requested / requested
   pointerlockchange locked=true     locked        locked
   pointerlockchange locked=false    unlocked      requested
   pointerlockerror                  refused       requested
   keydown / mousedown / wheel       requested     requested
```

`requested` から出られるのはブラウザ発の 2 イベントだけだった。
要求と応答のあいだにウィンドウが blur するのは日常であり、
本来それを直すユーザジェスチャ（クリック）は、まさに
`acquiresPointerLock()` が `requested` では作用しないと決めているものである。
プレイヤーは歩けるし打てる。二度と見回せない。

`blur` は `unlocked` に落ちる。`refused` ではない —— ブラウザは何も拒否していない、
要求が放棄されただけである。`refused` は UI が「もう一度クリックして見回してください」と
描くための状態で、`pointerlockerror` と「そもそもポインタロックの無いプラットフォーム」専用である。
既にある `refused` は blur を生き延びる（「次に *要求* があるまで sticky」だから）。

### RND-2 —— 順序を入れ替えただけ

```console
$ pnpm preview --stats | sed -n '/WHEEL-LEDGER/,/^$/p'

   ordering                                        reported  consumed   carried
   both events, then snapshot, then endFrame              1         1     0.200
   one event, snapshot, the OTHER event, endFrame         0         0     1.200
```

2 行目は以前 `0 / 1 / 0.200` だった。`snapshot` は `Math.trunc(wheelNotches)` を返し、
`endFrame` は `Math.trunc(wheelNotches)` を引いていた。
**この 2 つの trunc は別の瞬間に取られる。** あいだに届いたホイールイベントが
2 つ目を段の境界の向こうへ押すと、フレームが知らない段が 1 つ消費される。
参照実装の consume-on-read `consumeMouseClick` と同じ種類のバグで、
このファイル自身が明示的に拒否したもの
（「クリックが生き残るかは誰が先に読んだかで決まる」）である。

余りを繰り越す設計は正しく、トラックパッドを使い物にしている。
足りなかったのは、**`endFrame` が「フレームに伝えた分」を消費すべきで、
「実行時点の累算器が言う分」ではない**ということだった。

修正は `endFrame(frame?)` —— フレームが読んだスナップショットを**返してもらう**。
サービスに覚えさせなかったのは意図的である。`snapshot` が報告値を記録したら、
デバッグオーバーレイや **このアプリ**（1 ステップごとにアナログパネルを描き直す）が
次の `endFrame` の消費量を変えてしまい、計器が自分の観測対象を動かすことになる。
`snapshot` は純粋な読み取りのまま、契約は型に置いた ——
**読んでいないスナップショットでフレームを閉じることはできない。**
引数を省くと「このフレームはホイールを読んでいない」＝ 0 消費で、
誰も作用していない移動量は次のフレームに繰り越される。

### RND-8

`high` と `ultra` は**パス順が同じ**である。違いは composite シェーダが何を合成するかで、
それが返り値の型に無かった。チェーンは `PostProcessingStep`（`{ pass, effects }`）のリストになり、
`effects` は通常のパスでは `[pass]`、`composite` では包摂されたパスの一覧になる ——
アダプタがパスを組み立てるその瞬間に手元にある値の中に入っている。
順序チェッカが取る射影が `chainPasses`。

```console
   preset    passes  chain
   low       2       render -> output
   medium    2       render -> output
   high      5       render -> gtao -> composite{bloom} -> smaa -> output
   ultra     5       render -> gtao -> composite{godRays+bloom+bokeh} -> smaa -> output
```

### RND-6 —— 直さずに消した

`RenderRegistrationLayer` は引数を取るようにしても直らない。`InputServiceLayer` は
`Layer.effect` なので `Effect.provide` ごとに新しいサービスを組み立てる ——
**正しい Layer を 2 回使っても 2 台の機械になる**（`--stats` の最後の 2 行がそれ）。
単体の Layer 定数や Layer を返す関数は、手元にあること自体が「別々に provide する」誘いである。
`GameModule` は、その間違いを書けなくする形だった: `module.layers` を **1 回**
provide し、`frameStages` はその中から取る。

### RND-4 / RND-7 —— lease と未初期化状態を機構化した

- **RND-4**: `MirroredCameraState.sourceCapturedAtSecs`、`mirrorLagSecs`、
  `RenderFrameState.authoritativePose` を optional にし、mc-sim の最初の pose が届くまでを
  「未初期化」として表現する。時計を読むステージの責務は変わらない。
- **RND-7**: `withScratch` は native `Map` を公開せず、scratch ごとに一度だけ作る
  lease-checked view を渡す。view / wrapper / closure / iterator / deferred Effect の
  lease 後アクセスを `ScratchMisuseError` にし、持ち出しは `snapshotScratch` に限定する。

## クロックを読んでいない

カメラミラーの陳腐化は、注入した `MonotonicTimeSecs` に対して測られる。
このアプリはその数値を保持し、操作者が `+` / `-` で動かす。
`MIRROR_LAG_WARNING_SECS` は待つのではなく**意図して跨ぐ**。

`Date.now()` / `new Date()` / `performance.now()` はこのアプリのどこにも無い。
`mc-kernel-allow-time-source` エスケープハッチは使っていない。

## このアプリが見せられないもの

**GPU が要るものすべて。** ポストFXチェーンは見せられるが、それが作る絵は見せられない。
マテリアルポリシーは見せられるが、マテリアルは見せられない。カメラミラーは見せられるが、視界は見せられない。

THREE アダプタができたら、固定チャンクの目視テストはその隣に置くのが正しく、
そのときは mc-playground-kit が要る。**ここにあるのはその代わりではない。**
GPU 無しで確かめられる半分であり、入力状態機械にいたっては
**他に置き場所が無い**（Playwright はポインタロックを扱えない）。

## 依存

**このリポジトリ自身のモジュールと `effect` だけ。**
`effect` は既に `dependencies` にある。org パッケージも新規 npm 依存も THREE も無い。
`tsconfig.preview.json` と `pnpm lint` がアプリの import / 型境界を検証し、package の公開面は
`src/index.ts` からのみ構成する。

## ファイル

```
main.ts        エントリ、キー処理、--once / --stats / --list
options.ts     CLI パーサ（純粋）
script.ts      シナリオ定義（データのみ。何も実行しない）
machine.ts     InputService 1 つ + ミラー + 操作者のクロックを 1 イベントずつ進める
views.ts       6 つのビュー（純粋。MachineView と Style だけの関数）
probes.ts      --stats の数値レポート
style.ts       色と整形（純粋）
terminal.ts    このアプリで唯一の非純粋モジュール（Node の stdio）
```
