# Handoff: Useful Brain redesign (UI/UX + backend gaps)

Target repo: `wasimjalali/useful-brain` (Next.js 16 App Router, Tailwind v4, Cloudflare Workers: web, Brain, ingestion; D1, Vectorize, Workers AI, Pi Agent Core).
Source brief: `docs/design/2026-10-07-redesign-brief.md`. This README is self-sufficient; the brief is background.

## About the design files

The `.dc.html` files in this folder are **design references built in HTML**: interactive prototypes that show the intended look and behaviour. They are not production code. Recreate them in the repo's existing stack (React server/client components, Tailwind v4 role tokens in `src/app/globals.css`, existing `src/components/*` patterns). Do not ship the HTML.

To view: serve this folder with any static server (for example `npx serve .`) and open `Useful Brain Redesign.dc.html`. It's a pan-and-zoom canvas with every artboard. The light and dark tokens are set on each artboard's wrapper, so a screen file opened on its own renders unstyled. Always view screens through the canvas.

## Fidelity

**High fidelity.** Colours, type, spacing, radii, shadows, copy and interactions are final. Match them closely. Where this README and a prototype disagree, this README wins (it includes the audit corrections).

## Product rules the UI must express

- Every factual claim cites a passage the asker may read. Missing evidence is a refusal, never a guess.
- ACL applies before retrieval fusion, reranking, model context, citations, counts, search results and any UI number shown to a member.
- Actions run only after the person approves the **exact normalized arguments**. Any argument change invalidates the approval.
- Two audiences, one app: **Member** (chat, evidence, approvals, Library) and **Admin** (member features plus Overview, Sources, People, Evals and Activity).

---

## Design tokens

Add these as role tokens in `globals.css`, with a dark theme set (`[data-theme="dark"]`, and `prefers-color-scheme` when the theme is System). Replace the current `--canvas: #f8f8f8` with `#F3F3F3`.

| Token | Light | Dark |
|---|---|---|
| `--canvas` (rail and page) | `#F3F3F3` | `#0F0F0F` |
| `--surface` (stage) | `#FFFFFF` | `#171717` |
| `--sunken` | `#F0F0F0` | `#2C2C2C` |
| `--bubble` (lifted content) | `#FFFFFF` | `#202020` |
| `--ink` | `#171717` | `#EDEDED` |
| `--ink-muted` | `#5C5C5C` | `#A3A3A3` |
| `--ink-faint` (decoration only, never text) | `#A3A3A3` | `#6E6E6E` |
| `--ink-faint-text` (readable small text) | `#6B6B6B` | `#949494` |
| `--accent` (primary fill) | `#171717` | `#EDEDED` |
| `--accent-ink` | `#FFFFFF` | `#141414` |
| `--border` / `--border-strong` | `#EBEBEB` / `#E0E0E0` | `#262626` / `#333333` |
| `--edge` (whisper outline) | `rgb(0 0 0 / .05)` | `rgb(255 255 255 / .07)` |
| `--hover` (rail hover tone) | `rgb(0 0 0 / .04)` | `rgb(255 255 255 / .045)` |
| `--success` / `--success-soft` | `#0F6F56` / `#E4F4EE` | `#4CC39B` / `#13302A` |
| `--warning` / `--warning-soft` | `#8A5300` / `#FBF1DE` | `#E3A64A` / `#33260F` |
| `--danger` / `--danger-soft` | `#B23C22` / `#FBEAE5` | `#F0795C` / `#3A1B14` |
| `--hl` (graphite highlight) | `rgb(23 23 23 / .12)` | `rgb(237 237 237 / .15)` |
| `--hl-strong` (hovered or pinned) | `rgb(23 23 23 / .24)` | `rgb(237 237 237 / .30)` |
| `--scrim` (dialog backdrop) | `rgb(23 23 23 / .28)` | `rgb(0 0 0 / .55)` |

Shadows:
- `--lift`: `0 0.5px 1px rgb(23 23 23/.04), 0 3px 16px rgb(23 23 23/.08)` (dark: `0 0.5px 1px rgb(0 0 0/.3), 0 3px 16px rgb(0 0 0/.36)`)
- `--stage-shadow`: `0 1px 0 rgb(23 23 23/.03), 0 18px 40px -24px rgb(23 23 23/.18)` (dark: `…/.2`, `…/.6`)
- `--sel` (selected rail row, segmented thumb): `0 0 0 1px var(--edge), 0 1px 2px rgb(23 23 23/.07)` (dark: `rgb(0 0 0/.4)`)
- Dialogs: `0 0 0 1px var(--edge), var(--lift), 0 24px 64px -24px rgb(0 0 0/.35)`
- Lifted items use **edge plus lift**, never a grey 1px border.

Radius by role: 6 for chips, citation chips and kbd; 10 for buttons, nav rows and icon buttons; 14 for fields, bubbles, search fields and the error banner; 16 for cards, dialogs and menus; 22 for the expanded composer; 24 for the stage, the evidence panel and the mobile rail and sheet; 999 for the composer pill and the send button.

Type:
- Sans: system stack `-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, 'Segoe UI', sans-serif` for all chrome. This replaces Geist Sans.
- Mono: Geist Mono (already loaded through `next/font`), only for citations, chunk and generation IDs, scores, tool names and arguments, latencies and commands.
- Scale: page title 24/32, weight 600, tracking -0.02em. Empty-chat heading 24/32, weight 600. Chat body 15/24. Table and body UI 13/18–20. Rail rows 13. Section labels 12, weight 500, `--ink-faint-text`, sentence case. Meta 11–12. KPI numbers 28/36, weight 600. Dialog title 16, weight 600.
- `font-variant-numeric: tabular-nums` on every number. Sentence case everywhere, no Title Case.

Motion: one easing `cubic-bezier(0.22, 1, 0.36, 1)`. Hover and tone 120ms; highlight and citation colour 160ms; status-line text swap: rise 4px and fade in over 260ms. Page change is two beats: old page out 120ms, new page rises 260ms. No springs. Respect `prefers-reduced-motion` and disable all of it.

Icons: Lucide outline at 1.5 stroke, muted ink. No new packages are approved. Port the SVG paths from `ub-icon.js` (lucide-static 0.460.0, ISC) into `src/components/icons.tsx`.

Brand: keep the existing `UsefulBrainLogo` (document-and-quote mark plus wordmark) at the rail size shown, 20×22 mark. The wordmark text in the prototypes is a stand-in.

Banned: purple or indigo, gradients, glow, glass or blur, emoji icons, sparkle or robot icons, badge pills above headings, bento grids, cards inside cards, centred app content, helper text that restates a heading, hype words.

---

## Shell

- **Rail** (248px, flat on `--canvas`, padding 10). From top: logo row (40px tall); New chat ⌘N; Search ⌘K; Library. Admins also get the "Admin" group label and Overview, Sources, People, Evals, Activity. Below that, Chats grouped "Today" and "Previous 7 days". At the bottom, a pinned profile row: 30px avatar with initials, name 13/500, role or department 12 `--ink-faint-text`, and a settings gear icon button.
  - Rows are 34px tall with radius 10 and a 16px icon. Hover is `--hover` (a tone shift only). The active row is a small lifted card: `--bubble` plus `--sel`, weight 500. Keyboard hints are mono 11 in `--ink-faint-text`.
  - Order never changes between pages.
- **Stage**: `--surface`, margin `10px 10px 10px 0`, radius 24, `box-shadow: 0 0 0 1px var(--edge), var(--stage-shadow)`.
- **Evidence panel**: a second stage, not an overlay. 380px wide, same radius and shadow, same 10px gutter to its right. It sits beside the stage, and the chat column re-centres inside the narrower stage.
- **Chat head**: 52px, padding `0 12px 0 24px`, title 14/500 with ellipsis, panel toggle on the right (32×32; active state uses a sunken fill).
- **Chat column**: max 768px, centred in the stage. The column's content is left-aligned. User bubble: max 640, right-aligned, `--sunken`, radius 14, padding `10px 16px`.
- **Composer**: 52px pill with `--bubble`, `0 0 0 1px var(--edge), var(--lift)` and padding `0 8px 0 20px`. When multi-line, it becomes a box with radius 22, padding `14px 8px 8px 20px`, and the send button pinned bottom right. Send is a 36px circle: sunken with an `--ink-faint` arrow when empty; accent fill with an accent-ink arrow when there is text. While answering it becomes **Stop** (accent fill with a square icon). Focused: shadow edge becomes `--border-strong`.
- **Page header** (admin and library pages): padding `36px 48px 0`, title 24/600, a 13px `--ink-muted` subtitle 4px below, and primary actions right-aligned on the title baseline.
- **Tables**: header row 32px, 12/500 `--ink-faint-text`, bottom `1px var(--border)`. Rows are 46–56px with padding `0 12px` and radius 10. Row hover is `--sunken`. There are no zebra stripes or vertical rules. Row actions appear on hover in the last column.
- **Filter chips**: 30px tall, radius 6, padding `0 10px`, 13px. Off: `--sunken`, with the count in `--ink-faint-text`. On: accent fill with accent-ink text and the count at weight 400. Hover (off): `--border-strong`.
- **Segmented control**: track `--sunken`, padding 3, radius 10. Thumb is `--bubble` with `--sel`, radius 8, weight 500. Inactive options are `--ink-muted`.
- **Buttons**: Primary uses accent fill, radius 10, 13/500, height 34–36 (hover opacity .86, active opacity .76 and scale .98). Secondary uses `--sunken` with `inset 0 0 0 1px var(--edge)` (hover `--border-strong`). Ghost uses a transparent background (hover `--sunken`). Icon buttons are 32×32 with radius 10. Disabled buttons use `--sunken` with `--ink-faint-text` and the not-allowed cursor. No outline-only buttons.
- **Focus-visible** (all interactive elements): `0 0 0 2px <surface behind>, 0 0 0 4px var(--ink)`, following the element's radius.
- **Citation chip**: min 18×18, padding `0 5px`, radius 6, mono 11/500, vertical-align 2px. Default is `--sunken` with `--ink-muted`. Hovered or pinned is `--accent` with `--accent-ink`. In mobile body text it's 22×20 with an invisible hit area of at least 44px.

---

## Screens (artboard IDs match the canvas)

### 01 Chat, empty (light and dark)
- Column top padding 176. Heading "Ask about Northwind". Subline "Every answer cites the documents you can read." (15/24, `--ink-muted`, 6px gap). Composer 28px below, placeholder "Ask a question".
- Four suggested questions as quiet rows, 24px below the composer. Each row is 44px with the text in 14px `--ink-muted` and the department on the right (12px `--ink-faint-text`). Hover: `--sunken` and ink.
- Suggestions:
  - "How much parental leave do I get, and when am I eligible?" (HR)
  - "What is the first-response target for a P1 ticket?" (Support)
  - "How long are system logs kept?" (Engineering)
  - "Can I keep my laptop when I leave Northwind?" (Operations)
- Suggestions must be drawn only from documents the member can read.

### 02 Chat, answer with evidence open (light, dark, admin)
- Q: "How much parental leave do I get, and when am I eligible?"
- A: "You get sixteen weeks of fully paid parental leave per child, at 100% of base salary [1]. You're eligible after six months of continuous service [2]. It's on top of your annual leave, so it doesn't reduce your vacation or sick days [2]."
- Sources row (16px below): one 32px button per cited source, `--sunken` plus edge, radius 10, never wrapping internally. Contents: number chip on `--bubble`, document 13/500, section 12 `--ink-faint-text`.
- Action row: Copy, Retry, Good, Bad (32px icon buttons), then mono meta "8 passages · 2.1 s" in `--ink-faint-text`.
- **Signature, linked hover:** hovering citation n in the text or its source button turns that chip and source number to accent, scrolls passage n into view in the panel, and darkens its highlight from `--hl` to `--hl-strong` (160ms). Clicking pins it.
- **Evidence panel**:
  - Header 52px, "Evidence" 14/600, close button.
  - Tabs as a segmented control: "Cited 2" and "Retrieved 8".
  - Cited tab: each passage shows its chip, document 13/500 and section 12. The passage text is 13/21 `--ink-muted`, indented 26px. The relied-on sentence(s) are wrapped in `<mark>` with background `--hl`, colour `--ink`, radius 3, padding `1px 2px` and `box-decoration-break: clone`. Below it, an "Open document →" link (12/500 muted). Passages are separated by a 1px `--border` rule.
  - Retrieved tab: ranked list with rank (mono 11), document and section. Cited rows are marked "Cited".
  - Admin only: under each passage, mono 11 rows `chunk nw_hr_parental_leave:c02`, `generation g-c305cf57` and `scores Keyword 0.868 · Vector 0.840 · Rerank 0.991`. Retrieved rows show the rerank score, with a footer "Rerank score · floor 0.05 · g-c305cf57".

### 03 Chat, working
- One status line (`role="status"`, `aria-live="polite"`): a 6px ink dot pulsing at 1.2s, then the text. It rewrites in place through "Searching 34 documents" → "Reading 8 passages" → "Writing a cited answer". Each swap rises 4px over 260ms.
- **Audit correction:** the document count is the **asker's readable** count, not the corpus total. A member must not learn how many hidden documents exist.
- When the validated answer is ready, it replaces the status line with a rise-in. **Do not stream unvalidated model tokens.** The host validator must pass first. If you want a progressive feel, reveal the validated text quickly (it should finish in under 600ms).
- The composer send button becomes Stop and calls the existing `/cancel`.

### 04 Chat, no evidence
- Q: "When is the 2027 company holiday calendar published?"
- A: "I couldn't find this in the documents you can read, so I won't guess."
- Secondary button "Request this document" (file-plus icon). Next to it, mono meta "Searched 34 documents · 1.4 s".
- After a click, the button becomes a disabled "Requested" pill with a success check, plus a 12px note "Admins see it under Unanswered questions." Requests are idempotent per person and question.

### 05 Chat, approval (pending and done)
- Q: "Open a P1 ticket for Halvorsen Freight. Atlas sync has been stalled since 06:10 and their orders aren't flowing."
- A (cited): "That fits P1: a major feature is down for the customer [1]. P1 tickets get a 1-hour first response, around the clock [2]. I've prepared the ticket for the Support desk."
- **Approval card** (`--bubble`, edge plus lift, radius 16, max 640):
  - Header: ticket icon, "Needs your approval" 14/600, and mono `create_ticket` on the right.
  - Arguments as a mono 13/20 two-column grid (key in `--ink-faint-text`, value in ink): `desk Support`, `priority P1`, `customer Halvorsen Freight`, `subject Atlas sync stalled since 06:10, orders not flowing`.
  - Footer row above a `--border` rule: lock icon with "Approves these exact arguments only" (12px faint text), then **Deny** (secondary) and **Approve and run** (primary).
- **Done**: a compact lifted row with a success circle-check, "Ticket SUP-4821 created", mono "create_ticket · P1 · 09:42" and an "Open ticket ↗" ghost button. A follow-up cited line follows.
- **Denied**: a sunken row with circle-x and "Denied. Nothing was run." Also handle **expired** (approval TTL passed) with "This approval expired. Ask again to get a fresh one." in the same treatment.

### 06 Chat, error
- Partial text stays in `--ink-muted`. Below it, an alert (`role="alert"`) with `--danger-soft`, radius 14, padding `8px 8px 8px 14px`. It holds a danger circle-alert icon, the text "The answer stopped before it finished. Your question is saved." (14px ink) and a Retry button (`--bubble` plus `--sel`).
- Retry re-runs the same user message (`parent_user_message`) and shows the status line again.

### 07 Document reader (in the evidence panel)
- Header: back arrow (to evidence), title "Parental Leave Policy", open-in-Library icon, close.
- Metadata grid (12px): Version 2.0 · Effective 1 Feb 2026 · Readable by (globe icon) Everyone · Owner HR. Values come from document front matter (`version`, `effective_date`, `department`, `access_scope`, `allowed_*`).
- Body: section headings 13/600 and paragraphs 13/22 `--ink-muted`. The cited sentence is highlighted **in place** with the same mark, using `--hl-strong` for the active citation and `--hl` for other cited spans. The citation chip sits inline before the span. The panel opens scrolled to the active span.

### 08 Search (⌘K)
- Dialog 640px wide, 112px from the top, on the scrim. Input row 56px: search icon, 16px input, and an `esc` kbd.
- Groups "Chats" and "Documents" (section labels 12/500).
  - Chat rows are 40px: message icon, title with the query match in weight 600, and a relative date.
  - Document rows are 56px: file icon, title with the match in bold, a snippet line "Section · text…" (12px faint), and the department on the right.
- The selected row is `--sunken` with a ↵ icon. Arrow keys move the selection, Enter opens, and ⌘Enter asks about the document. Footer: kbd hints "↑↓ Move", "↵ Open", "⌘↵ Ask about this", and "2 chats · 3 documents" on the right.
- Documents are ACL-filtered. The member's own chats only.

### 09 Library (member; ready, loading, no match)
- Subtitle "34 documents you can read". Search field 340×36 (radius 14, sunken plus edge), placeholder "Search titles and sections".
- Department chips with live counts: All, Engineering, HR, Support, Operations, Finance, Legal, Sales. Hide chips with 0.
- Table columns: Document (file icon plus 14/500 title), Department, Who can read, and a hover action "Ask about this" (lifted small button, which starts a chat scoped to that document).
- Loading: 12 skeleton rows using `--sunken` bars. No match: "Nothing you can read matches "{query}"", the line "It may not exist yet, or it may be restricted to another team.", "Request this document" (secondary) and "Clear search" (ghost).

### 10 Overview (admin; light and dark)
- Subtitle: the week range.
- KPI strip: one lifted card split into four cells by `inset 1px 0 0 var(--border)`. Each cell has a label (12/500), a value (28/36/600), a delta (12 muted), a 28px sparkline (1.5px ink polyline, no fill, no axes) and "Thu / Wed" end labels.
  - Questions this week 214 (+12% on last week)
  - Answered with citations 91.6% (+0.8 pts)
  - No evidence 18 (8.4% of questions)
  - Median answer 2.4 s (−0.2 s)
- Two columns (`1fr 380px`, gap 48):
  - **Unanswered questions**, with label "What to add next" and "Asks" on the right. Rows are 60px: question 14px, meta "Last asked today · 1 document request · likely HR" (12 faint), the ask count on the right, and "Add document" on hover (opens the Upload dialog prefilled).
  - **System**: rows with a 7px status dot, name and detail. The header shows "1 warning" in warning colour when any row isn't healthy. Rows: Brain worker, Corpus database, Vector index ("Synced to g-c305cf57", mono), Workers AI, AI Gateway ("2 retries in the last hour", warning dot and text). Colour appears only on non-healthy rows.
  - **Evals**: 118/120 Questions passed, 0 ACL leaks (success colour), "Latest run 6 Sep 2026", and an "Open evals →" link.

### 11 Sources (admin; draft building and checks passed)
- Subtitle "65 documents · readers only see the active generation". Buttons: Re-index (secondary, refresh icon) and **Upload documents** (primary). Buttons never wrap.
- Generation card (lifted): Active generation with a green dot and mono `g-c305cf57`, Promoted 6 Sep 2026, Documents 62, Chunks 787, Retrieval Hybrid.
- Draft row (below a rule inside the same card):
  - **Building**: spinner, "Draft", mono `g-7d19a4e0`, "Embedding 41 of 58 chunks · 2 documents · 1 failed", a 160px progress bar, "71%", and a disabled "Promote draft".
  - **Checks passed**: success check, "Checks passed", the ID, "2 documents, 58 chunks · reconciled · ACL leaks 0 · live recall 0.995", then Discard (ghost) and **Promote draft** (primary).
  - **Audit correction:** draft checks are reconciliation plus the retrieval/ACL eval, not the full answer eval. Evals stay read-only and run from the repo.
- Search field and status chips: All 65 · Active 62 · Draft 2 · Failed 1.
- Table: Document (title 13/500 plus mono file name 11 faint, or the error in danger colour for failed rows), Department, Who can read, Chunks (right-aligned), Updated, Status pill (radius 6, 22px; Active uses success-soft with success, Draft uses sunken with muted, Failed uses danger-soft with danger).
- Long file names truncate with an ellipsis and a full `title` tooltip. The failed row shows "Could not read page 14: scanned image with no text layer".

### 12 Upload dialog
- Dialog 560px, 96px from the top. Title "Upload documents".
- Dropzone 112px (sunken plus edge, radius 14): "Drop files here, or browse" and "PDF, DOCX or Markdown, up to 25 MB each".
- File rows 44px: icon, name, size, current stage text and a 4-segment progress (Parsing, Chunking, Embedding, Ready). Done segments are ink, the current segment is `--ink-faint` and later segments are sunken. "Ready" is shown in success colour.
- "Who can read these": a segmented control (Everyone, Departments, Roles) and toggle chips for the groups.
  - Departments: Engineering, Executive, Finance, HR, Legal, Operations, Sales, Support.
  - Roles: Managers, Directors, HR managers, Finance managers, Support managers, Sales managers.
  - Everyone shows "All 148 people at Northwind."
- Note (layers icon): "Files go into a draft. Nothing changes for readers until you promote it."
- Footer: "{n} of 4 ready", Cancel, and **Add to draft**, which stays disabled until every file is Ready. Reject unsupported files inline.

### 13 People (admin; people, groups, viewing as)
- Subtitle "Access follows department and role. Use View as to check what someone can read." Primary button "Invite people".
- Tabs (segmented): People 148, Groups 9. Search "Search name or email".
- People table: Name (30px avatar, name 13/500, email 12 faint), Role (Admin or Member), Department, Documents readable (count plus a 72px bar out of the 62 active documents), Last active, and "View as" on hover.
- Groups table: Group, Type (Built in / Department / Role), People, Adds documents ("+10 documents"), and Rule in mono ("department = engineering", "role in (manager, director)").
- **Viewing as** (chat):
  - A 44px accent banner at the top of the stage: eye icon, "**Viewing as Priya Shah** · Support · 34 documents" and an inverted "Exit" button. The composer placeholder becomes "Ask as Priya Shah".
  - When a viewing-as answer is a refusal and a restricted document would have matched, show the admin-only line (eye-off icon, 12 faint): "Only you see this: Salary Bands exists, but only HR can read it."
  - That check runs separately with admin scope and never reaches the model.

### 14 Evals (admin, read-only)
- Subtitle "120 questions across five categories, run against the active generation". Model chip: mono `@cf/zai-org/glm-5.3-flash`.
- Runs chart: SVG line, 1.75 ink stroke. Gridlines at 60–100% labelled on the left. Points are 10px open dots, and the latest is filled. Labels above each point: Baseline 77/107 (30 Aug), Pass 1 95/120 (31 Aug), Pass 2 114/120 (31 Aug), Latest 118/120 (6 Sep 2026).
- Right column: "Latest run by category" bars (6px, ink on sunken): Factual 69/70, Trap 17/17, Permission 13/13, Unanswerable 10/10, Multi-hop 9/10. Retrieval metrics in mono 20: ACL leaks 0 (success), Live recall 0.995, Recall@3 0.912, MRR 0.825.
- "Remaining failures 2 of 120": expandable rows with a chevron (rotating 90° over 160ms), mono ID, category and question. Expanded rows show "Asked as" (mono principal), "Expected" (document · section list) and "Note". Data comes from q093 and q120 in `content/northwind/questions.json`.
- Footer: lock icon, "Read-only here. Run the suite from the repo:" and mono `npm run eval:northwind`.

### 15 Activity (admin)
- Outcome chips with counts: All 214 · Answered 189 · No evidence 18 · Approved 4 · Denied 1 · Error 2.
- Columns: chevron, Time (mono), Person, Question (ellipsis), Outcome (7px dot plus label; success for Answered and Approved, faint for No evidence, muted for Denied, danger for Error), Sources (right-aligned), Latency (mono, right-aligned).
- An expanded row shows the trace in a sunken box (radius 14) as a mono 12 grid of step, detail and duration. Steps: rewrite, retrieve, rerank, generate, tool call, approval, result.
- Traces are redacted per the existing redaction rules. No evidence text, only IDs and scores.

### 16 Settings dialog (appearance and account; model and connectors)
- Dialog 780×580 with a 212px left nav (Appearance, Account, then the "Admin" label, Model and retrieval, Connectors) and a close button top right.
- Appearance: Theme segmented control (System, Light, Dark, with monitor, sun and moon icons). The note says "Follows your device. Light right now." or "Always dark, whatever your device uses."
- Theme behaviour: persist the choice, apply it before first paint to avoid a flash, and follow live OS changes when System is selected.
- Account: Name, Email, Role, Department, "Can read 31 of 62 documents", and "Sign out" (secondary).
- Model and retrieval (admin, read-only, with lock icon and "Read-only. Changes go through evals."):
  - Answer model `@cf/zai-org/glm-5.3-flash`
  - Embeddings `@cf/qwen/qwen3-embedding-0.6b` (**audit correction**)
  - Reranker `@cf/baai/bge-reranker-base`
  - Retrieval: Hybrid, keyword and vector
  - Passages per answer 8
  - Rerank floor 0.05
  - Active generation `g-c305cf57`
  - Read all of these from the live config. Don't hard-code them.
- Connectors:
  - Uploads: built in, 65 documents, Active.
  - Support desk: `create_ticket`, every call needs approval, Connected.
  - GitHub: "Sync a repository folder into a draft", with a Connect button. **Audit correction:** this replaces Google Drive, which isn't in the source kinds (`upload | github | http`).

### 17 Sign in
- Left column 560px on the canvas: logo; "Sign in to Northwind"; "Ask about company documents. Every answer shows the passage behind it."; Email and Password fields (44px, radius 14, lifted, focus ring; the password field has a show/hide eye button); **Sign in** (primary, 44px); and the note "You'll only see documents your department and role can read." Footer: "Northwind Systems".
- Right side is a stage showing one answer sentence with an accent chip, and the source passage at 20/34 with `--hl-strong` behind the cited sentence.
- **Audit correction:** email and password only, with no SSO button (AGENTS.md: no SSO onboarding). Errors are shown inline under the field in danger colour. The existing signup gate stays as it is.

### 18 Mobile 390×844 (chat, rail slide-over, evidence sheet)
- Header 52px with menu, title and new chat (44px targets). Body 15/24, padding 16. The sources summary is a 44px button ("1 2 Parental Leave Policy · 2 passages ^") that opens the evidence sheet. Action icons are 44px. The composer sits above the home indicator.
- Rail: slide-over 308px over the scrim, radius `0 24 24 0`, 44px rows, profile at the bottom.
- Evidence sheet: bottom sheet 612px, radius `24 24 0 0`, grabber, full-width segmented tabs (36px), passages at 14/23 with the same highlight.
- Breakpoints:
  - ≥1200px: the evidence panel sits beside the stage.
  - 768–1199px: the rail collapses to the slide-over and the evidence panel opens as a 380px right sheet over the stage.
  - <768px: the mobile layout above.

### States sheet
These apply on every page. Buttons, icon buttons, citation chips, composer, rail rows and fields are each specified in default, hover, focus-visible, active and disabled. The sheet also covers loading skeletons (answer, table rows, evidence passage), empty patterns (rail first visit: "Questions you ask show up here."; filtered Activity: "No denied actions this week" plus "Show all outcomes") and page error ("Couldn't load sources. The corpus database didn't respond." plus Retry).

---

## Routes

| Route | Screen | Notes |
|---|---|---|
| `/chat`, `/chat/[id]` | 01–07 | Evidence panel state in the URL (`?evidence=cited\|retrieved&doc=<id>&c=<n>`) |
| `/library` | 09 | New |
| `/admin/overview` | 10 | New. Admin only |
| `/admin/sources` | 11, 12 | Replaces `/knowledge`; redirect `/knowledge` and `/knowledge/new` |
| `/admin/people` | 13 | New. Admin only |
| `/admin/evals` | 14 | Replaces `/evaluations` (redirect) |
| `/admin/activity` | 15 | New. Admin only |
| Settings | 16 | Dialog over any page; keep `/settings` as a deep link that opens it |
| `/login` | 17 | Restyle; `/signup` restyled to match, gate unchanged |
| `/open` | Public landing | Out of scope; leave untouched |

---

## Backend: what exists vs what to build

**Already in the repo (reuse, don't rebuild):** email/password sessions (`0011_auth_sessions`); principals, roles and departments; conversations, messages and evidence snapshots with channel scores (`0002`, `0010`); agent runs, tool calls and approvals (`0003`, `0004`); turn progress with a closed stage enum (`src/lib/cf/turn-progress.ts`); `/cancel`; corpus generations with draft → promote, reconciliation audits, FTS5 and Vectorize; ingestion workflow and queue; eval runs (`0009`); the synthetic MCP `create_ticket` and `northwind_lookup`; `assumePrincipal` (loopback only); the operational log and AI Gateway wrapper.

**Gaps to build** (Brain Worker endpoints, D1 migrations as additive files, server-side authorization, idempotent writes, tests first):

1. **Admin role and authorization.** Add an `admin` role in `roles`, enforced in Brain for every `/admin/*` route. Fail closed. `whoami` returns `{ isAdmin, department, roles, readableDocumentCount }`. The UI hides the admin group, but only the server enforces.
2. **Turn progress with counts.** Extend the payload with integers only, no text: `searching {readableDocuments}`, `reading {passages}`, `writing`, `done`, `failed {errorCode}`. Keep the union closed and the writes monotonic. Persist `latency_ms` and `passages_retrieved` on the assistant message.
3. **Feedback.** Add `message_feedback(message_id, principal_id, value ∈ {up, down}, created_at)` with a unique key `(message_id, principal_id)`. Endpoints: `POST` and `DELETE /messages/:id/feedback`.
4. **Document requests.** Add `document_requests(id, principal_id, message_id, question_normalized, created_at)`, unique per principal and normalized question. Endpoint: `POST /messages/:id/request-document`.
5. **Unanswered questions.** `GET /admin/unanswered?range=7d` aggregates `insufficient_evidence` messages by normalized question and returns ask count, last asked, request count, and the "likely" department (department of the best below-floor candidate; omit it if there is none). View-as turns are excluded.
6. **Overview metrics.** `GET /admin/overview?range=7d` returns totals, % grounded, no-evidence count, median latency, and 7 daily points for each sparkline. View-as and eval traffic are excluded.
7. **System health.** `GET /admin/health` returns Brain (self), corpus D1 ping, vector index (latest reconciliation versus the active generation), Workers AI (last call status) and AI Gateway (retry count in the last hour from the operational log), each as `{status: ok|warning|error, detail}`.
8. **Library and document reader.**
   - `GET /library` returns active-generation documents readable by the caller: id, title, department, a "who can read" label derived from `access_scope` and `allowed_departments`/`allowed_roles`, and section headings.
   - `GET /documents/:id` returns metadata (version, effective date, owner department, readers) and the section-split text. It's ACL-checked and returns 404 (not 403) if unreadable.
   - Optional `?message=<id>` returns highlight spans by mapping cited chunks through `chunks.start_offset`/`end_offset`.
   - Persist front matter (`version`, `effective_date`, `department`, `allowed_*`) per document version if it isn't already stored.
9. **Search.** `GET /search?q=` returns at most 5 of the caller's own chats (title plus message text) and at most 5 readable documents (FTS5 over titles and sections, active generation, ACL-filtered before ranking), with match ranges for bolding.
10. **Approvals with visible arguments.** Store the redacted normalized arguments JSON with each approval, and return it to the chat. Add the `expired` UI state. Approve and deny keep binding the fingerprint and idempotency key.
11. **`create_ticket` contract.** Change the arguments to `{desk: "Support", priority: "P0"|"P1"|"P2"|"P3", customer: string, subject: string}`, validated with typebox. Persist tickets in operations D1 (`tickets` table, `SUP-` plus a sequence starting at 4800) instead of the in-memory MCP store, so the done state and "Open ticket" survive reloads. It stays synthetic.
12. **Activity log and traces.** Add `turn_steps(message_id, step, detail_json, duration_ms, seq)`, written by the turn executor (rewrite, retrieve, rerank, generate, tool call, approval, result), redacted per `redact-tool-result`. Endpoints: `GET /admin/activity?outcome=&cursor=` (keyset pagination) and `GET /admin/activity/:messageId`.
13. **Sources and upload progress.**
    - `GET /admin/sources` returns the active generation summary, the draft generation (state, embedded/total chunks, documents, failed with error codes mapped to human messages) and documents with status, chunks, updated date and readers.
    - Upload: `POST /admin/uploads` creates a batch in the draft with an ACL selection. `GET /admin/uploads/:batchId` returns per-file stage (`parsing|chunking|embedding|ready|failed`).
    - Draft checks: reconciliation plus the retrieval/ACL eval (`run-retrieval-eval`) against the draft. Promote stays disabled until ACL leaks are 0. Discard deletes the draft.
14. **People, groups and invites.**
    - `GET /admin/people` returns principals joined to auth users, roles and departments, readable-document count (computed with the same ACL code as retrieval) and last active.
    - `GET /admin/groups` returns groups derived from departments and roles, with rule and document delta.
    - Invites: add `invites(id, email, role, department, token_hash, expires_at, accepted_at)`. `POST /admin/invites` returns a one-time link for the admin to copy. No email sending. Accepting the invite sets the password and creates the principal.
15. **View as in session mode.** Allow `assumePrincipal` for admins in `session` mode (today it's loopback only).
    - Every assumed turn writes an audit row.
    - Assumed turns aren't saved to either person's history and are excluded from metrics.
    - The admin-only "exists but restricted" diagnostic runs a separate admin-scope title match after the assumed turn refuses. It never touches model context and is returned only to the admin.
16. **Config read-out.** `GET /config` returns answer, embedding and reranker models, passages per answer, rerank floor, retrieval config version and active generation, read from code and config (`src/lib/models/selection.ts` and friends). Connectors come from the registry.
17. **Evals read-out.** Extend `GET /evaluations` to return the run history (including frozen campaign snapshots in `evals/results/`), category breakdown, retrieval metrics and failures with expected documents. The UI stays read-only.

---

## Audit corrections (already reflected in the prototypes)

1. Status-line and refusal counts show the asker's readable documents (34), not the corpus total (62), so no hidden-document count leaks.
2. Sign in is email and password. The SSO button is removed (AGENTS.md).
3. The Settings embeddings model is corrected to `@cf/qwen/qwen3-embedding-0.6b`.
4. Connectors offer GitHub instead of Google Drive.
5. Draft checks are reconciliation plus the retrieval/ACL eval, not the full answer eval.
6. "Documents readable" bars and "Can read" use the 62 active documents as the denominator.
7. Sources header buttons no longer wrap.
8. Answers must not stream before validation (behaviour note, see 03).

## Assets
- Icons: `ub-icon.js` (Lucide static 0.460.0, ISC). Port the needed paths into `src/components/icons.tsx`.
- Logo: the existing `src/components/useful-brain-logo.tsx` and `public/brand/*`.
- Fonts: Geist Mono through `next/font` (already present). System sans, no download.
- Content: only the Northwind corpus (`content/northwind/`, 65 documents, 120 questions). Names used: Maya Chen (Engineering member), Priya Shah (Support member), Jordan Ellis (Operations admin), plus people from the corpus. "Halvorsen Freight" is a synthetic customer.

## Files in this bundle
- `Useful Brain Redesign.dc.html`: the canvas with every artboard and token wrapper. **Start here.**
- `Chat.dc.html` (states: empty, answer, working, noevidence, approval, approved, error, viewing, reader), `Evidence Panel.dc.html` (evidence and document views, admin flag), `Rail.dc.html`.
- `Search.dc.html`, `Library.dc.html`, `Overview.dc.html`, `Sources.dc.html`, `Upload.dc.html`, `People.dc.html`, `Evals.dc.html`, `Activity.dc.html`, `Settings.dc.html`, `Sign In.dc.html`, `Mobile.dc.html`, `States.dc.html`.
- `ub-icon.js` (icons) and `support.js` (prototype runtime only; don't port it).
- `PROMPT.md`: the implementation prompt for the developer agent.
