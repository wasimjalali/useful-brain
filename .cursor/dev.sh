#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
. .cursor/select-node.sh

# Next.js only. Brain is `.cursor/brain-dev.sh` or `npm run preview:cf`.
exec npm run dev
