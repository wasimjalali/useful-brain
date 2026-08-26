import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

await applyD1Migrations(env.OPERATIONS_DB, env.TEST_MIGRATIONS);
await env.OPERATIONS_DB.prepare("PRAGMA foreign_keys = ON").run();
