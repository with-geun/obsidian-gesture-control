import { execFile } from "node:child_process";
import { Notice, Platform } from "obsidian";

export class SystemActionHandler {
	private previousVolume = 100;
	private isDictating = false;
	private dictationSetupDone = false;
	private accessibilityOk = false;

	async execute(actionId: string): Promise<boolean> {
		if (!Platform.isMacOS) {
			new Notice("This action is only available on macOS", 3000);
			return false;
		}

		switch (actionId) {
			case "gesture:dictation-toggle":
				await this.toggleDictation();
				return true;
			case "gesture:mic-toggle":
				await this.toggleMic();
				return true;
			case "gesture:mic-mute":
				await this.muteMic();
				return true;
			case "gesture:mic-unmute":
				await this.unmuteMic();
				return true;
			default:
				return false;
		}
	}

	// ── Dictation ──

	private async toggleDictation(): Promise<void> {
		// First-time: check accessibility + enable dictation
		if (!this.dictationSetupDone) {
			this.dictationSetupDone = true;

			// 1. Check Accessibility permission (required for System Events menu click)
			this.accessibilityOk = await this.checkAccessibility();
			if (!this.accessibilityOk) {
				new Notice(
					"Accessibility permission is required for Dictation.\n" +
					"System Settings → Privacy & Security → Accessibility → enable Obsidian",
					10000
				);
				await this.runShell(
					'open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"'
				);
				return;
			}

			// 2. Auto-enable dictation if not already on
			await this.ensureDictationEnabled();
		}

		if (!this.accessibilityOk) {
			// Re-check after user may have granted permission
			this.accessibilityOk = await this.checkAccessibility();
			if (!this.accessibilityOk) {
				new Notice(
					"Accessibility permission still not granted.\n" +
					"Please enable Obsidian in System Settings → Accessibility",
					5000
				);
				return;
			}
		}

		if (!this.isDictating) {
			const success = await this.startDictation();
			if (success) {
				this.isDictating = true;
				new Notice("Dictation started", 2000);
			}
		} else {
			await this.stopDictation();
			this.isDictating = false;
			new Notice("Dictation stopped", 2000);
		}
	}

	private async startDictation(): Promise<boolean> {
		// Click Edit > Start Dictation via System Events menu
		const result = await this.runOsascript(
			'tell application "System Events"\n' +
			'tell process "Obsidian"\n' +
			'set found to false\n' +
			'repeat with mi in menu bar items of menu bar 1\n' +
			'if not found then\n' +
			'try\n' +
			'set itemList to name of every menu item of menu 1 of mi\n' +
			'repeat with itemName in itemList\n' +
			'if itemName contains "Dictation" or itemName contains "받아쓰기" then\n' +
			'click menu item itemName of menu 1 of mi\n' +
			'set found to true\n' +
			'exit repeat\n' +
			'end if\n' +
			'end repeat\n' +
			'end try\n' +
			'end if\n' +
			'end repeat\n' +
			'if not found then return "not_found"\n' +
			'return "ok"\n' +
			'end tell\n' +
			'end tell'
		);

		if (result.trim() === "not_found") {
			new Notice(
				"Dictation menu item not found.\n" +
				"Enable Dictation in System Settings → Keyboard → Dictation",
				8000
			);
			await this.runShell(
				'open "x-apple.systempreferences:com.apple.Keyboard-Settings.extension"'
			);
			return false;
		}
		return true;
	}

	private stopDictation(): Promise<void> {
		// Escape key reliably stops macOS dictation
		return this.runOsascript(
			'tell application "System Events" to key code 53'
		).then(() => {});
	}

	/** Reset dictation state (e.g., if macOS auto-stopped) */
	resetDictationState(): void {
		this.isDictating = false;
	}

	// ── Mic Volume ──

	private async toggleMic(): Promise<void> {
		const current = await this.getMicVolume();
		if (current > 0) {
			this.previousVolume = current;
			await this.setMicVolume(0);
			new Notice("Mic muted", 2000);
		} else {
			const restore = this.previousVolume > 0 ? this.previousVolume : 100;
			await this.setMicVolume(restore);
			new Notice(`Mic unmuted (vol: ${restore})`, 2000);
		}
	}

	private async muteMic(): Promise<void> {
		const current = await this.getMicVolume();
		if (current > 0) this.previousVolume = current;
		await this.setMicVolume(0);
		new Notice("Mic muted", 2000);
	}

	private async unmuteMic(): Promise<void> {
		const restore = this.previousVolume > 0 ? this.previousVolume : 100;
		await this.setMicVolume(restore);
		new Notice(`Mic unmuted (vol: ${restore})`, 2000);
	}

	private async getMicVolume(): Promise<number> {
		const stdout = await this.runOsascript("input volume of (get volume settings)");
		const vol = parseInt(stdout.trim(), 10);
		return isNaN(vol) ? 0 : vol;
	}

	private setMicVolume(vol: number): Promise<void> {
		return this.runOsascript(`set volume input volume ${vol}`).then(() => {});
	}

	// ── Setup helpers ──

	/** Check Accessibility permission by attempting a System Events action */
	private async checkAccessibility(): Promise<boolean> {
		const result = await this.runOsascript(
			'try\n' +
			'tell application "System Events" to name of first process\n' +
			'return "ok"\n' +
			'on error\n' +
			'return "denied"\n' +
			'end try'
		);
		return result.trim() === "ok";
	}

	/** Enable macOS Dictation via defaults if not already on */
	private async ensureDictationEnabled(): Promise<void> {
		try {
			const result = await this.runShell(
				"defaults read com.apple.HIToolbox AppleDictationAutoEnable 2>/dev/null || echo 0"
			);
			if (result.trim() === "1") return;

			// Enable dictation and notify user
			await this.runShell("defaults write com.apple.HIToolbox AppleDictationAutoEnable -int 1");
			new Notice(
				"macOS Dictation has been auto-enabled.\n" +
				"If dictation doesn't work, enable it manually:\n" +
				"System Settings → Keyboard → Dictation",
				8000
			);
		} catch {
			// non-critical
		}
	}

	// ── Shell helpers ──

	private runShell(cmd: string): Promise<string> {
		return new Promise((resolve) => {
			execFile("/bin/sh", ["-c", cmd], (err, stdout) => {
				if (err) {
					console.warn("[GestureControl] shell error:", err);
				}
				resolve(stdout ?? "");
			});
		});
	}

	private runOsascript(script: string): Promise<string> {
		return new Promise((resolve) => {
			execFile("osascript", ["-e", script], (err, stdout) => {
				if (err) {
					console.warn("[GestureControl] osascript error:", err);
				}
				resolve(stdout ?? "");
			});
		});
	}
}
