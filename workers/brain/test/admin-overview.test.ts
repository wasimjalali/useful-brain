import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { ActivityResponse, OverviewResponse } from "../../../src/lib/contracts/admin-metrics";
import { computeOverview } from "../../../src/lib/store/admin-metrics";
import { call, personaCookies, seedTurn } from "./admin-helpers";
import { seedCorpus } from "./seed";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let cookies: Awaited<ReturnType<typeof personaCookies>>;
const now = Date.now();

beforeAll(async () => {
  cookies = await personaCookies();
  await seedCorpus();
  // Current week.
  await seedTurn({ id: "ov-1", at: now - HOUR, question: "a", latencyMs: 1000 });
  await seedTurn({ id: "ov-2", at: now - 3 * DAY, question: "b", latencyMs: 3000, owner: "member-priya" });
  await seedTurn({ id: "ov-3", at: now - 3 * DAY, question: "c", latencyMs: 5000, answerType: "insufficient_evidence" });
  await seedTurn({ id: "ov-4", at: now - 4 * DAY, question: "d", latencyMs: null, status: "failed", answerType: null });
  await seedTurn({ id: "ov-5", at: now - 2 * DAY, question: "e", latencyMs: 2000, approval: "approved" });
  await seedTurn({ id: "ov-pending", at: now - HOUR, question: "p", status: "pending", answerType: null });
  // Previous week.
  await seedTurn({ id: "ov-p1", at: now - 8 * DAY, question: "f", latencyMs: 4000 });
  await seedTurn({ id: "ov-p2", at: now - 9 * DAY, question: "g", latencyMs: 6000, answerType: "insufficient_evidence" });
  // One ask, failed once then retried successfully: one question, not two.
  await seedTurn({ id: "ov-retry-failed", at: now - 2 * HOUR, question: "retried", status: "failed", answerType: null, latencyMs: null });
  await env.OPERATIONS_DB.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, status, answer_type, latency_ms, parent_user_message_id, created_at, updated_at)
     VALUES ('ov-retry-ok', 'conv-ov-retry-failed', 'assistant', 'answer', 'completed', 'grounded', 1500, 'ov-retry-failed-q', ?, ?)`,
  )
    .bind(now - HOUR, now - HOUR)
    .run();
  // Outside both windows.
  await seedTurn({ id: "ov-old", at: now - 40 * DAY, question: "old" });
});

describe("GET /admin/overview", () => {
  it("needs a session", async () => {
    expect((await call("/admin/overview?range=7d")).status).toBe(401);
  });

  it("refuses a member", async () => {
    expect((await call("/admin/overview?range=7d", cookies["member-maya"])).status).toBe(403);
  });

  it("rejects an unknown range", async () => {
    expect((await call("/admin/overview?range=1y", cookies["member-jordan"])).status).toBe(400);
  });

  it("returns totals, deltas and seven daily points", async () => {
    const response = await call("/admin/overview?range=7d", cookies["member-jordan"]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as OverviewResponse;
    // 6 asks this week: pending is excluded and the retried ask counts once.
    expect(body.current.questions).toBe(6);
    expect(body.current.grounded).toBe(4);
    expect(body.current.groundedPercent).toBe(66.7);
    expect(body.current.noEvidence).toBe(1);
    // Median of 1000, 1500, 2000, 3000, 5000 (the failed turn has no latency).
    expect(body.current.latencySamples).toBe(5);
    expect(body.current.medianLatencyMs).toBe(2000);
    expect(body.previous.questions).toBe(2);
    expect(body.previous.grounded).toBe(1);
    expect(body.previous.noEvidence).toBe(1);
    expect(body.previous.medianLatencyMs).toBe(5000);
    expect(body.daily).toHaveLength(7);
    expect(body.daily.reduce((sum, day) => sum + day.questions, 0)).toBe(body.current.questions);
    expect(body.daily.reduce((sum, day) => sum + day.noEvidence, 0)).toBe(body.current.noEvidence);
  });

  it("reconciles with the activity log over the same window", async () => {
    const overview = (await (
      await call("/admin/overview?range=7d", cookies["member-jordan"])
    ).json()) as OverviewResponse;
    const activity = (await (
      await call("/admin/activity?range=7d", cookies["member-jordan"])
    ).json()) as ActivityResponse;
    expect(activity.total).toBe(overview.current.questions);
    expect(activity.counts.no_evidence).toBe(overview.current.noEvidence);
    expect(activity.counts.approved).toBe(1);
    expect(activity.counts.error).toBe(1);
  });

  it("counts a retried ask once, by its latest attempt, and still reconciles with activity", async () => {
    const overview = (await (
      await call("/admin/overview?range=7d", cookies["member-jordan"])
    ).json()) as OverviewResponse;
    const activity = (await (
      await call("/admin/activity?range=7d&limit=50", cookies["member-jordan"])
    ).json()) as ActivityResponse;
    // ov-1..ov-5 plus the retried ask (ov-retry-ok); the failed first attempt and the pending row are not questions.
    expect(overview.current.questions).toBe(6);
    expect(activity.rows.map((row) => row.messageId)).toContain("ov-retry-ok");
    expect(activity.rows.map((row) => row.messageId)).not.toContain("ov-retry-failed");
    expect(activity.total).toBe(overview.current.questions);
  });

  it("returns null percentages and medians for an empty window", () => {
    const empty = computeOverview([], now);
    expect(empty.current).toEqual({
      questions: 0,
      grounded: 0,
      groundedPercent: null,
      noEvidence: 0,
      medianLatencyMs: null,
      latencySamples: 0,
    });
    expect(empty.daily).toHaveLength(7);
  });
});
