import AppKit

let appDelegate = AppDelegate()
NSApplication.shared.delegate = appDelegate
NSApplication.shared.setActivationPolicy(.regular)
NSApplication.shared.run()
