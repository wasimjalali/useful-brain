#!/usr/bin/env bash
# Read-only checkout of the Burooj Sanad source, pinned to the migration commit.
#
# Useful Brain ports Burooj behaviour into TypeScript; Burooj is a reference
# source only. This script never modifies or pushes to Burooj.
#
# Requires the environment's GitHub token to include `wasimjalali/burooj`
# (grant it by adding Burooj as a second repo when creating the environment, or
# by adding it to `repositoryDependencies` once access is confirmed). If Burooj
# is already checked out as a multi-repo member, you do not need this script.
#
# Destination is overridable with BUROOJ_SRC (defaults to ~/burooj).
set -euo pipefail

BUROOJ_COMMIT="630ba08dc7cad6aa71942d6842ce6d8d55a26873"
BUROOJ_SRC="${BUROOJ_SRC:-$HOME/burooj}"
BUROOJ_REMOTE="${BUROOJ_REMOTE:-https://github.com/wasimjalali/burooj.git}"

if [ ! -d "$BUROOJ_SRC/.git" ]; then
  git clone "$BUROOJ_REMOTE" "$BUROOJ_SRC"
fi

git -C "$BUROOJ_SRC" fetch origin
git -C "$BUROOJ_SRC" checkout --detach "$BUROOJ_COMMIT"

echo "Burooj source ready (read-only) at $BUROOJ_SRC @ $BUROOJ_COMMIT"
