# Bugs

No P0 that makes the workspace lie about money or identity. The Evaluations mismatch is a product defect with a confirmed cause.

| ID | Pri | Repro | Cause | Evidence |
|---|---|---|---|---|
| B1 | P1 | Open `/evaluations`. Headline is 9/10, 30 Aug 2026. | `EvaluationsWorkspace` renders `MANUAL_EVAL_SET` (10 cases) and `runEvalsAction` → `src/lib/brain/eval-run.ts`. Frozen 120-question findings in `evals/results/2026-08-31/` are never loaded. | `03-evaluations-scroll-01.png`; `src/components/evaluations/evaluations-workspace.tsx`; `src/lib/eval/manual-eval-set.ts` |
| B2 | P2 | Click Run evaluations. | The UI can start a live 10-case loop against the current corpus. It cannot run or display the locked 120-question campaign. | Same files; `src/app/eval-actions.ts` |

Nothing else on the four captured screens failed to render. Console noise on Evaluations was not reproduced as a user-visible break.
