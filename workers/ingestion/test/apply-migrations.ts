import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.CORPUS_DB, env.TEST_MIGRATIONS);
await env.CORPUS_DB.prepare("PRAGMA foreign_keys = ON").run();
