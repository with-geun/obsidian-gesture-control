import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Notice } from "obsidian";
import { execFile } from "node:child_process";

const GITHUB_REPO = "with-geun/obsidian-gesture-control";
const ASSET_NAME = "gesture-control-native-macos.zip";

/**
 * Manages native asset downloads (GestureCamera.app + wasm/).
 *
 * On community plugin installs, only main.js/manifest.json/styles.css are delivered.
 * The user must explicitly install the native helper via the Settings UI button.
 * This is intentional -- downloading and executing a native binary should require
 * clear user consent, not happen silently on first launch.
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

	/** Get the download URL for the native assets zip */
	getDownloadUrl(version: string): string {
		return `https://github.com/${GITHUB_REPO}/releases/download/${version}/${ASSET_NAME}`;
	}

	/**
	 * Download and install native assets from the GitHub release.
	 * Called explicitly by the user via Settings UI "Install" button.
	 *
	 * Downloads from: https://github.com/{REPO}/releases/download/{version}/{ASSET_NAME}
	 * Extracts: GestureCamera.app/ (macOS camera helper) + wasm/ (MediaPipe WASM runtime)
	 */
	async downloadAssets(version: string): Promise<void> {
		const zipUrl = this.getDownloadUrl(version);

		const notice = new Notice("Gesture Control: Downloading native helper...", 0);

		try {
			const zipPath = join(this.pluginDir, ASSET_NAME);

			await this.exec("curl", ["-L", "--fail", "-o", zipPath, zipUrl]);
			notice.setMessage("Gesture Control: Extracting...");

			await this.exec("unzip", ["-o", zipPath, "-d", this.pluginDir]);

			// Make GestureCamera executable
			const execPath = join(this.pluginDir, "GestureCamera.app", "Contents", "MacOS", "GestureCamera");
			if (existsSync(execPath)) {
				await this.exec("chmod", ["+x", execPath]);
			}

			// Clean up zip
			try { unlinkSync(zipPath); } catch { /* ignore */ }

			notice.setMessage("Gesture Control: Native helper installed!");
			setTimeout(() => notice.hide(), 3000);

		} catch (err) {
			notice.hide();
			const msg = err instanceof Error ? err.message : String(err);
			throw new Error(
				`Failed to download native helper: ${msg}\n\n` +
				`Manual download: ${zipUrl}\n` +
				`Extract into: ${this.pluginDir}`
			);
		}
	}

	/** Remove native assets */
	async removeAssets(): Promise<void> {
		const appDir = join(this.pluginDir, "GestureCamera.app");
		const wasmDir = join(this.pluginDir, "wasm");
		// Use rm -rf for directories
		if (existsSync(appDir)) {
			await this.exec("rm", ["-rf", appDir]);
		}
		if (existsSync(wasmDir)) {
			await this.exec("rm", ["-rf", wasmDir]);
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
