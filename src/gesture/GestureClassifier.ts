import { NormalizedLandmark } from "@mediapipe/tasks-vision";
import { GestureType } from "../types";

export interface ClassificationResult {
	gesture: GestureType | null;
	confidence: number;
	fingerStates: boolean[]; // [thumb, index, middle, ring, pinky]
	landmarks: NormalizedLandmark[] | null;
}

// Landmark indices
const THUMB_TIP = 4;
const THUMB_IP = 3;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const INDEX_PIP = 6;
const MIDDLE_TIP = 12;
const MIDDLE_PIP = 10;
const RING_TIP = 16;
const RING_PIP = 14;
const PINKY_TIP = 20;
const PINKY_PIP = 18;

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
	return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export class GestureClassifier {
	private threshold: number;

	constructor(confidenceThreshold = 0.7) {
		this.threshold = confidenceThreshold;
	}

	classify(landmarks: NormalizedLandmark[]): ClassificationResult {
		if (landmarks.length < 21) {
			return { gesture: null, confidence: 0, fingerStates: [false, false, false, false, false], landmarks: null };
		}

		const fingerStates = this.getFingerStates(landmarks);
		const [thumb, index, middle, ring, pinky] = fingerStates;
		const extendedCount = fingerStates.filter(Boolean).length;
		const thumbIndexDist = dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP]);

		// Priority order: specific → general
		// 1. Pinch: thumb+index close + others curled (continuous)
		// 2. OK: thumb+index close + others extended (discrete)
		// 3. Pointing: index only (continuous)
		// 4. ILoveYou [1,1,0,0,1]
		// 5. Victory [*,1,1,0,0]
		// 6. Three [*,1,1,1,0]
		// 7. ThumbDown [1,0,0,0,0] + tip.y > ip.y
		// 8. ThumbUp [1,0,0,0,0] + tip.y < ip.y
		// 9. Palm (all extended)
		// 10. Fist (all curled)

		let gesture: GestureType | null = null;
		let confidence = 0;

		// 1. Pinch: thumb+index close, index extended, others curled
		if (thumbIndexDist < 0.08 && index && !middle && !ring && !pinky) {
			gesture = GestureType.Pinch;
			confidence = 1.0;
		}
		// 2. OK: thumb+index close (ring shape), remaining fingers extended
		else if (thumbIndexDist < 0.08 && middle && ring && pinky) {
			gesture = GestureType.OK;
			confidence = 1.0;
		}
		// 3. Pointing: only index extended
		else if (index && !middle && !ring && !pinky) {
			gesture = GestureType.Pointing;
			confidence = 1.0;
		}
		// 4. ILoveYou: thumb + index + pinky extended, middle + ring curled
		else if (thumb && index && !middle && !ring && pinky) {
			gesture = GestureType.ILoveYou;
			confidence = 1.0;
		}
		// 5. Victory: index + middle extended, ring + pinky curled
		else if (index && middle && !ring && !pinky) {
			gesture = GestureType.Victory;
			confidence = 1.0;
		}
		// 6. Three: index + middle + ring extended, pinky curled
		else if (index && middle && ring && !pinky) {
			gesture = GestureType.Three;
			confidence = 1.0;
		}
		// 7-8. Thumb only: direction determines Up vs Down
		else if (thumb && !index && !middle && !ring && !pinky) {
			const thumbTipY = landmarks[THUMB_TIP].y;
			const thumbIpY = landmarks[THUMB_IP].y;
			if (thumbTipY < thumbIpY) {
				gesture = GestureType.ThumbUp;
				confidence = 1.0;
			} else {
				gesture = GestureType.ThumbDown;
				confidence = 1.0;
			}
		}
		// 9. Palm: all fingers extended
		else if (extendedCount >= 5) {
			gesture = GestureType.Palm;
			confidence = extendedCount / 5;
		}
		// 10. Fist: all fingers curled
		else if (extendedCount === 0) {
			gesture = GestureType.Fist;
			confidence = 1.0;
		}

		// Apply threshold
		if (confidence < this.threshold) {
			gesture = null;
			confidence = 0;
		}

		return { gesture, confidence, fingerStates, landmarks };
	}

	setThreshold(value: number): void {
		this.threshold = value;
	}

	private getFingerStates(landmarks: NormalizedLandmark[]): boolean[] {
		return [
			this.isThumbExtended(landmarks),
			landmarks[INDEX_TIP].y < landmarks[INDEX_PIP].y,
			landmarks[MIDDLE_TIP].y < landmarks[MIDDLE_PIP].y,
			landmarks[RING_TIP].y < landmarks[RING_PIP].y,
			landmarks[PINKY_TIP].y < landmarks[PINKY_PIP].y,
		];
	}

	private isThumbExtended(lm: NormalizedLandmark[]): boolean {
		// Thumb tip farther from index MCP than thumb IP is
		const tipDist = dist(lm[THUMB_TIP], lm[INDEX_MCP]);
		const ipDist = dist(lm[THUMB_IP], lm[INDEX_MCP]);
		return tipDist > ipDist * 1.1;
	}
}
