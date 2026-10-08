# Prompt for the developer agent (Claude Code, run inside the `useful-brain` repo)

Copy everything below the line into the agent.

---

You are implementing the Useful Brain redesign end to end: the complete UI/UX from the approved high-fidelity design, and every backend capability that design needs and the repo doesn't have yet. Work in the existing repo and stack. Don't start a new app.

## Read first, in this order
1. `AGENTS.md` and `CLAUDE.md`. Their safety rules, approved-package list, stop conditions and verification workflow are binding and override anything below.
2. `docs/useful-brain-master-plan.md` for architecture contracts.
3. The handoff bundle, which I'll place at `docs/design/handoff-2026-10-08/`: `README.md` is the full spec (tokens, every screen, states, routes, the backend gap list and audit corrections), and `*.dc.html` are the interactive design references.
4. To view the designs, serve that folder statically (`npx serve docs/design/handoff-2026-10-08`) and open `Useful Brain Redesign.dc.html`. Always view screens through that canvas page: each screen gets its light or dark colours from the canvas, so a screen file opened on its own shows up unstyled. Treat the HTML as reference only. Don't copy the HTML or `support.js` into the app.

## Goal
Members can ask a question and trust the answer: cited claims, visible evidence with the graphite highlight, honest refusals, and approvals that bind exact arguments. Admins can manage sources, people and access, check quality, and watch activity and health. Every artboard in the canvas (01–18 plus the States sheet) works in the real app in light and dark, backed by real Brain Worker endpoints and D1 data. No mocks in production paths.

## Non-negotiables
- Branch off `main` (for example `feat/redesign-2026-10`). Never commit to `main`. Use small, reviewable commits per phase.
- Stack stays as is: Next.js App Router, Tailwind v4 role tokens in `src/app/globals.css`, Brain and ingestion Workers, D1 (corpus and operations), Vectorize, Workers AI, Pi Agent Core.
- Don't add packages outside the approved list in `AGENTS.md`. That rules out icon, chart, UI-kit and state libraries. Icons come from Lucide paths ported out of `ub-icon.js` into `src/components/icons.tsx`. Charts and sparklines are hand-written SVG.
- Never read `.env*`, `.dev.vars`, credential files or `secrets/`. Use synthetic Northwind data only.
- ACL before everything: fusion, rerank, model context, citations, search results, counts, suggestions and every number shown to a member. Unreadable documents return 404.
- Fail closed on missing identity, ACL metadata, corpus state, invalid citations or uncertain tool permission. Admin routes are enforced server-side in Brain. Hiding them in the UI doesn't count.
- Don't stream unvalidated model text. The host grounding validator passes first, then the UI reveals the validated answer.
- Approvals bind normalized arguments plus the idempotency key. Any change invalidates the approval. Every mutating tool call, queue consumer and workflow step is idempotent.
- Migrations are additive new files (`migrations/operations/0012_*.sql` and so on). Never edit applied migrations.
- No SSO, billing, tenant switching, Convex, LangChain or any other agent framework.
- Copy rules: sentence case, no helper text that restates a heading, no hype words, exact copy from the spec.

## Phases (finish each phase's exit criteria before moving on)

**Phase 0: recon and plan.** Map every artboard to its current route, components and endpoints. Confirm each backend gap in README §"Backend" against the code, and note anything that already exists. Write `docs/design/2026-10-08-redesign-implementation-plan.md` with the mapping, the endpoint contracts (request and response types), the migrations, and the test list.
- Exit: the plan is committed. Stop and report only if a gap contradicts the master plan.

**Phase 1: foundations.**
- Tokens for light and dark exactly as in README, with theme selection (System, Light, Dark) persisted, applied before first paint, and following live OS changes.
- System sans plus Geist Mono, tabular numbers, motion tokens and `prefers-reduced-motion`.
- Primitives: Button (primary, secondary, ghost, icon), Chip, CitationChip, Segmented, Field, SearchField, Dialog (focus trap, Esc, scrim, restore focus), Table, Skeleton, StatusDot, StatusPill, Kbd, Highlight mark, Toast-free inline alerts. All of them get hover, focus-visible, active and disabled states matching the States sheet.
- Exit: the existing `palette-preview` route (or a new internal `/design-check` route, excluded in production) renders every primitive in both themes. Unit tests cover the primitives' a11y roles.

**Phase 2: shell, navigation and authorization.**
- Rail exactly as specced (order fixed, ⌘N and ⌘K shortcuts, Today and Previous 7 days chat groups, profile row with settings).
- Stage, the evidence-panel slot and the responsive breakpoints (≥1200 side panel, 768–1199 sheets, <768 mobile).
- Routes and redirects from README §Routes.
- Admin role in Brain, enforced on all `/admin/*` endpoints. `whoami` extended.
- Exit: members never see or reach admin routes (UI plus a 403 or 404 from Brain, both tested).

**Phase 3: chat (member core).**
- Artboards 01–07: empty state with ACL-safe suggestions; the answer with citation chips, sources row and actions; the evidence panel (Cited and Retrieved tabs, admin chunk, generation and score rows); and the linked hover and pin signature, where chip, source button and passage highlight darken together and the passage scrolls into view.
- Document reader with in-place highlight from chunk offsets.
- Working status line with integer counts (extend turn progress: searching {readableDocuments}, reading {passages}, writing). Stop through `/cancel`.
- No-evidence refusal with idempotent "Request this document". Error alert plus retry of the saved question.
- Feedback (thumbs) persisted.
- Approval card with visible redacted arguments: pending, approve, deny and expired, plus the done state showing the persisted `SUP-####` ticket. The `create_ticket` schema becomes `{desk, priority, customer, subject}`.
- Exit: workerd tests for progress counts, feedback, document requests, approval argument binding, ticket persistence and the expired approval path. Component tests for linked hover, tabs, the reader highlight and every chat state.

**Phase 4: search and Library.**
- ⌘K dialog: chats plus documents, keyboard navigation, ⌘↵ asks about a document. `GET /search` is ACL-filtered before ranking.
- Library with department chips and counts, search, "Ask about this" (starts a document-scoped chat), and the loading and no-match states. `GET /library` and `GET /documents/:id` return 404 for unreadable documents.
- Exit: ACL leak tests prove a member can't find or open another department's document by title, search or ID.

**Phase 5: admin.**
- Overview: KPIs with sparklines, unanswered questions with "Add document", system health and the evals summary.
- Sources: the generation card, draft progress, draft checks (reconciliation plus retrieval/ACL eval; promote blocked unless ACL leaks are 0), status chips, the table with the failed-row error, Re-index, Discard and Promote.
- Upload dialog: per-file stage polling, the "who can read" selection persisted to document ACL, and "Add to draft" gating.
- People: people table, groups, invites as a copyable one-time link (no email). View as in session mode, admin only, with an audit row. Assumed turns are excluded from history and metrics, and the restricted-match diagnostic is admin-only and never reaches model context.
- Evals: read-only history, chart, categories, retrieval metrics and expandable failures.
- Activity: outcome filters, keyset pagination and the redacted step trace from a new `turn_steps` table.
- Exit: workerd tests for every new admin endpoint (authorization, ACL, idempotency, redaction). The Overview numbers reconcile with the Activity data in a seeded test.

**Phase 6: Settings, sign in and mobile.**
- Settings dialog (Appearance, Account, plus admin-only Model and retrieval read from live config, and Connectors from the registry with GitHub, not Google Drive). `/settings` deep-links to the dialog.
- Sign in with email and password (no SSO), inline errors, and `/signup` restyled with the gate unchanged.
- Mobile: rail slide-over, evidence bottom sheet, 44px targets, with inline citation chips given at least a 44px hit area.
- Exit: keyboard-only pass of the whole app, axe-clean in both themes, contrast at least 4.5:1 on all text.

**Phase 7: verification and hardening.**
- Run `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run build`, the workerd tests, the Wrangler dry runs, the dependency audit and the security tests.
- Visually verify in the running app (`npm run preview:cf`) per AGENTS.md "Visual verification on this Mac". Screenshot every artboard state in light, and 01, 02 and 10 in dark, side by side with the canvas. Record the hover signature and the working status line frame by frame (`winrec` plus `framesheet`). Save everything under `evals/results/2026-10-xx-redesign/`.
- Run `npm run eval:northwind` and confirm no regression from 118/120 and 0 ACL leaks.
- Get an independent review with a second model. Fix every confirmed P0/P1 and high or critical security finding.
- Exit: everything green. Open the PR with screenshots.

## Definition of done
- Every artboard and state in the canvas is implemented and reachable, in light and dark, at 1440 and 390, matching the spec values in README.
- Every backend gap in README §"Backend" is implemented with additive migrations, typed contracts, server-side authorization and tests.
- No mock data in production paths. The seed scripts load the Northwind corpus and the demo people.
- ACL, grounding, approval and idempotency guarantees are unchanged or stronger, proved by tests.
- Docs updated: README screenshots, `CLAUDE.md` code map, and the master plan or execution tracker entries made stale by this work.

## Stop and ask me only if
You hit an AGENTS.md stop condition, a design requirement contradicts the master plan or a safety rule, a package outside the approved list seems unavoidable, or a decision would change what members can see. Otherwise make the call, record it in the plan doc, and keep going.

## Report at the end of each phase
Report what shipped, the test and verification results, decisions you made that weren't in the spec, and anything deferred and why. Keep it short.
