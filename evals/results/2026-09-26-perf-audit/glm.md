Read-only audit complete. I traced the chat turn end to end (Brain route → execute-turn → agent run → retrieval → answer passes → persistence), the retrieval pipeline, ingestion, and the UI render paths. Summary:

- The single biggest user-visible cost is that nothing streams: Workers AI chat runs with `stream: false` and the UI only renders the answer after the entire turn completes, so perceived latency equals full model completion plus repair passes.
- The retrieval pipeline runs 6+ network hops strictly sequentially; several (embedding, FTS, ACL-shape load) are independent and could overlap.
- `loadAclShapes` does a full DISTINCT scan of the active generation's chunks on every `search_knowledge` call, re-done for each search in a turn.
- Every Brain request in loopback mode pays ~19 sequential D1 statements to re-ensure the loopback principal; a page snapshot makes 4 Brain calls.
- Post-answer safety passes (repair, identifier recovery, abstention recheck, coverage) can chain 2-4 extra blocking model calls, each shipping the full evidence text.
- Persistence and UI have bounded but real costs: unbounded history read, N+1 evidence queries on conversation load, 250 ms cancellation polling, and a workspace snapshot that ships the entire corpus text to the client on every navigation.

```json
[
  {
    "id": "A-01",
    "title": "Chat model runs non-streaming end to end; answer appears only after full completion",
    "file": "src/lib/models/workers-ai-chat.ts",
    "lines": "131-148",
    "area": "latency",
    "mechanism": "runChat sends stream:false and awaits one blocking ai.run per model turn; createWorkersAiChatStream wraps it in an event stream that only pushes start/done after the whole response arrives. Downstream, src/components/rag-visibility-dashboard.tsx:253-299 awaits askAction (a server action that awaits the whole /turns call) and only then calls setTurns, so the UI shows a spinner until the model finishes generating, evidence is persisted, and the response round-trips.",
    "user_visible_effect": "Perceived answer latency equals full model generation time plus retrieval, repair passes and persistence (up to the 90 s wall budget in AGENT_BUDGETS) with zero incremental feedback; no time-to-first-token.",
    "fix": "Set stream:true in the Workers AI payload and forward SSE deltas through the existing event stream, then expose the stream to the chat route/UI (SSE or WebSocket via the existing ConversationRunLock socket) so paragraphs render as they arrive.",
    "risk": "Citation grounding validates only the final text today; streaming must keep enforcing grounding on the completed draft and the UI must not render unvalidated paragraphs as final.",
    "impact": "high",
    "confidence": "high",
    "how_to_verify": "Measure time-to-first-visible-text in the UI before/after; record the chat window with winrec and review frames during a slow multi-part question."
  },
  {
    "id": "A-02",
    "title": "Retrieval pipeline is fully sequential: six serial network hops per search",
    "file": "src/lib/retrieve/cloudflare-pipeline.ts",
    "lines": "92-146",
    "area": "latency",
    "mechanism": "search() awaits in order: loadAclShapes (92, D1) -> enumerateAllowedAclGroups (93, per-shape SHA-256) -> embedWithWorkersAi (106, AI) -> vectorize.query (111) -> loadVectorChunkIds (126, D1) -> FTS keyword query (140-143, D1) -> loadChunks (146, D1) -> rerank (170, AI). The embed+Vectorize chain and the ACL-shape load are independent; the FTS query does not depend on the vector channel at all, and loadVectorChunkIds can run concurrently with the FTS query. Authorization order is preserved: aclKeys are still computed before the Vectorize filter is built.",
    "user_visible_effect": "Each search_knowledge call pays 5-7 serialized D1/AI roundtrips (~5-15 ms each on D1, more for AI embedding) before answer synthesis starts; multi-part questions repeat the whole chain.",
    "fix": "Promise.all([ (loadAclShapes -> enumerateAllowedAclGroups -> buildVectorizeQuery -> embed -> vectorize.query -> loadVectorChunkIds), (FTS query) ]), then loadChunks; keep the vector-channel try/catch degradation semantics unchanged.",
    "risk": "Error semantics: a Vectorize failure must still degrade to keyword-only without killing the keyword results; keep the existing catch boundary around only the vector branch.",
    "impact": "high",
    "confidence": "high",
    "how_to_verify": "Log per-stage timings around search() before/after; compare total search() duration in the retrieval trace on a staging turn."
  },
  {
    "id": "A-03",
    "title": "loadAclShapes scans every chunk row of the generation on each search call",
    "file": "src/lib/retrieve/cloudflare-pipeline.ts",
    "lines": "215-234",
    "area": "db",
    "mechanism": "loadAclShapes runs SELECT DISTINCT access_scope, allowed_roles, allowed_departments, metadata FROM chunks WHERE generation_id = ? and JSON-parses two columns per row. It runs once per search_knowledge invocation; the system prompt instructs the model to search once per topic (agent/run.ts:103), so a two-part question pays it twice per turn. The result only changes when the active generation changes.",
    "user_visible_effect": "A full-generation table scan plus N JSON parses added to every search before any candidate is fetched; grows with corpus size.",
    "fix": "Cache shapes per generationId in a module-level Map (isolated per Worker isolate, invalidated when activeGenerationId changes); or persist a distinct acl_shapes table per generation at ingest time and read that.",
    "risk": "A stale cache after a promotion would authorize against the wrong generation; key strictly by generationId and clear on generation change.",
    "impact": "medium",
    "confidence": "high",
    "how_to_verify": "EXPLAIN QUERY PLAN timing on the DISTINCT scan at current corpus size; turn-trace delta after caching."
  },
  {
    "id": "A-04",
    "title": "Loopback mode re-runs ~19 sequential D1 statements on every Brain request",
    "file": "src/lib/store/loopback-principal.ts",
    "lines": "45-68",
    "area": "latency",
    "mechanism": "workers/brain/src/index.ts:238-244 calls ensureLoopbackPrincipal on every fetch: PRAGMA foreign_keys + INSERT principals + 9 role INSERTs + 8 department INSERTs, all awaited sequentially, followed by another PRAGMA run at index.ts:244. The rows are ON CONFLICT DO NOTHING no-ops after the first call, but every request (whoami, conversations, turns, knowledge, evaluations) still pays ~20 D1 roundtrips. loadWorkspaceSnapshot (src/app/actions.ts:297-304) makes 4 Brain calls per page load, quadrupling the overhead.",
    "user_visible_effect": "Roughly 20-80 ms of dead time added to every request and every page navigation before any real work starts.",
    "fix": "Run the ensure once per isolate (module-level promise memo keyed by subject) and keep only the PRAGMA (or set it at binding init); or fold the inserts into one batch().",
    "risk": "A cold isolate that skips the insert before an early failure could miss first-run bootstrap; keep the memoized promise error-safe so a failed bootstrap retries.",
    "impact": "medium",
    "confidence": "high",
    "how_to_verify": "Duration logged per operation in writeOperationalLog before/after; compare /whoami durationMs on a warm isolate."
  },
  {
    "id": "A-05",
    "title": "Workspace snapshot serializes the entire corpus text to the client on every navigation",
    "file": "src/lib/store/knowledge-inventory.ts",
    "lines": "95-153",
    "area": "io",
    "mechanism": "loadKnowledgeInventory selects full content of every chunk in the generation (95-102), joins per-document text (134-145), and returns documents with full text plus all chunks. WorkspacePage (src/components/workspace/workspace-page.tsx:26-60) passes documents and chunks into RagVisibilityDashboard for every view including /chat, so the RSC payload carries the whole corpus (65 documents x all chunk bodies) on each chat page load and each router.refresh(), even when the chat view never reads them.",
    "user_visible_effect": "Slower page loads and navigation, larger transfer and client memory; cost scales with corpus size on every turn navigation via router.replace(/chat/<id>) after each answer.",
    "fix": "Return metadata-only inventory (counts, statuses, chunk previews truncated) from /knowledge and fetch per-document chunk lists on demand in the knowledge view; or load snapshot lazily only when activeView is knowledge/evaluations.",
    "risk": "Document detail dialog and first-run status derive from full text; the on-demand fetch must cover those paths.",
    "impact": "high",
    "confidence": "high",
    "how_to_verify": "Compare RSC payload size / network transfer for /chat before and after; check client memory with the corpus seeded."
  },
  {
    "id": "A-06",
    "title": "Post-answer model passes can chain 2-4 extra blocking chat-model roundtrips",
    "file": "src/lib/agent/run.ts",
    "lines": "497-660",
    "area": "latency",
    "mechanism": "After the agent loop, runKnowledgeAgent can await up to three repair calls (citation repair at 506, strict identifier recovery at 543, abstention recheck at 585) plus the coverage pass at 638, sequentially. The abstention recheck fires whenever the model refused with evidence present (comment notes 2-3 Northwind misses per run), and coverage fires for any multi-part question with >=2 evidence documents. Each call re-sends the full evidence prompt (workers-ai-citation-repair.ts:86-117, 270-314 use formatEvidenceForPrompt over all ~8 chunks, up to 300 tokens each) with max_completion_tokens 1024.",
    "user_visible_effect": "Tail latency: a refusing or multi-part turn can add 1-4 full blocking model completions (seconds each) after the main answer, all invisible to the user.",
    "fix": "Cap the chain to one extra model call per turn (prefer the strict recovery over the abstention recheck when both gates match), and trim the evidence prompt to the top-ranked chunks relevant to the question instead of all evidence.",
    "risk": "Skipping the abstention recheck reintroduces the measured refusal misses; keep eval coverage (Northwind 120 questions) green before trimming.",
    "impact": "medium",
    "confidence": "high",
    "how_to_verify": "Count ai.run invocations per turn via AI Gateway logs; compare p95 turn latency for refusing and multi-part questions before/after."
  },
  {
    "id": "A-07",
    "title": "Cancellation watcher polls the Durable Object every 250 ms for the whole turn",
    "file": "src/lib/brain/execute-turn.ts",
    "lines": "233-257",
    "area": "latency",
    "mechanism": "watchCancellation awaits lock.cancelled() (a DO RPC that runs a SQLite query per call) in a loop with a 250 ms sleep for the entire agent run; a 90 s turn generates ~360 DO wake-ups. ConversationRunLock already supports WebSockets with fanOut on cancel (workers/brain/src/conversation-lock.ts:101-121,187-194) and a ping/pong auto-response, but the watcher never subscribes; it also adds one final awaited lock.cancelled() at execute-turn.ts:192 after the run completes.",
    "user_visible_effect": "Small direct latency per poll, but constant DO instantiation/egress during every turn and extra isolate wake-ups; on a busy operator this multiplies across concurrent turns.",
    "fix": "Replace the poll loop with a WebSocket connection to the conversation DO (cancel events are already broadcast) or raise the poll interval to 1-2 s; drop the post-run cancelled() check in favor of the abort signal the watcher already sets.",
    "risk": "WS lifecycle must be torn down on run end to avoid leaking sockets; the DO fanOut only reaches connected sockets, so a missed connect must fall back to polling.",
    "impact": "medium",
    "confidence": "high",
    "how_to_verify": "Count DO requests per turn in the Cloudflare metrics before/after; verify cancel still aborts within ~1 s."
  },
  {
    "id": "A-08",
    "title": "loadBoundedHistory reads every message of a conversation, then trims",
    "file": "src/lib/store/conversations.ts",
    "lines": "788-796",
    "area": "db",
    "mechanism": "The query selects id, role, content, status, parent_user_message_id FROM messages WHERE conversation_id = ? ORDER BY created_at ASC with no LIMIT; trimStoredHistory then keeps only the last 6 turns / 6000 chars. Long conversations read every stored row (including full answer bodies) per turn just to discard most of them.",
    "user_visible_effect": "Per-turn pre-run latency grows linearly with conversation length; on D1 this is an extra full-conversation scan per question.",
    "fix": "Bound the SQL: ORDER BY created_at DESC LIMIT ~24 (enough rows to pair 6 completed turns) then reverse in memory, preserving the parent_user_message_id pairing.",
    "risk": "The pairing logic in pairCompletedHistoryTurns depends on seeing the parent of a retained assistant row; the DESC window must include parents of kept assistants, so validate with an eval replay.",
    "impact": "medium",
    "confidence": "high",
    "how_to_verify": "Time loadBoundedHistory on a 100-turn conversation before/after."
  },
  {
    "id": "A-09",
    "title": "loadConversationForUi issues one evidence_snapshots query per assistant turn (N+1)",
    "file": "src/lib/store/conversation-queries.ts",
    "lines": "130-137",
    "area": "db",
    "mechanism": "Inside the per-assistant loop, each completed turn triggers its own SELECT ... FROM evidence_snapshots WHERE message_id = ?. A 50-turn conversation performs 50 sequential D1 queries on every conversation open, plus three more setup queries.",
    "user_visible_effect": "Conversation open latency grows linearly with turn count; this runs on every /chat/<id> navigation.",
    "fix": "Fetch all evidence for the conversation in one query: SELECT ... FROM evidence_snapshots WHERE message_id IN (SELECT id FROM messages WHERE conversation_id = ?) ORDER BY message_id, rank, then group in memory.",
    "risk": "Row count grows with turns; keep the result bounded or paginate very long conversations.",
    "impact": "medium",
    "confidence": "high",
    "how_to_verify": "Time /conversations/<id> on a long conversation before/after; count D1 queries per load."
  },
  {
    "id": "A-10",
    "title": "createPendingTurn performs ~8 sequential D1 roundtrips with redundant re-reads before the run starts",
    "file": "src/lib/store/conversations.ts",
    "lines": "367-481",
    "area": "db",
    "mechanism": "On the fresh path: sha256 digest (367), duplicate probe (368), claim probe (392), INSERT claim (426-443), re-SELECT the just-inserted claim (444), assertReplayPayload (448, one to two more reads), materializeClaimedTurn batch (457), re-SELECT materialized message (463), and assertConversationOwner (468/475) whose owner fact the claim row already carries. execute-turn also runs loadOwnedTurnHandleByRequestId again at execute-turn.ts:146-150 right after createPendingTurn just verified the same row.",
    "user_visible_effect": "Roughly 8-10 serialized D1 roundtrips (~30-60 ms) added before retrieval begins on every turn.",
    "fix": "Use the INSERT ... RETURNING result instead of re-reading the claim; skip the post-materialize re-SELECT when materializeClaimedTurn did not throw a unique conflict; drop the duplicate loadOwnedTurnHandleByRequestId in execute-turn when createPendingTurn already returned a non-duplicate pending handle.",
    "risk": "Idempotency semantics: the re-reads exist to arbitrate concurrent claimants; keep the UNIQUE-conflict fallback path intact when removing the fast-path re-reads.",
    "impact": "medium",
    "confidence": "medium",
    "how_to_verify": "Wrap createPendingTurn with per-statement timings; count D1 ops per /turns request before/after."
  },
  {
    "id": "A-11",
    "title": "rescoreLocally tokenizes the entire allowed corpus as BM25 background on every search",
    "file": "src/lib/retrieve/keyword-score.ts",
    "lines": "170-189",
    "area": "latency",
    "mechanism": "rescoreLocally builds background from passageForRescore over every allowed chunk returned by loadChunks and bm25Over tokenizes each background text (128-133) plus the hit texts again (125-127), on each search_knowledge call. With hundreds of chunks at ~300 tokens this is ~100k+ regex tokenizations per search, repeated per search in a turn, purely on Workers CPU.",
    "user_visible_effect": "CPU milliseconds added per search on the hot path; contributes to the 30 s CPU-style budget pressure and latency under load, scaling with corpus size.",
    "fix": "Restrict the background set to the candidate set (union of vector + keyword hits) instead of all loaded chunks, or precompute token counts per chunk at ingest time and store them.",
    "risk": "IDF statistics shift when the background shrinks, changing keyword scores and possibly eval rankings; the retrieval fingerprint version must be bumped per RAG rules.",
    "impact": "low",
    "confidence": "medium",
    "how_to_verify": "Benchmark rescoreLocally wall time at current corpus size; re-run the Northwind 120-question eval after the change."
  },
  {
    "id": "A-12",
    "title": "Any document add, delete or reindex rebuilds and re-embeds the entire corpus sequentially",
    "file": "src/lib/store/corpus-seed.ts",
    "lines": "166-188",
    "area": "throughput",
    "mechanism": "seedNorthwindCorpus embeds in batches of 8 with awaited sequential loops (166-181) and upserts in batches of 20 sequentially (183-188); per chunk it also awaits two SHA-256 digests (127-128). The Brain routes make this worse: /knowledge/seed with merge:true (workers/brain/src/index.ts:637-687) loads every stored document via loadSeedDocumentsFromGeneration and re-seeds all of them, and DELETE /knowledge/documents/<id> (724-767) rebuilds the whole generation to remove one document.",
    "user_visible_effect": "Adding one small document or deleting one takes tens of seconds (hundreds of chunks x sequential embed calls at several hundred ms each) during which the UI blocks on embedAction/reindexAction and the corpus shows as processing.",
    "fix": "Run embed batches with bounded concurrency (e.g. 4-8 in flight via Promise.all), and make single-document add/delete an incremental chunk rewrite for that document within a new draft generation instead of a full-corpus rebuild.",
    "risk": "Concurrent embedding changes failure handling for partial batches; incremental rebuild must still produce a complete, auditable generation before ready (D1-authoritative, promote-only retrieval).",
    "impact": "medium",
    "confidence": "high",
    "how_to_verify": "Time /knowledge/seed with one 10 KB document added to the 65-doc corpus before/after; verify the mutation audit still reports clean."
  },
  {
    "id": "A-13",
    "title": "activeGenerationId queried twice per turn and rerank head computed from full candidate set",
    "file": "src/lib/brain/execute-turn.ts",
    "lines": "265, 196, 425-430",
    "area": "db",
    "mechanism": "execute-turn awaits activeGenerationId when building the pipeline (265) and again after the answer completes (196 via activeGenerationIdFor) for corpusGenerationId; if the mid-turn re-read is intentional freshness validation it is fine, but it is undocumented and costs one extra D1 read per turn. Separately, rerankMerged (cloudflare-pipeline.ts:296-316) ships rerankCandidates=20 passages, each fitted up to ~512 rerank tokens, to bge-reranker on every search even when fetchLimit candidates are 24 and topK is 8.",
    "user_visible_effect": "Minor: one extra D1 read per turn; rerank payload (~6k tokens) is a fixed per-search AI cost that grows answer latency slightly.",
    "fix": "Reuse the generationId captured at pipeline build unless the turn detected a promotion (or comment the re-read as intentional); no rerank change without a measured eval per RAG rules.",
    "risk": "Removing the second read could mislabel corpusGenerationId if a promotion lands mid-turn; keep it unless correctness is asserted elsewhere.",
    "impact": "low",
    "confidence": "low",
    "how_to_verify": "Diff per-turn D1 op counts; confirm intent of the second read with the master plan wording before changing."
  },
  {
    "id": "A-14",
    "title": "Knowledge workspace renders every paged document twice and recomputes word counts on state toggles",
    "file": "src/components/knowledge/knowledge-workspace.tsx",
    "lines": "96-119, 368-375",
    "area": "ui",
    "mechanism": "DocumentTable (md:block) and DocumentRows (md:hidden) are both always mounted for the same pagedDocuments (368-375), doubling render work. The inventory useMemo (96-119) runs countWords over each document's full text and rebuilds section Sets for every document whenever isEmbedding/isReindexing flip or chunk/document identity changes (e.g. router.refresh() snapshots), despite wordCount only being read inside the detail dialog.",
    "user_visible_effect": "Noticeable on low-end clients with large corpora: doubled table renders and O(total corpus text) recomputation on each refresh; not on the chat hot path.",
    "fix": "Compute wordCount lazily inside DocumentDetailDialog (or memoize per document), and render the mobile list only via CSS-visible conditional mount (matchMedia or window width state).",
    "risk": "Minimal; layout behavior of the md:hidden pattern must be preserved.",
    "impact": "low",
    "confidence": "medium",
    "how_to_verify": "React Profiler commit timings on the knowledge view with the corpus seeded, before/after."
  }
]
```
