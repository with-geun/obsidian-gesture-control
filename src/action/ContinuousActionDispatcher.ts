import { ContinuousGestureEvent } from "../types";

function getWebContents(): any | null {
	try {
		return require("@electron/remote").getCurrentWebContents();
	} catch { /* ignore */ }
	try {
		return require("electron").remote?.getCurrentWebContents?.();
	} catch { /* ignore */ }
	return null;
}

export class ContinuousActionDispatcher {
	private dot0: HTMLElement | null = null; // red dot (primary / cursor hand)
	private dot1: HTMLElement | null = null; // blue dot (second hand, zoom only)
	private active = false;
	private mouseIsDown = false;
	private webContents: any | null = null;
	private useNative = false;

	constructor() {
		this.webContents = getWebContents();
		this.useNative = this.webContents !== null;
	}

	dispatch(event: ContinuousGestureEvent): void {
		switch (event.type) {
			case "mode_enter":
				this.activate();
				break;
			case "mode_exit":
				this.deactivate();
				break;
			case "cursors_move":
				this.handleCursorsMove(event);
				break;
			case "zoom":
				this.handleZoom(event.x!, event.y!, event.zoomDelta!);
				break;
			case "mouse_down":
				this.handleMouseDown(event.x!, event.y!);
				break;
			case "mouse_up":
				this.handleMouseUp(event.x!, event.y!);
				break;
		}
	}

	destroy(): void {
		this.deactivate();
	}

	// --- Activation ---

	private activate(): void {
		if (this.active) return;
		this.active = true;
		this.ensureDot0();
	}

	private deactivate(): void {
		if (!this.active) return;
		if (this.mouseIsDown) {
			this.handleMouseUp(0, 0);
		}
		this.active = false;
		this.removeDots();
	}

	// --- Handlers ---

	private handleCursorsMove(event: ContinuousGestureEvent): void {
		const x0 = event.x!;
		const y0 = event.y!;
		const hasDual = event.x2 !== undefined && event.y2 !== undefined;

		// Primary dot (always visible in continuous mode)
		this.ensureDot0();
		this.dot0!.style.left = `${x0}px`;
		this.dot0!.style.top = `${y0}px`;

		if (hasDual) {
			// Zoom mode — show second dot
			this.ensureDot1();
			this.dot1!.style.left = `${event.x2}px`;
			this.dot1!.style.top = `${event.y2}px`;
		} else {
			// Cursor mode — hide second dot
			this.removeDot1();
		}

		// If dragging, send mousemove at cursor position
		if (this.mouseIsDown) {
			this.sendMouseMove(x0, y0);
		}
	}

	private handleZoom(x: number, y: number, zoomDelta: number): void {
		this.sendMouseMove(x, y);
		this.sendWheel(x, y, zoomDelta * 50);
	}

	private handleMouseDown(x: number, y: number): void {
		this.mouseIsDown = true;
		this.sendMouseMove(x, y);
		this.sendMouseDown(x, y);
	}

	private handleMouseUp(x: number, y: number): void {
		if (!this.mouseIsDown) return;
		this.mouseIsDown = false;
		this.sendMouseUp(x, y);
	}

	// --- Native / Synthetic event senders ---

	private sendMouseMove(x: number, y: number): void {
		if (this.useNative) {
			try {
				this.webContents.sendInputEvent({
					type: "mouseMove",
					x: Math.round(x),
					y: Math.round(y),
				});
				return;
			} catch { this.useNative = false; }
		}
		const target = document.elementFromPoint(x, y) ?? document.body;
		target.dispatchEvent(new MouseEvent("mousemove", {
			clientX: x, clientY: y,
			bubbles: true, cancelable: true, view: window,
		}));
	}

	private sendWheel(x: number, y: number, deltaY: number): void {
		if (this.useNative) {
			try {
				this.webContents.sendInputEvent({
					type: "mouseWheel",
					x: Math.round(x),
					y: Math.round(y),
					deltaX: 0,
					deltaY: Math.round(-deltaY),
					modifiers: ["ctrl"],
				});
				return;
			} catch { this.useNative = false; }
		}
		const target = document.elementFromPoint(x, y) ?? document.body;
		target.dispatchEvent(new WheelEvent("wheel", {
			clientX: x, clientY: y, deltaY,
			deltaMode: WheelEvent.DOM_DELTA_PIXEL,
			ctrlKey: true, bubbles: true, cancelable: true,
		}));
	}

	private sendMouseDown(x: number, y: number): void {
		if (this.useNative) {
			try {
				this.webContents.sendInputEvent({
					type: "mouseDown",
					x: Math.round(x), y: Math.round(y),
					button: "left", clickCount: 1,
				});
				return;
			} catch { this.useNative = false; }
		}
		const target = document.elementFromPoint(x, y) ?? document.body;
		target.dispatchEvent(new MouseEvent("mousedown", {
			clientX: x, clientY: y,
			bubbles: true, cancelable: true, view: window,
		}));
	}

	private sendMouseUp(x: number, y: number): void {
		if (this.useNative) {
			try {
				this.webContents.sendInputEvent({
					type: "mouseUp",
					x: Math.round(x), y: Math.round(y),
					button: "left", clickCount: 1,
				});
				return;
			} catch { this.useNative = false; }
		}
		const target = document.elementFromPoint(x, y) ?? document.body;
		target.dispatchEvent(new MouseEvent("mouseup", {
			clientX: x, clientY: y,
			bubbles: true, cancelable: true, view: window,
		}));
	}

	// --- Cursor dots ---

	private ensureDot0(): void {
		if (this.dot0) return;
		this.dot0 = this.makeDot("gesture-cursor-dot gesture-cursor-dot-0");
	}

	private ensureDot1(): void {
		if (this.dot1) return;
		this.dot1 = this.makeDot("gesture-cursor-dot gesture-cursor-dot-1");
	}

	private removeDot1(): void {
		if (this.dot1) { this.dot1.remove(); this.dot1 = null; }
	}

	private removeDots(): void {
		if (this.dot0) { this.dot0.remove(); this.dot0 = null; }
		this.removeDot1();
	}

	private makeDot(className: string): HTMLElement {
		const dot = document.createElement("div");
		dot.className = className;
		document.body.appendChild(dot);
		return dot;
	}
}
