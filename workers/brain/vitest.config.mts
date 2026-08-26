import path from "node:path";
import { fileURLToPath } from "node:url";

import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(root, "../../migrations/operations"));
      return {
        wrangler: { configPath: "./wrangler.test.jsonc" },
        remoteBindings: false,
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            IDENTITY_MODE: "access",
            LOOPBACK_RUNTIME: "false",
            ACCESS_TEAM_DOMAIN: "https://karkoai.cloudflareaccess.com",
            ACCESS_AUD: "32eafc7626e974616deaf0dc3ce63d7bcbed58a2731e84d06bc3cdf1b53c4228",
          },
        },
      };
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
