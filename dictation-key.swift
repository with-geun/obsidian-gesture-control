import CoreGraphics
import Foundation

// Post Control key press twice at HID level to trigger macOS Dictation
let src = CGEventSource(stateID: .hidSystemState)

func pressControl() {
    let down = CGEvent(keyboardEventSource: src, virtualKey: 0x3B, keyDown: true)
    let up = CGEvent(keyboardEventSource: src, virtualKey: 0x3B, keyDown: false)
    down?.flags = .maskControl
    down?.post(tap: .cghidEventTap)
    up?.post(tap: .cghidEventTap)
}

pressControl()
usleep(120000) // 120ms between presses
pressControl()
