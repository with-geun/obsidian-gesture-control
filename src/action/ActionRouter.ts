import { App, Notice } from "obsidian";
import { GestureType, GestureMapping, CUSTOM_ACTION_PREFIX, CUSTOM_ACTIONS } from "../types";
import { SystemActionHandler } from "./SystemActionHandler";

const GESTURE_LABELS: Record<string, string> = {
	[GestureType.Palm]: "Palm",
	[GestureType.Fist]: "Fist",
	[GestureType.ThumbUp]: "Thumb Up",
	[GestureType.ThumbDown]: "Thumb Down",
	[GestureType.Victory]: "Victory",
	[GestureType.ILoveYou]: "I Love You",
	[GestureType.OK]: "OK",
	[GestureType.Three]: "Three",
};

export class ActionRouter {
	private app: App;
	private mappings: GestureMapping[] = [];
	private systemHandler: SystemActionHandler = new SystemActionHandler();

	constructor(app: App) {
		this.app = app;
	}

	setMappings(mappings: GestureMapping[]): void {
		this.mappings = mappings;
	}

	async execute(gesture: GestureType): Promise<boolean> {
		const mapping = this.mappings.find(
			(m) => m.gesture === gesture && m.enabled && m.commandId
		);

		if (!mapping) return false;

		const commandId = mapping.commandId;
		const label = GESTURE_LABELS[gesture];

		// Custom action (gesture: prefix)
		if (commandId.startsWith(CUSTOM_ACTION_PREFIX)) {
			const success = await this.systemHandler.execute(commandId);
			if (!success) {
				console.warn(`[GestureControl] Unknown custom action: ${commandId}`);
			}
			return success;
		}

		// Obsidian command
		// @ts-ignore — Obsidian internal API
		const success = this.app.commands.executeCommandById(commandId);

		if (success) {
			const cmdName = this.getCommandName(commandId);
			new Notice(`${label} → ${cmdName}`, 2000);
		} else {
			console.warn(
				`[GestureControl] Command not found: ${commandId}`
			);
		}

		return !!success;
	}

	getCommandName(commandId: string): string {
		// Custom action name lookup
		if (commandId.startsWith(CUSTOM_ACTION_PREFIX)) {
			const action = CUSTOM_ACTIONS.find(a => a.id === commandId);
			return action ? `${action.icon} ${action.name}` : commandId;
		}
		// @ts-ignore — Obsidian internal API
		const cmd = this.app.commands.commands[commandId];
		return cmd?.name ?? commandId;
	}
}
