import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { UnansweredResponse } from "../../../src/lib/contracts/admin-metrics";
import { call, personaCookies, seedTurn } from "./admin-helpers";

const DAY = 24 * 3_600_000;
const now = Date.now();
let cookies: Awaited<ReturnType<typeof personaCookies>>;

beforeAll(async () => {
  cookies = await personaCookies();
  await seedTurn({
    id: "un-1",
    at: now - 2 * DAY,
    question: "What is the parental leave policy?",
    answerType: "insufficient_evidence",
    bestCandidateDepartment: "hr",
  });
  await seedTurn({
    id: "un-2",
    at: now - DAY,
    owner: "member-priya",
    question: "  what IS the   parental leave policy? ",
    answerType: "insufficient_evidence",
  });
  await seedTurn({
    id: "un-3",
    at: now - 3 * DAY,
    question: "Who approves a refund above 500?",
    answerType: "insufficient_evidence",
  });
  // Not counted: grounded, old, failed.
  await seedTurn({ id: "un-4", at: now - DAY, question: "Grounded one", answerType: "grounded" });
  await seedTurn({
    id: "un-5",
    at: now - 30 * DAY,
    question: "Old unanswered",
    answerType: "insufficient_evidence",
  });
  await seedTurn({
    id: "un-6",
    at: now - DAY,
    question: "Failed turn",
    status: "failed",
    answerType: "insufficient_evidence",
  });
  await env.OPERATIONS_DB.batch([
    env.OPERATIONS_DB
      .prepare(
        `INSERT INTO document_requests (id, principal_id, message_id, question_normalized, created_at)
         VALUES ('dr-1', 'member-maya', 'un-1', 'what is the parental leave policy?', ?)`,
      )
      .bind(now),
    env.OPERATIONS_DB
      .prepare(
        `INSERT INTO document_requests (id, principal_id, message_id, question_normalized, created_at)
         VALUES ('dr-2', 'member-priya', 'un-2', 'what is the parental leave policy?', ?)`,
      )
      .bind(now),
    // A free-text Library request has no message; it still counts toward its question.
    env.OPERATIONS_DB
      .prepare(
        `INSERT INTO document_requests (id, principal_id, message_id, question_normalized, created_at)
         VALUES ('dr-3', 'member-maya', NULL, 'who approves a refund above 500?', ?)`,
      )
      .bind(now),
  ]);
});

describe("GET /admin/unanswered", () => {
  it("needs a session", async () => {
    expect((await call("/admin/unanswered?range=7d")).status).toBe(401);
  });

  it("refuses a member", async () => {
    expect((await call("/admin/unanswered?range=7d", cookies["member-priya"])).status).toBe(403);
  });

  it("rejects an unknown range", async () => {
    expect((await call("/admin/unanswered?range=90d", cookies["member-jordan"])).status).toBe(400);
  });

  it("groups by normalized question with ask and request counts", async () => {
    const response = await call("/admin/unanswered?range=7d", cookies["member-jordan"]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as UnansweredResponse;
    expect(body.questions).toHaveLength(2);
    const [first, second] = body.questions;
    expect(first.asks).toBe(2);
    expect(first.requests).toBe(2);
    expect(first.likelyDepartment).toBe("hr");
    expect(first.question.toLowerCase()).toContain("parental leave");
    expect(first.lastAskedAt).toBe(now - DAY);
    expect(second.asks).toBe(1);
    expect(second.requests).toBe(1);
    expect("likelyDepartment" in second).toBe(false);
  });
});
