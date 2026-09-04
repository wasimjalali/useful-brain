import AppKit
import UsefulBrainCore
import WebKit

final class MainWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate {
    private let config: ServerConfig
    private let controller: ServerController

    private let webView: WKWebView
    private let statusBox = NSView()
    private let statusLabel = NSTextField(labelWithString: "Starting server")
    private let statusDetail = NSTextField(labelWithString: "")
    private let retryButton = NSButton(title: "Retry", target: nil, action: nil)

    init(config: ServerConfig, controller: ServerController) {
        self.config = config
        self.controller = controller

        let configuration = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: configuration)

        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Useful Brain"
        window.minSize = NSSize(width: 980, height: 640)
        window.center()
        super.init(window: window)

        statusLabel.font = .systemFont(ofSize: 17, weight: .medium)
        statusDetail.alignment = .center
        statusDetail.lineBreakMode = .byWordWrapping
        retryButton.target = self
        retryButton.action = #selector(retryStart)
        retryButton.isHidden = true

        for view in [statusLabel, statusDetail, retryButton] {
            view.translatesAutoresizingMaskIntoConstraints = false
            statusBox.addSubview(view)
        }

        guard let content = window.contentView else { return }
        webView.frame = content.bounds
        webView.autoresizingMask = [.width, .height]
        webView.isHidden = true
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isInspectable = true
        content.addSubview(webView)

        statusBox.frame = content.bounds
        statusBox.autoresizingMask = [.width, .height]
        content.addSubview(statusBox)

        NSLayoutConstraint.activate([
            statusLabel.centerXAnchor.constraint(equalTo: statusBox.centerXAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: statusBox.centerYAnchor, constant: -30),

            statusDetail.centerXAnchor.constraint(equalTo: statusBox.centerXAnchor),
            statusDetail.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 12),
            statusDetail.widthAnchor.constraint(lessThanOrEqualToConstant: 520),

            retryButton.centerXAnchor.constraint(equalTo: statusBox.centerXAnchor),
            retryButton.topAnchor.constraint(equalTo: statusDetail.bottomAnchor, constant: 18),
        ])
    }

    required init?(coder: NSCoder) {
        fatalError("Not implemented")
    }

    // MARK: - State rendering

    func render(state: ServerState) {
        switch state {
        case .idle:
            showStatus(label: "Server stopped", detail: "", retry: false)
        case .starting:
            showStatus(label: "Starting server", detail: "", retry: false)
        case .running:
            statusBox.isHidden = true
            webView.isHidden = false
            if webView.url == nil {
                webView.load(URLRequest(url: config.baseURL))
            }
        case .failed(let reason):
            showStatus(label: "Server failed to start", detail: reason, retry: true)
        }
    }

    private func showStatus(label: String, detail: String, retry: Bool) {
        statusLabel.stringValue = label
        statusDetail.stringValue = detail
        statusDetail.isHidden = detail.isEmpty
        retryButton.isHidden = !retry
        webView.isHidden = true
        statusBox.isHidden = false
    }

    @objc private func retryStart() {
        controller.start()
    }

    func reload() {
        webView.reload()
    }

    // MARK: - Navigation routing

    /// Decides where a navigation goes: the app webview for the active
    /// origin (loopback or staging), the default browser for external web
    /// content, cancel for everything else.
    private func route(_ navigationAction: WKNavigationAction) -> WKNavigationActionPolicy {
        guard let url = navigationAction.request.url else {
            return .cancel
        }
        if config.isAllowedOrigin(url) {
            return .allow
        }
        switch url.scheme?.lowercased() {
        case "http", "https":
            NSWorkspace.shared.open(url)
        default:
            break
        }
        return .cancel
    }

    // MARK: - WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(route(navigationAction))
    }

    // MARK: - WKUIDelegate

    /// target=_blank and window.open: the same policy decides. Allowed URLs
    /// load in this webview, external ones open in the default browser, and
    /// no second webview is ever created.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        guard let url = navigationAction.request.url else {
            return nil
        }
        if config.isAllowedOrigin(url) {
            webView.load(navigationAction.request)
        } else if ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    /// File inputs: without this delegate method WKWebView silently drops
    /// clicks on <input type="file">, so the Sources upload dialog appears
    /// dead. The panel is restricted to the types the upload form accepts.
    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [
            .init(filenameExtension: "md") ?? .data,
            .init(filenameExtension: "markdown") ?? .data,
            .init(filenameExtension: "txt") ?? .data,
            .pdf,
        ]
        panel.begin { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }
}
