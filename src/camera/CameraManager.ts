import { execFile } from "node:child_process";
import { readFileSync, existsSync, unlinkSync, statSync } from "node:fs";
import { join } from "node:path";
import { App } from "obsidian";
import type { PreviewMode, PreviewSettings } from "../types";

const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 480;
const ASPECT_RATIO = 4 / 3;
const FPS = 15;
const FRAME_PATH = "/tmp/gesture-control-frame.jpg";
const STATUS_PATH = "/tmp/gesture-control-status";
const PID_PATH = "/tmp/gesture-control-pid";

export class CameraManager {
	private container: HTMLDivElement | null = null;
	private previewCanvas: HTMLCanvasElement | null = null;
	private captureCanvas: HTMLCanvasElement | null = null;
	private overlayCanvas: HTMLCanvasElement | null = null;
	private toolbar: HTMLDivElement | null = null;
	private pollTimer: ReturnType<typeof setInterval> | null = null;
	private running = false;
	private lastMtime = 0;
	private nativePid: number | null = null;

	// Preview state
	private previewMode: PreviewMode = "skeleton";
	private previewWidth = 320;
	private posX = -1;
	private posY = -1;

	// Drag state
	private dragging = false;
	private dragOffsetX = 0;
	private dragOffsetY = 0;
	private boundDragMove: ((e: MouseEvent) => void) | null = null;
	private boundDragEnd: ((e: MouseEvent) => void) | null = null;

	// Resize state
	private resizing = false;
	private resizeStartX = 0;
	private resizeStartW = 0;
	private boundResizeMove: ((e: MouseEvent) => void) | null = null;
	private boundResizeEnd: ((e: MouseEvent) => void) | null = null;

	/** Called when user changes position/size/mode via drag/resize/toolbar */
	onSettingsChange: ((settings: Partial<PreviewSettings>) => void) | null = null;

	get isActive(): boolean {
		return this.running;
	}

	get frame(): HTMLCanvasElement | null {
		return this.captureCanvas;
	}

	get overlay(): HTMLCanvasElement | null {
		return this.overlayCanvas;
	}

	/** Apply saved preview settings (called after start) */
	setPreviewSettings(settings: PreviewSettings): void {
		this.previewMode = settings.mode;
		this.previewWidth = settings.width;
		this.posX = settings.x;
		this.posY = settings.y;
		this.applyMode();
		this.applySize();
		this.applyPosition();
	}

	/** Show preview (from hidden state) */
	showPreview(): void {
		if (this.previewMode === "hidden") {
			this.previewMode = "skeleton";
		}
		this.applyMode();
		this.onSettingsChange?.({ mode: this.previewMode });
	}

	/** Toggle preview visibility */
	togglePreview(): void {
		if (this.previewMode === "hidden") {
			this.previewMode = "skeleton";
		} else {
			this.previewMode = "hidden";
		}
		this.applyMode();
		this.onSettingsChange?.({ mode: this.previewMode });
	}

	async start(app: App): Promise<HTMLCanvasElement> {
		if (this.running) {
			return this.captureCanvas!;
		}

		// Resolve GestureCamera.app bundle path
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const basePath = (app.vault.adapter as any).getBasePath() as string;
		const appBundlePath = join(
			basePath,
			".obsidian/plugins/gesture-control/GestureCamera.app"
		);

		if (!existsSync(appBundlePath)) {
			throw new Error(
				"GestureCamera.app not found. Reinstall the plugin."
			);
		}

		// Cleanup stale files
		for (const p of [FRAME_PATH, STATUS_PATH, PID_PATH]) {
			try { unlinkSync(p); } catch { /* ignore */ }
		}

		// Setup UI
		this.createPreviewUI();

		// Launch via 'open -n -a' so macOS Launch Services registers it properly
		const parentPid = process.pid;

		execFile("open", [
			"-n", "-a", appBundlePath,
			"--args",
			String(FPS),
			String(CAPTURE_WIDTH),
			String(CAPTURE_HEIGHT),
			FRAME_PATH,
			STATUS_PATH,
			String(parentPid),
		], (err) => {
			if (err) {
				console.error("[GestureControl] open command error:", err);
			}
		});

		this.running = true;

		// Wait for status file to contain READY or ERROR
		await new Promise<void>((resolve, reject) => {
			let checks = 0;
			const check = setInterval(() => {
				checks++;
				try {
					if (existsSync(STATUS_PATH)) {
						const content = readFileSync(STATUS_PATH, "utf-8");
						if (content.includes("READY")) {
							clearInterval(check);
							resolve();
						} else if (content.includes("ERROR")) {
							clearInterval(check);
							reject(new Error(content.trim()));
						}
					}
				} catch { /* file not ready */ }
				if (checks > 300) { // 30 seconds
					clearInterval(check);
					reject(new Error("Native camera startup timeout"));
				}
			}, 100);
		});

		// Read native camera PID
		try {
			if (existsSync(PID_PATH)) {
				this.nativePid = parseInt(readFileSync(PID_PATH, "utf-8").trim());
			}
		} catch { /* ignore */ }

		// Wait for first frame file to appear
		await new Promise<void>((resolve, reject) => {
			let checks = 0;
			const check = setInterval(() => {
				checks++;
				if (existsSync(FRAME_PATH)) {
					clearInterval(check);
					resolve();
				}
				if (checks > 50) { // 5 seconds
					clearInterval(check);
					reject(new Error("No frame file after 5 seconds"));
				}
			}, 100);
		});

		// Capture canvas for MediaPipe (offscreen, always active)
		const captureCanvas = document.createElement("canvas");
		captureCanvas.width = CAPTURE_WIDTH;
		captureCanvas.height = CAPTURE_HEIGHT;
		this.captureCanvas = captureCanvas;

		const captureCtx = captureCanvas.getContext("2d")!;
		const previewCtx = this.previewCanvas!.getContext("2d")!;

		// Poll frame file and draw to canvases
		let frameCount = 0;
		this.lastMtime = 0;

		this.pollTimer = setInterval(() => {
			if (!this.running) return;
			try {
				const stat = statSync(FRAME_PATH);
				const mtime = stat.mtimeMs;
				if (mtime === this.lastMtime) return;
				this.lastMtime = mtime;

				const data = readFileSync(FRAME_PATH);
				if (data.length < 100) return;

				const blob = new Blob([data], { type: "image/jpeg" });
				createImageBitmap(blob).then((bitmap) => {
					if (!this.running) {
						bitmap.close();
						return;
					}
					// Always draw to capture canvas (MediaPipe needs it)
					captureCtx.drawImage(bitmap, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
					// Only draw to preview canvas in camera mode
					if (this.previewMode === "camera") {
						const pw = this.previewCanvas!.width;
						const ph = this.previewCanvas!.height;
						previewCtx.drawImage(bitmap, 0, 0, pw, ph);
					}
					bitmap.close();
				}).catch(() => { /* corrupt frame, skip */ });
			} catch {
				// File not ready or read error, skip
			}
		}, Math.floor(1000 / FPS));

		return captureCanvas;
	}

	stop(): void {
		this.running = false;

		if (this.pollTimer) {
			clearInterval(this.pollTimer);
			this.pollTimer = null;
		}

		// Kill native camera process via saved PID
		if (this.nativePid) {
			try {
				process.kill(this.nativePid, "SIGTERM");
			} catch { /* already dead */ }
			this.nativePid = null;
		}

		// Cleanup temp files
		for (const p of [FRAME_PATH, STATUS_PATH, PID_PATH]) {
			try { unlinkSync(p); } catch { /* ignore */ }
		}

		this.removeDragListeners();
		this.removeResizeListeners();

		if (this.container) {
			this.container.remove();
			this.container = null;
		}

		this.previewCanvas = null;
		this.captureCanvas = null;
		this.overlayCanvas = null;
		this.toolbar = null;
	}

	// ── UI Creation ──

	private createPreviewUI(): void {
		const previewHeight = Math.round(this.previewWidth / ASPECT_RATIO);

		// Container
		const container = document.createElement("div");
		container.className = "gesture-control-preview";
		container.style.width = `${this.previewWidth}px`;
		container.style.height = `${previewHeight}px`;
		this.container = container;

		// Toolbar (shown on hover)
		const toolbar = document.createElement("div");
		toolbar.className = "gesture-preview-toolbar";

		const modeBtn = document.createElement("button");
		modeBtn.className = "gesture-preview-btn";
		modeBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.toggleMode();
		});
		toolbar.appendChild(modeBtn);

		const hideBtn = document.createElement("button");
		hideBtn.className = "gesture-preview-btn";
		hideBtn.textContent = "\u2715";
		hideBtn.title = "Hide preview";
		hideBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.previewMode = "hidden";
			this.applyMode();
			this.onSettingsChange?.({ mode: "hidden" });
		});
		toolbar.appendChild(hideBtn);

		container.appendChild(toolbar);
		this.toolbar = toolbar;

		// Preview canvas (camera feed — hidden in skeleton mode)
		const previewCanvas = document.createElement("canvas");
		previewCanvas.width = this.previewWidth;
		previewCanvas.height = previewHeight;
		previewCanvas.className = "gesture-preview-canvas";
		container.appendChild(previewCanvas);
		this.previewCanvas = previewCanvas;

		// Overlay canvas (hand landmarks — always visible)
		const overlayCanvas = document.createElement("canvas");
		overlayCanvas.width = this.previewWidth;
		overlayCanvas.height = previewHeight;
		overlayCanvas.className = "gesture-preview-overlay";
		container.appendChild(overlayCanvas);
		this.overlayCanvas = overlayCanvas;

		// Resize handle
		const resizeHandle = document.createElement("div");
		resizeHandle.className = "gesture-preview-resize";
		resizeHandle.addEventListener("mousedown", (e) => this.onResizeStart(e));
		container.appendChild(resizeHandle);

		// Drag — toolbar mousedown
		toolbar.addEventListener("mousedown", (e) => {
			// Don't drag if clicking a button
			if ((e.target as HTMLElement).tagName === "BUTTON") return;
			this.onDragStart(e);
		});

		document.body.appendChild(container);
		this.applyPosition();
		this.applyMode();
	}

	// ── Mode ──

	private toggleMode(): void {
		this.previewMode = this.previewMode === "camera" ? "skeleton" : "camera";
		this.applyMode();
		this.onSettingsChange?.({ mode: this.previewMode });
	}

	private applyMode(): void {
		if (!this.container || !this.previewCanvas) return;

		const modeBtn = this.toolbar?.querySelector(".gesture-preview-btn") as HTMLButtonElement | null;

		if (this.previewMode === "hidden") {
			this.container.style.display = "none";
			return;
		}

		this.container.style.display = "";

		if (this.previewMode === "skeleton") {
			this.previewCanvas.style.display = "none";
			if (modeBtn) { modeBtn.textContent = "\uD83D\uDCF7"; modeBtn.title = "Show camera"; }
		} else {
			this.previewCanvas.style.display = "block";
			if (modeBtn) { modeBtn.textContent = "\uD83D\uDC80"; modeBtn.title = "Show skeleton only"; }
		}
	}

	// ── Position ──

	private applyPosition(): void {
		if (!this.container) return;
		if (this.posX >= 0 && this.posY >= 0) {
			this.container.style.left = `${this.posX}px`;
			this.container.style.top = `${this.posY}px`;
			this.container.style.right = "";
			this.container.style.bottom = "";
		} else {
			// Default: bottom-right
			this.container.style.right = "16px";
			this.container.style.bottom = "40px";
			this.container.style.left = "";
			this.container.style.top = "";
		}
	}

	/** Reset position to default bottom-right */
	resetPosition(): void {
		this.posX = -1;
		this.posY = -1;
		this.applyPosition();
		this.onSettingsChange?.({ x: -1, y: -1 });
	}

	// ── Size ──

	private applySize(): void {
		if (!this.container || !this.previewCanvas || !this.overlayCanvas) return;
		const h = Math.round(this.previewWidth / ASPECT_RATIO);
		this.container.style.width = `${this.previewWidth}px`;
		this.container.style.height = `${h}px`;
		this.previewCanvas.width = this.previewWidth;
		this.previewCanvas.height = h;
		this.overlayCanvas.width = this.previewWidth;
		this.overlayCanvas.height = h;
	}

	/** Update preview width externally (from settings slider) */
	setPreviewWidth(width: number): void {
		this.previewWidth = width;
		this.applySize();
	}

	/** Update preview mode externally (from settings dropdown) */
	setMode(mode: PreviewMode): void {
		this.previewMode = mode;
		this.applyMode();
	}

	// ── Drag ──

	private onDragStart(e: MouseEvent): void {
		if (!this.container) return;
		e.preventDefault();
		this.dragging = true;

		const rect = this.container.getBoundingClientRect();
		this.dragOffsetX = e.clientX - rect.left;
		this.dragOffsetY = e.clientY - rect.top;

		// Switch from right/bottom to left/top positioning
		this.container.style.left = `${rect.left}px`;
		this.container.style.top = `${rect.top}px`;
		this.container.style.right = "";
		this.container.style.bottom = "";

		this.boundDragMove = (ev) => this.onDragMove(ev);
		this.boundDragEnd = (ev) => this.onDragEnd(ev);
		document.addEventListener("mousemove", this.boundDragMove);
		document.addEventListener("mouseup", this.boundDragEnd);
	}

	private onDragMove(e: MouseEvent): void {
		if (!this.dragging || !this.container) return;
		const x = e.clientX - this.dragOffsetX;
		const y = e.clientY - this.dragOffsetY;
		this.container.style.left = `${x}px`;
		this.container.style.top = `${y}px`;
	}

	private onDragEnd(e: MouseEvent): void {
		if (!this.dragging || !this.container) return;
		this.dragging = false;
		this.posX = e.clientX - this.dragOffsetX;
		this.posY = e.clientY - this.dragOffsetY;
		this.removeDragListeners();
		this.onSettingsChange?.({ x: this.posX, y: this.posY });
	}

	private removeDragListeners(): void {
		if (this.boundDragMove) {
			document.removeEventListener("mousemove", this.boundDragMove);
			this.boundDragMove = null;
		}
		if (this.boundDragEnd) {
			document.removeEventListener("mouseup", this.boundDragEnd);
			this.boundDragEnd = null;
		}
		this.dragging = false;
	}

	// ── Resize ──

	private onResizeStart(e: MouseEvent): void {
		if (!this.container) return;
		e.preventDefault();
		e.stopPropagation();
		this.resizing = true;
		this.resizeStartX = e.clientX;
		this.resizeStartW = this.previewWidth;

		this.boundResizeMove = (ev) => this.onResizeMove(ev);
		this.boundResizeEnd = (ev) => this.onResizeEnd(ev);
		document.addEventListener("mousemove", this.boundResizeMove);
		document.addEventListener("mouseup", this.boundResizeEnd);
	}

	private onResizeMove(e: MouseEvent): void {
		if (!this.resizing) return;
		const dx = e.clientX - this.resizeStartX;
		const newW = Math.max(160, Math.min(480, this.resizeStartW + dx));
		this.previewWidth = newW;
		this.applySize();
	}

	private onResizeEnd(_e: MouseEvent): void {
		this.resizing = false;
		this.removeResizeListeners();
		this.onSettingsChange?.({ width: this.previewWidth });
	}

	private removeResizeListeners(): void {
		if (this.boundResizeMove) {
			document.removeEventListener("mousemove", this.boundResizeMove);
			this.boundResizeMove = null;
		}
		if (this.boundResizeEnd) {
			document.removeEventListener("mouseup", this.boundResizeEnd);
			this.boundResizeEnd = null;
		}
		this.resizing = false;
	}
}
