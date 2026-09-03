#!/bin/sh
# Regenerate macos/assets/AppIcon.icns from the web app icon (src/app/icon.svg).
# Inlines the SVG into a 1024x1024 transparent canvas with the tile at 80.5%
# of the canvas (macOS icon grid), then builds the iconset with iconutil.
set -eu

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }
command -v rsvg-convert >/dev/null || { echo "rsvg-convert is required (brew install librsvg)" >&2; }
command -v iconutil >/dev/null || { echo "iconutil is required (macOS built-in)" >&2; exit 1; }

cd "$(dirname "$0")/../.."
SRC="src/app/icon.svg"
OUT="macos/assets/AppIcon.icns"
ICONSET="macos/assets/AppIcon.iconset"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Compose the master canvas: strip the outer <svg> wrapper from the source
# icon and scale it (64 -> 824) inside the 1024 canvas, centered.
python3 - "$SRC" "$TMP/master.svg" <<'PYEOF'
import re
import sys

src_path, out_path = sys.argv[1], sys.argv[2]
with open(src_path, encoding="utf-8") as f:
    svg = f.read()
inner = re.sub(r"^\s*<svg[^>]*>", "", svg)
inner = re.sub(r"</svg>\s*$", "", inner)
master = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" '
    'viewBox="0 0 1024 1024">\n'
    '<g transform="translate(100 100) scale(12.875)">\n'
    + inner.strip()
    + "\n</g>\n</svg>\n"
)
with open(out_path, "w", encoding="utf-8") as f:
    f.write(master)
PYEOF

mkdir -p "$ICONSET"
for spec in \
  "16:icon_16x16.png" \
  "32:icon_16x16@2x.png" \
  "32:icon_32x32.png" \
  "64:icon_32x32@2x.png" \
  "128:icon_128x128.png" \
  "256:icon_128x128@2x.png" \
  "256:icon_256x256.png" \
  "512:icon_256x256@2x.png" \
  "512:icon_512x512.png" \
  "1024:icon_512x512@2x.png"; do
  size="${spec%%:*}"
  name="${spec#*:}"
  rsvg-convert -w "$size" -h "$size" "$TMP/master.svg" -o "$ICONSET/$name"
done

iconutil -c icns "$ICONSET" -o "$OUT"
echo "Wrote $OUT"
