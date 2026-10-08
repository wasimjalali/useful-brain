import type { TurnStepDetail } from "../contracts/admin-metrics";
import type { RetrievalTrace } from "../retrieve/types";
import type { TurnStepInput } from "../store/turn-steps";

const KEY_PATTERN = /^[a-z][A-Za-z0-9_]{0,31}$/;
const TEXT_VALUE_PATTERN = /^[A-Za-z0-9@:._/-]{1,64}$/;
const MAX_KEYS = 12;
const TOP_CHUNKS = 3;

export type SearchRecord = {
  query: string;
  durationMs: number;
  hits: number;
  trace: RetrievalTrace;
};

export type TurnTraceInput = {
  generationId: string | null;
  readableDocuments: number | null;
  searches: SearchRecord[];
  relevanceFloor: number;
  model: string;
  citationCount: number;
  toolProposals: string[];
  /** The asker's question, used only to decide whether a search query was rewritten. */
  question: string;
  approvalState: "pending" | null;
  answerType: string;
  generateMs: number;
};

/**
 * Keeps only values turn_steps accepts (ids, counts, scores, model names), so a
 * value outside the pattern drops one field instead of failing the whole trace.
 */
export function safeStepDetail(detail: Record<string, unknown>): TurnStepDetail {
  const safe: TurnStepDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    if (Object.keys(safe).length >= MAX_KEYS) {
      break;
    }
    if (!KEY_PATTERN.test(key)) {
      continue;
    }
    if (value === null || typeof value === "boolean") {
      safe[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      safe[key] = value;
    } else if (typeof value === "string" && TEXT_VALUE_PATTERN.test(value)) {
      safe[key] = value;
    }
  }
  return safe;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Approximate token count of a query. A count only, never the text. */
export function queryTokenCount(query: string): number {
  return query.split(/\s+/u).filter(Boolean).length;
}

export function buildTurnSteps(input: TurnTraceInput): TurnStepInput[] {
  const steps: TurnStepInput[] = [];
  const first = input.searches[0];
  const searchMs = input.searches.reduce((sum, search) => sum + search.durationMs, 0);

  if (first && first.query.trim() !== input.question.trim()) {
    steps.push({ step: "rewrite", detail: safeStepDetail({ queryTokens: queryTokenCount(first.query) }) });
  }

  if (first) {
    const degraded = input.searches.some((search) => search.trace.vectorChannelError);
    steps.push({
      step: "retrieve",
      detail: safeStepDetail({
        mode: degraded ? "keyword_only" : "hybrid",
        generation: input.generationId,
        readable: input.readableDocuments,
        candidates: first.trace.candidateCount ?? first.hits,
        searches: input.searches.length,
      }),
      durationMs: Math.max(0, Math.round(searchMs)),
    });
    const top: Record<string, unknown> = { floor: input.relevanceFloor };
    first.trace.finalChunkIds.slice(0, TOP_CHUNKS).forEach((chunkId, index) => {
      top[`chunk${index + 1}`] = chunkId;
      const score = first.trace.rerankScores[chunkId];
      if (typeof score === "number") {
        top[`score${index + 1}`] = round(score);
      }
    });
    steps.push({ step: "rerank", detail: safeStepDetail(top) });
  }

  steps.push({
    step: "generate",
    detail: safeStepDetail({
      model: input.model,
      citations: input.citationCount,
      toolProposals: input.toolProposals.length,
    }),
    durationMs: Math.max(0, Math.round(input.generateMs)),
  });

  for (const tool of input.toolProposals) {
    steps.push({ step: "tool_call", detail: safeStepDetail({ tool }) });
  }
  if (input.approvalState) {
    steps.push({ step: "approval", detail: safeStepDetail({ state: input.approvalState }) });
  }
  steps.push({ step: "result", detail: safeStepDetail({ answerType: input.answerType }) });
  return steps;
}
