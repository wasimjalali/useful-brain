# Frontend recon (Phase 0) - Useful Brain redesign

Branch checked: `feat/redesign-2026-10`. Read-only. Paths relative to repo root. Line refs are `file:line` at HEAD (b68cd22).

## 0. Headline findings

1. **The whole app UI is one client monolith.** Every page route renders `WorkspacePage` (`src/components/workspace/workspace-page.tsx:13`), which loads one snapshot (`loadWorkspaceSnapshot`, `src/app/actions.ts:286`) and mounts `RagVisibilityDashboard` (`src/components/rag-visibility-dashboard.tsx`, 703 lines) with a `key` that remounts on every route change (`workspace-page.tsx:44`). View is a `useState` (`:122`), nav is `router.push` (`:539`). Chat state, polling, search dialog, settings dialog, evidence panel all live there. The redesign needs real nested routes + a persistent shell, so this file is the main thing to dismantle.
2. **No token streaming exists today.** A turn is one awaited server action (`askGroundedQuestion` -> `POST /turns`, `actions.ts:92-134`) that returns the full validated `GroundedAnswerResponse`. Progress is a separate 2s poll of `/api/turns/[requestId]` that carries only a stage enum. The README rule "do not stream unvalidated tokens" is already satisfied; the redesign only adds counts + the in-place status line and a quick reveal animation.
3. **No dark theme, no theme persistence, no pre-paint script, no `palette-preview` route.** (`grep` for `data-theme|prefers-color-scheme|palette-preview` in `src/` finds nothing; only a 2026-07 plan doc mentions palette-preview.) PROMPT.md Phase 1 says "existing palette-preview route (or a new internal /design-check route)": it is the latter, new.
4. **Tokens are mostly there, names differ in places.** `--canvas/--surface/--sunken/--ink*/--accent*/--border*/--success|warning|danger(-soft)` exist (`globals.css:5-42`). Missing: `--bubble`, `--ink-faint-text`, `--edge`, `--hover`, `--hl`, `--hl-strong`, `--scrim`, `--lift`, `--stage-shadow`, `--sel`, dark set. Font is Geist Sans (`layout.tsx:5-12`), must become system stack; Geist Mono stays.
5. **`/open` shares globals.** `open-landing.tsx` uses `bg-canvas`, `.btn`, `border-border` etc. (`:69-158`). Changing `--canvas` to `#F3F3F3`, dropping Geist Sans and adding `prefers-color-scheme: dark` will change `/open` (README says leave untouched). Mitigation in section 7.
6. **"Operator" today vs "admin" in the design.** UI gates Sources actions on `identity.roles.includes("operator")` (`rag-visibility-dashboard.tsx:620` area, `knowledge-workspace.tsx:34,75,227,287`) and the settings "Assume principal" select on the same (`settings-workspace.tsx:99`). `WorkspaceIdentity` (`actions.ts:27-33`) has no `isAdmin`/`department`/`readableDocumentCount`. "View as" today = a localStorage key (`useful-brain.assumed-principal`, `rag-visibility-dashboard.tsx:52`) mapped to hard-coded `NORTHWIND_PRINCIPALS` and sent as `assumePrincipal` in the `/turns` body. Redesign replaces this with server-driven People -> View as.

## 1. Current frontend inventory

### 1a. Routes (`src/app`)

| Route | File | What it does |
|---|---|---|
| `/` | `page.tsx` | Server redirect: session cookie / loopback check -> `/open`, `/login`, else loads snapshot and redirects to `/chat` (or `/knowledge` if retrieval not ready, `:40`) |
| `/chat`, `/chat/[id]` | `chat/page.tsx`, `chat/[id]/page.tsx` | `<WorkspacePage view="chat" conversationId>`; `force-dynamic` |
| `/knowledge`, `/knowledge/new` | `knowledge/page.tsx`, `knowledge/new/page.tsx` | `<WorkspacePage view="knowledge" addDocument?>` |
| `/evaluations` | `evaluations/page.tsx` | `<WorkspacePage view="evaluations">` |
| `/settings` | `settings/page.tsx` | `<WorkspacePage view="settings">` -> opens Settings dialog over chat; closing pushes `/chat` (`dashboard:546-551`) |
| `/login`, `/signup` | `login/page.tsx`, `signup/page.tsx` | `<AuthForm mode>` |
| `/open` | `open/page.tsx` | public landing `OpenLanding` (out of scope) |
| `loading.tsx`, `error.tsx` | `app/` | Root skeleton shell (264px aside, old tokens) and error boundary (`btn btn-primary`) |
| `icon.svg`, `favicon.ico` | `app/` | metadata icons |

API routes: `api/auth/{login,logout,signup}/route.ts` (proxy to Brain via `web-auth-proxy.ts`, sets HttpOnly cookie), `api/turns/[requestId]/route.ts` (GET, forwards to Brain `/turns/:id/progress`, `no-store`), `api/brain/whoami/route.ts` (GET passthrough; **no UI caller**, only a config test and tracker reference it), `api/health/route.ts` (used by macOS shell `ServerConfig.swift:67`; keep).

Server actions (`src/app/actions.ts`, 370 lines): `embedSyntheticDocumentsAction`, `reindexKnowledgeAction`, `promoteCorpusVersionAction`, `askGroundedQuestion`, `cancelGroundedQuestionAction`, `loadConversationAction`, `deleteConversationAction`, `deleteKnowledgeDocumentAction`, `importLegacyConversationsAction` (no-op stub), `addSyntheticDocumentAction` (FormData; extracts text via `extractUploadedText`, builds one `nw_upload_<slug>` doc, `accessScope: "public"` hard-coded `:304`), `signOutAction`, `loadWorkspaceSnapshot`. `src/app/eval-actions.ts`: `runEvalsAction` -> `POST /evaluations/run` (**no UI caller now**: `EvaluationsWorkspace` is static, dashboard test asserts there is no run button).

### 1b. Brain calls the UI makes today

All server-side via `brainJson`/`brainFetch` (`src/lib/cf/brain-client.ts`, Service Binding `BRAIN`, forwards cookie + access JWT + x-request-id) unless noted.

| Method + path | Caller | Purpose |
|---|---|---|
| GET `/knowledge` | `loadWorkspaceSnapshot` `actions.ts:298` | inventory: documents, chunks, embeddingStorageStatus, retrievalMode |
| GET `/conversations` | `:299` | sidebar list (id, title, createdAt, updatedAt) |
| GET `/evaluations` | `:302` | `EvalRunResult[]` (snapshot's `evalRuns` -> `initialEvalRuns`; the Evals page itself reads static `campaign-snapshot.ts`) |
| GET `/whoami` | `:303` | `WorkspaceIdentity {id, kind, subject, roles, departments}` |
| GET `/conversations/:id` | `loadConversationAction:159` | full turns with evidence snapshots |
| DELETE `/conversations/:id` | `:172` | delete chat |
| POST `/turns` | `askGroundedQuestion:118` | body `{question, conversationId?, requestId, assumePrincipal?}`; returns whole `GroundedAnswerResponse` |
| POST `/cancel` | `:142` | `{requestId}` -> `{conversationId}` |
| GET `/turns/:id/progress` | browser `fetch('/api/turns/:id')` `dashboard:218` every 2s | stage enum only |
| POST `/knowledge/seed` | `embedSyntheticDocumentsAction:41`, `addSyntheticDocumentAction:255` | seed Northwind or merge one uploaded doc |
| POST `/knowledge/reindex` | `:68` | re-index |
| POST `/knowledge/promote` | `:81` | `{generationId}` |
| DELETE `/knowledge/documents/:id` | `:185` | delete a doc |
| POST `/evaluations/run` | `eval-actions.ts:13` | run evals (unused by UI) |
| POST `/auth/logout` | `signOutAction:275`, `web-auth-proxy.ts:62` | logout |
| POST `/auth/login`, `/auth/signup` | browser `fetch('/api/auth/*')` in `auth-form.tsx:27` -> `web-auth-proxy.ts:30` | session creation |
| GET `/health` | `api/health/route.ts:16` | macOS shell |

Not present anywhere in the UI today (all are README gaps): feedback, request-document, library, documents/:id, search, config, admin/*, uploads/batches, invites, approvals UI. Thumbs buttons in `conversation-turn.tsx:44-49` are local `useState` only.

### 1c. Components (`src/components`)

| File (lines) | Role today | Redesign fate |
|---|---|---|
| `rag-visibility-dashboard.tsx` (703) + test (789) | Monolith: view switch, chat state, polling, search/settings dialogs, assumed principal, legacy migration | **Delete**; split into layout shell + route pages + `useChatTurn` hook |
| `workspace/workspace-shell.tsx` (186) | `h-screen` flex: rail + `.stage` main + inspector slot; mobile top bar and 264px overlay drawer with focus trap | **Replace** with `shell/app-shell.tsx` (248 rail, 10px gutters, breakpoints) |
| `workspace/workspace-nav.tsx` (200) | Rail: logo, New chat, Search, Sources, Evals, "Recents" flat list, operator row | **Replace** with `shell/rail.tsx` (+ Library, Admin group, date groups, profile row) |
| `workspace/workspace-page.tsx` (61) | Server wrapper feeding the monolith | **Delete** |
| `workspace/chat-search-dialog.tsx` (93) + test | Client-side title filter of chats only | **Replace** (chats + docs, `/search`, keyboard nav) |
| `chat/chat-workspace.tsx` (383) + test (433) | Welcome + turn list + user bubble + ThinkingIndicator (4 stage labels) + stopped/error messages + setup notice; exports `buildEvidenceItems/filterCitedEvidence` | **Rewrite** into `chat/*` pieces; keep the evidence-item builders (move to `chat/evidence-items.ts`) |
| `chat/chat-composer.tsx` (141) | Auto-grow textarea pill (40px, max 192), Enter sends, Stop button, `aria-label="Generate answer"` | **Restyle** (52px pill, 22px radius multi-line, 36px send/Stop); keep logic |
| `chat/conversation-turn.tsx` (227) | Assistant message: avatar, paragraphs with `.cite` buttons, "Evidence N" trigger, hover-only actions, local feedback | **Rewrite**: sources row, linked hover, persistent actions + meta, feedback persisted |
| `chat/evidence-inspector.tsx` (370) | Right panel (360px, `fixed` <1024px), tabs, cards, flash on focus, `EvidenceChunkDialog` w/ sentence highlight | **Rewrite** as second stage w/ segmented tabs, mark highlight, admin rows, doc reader view |
| `knowledge/knowledge-workspace.tsx` (1147) + 2 tests (410+122) | Corpus summary, doc table, filters, paging, promote/reindex/seed, detail dialog, `AddDocumentDialog` (paste/file/folder queue), `folderFileTitle` | **Replace** by `admin/sources/*` + `upload-dialog`; salvage folder-queue logic and `folderFileTitle` (+ its test) if the upload dialog keeps folder support |
| `evaluations/evaluations-workspace.tsx` (199) + test | Static campaign snapshot: run tabs, score, categories, failures | **Replace** (`admin/evals/*`); data from `GET /evaluations` extended |
| `settings/settings-workspace.tsx` (227) + test | Dialog panes Operator/Retrieval/Models (reads `SELECTED_MODELS` statically), assume-principal Select, logout via fetch | **Replace** (`settings/settings-dialog.tsx`) |
| `auth/auth-form.tsx` (121) + test | login/signup form, Signup code field, plain styling | **Restyle** to artboard 17; keep fetch contract |
| `open/open-landing.tsx` (165) + test | Public landing | Untouched |
| `icons.tsx` (224) | 22 hand-drawn icons | **Extend/replace** with Lucide paths |
| `useful-brain-logo.tsx` (81) + test | `UsefulBrainMark/Avatar/Logo` | Keep; rail size 20x22 |
| `ui/dialog.tsx` (83) | Portal dialog, focus trap, Esc, restore focus, `maxWidth` class prop | Keep logic, restyle (`--scrim`, 16px radius, sizes by px) |
| `ui/select.tsx` (194) + test | Custom listbox select | Keep (used by Settings/Upload if needed) |
| `ui/status-label.tsx` (28) | Bordered rounded-full tone pill | Replace with `StatusPill` (radius 6, 22px) |
| `ui/scroll-chrome.tsx` (50) | `.uv-scroll` scrollbar reveal | Keep |

## 2. Artboard mapping

Legend: **E** existing, **N** new, **R** replace/delete.

| # | Screen | Target route | Existing coverage | New | Replace / delete |
|---|---|---|---|---|---|
| 01 | Chat empty | `/chat` | `ChatWelcome` in `chat-workspace.tsx:150`, hard-coded `SAMPLE_QUESTIONS` (chips, not ACL-derived) | Heading "Ask about Northwind", 4 suggestion rows w/ dept, ACL-safe suggestions source (Brain gap; interim: derive from `/library`) | `SAMPLE_QUESTIONS`, `.chip` style, old copy "Ask a grounded question" |
| 02 | Answer + evidence | `/chat/[id]?evidence=cited&c=1` | `ConversationTurn` + `EvidenceInspector`; evidence items carry vector/keyword/fused/rerank scores (`chat-workspace.tsx:355-370`) | Sources row buttons, action row with meta "8 passages . 2.1 s" (needs `latency_ms`, `passages_retrieved`), linked hover/pin store, segmented tabs, `<mark>` highlight, admin chunk/generation/scores rows (needs `isAdmin`) | `.evidence-card`, `.evidence-tab`, `.source-trigger`, `EvidenceChunkDialog` |
| 03 | Working | `/chat/[id]` | `ThinkingIndicator` + poll loop (`dashboard:195-252`), `TURN_STAGE_LABELS` | Pulsing dot, `role=status` aria-live, integer-count labels ("Searching 34 documents"), 260ms swap rise, rise-in of validated answer, Stop wired to `/cancel` (E) | 4-stage copy "Searching sources." (asserted by tests), spinner |
| 04 | No evidence | `/chat/[id]` | `StatusLabel "insufficient evidence"` badge only | Refusal copy, "Request this document" button + Requested state (`POST /messages/:id/request-document`), meta "Searched N documents . 1.4 s" | badge in header |
| 05 | Approval | `/chat/[id]` | **Nothing** in UI (approvals exist only in Brain/DB) | `approval-card.tsx` (pending/approved/denied/expired/done), approve/deny actions + endpoints, ticket row | - |
| 06 | Error | `/chat/[id]` | `ErrorMessage` in chat-workspace; `StoppedMessage`; retry re-sends question text | Alert styling, partial text kept muted, retry via `parent_user_message` | old ErrorMessage card |
| 07 | Doc reader | evidence panel `?doc=<id>&c=<n>` | `EvidenceChunkDialog` (chunk only, modal) | Reader view in panel, metadata grid, in-place spans (`GET /documents/:id?message=`) | modal chunk dialog |
| 08 | Search | dialog (global, ⌘K) | `ChatSearchDialog` (titles, client filter) | Docs group via `GET /search`, match bolding, kbd footer, ⌘Enter ask-about, ⌘K binding (none today) | old dialog |
| 09 | Library | `/library` | None (member sees nothing of docs; Sources is operator-ish) | Page, table, dept chips w/ counts, loading + no-match states, "Ask about this" (doc-scoped chat) | - |
| 10 | Overview | `/admin/overview` | None | Page, KPI strip, sparkline SVG, unanswered list, system rows, evals summary | - |
| 11 | Sources | `/admin/sources` | `KnowledgeWorkspace` (promote, reindex, table, filters) | Generation card, draft row (building / checks passed), status chips, table cols (Chunks/Updated/pill), failed-row error, Discard | `KnowledgeWorkspace`, `DocumentDetailDialog`, STATUS copy; redirect `/knowledge`, `/knowledge/new` -> `/admin/sources` |
| 12 | Upload dialog | dialog on `/admin/sources` (`?upload=1`) | `AddDocumentDialog` (paste/file/folder; sequential seed) | Stage progress per file (`GET /admin/uploads/:batch`), "Who can read" segmented + group chips, draft note, gating | `AddDocumentDialog`, public-only ACL in `addSyntheticDocumentAction` |
| 13 | People | `/admin/people` | Settings "Assume principal" select only | People/Groups tables, Invite dialog, View as banner (44px accent) + composer placeholder + restricted-match line | localStorage assumed principal, `NORTHWIND_PRINCIPALS` in UI |
| 14 | Evals | `/admin/evals` | `EvaluationsWorkspace` static (tabs, categories, failures) | Runs SVG line chart, category bars, metrics, expandable failures, repo-run footer; real data from extended `/evaluations` | static `campaign-snapshot` consumption in UI (the module itself can stay as fixture/test data), redirect `/evaluations` |
| 15 | Activity | `/admin/activity` | None | Table w/ outcome chips, keyset "load more", expandable mono trace | - |
| 16 | Settings | dialog; `/settings` deep link | `SettingsWorkspace` in `Dialog` | Appearance (theme), Account, admin Model/Connectors read from `/config`; 780x580, 212px nav | old panes; `/settings` page keeps working by opening the dialog |
| 17 | Sign in | `/login` (+ `/signup`) | `AuthForm` | 560 left column + proof stage, show/hide password, 44px fields, inline field errors | plain `rounded-md` inputs |
| 18 | Mobile | all app routes <768 | Hamburger `MobileTopBar` + 264px drawer; evidence as fixed right overlay <1024 | 52px header w/ 44px targets, sources summary button -> bottom sheet (612px), 308px rail, 44px chips hit area | `MobileTopBar`, `MobileNavOverlay`, `.citation-control` |
| States | skeleton/empty/error patterns | everywhere | `loading.tsx` skeleton, `.empty-state`, `error.tsx`, `WorkspaceLoadError` | Skeleton set (answer, rows, passage), rail first-visit empty, filtered Activity empty, page-error w/ Retry, state specs for every primitive | `.empty-state` card styling, root `loading.tsx` layout |

Routes (README §Routes). Redirects best done in `next.config.ts` `redirects()` (permanent: false) or per-page `redirect()`:
- `/knowledge` and `/knowledge/new` -> `/admin/sources` (new -> `/admin/sources?upload=1`)
- `/evaluations` -> `/admin/evals`
- `/settings` -> keep: a page that renders the app shell on `/chat` with the Settings dialog open (e.g. `redirect('/chat?settings=1')` or route the dialog by `?settings`), and closing drops the param instead of `router.push("/chat")`.
- `/` redirect currently sends non-ready corpora to `/knowledge` (`page.tsx:40`): change to `/admin/sources` for admins, `/library` or `/chat` for members.
- Hard-coded `/knowledge` pushes to update: `knowledge-workspace.tsx:202`, `dashboard:539-541,548`.
- `/open`, `/api/health`, `/api/turns/*`, `/api/auth/*`, `/api/brain/whoami` unchanged.

## 3. Styling foundations

**`src/app/globals.css` (714 lines).** Structure: `@import "tailwindcss"` (`:1`), `:root` tokens (`:3-47`), `@theme inline` mapping to `--color-*` (`:49-81`), `body` (`:86`), `@layer base` (focus ring is `outline: 2px solid var(--accent)`, `:96-110`), `@layer components` with legacy classes (`.card .btn .btn-primary .btn-secondary .icon-btn .field-input .uv-scroll .nav-item .stage .rail .operator-* .tip .chip .settings-* .search-modal .cite .evidence-* .source-trigger .operational-table .answer-* .suggestion-button .evidence-sentence .first-run-panel .corpus-summary .section-label .empty-state .skeleton .rise .panel-in .msg-in .dialog-* .step-line`), one `prefers-reduced-motion` block (`:703`).

Current -> target token deltas:

| Token | Today | README | Action |
|---|---|---|---|
| `--canvas` / `--rail` | `#f8f8f8` | `#F3F3F3` / `#0F0F0F` | change; drop separate `--rail` (or alias) |
| `--surface` | `#fff` | `#fff` / `#171717` | add dark |
| `--sunken` | `#f0f0f0` | same / `#2C2C2C` | add dark |
| `--bubble` | - | `#fff` / `#202020` | **add** |
| `--ink`, `--ink-muted` | `#171717`, `#5c5c5c` | same / `#EDEDED`, `#A3A3A3` | add dark |
| `--ink-faint` | `#a3a3a3` (used as TEXT in places, e.g. `text-ink-faint` in rail/chat) | decoration only | **audit all `text-ink-faint` -> `text-ink-faint-text`** |
| `--ink-faint-text` | - | `#6B6B6B` / `#949494` | **add** (fixes 4.5:1) |
| `--accent`, `--accent-ink` | `#171717`, `#fff` | same / `#EDEDED`, `#141414` | add dark |
| `--accent-soft/-strong/-deep/-on-dark`, `--brand*` | exist | not in README | keep as aliases during migration, remove at end |
| `--border`, `--border-strong` | `#ebebeb`, `#e0e0e0` | same / `#262626`, `#333` | add dark |
| `--edge`, `--hover`, `--hl`, `--hl-strong`, `--scrim` | - | spec'd | **add** |
| status trio + `-soft` | light values match README | dark values | add dark |
| shadows | `--shadow-sm/-card/-raise/-pop/-rail` | `--lift`, `--stage-shadow`, `--sel`, dialog shadow | add new, retire old |
| `--scroll-knob*` | light only | not in README | add dark values |
| `--ease-out` | `cubic-bezier(.22,1,.36,1)` | same | keep |

Theme mechanics to add: tokens on `:root`; dark block `:root:not([data-theme="light"])` inside `@media (prefers-color-scheme: dark)` plus `:root[data-theme="dark"]`; set `color-scheme` accordingly; `@theme inline` additions for `--color-bubble`, `--color-ink-faint-text`, `--color-edge`, `--color-hl`, `--color-hl-strong`, `--color-scrim`. Add `--font-sans` system stack (README) replacing Geist at `globals.css:79,89`; keep `--font-mono: var(--font-geist-mono)`. Add `font-variant-numeric: tabular-nums` rule (`.tnum` exists `:112`; README wants it on every number).

**`src/app/layout.tsx` (42 lines):** imports `Geist` and `Geist_Mono` from `next/font/google` (`:2-12`), `<html lang="en" className="h-full antialiased {vars}">`, `<body className="flex min-h-full flex-col">`, renders `<ScrollChrome />`. Change: remove `Geist`, keep `Geist_Mono`; add `suppressHydrationWarning` on `<html>` plus inline pre-paint script (section 4).

**Icons (`src/components/icons.tsx`).** Pattern: one local `Icon` wrapper (`viewBox 0 0 24 24`, `fill none`, `stroke currentColor`, `strokeWidth 1.6`, round caps, `aria-hidden`), then one exported function per icon taking `SVGProps` (e.g. `ChatIcon(props)`; `:22`). 22 icons: Chat, Knowledge, Evaluations, Settings, User, Send, Stop, Source, Quote, Check, ArrowRight, Plus, Close, Layers, Upload, Search, NewChat, Trash, Copy, Retry, ThumbUp, ThumbDown, ChevronDown. They are hand-drawn, not Lucide. `ub-icon.js` provides 80+ Lucide 0.460.0 inner-SVG strings in a name -> markup map: square-pen, search, library, layout-dashboard, database, users, clipboard-check, activity, settings, copy, rotate-ccw, thumbs-up/down, arrow-up/left/right, x, file-text, file-plus, chevron-down/right/up, upload, plus, check, circle-alert, triangle-alert, ticket, eye, eye-off, log-out, monitor, sun, moon, plug, corner-down-left, square, lock, external-link, menu, circle-check, circle-x, circle-dashed, server, cpu, network, refresh-cw, user-plus, mail, panel-right(-close), loader-circle, file-up, message-square, arrow-up-down, cloud, shield-check, git-branch, folder, clock, key-round, globe, link, layers, terminal, list-checks, user-round, github. Plan: keep the `Icon` wrapper (stroke -> 1.5), regenerate `icons.tsx` as `export const XIcon = ...` per name, **keep all current export names** (many importers: chat, rail, search, settings, knowledge) so the swap is non-breaking; add the new names. Note the repo's `lucide` content is paths as strings, so convert via a one-off script into JSX (no runtime lib, no new package).

**Primitives today.** `ui/dialog.tsx`: createPortal, focus trap, Esc, restore focus; sizing via Tailwind `maxWidth` class string; classes `.dialog-overlay/.dialog-panel` (22px radius, 1px border, `--shadow-pop`; scrim `rgb(23 23 23/.18)`). `ui/select.tsx`: custom combobox/listbox w/ keyboard, `aria-controls`; tested. `ui/status-label.tsx`: border + rounded-full + tone. `ui/scroll-chrome.tsx`: delegated scroll listener toggling `.is-scrolling`. No Button/Chip/Segmented/Field/Table/Skeleton/Kbd components; those are CSS classes (`.btn`, `.chip`, `.field-input`, `.skeleton`) used inline with Tailwind.

## 4. Theme handling today

None. No `data-theme`, no `prefers-color-scheme` media query, no `localStorage` theme key, no pre-paint script anywhere under `src/` (the only localStorage uses are `nura.conversations.v1` legacy chat history in `lib/rag/chat-history.ts:21-22` and `useful-brain.assumed-principal`). `<html>` has no `suppressHydrationWarning`. The macOS WKWebView shell loads the same web app; dark follows `prefers-color-scheme` there for free.

Plan: `src/lib/theme.ts` (types `ThemeChoice = "system"|"light"|"dark"`, key `useful-brain.theme`, `readTheme/applyTheme`, try/catch around storage); an inline `<script>` in `<head>` (via `dangerouslySetInnerHTML` or a tiny `ThemeScript` server component) that reads the key and sets `document.documentElement.dataset.theme` (only for light/dark; system leaves it unset) before paint; a `ThemeSync` client effect that listens to `matchMedia("(prefers-color-scheme: dark)")` and `storage` events. CSS handles System via the media query, so no JS needed for live OS changes in System mode (the listener is only needed for components that read the resolved theme, e.g. the Settings note "Follows your device. Light right now."). Check CSP: `public/_headers` only sets cache headers for static assets (`_headers:1-2`), so an inline script is fine; if a CSP is added later the script needs a nonce.

## 5. Tests

Runner: vitest 4 + `@testing-library/react` 16 + `@testing-library/jest-dom` + jsdom 29 (`vitest.config.ts`: `environment: "jsdom"`, `globals: true`, `setupFiles: ./src/test/setup.ts`, `@` alias, plugin-react; excludes `workers/**`, `spikes/**`). `src/test/setup.ts` globally mocks `next/navigation` `useRouter` -> `{push, refresh, replace}` as fresh `vi.fn()`s. **It does not mock `usePathname`/`useSearchParams`/`useParams`**: any new component using them in tests will need an extension of this mock (do that in Phase 1). No user-event, no axe, no Playwright in repo. Workers tests run separately (`workers/*/vitest.config.mts` via `@cloudflare/vitest-plugin`), invoked by `npm test`.

UI-adjacent test files (total tests): `rag-visibility-dashboard.test.tsx` (27, 789 lines), `chat/chat-workspace.test.tsx` (16), `knowledge/knowledge-workspace.test.tsx` (13), `knowledge/folder-upload.test.tsx` (4), `knowledge/folder-file-title.test.ts`, `settings/settings-workspace.test.tsx` (1), `evaluations/evaluations-workspace.test.tsx` (3), `workspace/chat-search-dialog.test.tsx` (1), `auth/auth-form.test.tsx` (2), `ui/select.test.tsx` (2), `open/open-landing.test.tsx` (1), `useful-brain-logo.test.tsx` (4), `app/actions.test.ts` (21), `app/eval-actions.test.ts` (2), `app/api/turns/[requestId]/route.test.ts` (4), `lib/cf/wrangler-config.test.ts` (reads `api/health` and `api/brain/whoami` route source).

Copy/structure assertions that WILL change (must be rewritten, not just edited):
- `dashboard.test`: heading "Ask a grounded question" (`:341`); nav buttons "Evals" `:346`, "Sources" `:235`, "Search" `:344`, "Settings" `:347`, "New chat" `:343`; "Open navigation"/"Close navigation" `:251,254`; "Close search" `:372`; dialog "Search chats" `:370`; "Upload document" `:405`, "Re-index sources" `:397`, "Delete document" `:430`, "View Return Policy" `:429`; "Retry question" `:654`; "Generation stopped." `:652`; status text "Drafting the answer." `:517`; poll-loop tests `:496-634` (2s loop, one in flight, unmount stop, terminal snapshot never completes answer). The poll tests encode behaviours to PRESERVE in the new `useChatTurn` hook.
- `chat-workspace.test`: "Question" label `:321`, "Generate answer" `:324`, "Copy answer"/"Copied answer" `:118,123`, "Retry question" `:130`, "Retry answer" `:162`, "Mark answer helpful/unhelpful" `:169,399`, tabs "Cited 1"/"Retrieved 5" `:193,198` (README tab labels match this pattern), "View full chunk" `:201`, "Drafting the answer." / "Searching sources." `:354,373`.
- `knowledge-workspace.test` (all 13): whole component replaced; salvage assertions for failed/processing row states into `admin/sources` tests.
- `evaluations-workspace.test`: heading "Evals", tabs "Baseline"/"Pass 2", button /Permission/, /q093/, no "Run evaluations".
- `settings-workspace.test` ("Models", "Retrieval" buttons, "principal-dev"), `select.test` (Settings dialog + "Assume principal" combobox), `chat-search-dialog.test` ("Search chats" searchbox).
- `auth-form.test`: "Signup code" label; keep.
Kept as is: `open-landing`, `useful-brain-logo`, `folder-file-title`, `actions.test`, `eval-actions.test`, `turns route.test`.
Retain accessible names where the spec does not change them (e.g. composer `aria-label` "Question"/"Generate answer", "Stop", "Copy answer", "Retry question") so more tests survive.

## 6. Mobile / responsive today

Single breakpoint family: Tailwind `lg` (1024). Rail: `hidden lg:flex` 248px (`workspace-nav.tsx:~66`); <lg shows `MobileTopBar` (hamburger + compact logo + name, `workspace-shell.tsx:84-103`) and a 264px `panel-in` drawer with focus trap + Esc + restore focus (`:109-170`, tested). Stage: `p-2.5 lg:pl-0` rounded 24 (`.stage`). Evidence: `fixed inset-y-0 right-0 w-[86%] max-w-[360px]` below lg with a `bg-ink/30` button backdrop (`dashboard:...Close sources`), static 360px beside stage at lg+; close button auto-focused when overlay (`evidence-inspector.tsx:82-96`). Citation hit area: `.citation-control` min 40x40 below 640px (`globals.css:~389`). Settings modal collapses nav to a row <640 (`.settings-modal`). Chat column `max-w-3xl`. No 768/1200 breakpoints, no bottom sheet, no 44px rule.

Needed: three states (≥1200 side panel / 768-1199 rail slide-over + 380px right sheet / <768 mobile with bottom sheet, 308px rail, 44px targets). Tailwind v4 custom breakpoints via `@theme { --breakpoint-... }` or `min-[1200px]:` arbitrary variants; avoid new deps. A small `useMediaQuery` hook (`src/lib/use-media-query.ts`, `matchMedia` + `useSyncExternalStore`) decides panel vs sheet DOM so only one evidence view is mounted (avoids duplicate `aria` regions and hover-link duplication).

## 7. Risks (what the redesign could break)

1. **Turn lifecycle / polling (CLAUDE.md "Provider calls bounded", conversations server-owned).** Behaviours encoded in `dashboard.submitQuestion/stopQuestion` and its tests: `conversationRef` guard drops results from an abandoned conversation; `turnSeq` ids; `router.replace('/chat/<id>')` after first answer; Stop -> `/cancel` -> inserts a `cancelled` turn and routes to the conversation; error turn with `errorRetryable`; poll = single in-flight request on a 2s loop, stops on unmount, progress never completes an answer (a "done"/"failed" snapshot is ignored). After the first answer the monolith calls `router.replace('/chat/<id>')` (`dashboard:317-321`); because `WorkspacePage`'s `key` includes the conversation id (`workspace-page.tsx:44`), that navigation remounts the dashboard and the turns come back from the server via `loadConversationAction`. In the new structure this must be a deliberate choice: either keep the chat island mounted across `/chat` -> `/chat/[id]` (use `history.replaceState` instead of `router.replace`, or a shared layout holding the session) or accept the remount and rely on the server reload. Verify this first-answer path with a test before rewriting the UI. Recommended: a client `ChatSession` keyed by conversation id that owns `turns`, with `loadConversationAction` only for cold loads.
2. **Evidence snapshot display.** `GroundedAnswerResponse.retrieval.results[]` are exact stored snapshots with all channel scores (`grounded-answer.ts`). Evidence items are derived on the client from the answer (`buildEvidenceItems`). The new panel must keep using the stored snapshot, not refetch live chunks, and `documentId` (optional on `CitedRetrievalResult`) is needed for "Open document" / `?doc=`; it can be null. Check Brain returns it for old messages.
3. **Citation label model.** Citations are labels like `[1]` matched to `citationLabel`; text uses `stripCitationMarkers` (`conversation-turn.tsx:222`) and appends chips after the paragraph, not inline at the sentence. README wants chips inline and highlighted sentences; the data has paragraph-level citations only (`GroundedAnswerParagraph {text, citations[]}`), so "inline per sentence" placement needs either paragraph-end chips (current) or a Brain/answer-contract change. Flag as a decision; default to paragraph-end chips to avoid touching `src/lib/answer/contract.ts`.
4. **Highlight source.** Today the "relied-on sentence" is found client-side by `findEvidenceSentenceMatch(text, focusText)` using the answer paragraph (`evidence-inspector.tsx:350`), not from stored spans. Keep it as the fallback; document reader highlights come from the new `GET /documents/:id?message=`.
5. **ACL leaks via new UI numbers.** Status line "Searching N documents" and "Searched N documents" must use the asker's readable count (README audit 1). The UI must never compute counts from the full `/knowledge` inventory (which today ships ALL docs/chunks to the client: `loadWorkspaceSnapshot` + `dashboard documents` props). Member pages must stop calling `/knowledge`; admin pages only.
6. **Admin gating is UI-only without Brain.** The rail hiding admin links is cosmetic; add server checks in each `app/admin/layout.tsx` (call `whoami`, `notFound()` if not admin) in addition to Brain 403/404.
7. **Auth redirects.** `loadWorkspaceSnapshot` is the only place redirecting to `/login` on `AUTH_REQUIRED` (`actions.ts:317`). A new `(app)/layout.tsx` calling `whoami` must keep that redirect or every page loses it.
8. **Server-action body limit and upload.** Upload currently posts the file through a server action (`next.config.ts` 12mb limit). The new upload dialog with 25 MB files and per-file stage polling needs a different path (route handler or direct R2 signed URL per master plan); do not rely on server action FormData.
9. **`/open` and the macOS app.** `/open` uses `bg-canvas`, `.btn`, Geist; dark mode + font change would alter it. Mitigation: `src/app/open/layout.tsx` wrapper with `data-theme="light"` on its root div and `font-family` stays visually the same only if Geist is kept for that route; simplest is to accept the system-font change and force light (decision for caller). macOS shell polls `/api/health` (keep route).
10. **Hover-only actions.** Existing answer actions are `opacity:0` until hover/focus on pointer devices (`globals.css:~455`); README shows them always visible. Do not carry the hidden state over (touch + a11y).
11. **Focus ring.** Global `:focus-visible` is an outline (`globals.css:~101`); README ring is a double box-shadow following the element radius. Changing it globally affects all pages, including `/open`; apply it in a layer both can accept.
12. **Test churn.** About 90 UI assertions across 8 files depend on current names (section 5). Keep accessible names stable where the spec permits.
13. **Reduced motion.** Existing block uses `0.01ms` duration (OK) but the status-line rise, page two-beat, hover-link transitions must be included.
14. **Legacy cleanup.** `importLegacyConversationsAction` is a no-op stub kept alive by a `useEffect` + `window.location.reload()` loop in the dashboard (`:176-188`); `lib/rag/chat-history.ts` localStorage migration code (`nura.conversations.*`). Drop with the dashboard (decision: check no real legacy data remains; it already returns success without saving).

## 8. Proposed frontend file plan

Principles: Server Components for route data; one small client island per interactive page; shell in a route-group layout so the rail never remounts; evidence panel state in URL; no new deps; keep existing patterns (`"use client"` components in `src/components/<area>/`, server actions in `src/app/*-actions.ts`, `brainJson` for server calls).

```
src/app/
  layout.tsx                      # system sans + Geist Mono, ThemeScript, suppressHydrationWarning
  globals.css                     # tokens (light/dark), base, primitives CSS; legacy classes removed at end
  (app)/                          # route group, no URL segment
    layout.tsx                    # server: whoami + conversations -> <AppShell>; redirects /login on AUTH_REQUIRED
    chat/page.tsx                 # empty state
    chat/[id]/page.tsx            # conversation (server loads turns)
    library/page.tsx
    settings/page.tsx             # deep link -> opens dialog (redirect to /chat?settings=1 or render dialog route)
    admin/
      layout.tsx                  # server: isAdmin guard -> notFound()
      overview/page.tsx
      sources/page.tsx            # ?upload=1 opens dialog
      people/page.tsx
      evals/page.tsx
      activity/page.tsx
    knowledge/page.tsx            # redirect -> /admin/sources   (or via next.config redirects())
    knowledge/new/page.tsx        # redirect -> /admin/sources?upload=1
    evaluations/page.tsx          # redirect -> /admin/evals
  login/page.tsx, signup/page.tsx # AuthForm restyle (stay outside (app))
  open/                           # untouched; add layout.tsx forcing data-theme="light" (decision)
  design-check/page.tsx           # dev-only primitive gallery (notFound() when NODE_ENV==="production")
  api/turns/[requestId]/route.ts  # keep; payload gains counts
  api/uploads/...                 # new route handlers for batch upload + stage polling (if not server actions)
  actions.ts                      # keep, prune: ask/cancel/loadConversation/delete/signOut; new: feedback, requestDocument, approve/deny
  admin-actions.ts                # new: sources/draft/promote/discard, invites, view-as
  library-actions.ts              # new: library(), document(id), search(q)
  eval-actions.ts                 # keep or remove runEvalsAction (unused)

src/components/
  ui/                             # primitives (all client-safe, tokens only)
    button.tsx (Button, IconButton), chip.tsx (FilterChip, CitationChip), segmented.tsx,
    field.tsx (Field, SearchField), table.tsx (Table*, EmptyRow), skeleton.tsx,
    status-dot.tsx, status-pill.tsx (replaces status-label.tsx), kbd.tsx, mark.tsx (Highlight),
    inline-alert.tsx, dialog.tsx (restyled), select.tsx, scroll-chrome.tsx, page-header.tsx, stage.tsx
  shell/
    app-shell.tsx                 # rail + stage slots, breakpoints, mobile slide-over
    rail.tsx, rail-chat-list.tsx  # groups Today / Previous 7 days; profile row
    mobile-header.tsx, mobile-sheet.tsx
    shortcuts.tsx                 # ⌘N, ⌘K global key handling
    page-transition.tsx           # two-beat page motion
  chat/
    chat-view.tsx                 # client island: owns turns, uses useChatTurn
    use-chat-turn.ts              # extracted submit/stop/poll/cancel guard logic (from dashboard)
    chat-head.tsx, chat-column.tsx, empty-state.tsx, suggestions.tsx
    composer.tsx                  # from chat-composer.tsx
    user-bubble.tsx, assistant-message.tsx, citation-text.tsx, sources-row.tsx, answer-actions.tsx
    status-line.tsx               # role=status, count labels
    no-evidence.tsx, error-alert.tsx, approval-card.tsx, view-as-banner.tsx
    evidence-items.ts             # buildEvidenceItems/filterCitedEvidence (moved)
    evidence/
      evidence-panel.tsx, evidence-list.tsx, retrieved-list.tsx, document-reader.tsx,
      evidence-link-store.ts      # hover/pin state (context + hook), drives chip/source/passage together
  library/ library-table.tsx, library-filters.tsx
  search/ search-dialog.tsx, search-results.tsx
  admin/
    overview/ kpi-strip.tsx, sparkline.tsx, unanswered-list.tsx, system-health.tsx, evals-summary.tsx
    sources/ generation-card.tsx, draft-row.tsx, sources-table.tsx, upload-dialog.tsx, upload-file-row.tsx, acl-picker.tsx
    people/ people-table.tsx, groups-table.tsx, invite-dialog.tsx
    evals/ runs-chart.tsx, category-bars.tsx, failures-list.tsx
    activity/ activity-table.tsx, trace-grid.tsx
  settings/ settings-dialog.tsx, appearance-pane.tsx, account-pane.tsx, model-pane.tsx, connectors-pane.tsx
  auth/ auth-form.tsx (restyled), proof-stage.tsx
  icons.tsx                       # Lucide ports, existing export names kept

src/lib/
  theme.ts, theme-script.tsx      # persistence + pre-paint
  use-media-query.ts
  format.ts                       # relative dates, "2.1 s", numbers (tabular)
  chat/groups.ts                  # Today / Previous 7 days bucketing
```

Delete at the end: `rag-visibility-dashboard.tsx(+test)`, `workspace/*`, `chat/{chat-workspace,conversation-turn,evidence-inspector}.tsx`, `knowledge/knowledge-workspace.tsx(+tests; keep folder-file-title if used)`, `evaluations/evaluations-workspace.tsx`, `settings/settings-workspace.tsx`, `ui/status-label.tsx`, root `loading.tsx` rewrite, legacy CSS classes, `lib/rag/chat-history.ts` localStorage-migration parts (keep types).

Suggested build order matching PROMPT phases (each lands green: `tsc`, `lint`, `vitest`, `build`):
1. Tokens + theme + fonts + icon port + primitives + `/design-check` (no behaviour change; old pages still render, `/open` forced light).
2. `(app)` layout, `AppShell`, `Rail`, shortcuts, route redirects; the old monolith temporarily wraps inside the new shell to keep chat/Sources working, then peels off per phase.
3. Chat: extract `use-chat-turn` first (move the dashboard tests' poll/cancel/guard cases onto it before rewriting UI), then components, then evidence panel and link store.
4. Search, Library, then admin pages as Brain endpoints land; mock-free: pages call server actions that call real Brain routes, so gate UI work per endpoint.
5. Settings dialog, auth restyle, mobile sheet, a11y pass (no axe in repo; keyboard pass + contrast script, any axe dep needs approval).

Open questions for the caller:
- Per-sentence vs paragraph-end citation chips (data supports paragraph-end only) - section 7.3.
- `/open` handling for dark theme + font - section 7.9.
- `isAdmin` source: new `admin` role vs reuse of `operator` (UI today checks `operator`); the README says add `admin`; confirm `roles` array naming returned by `whoami`.
- Where the Upload dialog sends files (route handler vs server action) given the 12 MB action limit and 25 MB spec.
