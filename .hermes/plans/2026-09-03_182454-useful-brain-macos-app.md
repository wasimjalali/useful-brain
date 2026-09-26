# Useful Brain macOS App Implementation Plan

> **For Hermes:** Execute task-by-task after Wasim approves. TDD for core logic. Only `git add` explicit `macos/` paths — never stage the eval session's modified files.

**Goal:** Ship `Useful Brain.app`, a native macOS shell that owns the local Brain server lifecycle and hosts the existing Next.js UI on 127.0.0.1, built and bundled the same way as Useful Voice.

**Architecture:** A small SwiftPM package inside this repo at `macos/` with three targets: `UsefulBrainCore` (server lifecycle logic, unit-tested), `UsefulBrainApp` (AppKit + WKWebView shell), and `UsefulBrainCoreTests`. The app starts the existing local Cloudflare stack (`npm run preview:cf`, wrangler dev on 127.0.0.1:8787 with D1 persisted in `.wrangler/state`), polls `/api/health`, then loads the web app in a `WKWebView`. No new npm dependencies, no changes to the web or worker code paths.

**Tech Stack:** Swift 6 (SwiftPM, no Xcode.app, Command Line Tools), AppKit, WebKit, `Process` for server spawn, Makefile bundling, codesign. Mirrors `~/Desktop/Personal Project/useful-voice` (Package.swift layout, CLT Testing.framework workaround, bundle/Info.plist, Makefile targets).

---

## Current context / assumptions

- Repo: `useful-brain`, Next.js 16 App Router UI + Cloudflare Workers backend (D1, Vectorize, Workers AI). Local full-parity run is `npm run preview:cf` → `opennextjs-cloudflare build` + local D1 migrations + `wrangler dev -c wrangler.jsonc -c workers/brain/wrangler.jsonc --ip 127.0.0.1 --persist-to .wrangler/state`, port 8787.
- Operator identity is loopback on 127.0.0.1, so the webview must load `http://127.0.0.1:8787` exactly (not `localhost`) to keep identity consistent.
- `src/app/api/health/route.ts` returns 200 when the Brain binding is healthy, 503 otherwise. This is the readiness probe.
- Useful Voice precedent (Sadaa): root `Package.swift` (macOS 14+), `Sources/<Name>Core` + `<Name>App` + `Tests`, `bundle/Info.plist`, Makefile with `build / test / bundle / install / clean`, stable self-signed signing identity with ad-hoc fallback, CLT Testing.framework copy dance for `swift test`.
- The eval session is running in this working tree on `eval/northwind-accuracy` with 10 modified + 6 untracked files. All work here is new files under `macos/` (plus one docs entry), branched at the current commit, so the eval tree stays untouched.
- Plain `next dev` is NOT the target runtime: the production-parity path is wrangler dev (Cloudflare bindings via local simulation). The shell targets `preview:cf`.
- Phase 2 (rollout to other people) is out of scope for execution. Distribution model (bundled server vs. client-of-staging) is a Wasim decision recorded as an open question.

## Files

- Create: `macos/Package.swift`
- Create: `macos/Sources/UsefulBrainCore/ServerConfig.swift`
- Create: `macos/Sources/UsefulBrainCore/HealthPoller.swift`
- Create: `macos/Sources/UsefulBrainCore/ServerController.swift`
- Create: `macos/Sources/UsefulBrainApp/main.swift`, `AppDelegate.swift`, `MainWindowController.swift`
- Create: `macos/Tests/UsefulBrainCoreTests/` (ServerConfigTests, HealthPollerTests, ServerControllerTests)
- Create: `macos/bundle/Info.plist`, `macos/assets/AppIcon.icns` (generated), `macos/scripts/make-icns.sh`
- Create: `macos/Makefile`
- Modify: `AGENTS.md` (short `macos/` mention under stacks)
- Create: `docs/macos-app.md` (build/install/run notes, short)

---

## Task 1: Branch setup

**Objective:** New branch at current commit without disturbing the eval working tree.

```bash
git checkout -b feature/macos-app   # branches at current HEAD, keeps uncommitted eval changes in tree
git status --short                  # eval modifications still present, untouched
```

Commit nothing yet. Rule for the whole run: stage only explicit paths (`git add macos/... docs/macos-app.md AGENTS.md`), never `git add -A`.

## Task 2: Package scaffold

**Objective:** SwiftPM package that builds an AppKit executable and a testable core.

`macos/Package.swift`:

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "UsefulBrain",
    platforms: [.macOS(.v14)],
    targets: [
        .target(name: "UsefulBrainCore"),
        .executableTarget(name: "UsefulBrainApp", dependencies: ["UsefulBrainCore"]),
        .testTarget(name: "UsefulBrainCoreTests", dependencies: ["UsefulBrainCore"]),
    ]
)
```

Verify: `cd macos && swift build` (with a stub `main.swift` printing nothing) exits 0.

Commit: `chore: scaffold macos SwiftPM package`

## Task 3: ServerConfig (TDD)

**Objective:** Resolve repo path, port, URLs and the launch command; overridable via `UserDefaults` for local flexibility.

Behavior spec:
- `ServerConfig.resolved(defaults:)` reads:
  - `repoPath` (default: `~/Desktop/Personal Project/useful-brain` expanded) so the installed app finds the checkout
  - `port` (default 8787)
- Derived: `baseURL = http://127.0.0.1:<port>`, `healthURL = baseURL + /api/health`, `serverCommand = "npm run preview:cf"`.
- `launchArguments` returns `["-lc", "cd <repoPath> && <serverCommand>"]` for `/bin/zsh`.

Test targets (`ServerConfigTests`): default values, env expansion of `~`, custom port and repo path round-trip through a fake `UserDefaults` suite.

Run: `swift test --filter ServerConfigTests` → pass.

Commit: `feat: server config resolution for macos shell`

## Task 4: HealthPoller + ServerController state machine (TDD)

**Objective:** Start/stop the local server and know when it is ready, with injected fakes so tests never spawn a real server.

- `HealthPoller` polls `healthURL` on a 500 ms interval, timeout 120 s, calls `onReady` on first 200 and `onTimeout` otherwise. Injected via a `HealthProbe` protocol (`Data.fetchResponse(url) -> Int?`) so tests use a fake.
- `ServerController` states: `.idle → .starting → .running → .failed(String)`, plus `.adopted` when health was already up before spawn (a running wrangler dev is adopted instead of double-started).
- Spawn: `Process` runs `/bin/zsh` with the launch arguments; child goes into its own process group; stdout/stderr tee to `~/Library/Library/Logs/useful-brain/server.log` (created via `FileManager`, append mode).
- Stop: `killpg(SIGTERM)` on the child process group, 5 s grace, then `SIGKILL`. Guards: stopping when idle is a no-op; spawn failure (repo missing, npm missing) → `.failed` with the readable reason.
- App termination path calls `stop()` so wrangler never outlives the app.

Tests (`ServerControllerTests`, `HealthPollerTests`): transitions with fake probe and fake process runner; adopt path; failed-spawn path; stop idempotence.

Run: `swift test` → all green.

Commit: `feat: server lifecycle controller for macos shell`

## Task 5: AppKit shell + WKWebView

**Objective:** A regular dock app with one window hosting the UI, plus minimal native chrome.

- `main.swift`: `NSApplication` setup, `AppDelegate` as delegate.
- `MainWindowController`: `NSWindow` (min 980x640, titlebar with title "Useful Brain"), `WKWebView` loading `config.baseURL`. `isInspectable = true` in DEBUG builds. `decidePolicyFor` allows only `127.0.0.1:<port>` navigations; any external http(s) link is cancelled and opened in the default browser (Dia) via `NSWorkspace.open`. Target frames `about:blank`/`_self` on the allowed origin are fine.
- While server is `.starting`: show a lightweight native state view with a "Starting server" label and stop/retry; once `.running` the webview loads. On `.failed`: show the failure reason and a Retry button (UI copy minimal, no helper prose).
- Menu: App menu (Quit), View (Reload, actual `reload()`), Server menu (Start, Stop, Show Log in Finder). `NSApplicationDelegate.applicationWillTerminate` calls `controller.stop()`.
- No `LSUIElement`: this is a workspace app, it keeps a dock icon.

Verification: `make run` opens the window, server start state appears, then the existing UI renders on 127.0.0.1 and chat answers with citations (loopback identity intact). External links (e.g. GitHub footer) open in Dia, not in the app.

Commit: `feat: appkit shell with webview and server menu`

## Task 6: Bundle, icon, signing, Makefile

**Objective:** Double-clickable `Useful Brain.app`, installed to /Applications like Useful Voice.

- `macos/bundle/Info.plist`: `CFBundleIdentifier ai.karko.usefulbrain`, `CFBundleName/DisplayName Useful Brain`, `CFBundleExecutable UsefulBrainApp`, `LSMinimumSystemVersion 14.0`, `NSHighResolutionCapable`, no `LSUIElement`.
- `macos/scripts/make-icns.sh`: renders `AppIcon.icns` via `iconutil` from a 1024 px PNG iconset.
- Icon source: `docs/icon.png` exists in the tree but is currently untracked (brand session). If Wasim confirms it is the final icon, commit the generated `.icns` (not the PNG, to avoid touching the other session's untracked file); otherwise reuse `src/app/icon.svg` rendered to PNG as a placeholder. Flag at approval time.
- `macos/Makefile` mirroring useful-voice: `build` (`swift build -c release`), `test` (CLT Testing.framework copy workaround, same flags as useful-voice), `bundle` (assemble `dist/Useful Brain.app` from `bundle/Info.plist` + binary + icns, `codesign --force --deep --sign`), `run`, `install` (`/Applications/Useful Brain.app`, relaunch), `clean`.
- Signing: reuse pattern `security find-identity` → stable identity `Useful Brain Local Signing` if present, else ad-hoc `-`. No Accessibility grant is needed (no hotkeys/AX), so ad-hoc is acceptable for phase 1; `scripts/setup-signing.sh` equivalent documented in `docs/macos-app.md`.

Verification: `make bundle` produces a signed app; `make install` places it in /Applications and launching it starts the server and shows the UI with no terminal involved.

Commit: `feat: app bundle, icon and Makefile for macos`

## Task 7: Docs + AGENTS.md touch

- `docs/macos-app.md`: prerequisites (node >= 22.19, CLT), `make install`, where logs live, `defaults write ai.karko.usefulbrain repoPath ...` override, signing note. Short, no marketing copy.
- `AGENTS.md`: add one bullet under stacks noting the `macos/` SwiftPM shell and its Makefile targets.

Commit: `docs: macos app build and run notes`

## Task 8: Full verification

1. `cd macos && swift build && swift test` — all green.
2. `make bundle && make install` — app in /Applications launches, starts server, loads UI.
3. Repo gates untouched and green: `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`. (No web code changed; run to prove no interference with the eval session's checkout.)
4. Kill app, confirm no orphaned `wrangler` process remains (`pgrep -fl wrangler`).
5. Push branch, open PR, wait for CI green, merge per change-management loop. Independent review with a second model before merge (not self-approved).

## Risks / tradeoffs / open questions

- **Spawned-server model.** The app depends on the repo checkout + node being present on the machine. Fine for local-first; phase 2 (other people) needs a different story (bundled server is hard with Cloudflare bindings; more likely the Mac app becomes a client of a staging deployment). Explicitly deferred.
- **Cold start latency.** `preview:cf` runs a full OpenNext build on every launch. Acceptable for v1 with the "Starting server" state; a follow-up can split build-once vs. run. Not built now (YAGNI).
- **Two sessions, one tree.** Eval session owns the current checkout's dirty files. Mitigation: branch at HEAD, only add explicit paths, never switch branches until the eval lands. If the eval session changes branches mid-run, stop and reconcile.
- **Port collision.** If 8787 is busy by a foreign process, health check fails and the app shows a failure naming the port; remediation is manual (config override), not auto-kill.
- **Open question at approval:** canonical icon source (`docs/icon.png` untracked vs. `src/app/icon.svg`), and signing identity name.
- **Phase 2 distribution, Wasim's call:** bundled local server vs. client-of-staging. No code, no spend, nothing provisioned in this phase.
