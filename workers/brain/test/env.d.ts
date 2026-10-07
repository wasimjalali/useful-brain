import type { D1Migration } from "cloudflare:test";

declare module "cloudflare:workers" {
  interface ProvidedEnv extends Env {
    TEST_MIGRATIONS: D1Migration[];
    TEST_CORPUS_MIGRATIONS: D1Migration[];
  }
}
