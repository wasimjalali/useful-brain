import re, sys, statistics
for path in sys.argv[1:]:
    calls = empty = length = stop = 0
    tokens = []
    for line in open(path, errors="replace"):
        if "DBG-QUALITY coverraw" not in line:
            continue
        calls += 1
        if '"raw":""' in line:
            empty += 1
        if 'finish_reason\\":\\"length' in line:
            length += 1
        if 'finish_reason\\":\\"stop' in line:
            stop += 1
        m = re.search(r'completion_tokens\\":(\d+)', line)
        if m:
            tokens.append(int(m.group(1)))
    print(path.split("/")[-1], "calls", calls, "empty", empty, "finish length", length, "finish stop", stop,
          "completion tokens median", statistics.median(tokens) if tokens else None, "max", max(tokens) if tokens else None, "n", len(tokens))
