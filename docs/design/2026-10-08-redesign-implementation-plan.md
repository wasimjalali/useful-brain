# Useful Brain redesign: implementation plan

Date: 2026-10-08. Spec: `docs/design/handoff-2026-10-08/README.md` (wins over the prototypes). Prompt: `docs/design/handoff-2026-10-08/PROMPT.md`.

Evidence for everything below lives in two recon reports, kept in the repo:

- `docs/design/2026-10-08-recon-frontend.md`: route and component inventory, artboard mapping (01–18 plus States), token deltas, test churn, frontend file plan.
- `docs/design/2026-10-08-recon-backend.md`: Brain HTTP surface, schema, status of all 17 backend gaps, turn pipeline, approvals, ingestion, test harness, endpoint contracts (TypeScript), migrations and the test list.

This file records the decisions, the amendments to the recon contracts and the delivery order. Where this file and a recon report disagree, this file wins.

## 1. Delivery shape

- Integration branch `feat/redesign-2026-10` off `main`. Each phase lands as a sub-branch PR into it, reviewed by two reviewers in parallel (GPT-6.1 Sol in Codex plus Sonnet; Opus as a third reviewer on security-sensitive diffs). Phase 7 opens the final PR to `main` with screenshots.
- Implementers are Sonnet subagents with disjoint file areas. Haiku takes mechanical work (icon port, copy sweeps). Opus orchestrates, checks each result and owns this plan.
- Every phase ends green on `npx tsc --noEmit`, `npm run typecheck:workers`, `npm run lint`, `npm test` and `npm run build`.

## 2. Decisions not in the spec

| # | Topic | Decision | Why |
|---|---|---|---|
| D1 | Corpus totals for members | Members see their readable count only ("Can read 34 documents"). The "of 62" denominator and the People bars appear on admin screens only. | Audit correction 1 and AGENTS "ACL before counts". README's "31 of 62" is on the admin's own account card, so the design already fits. |
| D2 | Admin role | New role string `admin`. `isAdmin = roles.includes("admin")`. Admin grants no document read rights. `operator` stays for the legacy `/knowledge/*` routes until they are deleted in Phase 5, then legacy routes accept `admin`. Loopback principal gets `admin`. | README gap 1. Keeps ACL independent of admin rights. |
| D3 | View as in session mode | Implemented as specced, admin only. Input changes to `assumePrincipalId` (a `principals.id`); roles and departments are resolved server-side, never from the browser. Assumed turns are never persisted (no conversation, no metrics) and always write a `view_as_audits` row. The loopback-only client-grant shape stays for loopback evals. Security-sensitive row: three reviewers. | README gap 15. Master plan §4: the browser never supplies grant lists. |
| D4 | "Exists but restricted" diagnostic | Admin only, after a refusal in a view-as turn. Returns title plus readers label, never chunk ids, scores, text or offsets. Excludes private-owner documents. Audited. Never enters model context. | Master plan pilot profile: administrators may see complete retrieval diagnostics, and admins already see every title in Sources. |
| D5 | Admin sees other people's questions (Activity) and all titles (Sources) | Allowed for admins. Private uploads show title plus "Private" only. Trace steps carry ids, counts and scores, never evidence text. | Same pilot profile clause; employees never see cross-user traces. |
| D6 | AI Gateway health row | The row reports the truth. Models call the `AI` binding directly today, so the row shows a warning dot with "Not in the call path". Workers AI health comes from a new `service_health_events` table written by a thin wrapper around `AI.run`. Routing models through AI Gateway is out of scope. | No mocks. Master plan §4/§8 drift is recorded here rather than hidden. |
| D7 | Draft checks | Run automatically once per draft after reconciliation: real Vectorize ID inventory plus the retrieval/ACL eval (no answer model) plus a per-upload ACL parity probe. Promote stays disabled unless checks passed and ACL leaks are 0. About 120 embeddings and 120 rerank calls per draft, inside the standing synthetic-eval authorization and the Workers AI safety limit. | README gap 13, audit correction 5. Evals UI stays read-only. |
| D8 | Upload formats and size | PDF, DOCX and Markdown (plus `.txt`), 25 MB per file. DOCX text comes from a package-free extractor (zip central directory plus `DecompressionStream("deflate-raw")`, `word/document.xml` text runs) with decompression-ratio, entry-count and time budgets. Extracted text is capped at 1.5 MB per document and rejected inline above that. Files go through a Next route handler, one request per file, not a server action. | No unapproved package needed (AGENTS stop condition avoided). Master plan §8 parser budgets. Server-action body limit is 12 MB. |
| D9 | Upload pipeline | `POST /admin/uploads` creates a batch in a draft generation with the ACL selection. Each file's text is stored in corpus D1 and an ID-only message goes on the ingest queue. The ingestion workflow chunks, embeds only new chunks, reuses embeddings for unchanged chunks (same model, dimensions, instruction, text and normalization, fetched with `getByIds`), upserts into the draft namespace, updates per-file stage and runs the draft checks. Discard marks the draft failed and deletes its namespace. The active generation never changes until Promote. | Master plan §5 generation state machine and §6 ingestion. |
| D10 | Demo people | A synthetic seed (`npm run seed:demo`) creates 148 Northwind principals with departments and roles; Maya Chen, Priya Shah and Jordan Ellis (admin) get passwords from a local, untracked seed input, never from the repo. | README people and counts. Synthetic only. |
| D11 | Invites | Admin-issued, single-use, expiring links (token shown once, only its hash stored). Accepting sets the password and creates the principal with exactly the invited role and department. An admin cannot invite another admin. The existing signup gate stays. | Not public signup; AGENTS allows it. |
| D12 | Citation chips | Chips render inline where the validated paragraph carries a `[n]` marker for one of its validated citation labels; otherwise at paragraph end. The answer contract is unchanged. | Keeps grounding and the 118/120 baseline untouched. |
| D13 | `/open` | Forced light, keeps Geist Sans through its own layout. | README says leave it untouched. |
| D14 | GitHub connector "Connect" | Shown in Settings with a disabled Connect button and "Not connected". A source-create endpoint is outside the 17 gaps. | No fake actions in production paths. |
| D15 | Suggested questions | `GET /suggestions` returns up to four curated questions whose target document the caller can read. | Screen 01 requires ACL-safe suggestions. |
| D16 | Turn progress | Additive closed union: `searching{readableDocuments}`, `reading{passages}`, `writing`, `done`, `failed{errorCode}`. Old stages map onto it. The UI holds each label at least 260 ms so `reading` doesn't flash. Validated text is revealed after the turn returns; no token streaming. | README 03 and audit correction 8. |
| D17 | Retry of a failed turn | `POST /turns {retryOfMessageId}` reuses the saved user message (`parent_user_message_id`). | README 06. |
| D18 | Document-scoped chat | `POST /turns {scopeDocumentId}` restricts retrieval to that document after ACL. Unreadable id returns 404. | Library "Ask about this". |
| D19 | Readable-document count | One SQL helper `countReadableDocuments` uses the same `aclSqlAndParams` predicate as the FTS channel, tested against the `canAccessChunk` oracle. | Same ACL code as retrieval. |

None of these contradicts the master plan or AGENTS.md, so Phase 0 does not stop.

## 3. Amendments to the backend contracts

Use recon-backend §8 with these changes:

- Add `WorkerNotFoundError` (code `NOT_FOUND`, 404). Unknown, unreadable and not-in-active-generation documents return byte-identical 404s.
- `GET /suggestions` (D15), `POST /turns` gains `retryOfMessageId` and `scopeDocumentId` (D17, D18), `assumePrincipalId` (D3).
- `POST /admin/uploads` takes `{readers, idempotencyKey, files:[{name,size}]}` and returns `{batchId, files:[{id,name}]}`. File text arrives per file at `PUT /admin/uploads/:batchId/files/:fileId` from the Next route handler.
- `POST /admin/drafts/:id/promote` and `/discard`. Promote requires `draft_checks.status = 'passed'` and `acl_leaks = 0`.
- `GET /config` and `GET /evaluations` (extended) are admin only.
- Health detail strings are closed codes mapped to copy in the UI.

Migrations, all additive: operations `0012_turn_metrics_feedback`, `0013_admin_invites_viewas`, `0014_tickets_approval_display`, `0015_turn_steps_health`; corpus `0004_document_catalog` (catalog, bodies, title and heading FTS with triggers, no `INSERT OR REPLACE`), `0005_uploads_draft_progress`. Existing generations get catalog and body rows through an idempotent backfill.

## 4. Phases and work packages

| Phase | Packages (owner) | Exit |
|---|---|---|
| 1 Foundations | 1a tokens, theme (pre-paint, persisted, live OS), fonts, motion, `/open` light (Sonnet). 1b Lucide icon port keeping export names (Haiku). 1c primitives plus `/design-check` (dev only) and a11y role tests (Sonnet). 1d backend foundation: Brain test harness with `CORPUS_DB`, `WorkerNotFoundError`, admin role and `requireAdmin` on `/admin/*`, extended `whoami`, `countReadableDocuments`, corpus `0004` plus backfill, seed personas (Sonnet). | Primitives render in both themes; admin gate tested (401/403/200); whoami count equals the oracle. |
| 2 Shell | `(app)` layout, rail, stage, evidence slot, breakpoints, ⌘N/⌘K, redirects, admin layout guard, `useChatTurn` extracted with the existing poll tests moved onto it. | Members can't see or reach admin routes (UI plus Brain, tested). |
| 3 Chat | Progress counts, metrics columns, feedback, document requests, suggestions, retry, `create_ticket` live wiring plus tickets plus approval display and expiry, documents endpoint plus spans; chat UI 01–07, evidence panel, linked hover and pin, reader. | Workerd and component tests listed in recon-backend §8 and PROMPT Phase 3. |
| 4 Search and Library | `/search`, `/library`, document-scoped chat; ⌘K dialog and Library page. | ACL leak tests by title, search and id. |
| 5 Admin | Overview, health, unanswered, activity plus `turn_steps`, sources, uploads pipeline and draft checks, people, groups, invites, view as, evals read-out; all admin pages. Legacy `/knowledge` UI and the monolith deleted. | Admin endpoint tests; Overview reconciles with Activity on seeded data. |
| 6 Settings, sign in, mobile | Settings dialog with `/config`; auth restyle; mobile slide-over and evidence sheet. | Keyboard pass, contrast at least 4.5:1 in both themes. |
| 7 Verification | Full checks, `preview:cf` screenshots and frame recordings into `evals/results/2026-10-xx-redesign/`, `npm run eval:northwind` (no regression from 118/120, 0 ACL leaks), final review, PR to `main`. | Everything green. |

## 5. Test list

Recon-backend §8 "Test list" plus recon-frontend §5 (tests to rewrite, accessible names to keep). Failure cases are written before the code for every Brain route, per the repo's test-first rule.

## 6. Docs to update at the end

`README.md` screenshots, `CLAUDE.md` code map, master plan §8 (view as in session mode) and §9 (admin diagnostics), the execution tracker.
