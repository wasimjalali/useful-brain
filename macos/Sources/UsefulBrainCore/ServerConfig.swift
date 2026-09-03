import Foundation

/// Where the app points the webview: the local loopback stack (default) or
/// the deployed staging app on Cloudflare. Staging is a normal https origin:
/// no local server is spawned, no health poll runs, and cookies work because
/// the origin is the deployed app itself.
public enum ServerMode: String, Equatable {
    case local
    case staging

    public static func resolved(defaults: UserDefaults = .standard) -> ServerMode {
        let raw = defaults.string(forKey: "mode") ?? ServerMode.local.rawValue
        return ServerMode(rawValue: raw) ?? .local
    }
}

/// Resolved configuration for the local Brain server and the app shell.
///
/// Values come from UserDefaults so they can be overridden without a
/// rebuild, e.g. `defaults write ai.karko.usefulbrain port -int 8791`.
/// The default port avoids 8787, which the Hermes WebUI occupies on this
/// machine; the port is passed to `wrangler dev` at spawn time.
public struct ServerConfig: Equatable {
    public var mode: ServerMode
    public var repoPath: String
    public var port: Int
    public var stagingBaseURLString: String

    public static let defaultRepoPath = "~/Desktop/Personal Project/useful-brain"
    public static let defaultPort = 8790
    public static let defaultStagingBaseURLString = "https://useful-brain-staging.karko-ai.workers.dev"

    public static func resolved(defaults: UserDefaults = .standard) -> ServerConfig {
        let mode = ServerMode.resolved(defaults: defaults)
        let repo = defaults.string(forKey: "repoPath") ?? defaultRepoPath
        let port = defaults.object(forKey: "port") as? Int ?? defaultPort
        let staging = defaults.string(forKey: "stagingURL") ?? defaultStagingBaseURLString
        return ServerConfig(
            mode: mode,
            repoPath: (repo as NSString).expandingTildeInPath,
            port: port,
            stagingBaseURLString: staging
        )
    }

    public init(
        mode: ServerMode = .local,
        repoPath: String = ServerConfig.defaultRepoPath,
        port: Int = ServerConfig.defaultPort,
        stagingBaseURLString: String = ServerConfig.defaultStagingBaseURLString
    ) {
        self.mode = mode
        self.repoPath = (repoPath as NSString).expandingTildeInPath
        self.port = port
        self.stagingBaseURLString = stagingBaseURLString
    }

    /// The origin the webview loads. Staging bypasses the local stack.
    public var baseURL: URL {
        switch mode {
        case .staging:
            return URL(string: stagingBaseURLString) ?? URL(string: Self.defaultStagingBaseURLString)!
        case .local:
            return URL(string: "http://127.0.0.1:\(port)")!
        }
    }
    public var healthURL: URL { baseURL.appendingPathComponent("api/health") }
    public var spawnsLocalServer: Bool { mode == .local }
    public var launchExecutable: String { "/bin/zsh" }
    public var launchArguments: [String] {
        ["-lc", "cd \(Self.shellQuoted(repoPath)) && exec npm run preview:cf -- --port \(port)"]
    }

    /// The webview may navigate only to the active mode's own origin (so the
    /// session cookie stays on that origin) plus inert schemes.
    public func isAllowedOrigin(_ url: URL) -> Bool {
        if ["blob", "about", "data"].contains(url.scheme?.lowercased() ?? "") {
            return true
        }
        guard let base = URL(string: baseURL.absoluteString),
              let host = url.host?.lowercased(),
              let baseHost = base.host?.lowercased(),
              host == baseHost
                  || (mode == .local && host == "localhost"
                      && ["127.0.0.1", "localhost"].contains(baseHost)) else {
            return false
        }
        if mode == .staging {
            return url.scheme?.lowercased() == "https"
        }
        return url.port == port || (url.port == nil && port == 80)
    }

    public static func shellQuoted(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }
}
