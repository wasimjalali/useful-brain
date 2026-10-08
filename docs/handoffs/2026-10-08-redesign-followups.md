# Handoff: after the redesign (2026-10-08)

Start here in a new session. `main` is at the merge of PR #69. Nothing is in flight: no open PRs from this work, no worktrees, no running evals.

## What landed today

| PR | What |
| --- | --- |
| #59, #60, #62, #63, #64 | The redesign (handoff in `docs/design/handoff-2026-10-08/`), Phases 1 to 7, eval write-up `evals/system-evals/2026-10-08-redesign-verification.md` |
| #65 | Wasim accepted the redesign's 115/120 |
| #66 | D20: full Vectorize inventory in draft reconciliation, active only once the secrets below exist |
| #67 | Backend failures end as 503 "unavailable" (not a fake refusal), model calls stop at the 90 s budget, Retry stays in the same conversation, the harness refuses to score 503s |
| #68 | Coverage pass works on GLM (`reasoning_effort: "low"`; the model can't disable reasoning), restated-figure twin hints, prompt `grounded-answer.v13`. Full battery **117/120, 0 ACL leaks**. Write-up `evals/system-evals/2026-10-08-pointer-twin-fix.md` |
| #69 | Detail layouts Wasim picked from two mockup rounds (evidence 1B, Settings 2A/3A, audit A to E), search groups identical chats, Evals and Overview show the 117/120 run |

## Waiting on Wasim

1. **D20 secrets** (he'll do them himself; never handle the values): Vectorize Read token, two `wrangler secret put` commands in `docs/runbooks/operations.md`, corpus migration 0006 on staging, then one staging draft to confirm `inventory_checked = 1`.
2. **Model ids:** built as "full id in Settings → Model and retrieval only, readable name plus tooltip elsewhere". He may decide otherwise; the change is small (`modelDisplayName` in `src/lib/labels.ts` and the components that use it).
3. **Phase 7B** (production with real company data) needs his explicit go. Don't start it.
4. **Google Drive connector:** his decision, see below. Don't build it without a yes.

## Google Drive: what exists and what it would take

- **The mockup** (`docs/design/handoff-2026-10-08/Settings.dc.html`) showed a Google Drive connector in Settings → Connectors.
- **The handoff spec replaced it with GitHub on purpose** (`README.md` line ~240, "Audit correction": Drive isn't in the source kinds `upload | github | http`).
- **The master plan** (§6 Ingestion) schedules Google Drive, SharePoint, Notion and Slack "after their auth and rate-limit contracts are designed". §8 calls per-user OAuth connectors a later security milestone (envelope-encrypted tokens, rotation, revocation, least-privilege scopes).
- **Backend:** nothing for Drive. `src/lib/connectors/registry.ts` kinds are `http | github | mcp | action_sink | plugin`.
- **GitHub is half-built:** `src/lib/connectors/github-tree.ts` (tree listing, truncation refusal, stale-delete rules) exists with tests, but nothing wires it to the UI or the ingestion workflow. The Settings "Connect" button is a disabled placeholder.
- **A "mounted" Drive (Drive for desktop) can't work here:** Workers have no filesystem. It has to be the Drive API.

Recommendation (for Wasim to decide):
1. Not needed for the portfolio demo now. Uploads cover ingestion, and a dead button is worse than none.
2. If a connector is wanted, wire GitHub end to end first (the logic exists): Connect, path prefix, sync into a draft, the normal draft checks, promote.
3. Then Drive the simple way: one org-level service account with `drive.readonly`, syncing a shared folder into a draft like GitHub. The key is a Worker secret. Per-user OAuth only if multiple people need their own Drives, and that's the heavier security milestone.
4. Drive needs a Google Cloud project and a service account created by Wasim (an account action). The Drive API is free at this volume.
5. Until then, consider hiding the disabled GitHub "Connect" button so nothing in Settings looks broken.

## How things run locally

- **App:** `npm run preview:cf` serves on 127.0.0.1:8787 as the loopback admin. Demo people (for example `maya.chen@northwind.example`) sign in with the `DEMO_PASSWORD` that `npm run seed:demo` used. The throwaway password file from this session was in its scratchpad and is gone; reseed with a new one.
- **Second preview** on another port: `npm run preview:cf -- --port 8788 --inspector-port 9331` (its own `.wrangler/state` per worktree).
- **Eval worker:** fresh state per run: apply both migrations with `--persist-to <dir>`, `wrangler dev --config workers/brain/wrangler.jsonc --port <p> --persist-to <dir>`, seed (`evals/results/2026-10-08-redesign/scripts/seed-only.ts`), then `npm run eval:northwind -- --live http://127.0.0.1:<p>`. `--questions content/northwind/tuning-questions.json` runs the tuning set, never the locked 120.
- **Screenshots** from today are in `verify/detail-layouts/` and `verify/ui-audit/` (local, gitignored).

## Gotchas learned today

- Long local runs degrade: remote Workers AI/Vectorize bindings stall under sustained load. Since #67 that surfaces as 503s, and the harness retries them and then stops loudly. Restart the worker and use `--resume`.
- Editing source while `wrangler dev` runs hot-reloads it and kills in-flight turns. Don't edit the worktree an eval is running from.
- A one-document draft always fails the draft checks' quality floor. Test uploads on top of the full Northwind corpus.
- Turbopack rejects a symlinked `node_modules`, so run `npm ci` in each worktree before a preview build.
- `main` needs one approving review. Agents admin-merge only with Wasim's say-so (he gave it for this work).
