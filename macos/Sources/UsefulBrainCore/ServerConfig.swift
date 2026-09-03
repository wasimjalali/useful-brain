import Foundation

/// Resolved configuration for the local Brain server and the app shell.
///
/// Values come from UserDefaults so they can be overridden without a
/// rebuild, e.g. `defaults write ai.karko.usefulbrain port -int 8791`.
/// The default port avoids 8787, which the Hermes WebUI occupies on this
/// machine; the port is passed to `wrangler dev` at spawn time.
public struct ServerConfig: Equatable {
    public var repoPath: String
    public var port: Int

    public static let defaultRepoPath = "~/Desktop/Personal Project/useful-brain"
    public static let defaultPort = 8790

    public static func resolved(defaults: UserDefaults = .standard) -> ServerConfig {
        let repo = defaults.string(forKey: "repoPath") ?? defaultRepoPath
        let port = defaults.object(forKey: "port") as? Int ?? defaultPort
        return ServerConfig(repoPath: (repo as NSString).expandingTildeInPath, port: port)
    }

    public var baseURL: URL { URL(string: "http://127.0.0.1:\(port)")! }
    public var healthURL: URL { baseURL.appendingPathComponent("api/health") }
    public var launchExecutable: String { "/bin/zsh" }
    public var launchArguments: [String] {
        ["-lc", "cd \(Self.shellQuoted(repoPath)) && exec npm run preview:cf -- --port \(port)"]
    }

    public static func shellQuoted(_ value: String) -> String {
        "'" + value.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    public init(repoPath: String, port: Int) {
        self.repoPath = repoPath
        self.port = port
    }
}
