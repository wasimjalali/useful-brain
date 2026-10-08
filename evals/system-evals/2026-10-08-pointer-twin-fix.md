# The coverage pass was silent: fixing q028 and q088 by making it run

Date: 2026-10-08. Repo: Useful Brain. Model: GLM 5.3 Flash (`@cf/zai-org/glm-5.3-flash`). Prompt `grounded-answer.v10` before, `grounded-answer.v11` after. Retrieval unchanged.

## TL;DR

Two Northwind questions kept failing after retrieval had already found the right documents: q028 (a process document cited instead of the policy that owns its rule) and q088 (a hiring referral bonus cited instead of the sales referral program). The 2026-09-06 pointer mechanism was meant to catch exactly these. It almost never got the chance.

**Root cause:** the coverage pass (and the other quote-extraction calls) asked GLM 5.3 Flash to turn thinking off with `chat_template_kwargs.enable_thinking: false`. The [model's Workers AI schema](https://developers.cloudflare.com/workers-ai/models/glm-5.3-flash/) says "Reasoning cannot be disabled" and defaults to max effort. With a 1,024-token completion cap, the reasoning used the whole budget and the call returned `finish_reason: "length"` with empty content. The pass then returned nothing, silently.

| Coverage calls, live worker | Calls | Empty content | Hit the 1,024 cap | Median completion tokens |
| --- | --- | --- | --- | --- |
| Before (v10) | 67 | 45 (67%) | 39 of 60 logged | 1,024 |
| After (v11) | 63 | 0 | 0 | 91 (max 401) |

Two changes, both corpus-agnostic: extraction calls on models that can't disable reasoning now ask for `reasoning_effort: "low"` with a 4,096-token cap, and pointer detection gained a third signal, an uncited chunk that states every figure of a cited draft paragraph (a restated rule).

| Question | Before (v10, this worker) | Decoding fix only | After (v11) |
| --- | --- | --- | --- |
| q028 twin document | 0/4 | 1/3 | **5/6** |
| q088 similar program | 1/4 | 2/3 | **5/6** (the miss was a provider failure, below) |
| Tuning set, 16 new questions x3 | 46/48 | not run | **48/48** |
| Abstention guard, 3 new questions x2 | 6/6 | not run | 6/6 |

Earlier today q028 passed 1/3 and 2/3 in two A/B variants and q088 passed 0 of 8 across every variant ([redesign report](2026-10-08-redesign-verification.md)).

## How it was found

1. Read `pointer-completion.ts` and its call sites. Detection looked right for both questions: q088's draft hinted the sales referral program by title, so the coverage pass should have run with that hint.
2. Added temporary logging (removed before commit) of the search queries, raw draft, hints and the coverage call's raw provider response on an isolated worker (port 8791, own persist dir, generation `g-2055a92b`).
3. First live turns: the coverage call returned `""` on 5 of 6. Logging the response tail showed `finish_reason: "length"`, `completion_tokens: 1024` and a long `reasoning_content` in which the model was mid-way through the right judgment ("the question says employee referral payout, could be either program...") when the budget ran out.
4. Checked the official model page: `reasoning_effort` accepts `low`, `high`, `max`, default `max`, and "Reasoning cannot be disabled". The toggle in `extractionDecoding` was a no-op for this model.

So the pointer mechanism wasn't wrong. It was starved. That also explains why it "fixed q088 once" on 2026-09-06 and didn't hold: it only worked on the draws where max-effort reasoning happened to finish under 1,024 tokens.

## What changed

1. **Extraction decoding** (`src/lib/models/workers-ai-citation-repair.ts`, `eval-override.ts`). A new `MODELS_WITH_MANDATORY_REASONING` set (GLM 5.3 and GLM 5.3 Flash, both documented as unable to disable reasoning) gets `reasoning_effort: "low"` and `max_completion_tokens: 4096`, and no ignored toggle. Models with a working toggle keep `enable_thinking: false` and 1,024. This covers every quote-extraction call: coverage, citation repair, identifier recovery and the abstention recheck.
2. **Restated-figure detection** (`src/lib/agent/pointer-completion.ts`). With the coverage pass alive, q028 still failed when the hint list didn't contain the privacy policy: no title was named in the cited chunk, and three named neighbors filled the hint cap. The new signal: an uncited chunk that contains every figure (at least two) of one cited draft paragraph is restating the same rule. "30-day" and "30 days" match, "$2,000" survives normalization, citation labels are never figures. One shared figure is not enough, since "30 days" appears all over a policy corpus. Hints are now ranked restates, then contrast, then named, so the cap can't evict a twin.
3. **Reason-specific hint wording** in the coverage prompt (bumped to `grounded-answer.v11`). A restating twin is asked for so both sources get cited. A contrasted program is asked for when the question's wording could mean either, so the answer shows each program with its own numbers. Named documents keep the old wording.

No question ids, document ids or corpus words in runtime code. The host still keeps additions only when the combined answer re-validates against the evidence ledger.

## Is q088's gold label right?

Arguably not, and the fix doesn't pretend otherwise. The question asks how "an employee referral payout" works. The recruiting policy's section is literally titled "Employee Referral Bonus" ($1,000 per hire). The commission plan calls the sales program "employee referral bonuses ($2,000 per customer)". The sales referral program also excludes sales roles, so the rep in the question can only ever earn the hiring bonus. The sales context ("explain to a rep", "a new deal") leans toward the gold, but the model's reading isn't wrong. It's ambiguous.

The fix answers the ambiguity rather than picking a side: the passing q088 answers now give both programs, $2,000 per customer under the referral program and $1,000 per hire under the recruiting policy, each with its own citation, plus the 8% commission. They pass because the multi-hop scorer accepts extra citations. A reader of the 120 battery should know the pass comes from showing both, not from the model "learning" the gold.

## Tuning set

`content/northwind/tuning-questions.json`, 16 new questions over other document pairs. The locked `questions.json` was not touched.

- **Twins (7):** a process or neighbor document restates a number and names the policy that owns it. SLA targets restated by Channel and Hours and the agent scorecard, the vendor legal-review threshold restated by the procurement policy, refund processing time restated by the complaint path. tq12 to tq14 phrase the question in the restating document's own words, as q028 does.
- **Similar programs (9):** complaint escalation (ESC) versus incident escalation (SEV), partner commission versus the employee referral program and the rep commission plan, data retention versus system log retention, the 90-day onboarding checkpoint versus the annual review cycle, a data request versus a P2 ticket.
- **Abstention guard (3),** `tuning-abstention-questions.json`: questions next to similar evidence with no answer (a partner referring a job candidate, a Tokyo per-diem, a parking subsidy amount). A working repair or coverage pass that quotes too eagerly would turn these refusals into unsupported answers.

The first 11 questions all passed on the first baseline repeat, so 5 harder ones (tq12 to tq16) were added before the 3-repeat baseline. That first repeat is kept as `tuning11-before-r1-*`.

| Tuning metric, per 16-question run | Before r1 / r2 / r3 | After r1 / r2 / r3 |
| --- | --- | --- |
| Passed | 15 / 15 / 16 | 16 / 16 / 16 |
| Misses | tq11, tq07 | none |
| Gold retrieved but uncited | 2 / 1 / 1 | 0 / 0 / 0 |
| Cited a non-gold document too | 4 / 4 / 3 | 8 / 7 / 6 |
| Latency p50 | 45.1s / 42.1s / 44.1s | 21.7s / 25.6s / 25.2s |
| Latency p95 | 65.5s / 80.5s / 66.4s | 37.9s / 38.9s / 58.0s |
| Live retrieved recall | 1.0 | 1.0 |

The tuning set mostly showed that the model already handles these shapes on other pairs. It's a regression guard more than a lever. The latency drop is real and comes from the same root cause: a max-effort coverage call that burns 1,024 tokens costs about 20 seconds.

## Honest caveats

- **Citations broadened.** Answers now cite a non-gold document more often (3.7 to 7 per 16 questions on the tuning set). That's the coverage pass doing what it was always meant to do, including the older "named" hints, which can add a correct but off-topic neighbor (q028 sometimes also cites the data retention deletion sentence). Nothing unsupported was added and the abstention guard held, but answers are slightly longer. The full battery's `citedNotExpectedCount` is the number to watch.
- **Wider blast radius than the two questions.** The decoding fix also revives citation repair, identifier recovery and the abstention recheck, which were starved the same way. That should help factual refusals and could in principle hurt unanswerable cases. The 3-question abstention guard is small. The full 120 battery is the real check.
- **q088's one miss after the change** was not an answer-path failure: the main chat call failed with remote Workers AI "internal error"s, no search ran, and the turn came back as `insufficient_evidence` after 60s. It's scored as a fail (under the 300s brownout rule). It also shows the open gap from the redesign report: a backend failure surfaces as insufficient evidence.
- **q028 still misses when the draft has only one figure.** In the one v11 miss, the draft quoted only "30 days", so the two-figure rule had nothing to match. That's deliberate: one shared number is too weak a signal.
- **Small samples.** 6 turns per locked question after the change, 48 tuning turns. One local worker, one seeded generation.
- **Silent truncation still possible.** A `finish_reason: "length"` with empty content is still returned as "no additions" without a log line. Surfacing it is a separate change.

## What ran

- Worker: `wrangler dev --config workers/brain/wrangler.jsonc --port 8791 --persist-to <scratch>/state-quality`, migrations applied, Northwind seeded and promoted (`g-2055a92b`), hybrid retrieval, zero vector-degraded turns.
- Decoding unchanged for the main chat loop (`temperature: 0`, `seed: 7`).
- One baseline repeat stalled on a local brownout (a coverage call hung for more than 10 minutes). It was discarded (`tuning-questions-before-r3-aborted-brownout.log`), the worker restarted, and the repeat re-run as `before-rerun-r1`.
- About 152 live turns in total, plus one Northwind seed. Workers AI on credits, well inside the $75/month inference safety boundary. Gross spend wasn't metered per run.

## Raw files

`results/2026-10-08-quality/`:

- `q028-q088-before-q-diag*.json` (v10), `q028-q088-after-decoding-only.json`, `q028-q088-after-v11-probe.json`, `q028-q088-after-v11.json`
- `tuning-questions-{before,before-rerun,after}-r*-{findings,live-summary}.json`, `tuning-abstention-questions-{before,after}-r*-*.json`, `tuning11-before-r1-*`
- `instrumentation-v10.log`, `instrumentation-v11.log`: the temporary drafts, hints and coverage responses; `coverage-call-stats.py` and `coverage-call-stats.txt` produce the first table

## Reproduce

```bash
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8791 --persist-to <dir>
npx jiti evals/results/2026-10-08-redesign/scripts/seed-only.ts http://127.0.0.1:8791
npm run eval:northwind -- --live http://127.0.0.1:8791 --questions content/northwind/tuning-questions.json
npx jiti evals/results/2026-10-08-redesign/scripts/ab-repeat.ts http://127.0.0.1:8791 3 out.json label q028 q088
```

`--questions` writes to `eval-output/tuning/<file>/`, never to the locked run's files, and refuses `questions.json` itself. `results/2026-10-08-quality/tuning-run.sh` wraps the repeats.
