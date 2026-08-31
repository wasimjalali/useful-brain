import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { Principal } from "../acl/access";
import type { DirectoryRecord } from "../auth/principal";
import { PROMPT_VERSION, answerFromEvidence, structuredAnswerToText } from "../answer/contract";
import { structuredJsonFromGroundedProse } from "../answer/prose-to-structured";
import {
  LIVE_KNOWLEDGE_SYSTEM_PROMPT,
  runKnowledgeAgent,
  type AgentRuntime,
} from "../agent/run";
import {
  WorkerBusyError,
  WorkerCancelledError,
  WorkerForbiddenError,
  WorkerValidationError,
} from "../cf/worker-errors";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "../embeddings/instructions";
import type { WorkersAiRunner } from "../embeddings/workers-ai-embed";
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
  question: string;
  conversationId?: string;
  requestId: string;
  persistConversation?: boolean;
  now?: number;
};

export async function executeTurn(input: ExecuteTurnInput): Promise<GroundedAnswerResponse> {
  const now = input.now ?? Date.now();
  const persist = input.persistConversation !== false;
  const retrievalPrincipal: Principal = input.assumedPrincipal ?? {
    userId: input.principal.id,
    roles: input.principal.roles,
    departments: input.principal.departments,
  };
  const policyPrincipal = { id: input.principal.id };
  const pipeline = await knowledgePipeline(input);
  const runtime = liveRuntime(input.ai, input.evalModelOverride);

  if (!persist) {
    const result = await runKnowledgeAgent({
      question: input.question,
      pipeline,
      principal: retrievalPrincipal,
      policyPrincipal,
      conversationId: input.conversationId ?? "eval-ephemeral",
      runtime,
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
      return replayToResponse(completed);
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

  try {
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
    });
    if (cancellationWatchError) {
      throw cancellationWatchError;
    }
    if (runAbort.signal.aborted || (await lock.cancelled())) {
      throw new WorkerCancelledError();
    }
    const rawModelJson = structuredJsonFromGroundedProse(result.finalResponse, result.evidence);
    const corpusGenerationId = (await activeGenerationIdFor(input)) ?? "none";
    const completed = await persistThenRelease({
      persist: () =>
        completeTurn(input.operations, {
          ownerPrincipalId: input.principal.id,
          assistantMessageId: pending.assistantMessageId,
          requestId: input.requestId,
          rawModelJson,
          evidence: result.evidence,
          answerModel: result.model,
          embeddingModel: EMBEDDING_MODEL,
          embeddingDimensions: EMBEDDING_DIMENSIONS,
          promptVersion: result.promptVersion || PROMPT_VERSION,
          retrievalConfigVersion: fingerprintId(REAL_STACK_FINGERPRINT),
          corpusGenerationId,
          now: Date.now(),
        }),
      release: () => lock.release(pending.assistantMessageId),
    });
    return withTurnDiagnostics(replayToResponse(completed), result, input.assumedPrincipal);
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

async function knowledgePipeline(
  input: ExecuteTurnInput,
): Promise<Pick<KnowledgePipeline, "search">> {
  if (!input.corpus) {
    return emptyPipeline();
  }
  const generationId = await activeGenerationId(input.corpus as unknown as SqlExecutor);
  if (!generationId) {
    return emptyPipeline();
  }
  return new CloudflareKnowledgePipeline({
    db: input.corpus,
    vectorize: input.vectorize ?? null,
    ai: input.ai ?? { run: async () => ({ data: [] }) },
    reranker: input.ai ? new WorkersAiReranker(input.ai) : new FakeReranker(),
    generationId,
    fingerprint: REAL_STACK_FINGERPRINT,
  });
}

function emptyPipeline(): Pick<KnowledgePipeline, "search"> {
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
  const runner = { run: (id: string, payload: Record<string, unknown>) => ai.run(id, payload) };
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

async function activeGenerationIdFor(input: ExecuteTurnInput): Promise<string | null> {
  if (!input.corpus) {
    return null;
  }
  return activeGenerationId(input.corpus as unknown as SqlExecutor);
}
