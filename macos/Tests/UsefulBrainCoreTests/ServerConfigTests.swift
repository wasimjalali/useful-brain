import Testing
import Foundation
@testable import UsefulBrainCore

@Suite struct ServerConfigTests {
    private func freshDefaults(_ name: String) -> UserDefaults {
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    // MARK: - Local mode (default)

    @Test func defaults() {
        let config = ServerConfig.resolved(defaults: freshDefaults("ServerConfigTests.defaults"))

        #expect(config.mode == .local)
        #expect(config.port == 8790)
        #expect(
            config.repoPath == NSString(string: ServerConfig.defaultRepoPath).expandingTildeInPath
        )
        #expect(config.baseURL.absoluteString == "http://127.0.0.1:8790")
        #expect(config.healthURL.absoluteString == "http://127.0.0.1:8790/api/health")
        #expect(config.spawnsLocalServer)
        #expect(config.launchExecutable == "/bin/zsh")
    }

    @Test func overrides() {
        let defaults = freshDefaults("ServerConfigTests.overrides")
        defaults.set("/tmp/brain repo", forKey: "repoPath")
        defaults.set(9999, forKey: "port")

        let config = ServerConfig.resolved(defaults: defaults)

        #expect(config.port == 9999)
        #expect(config.baseURL.absoluteString == "http://127.0.0.1:9999")
        #expect(config.healthURL.absoluteString == "http://127.0.0.1:9999/api/health")
        #expect(config.launchArguments[0] == "-lc")
        #expect(config.launchArguments[1].contains("'/tmp/brain repo'"))
        #expect(config.launchArguments[1].hasPrefix("cd "))
        #expect(
            config.launchArguments[1].hasSuffix("&& exec npm run preview:cf -- --port 9999")
        )
    }

    // MARK: - Staging mode

    @Test func stagingModePointsAtDeployedOriginAndSkipsLocalServer() {
        let defaults = freshDefaults("ServerConfigTests.stagingMode")
        defaults.set("staging", forKey: "mode")

        let config = ServerConfig.resolved(defaults: defaults)

        #expect(config.mode == .staging)
        #expect(!config.spawnsLocalServer)
        #expect(
            config.baseURL.absoluteString == ServerConfig.defaultStagingBaseURLString
        )
        #expect(
            config.healthURL.absoluteString
                == ServerConfig.defaultStagingBaseURLString + "/api/health"
        )
        #expect(config.launchArguments[1].hasPrefix("cd "))
    }

    @Test func stagingURLIsOverridable() {
        let defaults = freshDefaults("ServerConfigTests.stagingURL")
        defaults.set("staging", forKey: "mode")
        defaults.set("https://brain.example.dev", forKey: "stagingURL")

        let config = ServerConfig.resolved(defaults: defaults)

        #expect(config.baseURL.absoluteString == "https://brain.example.dev")
    }

    // MARK: - Origin allowlist

    @Test func localModeAllowsOnlyItsOwnLoopbackOrigin() {
        let config = ServerConfig(mode: .local, repoPath: "/tmp", port: 8790)

        #expect(config.isAllowedOrigin(URL(string: "http://127.0.0.1:8790/chat")!))
        #expect(config.isAllowedOrigin(URL(string: "http://localhost:8790/chat")!))
        #expect(!config.isAllowedOrigin(URL(string: "http://127.0.0.1:9999/chat")!))
        #expect(!config.isAllowedOrigin(URL(string: "https://useful-brain-staging.karko-ai.workers.dev/")!))
        #expect(config.isAllowedOrigin(URL(string: "blob:https://x")!))
    }

    @Test func stagingModeAllowsOnlyItsOwnHTTPSOrigin() {
        let config = ServerConfig(mode: .staging)

        #expect(
            config.isAllowedOrigin(
                URL(string: "https://useful-brain-staging.karko-ai.workers.dev/login")!
            )
        )
        #expect(
            !config.isAllowedOrigin(
                URL(string: "http://useful-brain-staging.karko-ai.workers.dev/")!
            )
        )
        #expect(!config.isAllowedOrigin(URL(string: "https://evil.example/")!))
        #expect(!config.isAllowedOrigin(URL(string: "http://127.0.0.1:8790/")!))
    }

    @Test func shellQuoting() {
        #expect(ServerConfig.shellQuoted("plain-path") == "'plain-path'")
        #expect(ServerConfig.shellQuoted("it's") == "'it'\\''s'")
        #expect(ServerConfig.shellQuoted("a b/c") == "'a b/c'")
    }
}
