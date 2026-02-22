# Gesture Control for Obsidian

Control Obsidian with hand gestures via your webcam. No mouse, no keyboard -- just your hands.

> **macOS only** -- requires camera and Accessibility permissions.

<!-- TODO: Add demo GIF here -->
<!-- ![Demo](docs/demo.gif) -->

## Features

- **8 hand gestures** mapped to any Obsidian command (Palm, Fist, Thumb Up/Down, Victory, ILoveYou, OK, Three)
- **Continuous mode** -- point with both hands to enter zoom/cursor/click/drag mode
  - Two-hand pinch zoom
  - Single-hand cursor control
  - Thumb trigger for click and drag
- **Camera preview HUD** -- cyberpunk-style skeleton overlay, draggable and resizable
- **Dictation toggle** -- trigger macOS Dictation with a gesture
- **Mic toggle** -- mute/unmute microphone with a gesture
- **Custom action system** -- extend beyond Obsidian commands with system-level actions
- **Privacy-first** -- all processing happens locally, no data leaves your machine

## Installation

### Community Plugins (Recommended)

1. Open Obsidian Settings > Community plugins
2. Click "Browse" and search for **Gesture Control**
3. Click Install, then Enable
4. Native assets (camera app + WASM files) will be downloaded automatically on first launch

### Manual Install

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/with-geun/obsidian-gesture-control/releases)
2. Create `<vault>/.obsidian/plugins/gesture-control/`
3. Place the downloaded files in that folder
4. Download `gesture-control-native-macos.zip` from the same release
5. Extract it into the plugin folder (should produce `GestureCamera.app/` and `wasm/`)
6. Enable "Gesture Control" in Settings > Community plugins

## Getting Started

1. Click the **hand icon** in the ribbon (left sidebar) or run **"Toggle Gesture Camera"** from the command palette
2. macOS will ask for **camera permission** -- allow it
3. A camera preview appears in the bottom-right corner showing a skeleton overlay of your hand
4. Show your hand and try a gesture!

## Gestures

### Discrete Gestures

Each gesture triggers a mapped Obsidian command after holding it for the configured dwell time.

| Gesture | Default Action | How to Make |
|---------|---------------|-------------|
| Open Palm | Toggle left sidebar | All 5 fingers extended |
| Fist | Navigate back | All fingers curled |
| Thumb Up | Dictation toggle | Only thumb extended upward |
| Victory | New file | Index + middle finger extended (peace sign) |
| ILoveYou | Command palette | Thumb + index + pinky extended |
| OK | *(not set)* | Thumb tip touches index tip, others extended |
| Thumb Down | *(not set)* | Only thumb extended downward |
| Three | *(not set)* | Index + middle + ring extended |

All mappings are fully configurable in Settings.

### Continuous Mode

Point with **both hands** (index finger only) to enter continuous mode:

1. **Zoom phase** -- two tracking dots appear; move hands apart/together to zoom in/out
2. **Cursor phase** -- remove one hand; the remaining hand controls the cursor
3. **Click** -- quickly extend and retract your thumb
4. **Drag** -- extend your thumb and hold to start dragging, retract to release

## Settings

Open **Settings > Gesture Control** to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| Confidence Threshold | 0.7 | How certain detection must be (0.5--1.0) |
| Dwell Time | 500ms | How long to hold a gesture before triggering (200--1500ms) |
| Cooldown Time | 1000ms | Minimum wait between triggers (300--3000ms) |
| Gesture Mappings | *(see above)* | Map each gesture to any Obsidian command or custom action |
| Continuous Mode | Enabled | Enable/disable zoom + cursor mode |
| Preview Mode | Skeleton | Camera feed, skeleton only, or hidden |
| Preview Size | 320px | Resizable 160--480px, maintains 4:3 ratio |

## Requirements

- **macOS** (Apple Silicon or Intel)
- Webcam (built-in or external)
- Obsidian 1.0.0+
- **Camera permission** for GestureCamera
- **Accessibility permission** for Dictation/Mic features (optional)
- Internet connection on first launch (downloads hand tracking model from Google CDN)

## Privacy

- All video processing runs **locally** using MediaPipe WASM -- no cloud APIs
- **No images or video are stored, recorded, or transmitted**
- Camera frames exist only in memory and a temporary file (`/tmp/gesture-control-frame.jpg`) deleted when camera stops
- The hand tracking model is downloaded once from Google's CDN and cached locally
- The plugin makes no network requests after initial setup

## Troubleshooting

**Camera permission denied**
Go to System Settings > Privacy & Security > Camera and allow Obsidian (or GestureCamera).

**Camera started but no hand detected**
Make sure your hand is visible and well-lit. The skeleton overlay should appear when a hand is detected.

**Gesture triggers too easily / not easily enough**
Adjust Confidence Threshold and Dwell Time in Settings.

**Dictation not working**
Ensure Accessibility permission is granted in System Settings > Privacy & Security > Accessibility for Obsidian. Also verify that Dictation is enabled in System Settings > Keyboard > Dictation.

**Plugin not loading after community install**
Click the hand icon to trigger first launch -- native assets will be downloaded automatically. If it fails, check your internet connection and try again.

**Native assets download failed**
Download `gesture-control-native-macos.zip` manually from the [releases page](https://github.com/with-geun/obsidian-gesture-control/releases) and extract it into the plugin folder.

## Development

```bash
# Clone
git clone https://github.com/with-geun/obsidian-gesture-control.git
cd obsidian-gesture-control

# Install
npm install

# Dev (watch mode)
npm run dev

# Build
npm run build
```

### Native Camera Build (macOS)

```bash
swiftc -O -o GestureCamera.app/Contents/MacOS/GestureCamera src/camera/native-camera.swift \
  -framework AVFoundation -framework CoreImage -framework Cocoa
```

## License

[MIT](LICENSE)
