# Pointer-triggered coverage: 116 to 118 without fitting the corpus

Date: 2026-09-06. Repo: Useful Brain. Eval: 120-question Northwind live battery, GLM 5.3 Flash.

## TL;DR

A fresh full run first scored 116/120, with all four misses sharing one shape: retrieval delivered the gold documents, but the answer cited a neighboring twin instead. The first fix attempt (host-side sentence grafting) worked and was then thrown away: it pinned sentences by word overlap, which fits this corpus's phrasing and would not survive a new one. The kept design detects pointer cases deterministically and lets the model do the wording. Result: **118/120 (98.3%)**, the strongest general-system score on this battery. Frozen evidence: [`results/2026-09-06/findings.glm-5.3-flash.json`](../results/2026-09-06/findings.glm-5.3-flash.json).

| Category | Before (2026-09-06 morning) | After |
| --- | --- | --- |
| Factual | 69/70 | 69/70 |
| Trap | 17/17 | 17/17 |
| Permission | 13/13 | 13/13 |
| Unanswerable | 9/10 | 10/10 |
| Multi-hop (locked + expanded) | 8/10 | 9/10 |
| **Total** | **116/120 (96.7%)** | **118/120 (98.3%)** |

## What changed and why

Three small, corpus-agnostic changes (prompt version `grounded-answer.v9`):

1. **Pointer detection** (`src/lib/agent/pointer-completion.ts`). The corpus names owning policies from neighbors ("request earlier deletion through the Customer Data Access Requests process", "the hiring bonus is a different program"). The host now detects uncited documents named by title in the question, draft or cited evidence, plus documents that explicitly contrast themselves with a cited one. No question or document IDs, no corpus words in the code. Detection only: it selects no sentences.
2. **Coverage pass extended.** The model second look previously ran for multi-part questions only. It now also runs on single-part drafts with pointer hints, with a strengthened disambiguation instruction. One extra model call, only when the evidence itself points elsewhere. The host keeps additions only when they re-validate against the ledger.
3. **Two prompt rules.** The chat prompt now states that programs the evidence calls different must be answered each from its own document. A hint-threshold bug was fixed along the way: single-word titles (`privacy-policy.md`) could never trigger coverage hints under the old match rule.

Deliberately not done: deterministic sentence grafting. It reached 4/4 on the failing questions in a smoke replay and was removed because word-overlap picking is phrasing-fitted. Strength over score.

## Honest caveats

- The two residual misses (q093, identifier lookup refused with evidence retrieved; q120, expanded multi-hop missing the SLA-credit citation) both pass on replay. They are run-to-run reasoning-model variance, confirmed by re-asking, not systematic gaps. Expect the band 116 to 120 across runs, not a pinned number.
- Retrieval stayed locked throughout: recall@3 0.912, MRR 0.825, zero ACL leaks; live retrieved recall 0.995, zero forbidden-document retrievals.
- Latency p50 22.9s, p95 58.9s, comparable to the August baseline.

## Reproduce

```bash
npx wrangler dev --config workers/brain/wrangler.jsonc --port 8789 --persist-to .wrangler/state-eval
npm run eval:northwind -- --live http://127.0.0.1:8789
```

Results land in `eval-output/findings.json` (gitignored); the frozen copy is `results/2026-09-06/findings.glm-5.3-flash.json`.
