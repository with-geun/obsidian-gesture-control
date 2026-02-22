import { existsSync } from "node:fs";
import { join } from "node:path";
import { Notice } from "obsidian";
import { execFile } from "node:child_process";

const GITHUB_REPO = "with-geun/obsidian-gesture-control";
const ASSET_NAME = "gesture-control-native-macos.zip";

/**
 * Manages native asset downloads (GestureCamera.app + wasm/).
 * On community plugin installs, only main.js/manifest.json/styles.css are delivered.
 * This module downloads the rest from GitHub Releases on first launch.
 */
export class AssetManager {
	private pluginDir: string;

	constructor(pluginDir: string) {
		this.pluginDir = pluginDir;
	}

	/** Check if both GestureCamera.app and wasm/ exist */
	hasNativeAssets(): boolean {
		const appPath = join(this.pluginDir, "GestureCamera.app", "Contents", "MacOS", "GestureCamera");
		const wasmJs = join(this.pluginDir, "wasm", "vision_wasm_internal.js");
		const wasmBin = join(this.pluginDir, "wasm", "vision_wasm_internal.wasm");
		return existsSync(appPath) && existsSync(wasmJs) && existsSync(wasmBin);
	}

	/**
	 * Download native assets from the GitHub release matching the plugin version.
	 * Uses manifest.json version to find the correct release tag.
	 */
	async downloadAssets(version: string): Promise<void> {
		const zipUrl = `https://github.com/${GITHUB_REPO}/releases/download/${version}/${ASSET_NAME}`;

		const notice = new Notice("Gesture Control: Downloading native assets...", 0);

		try {
			// Download zip using curl (available on all macOS)
			const zipPath = join(this.pluginDir, ASSET_NAME);

			await this.exec("curl", ["-L", "-o", zipPath, zipUrl]);
			notice.setMessage("Gesture Control: Extracting native assets...");

			// Extract zip into plugin directory
			await this.exec("unzip", ["-o", zipPath, "-d", this.pluginDir]);

			// Make GestureCamera executable
			const execPath = join(this.pluginDir, "GestureCamera.app", "Contents", "MacOS", "GestureCamera");
			if (existsSync(execPath)) {
				await this.exec("chmod", ["+x", execPath]);
			}

			// Clean up zip
			try {
				const { unlinkSync } = require("node:fs");
				unlinkSync(zipPath);
			} catch { /* ignore */ }

			notice.setMessage("Gesture Control: Native assets ready!");
			setTimeout(() => notice.hide(), 3000);

		} catch (err) {
			notice.hide();
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Failed to download native assets: ${msg}\n\n` +
				`You can download manually from:\n` +
				`https://github.com/${GITHUB_REPO}/releases/download/${version}/${ASSET_NAME}\n` +
				`Extract into: ${this.pluginDir}`
			);
		}
	}

	private exec(cmd: string, args: string[]): Promise<string> {
		return new Promise((resolve, reject) => {
			execFile(cmd, args, { timeout: 120000 }, (err, stdout, stderr) => {
				if (err) {
					reject(new Error(`${cmd} failed: ${stderr || err.message}`));
				} else {
					resolve(stdout);
				}
			});
		});
	}
}
