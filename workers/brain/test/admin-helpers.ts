import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";

import worker from "../src";
import { seedPersonas, seedPrincipals, type PersonaId } from "./seed";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
const sessionEnv = {
  ...env,
  IDENTITY_MODE: "session",
  LOOPBACK_RUNTIME: "false",
  LOOPBACK_SUBJECT: "",
} as typeof env;

export async function call(path: string, cookie?: string): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new IncomingRequest(`https://brain.internal${path}`, { headers: cookie ? { cookie } : {} }),
    sessionEnv,
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return response;
}

export async function personaCookies(): Promise<Record<PersonaId, string>> {
  await seedPrincipals();
  return seedPersonas();
}

export type SeedMessage = {
  id: string;
  /** Conversation owner. Defaults to member-maya. */
  owner?: PersonaId;
  question: string;
  at: number;
  answerType?: "grounded" | "insufficient_evidence" | "unavailable" | null;
  status?: "completed" | "failed" | "pending";
  latencyMs?: number | null;
  bestCandidateDepartment?: string | null;
  approval?: "approved" | "rejected" | "pending";
  evidenceDocuments?: string[];
  /** Citation labels the answer's paragraphs cite, e.g. ["[1]"]. Omitted means no structured paragraphs. */
  citedLabels?: string[];
};

/** Seeds one conversation with a user question and its assistant message, directly in D1. */
export async function seedTurn(input: SeedMessage): Promise<void> {
  const db = env.OPERATIONS_DB;
  const conversationId = `conv-${input.id}`;
  const userId = `${input.id}-q`;
  const status = input.status ?? "completed";
  const statements = [
    db
      .prepare(
        `INSERT INTO conversations (id, owner_principal_id, title, created_at, updated_at) VALUES (?, ?, 't', ?, ?)`,
      )
      .bind(conversationId, input.owner ?? "member-maya", input.at, input.at),
    db
      .prepare(
        `INSERT INTO messages (id, conversation_id, role, content, status, created_at, updated_at)
         VALUES (?, ?, 'user', ?, 'completed', ?, ?)`,
      )
      .bind(userId, conversationId, input.question, input.at, input.at),
    db
      .prepare(
        `INSERT INTO messages (
           id, conversation_id, role, content, status, answer_type, latency_ms,
           best_candidate_department, parent_user_message_id, created_at, updated_at,
           structured_paragraphs_json
         ) VALUES (?, ?, 'assistant', 'answer', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        conversationId,
        status,
        input.answerType === undefined ? "grounded" : input.answerType,
        input.latencyMs === undefined ? 2000 : input.latencyMs,
        input.bestCandidateDepartment ?? null,
        userId,
        input.at,
        input.at,
        input.citedLabels
          ? JSON.stringify([{ text: 'answer', citations: input.citedLabels }])
          : null,
      ),
  ];
  for (const [index, documentId] of (input.evidenceDocuments ?? []).entries()) {
    statements.push(
      db
        .prepare(
          `INSERT INTO evidence_snapshots (
             message_id, rank, score, chunk_id, source, section, text, token_estimate,
             citation_label, document_id
           ) VALUES (?, ?, 0.9, ?, 'src', 'sec', 'SECRET EVIDENCE TEXT', 5, ?, ?)`,
        )
        .bind(input.id, index + 1, `${input.id}-c${index}`, `[${index + 1}]`, documentId),
    );
  }
  if (input.approval) {
    const runId = `run-${input.id}`;
    statements.push(
      db
        .prepare(
          `INSERT INTO agent_runs (id, conversation_id, principal_id, status, evidence_message_id, created_at, updated_at)
           VALUES (?, ?, ?, 'completed', ?, ?, ?)`,
        )
        .bind(runId, conversationId, input.owner ?? "member-maya", input.id, input.at, input.at),
      db
        .prepare(
          `INSERT INTO approvals (
             idempotency_key, principal_id, conversation_id, tool, argument_fingerprint,
             expires_at, status, created_at, run_id
           ) VALUES (?, ?, ?, 'create_ticket', 'fp', ?, ?, ?, ?)`,
        )
        .bind(
          `key-${input.id}`,
          input.owner ?? "member-maya",
          conversationId,
          input.at + 900_000,
          input.approval,
          input.at,
          runId,
        ),
    );
  }
  await db.batch(statements);
}
