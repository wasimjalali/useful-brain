import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import questions from "../../../content/northwind/questions.json";
import passOne from "../../../evals/results/2026-08-31/findings.pass1.json";
import passTwo from "../../../evals/results/2026-08-31/findings.glm-5.3-flash.json";
import latest from "../../../evals/results/2026-09-06/findings.glm-5.3-flash.json";
import type { EvalsAdminView } from "../../../src/lib/contracts/admin-metrics";
import { NORTHWIND_CAMPAIGN, campaignRun } from "../../../src/lib/eval/campaign-snapshot";
import { call, personaCookies } from "./admin-helpers";
import { seedCorpus } from "./seed";

let cookies: Awaited<ReturnType<typeof personaCookies>>;

beforeAll(async () => {
  cookies = await personaCookies();
});

type Findings = {
  live: {
    scored: number;
    passed: number;
    byCategory: Record<string, { scored: number; passed: number }>;
  };
  failures: { questionId: string }[];
};

function rollUp(findings: Findings) {
  const merged = new Map<string, { passed: number; scored: number }>();
  for (const [id, value] of Object.entries(findings.live.byCategory)) {
    const key = id === "multi_hop_expanded" ? "multi_hop" : id;
    const current = merged.get(key) ?? { passed: 0, scored: 0 };
    merged.set(key, { passed: current.passed + value.passed, scored: current.scored + value.scored });
  }
  return merged;
}

describe("campaign snapshot constants match the committed eval results", () => {
  const cases: [string, Findings][] = [
    ["pass1", passOne as Findings],
    ["final", passTwo as Findings],
    ["coverage", latest as Findings],
  ];
  for (const [key, findings] of cases) {
    it(`${key} totals, categories and failing ids`, () => {
      const run = campaignRun(key as "pass1");
      expect(run.passed).toBe(findings.live.passed);
      expect(run.scored).toBe(findings.live.scored);
      const merged = rollUp(findings);
      for (const category of run.categories) {
        expect(merged.get(category.id), category.id).toEqual({
          passed: category.passed,
          scored: category.scored,
        });
      }
      if (run.failures.length > 0) {
        expect(run.failures.map((failure) => failure.id).sort()).toEqual(
          findings.failures.map((failure) => failure.questionId).sort(),
        );
      }
    });
  }

  it("retrieval constants match the latest findings", () => {
    const retrieval = (latest as unknown as {
      retrieval: { recallAtK: number; mrr: number; ndcgAtK: number; aclLeakCount: number };
      live: { retrievedRecall: number };
    });
    const round = (value: number) => Math.round(value * 1000) / 1000;
    expect(NORTHWIND_CAMPAIGN.retrieval.recallAt3).toBe(round(retrieval.retrieval.recallAtK));
    expect(NORTHWIND_CAMPAIGN.retrieval.mrr).toBe(round(retrieval.retrieval.mrr));
    expect(NORTHWIND_CAMPAIGN.retrieval.ndcg).toBe(round(retrieval.retrieval.ndcgAtK));
    expect(NORTHWIND_CAMPAIGN.retrieval.liveRetrievedRecall).toBe(round(retrieval.live.retrievedRecall));
    expect(NORTHWIND_CAMPAIGN.retrieval.aclLeaks).toBe(retrieval.retrieval.aclLeakCount);
    expect(NORTHWIND_CAMPAIGN.questions).toBe(questions.questions.length);
  });
});

describe("GET /evaluations?view=campaign", () => {
  it("needs a session", async () => {
    expect((await call("/evaluations?view=campaign")).status).toBe(401);
  });

  it("refuses a member", async () => {
    expect((await call("/evaluations?view=campaign", cookies["member-maya"])).status).toBe(403);
  });

  it("rejects an unknown view", async () => {
    expect((await call("/evaluations?view=bogus", cookies["member-jordan"])).status).toBe(400);
  });

  it("keeps the plain list for members", async () => {
    const response = await call("/evaluations", cookies["member-maya"]);
    expect(response.status).toBe(200);
    expect(Array.isArray(await response.json())).toBe(true);
  });

  it("returns runs, latest categories, metrics and expanded failures", async () => {
    const response = await call("/evaluations?view=campaign", cookies["member-jordan"]);
    expect(response.status).toBe(200);
    const body = (await response.json()) as EvalsAdminView;
    expect(body.runs.map((run) => run.key)).toEqual(["baseline", "pass1", "final", "coverage"]);
    expect(body.latestKey).toBe("coverage");
    expect(body.categories.map((category) => category.id)).toEqual([
      "factual",
      "trap",
      "permission",
      "unanswerable",
      "multi_hop",
    ]);
    expect(body.retrieval.aclLeaks).toBe(0);
    expect(body.failures.map((failure) => failure.id)).toEqual(["q093", "q120"]);
    const [first, second] = body.failures;
    expect(first.askedAs).toBe("support_agent");
    expect(first.question).toBe("What is ERR-7702 and who do I hand it to?");
    expect(first.expected).toEqual([
      {
        documentId: "nw_engineering_error_code_reference",
        title: "Northwind Core Error Code Reference",
        section: "Billing and Entitlement Errors (ERR-7xxx)",
      },
    ]);
    expect(first.note).toContain("exact token");
    expect(second.expected.map((item) => item.title)).toEqual([
      "Support SLA Policy",
      "Customer Complaint Escalation Path",
    ]);
    expect(second.expected.map((item) => item.documentId)).toEqual([
      "nw_support_sla_policy",
      "nw_support_complaint_escalation",
    ]);
    expect(second.expected.map((item) => item.section)).toEqual([
      "SLA Credits",
      "Goodwill and Compensation Rules",
    ]);
  });

  it("prefers the active catalog title over the bundled front matter title", async () => {
    const { generationId } = await seedCorpus();
    await env.CORPUS_DB.prepare(
      `INSERT INTO document_catalog (document_id, generation_id, title, access_scope, chunk_count, file_name, updated_at)
       VALUES ('nw_support_sla_policy', ?, 'Catalog SLA Title', 'public', 1, 'sla.md', 1)`,
    )
      .bind(generationId)
      .run();
    const response = await call("/evaluations?view=campaign", cookies["member-jordan"]);
    const body = (await response.json()) as EvalsAdminView;
    expect(body.failures[1].expected.map((item) => item.title)).toEqual([
      "Catalog SLA Title",
      "Customer Complaint Escalation Path",
    ]);
  });
});
