import { GestureType, CONTINUOUS_GESTURES } from "../types";
import { ClassificationResult } from "./GestureClassifier";

export interface StabilizedGesture {
	gesture: GestureType;
	confidence: number;
}

export type OnGestureConfirmed = (result: StabilizedGesture) => void;

export class GestureStabilizer {
	private dwellTime: number;
	private cooldownTime: number;
	private minFrames: number;

	private currentGesture: GestureType | null = null;
	private gestureStartTime = 0;
	private consecutiveFrames = 0;
	private lastFiredTime = 0;
	private firedGesture: GestureType | null = null; // requires release before re-fire
	private onConfirmed: OnGestureConfirmed | null = null;

	constructor(dwellTime = 400, cooldownTime = 1000, minFrames = 3) {
		this.dwellTime = dwellTime;
		this.cooldownTime = cooldownTime;
		this.minFrames = minFrames;
	}

	setCallback(cb: OnGestureConfirmed): void {
		this.onConfirmed = cb;
	}

	update(result: ClassificationResult): void {
		const now = Date.now();

		// Continuous gestures (Pointing/Pinch) bypass the stabilizer entirely
		if (result.gesture !== null && CONTINUOUS_GESTURES.has(result.gesture)) {
			// Treat like "no gesture" for the discrete pipeline — release lock
			this.firedGesture = null;
			this.resetTracking();
			return;
		}

		// No gesture → release lock + reset
		if (result.gesture === null) {
			this.firedGesture = null;
			this.resetTracking();
			return;
		}

		// Different gesture from the one that fired → also release lock
		if (this.firedGesture !== null && result.gesture !== this.firedGesture) {
			this.firedGesture = null;
		}

		// Still holding the same gesture that already fired → ignore until released
		if (result.gesture === this.firedGesture) {
			return;
		}

		if (result.gesture !== this.currentGesture) {
			this.currentGesture = result.gesture;
			this.gestureStartTime = now;
			this.consecutiveFrames = 1;
			return;
		}

		// Same gesture continues
		this.consecutiveFrames++;

		const elapsed = now - this.gestureStartTime;
		const pastCooldown = now - this.lastFiredTime >= this.cooldownTime;

		if (
			this.consecutiveFrames >= this.minFrames &&
			elapsed >= this.dwellTime &&
			pastCooldown
		) {
			this.lastFiredTime = now;
			this.firedGesture = result.gesture; // lock until released
			this.onConfirmed?.({
				gesture: result.gesture,
				confidence: result.confidence,
			});
			this.resetTracking();
		}
	}

	reset(): void {
		this.resetTracking();
		this.lastFiredTime = 0;
		this.firedGesture = null;
	}

	setDwellTime(ms: number): void {
		this.dwellTime = ms;
	}

	setCooldownTime(ms: number): void {
		this.cooldownTime = ms;
	}

	setMinFrames(n: number): void {
		this.minFrames = n;
	}

	private resetTracking(): void {
		this.currentGesture = null;
		this.gestureStartTime = 0;
		this.consecutiveFrames = 0;
	}
}
