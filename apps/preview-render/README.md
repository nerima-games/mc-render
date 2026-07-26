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
`pnpm lint` と `pnpm check:deps` の対象には**入っている**。

## なぜ「固定チャンクのビューア」ではないのか

[docs/testing.md](../../docs/testing.md) はこのリポジトリのプレビューを
**「固定チャンクを読み込んでマテリアルとポストFXを目視」**と定めている。
それには THREE.js アダプタと canvas と GPU が要る。**mc-render にはどれも無い。**

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
| `input` | `1` | ロック機械 / pressed / justPressed / uiClicks / ポインタ差分 / ホイール台帳 / Escape 所有 |
| `postfx` | `2` | 正典順の 8 パス、4 プリセット、composite の包含、バリデータの棄却例 |
| `material` | `3` | `forceSinglePass` の判定表と `auditMaterials` |
| `mirror` | `4` | カメラミラーの陳腐化。**クロックは操作者が動かす** |
| `scratch` | `5` | borrow / return 規律で、実際に捕まるものと捕まらないもの |
| `stages` | `6` | 5 つのステージと `after` 辺、リスナ計画 |

## 見つけたもの

`--stats` が全部を数値で出す。各項目に file:line と再現コマンドが付いている。

| # | 内容 | 場所 |
| --- | --- | --- |
| RND-1 | **`requested` は吸収状態。** `blur` が保存し、`requestPointerLock` は再送しない。セッション中もう二度とマウスルックに入れない | `application/input-service.ts:581-585`, `:634-642` |
| RND-2 | **`endFrame` が、どのフレームにも報告していないホイール段を消費する。** `Math.trunc` を 2 回別々の瞬間に取っている | `application/input-service.ts:600`, `:672` |
| RND-3 | **`blur` が `pointerLocked` を残す。** タブに戻るためのクリックが `attack` になる | `application/input-service.ts:581-585` |
| RND-4 | ミラーの初期状態が自己矛盾。`UNSET_CAMERA_POSE`（`capturedAtSecs` 0）に対し `mirrorLagSecs` はリテラル `0`（＝新鮮） | `stages/registration.ts:170-173` |
| RND-5 | `MIRROR_LAG_WARNING_SECS` の doc が「Milliseconds」と書いている。名前は `_SECS`、値は `0.1`、比較対象は秒 | `domain/camera-mirror.ts:160` |
| RND-6 | **`RenderRegistrationLayer` が `renderModule` の引数を捨てる。** ステージが別インスタンスに結び付く | `stages/registration.ts:410` |
| RND-7 | `withScratch` が捕まえるのは同一性エスケープだけ。包んで返す / クロージャ / 遅延コールバック / 直接読みはすべて素通り | `domain/frame-scratch.ts:167-196` |
| RND-8 | **`buildPostProcessingChain` は `high` と `ultra` に同一の配列を返す。** composite の入力が型に無い | `domain/post-processing.ts:235-266` |

### RND-1 —— 一番重いもの

このリポジトリは**このハザードを名前で知っている**。`PointerLockRequestOutcome` の doc
（input-service.ts:236-240）は `unavailable` という値が存在する理由を
「答えの返りようがない要求は、状態機械をセッション中ずっと `requested` に置き去りにするから」
と書いており、`test/input.test.ts:1094-1099` はそのパスを
「Leaving the machine in `requested` would strand it for the session.」というコメント付きで固定している。

**`sent` のパスには同じ穴が空いていて、何も守っていない。**

```console
$ pnpm preview --stats | sed -n '/LOCK-MACHINE/,/FINDING/p'

   after requesting, then...         state         re-ask gives
   (nothing)                         requested     requested
   blur                              requested     requested
   pointerlockchange locked=true     locked        locked
   pointerlockchange locked=false    unlocked      requested
   pointerlockerror                  refused       requested
   keydown / mousedown / wheel       requested     requested
```

`requested` から出られるのはブラウザ発の 2 イベントだけである。
要求と応答のあいだにウィンドウが blur するのは日常であり、
本来それを直すユーザジェスチャ（クリック）は、まさに
`acquiresPointerLock()` が `requested` では作用しないと決めているものである
（input-bindings.ts:678-679）。プレイヤーは歩けるし打てる。二度と見回せない。

### RND-2 —— 順序を入れ替えただけ

```console
$ pnpm preview --stats | sed -n '/WHEEL-LEDGER/,/FINDING/p'

   ordering                                        reported  consumed   carried
   both events, then snapshot, then endFrame              1         1     0.200
   one event, snapshot, the OTHER event, endFrame         0         1     0.200
```

`snapshot` は `Math.trunc(wheelNotches)` を返し（input-service.ts:600）、
`endFrame` は `Math.trunc(wheelNotches)` を引く（input-service.ts:672）。
**この 2 つの trunc は別の瞬間に取られる。** あいだに届いたホイールイベントが
2 つ目を段の境界の向こうへ押すと、フレームが知らない段が 1 つ消費される。

これは参照実装の consume-on-read `consumeMouseClick` と同じ種類のバグで、
このファイル自身が明示的に拒否したもの（input-service.ts:288-292 —
「クリックが生き残るかは誰が先に読んだかで決まる」）である。

余りを繰り越す設計（input-service.ts:664-672）は正しく、トラックパッドを使い物にしている。
足りないのは、**`endFrame` が「フレームに伝えた分」を消費すべきで、
「実行時点の累算器が言う分」ではない**ということである。

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
`apps` は `SCAN_ROOTS` に入っているので、import は `domain/` と同じゲートを通る。

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
