# From 72% to 95%: repairing a grounded RAG agent without touching the scorer

Date: 2026-08-31. Repo: Useful Brain. Eval: 120-question Northwind live battery.

## TL;DR

Useful Brain answers company questions with verbatim, cited evidence and refuses when the evidence isn't there. Its live eval moved from 77/107 (72%, with 13 permission questions skipped) to 114/120 (95.0%) across two repair passes. Multi-hop questions went from 0/10 to 9/10. Every gain came from the answer layer: the retrieval metrics and every scoring rule stayed locked the whole time. The most important single fix was discovering that our repair model calls were silently starving a reasoning model of output tokens.

| Category | Pass 1 (2026-08-31 morning) | Pass 2 (final) |
| --- | --- | --- |
| Factual | 59/70 | 66/70 |
| Trap | 17/17 | 17/17 |
| Permission | 10/13 | 12/13 |
| Unanswerable | 9/10 | 10/10 |
| Multi-hop (locked + expanded) | 0/10 | 9/10 |
| **Total** | **95/120 (79.2%)** | **114/120 (95.0%)** |

The pre-repair baseline (2026-08-30) scored 77 of 107 (72%) with all 13 permission questions skipped because the live path could not represent each question's principal.

Constant throughout: retrieval layer recall@3 0.912, MRR 0.825, nDCG 0.837, zero ACL leaks, zero forbidden-document retrievals live. Frozen evidence: [`results/2026-08-31/findings.glm-5.3-flash.json`](../results/2026-08-31/findings.glm-5.3-flash.json), pre-repair baseline in [`findings.pre-fix.json`](../results/2026-08-31/findings.pre-fix.json).

## The setup

The corpus is 65 synthetic company documents with document-level ACLs (public, department, role, private-owner). The battery is 120 locked questions: 70 factual, 17 traps (a plausible wrong document sits nearby), 13 permission cases (the answer lives in a document the asking principal cannot read), 10 unanswerable, and 10 multi-hop questions whose answer requires citing two documents.

The scoring rules are deliberately harsh and were never loosened:

- A multi-hop answer must cite every gold document. One of two is a fail.
- Permission and unanswerable questions must return `insufficient_evidence`. A fluent answer from a related-but-wrong document is a fail.
- Retrieving any forbidden document is a fail regardless of the answer.
- Every question runs under its own principal, and the harness fails closed if the backend doesn't confirm the identity or the answering model.

The answering stack: hybrid retrieval (keyword + vector + reranker) feeding a tool-calling agent on Workers AI, with a host-side grounding validator that only accepts answers whose every sentence is a verbatim span of retrieved evidence, cited with current-turn labels.

## Pass 1: score honestly first

The original 72% hid two measurement problems. Permission questions were skipped on the live path because the local operator identity couldn't represent the asking principal, and several factual failures were really identity failures: role-scoped gold documents never entered retrieval for the loopback operator.

Pass 1 fixed the measurement before the model: a loopback-only assumed-principal field scoped retrieval to each question's principal (never storage or tool policy, rejected outside loopback), deterministic citation completion attached labels the model earned but didn't write, and refusal handling stopped routing genuine abstentions through citation repair. Score: 95/120 with all 120 finally scored. But multi-hop collapsed to 0/10 and four failure families remained.

## Pass 2: four failure families, four root causes

**A. Multi-hop 0/10, second document retrieved but never cited.** The model retrieved both documents 98% of the time, then wrote about one. The real root cause was invisible until we logged the raw model responses: our citation-repair and coverage calls capped completion at 512 tokens, and GLM 5.3 Flash is a reasoning model. It spent the entire budget thinking, hit `finish_reason: length`, and returned empty content. Every "repair" was silently a no-op falling back to a crude lexical extractor. Fixes: disable thinking on extraction calls (they select quotes, they don't need chain-of-thought), recover the JSON object from narrated responses with balanced-brace parsing that prefers the last emitted object over mid-reasoning examples, and add a coverage pass that asks, for multi-part questions only, for the exact evidence sentence answering each still-open part. Coverage additions must re-validate against the evidence ledger before they're kept.

**B. Twin-document misattribution.** Six factual questions failed because the model quoted the lookalike sentence from a neighboring document (handbook vs the dedicated policy). Fixes: each search hit now leads with its document identity before the text, and the prompt prefers the dedicated policy document for the asked topic or cites both.

**C. Grounded answers from allowed neighbors on permission questions.** The forbidden document was correctly never retrieved, but the model answered anyway from a related allowed document. Fix was discipline, not machinery: the prompt now states that a sentence about a different program, plan or policy than the one asked is not an answer.

**D. Run-to-run churn.** Questions flipped between runs. Fixes: temperature 0 and a pinned seed on every call, and a verbatim-salvage pass that deterministically rebuilds an invalid draft from its exact evidence spans, because the model kept wrapping correct quotes in `**Label:** "quote" - from file.md` decoration that failed strict validation.

## The adversarial review earned its keep

Before committing, three parallel reviewers (security, grounding logic, eval honesty) attacked the diff. The security reviewer found a real high-severity bug: the new salvage pass ran ahead of the refusal-honoring guard, so a short refusal that happened to quote an evidence sentence could be converted into a confident grounded answer to an unanswerable question. An interim run had scored 115/120 with that bug in place. We fixed it, hardened salvage three more ways (body-text-only grounding, longest-span preference, bounded colon prefixes), tightened the multi-part trigger so narrative "and" in trap questions can't fire it, and re-ran everything. The recorded 114/120 is the honest post-fix number, one point lower than the flattering one.

The eval harness also got integrity upgrades from the review: checkpoints now pin the exact answer-pipeline build and a digest of the question set, resumes fail closed on any mismatch, latency summaries carry a partial flag, and the report shows a cited-but-not-expected counter so citation broadening can't hide.

## Honest caveats

- Three to five questions still churn between runs. Temperature 0 doesn't pin a reasoning model's thinking on this stack, so treat single-question flips as noise and category totals as signal.
- Complete-answer latency (p50 ~15 to 20s, p95 ~56s) exceeds the 15s p95 production target. That's the model's reasoning phase, and it's recorded as an open item, not accepted.
- The four remaining failures (q073, q088, q100, q105/q110 style identifier lookups) fail across every model we later tested, which points at corpus and retrieval difficulty rather than the answer layer.

## Reproduce

```bash
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8789 --persist-to .wrangler/state-eval
npm run eval:northwind -- --live http://127.0.0.1:8789
```
