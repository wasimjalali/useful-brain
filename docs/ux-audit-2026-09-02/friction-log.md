# Friction log

Rated by effect on a first-time operator (or a hiring manager watching the portfolio). Evidence is the 1440×900 captures in this folder.

| ID | Severity | Where | Cost | One-line fix |
|---|---|---|---|---|
| F1 | High | Evaluations | The page headlines 9/10 from a 10-case smoke run. The locked campaign is 114/120 (95%). A visitor reads the wrong number. | Make Evaluations a read-only dashboard of the frozen Northwind campaign. |
| F2 | High | Evaluations | Primary action is "Run evaluations". A live 120-question run takes tens of minutes and is a CLI job. The button invites the wrong task. | Remove the run control from the UI. Keep `npm run eval:northwind` as the operator path. |
| F3 | Medium | Knowledge | Generation IDs, chunk counts, re-index, and three filters sit above the document names. A beginner cannot tell what to do first. | One primary action (Upload). Move generation / re-index behind a quiet details row. |
| F4 | Medium | Chat | "New chat" appears in the rail and again in the header. Suggestion chips repeat the same questions as the eval set. | One New chat control. Keep suggestions; they are the right first action. |
| F5 | Medium | Shell | Documents / Chunks / "Retrieval ready" repeat on every page and again in Settings and Knowledge. | Keep a one-line ready state. Put inventory only on Knowledge. |
| F6 | Medium | Shell | Warm paper + forest teal is a second visual language from the Cursor / ink-on-white brief. | Retoken after the visual direction is locked. |
| F7 | Low | Settings | Roles and departments dump every Northwind value into one row. Assume principal is the only action and it is mid-list. | Lead with Assume principal. Collapse the role dump. |
| F8 | Low | Evaluations | Failed row (eval-02) cites a Meridian portal doc. That is a real 10-case miss, not the 120-question residue. | Stop treating this battery as the scoreboard. |

## Patterns

1. The proof eval and the UI eval are different products.
2. Operator machinery (IDs, re-index, assume principal) is in the default viewport.
3. The same status chrome is painted three times.

## If you change one thing

Stop running evals in the browser. Show 114/120, the 72→95 story, and the six remaining failures, read-only.
