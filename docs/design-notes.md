# 設計注意

plan.md §3.9「設計注意（参照実装の実測知見）」の全項目を、参照実装の証跡（file:line）付きで展開し、
**それぞれを「書くべき回帰テスト」として名前で表現**したもの。

パスは `takeokunn/ts-minecraft` リポジトリルート相対。
「状態」列: **済** = 本リポジトリに回帰テストがある / **要** = 本実装時に必須 / **将来** = 該当機能の実装時に。

| ID | 設計注意 | 状態 |
| --- | --- | --- |
| DN-01 | ポストFXの確定順序 | 済 |
| DN-02 | 共有 transparent + DoubleSide には `forceSinglePass` | 済 |
| DN-03 | フレーム毎の一時 `Map` は事前確保して再利用 | 済 |
| DN-04 | 入力は `window` 登録。モーダルは `document` で stopPropagation | 済 |
| DN-05 | Escape キーの所有者はフレーム側の単一ハンドラ | 済 |
| DN-06 | カメラ姿勢は mc-sim 所有。ここはミラー | 済 |
| DN-07 | GTAOPass は無効時も VRAM を食う。作らない | 済（部分） |
| DN-08 | 入力サービスは blur で保持キーをクリア | 済 |
| DN-09 | ポインタロック解除時にデルタを捨てる | 済 |
| DN-10 | ワーカープールは Port と実装を分ける | 要 |
| DN-11 | `Date.now()` を使わない | 済 |
| DN-12 | クリックはロック状態で意味が変わる。`contextmenu` はロック中のみ抑止 | 済 |
| DN-13 | ホイールはエッジでもレベルでもなくデルタ。単位はドメインで正規化する | 済 |
| DN-14 | ポインタロックは要求であり、拒否されうる。`unlocked` と `refused` は別 | 済 |
| DN-15 | DOM は `lib` ではなく**狭い構造的インターフェース**で受ける。`lib.DOM` を入れない | 済 |

---

## DN-01 ポストFXの確定順序

### plan.md §3.9

> ポストFXの確定順序: RenderPass → GTAO → GodRays → Bloom → Bokeh(DoF) → SMAA → Output

### 参照実装の証跡

唯一のコンポーザ構築箇所
`packages/app/application/main/session-post-processing.ts` の `comp.addPass(...)` 呼び出し順:

| 行 | パス | 条件 |
| ---: | --- | --- |
| :51 | `RenderPass` | 無条件 |
| :63 | `GTAOPass` | `ssaoEnabled` |
| :76 | `GodRaysPass` | `godRaysEnabled && !compositeActive` |
| :94 | `UnrealBloomPass` | `bloomEnabled && !compositeActive` |
| :110 | `BokehPass` | `dofEnabled && !compositeActive` |
| :127 | **`CompositePass`** | `compositeActive` |
| :137 | `SMAAPass` | `smaaEnabled` |
| :142 | `OutputPass` | 無条件 |

**plan.md は `CompositePass` を落としている。** これは実在する 8 段目で、ultra プリセットでは
Bloom + GodRays + Bokeh を 1 枚のフラグメントシェーダに統合し、個別パスを無効化する。
位置は参照実装が明記している（:115-117）:

```
// CompositePass (new): single fragment shader for bloom + godRays + bokeh.
// Inserted AFTER the individual passes (which are no-ops when active) and
// BEFORE SMAA so anti-aliasing operates on the final composited image.
```

プリセット対応（:24-28）:

```
low    → CompositePass disabled (no effects), individual passes disabled
medium → CompositePass disabled, individual passes disabled
high   → CompositePass enabled with { bloom:true }; individual bloom disabled
ultra  → CompositePass enabled with { bloom, godRays, bokeh }; individual passes disabled
```

有効化条件（:41-43）: `compositeActive = useCompositePass && compositeFlagsAnyEnabled(flags)`。
**何も合成しない CompositePass は全画面 read/write の無駄**なので、第 2 項が要る。

`resolveCompositeFlags` / `compositeFlagsAnyEnabled` の実体は
`packages/rendering/infrastructure/post-processing/composite-pass.ts:263-274` にあり、
プリセットの真偽値をそのまま写すだけである（`bloom ← bloomEnabled` /
`godRays ← godRaysEnabled` / `bokeh ← dofEnabled`、3 つの `||`）。

### プリセット表の正（`GRAPHICS_PRESETS`）

上の `:24-28` のコメントは**どのパスが ON か**しか書いておらず、OFF 側を確定できない。
プリセット値の正は `packages/game/application/settings-service.config.ts` の
`GRAPHICS_PRESETS` 定数（末尾の `resolvePreset` が読み、`session-post-processing.ts` が
`initialGraphics` として受け取る）である。ポストFX に効くフィールドだけ抜くと:

| プリセット | ssao | godRays | bloom | dof | smaa | composite |
| --- | --- | --- | --- | --- | --- | --- |
| low | false | false | false | false | false | false |
| medium | false | false | false | false | **false** | false |
| high | true | false | true | false | true | true |
| ultra | true | true | true | true | true | true |

**`medium` の `smaaEnabled` は `false`。** medium は低スペック向けの「バランス」既定値で、
追加するのは影と空だけである。SMAA はフル解像度のポストパスなので high / ultra 専用。
`settings-service.config.ts` 冒頭が調整方針を明記している:

```
low:    no post-processing, no sky, no shadows (low-spec default, DPR 0.5)
medium: + shadows + sky (balanced, DPR 1.25)
high:   + bloom (HDR), higher DPR, crisper shadows
ultra:  + god rays + dof + max DPR (maximum quality)
```

`useCompositePass`（FR-4.3）についても同ファイルが理由を書いている:

```
Only enabled on presets that actually use HDR effects (high/ultra) — on
low/medium the CompositePass would have no inputs to composite
```

これは上記 `isCompositeActive` の第 2 項そのものである。

移植していないが**順序に隣接するため記録しておく 2 点**:

- `composerRtType` は low/medium の `THREE.UnsignedByteType`(1009) から
  high/ultra で `THREE.HalfFloatType`(1016) に変わる。bloom が HDR レンダーターゲットを
  必要とするためで、bloom を有効にしながら HDR ターゲットにしないプリセットは、
  bloom が拾うはずのハイライトを先にクリップしてしまう。
- FR-4.3 の統合による削減量は同ファイルで **~25 MB/frame の帯域**と記録されている。
  8 段目が存在する理由そのもの。

### 各エッジの理由

| エッジ | 理由 |
| --- | --- |
| GTAO が色を触る全パスより前 | AO は RenderPass 直後の生の深度/法線バッファを必要とする。ブラー後に走らせると、bloom で明るくした窪みを暗くする |
| GodRays → Bloom | 光条は bloom に拾わせて光らせる。逆順だと閾値パスの後に足されるので永遠に光らない |
| Bloom → Bokeh | DoF は画面上のもの（光の滲みを含む）をぼかす。ぼかし→光らせだと、ボケた領域が再び鮮鋭になる |
| CompositePass → SMAA | アンチエイリアスは**最終合成画像**を見る必要がある。参照実装 :115-117 |
| SMAA は最後から2番目 | SMAA の後に何かを足すと、除去したエイリアシングが戻る |
| Output は必ず最後 | トーンマッピングと色空間変換。この後に走るパスは display-referred 値を操作することになる |

### 新設計の方針

**チェーンをデータとして表現する。** 参照実装ではこの知識が「builder 関数の文の並び順」にしか
書かれておらず、読むことでしか検査できず、GPU 無しではテストできなかった。
`domain/post-processing.ts` は配列 `POST_PROCESSING_PASS_ORDER` と
純粋関数 `validatePostProcessingChain` にしてあるので、`environment: 'node'` で固定できる。

THREE.js アダプタの仕事は `buildPostProcessingChain` の出力（`PostProcessingStep` の列。
`composite` はそれが合成するエフェクト一覧を `effects` に持つ）を歩いて `composer.addPass` を
呼ぶだけになる。順序を間違えるには GPU 不要のテストを落とすしかない。

### 書くべき回帰テスト

`test/post-processing.test.ts`（20 テスト）。

| テスト名 | 内容 |
| --- | --- |
| `is exactly the reference implementation addPass sequence` | 8 要素の配列そのもの |
| `GodRays runs BEFORE Bloom, so its streaks get picked up by the glow` | |
| `Bokeh runs AFTER Bloom, so depth of field blurs the glow rather than the reverse` | |
| `GTAO runs before every colour effect, while depth and normals are still raw` | |
| `SMAA is second to last: it must anti-alias the FINAL composited image` | |
| `REGRESSION: replaces bloom, godRays and bokeh — never runs alongside them` | ultra で 3 パスが消える |
| `is only active when it actually has something to composite` | `compositeFlagsAnyEnabled` 相当 |
| `REGRESSION: rejects SMAA before Bloom` / `rejects Bokeh before Bloom` / `rejects anything after output` | 検証関数側 |
| `every one of the 64 on/off combinations produces a canonical chain` | 6 bool の**全数**。1 組合せだけ壊れるバグは開発者より先にプレイヤーに届く |
| **（要追加）** `the THREE adapter adds passes in exactly buildPostProcessingChain order` | アダプタ実装時。`addPass` のスパイで assert |

---

## DN-02 共有 transparent + DoubleSide には `forceSinglePass`

### plan.md §3.9

> 共有マテリアルの transparent + DoubleSide には `forceSinglePass`
> （アイドルスタッターの原因。p95 33ms→9.2ms の実測）

### 参照実装の証跡

診断の全文（`packages/rendering/infrastructure/meshing/chunk-mesh-materials.ts:145-150`）:

```
// forceSinglePass: Three.js renders transparent+DoubleSide materials in TWO
// passes (back then front faces), setting material.needsUpdate per pass. On a
// material SHARED by every glass/leaves chunk mesh that version bump forces a
// shader-program re-resolution for all sharers each frame (measured ~15k
// getParameters calls/3s at idle). Cutout foliage gains nothing from the
// two-pass ordering, so render single-pass like vanilla.
```

### 数値の出所（**訂正**: 以前「未検証」と書いたのは誤り）

本書は以前 `p95 33ms → 9.2ms` を「plan.md の主張。参照実装のソース・テスト・計測出力の
いずれにも裏付けが無い」と記録していた。**その判定は誤りである。**
追跡対象のファイルだけを全文検索して結論を出しており、**コミットメッセージを見ていなかった**。

一次出典は参照実装のコミット `d51c5ba7`
（`perf(gfx): kill idle-frame stutter — forceSinglePass on shared transparent DoubleSide materials`）である:

```
Measured before/after (idle, settled world):
- p95 frame time 25-33ms -> 9.2ms; p99 34-42ms -> 9.3ms
- frames >33ms per 8s: 19-23 -> 1; fps 84-94 -> display-capped 119
- getParameters+getProgram self time 323ms/8s -> 0ms
```

| 数値 | 出所 | 扱い |
| --- | --- | --- |
| `~15k getParameters calls / 3s at idle` | 参照実装のソースコードの実測値コメント（`chunk-mesh-materials.ts:145-150`、上に全文引用） | コード検証済み |
| `p95 25-33ms → 9.2ms` / `p99 34-42ms → 9.3ms` | 参照実装のコミット `d51c5ba7` のメッセージ（"Measured before/after (idle, settled world)"） | **実測。ただし再実行はできない**（下記） |

**plan.md §3.9 は 25–33ms の範囲の悪いほうの端だけを取って「33ms」と書いている。**
これは捏造ではないが、範囲の端点を単一の測定値として提示したものである。
`p95 33ms → 9.2ms` という書き方は改善幅を最大に見せる。範囲で引くこと。

**再現可能性についての限定は残る。** ベンチマークスクリプトも計測出力もコミットされておらず、
条件（idle、settled world、8 秒窓、当時の実機とディスプレイ）を揃えて再実行する手段は無い。
**由来は明確・再現手段は無い**、が正しい記述である。
検索だけでは見つからない理由も記録しておく: 追跡ファイル側で `33ms` / `9.2ms` に
ヒットするのは `packages/app/application/main/qa-api-perf.ts:22,97` の `over33ms` カウンタと
`packages/app/application/frame/frame-budget.test.ts:17` の「120 FPS で ~8.33ms」だけで、
どちらも本件の測定ではない。**追跡ファイルに無いことは「裏が無い」ことを意味しない。**

なお `domain/material-policy.ts` の診断メッセージには `33ms -> 9.2ms` の文字列を**残してある**。
これは次に読む人が「ただの最適化」と思って外さないための動機付けである。
文字列そのものは plan.md §3.9 の表記に合わせてあるが、
典拠と正確な範囲は上表（コミット `d51c5ba7`）である。

### 適用箇所

参照実装で `forceSinglePass: true` が立っているのは 4 箇所:

| 箇所 | マテリアル | 共有か | `alphaTest` |
| --- | --- | --- | ---: |
| `packages/rendering/infrastructure/meshing/chunk-mesh-materials.ts:164` | ガラス/葉チャンクマテリアル | **共有** | 0.1 |
| `packages/rendering/infrastructure/post-processing/water-material.ts:137` | 水面マテリアル（:134-136 に同趣旨の説明） | **共有** | — |
| `packages/rendering/infrastructure/particles/particle-system.ts:60` | プールされたパーティクルマテリアル（:57-59「Cutout particles don't need it」） | **共有**（プール） | 0.5 |
| `packages/presentation/hud/first-person-held-item.ts:131` | 一人称の手持ちアイテム。`transparent: !isBlock` + `DoubleSide`、平板は `PlaneGeometry` | **非共有**（呼び出しごとに `new`） | — |

4 番目は 2 つの点で他と違い、どちらも記録する価値がある。

- **`packages/presentation` にある。** 参照実装は一人称の手持ちアイテム描画を HUD パッケージに
  置いていたが、新分割ではこれは**描画の関心事**であり mc-render が所有する。
  移植時に取りこぼしやすい場所なので [porting.md](./porting.md) と突き合わせること。
- **共有されていない。** 呼び出しごとに `new THREE.MeshBasicMaterial(...)` している。
  つまり §「発症条件」の 3 番目を満たさず、**アイドルスタッターの実例ではない**。
  ここでの `forceSinglePass` は予防的な適用である。

したがってこれは「共有マテリアル問題の 4 例目」ではなく、
**規則の適用範囲が『共有されているもの』より広いことの実例**である。
cutout ないし平板で `DoubleSide` なマテリアルは、共有されていなくても
2 パス順序から得るものが無いので、付けて安全かつ正しい。
共有は問題を**緊急**にする乗数であって、`forceSinglePass` が正しくなる条件そのものではない。
`requiresForceSinglePass` が `must-force-single-pass` を返すのは共有時だけだが、
`ok` は「付けるな」ではなく「付けなくても実害が出ない」の意味である。

### 発症条件は 3 つ揃ったとき

1. `transparent: true` — 2 パス経路に入る
2. `side: DoubleSide` — 裏面→表面の 2 パスになる
3. **共有されている** — `material.version` の bump が、参照している全メッシュのシェーダプログラムを無効化する

どれか 1 つでも欠けると起きない。だから `requiresForceSinglePass` は 3 つ全部を見る。

### 逆に、付けてはいけない場合

`forceSinglePass` はタダではない。2 パス描画は**本当に半透明な物体**の内側の面を外側より先に
描くために存在する。ステンドグラスや水中から見た深い水に付けると、順序が目に見えて壊れる。

見分けは **`alphaTest > 0`**。アルファテスト付きは cutout であり、各フラグメントは完全不透明か
破棄かのどちらかなので、2 パス順序が解決すべきものが無い。
参照実装の 4 箇所はすべて cutout か平板である。

`domain/material-policy.ts` はこれを**規則**として書いており、3 つのマテリアルを名指ししていない
（plan.md §3.1 の「能力フラグ vs 名指しブロックID」と同じ手）。

判定は 3 値:

| verdict | 意味 |
| --- | --- |
| `ok` | 2 パス経路に入らない、または共有されていない |
| `must-force-single-pass` | 共有 + 2パス + cutout。`forceSinglePass: true` が必要 |
| `review-sharing` | 共有 + 2パス + **真の半透明**。forceSinglePass は見た目を壊す。共有をやめるか、コストを意図的に受け入れる |

### 書くべき回帰テスト

`test/material-policy.test.ts`（10 テスト）。

| テスト名 | 内容 |
| --- | --- |
| `REGRESSION: the glass/leaves chunk material requires it` | |
| `REGRESSION: the pooled particle material requires it` | |
| `a PER-MESH two-pass material does not: its version bump costs one program` | 共有が乗数であること |
| `a FrontSide material does not` / `an opaque material does not` | 条件の独立性 |
| `REGRESSION: alphaTest 0 means the two-pass ordering is doing real work` | 付けてはいけない場合 |
| `the diagnostic names the measurement, not just the rule` | メッセージに `33ms -> 9.2ms` が入る。次の人が「整理」しないため |
| **（要追加）** `every shared material built by the adapter passes auditMaterials` | アダプタ実装時、起動時アサーションとして |

---

## DN-03 フレーム毎の一時 `Map` は事前確保して再利用

### plan.md §3.9 / §5.2

> フレーム毎の一時 `Map` は事前確保して再利用（GC回避）

§5.2「パフォーマンス例外（実測で確定済み。Effect流に『修正』しない）」にも再掲されている。
meshing のネイティブ `Set`（§3.3）、noise の `let` + `for`（§3.2）と同列の**意図的な非Effect流**である。

### 参照実装の証跡

```
packages/rendering/infrastructure/entity/entity-renderer.ts:35-38
  // FR-2.5: per-frame scratch matrices. Constructing THREE.Matrix4 /
  // Quaternion / Euler objects in the hot loop produces measurable GC
  // pressure (one frame touches 6 roles × N mobs). Allocate once per
  // service instance and reuse.

packages/rendering/infrastructure/renderer/world-renderer.ts:52-58
  // ... pose into this reusable scratch (no allocation); on a cache miss the
  // two objects are swapped so the scratch becomes the new "last" and the old
  // "last" is recycled as the next scratch — zero allocation, zero field copy
  // on either path.
  // Pre-allocated objects for frustum culling and refraction pre-pass —
  // reused every frame to avoid GC pressure

packages/rendering/infrastructure/renderer/world-renderer-refraction-ratio.ts:4
  // FR-4.4: pre-allocated scratch for AABB projection — reused across frames
```

`entity-renderer.ts:55-70` の `makeScratch()` はサービスファクトリ**内**で生成されている。
モジュールロード時ではない理由もコメントにある（:39-41）: `vi.mock('three', ...)` が
モックを差し込む前にコンストラクタが走ってしまうため。副産物として、
**サービスを 2 つ作れば scratch も 2 つになる**——kit がプレビューを 2 枚並べるときに要る性質である。

### なぜ `HashMap` ではないのか

永続 `HashMap` は挿入のたびにアロケートする。それが永続性の実装だからである。
60 Hz でチャンク集合を回すと、次のフレームまでに捨てられるためだけのアロケーションが
毎秒数千発生する。結果の GC はプレイヤーには周期的なヒッチングとして見える。

事前確保したネイティブ `Map` を**置き換えではなく `clear()`** すれば、定常状態でアロケーションはゼロ。
`Map.clear()` はバケット配列を保持する。

### 契約と、それを文書ではなく機構で守る理由

再利用される可変バッファが安全なのは 1 つの規則の下だけである:
**フレーム境界を跨いで参照を保持してはならない。**
保持した消費者は、バッファが黙って空にされ次フレームのデータで埋め直されるのを見る。
特定のタイミングでしか再現せず、読んで見つけるのはほぼ不可能なバグになる。

`withScratch` はこれを機構化している。

- 借用時にクリア（退出時ではない。デバッグ時に中身を見られるようにするため、かつ
  本当に重要な不変条件は「コールバックが古いデータを見ない」ほう）
- コールバックがバッファ**そのもの**を返したら `ScratchMisuseError`
- 二重借用（再入）も `ScratchMisuseError`
- 持ち出したいときは `snapshotScratch` でコピー。**アロケートするのが目的**——
  タダに見えて実はタダでない参照より、明示的で帰属可能なアロケーションのほうがよい

> 実装者向けの罠: `Map.prototype.set` は Map 自身を返す。
> `withScratch(s, (b) => b.set(k, v))` はバッファを返してしまい escape 検査に引っかかる。
> ブロック本体を使うこと。**引っかかるのが正しい**——暗黙に返してしまうバッファは、
> まさにこの機構が防ぎたい「うっかり漏れ」であり、いちばん書きやすい間違いである。

### 書くべき回帰テスト

`test/frame-scratch.test.ts`（12 テスト）。

| テスト名 | 内容 |
| --- | --- |
| `the SAME Map object serves every frame — no allocation per frame` | 5 フレームで同一オブジェクト |
| `REGRESSION: the buffer is cleared on ENTRY, so a frame never sees stale data` | |
| `clearing keeps the buffer identity, which is what keeps the bucket array` | |
| `returning the buffer itself throws rather than handing out a live reference` | |
| `a failed escape still releases the borrow, so the buffer stays usable` | |
| `snapshotScratch is the sanctioned way to keep results, and it copies` | |
| `two nested users of one buffer would clobber each other` | 再入検出 |
| `two DIFFERENT buffers may be borrowed at once` | 検出が過剰でないこと |
| `two frame-scratch sets are independent, so two renderers can coexist` | kit の 2 枚並列 |
| **（要追加）** `a full frame allocates no new Map` | アダプタ実装時。`--expose-gc` かアロケーション計測で |

---

## DN-04 入力は `window` 登録。モーダルは `document` で stopPropagation

### plan.md §3.9

> 入力は `window` にキー登録。モーダルは stopPropagation で遮蔽し、
> **Escapeキーの所有者はフレーム側の単一ハンドラ**（参照実装で確立した競合回避）

plan.md §3.13（mx-ui）にも対の記述がある:

> モーダルの Escape は stopPropagation、閉じる責務はフレーム側単一ハンドラ
> （mc-render の入力設計と対）

### 参照実装の証跡

```
packages/presentation/input/input-service.ts:172-177
  // Key listeners live on `window` (bubble phase) so modal overlays
  // (inventory/settings/pause/chat) that consume a key with
  // stopPropagation() on `document` shield it from gameplay input.
  // Otherwise the frame-pipeline sees the same Escape one frame after
  // the modal already handled it and acts on stale modal state.
```

登録の実体（:178-190）:

| イベント | 登録先 |
| --- | --- |
| `keydown` / `keyup` | **`window`** |
| `mousemove` / `mousedown` / `mouseup` / `contextmenu` | `document` |
| `pointerlockchange` / `pointerlockerror` | `document` |
| `wheel` | `document`（`{ passive: false }`。ホットバー巡回が `preventDefault` するため） |
| `blur` | **`window`** |

全体が `typeof window !== 'undefined' && typeof document !== 'undefined'` でガードされ（:171）、
`Effect.addFinalizer` で全解除される（:191-）。

### 3 段のプロトコル

1. ゲームプレイ入力は `window`（バブルフェーズ）に登録する
2. モーダルは `document`（バブル経路上、`window` の**内側**）に登録し、消費したキーで `stopPropagation()` する
3. したがってモーダルが消費したキーはゲームプレイ入力に**到達しない**

防いでいる失敗は具体的である。これが無いと、Escape でモーダルが閉じ、**かつ**フレームパイプラインが
1 フレーム後に同じ Escape を見て、既に古くなったモーダル状態を読んでポーズメニューを開く。
プレイヤーは 1 回押して 2 つのことが起きる。

### 新設計の方針

登録先を**データ**にする（`GAMEPLAY_LISTENER_TARGET` / `MODAL_LISTENER_TARGET` / `LISTENER_PLAN`）。
2 つを入れ替えるのは 1 語の編集であり、それだけで遮蔽が壊れて double-Escape が復活する。
`modalConsumedKeyReachesGameplay` がバブル関係そのものを関数にしてあるので、DOM 無しで assert できる。

さらに、イベント自体が `target` を持つ（`InputEvent`）。`MODAL_LISTENER_TARGET` 由来の
キーイベントはサービスが**無視する**——モーダル経路で届いたキーはゲームプレイ入力ではない。

### `mousedown` / `mouseup` は `document` ではなく `window`（参照実装からの意図的な逸脱）

参照実装は両方を `document` に登録している（:181-182）。ボタンが**ゲームプレイのアクションを
1 つも運んでいなかった**間はそれで安全だった。DN-12 で左右クリックが `attack` / `use` に
なった以上、ボタンはキーと同じ遮蔽に従わなければならない。そして `document` の
リスナは、同じ `document` で `stopPropagation()` するモーダルからは**遮蔽されない**
——遮蔽されるかどうかが登録順に依存する、という最悪の形になる。

`mousedown` / `mouseup` はどちらも `window` までバブルするので、移動のコストはゼロである。
`mousemove` / `wheel` / `pointerlock*` / `contextmenu` は `document` のまま——
これらはゲームプレイのコードを運ばず、遮蔽規則に参加しない。

### 書くべき回帰テスト

`test/input.test.ts` の `describe('REGRESSION: modal shielding via the window/document bubble path')`。

| テスト名 | 内容 |
| --- | --- |
| `gameplay listens on window, modals on document` | 定数そのもの |
| `a key a modal stopped propagating NEVER reaches gameplay` | |
| `swapping the two targets breaks the shielding — which is why they are constants` | 逆にすると壊れることの明示 |
| `a key the modal did not consume still reaches gameplay` | 遮蔽が過剰でないこと |
| `key listeners sit on window in the adapter plan; keydown and keyup agree` | keydown と keyup が違う先だとキーが刺さる |
| `mousedown and mouseup register on the same target, or a held button sticks` | 上の逸脱。両方 `window` |
| `an event tagged as arriving at the modal target is not gameplay input` | |
| `a click a modal consumed NEVER reaches gameplay` | ボタンにも同じ遮蔽が効くこと |

`test/browser-input-adapter.test.ts` の `describe`（アダプタ側、**実装済**）:

| テスト名 | 内容 |
| --- | --- |
| `the window adapter registers exactly LISTENER_PLAN` | 登録先も順序も `LISTENER_PLAN` そのもの |
| `gameplay codes go on window, and nothing puts one on the modal target` | 遮蔽規則をアダプタが実際に適用していること |
| `every listener is removed on finalizer` | 参照実装 :191- 相当 |
| `the removal matches the registration: same target, same function, same flags` | `removeEventListener` は type / 関数同一性 / capture の 3 つで照合する。1 つでも外すと**黙って**何もしない |
| `REGRESSION: a second world load leaks nothing` | plan.md §3.8 の最悪バグ（2 回目のロード）と同型 |
| `two services on one page get two independent sets of listeners` | kit の 2 枚並列 |

---

## DN-05 Escape キーの所有者はフレーム側の単一ハンドラ

DN-04 と対だが、独立した設計注意として扱う。

### 参照実装の証跡

```
packages/app/application/frame/stages/input-stage-menu.ts:6   export const handleEscape = (...)
packages/app/application/frame/stages/input-stage.ts:33        呼び出しはここ 1 箇所のみ
```

### 新設計の方針

**所有者をコメントではなく値にする。** `ESCAPE_OWNER = 'frame-handler'`。
「モーダルを閉じるのは誰か」が grep できる問いになり、CI が検査する。

強制は 4 重:

1. `bindingFor(bindings, 'escape')` は常に `undefined`（設定 blob が壊れていても）
2. `remap(_, 'escape', key)` は `escape-is-not-bindable` で拒否
3. `remap(_, action, 'Escape')` も同じ理由で拒否 ← **これが実際に第 2 の所有者を作る経路**
4. `actionForKey(_, 'Escape')` は常に `undefined`

生のキーは `snapshot().pressed` で見える。フレームハンドラがそれを必要とするためである。
見えなくしてしまうと、唯一の正当な所有者まで Escape を読めなくなる。

### 書くべき回帰テスト

`test/input.test.ts` の `describe('REGRESSION: Escape has exactly one owner')`（7 テスト）。

| テスト名 |
| --- |
| `the owner is the frame-level handler, recorded as a value not a comment` |
| `escape is not a bindable action: bindingFor always returns undefined` |
| `rebinding TO escape is rejected` |
| `rebinding the Escape KEY to another action is rejected` |
| `actionForKey never resolves Escape to a gameplay action` |
| `no listener in the adapter plan binds Escape` |
| `the escape action never reads as active or triggered, whatever arrives` |
| **（要追加）** `pressing Escape once produces exactly one close` — mc-compose の E2E で |

---

## DN-06 カメラ姿勢は mc-sim 所有。ここはミラー

### plan.md §3.8 / §4.3 / §5.1-2

> **カメラ所有権**: 参照実装はTHREEカメラが正でシミュレーションが描画から視線を読む逆転構造だった
> （「camera.position を読むな matrixWorld を使え」という慢性gotchaの根源）。
> 新実装は sim が姿勢を所有し、THREEカメラはミラー

### 参照実装の証跡

姿勢の回転成分はシミュレーション側にあり（`packages/entity/application/camera-state.ts`、THREE import 無し）、
描画 stage が THREE カメラへ書く:

```
packages/app/application/frame/stages/camera-stage.ts:63-67
  camera.rotation.set(pitch, yaw, 0, 'YXZ')
```

**そして 13 箇所が読み戻す**（すべてシミュレーション側のロジック）:

```
packages/app/application/frame/stages/attack-targeting.ts:18,24
packages/app/application/frame/stages/entity-update-stage.ts:182,189
packages/app/application/frame/stages/interaction-bow-handler.ts:105,123-124
packages/app/application/frame/stages/interaction-melee-handler.ts:142,213
packages/app/application/frame/stages/interaction-right-click-handler.ts:73
packages/app/application/frame/stages/interaction-stage-underwater.ts:37,42-44
```

慢性 gotcha:

```
packages/app/application/main/qa-api-visual.ts:17-19
  // World position via matrixWorld — the frame composes the camera pose
  // into matrixWorld directly, so `.position` can be stale (or the origin).
```

**stale の発生源**（ここが根本原因で、しかも mc-render 側の処理である）:

```
packages/app/application/frame/stages/render-stage.ts:41-48
  攻撃スイングのバンプのため生カメラを translateX / translateY / rotateZ で動かす
packages/app/application/frame/stages/render-stage.ts:98-100
  Effect.ensuring で復元
```

この 2 点の間、`.position` と `matrixWorld` は食い違う。その窓でカメラを読んだコードは
プレイヤーの姿勢ではなく**武器バンプ後の姿勢**を得る。

### 新設計の方針

**姿勢は値として mc-sim から届き、演出は別の値としてミラー時に合成し、合成結果はどこにも戻さない。**

- `mirroredCameraState(snapshot, offset)` は純粋関数。入力スナップショットは出力ではなく、
  出力から入力への経路が存在しない
- 演出（攻撃スイング・歩行の揺れ・被弾シェイク・反動）はすべて `ViewOffset` に入る
- `forwardVector` は**スナップショット**を取る。ミラー結果ではない。
  演出のロールが「プレイヤーがどこを見ているか」に漏れることは型レベルで起きない
- Euler order は `'YXZ'`（参照実装 camera-stage.ts:67 と同値）。既定の `'XYZ'` だと
  pitch した状態で yaw すると地平線が傾く
- 依存グラフが独立に保証する: `mc-render → mc-sim` があるため逆エッジは循環

### 書くべき回帰テスト

`test/camera-mirror.test.ts`（13 テスト）。

| テスト名 | 内容 |
| --- | --- |
| `REGRESSION: the attack-swing bob does NOT perturb the authoritative snapshot` | 参照実装が持っていた欠陥そのもの |
| `REGRESSION: the bob does not change where the player is deemed to be looking` | `forwardVector` はスナップショットを取る |
| `mirroring twice from the same snapshot is idempotent — no accumulation` | |
| `is 'YXZ', matching the reference's camera-stage.ts:67` | |
| `a rightward bob moves along +X when facing -Z` / `the same bob follows the yaw` | ローカル基底での適用 |
| `a vertical bob stays vertical whatever the pitch` | pitch を掛けない理由 |
| `is a unit vector at every pitch, so a raycast needs no renormalisation` | |
| `a pose more than 100 ms old is reported as stale rather than silently drawn` | |
| **（要追加）** `no source file in this repository reads camera.position` | アダプタ実装時。走査テストで |

---

## DN-07 GTAOPass は無効時も VRAM を食う

plan.md には無いが、参照実装がコメントで残している実測知見。

```
packages/app/application/main/session-post-processing.ts:53-56
  // R100: GTAOPass allocates full-resolution MRT targets even when disabled,
  // wasting ~30-60 MB VRAM on presets where SSAO is not needed. Only construct
  // it when ssaoEnabled is true; otherwise Option.none() so downstream code
  // knows the pass is absent (not just disabled).
```

同じ扱いが GodRays（:70）/ Bloom（:82）/ Bokeh（:100）にもあり、
「composite が有効なら個別パスは**作らない**」になっている。

### 新設計の方針

`buildPostProcessingChain` は無効なパスを**出力しない**。参照実装は作って `enabled = false` に
していた（`compositeActive` のとき）が、作らないほうが強い——無効なパスもレンダーターゲットは確保する。

### 書くべき回帰テスト

| テスト名 | 場所 |
| --- | --- |
| `the minimum chain is render then output` | `test/post-processing.test.ts` |
| `REGRESSION: replaces bloom, godRays and bokeh — never runs alongside them` | 同上 |
| **（要追加）** `a disabled pass is never constructed` | アダプタ実装時 |

---

## DN-08 入力サービスは blur で保持キーをクリア

参照実装がユーザ報告から得た知見。

```
packages/presentation/input/input-service.ts:155-158
  // Clear all held input when the window loses focus. The browser does NOT
  // deliver keyup/mouseup for keys/buttons still held when focus leaves, so
  // without this a key held during a tab/window switch stays "pressed" forever
  // and the player keeps walking/acting on return (user report: stuck controls).
```

実装（:159-168）はキーだけでなくマウスボタン、ゲームパッド、仮想入力、マウスデルタ、
ホイールデルタも全部クリアしている。`blur` に配線（:190）。`visibilitychange` ではない。

### 書くべき回帰テスト

| テスト名 | 場所 |
| --- | --- |
| `REGRESSION: blur clears held input — the browser sends no keyup while unfocused` | `test/input.test.ts` |
| `REGRESSION: blur releases held buttons — the browser sends no mouseup while unfocused` | 同上。参照実装のコメントは keys/**buttons** と両方を名指ししている |
| `blur drops the wheel travel too — the reference clears it in handleBlur` | 参照実装 :167。DN-13 |
| **（要追加）** `blur clears gamepad and touch state too` | それらの実装時 |

---

## DN-09 ポインタロック解除時にデルタを捨てる

ポインタロックが外れるとポインタはロック前の位置に飛ぶ。そのジャンプをカメラに食わせると
視点がぐるりと回る。

参照実装は `handlePointerLockChange` / `handlePointerLockError`（:150-153, :184-185）を持つ。
新実装では `pointerlockchange` で `locked: false` になったときに蓄積デルタをゼロにする。
`pointerlockerror` のほうは**状態の区別**として別に扱う（DN-14）。捨てるものは無い——
拒否された要求はポインタを掴んでいないので、デルタも押下ボタンも存在しない。

あわせて、**ロックされていない間のポインタ移動は無視する**。ロックされていないときの
`movementX/Y` はウィンドウ内のカーソル移動であって視点操作ではない。

### 書くべき回帰テスト

| テスト名 | 場所 |
| --- | --- |
| `pointer motion is ignored while the pointer is NOT locked` | `test/input.test.ts` |
| `losing the pointer lock zeroes the delta, so the view does not spin` | 同上 |
| `endFrame clears the edge and the accumulated pointer delta, not the held keys` | 同上 |
| `losing the lock releases held buttons, so breaking stops when the pause menu opens` | 同上。DN-12 |
| `losing the lock does NOT release held keys — chat and the frame handler still need them` | 同上。捨てすぎないこと |
| `losing the lock drops the wheel travel, so the hotbar does not jump on return` | 同上。DN-13（アナログ状態はロックしたセッションのもの） |

**ヘッドレスでは検証できないこと**: 実ブラウザのポインタロックは Playwright（SwiftShader）で
使えない（plan.md §3.10）。だからこそ、この挙動は**ポート越しの単体テストで押さえる**必要がある。

---

## DN-10 ワーカープールは Port と実装を分ける

plan.md §3.7 は mc-worldgen に「ワーカープールPort（実装は利用側が注入）」、
§3.9 は mc-render に「ワーカープール実装」と書く。つまり **Port は使う側が定義し、実装はここ**。

参照実装 `packages/worker`（1,556 LOC）は両方が同居している:

| ファイル | LOC | 分割先 |
| --- | ---: | --- |
| `application/terrain-worker-pool-port.ts` | 48 | Port → mc-worldgen |
| `application/meshing-worker-pool-port.ts` | 36 | Port → mc-meshing または mc-render |
| `infrastructure/terrain-worker-pool.ts` | 272 | 実装 → mc-render |
| `infrastructure/meshing/meshing-worker-pool.ts` | 307 | 実装 → mc-render |
| `infrastructure/meshing/meshing-worker-config.ts` | 42 | plan.md §3.3 は **mc-meshing** 行きとしている |

**`meshing-worker-config.ts` の行き先が plan.md 内で食い違っている。**
§3.3（mc-meshing の移植元）に含まれているが、§3.9 の「ワーカープール実装」にも該当しうる。
実装時に決めて本文書に追記すること。

### 書くべき回帰テスト（要）

| テスト名 | 内容 |
| --- | --- |
| `the pool implementation satisfies the Port without importing its owner's internals` | |
| `a worker that dies is replaced rather than deadlocking the pool` | |

---

## DN-11 `Date.now()` を使わない

plan.md §4.3 / §5.1-3。時刻はすべて注入された Clock Port から取る。

強制は `scripts/check-dependency-whitelist.ts` の `findBannedTimeSources`
（`Date.now()` / `new Date()` / `performance.now()`）。**oxlint.json ではない**——
oxlint 0.12 は `no-restricted-syntax` も `no-restricted-properties` も実装しておらず、
`no-restricted-globals` は一覧に出るが実装されていない（mc-kernel で 0.12.0 に対し実測確認済み）。

**mc-render はこの禁止が最も効くリポジトリである。** `performance.now()` は FPS 計測・
フレーム時間計測・アニメーション補間で自然に手が伸びる。参照実装にも
`packages/rendering/presentation/perf-hud-counters.ts` のような計測コードがある。

そして**ブラウザプラットフォームを所有するのがここである以上、Clock Port の実装アダプタは
おそらくここに置かれる**。だからエスケープハッチは**ファイト単位ではなく行単位**である
（`mc-kernel-allow-time-source` コメント）。アダプタの 1 行だけが例外になり、
同じファイルの他の行は例外にならない。

### 書くべき回帰テスト

| テスト名 | 場所 |
| --- | --- |
| `catches all three raw clock reads, with line numbers` | `test/check-dependency-whitelist.test.ts` |
| `ignores the same text inside a comment or a string` | 同上 |
| `the escape hatch exempts exactly the line that carries it` | 同上 |

---

## DN-12 クリックはロック状態で意味が変わる

plan.md には無い。**縦切りスパイクが見つけた穴**である。
スパイクは「プレイヤーがブロックを壊す」を表現できず、破壊を `KeyB` に縛って回避した。
`InputEvent` にマウスボタンの場合が無く、`INPUT_ACTIONS` に `attack` / `use` が無かった。
一方 `LISTENER_PLAN` は `contextmenu` を「右クリックでブロックを置けるように」という注記付きで
既に登録していた——**リスナは計画済みで、それを運ぶイベント型とアクションだけが無かった。**

公開モデルの決定（番号ではなく名前、`InputCode` の単一空間）は
[public-api.md](./public-api.md) §2.5 にある。ここに書くのは**設計注意**の側、
すなわち「知らないと必ず踏む」2 つである。

### 1. ロック中のクリックはゲーム操作、非ロック中のクリックは UI 操作

参照実装は区別しない。`handleMouseDown`（`input-service.ts:119-123`）は
ロック状態に関係なく全ボタンを記録し、ゲームプレイ側は
`interaction-stage-snapshot.ts:56-62` の `gamePausedRef` で止めている。

```
const paused = yield* Ref.get(deps.gamePausedRef)
if (paused) { return createPausedInteractionStageSnapshot(...) }
const leftClick = yield* services.inputService.consumeMouseClick(0)
```

これは「非ロック状態は必ずポーズ状態でもある」という不変条件に依存している。
**ポインタロックを取り直すクリックが反例**である。それはフレームが状態変化を知る前に届き、
しかもブロックを壊すのと同じ左クリックである。

新実装は `dispatch` の時点で判定する。サービスは `pointerlockchange` を既に追っており、
判定に必要な状態は全部手元にある。非ロック中のクリックは `uiClicks` にだけ入り、
`pressed` / `justPressed` には**入らない**——`pressed` の中身は
「ゲームプレイに使ってよいコード」である、という不変条件を保つため。
捨てないのは、それがロックを取り直すクリックそのものだからである。

対になる規則: **ロックを失ったら保持中のボタンを離す。**
左ボタン押しっぱなしで破壊中に Escape を押すとブラウザはロックを解除し、次のクリックは
メニューに行くので `mouseup` は来ない。DN-09 でデルタを捨てるのと同型の理由である。
キーは離さない。チャット入力もフレームハンドラの Escape も非ロック中に届く必要がある。

### 2. `contextmenu` は抑止しなければならないが、無条件ではない

抑止しないと、ブロックを置くたびにブラウザのメニューが開き、ポインタロックも持って行かれる。
参照実装は無条件に `preventDefault()` する（:140-142、登録は :183）。
本実装は `suppressesBrowserContextMenu(pointerLocked)` でロック中のみに絞る——
非ロック中は DOM UI が動いている場面であり、そこで既定動作を飲み込むと
チャット行のコピーもテキスト欄のスペルチェックも消える。

抑止判定を純粋関数にしてある理由は DN-09 と同じで、しかもより強い:
plan.md §3.10 のとおり Playwright（SwiftShader）はヘッドレスでポインタロックを扱えないので、
**ロック中の分岐を通るブラウザテストは存在しえない。**

参照実装が :137-139 に残している罠も機構化してある。

```
// Do NOT add to justClickedButtons here — handleMouseDown already captures button 2.
// Adding it here would cause a spurious second right-click if consumeMouseClick(2)
// is called between the mousedown and contextmenu events.
```

`contextmenu` は `InputEvent` の 1 ケースとして受け、**ボタン状態を一切変えない**。
イベントとして受けるのは「何もしない」をテストで assert できる性質にするためである。
なお本実装のエッジは consume 型ではなく `endFrame` クリア型なので、
参照実装の警告が想定する「誰が先に読んだかで結果が変わる」競合はそもそも成立しない。

### 書くべき回帰テスト

`test/input.test.ts` の 3 つの describe（計 24 テスト）。

| テスト名 | 内容 |
| --- | --- |
| `left click is attack and right click is use — the two the spike could not express` | 穴そのもの |
| `MouseEvent.button numbers are translated to names in exactly one place` | 0/1/2 と、3 が `undefined` |
| `no KeyboardEvent.code begins with Mouse, which is what makes ONE code space safe` | 単一コード空間の前提 |
| `REGRESSION: a click is an edge for exactly ONE frame — one click breaks one block` | エッジと `endFrame` |
| `a held button stays down across frames, so hold-to-break keeps breaking` | レベル側 |
| `a second mousedown within one frame does not produce a second edge` | |
| `attack fires from the LEFT button and use from the RIGHT, not the other way round` | |
| `attack can be rebound to a KEY — which is what the spike had to hack in` | 単一空間の見返り |
| `one code one action applies across the key/button boundary` | `remap` の重複検査 |
| `a click while UNLOCKED never fires attack — a menu click must not break a block` | 上記 1 |
| `an unlocked click IS reported as a UI click — it is what re-acquires the lock` | 捨てないこと |
| `losing the lock releases held buttons, so breaking stops when the pause menu opens` | |
| `is suppressed while the pointer is locked, or right-click opens a menu mid-place` | 上記 2 |
| `is NOT suppressed while unlocked, where the browser menu is the platform behaviour` | 参照実装との差 |
| `the contextmenu event adds NO second right-button edge — one click, one placement` | :137-139 |
| `a UI click ASKS for the pointer lock — the consumer uiClicks never had` | `test/stage-registration.test.ts`。DN-14 |
| `the window adapter calls preventDefault exactly when shouldSuppressContextMenu says so` | `test/browser-input-adapter.test.ts`。**実装済** |
| `no OTHER handler ever calls preventDefault, locked or not` | 同上。抑止が過剰でないこと |

---

## DN-13 ホイールはエッジでもレベルでもなく**デルタ**

plan.md には無い。**DN-12 と同じ形の穴**である。
`LISTENER_PLAN` は `wheel` を「ホットバー循環のため `passive: false`」という注記付きで
既に登録していたのに、`InputEvent` に `wheel` の場合が無く、`INPUT_ACTIONS` にホットバーの
アクションも無かった——リスナは計画済みで、それを運ぶイベント型とアクションだけが無かった。

公開モデルの決定（`InputCode` にしない、ノッチ単位、剰余算の置き場所）は
[public-api.md](./public-api.md) §2.7 にある。ここに書くのは**知らないと必ず踏む** 3 つ。

### 1. `deltaMode` を見ないと、ブラウザによって 33 倍ずれる

参照実装は生の `event.deltaY` を足す。

```
packages/presentation/input/input-service.ts:130-133
  const handleWheel = (event: WheelEvent) => {
    event.preventDefault()
    MutableRef.set(wheelDeltaRef, MutableRef.get(wheelDeltaRef) + event.deltaY)
  }
```

`deltaMode` を見ていない。同じ 1 ノッチが Chrome では `100`（ピクセル）、
Firefox（Windows・クラシックホイール）では `3`（行）である。
それで動いているように見えるのは、唯一の消費者が**符号しか使っていない**からで
（`hotbar-service.ts:76`）、大きさを使った瞬間に破綻する。

本実装は `notchesForWheelDelta` で**ドメインの**定数（`100` / `3` / `1`）を使って
ノッチに正規化し、**dispatch の時点で**効かせる。トラックパッド（ピクセル）と
ホイール（行）は同一フレーム内に両方届きうるので、蓄積器の単位は 1 つでなければならない。

### 2. エッジにすると、素早いフリックが 1 スロットになる

`WheelUp` / `WheelDown` を `InputCode` にすれば既存機構（`justPressed`・`endFrame`・`remap`）に
そのまま乗る。乗せてはならない。**エッジは大きさを持てない**ので 3 ノッチが 1 になる。
それは参照実装が実際にやっていることである（`wheelDelta > 0 ? 1 : -1`）。

ホイールは `pointerDelta` と同じアナログ状態として蓄積する。DN-09 の規則がそのまま効く:
非ロック中は無視、ロック喪失で破棄、`endFrame` でクリア。

**1 点だけ差がある。`endFrame` は整数ノッチだけを消し、1 ノッチ未満の端数を持ち越す。**
トラックパッドは 1 イベント数ピクセルしか送らないので、毎フレーム全部捨てると
どのフレームも 0 ノッチに丸まり、**ノート PC でホットバーが操作不能になる**。
持ち越しはロック喪失と `blur` で消え、逆回しで相殺される。

**消費するのは「そのフレームに伝えた分」であって「実行時点の累算器が言う分」ではない。**
`endFrame(frame)` はフレームが読んだスナップショットを受け取る。以前は
`snapshot` と `endFrame` がそれぞれ別の瞬間に `Math.trunc` を取っていたので、
あいだに届いたホイールイベント —— DOM リスナが走るのはまさにそこである ——
が 2 つ目を段の境界の向こうへ押し、フレームが知らない段が 1 つ消費された。
プレイヤーはデテントを 1 つ回したのにスロットが動かない、それも再現しない形で。
これは参照実装の consume-on-read `consumeMouseClick` と同じ種類で、DN-12 が明示的に
拒否したものである。

サービスに「最後に報告した値」を覚えさせなかったのは意図的である。そうすると
`snapshot` が**フレーム境界に副作用を持つ読み取り**になり、デバッグオーバーレイや
プレビューのアナログパネルの再描画が次の `endFrame` の消費量を変えてしまう。
**計器が観測対象を動かしてはならない。** 契約は型に置いた ——
読んでいないスナップショットでフレームは閉じられない。

### 3. 循環の剰余算は、参照実装の式が**歩幅 2 以上で壊れる**

```
packages/inventory/application/hotbar-service.ts:77-79
  SlotIndex.make((SlotIndex.toNumber(cur) + direction + HOTBAR_SIZE) % HOTBAR_SIZE)
```

JavaScript の `%` は被除数の符号を保つ。`+ HOTBAR_SIZE` 1 回で足りるのは
`direction` が ±1 に潰されているからで、`steps = -12` を渡すと**負のスロット番号**が
黙って返る。大きさを運ぶ本実装は最初の速いフリックでそこに当たる。
`wrapHotbarSelection` が `((x % size) + size) % size` を 1 箇所に置いている。
`size` は引数である——ホットバーの長さはインベントリ所有者の事実であり、
このリポジトリが 2 つ目の答えになってはならない。

### 書くべき回帰テスト

| テスト名 | 内容 |
| --- | --- |
| `a flick ACCUMULATES within one frame: the frame sees the SUM of its events` | 蓄積 |
| `endFrame clears the accumulated notches, so one flick cycles the hotbar once` | クリア |
| `deltaMode is NORMALISED: 100 pixels, 3 lines and 1 page are each one notch` | 上記 1 |
| `normalisation applies at DISPATCH, so mixed units can be added at all` | 同上 |
| `WheelEvent.deltaMode numbers are translated to names in exactly one place` | 境界 1 箇所 |
| `a sub-notch trackpad scroll CARRIES across frames instead of being lost` | 上記 2 の端数 |
| `the carried remainder is under one notch, so it cannot become a phantom step` | 有界性 |
| `the wheel NEVER touches pressed or justPressed — an edge cannot say "two"` | 上記 2 |
| `a wheel event is IGNORED while unlocked — that scroll belongs to the DOM` | DN-09 と同型 |
| `losing the lock drops the wheel travel, so the hotbar does not jump on return` | 同上 |
| `browser scrolling is suppressed while locked and NOT while unlocked` | §2.6 と同型 |
| `REGRESSION: a MULTI-notch step wraps too — the reference formula returns -3 here` | 上記 3 |
| `the window adapter passes deltaMode through wheelDeltaModeForIndex` | `test/browser-input-adapter.test.ts`。**実装済**。0/1/2 は名前に、3 は落とす |
| `the wheel handler calls preventDefault exactly when shouldSuppressWheelScroll says so` | 同上。`passive: false` はこのためだけに付いている |
| `a wheel whose unit cannot be named is still suppressed while locked` | 同上。イベントは捨てるが、ロック中のキャンバスの下でページが動いてはならない |

---

## DN-14 ポインタロックは**要求**であり、拒否されうる

plan.md には無い。[public-api.md](./public-api.md) §2.2 が
「要求側（`requestPointerLock`）は未実装」と自分で記録していた穴である。
DN-12 が `uiClicks`（ロックを取り直すクリック）をモデル化したが、
**それを受ける側が無かったので、プレビューはマウスルックに入れなかった。**

決定（4 状態、`PointerLockPort`、誰がいつ要求するか）は
[public-api.md](./public-api.md) §2.8。ここに書くのは踏む側の 3 つ。

### 1. 「ロックしていない」は 3 つある

`unlocked`（誰も要求していない）・`requested`（返事待ち）・`refused`（拒否された）。
プレイヤーに見せる必要があるのは 3 つ目だけであり、boolean ではそれが言えない。

参照実装は 3 つを 1 つの boolean に潰し、拒否は開発者コンソールに出す。

```
packages/presentation/input/input-service.ts:150-153
  const handlePointerLockError = () => {
    MutableRef.set(pointerLockFallbackRef, false)
    console.warn('Pointer Lock request failed')
  }
```

`pointerlockchange { locked: false }` を `refused` にしないこと。
Escape でロックが切れるのは通常動作であり、そこで「ブラウザに拒否された」と出したら
毎回のポーズが障害報告になる。

### 2. 答えの来ない要求は、状態機械をセッション中固める

要求を出せない場合がある——canvas が無い、`requestPointerLock` が無い、
feature policy が禁じている（参照実装 :258-266 が実際に検査している）。
このとき `pointerlockchange` も `pointerlockerror` も**永久に来ない**。
`requested` のまま放置すれば、以後クリックしても
「保留中の要求があるので二重に要求しない」規則に永久に引っかかる。

だから `PointerLockPort.request` は `'sent' | 'unavailable'` を返し、
`unavailable` はその場で `refused` に落ちる。

参照実装は同じ場面で `pointerLockFallbackRef` を立てて**ロック済みだと嘘をつく**
（:263-266、読み出しは :282-284）。MCP 駆動環境を動かすための細工だが、
DN-12 のクリック判定はすべてその boolean の上に建っている。**移植しない。**

### 3. 要求は Port から出す。DOM を直接叩かない

`canvas.requestPointerLock()` をサービスから呼べば、このリポジトリは `lib.DOM` を必要とし、
入力モデル全体が `environment: 'node'` で検査できなくなる。
しかも plan.md §3.10 のとおり Playwright（SwiftShader）はポインタロックを扱えないので、
**DOM を直接叩いた瞬間、その挙動を検査できるテストはこの世に無くなる。**
DN-09 と同じ論法で、こちらのほうが強い。

要求を出す場所は `render:input` stage であって `dispatch` ではない。
`dispatch` は DOM イベントハンドラの中で走る記録係であり、ロックを取るのは判断である。
サービスが勝手に掴むと、入力を覗きたいだけのプレビューからポインタを奪う。

### 書くべき回帰テスト

| テスト名 | 内容 |
| --- | --- |
| `never having asked is a different state from having been refused` | 上記 1。穴そのもの |
| `REQUEST → GRANTED: the ask reports 'requested', and the EVENT is what locks` | 要求≠許可 |
| `REQUEST → REFUSED: pointerlockerror answers the ask, and the state says so` | |
| `a REFUSAL is sticky, so the UI can still draw it several frames later` | |
| `an ordinary unlock does NOT read as refused — Escape is not a browser refusal` | 上記 1 |
| `a second request while one is PENDING does not ask the browser twice` | |
| `a platform with NO pointer lock refuses at once rather than hanging in requested` | 上記 2 |
| `a refusal can be RETRIED — a click is the user gesture the browser wanted` | |
| `only the LEFT button asks for the lock, and only while it is askable` | `acquiresPointerLock` |
| `a UI click ASKS for the pointer lock — the consumer uiClicks never had` | `test/stage-registration.test.ts` |
| `a click while ALREADY locked is a game action and asks for nothing` | 同上 |
| `the browser port calls canvas.requestPointerLock exactly once per ask` | `test/browser-input-adapter.test.ts`。**実装済** |
| `a refused lock surfaces as pointerlockerror, through the real listener` | 同上。要求→拒否→`refused` を実リスナ経由で通す |
| `an element with no requestPointerLock is unavailable, not sent` | 同上。上記 2（答えの来ない要求） |
| `a permissions policy that forbids the lock is unavailable, and is not asked` | 同上。参照実装 :258-262 相当を Port の引数として受ける |
| `a THROWING requestPointerLock is unavailable — the ask did not go out` | 同上。throw は拒否ではない（拒否はイベント） |
| `a REJECTED promise still counts as sent, and does not escape as an unhandled rejection` | 同上。現行ブラウザは promise を reject **かつ** `pointerlockerror` を投げる |

---

## DN-15 DOM は `lib` ではなく**狭い構造的インターフェース**で受ける

plan.md には無い。**`window` 入力アダプタを書いた時点で決めざるを得なかった**ことである。

### 何が問題だったか

このリポジトリは `lib: ["ES2024"]` / `types: []` で出荷ソースを検査している
（`tsconfig.base.json`、ゲートは `tsconfig.build.json`）。
それは整理整頓ではなく、**ポストFXの順序・ホイールのモデル・ロック状態機械を
`environment: 'node'` で検査可能にしている当の機構**である。
そして plan.md §3.10 のとおり、ブラウザ側にも逃げ場は無い——
Playwright は SwiftShader でポインタロックを扱えないので、
「ブラウザでしか観測できない挙動」は**この世のどのテストからも観測できない挙動**になる。

一方でアダプタは `window` / `document` / canvas と話さなければならない。

### 選択肢は 3 つあった

| 案 | 結果 |
| --- | --- |
| `lib` に `"DOM"` を足す | 純粋なファイル全部から同時に歯止めが消える。しかも**数ヶ月誰も気づかない** |
| アダプタ専用の 2 つ目の tsconfig プロジェクト（`lib.DOM` 付き） | **機械的に詰む**。`scripts/api-lock.ts` は `tsconfig.build.json` から公開面を作り、`scripts/check-dependency-whitelist.ts` は `index.ts` / `domain/` / `application/` / `stages/` で出荷ソースを分類する。どちらも 16 リポジトリに byte-identical で vendor される領域で、リポジトリ毎に編集してはならない。build プロジェクト外のアダプタは `index.ts` から re-export できず、**それが存在する理由であるプレビューから使えない** |
| **実際に使う DOM メンバだけを構造的に書く** | 採用 |

### 採ったかたち

`application/dom-surface.ts` が**このリポジトリの DOM 依存の全部**である（メンバ 8 個）。
`application/browser-input-adapter.ts` がそれを使う唯一のファイルである。

構造的な型は「実物が代入できる」ことが保証されなければ意味が無く、それは自明ではない。
`strictFunctionTypes` によりリスナの引数は反変なので、
`DomInputEvent.code` を必須にしたり、イベント種別ごとに型を分けたりすると
**実物の `Window` が `DomEventTarget` に代入できなくなる**。
そのとき `pnpm typecheck` は何も言わない（そちらのプロジェクトには代入元の DOM が無い）。
最初に気づくのはブラウザ側の消費者で、その人が手を伸ばすのは `as unknown as` である——
型安全が実際に失われるのはそこである。

だから代入可能性そのものをテストにしてある。

| 半分 | 何を証明するか | どこ |
| --- | --- | --- |
| ドメインは DOM 非依存のまま | `pnpm typecheck` が `lib: ["ES2024"]` / `types: []` で**出荷ソース全部**を通す | `pnpm verify` |
| 同上（設定が後から緩められていない） | `tsconfig.build.json` の `lib` / `types` を assert | `the shipped project still compiles with NO DOM at all` |
| 狭い型が実物の**部分集合**である | `test/fixtures/dom-surface.ts` を**本物の `lib.dom.d.ts`** に対してコンパイルし、診断 0 件を assert | `a real Window, Document and HTMLCanvasElement satisfy the adapter without a cast` |

3 番目のフィクスチャは `tsconfig.json` / `tsconfig.test.json` から `test/fixtures/**` として
**除外**してある。DOM 型を名指しするのが目的のファイルであり、
DOM の無いプロジェクトに入れれば落ちるだけで、出荷プロジェクトに入れれば
それは `"DOM"` フラグが裏口から入ったのと同じだからである。

### 適用範囲の限定

**これは THREE.js には持ち越せない。** THREE のクラス階層は「メンバ 8 個」ではない。
`"DOM"` / `"WebWorker"` を入れるかどうかは最初の THREE.js アダプタで改めて議論する。
DN-15 が言えるのは「1 つのアダプタのために全ファイルから歯止めを外すのは高すぎる」であって、
「構造的な型はいつでも DOM の代わりになる」ではない。

### 書くべき回帰テスト

| テスト名 | 場所 |
| --- | --- |
| `a real Window, Document and HTMLCanvasElement satisfy the adapter without a cast` | `test/browser-input-adapter.test.ts` |
| `the shipped project still compiles with NO DOM at all` | 同上 |
