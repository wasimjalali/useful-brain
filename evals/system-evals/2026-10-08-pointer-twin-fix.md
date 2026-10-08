# The coverage pass was silent: fixing q028 and q088 by making it run

Date: 2026-10-08. Repo: Useful Brain. Model: GLM 5.3 Flash (`@cf/zai-org/glm-5.3-flash`). Prompt `grounded-answer.v10` before, `grounded-answer.v12` after (v11 was an interim build, reported separately below). Retrieval unchanged.

## TL;DR

Two Northwind questions kept failing after retrieval had already found the right documents: q028 (a process document cited instead of the policy that owns its rule) and q088 (a hiring referral bonus cited instead of the sales referral program). The 2026-09-06 pointer mechanism was meant to catch exactly these. It almost never got the chance.

**Root cause:** the coverage pass (and the other quote-extraction calls) asked GLM 5.3 Flash to turn thinking off with `chat_template_kwargs.enable_thinking: false`. The [model's Workers AI schema](https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/) says "Reasoning cannot be disabled" and defaults to max effort. With a 1,024-token completion cap, the reasoning used the whole budget and the call returned `finish_reason: "length"` with empty content. The pass then returned "no additions", silently.

| Coverage calls, live worker, temporary instrumentation | Calls | Empty content | Hit the 1,024 cap | Median completion tokens |
| --- | --- | --- | --- | --- |
| v10 (before) | 67 | 45 (67%) | 39 of 60 with a logged finish reason | 1,024 |
| v11 (decoding fixed) | 63 | 0 | 0 | 91 (max 401) |

The final build (v12) has no instrumentation. Its new truncation warning fired 0 times across the 60 v12 turns on that worker.

Final results, all corpus-agnostic changes:

| | Before | After (v12) |
| --- | --- | --- |
| q028 twin document | 0/4 on this worker (v10). Earlier today: 1/3, 1/3, 2/3 in the three A/B variants | **3/3** |
| q088 similar program | 1/4 on this worker (v10). Earlier today: 0/3, 0/3, 0/2 | **3/3** |
| Tuning set v2, 16 new questions x3 | 46/48 on `origin/main` (`adbd1ee`) | **47/48** |
| Abstention guard, 3 new questions x2 | 6/6 (v10) | 6/6 |

One of the four q028 "before" turns on this worker (`q028-q088-before-q-diag1.json`) never retrieved the privacy policy at all, so it was a retrieval miss, not a citation miss. The other three retrieved it and cited only the process document.

## How it was found

1. Read `pointer-completion.ts` and its call sites. Detection looked right for both questions: q088's draft hinted the sales referral program by title, so the coverage pass should have run with that hint.
2. Added temporary logging (removed before commit) of the search queries, raw draft, hints and the coverage call's raw provider response on an isolated worker (port 8791, own persist dir, generation `g-2055a92b`).
3. First live turns: the coverage call returned `""` on 5 of 6. The response tail showed `finish_reason: "length"`, `completion_tokens: 1024` and a long `reasoning_content` in which the model was mid-way through the right judgment ("the question says employee referral payout, could be either program...") when the budget ran out.
4. Checked the official model page: `reasoning_effort` accepts `low`, `high`, `max`, default `max`, and "Reasoning cannot be disabled". The toggle was a no-op for this model.

So the pointer mechanism wasn't wrong. It was starved. That also explains why it "fixed q088 once" on 2026-09-06 and didn't hold: it only worked on the draws where max-effort reasoning happened to finish under 1,024 tokens.

## What changed

1. **Extraction decoding** (`src/lib/models/workers-ai-citation-repair.ts`, `eval-override.ts`). A `MODELS_WITH_MANDATORY_REASONING` set (GLM 5.3 and GLM 5.3 Flash, both documented as unable to disable reasoning) gets `reasoning_effort: "low"` and `max_completion_tokens: 4096`, and no ignored toggle. Models with a working toggle keep `enable_thinking: false` and 1,024. This covers every quote-extraction call: coverage, citation repair, identifier recovery and the abstention recheck.
2. **Truncation is a failure, not "no quotes".** An extraction that still ends with `finish_reason: "length"` and no content now throws `ExtractionTruncatedError`. It is never cached, so a later strict retry or abstention recheck asks the provider again. It writes one warning line with no question, evidence or reasoning text. The run counts it, and the turn reports it as `extractionTruncatedCount` next to `vectorDegradedCount`.
3. **Restated-figure detection** (`src/lib/agent/pointer-completion.ts`). With the coverage pass alive, q028 still missed whenever the privacy policy wasn't hinted: no title was named in the cited chunk, and named neighbors filled the hint cap. The new signal: an uncited chunk containing every figure (at least two) of one cited draft paragraph may be restating the same rule. A figure is a quantity with a unit (a duration, a percentage or money). Years, section and step numbers and bare counts never count. Qualifiers stay attached, so 5 business days is not 5 calendar days. "30-day" and "30 days" match, and "$2,000" survives normalization.
4. **Hint-cap order.** Explicit contrasts and documents the question itself names are protected. Restating twins fill the remaining slots ahead of documents named only by the draft or the cited text, which is the noisiest signal (a cited chunk often lists every related policy).
5. **Reason-specific hint wording** in the coverage prompt (`grounded-answer.v12`). A restating twin is a candidate: the model includes its sentence only if it states the same rule for the same topic the question asks about, and is told the match can be coincidence. A contrasted program is included when the question's wording could mean either, so the answer shows each program with its own numbers. Named documents keep the old wording.

No question ids, document ids or corpus words in runtime code. The host still keeps additions only when the combined answer re-validates against the evidence ledger.

## Is q088's gold label right?

Arguably not, and the fix doesn't pretend otherwise. The question asks how "an employee referral payout" works. The recruiting policy's section is literally titled "Employee Referral Bonus" ($1,000 per hire). The commission plan calls the sales program "employee referral bonuses ($2,000 per customer)". The sales referral program also excludes sales roles, so the rep in the question can only ever earn the hiring bonus. The sales context ("explain to a rep", "a new deal") leans toward the gold, but the model's reading isn't wrong. It's ambiguous.

The fix answers the ambiguity rather than picking a side: all three v12 q088 answers cite both programs ($2,000 per customer under the referral program, $1,000 per hire under the recruiting policy) plus the 8% commission. They pass because the multi-hop scorer accepts extra citations. A reader of the 120 battery should know the pass comes from showing both, not from the model learning the gold.

## Tuning set v2

`content/northwind/tuning-questions.json`, 16 new questions. The locked `questions.json` was not touched. A test (`src/lib/eval/live-northwind-eval.test.ts`) fails if any tuning question shares a gold document and an expected section with a locked question, or reuses a locked id.

- **Twins (tu01 to tu08):** a process, handbook or neighbor document restates a figure and points at the policy that owns it. Ticket reopening restated by the agent scorecard, refund processing time restated by the complaint path (two phrasings), recovery targets restated by the DR runbook, post-contract data retention restated by the privacy policy, sabbatical terms restated by the handbook, corporate card approval thresholds that the card policy says are "the same thresholds" as employee expenses, holiday coverage pointed to by the on-call rotation.
- **Similar programs (tu09 to tu16):** complaint ESC levels versus incident SEV levels (three questions), a PIP versus the onboarding extension plan, contractor versus employee expense receipts, prospect data versus log access, employee customer referrals versus reseller partners, parental versus sick leave.
- **Abstention guard (3),** `tuning-abstention-questions.json`: questions next to similar evidence with no answer (a partner referring a job candidate, a Tokyo per-diem, a parking subsidy amount). A working repair or coverage pass that quotes too eagerly would turn these refusals into unsupported answers.

"Before" ran on a detached worktree of `origin/main` (`adbd1ee`, prompt v10, includes PR #67) on port 8793 with its own persist dir and seeded generation `g-fa04ae7d`. "After" ran on this branch (`14a17b2`, prompt v12) on port 8791, generation `g-2055a92b`. Same harness checkout for both; each output records the Brain's pipeline version and the harness commit (`harnessDirty: true` because the runner script was edited, uncommitted, during the runs).

| Tuning v2, per 16-question run | Before r1 / r2 / r3 (main) | After r1 / r2 / r3 (v12) |
| --- | --- | --- |
| Passed | 16 / 15 / 15 | 15 / 16 / 16 |
| Misses | tu07, tu07 | tu07 |
| Gold retrieved but uncited | 0 / 1 / 1 | 1 / 0 / 0 |
| Cited a non-gold document too | 2 / 4 / 3 | 4 / 4 / 3 |
| Latency p50 | 52.1s / 42.2s / 49.8s | 25.2s / 23.2s / 21.7s |
| Latency p95 | 75.6s / 81.5s / 85.7s | 70.2s / 67.7s / 118.7s |

The tuning set mostly shows the model already handles these shapes on other document pairs, so it's a regression guard more than a lever. The one discriminating question is tu07 (corporate card approval, a two-figure twin): 1/3 before, 2/3 after. The latency drop comes from the same root cause: a max-effort coverage call that burns 1,024 tokens costs about 20 seconds. The single 118.7s p95 is one slow turn, not a pattern.

## History: the interim v11 build and tuning set v1

Reported for the record, not pooled with the final numbers.

- **Decoding fix only** (v11 decoding, v10 hints): q028 1/3, q088 2/3 (`q028-q088-after-decoding-only.json`).
- **v11** (decoding fix plus the first version of restated figures, which counted bare numbers and let restating twins outrank every other hint): two 3-repeat runs of the same build, q028 2/3 then 3/3, q088 3/3 then 2/3. They were two batches of one build, which is why the earlier draft of this report summed them as 5/6. The q088 miss in the second batch is below.
- **Tuning set v1** (`superseded-tuning-questions-v1.json`, runs named `superseded-v1-*`): 46/48 before (v10) and 48/48 after (v11). Review found it overlapped the locked set: 12 of its 16 questions shared a gold document and expected section with a locked question, and five asked locked facts outright (tq02 and tq13 repeat q026, tq10 repeats q028, tq16 is q088's template, tq14 used q028's vocabulary). v1 was also extended in place: its first 11 questions all passed one baseline repeat (`superseded-v1-tuning11-before-r1-*`), a second repeat was aborted after 2 turns (`superseded-v1-tuning11-before-r2-aborted.log`), and 5 questions were added before the 3-repeat baseline. v2 replaces it.

## Honest caveats

- **The v11 q088 miss was inferred to be a provider failure, not an answer-path failure.** The evidence (`q088-v11-miss-worker-log-excerpt.log`): the turn's instrumentation line shows no search and an empty draft, the worker logged 57 remote Workers AI "internal error" lines during that turn, and it returned `insufficient_evidence` after 60s. The logs don't name which call failed, so "the main chat call failed" is an inference. It was scored as a fail. Under `main`'s PR #67 such a failure now ends as a 503 and stops the harness instead of being scored.
- **Brownout rule used here.** From the brief: a turn over 300 seconds is a local `wrangler dev` brownout and is discarded, never scored. In practice one v10 tuning repeat stalled on a coverage call that hung for more than 10 minutes. The whole repeat was discarded (`superseded-v1-tuning-questions-before-r3-aborted-brownout.log`), the worker restarted and the repeat re-run. No turn in the v12 measurements came near 300s. The v12 worker log still shows remote "internal error" lines that the bindings retried. No v12 turn failed.
- **Citations broadened a little.** v12 answers cite a non-gold document about as often as `main` (11 versus 9 across three tuning runs). v11 had broadened more (21 versus 11 on tuning v1). The softer restates wording and the demotion of text-only named hints account for the difference. q028 sometimes also cited the data retention deletion sentence under v11. Nothing unsupported was added and the abstention guard held. The full battery's `citedNotExpectedCount` is the number to watch.
- **Wider blast radius than the two questions.** The decoding fix also revives citation repair, identifier recovery and the abstention recheck, which were starved the same way. That should help factual refusals and could in principle hurt unanswerable cases. The 3-question abstention guard is small. The full 120 battery is the real check.
- **q028 still needs two figures in the draft** for the restated-figure hint. A draft that quotes only "30 days" gives it nothing to match, by design.
- **Small samples.** 3 turns per locked question on the final build, 48 tuning turns per side. Two local workers, two seeded generations of the same corpus.
- **Turn budget.** About 260 live turns across both rounds (152 in round one, 108 in round two), plus Northwind seeds on two fresh workers (one seed request was sent twice after a client-side timeout), slightly over the ~250 guideline. Workers AI on credits, well inside the $75/month inference safety boundary. Gross spend wasn't metered per run.

## Raw files

`results/2026-10-08-quality/`:

- Final: `tuning-questions-before-main-r*`, `tuning-questions-after-v12-r*`, `tuning-abstention-questions-after-v12-r*`, `q028-q088-after-v12.json`
- Before on this worker: `q028-q088-before-q-diag*.json`, `tuning-abstention-questions-before-v10-r*`
- Interim v11: `q028-q088-after-decoding-only.json`, `q028-q088-after-v11-probe.json`, `q028-q088-after-v11.json`, `tuning-abstention-questions-after-v11-r*`, `q088-v11-miss-worker-log-excerpt.log`
- Superseded tuning v1: `superseded-tuning-questions-v1.json`, `superseded-v1-*`
- Instrumentation: `instrumentation-v10.log`, `instrumentation-v11.log`, plus `coverage-call-stats.py` and `coverage-call-stats.txt`, which produce the first table
- Runner: `tuning-run.sh <label> <repeats> <file stem> [port]`

## Reproduce

```bash
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8791 --persist-to <dir>
npx jiti evals/results/2026-10-08-redesign/scripts/seed-only.ts http://127.0.0.1:8791
npm run eval:northwind -- --live http://127.0.0.1:8791 --questions content/northwind/tuning-questions.json
npx jiti evals/results/2026-10-08-redesign/scripts/ab-repeat.ts http://127.0.0.1:8791 3 out.json label q028 q088
```

For the "before" side, run the same worker command from a detached worktree of the base commit on another port (add `--inspector-port` when two workers start together) and point the same harness at it. `--questions` writes to `eval-output/tuning/<file>/`, never to the locked run's files. It refuses `questions.json` under any spelling and fails closed on a file with no questions.
