# Flow map

The product is a single-operator local workspace. One spine: left nav, same four items on every page.

## 1. Chat (entry)

Job: ask a company question, see a cited answer, inspect the evidence.

1. `/` redirects to `/chat`.
2. Empty composer: four suggestion chips, send field, New chat in the rail and again in the header.
3. Recent conversations sit under the nav only while Chat is active.
4. An answered turn opens the evidence inspector as a sibling column.

Clicks to first answer from a cold open: 1 (suggestion) or 2 (type + send). Timed wait is model latency, not chrome.

## 2. Knowledge base

Job: see what the agent may read, add a document, promote a generation.

1. `/knowledge` shows generation status, 65/717 inventory, search / filter / sort, and a document table.
2. Upload document opens a dialog (`/knowledge/new` is the same view with the dialog open).
3. Re-index knowledge base is a full-corpus action on this page.

This is an operator page, not a beginner page. Generation IDs and chunk counts are the first things in the viewport.

## 3. Evaluations (current)

Job today: trigger a live 10-case manual battery and inspect per-case evidence.

1. `/evaluations` shows "Run evaluations", latest run 9/10 from 30 Aug 2026, and a 10-row table.
2. The locked 120-question Northwind campaign (72% → 95%, 114/120 on 31 Aug 2026) is not on this page. It lives in `evals/` only.

Clicks to see the portfolio proof number: infinite. The page cannot show it.

## 4. Settings

Job: see who is asking, optionally assume a Northwind principal, read locked models.

1. `/settings` is a definition list. The only control is Assume principal.
2. Retrieval stats repeat the sidebar and the Knowledge header.

## What the shape tells you

Four pages is the right count. Chat is the product. Knowledge is the corpus. Settings is the identity switch needed for ACL demos. Evaluations is the only page whose job is wrong: it is a runner for a 10-case smoke set, while the number that matters is a frozen 120-question campaign. The spine (left nav, teal-on-paper tokens, rail stats on every page) is louder than the task.
