import Testing
import Foundation
@testable import UsefulBrainCore

/// End-to-end lifecycle against a real spawned process tree
/// (zsh -> npm run -> node), using a temp package so the real repo's
/// wrangler state and any concurrently running server are never touched.
@Suite struct ServerLifecycleIntegrationTests {
    private let smokePort = 8791

    private func makeSmokePackage() throws -> String {
        let dir = NSTemporaryDirectory() + "ub-smoke-\(UUID().uuidString)"
        try FileManager.default.createDirectory(
            atPath: dir,
            withIntermediateDirectories: true
        )
        let package = """
        {
          "name": "ub-smoke",
          "private": true,
          "scripts": { "preview:cf": "node server.js" }
        }
        """
        let server = """
        const http = require("http");
        const argv = process.argv;
        const i = argv.indexOf("--port");
        const port = i >= 0 ? Number(argv[i + 1]) : 8099;
        http.createServer((req, res) => {
          res.writeHead(200, { "content-type": "text/plain" });
          res.end("ok");
        }).listen(port, "127.0.0.1", () => console.log(`smoke on ${port}`));
        """
        try package.write(toFile: dir + "/package.json", atomically: true, encoding: .utf8)
        try server.write(toFile: dir + "/server.js", atomically: true, encoding: .utf8)
        return dir
    }

    @Test func spawnsReachesRunningAndStopsCleanly() async throws {
        guard ServerController.npmExists() else {
            Issue.record("npm is required for the lifecycle integration test")
            return
        }
        let dir = try makeSmokePackage()
        defer { try? FileManager.default.removeItem(atPath: dir) }

        let controller = ServerController(
            config: ServerConfig(repoPath: dir, port: smokePort),
            poller: HealthPoller(probe: URLSessionHealthProbe())
        )
        defer { controller.stop() }

        controller.start(healthTimeout: 30)

        let deadline = Date().addingTimeInterval(30)
        while Date() < deadline && controller.state != .running {
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        #expect(controller.state == .running)
        #expect(
            URLSessionHealthProbe().status(
                for: URL(string: "http://127.0.0.1:\(smokePort)/api/health")!,
                timeout: 2
            ) == 200
        )

        controller.stop()
        #expect(controller.state == .idle)

        // The whole tree must be gone: the port answers nothing now.
        let drained = try await waitUntilDrained(
            url: URL(string: "http://127.0.0.1:\(smokePort)/api/health")!
        )
        #expect(drained)
    }

    private func waitUntilDrained(url: URL) async throws -> Bool {
        let probe = URLSessionHealthProbe()
        let deadline = Date().addingTimeInterval(5)
        while Date() < deadline {
            if probe.status(for: url, timeout: 1) == nil {
                return true
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        return false
    }
}
