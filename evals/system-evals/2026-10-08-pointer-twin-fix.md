# The coverage pass was silent: fixing q028 and q088 by making it run

Date: 2026-10-08. Repo: Useful Brain. Model: GLM 5.3 Flash (`@cf/zai-org/glm-5.3-flash`). Prompt `grounded-answer.v10` before, `grounded-answer.v13` after. v11 and v12 were interim builds from review rounds and are reported separately below. Retrieval unchanged.

## TL;DR

Two Northwind questions kept failing after retrieval had already found the right documents: q028 (a process document cited instead of the policy that owns its rule) and q088 (a hiring referral bonus cited instead of the sales referral program). The 2026-09-06 pointer mechanism was meant to catch exactly these. It almost never got the chance.

**Root cause:** the coverage pass (and the other quote-extraction calls) asked GLM 5.3 Flash to turn thinking off with `chat_template_kwargs.enable_thinking: false`. The [model's Workers AI schema](https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/) says "Reasoning cannot be disabled" and defaults to max effort. With a 1,024-token completion cap, the reasoning used the whole budget and the call returned `finish_reason: "length"` with empty content. The pass then returned "no additions", silently.

| Coverage calls, live worker, temporary instrumentation | Calls | Empty content | Hit the 1,024 cap | Median completion tokens |
| --- | --- | --- | --- | --- |
| v10 (before) | 67 | 45 (67%) | 39 of 60 with a logged finish reason | 1,024 |
| v11 (decoding fixed) | 63 | 0 | 0 | 91 (max 401) |

The v12 and v13 builds carry no instrumentation. Their truncation warning fired 0 times on each 60-turn worker run (`worker-log-counts.txt`, produced by `worker-log-counts.py` from the committed worker logs).

This table and the two locked questions are the real evidence:

| | Before | After (v13) |
| --- | --- | --- |
| q028 twin document | 0/4 on this worker (v10). Earlier today: 1/3, 1/3, 2/3 in the three A/B variants | **3/3** |
| q088 similar program | 1/4 on this worker (v10). Earlier today: 0/3, 0/3, 0/2 | **3/3** |

One of the four q028 "before" turns on this worker (`q028-q088-before-q-diag1.json`) never retrieved the privacy policy at all, so it was a retrieval miss, not a citation miss. The other three retrieved it and cited only the process document.

The new tuning set and the abstention guard show **no measurable change**: 46/48 on `origin/main` against 47/48 on v13, a difference of one question at n=3, and 6/6 against 6/6. They're a regression guard, not evidence of improvement.

On the full locked battery, v13 scored **117/120 with 0 ACL leaks**, against 115/120 twice on the redesign build. Details are in [Full 120 battery](#full-120-battery).

## Full 120 battery

The orchestrator ran the locked 120-question battery on v13 (`f0cad65`, harness at `d52b372`). It used a fresh worker on port 8792 with its own state and generation `g-7a3b7142`. Result: **117/120 with 0 ACL leaks**. For comparison, the redesign build scored 115/120 in both of its full runs ([redesign verification](2026-10-08-redesign-verification.md)). The retrieval layer is unchanged: recall@3 0.912, MRR 0.825, nDCG 0.837.

| Category | Redesign run 1 | Redesign run 2 | v13 |
| --- | --- | --- | --- |
| Factual | 69/70 | 70/70 | 70/70 |
| Trap | 17/17 | 17/17 | 17/17 |
| Permission | 12/13 | 12/13 | 12/13 |
| Unanswerable | 10/10 | 10/10 | 10/10 |
| Multi-hop (locked) | 3/5 | 3/5 | 3/5 |
| Multi-hop (expanded) | 4/5 | 3/5 | 5/5 |
| **Total** | **115/120** | **115/120** | **117/120** |
| ACL leaks | 0 | 0 | 0 |
| Live retrieved recall | 0.995 | 0.995 | 0.995 |
| Latency p50 / p95 | 21.2s / 75.6s | 27.0s / 83.4s | 20.1s / 58.4s |

Other v13 numbers:
- 0 vector-degraded turns.
- `citedNotExpectedCount` 13.
- `goldRetrievedUncitedCount` 13.
- 13 refusals kept with evidence in hand. All 13 are correct abstentions: 9 permission and 4 unanswerable.

q028 and q088 both pass. The three misses:
- **q073** (permission): answered from an allowed neighbor, the 2026 release notes, instead of abstaining. The forbidden document was never retrieved, so it's not a leak. It's on the 2026-08-31 failure list too.
- **q086** (multi-hop): cited the change management policy but not the deployment policy.
- **q090** (multi-hop): cited the refund and data retention policies but not the DSAR process.

All three are citation choices with the gold retrieved, not retrieval failures. One full run can't separate a gain this size from run-to-run variance: the 2026-09-06 report put the band at 116 to 120.

Two small fixes landed after this battery, from the third review round:
- a length-limited response with a cut-off object after a complete example is now treated as truncated;
- the coverage pass drops a quote that the model repeated within one response.

Both touch only truncated or duplicated extraction responses, and the v13 tuning, abstention and q028/q088 runs logged 0 truncations. So the battery reflects the answer path as merged. Raw files: `results/2026-10-08-quality/full-battery-v13-{findings,live-summary,live-checkpoint,retrieval-report}.json`.

## How it was found

1. Read `pointer-completion.ts` and its call sites. Detection looked right for both questions: q088's draft hinted the sales referral program by title, so the coverage pass should have run with that hint.
2. Added temporary logging (removed before commit) of the search queries, raw draft, hints and the coverage call's raw provider response on an isolated worker (port 8791, own persist dir, generation `g-2055a92b`).
3. First live turns: the coverage call returned `""` on 5 of 6. The response tail showed `finish_reason: "length"`, `completion_tokens: 1024` and a long `reasoning_content` in which the model was mid-way through the right judgment ("the question says employee referral payout, could be either program...") when the budget ran out.
4. Checked the official model page: `reasoning_effort` accepts `low`, `high`, `max`, default `max`, and "Reasoning cannot be disabled". The toggle was a no-op for this model.

So the pointer mechanism wasn't wrong. It was starved. That also explains why it "fixed q088 once" on 2026-09-06 and didn't hold: it only worked on the draws where max-effort reasoning happened to finish under 1,024 tokens.

## What changed

1. **Extraction decoding** (`src/lib/models/workers-ai-citation-repair.ts`, `eval-override.ts`). A `MODELS_WITH_MANDATORY_REASONING` set (GLM 5.3 and GLM 5.3 Flash, both documented as unable to disable reasoning) gets `reasoning_effort: "low"` and `max_completion_tokens: 4096`, and no ignored toggle. Models with a working toggle keep `enable_thinking: false` and 1,024. This covers every quote-extraction call: coverage, citation repair, identifier recovery and the abstention recheck.
2. **Truncation is a failure, not "no quotes".** A `finish_reason: "length"` response is accepted only when its last quotes object is complete JSON. An empty answer, an answer cut off mid-JSON, or an earlier example object in narration standing in for a cut-off final one all throw `ExtractionTruncatedError`. The check reads the same `choices` or `result.choices` envelope as the chat parser. A truncated extraction is never cached, so a later strict retry or abstention recheck asks the provider again. It writes one warning line with no question, evidence or reasoning text. The run counts it, and the turn reports it as `extractionTruncatedCount` next to `vectorDegradedCount`.
3. **Restated-figure detection** (`src/lib/agent/pointer-completion.ts`). With the coverage pass alive, q028 still missed whenever the privacy policy wasn't hinted: no title was named in the cited chunk, and named neighbors filled the hint cap. The new signal: an uncited chunk containing every figure (at least two) of one cited draft paragraph may be restating the same rule.
   - A figure is a quantity with a unit: a duration, a percentage or money. Years, section and step numbers and bare counts never count.
   - Qualifiers stay attached ("5 business days" is not "5 calendar days"), and so do money magnitudes ("$5 million" is not "$5").
   - "30-day", "30 days" and "1-business-day" read like their spaced twins, and "$2,000" survives normalization.
4. **Hint-cap order.** Explicit contrasts and documents the question itself names are protected. Restating twins fill the remaining slots ahead of documents named only by the draft or the cited text, which is the noisiest signal (a cited chunk often lists every related policy).
5. **Reason-specific hint wording** in the coverage prompt. A restating twin is a candidate: the model includes its sentence only if it states the same rule for the same topic the question asks about, and is told the match can be coincidence. A contrasted program is included when the question's wording could mean either, so the answer shows each program with its own numbers. Named documents keep the old wording.
6. **Coverage dedup by citation identity.** A coverage quote counts as a duplicate only when a draft paragraph already carries both its text and its label. The same sentence under a new label is kept as an addition, so an owner policy that states exactly what the cited process document states can still be cited.

No question ids, document ids or corpus words in runtime code. The host still keeps additions only when the combined answer re-validates against the evidence ledger.

## Is q088's gold label right?

Arguably not, and the fix doesn't pretend otherwise. The question asks how "an employee referral payout" works. The recruiting policy's section is literally titled "Employee Referral Bonus" ($1,000 per hire). The commission plan calls the sales program "employee referral bonuses ($2,000 per customer)". The sales referral program also excludes sales roles, so the rep in the question can only ever earn the hiring bonus. The sales context ("explain to a rep", "a new deal") leans toward the gold, but the model's reading isn't wrong. It's ambiguous.

The fix answers the ambiguity rather than picking a side: all three v13 q088 answers cite both programs ($2,000 per customer under the referral program, $1,000 per hire under the recruiting policy) plus the 8% commission. They pass because the multi-hop scorer accepts extra citations. A reader of the 120 battery should know the pass comes from showing both, not from the model learning the gold.

## Tuning set v2

`content/northwind/tuning-questions.json` has 16 questions: 12 new and 4 carried over from v1 (tu02, tu03, tu09 and tu10). The locked `questions.json` was not touched.

**Overlap with the locked set.** A test (`src/lib/eval/live-northwind-eval.test.ts`) fails if any tuning question shares a gold document and an expected section with a locked question, or reuses a locked id. It checks document plus section only. By hand:
- tu02 and tu03 ask the same fact (refund processing time) in two phrasings.
- tu05's gold section also states the 30-day deletion that locked q090 asks about through the DSAR process. That's a partial-fact overlap the test can't see.

**What the questions cover:**
- **Twins (tu01 to tu08):** a process, handbook or neighbor document restates a figure and points at the policy that owns it.
  - ticket reopening, restated by the agent scorecard
  - refund processing time, restated by the complaint path
  - recovery targets, restated by the DR runbook
  - post-contract data retention, restated by the privacy policy
  - sabbatical terms, restated by the handbook
  - corporate card approval thresholds, which the card policy calls "the same thresholds" as employee expenses
  - holiday coverage, which the on-call rotation points to
- **Similar programs (tu09 to tu16):**
  - complaint ESC levels versus incident SEV levels (three questions)
  - a PIP versus the onboarding extension plan
  - contractor versus employee expense receipts
  - prospect data versus log access
  - employee customer referrals versus reseller partners
  - parental versus sick leave
- **Abstention guard (3),** `tuning-abstention-questions.json`: questions next to similar evidence with no answer (a partner referring a job candidate, a Tokyo per-diem, a parking subsidy amount). A working repair or coverage pass that quotes too eagerly would turn these refusals into unsupported answers.

**How before and after ran.**
- "Before" ran on a detached worktree of `origin/main` (`adbd1ee`, prompt v10, includes PR #67) on port 8793, with its own persist dir and seeded generation `g-fa04ae7d`.
- "After" ran on this branch at `f0cad65` (prompt v13) on port 8791, generation `g-2055a92b`, from a clean checkout (`harnessDirty: false`).
- Each output records the Brain's pipeline version and the harness commit. The "before" runs record `harnessDirty: true`, because the runner script was edited, uncommitted, while they ran.

| Tuning v2, per 16-question run | Before r1 / r2 / r3 (main) | After r1 / r2 / r3 (v13) |
| --- | --- | --- |
| Passed | 16 / 15 / 15 | 15 / 16 / 16 |
| Misses | tu07, tu07 | tu07 |
| Gold retrieved but uncited | 0 / 1 / 1 | 1 / 0 / 0 |
| Cited a non-gold document too | 2 / 4 / 3 | 3 / 4 / 3 |
| Latency p50 | 52.1s / 42.2s / 49.8s | 31.0s / 25.6s / 21.5s |
| Latency p95 | 75.6s / 81.5s / 85.7s | 61.2s / 55.9s / 81.8s |

The only question that moved is tu07 (corporate card approval, a two-figure twin): 1/3 before, 2/3 after. That's one question at n=3, not a measured improvement. The latency drop is the clearest side effect and has the same root cause: a max-effort coverage call that burns 1,024 tokens costs about 20 seconds.

## History: interim builds and tuning set v1

Reported for the record, not pooled with the final numbers.

- **Decoding fix only** (v11 decoding, v10 hints): q028 1/3, q088 2/3 (`q028-q088-after-decoding-only.json`).
- **v11** (decoding fix plus a first restated-figure rule that counted bare numbers and let restating twins outrank every other hint). Two 3-repeat batches of the same build: q028 2/3 then 3/3, q088 3/3 then 2/3. The q088 miss in the second batch is discussed below.
- **v12** (round-one review fixes): q028 3/3, q088 3/3, tuning v2 47/48 (tu07 missed once), abstention 6/6. These are the `*-after-v12*` files.
- **Tuning set v1** (`superseded-tuning-questions-v1.json`, runs named `superseded-v1-*`): 46/48 before (v10) and 48/48 after (v11).
  - Review found it overlapped the locked set: 12 of its 16 questions shared a gold document and expected section with a locked question.
  - Five of them asked locked facts outright: tq02 and tq13 repeat q026, tq10 repeats q028, tq16 is q088's template, and tq14 used q028's vocabulary.
  - v1 was also extended in place. Its first 11 questions all passed one baseline repeat (`superseded-v1-tuning11-before-r1-*`). A second repeat was aborted after 2 turns (`superseded-v1-tuning11-before-r2-aborted.log`). 5 questions were then added before the 3-repeat baseline.
  - v2 replaces it.

## Honest caveats

- **The v11 q088 miss was inferred to be a provider failure, not an answer-path failure.** The evidence is `q088-v11-miss-worker-log-excerpt.log`:
  - The turn's instrumentation line shows no search and an empty draft.
  - The excerpt holds 57 remote Workers AI "internal error" lines. 9 of them precede the previous q028 turn's `POST /turns 200` line. 48 fall inside q088's own turn.
  - The 60-second `insufficient_evidence` outcome comes from the scored result row (`q028-q088-after-v11.json`), not from the log.
  - The log doesn't name which call failed, so "the main chat call failed" is an inference.
  - It was scored as a fail. Under `main`'s PR #67, a failure like that now ends as a 503 and the harness retries, then stops, instead of scoring it.
- **Each 60-turn v12 and v13 run hit one 503.** The Brain returned `503 UNAVAILABLE` after about 70 seconds once in the v12 run and once in the v13 run (`worker-503-excerpts.log`). The harness retried each as a fresh request (PR #67 behavior) and scored the retry, so no scored v12 or v13 row is a failure, but one turn per run needed a retry. Both worker logs also contain remote "internal error" lines that the bindings retried (1,122 and 291 lines).
- **This campaign's brownout rule.** A turn over 300 seconds is treated as a local `wrangler dev` brownout and discarded, never scored. The redesign report excluded turns of 400 to 1,017 seconds on the same grounds. In practice:
  - One v10 tuning repeat stalled on a coverage call that hung for more than 10 minutes. The whole repeat was discarded (`superseded-v1-tuning-questions-before-r3-aborted-brownout.log`), the worker restarted and the repeat re-run.
  - No scored turn in the v12 or v13 measurements came near 300 seconds.
- **Citations barely broadened.** v13 answers cite a non-gold document about as often as `main`: 10 versus 9 across three tuning runs. v11 had broadened more: 21 versus 11 on tuning v1. The softer restates wording and the demotion of text-only named hints account for the difference. Nothing unsupported was added and the abstention guard held. The full battery's `citedNotExpectedCount` is the number to watch.
- **Wider blast radius than the two questions.** The decoding fix also revives citation repair, identifier recovery and the abstention recheck, which were starved the same way. That should help factual refusals and could in principle hurt unanswerable cases. The 3-question abstention guard is small. The full battery's 10/10 unanswerable and 70/70 factual are the broader check, from one run.
- **q028 still needs two figures in the draft** for the restated-figure hint. A draft that quotes only "30 days" gives it nothing to match, by design.
- **Small samples.** 3 turns per locked question on the final build, 48 tuning turns per side. Two local workers, two seeded generations of the same corpus.
- **Turn budget.** About 320 live turns across three rounds (152, 108 and 60), plus Northwind seeds on two fresh workers (one seed request was sent twice after a client-side timeout). That's over the ~250 guideline, because the review rounds asked for re-measurement. Workers AI on credits, well inside the $75/month inference safety boundary. Gross spend wasn't metered per run.

## Raw files

`results/2026-10-08-quality/`:

- **Final:** `tuning-questions-before-main-r*`, `tuning-questions-after-v13-r*`, `tuning-abstention-questions-after-v13-r*`, `q028-q088-after-v13.json`
- **Before on this worker:** `q028-q088-before-q-diag*.json`, `tuning-abstention-questions-before-v10-r*`
- **Interim builds:**
  - v11: `q028-q088-after-decoding-only.json`, `q028-q088-after-v11-probe.json`, `q028-q088-after-v11.json`, `tuning-abstention-questions-after-v11-r*`, `q088-v11-miss-worker-log-excerpt.log`
  - v12: `*-after-v12*`
- **Superseded tuning v1:** `superseded-tuning-questions-v1.json`, `superseded-v1-*`
- **Instrumentation:** `instrumentation-v10.log`, `instrumentation-v11.log`, plus `coverage-call-stats.py` and `coverage-call-stats.txt`, which produce the first table
- **Full battery (v13):** `full-battery-v13-findings.json`, `full-battery-v13-live-summary.json`, `full-battery-v13-live-checkpoint.json`, `full-battery-v13-retrieval-report.json`
- **Worker health:** `worker-v12-8791.log`, `worker-v13-8791.log`, `worker-log-counts.py`, `worker-log-counts.txt`, `worker-503-excerpts.log`. After capture, one home-directory path in `worker-v12-8791.log` (a wrangler log location) was replaced with `~` (commit `d52b372`). Nothing else in the logs was edited.
- **Runner:** `tuning-run.sh <label> <repeats> <file stem> [port]`

## Reproduce

```bash
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8791 --persist-to <dir>
npx jiti evals/results/2026-10-08-redesign/scripts/seed-only.ts http://127.0.0.1:8791
npm run eval:northwind -- --live http://127.0.0.1:8791 --questions content/northwind/tuning-questions.json
npx jiti evals/results/2026-10-08-redesign/scripts/ab-repeat.ts http://127.0.0.1:8791 3 out.json label q028 q088
python3 evals/results/2026-10-08-quality/worker-log-counts.py <worker.log>
```

For the "before" side, run the same worker command from a detached worktree of the base commit on another port, and point the same harness at it. Add `--inspector-port` when two workers start together. `--questions` writes to `eval-output/tuning/<file>/`, never to the locked run's files. It refuses `questions.json` under any spelling, and it fails closed on a file with no questions.
