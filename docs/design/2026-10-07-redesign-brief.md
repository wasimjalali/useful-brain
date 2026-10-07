# Useful Brain redesign brief (for `/design`)

## Product

Useful Brain answers questions from company documents. Every claim cites a passage the asker is allowed to read. Missing evidence is a refusal, never a guess. Actions (tickets, drafts) run only after the person approves the exact arguments.

Two audiences, one app:

- **Member** (an employee): asks questions, reads cited answers, checks the evidence, approves actions, browses the documents they can read.
- **Admin**: everything a member does, plus manages sources, people and access, checks quality (evals), watches activity and system health.

The single job of the main screen: ask a question and trust the answer.

Content is the synthetic Northwind Systems corpus: 65 documents across HR, Finance, Support, Sales, Legal, Engineering, Operations and Executive. Use only this content. No Lorem, no "John Doe".

## Visual system (Useful Bot tokens, exact)

Monochrome. Black is the brand. Color only for status.

| Role | Light | Dark |
|---|---|---|
| canvas, rail | #F3F3F3 | #0F0F0F |
| surface (stage) | #FFFFFF | #171717 |
| sunken | #F0F0F0 | #2C2C2C |
| bubble (lifted content) | #FFFFFF | #202020 |
| ink | #171717 | #EDEDED |
| ink-muted | #5C5C5C | #A3A3A3 |
| ink-faint (decoration only) | #A3A3A3 | #6E6E6E |
| ink-faint text (readable) | #6B6B6B | #949494 |
| accent (primary fill) | #171717 | #EDEDED |
| accent-ink (text on accent) | #FFFFFF | #141414 |
| border / border-strong | #EBEBEB / #E0E0E0 | #262626 / #333333 |
| edge (whisper outline) | rgb(0 0 0 / 0.05) | rgb(255 255 255 / 0.07) |
| success / soft | #0F6F56 / #E4F4EE | #4CC39B / #13302A |
| warning / soft | #8A5300 / #FBF1DE | #E3A64A / #33260F |
| danger / soft | #B23C22 / #FBEAE5 | #F0795C / #3A1B14 |

- Radius by role: 6 chips and focus, 10 buttons and nav rows, 14 fields and bubbles, 16 cards, dialogs and menus, 22 expanded composer, 24 stage, pill 999.
- Shadows: lift `0 0.5px 1px rgb(23 23 23/.04), 0 3px 16px rgb(23 23 23/.08)`; stage `0 1px 0 rgb(23 23 23/.03), 0 18px 40px -24px rgb(23 23 23/.18)`. Shadows stay dark in dark mode.
- Type: system UI stack (SF Pro) for all chrome. Geist Mono for citations, chunk IDs, generation IDs, scores and commands. Chat body 15/24. Rail rows 13. Section titles 12, weight 500, sentence case. Page titles 24, weight 600, tracking -0.02em. Tabular figures on every number.
- Shell: flat rail 248px on the canvas, white stage floating with a 10px gutter and 24px radius. Chat head 52px. Chat column max 768px, user bubble max 640px. Composer is a 52px pill that grows to a 22px-radius box when multi-line, with a solid black circular send button (sunken with a faint arrow when empty).
- Lift, don't outline: lifted items use the edge plus the lift shadow, not gray 1px borders. Selected rail item is a small white card with a 1-2px soft shadow; hover is a tone shift only.
- Primary button: solid black. Secondary: sunken tone fill with the edge. No outline-only buttons.
- Icons: one line set (Lucide, 1.5px stroke), muted ink.
- Motion: one easing, cubic-bezier(0.22, 1, 0.36, 1), 120-260ms. Page changes are two beats (old page out 120ms, new page rises 260ms). No springs.

Banned: purple or indigo, gradients, glow, glass or blur, emoji icons, sparkle or robot icons, badge pills above headings, bento grids, cards inside cards, centered app content, helper text that restates a heading, hype words, Title Case.

## Signature (the one bold thing)

**The graphite highlight.** In the evidence panel, the sentence the answer relies on is marked with a soft graphite highlighter (ink at about 12% behind the text, like a pencil marker), while the surrounding passage stays in muted ink. Hovering a citation chip in the answer brings its passage into view and darkens its highlight. Opening the document shows the same highlight in place. Everything else stays quiet.

## Navigation

Rail, top to bottom: mark and "Useful Brain", then New chat (⌘N), Search (⌘K), Library. Admins also get an "Admin" group: Overview, Sources, People, Evals, Activity. Then "Chats" grouped by Today and Previous 7 days. Profile row pinned at the bottom: avatar, name, role, settings gear. Navigation never changes order between pages.

## Artboards

Desktop 1440×900 unless noted. Light first, dark for the starred ones.

1. **Chat, empty\*** Heading "Ask about Northwind", one line "Every answer cites the documents you can read.", composer, four suggested questions as quiet rows.
2. **Chat, answer with evidence open\*** Q: "How much parental leave do I get, and when am I eligible?" A: "You get sixteen weeks of fully paid parental leave per child, at 100% of base salary [1]. You're eligible after six months of continuous service [2]. It's on top of your annual leave, so it doesn't reduce your vacation or sick days [2]." Sources row under the answer. Actions: copy, retry, good, bad, plus faint mono meta "8 passages · 2.1 s". Evidence panel (380px, beside the stage): tabs "Cited 2" and "Retrieved 8", each passage with document, section, graphite highlight. Admin view adds chunk ID, generation and scores (Keyword 0.868, Vector 0.840, Rerank 0.991).
3. **Chat, working.** One status line that updates: "Searching 62 documents", "Reading 8 passages", "Writing a cited answer". The first token of the reply replaces it.
4. **Chat, no evidence.** Q: "When is the 2027 company holiday calendar published?" A calm refusal: "I couldn't find this in the documents you can read, so I won't guess." A secondary button "Request this document" that becomes "Requested".
5. **Chat, approval.** The agent proposes `create_ticket` (Support desk). Card: "Needs your approval", the exact arguments (priority P1, subject, customer), "Approves these exact arguments only", buttons "Approve and run" and "Deny". Also show the done state ("Ticket SUP-4821 created").
6. **Chat, error.** "The answer stopped before it finished. Your question is saved." with Retry.
7. **Document reader** in the panel: Parental Leave Policy, v2.0, effective 1 Feb 2026, readable by Everyone, the cited sentence highlighted in place.
8. **Search (⌘K)** dialog: results grouped as Chats and Documents, keyboard hints.
9. **Library** (member): documents you can read, filter chips by department with counts, search, "Ask about this" on hover.
10. **Overview\*** (admin): Questions this week 214, Answered with citations 91.6%, No evidence 18, Median answer 2.4 s (with sparklines). "Unanswered questions" list (what to add next). "System" status: Brain worker, Corpus database, Vector index (synced to g-c305cf57), Workers AI, AI Gateway (warning: 2 retries in the last hour). Evals summary: 118/120, ACL leaks 0.
11. **Sources** (admin): "Upload documents" primary, "Re-index" secondary. Active generation strip: g-c305cf57, promoted 6 Sep 2026, 62 documents, 787 chunks, hybrid retrieval. A draft generation row (building, then "Checks passed" with "Promote draft"). Table: Document, Department, Who can read, Chunks, Updated, Status (Active, Draft, Failed). Include one failed row with a long file name.
12. **Upload dialog:** dropzone, file list with per-file progress (Parsing, Chunking, Embedding, Ready), "Who can read these" (Everyone, Departments, Roles), note "Files go into a draft. Nothing changes for readers until you promote it.", "Add to draft".
13. **People** (admin): "Invite people". People table (name and email, role, department, documents readable, last active) with "View as" on hover. Groups tab. Show the "Viewing as Priya Shah · Support · 34 documents · Exit" banner on a chat.
14. **Evals** (admin): runs Baseline 77/107 (30 Aug), Pass 1 95/120, Pass 2 114/120 (31 Aug), Latest 118/120 (6 Sep 2026) as a small line chart. Category bars: Factual 69/70, Trap 17/17, Permission 13/13, Unanswerable 10/10, Multi-hop 9/10. Retrieval: ACL leaks 0, live recall 0.995, Recall@3 0.912, MRR 0.825. Remaining failures q093 (factual) and q120 (multi-hop), expandable. Model `@cf/zai-org/glm-5.3-flash`. Read-only; mono footer "npm run eval:northwind".
15. **Activity** (admin): log of turns with time, person, question, outcome (Answered, No evidence, Approved, Denied, Error), sources cited, latency. Filter chips by outcome. A row expands to the retrieval trace and tool calls.
16. **Settings** dialog: Appearance (System, Light, Dark as a custom segmented control), Account, and for admins Model and retrieval (read-only, "changes go through evals") and Connectors.
17. **Sign in.**
18. **Mobile 390×844:** chat with answer, rail as a slide-over, evidence as a bottom sheet.

States to cover on every page where they apply: empty, loading (skeletons), error, hover, focus-visible, active, disabled.
