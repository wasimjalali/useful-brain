
## A. Chat turn model-call chain
- (src/lib/agent/run.ts) Up to four extra Workers AI calls per answer, all strictly sequential after the agent loop
    fix: Fold the identifier recovery and the abstention recheck into a single repair call: they use the same model, the same prompt shape and the same evidence, and differ only in `strictTokens` / `lexicalFal
- (src/lib/models/workers-ai-chat.ts) Chat turn blocks on a full non-streamed generation with no output cap
    fix: Set an explicit max_completion_tokens to bound reasoning, then switch to stream:true and forward deltas (Workers AI SSE -> brain /turns -> client fetch reader, or the existing ConversationRunLock WebS
- (src/lib/agent/run.ts) Coverage pass adds a full second generation per multi-part answer
    fix: Gate the call behind a cheap host-side precondition (e.g. a question-referenced evidence document is still uncited, or the draft cites fewer than two evidence documents) before paying the model call.
- (src/lib/agent/run.ts) Refusal path can chain up to three extra model calls after the loop
    fix: Merge the strict-token and abstention rechecks into one call (strictTokens is only an acceptance filter, lexicalFallback is already a parameter) and skip them when no question identifier occurs in the
- (src/lib/agent/run.ts) toolExecution 'sequential' serializes the model's multiple searches
    fix: Set toolExecution:'parallel' (search_knowledge is read-only and idempotent) and verify ledger label assignment and deadline signals under concurrency.
- (src/lib/agent/run.ts) The full agent transcript is deep-cloned for a field production never reads
    fix: Return the live array or a cheap shallow copy and keep the deep clone as a test helper.
- (src/lib/models/workers-ai-chat.ts) Chat answer is non-streamed end to end, no partial output
    fix: Stream tool-call/answer deltas over the existing conversation-lock WebSocket or a chunked response, and render partial answer text while grounding validation runs at the end.
- (src/lib/agent/run.ts) Up to four extra sequential model calls after the main answer
    fix: Run identifier/abstention retries only when the draft is actually a refusal or invalid citation with identifier overlap; skip coverage when draft already cites all evidence docs; cap to one repair att
- (src/lib/agent/run.ts) Multi-search turns run full retrieval pipelines serially
    fix: Keep sequential execution but reduce fan-out: constrain the prompt to one search plus one follow-up, or batch the two queries into one fused retrieval; do not parallelize tool calls without Pi Agent C
- (src/lib/models/workers-ai-chat.ts) Chat model runs non-streaming end to end; answer appears only after full completion
    fix: Set stream:true in the Workers AI payload and forward SSE deltas through the existing event stream, then expose the stream to the chat route/UI (SSE or WebSocket via the existing ConversationRunLock s
- (src/lib/agent/run.ts) Post-answer model passes can chain 2-4 extra blocking chat-model roundtrips
    fix: Cap the chain to one extra model call per turn (prefer the strict recovery over the abstention recheck when both gates match), and trim the evidence prompt to the top-ranked chunks relevant to the que


## B. Per-turn D1 persistence
- (src/lib/store/conversations.ts) loadBoundedHistory reads every message in the conversation, then trims to 6 turns in JavaScript
    fix: Select newest-first with a bounded limit and reverse in JS: `ORDER BY created_at DESC, id DESC LIMIT 24` (2 messages per turn x 6 turns, plus slack for pending and orphaned rows), then `.reverse()` be
- (src/lib/store/conversations.ts) Nine sequential operations-D1 round trips before any model work, three of them redundant
    fix: Use the insert's `meta.changes` to detect the claim winner instead of re-reading at 444: `changes === 1` means this caller wrote the row and already knows every field; only re-read on a conflict. Hois
- (src/lib/store/corpus-seed.ts) A single document change re-embeds the entire corpus in strictly sequential batches
    fix: Two changes, in order of value. First, parallelize the embedding loop with a bounded concurrency window (4-8 in flight) instead of one at a time. Second, stop the rejoin: persist document bodies in `d
- (src/lib/store/conversations.ts) completeTurn writes the turn, then reads all of it back, and the answer is structured three times
    fix: Build the `ReplayedTurn` once in `completeTurn` from the values already in hand - `content`, `structured.paragraphs`, `answerModel` and `input.evidence` - instead of re-reading, keeping `loadReplay` o
- (src/lib/store/corpus-seed.ts) Each upload re-chunks and re-embeds the entire corpus, once per file in folder uploads
    fix: Send the folder queue as one seed call with all documents, and support appending to an existing draft generation so unchanged documents reuse their chunks and vectors.
- (src/lib/store/conversations.ts) Per-turn persistence repeats ownership checks and replay loads
    fix: Verify ownership once per turn and pass the verified conversation id through; fold the pre-commit replay check into the pending lookup; return the committed row from completeTurn instead of replaying 
- (src/lib/store/conversations.ts) createPendingTurn does 6-8 serial D1 roundtrips before the model starts
    fix: Collapse duplicate-check plus claim load into one query path and skip the post-insert reload when the insert won; keep idempotency checks but remove redundant selects.
- (src/lib/store/conversations.ts) Post-answer persist blocks the response on heavy writes plus re-reads
    fix: Return the already-validated answer after the batch write succeeds and do the final loadReplay lazily; keep persist-then-release ordering but avoid the pre-write loadReplay when status is known pendin
- (src/lib/store/conversations.ts) History loads the whole conversation then injects it into the prompt
    fix: Add LIMIT/OFFSET or DESC LIMIT query for the last ~12 messages and keep the JS trim as a guard; consider excluding prior answers from retrieval tool context.
- (src/lib/store/conversations.ts) loadBoundedHistory reads every message of a conversation, then trims
    fix: Bound the SQL: ORDER BY created_at DESC LIMIT ~24 (enough rows to pair 6 completed turns) then reverse in memory, preserving the parent_user_message_id pairing.
- (src/lib/store/corpus-seed.ts) Any document add, delete or reindex rebuilds and re-embeds the entire corpus sequentially
    fix: Run embed batches with bounded concurrency (e.g. 4-8 in flight via Promise.all), and make single-document add/delete an incremental chunk rewrite for that document within a new draft generation instea


## C. Retrieval pipeline seriality
- (src/lib/retrieve/cloudflare-pipeline.ts) Retrieval search() is a fully serialized chain; the keyword branch has no dependency on the vector branch
    fix: Start the FTS promise at the top of `search()`, before `loadAclShapes`, and await it alongside the vector branch rather than after `loadVectorChunkIds`. Keep `loadChunks` as the join point so it still
- (src/lib/retrieve/cloudflare-pipeline.ts) loadAclShapes re-derives the per-generation ACL shape set on every search()
    fix: Memoize per isolate: `const aclShapeCache = new Map<string, AclShape[]>()` keyed by `generationId`, populated on first use. Evicting is not needed because a generation's chunks are immutable once writ
- (src/lib/retrieve/cloudflare-pipeline.ts) Search runs the vector path, FTS and id lookups as one serial chain
    fix: Kick off embedWithWorkersAi and the FTS query first, await aclKeys separately, then vectorize.query, then Promise.all([loadVectorChunkIds, ftsResult]) before loadChunks and the existing post-load ACL 
- (src/lib/retrieve/cloudflare-pipeline.ts) ACL shapes are re-scanned and re-hashed on every search of a turn
    fix: Memoize shapes and aclKeys lazily on CloudflareKnowledgePipeline keyed by generationId; the instance already pins one principal and generation per turn.
- (src/lib/retrieve/cloudflare-pipeline.ts) Retrieval pipeline awaits vector and keyword channels serially
    fix: Start embedWithWorkersAi concurrently with loadAclShapes/enumerateAllowedAclGroups; run the FTS D1 query concurrently with the vector branch and join before loadChunks/fusion. Keep ACL filter construc
- (src/lib/acl/access.ts) ACL group hashing is serial per shape on the hot path
    fix: Cache shape-to-key map per generationId in memory; compute missing keys with Promise.all instead of serial await.
- (src/lib/retrieve/workers-ai-rerank.ts) Reranker receives up to 20 full passages of ~512 tokens per search
    fix: Lower rerankCandidates for the hot path or shorten passages to first ~200 tokens before rerank; keep full text only for cited hits.
- (src/lib/retrieve/cloudflare-pipeline.ts) Retrieval pipeline is fully sequential: six serial network hops per search
    fix: Promise.all([ (loadAclShapes -> enumerateAllowedAclGroups -> buildVectorizeQuery -> embed -> vectorize.query -> loadVectorChunkIds), (FTS query) ]), then loadChunks; keep the vector-channel try/catch 
- (src/lib/retrieve/cloudflare-pipeline.ts) loadAclShapes scans every chunk row of the generation on each search call
    fix: Cache shapes per generationId in a module-level Map (isolated per Worker isolate, invalidated when activeGenerationId changes); or persist a distinct acl_shapes table per generation at ingest time and


## D. Request setup overhead
- (src/lib/store/knowledge-inventory.ts) Every workspace page load ships the whole corpus (~1.5 MB) to the browser, including on the chat view
    fix: Stop sending corpus text with the page shell. Have `/knowledge` return only document metadata and per-document chunk counts, and load chunk text through a server action (`/knowledge/chunks?documentId=
- (workers/brain/src/index.ts) Loopback identity runs ~20 sequential D1 round trips on every Brain Worker request
    fix: Move the loopback bootstrap out of the request path: run it once per isolate behind a module-level `let bootstrapped: Promise<void> | undefined` memo, or gate it on a `SELECT 1 FROM principals WHERE i
- (src/lib/brain/execute-turn.ts) activeGenerationId is queried twice per turn with identical SQL
    fix: Have `knowledgePipeline()` return `{ pipeline, generationId }` and pass that `generationId` to `completeTurn` instead of calling `activeGenerationIdFor`. Note the `?? "none"` fallback at line 196 alre
- (src/lib/store/knowledge-inventory.ts) Load-knowledge-inventory runs seven strictly sequential D1 queries, two of them redundant counts
    fix: Run (66) and (67-71) with `Promise.all`, then (84), (85-94) and (95-102) with `Promise.all`, and derive `storedDocuments`, `storedChunks`, the document list and the chunk-to-path map from the chunk ro
- (src/lib/brain/execute-turn.ts) Active generation id is queried twice per turn
    fix: Have knowledgePipeline return the resolved generation id (or read it once into a local) and reuse it for completeTurn.
- (src/lib/brain/execute-turn.ts) Cancellation watch polls the Durable Object every 250ms for the whole turn
    fix: Push cancellation through the lock's existing hibernating WebSocket fanOut (conversation-lock.ts:187-194) or relax the poll to 1s with a final check before persistence.
- (workers/brain/src/index.ts) Loopback identity re-upserts 18 rows on every request
    fix: Run the bootstrap once per isolate behind a module-scope promise, batch the inserts with db.batch, and drop the duplicate PRAGMA.
- (src/lib/brain/execute-turn.ts) Same slowly-changing retrieval metadata re-queried per search and per turn
    fix: Resolve generationId, ACL shapes, and namespace once per turn in executeTurn and pass them into the pipeline/search tool; invalidate only on promotion.
- (src/lib/store/loopback-principal.ts) Loopback mode re-runs ~19 sequential D1 statements on every Brain request
    fix: Run the ensure once per isolate (module-level promise memo keyed by subject) and keep only the PRAGMA (or set it at binding init); or fold the inserts into one batch().
- (src/lib/store/knowledge-inventory.ts) Workspace snapshot serializes the entire corpus text to the client on every navigation
    fix: Return metadata-only inventory (counts, statuses, chunk previews truncated) from /knowledge and fetch per-document chunk lists on demand in the knowledge view; or load snapshot lazily only when active
- (src/lib/brain/execute-turn.ts) Cancellation watcher polls the Durable Object every 250 ms for the whole turn
    fix: Replace the poll loop with a WebSocket connection to the conversation DO (cancel events are already broadcast) or raise the poll interval to 1-2 s; drop the post-run cancelled() check in favor of the 


## E. UI payload and render
- (src/lib/agent/deadlines.ts) Abort and read-tool deadlines reject the caller but never cancel the underlying work
    fix: Thread an `AbortSignal` through `KnowledgePipeline.search` into the Workers AI and Vectorize calls, and pass `options.signal` into the `ai.run` payloads where the Workers AI binding supports it. Keep 
- (src/components/knowledge/knowledge-workspace.tsx) knowledge-workspace recomputes word counts over the whole corpus on every indexing-state toggle
    fix: Split the memo: keep the chunk grouping and per-document derived counts (including word count) in a memo keyed only on `[chunks, documents]`, and compute the status string separately keyed on the stat
- (src/components/rag-visibility-dashboard.tsx) The full turns array including all evidence text is duplicated into client conversation state on every answer
    fix: Store only the conversation summary in `conversations` - `{id, title, turns: [], createdAt, updatedAt}` - and keep the authoritative turn list in the existing `turns` state, which is what `ChatWorkspa
- (src/components/chat/chat-workspace.tsx) No streaming or progress signal, so the whole serial turn chain lands as one spinner
    fix: Cheapest version: have the turn emit coarse phase events over the existing `ConversationRunLock.broadcast` - 'retrieving', 'answering', 'validating' - and render them as the indicator label. This need
- (src/components/workspace/workspace-page.tsx) Every chat navigation refetches the whole corpus, twice over
    fix: Return only counts and status for chat views and load documents/chunks lazily when the knowledge view opens; stop duplicating document text since chunks already carry it; keep client state stable acro
- (src/components/chat/chat-workspace.tsx) Typing re-renders every conversation turn
    fix: Wrap ConversationTurn in React.memo with stable callbacks (useCallback keyed by turn.id), or move the draft state into the composer component.
- (src/components/knowledge/knowledge-workspace.tsx) Folder uploads run strictly one file at a time
    fix: Upload with bounded concurrency (2-3) or add a batch add-documents server action; keep per-file skip messages.


## F. Unassigned
- (src/lib/store/conversation-queries.ts) loadConversationForUi runs one evidence_snapshots query per turn, inside the loop
- (src/lib/store/conversation-queries.ts) Opening a conversation issues one evidence query per turn
- (src/lib/store/conversation-queries.ts) loadConversationForUi issues one evidence_snapshots query per assistant turn (N+1)