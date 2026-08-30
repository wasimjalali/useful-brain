#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=/dev/null
. .cursor/select-node.sh

npm run db:local
exec npx wrangler dev -c workers/brain/wrangler.jsonc --ip 127.0.0.1 --port 8788 --persist-to .wrangler/state
