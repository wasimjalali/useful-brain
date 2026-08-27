# Shared Node selection for Cloud Agent setup, sourced by install.sh and dev.sh.
#
# The exec-daemon injects an older Node (v22.14.x) ahead of nvm on PATH. That
# build hits a jsdom WebCrypto cross-realm ArrayBuffer failure in the Access
# JWT tests, so we pin PATH to the nvm default (>=22.22) which matches the
# recorded project baseline and passes the full suite.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh" >/dev/null 2>&1 || true
  SELECTED_NODE_BIN="$(nvm which default 2>/dev/null | xargs -r dirname)"
  if [ -n "$SELECTED_NODE_BIN" ]; then
    export PATH="$SELECTED_NODE_BIN:$PATH"
  fi
fi
