#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
. .cursor/select-node.sh

echo "Using $(node -v) / npm $(npm -v)"
npm ci
