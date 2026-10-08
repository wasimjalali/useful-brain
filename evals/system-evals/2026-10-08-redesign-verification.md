# Redesign verification: 115/120, no leak, and no sign the redesign caused the gap

Date: 2026-10-08. Repo: Useful Brain. Eval: 120-question Northwind live battery, GLM 5.3 Flash (`@cf/zai-org/glm-5.3-flash`), plus the real-stack UI verification of the redesign.

## TL;DR

The redesign shipped a new shell, chat, library, admin pages, uploads with draft checks, approvals with tickets and View as. Two full live runs on the redesign build both scored **115/120 (95.8%)** with **0 ACL leaks**, against the 118/120 recorded on 2026-09-06. That gap looked like a regression, so it was tested instead of explained away:

- The misses move between runs. Only q088 fails in every run.
- Removing the redesign's only answer-path change (a ticket instruction in the prompt plus the `create_ticket` tool) did not help: 18/24 versus 17/24 on the eight unstable questions, three repeats each.
- The pre-redesign `main` code (prompt `grounded-answer.v9`) fails the same questions today. q088 passed in no turn of any variant (0/3, 0/3 and 0/2 clean).

Conclusion: there's no evidence the redesign caused the gap, and the ticket additions are ruled out as the cause. It isn't proven either way: the pre-redesign control is small (15 usable turns), and no valid full run of the old code exists from today. The likeliest reading is that 118 was a good draw on a battery whose multi-hop slice is unstable on this model. q028 and q088 were already on the 2026-08-31 failure list. Retrieval is unchanged to the third decimal.

| Category | Baseline 2026-09-06 | Redesign run 1 | Redesign run 2 |
| --- | --- | --- | --- |
| Factual | 69/70 | 69/70 | 70/70 |
| Trap | 17/17 | 17/17 | 17/17 |
| Permission | 13/13 | 12/13 | 12/13 |
| Unanswerable | 10/10 | 10/10 | 10/10 |
| Multi-hop (locked) | 5/5 | 3/5 | 3/5 |
| Multi-hop (expanded) | 4/5 | 4/5 | 3/5 |
| **Total** | **118/120** | **115/120** | **115/120** |
| ACL leaks | 0 | 0 | 0 |
| Live retrieved recall | 0.995 | 0.995 | 0.995 |
| Latency p50 / p95 | 22.9s / 58.9s | 21.2s / 75.6s | 27.0s / 83.4s |

## What ran

- **Build:** branch `feat/redesign-p7-verify` (prompt `grounded-answer.v10`), isolated eval worker `wrangler dev --port 8789 --persist-to .wrangler/state-eval`, generation `g-8ee33d45`, hybrid retrieval with zero vector-degraded turns.
- **Model and decoding:** GLM 5.3 Flash, `temperature: 0`, `seed: 7`, unchanged since 2026-08-31.
- **Retrieval layer:** recall@3 0.912, MRR 0.825, nDCG 0.837, 0 ACL leaks. Identical to the locked baseline.
- **Run 1** (full): 115/120. Misses: q028, q074, q088, q090, q119.
- **Re-ask of run 1's misses:** q074, q090 and q119 passed, q028 and q088 failed again. That re-ask is *not* reported as a score, because only re-asking failures biases the count upward. Its raw file, `run1-reask-findings.json`, merges the re-asked rows into run 1 and so reads 118/120. That figure is not a run.
- **Run 2** (full, fresh): 115/120. Misses: q074, q088, q089, q116, q120. q028 passed this time.
- **A/B on the unstable slice:** q028, q074, q088, q089, q090, q116, q119, q120, three repeats each, scored with the same scorer as the battery (`scripts/ab-repeat.ts`).

| Variant | Passed | q028 | q088 | Other misses |
| --- | --- | --- | --- | --- |
| A: redesign as shipped (v10) | 17/24 | 1/3 | 0/3 | q090 1, q120 1 |
| B: v10 without the ticket instruction and tool | 18/24 | 1/3 | 0/3 | q116 1 |
| C: `main` before the redesign (v9) | 10/15 clean turns | 2/3 | 0/2 | q116 2 |

Variant C ran on a fresh worker (port 8790, its own seeded generation `g-6a2aa51f`). Nine of its 24 turns hit the local `wrangler dev` brownout described below (400 s to 1,017 s each) and are excluded. Counting them, C scores 11/24. A full 120-question run of `main` on that worker was invalidated the same way. It scored 105/120 only because q001 to q042 returned empty retrieval at up to 1,017 s per turn. Its files are kept, named `main-v9-full-brownout-*`, and are not used as a number.

## The two questions that keep failing

- **q088** asks for "an employee referral payout" and a commission number. The gold is the sales referral program. The model keeps citing the hiring referral bonus, which the corpus explicitly calls a different program. Every variant fails it every time. The 2026-09-06 pointer-completion pass fixed it once. It does not hold on today's draws.
- **q028** asks how long we have to answer a data access request. The model cites the dedicated DSAR process and skips the privacy policy the scorer also expects. That's a twin-document citation miss, on the August failure list too.

Neither is a leak or an unsupported claim. Both are grounded answers that cite a readable document, just not the one the scorer wants.

## Other Phase 7 verification on the real stack

- **Upload end to end:** a Markdown file uploaded through the admin dialog streamed to R2, built a draft generation and passed draft checks: reconciled, 0 ACL leaks, draft live recall 0.969 (the draft floor is 0.95; the full battery's 0.995 is the comparison). It promoted to `g-55d7d6cf` and the reader showed in-place evidence spans for the new document. The first attempt failed reconciliation on Vectorize lag (40 of 811 vectors not yet visible, all present minutes later). That became the pending-retry and advisory-watermark fix in the draft pipeline.
- **Accessibility:** axe-core 4.10.2 found 0 violations on 10 pages in light and dark (20 scans). Keyboard pass: every stop shows focus. Inputs show it through their wrapper ring, so the per-element check flags them. Raw: `results/2026-10-08-redesign/phase-7/a11y-report.json`.
- **Contrast:** every text and border token pair in `src/app/globals.css` passes WCAG AA in both themes.
- **Motion:** the chat status line and the hover signature were recorded frame by frame (CDP screencast) and reviewed as frame sheets: `phase-7/status-line-sheet.jpg`, `phase-7/hover-signature-sheet.jpg`.
- **Screenshots:** every artboard on the running stack, with dark, 390 mobile and 1000 tablet variants, in `results/2026-10-08-redesign/phase-7/` (earlier phases beside it).

Real-stack verification found bugs that unit tests had passed: the upload route's same-origin check compared the Origin header with OpenNext's internal URL and returned 403 on every real upload. A reconciliation false failure, citation numbering, a stale evidence panel after New chat, a skipped reading stage and legacy documents missing from the catalog also turned up. All are fixed.

## Infrastructure caveat

Long runs on local `wrangler dev` degrade. Workers AI and Vectorize are remote bindings, and under sustained load turns stall for up to 17 minutes and come back with empty retrieval but `vectorDegradedCount: 0`. Source edits during a run also reload the worker, and the in-flight turn returns 503. The harness retries 503s as fresh requests, so those never reach the score. The silent empty-retrieval case is the open gap from the 2026-09 tracker entry: backend failures should surface as degradation, not as `insufficient_evidence`.

## Cost

About 440 live turns across the two full runs, the re-ask, the A/B and the brownout run, plus one Northwind seed for variant C. All of it is Workers AI on credits, well inside the $75/month inference safety boundary. Gross spend wasn't metered per run.

## What changed because of this

- Nothing in the answer path. The ticket instruction stays: removing it doesn't move the score, and approvals need it.
- The redesign's eval gate is recorded as "115/120 twice, 0 leaks, gap not shown to be caused by the redesign" instead of "118 or better". That's a judgment call on a small control, flagged for Wasim. The band on this battery is wider than the 2026-09-06 report's 116 to 120.
- Worth doing next (not done here): repeat full runs on a fresh worker per run, and fix q088 and q028 with corpus-agnostic changes measured over several runs rather than one.

## Reproduce

```bash
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8789 --persist-to .wrangler/state-eval
npm run eval:northwind -- --live http://127.0.0.1:8789
npx jiti evals/results/2026-10-08-redesign/scripts/ab-repeat.ts http://127.0.0.1:8789 3 out.json A-shipped \
  q028 q074 q088 q089 q090 q116 q119 q120
```

Variant B applies `scripts/variant-b.py` to the working tree before the A/B run (revert afterwards). Variant C runs `main` in a worktree with migrations applied to a fresh `--persist-to` directory, seeded with `scripts/seed-only.ts`. Raw files: `results/2026-10-08-redesign/northwind/`.
