import { GestureType, GestureMapping } from "../types";

export type StatusState = "off" | "ready" | "hand" | "fired" | "continuous";

const GESTURE_ICONS: Partial<Record<GestureType, string>> = {
	[GestureType.Palm]: "\u270b",
	[GestureType.Fist]: "\u270a",
	[GestureType.ThumbUp]: "\ud83d\udc4d",
	[GestureType.ThumbDown]: "\ud83d\udc4e",
	[GestureType.Victory]: "\u270c\ufe0f",
	[GestureType.ILoveYou]: "\ud83e\udd1f",
	[GestureType.OK]: "\ud83d\udc4c",
	[GestureType.Three]: "\u261d\ufe0f",
	[GestureType.Pointing]: "\u261d\ufe0f",
	[GestureType.Pinch]: "\ud83e\udd0f",
};

const STATE_CSS: Record<StatusState, string> = {
	off: "gesture-ribbon-off",
	ready: "gesture-ribbon-ready",
	hand: "gesture-ribbon-hand",
	fired: "gesture-ribbon-fired",
	continuous: "gesture-ribbon-continuous",
};

export class StatusDisplay {
	private ribbonEl: HTMLElement | null = null;
	private statusBarEl: HTMLElement | null = null;
	private state: StatusState = "off";
	private firedTimer: ReturnType<typeof setTimeout> | null = null;

	setRibbonEl(el: HTMLElement): void {
		this.ribbonEl = el;
		this.applyRibbonState();
	}

	setStatusBarEl(el: HTMLElement): void {
		this.statusBarEl = el;
	}

	/** Update display state — called from main plugin */
	update(
		cameraActive: boolean,
		handDetected: boolean,
		firedGesture: GestureType | null,
		mappings: GestureMapping[],
		getCommandName: (id: string) => string,
		continuousMode?: string
	): void {
		if (!cameraActive) {
			this.setState("off");
			this.setStatusText("Gesture: OFF");
			return;
		}

		// Continuous mode takes priority
		if (continuousMode) {
			this.setState("continuous");
			const modeLabel =
				continuousMode === "zooming" ? "Zoom (two hands)"
				: continuousMode === "clicking" ? "Dragging..."
				: "Cursor (quick=click, hold=drag)";
			this.setStatusText(`Continuous: ${modeLabel}`);
			return;
		}

		if (firedGesture) {
			this.setState("fired");
			const mapping = mappings.find((m) => m.gesture === firedGesture);
			const icon = GESTURE_ICONS[firedGesture] ?? "";
			const cmdName = mapping?.commandId
				? getCommandName(mapping.commandId)
				: "";
			this.setStatusText(`${icon} ${firedGesture} → ${cmdName}`);

			// Revert to hand/ready after 2s
			this.clearFiredTimer();
			this.firedTimer = setTimeout(() => {
				this.setState(handDetected ? "hand" : "ready");
				this.setStatusText(
					handDetected ? "Gesture: Hand detected" : "Gesture: Ready"
				);
			}, 2000);
			return;
		}

		if (handDetected) {
			this.setState("hand");
			this.setStatusText("Gesture: Hand detected");
		} else {
			this.setState("ready");
			this.setStatusText("Gesture: Ready");
		}
	}

	destroy(): void {
		this.clearFiredTimer();
	}

	private setState(state: StatusState): void {
		this.state = state;
		this.applyRibbonState();
	}

	private applyRibbonState(): void {
		if (!this.ribbonEl) return;
		// Remove all state classes
		for (const cls of Object.values(STATE_CSS)) {
			this.ribbonEl.removeClass(cls);
		}
		this.ribbonEl.addClass(STATE_CSS[this.state]);
	}

	private setStatusText(text: string): void {
		if (!this.statusBarEl) return;
		this.statusBarEl.setText(text);
	}

	private clearFiredTimer(): void {
		if (this.firedTimer !== null) {
			clearTimeout(this.firedTimer);
			this.firedTimer = null;
		}
	}
}
