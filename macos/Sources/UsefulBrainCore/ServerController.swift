import Foundation

/// Lifecycle state of the local Brain server.
public enum ServerState: Equatable {
    case idle
    case starting
    case running
    case failed(String)
}

/// Owns the spawned local server process (npm run preview:cf) and reports
/// state changes through `onStateChange`. Callbacks fire on whatever thread
/// the transition happened on; hop to the main queue before touching AppKit.
public final class ServerController {
    private let config: ServerConfig
    private let poller: HealthPoller
    private let logFile: URL
    private let queue = DispatchQueue(label: "ai.karko.usefulbrain.server")
    private let lock = NSLock()
    private var process: Process?
    private var logHandle: FileHandle?
    private var childInOwnGroup = false
    private var _state: ServerState = .idle

    public var onStateChange: ((ServerState) -> Void)?

    public var state: ServerState {
        lock.lock()
        defer { lock.unlock() }
        return _state
    }

    public init(config: ServerConfig, poller: HealthPoller, logFile: URL? = nil) {
        self.config = config
        self.poller = poller
        self.logFile = logFile ?? ServerController.defaultLogFile()
    }

    public static func defaultLogFile() -> URL {
        let dir = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Logs/useful-brain", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("server.log")
    }

    /// Starts the server, or adopts one that is already healthy on the port.
    /// `healthTimeout` bounds the wait for /api/health to answer 200.
    public func start(healthTimeout: TimeInterval = 300) {
        queue.async { self.startSync(healthTimeout: healthTimeout) }
    }

    /// Stops the spawned server and waits (bounded) for the tree to die.
    /// Use from app termination and tests, where blocking is correct.
    public func stop(grace: TimeInterval = 5) {
        guard let victim = takeProcess() else {
            if state != .idle {
                setState(.idle)
            }
            return
        }
        let grouped = takeGrouped()
        terminateTree(victim, grouped: grouped, grace: grace)
        if state != .idle {
            setState(.idle)
        }
    }

    /// Stops the spawned server without blocking the caller. The SIGTERM,
    /// bounded wait and SIGKILL escalation run on a background queue.
    /// Use from UI actions so the menu never freezes.
    public func stopAsync(grace: TimeInterval = 5) {
        guard let victim = takeProcess() else {
            DispatchQueue.main.async {
                if self.state != .idle {
                    self.setState(.idle)
                }
            }
            return
        }
        let grouped = takeGrouped()
        if state != .idle {
            setState(.idle)
        }
        DispatchQueue.global(qos: .utility).async { [weak self] in
            self?.terminateTree(victim, grouped: grouped, grace: grace)
        }
    }

    // MARK: - Internals

    private func terminateTree(_ p: Process, grouped: Bool, grace: TimeInterval) {
        let pid = p.processIdentifier
        if grouped {
            killpg(pid, SIGTERM)
        } else {
            kill(pid, SIGTERM)
        }
        let deadline = Date().addingTimeInterval(grace)
        while p.isRunning && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if p.isRunning {
            if grouped {
                killpg(pid, SIGKILL)
            } else {
                kill(pid, SIGKILL)
            }
        }
        closeLogHandle()
    }

    private func takeGrouped() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return childInOwnGroup
    }

    private func closeLogHandle() {
        lock.lock()
        let handle = logHandle
        logHandle = nil
        lock.unlock()
        try? handle?.close()
    }

    private func startSync(healthTimeout: TimeInterval) {
        switch state {
        case .starting, .running:
            return
        case .idle, .failed:
            break
        }
        setState(.starting)

        // Adopt a server that is already up, e.g. started from a terminal.
        if poller.probe.status(for: config.healthURL, timeout: 1) == 200 {
            setState(.running)
            return
        }

        // Fail fast on the two mistakes that would otherwise only surface
        // after the full health timeout.
        if !FileManager.default.fileExists(atPath: config.repoPath) {
            setState(.failed(
                "The Brain repository was not found at \(config.repoPath). "
                    + "Point the app at your checkout with: "
                    + "defaults write ai.karko.usefulbrain repoPath <path>"
            ))
            return
        }
        if !Self.npmExists() {
            setState(.failed(
                "npm was not found. Install Node.js 22 or later, or make sure "
                    + "/opt/homebrew/bin/npm exists."
            ))
            return
        }

        do {
            try spawn()
        } catch {
            setState(.failed("Could not launch the server process: \(readable(error))"))
            return
        }

        poller.waitUntilHealthy(
            url: config.healthURL,
            timeout: healthTimeout,
            onReady: { [weak self] in
                guard let self, self.hasPendingProcess() else { return }
                self.setState(.running)
            },
            onTimeout: { [weak self] in
                guard let self else { return }
                // A nil process slot means the user stopped us mid-start.
                guard self.hasPendingProcess() else {
                    self.setStateIfNotIdle(.idle)
                    return
                }
                let message = "Server did not become healthy on 127.0.0.1:\(self.config.port) within \(Int(healthTimeout))s. Check Library/Logs/useful-brain/server.log."
                self.stop()
                self.setState(.failed(message))
            }
        )
    }

    static func npmExists() -> Bool {
        for path in ["/opt/homebrew/bin/npm", "/usr/local/bin/npm"] {
            if FileManager.default.isExecutableFile(atPath: path) {
                return true
            }
        }
        return false
    }

    private func spawn() throws {
        let handle = try openLogHandle()

        let p = Process()
        p.executableURL = URL(fileURLWithPath: config.launchExecutable)
        p.arguments = config.launchArguments
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        p.environment = env
        p.standardOutput = handle
        p.standardError = handle

        try p.run()

        // Put the child in its own process group so stop() can signal the
        // whole npm -> wrangler -> workerd tree. If the child already exec'd
        // (setpgid lost the race), terminateTree falls back to signaling the
        // pid and relies on npm forwarding the signal.
        let grouped = setpgid(p.processIdentifier, p.processIdentifier) == 0

        lock.lock()
        process = p
        logHandle = handle
        childInOwnGroup = grouped
        lock.unlock()
    }

    private func openLogHandle() throws -> FileHandle {
        if !FileManager.default.fileExists(atPath: logFile.path) {
            FileManager.default.createFile(atPath: logFile.path, contents: nil)
        }
        guard let handle = FileHandle(forWritingAtPath: logFile.path) else {
            throw CocoaError(.fileWriteUnknown)
        }
        handle.seekToEndOfFile()
        return handle
    }

    private func takeProcess() -> Process? {
        lock.lock()
        defer { lock.unlock() }
        let p = process
        process = nil
        return p
    }

    private func hasPendingProcess() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return process != nil
    }

    private func setState(_ s: ServerState) {
        lock.lock()
        let changed = _state != s
        _state = s
        lock.unlock()
        if changed {
            onStateChange?(s)
        }
    }

    private func setStateIfNotIdle(_ s: ServerState) {
        if state != .idle {
            setState(s)
        }
    }

    private func readable(_ error: Error) -> String {
        (error as? CocoaError)?.userInfo[NSLocalizedDescriptionKey] as? String
            ?? String(describing: error)
    }
}
