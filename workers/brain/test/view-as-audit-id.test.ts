import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { beginViewAsAudit } from "../../../src/lib/brain/view-as";
import type { OperationsDatabase } from "../../../src/lib/store/conversations";
import { seedPersonas, seedPrincipals } from "./seed";

beforeAll(async () => {
  await seedPrincipals();
  await seedPersonas();
});

describe("view-as audit ids", () => {
  it("never collide for distinct long request ids that share a prefix", async () => {
    const db = env.OPERATIONS_DB as unknown as OperationsDatabase;
    const prefix = "a".repeat(112);
    for (const suffix of ["x", "y"]) {
      await expect(
        beginViewAsAudit(db, {
          requestId: `${prefix}${suffix}`,
          adminPrincipalId: "member-jordan",
          assumedPrincipalId: "member-priya",
          question: "What is the first-response target for a P1 ticket?",
          now: Date.now(),
        }),
      ).resolves.toBeUndefined();
    }
    const rows = await env.OPERATIONS_DB.prepare(
      "SELECT COUNT(DISTINCT id) AS n FROM view_as_audits WHERE request_id IN (?, ?)",
    )
      .bind(`${prefix}x`, `${prefix}y`)
      .first<{ n: number }>();
    expect(rows?.n).toBe(2);
  });
});
