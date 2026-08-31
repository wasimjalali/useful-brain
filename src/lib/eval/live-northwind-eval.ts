import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ingestNorthwind } from "./ingest-northwind";
import { coverageGaps } from "./northwind-coverage";
import {
  ABSTENTION_CATEGORIES,
  EVAL_CATEGORIES,
  loadNorthwindCorpus,
  type EvalCategory,
  type EvalQuestion,
  type NorthwindDocument,
} from "./northwind-loader";
import { runRetrievalEvals, type RetrievalEvalReport } from "./run-retrieval-eval";
import {
  scoreNorthwindAnswer,
  type NorthwindAnswerForEval,
  type NorthwindAnswerScore,
} from "./score-northwind-answer";
import type { GroundedAnswerResponse } from "../rag/grounded-answer";
import { CHAT_MODEL_ID } from "../models/selection";

export const EVAL_OUTPUT_DIR = path.join(process.cwd(), "eval-output");
const RETRIEVAL_REPORT = path.join(EVAL_OUTPUT_DIR, "retrieval-report.json");

// Bumped when scoring semantics change so a resume never mixes rows scored
// under different identity or metric rules.
const HARNESS_VERSION = 3;

type LiveCheckpoint = {
  harnessVersion?: number;
  brainUrl: string;
  generationId: string | null;
  model?: string;
  /** Answer-pipeline build the rows were produced by (prompt + retrieval fingerprint). */
  pipelineVersion?: string;
  /** Digest of the loaded question set the rows were scored against. */
  questionSetDigest?: string;
  results: NorthwindAnswerScore[];
  latenciesMs?: Record<string, number>;
};

function questionSetDigest(questions: EvalQuestion[]): string {
  const canonical = questions.map((question) => ({
    id: question.questionId,
    category: question.category,
    query: question.query,
    expected: question.expectedDocumentIds,
    forbidden: question.forbiddenDocumentIds,
    sections: question.expectedSections,
    principal: question.principal,
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 32);
}

/** Per-model output files so one candidate's run never overwrites another's. */
function outputPaths(model: string | undefined) {
  const suffix = model
    ? `.${model.replace(/^@cf\//, "").replace(/[^a-zA-Z0-9.-]+/g, "-")}`
    : "";
  return {
    checkpoint: path.join(EVAL_OUTPUT_DIR, `live-checkpoint${suffix}.json`),
    summary: path.join(EVAL_OUTPUT_DIR, `live-summary${suffix}.json`),
    findings: path.join(EVAL_OUTPUT_DIR, `findings${suffix}.json`),
  };
}

function parseArgs(argv: string[]) {
  const liveIndex = argv.indexOf("--live");
  const brainUrl = (liveIndex >= 0 ? argv[liveIndex + 1] : process.env.NORTHWIND_EVAL_LIVE_URL) ?? "";
  const modelIndex = argv.indexOf("--model");
  const model = modelIndex >= 0 ? argv[modelIndex + 1] : undefined;
  if (modelIndex >= 0 && (!model || model.startsWith("--"))) {
    // Fail closed: a dangling --model must never silently evaluate the
    // production model and record the run as the baseline.
    throw new Error("--model requires a model id");
  }
  return {
    live: Boolean(brainUrl),
    brainUrl: brainUrl.replace(/\/$/, ""),
    resume: argv.includes("--resume") || process.env.NORTHWIND_EVAL_RESUME === "1",
    model,
  };
}

function countByCategory(questions: EvalQuestion[]): Record<EvalCategory, number> {
  const counts = Object.fromEntries(EVAL_CATEGORIES.map((category) => [category, 0])) as Record<
    EvalCategory,
    number
  >;
  for (const question of questions) {
    counts[question.category] += 1;
  }
  return counts;
}

function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function runRetrievalLayer(questions: EvalQuestion[], documents: NorthwindDocument[]) {
  const { pipeline } = await ingestNorthwind(documents);
  const report = await runRetrievalEvals(pipeline, questions, 3);
  writeJson(RETRIEVAL_REPORT, report);
  return report;
}

async function brainJson<T>(brainUrl: string, pathName: string, init: RequestInit = {}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${brainUrl}${pathName}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`Brain ${pathName} returned ${response.status}`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    const payload = (await response.json()) as T & { code?: string; message?: string };
    if (!response.ok) {
      throw new Error(payload.message ?? `Brain ${pathName} returned ${response.status}`);
    }
    return payload;
  }
  throw lastError instanceof Error ? lastError : new Error(`Brain ${pathName} failed`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toEvalAnswer(response: GroundedAnswerResponse): NorthwindAnswerForEval {
  return {
    answer: response.answer,
    structuredAnswer: response.structuredAnswer,
    retrieval: {
      results: response.retrieval.results.map((result) => ({
        source: result.source,
        section: result.section,
        citationLabel: result.citationLabel,
        documentId: result.documentId,
      })),
    },
    vectorDegradedCount: response.vectorDegradedCount,
    refusalReason: response.refusalReason,
  };
}

const SEED_TIMEOUT_MS = 600_000;
const SEED_POLL_INTERVAL_MS = 10_000;
const SEED_POLL_DEADLINE_MS = 900_000;

type KnowledgeStatus = {
  embeddingStorageStatus?: { activeVersionId?: string | null; readyVersionId?: string | null };
};

async function knowledgeStatus(brainUrl: string): Promise<KnowledgeStatus> {
  return brainJson<KnowledgeStatus>(brainUrl, "/knowledge");
}

async function promoteGeneration(brainUrl: string, generationId: string): Promise<string> {
  await brainJson(brainUrl, "/knowledge/promote", {
    method: "POST",
    body: JSON.stringify({ generationId }),
  });
  return generationId;
}

/**
 * A seed run that outlives the HTTP client is still a success: the worker
 * finishes the generation and reports it as readyVersionId. Never reseed on
 * a timeout; poll for the ready generation and promote it instead.
 */
async function ensureSeeded(brainUrl: string): Promise<string> {
  const inventory = await knowledgeStatus(brainUrl);
  const active = inventory.embeddingStorageStatus?.activeVersionId;
  if (active) {
    return active;
  }
  const ready = inventory.embeddingStorageStatus?.readyVersionId;
  if (ready) {
    return promoteGeneration(brainUrl, ready);
  }
  const { northwindSeedDocuments } = await import("./northwind-seed");
  try {
    const response = await fetch(`${brainUrl}/knowledge/seed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ documents: northwindSeedDocuments() }),
      signal: AbortSignal.timeout(SEED_TIMEOUT_MS),
    });
    if (response.ok) {
      const seeded = (await response.json()) as { generationId: string };
      return promoteGeneration(brainUrl, seeded.generationId);
    }
    process.stderr.write(`seed returned ${response.status}; polling for a ready generation\n`);
  } catch (error) {
    process.stderr.write(
      `seed request failed (${error instanceof Error ? error.message : String(error)}); polling for a ready generation\n`,
    );
  }
  const deadline = Date.now() + SEED_POLL_DEADLINE_MS;
  while (Date.now() < deadline) {
    await sleep(SEED_POLL_INTERVAL_MS);
    const polled = await knowledgeStatus(brainUrl).catch(() => null);
    const readyId = polled?.embeddingStorageStatus?.readyVersionId;
    if (readyId) {
      return promoteGeneration(brainUrl, readyId);
    }
    const activeId = polled?.embeddingStorageStatus?.activeVersionId;
    if (activeId) {
      return activeId;
    }
  }
  throw new Error("seed did not produce a ready generation before the polling deadline");
}

async function runLiveLayer(
  questions: EvalQuestion[],
  brainUrl: string,
  resume: boolean,
  model: string | undefined,
): Promise<{
  generationId: string;
  results: NorthwindAnswerScore[];
  latenciesMs: Record<string, number>;
}> {
  const generationId = await ensureSeeded(brainUrl);
  const paths = outputPaths(model);
  const expectedModel = model ?? CHAT_MODEL_ID;
  const digest = questionSetDigest(questions);
  let results: NorthwindAnswerScore[] = [];
  let latenciesMs: Record<string, number> = {};
  let pipelineVersion: string | undefined;
  if (resume) {
    try {
      const previous = JSON.parse(readFileSync(paths.checkpoint, "utf8")) as LiveCheckpoint;
      if (
        previous.brainUrl === brainUrl &&
        previous.harnessVersion === HARNESS_VERSION &&
        previous.generationId === generationId &&
        (previous.model ?? CHAT_MODEL_ID) === expectedModel &&
        previous.questionSetDigest === digest
      ) {
        results = previous.results;
        latenciesMs = previous.latenciesMs ?? {};
        pipelineVersion = previous.pipelineVersion;
      }
    } catch {
      results = [];
    }
  }
  const done = new Set(results.map((result) => result.questionId));
  for (const [index, question] of questions.entries()) {
    if (done.has(question.questionId)) {
      continue;
    }
    process.stderr.write(`live ${index + 1}/${questions.length} ${question.questionId}\n`);
    const requestId = `eval-live-${question.questionId}-${Date.now()}`;
    const startedAt = Date.now();
    const response = await brainJson<GroundedAnswerResponse>(brainUrl, "/turns", {
      method: "POST",
      body: JSON.stringify({
        question: question.query,
        requestId,
        persistConversation: false,
        assumePrincipal: {
          userId: question.principal.userId,
          roles: question.principal.roles,
          departments: question.principal.departments,
        },
        ...(model ? { evalModel: model } : {}),
      }),
    });
    latenciesMs[question.questionId] = Date.now() - startedAt;
    if (response.assumedPrincipal?.userId !== question.principal.userId) {
      // Fail closed: never score a turn whose retrieval identity was not
      // confirmed to be the question's principal.
      throw new Error(
        `${question.questionId}: Brain did not confirm the assumed principal (got ${
          response.assumedPrincipal?.userId ?? "none"
        })`,
      );
    }
    if (response.answerModel !== expectedModel) {
      // Fail closed: never score a turn answered by a different model than
      // the one this run is evaluating.
      throw new Error(
        `${question.questionId}: Brain answered with ${response.answerModel}, expected ${expectedModel}`,
      );
    }
    const responseVersion = `${response.promptVersion ?? "unreported"}|${
      response.retrievalConfigVersion ?? "unreported"
    }`;
    if (pipelineVersion === undefined) {
      pipelineVersion = responseVersion;
    } else if (pipelineVersion !== responseVersion) {
      // Fail closed: never mix rows produced by different Brain builds in
      // one run or across a resume.
      throw new Error(
        `${question.questionId}: Brain pipeline changed mid-run (${responseVersion} vs ${pipelineVersion})`,
      );
    }
    const scored = scoreNorthwindAnswer(question, toEvalAnswer(response));
    results.push(scored);
    writeJson(paths.checkpoint, {
      harnessVersion: HARNESS_VERSION,
      brainUrl,
      generationId,
      model: expectedModel,
      pipelineVersion,
      questionSetDigest: digest,
      results,
      latenciesMs,
    } satisfies LiveCheckpoint);
    await sleep(250);
  }
  return { generationId, results, latenciesMs };
}

function latencySummary(latenciesMs: Record<string, number>, total: number) {
  const values = Object.values(latenciesMs).sort((a, b) => a - b);
  if (values.length === 0) {
    return null;
  }
  const at = (q: number) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  return {
    count: values.length,
    total,
    // A resumed run only measures the questions it re-asked; a partial
    // latency sample must never be read as run-level coverage.
    partial: values.length < total,
    meanMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    p50Ms: at(0.5),
    p95Ms: at(0.95),
  };
}

function summarize(
  retrieval: RetrievalEvalReport,
  live: NorthwindAnswerScore[] | null,
  questions: EvalQuestion[],
) {
  const questionById = new Map(questions.map((question) => [question.questionId, question]));
  const liveCounted = live?.filter((result) => result.status !== "skipped") ?? [];
  const livePassed = liveCounted.filter((result) => result.status === "pass").length;
  const liveByCategory: Record<string, { scored: number; passed: number }> = {};
  for (const result of liveCounted) {
    const bucket = (liveByCategory[result.category] ??= { scored: 0, passed: 0 });
    bucket.scored += 1;
    if (result.status === "pass") {
      bucket.passed += 1;
    }
  }
  const recallRows = liveCounted.filter((result) => result.liveRecall !== null);
  const vectorDegradedTurns = liveCounted.filter(
    (result) => result.vectorDegradedCount > 0,
  ).length;
  if (vectorDegradedTurns > 0) {
    process.stderr.write(
      `warning: ${vectorDegradedTurns} live turns ran keyword-only after vector-channel errors; this summary is not comparable to a hybrid baseline\n`,
    );
  }
  return {
    retrieval: {
      recallAtK: retrieval.recallAtK,
      mrr: retrieval.mrr,
      ndcgAtK: retrieval.ndcgAtK,
      citationCorrectness: retrieval.citationCorrectness,
      abstentionCorrectness: retrieval.abstentionCorrectness,
      aclLeakCount: retrieval.aclLeakCount,
      questions: retrieval.results.length,
    },
    live: live
      ? {
          total: live.length,
          scored: liveCounted.length,
          passed: livePassed,
          failed: liveCounted.length - livePassed,
          skipped: live.filter((result) => result.status === "skipped").length,
          passRate: liveCounted.length === 0 ? 0 : livePassed / liveCounted.length,
          byCategory: liveByCategory,
          retrievedRecall:
            recallRows.length === 0
              ? null
              : recallRows.reduce((sum, result) => sum + (result.liveRecall ?? 0), 0) /
                recallRows.length,
          goldRetrievedUncitedCount: liveCounted.filter(
            (result) => result.goldRetrievedUncited.length > 0,
          ).length,
          // Counterpart to goldRetrievedUncitedCount: grounded answers that
          // also cite documents outside the gold set, so citation broadening
          // stays visible next to the pass rate.
          citedNotExpectedCount: liveCounted.filter((result) => {
            const question = questionById.get(result.questionId);
            if (!question || ABSTENTION_CATEGORIES.has(question.category)) {
              return false;
            }
            return result.citedDocumentIds.some(
              (id) => !question.expectedDocumentIds.includes(id),
            );
          }).length,
          vectorDegradedTurns,
          // Only a fully hybrid run may be compared with a hybrid baseline.
          hybridBaselineComparable: vectorDegradedTurns === 0,
          refusedWithEvidence: liveCounted.filter(
            (result) => result.refusalReason === "model_abstained_with_evidence",
          ).length,
        }
      : null,
    failures: [
      ...retrieval.results
        .filter((result) => result.leakedDocumentIds.length > 0 || result.aclViolationChunkIds.length > 0)
        .map((result) => ({ layer: "retrieval", questionId: result.questionId, detail: result })),
      ...(live ?? [])
        .filter((result) => result.status === "fail")
        .map((result) => ({ layer: "live", questionId: result.questionId, detail: result })),
    ],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { documents, questions } = loadNorthwindCorpus();
  const gaps = coverageGaps(countByCategory(questions));
  if (gaps.length > 0) {
    throw new Error(`Northwind coverage gaps: ${gaps.join("; ")}`);
  }
  const retrieval = await runRetrievalLayer(questions, documents);
  const paths = outputPaths(args.model);
  let live: {
    generationId: string;
    results: NorthwindAnswerScore[];
    latenciesMs: Record<string, number>;
  } | null = null;
  if (args.live) {
    live = await runLiveLayer(questions, args.brainUrl, args.resume, args.model);
    writeJson(paths.summary, {
      model: args.model ?? CHAT_MODEL_ID,
      generationId: live.generationId,
      latency: latencySummary(live.latenciesMs, live.results.length),
      results: live.results,
    });
  }
  const findings = {
    model: args.model ?? CHAT_MODEL_ID,
    ...(live ? { latency: latencySummary(live.latenciesMs, live.results.length) } : {}),
    ...summarize(retrieval, live?.results ?? null, questions),
  };
  writeJson(paths.findings, findings);
  process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
}

function isDirectRun() {
  const entry = process.argv[1]?.replace(/\\/g, "/");
  return Boolean(entry?.endsWith("live-northwind-eval.ts") || entry?.endsWith("live-northwind-eval.js"));
}

if (isDirectRun()) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
