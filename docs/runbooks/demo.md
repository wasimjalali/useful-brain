# Public demo runbook (brain.usefulbuild.com)

The public demo is the real Useful Brain app on synthetic Northwind data, with no model.

- **No AI.** The demo Brain binds no Workers AI and no Vectorize. `DEMO_MODE=true` refuses to start if `AI` is ever bound (`src/lib/demo/demo-mode.ts`), and the config test checks the bindings.
- **Scripted answers.** Six starter questions (`src/lib/demo/demo-script.ts`) run the real keyword search, then answer with sentences copied verbatim from the right Northwind document, cited with the labels search returned. Any other question gets the app's own not-enough-evidence answer. The scripted runtime is `src/lib/demo/demo-runtime.ts`.
- **No sign-in.** A page visit without a session gets a new demo admin (`src/lib/demo/demo-sign-in.ts` in the web proxy, Brain `POST /auth/demo`). Each visitor has their own chats. Visitors are left out of People.
- **Read-only.** Brain refuses every write except a visitor's own chat writes (`demoRequestAllowed`): uploads, invites, corpus changes, evaluations and approvals return `403` with "Changes are turned off in this demo."
- **Hourly cleanup.** A cron (`17 * * * *`) removes visitors older than a day with everything they made, in bounded batches (`src/lib/demo/demo-cleanup.ts`).
- **Abuse limits.** The web Worker rate-limits new demo sign-ins to 10 a minute per address (`DEMO_SIGN_IN_LIMIT`), only real browser page loads (`Sec-Fetch-Mode: navigate`) sign in, and Brain caps new visitors at 300 an hour.

## Resources

| What | Name |
|---|---|
| Web Worker | `useful-brain-demo`, custom domain `brain.usefulbuild.com` |
| Brain Worker | `useful-brain-brain-demo` (Service Binding only) |
| Corpus D1 | `useful-brain-corpus-demo` |
| Operations D1 | `useful-brain-operations-demo` |

There is no R2 bucket, queue, workflow, Vectorize index or Ingestion Worker for the demo.

## Build the data (fresh database)

Run from the repo root. `<dir>` is a new empty folder each time.

```bash
# 1. Schema on both remote databases.
CI=true npx wrangler d1 migrations apply useful-brain-corpus-demo --remote --env demo -c workers/brain/wrangler.jsonc
CI=true npx wrangler d1 migrations apply useful-brain-operations-demo --remote --env demo -c workers/brain/wrangler.jsonc

# 2. Corpus: seed locally with the app's own code (no model), write the rows as SQL, load them.
CI=true npx wrangler d1 migrations apply useful-brain-corpus-demo --local --env demo -c workers/brain/wrangler.jsonc --persist-to <dir>
npm run build:demo-corpus -- <dir> <dir>/demo-corpus.sql
CI=true npx wrangler d1 execute useful-brain-corpus-demo --remote --env demo -c workers/brain/wrangler.jsonc --file <dir>/demo-corpus.sql

# 3. The 148 synthetic people. The password is random and thrown away: nobody signs in with it.
DEMO_PASSWORD="$(openssl rand -hex 24)" npm run seed:demo -- --remote --env demo
```

The SQL file holds rows only. The remote's FTS triggers rebuild both search indexes as the rows land. Check with:

```bash
npx wrangler d1 execute useful-brain-corpus-demo --remote --env demo -c workers/brain/wrangler.jsonc \
  --command "SELECT (SELECT COUNT(*) FROM chunks), (SELECT COUNT(*) FROM chunks_fts), (SELECT active_generation_id FROM corpus_state)"
```

Expect 808 chunks, 808 FTS rows and one active generation.

## Deploy

Deploy Brain first, so the web Worker's Service Binding has a target.

```bash
npx wrangler deploy -c workers/brain/wrangler.jsonc --env demo
npx opennextjs-cloudflare build
npx wrangler deploy -c wrangler.jsonc --env demo
```

On this Mac, run the build and deploys through `~/.agents/tools/heavy-lock.sh`.

## Smoke

Open `https://brain.usefulbuild.com` in a fresh private window. You should land on Chat as Demo Admin with six starter questions. Each one answers with citations and the evidence panel. An off-script question says there isn't enough evidence. Admin pages load, and Sources upload or an invite says changes are turned off.
