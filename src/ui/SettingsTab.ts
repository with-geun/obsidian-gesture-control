import {
	App,
	FuzzySuggestModal,
	PluginSettingTab,
	Setting,
	Command,
} from "obsidian";
import { GestureType, GestureMapping, CUSTOM_ACTIONS, CUSTOM_ACTION_PREFIX, PreviewMode } from "../types";
import type GestureControlPlugin from "../main";

const GESTURE_LABELS: Record<string, string> = {
	[GestureType.Palm]: "Open Palm",
	[GestureType.Fist]: "Fist",
	[GestureType.ThumbUp]: "Thumb Up",
	[GestureType.ThumbDown]: "Thumb Down",
	[GestureType.Victory]: "Victory",
	[GestureType.ILoveYou]: "I Love You",
	[GestureType.OK]: "OK",
	[GestureType.Three]: "Three",
};

const GESTURE_ICONS: Record<string, string> = {
	[GestureType.Palm]: "\u270b",
	[GestureType.Fist]: "\u270a",
	[GestureType.ThumbUp]: "\ud83d\udc4d",
	[GestureType.ThumbDown]: "\ud83d\udc4e",
	[GestureType.Victory]: "\u270c\ufe0f",
	[GestureType.ILoveYou]: "\ud83e\udd1f",
	[GestureType.OK]: "\ud83d\udc4c",
	[GestureType.Three]: "\u261d\ufe0f3",
};

/** Unified item for command suggest modal (custom action or Obsidian command) */
interface CommandItem {
	id: string;
	name: string;
}

/** Modal for picking a command (custom actions + Obsidian commands) */
class CommandSuggestModal extends FuzzySuggestModal<CommandItem> {
	private items: CommandItem[];
	private onChoose: (item: CommandItem) => void;

	constructor(app: App, onChoose: (item: CommandItem) => void) {
		super(app);

		// Custom actions first
		const customItems: CommandItem[] = CUSTOM_ACTIONS.map(a => ({
			id: a.id,
			name: `${a.icon} ${a.name}`,
		}));

		// Obsidian commands
		// @ts-ignore — internal API
		const obsidianCmds = Object.values(app.commands.commands) as Command[];
		const obsidianItems: CommandItem[] = obsidianCmds.map(c => ({
			id: c.id,
			name: c.name,
		}));

		this.items = [...customItems, ...obsidianItems];
		this.onChoose = onChoose;
		this.setPlaceholder("Search commands...");
	}

	getItems(): CommandItem[] {
		return this.items;
	}

	getItemText(item: CommandItem): string {
		return item.name;
	}

	onChooseItem(item: CommandItem): void {
		this.onChoose(item);
	}
}

export class SettingsTab extends PluginSettingTab {
	plugin: GestureControlPlugin;

	constructor(app: App, plugin: GestureControlPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// — Gesture Mappings —
		containerEl.createEl("h2", { text: "Gesture Mappings" });

		for (const mapping of this.plugin.settings.gestureMappings) {
			this.addGestureSection(containerEl, mapping);
		}

		// — Global Settings —
		containerEl.createEl("h2", { text: "Detection Settings" });

		new Setting(containerEl)
			.setName("Confidence threshold")
			.setDesc("Minimum confidence to recognize a gesture (0.5 ~ 1.0)")
			.addSlider((slider) =>
				slider
					.setLimits(0.5, 1.0, 0.05)
					.setValue(this.plugin.settings.confidenceThreshold)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.confidenceThreshold = value;
						this.plugin.classifier.setThreshold(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Dwell time (ms)")
			.setDesc("Hold gesture this long before it activates (200 ~ 1500)")
			.addSlider((slider) =>
				slider
					.setLimits(200, 1500, 50)
					.setValue(this.plugin.settings.dwellTime)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.dwellTime = value;
						this.plugin.stabilizer.setDwellTime(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Cooldown time (ms)")
			.setDesc(
				"Wait this long after activation before allowing next gesture (300 ~ 3000)"
			)
			.addSlider((slider) =>
				slider
					.setLimits(300, 3000, 100)
					.setValue(this.plugin.settings.cooldownTime)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.cooldownTime = value;
						this.plugin.stabilizer.setCooldownTime(value);
						await this.plugin.saveSettings();
					})
			);

		// — Continuous Gesture Settings —
		containerEl.createEl("h2", { text: "Continuous Gestures (Two-Hand)" });
		containerEl.createEl("p", {
			text: "Point both index fingers to enter continuous mode. Spread/pinch to zoom. Extend thumb to click/drag.",
			cls: "setting-item-description",
		});

		const cs = this.plugin.settings.continuous;

		new Setting(containerEl)
			.setName("Enable continuous gestures")
			.setDesc("Both hands pointing → cursor + zoom + click/drag")
			.addToggle((toggle) =>
				toggle.setValue(cs.enabled).onChange(async (value) => {
					cs.enabled = value;
					this.plugin.applySettings();
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("Cursor smoothing")
			.setDesc("Lower = smoother but more lag (0.1 ~ 0.8)")
			.addSlider((slider) =>
				slider
					.setLimits(0.1, 0.8, 0.05)
					.setValue(cs.smoothingAlpha)
					.setDynamicTooltip()
					.onChange(async (value) => {
						cs.smoothingAlpha = value;
						this.plugin.applySettings();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Zoom sensitivity")
			.setDesc("Higher = faster zoom (5 ~ 50)")
			.addSlider((slider) =>
				slider
					.setLimits(5, 50, 1)
					.setValue(cs.zoomSensitivity)
					.setDynamicTooltip()
					.onChange(async (value) => {
						cs.zoomSensitivity = value;
						this.plugin.applySettings();
						await this.plugin.saveSettings();
					})
			);

		// — Camera Preview Settings —
		containerEl.createEl("h2", { text: "Camera Preview" });

		const ps = this.plugin.settings.preview;

		new Setting(containerEl)
			.setName("Display mode")
			.setDesc("Skeleton: black background + hand bones. Camera: live feed. Hidden: no preview.")
			.addDropdown((dd) =>
				dd
					.addOption("skeleton", "Skeleton")
					.addOption("camera", "Camera")
					.addOption("hidden", "Hidden")
					.setValue(ps.mode)
					.onChange(async (value) => {
						ps.mode = value as PreviewMode;
						this.plugin.applySettings();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Preview size")
			.setDesc("Width in pixels (160 ~ 480)")
			.addSlider((slider) =>
				slider
					.setLimits(160, 480, 16)
					.setValue(ps.width)
					.setDynamicTooltip()
					.onChange(async (value) => {
						ps.width = value;
						this.plugin.applySettings();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Reset position")
			.setDesc("Move preview back to bottom-right corner")
			.addButton((btn) =>
				btn.setButtonText("Reset").onClick(async () => {
					ps.x = -1;
					ps.y = -1;
					this.plugin.camera.resetPosition();
					await this.plugin.saveSettings();
				})
			);
	}

	private addGestureSection(
		containerEl: HTMLElement,
		mapping: GestureMapping
	): void {
		const icon = GESTURE_ICONS[mapping.gesture];
		const label = GESTURE_LABELS[mapping.gesture];

		// Enable toggle
		new Setting(containerEl)
			.setName(`${icon} ${label}`)
			.setDesc(this.getCommandName(mapping.commandId))
			.addToggle((toggle) =>
				toggle.setValue(mapping.enabled).onChange(async (value) => {
					mapping.enabled = value;
					await this.plugin.saveSettings();
					this.plugin.applySettings();
				})
			)
			.addButton((btn) =>
				btn.setButtonText("Change command").onClick(() => {
					new CommandSuggestModal(this.app, async (item) => {
						mapping.commandId = item.id;
						await this.plugin.saveSettings();
						this.plugin.applySettings();
						this.display(); // refresh UI
					}).open();
				})
			);
	}

	private getCommandName(commandId: string): string {
		if (!commandId) return "No command assigned";
		// Custom action name
		if (commandId.startsWith(CUSTOM_ACTION_PREFIX)) {
			const action = CUSTOM_ACTIONS.find(a => a.id === commandId);
			if (!action) return commandId;
			const macOnly = action.id.includes("dictation") || action.id.includes("mic")
				? " (macOS)" : "";
			return `${action.icon} ${action.name}${macOnly}`;
		}
		// @ts-ignore — internal API
		const cmd = this.app.commands.commands[commandId];
		return cmd?.name ?? commandId;
	}
}
