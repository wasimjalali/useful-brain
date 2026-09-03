import Foundation

/// Health probe abstraction so tests and the app can supply implementations.
public protocol HealthProbe {
    /// Returns the HTTP status code, or nil when the request failed.
    func status(for url: URL, timeout: TimeInterval) -> Int?
}

/// Real probe backed by URLSession. Blocking; call off the main thread.
public struct URLSessionHealthProbe: HealthProbe {
    public init() {}

    public func status(for url: URL, timeout: TimeInterval) -> Int? {
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        let semaphore = DispatchSemaphore(value: 0)
        var code: Int?
        let task = URLSession.shared.dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse { code = http.statusCode }
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + timeout + 2)
        return code
    }
}

/// Polls the Brain health endpoint until it answers 200 or times out.
public struct HealthPoller {
    public let probe: HealthProbe

    public init(probe: HealthProbe) {
        self.probe = probe
    }

    public func waitUntilHealthy(
        url: URL,
        interval: TimeInterval = 0.5,
        timeout: TimeInterval,
        onReady: @escaping () -> Void,
        onTimeout: @escaping () -> Void
    ) {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if probe.status(for: url, timeout: min(2, timeout)) == 200 {
                onReady()
                return
            }
            Thread.sleep(forTimeInterval: interval)
        }
        onTimeout()
    }
}
