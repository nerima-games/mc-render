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

// チェーンの要素は「パス」と「そのパスが実行するエフェクト」。
// 通常のパスでは effects === [pass]。`composite` では包摂したパスの一覧で、
// それが `high` と `ultra` を区別する唯一の値である（パス順は同じ）。
type PostProcessingStep = {
  readonly pass: PostProcessingPass
  readonly effects: ReadonlyArray<PostProcessingPass>
}
const buildPostProcessingChain: (quality: GraphicsQuality) => ReadonlyArray<PostProcessingStep>
const chainPasses: (chain: ReadonlyArray<PostProcessingStep>) => ReadonlyArray<PostProcessingPass>
const chainEffects: (chain: ReadonlyArray<PostProcessingStep>) => ReadonlyArray<PostProcessingPass>
const validatePostProcessingChain: (chain: ReadonlyArray<PostProcessingPass>) => ReadonlyArray<ChainViolation>
const isCanonicalChain: (chain: ReadonlyArray<PostProcessingPass>) => boolean
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
- **`composite` を組み立てるときは、そのステップの `effects` を入力として使う。**
  `GraphicsQuality` を読み直してはならない —— チェーンをデータにした意味が消える。
  `effects` が無かった頃、`high` と `ultra` は同一の配列で、ドキュメント通りに
  歩いたアダプタは両方に同じコンポーザを作り、ultra のプレイヤーには
  god ray も被写界深度も出なかった
- 起動時に `validatePostProcessingChain(chainPasses(chain))` を通し、違反があれば
  開発ビルドで大声で落ちる

## 2. InputService

### 2.1 公開するもの

```typescript
// domain/input-bindings.ts
type InputAction =
  | 'moveForward' | ... | 'attack' | 'use' | 'pickBlock'
  | 'hotbarSlot1' | ... | 'hotbarSlot9'     // Digit1..Digit9
  | 'escape'
type KeyCode = string                       // KeyboardEvent.code
type MouseButton = 'MouseLeft' | 'MouseMiddle' | 'MouseRight'
type InputCode = KeyCode | MouseButton      // バインドできるものすべて
const MOUSE_BUTTONS / MOUSE_BUTTON_BY_INDEX
const mouseButtonForIndex: (index: number) => MouseButton | undefined
const isMouseButton: (code: InputCode) => code is MouseButton
const DEFAULT_BINDINGS: Record<Exclude<InputAction, 'escape'>, InputCode>
const ESCAPE_OWNER: 'frame-handler'
const ESCAPE_KEY_CODE: 'Escape'
const GAMEPLAY_LISTENER_TARGET: 'window'
const MODAL_LISTENER_TARGET: 'document'
const bindingFor / actionForKey / remap / modalConsumedKeyReachesGameplay
const suppressesBrowserContextMenu: (pointerLocked: boolean) => boolean
const suppressesBrowserScroll: (pointerLocked: boolean) => boolean

// ホイール（§2.7）——InputCode ではない。デルタである
type WheelDeltaMode = 'pixel' | 'line' | 'page'
const WHEEL_DELTA_MODES / WHEEL_DELTA_MODE_BY_INDEX
const wheelDeltaModeForIndex: (index: number) => WheelDeltaMode | undefined
const WHEEL_PIXELS_PER_NOTCH: 100 / WHEEL_LINES_PER_NOTCH: 3 / WHEEL_PAGES_PER_NOTCH: 1
const notchesForWheelDelta: (deltaY: number, mode: WheelDeltaMode) => number
const wrapHotbarSelection: (current: number, steps: number, size: number) => number

// ポインタロック（§2.8）
type PointerLockState = 'unlocked' | 'requested' | 'locked' | 'refused'
const POINTER_LOCK_STATES
const POINTER_LOCK_ACQUIRE_BUTTON: 'MouseLeft'
// クリックが**どこに落ちたか**（§2.11）。ロック対象 = ホストが名指しした canvas
type ClickLanding = 'lock-target' | 'ui' | 'elsewhere'
const CLICK_LANDINGS
const POINTER_LOCK_ACQUIRE_LANDING: 'lock-target'
const acquiresPointerLock: (
  button: MouseButton,
  state: PointerLockState,
  landing: ClickLanding,
) => boolean

// application/input-service.ts
type InputEvent =
  | { kind: 'keydown' | 'keyup'; code: KeyCode; target: ListenerTarget }
  // `landing` は mousedown だけ。ロック中は参照されず、解放は無条件（§2.11）
  | { kind: 'mousedown'; button: MouseButton; target: ListenerTarget; landing: ClickLanding }
  | { kind: 'mouseup'; button: MouseButton; target: ListenerTarget }
  | { kind: 'contextmenu'; target: ListenerTarget }
  | { kind: 'pointermove'; deltaX: number; deltaY: number }
  | { kind: 'wheel'; deltaY: number; deltaMode: WheelDeltaMode }
  | { kind: 'pointerlockchange'; locked: boolean }
  | { kind: 'pointerlockerror' }
  | { kind: 'blur' }
  | { kind: 'gamepadpress' | 'gamepadrelease'; action: InputAction; target: ListenerTarget }
  | { kind: 'gamepadtick'; axes: GamepadAxes }

type InputSnapshot = {
  readonly pressed: ReadonlySet<InputCode>       // キー + ロック中に押されたボタン
  readonly justPressed: ReadonlySet<InputCode>   // 同じエッジ集合。endFrame でクリア
  readonly uiClicks: ReadonlySet<MouseButton>    // 非ロック中のクリック。endFrame でクリア
  // 同じクリックを「ボタン + 落ちた先」の対で。uiClicks はこれの射影（§2.11）
  readonly uiClickLandings: ReadonlyArray<UiClick>
  readonly pointerDelta: { x: number; y: number }
  readonly wheelNotches: number                  // 端数込みの累積ノッチ
  readonly wheelSteps: number                    // 整数ノッチ。ホットバーが読むのはこれ
  readonly pointerLocked: boolean                // pointerLockState === 'locked' の派生
  readonly pointerLockState: PointerLockState
  readonly gamepadAxes: GamepadAxes
}

// domain/gamepad-input.ts
type GamepadAxes = {
  readonly leftX: number; readonly leftY: number
  readonly rightX: number; readonly rightY: number
}
type GamepadSnapshot = {
  readonly connected: boolean
  readonly buttons: ReadonlyArray<{ readonly pressed: boolean; readonly value: number }>
  readonly axes: ReadonlyArray<number>
}
const normalizeGamepadAxes: (axes: ReadonlyArray<number>, deadzone?: number) => GamepadAxes

// application/gamepad-input-adapter.ts
type GamepadSource = () => ReadonlyArray<GamepadSnapshot | null>
type GamepadInputAdapter = { readonly poll: Effect<void>; readonly reset: Effect<void> }
const makeGamepadInputAdapter: (
  input: InputServiceApi,
  source: GamepadSource,
  bindings?: GamepadBindings,
) => GamepadInputAdapter

// ポインタロックの「要求」の出口。DOM 型は使わない（§2.8）
type UiClick = { readonly button: MouseButton; readonly landing: ClickLanding }

type PointerLockRequestOutcome = 'sent' | 'unavailable'
type PointerLockPort = { readonly request: Effect.Effect<PointerLockRequestOutcome> }
const UNAVAILABLE_POINTER_LOCK: PointerLockPort

type InputServiceApi = {
  readonly dispatch: (event: InputEvent) => Effect.Effect<void>
  readonly snapshot: Effect.Effect<InputSnapshot>
  readonly isActionActive: (action: InputAction) => Effect.Effect<boolean>
  readonly wasActionJustTriggered: (action: InputAction) => Effect.Effect<boolean>
  readonly isButtonDown: (button: MouseButton) => Effect.Effect<boolean>
  readonly wasButtonJustPressed: (button: MouseButton) => Effect.Effect<boolean>
  readonly wasUiClick: (button: MouseButton) => Effect.Effect<boolean>
  readonly shouldSuppressContextMenu: Effect.Effect<boolean>
  readonly shouldSuppressWheelScroll: Effect.Effect<boolean>
  readonly pointerLockState: Effect.Effect<PointerLockState>
  readonly requestPointerLock: Effect.Effect<PointerLockState>
  // フレームが読んだスナップショットを**返してもらう**。整数ノッチは
  // 「そのフレームに伝えた分」だけを消費する。省略＝「このフレームはホイールを
  // 読んでいない」＝ 0 消費（移動量は次のフレームへ繰り越す）。§2.7
  readonly endFrame: (frame?: InputSnapshot | undefined) => Effect.Effect<void>
  readonly clearHeld: Effect.Effect<void>
  readonly bindings: Effect.Effect<Bindings>
  readonly rebind: (action, key: InputCode) => Effect.Effect<RemapOutcome>
  readonly resetBindings: Effect.Effect<void>
}

const makeInputService: (bindings?: Bindings, pointerLock?: PointerLockPort) => Effect<InputServiceApi>
const InputServiceLayer: (bindings?: Bindings, pointerLock?: PointerLockPort) => Layer<InputService>

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
| ポインタロック | `requestPointerLock`（:252-269）、`pointerlockchange`（:184）、`pointerlockerror`（:185, :150-153 は `console.warn` のみ） | `PointerLockPort` 越しに要求し、`pointerlockchange` / `pointerlockerror` の 2 つで答えを受ける 4 状態機械。§2.8 |
| ロック要求の失敗 | `pointerLockFallbackRef`（:52）。feature policy が拒否したら**ロック済みと嘘をつく**（:263-266, :282-284） | `refused` 状態。嘘をつかない。**未移植**（§2.8） |
| ホイール | 生の `event.deltaY` を累積（:130-133）。`deltaMode` を見ない | ノッチに正規化して累積。`endFrame` でクリア、端数は持ち越し。§2.7 |
| ホットバー | 1-9 キーは `KeyMappings.HOTBAR_SLOT_*`、循環は `hotbar-service.ts:74-80` が符号だけ見る | `hotbarSlot1`..`9` は普通のバインド。循環幅は `wheelSteps`、剰余は `wrapHotbarSelection`。§2.7 |
| マウスボタン | `HashMap<number, boolean>` + `HashSet<number>`（:46-48）。`isMouseDown(2)` のように**番号で**読む | 名前（`MouseLeft` / `MouseMiddle` / `MouseRight`）でキーと**同じコード空間**に入れる。§2.5 |
| クリックのエッジ | `consumeMouseClick`（:286）。**読んだら消える** | `wasButtonJustPressed`。`justPressed` と同じで `endFrame` が消す。§2.5 |
| `contextmenu` | 無条件 `preventDefault`（:140-142） | ロック中のみ抑止。`suppressesBrowserContextMenu`。§2.6 |
| ゲームパッド | `domain/gamepad-input.ts` + `application/gamepad-input-adapter.ts` | 実装済み。ホストが `GamepadSource` を注入し、毎フレーム `poll` する |
| タッチ / 仮想入力 | `domain/input-bindings.ts` + `application/browser-input-adapter.ts` | 実装済み。DOM のタッチイベントを `InputEvent` に変換する |
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

## 2.5 マウスボタン — 公開モデルは番号ではなく名前

縦切りスパイクが「プレイヤーがブロックを壊す」を表現できず、破壊を `KeyB` に縛って回避した。
`InputEvent` にボタンの場合が無く、`INPUT_ACTIONS` に `attack` / `use` が無かったためである。
意図は半分実装されていた——`LISTENER_PLAN` は `contextmenu` を
「右クリックでブロックを置けるように」という注記付きで既に登録していた。

### 決定: `'MouseLeft' | 'MouseMiddle' | 'MouseRight'`

DOM はボタンを番号で渡す（`MouseEvent.button`: 0 左 / 1 中 / 2 右）。参照実装はその番号を
最後まで運び（`HashMap<number, boolean>`、`input-service.ts:46`）、呼び出し側は
`isMouseDown(2)`（`.../frame/stages/interaction-stage.ts:76`）と書く。
`camera-stage.ts:52` がその結果を `rightClickHeld` という名前に受け直しているのは、
名前があれば要らなかった注釈である。

名前を選んだ決め手はアダプタの都合ではなく、**バインドが永続化され、リマップされる**ことである。

- `{"attack": 2}` という設定 blob はキーコードと区別がつかず、人間が編集できない
- `remap` の重複検査が「番号の空間」と「文字列の空間」の 2 つを跨ぐことになる

名前にするとボタンはキーと**同じコード空間**（`InputCode`）に入り、キーボード経路が既に持っている
機構——1 コード 1 アクション、`justPressed` エッジ、`blur` クリア、`endFrame`——が
そのままボタンに効く。並行機構を作らない、が最も重要な性質である。
`InputCode` が 1 つで済むのは `KeyboardEvent.code` に `Mouse` で始まる値が**無い**からで、
`isMouseButton` はその前提の上でコードを見るだけで種別を判定できる。

番号→名前の変換は `mouseButtonForIndex` **1 箇所だけ**が知っている。
3 / 4（親指ボタン）は `undefined` を返して境界で落とす。参照実装は
`event.button` をそのまま記録していた（:120）ので、何にも読まれない状態が溜まっていた。

### ロック状態がクリックの意味を変える

ロック中のクリックはゲーム操作、非ロック中のクリックは UI 操作である。
サービスは既に `pointerlockchange` を追っているので、`dispatch` の時点で判定できる。

| 状態 | `mousedown` の行き先 | 読み口 |
| --- | --- | --- |
| ロック中 | `pressed` / `justPressed`（キーと同じ） | `isActionActive('attack')` / `wasButtonJustPressed` |
| 非ロック中 | `uiClicks` のみ（**落ちた先つき**。§2.11） | `wasUiClick` / `InputSnapshot.uiClickLandings` |

非ロック中のクリックを**捨てない**のは、ポインタロックを取り直すクリックがまさにそれであり、
かつ 1 フレーム後にブロックを壊すのと同じ左クリックだからである。
`pressed` に入れないのは、`pressed` の中身が「ゲームプレイに使ってよいコード」であるという
不変条件を保つため。

参照実装はこの区別を持たない。`handleMouseDown`（:119-123）はロック状態に関係なく全部記録し、
ゲームプレイ側は `gamePausedRef`（`interaction-stage-snapshot.ts:56-62`）で止めている。
それは「非ロック = ポーズ」が常に成り立つ間だけ正しい。ロックを**取り直す**クリックが反例で、
フレームが状態変化を知る前に届く。

### ロックを失うと保持中のボタンは離される

DN-09（デルタを捨てる）と同型の理由。左ボタンを押しっぱなしで破壊中に Escape を押すと
ブラウザはロックを解除し、次のクリックはメニューに行くので `mouseup` は**来ない**。
キーは離さない——チャット入力もフレームハンドラの Escape も非ロック中に届く必要がある。

## 2.6 `contextmenu` の抑止

右クリックが `use` である以上、抑止しないとブロックを置くたびにブラウザのメニューが開き、
ポインタロックも持って行かれる。

参照実装は**無条件**に `preventDefault()` する（`input-service.ts:140-142`、登録は :183）。
本実装は `suppressesBrowserContextMenu(pointerLocked)` で**ロック中のみ**に絞る。
非ロック中は DOM UI（チャット行のコピー、テキスト欄のスペルチェック）が動いている場面であり、
そこでブラウザの既定動作を飲み込むのはプラットフォームの挙動を壊すことである。

抑止判定を純粋関数にしてあるのは、これが `environment: 'node'` でしか押さえられないためである。
plan.md §3.10 のとおり Playwright（SwiftShader）はヘッドレスでポインタロックを扱えないので、
**ロック中の分岐を通るブラウザテストは存在しえない**。

もう 1 つ、参照実装が :137-139 に残している罠を機構化してある:

```
// Do NOT add to justClickedButtons here — handleMouseDown already captures button 2.
// Adding it here would cause a spurious second right-click if consumeMouseClick(2)
// is called between the mousedown and contextmenu events.
```

`contextmenu` は `InputEvent` の 1 ケースとして受けるが、**ボタン状態を一切変えない**。
イベントとして受けるのは、「何もしない」がテストで assert できる性質になるからである
（省略は誰にも見えない）。
なお本実装のエッジは consume 型ではなく `endFrame` クリア型なので、参照実装のような
「誰が先に読んだかで結果が変わる」競合はそもそも成立しない。

## 2.7 ホイール — エッジでもレベルでもなく**デルタ**

`LISTENER_PLAN` は `wheel` を「ホットバー循環のため `passive: false`」という注記付きで
登録していた。しかし `InputEvent` に `wheel` の場合が無く、`INPUT_ACTIONS` にホットバーの
アクションも無かった——**§2.5 のマウスボタンとまったく同じ形の穴**である
（リスナは計画済み、それを運ぶイベント型が無い）。

### 決定 1: ホイールは `InputCode` に**しない**

ホイールは押されない（`pressed` に入らない）し、エッジでもない（`justPressed` に入らない）。
`WheelUp` / `WheelDown` という擬似コードを作れば既存機構にそのまま乗るが、
**2 ノッチが 1 エッジに潰れる**。それは参照実装のバグそのもので、
`hotbar-service.ts:76` が累積デルタを `wheelDelta > 0 ? 1 : -1` に落としているため、
素早く 3 ノッチ回しても 1 スロットしか動かない。

したがってホイールは `pointerDelta` と同じ**アナログ状態**であり、
蓄積して `endFrame` でクリアする。`pointerDelta` との整合は 3 点で取ってある。

| 規則 | `pointerDelta` | `wheelNotches` |
| --- | --- | --- |
| 非ロック中は無視 | する（DN-09） | する。非ロック中のホイールはチャット欄のスクロールである |
| ロック喪失で捨てる | する（DN-09） | する。ポーズ前の半回転が復帰後にホットバーを動かしてはならない |
| `endFrame` でクリア | 全部 0 に | **整数ノッチだけ**。端数は持ち越す（下記） |

端数の持ち越しだけが差分である。トラックパッドは 1 イベント数ピクセルしか送らないので、
毎フレーム全部捨てると常に 0 ノッチに丸まり、**ノート PC でホットバーが操作不能になる**。
持ち越す端数は必ず 1 ノッチ未満で、ロック喪失・`blur` で消え、逆回しで相殺されるので、
幻のステップにはならない。

### 決定 2: 正規化は**ドメイン**で行う

`WheelEvent.deltaY` の単位は `deltaMode` で決まる（ピクセル / 行 / ページ）。
同じ 1 ノッチが Chrome では `100`、Firefox（Windows・クラシックホイール）では `3` になる。
アダプタがやるのは `MouseEvent.button` と同じ**番号→名前**の変換
（`wheelDeltaModeForIndex`）だけで、「何ピクセルが 1 ノッチか」という**方針**は
`notchesForWheelDelta` に置く。理由は `suppressesBrowserContextMenu` と同じで、
plan.md §3.10 によりロック中の分岐を通るブラウザテストが存在しえない以上、
アダプタに置いた方針は**どのテストからも押さえられない**。

正規化は**dispatch の時点**で効かせる。トラックパッド（ピクセル）とホイール（行）は
同一フレーム内に両方届きうるので、生の値を足すと `3 + 100` になって意味を失う。

### 決定 3: 循環の**剰余算**はここ、**スロット数**は消費側

`wrapHotbarSelection(current, steps, size)` は `size` を引数に取る。
ホットバーの長さはインベントリを所有する側の事実であり、このリポジトリが
2 つ目の答えになってはならない。一方で剰余算は罠なので、ここに 1 つだけ置く。

```
参照実装: (SlotIndex.toNumber(cur) + direction + HOTBAR_SIZE) % HOTBAR_SIZE
          <reference-impl>/packages/inventory/application/hotbar-service.ts:77-79
```

JavaScript の `%` は被除数の符号を保つので、`+ HOTBAR_SIZE` 1 回で足りるのは
`direction` が ±1 に潰されているからである。本実装はフリックの大きさをそのまま運ぶので、
`steps = -12` で**負のスロット番号**を返す。`((x % size) + size) % size` なら任意の歩幅で正しい。

`hotbarSlot1`..`hotbarSlot9` は `Digit1`..`Digit9` に**普通のバインドとして**入れた。
9 という数はキーボードの事実（数字段は 9 個）であって、ホットバーの長さではない。
消費側が 5 スロットなら `hotbarSlot6` を無視するだけでよい。
`hotbarNext` / `hotbarPrev` は**作っていない**——循環は `wheelSteps` が既に表現しており、
アクションとしても持つと 1 つの意図に 2 つの機構ができる。

## 2.8 ポインタロックは**要求**であり、拒否されうる

§2.2 が「要求側（`requestPointerLock`）は未実装」と書いていた穴。
`uiClicks`（§2.5）は「ロックを取り直すクリック」を記録するのに、それを受ける側が無かったので、
**プレビューはマウスルックに入れなかった。**

### 状態は boolean ではなく 4 つ

| 状態 | 意味 | UI |
| --- | --- | --- |
| `unlocked` | 誰も要求していない | 何も出さない |
| `requested` | 要求済み、返事待ち | **二重に要求しない**（保留中の要求は拒否理由の 1 つ） |
| `locked` | 許可された | マウスルック中。クリックはゲーム操作（§2.5） |
| `refused` | `pointerlockerror` が来た | 「クリックで視点操作」を**出す**。これが boolean では言えない |

`pointerlockchange { locked: false }` は `unlocked` に落とす。`refused` にはしない——
Escape でロックが切れるたびに「ブラウザに拒否された」と表示することになる。
`refused` は sticky で、次に要求するまで残る（描画フレームが読めなければ意味が無い）。

参照実装は 4 つを 1 つの boolean に潰し、拒否は `console.warn` に出すだけである
（`input-service.ts:150-153`）。プレイヤーが開いたことのない場所である。

### 要求は `PointerLockPort` から出す

```typescript
type PointerLockPort = { readonly request: Effect.Effect<'sent' | 'unavailable'> }
```

`canvas.requestPointerLock()` をここで呼ばないのは、このリポジトリが `lib.DOM` を持たないからで、
それこそが入力モデルを `environment: 'node'` で検査可能にしている当のものである。
しかも plan.md §3.10 のとおり **Playwright はポインタロックを扱えない**ので、
DOM を直接叩けばそれは「どのテストからも押さえられない挙動」になる。

`request` が返すのは「**要求が出たか**」だけである。許可されたかは返せない——
ブラウザもまだ知らないからで、答えは後から `pointerlockchange` / `pointerlockerror` として
`dispatch` に届く。要求を答えのように扱えないことが、この Port 形状の目的である。

`unavailable` が別値なのは、**答えが永久に来ない**場合があるからである
（canvas が無い、`requestPointerLock` が無い、feature policy が禁じている:
参照実装 :258-266）。これを `requested` のまま放置すると状態機械がセッション中ずっと固まる。
サービスは即座に `refused` に落とす。

参照実装は同じ状況で `pointerLockFallbackRef` を立てて**ロック済みだと嘘をつく**（:263-266, :282-284）。
DN-12 のクリック判定はすべてその boolean の上に建っているので、**移植しない**。

### 誰がいつ要求するか

- **どのクリックか**: `acquiresPointerLock(button, state, landing)`。左ボタンのみ、
  `unlocked` / `refused` のみ、そして**ロック対象（canvas）に落ちたクリックのみ**（§2.11）。
  非ロック中の右クリックはブラウザのコンテキストメニュー（§2.6）、中クリックはペーストや
  オートスクロールであり、そこからポインタを奪うとプレイヤーは開こうとしていたメニューを失う。
  `refused` を含めるのが要点で、拒否の典型的な原因はユーザジェスチャの欠如であり、
  クリックはまさにそれを満たす。
- **どこで**: `render:input` stage（`stages/registration.ts`）。サンプル後・`endFrame` 前。
  `dispatch` ではない——`dispatch` は DOM イベントハンドラの中で走る記録係であり、
  ロックを取るのは判断である。サービスが勝手にポインタを掴むと、
  入力を覗きたいだけのプレビューからポインタを奪うことになる。

```
unlocked ──requestPointerLock──▶ requested ──pointerlockchange(true)──▶ locked
   ▲                                │                                      │
   │                                └──pointerlockerror──▶ refused         │
   └──────────────pointerlockchange(false)──────────────────────────────────┘
                          （refused からもクリックで再要求できる）
```

## 2.9 `window` 入力アダプタ — **DOM を `lib` ではなく型で受ける**

§2.2 の表がずっと「`window` アダプタは別 Layer」とだけ書いていた穴。
§7 の表にも「`window` 入力アダプタ: 未実装、消費者は全プレビュー」とあった。**実装済み。**

### 2.9.1 公開するもの

```typescript
// application/dom-surface.ts —— このリポジトリの DOM 依存の全部（メンバ 8 個）
type DomListenerOptions = { readonly capture?: boolean; readonly passive?: boolean }
type DomInputEvent = {
  readonly preventDefault: () => void         // 必須。これが weak type を防ぐ
  readonly code?: string                      // KeyboardEvent.code
  readonly button?: number                    // MouseEvent.button
  readonly movementX?: number
  readonly movementY?: number
  readonly deltaY?: number                    // WheelEvent.deltaY（生）
  readonly deltaMode?: number                 // WheelEvent.deltaMode
  readonly target?: unknown                   // Event.target。**比較するだけ**（§2.10）
}
type DomListener = (event: DomInputEvent) => void
type DomEventTarget = { addEventListener; removeEventListener }
type DomDocument = DomEventTarget & { readonly pointerLockElement: unknown }
type PointerLockTarget = { readonly requestPointerLock?: () => unknown }
const isPointerLockHeld: (document: DomDocument) => boolean

// application/browser-input-adapter.ts
type BrowserInputTargets = { readonly window: DomEventTarget; readonly document: DomDocument }
type PlannedListener = { readonly event: string; readonly target: ListenerTarget }
type ListenerRegistration = { event; target; listener; options }
type InstalledInputListeners = { registrations: ReadonlyArray<ListenerRegistration>; remove: () => void }
type DomEventContext = {
  readonly pointerLockHeld: boolean
  readonly focusGroups: ReadonlyArray<FocusGroupTargets>
  readonly pointerLockTarget?: unknown          // ロック対象。**比較するだけ**（§2.11）
}

const PREVENT_DEFAULT_EVENTS: ReadonlyArray<string>   // ['wheel', 'contextmenu']
const mayPreventDefault: (eventName: string) => boolean
const listenerOptionsFor: (eventName: string) => DomListenerOptions
const TRANSLATED_DOM_EVENTS: ReadonlyArray<string>

const translateDomEvent: (planned, event: DomInputEvent, context) => InputEvent | undefined
// 第 3 引数はフォーカスロスタ、第 4 引数は**ロック対象**（= canvas）。どちらも省略可
const installInputListeners: (targets, input: InputServiceApi, focusGroups?, pointerLockTarget?) => InstalledInputListeners
const scopedInputListeners: (targets, input, focusGroups?, pointerLockTarget?) => Effect<InstalledInputListeners, never, Scope>

type BrowserPointerLockOptions = { canvas: PointerLockTarget; allowsPointerLock?: () => boolean }
const makeBrowserPointerLockPort: (options) => PointerLockPort

type BrowserInputOptions = { targets; canvas?; allowsPointerLock?; bindings?; focusGroups? }
const browserInputLayer: (options: BrowserInputOptions) => Layer<InputService>

// キーボードフォーカス（§2.10）
type FocusGroupTargets = { readonly group: string; readonly targets: ReadonlyArray<unknown> }
const resolveFocusTarget: (groups, target: unknown) => FocusTarget | undefined

// クリックの着地（§2.11）。同じ `===` 照合。要素は 1 つも読まない
const resolveClickLanding: (pointerLockTarget: unknown, groups, target: unknown) => ClickLanding
```

### 2.9.2 `lib` に `"DOM"` を入れなかった理由

正本は [design-notes.md](./design-notes.md) DN-15。要点だけ:

`lib: ["ES2024"]` / `types: []` は**ポストFXの順序・ホイールのモデル・ロック状態機械を
`environment: 'node'` で検査可能にしている当の機構**であり、
plan.md §3.10（Playwright は SwiftShader でポインタロック不可）により
ブラウザ側にも逃げ場が無い。1 つのアダプタのために全ファイルからその歯止めを外すのは高すぎる。

アダプタ専用の 2 つ目の tsconfig プロジェクトも採れない。
`scripts/api-lock.ts` は `tsconfig.build.json` から公開面を作り、
`scripts/check-dependency-whitelist.ts` は `index.ts` / `domain/` / `application/` / `stages/` で
出荷ソースを分類する。どちらも 16 リポジトリに byte-identical で vendor される領域であり、
build プロジェクトの外に置いたアダプタは `index.ts` から re-export できない
——つまり**それが存在する理由であるプレビューから使えない**。

代入可能性はテストで証明してある（§8.1 相当は [testing.md](./testing.md) §8.1）。
`test/fixtures/dom-surface.ts` を**本物の `lib.dom.d.ts`** に対してコンパイルし、
実物の `Window` / `Document` / `HTMLCanvasElement` が**キャスト無しで**適合することを assert する。
`strictFunctionTypes` によりリスナの引数は反変なので、`DomInputEvent` を狭めると
実物が代入できなくなり、消費者は `as unknown as` に手を伸ばす——型安全が失われるのはそこである。

### 2.9.3 アダプタが決めてよいこと / いけないこと

**いけない**（ここでの判断は**どのテストからも押さえられない**判断になるため）:

| 事項 | 正はどこか |
| --- | --- |
| どのイベントをどこに登録するか | `LISTENER_PLAN`。アダプタはそれを `map` する |
| `preventDefault()` するか | `shouldSuppressWheelScroll` / `shouldSuppressContextMenu`（§2.6 / §2.7） |
| 何ピクセルが 1 ノッチか | `notchesForWheelDelta`（§2.7） |
| いつロックを要求するか | `acquiresPointerLock` + `render:input` stage（§2.8） |

**よい**——すべて**番号→名前**の同型の変換である:

| 変換 | 1 箇所 |
| --- | --- |
| `MouseEvent.button` → `MouseButton` | `mouseButtonForIndex` |
| `WheelEvent.deltaMode` → `WheelDeltaMode` | `wheelDeltaModeForIndex` |
| DOM のイベント名 → `InputEvent` の case | `translateDomEvent`（`mousemove` → `pointermove`） |
| `document.pointerLockElement` → `locked: boolean` | `isPointerLockHeld` |

名前を付けられない値は**境界で落とす**（親指ボタン、未知の `deltaMode`、`NaN` の `movementX`）。
イベントハンドラは throw してはならず、推測はもっと悪い。

### 2.9.4 解除は正確でなければならない

`installInputListeners` は登録した内容（登録先・イベント名・リスナ**関数**・オプション**オブジェクト**）を
返し、`remove` は**その同じ配列**を歩く。「足したものが全部外れる」は
読み手が 2 つのリストを見比べて信じる約束ではなく、1 つのリストを 2 回歩く事実である。

`removeEventListener` は type / 関数同一性 / **capture フラグ**の 3 つで照合し、
1 つでも外れると**黙って何もしない**。だから `capture: false` を既定に任せず明示し、
同じオブジェクトを両方に渡している。

漏らした場合の症状は plan.md §3.8 が参照実装の最悪バグ群として記録している
「2 回目のワールドロード」と同型である: 1 回目のハンドラが生き残って 2 回目と並走し、
キーが 2 つのことをする。kit はプレビューを 2 枚並べるので、**このリポジトリは 2 個目を先に見る**。
だから `browserInputLayer` が既定の入口であり、解除は Scope に結ばれている。

### 2.9.5 `passive: false` は 2 つだけ

`preventDefault()` を呼びうるリスナだけが `passive: false` で登録される
（`PREVENT_DEFAULT_EVENTS` = `wheel` / `contextmenu`）。
スクロール経路上の非 passive リスナは実際にフレーム時間を食う——
ブラウザはスクロールしてよいかを知るためにハンドラの復帰を待たなければならない。

厳密に**必要**なのは `wheel` だけである（ブラウザが既定で passive にするのは
`wheel` / `mousewheel` / `touchstart` / `touchmove` であり、`contextmenu` は元から非 passive）。
`contextmenu` も列挙してあるのは、この 1 つのリストが
「既定を抑止しうる」と「非 passive で登録する」の両方を表しており、
既に非 passive なものに `passive: false` を明示しても挙動もフレーム時間も変わらないからである。

## 2.10 キーボードフォーカスは**観測**であって移動ではない

mx-ui が半分だけ作って止めた穴（mx-ui/docs/design-notes.md DN-UI-13i）。
向こうはホットバーを roving-`tabindex` グループにし（**ネイティブなタブストップは 1 つ**）、
スロットごとに専用のリング要素を置き、`HudView.setKeyboardFocus(index | undefined)` を用意した。
そこで止めた理由が所有権である:

| 事柄 | 必要な動詞 | 所有者 |
| --- | --- | --- |
| スロットがフォーカスを持てる | `setAttribute` | mx-ui |
| フォーカスが**どう見えるか** | `style.setProperty` | mx-ui |
| フォーカスを**動かす**キーストローク | `addEventListener` | **mc-render** |
| 動いたことを mx-ui に**伝える** | — | **mc-render** |

### 2.10.1 公開するもの

```typescript
// domain/input-bindings.ts
type FocusTarget = { readonly group: string; readonly index: number }  // index は 0 起点
const HOTBAR_FOCUS_GROUP: string                       // 'hotbar'
const FOCUS_NAVIGATION_KEY_CODE: KeyCode               // 'Tab'
const FOCUS_NAVIGATION_OWNER: 'user-agent'
const reportsKeyboardFocus: (state: PointerLockState) => boolean

// application/input-service.ts
type InputEvent = ... | { kind: 'focuschange'; focus: FocusTarget | undefined }
type InputSnapshot = { ...; readonly keyboardFocus: FocusTarget | undefined }
type InputServiceApi = { ...; readonly keyboardFocus: Effect<FocusTarget | undefined> }
const FOCUS_NAVIGATION_POLICY: { key; owner; preventDefault: false; registeredBy; rationale }
```

### 2.10.2 Tab は**実装しない**。ブラウザが既にやっている

mx-ui は**リングとタブストップを同じスロットに置いた**。
だから Tab でブラウザがネイティブにフォーカスする要素は、
mx-ui がリングを描いた要素と**構成上一致する**。
順序も、Shift+Tab も、スクリーンリーダーも、画面キーボードも、プラットフォームが既に正しくやる。

**足りなかったのは「気づくこと」だけである。** だから追加したのは
`focusin` / `focusout` の 2 リスナと、それを運ぶ 1 ケースだけで、
`keydown` の Tab ハンドラも `focus()` 呼び出しも**無い**。

`focus` / `blur` ではなく `focusin` / `focusout` なのは、**後者だけがバブルする**からである。
前者なら mx-ui が作るスロット 1 つ 1 つにリスナを付けることになり、
このリポジトリが所有しない要素を知り、HUD が組み直されるたびに登録し直す必要がある。
`document` の 1 本は、まだ存在しないスロットも覆う。

### 2.10.3 `preventDefault` は**どのロック状態でも**しない

`suppressesBrowserContextMenu` / `suppressesBrowserScroll` は「ロック中だけ」という
**擁護できる絞り込み**を持つ（§2.6 / §2.7）。Tab にはそれが**無い**。程度の差ではない:

- コンテキストメニューを飲むと、チャット行の「コピー」が消える
- スクロールを飲むと、設定画面の下端に届かなくなる
- **Tab を飲むと、出口が全部消える**。ブラウザのクロムにも、次のコントロールにも、
  「縛り直して脱出する」ための設定画面にすら届かない。キーボードトラップであり
  WCAG 2.1 SC 2.1.2 違反である

だから対になる述語 `suppressesBrowserFocusNavigation` は**作っていない**。
述語は議論を再開する場所であり、この答えは全ロック状態で不変だからである。
代わりに `FOCUS_NAVIGATION_POLICY.preventDefault === false` を値として置き、テストが見張る。

同じ理由で **Tab は縛れない**（`remap` は `key-reserved-by-user-agent` で拒否する）。
Escape の所有者はこちらが選んだフレームハンドラで、動かそうと思えば動かせる。
Tab の所有者はユーザーエージェントで、**動かせない——上書きできるだけ**で、
その上書きがトラップそのものである。除去できない所有者に 2 人目を足さない。

（バニラの Tab はプレイヤーリストである。ブラウザはバニラではない。
プレイヤーリストは他のどのキーにでも縛れる。両方の意味を持つ Tab は縛れない。）

### 2.10.4 ロック中は**報告しない**。ただし**忘れない**

`reportsKeyboardFocus(state)` は `locked` のときだけ false。
§2.5 が「ロック中のクリックはゲーム操作、非ロック中のクリックは UI 操作」と引いた継ぎ目と同じものを、
キーボードに当てている——ロック中はキーがアバターを動かしており、
そのときホットバーに光るリングは**次のキーが何をするかについての嘘**である。

重要なのは**マスクであって消去ではない**こと。ポインタロックはキーボードに触らないので、
フォーカスは**まだそこにある**。消してしまうと、
「スロット 3 に Tab → クリックして視点操作 → Escape」で
リングがどこにも無いまま Space がスロット 3 を叩く、という状態になる。
サービスは生の観測を保持し、読み出しでマスクする。

`blur` と `clearHeld` も `keyboardFocus` だけは**保持する**。
ウィンドウがフォーカスを失っても、その中の DOM フォーカスは動かない——
ブラウザは同じ要素を覚えていて戻ってきたら復帰させ、たいてい再通知しない。
ここで消すと、タブを切り替えただけでリングが消えて二度と戻らない。

### 2.10.5 要素は**同一性でしか**見ない

ホストが `focusGroups: [{ group: HOTBAR_FOCUS_GROUP, targets: [...9 要素] }]` を渡し、
アダプタは `event.target` をその配列と `===` で照合して**位置**を返す。
`targets` が `ReadonlyArray<unknown>` なのは、**中を読まないから**である
（`DomDocument.pointerLockElement` が `unknown` なのと同じ理由）。

mx-ui の `data-slot-index` を読む案は 3 つの理由で採らなかった:

1. `data-slot-index` は**領域ローカル**である。ホットバーのスロット 0 とインベントリのスロット 0 は
   同じ値を持ち、区別には祖先を辿る必要がある。セレクタをこちらに書けば、
   それは**実物と突き合わせられないリポジトリに置かれた mx-ui の DOM 構造の写し**になる
2. `getAttribute` を `dom-surface.ts` に入れることになり、**代入可能性の証明が壊れる**。
   実物の `Event.target` は `EventTarget | null` で `getAttribute` を持たず、
   全省略可能なオブジェクト型は weak type なので TypeScript が即座に拒否する。
   `Window` が `DomEventTarget` に代入できなくなり、`pnpm typecheck` は何も言わない（DN-15）
3. mx-ui を唯一のフォーカス可能 UI 源として焼き付けることになる。
   自前の設定画面を描くホストにもグループはある

DOM 面が増えたのは `DomInputEvent.target?: unknown` の**1 フィールドだけ**である。
`application/dom-surface.ts` の型宣言も述語も 1 つも増えておらず、
`index.ts` から出るエントリは 7 つのまま（`DomListenerOptions` / `DomInputEvent` / `DomListener` /
`DomEventTarget` / `DomDocument` / `PointerLockTarget` / `isPointerLockHeld`）である。
`test/fixtures/dom-surface.ts` に `event.target` を読むハンドラと `focusin` / `focusout` の
登録・解除を足してあるので、**部分集合の証明はこの 1 フィールドを含んだ状態で緑である**——
`export const windowIsAnEventTarget: DomEventTarget = browserWindow` が本物の
`lib.dom.d.ts` に対して通ることが、`target` を足しても反変性が壊れていないことの本体である。

### 2.10.6 ホストがやること —— リングを点けるための呼び出し列

**mx-ui は何も呼ばない。** 向こうはリスナを 1 本も持たず（`mx-ui/application/dom-surface.ts` に
`addEventListener` も `focus()` も無い）、`HudView.setKeyboardFocus` を**呼ばれる側**として持つだけである。
呼ぶのは**両方をページに載せているホスト**（プレビュー、またはゲーム本体）である。
mc-sim の §7-5 と同じ立場——「2 つのリポジトリを同時に知っている唯一の場所」がホストだからである。

順序に意味があるのは 1 箇所だけで、そこが唯一の落とし穴である。

```typescript
// ── 1. HUD を先に建てる。ロスタは実在する要素の配列でなければならない ────────
//    `parent` はホストが所有する本物の要素で、mx-ui には渡すだけ。
const hud = createHudView(factory, parent, motion)

// ── 2. ロスタを集める。mx-ui はスロット要素を配らないので、ホストが自分の
//        `parent` から引く。`HudView.root` は mx-ui の狭い `DomElement` で
//        `querySelectorAll` を持たないため、引くのは `parent` の側である。
const slots: ReadonlyArray<Element> = [
  ...parent.querySelectorAll('[data-mx-ui="hotbar"] [data-mx-ui="slot"]'),
]
//    9 個。DOM 文書順 = スロット index 順（`createHudView` が index 順に append する）。
//    `tabindex` は slot の ROOT に載っている（`data-mx-ui="slot"` を持つ要素そのもの）ので、
//    `focusin` の `event.target` はこの配列の要素と `===` で一致する。

// ── 3. 入力 Layer を建てる。ロスタとロック対象はここで**閉じ込められる** ─────
//    ブラウザホストは `renderModule().layers`（= `InputServiceLayer`）の代わりに
//    これを provide する。タグは同じ `InputService` なので、
//    `renderModule().frameStages` はこの provide の**中で**取る。
//    （理由は `stages/registration.ts` 末尾の「NO RenderRegistrationLayer」:
//      Layer を別々に provide すると、登録した stage が握るサービスと
//      DOM イベントが届くサービスが**別インスタンス**になる。）
const inputLayer = browserInputLayer({
  targets: { window, document },
  //    `canvas` は 2 つの意味を持つ。ロックを要求する**宛先**であり、
  //    かつ「クリックがここに落ちたときだけ要求してよい」という**スコープ**である（§2.11）。
  //    ホストが書くのは 1 回で、両方が決まる。**新しく渡すものは無い。**
  canvas,
  bindings: savedBindings ?? defaultBindings(),
  focusGroups: [{ group: HOTBAR_FOCUS_GROUP, targets: slots }],
})

// ── 4. 毎フレーム、`render:input` の**後**に 1 回。上の provide の中 ────────
//        `render:input` が snapshot → （必要なら）requestPointerLock → endFrame を
//        済ませている。読むのは snapshot でも service 直でもよく、
//        両者は同じマスクを通るので食い違わない。
const input = yield* InputService
const focus = yield* input.keyboardFocus                   // FocusTarget | undefined
hud.setKeyboardFocus(
  focus?.group === HOTBAR_FOCUS_GROUP ? focus.index : undefined,
)
```

**1 → 2 → 3 の順序は守らなければならない。** `installInputListeners` はロスタを
**インストール時にクロージャで捕まえる**。3 を先にやると `targets` は空配列のままで、
リスナは登録され、イベントは届き、`resolveFocusTarget` は毎回 `undefined` を返す——
**壊れ方が「静かに何も起きない」なので、テストが無ければ気づかない。**
逆に HudView を捨てて建て直すホストは、**入力 Layer のスコープも建て直す**必要がある
（古いロスタは死んだ要素を指す）。`createHudView` は 9 スロットを 1 度だけ作って
以後は使い回す（`renderIconRow` と違い、ホットバーは長さが変わらない）ので、
**1 つの HudView が生きている間ロスタは安定している。**

**4 は毎フレームでよく、条件を付ける必要は無い。** `keyboardFocus` は**レベルであってエッジではない**——
`endFrame` は触らないので、フレーム境界で消えることはない。フォーカスは「起きる」ものではなく
「そこに在る」ものであり、フレーム境界で消すリングはリフレッシュレートで点滅する。
「変わったフレーム」のエッジを足さなかったのは、mx-ui 側が既に冪等
（`writeAttribute` が差分書きなので、同じ値の再指定で DOM を 1 バイトも書かない）だからで、
足せば**消費者のいない 2 つ目の機構**になり、読み損ねたフレームで食い違う。

`undefined` と `0` は**違う**。mx-ui は `undefined` で全リングを消し、`0` でスロット 0 を光らせる。
だから「グループの外に出た」を `0` に丸めてはならない
（`resolveFocusTarget` が `indexOf` の `-1` を index にしない理由）。
`group` を見てから `index` を渡すのも同じ理由で、
`{ group: 'settings', index: 2 }` をそのまま渡せばホットバーのスロット 2 が光る。

ロック中は `keyboardFocus` が `undefined` を返すので、上の 1 行は自動的に
`setKeyboardFocus(undefined)` になり、mx-ui はリングを消してタブストップを既定
（スロット 0）に戻す。**ブラウザの実フォーカスは動かない**（`tabindex="-1"` を書いても
フォーカス中の要素は blur しない）ので、ロックが明ければ mc-render が同じ index を再び報告し、
同じ 1 行がリングを元に戻す。往復するために mx-ui 側に状態は要らない。

**ホストがやってはいけないこと。** `focus()` を呼ばない、Tab を `preventDefault` しない、
`tabindex` を自分で書かない。3 つとも所有者が別に居り、最初の 2 つは §2.10.2 / §2.10.3、
3 つ目は mx-ui の `setSlotTabStop` である。

**`canvas` を渡し忘れると 2 つ同時に壊れる。** ロックの要求先が無くなり
（`UNAVAILABLE_POINTER_LOCK` になる）、同時にどのクリックも `lock-target` に解決されない。
どちらも「マウスルックに入れない」として現れるので、症状は 1 つで原因は 1 つである。
逆に **canvas をフォーカスグループに入れてはならない**——`resolveClickLanding` は
ロック対象を先に見るので害は無いが、その 2 つは別の問い（§2.11）である。

**まだ閉じていない 1 点**——グループ内をキーボードで移動する手段が無いこと——は
[design-notes.md](./design-notes.md) DN-16 §5(a) に、どのリポジトリが変わる必要があるかと
一緒に書いてある。**HUD の上のクリックがポインタロック要求になる問題（§5(b)）は閉じた。**
下の §2.11 がその決定である。

## 2.11 クリックは**どこに落ちたか**で意味が変わる

DN-16 §5(b) が「3 案あってどれも境界をまたぐ」と保留していた穴。**閉じた。**
判断の全文と、3 案を採らなかった理由は
[design-notes.md](./design-notes.md) DN-16 §5(b) にある。ここには決定だけを書く。

### 穴

非ロック中、プレイヤーがホットバーのスロットをクリックする。
`tabindex="-1"` の要素は**クリックでフォーカスされる**のでリングが点く（正しい）。
同じ `mousedown` が `window` までバブルして `uiClicks` に入り、
`render:input` が `acquiresPointerLock('MouseLeft', 'unlocked')` を `true` と読む。
ロックが許可されると `reportsKeyboardFocus` が `false` になり、
**たった今点いたリングが消え、プレイヤーは視点操作に放り込まれる。**

### 決定: 述語は「ロック対象に落ちた」

```typescript
type ClickLanding = 'lock-target' | 'ui' | 'elsewhere'
const POINTER_LOCK_ACQUIRE_LANDING: ClickLanding = 'lock-target'
const acquiresPointerLock = (button, state, landing) =>
  button === POINTER_LOCK_ACQUIRE_BUTTON &&
  landing === POINTER_LOCK_ACQUIRE_LANDING &&
  (state === 'unlocked' || state === 'refused')
```

| 着地 | 何か | 要求するか |
| --- | --- | --- |
| `lock-target` | ホストが `BrowserInputOptions.canvas` として名指しした要素。`requestPointerLock()` を呼ぶ当のもの | **する** |
| `ui` | ホストが名指ししたフォーカスグループの要素（ホットバーのスロット、設定ボタン） | しない |
| `elsewhere` | どちらでもない。canvas 脇のレターボックス、ページ背景、宣言されていないヘッダ | しない |

**「UI に落ちなかった」ではない。** 2 つは第 3 の場合で分岐し、そこが要点である:

- 「UI ではない」は**開世界**——ホストが列挙し忘れたもの全部にポインタを与える。
  宣言忘れの代償が「リンクをクリックしたらマウスルック」になる。
- 「ロック対象である」は**閉世界**——名指しされた 1 要素にだけ与える。
  宣言忘れの代償は「マウスルックに入れない」であり、最初の 1 回で見え、混乱もさせない。
- しかも**ホストの宣言が 1 つも増えない**。ロック対象とはロックの宛先そのもので、
  ロックできるホストは既に名指ししており、名指ししていないホストは元からロックできない。
  規則は 1 行: **「ロックを受け取る要素が、ロックを要求するために押すべき要素である」**。
- 「UI」はロスタの語彙では言えない。ロスタは**フォーカス**のために在るので、
  `onclick` だけの `<div>` もレターボックスも入っていない。

`ui` と `elsewhere` は判定が同じでも**2 つの名前のまま**にしてある。
ロック対象の同一性が壊れたとき全クリックが `elsewhere` になり、
マウスルックが静かに動かなくなる——boolean だとそのバグと正しい拒否が同じ値になる。

### 着地は `uiClicks` を減らさない

HUD へのクリックも `uiClicks` に**入る**。そのスロットを描いたメニューが読むからである。
変わったのは、フレームが**どこに落ちたか**を見られるようになったことだけである。

```typescript
readonly uiClicks: ReadonlySet<MouseButton>          // 「クリックされたか」——メニューの問い
readonly uiClickLandings: ReadonlyArray<UiClick>     // 「どこに落ちたか」——ロックの問い
```

`uiClicks` は `uiClickLandings` の**射影**（snapshot 時に計算）である。
2 つの真理を並べて持てば食い違うので、`pointerLocked` / `pointerLockState` と同じ扱いにした。
対の列であって集合ではないのは、**1 フレームの中でスロットと canvas を続けてクリックできる**からで、
対応が消えると片方の着地がもう片方の答えになる——それは穴が 1 段深くなっただけである。

### DOM 面は増えていない

`event.target` は**ヒットテストが見つけた最も深い要素**なので、
canvas の上に描かれた DOM HUD はそこへのクリックの `target` そのものになる。
`contains` も `composedPath` も要らず、`dom-surface.ts` は 1 メンバも増えていない
（`target?: unknown` は §2.10 で既に在る）。
`test/fixtures/dom-surface.ts` に証明を 1 つ足してある。

限界: ホストが canvas ではなく**コンテナ要素**をロック対象にすると、その子へのクリックは
`elsewhere` になる。そのホストは canvas を名指しすること。

### 誰が変わるか —— **誰も**

mx-ui はリスナも `stopPropagation()` も持たないまま（DN-UI-4 は無傷）。
ホストは `browserInputLayer` に既に渡している `canvas` 以外を渡さない。
`installInputListeners` を直に呼ぶホストだけが、第 4 引数で canvas をもう一度渡す。

## 3. WorldRenderer — **実装済**

`makeWorldRenderer` は注入された THREE surface と canvas から renderer、scene、camera を
取得し、chunk mesh、描画、resize、破棄を所有する。環境表現は純粋な
`planRenderEnvironment(daylight, farPlane)` と副作用境界の
`WorldRenderer.setEnvironment(plan)` に分ける。

```ts
const shader = makeChunkShaderMaterial(three, atlasTexture)
const renderer = yield* makeWorldRenderer(three, canvas, {
  material: () => shader.material,
  applyMaterialEnvironment: (environment) =>
    applyChunkShaderEnvironment(shader.uniforms, environment),
})

yield* renderer.setEnvironment(planRenderEnvironment(daylight, farPlane))
```

同じ plan が canvas の clear color と chunk shader の sunlight / fog uniforms を更新する。
uniform box は material と共有したまま更新するため GPU resource を再生成しない。
resize listener と renderer/material の解放責務は従来どおり scope finalizer が所有し、
環境更新は listener や resource を追加しない。

### 3.1 購読先は決まった — mc-sim ではなく mc-worldgen

これは長らく「購読先が設計されていないから書けない」と書かれていた。**その障害は無くなった。**

購読先は `ChunkStore`（`@nerima-games/mc-worldgen/ChunkStore`、
`mc-worldgen/application/chunk-store.ts`）である。mc-sim ではない:
plan.md はブロック書き込み経路の所有者を §3.7 と §3.8 の間で決めておらず、
mc-worldgen に決着した。根拠は `mc-worldgen/docs/public-api.md` §6-0。

`render → worldgen` は plan.md §2.1 に既にあるエッジなので、
**依存グラフの変更は要らない。**

```typescript
// render:chunk-sync stage の骨格
const subscription = yield* chunkStore.subscribeDirtyScoped   // 登録時に一度だけ
// ...毎フレーム:
const { changed, removed } = yield* subscription.drain
for (const coord of removed) { /* BufferGeometry を dispose */ }
for (const coord of changed) {
  const chunk = yield* chunkStore.peek(coord)
  const neighbours = yield* chunkStore.neighbours(coord)   // mc-meshing の ChunkNeighbours に構造的に適合
  // → ワーカープールへ mesh(chunk, neighbours, config)
}
```

3 点、設計が答えている:

- **push か pull か**（下記 §3.3 の問い）: **購読者ごとに集合を溜める pull**。
  コストは push と同じ O(変更量) で、かつ mc-worldgen が消費者を知らなくてよい
  （worldgen は render も sim も import できない）。
- **重複排除**: 落下する砂の柱は 1 tick に同じチャンクを 32 回汚す。集合なので drain は 1 座標であり、
  メッシュは 1 回である。Stream / `PubSub` なら 32 回メッシュしていた。
- **`changed` と `removed` が別**: 要求される動作が正反対（メッシュする / dispose する）だから。
  同じ窓で変更されてからアンロードされたチャンクは `removed` にだけ現れる。

`ChunkStore.neighbours(coord)` は `mc-meshing` の `ChunkNeighbours` に**構造的に**適合する
（4 つの optional な `{ blocks }`、`yPos`/`yNeg` は無し）。mc-worldgen は mc-meshing を import できないので
名前的な適合ではない。両方に依存する本リポジトリがそのまま渡す。

### 3.2 参照実装の該当箇所

| ファイル | LOC | 内容 |
| --- | ---: | --- |
| `packages/rendering/infrastructure/renderer/world-renderer.ts` | — | 本体。:52-58 に scratch 再利用のコメント |
| `packages/rendering/infrastructure/renderer/world-renderer-chunk-sync.ts` | — | チャンク同期（:28 に増分更新の margin 判定） |
| `packages/rendering/infrastructure/renderer/world-renderer-pose-cache.ts` | — | :49 に scratch 埋め |
| `packages/rendering/infrastructure/renderer/world-renderer-refraction*.ts` | — | 屈折プリパス。:119「allocation-free on both paths」 |
| `packages/rendering/infrastructure/renderer/` 合計 | **1,429** | |

### 3.3 設計時に決めること

- ~~ダーティ通知は push か pull か~~ → **決着済み。§3.1 を見よ。**
  「毎フレーム全チャンク走査になるから pull は不可」という指摘はそのまま正しく、
  採用された設計はその指摘を満たしている（購読者ごとの集合を drain するので O(変更量)）
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
| ワーカープール実装 | `src/application/worker-pool.ts` | 実装済み | mc-worldgen / mc-meshing の Port を消費 |
| ~~`window` 入力アダプタ~~ | ~~`input-service.ts:171-205`~~ | — | **実装済。§2.9** |
| ゲームパッド / タッチ | `domain/gamepad-input.ts` / `application/gamepad-input-adapter.ts` / `application/browser-input-adapter.ts` | 実装済み | ホストがゲームパッドの読み取りと毎フレーム `poll` を担当 |

`raycasting-service.ts`（89 LOC）に注意。plan.md §3.4 は
「ブロック狙撃はレイキャストではなく voxel-DDA（参照実装で 2.3ms→0.09ms、25倍）」として
**mc-physics** に置いている。mc-render 側に残るのは THREE の `Raycaster` を使う
**描画専用**の用途（マウスピッキング等）だけのはずである。**実装時に切り分けること。**

## 8. APIロック

plan.md §6 Step 0-3。**実装済みで、§9 のツール選定も決着している。**
mc-render の下流は kit のみだが、kit は全プレビューの土台なので実質的な影響範囲は広い。

| 項目 | 内容 |
| --- | --- |
| 生成物 | リポジトリ直下の `api-lock.md`（公開宣言 121 件 + 参照されている非 export 宣言 17 件。コミット対象） |
| 生成器 | `scripts/api-lock.ts`（16 リポジトリに byte-identical で vendor。`scripts/check-dependency-whitelist.ts` と同じ方式で、編集してよいのは `REPOSITORY_POLICY` だけ） |
| 検査 | `pnpm api:check` — `api-lock.md` が実際の公開 API と食い違えば非ゼロ終了 |
| 更新 | `pnpm api:update` |
| 配線 | `pnpm verify` の `check:deps` と `test` の間、および CI の `API lock` ステップ |
| 追加依存 | **なし**（`typescript` は既に devDependency） |

`@microsoft/api-extractor` を先に試して却下した経緯・実測・仕組み・限界は
mc-kernel の `docs/versioning.md` §7 が正本。ここでは mc-render にとっての意味だけ書く。

**この選定は本書 §6 の `RRegister` 議論と同じものを守っている。** api-extractor は
`Context.Tag` のサービスクラスを「forgotten export」として落とし、Tag 識別子文字列と
束ねられた service 型を捨てる。mc-render の `api-lock.md` にはそれが残っている:

```ts
const InputService_base: Context.TagClass<InputService, "@nerima-games/mc-render/InputService", InputServiceApi>;
```

`InputService` は §6 が言う通り `ROut` にも `RRegister` にも現れ、`RIn` には現れないサービスである。
この Tag 文字列は mc-compose がステージを合成するときの解決鍵であり、
黙って変わると mc-render 単体では型検査を通ったまま、合成した瞬間に実行時で壊れる。
`GameModule<ROut, E, RIn, RRegister = never>` の型引数と既定値がロックにそのまま写るのも同じ理由で重要である
（生成器が `checker.typeToString` ではなく declaration emit を使っているのはこのため）。

捕まえないもの: **挙動**（THREE のアダプタが何を描くかはこのファイルに出ない。テストの仕事）と、
**interface / 型リテラルのメンバ順**（ソース順を保つので並べ替えは API 変更でなくても diff になる）。

公開面を変える PR は `pnpm api:update` の結果を**同じ PR に**含めること。
§7 の `WorldRenderer` が入るときが、このロックの最初の大きな diff になる。
