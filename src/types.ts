export enum GestureType {
	Palm = "palm",
	Fist = "fist",
	ThumbUp = "thumb_up",
	ThumbDown = "thumb_down",
	Victory = "victory",
	ILoveYou = "i_love_you",
	OK = "ok",
	Three = "three",
	Pointing = "pointing",
	Pinch = "pinch",
}

/** Gesture types that feed into the continuous (every-frame) pipeline */
export const CONTINUOUS_GESTURES: ReadonlySet<GestureType> = new Set([
	GestureType.Pointing,
	GestureType.Pinch,
]);

export interface GestureMapping {
	gesture: GestureType;
	commandId: string;
	enabled: boolean;
}

export interface ContinuousSettings {
	enabled: boolean;
	/** EMA smoothing alpha for cursor position (0–1, lower = smoother) */
	smoothingAlpha: number;
	/** Zoom sensitivity multiplier for two-hand distance */
	zoomSensitivity: number;
}

export interface ContinuousGestureEvent {
	type:
		| "mode_enter"
		| "mode_exit"
		| "cursors_move"
		| "zoom"
		| "mouse_down"
		| "mouse_up";
	/** Primary cursor (the hand that clicked) */
	x?: number;
	y?: number;
	/** Secondary cursor (the other hand) */
	x2?: number;
	y2?: number;
	/** Zoom delta (positive = zoom in, negative = zoom out) */
	zoomDelta?: number;
}

export type PreviewMode = "camera" | "skeleton" | "hidden";

export interface PreviewSettings {
	mode: PreviewMode;
	x: number;    // px from left (-1 = default bottom-right)
	y: number;    // px from top (-1 = default bottom-right)
	width: number; // preview width in px (default 320)
}

export interface GestureControlSettings {
	enabled: boolean;
	gestureMappings: GestureMapping[];
	dwellTime: number;
	cooldownTime: number;
	confidenceThreshold: number;
	continuous: ContinuousSettings;
	preview: PreviewSettings;
}

export const DEFAULT_CONTINUOUS_SETTINGS: ContinuousSettings = {
	enabled: true,
	smoothingAlpha: 0.15,
	zoomSensitivity: 15,
};

export const DEFAULT_PREVIEW_SETTINGS: PreviewSettings = {
	mode: "skeleton",
	x: -1,
	y: -1,
	width: 320,
};

/** Custom action IDs (prefix "gesture:" routes to SystemActionHandler) */
export const CUSTOM_ACTIONS = [
	{ id: "gesture:dictation-toggle", name: "Dictation (macOS)", icon: "\uD83C\uDF99\uFE0F" },
	{ id: "gesture:mic-toggle", name: "Mic Toggle (macOS)", icon: "\uD83D\uDD08" },
	{ id: "gesture:mic-mute", name: "Mic Mute (macOS)", icon: "\uD83D\uDD07" },
	{ id: "gesture:mic-unmute", name: "Mic Unmute (macOS)", icon: "\uD83D\uDD0A" },
] as const;

export const CUSTOM_ACTION_PREFIX = "gesture:";

export const DEFAULT_SETTINGS: GestureControlSettings = {
	enabled: false,
	gestureMappings: [
		{ gesture: GestureType.Palm, commandId: "app:toggle-left-sidebar", enabled: true },
		{ gesture: GestureType.Fist, commandId: "app:go-back", enabled: true },
		{ gesture: GestureType.ThumbUp, commandId: "gesture:dictation-toggle", enabled: true },
		{ gesture: GestureType.Victory, commandId: "file-explorer:new-file", enabled: true },
		{ gesture: GestureType.ILoveYou, commandId: "command-palette:open", enabled: true },
		{ gesture: GestureType.OK, commandId: "", enabled: false },
		{ gesture: GestureType.ThumbDown, commandId: "", enabled: false },
		{ gesture: GestureType.Three, commandId: "", enabled: false },
	],
	dwellTime: 500,
	cooldownTime: 1000,
	confidenceThreshold: 0.7,
	continuous: { ...DEFAULT_CONTINUOUS_SETTINGS },
	preview: { ...DEFAULT_PREVIEW_SETTINGS },
};
