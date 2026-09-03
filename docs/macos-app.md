# Useful Brain macOS app

Native macOS shell for the local Brain. The app owns the server lifecycle and
hosts the existing Next.js UI in a webview. Built with SwiftPM and AppKit, no
Xcode.app required (Command Line Tools are enough).

## What it does

- Spawns `npm run preview:cf` in this repo on launch (OpenNext build, local D1
  migrations, `wrangler dev` with bindings on 127.0.0.1).
- Polls `/api/health` until the stack is ready, then loads the UI in a
  WKWebView pinned to 127.0.0.1 so loopback identity holds.
- Adopts a server that is already healthy instead of double-starting.
- Stops the whole process tree on quit (SIGTERM to the process group, then
  SIGKILL after a 5 s grace).
- External http(s) links open in the default browser; navigation stays on the
  app's origin.

The default port is 8790 because 8787 is occupied by the Hermes WebUI on this
machine. Override anything without a rebuild:

```
defaults write ai.karko.usefulbrain repoPath "/path/to/useful-brain"
defaults write ai.karko.usefulbrain port -int 8791
```

Server output is appended to `~/Library/Logs/useful-brain/server.log`
(Server menu > Show Log in Finder). The log grows without bound; delete it
whenever it gets large.

## Build and install

Prerequisites: Node.js >= 22.19, Command Line Tools (`xcode-select --install`),
`rsvg-convert` for icon regeneration only (`brew install librsvg`).

```
cd macos
make test      # Swift Testing suite (includes a real spawn/stop lifecycle test)
make bundle    # release build + dist/Useful Brain.app, ad-hoc signed
make install   # bundle + copy to /Applications and launch
```

`make test` copies CLT's Testing.framework next to the test bundle because
Command Line Tools do not put it on the dyld search path. Installing full
Xcode makes that step unnecessary but harmless.

Signing uses the stable self-signed identity "Useful Brain Local Signing" when
it exists, otherwise ad-hoc. Ad-hoc is fine here: unlike Useful Voice, the app
needs no Accessibility grant, so nothing is lost across reinstalls. Create the
stable identity once with:

```
security create-keypair -t rsa -k login "Useful Brain Local Signing"
```

then re-run `make bundle`.

## Icon

`assets/AppIcon.icns` is generated from the web app icon `src/app/icon.svg`
(dark tile) by `scripts/make-icns.sh`: the 64 px tile is scaled onto a 1024 px
canvas at the macOS icon grid ratio (80.5 percent) and assembled into an
iconset with `iconutil`. Run `make icon` after changing the source SVG.

## Known limitation

Every launch runs the full OpenNext build, so cold start takes a while; the
app shows a starting state and the log carries the build output. A build-once
run-often split is a deliberate follow-up, not built yet.

While another `wrangler dev` is running against this repo's `.wrangler/state`
(for example the Northwind eval), launching the app concurrently is not
advised: the OpenNext rebuild can hot-reload the running worker mid-run.
