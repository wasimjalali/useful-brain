import AppKit
import UsefulBrainCore
import WebKit

final class MainWindowController: NSWindowController, WKNavigationDelegate {
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

    // MARK: - WKNavigationDelegate

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.host == "127.0.0.1" && url.port == config.port {
            decisionHandler(.allow)
            return
        }
        switch url.scheme {
        case "blob", "about", "data":
            decisionHandler(.allow)
        case "http", "https":
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        default:
            decisionHandler(.cancel)
        }
    }
}
