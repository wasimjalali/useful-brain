import Testing
import Foundation
@testable import UsefulBrainCore

@Suite struct ServerControllerTests {
    private func tempLog() -> URL {
        URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("ub-test-\(UUID().uuidString).log")
    }

    private func waitForState(
        _ controller: ServerController,
        _ target: ServerState,
        timeout: TimeInterval = 5
    ) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if controller.state == target { return true }
            Thread.sleep(forTimeInterval: 0.02)
        }
        return false
    }

    private func waitForFailure(
        _ controller: ServerController,
        timeout: TimeInterval = 5
    ) -> String? {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if case .failed(let message) = controller.state {
                return message
            }
            Thread.sleep(forTimeInterval: 0.02)
        }
        return nil
    }

    @Test func adoptsHealthyServer() {
        let controller = ServerController(
            config: ServerConfig(repoPath: "/tmp", port: 8787),
            poller: HealthPoller(probe: FakeProbe(codes: [200])),
            logFile: tempLog()
        )

        controller.start(healthTimeout: 1)
        let reached = waitForState(controller, .running)

        #expect(reached)
        controller.stop()
        #expect(controller.state == .idle)
    }

    @Test func stopFromIdleIsNoop() {
        let controller = ServerController(
            config: ServerConfig(repoPath: "/tmp", port: 8787),
            poller: HealthPoller(probe: FakeProbe(codes: [nil])),
            logFile: tempLog()
        )

        controller.stop()

        #expect(controller.state == .idle)
    }

    @Test func failsFastWhenRepoMissing() {
        let controller = ServerController(
            config: ServerConfig(repoPath: "/nonexistent-\(UUID().uuidString)", port: 8787),
            poller: HealthPoller(probe: FakeProbe(codes: [nil])),
            logFile: tempLog()
        )

        controller.start(healthTimeout: 30)

        let message = waitForFailure(controller, timeout: 3)
        #expect(message?.contains("repository was not found") == true)
    }

    @Test func failsWhenServerNeverBecomesHealthy() {
        // A real, existing empty directory: the spawn succeeds, npm exits at
        // once because there is no package.json, and the health window closes.
        let emptyDir = NSTemporaryDirectory() + "ub-empty-\(UUID().uuidString)"
        try? FileManager.default.createDirectory(atPath: emptyDir, withIntermediateDirectories: true)
        let controller = ServerController(
            config: ServerConfig(repoPath: emptyDir, port: 8787),
            poller: HealthPoller(probe: FakeProbe(codes: [nil])),
            logFile: tempLog()
        )

        controller.start(healthTimeout: 0.5)

        let message = waitForFailure(controller, timeout: 5)
        #expect(message?.contains("did not become healthy") == true)
    }
}
