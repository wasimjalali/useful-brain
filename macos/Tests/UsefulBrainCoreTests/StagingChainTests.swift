import Foundation
import Testing
@testable import UsefulBrainCore

/// Live smoke against the deployed staging origin through the app's own
/// config surface. It proves the chain the macOS app uses in staging mode:
/// the configured base URL is the deployed app, health answers 200, and the
/// auth API round-trips a real login on that origin.
@Suite struct StagingChainTests {
    private let staging = URL(string: ServerConfig.defaultStagingBaseURLString)!

    private func get(_ url: URL, method: String = "GET", body: Data? = nil, contentType: String? = nil) throws -> (Data, HTTPURLResponse?) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        if let body {
            request.httpBody = body
        }
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }
        let semaphore = DispatchSemaphore(value: 0)
        var data: Data?
        var response: URLResponse?
        var error: Error?
        let task = URLSession.shared.dataTask(with: request) { d, r, e in
            data = d
            response = r
            error = e
            semaphore.signal()
        }
        task.resume()
        _ = semaphore.wait(timeout: .now() + 20)
        if let error {
            throw error
        }
        return (data ?? Data(), response as? HTTPURLResponse)
    }

    @Test func stagingHealthAnswers200() throws {
        let (_, response) = try get(staging.appendingPathComponent("api/health"))
        #expect(response?.statusCode == 200)
    }

    /// The debug account can sign in over https on the staging origin, which
    /// is the same path the webview's signup/login forms take. Skips (does
    /// not fail) when the credentials are absent from the environment.
    @Test func stagingLoginRoundTrips() throws {
        guard let email = ProcessInfo.processInfo.environment["UB_DEBUG_EMAIL"],
              let password = ProcessInfo.processInfo.environment["UB_DEBUG_PASSWORD"] else {
            #expect(Bool(true), "debug credentials not provided; skipping live login")
            return
        }
        let body = try JSONEncoder().encode(["email": email, "password": password])
        let (_, response) = try get(
            staging.appendingPathComponent("api/auth/login"),
            method: "POST",
            body: body,
            contentType: "application/json"
        )
        #expect(response?.statusCode == 200)
    }
}
