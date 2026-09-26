```json
[
  {
    "finding": "A length stop with non-empty content has no truncation handling. run.ts never inspects stopReason 'length'; it grounds the raw text and can return it as finalResponse. Because claim support is substring matching (contract.ts:200-209), a final sentence cut mid-way that is a prefix of a cited evidence sentence passes markersValidForLedger, and salvageVerbatimQuotes can keep that fragment as its own labeled paragraph. A previously complete long answer can therefore be stored visibly truncated, with no flag in KnowledgeRunResult (no stopReason, no truncated field) and no run-level test. This is acceptance, not bounded failure. The master plan defines no truncation policy, and the perf audit required eval checks for exactly this risk (evals/results/2026-09-26-perf-audit/deepseek.md:17); this checkout has no generation-cap eval record.",
    "severity": "high",
    "line": "src/lib/models/workers-ai-chat.ts:107"
  },
  {
    "finding": "The per-call cap equals the entire run output budget (workers-ai-chat.ts:30 and budgets.ts:6 are both 4000) while assertTokenTotals is enforced cumulatively over all assistant messages (budgets.ts:67-76, called at run.ts:406-407 and run.ts:470-478). A run that hits the cap on the answer call, plus any output from the search call, is over budget; run.ts:721 then forces BRAIN_KNOWLEDGE_UNAVAILABLE over the grounded draft, and execute-turn.ts:236 turns aborted into WorkerCancelledError, a 409 CANCELLED (worker-errors.ts:120-127). So the 'keeps a length finish with content on the normal completion path' behavior pinned at workers-ai-chat.test.ts:145-159 cannot complete in a normal two-call run whenever the provider reports usage for the tool-call turn. If the provider under-reports reasoning tokens, the same run lands in finding 1 instead. Either way the cap-hit case is not handled as intended.",
    "severity": "high",
    "line": "src/lib/agent/run.ts:721"
  },
  {
    "finding": "After a token-budget trip, repair and coverage calls still start. canRepair (run.ts:545-549) and canCover (run.ts:674-678) gate only on runtime, abort, wall time and evidence; they ignore budgetErrorMessage and token totals. When turns remain, the repair model call happens, its validated output is written to grounded, and run.ts:721 then discards it for BRAIN_KNOWLEDGE_UNAVAILABLE because budgetErrorMessage wins. That spends provider calls for nothing, and repair usage never reaches BudgetTracker, so the run-level output cap is bypassed without a trace.",
    "severity": "low",
    "line": "src/lib/agent/run.ts:545"
  },
  {
    "finding": "pi-agent-core does refuse truncated tool calls (dist/agent-loop.js:117-125: failToolCallsFromTruncatedMessage produces error results and the loop continues), so nothing executes and there is no crash. However nothing in this repo pins that refusal, and one run-level corner fails open: if the run ends on such a turn through the turn limit rather than the token limit, the last assistant text is empty, rawFinal becomes '', enforce() passes it through (host-grounding.ts:644-657), and run.ts:720-723 keeps '' because ?? does not replace an empty string, so the stored answer silently becomes insufficient_evidence instead of BRAIN_KNOWLEDGE_UNAVAILABLE.",
    "severity": "low",
    "line": "src/lib/agent/agent-loop.test.ts:655"
  },
  {
    "finding": "Coverage stops at runKnowledgeAgent and does not pin the user-visible outcome. On the persist path execute-turn ignores finalResponse when result.aborted and fails the turn 409 CANCELLED (execute-turn.ts:236-238), so the KU string never reaches a stored turn; on the ephemeral eval path prose-to-structured.ts:36-37 maps KU to insufficient_evidence, so cap failures score as ordinary refusals rather than errors. No workerd test exercises a terminal model error, the length+tool_calls path, or usage parsing against budget enforcement end to end.",
    "severity": "low",
    "line": "src/lib/brain/execute-turn.ts:236"
  }
]
```

DISMISSED:
```json
[
  "Truncated tool-call arguments fail closed: parseToolCall's JSON.parse throws on cut JSON, runChat's catch emits a stream error with stopReason 'error', pi sets errorMessage, and the run resolves to KU with aborted true. No crash.",
  "Length-stop tool calls bypass beforeToolCall, but no tool executes, so there is no policy, approval or mutating side-effect gap.",
  "No usage double counting: shouldStopAfterTurn calls assertTokenTotals, which overwrites tracker totals with the cumulative sum over newMessages; the run-end check recomputes from the priorMessageCount slice; each call's per-call usage is summed once.",
  "Missing usage keys return 0 and silently under-count the budget (fail-open). Accepted per the brief; no crash or negative accounting.",
  "Both reported usage shapes are handled (top-level and result.usage) and both are tested; total_tokens falls back to input+output.",
  "No caller depends on the old empty-draft result. Evals and eval-run call executeTurn with persistConversation false, where empty and KU both map to insufficient_evidence; approval resume never reads finalResponse; the live Northwind eval also posts persistConversation false and stays HTTP 200.",
  "The first chat call alone cannot trip the token budget: the comparison is strict >, so exactly 4000 passes. A provider report above the requested cap would stop the loop via shouldStopAfterTurn, which catches BudgetExceededError and returns true, so the path is bounded with no unhandled error.",
  "usage.cost stays 0; budgets read tokens only, so cost parsing cannot affect accounting.",
  "Extraction keeps its own 1024 cap and validatedRepairText ignores stopReason and returns null on empty text, so the empty-length error mapping does not change repair behavior.",
  "max_completion_tokens as a parameter name is not treated as new risk: extraction already sends it in production and the perf audit recommended it.",
  "A missing or non-'length' finish_reason defaults to 'stop' and could execute partially generated tool calls; provider-contract dependent and truncated JSON still fails closed, so not flagged.",
  "The 409 CANCELLED on the persisted path is this PR's intended fail-the-turn outcome for model errors; it is a fail-closed choice, not a caller break.",
  "Pre-PR tree was not compared (no git per brief); every conclusion is drawn from the current checkout only."
]
```
