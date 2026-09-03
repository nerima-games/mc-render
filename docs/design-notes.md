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
| DN-16 | キーボードフォーカスは**観測**。Tab はユーザーエージェントのもので、決して奪わない | 済 |
| DN-17 | パーティクルプールは固定容量 + **drop-oldest**。乱数はシード付き | 済 |
| DN-18 | 水面は**平面**なので `forceSinglePass` は正しい。屈折プリパスはゲート 6 つ | 済 |
| DN-19 | アトラス UV はハーフテクセルだけ内側に寄せる。V は反転する | 済 |
| DN-20 | パーティクルは `InstancedMesh` を使わない。`InstancedBufferGeometry` で十分 | 済 |

DN-17 / DN-18 / DN-19 は plan.md §3.9 の設計注意リストには無い。
参照実装の**移植中に見つかった**もので、扱いは他と同じ（証跡 file:line + 回帰テスト名）である。
DN-20 も同リストには無いが、見つかった欠落ではなく**外部のギャップ一覧が「instanced-mesh クラスが無い」
と名指ししたことへの回答**である —— 実装済みの判断を、後から読む人のために文章にしただけで、
挙動は変えていない。
**全文の論証はモジュールのヘッダにある** —— このリポジトリは
`domain/frame-scratch.ts` 以来そこを一次の置き場にしており、下の 4 節はその索引である。

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
- コールバックがバッファ view **そのもの**を返したら `ScratchMisuseError`。
  view を包んで返す、クロージャや iterator、遅延 Effect に保持する場合も、lease 後の
  操作で `ScratchMisuseError` になる。native の backing `Map` は公開しない
- 二重借用（再入）も `ScratchMisuseError`
- 持ち出したいときは `snapshotScratch` でコピー。**アロケートするのが目的**——
  タダに見えて実はタダでない参照より、明示的で帰属可能なアロケーションのほうがよい

> 実装者向けの罠: `Map.prototype.set` は Map 自身を返す。
> `withScratch(s, (b) => b.set(k, v))` はバッファを返してしまい escape 検査に引っかかる。
> ブロック本体を使うこと。**引っかかるのが正しい**——暗黙に返してしまうバッファは、
> まさにこの機構が防ぎたい「うっかり漏れ」であり、いちばん書きやすい間違いである。

### 書くべき回帰テスト

`test/frame-scratch.test.ts`（18 テスト）。

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

- `mirroredCameraState(snapshot, offset)` は純粋関数。未到着時は `snapshot` が `undefined` でも
  保留状態を返し、入力スナップショットは出力ではなく、
  出力から入力への経路が存在しない
- 演出（攻撃スイング・歩行の揺れ・被弾シェイク・反動）はすべて `ViewOffset` に入る
- `forwardVector` は**スナップショット**を取る。ミラー結果ではない。
  演出のロールが「プレイヤーがどこを見ているか」に漏れることは型レベルで起きない
- Euler order は `'YXZ'`（参照実装 camera-stage.ts:67 と同値）。既定の `'XYZ'` だと
  pitch した状態で yaw すると地平線が傾く
- 依存グラフが独立に保証する: `mc-render → mc-sim` があるため逆エッジは循環

### 書くべき回帰テスト

`test/camera-mirror.test.ts`（15 テスト）。

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
| `an unpublished pose is pending rather than fresh` | source timestamp が無い状態を stale と混同しない |

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
| `blur clears gamepad and touch state too` | `test/touch-controls.test.ts` / `test/gamepad-input.test.ts`。実装済み |

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

現在の runtime code はグローバルな時計を直接読まず、Clock Port または
`MonotonicTimeSecs` を受け取る。`pnpm lint` は `src`、`apps`、`scripts`、`test` を
走査するが、専用の dependency-whitelist スクリプトは持たない。

この制約を変更する場合は、時間の供給元をブラウザアダプタの境界に閉じ込め、
domain/application の純粋な処理には注入可能な値だけを渡すこと。

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

plan.md には無い。[public-api.md](./public-api.md) §2.2 が過去の監査で
「要求側（`requestPointerLock`）は未実装」と記録していた穴であり、現行実装では閉じている。
DN-12 が `uiClicks`（ロックを取り直すクリック）をモデル化したが、
**当時はそれを受ける側が無かったので、プレビューはマウスルックに入れなかった。**

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
| アダプタ専用の 2 つ目の tsconfig プロジェクト（`lib.DOM` 付き） | 採用しない。`tsconfig.build.json` を package の唯一の declaration 出力プロジェクトとし、`tsconfig.test.json` / `tsconfig.preview.json` は検証専用にする。DOM アダプタの実物代入可能性は `test/typescript-project.ts` の fixture 検査で証明する |
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

---

## DN-16 キーボードフォーカスは**観測**である。Tab は奪わない

plan.md には無い。**mx-ui が半分だけ作って止めた**ところである
（mx-ui/docs/design-notes.md DN-UI-13i、`mx-ui/application/slot-element.ts`）。

公開モデルの決定（`FocusTarget`、`focusin`/`focusout`、ロック中のマスク、
同一性による解決）は [public-api.md](./public-api.md) §2.10 にある。
ここに書くのは**設計注意**の側、すなわち「知らないと必ず踏む」4 つと、
**まだ閉じていない 2 点**（§5）である。

### 証跡

**参照実装には対応物が無い。** DN-04 が引いている
`ts-minecraft/packages/presentation/input/input-service.ts:178-190` のリスナ列は
`keydown` / `keyup` / `mousemove` / `pointerlockchange` / `pointerlockerror` / `wheel` /
`contextmenu` / `blur` の 8 本で、**フォーカス系は 1 本も無い**。
参照実装の HUD にリングもロービングタブストップも無いからで、
つまりこの項目は移植ではなく**こちら側で新規に決めたもの**である。
したがって証跡は兄弟リポジトリ側にある。

| 事実 | どこ |
| --- | --- |
| ホットバーは roving `tabindex` の**1 タブストップ**。`'0'` / `'-1'` は `root` に書かれる | `mx-ui/application/slot-element.ts` `setSlotTabStop`（`tabStop: attributeCell(root, 'tabindex')`） |
| リングは**スロットごとの専用要素**（`data-mx-ui="slot-focus-ring"`）で、`hidden` 1 属性で切り替わる | 同 `createSlotElement` / `setSlotKeyboardFocus` |
| 受け口は `HudView.setKeyboardFocus(index: number \| undefined)`。`undefined` は全リング消灯、`0` はスロット 0 点灯 | `mx-ui/application/hud-view.ts` `applyKeyboardFocus`（`DEFAULT_TAB_STOP_INDEX = 0`） |
| mx-ui は**リスナを 1 本も持たない**。`addEventListener` も `focus()` も、向こうの `dom-surface.ts` に**無い** | `mx-ui/application/hud-view.ts` ヘッダ、`mx-ui/application/dom-surface.ts` |
| 「このリポジトリだけでは閉じられない唯一の点。閉じるにはキーストロークに**気づく**必要がある」 | `mx-ui/docs/design-notes.md` DN-UI-13i |
| 向こうがそれを回帰テストで固定している | `REGRESSION: making a slot focusable did not add a listener or a way to move focus` |

`tabindex` が `slot.root` に載っていることは配線上の要点である——
`focusin` の `event.target` は**スロットの root 要素そのもの**になるので、
ホストが渡すロスタは `[data-mx-ui="slot"]` の root 群でよい
（[public-api.md](./public-api.md) §2.10.6）。

### 1. Tab を `preventDefault` するとキーボードトラップになる

これが一番踏みやすい。入力を所有する側は「Tab を取って自前でフォーカスを動かす」に手が伸びる——
`contextmenu` も `wheel` も既にそうしているからである。**この 3 つは同じではない。**

| 既定動作 | 飲み込むと失うもの | 絞り込み |
| --- | --- | --- |
| コンテキストメニュー | チャット行の「コピー」、テキスト欄のスペルチェック | ロック中のみ（`suppressesBrowserContextMenu`） |
| ページスクロール | 設定画面の下端 | ロック中のみ（`suppressesBrowserScroll`） |
| **フォーカス移動（Tab）** | **出口が全部**。ブラウザのクロム、次のコントロール、次のフレーム、そして「縛り直して脱出する」ための設定画面 | **無し。どのロック状態でもしない** |

WCAG 2.1 SC 2.1.2（No Keyboard Trap）そのものである。
しかも自己修復不能なのが効く: 縛り直せば直る類の不具合ではない、
**縛り直す画面に到達できない**からである。

だから対になる述語を**作っていない**。`suppressesBrowserFocusNavigation(pointerLocked)` は
恒偽の関数であり、恒偽の述語は「いつか true になる分岐がある」という誤った合図である。
代わりに `FOCUS_NAVIGATION_POLICY`（`application/input-service.ts`、`ESCAPE_POLICY` の隣）に
`preventDefault: false` を**値として**置いた。
「抑止しない」は**何かを足すことで破られる**約束であり、
不在としてしか存在しない約束は CI が見張れない。

### 2. Escape の規則と Tab の規則は**形が逆**である

同じ「1 キー 1 所有者」に見えて、非対称である。

| | Escape | Tab |
| --- | --- | --- |
| 所有者 | フレーム級の単一ハンドラ（DN-05） | ユーザーエージェント |
| 所有者はどこに居るか | **アプリの中** | **アプリの外** |
| 動かせるか | 動かせる（設計判断） | **動かせない。上書きできるだけ** |
| 規則の向き | 中の所有者を 1 人に固定し、2 人目を禁じる | 外の所有者を認め、**アプリが 2 人目になることを禁じる** |

`remap` は Tab を `key-reserved-by-user-agent` で拒否する。
縛れてしまうと、その 1 押しは**必ず 2 つのことをする**——アクションが走り、同時にフォーカスが動く。
1 つにする方法は `preventDefault` しかなく、それが上の 1 である。
除去できない所有者に 2 人目を足さない。

バニラの Tab はプレイヤーリストである。ブラウザはバニラではない。
プレイヤーリストは他のどのキーにでも縛れるが、**両方の意味を持つ Tab は縛れない**。
`actionForKey` にも同じガードを置いてある: `remap` は書き込みを止めるだけで、
規則が存在する前に書かれた永続設定 blob はこの関数に直接届く。

### 3. ロック中に**消す**と、ロックが明けたときリングとフォーカスがずれる

ロック中に報告しないこと自体は素直である（キーはアバターを動かしており、
そのときのリングは次のキーが何をするかについての嘘である）。
踏むのはその**実装のしかた**である。

`dispatch` でイベントを捨てる／状態を `undefined` にする、のどちらでも同じ壊れ方をする:

```
Tab でスロット 3 → クリックしてロック取得 → Escape でロック解除
  消していた場合: リングはどこにも無い。しかしブラウザのフォーカスはスロット 3 のままなので、
                  次の Space はスロット 3 を叩く。**見えているものと起きることが違う**
```

ポインタロックは**キーボードに触らない**。だからフォーカスは本当にまだそこに在る。
生の観測を `InputState.keyboardFocus` に保持し、**読み出しで** `reportsKeyboardFocus` を掛ける。
マスクは可逆で、消去は不可逆である。

同じ理由で `blur` と `clearHeld` も `keyboardFocus` だけは**明示的に持ち越す**。
DN-08 の「blur で保持キーを消す」は、**ブラウザが keyup を送ってこない**から必要なのであって、
フォーカスは事情が逆である——ウィンドウが非アクティブになっても中の DOM フォーカスは動かず、
ブラウザは戻ってきたときに同じ要素へ復帰させ、たいてい再通知しない。
ここで消すと、タブを切り替えただけでリングが消えて二度と戻らない。
本当に離れたときは `focusout` が来る。

### 4. `focus` ではなく `focusin`、属性ではなく**同一性**

2 つとも「動くように見えるがスケールしない」選択肢がある。

**`focus` / `blur` はバブルしない。** スロットごとにリスナを付けることになり、
このリポジトリが所有しない要素を知り、HUD が組み直されるたびに登録し直すことになる
（DN-04 の「登録は 1 箇所」が壊れ、`LISTENER_PLAN` がホストごとに変わる）。
`focusin` / `focusout` は `document` の 1 本で、**まだ存在しないスロットも覆う**。

**`data-slot-index` を読むと 2 通りに壊れる。**
1 つは領域ローカルであること（ホットバーのスロット 0 とインベントリのスロット 0 は同じ値）。
もう 1 つが効く方で、`getAttribute` を `dom-surface.ts` に入れると
**DN-15 の代入可能性の証明が壊れる**: 実物の `Event.target` は `EventTarget | null` で
`getAttribute` を持たず、全省略可能なオブジェクト型は weak type なので TypeScript が即座に拒否する。
`Event` が `DomInputEvent` に代入できなくなり、リスナ引数は反変なので
`Window` が `DomEventTarget` に代入できなくなる。そして `pnpm typecheck` は**何も言わない**。

だから `target?: unknown` の 1 フィールドだけを足し、
`resolveFocusTarget` は `===` で照合して配列位置を返す。
`unknown` を選んだ理由は `pointerLockElement` が `unknown` である理由と同じ——
**比較しかしないから**である。
`application/dom-surface.ts` に増えたのは `DomInputEvent` の省略可能フィールド **1 つだけ**で、
型宣言も述語も 1 つも増えていない（`index.ts` 経由の公開エントリは 7 つのまま）。

### 5. 観測の外に残った 2 点。**どちらも観測の欠陥ではなく、決定が要った**

（両方とも閉じた。(a) の採用条件だった mx-ui 側の合意は、まだ得ていない——
下記「(a) を閉じたが、まだ残っている 1 点」を参照。）

入っているのは**観測**であり、それは mx-ui が名指しで待っていたもの
（DN-UI-13i「閉じるにはキーストロークに気づく必要がある」）そのものである。
一方で `setSlotTabStop` のコメントは「`'-1'` にして**消さない**のは、
入力を所有する側がグループ**内**でフォーカスを動かせるようにするためだ」と書いている。
その動詞はまだ無い。書いておかないと、次に読む人が観測の側を疑い始める。

**(a) グループ内の移動（矢印キー）が無かった。—— 閉じた。** ホットバーはタブストップが 1 つ
なので、Tab で入れるのは常に `DEFAULT_TAB_STOP_INDEX`（= スロット 0）だけだった。
`focus()` を呼ぶ主体が居なかったので、キーボードだけでスロット 1..8 に
**リングを動かす手段が無かった**。

閉じるには**この 1 リポジトリだけでは決められない 3 点**が要ると書いていた:
`dom-surface.ts` に `focus()` を足す（DN-15 の代入可能性の証明をやり直す）、
どのキーが移動するかを決める（矢印か、Home/End か、循環するのか）、
そして**ロック中はそのキーが移動してはならない**。3 つとも決めて閉じた:

| 決定 | どこ | 理由 |
| --- | --- | --- |
| `focus(): void` を `FocusableTarget` として `dom-surface.ts` に足した | `application/dom-surface.ts` | `preventDefault` と同じ理由で REQUIRED。全省略可能型は weak type で、TS が拒否する |
| 矢印（`ArrowLeft`/`ArrowUp` が -1、`ArrowRight`/`ArrowDown` が +1）、循環する | `domain/focus-navigation.ts` の `focusNavigationStepForCode`、`domain/input-bindings.ts` の `wrapHotbarSelection` | ホットバーは 1 行なので `up`/`down` は `left`/`right` と同じ意味にした。循環はホイールでの既存の巡回（`wrapHotbarSelection`）と揃えた——新しい巻き込みの罠を作らないための再利用 |
| ロック中は移動しない | `application/browser-input-adapter.ts` の `resolveFocusNavigationTarget` | `reportsKeyboardFocus` が読み出しに掛けているのと同じマスクを、書き込み側にも掛けた |

`FocusGroupTargets.targets` は `ReadonlyArray<unknown>` から `ReadonlyArray<FocusableTarget>` へ広がった——
比較だけだった箱に、初めて**書き込み**（`.focus()`）が 1 つ増えた。
`resolveFocusTarget` はそれでも読まない: `Array.prototype.indexOf(target)` は
`target: unknown` を `FocusableTarget` へ渡すことになり弾かれるので、
`findIndex((candidate) => candidate === target)` に書き換えた——比較の中身は変わっていない。

**`preventDefault()` は呼んでいない。** `mayPreventDefault` に `keydown` の場合分けは無く、
これからも無い——足せば Tab も対象になる（REGRESSION テストが既にこれを固定していた）。
`ARROW_FOCUS_NAVIGATION_POLICY.owner` が `'host'` なのはこのためで、
矢印キーの既定動作を抑止するかどうかは**ホストの判断**であり、
このアダプタの判断ではない。

#### (a) を閉じたが、まだ残っている 1 点

`dom-surface.ts` の `focus()` と、キーが動く/動かない条件は
**この 1 リポジトリで決められる**ことだったので決めて閉じた。
決められなかったのは「**mx-ui 側がこの挙動を望むかどうか**」で、それはコードの依存ではなく、
公開後の UX が両リポジトリのオーナーにとって正しいかという合意の問題である
（`HudView.setKeyboardFocus` は既にどんな index も受け付けるので、
mx-ui 側のコード変更は要らない——変わったのは「呼ばれる回数」だけである）。
まだ mx-ui と確認していない。

**もう 1 点、mx-ui との合意とは別の軸で残っている。** 実 `HTMLElement.focus()` が実際に
`document.activeElement` を動かし `focusout`/`focusin` を発火させることは、
`test/browser-input-adapter.test.ts` のフェイクでは確かめられない——それはブラウザについての
事実であって、このアダプタについての事実ではない（同テストのコメント）。手作業で CDP 越しに
実ブラウザを駆動して一度確認されたが、コミットされたチェックとしては存在しない。
このリポジトリがブラウザテスト一式を持たない理由と、この 1 点をどう扱うかは
[testing.md](./testing.md) §8.2 に書く——ブラウザテストを足すかどうかは
1 タスクの一存で決めることではない。

**(b) HUD の上のクリックが、ポインタロック要求になる。—— 閉じた。**
これは DN-12 / DN-14 から来ていた既存の穴で、
**フォーカス可能な DOM UI が実在するようになったことで初めて手が届く**ようになった。

```
非ロック中、プレイヤーがホットバーのスロットをマウスでクリックする
  → tabindex="-1" の要素はクリックでフォーカスされる → focusin → リング点灯（正しい）
  → 同じ mousedown が window に届く → uiClicks に入る
  → render:input が acquiresPointerLock('MouseLeft', 'unlocked') = true を見る
  → requestPointerLock → 許可されると locked → reportsKeyboardFocus が false
  → リングが消え、プレイヤーは視点操作に放り込まれる
```

`acquiresPointerLock` は `(button, state)` の純粋述語で、
**クリックがどこに落ちたかを知らなかった**。
そして知る手段が当てにできないのが当時の判断だった:
DN-04 の遮蔽規則は「モーダルが `document` で `stopPropagation()` する」ことを前提にしているが、
**mx-ui はリスナを 1 本も持たない**（上の証跡表）ので、`stopPropagation()` を呼ぶ主体が居ない。
だから選択肢は 3 つあり、どれも境界をまたぐ、と書いていた:

| 案 | 誰が変わるか | 判定 |
| --- | --- | --- |
| mx-ui が消費したクリックを `document` で `stopPropagation()` する | mx-ui（`addEventListener` を持つことになる。DN-UI-4 が明示的に拒否してきた方向） | 不採用 |
| ホストが HUD の下に canvas を置き、ロック要求を canvas スコープの `mousedown` に限る | ホスト（`LISTENER_PLAN` の `mousedown` は `window` のままなので、要求の判断だけを分ける） | 不採用 |
| `acquiresPointerLock` に「クリックが UI に落ちたか」を渡す | mc-render（`dom-surface.ts` に `contains` か `composedPath` が要る。DN-15 の面が増える） | 不採用（下記のとおり `contains` は要らなかった） |
| **`acquiresPointerLock` に「クリックがどこに落ちたか」を名前で渡す** | **mc-render だけ。DOM 面は 1 バイトも増えない** | **採用** |

**4 番目が在ることに気づいていなかった。** アダプタは既に `event.target` を読んでおり
（フォーカス解決のために `target?: unknown` を 1 つだけ足してある）、
`resolveFocusTarget` は既にそれを**要素の同一性**でロスタと照合している。
つまり mc-render は「クリックがどこに落ちたか」を**もう知っている**。
足りなかったのは、その答えを述語まで運ぶ 1 語だけだった。

### 採った述語 —— 「ロック対象に落ちた」であって「UI に落ちなかった」ではない

`ClickLanding = 'lock-target' | 'ui' | 'elsewhere'`（`domain/input-bindings.ts`）。
`acquiresPointerLock(button, state, landing)` は
`landing === POINTER_LOCK_ACQUIRE_LANDING`（= `'lock-target'`）を要求する。

2 つの述語は**どちらにも落ちなかったクリック**で分岐する。理由は 3 つ:

1. **開世界 vs 閉世界。** 「UI ではない」はホストが列挙し忘れたもの**全部**にポインタを与える。
   「ロック対象である」はホストが名指しした 1 要素にだけ与える。
   宣言を忘れたときの代償が、前者は「リンクをクリックしたらマウスルックに放り込まれる」、
   後者は「マウスルックに入れない」である。後者は最初の 1 回で見え、しかも人を混乱させない。
   ポインタを奪う操作は**カーソルが消え、リングもマスクされる**——
   自分で自分を隠す失敗なので、既定は「与えない」でなければならない。
2. **ホストの宣言が 1 つも増えない。** ロック対象とは
   `BrowserInputOptions.canvas`、すなわち `makeBrowserPointerLockPort` が
   `requestPointerLock()` を呼ぶ当の要素である。**ロックできるホストは既にそれを名指ししている**し、
   名指ししていないホストは `UNAVAILABLE_POINTER_LOCK` で最初からロックできない。
   規則を 1 行で言えば **「ロックを受け取る要素が、ロックを要求するために押すべき要素である」**。
   一方「UI ではない」は、UI を描く**すべての**ホストに新しいロスタを要求し、
   忘れたホストは壊れたまま・しかも静かに残る。
3. **「UI」はロスタの語彙では言えない。** ロスタは**フォーカス**のために在るので、
   `onclick` だけの `<div>`、レターボックスの帯、ホストが描いたヘッダは入っていない。
   「UI ではない」はそれら全部にポインタを与える。

### 第 3 の場合（`elsewhere`）はどうなるか

**要求しない。** 固定アスペクト canvas の脇の黒帯、ページ背景、ホストが描いて宣言しなかったヘッダ
——どれも「ゲームのビューポート」ではなく、クリックの既定の意味がマウスルックであってはならない。

`ui` と `elsewhere` は**判定が同じなのに 2 つの名前のまま**にしてある。診断のためである:
ロック対象の同一性が壊れたとき（ホストが canvas ではなくラッパ `<div>` を渡した、
HUD を建て直したのに入力スコープを建て直していない）**全クリックが `elsewhere` になり、
マウスルックが静かに動かなくなる**。boolean だとこのバグと「HUD クリックを正しく断った」が
同じ値になる。3 値なら、テストもデバッグオーバーレイも**どちらの半分が壊れたか**を言える。

### DOM 面は増えていない。`contains` は要らなかった

`event.target` は**ヒットテストが見つけた最も深い要素**である。だから:

- canvas の**上に**描かれた DOM HUD は、そこへのクリックの `target` そのものになる
  → `ui` / `elsewhere` に解決され、下の canvas にはならない。**これが穴の閉じ方である**
- `pointer-events: none` の HUD 要素はそもそもヒットせず、クリックは canvas に届き、
  同時に何もフォーカスしない → ロックしてよい。矛盾しない

`<canvas>` に**描画される子要素は無い**（中身はフォールバックでヒットテストされない）ので、
`contains` が歩く部分木が存在しない。よって `dom-surface.ts` は**1 メンバも増えていない**
（`target?: unknown` は前回の観測導入で既に在る）。
`test/fixtures/dom-surface.ts` には**証明を 1 つ足した**:
`scopesTheLockToAnElementItOnlyCompares` —— ロック対象を `===` でしか触らないハンドラが
本物の `lib.dom.d.ts` に対して診断 0 でコンパイルすること。
`contains` を足していたら `EventTarget` には無く `Node` にしかないので
**`Event` が `DomInputEvent` に代入できなくなり、反変性で `Window` が `DomEventTarget` に
代入できなくなる**（DN-15 §「採ったかたち」）。フィクスチャのコメントに
「ここが落ちたら `contains` に手を伸ばすのではなく、比較に留まれ」と書いてある。

**残る限界を明示しておく。** ホストが canvas ではなく**コンテナ要素**をロック対象にすると
（`Element.requestPointerLock` は任意の要素に在る）、その子へのクリックは `elsewhere` になる。
そのホストは canvas を名指しするべきである。この 1 ケースのために
DN-15 の代入可能性の証明をやり直す価値は無い。

### 誰がまだ必要か —— **誰も要らない**

**mx-ui は変わらない。** リスナも `stopPropagation()` も要らず、
DN-UI-4 の「`addEventListener` を持たない」は無傷である。
**ホストも新しい宣言をしない。** `browserInputLayer` が `options.canvas` を
ロック要求の宛先とクリックのスコープの**両方**に渡す。
`installInputListeners` を直に呼ぶホスト（Port を自前で組む場合）だけが
第 4 引数で canvas をもう一度渡す必要がある。
残っているのは §5(a)（グループ内の矢印キー移動）だけで、そちらは**依然 mx-ui と一緒に決める**。

### 書くべき回帰テスト

`test/input.test.ts` の 3 つの describe と `test/browser-input-adapter.test.ts` の 2 つ。

| テスト名 | 内容 | 場所 |
| --- | --- | --- |
| `a focus change is visible in the snapshot — the half mx-ui was waiting for` | 穴そのもの | input |
| `focus leaving the group is undefined and NOT slot zero` | mx-ui の `undefined` / `0` の非対称 | input |
| `endFrame does NOT clear it: focus is a LEVEL, like pressed and unlike justPressed` | フレーム境界の一貫性 | input |
| `blur PRESERVES it — the browser does not move focus when the window loses it` | 上記 3。DN-08 との差 | input |
| `clearHeld preserves it too, for the same reason` | 同上 | input |
| `focus is NOT reported while the pointer is LOCKED — Tab then is not navigation` | ロック規則 | input |
| `REGRESSION: the lock MASKS the focus, it does not forget it` | **上記 3 の本体** | input |
| ``the mask is exactly `locked`: requested and refused still report`` | 4 状態のうちどれか | input |
| `NOTHING suppresses Tab: the preventDefault list stays at wheel and contextmenu` | **上記 1** | input |
| `Tab cannot be bound to an action — the owner that cannot be removed gets no second` | 上記 2 | input |
| `actionForKey never resolves Tab, even from a corrupt persisted blob` | もう 1 つの入口 | input |
| `a Tab keydown still reaches the service as an ordinary held code` | 飲み込んでいないこと | input |
| `Escape and Tab have OPPOSITE policy shapes, and that is the design` | 上記 2 | input |
| `they are focusIN and focusOUT, because only those two BUBBLE` | 上記 4 | input |
| `an element in the roster becomes its group and its 0-based position` | 境界の変換 | adapter |
| `an element NOBODY named reports no focus — never slot zero` | `indexOf` の `-1` を丸めない | adapter |
| `focusout ALWAYS reports no focus, whatever element it came from` | 離脱側を解決しない | adapter |
| `resolution is by IDENTITY, so an equal-looking element is not the same slot` | 上記 4 | adapter |
| `a move within the group settles on the ARRIVAL, not on the departure` | focusout→focusin の順序 | adapter |
| `REGRESSION: no focus handler EVER calls preventDefault` | **上記 1 を実リスナ越しに** | adapter |
| `the focus listeners make NO preventDefault claim — no passive: false on either` | 上記 1 を登録オプションの側から。`passive: false` は「既定を抑止しうる」の宣言であり、フォーカスのハンドラが名乗ってはならない | adapter |
| `a real Window, Document and HTMLCanvasElement satisfy the adapter without a cast` | `target` を足しても DN-15 が成立。**ロック対象を `===` でしか触らないハンドラも含む**（§5(b)） | adapter |

§5(b) の分（**実装済**。名前は「どちらの半分が壊れたか」を言うようにしてある）:

| テスト名 | 内容 | 場所 |
| --- | --- | --- |
| `DN-16 §5(b): only a click on the LOCK TARGET asks — a HUD click does not` | 述語の真理値表。旧 `(button, state)` では全行 true | input |
| `DN-16 §5(b): a click on NEITHER asks for nothing — the rule is "on the lock target", not "not on UI"` | **第 3 の場合**。2 つの述語が分岐する唯一の点 | input |
| `DN-16 §5(b): the landing does not decide whether it is a uiClick — every unlocked click is one` | HUD クリックを `uiClicks` から落とさないこと（落とすと、その要素を描いたメニューに届かない） | input |
| `DN-16 §5(b): two clicks in ONE frame keep their own landings` | 対の列である理由 | input |
| `DN-16 §5(b): one physical click delivered twice is ONE ui click, landing and all` | 重複排除は対の単位 | input |
| `DN-16 §5(b): endFrame clears the landings with the clicks, because both are the same edge` | フレーム境界 | input |
| `DN-16 §5(b): a HUD click does NOT mask the focus ring, and a canvas click does` | **プレイヤーが見る症状**。後半が無いと「マスク自体が壊れた」でも通ってしまう | input |
| `the LOCK TARGET is recognised by identity, and only by identity` | 同一性。構造的に等しい別要素は別物 | adapter |
| `a REGISTERED UI element is \`ui\`, which is the landing that never asks` | ロスタ側 | adapter |
| `an element in NEITHER is \`elsewhere\`, and that is a third answer and not a \`ui\`` | 第 3 の場合を名前として持つこと | adapter |
| `a click on NOTHING is \`elsewhere\`, even when the host named no lock target` | `undefined === undefined` の罠。宣言なしホストで全クリックがロックを取る失敗 | adapter |
| `the lock target WINS over a roster that also names it, so the tie is not silent` | 優先順位の明示 | adapter |
| `the translation puts the landing on the event, and on mousedown only` | `mouseup` は無条件解放なので持たない | adapter |
| `a click on a HOTBAR SLOT is a uiClick that does NOT ask for the lock` | **穴そのもの**を実リスナ越しに | adapter |
| `the ring the click LIT is still reported, because nothing locked` | 同上の見える側 | adapter |
| `a click on the CANVAS does ask, so mouselook still works` | 直さないことを直していないこと | adapter |
| `a click on NEITHER does not ask — the third case, through the real listener` | 第 3 の場合を実リスナ越しに | adapter |
| `browserInputLayer scopes the click to the canvas it was ALREADY given` | ホストの宣言が増えないこと | adapter |
| `a host with NO canvas resolves every click as elsewhere, and could never lock anyway` | 後方互換 | adapter |
| `a click while LOCKED is a game action, and the landing decides nothing` | ロック中は参照しないこと | adapter |
| `no click handler EVER calls preventDefault, whatever it landed on` | 着地は**観測**であること。抑止すればフォーカス移動そのものを壊す | adapter |
| `DN-16 §5(b): a click on a REGISTERED UI ELEMENT does not ask for the lock` | フレーム段（`render:input`）が実際に要求しないこと | stage |
| `DN-16 §5(b): the same click IS still a uiClick — the menu that drew the slot wants it` | 同上 | stage |
| `DN-16 §5(b): a click on the LOCK TARGET does ask — the fix did not break mouselook` | 同上 | stage |
| `DN-16 §5(b): a click on NEITHER asks for nothing — the rule is "on the lock target"` | 同上 | stage |
| `DN-16 §5(b): the ring survives a HUD click, and only a canvas click masks it` | マスクの可逆性まで含めた往復 | stage |

---

## DN-17 パーティクルプールは固定容量 + drop-oldest。乱数はシード付き

全文: `domain/particle-pool.ts` のヘッダ。

### 参照実装の証跡

| 事実 | 出典 |
| --- | --- |
| 容量 512 | `packages/rendering/infrastructure/particles/particle-system-factory.ts:5` |
| 寿命 0.5 秒 / 重力 12 m/s² / クォッド 0.1m | 同 `:6` / `:7` / `:8` |
| 散り幅（水平 2.0 / 上 3.0 / 下 0.5、**非対称**） | 同 `:11-13` |
| 既定バースト 6 個 | `particle-system.ts:126` |
| dt クランプ 0.1 秒 | 同 `:166`（理由は `:164-165`） |
| **満杯時は最古を追い出す** | `particle-system-factory.ts:147-169` + `:130-145`、コメント `:167`「Pool full -> evict oldest」 |

### 数値の出所（重要）

**容量 512 は転記であって正当化ではない。** 参照実装は測定も予算も導出も残していない。
本リポジトリでは再測定できない（GPU が無い）。**「調整済みの数値」として引用してはならない。**

### 参照実装から意図的に外した 3 点

1. **最古の求め方。** 参照実装は `ages: Float32Array` に単調増加のスポーンカウンタを持ち、
   `:101-102` に「60fps で ~136 年で一周する。無関係」と書く。
   **その注釈は別の問いに答えている。** float32 に入れたカウンタの制約は一周ではなく
   **2^24 = 16,777,216 で連続整数を表現できなくなること**で、そこを越えると全スロットが同値になり
   `findOldestSlot` は永遠にスロット 0 を返す。
   本実装は `ages` を持たず、**残り寿命**で順序を読む —— 寿命が単一定数である限り
   残り寿命はスポーン時刻の狭義単調減少関数だからである。
   その前提は `evictionOrderIsSpawnOrder` という値にしてテストで固定した。
   **パーティクル種別ごとの寿命を入れる日に、この等価性は壊れる。**
2. **`Math.random()` を使わない。** 参照実装 `:171-174` はアロケータ費用だけを比べて
   `Math.random` を選んでおり、**再現性の問いに触れていない**。plan.md §5.1-3 が再現性を
   オラクル利用の前提にしている。mx-gameplay `domain/frame-rolls.ts` の MINSTD を**転記**した
   （mx-gameplay は依存許可外）。
3. **`count = 0` と `dt = NaN`。** 参照実装は前者を `Math.max(1, ...)` で 1 個にし、
   後者は `Math.max(0, Math.min(NaN, 0.1))` が NaN になるためプール全体を汚染する。
   どちらも不活性な方向に倒した。回帰テストで固定。

### 回帰テスト

`test/particle-pool.test.ts`。`it evicts the OLDEST particle` と
`and it does NOT evict the newest` は対で置くこと（§5.5）——
前者だけならスロット 0 を返すだけの実装も通る。

---

## DN-18 水面は平面。だから `forceSinglePass` は正しい。屈折はゲート 6 つ

全文: `domain/water-surface.ts` と `domain/water-refraction.ts` のヘッダ。

### `forceSinglePass` の穴

DN-02 の述語（`shared && two-pass && cutout`）は**水面を分類できない**。
`alphaTest` が 0 だからである。詳細と対処は
[responsibility.md §2.1](./responsibility.md)。要点だけ:

- 参照実装は `water-material.ts:137` でフラグを立てており、それは**正しい**
- 正しい理由は「平面だから」であって「cutout だから」ではない
- `material-policy.ts:62-63` は基準を「cutout **または平面**」と書き、`:92-96` で cutout 側だけを述語にした
- 共有述語は書き換えていない。欠けた条項を `WATER_SURFACE_IS_FLAT` として合成した

### 数値の出所

| 値 | 出典 | 種別 |
| --- | --- | --- |
| F0 = 0.02 | `water-material.ts:74,79` | 転記。ただし**導出可能** —— 屈折率 1.333 から `((1-n)/(1+n))²` = 0.020373。テストで一致を確認している |
| パレット / アルファ 0.86 / 太陽減衰の下限 0.30 | 同 `:83-84` / `:107` / `:106` | 転記。根拠は**画についての判断**（`:81-82`）で、ここでは検査不能 |
| リップル振幅 0.014（**画面 UV**、世界単位ではない） | 同 `:66` | 転記 |
| 屈折の最小画面比 0.05 / 0.005 | `settings-service.config.ts:31,44,53,62` | 転記 |
| 屈折の間隔 low/medium 0・high 2・ultra 1 | 同 `:30,43,52,61` | 転記。**high は ultra より更新が疎い** |

### 正弦近似に付いた「~0.056」は別の関数の性質である

`water-material.ts:50-56` の `fastSin` は
`mod(x, 2π) - π` で簡約する。GLSL の `mod` は `[0, y)` を返すので、
これは多項式を `x - π` で評価する —— つまり **`-sin(x)` を近似している**。
実測: `sin` に対する最大誤差 2.0000、`-sin` に対して 0.05601。
コメントの `~0.056` は**多項式**（Bhaskara）については正しく、
**それが貼られている関数**については正しくない。DN-02 の `p95 33ms → 9.2ms` と同じ形の誤りである。

**リップルでは無害**（振動場の符号反転は位相の反転にすぎず、誰にも見えない）。
だから残った。本実装 `waveApprox` は名前どおり `sin` を近似し、
誤差 0.056 は**引用せずこの場で測っている**（`test/water-surface.test.ts`）。
なお JavaScript の `%` は被除数の符号を保つので、GLSL からの逐語転記は**負の入力で更に壊れる**。

### 屈折プリパスのゲートは 6 つで、順序は答えを変えない

参照実装では 3 ファイル 2 パッケージに散っており、6 つあることは呼び出し連鎖を追わないと分からない
（カメラ判定に至っては**2 箇所に重複**している）。データにしてある。

順序は参照実装から**意図的に変えた**: 最も高価な画面比ゲート（水メッシュごとに AABB 8 隅を射影）より、
最も安いキャッシュゲート（float 比較 12 回）を先に置いた。
**安全である理由**は 6 つが相互に独立な述語だからで、それは主張ではなく
**720 通り全数**のテストで固定してある（§5.3）。
順序が変えるのは**理由**と**支払った計算量**だけで、走るか否かではない ——
理由まで一致すると主張するのは嘘なので、テストはそこを assert していない。

---

## DN-19 アトラス UV はハーフテクセル内側。V は反転する

全文: `domain/texture-atlas.ts` のヘッダ。

### 参照実装の証跡

`packages/rendering/infrastructure/textures/block-texture-map.ts:9-11`
（`ATLAS_COLS = 16` / `ATLAS_SIZE = 512` / `HALF_TEXEL = 0.5/512`）と `:14-26`（`getTileUVs`）。
いずれも**転記であって正当化ではない** —— 参照実装は導出も測定も書いていない。
検査できるのは 3 つが**互いに整合すること**で、`atlasLayoutViolations` がそれを見る。

### 見つけた不整合（**これは本リポジトリの導出**であり、参照実装の記述ではない）

`getParticleUvOffset` は**内側に寄せた**原点 `(u0, v0)` を返し（`particle-system-factory.ts:57-64`）、
`buildParticleGeometry` はクォッドの UV 幅に `TILE_FRACTION = 1/16` すなわち
**寄せていない**タイル幅を使う（同 `:39-54`、`:17`）。
シェーダは両者を足す（`particle-system.ts:84`）ので、パーティクルは

    [ col/16 + HALF_TEXEL , (col+1)/16 + HALF_TEXEL ]

をサンプルする —— 遠い側の端が**タイル境界を半テクセル越えて隣のタイルに入る**。
近い端に掛けた内寄せを、遠い端で全幅を使うことで打ち消している。

**影響の正直な見積り**: 0.1m のクォッドの 2 辺に 1 テクセルの滲み。プレイヤーは報告しない。
直したのは**ただで直るから**と、**同じ誤りがチャンク面で起きれば古典的に目立つ**からである。
`uvPatchStaysInsideTile` が 2 つの幅を判別し、テストが参照実装側を**落とす**ことを固定している。

### V 反転

画像ファイルは上から、GL の V は下から数える。対称なタイルでは見えず、草ブロックでは一目で分かる ——
**手元で試した内容次第で生き延びる**という最悪の組合せである。
`tileIndexForUvOrigin` で逆写像を作り、256 タイル全数で往復させている。
**片方向だけでは捕まらない**: 反転を逆に書いても写像は依然として全単射である。

---

## DN-20 パーティクルは `InstancedMesh` を使わない。`InstancedBufferGeometry` で十分

全文: `application/particle-system.ts` のヘッダ「IT DOES NOT USE `THREE.InstancedMesh`」。

### 背景

`domain/particle-pool.ts` のヘッダは参照実装（`particle-system-factory.ts:96-128`）が
`THREE.InstancedMesh` を使っていたことを記録している。本リポジトリの実装は
**それを使っていない** —— 代わりに `InstancedBufferGeometry` と
`InstancedBufferAttribute` を `application/three-surface.ts` の
`ThreeInstancedSurface` 経由で直接組んでいる（`InstancedMesh` 自身がその 2 つの上に
built されている、three.js 本体の実装と同じ層）。外部のギャップ一覧がこれを
「instanced-mesh クラスが無い」と読んだ形跡があるが、**instancing 自体は既にある**——
無いのは `InstancedMesh` という名前の便利クラスだけである。

**「1 描画呼び出し」は `InstancedMesh` の持ち物ではない。** それは
`InstancedBufferGeometry` 自身の性質で、`ThreeInstancedBufferGeometry` の
コメント（`application/three-surface.ts`）が既に書いている——`instanceCount` が
three に「先頭 N インスタンスだけ描け」と伝える、その 1 フィールドがそれである。
`InstancedMesh` は `Mesh` に `instanceMatrix` という便利フィールドを足したものに
過ぎず、同じ instanced-geometry の仕組みの上に built されている。だから
`InstancedMesh` を使わない選択は描画呼び出しを 1 つも増やさない —— この問いが
出る前から、描画は既に 1 回である。増えるのは `instanceMatrix` を**足すかどうか**
だけで、本実装はそれを必要としない。

### 使わない理由。コストが 2 つ増え、買えるものが無い

| | `InstancedMesh` | 本実装 |
| --- | --- | --- |
| インスタンスあたりのバイト数 | `instanceMatrix`: `Float32Array(count * 16)` = 64 バイト（`Matrix4` 1 個） | `instancePosition`(3) + `instanceScale`(1) + `instanceUvOffset`(2) = 24 バイト（`PARTICLE_INSTANCE_ATTRIBUTES`、`domain/particle-shader.ts`） |
| 毎フレームの更新 | `setMatrixAt(i, matrix)` をインスタンスごとに呼ぶループが要る | 無い。`ParticlePool` の typed array を直接エイリアスしているので `advanceParticles` の結果がそのまま GPU に渡るバイト列 |
| アトラス UV の置き場 | `instanceMatrix` に無い。結局 `instanceUvOffset` 用の `InstancedBufferAttribute` を別途足すことになる | 最初からそのアタッチメント 1 つだけ |

`Matrix4` が要るのは任意回転・非一様スケールのためで、このパーティクルは
どちらも使わない —— ビルボード回転はカメラ基底からの頂点シェーダ計算であって
インスタンスごとの行列ではない（`domain/particle-shader.ts` 「WHY THE QUAD IS
BILLBOARDED IN THE VERTEX STAGE」）。買えない能力に 40 バイト/インスタンスと
毎フレームのループを払う理由が無い。しかも `instanceUvOffset` は `instanceMatrix`
の中に場所が無いので、`InstancedMesh` に切り替えても**カスタム attribute が 1 つ
減るわけではない** —— `instanceMatrix` の分だけ増える。

`application/particle-system.ts` の「THE POOL IS NOT COPIED」はこの判断の裏面でもある:
`setMatrixAt` ループを入れれば、そのループ自体がここで避けているコピー/マーシャリングに
なる。

### 再開の条件

インスタンスごとの回転や非一様スケールが要る機能が来たとき——そのときだけ
`InstancedMesh` への切り替えを検討する。現状はどちらも使っていない。

### 回帰テスト

`test/particle-system.test.ts` の `geometry.instanceCount` を読むテスト群が、
「1 ジオメトリ・1 マテリアル・1 描画呼び出し・可変インスタンス数」という形そのものを
固定している。「`InstancedMesh` を使っていないこと」自体を検査するテストは無い——
使っていないのは import の不在であり、型システムがそれを保証する
（`ThreeInstancedSurface` に `InstancedMesh` のコンストラクタが無い）。
