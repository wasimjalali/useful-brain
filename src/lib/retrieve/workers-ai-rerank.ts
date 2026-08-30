import { splitTokens } from "../ingest/chunker";
import { countTokens } from "../ingest/tokenizer";

export const DEFAULT_MAX_INPUT_TOKENS = 512;
export const DEFAULT_RERANK_CANDIDATES = 20;
export const DEFAULT_RELEVANCE_FLOOR = 0.05;

const ESTIMATOR_WORST_CASE = 1.18;
const RESERVED_TOKENS = 8;
const QUERY_SHARE = 0.25;

export class RerankError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RerankError";
  }
}

export function deflatedBudget(maxInputTokens: number): number {
  return Math.trunc((maxInputTokens - RESERVED_TOKENS) / ESTIMATOR_WORST_CASE);
}

export function fitQuery(query: string, maxInputTokens = DEFAULT_MAX_INPUT_TOKENS): string {
  const deflated = deflatedBudget(maxInputTokens);
  if (deflated < 2) {
    throw new RerankError(
      `max_input_tokens=${maxInputTokens} leaves no room for a query and a passage together once the estimator's error is allowed for`,
    );
  }
  const cap = Math.max(1, Math.trunc(deflated * QUERY_SHARE));
  if (countTokens(query) <= cap) {
    return query;
  }
  const windows = splitTokens(query, { maxTokens: cap, overlapTokens: 0 });
  return windows[0] ?? query.slice(0, cap * 4);
}

export function fitToBudget(
  query: string,
  passage: string,
  maxInputTokens = DEFAULT_MAX_INPUT_TOKENS,
): string {
  const budget = deflatedBudget(maxInputTokens) - countTokens(query);
  if (budget < 1) {
    throw new RerankError(
      `the query is ${countTokens(query)} estimated tokens, which leaves no room under the reranker's ${maxInputTokens}-token cap`,
    );
  }
  if (countTokens(passage) <= budget) {
    return passage;
  }
  const windows = splitTokens(passage, { maxTokens: budget, overlapTokens: 0 });
  if (windows.length === 0) {
    throw new RerankError(
      `a ${countTokens(passage)}-token passage produced no window at a budget of ${budget}`,
    );
  }
  return windows[0];
}

export function workersAiRerankRequest(
  query: string,
  passages: string[],
  maxInputTokens = DEFAULT_MAX_INPUT_TOKENS,
): { query: string; contexts: Array<{ text: string }> } {
  const fittedQuery = fitQuery(query, maxInputTokens);
  return {
    query: fittedQuery,
    contexts: passages.map((passage) => ({ text: fitToBudget(fittedQuery, passage, maxInputTokens) })),
  };
}

export function parseWorkersAiRerankResponse(payload: unknown, passageCount: number): number[] {
  if (!payload || typeof payload !== "object") {
    throw new RerankError("workers_ai rerank response missing body");
  }
  const body = payload as {
    success?: boolean;
    errors?: Array<{ message?: string }>;
    response?: unknown;
    result?: { response?: unknown };
  };
  if (body.success === false) {
    const detail = (body.errors ?? []).map((error) => error.message ?? "unknown error").join("; ");
    throw new RerankError(`workers_ai rejected the rerank: ${detail || "unknown error"}`);
  }
  const entries = Array.isArray(body.response) ? body.response : body.result?.response;
  if (!Array.isArray(entries)) {
    throw new RerankError("workers_ai rerank response missing result.response[]");
  }
  if (entries.length !== passageCount) {
    throw new RerankError(`workers_ai rerank returned ${entries.length} entries for ${passageCount} passages`);
  }
  const scores: Array<number | null> = Array.from({ length: passageCount }, () => null);
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") {
      throw new RerankError("workers_ai rerank entry is not a mapping");
    }
    const rawIndex = (entry as { id?: unknown }).id;
    const rawScore = (entry as { score?: unknown }).score;
    if (typeof rawIndex === "boolean" || typeof rawIndex !== "number" || !Number.isInteger(rawIndex)) {
      throw new RerankError(`workers_ai rerank returned a non-integer id ${String(rawIndex)}`);
    }
    const score = typeof rawScore === "number" ? rawScore : Number(rawScore);
    if (!Number.isFinite(score)) {
      throw new RerankError(`workers_ai rerank returned a non-finite score ${String(rawScore)} for index ${rawIndex}`);
    }
    if (rawIndex < 0 || rawIndex >= passageCount) {
      throw new RerankError(`workers_ai rerank returned index ${rawIndex} for a request of ${passageCount} passages`);
    }
    if (scores[rawIndex] !== null) {
      throw new RerankError(`workers_ai rerank scored index ${rawIndex} twice`);
    }
    scores[rawIndex] = score;
  }
  const missing = scores.flatMap((score, index) => (score === null ? [index] : []));
  if (missing.length > 0) {
    throw new RerankError(`workers_ai rerank scored ${passageCount - missing.length} of ${passageCount} passages`);
  }
  return scores as number[];
}
