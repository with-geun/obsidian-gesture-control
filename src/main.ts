import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, DEFAULT_PREVIEW_SETTINGS, GestureControlSettings, GestureType } from "./types";
import { CameraManager } from "./camera/CameraManager";
import { HandTracker } from "./tracking/HandTracker";
import { GestureClassifier } from "./gesture/GestureClassifier";
import { GestureStabilizer } from "./gesture/GestureStabilizer";
import { ContinuousGestureProcessor } from "./gesture/ContinuousGestureProcessor";
import { ActionRouter } from "./action/ActionRouter";
import { ContinuousActionDispatcher } from "./action/ContinuousActionDispatcher";
import { SettingsTab } from "./ui/SettingsTab";
import { StatusDisplay } from "./ui/StatusDisplay";
import { AssetManager } from "./AssetManager";

export default class GestureControlPlugin extends Plugin {
	settings: GestureControlSettings = DEFAULT_SETTINGS;
	camera: CameraManager = new CameraManager();
	tracker: HandTracker = new HandTracker();
	classifier: GestureClassifier = new GestureClassifier();
	stabilizer: GestureStabilizer = new GestureStabilizer();
	continuousProcessor: ContinuousGestureProcessor = new ContinuousGestureProcessor();
	private router: ActionRouter | null = null;
	private continuousDispatcher: ContinuousActionDispatcher = new ContinuousActionDispatcher();
	private display: StatusDisplay = new StatusDisplay();
	private toggling = false;
	private handDetected = false;
	private lastFiredGesture: GestureType | null = null;

	async onload() {
		await this.loadSettings();

		// ActionRouter
		this.router = new ActionRouter(this.app);
		this.router.setMappings(this.settings.gestureMappings);

		// Apply settings to classifier/stabilizer
		this.classifier.setThreshold(this.settings.confidenceThreshold);
		this.stabilizer.setDwellTime(this.settings.dwellTime);
		this.stabilizer.setCooldownTime(this.settings.cooldownTime);

		// Continuous processor setup
		this.continuousProcessor.setSettings(this.settings.continuous);
		this.continuousProcessor.setCallback((event) => {
			this.continuousDispatcher.dispatch(event);
			this.refreshDisplay();
		});

		// Stabilizer callback — gesture confirmed → execute command
		this.stabilizer.setCallback((result) => {
			this.lastFiredGesture = result.gesture;
			this.router?.execute(result.gesture).catch((e) =>
				console.error("[GestureControl] Action error:", e)
			);
			this.refreshDisplay();
		});

		// Hand tracking callbacks
		this.tracker.setCallbacks(
			(result) => {
				this.handDetected = true;
				this.updateViewport();

				const allHands = result.allHands;

				// Classify all hands, collect Pointing hands for continuous pipeline
				const pointingHands: { landmarks: typeof result.landmarks; fingers: boolean[] }[] = [];
				const classifications = allHands.map(lm => this.classifier.classify(lm));

				for (let i = 0; i < classifications.length; i++) {
					if (classifications[i].gesture === GestureType.Pointing) {
						pointingHands.push({
							landmarks: allHands[i],
							fingers: classifications[i].fingerStates,
						});
					}
				}

				// Try continuous pipeline (needs 2 pointing hands to enter, 1 to stay)
				const consumed = this.continuousProcessor.update(pointingHands);

				if (consumed) {
					this.stabilizer.reset();
					this.refreshDisplay();
					return;
				}

				// Not consumed → discrete pipeline (single hand)
				this.continuousProcessor.reset();
				const classification = this.classifier.classify(result.landmarks);
				this.stabilizer.update(classification);
				this.refreshDisplay();
			},
			() => {
				this.handDetected = false;
				this.stabilizer.reset();
				this.continuousProcessor.reset();
				this.lastFiredGesture = null;
				this.refreshDisplay();
			}
		);

		// Ribbon icon — toggles gesture camera
		const ribbonEl = this.addRibbonIcon("hand", "Toggle Gesture Camera", () => {
			this.toggleCamera().catch((e) =>
				console.error("[GestureControl]", e)
			);
		});
		this.display.setRibbonEl(ribbonEl);

		// Command: Toggle Gesture Camera
		this.addCommand({
			id: "toggle-gesture-camera",
			name: "Toggle Gesture Camera",
			callback: () => {
				this.toggleCamera().catch((e) =>
					console.error("[GestureControl]", e)
				);
			},
		});

		// Command: Toggle Preview Visibility
		this.addCommand({
			id: "toggle-preview",
			name: "Toggle Camera Preview",
			callback: () => {
				this.camera.togglePreview();
			},
		});

		// Settings tab
		this.addSettingTab(new SettingsTab(this.app, this));

		// Status bar
		this.display.setStatusBarEl(this.addStatusBarItem());
		this.refreshDisplay();
	}

	async onunload() {
		await this.tracker.destroy();
		this.camera.stop();
		this.continuousProcessor.reset();
		this.continuousDispatcher.destroy();
		this.display.destroy();
	}

	private async toggleCamera() {
		if (this.toggling) return;
		this.toggling = true;
		try {
			if (this.camera.isActive) {
				await this.stopPipeline();
				new Notice("Gesture camera: OFF");
			} else {
				// Ensure native assets exist (auto-download on first community install)
				await this.ensureNativeAssets();

				const frameCanvas = await this.camera.start(this.app);
				this.camera.setPreviewSettings(this.settings.preview);
				this.camera.onSettingsChange = (partial) => {
					Object.assign(this.settings.preview, partial);
					this.saveSettings();
				};
				new Notice("Loading hand tracking model...");
				await this.tracker.init(this.app);
				this.tracker.start(frameCanvas, this.camera.overlay ?? undefined);
				new Notice("Gesture camera: ON — show your hand!");
			}
		} catch (err) {
			const msg = this.friendlyError(err);
			new Notice(msg, 10000);
			console.error("[GestureControl]", err);
			await this.stopPipeline();
		} finally {
			this.toggling = false;
		}
		this.refreshDisplay();
	}

	private async stopPipeline(): Promise<void> {
		await this.tracker.destroy();
		this.camera.stop();
		this.handDetected = false;
		this.stabilizer.reset();
		this.continuousProcessor.reset();
		this.continuousDispatcher.destroy();
		this.lastFiredGesture = null;
	}

	private getPluginDir(): string {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const basePath = (this.app.vault.adapter as any).getBasePath() as string;
		return require("node:path").join(basePath, ".obsidian/plugins/gesture-control");
	}

	private async ensureNativeAssets(): Promise<void> {
		const pluginDir = this.getPluginDir();
		const assets = new AssetManager(pluginDir);
		if (assets.hasNativeAssets()) return;

		new Notice("Gesture Control: Native assets not found. Downloading...", 5000);
		await assets.downloadAssets(this.manifest.version);
	}

	private friendlyError(err: unknown): string {
		const raw = err instanceof Error ? err.message : String(err);
		if (raw.includes("CAMERA_DENIED") || raw.includes("permission")) {
			return "Camera permission denied. Allow camera access in System Settings > Privacy & Security > Camera.";
		}
		if (raw.includes("timeout") || raw.includes("Timeout")) {
			return "Camera startup timed out. Try toggling again.";
		}
		if (raw.includes("No frame file")) {
			return "Camera started but no frames received. Try toggling again.";
		}
		if (raw.includes("hand_landmarker") || raw.includes("model")) {
			return "Failed to load hand tracking model. Check your internet connection.";
		}
		if (raw.includes("native assets") || raw.includes("Failed to download")) {
			return raw; // Already user-friendly from AssetManager
		}
		return `Gesture Control error: ${raw}`;
	}

	private refreshDisplay(): void {
		const continuousMode = this.continuousProcessor.getMode();
		this.display.update(
			this.camera.isActive,
			this.handDetected,
			this.lastFiredGesture,
			this.settings.gestureMappings,
			(id) => this.router?.getCommandName(id) ?? id,
			continuousMode !== "inactive" ? continuousMode : undefined
		);
	}

	private updateViewport(): void {
		this.continuousProcessor.setViewport(window.innerWidth, window.innerHeight);
	}

	applySettings(): void {
		this.classifier.setThreshold(this.settings.confidenceThreshold);
		this.stabilizer.setDwellTime(this.settings.dwellTime);
		this.stabilizer.setCooldownTime(this.settings.cooldownTime);
		this.router?.setMappings(this.settings.gestureMappings);
		this.continuousProcessor.setSettings(this.settings.continuous);
		if (this.camera.isActive) {
			this.camera.setPreviewSettings(this.settings.preview);
		}
	}

	async loadSettings() {
		const saved = await this.loadData();
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			saved
		);
		// Deep merge nested objects
		this.settings.preview = Object.assign(
			{},
			DEFAULT_PREVIEW_SETTINGS,
			saved?.preview
		);
		// Merge gesture mappings: keep saved values, add missing gestures from defaults
		if (saved?.gestureMappings) {
			const savedGestures = new Set(saved.gestureMappings.map((m: { gesture: string }) => m.gesture));
			for (const def of DEFAULT_SETTINGS.gestureMappings) {
				if (!savedGestures.has(def.gesture)) {
					this.settings.gestureMappings.push({ ...def });
				}
			}
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
