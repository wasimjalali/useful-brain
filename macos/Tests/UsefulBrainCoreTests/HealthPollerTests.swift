import Testing
import Foundation
@testable import UsefulBrainCore

final class FakeProbe: HealthProbe {
    private let codes: [Int?]
    private var index = 0

    init(codes: [Int?]) {
        self.codes = codes
    }

    func status(for url: URL, timeout: TimeInterval) -> Int? {
        defer { index = min(index + 1, codes.count - 1) }
        return codes[index]
    }
}

@Suite struct HealthPollerTests {
    private let unreachable = URL(string: "http://127.0.0.1:1/api/health")!

    @Test func readyOn200() {
        var timedOut = false
        var ready = false
        let poller = HealthPoller(probe: FakeProbe(codes: [nil, 200]))

        poller.waitUntilHealthy(
            url: unreachable,
            interval: 0.01,
            timeout: 2,
            onReady: { ready = true },
            onTimeout: { timedOut = true }
        )

        #expect(ready)
        #expect(!timedOut)
    }

    @Test func timeoutWhenNeverHealthy() {
        var ready = false
        var timedOut = false
        let poller = HealthPoller(probe: FakeProbe(codes: [nil]))

        poller.waitUntilHealthy(
            url: unreachable,
            interval: 0.01,
            timeout: 0.2,
            onReady: { ready = true },
            onTimeout: { timedOut = true }
        )

        #expect(timedOut)
        #expect(!ready)
    }
}
