# Perf audit round 1: four-model parallel audit of the chat hot path

Date: 2026-09-26. Repo commit at audit time: `5215b65` (main).

## Question

No specific complaint yet: where does Useful Brain lose time, CPU, memory and I/O across chat turn latency, retrieval pipeline cost, ingestion throughput and UI render/poll behavior? Prioritize user-visible latency on the chat path.

## What ran

Four independent read-only audits through `opencode run --variant max`, launched in parallel with the same brief (`brief-round1.md` in the raw files), 900 s wall budget each:

| Model | Findings | Report |
|---|---|---|
| opencode-go/space-bunny-free (bunny) | 19 | bunny.md |
| opencode-go/deepseek-v4.1-flash (deepseek) | 19 | deepseek.md |
| opencode-go/muse-spark-1.3-contributor (muse) | 17 | muse.md |
| opencode-go/glm-5.3-flash (glm) | 14 | glm.md |

Total 69 raw findings, 52 after dedupe of high-impact/high-confidence items (`high-confidence-round1.json`, `clustered-round1.md`).

Round-trip notes: every model accepted `--variant max` on a test prompt, but glm's upstream rejected `reasoning_effort` on the real brief, so glm ran without a variant. mimo-v2.6-pro failed three times (opencode session-store error; 900 s timeout twice; a typo'd absolute path auto-rejected) and was skipped by operator decision. The `.err` files for aborted attempts are not kept here; reports are.

## Consensus clusters (models agreeing on the same mechanism)

Finds marked "verified" were confirmed by hand in source before fixing.

1. **Chat is fully non-streamed** (bunny/deepseek/muse/glm): `stream: false` in `src/lib/models/workers-ai-chat.ts:133`, single undifferentiated spinner in the UI. Unfixed: needs an SSE design through Brain and a UI streaming path.
2. **Post-answer repair/coverage chain** (bunny/deepseek/muse/glm): up to 3 sequential repair calls plus the coverage pass block before persist (`src/lib/agent/run.ts:502-660`). Verified. Unfixed: the passes exist for measured eval-regression reasons (2026-09-03, 2026-08-31 records); folding them is an eval-comparability decision, not a safe mechanical change.
3. **Retrieval pipeline seriality** (bunny/deepseek/muse/glm): vector channel embed → Vectorize query → id lookups → FTS → load → fuse → rerank all awaited in order. **Fixed**: keyword channel now runs concurrently (keyword SQL carries its own ACL predicate; authorization still applies before fusion), and ACL shapes are memoized per pipeline instance.
4. **Per-turn D1 persistence overhead** (bunny/deepseek/muse/glm): `createPendingTurn` ~8 sequential roundtrips; `loadBoundedHistory` reads every message then trims in JS; `loadConversationForUi` one evidence query per turn (N+1); completion re-reads. **Fixed**: bounded SQL tail for history, chunked `IN` batch for evidence. Not fixed: `createPendingTurn` shape (duplication defense); leave until a design pass.
5. **Full-corpus re-embed on any change** (bunny/deepseek/glm): reindex and single-document delete both route to `seedNorthwindCorpus` over all documents (`workers/brain/src/index.ts:673/708/753`). Verified. Unfixed: intentional for a synthetic 65-document corpus; becomes real when the corpus grows.
6. **Workspace snapshot ships the corpus to the browser** (bunny/glm): `loadKnowledgeInventory` returns full chunk text, `loadWorkspaceSnapshot` calls it for every page including `/chat`, ~1.5 MB payload. Verified. Unfixed: needs a UI contract decision on what the chat page actually consumes.
7. **Loopback identity ~19 sequential D1 statements per Brain request** (bunny/glm): **Fixed** with one `db.batch`. Not fixed: caching `ensureLoopbackPrincipal` lifetime per isolate, which changes identity semantics.
8. **activeGenerationId twice per turn** (bunny/deepseek/glm): **Fixed**, resolved once per turn.
9. **Redundant counts per knowledge load** (bunny): **Fixed**, counts from already-materialized arrays.
10. **Cancellation watcher polls the Durable Object every 250 ms** (deepseek/muse/glm): verified, kept as-is. Bounded by turn wall-time; introducing a DO alarm or notification path is a structural change disproportionate to the cost.

Cost: model usage only, Cloudflare credits. No Cloudflare metered spend.

## Changes landed

`perf/round1-hot-path-fixes` → PR #48. Six files, no behavior contract changed: fusion inputs, fingerprint, authorization ordering, trace fields and stored evidence are identical.

## Conclusion

Cross-model consensus localized the hot path in three places: serial retrieval, serial per-turn persistence and the closed feedback loop of non-streamed generation plus repair passes under one 90 s wall budget. Round 1 landed the mechanical reducts (serial awaits, duplicate reads, N+1). The remaining items are design decisions (streaming, repair-chain folding, snapshot shrinkage) and should be measured against a baseline before and after.

## Untested-baseline caveat

No end-to-end latency measurement exists yet (the app needs a live Workers AI stack for a real turn). The fixes remove measured-mechanism overhead with identical outputs; before/after timing on the live path remains open work for round 2.

---

# Round 2 record (2026-09-26, same day, autonomous execution)

Plan finalized with GPT-6 Astra at xhigh effort through Codex CLI (the finalized plan text was produced in-session; summary in the phases below). Implementation: SWE-2 in the Devin CLI (swe-2-max or swe-2-high per phase). Review loop per PR: SWE-2-high plus the three-model panel from round 1 (space-bunny-free, deepseek-v4.1-flash, muse-spark-1.3-contributor) via opencode run --variant max. Administrator: Claude (GLM 5.3 Flash). Opus reviewer was explicitly dropped from this round by Wasim.

| Phase | PR | Outcome |
|---|---|---|
| Visual verification technique | #49 | merged: cua-driver + winrec/framesheet + perf-guard reference recorded in AGENTS.md |
| Round-1 fixes | #48 | merged: 6 hot-path reducts; 3-model review found 1 high + 2 medium, all fixed and re-reviewed (deterministic history-tail regression test, unhandled-rejection fix, memo eviction fix) |
| 1 turn progress | #50 | merged: closed stage enum, Brain progress route, DO bounded stage writes, Next proxy, UI polling; live-verified searching→drafting→done through the installed app's stack |
| 2 cancellation propagation | #51 | merged: signals to every Workers AI call, aborts propagate (never keyword-degrade), listener cleanup, captureMessages skips production transcript clones; deepseek high (internal abort persisted as success) fixed before merge |
| 3 extraction reuse | #52 | merged: run-local extraction cache for repair passes, budget counts real invocations, ratchets unchanged; purity claim qualified per review |
| 4 generation cap candidate | #53 | DISCARDED at the gate: 3-model review converged on 4 blockers (truncated drafts stored as grounded answers; cap == whole run budget on a model that cannot disable thinking; usage parsing arms the cumulative budget so a cap-saturating draft discards validated answers; uncaught parse of truncated tool args). Per the plan: a failed candidate does not ship. Findings archived in pr53-review-*.md |
| Folder-import batching | — | not attempted (Astra blocker: no exact-inventory adapter for corpus reconciliation; merge gate blocked by design) |

Live verification: progress states observed through the installed app stack (searching → drafting → done) with the frame recorder running; cua-driver element clicks go stale against this WKWebView (AX republish), so the rendered-label check relies on the component tests; known gap recorded in visual-verification.json. Logo: unchanged per Wasim's skip instruction.
