# 公開API

plan.md §3.9 は主要な公開APIを

> `WorldRenderer`（chunk ダーティ購読→メッシュ更新）、ポストFXチェーン、`InputService`、
> グラフィックス品質プリセット適用

と書いている。本書はそれを、**参照実装の実コードと突き合わせて**具体化したもの。
パスはすべて `takeokunn/ts-minecraft` リポジトリルート相対。

## 0. 参照実装のサービス定義方式

参照実装は `Effect.Service` クラスを主に使い、一部で `Context.GenericTag` を使う
（`packages/game/domain/physics-port.ts:14,22,29`）。
Tag 名は `@minecraft/...`。

**新実装は `Context.Tag` + 明示的な `Layer` に統一する**（`application/input-service.ts` 参照）。
理由は mc-sim の `docs/public-api.md` §0 と同じで、加えてこのリポジトリ固有の理由がある:
**kit がプレビューを 2 枚並べる**ので、レンダラも入力サービスも複数インスタンス作れる必要がある。
参照実装の `entity-renderer.ts:39-41` が scratch をモジュールロード時ではなく
サービスファクトリ内で作っているのは、テストのモック都合だが結果として同じ性質を得ている。

Tag 名は `@nerima-games/mc-render/XxxService`。

## 1. ポストFXチェーン

### 1.1 公開するもの

```typescript
// domain/post-processing.ts
const POST_PROCESSING_PASS_ORDER: readonly [
  'render', 'gtao', 'godRays', 'bloom', 'bokeh', 'composite', 'smaa', 'output',
]
type PostProcessingPass = (typeof POST_PROCESSING_PASS_ORDER)[number]

type GraphicsQuality = {
  readonly ssaoEnabled: boolean
  readonly godRaysEnabled: boolean
  readonly bloomEnabled: boolean
  readonly dofEnabled: boolean
  readonly smaaEnabled: boolean
  readonly useCompositePass: boolean
}
const QUALITY_PRESETS: Record<'low' | 'medium' | 'high' | 'ultra', GraphicsQuality>

const isCompositeActive: (quality: GraphicsQuality) => boolean
const buildPostProcessingChain: (quality: GraphicsQuality) => ReadonlyArray<PostProcessingPass>
const validatePostProcessingChain: (chain) => ReadonlyArray<ChainViolation>
const isCanonicalChain: (chain) => boolean
```

### 1.2 参照実装との照合

| 事項 | 参照実装 | 新実装 |
| --- | --- | --- |
| 構築箇所 | `packages/app/application/main/session-post-processing.ts:33-154`（**mc-app にあった**） | mc-render 内。合成層に描画設定を置かない |
| パス順序 | `addPass` の文の並び（:51, :63, :76, :94, :110, :127, :137, :142） | 配列 `POST_PROCESSING_PASS_ORDER` + 検証関数 |
| 無効パス | 作って `enabled = false`（composite 有効時） | **作らない**。無効パスもレンダーターゲットは確保する（:53-56） |
| プリセット解決 | `resolvePreset`（`packages/game/application/settings-service.config.ts`） | `QUALITY_PRESETS`。ただしポストFX部分のみ（§1.3） |
| 定数 | `packages/app/application/main.config.ts:30-32` `GTAO_BLEND_INTENSITY = 0.8`、`BLOOM_*`、`BOKEH_*` | 未移植 |

### 1.3 まだ無いプリセット項目

参照実装の `resolvePreset` はポストFX以外も返す。少なくとも:

- `composerRtType`（`WebGLRenderTarget` の `type`。:48）
- `bloomStrength`（プリセットごとに違う。:92）
- `godRaysSamples`（:78。しかも `render-stage.ts:67-69` が**適応的に**減らす）
- レンダースケール（`browser-runtime-resize-layout.ts` がこれで各パスのサイズを決める）
- 影解像度・視界距離

`GraphicsQuality` にはポストFXの有無しか入っていない。**本実装で拡張が要る。**
拡張は `mc-playground-kit` と `mx-ui`（設定画面）の両方に波及するので、
1 度で決めること。

### 1.4 THREE.js アダプタへの契約

- `buildPostProcessingChain` の出力を**その順で**歩いて `composer.addPass` する
- 各パスの構築は「チェーンに含まれるときだけ」行う
- 起動時に `validatePostProcessingChain` を通し、違反があれば開発ビルドで大声で落ちる

## 2. InputService

### 2.1 公開するもの

```typescript
// domain/input-bindings.ts
type InputAction = 'moveForward' | ... | 'escape'
const DEFAULT_BINDINGS: Record<Exclude<InputAction, 'escape'>, KeyCode>
const ESCAPE_OWNER: 'frame-handler'
const ESCAPE_KEY_CODE: 'Escape'
const GAMEPLAY_LISTENER_TARGET: 'window'
const MODAL_LISTENER_TARGET: 'document'
const bindingFor / actionForKey / remap / modalConsumedKeyReachesGameplay

// application/input-service.ts
type InputEvent =
  | { kind: 'keydown' | 'keyup'; code: KeyCode; target: ListenerTarget }
  | { kind: 'pointermove'; deltaX: number; deltaY: number }
  | { kind: 'pointerlockchange'; locked: boolean }
  | { kind: 'blur' }

type InputServiceApi = {
  readonly dispatch: (event: InputEvent) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<InputSnapshot>
  readonly isActionActive: (action: InputAction) => Effect.Effect<boolean>
  readonly wasActionJustTriggered: (action: InputAction) => Effect.Effect<boolean>
  readonly endFrame: Effect.Effect<void>
  readonly clearHeld: Effect.Effect<void>
  readonly bindings: Effect.Effect<Bindings>
  readonly rebind: (action, key) => Effect.Effect<RemapOutcome>
  readonly resetBindings: Effect.Effect<void>
}

const LISTENER_PLAN: ReadonlyArray<{ event: string; target: ListenerTarget; note: string }>
const ESCAPE_POLICY
```

### 2.2 参照実装との照合

参照実装 `packages/presentation/input/input-service.ts`（337 LOC）+ 周辺
（`virtual-input-state.ts` 64 / `gamepad-input-state.ts` 152 / `screenshot-service.ts` 50 /
`input-service-test-utils.ts` 75 / `index.ts` 3、計 **681 LOC**）。

| 事項 | 参照実装 | 新実装 |
| --- | --- | --- |
| DOM への接続 | `window` / `document` に直接 `addEventListener`（:178-190）、`typeof window !== 'undefined'` でガード（:171） | 注入された `InputEvent` を `dispatch` で受ける。`window` アダプタは別 Layer |
| 状態の保持 | `MutableRef` + `HashSet` / `HashMap`（`packages/entity/...` と同じ流儀） | `Ref` + 素の `Set`。**フレーム毎の一時集合ではない**ので永続構造の必要が無い |
| 押下エッジ | `justPressedKeysRef` を別に持つ（:161） | `justPressed`。同じ設計 |
| blur クリア | `handleBlur`（:159-168） | `clearHeld` / `dispatch({kind:'blur'})` |
| ポインタロック | `requestPointerLock`（:252-269）、`pointerlockchange`（:184） | `pointerlockchange` イベントのみ。**要求側**（`requestPointerLock`）は未実装 |
| ゲームパッド | `gamepad-input-state.ts`（152 LOC） | 未実装 |
| タッチ / 仮想入力 | `virtual-input-state.ts`（64 LOC） | 未実装 |
| スクリーンショット | `screenshot-service.ts`（50 LOC） | 未実装。**mc-render に置くか要検討**（QA API は mc-compose の責務） |
| キーリマッピング | 参照実装では UI 側（`packages/presentation/settings`） | `remap`。**規則（Escape 不可・重複不可）をここに持つ**のが差分 |

### 2.3 拒否を throw ではなく値で返す

`remap` は `RemapOutcome`（`ok` / `rejected` + 理由）を返す。
設定画面（mx-ui）から駆動されるものであり、リバインドの拒否は**通常の結果**であって例外ではない。
プレイヤーに理由を見せる必要がある。

拒否理由は 3 つ、優先順に:

1. `escape-is-not-bindable` — アクションとしても**キーとしても**不可。第 2 の所有者を作らせない
2. `unknown-action` — 壊れた永続設定 blob から実行時に到達しうる
3. `key-already-bound` — 1 キー 1 アクション。黙って奪うと、プレイヤーは実行できなくなった
   アクションと、その理由の手がかりの無さを同時に得る

### 2.4 `.code` であって `.key` ではない

`DEFAULT_BINDINGS` は `KeyboardEvent.code`（`'KeyW'`）を持つ。`.key`（`'w'`）ではない。
`code` はレイアウト非依存なので、AZERTY でも Dvorak でも WASD は同じ指の下にある。
`.key` をバインドすると、フランス語配列のプレイヤーは前に進めなくなる。

## 3. WorldRenderer — **未設計。最優先**

plan.md §3.9 の筆頭 API であり、**まだ 1 行も無い。**

### 3.1 なぜ書けないか

`WorldRenderer` の主機能は「chunk ダーティ購読 → メッシュ更新」である。
その購読先（mc-sim のチャンクダーティ通知）が**まだ設計されていない**
（mc-sim の `docs/public-api.md` §5 が最優先項目として挙げている）。

界面が決まっていない相手を購読する API は書けない。**mc-sim 側が先。**

### 3.2 参照実装の該当箇所

| ファイル | LOC | 内容 |
| --- | ---: | --- |
| `packages/rendering/infrastructure/renderer/world-renderer.ts` | — | 本体。:52-58 に scratch 再利用のコメント |
| `packages/rendering/infrastructure/renderer/world-renderer-chunk-sync.ts` | — | チャンク同期（:28 に増分更新の margin 判定） |
| `packages/rendering/infrastructure/renderer/world-renderer-pose-cache.ts` | — | :49 に scratch 埋め |
| `packages/rendering/infrastructure/renderer/world-renderer-refraction*.ts` | — | 屈折プリパス。:119「allocation-free on both paths」 |
| `packages/rendering/infrastructure/renderer/` 合計 | **1,429** | |

### 3.3 設計時に決めること

- ダーティ通知は push（mc-sim が発行）か pull（mc-render が問い合わせ）か
  → **push であるべき**。pull は毎フレーム全チャンク走査であり、plan.md §3.11 が
  落下ブロックについて記録している「O(chunks×blocks) の惨事」と同型
- メッシュ生成をワーカーに投げる境界（mc-meshing は純粋関数、実行はワーカープール）
- ジオメトリの破棄タイミング（THREE の `BufferGeometry` は明示 dispose が要る）

## 4. マテリアル方針

```typescript
// domain/material-policy.ts
type MaterialSpec = {
  readonly name: string
  readonly transparent: boolean
  readonly side: 'front' | 'back' | 'double'
  readonly alphaTest: number
  readonly shared: boolean
}
const requiresForceSinglePass: (material: MaterialSpec) => boolean
const describeMaterialPolicy: (material: MaterialSpec) => MaterialPolicyVerdict
const auditMaterials: (materials) => ReadonlyArray<{ material; verdict }>
```

`MaterialSpec` は `THREE.Material` の構造的部分集合なので、実マテリアルがそのまま適合する。
アダプタは起動時に共有マテリアルを全部 `auditMaterials` に通し、
開発ビルドで大声で落ちるようにすること（[design-notes.md](./design-notes.md) DN-02）。

## 5. フレーム毎スクラッチ

```typescript
// domain/frame-scratch.ts
type ScratchMap<K, V>
const makeScratchMap: <K, V>(name: string, initialCapacity?: number) => ScratchMap<K, V>
const withScratch: <K, V, A>(scratch: ScratchMap<K, V>, use: (buffer: Map<K, V>) => A) => A
const snapshotScratch: <K, V>(buffer: ReadonlyMap<K, V>) => ReadonlyMap<K, V>
type FrameScratch = { visibleChunks; entityInstances; lightUpdates }
const makeFrameScratch: () => FrameScratch
```

`FrameScratch` の中身は**暫定**。参照実装のフレーム毎一時オブジェクトから名前を取り、
コメントの記述からサイズを見積もっただけである。実際の集合は THREE.js アダプタと一緒に決まる。

## 6. カメラミラー

```typescript
// domain/camera-mirror.ts
type ViewOffset = { right: number; up: number; rollRadians: number }
type MirroredCameraState = {
  readonly position: Position
  readonly rotation: { x: number; y: number; z: number; order: 'YXZ' }
  readonly sourceCapturedAtSecs: MonotonicTimeSecs
}
const mirroredCameraState: (snapshot: CameraPoseSnapshot, offset?: ViewOffset) => MirroredCameraState
const forwardVector: (snapshot: CameraPoseSnapshot) => Position
const mirrorLagSecs / isMirrorStale
```

**`CameraPoseSnapshot` を受け取る口しかない。書き戻す口は無く、作ってはならない**
（[design-notes.md](./design-notes.md) DN-06）。

## 6-2. フレーム stage 登録（`stages/`）

```typescript
const RENDER_STAGE_IDS: {
  input: StageId          // 'render:input'
  cameraMirror: StageId   // 'render:camera-mirror'
  chunkSync: StageId      // 'render:chunk-sync'
  draw: StageId           // 'render:draw'
  postFx: StageId         // 'render:post-fx'
}

const renderModule: (quality?) => GameModule<InputService, never, never, InputService>
const renderStages: (state, input) => ReadonlyArray<StageRegistration>
const makeRenderFrameState: (quality?) => Effect<RenderFrameState>
const makeRenderStagesForPreview: (quality?) => Effect<{state, stages}, never, InputService>
```

### なぜここに置いたのか

縦切りスパイクが「描画 stage をどこに置くか」を決めた。候補は「新しい体験モジュール」と
「mc-render」で、3 つの根拠で mc-render になった。

1. 描画 stage の完全な import 集合は `mc-kernel` + `mc-sim`(読み取りのみ) + `mc-render` +
   `mc-meshing` で、**これは既に mc-render の行そのもの**である。
2. 描画 stage には**ゲームルールが 1 つも無い**。体験モジュール（plan.md §2.2）が所有するのは
   VERB であり、これらを抱えたモジュールは VERB を 1 つも所有しない。
3. **mc-render はどのみち stage を登録しなければならない。** `InputService.endFrame` は
   フレーム毎にちょうど 1 回呼ばれなければならず、それは定義上 stage である。
   それまでロスター全体で登録されていた入力 stage は `mc-playground-kit` の `input:sample` だけで、
   kit は開発時専用だった。つまり**出荷ビルドには入力 stage が存在しなかった** —
   `justPressed` が永久にクリアされず、インベントリキーを 1 回押すと押しっぱなしのフレーム全部で
   再発火する。plan.md §2.3-2 が防ぐために書かれた失敗そのものである。

### id はすべて `render:` 接頭辞

骨格の phase 名と同じ裸の名前（`camera-mirror` / `chunk-sync` / `post-fx`）ではなく、
plan.md §4.1 の `<owning-repo-suffix>:<stage>` 規約に従っている。
mx-ui が phase 名 `hud-sync` に対して `ui:hud-sync` を登録しているのと同じである。理由は 2 つ:

- `mc-compose/domain/modding.ts` が裸の名前を mod に対して**予約**している。
  一次モジュールが裸の名前を登録するのは合法だが、予約 id を無駄に消費する。
- 解決済みのフレーム順序を読んだレビュアが、どのリポジトリを開けばよいかを一目で判断できる。

mc-compose の phase membership は id の**名前側**（最後のコロン以降）で照合するので、
`render:camera-mirror` は `camera-mirror` phase に、`render:draw` は `render` phase に落ちる。
`render:input` は複数 phase に一致しうるが、mc-compose の `domain/stage-order.ts` が
「複数一致した stage は**最も早い** phase に属する」と定めており、意図どおり input になる。

### `frameStages` が Effect である理由は、このリポジトリが作った

`renderModule` の型引数がその議論そのものである。

```
ROut      = InputService   — mc-render が提供する
RIn       = never          — その Layer を組むのに与えられる必要のあるものは無い
RRegister = InputService   — しかし render:input を登録するには必要
```

`InputService` は `ROut` にあり `RRegister` にもあり、**どちらの場合も `RIn` には無い**。
`RRegister` を `RIn` に畳むと「自分が出荷するサービスをホストが供給しろ」と言うことになる。
経緯は mc-kernel `docs/freeze-checklist.md` (b)。

### FIRST CUT の範囲

**フレーム位置と順序制約は確定**である。mc-compose が必要とするのはそれであり、
本体が埋まっても変わらない。

本体のうち、まだ到達できないサービスを要するものは FIRST CUT として最小限のことをする
（`mx-gameplay/stages/registration.ts` と同じ書き方）。
mc-sim と mc-meshing は mc-render の宣言済みの親だが未 publish なので、
それらを読むはずの箇所はプレビューやテストが埋める `Ref` を読む。
ローカルポートを発明していないのは、それが「カメラ姿勢を所有するのは誰か」への 2 つ目の答えになり、
plan.md §3.8 が参照実装の最悪の構造バグとして記録している逆転そのものだからである。

## 7. まだ設計していない公開API

**着手前に本書へ追記すること。**

| 領域 | 参照実装 | LOC | 主な消費者 |
| --- | --- | ---: | --- |
| **`WorldRenderer`** | `infrastructure/renderer/` | 1,429 | kit / compose |
| エンティティ描画 | `infrastructure/entity/` | 2,080 | mx-gameplay 経由 |
| テクスチャアトラス | `infrastructure/textures/` | 555 | 全描画 |
| パーティクル | `infrastructure/particles/` | 414 | mx-gameplay |
| 水面 / 屈折 | `infrastructure/post-processing/water-material.ts` ほか | 587 | — |
| プレイヤー描画（一人称の手など） | `infrastructure/player/` | 384 | — |
| 性能計測 HUD | `infrastructure/perf/` + `presentation/` | 698 | 開発時 |
| レイキャスト（描画側の当たり） | `infrastructure/raycasting/` | 89 | **要検討**: voxel-DDA は mc-physics（plan.md §3.4） |
| ワーカープール実装 | `packages/worker/infrastructure/` | ~1,100 | mc-worldgen / mc-meshing |
| `window` 入力アダプタ | `packages/presentation/input/input-service.ts:171-205` | — | 全プレビュー |
| ゲームパッド / タッチ | `gamepad-input-state.ts` / `virtual-input-state.ts` | 216 | mx-ui（モバイル） |

`raycasting-service.ts`（89 LOC）に注意。plan.md §3.4 は
「ブロック狙撃はレイキャストではなく voxel-DDA（参照実装で 2.3ms→0.09ms、25倍）」として
**mc-physics** に置いている。mc-render 側に残るのは THREE の `Raycaster` を使う
**描画専用**の用途（マウスピッキング等）だけのはずである。**実装時に切り分けること。**

## 8. APIロック

plan.md §6 Step 0-3。ツール未選定（§9 未決）。
mc-render の下流は kit のみだが、kit は全プレビューの土台なので実質的な影響範囲は広い。
publish 開始（plan.md §6 Step 3）までに必須。
