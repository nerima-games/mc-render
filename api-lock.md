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
exported declarations: 329
supporting declarations: 19

## Exported

### AO_LEVELS  `const`

```ts
const AO_LEVELS: number;
```

### AO_MAX  `const`

```ts
const AO_MAX: number;
```

### AO_ONLY_SHADE  `const`

```ts
const AO_ONLY_SHADE: QuadShade;
```

### AO_SHADE_BY_LEVEL  `const`

```ts
const AO_SHADE_BY_LEVEL: ReadonlyArray<number>;
```

### AO_SHADE_FLOOR  `const`

```ts
const AO_SHADE_FLOOR = 0.8;
```

### AO_SHADE_RANGE  `const`

```ts
const AO_SHADE_RANGE = 0.2;
```

### ATLAS_COLUMNS  `const`

```ts
const ATLAS_COLUMNS = 16;
```

### ATLAS_PIXELS  `const`

```ts
const ATLAS_PIXELS = 512;
```

### ATLAS_TILE_COUNT  `const`

```ts
const ATLAS_TILE_COUNT: number;
```

### BEHIND_NEAR_PLANE_RATIO  `const`

```ts
const BEHIND_NEAR_PLANE_RATIO = 1;
```

### Bindings  `type`

```ts
type Bindings = Readonly<Record<string, InputCode>>;
```

### BlockNameLookup  `type`

```ts
type BlockNameLookup = (blockId: number) => string;
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

### CAMERA_FAR_PLANE  `const`

```ts
const CAMERA_FAR_PLANE = 300;
```

### CAMERA_FOV_DEGREES  `const`

```ts
const CAMERA_FOV_DEGREES = 75;
```

### CAMERA_NEAR_PLANE  `const`

```ts
const CAMERA_NEAR_PLANE = 0.1;
```

### CLICK_LANDINGS  `const`

```ts
const CLICK_LANDINGS: readonly ["lock-target", "ui", "elsewhere"];
```

### COLOR_COMPONENTS  `const`

```ts
const COLOR_COMPONENTS = 3;
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

### ChunkGeometryBuffers  `type`

```ts
type ChunkGeometryBuffers = {
    readonly positions: Float32Array;
    readonly normals: Float32Array;
    readonly colors: Uint8Array;
    readonly uvs: Float32Array;
    readonly indices: Uint32Array;
    readonly quadCount: number;
    readonly vertexCount: number;
    readonly indexCount: number;
};
```

### ChunkKey  `type`

```ts
type ChunkKey = string;
```

### ChunkXZ  `type`

```ts
type ChunkXZ = {
    readonly chunkX: number;
    readonly chunkZ: number;
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

### DEFAULT_BURST_PARTICLES  `const`

```ts
const DEFAULT_BURST_PARTICLES = 6;
```

### DEFAULT_PARTICLE_SEED  `const`

```ts
const DEFAULT_PARTICLE_SEED = 20260728;
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

### DrawPort  `type`

```ts
type DrawPort = {
    readonly draw: (camera: MirroredCameraState) => Effect.Effect<void>;
    readonly resize: (width: number, height: number) => Effect.Effect<void>;
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

### FACE_BRIGHTNESS  `const`

```ts
const FACE_BRIGHTNESS: Readonly<Record<FaceDirection, number>>;
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

### FULLY_LIT  `const`

```ts
const FULLY_LIT: LightSampler;
```

### FULL_LIGHT  `const`

```ts
const FULL_LIGHT: SkyBlockLight;
```

### FaceDirection  `type`

```ts
type FaceDirection = 'xPos' | 'xNeg' | 'yPos' | 'yNeg' | 'zPos' | 'zNeg';
```

### FaceRole  `type`

```ts
type FaceRole = 'top' | 'bottom' | 'side';
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

### HALF_TEXEL_UV  `const`

```ts
const HALF_TEXEL_UV: number;
```

### HOTBAR_FOCUS_GROUP  `const`

```ts
const HOTBAR_FOCUS_GROUP = "hotbar";
```

### INDICES_PER_QUAD  `const`

```ts
const INDICES_PER_QUAD = 6;
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

### LIGHT_SHADE_FLOOR  `const`

```ts
const LIGHT_SHADE_FLOOR = 0.45;
```

### LIGHT_SHADE_RANGE  `const`

```ts
const LIGHT_SHADE_RANGE = 0.55;
```

### LISTENER_PLAN  `const`

```ts
const LISTENER_PLAN: ReadonlyArray<{
    readonly event: string;
    readonly target: ListenerTarget;
    readonly note: string;
}>;
```

### LOD1_DISTANCE_CHUNKS  `const`

```ts
const LOD1_DISTANCE_CHUNKS = 4;
```

### LOD2_DISTANCE_CHUNKS  `const`

```ts
const LOD2_DISTANCE_CHUNKS = 8;
```

### LightSampler  `type`

```ts
type LightSampler = (x: number, y: number, z: number) => SkyBlockLight;
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

### LodThresholds  `type`

```ts
type LodThresholds = {
    readonly lod1: number;
    readonly lod2: number;
};
```

### LodTierCensus  `type`

```ts
type LodTierCensus = Readonly<Record<LodLevel, number>>;
```

### MANDATORY_PASSES  `const`

```ts
const MANDATORY_PASSES: ReadonlySet<PostProcessingPass>;
```

### MAX_PARTICLE_STEP_SECS  `const`

```ts
const MAX_PARTICLE_STEP_SECS = 0.1;
```

### MAX_RIPPLE_OFFSET_UV  `const`

```ts
const MAX_RIPPLE_OFFSET_UV: number;
```

### MAX_SHADE_BYTE  `const`

```ts
const MAX_SHADE_BYTE = 255;
```

### MAX_SHADE_FACTOR  `const`

```ts
const MAX_SHADE_FACTOR = 1;
```

### MIRROR_LAG_WARNING_SECS  `const`

```ts
const MIRROR_LAG_WARNING_SECS = 0.1;
```

### MISSING_TILE  `const`

```ts
const MISSING_TILE = 0;
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

### MeshQuad  `type`

```ts
type MeshQuad = {
    readonly blockId: number;
    readonly direction: FaceDirection;
    readonly role: FaceRole;
    readonly lx: number;
    readonly y: number;
    readonly lz: number;
    readonly width: number;
    readonly height: number;
    readonly ao: number;
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

### NDC_VIEWPORT_AREA  `const`

```ts
const NDC_VIEWPORT_AREA = 4;
```

### NORMAL_COMPONENTS  `const`

```ts
const NORMAL_COMPONENTS = 3;
```

### NO_DRAW_TARGET  `const`

```ts
const NO_DRAW_TARGET: DrawPort;
```

### NO_LIGHT  `const`

```ts
const NO_LIGHT: SkyBlockLight;
```

### NO_VIEW_OFFSET  `const`

```ts
const NO_VIEW_OFFSET: ViewOffset;
```

### OWN_STAGE_PREFIX  `const`

```ts
const OWN_STAGE_PREFIX = "render:";
```

### PARTICLE_GRAVITY_M_PER_S2  `const`

```ts
const PARTICLE_GRAVITY_M_PER_S2 = 12;
```

### PARTICLE_LIFETIME_SECS  `const`

```ts
const PARTICLE_LIFETIME_SECS = 0.5;
```

### PARTICLE_MATERIAL_SPEC  `const`

```ts
const PARTICLE_MATERIAL_SPEC: MaterialSpec;
```

### PARTICLE_POOL_CAPACITY  `const`

```ts
const PARTICLE_POOL_CAPACITY = 512;
```

### PARTICLE_QUAD_SIZE_M  `const`

```ts
const PARTICLE_QUAD_SIZE_M = 0.1;
```

### PARTICLE_SPREAD_DOWN_M_PER_S  `const`

```ts
const PARTICLE_SPREAD_DOWN_M_PER_S = 0.5;
```

### PARTICLE_SPREAD_HORIZONTAL_M_PER_S  `const`

```ts
const PARTICLE_SPREAD_HORIZONTAL_M_PER_S = 2;
```

### PARTICLE_SPREAD_UP_M_PER_S  `const`

```ts
const PARTICLE_SPREAD_UP_M_PER_S = 3;
```

### PARTICLE_UV_SPAN  `const`

```ts
const PARTICLE_UV_SPAN: number;
```

### PARTICLE_UV_STRIDE  `const`

```ts
const PARTICLE_UV_STRIDE = 2;
```

### PARTICLE_VECTOR_STRIDE  `const`

```ts
const PARTICLE_VECTOR_STRIDE = 3;
```

### PARTICLE_WRITES_DEPTH  `const`

```ts
const PARTICLE_WRITES_DEPTH = false;
```

### PER_FRAME_WATER_UNIFORMS  `const`

```ts
const PER_FRAME_WATER_UNIFORMS: ReadonlyArray<WaterUniformName>;
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

### POSITION_COMPONENTS  `const`

```ts
const POSITION_COMPONENTS = 3;
```

### POST_PROCESSING_PASS_ORDER  `const`

```ts
const POST_PROCESSING_PASS_ORDER: readonly ["render", "gtao", "godRays", "bloom", "bokeh", "composite", "smaa", "output"];
```

### PREVENT_DEFAULT_EVENTS  `const`

```ts
const PREVENT_DEFAULT_EVENTS: ReadonlyArray<string>;
```

### ParticlePool  `type`

```ts
type ParticlePool = {
    readonly capacity: number;
    readonly positions: Float32Array;
    readonly velocities: Float32Array;
    readonly lifetimesSecs: Float32Array;
    readonly scales: Float32Array;
    readonly uvOffsets: Float32Array;
    readonly activeCount: () => number;
    readonly seed: () => number;
    readonly evictionCount: () => number;
};
```

### ParticlePoolOptions  `type`

```ts
type ParticlePoolOptions = {
    readonly capacity?: number;
    readonly seed?: number;
};
```

### ParticleSlotState  `type`

```ts
type ParticleSlotState = {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly velocityX: number;
    readonly velocityY: number;
    readonly velocityZ: number;
    readonly remainingSecs: number;
    readonly scale: number;
    readonly uvU: number;
    readonly uvV: number;
};
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

### QuadAxis  `type`

```ts
type QuadAxis = 'x' | 'y' | 'z';
```

### QuadCorners  `type`

```ts
type QuadCorners = readonly [QuadVertex, QuadVertex, QuadVertex, QuadVertex];
```

### QuadShade  `type`

```ts
type QuadShade = (quad: MeshQuad) => number;
```

### QuadVertex  `type`

```ts
type QuadVertex = readonly [number, number, number];
```

### QualityPreset  `type`

```ts
type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';
```

### REFERENCE_LOD_THRESHOLDS  `const`

```ts
const REFERENCE_LOD_THRESHOLDS: LodThresholds;
```

### REFERENCE_REFRACTION_GATE_ORDER  `const`

```ts
const REFERENCE_REFRACTION_GATE_ORDER: ReadonlyArray<RefractionGate>;
```

### REFERENCE_VIEWING_CONDITIONS  `const`

```ts
const REFERENCE_VIEWING_CONDITIONS: ViewingConditions;
```

### REFRACTION_GATE_ORDER  `const`

```ts
const REFRACTION_GATE_ORDER: ReadonlyArray<RefractionGate>;
```

### REFRACTION_INTERVAL_FRAMES  `const`

```ts
const REFRACTION_INTERVAL_FRAMES: Readonly<Record<QualityPreset, number>>;
```

### REFRACTION_MIN_SCREEN_RATIO  `const`

```ts
const REFRACTION_MIN_SCREEN_RATIO: Readonly<Record<QualityPreset, number>>;
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

### RIPPLE_AMPLITUDE_UV  `const`

```ts
const RIPPLE_AMPLITUDE_UV = 0.014;
```

### RIPPLE_LAYERS_U  `const`

```ts
const RIPPLE_LAYERS_U: ReadonlyArray<RippleLayer>;
```

### RIPPLE_LAYERS_V  `const`

```ts
const RIPPLE_LAYERS_V: ReadonlyArray<RippleLayer>;
```

### RefractionCameraKey  `type`

```ts
type RefractionCameraKey = {
    readonly sceneVersion: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly qx: number;
    readonly qy: number;
    readonly qz: number;
    readonly qw: number;
    readonly projection0: number;
    readonly projection5: number;
    readonly projection10: number;
    readonly projection14: number;
};
```

### RefractionDecision  `type`

```ts
type RefractionDecision = 'run' | `skip:${RefractionGate}`;
```

### RefractionGate  `type`

```ts
type RefractionGate = 'interval-disabled' | 'not-this-frame' | 'no-water-meshes' | 'no-visible-water' | 'camera-and-scene-unchanged' | 'below-screen-ratio';
```

### RefractionInputs  `type`

```ts
type RefractionInputs = {
    readonly intervalFrames: number;
    readonly frameNumber: number;
    readonly waterMeshCount: number;
    readonly visibleWaterMeshCount: number;
    readonly waterScreenRatio: number;
    readonly minScreenRatio: number;
    readonly cameraKey: RefractionCameraKey;
    readonly lastRenderedKey: RefractionCameraKey | undefined;
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

### RippleLayer  `type`

```ts
type RippleLayer = {
    readonly spatialFrequency: number;
    readonly temporalSpeed: number;
    readonly amplitudeScale: number;
};
```

### RippleOffset  `type`

```ts
type RippleOffset = {
    readonly u: number;
    readonly v: number;
};
```

### SKY_CLEAR_ALPHA  `const`

```ts
const SKY_CLEAR_ALPHA = 1;
```

### SKY_CLEAR_COLOR  `const`

```ts
const SKY_CLEAR_COLOR = 8900331;
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

### ShadingOptions  `type`

```ts
type ShadingOptions = {
    readonly skyIntensity?: number;
};
```

### SkyBlockLight  `type`

```ts
type SkyBlockLight = {
    readonly sky: number;
    readonly block: number;
};
```

### TILE_BY_BLOCK_NAME  `const`

```ts
const TILE_BY_BLOCK_NAME: Readonly<Record<string, TileAssignment>>;
```

### TILE_PIXELS  `const`

```ts
const TILE_PIXELS: number;
```

### TILE_UV_PITCH  `const`

```ts
const TILE_UV_PITCH: number;
```

### TILE_UV_SPAN  `const`

```ts
const TILE_UV_SPAN: number;
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

### ThreeBufferAttribute  `type`

```ts
type ThreeBufferAttribute = Record<never, never>;
```

### ThreeBufferGeometry  `type`

```ts
type ThreeBufferGeometry = {
    setAttribute(name: string, attribute: ThreeBufferAttribute): unknown;
    setIndex(index: ThreeBufferAttribute | null): unknown;
    readonly computeBoundingSphere: () => void;
    readonly dispose: () => void;
};
```

### ThreeCamera  `type`

```ts
type ThreeCamera = {
    readonly position: ThreeVector3;
    readonly rotation: ThreeEuler;
};
```

### ThreeEuler  `type`

```ts
type ThreeEuler = {
    set(x: number, y: number, z: number, order: 'YXZ'): unknown;
};
```

### ThreeMaterial  `type`

```ts
type ThreeMaterial = {
    readonly dispose: () => void;
};
```

### ThreeMesh  `type`

```ts
type ThreeMesh = {
    frustumCulled: boolean;
};
```

### ThreePerspectiveCamera  `type`

```ts
type ThreePerspectiveCamera = ThreeCamera & {
    aspect: number;
    readonly updateProjectionMatrix: () => void;
};
```

### ThreeRendererParameters  `type`

```ts
type ThreeRendererParameters<TCanvas> = {
    readonly canvas: TCanvas;
    readonly antialias: boolean;
    readonly stencil: boolean;
    readonly powerPreference: 'high-performance';
    readonly failIfMajorPerformanceCaveat: boolean;
};
```

### ThreeScene  `type`

```ts
type ThreeScene = {
    add(object: ThreeMesh): unknown;
    remove(object: ThreeMesh): unknown;
};
```

### ThreeSurface  `type`

```ts
type ThreeSurface<TCanvas, TGeometry extends ThreeBufferGeometry, TMaterial extends ThreeMaterial> = {
    readonly WebGLRenderer: new (parameters: ThreeRendererParameters<TCanvas>) => ThreeWebGLRenderer;
    readonly Scene: new () => ThreeScene;
    readonly PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => ThreePerspectiveCamera;
    readonly BufferGeometry: new () => TGeometry;
    readonly BufferAttribute: new (array: Float32Array | Uint8Array | Uint32Array, itemSize: number, normalized: boolean) => ThreeBufferAttribute;
    readonly Mesh: new (geometry: TGeometry, material: TMaterial) => ThreeMesh;
    readonly MeshBasicMaterial: new (parameters: {
        readonly vertexColors: boolean;
        readonly wireframe: boolean;
    }) => TMaterial;
};
```

### ThreeVector3  `type`

```ts
type ThreeVector3 = {
    set(x: number, y: number, z: number): unknown;
};
```

### ThreeWebGLRenderer  `type`

```ts
type ThreeWebGLRenderer = {
    render(scene: ThreeScene, camera: ThreeCamera): unknown;
    readonly setSize: (width: number, height: number, updateStyle: boolean) => unknown;
    readonly setClearColor: (color: number, alpha: number) => unknown;
    readonly dispose: () => void;
};
```

### TileAssignment  `type`

```ts
type TileAssignment = Readonly<Record<FaceRole, number>>;
```

### TileUvBounds  `type`

```ts
type TileUvBounds = {
    readonly u0: number;
    readonly v0: number;
    readonly u1: number;
    readonly v1: number;
};
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

### UV_COMPONENTS  `const`

```ts
const UV_COMPONENTS = 2;
```

### UiClick  `type`

```ts
type UiClick = {
    readonly button: MouseButton;
    readonly landing: ClickLanding;
};
```

### UvOrigin  `type`

```ts
type UvOrigin = {
    readonly u: number;
    readonly v: number;
};
```

### VERTICES_PER_QUAD  `const`

```ts
const VERTICES_PER_QUAD = 4;
```

### ViewOffset  `type`

```ts
type ViewOffset = {
    readonly right: number;
    readonly up: number;
    readonly rollRadians: number;
};
```

### ViewingConditions  `type`

```ts
type ViewingConditions = {
    readonly viewportHeightPixels: number;
    readonly verticalFovDegrees: number;
};
```

### Viewport  `type`

```ts
type Viewport = {
    readonly width: number;
    readonly height: number;
};
```

### WATER_DEEP_COLOR  `const`

```ts
const WATER_DEEP_COLOR: WaterColor;
```

### WATER_FRESNEL_F0  `const`

```ts
const WATER_FRESNEL_F0 = 0.02;
```

### WATER_INDEX_OF_REFRACTION  `const`

```ts
const WATER_INDEX_OF_REFRACTION = 1.333;
```

### WATER_MATERIAL_SPEC  `const`

```ts
const WATER_MATERIAL_SPEC: MaterialSpec;
```

### WATER_SHALLOW_COLOR  `const`

```ts
const WATER_SHALLOW_COLOR: WaterColor;
```

### WATER_SURFACE_ALPHA  `const`

```ts
const WATER_SURFACE_ALPHA = 0.86;
```

### WATER_SURFACE_IS_FLAT  `const`

```ts
const WATER_SURFACE_IS_FLAT = true;
```

### WATER_UNIFORM_NAMES  `const`

```ts
const WATER_UNIFORM_NAMES: ReadonlyArray<WaterUniformName>;
```

### WATER_WRITES_DEPTH  `const`

```ts
const WATER_WRITES_DEPTH = false;
```

### WAVE_APPROX_MAX_ERROR  `const`

```ts
const WAVE_APPROX_MAX_ERROR = 0.0561;
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

### WaterColor  `type`

```ts
type WaterColor = {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
};
```

### WaterUniformName  `type`

```ts
type WaterUniformName = 'uTime' | 'uRefractionMap' | 'uCameraPosition' | 'uResolution' | 'uRefractionValid' | 'uSunIntensity';
```

### WheelDeltaMode  `type`

```ts
type WheelDeltaMode = (typeof WHEEL_DELTA_MODES)[number];
```

### WorldRenderer  `type`

```ts
type WorldRenderer = DrawPort & {
    readonly setChunk: (key: ChunkKey, buffers: ChunkGeometryBuffers) => Effect.Effect<void>;
    readonly removeChunk: (key: ChunkKey) => Effect.Effect<void>;
    readonly chunkKeys: Effect.Effect<ReadonlyArray<ChunkKey>>;
    readonly framesRendered: Effect.Effect<number>;
    readonly dispose: Effect.Effect<void>;
};
```

### WorldRendererOptions  `type`

```ts
type WorldRendererOptions = {
    readonly fovDegrees?: number;
    readonly nearPlane?: number;
    readonly farPlane?: number;
    readonly clearColor?: number;
    readonly wireframe?: boolean;
};
```

### acquiresPointerLock  `const`

```ts
const acquiresPointerLock: (button: MouseButton, state: PointerLockState, landing: ClickLanding) => boolean;
```

### actionForKey  `const`

```ts
const actionForKey: (bindings: Bindings, key: InputCode) => InputAction | undefined;
```

### advanceParticles  `const`

```ts
const advanceParticles: (pool: ParticlePool, dtSecs: number) => number;
```

### aoShade  `const`

```ts
const aoShade: (level: number) => number;
```

### aoShadeFactor  `const`

```ts
const aoShadeFactor: (aoLevel: number) => number;
```

### atlasLayoutViolations  `const`

```ts
const atlasLayoutViolations: () => ReadonlyArray<string>;
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

### buildChunkGeometry  `const`

```ts
const buildChunkGeometry: (quads: ReadonlyArray<MeshQuad>, originX?: number, originZ?: number, shade?: QuadShade) => ChunkGeometryBuffers;
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

### chunkDistance  `const`

```ts
const chunkDistance: (from: ChunkXZ, to: ChunkXZ) => number;
```

### clampSunIntensity  `const`

```ts
const clampSunIntensity: (sunIntensity: number) => number;
```

### clearParticles  `const`

```ts
const clearParticles: (pool: ParticlePool) => void;
```

### codeForTouchAction  `const`

```ts
const codeForTouchAction: (bindings: Bindings, action: InputAction) => InputCode | undefined;
```

### combinedShadeByte  `const`

```ts
const combinedShadeByte: (light: SkyBlockLight, aoLevel: number, skyIntensity: number, direction?: FaceDirection) => number;
```

### combinedShadeFactor  `const`

```ts
const combinedShadeFactor: (light: SkyBlockLight, aoLevel: number, skyIntensity: number, direction?: FaceDirection) => number;
```

### decideRefractionPrePass  `const`

```ts
const decideRefractionPrePass: (inputs: RefractionInputs, order?: ReadonlyArray<RefractionGate>) => RefractionDecision;
```

### defaultBindings  `const`

```ts
const defaultBindings: () => Bindings;
```

### describeMaterialPolicy  `const`

```ts
const describeMaterialPolicy: (material: MaterialSpec) => MaterialPolicyVerdict;
```

### describeRefractionDecision  `const`

```ts
const describeRefractionDecision: (decision: RefractionDecision) => string;
```

### distanceForScreenErrorPixels  `const`

```ts
const distanceForScreenErrorPixels: (level: LodLevel, errorPixels: number, view: ViewingConditions) => number;
```

### effectiveLightLevel  `const`

```ts
const effectiveLightLevel: (light: SkyBlockLight, skyIntensity: number) => number;
```

### evictionOrderIsSpawnOrder  `const`

```ts
const evictionOrderIsSpawnOrder = true;
```

### faceBrightness  `const`

```ts
const faceBrightness: (direction: FaceDirection) => number;
```

### faceNormal  `const`

```ts
const faceNormal: (direction: FaceDirection) => QuadVertex;
```

### forwardVector  `const`

```ts
const forwardVector: (snapshot: CameraPoseSnapshot) => Position;
```

### fresnelF0ForIor  `const`

```ts
const fresnelF0ForIor: (ior: number) => number;
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

### isRefractionSkipped  `const`

```ts
const isRefractionSkipped: (decision: RefractionDecision) => boolean;
```

### isSlotActive  `const`

```ts
const isSlotActive: (pool: ParticlePool, slot: number) => boolean;
```

### isTileIndex  `const`

```ts
const isTileIndex: (tileIndex: number) => boolean;
```

### lightSamplePoint  `const`

```ts
const lightSamplePoint: (quad: {
    readonly lx: number;
    readonly y: number;
    readonly lz: number;
}, normal: readonly [number, number, number]) => readonly [number, number, number];
```

### lightShadeFactor  `const`

```ts
const lightShadeFactor: (level: number) => number;
```

### listenerOptionsFor  `const`

```ts
const listenerOptionsFor: (eventName: string) => DomListenerOptions;
```

### litShade  `const`

```ts
const litShade: (sampler: LightSampler, options?: ShadingOptions) => QuadShade;
```

### lodForDistance  `const`

```ts
const lodForDistance: (distanceChunks: number, thresholds: LodThresholds) => LodLevel;
```

### lodScreenErrorPixels  `const`

```ts
const lodScreenErrorPixels: (level: LodLevel, distanceChunks: number, view: ViewingConditions) => number;
```

### lodThresholdsForRenderDistance  `const`

```ts
const lodThresholdsForRenderDistance: (renderDistance: number) => LodThresholds;
```

### lodTierCensus  `const`

```ts
const lodTierCensus: (renderDistance: number, thresholds: LodThresholds) => LodTierCensus;
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

### makeParticlePool  `const`

```ts
const makeParticlePool: (options?: ParticlePoolOptions) => ParticlePool;
```

### makeRenderFrameState  `const`

```ts
const makeRenderFrameState: (quality?: GraphicsQuality) => Effect.Effect<RenderFrameState>;
```

### makeRenderStagesForPreview  `const`

```ts
const makeRenderStagesForPreview: (quality?: GraphicsQuality, draw?: DrawPort) => Effect.Effect<{
    readonly state: RenderFrameState;
    readonly stages: ReadonlyArray<StageRegistration>;
}, never, InputService>;
```

### makeScratchMap  `const`

```ts
const makeScratchMap: <K, V>(name: string, initialCapacity?: number) => ScratchMap<K, V>;
```

### makeWorldRenderer  `const`

```ts
const makeWorldRenderer: <TCanvas, TGeometry extends ThreeBufferGeometry, TMaterial extends ThreeMaterial>(three: ThreeSurface<TCanvas, TGeometry, TMaterial>, canvas: TCanvas, viewport: Viewport, options?: WorldRendererOptions) => Effect.Effect<WorldRenderer>;
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

### mixWaterColor  `const`

```ts
const mixWaterColor: (from: WaterColor, to: WaterColor, t: number) => WaterColor;
```

### modalConsumedKeyReachesGameplay  `const`

```ts
const modalConsumedKeyReachesGameplay: (modalTarget: ListenerTarget, gameplayTarget: ListenerTarget, stoppedPropagation: boolean) => boolean;
```

### mouseButtonForIndex  `const`

```ts
const mouseButtonForIndex: (index: number) => MouseButton | undefined;
```

### normaliseTileIndex  `const`

```ts
const normaliseTileIndex: (tileIndex: number) => number;
```

### notchesForWheelDelta  `const`

```ts
const notchesForWheelDelta: (deltaY: number, mode: WheelDeltaMode) => number;
```

### passOrderIndex  `const`

```ts
const passOrderIndex: (pass: PostProcessingPass) => number;
```

### quadCorners  `const`

```ts
const quadCorners: (quad: MeshQuad, originX: number, originZ: number) => QuadCorners;
```

### quadUvExtent  `const`

```ts
const quadUvExtent: (quad: MeshQuad) => readonly [number, number];
```

### readSlot  `const`

```ts
const readSlot: (pool: ParticlePool, slot: number) => ParticleSlotState | undefined;
```

### referencedTileIndices  `const`

```ts
const referencedTileIndices: () => ReadonlyArray<number>;
```

### refractionRunsOnFrame  `const`

```ts
const refractionRunsOnFrame: (intervalFrames: number, frameNumber: number) => boolean;
```

### remap  `const`

```ts
const remap: (bindings: Bindings, action: InputAction, key: InputCode) => RemapOutcome;
```

### renderModule  `const`

```ts
const renderModule: (quality?: GraphicsQuality, pointerLock?: PointerLockPort, draw?: DrawPort) => GameModule<InputService, never, never, InputService>;
```

### renderStages  `const`

```ts
const renderStages: (state: RenderFrameState, input: InputServiceApi, draw?: DrawPort) => ReadonlyArray<StageRegistration>;
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

### rippleOffset  `const`

```ts
const rippleOffset: (worldX: number, worldZ: number, timeSecs: number) => RippleOffset;
```

### sameRefractionKey  `const`

```ts
const sameRefractionKey: (a: RefractionCameraKey, b: RefractionCameraKey) => boolean;
```

### schlickFresnel  `const`

```ts
const schlickFresnel: (cosTheta: number) => number;
```

### scopedInputListeners  `const`

```ts
const scopedInputListeners: (targets: BrowserInputTargets, input: InputServiceApi, focusGroups?: ReadonlyArray<FocusGroupTargets>, pointerLockTarget?: unknown, touchControls?: ReadonlyArray<TouchControlTarget>) => Effect.Effect<InstalledInputListeners, never, Scope.Scope>;
```

### screenRatioForNdcRect  `const`

```ts
const screenRatioForNdcRect: (minX: number, minY: number, maxX: number, maxY: number) => number;
```

### snapshotAgeSecs  `const`

```ts
const snapshotAgeSecs: (snapshot: CameraPoseSnapshot, now: MonotonicTimeSecs) => number;
```

### snapshotScratch  `const`

```ts
const snapshotScratch: <K, V>(buffer: ReadonlyMap<K, V>) => ReadonlyMap<K, V>;
```

### spawnBlockBurst  `const`

```ts
const spawnBlockBurst: (pool: ParticlePool, x: number, y: number, z: number, tileIndex: number, count?: number) => number;
```

### spawnBurst  `const`

```ts
const spawnBurst: (pool: ParticlePool, x: number, y: number, z: number, uvU: number, uvV: number, count?: number) => number;
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

### tangentAxes  `const`

```ts
const tangentAxes: (direction: FaceDirection) => readonly [QuadAxis, QuadAxis];
```

### tileColumn  `const`

```ts
const tileColumn: (tileIndex: number) => number;
```

### tileIndexForBlockName  `const`

```ts
const tileIndexForBlockName: (blockName: string, role: FaceRole) => number;
```

### tileIndexForUvOrigin  `const`

```ts
const tileIndexForUvOrigin: (origin: UvOrigin) => number;
```

### tileIndexResolver  `const`

```ts
const tileIndexResolver: (blockNameOf: BlockNameLookup) => (blockId: number, role: FaceRole) => number;
```

### tileRow  `const`

```ts
const tileRow: (tileIndex: number) => number;
```

### tileUvBounds  `const`

```ts
const tileUvBounds: (tileIndex: number) => TileUvBounds;
```

### tileUvOrigin  `const`

```ts
const tileUvOrigin: (tileIndex: number) => UvOrigin;
```

### totalQuadArea  `const`

```ts
const totalQuadArea: (quads: ReadonlyArray<MeshQuad>) => number;
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

### unreachableLodTiers  `const`

```ts
const unreachableLodTiers: (renderDistance: number, thresholds: LodThresholds) => ReadonlyArray<LodLevel>;
```

### uvPatchStaysInsideTile  `const`

```ts
const uvPatchStaysInsideTile: (span: number) => boolean;
```

### validatePostProcessingChain  `const`

```ts
const validatePostProcessingChain: (chain: ReadonlyArray<PostProcessingPass>) => ReadonlyArray<ChainViolation>;
```

### waterDepthFactor  `const`

```ts
const waterDepthFactor: (fresnel: number) => number;
```

### waterForceSinglePassVerdict  `const`

```ts
const waterForceSinglePassVerdict: () => MaterialPolicyVerdict;
```

### waterSunAttenuation  `const`

```ts
const waterSunAttenuation: (sunIntensity: number) => number;
```

### waterTint  `const`

```ts
const waterTint: (fresnel: number) => WaterColor;
```

### waveApprox  `const`

```ts
const waveApprox: (x: number) => number;
```

### waveApproxCos  `const`

```ts
const waveApproxCos: (x: number) => number;
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

### LOD_LEVELS  `const`

```ts
const LOD_LEVELS: readonly [0, 1, 2];
```

### LodLevel  `type`

```ts
type LodLevel = (typeof LOD_LEVELS)[number];
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
