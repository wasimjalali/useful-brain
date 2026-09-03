import AppKit
import UsefulBrainCore

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let config = ServerConfig.resolved()
    private lazy var controller = ServerController(
        config: config,
        poller: HealthPoller(probe: URLSessionHealthProbe())
    )
    private var windowController: MainWindowController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()

        let wc = MainWindowController(config: config, controller: controller)
        windowController = wc
        wc.showWindow(nil)
        wc.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        controller.onStateChange = { [weak self] state in
            DispatchQueue.main.async { self?.windowController?.render(state: state) }
        }
        controller.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        controller.stop()
    }

    @objc func startServer() {
        controller.start()
    }

    @objc func stopServer() {
        controller.stop()
    }

    @objc func reloadPage() {
        windowController?.reload()
    }

    @objc func showLog() {
        NSWorkspace.shared.open(ServerController.defaultLogFile().deletingLastPathComponent())
    }

    private func buildMenu() {
        let main = NSMenu()

        let appRoot = NSMenuItem()
        main.addItem(appRoot)
        let appMenu = NSMenu()
        appMenu.addItem(NSMenuItem(
            title: "Quit Useful Brain",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        ))
        appRoot.submenu = appMenu

        let viewRoot = NSMenuItem()
        main.addItem(viewRoot)
        let viewMenu = NSMenu(title: "View")
        let reload = NSMenuItem(title: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        reload.target = self
        viewMenu.addItem(reload)
        viewRoot.submenu = viewMenu

        let serverRoot = NSMenuItem()
        main.addItem(serverRoot)
        let serverMenu = NSMenu(title: "Server")
        let start = NSMenuItem(title: "Start", action: #selector(startServer), keyEquivalent: "")
        start.target = self
        let stop = NSMenuItem(title: "Stop", action: #selector(stopServer), keyEquivalent: "")
        stop.target = self
        let log = NSMenuItem(title: "Show Log in Finder", action: #selector(showLog), keyEquivalent: "")
        log.target = self
        serverMenu.addItem(start)
        serverMenu.addItem(stop)
        serverMenu.addItem(log)
        serverRoot.submenu = serverMenu

        NSApp.mainMenu = main
    }
}
