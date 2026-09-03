#!/bin/sh
# Measurement variant of the app icon: same artwork, transparent background,
# no dark tile, quotation mark blackened so its bbox can be isolated.
# Used by png_bbox.py to measure the document (white) and quote (dark) boxes.
set -eu
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../.."
sed -e '/<rect width="64" height="64" rx="15"/d' \
    -e 's/<g fill="#fafafa" transform=/<g fill="#000000" transform=/' src/app/icon.svg > /tmp/ub-measure.svg
rsvg-convert -w 256 -h 256 /tmp/ub-measure.svg -o /tmp/ub-measure.png
rsvg-convert -w 256 -h 256 src/app/icon.svg -o /tmp/ub-full.png
echo "== document (white pixels) =="
python3 "$SCRIPT_DIR/png_bbox.py" /tmp/ub-measure.png --white
echo "== quotation mark (dark pixels) =="
python3 "$SCRIPT_DIR/png_bbox.py" /tmp/ub-measure.png --dark
