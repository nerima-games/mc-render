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
const acquiresPointerLock: (button: MouseButton, state: PointerLockState) => boolean

// application/input-service.ts
type InputEvent =
  | { kind: 'keydown' | 'keyup'; code: KeyCode; target: ListenerTarget }
  | { kind: 'mousedown' | 'mouseup'; button: MouseButton; target: ListenerTarget }
  | { kind: 'contextmenu'; target: ListenerTarget }
  | { kind: 'pointermove'; deltaX: number; deltaY: number }
  | { kind: 'wheel'; deltaY: number; deltaMode: WheelDeltaMode }
  | { kind: 'pointerlockchange'; locked: boolean }
  | { kind: 'pointerlockerror' }
  | { kind: 'blur' }

type InputSnapshot = {
  readonly pressed: ReadonlySet<InputCode>       // キー + ロック中に押されたボタン
  readonly justPressed: ReadonlySet<InputCode>   // 同じエッジ集合。endFrame でクリア
  readonly uiClicks: ReadonlySet<MouseButton>    // 非ロック中のクリック。endFrame でクリア
  readonly pointerDelta: { x: number; y: number }
  readonly wheelNotches: number                  // 端数込みの累積ノッチ
  readonly wheelSteps: number                    // 整数ノッチ。ホットバーが読むのはこれ
  readonly pointerLocked: boolean                // pointerLockState === 'locked' の派生
  readonly pointerLockState: PointerLockState
}

// ポインタロックの「要求」の出口。DOM 型は使わない（§2.8）
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
  readonly endFrame: Effect.Effect<void>
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
| 非ロック中 | `uiClicks` のみ | `wasUiClick` |

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

- **どのクリックか**: `acquiresPointerLock(button, state)`。左ボタンのみ、`unlocked` / `refused` のみ。
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

## 3. WorldRenderer — **未設計。最優先**

plan.md §3.9 の筆頭 API であり、**まだ 1 行も無い。**

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
| ワーカープール実装 | `packages/worker/infrastructure/` | ~1,100 | mc-worldgen / mc-meshing |
| `window` 入力アダプタ | `packages/presentation/input/input-service.ts:171-205` | — | 全プレビュー |
| ゲームパッド / タッチ | `gamepad-input-state.ts` / `virtual-input-state.ts` | 216 | mx-ui（モバイル） |

`raycasting-service.ts`（89 LOC）に注意。plan.md §3.4 は
「ブロック狙撃はレイキャストではなく voxel-DDA（参照実装で 2.3ms→0.09ms、25倍）」として
**mc-physics** に置いている。mc-render 側に残るのは THREE の `Raycaster` を使う
**描画専用**の用途（マウスピッキング等）だけのはずである。**実装時に切り分けること。**

## 8. APIロック

plan.md §6 Step 0-3。**実装済みで、§9 のツール選定も決着している。**
mc-render の下流は kit のみだが、kit は全プレビューの土台なので実質的な影響範囲は広い。

| 項目 | 内容 |
| --- | --- |
| 生成物 | リポジトリ直下の `api-lock.md`（公開宣言 98 件 + 参照されている非 export 宣言 17 件。コミット対象） |
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
