import { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { ContinuousSettings, ContinuousGestureEvent, DEFAULT_CONTINUOUS_SETTINGS } from "../types";

/**
 * Two-phase continuous gesture processor.
 *
 * Phase 1 — ZOOM: Both hands pointing (index only) → zoom with distance
 * Phase 2 — CURSOR: One hand removed → remaining hand controls cursor
 *           Thumb extend → mousedown (click / drag start)
 *           Thumb retract → mouseup (release)
 *           Second hand reappears → back to ZOOM
 *
 * Entry: both hands Pointing detected
 * Exit: remaining hand changes to non-Pointing, or no hands
 */

export type ContinuousMode = "inactive" | "zooming" | "cursor" | "clicking";

export type OnContinuousEvent = (event: ContinuousGestureEvent) => void;

const INDEX_TIP = 8;

const ZONE_MIN = 0.12;
const ZONE_MAX = 0.88;

function dist2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
	return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function zoneMap(value: number, min: number, max: number): number {
	return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

export class ContinuousGestureProcessor {
	private mode: ContinuousMode = "inactive";
	private settings: ContinuousSettings;
	private onEvent: OnContinuousEvent | null = null;

	// Zoom: two dots
	private smooth0X = 0; private smooth0Y = 0;
	private smooth1X = 0; private smooth1Y = 0;
	private prevIndexDist = 0;

	// Cursor: one dot (reuses smooth0X/Y)
	private hasInitial = false;

	// Click/drag separation
	private thumbDown = false;       // mousedown actually sent (drag mode)
	private thumbConfirmed = false;  // thumb extension confirmed (past debounce)
	private thumbOnFrames = 0;       // consecutive frames with thumb extended
	private thumbOffFrames = 0;      // consecutive frames with thumb retracted
	private thumbHoldFrames = 0;     // frames since thumb confirmed (for click vs drag)
	private static readonly THUMB_DEBOUNCE = 2;      // frames to confirm thumb extend/click release
	private static readonly DRAG_THRESHOLD = 8;      // frames to switch from click → drag (~250ms)
	private static readonly DRAG_RELEASE_DEBOUNCE = 6; // frames to confirm drag release (more stable)

	// Viewport
	private viewportWidth = 0;
	private viewportHeight = 0;

	constructor(settings?: ContinuousSettings) {
		this.settings = settings ?? { ...DEFAULT_CONTINUOUS_SETTINGS };
	}

	setCallback(cb: OnContinuousEvent): void { this.onEvent = cb; }
	setSettings(settings: ContinuousSettings): void { this.settings = settings; }
	setViewport(w: number, h: number): void { this.viewportWidth = w; this.viewportHeight = h; }
	getMode(): ContinuousMode { return this.mode; }

	/**
	 * Called every frame from main.ts.
	 * @param pointingHands — array of { landmarks, fingerStates } for each hand classified as Pointing
	 * @returns true if consumed by continuous pipeline
	 */
	update(pointingHands: { landmarks: NormalizedLandmark[]; fingers: boolean[] }[]): boolean {
		if (!this.settings.enabled) {
			if (this.mode !== "inactive") this.exitMode();
			return false;
		}

		const count = pointingHands.length;

		// --- Two hands pointing → Zoom ---
		if (count >= 2) {
			return this.handleZoom(pointingHands[0].landmarks, pointingHands[1].landmarks);
		}

		// --- One hand pointing (only if we were already active) → Cursor ---
		if (count === 1 && this.mode !== "inactive") {
			return this.handleCursor(pointingHands[0].landmarks, pointingHands[0].fingers);
		}

		// --- No pointing hands, or single hand without prior activation → exit ---
		if (this.mode !== "inactive") {
			this.exitMode();
		}
		return false;
	}

	reset(): void {
		if (this.mode !== "inactive") this.exitMode();
		this.hasInitial = false;
		this.resetThumbState();
	}

	// === Zoom phase ===

	private handleZoom(lm0: NormalizedLandmark[], lm1: NormalizedLandmark[]): boolean {
		const idx0 = lm0[INDEX_TIP];
		const idx1 = lm1[INDEX_TIP];
		const indexDist = dist2d(idx0, idx1);

		// If we were clicking/dragging, release mouse first
		if (this.thumbDown) {
			this.releaseClick();
		}
		this.resetThumbState();

		const wasInactive = this.mode === "inactive";
		if (this.mode !== "zooming") {
			this.mode = "zooming";
			if (wasInactive) {
				this.onEvent?.({ type: "mode_enter" });
			}
		}

		// Update two dot positions
		this.updateDualPositions(idx0, idx1);
		const px0 = this.smooth0X * this.viewportWidth;
		const py0 = this.smooth0Y * this.viewportHeight;
		const px1 = this.smooth1X * this.viewportWidth;
		const py1 = this.smooth1Y * this.viewportHeight;

		this.onEvent?.({
			type: "cursors_move",
			x: px0, y: py0,
			x2: px1, y2: py1,
		});

		// Zoom delta
		if (!wasInactive) {
			const delta = indexDist - this.prevIndexDist;
			if (Math.abs(delta) > 0.002) {
				const mx = (px0 + px1) / 2;
				const my = (py0 + py1) / 2;
				this.onEvent?.({
					type: "zoom",
					x: mx, y: my,
					zoomDelta: -delta * this.settings.zoomSensitivity,
				});
			}
		}

		this.prevIndexDist = indexDist;
		return true;
	}

	// === Cursor phase ===

	private handleCursor(lm: NormalizedLandmark[], fingers: boolean[]): boolean {
		const idx = lm[INDEX_TIP];

		if (this.mode === "zooming") {
			// Transition from zoom → cursor: keep last cursor position, smooth transition
			this.mode = "cursor";
		}

		// Update single cursor position
		this.updateSinglePosition(idx);
		const px = this.smooth0X * this.viewportWidth;
		const py = this.smooth0Y * this.viewportHeight;

		// Emit as cursors_move with only primary cursor (x2/y2 = undefined → hide second dot)
		this.onEvent?.({ type: "cursors_move", x: px, y: py });

		// Thumb detection — click vs drag separation
		const thumbExtended = fingers[0];

		if (thumbExtended) {
			this.thumbOnFrames++;
			this.thumbOffFrames = 0;

			// Confirm thumb extension (debounce)
			if (!this.thumbConfirmed && this.thumbOnFrames >= ContinuousGestureProcessor.THUMB_DEBOUNCE) {
				this.thumbConfirmed = true;
				this.thumbHoldFrames = 0;
			}

			// While confirmed, count hold duration
			if (this.thumbConfirmed) {
				this.thumbHoldFrames++;
				// Held long enough → drag mode (send mousedown now)
				if (!this.thumbDown && this.thumbHoldFrames >= ContinuousGestureProcessor.DRAG_THRESHOLD) {
					this.thumbDown = true;
					this.mode = "clicking";
					this.onEvent?.({ type: "mouse_down", x: px, y: py });
				}
			}
		} else {
			this.thumbOffFrames++;
			this.thumbOnFrames = 0;

			// Use stricter debounce for drag release vs click release
			const releaseThreshold = this.thumbDown
				? ContinuousGestureProcessor.DRAG_RELEASE_DEBOUNCE
				: ContinuousGestureProcessor.THUMB_DEBOUNCE;

			if (this.thumbConfirmed && this.thumbOffFrames >= releaseThreshold) {
				if (!this.thumbDown) {
					// Quick release → click (mousedown + mouseup at same position)
					this.onEvent?.({ type: "mouse_down", x: px, y: py });
					this.onEvent?.({ type: "mouse_up", x: px, y: py });
				} else {
					// Was dragging → release
					this.releaseClick();
				}
				this.thumbConfirmed = false;
				this.thumbHoldFrames = 0;
			}
		}

		return true;
	}

	// === Position helpers ===

	private updateDualPositions(idx0: NormalizedLandmark, idx1: NormalizedLandmark): void {
		const a = this.settings.smoothingAlpha;
		const r0x = this.mapX(idx0.x), r0y = this.mapY(idx0.y);
		const r1x = this.mapX(idx1.x), r1y = this.mapY(idx1.y);

		if (!this.hasInitial) {
			this.smooth0X = r0x; this.smooth0Y = r0y;
			this.smooth1X = r1x; this.smooth1Y = r1y;
			this.hasInitial = true;
		} else {
			this.smooth0X = a * r0x + (1 - a) * this.smooth0X;
			this.smooth0Y = a * r0y + (1 - a) * this.smooth0Y;
			this.smooth1X = a * r1x + (1 - a) * this.smooth1X;
			this.smooth1Y = a * r1y + (1 - a) * this.smooth1Y;
		}
	}

	private updateSinglePosition(idx: NormalizedLandmark): void {
		const a = this.settings.smoothingAlpha;
		const rx = this.mapX(idx.x), ry = this.mapY(idx.y);

		if (!this.hasInitial) {
			this.smooth0X = rx; this.smooth0Y = ry;
			this.hasInitial = true;
		} else {
			this.smooth0X = a * rx + (1 - a) * this.smooth0X;
			this.smooth0Y = a * ry + (1 - a) * this.smooth0Y;
		}
	}

	private mapX(rawX: number): number {
		return zoneMap(1 - rawX, ZONE_MIN, ZONE_MAX);
	}

	private mapY(rawY: number): number {
		return zoneMap(rawY, ZONE_MIN, ZONE_MAX);
	}

	// === Click helpers ===

	private releaseClick(): void {
		const px = this.smooth0X * this.viewportWidth;
		const py = this.smooth0Y * this.viewportHeight;
		this.onEvent?.({ type: "mouse_up", x: px, y: py });
		this.thumbDown = false;
		this.mode = "cursor";
	}

	private exitMode(): void {
		if (this.thumbDown) {
			this.releaseClick();
		}
		this.onEvent?.({ type: "mode_exit" });
		this.mode = "inactive";
		this.hasInitial = false;
		this.resetThumbState();
	}

	private resetThumbState(): void {
		this.thumbDown = false;
		this.thumbConfirmed = false;
		this.thumbOnFrames = 0;
		this.thumbOffFrames = 0;
		this.thumbHoldFrames = 0;
	}
}
