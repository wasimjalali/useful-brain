# Burooj migration ledger

Status: Phase 4 grounded answers, host finalizer, evidence snapshots and server-owned conversations are in place. Pi agent loop remains Phase 5.

Sanad source commit: `630ba08dc7cad6aa71942d6842ce6d8d55a26873`  
Sibling checkout: `/Users/wasimjalali/Desktop/Personal Project/Burooj`  
Checkout note: HEAD matches the locked commit. The worktree is dirty with Tabari UI files only; Sanad sources used for this ledger were not modified.

Target contract tests named below are planned Useful Brain files unless Status is Ported.

## Named eval slices

| Slice | IDs | Fake-provider 2026-08-26 local memory run | Locked real-stack (Burooj docs, not re-run) | Useful Brain status |
| --- | --- | --- | --- | --- |
| Full 120-question set | q001–q120 | recall 0.907, MRR 0.821, nDCG 0.831, citation 0.505, ACL leaks 0 | See fingerprint below | Ported: fake-provider CI floors 0.90/0.80/0.82/0.49 pass |
| Locked multi-hop | q086–q090 | recall 0.80, MRR 0.80, nDCG 0.707, citation 0.00 | reranker off 0.80/1.00/0.829/0.20; BGE+0.05 floor 0.90/1.00/0.923/0.80 | Named slice preserved |
| Expanded multi-hop | q116–q120 | recall 0.60, MRR 0.80, nDCG 0.600, citation 0.20 | reranker off 0.60/0.90/0.645/0.60; BGE+0.05 floor 0.80/0.90/0.768/0.60 | Named slice preserved |

Question distribution at the locked commit: 70 factual, 17 trap, 13 permission, 10 unanswerable, 5 locked multi-hop, 5 expanded multi-hop. Corpus: 65 Markdown documents.

## Retrieval fingerprint to preserve

Recorded from `Burooj/sanad/env.example` and `docs/superpowers/plans/2026-08-07-remaining-work-plan.md` for the **real** stack. This is the Useful Brain starting profile.

| Knob | Locked real-stack value |
| --- | --- |
| Chunking | 300 estimated tokens, 30-token overlap, heading boundaries, sentence-aware cuts, character anchors |
| Fusion | 0.70 vector / 0.30 keyword |
| Keyword candidates | 6 |
| Rerank candidates | 20 |
| Reranker | `@cf/baai/bge-reranker-base` |
| Relevance floor | 0.05 |
| Embedding | `@cf/qwen/qwen3-embedding-0.6b`, 1024 dimensions, cosine |
| Parent expansion | off |
| Conflict detection | off |
| Index inventory at last Burooj closeout | 807 expected, 807 present, stable processed watermark |

The fake-provider CI ratchet is a **separate** fingerprint. The 2026-08-26 unpaid local run used library fake defaults: MemoryChunkStore, `sanad-fake-embed` 64-d, no reranker, 500/50 chunks, 0.20/0.80 fusion, keyword candidates 6, rerank window 20, floor 0.0, 649 chunks. That matches `sanad/tests/test_evals.py` and must not be mixed with the real-stack numbers.

## Capability map

| Capability | Burooj source | Burooj tests | Useful Brain destination | Target contract test | Status |
| --- | --- | --- | --- | --- | --- |
| 300/30 chunking and character anchors | `sanad/src/sanad/ingest/chunker.py`, `sanad/env.example` | `sanad/tests/test_chunker.py`, `test_passage_anchors.py` | Ingestion Worker | `src/lib/ingest/chunker.test.ts` | Ported: 300/30, headings, sentence cuts, pretokens, decimal `.` not a sentence end, oversized pretoken hard-split, character anchors |
| Query/document embedding instructions | `sanad/src/sanad/ingest/embeddings.py` | `sanad/tests/test_embeddings_factory.py` | Workers AI embedding adapter | `src/lib/embeddings/instructions.test.ts` | Ported: query instruction vs document payload; `@cf/qwen/qwen3-embedding-0.6b` 1024 cosine |
| D1 FTS5 and Vectorize projection | `sanad/src/sanad/store/cloudflare.py` | `sanad/tests/test_store_cloudflare.py` | Corpus D1 + Vectorize repositories | `src/lib/store/cloudflare-fts.test.ts` | Ported: FTS5 external-content, AUTOINCREMENT rowid, triggers, generation+ACL MATCH; Vectorize mutation wait, metadata index, 2048-byte filter cap, generation namespace |
| Hybrid fusion and local keyword rescoring | `sanad/src/sanad/retrieve/fusion.py`, `keyword_score.py` | `sanad/tests/test_fusion.py`, `test_pipeline.py` | Retrieval pipeline | `src/lib/retrieve/fusion.test.ts`, `keyword-score.test.ts` | Ported |
| Cross-encoder rerank and score floor | `sanad/src/sanad/retrieve/reranker.py` | `sanad/tests/test_reranker.py` | Workers AI reranker | `src/lib/retrieve/rerank.test.ts` | Ported: FakeReranker, heading prefix, 0.05 floor, fail-closed Workers AI parser. Live BGE eval is a written exception |
| Parent context off / conflict off | `sanad/src/sanad/retrieve/parent.py`, `conflict.py` | `test_parent_retrieval.py`, `test_conflict_detect.py` | Context assembly | `src/lib/retrieve/parent-off.test.ts` | Ported: both off |
| 65-document Northwind corpus and 120 questions | `sanad/src/sanad/evals/corpus/` | `sanad/tests/test_evals.py`, `test_evals_loader.py` | TypeScript eval fixtures | `src/lib/eval/northwind.test.ts`, `fake-provider-eval.test.ts` | Ported |
| Keyword oracle | `sanad/tests/test_keyword_oracle.py` | same | Retrieval ACL | `src/lib/acl/keyword-oracle.test.ts` | Ported |
| Window eviction | `sanad/tests/test_window_eviction.py` | same | Retrieval ACL | `src/lib/acl/window-eviction.test.ts` | Ported |
| Exact D1/Vectorize inventory audit | `sanad/src/sanad/store/audit.py` | `sanad/tests/test_store_audit.py` | Reconciliation workflow | `src/lib/store/inventory-audit.test.ts` | Ported: exact mutation equality, paginated IDs, moving audit is partial and blocks promotion |
| ACL grouping and pre-score filtering | `sanad/src/sanad/permissions/acl.py` | `sanad/tests/test_acl_filter.py`, `test_permissions.py` | Authorization and retrieval policy | `src/lib/acl/acl-group.test.ts`, `acl-filter.test.ts` | Ported: length-prefixed injective SHA-256 `[:32]`; non-string private owner denies; store-side filter equivalence |
| Access JWT verification | `sanad/src/sanad/auth/access_jwt.py` | `sanad/tests/test_auth_access_jwt.py` | Brain Access middleware | `src/lib/auth/access-jwt.test.ts`, `workers/brain/test/access-jwt.test.ts` | Ported as optional capability. Not a launch gate (Wasim 2026-08-27 local portfolio product). |
| Connector lifecycle and SSRF controls | `sanad/src/sanad/connectors/` | `test_connectors.py`, `test_live_http.py` | Ingestion connectors | `src/lib/connectors/http-allowlist.test.ts`, `src/lib/connectors/github-tree.test.ts`, `src/lib/connectors/config-scrub.test.ts` | Ported: GitHub truncated listings fail; stale delete only after complete list+ingest; HTTP allowlist-only with redirects refused; recursive secret scrub; named `CONNECTOR_*` bindings |
| Answer contract | `sanad/tests/test_brain_answer_contract.py` | same | RAG answer validation | `src/lib/answer/contract.test.ts` | Ported: structured `grounded` / `insufficient_evidence`, current-run citation labels only, empty retrieval abstains |
| Host grounding finalizer | `tabari/tests/agent/test_brain_grounding.py` | same | Brain host finalizer | `src/lib/agent/host-grounding.test.ts` | Ported: must-retrieve, current-turn `search_knowledge` ledger, invalid citation refuse, deterministic unavailable without transport leakage. Tabari session-DB/finalize_turn and deferred-tool cache are not ported |
| Current Nura citation/refusal/ops records | Useful Brain `convex/groundedAnswer.ts`, `convex/operations.ts` | `convex/groundedAnswer.test.ts`, `convex/operations.test.ts`, `src/lib/eval/run-eval.test.ts` | Keep through Phase 4 shadow | `src/lib/answer/convex-shadow.test.ts` plus existing Convex tests | Shadow parity; Convex remains the live UI |

## Invariants that must survive the TypeScript rewrite

| Invariant | Burooj proof | Useful Brain status |
| --- | --- | --- |
| ACL candidate generation over allowed content only; `acl_group` is length-prefixed injective SHA-256 truncated to 32 hex | `permissions/acl.py`, `test_acl_filter.py` | Ported |
| Over-wide principals raise `AclTooWide`; grants are never truncated | `test_acl_filter.py` | Ported |
| Private owners are non-empty strings; D1 owner extraction fails closed | `store/cloudflare.py` | Ported in `ownerOf` |
| Query and document embedding instructions remain distinct; Vectorize cosine only | `ingest/embeddings.py` | Ported |
| External-content FTS5 uses `INTEGER PRIMARY KEY AUTOINCREMENT`, insert/update and delete triggers, `ON CONFLICT DO UPDATE`; `INSERT OR REPLACE` forbidden | `test_store_cloudflare.py` | Ported |
| Vectorize mutation IDs are opaque; wait for exact equality; paginated ID inventory; moving audit is partial | `store/audit.py` | Ported |
| GitHub truncated listings fail the sync | `connectors/` + `test_connectors.py` | Ported |
| HTTP fetch pins validated public addresses or stays allowlist-only | `connectors/` + `test_live_http.py` | Allowlist-only; redirects not followed |
| Connector config recursively scrubbed; only named secret-binding references | `test_connector_instances.py` | Ported (`secret_binding` / `CONNECTOR_*`) |
| Access JWT: RS256, application token, fail closed; roles/departments from server directory | `auth/access_jwt.py` | Ported as optional capability. Not a launch gate |
| Eval loader rejects duplicate keys; fake and real ratchets stay separate | `test_evals.py`, `test_evals_loader.py` | Ported |
| Must-retrieve, current-turn evidence ledger, deterministic unavailable/insufficient_evidence, no transport leakage | `test_brain_grounding.py` | Ported |
| Permission, keyword-oracle and window-eviction suites are release blockers | named tests above | Ported |

Do not port the Python/FastAPI shell, Tabari desktop, Tabari’s unrelated agent framework, or REST clients that Workers bindings replace.
