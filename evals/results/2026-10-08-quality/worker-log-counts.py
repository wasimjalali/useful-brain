"""Counts the lines in a local `wrangler dev` Brain log that back the write-up's
worker-health claims: /turns responses by status, truncation warnings from the
extraction passes, and remote Workers AI "internal error" lines.

Usage: python3 worker-log-counts.py <worker.log> [...]
"""
import re
import sys

ANSI = re.compile(r"\x1b\[[0-9;]*m")

for path in sys.argv[1:]:
    statuses: dict[str, int] = {}
    truncated = internal = 0
    for line in open(path, errors="replace"):
        line = ANSI.sub("", line)
        match = re.search(r"POST /turns (\d{3})", line)
        if match:
            statuses[match.group(1)] = statuses.get(match.group(1), 0) + 1
        if '"event":"extraction_truncated"' in line:
            truncated += 1
        if "internal error; reference" in line:
            internal += 1
    print(
        path.split("/")[-1],
        "turn responses by status",
        dict(sorted(statuses.items())),
        "extraction_truncated warnings",
        truncated,
        "remote internal-error lines",
        internal,
    )
