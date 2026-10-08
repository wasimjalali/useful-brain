import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type {
  ActivityResponse,
  ActivityTraceResponse,
} from "../../../src/lib/contracts/admin-metrics";
import { recordTurnSteps } from "../../../src/lib/store/turn-steps";
import { call, personaCookies, seedTurn } from "./admin-helpers";

const MIN = 60_000;
const now = Date.now();
let cookies: Awaited<ReturnType<typeof personaCookies>>;

async function page(query: string): Promise<ActivityResponse> {
  const response = await call(`/admin/activity?${query}`, cookies["member-jordan"]);
  expect(response.status).toBe(200);
  return (await response.json()) as ActivityResponse;
}

beforeAll(async () => {
  cookies = await personaCookies();
  // Ten turns, two sharing a timestamp so the tie-break matters.
  for (let index = 0; index < 8; index += 1) {
    await seedTurn({
      id: `ac-${index}`,
      at: now - (index + 1) * MIN,
      question: `question ${index}`,
      owner: index % 2 === 0 ? "member-maya" : "member-priya",
      evidenceDocuments: index === 0 ? ["doc-a", "doc-a", "doc-b"] : [],
    });
  }
  await seedTurn({ id: "ac-tie-a", at: now - 10 * MIN, question: "tie a" });
  await seedTurn({ id: "ac-tie-b", at: now - 10 * MIN, question: "tie b" });
  await seedTurn({ id: "ac-ne", at: now - 11 * MIN, question: "none", answerType: "insufficient_evidence" });
  await seedTurn({ id: "ac-ok", at: now - 12 * MIN, question: "ticket", approval: "approved" });
  await seedTurn({ id: "ac-no", at: now - 13 * MIN, question: "ticket 2", approval: "rejected" });
  await seedTurn({ id: "ac-err", at: now - 14 * MIN, question: "boom", status: "failed", answerType: null });
  await seedTurn({ id: "ac-down", at: now - 15 * MIN, question: "down", answerType: "unavailable" });
});

describe("GET /admin/activity", () => {
  it("needs a session", async () => {
    expect((await call("/admin/activity")).status).toBe(401);
  });

  it("refuses a member", async () => {
    expect((await call("/admin/activity", cookies["member-maya"])).status).toBe(403);
  });

  it("rejects an unknown outcome and a malformed cursor", async () => {
    expect((await call("/admin/activity?outcome=bogus", cookies["member-jordan"])).status).toBe(400);
    expect((await call("/admin/activity?cursor=nope", cookies["member-jordan"])).status).toBe(400);
    expect((await call("/admin/activity?limit=0", cookies["member-jordan"])).status).toBe(400);
  });

  it("derives outcomes, person, question, sources and latency", async () => {
    const body = await page("range=7d&limit=50");
    const byId = new Map(body.rows.map((row) => [row.messageId, row]));
    expect(byId.get("ac-ne")!.outcome).toBe("no_evidence");
    expect(byId.get("ac-ok")!.outcome).toBe("approved");
    expect(byId.get("ac-no")!.outcome).toBe("denied");
    expect(byId.get("ac-err")!.outcome).toBe("error");
    expect(byId.get("ac-down")!.outcome).toBe("error");
    expect(byId.get("ac-1")!.outcome).toBe("answered");
    expect(byId.get("ac-0")).toMatchObject({
      person: "Maya Chen",
      question: "question 0",
      sources: 2,
      latencyMs: 2000,
    });
    expect(byId.get("ac-1")!.person).toBe("Priya Shah");
    expect(body.total).toBe(body.counts.answered + body.counts.no_evidence + body.counts.approved + body.counts.denied + body.counts.error);
    expect(body.counts).toMatchObject({ approved: 1, denied: 1, no_evidence: 1, error: 2 });
  });

  it("filters by outcome", async () => {
    const body = await page("outcome=error");
    expect(body.rows.map((row) => row.messageId).sort()).toEqual(["ac-down", "ac-err"]);
    expect(body.nextCursor).toBeNull();
  });

  it("pages by keyset without gaps or repeats, even when rows arrive mid-walk", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let inserted = false;
    do {
      const body: ActivityResponse = await page(`limit=4${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      seen.push(...body.rows.map((row) => row.messageId));
      cursor = body.nextCursor;
      if (!inserted) {
        inserted = true;
        // Newer rows land after the first page was served.
        await seedTurn({ id: "ac-late-1", at: now + MIN, question: "late 1" });
        await seedTurn({ id: "ac-late-2", at: now + 2 * MIN, question: "late 2" });
      }
    } while (cursor);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toHaveLength(15);
    expect(seen).not.toContain("ac-late-1");
    const tieA = seen.indexOf("ac-tie-a");
    const tieB = seen.indexOf("ac-tie-b");
    expect(tieB).toBeLessThan(tieA);
  });
});

describe("recordTurnSteps and the trace", () => {
  it("is idempotent for the same message and sequence", async () => {
    const steps = [
      { step: "retrieve" as const, detail: { candidates: 12, passages: 5, topScore: 0.83 }, durationMs: 120 },
      { step: "generate" as const, detail: { model: "@cf/zai-org/glm-5.3-flash", outputTokens: 300 }, durationMs: 900 },
    ];
    await recordTurnSteps(env.OPERATIONS_DB, "ac-0", steps);
    await recordTurnSteps(env.OPERATIONS_DB, "ac-0", steps);
    const rows = await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM turn_steps WHERE message_id = 'ac-0'`).first<{ n: number }>();
    expect(rows!.n).toBe(2);
  });

  it("rejects free text, unknown steps and oversize traces", async () => {
    await expect(
      recordTurnSteps(env.OPERATIONS_DB, "ac-1", [
        { step: "retrieve", detail: { excerpt: "Employees accrue 20 days of leave per year" } },
      ]),
    ).rejects.toThrow();
    await expect(
      recordTurnSteps(env.OPERATIONS_DB, "ac-1", [{ step: "bogus" as never, detail: {} }]),
    ).rejects.toThrow();
    await expect(
      recordTurnSteps(
        env.OPERATIONS_DB,
        "ac-1",
        Array.from({ length: 25 }, () => ({ step: "result" as const, detail: {} })),
      ),
    ).rejects.toThrow();
    const rows = await env.OPERATIONS_DB.prepare(`SELECT COUNT(*) AS n FROM turn_steps WHERE message_id = 'ac-1'`).first<{ n: number }>();
    expect(rows!.n).toBe(0);
  });

  it("redacts secret-shaped keys in details", async () => {
    await recordTurnSteps(env.OPERATIONS_DB, "ac-2", [
      { step: "tool_call", detail: { tool: "create_ticket", token: "abc123" } },
    ]);
    const row = await env.OPERATIONS_DB.prepare(`SELECT detail_json FROM turn_steps WHERE message_id = 'ac-2'`).first<{ detail_json: string }>();
    expect(row!.detail_json).not.toContain("abc123");
  });

  it("needs admin and returns ordered steps with no evidence text", async () => {
    expect((await call("/admin/activity/ac-0")).status).toBe(401);
    expect((await call("/admin/activity/ac-0", cookies["member-maya"])).status).toBe(403);
    const response = await call("/admin/activity/ac-0", cookies["member-jordan"]);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("SECRET EVIDENCE TEXT");
    const body = JSON.parse(text) as ActivityTraceResponse;
    expect(body.steps.map((step) => step.step)).toEqual(["retrieve", "generate"]);
    expect(body.steps[0]).toMatchObject({ seq: 1, durationMs: 120, detail: { candidates: 12, passages: 5 } });
  });

  it("returns an empty trace for a turn without steps and 404 for an unknown or user message", async () => {
    const empty = (await (await call("/admin/activity/ac-3", cookies["member-jordan"])).json()) as ActivityTraceResponse;
    expect(empty.steps).toEqual([]);
    expect((await call("/admin/activity/nope", cookies["member-jordan"])).status).toBe(404);
    expect((await call("/admin/activity/ac-3-q", cookies["member-jordan"])).status).toBe(404);
  });
});
