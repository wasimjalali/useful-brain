import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { Principal } from "../acl/access";
import type { DirectoryRecord } from "../auth/principal";
import {
  PROMPT_VERSION,
  answerFromEvidence,
  buildInsufficientEvidenceAnswer,
  structuredAnswerToText,
} from "../answer/contract";
import { IdempotentExecutor, MemoryIdempotencyStore } from "../agent/approvals";
import { createCreateTicketTool } from "../connectors/tools";
import type { TurnResponseExtras } from "../contracts/turn";
import { withAiHealth } from "../models/ai-health-wrap";
import { loadApprovalViewForMessage, recordPendingApproval } from "../store/approval-view";
import { resolveScopedDocument } from "../store/library-queries";
import { recordTurnSteps } from "../store/turn-steps";
import { buildTurnSteps, type SearchRecord } from "./turn-trace";
import { structuredJsonFromGroundedProse } from "../answer/prose-to-structured";
import {
  LIVE_KNOWLEDGE_SYSTEM_PROMPT,
  runKnowledgeAgent,
  type AgentRuntime,
} from "../agent/run";
import type { TurnStage } from "../cf/turn-progress";
import { countReadableDocuments } from "../acl/access";
import {
  WorkerBusyError,
  WorkerCancelledError,
  WorkerForbiddenError,
  WorkerNotFoundError,
  WorkerValidationError,
} from "../cf/worker-errors";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../embeddings/instructions";
import type { WorkersAiRunner, WorkersAiRunOptions } from "../embeddings/workers-ai-embed";
import { evalChatModel } from "../models/eval-override";
import { glm53FlashModel } from "../models/glm-5-3-flash";
import { createWorkersAiChatStream } from "../models/workers-ai-chat";
import {
  createWorkersAiCitationRepair,
  createWorkersAiCoveragePass,
} from "../models/workers-ai-citation-repair";
import { CHAT_MODEL_ID } from "../models/selection";
import type { GroundedAnswerResponse } from "../rag/grounded-answer";
import { CloudflareKnowledgePipeline, type CorpusSql, type VectorizeIndex } from "../retrieve/cloudflare-pipeline";
import { REAL_STACK_FINGERPRINT, fingerprintId } from "../retrieve/fingerprint";
import { FakeReranker } from "../retrieve/rerank";
import { WorkersAiReranker } from "../retrieve/workers-ai-reranker";
import type { KnowledgePipeline } from "../retrieve/pipeline";
import { activeGenerationId, type SqlExecutor } from "../store/corpus-d1";
import {
  completeTurn,
  ConversationStoreError,
  createPendingTurn,
  failTurn,
  loadBoundedHistory,
  loadOwnedTurnHandleByRequestId,
  loadReplay,
  persistThenRelease,
  type OperationsDatabase,
  type StoredHistoryTurn,
} from "../store/conversations";

export type ConversationLockStub = {
  acquire(runId: string): Promise<{ ok: boolean; status?: number; runId?: string }>;
  cancelled(): Promise<boolean>;
  release(runId: string): Promise<{ ok: boolean }>;
  /**
   * Optional turn-progress write into the lock. Progress is best-effort: a
   * lock without stage support simply skips reporting, and the write carries
   * a stage enum only, never model output or evidence.
   */
  setStage?(runId: string, stage: TurnStage, count?: number): Promise<unknown>;
};

export type ExecuteTurnInput = {
  operations: OperationsDatabase;
  corpus?: CorpusSql;
  vectorize?: VectorizeIndex;
  ai?: WorkersAiRunner;
  lockFor(conversationId: string): ConversationLockStub;
  principal: DirectoryRecord;
  /**
   * Loopback-only retrieval principal override for ACL demos and evals.
   * Scopes retrieval authorization only; storage ownership and tool policy
   * stay with the authenticated operator principal. The Brain route fails
   * closed on this field outside loopback identity mode.
   */
  assumedPrincipal?: Principal;
  /**
   * Loopback-only chat-model override for the eval bake-off. Parsed and
   * allowlisted by the Brain route; never changes the locked production
   * selection.
   */
  evalModelOverride?: string;
  /**
   * Injection seam for tests: replaces the live Workers AI chat runtime. Never
   * set from a request.
   */
  runtime?: AgentRuntime;
  /**
   * Restrict retrieval to one document. Resolved against the retrieval
   * principal before anything is stored; an unreadable id is NOT_FOUND.
   */
  scopeDocumentId?: string;
  question: string;
  conversationId?: string;
  /**
   * Retry of a failed turn: the id of the saved user message to answer again.
   * The Brain route resolves it server-side (owner checked); the new assistant
   * message points at this same user message and no second user row is made.
   */
  reuseUserMessageId?: string;
  requestId: string;
  persistConversation?: boolean;
  now?: number;
};

export async function executeTurn(
  input: ExecuteTurnInput,
): Promise<GroundedAnswerResponse & TurnResponseExtras> {
  const now = input.now ?? Date.now();
  const turnStartedAt = Date.now();
  const persist = input.persistConversation !== false;
  const retrievalPrincipal: Principal = input.assumedPrincipal ?? {
    userId: input.principal.id,
    roles: input.principal.roles,
    departments: input.principal.departments,
  };
  const policyPrincipal = { id: input.principal.id };
  // Resolved once per turn: the corpus state row does not move during a turn
  // (promotion is an explicit separate request), so both the pipeline and the
  // completion record read the same value without a second query. The
  // nullable value drives the empty-pipeline decision; "none" is only the
  // storage stamp for turns without a corpus, so a corpus with no active
  // generation still builds an empty pipeline rather than a real one bound
  // to a sentinel id.
  const generationIdValue = await knowledgeGenerationId(input);
  const corpusGenerationId = generationIdValue ?? "none";
  if (input.scopeDocumentId !== undefined) {
    if (!input.corpus || !generationIdValue) {
      throw new WorkerNotFoundError();
    }
    await resolveScopedDocument(
      input.corpus as unknown as SqlExecutor,
      generationIdValue,
      retrievalPrincipal,
      input.scopeDocumentId,
    );
  }
  // Every Workers AI call of the turn (chat, embedding, rerank) records its
  // outcome as a throttled health event.
  const ai = input.ai ? withAiHealth(input.operations, input.ai) : undefined;
  // Passages in the first search of the run: what "reading" reports and what
  // is stored as passages_retrieved. Captured at the pipeline seam so no
  // agent internals are touched.
  let firstSearchPassages: number | undefined;
  const basePipeline = knowledgePipelineFor(input, generationIdValue, ai);
  const searches: SearchRecord[] = [];
  const pipeline: Pick<KnowledgePipeline, "search"> = {
    search: async (args) => {
      const searchStartedAt = Date.now();
      const result = await basePipeline.search(
        input.scopeDocumentId === undefined ? args : { ...args, documentId: input.scopeDocumentId },
      );
      searches.push({
        query: args.query,
        durationMs: Date.now() - searchStartedAt,
        hits: result.hits.length,
        trace: result.trace,
      });
      firstSearchPassages ??= result.hits.length;
      return result;
    },
  };
  const baseRuntime = input.runtime ?? liveRuntime(ai, input.evalModelOverride);

  if (!persist) {
    const result = await runKnowledgeAgent({
      question: input.question,
      pipeline,
      principal: retrievalPrincipal,
      policyPrincipal,
      conversationId: input.conversationId ?? "eval-ephemeral",
      runtime: baseRuntime,
      captureMessages: false,
    });
    return withTurnDiagnostics(
      responseFromAgent(input.question, result.finalResponse, result.evidence, result.model),
      result,
      input.assumedPrincipal,
    );
  }

  let pending: { conversationId: string; assistantMessageId: string; duplicate: boolean };
  try {
    pending = await createPendingTurn(input.operations, {
      ownerPrincipalId: input.principal.id,
      conversationId: input.conversationId,
      requestId: input.requestId,
      question: input.question,
      reuseUserMessageId: input.reuseUserMessageId,
      now,
    });
  } catch (error) {
    throw mapStoreError(error);
  }

  if (pending.duplicate) {
    const completed = await loadReplay(input.operations, pending.assistantMessageId, input.principal.id);
    if (completed) {
      // A replayed turn never echoes assumedPrincipal: the stored answer may
      // have been produced under a different retrieval scope, and a caller
      // that requires the confirmation must treat the missing echo as
      // unconfirmed identity.
      const approval = await loadApprovalViewForMessage(
        input.operations,
        pending.assistantMessageId,
        { id: input.principal.id },
      ).catch(() => null);
      return { ...replayToResponse(completed), ...(approval ? { approval } : {}) };
    }
    throw new WorkerBusyError();
  }

  const lock = input.lockFor(pending.conversationId);
  const acquired = await lock.acquire(pending.assistantMessageId);
  if (!acquired.ok) {
    await failTurn(input.operations, {
      assistantMessageId: pending.assistantMessageId,
      ownerPrincipalId: input.principal.id,
      errorCode: "RATE_LIMITED",
      now,
    }).catch(() => undefined);
    throw new WorkerBusyError();
  }

  const claimedTurn = await loadOwnedTurnHandleByRequestId(
    input.operations,
    input.requestId,
    input.principal.id,
  );
  if (!claimedTurn || claimedTurn.status !== "pending") {
    await lock.release(pending.assistantMessageId).catch(() => undefined);
    throw new WorkerCancelledError();
  }

  const runAbort = new AbortController();
  const cancellationWatchStop = new AbortController();
  let cancellationWatchError: unknown;
  const cancellationWatch = watchCancellation(
    lock,
    runAbort,
    cancellationWatchStop.signal,
  ).catch((error) => {
    cancellationWatchError = error;
    runAbort.abort();
  });

  // Turn progress reports host-controlled stages and integer counts to the
  // conversation lock so a poller can see where the run is without ever
  // seeing unvalidated model output. Writes are best-effort and bounded; a
  // failed write must never fail the turn. Stages: "searching" with the
  // asker's readable-document count, "reading" with the passages of the first
  // search (fired by the first completed search) and "writing" once the
  // follow-up model call starts.
  const markStage = async (stage: TurnStage, count?: number): Promise<void> => {
    try {
      await lock.setStage?.(pending.assistantMessageId, stage, count);
    } catch {
      // Progress is best-effort and must never fail a turn.
    }
  };
  let readingMarked = false;
  const runtime: AgentRuntime | undefined = baseRuntime && {
    ...baseRuntime,
    stream: (...args: Parameters<AgentRuntime["stream"]>) => {
      if (readingMarked) {
        void markStage("writing");
      }
      return baseRuntime.stream(...args);
    },
  };

  try {
    const generateStartedAt = Date.now();
    const readableDocuments = await readableDocumentCount(input, generationIdValue, retrievalPrincipal);
    if (readableDocuments !== null) {
      await markStage("searching", readableDocuments);
    }
    // A turn scoped to an assumed principal never receives prior answers in
    // its model context: earlier turns may have been retrieved under a
    // different principal's ACL scope.
    const history = input.assumedPrincipal
      ? []
      : await loadBoundedHistory(
          input.operations,
          pending.conversationId,
          input.principal.id,
        );
    const result = await runKnowledgeAgent({
      question: input.question,
      pipeline,
      principal: retrievalPrincipal,
      policyPrincipal,
      conversationId: pending.conversationId,
      priorMessages: historyToAgentMessages(history, resultModelId(runtime)),
      abort: runAbort,
      runtime,
      captureMessages: false,
      // The ticket tool can only propose: the policy gateway turns every call
      // into a pending approval before execute() runs, and the executor below
      // refuses to create anything on its own.
      extraTools: [
        createCreateTicketTool({
          principal: policyPrincipal,
          conversationId: pending.conversationId,
          executor: new IdempotentExecutor(new MemoryIdempotencyStore()),
          createTicket: async () => {
            throw new Error("create_ticket runs only after an approval");
          },
        }),
      ],
      onFirstSearchComplete: async () => {
        await markStage("reading", firstSearchPassages ?? 0);
        readingMarked = true;
      },
    });
    if (cancellationWatchError) {
      throw cancellationWatchError;
    }
    if (runAbort.signal.aborted || (await lock.cancelled())) {
      throw new WorkerCancelledError();
    }
    // An internal abort (wall-time budget exhausted inside the run) must
    // fail the turn the same way an external cancellation does: the run
    // never produced a validated answer, so persisting one would store an
    // unvalidated result as a completed answer.
    if (result.aborted) {
      throw new WorkerCancelledError();
    }
    await markStage("writing");
    let rawModelJson = structuredJsonFromGroundedProse(result.finalResponse, result.evidence);
    let storedEvidence = result.evidence;
    let approvalRecorded = false;
    let actionNote = false;
    if (result.pendingApproval) {
      approvalRecorded = await recordApprovalOrRefuse(input.operations, {
        assistantMessageId: pending.assistantMessageId,
        conversationId: pending.conversationId,
        principalId: input.principal.id,
        corpusGenerationId,
        result,
      });
      actionNote = approvalRecorded;
      if (!approvalRecorded) {
        // A proposal that could not be recorded is a refusal: no card, no
        // half-recorded run, and no cited text the model wrote around it.
        rawModelJson = JSON.stringify(buildInsufficientEvidenceAnswer());
        storedEvidence = [];
      }
    }
    const completed = await persistThenRelease({
      persist: () =>
        completeTurn(input.operations, {
          ownerPrincipalId: input.principal.id,
          assistantMessageId: pending.assistantMessageId,
          requestId: input.requestId,
          rawModelJson,
          actionNote,
          evidence: storedEvidence,
          answerModel: result.model,
          embeddingModel: EMBEDDING_MODEL,
          embeddingDimensions: EMBEDDING_DIMENSIONS,
          promptVersion: result.promptVersion || PROMPT_VERSION,
          retrievalConfigVersion: fingerprintId(REAL_STACK_FINGERPRINT),
          corpusGenerationId,
          latencyMs: Date.now() - turnStartedAt,
          passagesRetrieved: firstSearchPassages ?? 0,
          now: Date.now(),
        }),
      release: () => lock.release(pending.assistantMessageId),
    });
    const answerType = completed.structuredAnswer.answerType;
    await recordTurnSideData(input, {
      assistantMessageId: pending.assistantMessageId,
      generationId: generationIdValue,
      readableDocuments,
      searches,
      result,
      citationCount: new Set(completed.structuredAnswer.paragraphs.flatMap((p) => p.citations)).size,
      approvalRecorded,
      answerType,
      generateMs: Date.now() - generateStartedAt,
    });
    const approval = approvalRecorded
      ? await loadApprovalViewForMessage(input.operations, pending.assistantMessageId, {
          id: input.principal.id,
        }).catch(() => {
          console.error("approval_view_load_failed");
          return null;
        })
      : null;
    return {
      ...withTurnDiagnostics(replayToResponse(completed), result, input.assumedPrincipal),
      ...(approval ? { approval } : {}),
    };
  } catch (error) {
    const cancelled = await lock.cancelled().catch(() => false);
    const failure = cancelled ? new WorkerCancelledError() : error;
    await failTurn(input.operations, {
      assistantMessageId: pending.assistantMessageId,
      ownerPrincipalId: input.principal.id,
      errorCode: failure instanceof WorkerCancelledError ? "CANCELLED" : "INTERNAL_ERROR",
      now: Date.now(),
    }).catch(() => undefined);
    await lock.release(pending.assistantMessageId).catch(() => undefined);
    throw mapStoreError(failure);
  } finally {
    cancellationWatchStop.abort();
    await cancellationWatch;
  }
}

async function watchCancellation(
  lock: ConversationLockStub,
  runAbort: AbortController,
  stop: AbortSignal,
): Promise<void> {
  while (!stop.aborted && !runAbort.signal.aborted) {
    if (await lock.cancelled()) {
      runAbort.abort();
      return;
    }
    await waitForCancellationPoll(stop);
  }
}

function waitForCancellationPoll(stop: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, 250);
    stop.addEventListener("abort", finish, { once: true });
    function finish() {
      clearTimeout(timer);
      stop.removeEventListener("abort", finish);
      resolve();
    }
  });
}

/**
 * Documents the asker can read in the active generation, through the same ACL
 * predicate as retrieval. Null when it cannot be computed (no corpus, or a
 * read failure), in which case the progress route computes it on demand.
 */
async function readableDocumentCount(
  input: ExecuteTurnInput,
  generationId: string | null,
  principal: Principal,
): Promise<number | null> {
  if (!input.corpus || !generationId) {
    return 0;
  }
  try {
    return await countReadableDocuments(
      input.corpus as unknown as SqlExecutor,
      generationId,
      principal,
    );
  } catch {
    return null;
  }
}

function knowledgeGenerationId(input: ExecuteTurnInput): Promise<string | null> {
  if (!input.corpus) {
    return Promise.resolve(null);
  }
  return activeGenerationId(input.corpus as unknown as SqlExecutor);
}

type ScopableSearch = {
  search(
    args: Parameters<KnowledgePipeline["search"]>[0] & { documentId?: string },
  ): ReturnType<KnowledgePipeline["search"]>;
};

function knowledgePipelineFor(
  input: ExecuteTurnInput,
  generationId: string | null,
  ai: WorkersAiRunner | undefined,
): ScopableSearch {
  if (!input.corpus || !generationId) {
    return emptyPipeline();
  }
  return new CloudflareKnowledgePipeline({
    db: input.corpus,
    vectorize: input.vectorize ?? null,
    ai: ai ?? { run: async () => ({ data: [] }) },
    reranker: ai ? new WorkersAiReranker(ai) : new FakeReranker(),
    generationId,
    fingerprint: REAL_STACK_FINGERPRINT,
  });
}

function emptyPipeline(): ScopableSearch {
  return {
    search: async ({ query }) => ({
      hits: [],
      trace: {
        query,
        finalChunkIds: [],
        vectorScores: {},
        keywordScores: {},
        fusedScores: {},
        rerankScores: {},
        fingerprint: fingerprintId(REAL_STACK_FINGERPRINT),
      },
    }),
  };
}

function liveRuntime(
  ai: WorkersAiRunner | undefined,
  evalModelOverride?: string,
): AgentRuntime | undefined {
  if (!ai) {
    return undefined;
  }
  const model = evalModelOverride ? evalChatModel(evalModelOverride) : glm53FlashModel();
  const runner = {
    run: (id: string, payload: Record<string, unknown>, options?: WorkersAiRunOptions) =>
      ai.run(id, payload, options),
  };
  return {
    model,
    stream: createWorkersAiChatStream(runner),
    repairGroundedAnswer: createWorkersAiCitationRepair(runner, model.id),
    coverAnswerParts: createWorkersAiCoveragePass(runner, model.id),
    systemPrompt: LIVE_KNOWLEDGE_SYSTEM_PROMPT,
  };
}

function resultModelId(runtime: AgentRuntime | undefined): string {
  return runtime?.model.id ?? CHAT_MODEL_ID;
}

function historyToAgentMessages(history: StoredHistoryTurn[], modelId: string): AgentMessage[] {
  const messages: AgentMessage[] = [];
  for (const turn of history) {
    messages.push({ role: "user", content: turn.question, timestamp: Date.now() });
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: turn.answer }],
      api: "openai-completions",
      provider: "cloudflare-workers-ai",
      model: modelId,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    });
  }
  return messages;
}

function withTurnDiagnostics(
  response: GroundedAnswerResponse,
  result: { vectorDegradedCount: number; refusalReason?: string },
  assumedPrincipal: Principal | undefined,
): GroundedAnswerResponse {
  return {
    ...response,
    ...(result.vectorDegradedCount > 0
      ? { vectorDegradedCount: result.vectorDegradedCount }
      : {}),
    ...(result.refusalReason ? { refusalReason: result.refusalReason } : {}),
    ...(assumedPrincipal
      ? {
          assumedPrincipal: {
            userId: assumedPrincipal.userId,
            roles: [...assumedPrincipal.roles],
            departments: [...assumedPrincipal.departments],
          },
        }
      : {}),
  };
}

function responseFromAgent(
  question: string,
  finalResponse: string,
  evidence: GroundedAnswerResponse["retrieval"]["results"],
  model: string,
): GroundedAnswerResponse {
  const raw = structuredJsonFromGroundedProse(finalResponse, evidence);
  const structured = answerFromEvidence(raw, evidence);
  return {
    question,
    answer: structuredAnswerToText(structured),
    answerModel: model,
    structuredAnswer: structured,
    retrieval: {
      embeddingModel: EMBEDDING_MODEL,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
      results: evidence,
    },
    // The ephemeral eval path pins the answer-pipeline build so a resumed
    // eval can refuse to mix rows produced by different Brain builds.
    promptVersion: PROMPT_VERSION,
    retrievalConfigVersion: fingerprintId(REAL_STACK_FINGERPRINT),
  };
}

function replayToResponse(replay: {
  conversationId: string;
  assistantMessageId: string;
  question: string;
  answer: string;
  answerModel: string;
  structuredAnswer: GroundedAnswerResponse["structuredAnswer"];
  retrieval: GroundedAnswerResponse["retrieval"];
  corpusGenerationId?: string | null;
  retrievalConfigVersion?: string | null;
}): GroundedAnswerResponse {
  return {
    question: replay.question,
    answer: replay.answer,
    answerModel: replay.answerModel,
    structuredAnswer: replay.structuredAnswer,
    retrieval: replay.retrieval,
    conversationId: replay.conversationId,
    assistantMessageId: replay.assistantMessageId,
    corpusGenerationId: replay.corpusGenerationId,
    retrievalConfigVersion: replay.retrievalConfigVersion,
  };
}

function mapStoreError(error: unknown): unknown {
  if (error instanceof ConversationStoreError && error.message === "FORBIDDEN") {
    return new WorkerForbiddenError();
  }
  if (error instanceof ConversationStoreError) {
    return new WorkerValidationError();
  }
  return error;
}

type RunForSideData = Awaited<ReturnType<typeof runKnowledgeAgent>>;

/**
 * Records the pending approval of a proposed write. Returns false (and leaves no
 * approval row behind) when it cannot be recorded, so the caller refuses.
 */
async function recordApprovalOrRefuse(
  db: OperationsDatabase,
  input: {
    assistantMessageId: string;
    conversationId: string;
    principalId: string;
    corpusGenerationId: string;
    result: RunForSideData;
  },
): Promise<boolean> {
  const binding = input.result.pendingApprovalBinding;
  if (!binding) {
    console.error("approval_binding_missing");
    return false;
  }
  try {
    await recordPendingApproval(db, {
      assistantMessageId: input.assistantMessageId,
      conversationId: input.conversationId,
      principalId: input.principalId,
      model: input.result.model,
      promptVersion: input.result.promptVersion || PROMPT_VERSION,
      corpusGenerationId: input.corpusGenerationId,
      toolCalls: input.result.toolCalls,
      binding,
      now: Date.now(),
    });
    return true;
  } catch {
    console.error("approval_record_failed");
    // A run created before the failure must not stay open.
    await db
      .prepare(
        `UPDATE agent_runs SET status = 'failed', updated_at = ?
         WHERE id = ? AND status IN ('running', 'pending_approval')
           AND NOT EXISTS (SELECT 1 FROM approvals WHERE run_id = agent_runs.id)`,
      )
      .bind(Date.now(), `run-approval-${input.assistantMessageId}`)
      .run()
      .catch(() => undefined);
    return false;
  }
}

/**
 * Trace and admin data of a completed turn. Every write is best-effort: a
 * failure is logged with a fixed code and never fails or changes the turn.
 */
async function recordTurnSideData(
  input: ExecuteTurnInput,
  turn: {
    assistantMessageId: string;
    generationId: string | null;
    readableDocuments: number | null;
    searches: SearchRecord[];
    result: RunForSideData;
    citationCount: number;
    approvalRecorded: boolean;
    answerType: string;
    generateMs: number;
  },
): Promise<void> {
  const toolProposals = turn.result.toolCalls
    .filter((call) => call.tool !== "search_knowledge")
    .map((call) => call.tool);
  try {
    await recordTurnSteps(
      input.operations,
      turn.assistantMessageId,
      buildTurnSteps({
        generationId: turn.generationId,
        readableDocuments: turn.readableDocuments,
        searches: turn.searches,
        relevanceFloor: REAL_STACK_FINGERPRINT.relevanceFloor,
        model: turn.result.model,
        citationCount: turn.citationCount,
        toolProposals,
        question: input.question,
        approvalState: turn.approvalRecorded ? "pending" : null,
        answerType: turn.answerType,
        generateMs: turn.generateMs,
      }),
    );
  } catch {
    console.error("turn_steps_write_failed");
  }
  if (turn.answerType !== "insufficient_evidence" || !input.corpus || !turn.generationId) {
    return;
  }
  try {
    const best = turn.searches
      .flatMap((search) => (search.trace.bestBelowFloor ? [search.trace.bestBelowFloor] : []))
      .sort((left, right) => right.score - left.score)[0];
    if (!best) {
      return;
    }
    const row = await input.corpus
      .prepare(`SELECT department FROM document_catalog WHERE generation_id = ? AND document_id = ?`)
      .bind(turn.generationId, best.documentId)
      .first<{ department: string | null }>();
    if (!row?.department) {
      return;
    }
    await input.operations
      .prepare(
        `UPDATE messages SET best_candidate_department = ? WHERE id = ? AND role = 'assistant'`,
      )
      .bind(row.department, turn.assistantMessageId)
      .run();
  } catch {
    console.error("best_candidate_department_write_failed");
  }
}
