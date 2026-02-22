import { HandLandmarker, NormalizedLandmark } from "@mediapipe/tasks-vision";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "obsidian";

const MODEL_URL =
	"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task";

// MediaPipe hand landmark connections
const HAND_CONNECTIONS: [number, number][] = [
	[0, 1], [1, 2], [2, 3], [3, 4],       // Thumb
	[0, 5], [5, 6], [6, 7], [7, 8],       // Index
	[0, 9], [9, 10], [10, 11], [11, 12],  // Middle
	[0, 13], [13, 14], [14, 15], [15, 16],// Ring
	[0, 17], [17, 18], [18, 19], [19, 20],// Pinky
	[5, 9], [9, 13], [13, 17],            // Palm
];

// ── Cyberpunk HUD Skeleton ──────────────────────────────────────────
//
// Visual language: Tron light-lines, Ghost in the Shell HUD overlay,
// Iron Man holographic wireframe. Clean, luminous, futuristic.
//
// Rendering pipeline (per hand, 4 draw passes):
//   1. Bone glow pass   — wide, translucent, soft-edge lines (structural glow)
//   2. Bone core pass   — thin, bright, sharp lines (the visible "wire")
//   3. Joint glow halos — translucent circles behind each joint
//   4. Joint cores      — bright dots/rings on top
//
// Fingertips (4,8,12,16,20) get 2x radius + bloom halo.
// Wrist (0) gets a hollow ring anchor marker.
// Palm bridges ([5,9],[9,13],[13,17]) are rendered dimmer.
//
// Scale system: all px values multiply by (canvasWidth / 320).
// At 160px wide, everything is half size. At 480px, 1.5x.
// This prevents the "chunky at small sizes" problem.

const FINGERTIP_IDS = new Set([4, 8, 12, 16, 20]);
const WRIST_ID = 0;
const REFERENCE_WIDTH = 320;

// Palm bridge connections — indices 20,21,22 in HAND_CONNECTIONS array
// These are: [5,9], [9,13], [13,17] — the cross-palm connectors
const PALM_CONN_INDICES = new Set([20, 21, 22]);

interface HandPalette {
	// Bones
	boneCore: string;          // thin bright line
	boneGlow: string;          // wide translucent line
	boneShadow: string;        // shadowColor for bone glow
	palmCore: string;          // palm bridge core (dimmer)
	palmGlow: string;          // palm bridge glow (dimmer)

	// Regular joints (knuckles, mid-finger)
	jointCore: string;         // center dot
	jointHalo: string;         // outer translucent circle
	jointShadow: string;       // shadowColor

	// Fingertips — brightest accent points
	tipCore: string;           // near-white center
	tipHalo: string;           // colored bloom ring
	tipShadow: string;        // strong bloom color

	// Wrist — anchor marker
	wristDot: string;          // center fill
	wristRing: string;         // ring stroke
	wristShadow: string;       // glow
}

// Hand 0: Cool Blue / Cyan
const PALETTE_COOL: HandPalette = {
	boneCore:     "rgba(195, 220, 255, 0.88)",
	boneGlow:     "rgba(100, 170, 255, 0.15)",
	boneShadow:   "rgba(100, 180, 255, 0.45)",
	palmCore:     "rgba(145, 185, 235, 0.50)",
	palmGlow:     "rgba(90, 150, 220, 0.10)",

	jointCore:    "rgba(205, 228, 255, 0.80)",
	jointHalo:    "rgba(110, 175, 255, 0.18)",
	jointShadow:  "rgba(100, 170, 255, 0.35)",

	tipCore:      "rgba(240, 248, 255, 1.0)",
	tipHalo:      "rgba(120, 195, 255, 0.30)",
	tipShadow:    "rgba(100, 190, 255, 0.55)",

	wristDot:     "rgba(185, 215, 250, 0.75)",
	wristRing:    "rgba(110, 175, 255, 0.45)",
	wristShadow:  "rgba(90, 165, 255, 0.35)",
};

// Hand 1: Warm Rose / Coral
const PALETTE_WARM: HandPalette = {
	boneCore:     "rgba(255, 205, 215, 0.88)",
	boneGlow:     "rgba(255, 130, 155, 0.15)",
	boneShadow:   "rgba(255, 135, 165, 0.45)",
	palmCore:     "rgba(235, 165, 180, 0.50)",
	palmGlow:     "rgba(220, 130, 155, 0.10)",

	jointCore:    "rgba(255, 218, 228, 0.80)",
	jointHalo:    "rgba(255, 145, 175, 0.18)",
	jointShadow:  "rgba(255, 135, 165, 0.35)",

	tipCore:      "rgba(255, 248, 250, 1.0)",
	tipHalo:      "rgba(255, 165, 190, 0.30)",
	tipShadow:    "rgba(255, 145, 175, 0.55)",

	wristDot:     "rgba(250, 205, 215, 0.75)",
	wristRing:    "rgba(255, 140, 165, 0.45)",
	wristShadow:  "rgba(255, 125, 155, 0.35)",
};

const PALETTES: HandPalette[] = [PALETTE_COOL, PALETTE_WARM];

export interface HandTrackingResult {
	landmarks: NormalizedLandmark[];
	/** All detected hands (1 or 2) */
	allHands: NormalizedLandmark[][];
	timestamp: number;
}

export type OnHandDetected = (result: HandTrackingResult) => void;
export type OnHandLost = () => void;

export class HandTracker {
	private handLandmarker: HandLandmarker | null = null;
	private animFrameId: number | null = null;
	private lastFrameTime = 0;
	private frameInterval: number;
	private onHandDetected: OnHandDetected | null = null;
	private onHandLost: OnHandLost | null = null;
	private wasHandVisible = false;
	private canvas: HTMLCanvasElement | null = null;

	constructor(fps = 15) {
		this.frameInterval = 1000 / fps;
	}

	async init(app: App): Promise<void> {
		// Skip if already initialized
		if (this.handLandmarker) return;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const basePath = (app.vault.adapter as any).getBasePath() as string;
		const wasmDir = join(
			basePath,
			".obsidian/plugins/gesture-control/wasm"
		);

		const loaderJs = readFileSync(
			join(wasmDir, "vision_wasm_internal.js")
		);
		const wasmBinary = readFileSync(
			join(wasmDir, "vision_wasm_internal.wasm")
		);

		const loaderBlob = new Blob([loaderJs], {
			type: "text/javascript",
		});
		const wasmBlob = new Blob([wasmBinary], {
			type: "application/wasm",
		});

		const wasmFileset = {
			wasmLoaderPath: URL.createObjectURL(loaderBlob),
			wasmBinaryPath: URL.createObjectURL(wasmBlob),
		};

		this.handLandmarker = await HandLandmarker.createFromOptions(
			wasmFileset,
			{
				baseOptions: {
					modelAssetPath: MODEL_URL,
					delegate: "CPU",
				},
				numHands: 2,
				runningMode: "VIDEO",
			}
		);

		URL.revokeObjectURL(wasmFileset.wasmLoaderPath);
		URL.revokeObjectURL(wasmFileset.wasmBinaryPath);
	}

	setCallbacks(onDetected: OnHandDetected, onLost: OnHandLost): void {
		this.onHandDetected = onDetected;
		this.onHandLost = onLost;
	}

	start(
		frameSource: HTMLCanvasElement,
		overlayCanvas?: HTMLCanvasElement
	): void {
		if (!this.handLandmarker) {
			throw new Error("HandTracker not initialized. Call init() first.");
		}
		this.canvas = overlayCanvas ?? null;

		const detect = (timestamp: number) => {
			this.animFrameId = requestAnimationFrame(detect);

			if (timestamp - this.lastFrameTime < this.frameInterval) return;
			this.lastFrameTime = timestamp;

			try {
				const result = this.handLandmarker!.detectForVideo(
					frameSource,
					timestamp
				);

				if (result.landmarks && result.landmarks.length > 0) {
					const landmarks = result.landmarks[0];
					const allHands = result.landmarks;
					this.wasHandVisible = true;
					this.drawAllLandmarks(allHands);
					this.onHandDetected?.({ landmarks, allHands, timestamp });
				} else {
					this.clearCanvas();
					if (this.wasHandVisible) {
						this.wasHandVisible = false;
						this.onHandLost?.();
					}
				}
			} catch (e) {
				console.error("[GestureControl] detectForVideo error:", e);
			}
		};

		this.animFrameId = requestAnimationFrame(detect);
	}

	stop(): void {
		if (this.animFrameId !== null) {
			cancelAnimationFrame(this.animFrameId);
			this.animFrameId = null;
		}
		this.clearCanvas();
		this.wasHandVisible = false;
		this.canvas = null;
	}

	async destroy(): Promise<void> {
		this.stop();
		if (this.handLandmarker) {
			this.handLandmarker.close();
			this.handLandmarker = null;
		}
	}

	private drawAllLandmarks(allHands: NormalizedLandmark[][]): void {
		if (!this.canvas) return;
		const ctx = this.canvas.getContext("2d");
		if (!ctx) return;
		const w = this.canvas.width;
		const h = this.canvas.height;
		ctx.clearRect(0, 0, w, h);

		for (let i = 0; i < allHands.length; i++) {
			this.drawLandmarksOnCtx(ctx, allHands[i], w, h, i);
		}
	}

	/**
	 * Cyberpunk HUD hand skeleton renderer.
	 *
	 * Rendering architecture (4 passes, back-to-front):
	 *
	 *   Pass 1 — BONE GLOW: Wide translucent strokes with shadowBlur
	 *            create a soft neon underglow beneath each bone.
	 *            Palm bridges rendered separately at lower opacity.
	 *
	 *   Pass 2 — BONE CORE: Thin, bright, sharp lines on top of glow.
	 *            This is the visible "wire" of the skeleton.
	 *            Uses round lineCap for clean segment joins.
	 *
	 *   Pass 3 — JOINT HALOS: Translucent circles at every landmark.
	 *            Fingertips get 2x larger halos with bloom shadowBlur.
	 *            Wrist gets a hollow ring marker.
	 *
	 *   Pass 4 — JOINT CORES: Small bright dots on top of halos.
	 *            Fingertips are near-white for maximum contrast.
	 *
	 * Performance notes:
	 *  - shadowBlur is used sparingly (1 value per pass, not per element)
	 *  - All sizes scale with (canvasWidth / 320) for resolution independence
	 *  - Total draw calls: ~80 per hand (acceptable at 15fps)
	 */
	private drawLandmarksOnCtx(
		ctx: CanvasRenderingContext2D,
		landmarks: NormalizedLandmark[],
		w: number,
		h: number,
		handIndex: number
	): void {
		const s = w / REFERENCE_WIDTH;
		const p = PALETTES[handIndex] ?? PALETTES[0];
		const TWO_PI = 2 * Math.PI;

		ctx.lineCap = "round";
		ctx.lineJoin = "round";

		// ── Pass 1: Bone glow (wide, translucent, with subtle shadowBlur) ──
		ctx.save();
		ctx.shadowColor = p.boneShadow;
		ctx.shadowBlur = Math.max(2, 6 * s);
		ctx.shadowOffsetX = 0;
		ctx.shadowOffsetY = 0;

		for (let ci = 0; ci < HAND_CONNECTIONS.length; ci++) {
			const [a, b] = HAND_CONNECTIONS[ci];
			const isPalm = PALM_CONN_INDICES.has(ci);
			ctx.strokeStyle = isPalm ? p.palmGlow : p.boneGlow;
			ctx.lineWidth = Math.max(1, (isPalm ? 3.5 : 5) * s);
			ctx.beginPath();
			ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
			ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
			ctx.stroke();
		}
		ctx.restore();

		// ── Pass 2: Bone core (thin, bright, no shadow) ──
		for (let ci = 0; ci < HAND_CONNECTIONS.length; ci++) {
			const [a, b] = HAND_CONNECTIONS[ci];
			const isPalm = PALM_CONN_INDICES.has(ci);
			ctx.strokeStyle = isPalm ? p.palmCore : p.boneCore;
			ctx.lineWidth = Math.max(0.5, (isPalm ? 1.0 : 1.5) * s);
			ctx.beginPath();
			ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
			ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
			ctx.stroke();
		}

		// ── Pass 3: Joint halos (back layer) ──
		for (let i = 0; i < landmarks.length; i++) {
			const px = landmarks[i].x * w;
			const py = landmarks[i].y * h;

			if (FINGERTIP_IDS.has(i)) {
				// Fingertip bloom halo — large, with shadowBlur for bloom
				const haloR = Math.max(2, 5.5 * s);
				ctx.save();
				ctx.shadowColor = p.tipShadow;
				ctx.shadowBlur = Math.max(3, 8 * s);
				ctx.shadowOffsetX = 0;
				ctx.shadowOffsetY = 0;
				ctx.beginPath();
				ctx.arc(px, py, haloR, 0, TWO_PI);
				ctx.fillStyle = p.tipHalo;
				ctx.fill();
				ctx.restore();

			} else if (i === WRIST_ID) {
				// Wrist: hollow ring marker
				const ringR = Math.max(2.5, 5 * s);
				ctx.save();
				ctx.shadowColor = p.wristShadow;
				ctx.shadowBlur = Math.max(2, 5 * s);
				ctx.shadowOffsetX = 0;
				ctx.shadowOffsetY = 0;
				ctx.beginPath();
				ctx.arc(px, py, ringR, 0, TWO_PI);
				ctx.strokeStyle = p.wristRing;
				ctx.lineWidth = Math.max(0.5, 1.2 * s);
				ctx.stroke();
				ctx.restore();

			} else {
				// Regular joint halo
				const haloR = Math.max(1, 2.8 * s);
				ctx.beginPath();
				ctx.arc(px, py, haloR, 0, TWO_PI);
				ctx.fillStyle = p.jointHalo;
				ctx.fill();
			}
		}

		// ── Pass 4: Joint cores (front layer — bright dots) ──
		for (let i = 0; i < landmarks.length; i++) {
			const px = landmarks[i].x * w;
			const py = landmarks[i].y * h;

			if (FINGERTIP_IDS.has(i)) {
				// Fingertip core: bright near-white
				const coreR = Math.max(1, 2.5 * s);
				ctx.beginPath();
				ctx.arc(px, py, coreR, 0, TWO_PI);
				ctx.fillStyle = p.tipCore;
				ctx.fill();

			} else if (i === WRIST_ID) {
				// Wrist center dot
				const dotR = Math.max(0.8, 1.8 * s);
				ctx.beginPath();
				ctx.arc(px, py, dotR, 0, TWO_PI);
				ctx.fillStyle = p.wristDot;
				ctx.fill();

			} else {
				// Regular joint core
				const coreR = Math.max(0.5, 1.5 * s);
				ctx.beginPath();
				ctx.arc(px, py, coreR, 0, TWO_PI);
				ctx.fillStyle = p.jointCore;
				ctx.fill();
			}
		}
	}

	private clearCanvas(): void {
		if (!this.canvas) return;
		const ctx = this.canvas.getContext("2d");
		if (!ctx) return;
		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
	}
}
