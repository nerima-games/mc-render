# API lock — @nerima-games/mc-render

<!-- ------------------------------------------------------------------------- -->
<!-- GENERATED FILE. Do not edit by hand.                                      -->
<!--                                                                           -->
<!-- Regenerate with `pnpm api:update`. `pnpm api:check`, which `pnpm verify`  -->
<!-- runs, fails when this file is stale.                                      -->
<!--                                                                           -->
<!-- Every line below is part of the published surface of this package. A diff -->
<!-- here is a diff in what consumers can see, and is the thing plan.md §6     -->
<!-- Step 0-3 asks to be reviewed as a diff. See scripts/api-lock.ts for how   -->
<!-- it is produced and why it is produced this way.                           -->
<!-- ------------------------------------------------------------------------- -->

format: 1
exported declarations: 147
supporting declarations: 17

## Exported

### Bindings  `type`

```ts
type Bindings = Readonly<Record<string, InputCode>>;
```

### BrowserInputOptions  `type`

```ts
type BrowserInputOptions = {
    readonly targets: BrowserInputTargets;
    readonly canvas?: PointerLockTarget;
    readonly allowsPointerLock?: () => boolean;
    readonly bindings?: Bindings;
    readonly focusGroups?: ReadonlyArray<FocusGroupTargets>;
    readonly touchControls?: ReadonlyArray<TouchControlTarget>;
};
```

### BrowserInputTargets  `type`

```ts
type BrowserInputTargets = {
    readonly window: DomEventTarget;
    readonly document: DomDocument;
};
```

### BrowserPointerLockOptions  `type`

```ts
type BrowserPointerLockOptions = {
    readonly canvas: PointerLockTarget;
    readonly allowsPointerLock?: () => boolean;
};
```

### CLICK_LANDINGS  `const`

```ts
const CLICK_LANDINGS: readonly ["lock-target", "ui", "elsewhere"];
```

### COMPOSITE_SUBSUMES  `const`

```ts
const COMPOSITE_SUBSUMES: ReadonlySet<PostProcessingPass>;
```

### ChainViolation  `type`

```ts
type ChainViolation = {
    readonly rule: 'out-of-order' | 'missing-mandatory' | 'duplicate' | 'composite-conflict' | 'trailing-pass';
    readonly message: string;
};
```

### ClickLanding  `type`

```ts
type ClickLanding = (typeof CLICK_LANDINGS)[number];
```

### DEFAULT_BINDINGS  `const`

```ts
const DEFAULT_BINDINGS: Readonly<Record<Exclude<InputAction, 'escape'>, InputCode>>;
```

### DomDocument  `type`

```ts
type DomDocument = DomEventTarget & {
    readonly pointerLockElement: unknown;
};
```

### DomEventContext  `type`

```ts
type DomEventContext = {
    readonly pointerLockHeld: boolean;
    readonly focusGroups: ReadonlyArray<FocusGroupTargets>;
    readonly pointerLockTarget?: unknown;
    readonly touchControls?: ReadonlyArray<TouchControlTarget>;
};
```

### DomEventTarget  `type`

```ts
type DomEventTarget = {
    readonly addEventListener: (type: string, listener: DomListener, options?: DomListenerOptions) => void;
    readonly removeEventListener: (type: string, listener: DomListener, options?: DomListenerOptions) => void;
};
```

### DomInputEvent  `type`

```ts
type DomInputEvent = {
    readonly preventDefault: () => void;
    readonly code?: string;
    readonly button?: number;
    readonly movementX?: number;
    readonly movementY?: number;
    readonly deltaY?: number;
    readonly deltaMode?: number;
    readonly target?: unknown;
};
```

### DomListener  `type`

```ts
type DomListener = (event: DomInputEvent) => void;
```

### DomListenerOptions  `type`

```ts
type DomListenerOptions = {
    readonly capture?: boolean;
    readonly passive?: boolean;
};
```

### ESCAPE_KEY_CODE  `const`

```ts
const ESCAPE_KEY_CODE: KeyCode;
```

### ESCAPE_OWNER  `const`

```ts
const ESCAPE_OWNER: "frame-handler";
```

### ESCAPE_POLICY  `const`

```ts
const ESCAPE_POLICY: {
    readonly key: string;
    readonly owner: "frame-handler";
    readonly registeredBy: "nobody — the frame-level handler reads it, no binding maps to it";
    readonly rationale: string;
};
```

### EXPERIENCE_MODULE_STAGE_PREFIXES  `const`

```ts
const EXPERIENCE_MODULE_STAGE_PREFIXES: readonly ["gameplay:", "redstone:", "ui:", "multiplayer:"];
```

### FOCUS_NAVIGATION_KEY_CODE  `const`

```ts
const FOCUS_NAVIGATION_KEY_CODE: KeyCode;
```

### FOCUS_NAVIGATION_OWNER  `const`

```ts
const FOCUS_NAVIGATION_OWNER: "user-agent";
```

### FOCUS_NAVIGATION_POLICY  `const`

```ts
const FOCUS_NAVIGATION_POLICY: {
    readonly key: string;
    readonly owner: "user-agent";
    readonly preventDefault: false;
    readonly registeredBy: "nobody — the browser moves focus, and `focusin`/`focusout` on document report where it went";
    readonly rationale: string;
};
```

### FocusGroupTargets  `type`

```ts
type FocusGroupTargets = {
    readonly group: string;
    readonly targets: ReadonlyArray<unknown>;
};
```

### FocusTarget  `type`

```ts
type FocusTarget = {
    readonly group: string;
    readonly index: number;
};
```

### FrameScratch  `type`

```ts
type FrameScratch = {
    readonly visibleChunks: ScratchMap<string, number>;
    readonly entityInstances: ScratchMap<string, number>;
    readonly lightUpdates: ScratchMap<string, number>;
};
```

### GAMEPLAY_LISTENER_TARGET  `const`

```ts
const GAMEPLAY_LISTENER_TARGET: ListenerTarget;
```

### GraphicsQuality  `type`

```ts
type GraphicsQuality = {
    readonly ssaoEnabled: boolean;
    readonly godRaysEnabled: boolean;
    readonly bloomEnabled: boolean;
    readonly dofEnabled: boolean;
    readonly smaaEnabled: boolean;
    readonly useCompositePass: boolean;
};
```

### HOTBAR_FOCUS_GROUP  `const`

```ts
const HOTBAR_FOCUS_GROUP = "hotbar";
```

### INPUT_ACTIONS  `const`

```ts
const INPUT_ACTIONS: readonly ["moveForward", "moveBackward", "moveLeft", "moveRight", "jump", "sneak", "sprint", "openInventory", "openChat", "attack", "use", "pickBlock", "hotbarSlot1", "hotbarSlot2", "hotbarSlot3", "hotbarSlot4", "hotbarSlot5", "hotbarSlot6", "hotbarSlot7", "hotbarSlot8", "hotbarSlot9", "escape"];
```

### InputAction  `type`

```ts
type InputAction = (typeof INPUT_ACTIONS)[number];
```

### InputCode  `type`

```ts
type InputCode = KeyCode | MouseButton;
```

### InputEvent  `type`

```ts
type InputEvent = {
    readonly kind: 'keydown';
    readonly code: KeyCode;
    readonly target: ListenerTarget;
} | {
    readonly kind: 'keyup';
    readonly code: KeyCode;
    readonly target: ListenerTarget;
} | {
    readonly kind: 'mousedown';
    readonly button: MouseButton;
    readonly target: ListenerTarget;
    readonly landing: ClickLanding;
} | {
    readonly kind: 'mouseup';
    readonly button: MouseButton;
    readonly target: ListenerTarget;
} | {
    readonly kind: 'contextmenu';
    readonly target: ListenerTarget;
} | {
    readonly kind: 'pointermove';
    readonly deltaX: number;
    readonly deltaY: number;
} | {
    readonly kind: 'wheel';
    readonly deltaY: number;
    readonly deltaMode: WheelDeltaMode;
} | {
    readonly kind: 'pointerlockchange';
    readonly locked: boolean;
} | {
    readonly kind: 'pointerlockerror';
} | {
    readonly kind: 'blur';
} | {
    readonly kind: 'focuschange';
    readonly focus: FocusTarget | undefined;
} | {
    readonly kind: 'touchpress';
    readonly action: InputAction;
    readonly target: ListenerTarget;
} | {
    readonly kind: 'touchrelease';
    readonly action: InputAction;
    readonly target: ListenerTarget;
};
```

### InputService  `class`

```ts
class InputService extends InputService_base {
}
```

### InputServiceApi  `type`

```ts
type InputServiceApi = {
    readonly dispatch: (event: InputEvent) => Effect.Effect<void>;
    readonly snapshot: Effect.Effect<InputSnapshot>;
    readonly isActionActive: (action: InputAction) => Effect.Effect<boolean>;
    readonly wasActionJustTriggered: (action: InputAction) => Effect.Effect<boolean>;
    readonly isButtonDown: (button: MouseButton) => Effect.Effect<boolean>;
    readonly wasButtonJustPressed: (button: MouseButton) => Effect.Effect<boolean>;
    readonly wasUiClick: (button: MouseButton) => Effect.Effect<boolean>;
    readonly shouldSuppressContextMenu: Effect.Effect<boolean>;
    readonly shouldSuppressWheelScroll: Effect.Effect<boolean>;
    readonly pointerLockState: Effect.Effect<PointerLockState>;
    readonly keyboardFocus: Effect.Effect<FocusTarget | undefined>;
    readonly requestPointerLock: Effect.Effect<PointerLockState>;
    readonly endFrame: (frame?: InputSnapshot | undefined) => Effect.Effect<void>;
    readonly clearHeld: Effect.Effect<void>;
    readonly bindings: Effect.Effect<Bindings>;
    readonly rebind: (action: InputAction, key: InputCode) => Effect.Effect<RemapOutcome>;
    readonly resetBindings: Effect.Effect<void>;
};
```

### InputServiceLayer  `const`

```ts
const InputServiceLayer: (bindings?: Bindings, pointerLock?: PointerLockPort) => Layer.Layer<InputService>;
```

### InputSnapshot  `type`

```ts
type InputSnapshot = {
    readonly pressed: ReadonlySet<InputCode>;
    readonly justPressed: ReadonlySet<InputCode>;
    readonly uiClicks: ReadonlySet<MouseButton>;
    readonly uiClickLandings: ReadonlyArray<UiClick>;
    readonly pointerDelta: {
        readonly x: number;
        readonly y: number;
    };
    readonly wheelNotches: number;
    readonly wheelSteps: number;
    readonly pointerLocked: boolean;
    readonly pointerLockState: PointerLockState;
    readonly keyboardFocus: FocusTarget | undefined;
};
```

### InstalledInputListeners  `type`

```ts
type InstalledInputListeners = {
    readonly registrations: ReadonlyArray<ListenerRegistration>;
    readonly remove: () => void;
};
```

### KeyCode  `type`

```ts
type KeyCode = string;
```

### LISTENER_PLAN  `const`

```ts
const LISTENER_PLAN: ReadonlyArray<{
    readonly event: string;
    readonly target: ListenerTarget;
    readonly note: string;
}>;
```

### ListenerRegistration  `type`

```ts
type ListenerRegistration = {
    readonly event: string;
    readonly target: ListenerTarget;
    readonly listener: DomListener;
    readonly options: DomListenerOptions;
};
```

### ListenerTarget  `type`

```ts
type ListenerTarget = 'window' | 'document';
```

### MANDATORY_PASSES  `const`

```ts
const MANDATORY_PASSES: ReadonlySet<PostProcessingPass>;
```

### MIRROR_LAG_WARNING_SECS  `const`

```ts
const MIRROR_LAG_WARNING_SECS = 0.1;
```

### MODAL_LISTENER_TARGET  `const`

```ts
const MODAL_LISTENER_TARGET: ListenerTarget;
```

### MOUSE_BUTTONS  `const`

```ts
const MOUSE_BUTTONS: readonly ["MouseLeft", "MouseMiddle", "MouseRight"];
```

### MOUSE_BUTTON_BY_INDEX  `const`

```ts
const MOUSE_BUTTON_BY_INDEX: ReadonlyArray<MouseButton>;
```

### MaterialPolicyVerdict  `type`

```ts
type MaterialPolicyVerdict = {
    readonly kind: 'ok';
    readonly reason: string;
} | {
    readonly kind: 'must-force-single-pass';
    readonly reason: string;
} | {
    readonly kind: 'review-sharing';
    readonly reason: string;
};
```

### MaterialSide  `type`

```ts
type MaterialSide = 'front' | 'back' | 'double';
```

### MaterialSpec  `type`

```ts
type MaterialSpec = {
    readonly name: string;
    readonly transparent: boolean;
    readonly side: MaterialSide;
    readonly alphaTest: number;
    readonly shared: boolean;
};
```

### MirroredCameraState  `type`

```ts
type MirroredCameraState = {
    readonly position: Position;
    readonly rotation: {
        readonly x: number;
        readonly y: number;
        readonly z: number;
        readonly order: 'YXZ';
    };
    readonly sourceCapturedAtSecs: MonotonicTimeSecs;
};
```

### MouseButton  `type`

```ts
type MouseButton = (typeof MOUSE_BUTTONS)[number];
```

### NO_VIEW_OFFSET  `const`

```ts
const NO_VIEW_OFFSET: ViewOffset;
```

### OWN_STAGE_PREFIX  `const`

```ts
const OWN_STAGE_PREFIX = "render:";
```

### POINTER_LOCK_ACQUIRE_BUTTON  `const`

```ts
const POINTER_LOCK_ACQUIRE_BUTTON: MouseButton;
```

### POINTER_LOCK_ACQUIRE_LANDING  `const`

```ts
const POINTER_LOCK_ACQUIRE_LANDING: ClickLanding;
```

### POINTER_LOCK_STATES  `const`

```ts
const POINTER_LOCK_STATES: readonly ["unlocked", "requested", "locked", "refused"];
```

### POST_PROCESSING_PASS_ORDER  `const`

```ts
const POST_PROCESSING_PASS_ORDER: readonly ["render", "gtao", "godRays", "bloom", "bokeh", "composite", "smaa", "output"];
```

### PREVENT_DEFAULT_EVENTS  `const`

```ts
const PREVENT_DEFAULT_EVENTS: ReadonlyArray<string>;
```

### PlannedListener  `type`

```ts
type PlannedListener = {
    readonly event: string;
    readonly target: ListenerTarget;
};
```

### PointerLockPort  `type`

```ts
type PointerLockPort = {
    readonly request: Effect.Effect<PointerLockRequestOutcome>;
};
```

### PointerLockRequestOutcome  `type`

```ts
type PointerLockRequestOutcome = 'sent' | 'unavailable';
```

### PointerLockState  `type`

```ts
type PointerLockState = (typeof POINTER_LOCK_STATES)[number];
```

### PointerLockTarget  `type`

```ts
type PointerLockTarget = {
    readonly requestPointerLock?: () => unknown;
};
```

### PostProcessingPass  `type`

```ts
type PostProcessingPass = (typeof POST_PROCESSING_PASS_ORDER)[number];
```

### PostProcessingStep  `type`

```ts
type PostProcessingStep = {
    readonly pass: PostProcessingPass;
    readonly effects: ReadonlyArray<PostProcessingPass>;
};
```

### QUALITY_PRESETS  `const`

```ts
const QUALITY_PRESETS: Readonly<Record<QualityPreset, GraphicsQuality>>;
```

### QualityPreset  `type`

```ts
type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
```

### RENDER_STAGE_IDS  `const`

```ts
const RENDER_STAGE_IDS: {
    readonly input: StageId;
    readonly cameraMirror: StageId;
    readonly chunkSync: StageId;
    readonly draw: StageId;
    readonly postFx: StageId;
};
```

### RemapOutcome  `type`

```ts
type RemapOutcome = {
    readonly kind: 'ok';
    readonly bindings: Bindings;
} | {
    readonly kind: 'rejected';
    readonly rejection: RemapRejection;
};
```

### RemapRejection  `type`

```ts
type RemapRejection = {
    readonly reason: 'escape-is-not-bindable' | 'key-reserved-by-user-agent' | 'key-already-bound' | 'unknown-action';
    readonly message: string;
};
```

### RenderFrameState  `type`

```ts
type RenderFrameState = {
    readonly scratch: FrameScratch;
    readonly authoritativePose: Ref.Ref<CameraPoseSnapshot>;
    readonly viewOffset: Ref.Ref<ViewOffset>;
    readonly mirroredCamera: Ref.Ref<MirroredCameraState>;
    readonly mirrorLagSecs: Ref.Ref<number>;
    readonly input: Ref.Ref<InputSnapshot>;
    readonly visibleChunkCount: Ref.Ref<number>;
    readonly quality: Ref.Ref<GraphicsQuality>;
    readonly postFxChain: Ref.Ref<ReadonlyArray<PostProcessingStep>>;
    readonly postFxBuiltFrom: Ref.Ref<GraphicsQuality>;
    readonly framesDrawn: Ref.Ref<number>;
};
```

### ScratchMap  `type`

```ts
type ScratchMap<K, V> = {
    readonly name: string;
    readonly buffer: Map<K, V>;
    readonly usageCount: () => number;
    readonly borrowedCount: () => number;
};
```

### ScratchMisuseError  `class`

```ts
class ScratchMisuseError extends Error {
    readonly violation: ScratchViolation;
    constructor(violation: ScratchViolation);
}
```

### ScratchViolation  `type`

```ts
type ScratchViolation = {
    readonly rule: 're-entrant-borrow' | 'escaped-buffer';
    readonly message: string;
};
```

### TOUCH_LOOK_IDLE  `const`

```ts
const TOUCH_LOOK_IDLE: TouchLookState;
```

### TOUCH_LOOK_PHASES  `const`

```ts
const TOUCH_LOOK_PHASES: readonly ["press", "move", "release"];
```

### TRANSLATED_DOM_EVENTS  `const`

```ts
const TRANSLATED_DOM_EVENTS: ReadonlyArray<string>;
```

### TouchControlTarget  `type`

```ts
type TouchControlTarget = {
    readonly action: InputAction;
    readonly target: unknown;
};
```

### TouchLookPhase  `type`

```ts
type TouchLookPhase = (typeof TOUCH_LOOK_PHASES)[number];
```

### TouchLookState  `type`

```ts
type TouchLookState = {
    readonly anchor: TouchPoint | undefined;
};
```

### TouchLookStep  `type`

```ts
type TouchLookStep = {
    readonly state: TouchLookState;
    readonly delta: TouchPoint;
};
```

### TouchPoint  `type`

```ts
type TouchPoint = {
    readonly x: number;
    readonly y: number;
};
```

### UNAVAILABLE_POINTER_LOCK  `const`

```ts
const UNAVAILABLE_POINTER_LOCK: PointerLockPort;
```

### UNSET_CAMERA_POSE  `const`

```ts
const UNSET_CAMERA_POSE: CameraPoseSnapshot;
```

### UPSTREAM_STAGE_IDS  `const`

```ts
const UPSTREAM_STAGE_IDS: {
    readonly simPhysics: StageId;
};
```

### UiClick  `type`

```ts
type UiClick = {
    readonly button: MouseButton;
    readonly landing: ClickLanding;
};
```

### ViewOffset  `type`

```ts
type ViewOffset = {
    readonly right: number;
    readonly up: number;
    readonly rollRadians: number;
};
```

### WHEEL_DELTA_MODES  `const`

```ts
const WHEEL_DELTA_MODES: readonly ["pixel", "line", "page"];
```

### WHEEL_DELTA_MODE_BY_INDEX  `const`

```ts
const WHEEL_DELTA_MODE_BY_INDEX: ReadonlyArray<WheelDeltaMode>;
```

### WHEEL_LINES_PER_NOTCH  `const`

```ts
const WHEEL_LINES_PER_NOTCH = 3;
```

### WHEEL_PAGES_PER_NOTCH  `const`

```ts
const WHEEL_PAGES_PER_NOTCH = 1;
```

### WHEEL_PIXELS_PER_NOTCH  `const`

```ts
const WHEEL_PIXELS_PER_NOTCH = 100;
```

### WheelDeltaMode  `type`

```ts
type WheelDeltaMode = (typeof WHEEL_DELTA_MODES)[number];
```

### acquiresPointerLock  `const`

```ts
const acquiresPointerLock: (button: MouseButton, state: PointerLockState, landing: ClickLanding) => boolean;
```

### actionForKey  `const`

```ts
const actionForKey: (bindings: Bindings, key: InputCode) => InputAction | undefined;
```

### auditMaterials  `const`

```ts
const auditMaterials: (materials: ReadonlyArray<MaterialSpec>) => ReadonlyArray<{
    readonly material: MaterialSpec;
    readonly verdict: MaterialPolicyVerdict;
}>;
```

### bindingFor  `const`

```ts
const bindingFor: (bindings: Bindings, action: InputAction) => InputCode | undefined;
```

### browserInputLayer  `const`

```ts
const browserInputLayer: (options: BrowserInputOptions) => Layer.Layer<InputService>;
```

### buildPostProcessingChain  `const`

```ts
const buildPostProcessingChain: (quality: GraphicsQuality) => ReadonlyArray<PostProcessingStep>;
```

### chainEffects  `const`

```ts
const chainEffects: (chain: ReadonlyArray<PostProcessingStep>) => ReadonlyArray<PostProcessingPass>;
```

### chainPasses  `const`

```ts
const chainPasses: (chain: ReadonlyArray<PostProcessingStep>) => ReadonlyArray<PostProcessingPass>;
```

### codeForTouchAction  `const`

```ts
const codeForTouchAction: (bindings: Bindings, action: InputAction) => InputCode | undefined;
```

### defaultBindings  `const`

```ts
const defaultBindings: () => Bindings;
```

### describeMaterialPolicy  `const`

```ts
const describeMaterialPolicy: (material: MaterialSpec) => MaterialPolicyVerdict;
```

### forwardVector  `const`

```ts
const forwardVector: (snapshot: CameraPoseSnapshot) => Position;
```

### installInputListeners  `const`

```ts
const installInputListeners: (targets: BrowserInputTargets, input: InputServiceApi, focusGroups?: ReadonlyArray<FocusGroupTargets>, pointerLockTarget?: unknown, touchControls?: ReadonlyArray<TouchControlTarget>) => InstalledInputListeners;
```

### isCanonicalChain  `const`

```ts
const isCanonicalChain: (chain: ReadonlyArray<PostProcessingPass>) => boolean;
```

### isCompositeActive  `const`

```ts
const isCompositeActive: (quality: GraphicsQuality) => boolean;
```

### isCutout  `const`

```ts
const isCutout: (material: MaterialSpec) => boolean;
```

### isMirrorStale  `const`

```ts
const isMirrorStale: (state: MirroredCameraState, now: MonotonicTimeSecs) => boolean;
```

### isMouseButton  `const`

```ts
const isMouseButton: (code: InputCode) => code is MouseButton;
```

### isPointerLockHeld  `const`

```ts
const isPointerLockHeld: (document: DomDocument) => boolean;
```

### listenerOptionsFor  `const`

```ts
const listenerOptionsFor: (eventName: string) => DomListenerOptions;
```

### makeBrowserPointerLockPort  `const`

```ts
const makeBrowserPointerLockPort: (options: BrowserPointerLockOptions) => PointerLockPort;
```

### makeFrameScratch  `const`

```ts
const makeFrameScratch: () => FrameScratch;
```

### makeInputService  `const`

```ts
const makeInputService: (bindings?: Bindings, pointerLock?: PointerLockPort) => Effect.Effect<InputServiceApi>;
```

### makeRenderFrameState  `const`

```ts
const makeRenderFrameState: (quality?: GraphicsQuality) => Effect.Effect<RenderFrameState>;
```

### makeRenderStagesForPreview  `const`

```ts
const makeRenderStagesForPreview: (quality?: GraphicsQuality) => Effect.Effect<{
    readonly state: RenderFrameState;
    readonly stages: ReadonlyArray<StageRegistration>;
}, never, InputService>;
```

### makeScratchMap  `const`

```ts
const makeScratchMap: <K, V>(name: string, initialCapacity?: number) => ScratchMap<K, V>;
```

### mayPreventDefault  `const`

```ts
const mayPreventDefault: (eventName: string) => boolean;
```

### mirrorLagSecs  `const`

```ts
const mirrorLagSecs: (state: MirroredCameraState, now: MonotonicTimeSecs) => number;
```

### mirroredCameraState  `const`

```ts
const mirroredCameraState: (snapshot: CameraPoseSnapshot, offset?: ViewOffset) => MirroredCameraState;
```

### modalConsumedKeyReachesGameplay  `const`

```ts
const modalConsumedKeyReachesGameplay: (modalTarget: ListenerTarget, gameplayTarget: ListenerTarget, stoppedPropagation: boolean) => boolean;
```

### mouseButtonForIndex  `const`

```ts
const mouseButtonForIndex: (index: number) => MouseButton | undefined;
```

### notchesForWheelDelta  `const`

```ts
const notchesForWheelDelta: (deltaY: number, mode: WheelDeltaMode) => number;
```

### passOrderIndex  `const`

```ts
const passOrderIndex: (pass: PostProcessingPass) => number;
```

### remap  `const`

```ts
const remap: (bindings: Bindings, action: InputAction, key: InputCode) => RemapOutcome;
```

### renderModule  `const`

```ts
const renderModule: (quality?: GraphicsQuality, pointerLock?: PointerLockPort) => GameModule<InputService, never, never, InputService>;
```

### renderStages  `const`

```ts
const renderStages: (state: RenderFrameState, input: InputServiceApi) => ReadonlyArray<StageRegistration>;
```

### reportsKeyboardFocus  `const`

```ts
const reportsKeyboardFocus: (state: PointerLockState) => boolean;
```

### requiresForceSinglePass  `const`

```ts
const requiresForceSinglePass: (material: MaterialSpec) => boolean;
```

### resolveClickLanding  `const`

```ts
const resolveClickLanding: (pointerLockTarget: unknown, groups: ReadonlyArray<FocusGroupTargets>, target: unknown) => ClickLanding;
```

### resolveFocusTarget  `const`

```ts
const resolveFocusTarget: (groups: ReadonlyArray<FocusGroupTargets>, target: unknown) => FocusTarget | undefined;
```

### resolveTouchControl  `const`

```ts
const resolveTouchControl: (controls: ReadonlyArray<TouchControlTarget>, target: unknown) => InputAction | undefined;
```

### scopedInputListeners  `const`

```ts
const scopedInputListeners: (targets: BrowserInputTargets, input: InputServiceApi, focusGroups?: ReadonlyArray<FocusGroupTargets>, pointerLockTarget?: unknown, touchControls?: ReadonlyArray<TouchControlTarget>) => Effect.Effect<InstalledInputListeners, never, Scope.Scope>;
```

### snapshotAgeSecs  `const`

```ts
const snapshotAgeSecs: (snapshot: CameraPoseSnapshot, now: MonotonicTimeSecs) => number;
```

### snapshotScratch  `const`

```ts
const snapshotScratch: <K, V>(buffer: ReadonlyMap<K, V>) => ReadonlyMap<K, V>;
```

### suppressesBrowserContextMenu  `const`

```ts
const suppressesBrowserContextMenu: (pointerLocked: boolean) => boolean;
```

### suppressesBrowserScroll  `const`

```ts
const suppressesBrowserScroll: (pointerLocked: boolean) => boolean;
```

### takesTwoPassPath  `const`

```ts
const takesTwoPassPath: (material: MaterialSpec) => boolean;
```

### touchLookStep  `const`

```ts
const touchLookStep: (state: TouchLookState, phase: TouchLookPhase, point: TouchPoint) => TouchLookStep;
```

### translateDomEvent  `const`

```ts
const translateDomEvent: (planned: PlannedListener, event: DomInputEvent, context: DomEventContext) => InputEvent | undefined;
```

### unboundTouchActions  `const`

```ts
const unboundTouchActions: (bindings: Bindings, actions: ReadonlyArray<InputAction>) => ReadonlyArray<InputAction>;
```

### validatePostProcessingChain  `const`

```ts
const validatePostProcessingChain: (chain: ReadonlyArray<PostProcessingPass>) => ReadonlyArray<ChainViolation>;
```

### wheelDeltaModeForIndex  `const`

```ts
const wheelDeltaModeForIndex: (index: number) => WheelDeltaMode | undefined;
```

### withScratch  `const`

```ts
const withScratch: <K, V, A>(scratch: ScratchMap<K, V>, use: (buffer: Map<K, V>) => A) => A;
```

### wrapHotbarSelection  `const`

```ts
const wrapHotbarSelection: (current: number, steps: number, size: number) => number;
```

## Supporting declarations

Not exported from the barrel, but named by the signatures above, so a
consumer is exposed to them. `Context.Tag` service classes emit their real
type onto one of these.

### CameraPoseSnapshot  `type`

```ts
type CameraPoseSnapshot = {
    readonly position: Position;
    readonly yawRadians: number;
    readonly pitchRadians: number;
    readonly capturedAtSecs: MonotonicTimeSecs;
};
```

### ClockPort  `class`

```ts
class ClockPort extends ClockPort_base {
}
```

### ClockPort_base  `const`

```ts
const ClockPort_base: Context.TagClass<ClockPort, "@nerima-games/mc-kernel/ClockPort", ClockService>;
```

### ClockService  `type`

```ts
type ClockService = {
    readonly monotonicSecs: Effect.Effect<MonotonicTimeSecs>;
    readonly wallClockEpochMillis: Effect.Effect<EpochMillis>;
};
```

### DeltaTimeSecs  `const`

```ts
const DeltaTimeSecs: Brand.Brand.Constructor<DeltaTimeSecs>;
```

### DeltaTimeSecs  `type`

```ts
type DeltaTimeSecs = number & Brand.Brand<'DeltaTimeSecs'>;
```

### EpochMillis  `const`

```ts
const EpochMillis: Brand.Brand.Constructor<EpochMillis>;
```

### EpochMillis  `type`

```ts
type EpochMillis = number & Brand.Brand<'EpochMillis'>;
```

### FrameServices  `type`

```ts
type FrameServices = ClockPort;
```

### GameModule  `interface`

```ts
interface GameModule<ROut, E, RIn, RRegister = never> {
    readonly layers: Layer.Layer<ROut, E, RIn>;
    readonly frameStages: Effect.Effect<ReadonlyArray<StageRegistration>, never, RRegister>;
}
```

### InputService_base  `const`

```ts
const InputService_base: Context.TagClass<InputService, "@nerima-games/mc-render/InputService", InputServiceApi>;
```

### MonotonicTimeSecs  `const`

```ts
const MonotonicTimeSecs: Brand.Brand.Constructor<MonotonicTimeSecs>;
```

### MonotonicTimeSecs  `type`

```ts
type MonotonicTimeSecs = number & Brand.Brand<'MonotonicTimeSecs'>;
```

### Position  `type`

```ts
type Position = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
};
```

### StageId  `const`

```ts
const StageId: Brand.Brand.Constructor<StageId>;
```

### StageId  `type`

```ts
type StageId = string & Brand.Brand<'StageId'>;
```

### StageRegistration  `interface`

```ts
interface StageRegistration {
    readonly id: StageId;
    readonly after?: ReadonlyArray<StageId>;
    readonly run: (dt: DeltaTimeSecs) => Effect.Effect<void, never, FrameServices>;
}
```
