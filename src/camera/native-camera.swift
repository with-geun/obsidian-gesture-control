import AVFoundation
import Cocoa
import CoreImage

// Native camera capture helper for Obsidian Gesture Control plugin.
// Launched via `open -a GestureCamera.app` so macOS TCC recognizes the bundle.
// Writes JPEG frames to a temp file (atomic). Plugin polls for new frames.
// Status is written to a status file (not stderr) since `open` doesn't pipe stdio.
//
// Usage: GestureCamera [fps] [width] [height] [frame_path] [status_path] [parent_pid]

let fps = CommandLine.arguments.count > 1 ? Int(CommandLine.arguments[1]) ?? 15 : 15
let width = CommandLine.arguments.count > 2 ? Int(CommandLine.arguments[2]) ?? 640 : 640
let height = CommandLine.arguments.count > 3 ? Int(CommandLine.arguments[3]) ?? 480 : 480
let framePath = CommandLine.arguments.count > 4 ? CommandLine.arguments[4] : "/tmp/gesture-control-frame.jpg"
let statusPath = CommandLine.arguments.count > 5 ? CommandLine.arguments[5] : "/tmp/gesture-control-status"
let parentPid: pid_t = CommandLine.arguments.count > 6 ? pid_t(CommandLine.arguments[6]) ?? 0 : 0

let pidPath = "/tmp/gesture-control-pid"

// Write status to file (plugin polls this) + stderr (for terminal debug)
func writeStatus(_ msg: String) {
    try? msg.write(toFile: statusPath, atomically: true, encoding: .utf8)
    FileHandle.standardError.write("[GestureCamera] \(msg)\n".data(using: .utf8)!)
}

class CameraCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    let session = AVCaptureSession()
    let context = CIContext()
    var lastTime: CFAbsoluteTime = 0
    let minInterval: CFAbsoluteTime

    init(fps: Int) {
        self.minInterval = 1.0 / Double(fps)
        super.init()
    }

    func start() -> Bool {
        let authStatus = AVCaptureDevice.authorizationStatus(for: .video)
        writeStatus("CAM_AUTH: \(authStatus.rawValue)")

        if authStatus == .notDetermined {
            writeStatus("REQUESTING_ACCESS...")
            var granted = false
            var responded = false
            AVCaptureDevice.requestAccess(for: .video) { result in
                granted = result
                responded = true
            }
            // RunLoop keeps main thread alive so macOS permission dialog can appear
            while !responded {
                RunLoop.main.run(mode: .default, before: Date(timeIntervalSinceNow: 0.1))
            }
            if !granted {
                writeStatus("ERROR: Camera permission denied by user")
                return false
            }
            writeStatus("ACCESS_GRANTED: true")
        } else if authStatus != .authorized {
            writeStatus("ERROR: Camera access denied (status=\(authStatus.rawValue)). Open System Settings > Privacy > Camera")
            return false
        }

        session.sessionPreset = .vga640x480

        guard let device = AVCaptureDevice.default(for: .video) else {
            writeStatus("ERROR: No camera found")
            return false
        }

        guard let input = try? AVCaptureDeviceInput(device: device) else {
            writeStatus("ERROR: Cannot access camera")
            return false
        }

        if !session.canAddInput(input) {
            writeStatus("ERROR: Cannot add camera input")
            return false
        }
        session.addInput(input)

        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA
        ]
        output.alwaysDiscardsLateVideoFrames = true

        let queue = DispatchQueue(label: "camera.capture")
        output.setSampleBufferDelegate(self, queue: queue)

        if !session.canAddOutput(output) {
            writeStatus("ERROR: Cannot add camera output")
            return false
        }
        session.addOutput(output)

        session.startRunning()

        // Signal ready
        writeStatus("READY")

        // Watchdog
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            if self?.lastTime == 0 {
                writeStatus("WARN: No frames received after 3s")
            }
        }

        return true
    }

    var framesSent = 0

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        let now = CFAbsoluteTimeGetCurrent()
        if now - lastTime < minInterval { return }
        lastTime = now

        framesSent += 1

        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }

        let ciImage = CIImage(cvImageBuffer: imageBuffer)
        let scaleX = CGFloat(width) / ciImage.extent.width
        let scaleY = CGFloat(height) / ciImage.extent.height
        let scaled = ciImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

        guard let cgImage = context.createCGImage(scaled, from: CGRect(x: 0, y: 0, width: width, height: height)) else { return }

        let bitmapRep = NSBitmapImageRep(cgImage: cgImage)
        guard let jpegData = bitmapRep.representation(using: .jpeg, properties: [.compressionFactor: 0.7]) else { return }

        do {
            try jpegData.write(to: URL(fileURLWithPath: framePath), options: .atomic)
        } catch {
            // skip write errors silently
        }
    }
}

// Write our PID so the plugin can kill us on stop
try? "\(ProcessInfo.processInfo.processIdentifier)".write(toFile: pidPath, atomically: true, encoding: .utf8)

// Handle SIGPIPE
signal(SIGPIPE, SIG_IGN)

// Handle SIGTERM — clean up and exit
signal(SIGTERM) { _ in
    try? FileManager.default.removeItem(atPath: framePath)
    try? FileManager.default.removeItem(atPath: statusPath)
    try? FileManager.default.removeItem(atPath: pidPath)
    exit(0)
}

// Monitor parent process liveness + PID file existence
DispatchQueue.global().async {
    while true {
        Thread.sleep(forTimeInterval: 2.0)

        // If PID file was deleted by plugin, exit
        if !FileManager.default.fileExists(atPath: pidPath) {
            try? FileManager.default.removeItem(atPath: framePath)
            try? FileManager.default.removeItem(atPath: statusPath)
            exit(0)
        }

        // If parent PID was provided and parent is dead, exit
        if parentPid > 0 && kill(parentPid, 0) != 0 {
            try? FileManager.default.removeItem(atPath: framePath)
            try? FileManager.default.removeItem(atPath: statusPath)
            try? FileManager.default.removeItem(atPath: pidPath)
            exit(0)
        }
    }
}

let capture = CameraCapture(fps: fps)
if !capture.start() {
    try? FileManager.default.removeItem(atPath: pidPath)
    exit(1)
}

RunLoop.main.run()
