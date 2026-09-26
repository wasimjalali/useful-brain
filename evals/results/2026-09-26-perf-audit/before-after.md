# Before/after measurement: round-1 + round-2 perf changes

Date: 2026-09-26. Measured on this Mac against the local stack (OpenNext + workerd + local D1/Vectorize state), real Workers AI turns, same 8 questions per batch, temperature 0 / seed 7 pinned both sides.

- BEFORE = commit `5215b65` (before the round-1 fixes, PR #48).
- AFTER = `main` at `eb64d09` (round 1 + round 2 phases 1-3 merged).

## End-to-end turn latency (wall time, server-side turns operation)

| Batch | n | median | mean | min | max |
|---|---|---|---|---|---|
| before #1 | 8 | 13.4 s | 16.3 s | 5.8 s | 28.1 s |
| before #2 | 8 | 12.6 s | 16.5 s | 4.7 s | 34.5 s |
| after #1 (app server) | 8 | 27.3 s | 30.9 s | 8.5 s | 69.9 s |
| after #2 | 8 | 19.0 s | 18.8 s | 4.3 s | 34.4 s |

Headline: **the end-to-end numbers do not show an improvement, and the after-#1 batch looks ~50% slower.** That delta is not a code regression and the numbers cannot resolve the fix wins. Evidence:

1. **Model serving latency dominates and is extremely bursty.** Instrumenting `ai.run` on the after build (one batch, 12 calls across 4 turns) shows identical pinned-parameter chat calls ranging **1.3 s to 22 s** within the same run. Mean model call ≈ 5.1 s, and each turn makes 2-4 model calls (search embedding, rerank, chat, repairs, coverage). ±10 s of per-call variance swamps the ~1-2 s the fixes remove.
2. **The after-#1 batch was measured on a machine that had been up all night** under agent runs; the later after-#2 batch (quiet machine) came in at mean 18.8 s vs 30.9 s for the same code - a 40% swing from environment alone, same commit.
3. **Cloudflare rate limits tripped** during the instrumented batch (turns returning ~1 s with errors after ~40 turns in a short window), so tight back-to-back sampling has a floor on how much signal it can produce.

Conclusion: end-to-end turn time is not a usable yardstick for these changes at this sample size; claiming a speed win from these numbers would be dishonest, and claiming a regression would be equally wrong.

## What IS proven (deterministic, unit-tested roundtrip reductions)

These are query-count facts with tests pinning them, worth roughly 1-2 s per turn under load, structurally:

| Change | Before | After |
|---|---|---|
| Retrieval critical path per search | 7-8 serial roundtrips (ACL scan, embed, Vectorize, id lookup, FTS, chunk load, rerank) | ~5 (embed+Vectorize concurrent with FTS; shared chunk load) |
| ACL-shape scan | once per search call (×N searches per turn) | once per turn |
| activeGenerationId | 2 queries per turn | 1 |
| History load | full conversation scan every turn | bounded tail; full scan only when the tail provably cannot saturate |
| Evidence snapshots (conversation view) | 1 query per assistant turn | 1 batched query per 90 turns |
| Loopback identity | 19 sequential inserts per Brain request | 1 batch |
| Knowledge inventory | 2 redundant COUNT queries | 0 (array-derived) |
| Repair extraction (same-run identical requests) | 2-3 model calls | 1 (cache hit) |
| Transcript snapshot (production) | deep clone of full agent transcript every turn | skipped (`captureMessages: false`) |
| Cancellation | aborts swallowed into degraded results; listeners leaked | aborts propagate; listeners cleaned on settlement |

## Not re-measured (structural, no before/after claimed)

- Full-corpus re-embed on any document change (deferred: needs generation-reuse design).
- ~1.5 MB workspace snapshot shipped to the browser on every page load (deferred: needs the summary endpoint UI contract).
- Raw token streaming (deferred by the plan: progress stages shipped instead).
- Folder-upload batching (blocked: corpus reconciliation prerequisite).

## Follow-up that would settle it

The right yardstick is per-stage timing, not end-to-end: the turn-progress route now exposes `searching → drafting` (retrieval + setup) and `drafting → checking_citations` (answer + repairs) boundaries; polling it across 30+ turns per build on a quiet machine would isolate the pipeline overhead from model variance. The perf-guard rig (AGENTS.md) is the template for making that a repeatable gate.
