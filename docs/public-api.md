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
| プリセット解決 | `resolvePreset`（`packages/game/application/settings-service.config.ts`） | `QUALITY_PRESETS`。ポストFX・屈折間引き・DPR上限は転写済み、影解像度・視界距離は所有者違いで対象外（§1.3） |
| 定数 | `packages/app/application/main.config.ts:30-32` `GTAO_BLEND_INTENSITY = 0.8`、`BLOOM_*`、`BOKEH_*` | 未移植 |

### 1.3 プリセット項目の現況

`GraphicsQuality` は当初ポストFXの有無しか持たなかったが、現在は 5 フィールドに
拡張済みである（`domain/post-processing.ts:135-160`）。参照実装の `resolvePreset`
が返す値のうち、次の 4 つは本実装に転写され、ブラウザアダプタまで配線済み:

- `composerRenderTarget`（参照実装の `composerRtType` に相当。`WebGLRenderTarget` の
  `type` を LDR/HDR で切り替える。`domain/post-processing.ts:137,163`、値は
  `:221,235,249,263`）。`src/browser.ts:285-288` の `qualityUsesHdrRenderTarget` が
  `THREE.HalfFloatType` / `THREE.UnsignedByteType` へ写像する
- `bloomStrength`（プリセットごとに違う。`domain/post-processing.ts:141`、値は
  `:220,234,248,262`）。`src/browser.ts:257-259` が `UnrealBloomPass` へ渡す
- `godRaysSamples`（`domain/post-processing.ts:139`、値は `:224,238,252,266`）。
  `src/browser.ts:338` が `createGodRaysShader` へ渡す
- レンダースケール（`pixelRatioCap`。DPR の上限で、レンダーバッファのサイズを
  `viewport size × pixelRatio` として直接決める。`domain/post-processing.ts:147`、
  値は各プリセット）。`src/browser.ts:180-193`（`resolveMaxPixelRatio`/
  `resolvePixelRatio`）・`:893`（呼び出し）・`:309,373,683`（`setPixelRatio`）で配線済み

残るのは 2 項目で、どちらも「ノブが無い」のではなく「所有者が別にいる」という
理由で止まっている（`domain/post-processing.ts:201-206`）:

- **影解像度** — このリポジトリに実時間の影を落とす THREE ライトが 1 つも無い
  （`DirectionalLight` 等は未使用）。既存の焼き込み voxel-lighting モデルの隣に
  もう 1 つの照明モデルを足す製品判断であり、ノブの追加では済まない。保留は
  意図であって漏れではない（`domain/post-processing.ts:201-206`）
- **視界距離** — `WorldRendererOptions` に `renderDistance` は無い
  （`application/world-renderer.ts:526-557`）。生の `farPlane`（世界単位、既定
  300、`:529`,`:166`）が逃げ道として既にあるが、参照実装のチャンク基準の
  `renderDistance` は mc-sim 所有で未公開であり、本パッケージから届かない
  （`application/world-renderer.ts:145-166`）

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

## 1.5 Particle requests and pools

`ParticleService` accepts typed render-space requests through
`spawn(request): Effect.Effect<0 | 1>`. `ParticleRequestSchema` validates the
kind, dimension-aware world position, optional RGB color, lifetime, direction,
and followed entity. Color channels are finite values in `[0, 1]`; lifetime is
finite and positive. Decode untrusted values at the host boundary before calling
the service.

The supported kinds are `block-break`, `entity-hit`, `explosion`, and
`level-up`. Provide `ParticleService` with `ParticleServiceLive`; each layer
build creates one `ParticlePool`. A request returns `1` when accepted and `0`
when its dimension does not match the active render dimension or its followed
entity is unavailable.
When the pool is full, it evicts the oldest live particles and still accepts the
request. A followed particle tracks the entity each frame. A frame from another
dimension hides the particle while retaining its follow target. If the entity
disappears from a matching-dimension frame, the particle detaches at its last
position and continues for its remaining lifetime.

`direction`, when supplied, is multiplied by the kind's base speed without
normalization. Without it, particles keep the pool's randomized burst velocity.
The following defaults apply when a request omits its color or lifetime:

| Kind | Count | Base speed (m/s) | RGB tint | Lifetime (s) |
| --- | ---: | ---: | --- | ---: |
| `block-break` | 6 | 2 | `(1, 1, 1)` | 0.5 |
| `entity-hit` | 4 | 1.5 | `(1, 0.35, 0.25)` | 0.5 |
| `explosion` | 16 | 3 | `(1, 0.55, 0.2)` | 0.5 |
| `level-up` | 8 | 1 | `(0.45, 1, 0.4)` | 0.5 |

```typescript
import { Effect } from 'effect'
import {
  PARTICLE_KIND_DEFAULTS,
  ParticleRequestSchema,
  ParticleService,
  ParticleServiceLive,
  makeParticlePool,
  type ParticleRequest,
} from '@nerima-games/mc-render'
```

`ParticleServiceApi` has this service shape:

```typescript
type ParticleServiceApi = {
  readonly spawn: (request: ParticleRequest) => Effect.Effect<0 | 1>
}
```

`ParticlePool` is a branded value built by `makeParticlePool`. It exposes fixed
typed render buffers and read-only `activeCount`, `seed`, and `evictionCount`
diagnostics. The generator state, eviction sequence, and follow offsets remain
internal. Use the pool operations for low-level rendering; game code should
request particles through `ParticleService`.

### 1.6 Kernel DomainEvent particle mapping

`particleRequestForDomainEvent(event, context?)` is a pure mapper from the
mc-kernel 0.10.0 `DomainEvent` vocabulary to a `ParticleRequest`. It returns
`undefined` when a known event has no render particle or its entity position
cannot be resolved. It returns `UnhandledParticleEvent` only if a value from a
newer runtime carries an event tag outside mc-kernel 0.10.0's typed vocabulary.
The mc-kernel 0.10.0 `DomainEvent` union is handled exhaustively across all 20
tags. The mapper does not subscribe to the mc-sim event bus; the host owns that
subscription and passes each event to this mapper.

```typescript
export type ParticleEventContext = Readonly<{
  readonly positionOfEntity?: (entity: EntityId) => WorldPosition | undefined
}>

export type UnhandledParticleEvent = Readonly<{
  readonly _tag: 'UnhandledParticleEvent'
  readonly eventTag: string
}>

export type ParticleEventResult = ParticleRequest | UnhandledParticleEvent | undefined

export const particleRequestForDomainEvent: (
  event: DomainEvent,
  context?: ParticleEventContext,
) => ParticleEventResult
```

Block addresses become requests at the block center. Events without a captured position use
`ParticleEventContext.positionOfEntity` to resolve their actor or entity. If
that lookup has no position, the mapper returns `undefined` instead of
inventing a world coordinate. Requests for a resolved entity follow that entity
through `ParticleService`. Callers should treat `UnhandledParticleEvent` as an
unrecognized runtime tag that needs handling when the kernel vocabulary grows.

| Kernel event tag | ParticleRequest mapping |
| --- | --- |
| `EntityDamaged` | `entity-hit` at the event position, following the damaged entity |
| `BlockBroken` | `block-break` at the block center |
| `Explosion` | `explosion` at the event position; creeper uses green tint and TNT uses red tint |
| `LevelUp` | `level-up` at the captured entity position, following the entity |
| `AchievementUnlocked` | No particle; achievement feedback belongs to the UI notification surface |
| `BlockPlaced` | Cyan-tinted `level-up` at the block center |
| `BlockChangedByWorld` | `block-break` at the block center |
| `EntityDied` | `entity-hit` at the captured death position |
| `EntityHealed` | `level-up` at the resolved entity position |
| `EntitySpawned` | `level-up` at the captured spawn position, following the entity |
| `EntityTeleported` | `level-up` at the destination position, following the entity |
| `ItemDropped` | `block-break` at the dropped item's position |
| `ItemPickedUp` | `level-up` at the resolved actor position |
| `ItemConsumed` | `level-up` at the resolved actor position |
| `WeatherGameplayEffect` | Lightning uses a pale explosion tint; creeper charge uses the creeper tint; transformation uses a magenta `level-up` tint. Entity effects require a resolved position. |
| `ProjectileLaunched` | `entity-hit` at the origin, directed by the initial velocity and following the shooter |
| `ProjectileImpacted` | `entity-hit` at the impact position; entity hits follow the target |
| `ShieldBlocked` | Cyan-tinted `entity-hit` at the shield position, following the defender |
| `ExperienceCollected` | `level-up` at the resolved player position |
| `VehicleTransition` | No particle; mc-render has no mount-transition effect |

The public package entry exports `particleRequestForDomainEvent` and the
`ParticleEventContext` type:

```typescript
import {
  particleRequestForDomainEvent,
  type ParticleEventContext,
  type ParticleEventResult,
  type UnhandledParticleEvent,
} from '@nerima-games/mc-render'
```

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
| スクリーンショット | `screenshot-service.ts`（50 LOC） | Browser entry は canvas の PNG capture と F2 download を提供する。QA workflow の管理は host の責務 |
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

§2.2 が過去の監査で「要求側（`requestPointerLock`）は未実装」と記録していた穴は、現行実装で閉じている。
`uiClicks`（§2.5）は「ロックを取り直すクリック」を記録するのに、それを受ける側が無かったので、
**当時のプレビューはマウスルックに入れなかった。**

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
type FocusTargetForElement = (target: unknown) => FocusTarget | undefined
type ClickLandingForTarget = (target: unknown) => ClickLanding
type FocusNavigationHandler = (direction: FocusNavigationDirection) => void

type DomEventContext = {
  readonly pointerLockHeld: boolean
  readonly focusTargetForElement?: FocusTargetForElement
  readonly clickLandingForTarget?: ClickLandingForTarget
  readonly pointerLockTarget?: unknown
  readonly onFocusNavigationDirection?: FocusNavigationHandler
  readonly touchControls?: ReadonlyArray<TouchControlTarget>
}

const PREVENT_DEFAULT_EVENTS: ReadonlyArray<string>   // ['wheel', 'contextmenu']
const mayPreventDefault: (eventName: string) => boolean
const listenerOptionsFor: (eventName: string) => DomListenerOptions
const TRANSLATED_DOM_EVENTS: ReadonlyArray<string>

const translateDomEvent: (planned, event: DomInputEvent, context) => InputEvent | undefined
const installInputListeners: (targets, input: InputServiceApi, options?) => InstalledInputListeners
const scopedInputListeners: (targets, input, options?) => Effect<InstalledInputListeners, never, Scope>

type BrowserPointerLockOptions = { canvas: PointerLockTarget; allowsPointerLock?: () => boolean }
const makeBrowserPointerLockPort: (options) => PointerLockPort

type BrowserInputOptions = {
  targets; canvas?; allowsPointerLock?; bindings?
  focusTargetForElement?; clickLandingForTarget?; onFocusNavigationDirection?
  touchControls?
}
const browserInputLayer: (options: BrowserInputOptions) => Layer<InputService>

// The renderer compares the target with the canvas and delegates UI membership
// classification to the host.
const resolveClickLanding: (
  pointerLockTarget: unknown,
  target: unknown,
  clickLandingForTarget?: ClickLandingForTarget
) => ClickLanding
```

### 2.9.2 `lib` に `"DOM"` を入れなかった理由

正本は [design-notes.md](./design-notes.md) DN-15。要点だけ:

`lib: ["ES2024"]` / `types: []` は**ポストFXの順序・ホイールのモデル・ロック状態機械を
`environment: 'node'` で検査可能にしている当の機構**であり、
plan.md §3.10（Playwright は SwiftShader でポインタロック不可）により
ブラウザ側にも逃げ場が無い。1 つのアダプタのために全ファイルからその歯止めを外すのは高すぎる。

アダプタ専用の 2 つ目の tsconfig プロジェクトも採れない。
`tsconfig.build.json` が package の唯一の出力プロジェクトであり、
`tsconfig.test.json` と `tsconfig.preview.json` は検証専用である。
公開 declaration とアダプタの型検証を別の出力境界に分けると、package の公開面と
実際に検証した面がずれるため、DOM アダプタは構造的な型で build project に留めている。

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

## 2.10 Keyboard focus boundary

mc-render owns the focus DTO and the key-to-intent vocabulary. mx-ui owns DOM
membership and resolves a focused element to that DTO. The dependency points
from mx-ui to mc-render; mc-render does not import mx-ui or inspect its DOM.

### Public DTO

```typescript
// domain/input-bindings.ts
export type FocusTarget = {
  readonly group: string
  readonly index: number // zero-based within the group
}

// application/input-service.ts
type InputEvent =
  | { readonly kind: 'focuschange'; readonly focus: FocusTarget | undefined }

type InputSnapshot = {
  readonly keyboardFocus: FocusTarget | undefined
}

type InputServiceApi = {
  readonly dispatch: (event: InputEvent) => Effect.Effect<void>
  readonly keyboardFocus: Effect.Effect<FocusTarget | undefined>
}
```

The root entry exports `FocusTarget`, `InputEvent`, `InputSnapshot`, and
`InputServiceApi`. When using `browserInputLayer`, mx-ui provides a
`focusTargetForElement` callback; the adapter dispatches its result as a
`focuschange` event. The DTO contains only the group name and its zero-based member index. It carries
no element, selector, or mx-ui-specific type. `undefined` means that focus is
outside the managed groups; index `0` remains a valid focused member.

### Reading focus

`InputServiceApi.keyboardFocus` and `InputSnapshot.keyboardFocus` expose the
same retained focus value. They return `undefined` while pointer lock is held,
so gameplay keys do not leave a UI focus indicator active. Releasing pointer
lock reveals the retained value again. A consumer can read the service directly
or use the snapshot.

### Keyboard intent

The root entry also exports `FocusNavigationDirection`,
`focusNavigationDirectionForCode`, `FocusStep`,
`focusStepForDirection`, and `focusNavigationStepForCode`. These map keyboard
codes to navigation intent and an index step. Focus-group lookup, DOM membership,
and moving focus between mx-ui elements belong to mx-ui. The adapter emits arrow
intent only while pointer lock is not held. It still dispatches the raw key to
the input service, and it does not suppress the browser default.

Tab remains owned by the browser. mc-render does not prevent its default action
or move DOM focus. `FOCUS_NAVIGATION_POLICY.preventDefault` is `false`;
keyboard intent conversion does not change that policy.

## 2.11 Click landing and pointer-lock acquisition

An unlocked click can both activate UI and reach the input service. Pointer lock
must be requested only when the click lands on the canvas that will receive the
lock. `acquiresPointerLock` requires the configured mouse button, an unlocked or
refused state, and the `lock-target` landing:

```typescript
type ClickLanding = 'lock-target' | 'ui' | 'elsewhere'
const POINTER_LOCK_ACQUIRE_LANDING: ClickLanding = 'lock-target'
const acquiresPointerLock = (button, state, landing) =>
  button === POINTER_LOCK_ACQUIRE_BUTTON &&
  landing === POINTER_LOCK_ACQUIRE_LANDING &&
  (state === 'unlocked' || state === 'refused')
```

The browser adapter identifies the configured canvas by object identity. For
other targets it calls the optional mx-ui-owned `clickLandingForTarget` mapper,
which returns `ui` or `elsewhere`. If no mapper is supplied, non-canvas clicks
are `elsewhere`. mc-render does not maintain or inspect a UI element roster.

| Landing | Meaning | Requests pointer lock |
| --- | --- | --- |
| `lock-target` | The canvas passed to `BrowserInputOptions.canvas` | Yes |
| `ui` | The host classifies the target as UI | No |
| `elsewhere` | Any other target | No |

A click's landing does not remove it from `uiClicks`. The snapshot keeps the
button set and ordered `uiClickLandings` so a menu can react to clicks while
pointer-lock acquisition uses the landing.

`resolveClickLanding(pointerLockTarget, target, clickLandingForTarget?)` is
exported for hosts and tests. A missing or null target resolves to `elsewhere`;
a target identical to the non-null canvas resolves to `lock-target` before the
host mapper is consulted.

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

チャンクの scene key は `@nerima-games/mc-kernel` の branded `ChunkKey` である。
`ChunkGeometryUpdate.key`、`WorldRenderer.setChunk`、`removeChunk`、`chunkKeys` はこの型を
共有し、文字列を直接渡す API ではない。worldgen の `chunkKeyOf` が返す key をそのまま使う。

`planRenderEnvironment` は第 3 引数に `@nerima-games/mc-kernel` の
`Dimension`（`'overworld' | 'nether' | 'end'`）を取る。省略時は `'overworld'` で、既存の
呼び出しはすべて出力が変わらない。`nether`（太陽も昼夜サイクルも無い、閉じた霧）と
`end`（暗い、太陽の無い虚空）は `daylight` を無視し、`RenderEnvironmentPlan.dimension` に
解決済みの次元を返す。`WorldRendererOptions.dimension`、`WorldWeatherSnapshot.dimension`、
`WeatherRenderer.stop(daylight?, dimension?)` の 3 箇所がこれを配線する。`Dimension` 自体は
再エクスポートしない — `src/index.ts` 末尾に書かれている既存方針
（「Kernel and meshing vocabulary are not re-exported from this package」）どおり、
呼び出し側は `@nerima-games/mc-kernel` から直接 import する。恒星（`end` の星空）は
色の差し替えではなく新規のジオメトリなので、この変更には含めていない — 次の変更のための
フックとして `RenderEnvironmentPlan.dimension` フィールドだけが値に残る。

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
  readonly sourceCapturedAtSecs: MonotonicTimeSecs | undefined
}
const mirroredCameraState: (snapshot: CameraPoseSnapshot | undefined, offset?: ViewOffset) => MirroredCameraState
const forwardVector: (snapshot: CameraPoseSnapshot) => Position
const mirrorLagSecs / isMirrorStale // 未初期化時は undefined / false
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

const renderModule: (quality?) => GameModule<InputService, never, never, InputService | PlayerService>
const renderStages: (options: RenderStagesOptions) => ReadonlyArray<StageRegistration>
const makeRenderFrameState: (quality?) => Effect<RenderFrameState>
const makeRenderStagesForPreview: (quality?) => Effect<{state, stages}, never, InputService | PlayerService>
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
RRegister = InputService | PlayerService — render の登録に必要
```

`InputService` は `ROut` と `RRegister` にあり、`PlayerService` は `RRegister` にある。
どちらも `RIn` には無い。
`RRegister` を `RIn` に畳むと「自分が出荷するサービスをホストが供給しろ」と言うことになる。
経緯は mc-kernel `docs/freeze-checklist.md` (b)。

### カメラ姿勢の所有権

**フレーム位置と順序制約は確定**である。mc-compose が必要とするのはそれであり、
本体が埋まっても変わらない。

`render:camera-mirror` は登録時に要求した `PlayerService` の
`cameraPose: Effect<CameraPoseSnapshot, never, ClockPort>` を読み、
`RenderFrameState` に pose を保存しない。`authoritativePose` と `initialPose` は公開 API に無く、
時計は compose 側が `FrameServices` として供給する。

## 7. 参照実装の API 棚卸し（初期設計時の履歴）

This is the original pre-implementation inventory, retained as historical context.
It is not a list of current API gaps: several rows, including `WorldRenderer`,
are implemented and documented above. The shipped root and browser entries are
listed in §§8–9.

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

## 8. 公開 API と package 検証

The public package surface is defined by the entry points listed in
`package.json#exports`. The root entry is `src/index.ts`; the browser entry is
`src/browser.ts`. Review the emitted declarations and both package export paths
when changing the public API.

| 検査 | 保証するもの |
| --- | --- |
| `pnpm typecheck` | build / test / preview / browser TypeScript projects resolve successfully |
| `pnpm build` | Removes stale `dist/` output and emits declarations and ESM for both entries |
| `pnpm pack --dry-run` | `package.json#files` に従った package 内容になること |
| `pnpm test` | Behavior tests |
| `pnpm test:coverage` | Behavior tests and 100% statements / branches / functions / lines for Node coverage scope; browser runtime behavior is checked by `pnpm test:browser` |

This repository does not maintain an API lock file or API lock commands. Review
the source entry points and declaration diffs in pull requests. Tests and the
browser fixtures verify runtime rendering behavior.

## 9. Browser entry

Import `@nerima-games/mc-render/browser` in a browser host that owns a canvas.
This entry depends on Three.js and is built with DOM types; the root entry stays
portable and DOM-free.

```typescript
import {
  GpuTimerService,
  GpuTimerServiceLayer,
  makeBrowserWorldRuntime,
  makeGpuTimerService,
  type BrowserFrame,
  type BrowserWorldRuntime,
  type BrowserWorldRuntimeOptions,
  type GpuTimerServiceApi,
  type GpuTimerServiceFailure,
} from '@nerima-games/mc-render/browser'
```

`makeBrowserWorldRuntime(options)` asynchronously creates a runtime for the
provided `HTMLCanvasElement`. The returned runtime exposes its Three.js
renderer, scene, perspective camera, world renderer, resize and frame
operations, water surface attachment, screenshot capture, animation controls,
and disposal. Its live `quality` and `qualityPreset` values reflect adaptive
quality changes; `latestGpuTimeMs`, `gpuTimingSupported`, and `latestSsim`
expose the most recent measurements.

`BrowserWorldRuntimeOptions` accepts an optional texture atlas, quality preset
or custom quality, pixel ratio limit, resize behavior, water geometry, and world
renderer options. `BrowserFrame` combines mirrored camera state with an
optional production frame.

`GpuTimerService` measures elapsed GPU time through the WebGL timer query
extension. `GpuTimerServiceLayer(gl)` provides it as an Effect service, and
`makeGpuTimerService(gl)` creates its API directly. A poll returns elapsed
milliseconds when a query is available and valid; unsupported, pending, or
disjoint queries return `undefined`. GPU failures use
`GpuTimerServiceFailure`.

This entry uses the package's pinned Three.js dependency. Applications must
provide a WebGL2-capable browser for rendering. The browser test job exercises
shader compilation, the composite and refraction paths, GPU timer support and
fallback, adaptive quality, and rendered pixels on Chromium with software WebGL.
