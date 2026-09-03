import Testing
import Foundation
@testable import UsefulBrainCore

@Suite struct ServerConfigTests {
    private func freshDefaults(_ name: String) -> UserDefaults {
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func defaults() {
        let config = ServerConfig.resolved(defaults: freshDefaults("ServerConfigTests.defaults"))

        #expect(config.port == 8790)
        #expect(
            config.repoPath == NSString(string: ServerConfig.defaultRepoPath).expandingTildeInPath
        )
        #expect(config.baseURL.absoluteString == "http://127.0.0.1:8790")
        #expect(config.healthURL.absoluteString == "http://127.0.0.1:8790/api/health")
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

    @Test func shellQuoting() {
        #expect(ServerConfig.shellQuoted("plain-path") == "'plain-path'")
        #expect(ServerConfig.shellQuoted("it's") == "'it'\\''s'")
        #expect(ServerConfig.shellQuoted("a b/c") == "'a b/c'")
    }
}
