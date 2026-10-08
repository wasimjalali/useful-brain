import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";

import worker from "../src";
import type { DirectoryRecord } from "../../../src/lib/auth/principal";
import { addCitationLabels, PROMPT_VERSION } from "../../../src/lib/answer/contract";
import { promoteGeneration } from "../../../src/lib/store/corpus-d1";
import { completeTurn, createPendingTurn } from "../../../src/lib/store/conversations";
import { seedNorthwindCorpus } from "../../../src/lib/store/corpus-seed";
import { CORPUS_DOCUMENTS } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

export const sessionEnv = {
  ...env,
  IDENTITY_MODE: "session",
  LOOPBACK_RUNTIME: "false",
  LOOPBACK_SUBJECT: "",
} as typeof env;

export async function call(
  path: string,
  cookie?: string,
  init: { method?: string; json?: unknown; rawBody?: string } = {},
): Promise<Response> {
  const ctx = createExecutionContext();
  const body = init.rawBody ?? (init.json === undefined ? undefined : JSON.stringify(init.json));
  const response = await worker.fetch(
    new IncomingRequest(`https://brain.internal${path}`, {
      method: init.method ?? (body === undefined ? "GET" : "POST"),
      headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body,
    }),
    sessionEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

export const MAYA: DirectoryRecord = {
  id: "member-maya",
  subject: "maya.chen@northwind.example",
  kind: "user",
  roles: ["standard"],
  departments: ["engineering"],
};

export const PRIYA: DirectoryRecord = {
  id: "member-priya",
  subject: "priya.shah@northwind.example",
  kind: "user",
  roles: ["standard"],
  departments: ["support"],
};

// ACLs here are test ACLs: equipment return is department-scoped on purpose so
// the suggestion filter has a restricted target for some personas.
const NW_DOCUMENTS = [
  nw("nw_hr_parental_leave", "Parental Leave Policy", "public", [], "hr"),
  nw("nw_support_sla_policy", "Support SLA Policy", "public", [], "support"),
  nw("nw_engineering_log_retention", "System Log Retention Policy", "department", ["engineering"], "engineering"),
  nw("nw_operations_equipment_return", "Equipment Return Policy", "department", ["operations"], "operations"),
  nw("nw_hr_leave_policy", "Leave and Time Off Policy", "public", [], "hr"),
  nw("nw_hr_remote_work", "Remote Work and Flexible Hours", "public", [], "hr"),
  nw("nw_finance_employee_expense", "Employee Expense Policy", "public", [], "finance"),
  nw("nw_engineering_on_call", "On-call Rotation", "public", [], "engineering"),
  nw("nw_legal_data_retention", "Data Retention Policy", "public", [], "legal"),
];

function nw(
  documentId: string,
  title: string,
  accessScope: "public" | "department",
  departments: string[],
  department: string,
) {
  return {
    documentId,
    title,
    sourceName: title,
    sourcePath: `northwind/${department}/${documentId}.md`,
    accessScope,
    allowedRoles: [],
    allowedDepartments: departments,
    body: `# ${title}\n\n## Summary\n\n${title} describes the synthetic procedure for refund, escalation and retention topics.`,
    metadata: { department, version: "1.0", effective_date: "2026-01-01" },
  };
}

export const CHAT_CORPUS_TOTAL = CORPUS_DOCUMENTS.length + NW_DOCUMENTS.length;

/** Seeds the Phase 1 corpus plus Northwind-id documents, keyword-only, and promotes it. */
export async function seedChatCorpus(): Promise<{ generationId: string }> {
  const result = await seedNorthwindCorpus({
    db: env.CORPUS_DB,
    documents: [...CORPUS_DOCUMENTS, ...NW_DOCUMENTS],
  });
  await promoteGeneration(env.CORPUS_DB, result.generationId);
  return { generationId: result.generationId };
}

/** Records every stage write while delegating to the real conversation lock. */
export function recordingLock(calls: Array<[string, number | undefined]>) {
  return (conversationId: string) => {
    const real = env.CONVERSATION.getByName(conversationId);
    return {
      acquire: (runId: string) => real.acquire(runId),
      cancelled: () => real.cancelled(),
      release: (runId: string) => real.release(runId),
      setStage: async (runId: string, stage: string, count?: number) => {
        calls.push([stage, count]);
        return real.setStage(runId, stage, count);
      },
    };
  };
}

/**
 * A completed grounded answer stored directly (the keyword-only faux model
 * never produces a verbatim-grounded one). Cites the handbook document.
 */
export async function seedGroundedAnswer(input: {
  owner: string;
  requestId: string;
  question?: string;
  conversationId?: string;
  generationId?: string;
}): Promise<{ conversationId: string; assistantMessageId: string }> {
  const pending = await createPendingTurn(env.OPERATIONS_DB, {
    ownerPrincipalId: input.owner,
    conversationId: input.conversationId,
    requestId: input.requestId,
    question: input.question ?? "How does leave work at Northwind?",
    now: 2_000,
  });
  await completeTurn(env.OPERATIONS_DB, {
    ownerPrincipalId: input.owner,
    assistantMessageId: pending.assistantMessageId,
    requestId: input.requestId,
    rawModelJson: JSON.stringify({
      answerType: "grounded",
      paragraphs: [{ text: "Leave accrues monthly.", citations: ["[1]"] }],
    }),
    evidence: addCitationLabels([
      {
        rank: 1,
        score: 0.8,
        chunkId: "handbook__chunk_001",
        source: "employee-handbook.md",
        section: "Leave",
        text: "Leave accrues monthly.",
        tokenEstimate: 4,
        documentId: "doc-public-handbook",
      },
    ]),
    answerModel: "test-model",
    embeddingModel: "fake-embed",
    embeddingDimensions: 8,
    promptVersion: PROMPT_VERSION,
    retrievalConfigVersion: "fake-provider",
    corpusGenerationId: input.generationId ?? "gen-test",
    latencyMs: 1234,
    passagesRetrieved: 2,
    now: 2_001,
  });
  return { conversationId: pending.conversationId, assistantMessageId: pending.assistantMessageId };
}
