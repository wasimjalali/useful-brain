import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ingestNorthwind } from "./ingest-northwind";
import { coverageGaps } from "./northwind-coverage";
import {
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

export const EVAL_OUTPUT_DIR = path.join(process.cwd(), "eval-output");
const RETRIEVAL_REPORT = path.join(EVAL_OUTPUT_DIR, "retrieval-report.json");
const LIVE_CHECKPOINT = path.join(EVAL_OUTPUT_DIR, "live-checkpoint.json");
const LIVE_SUMMARY = path.join(EVAL_OUTPUT_DIR, "live-summary.json");
const FINDINGS = path.join(EVAL_OUTPUT_DIR, "findings.json");

// Bumped when scoring semantics change so a resume never mixes rows scored
// under different identity or metric rules.
const HARNESS_VERSION = 2;

type LiveCheckpoint = {
  harnessVersion?: number;
  brainUrl: string;
  generationId: string | null;
  results: NorthwindAnswerScore[];
};

function parseArgs(argv: string[]) {
  const liveIndex = argv.indexOf("--live");
  const brainUrl = (liveIndex >= 0 ? argv[liveIndex + 1] : process.env.NORTHWIND_EVAL_LIVE_URL) ?? "";
  return {
    live: Boolean(brainUrl),
    brainUrl: brainUrl.replace(/\/$/, ""),
    resume: argv.includes("--resume") || process.env.NORTHWIND_EVAL_RESUME === "1",
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
): Promise<{ generationId: string; results: NorthwindAnswerScore[] }> {
  const generationId = await ensureSeeded(brainUrl);
  let results: NorthwindAnswerScore[] = [];
  if (resume) {
    try {
      const previous = JSON.parse(readFileSync(LIVE_CHECKPOINT, "utf8")) as LiveCheckpoint;
      if (
        previous.brainUrl === brainUrl &&
        previous.harnessVersion === HARNESS_VERSION &&
        previous.generationId === generationId
      ) {
        results = previous.results;
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
      }),
    });
    if (response.assumedPrincipal?.userId !== question.principal.userId) {
      // Fail closed: never score a turn whose retrieval identity was not
      // confirmed to be the question's principal.
      throw new Error(
        `${question.questionId}: Brain did not confirm the assumed principal (got ${
          response.assumedPrincipal?.userId ?? "none"
        })`,
      );
    }
    const scored = scoreNorthwindAnswer(question, toEvalAnswer(response));
    results.push(scored);
    writeJson(LIVE_CHECKPOINT, {
      harnessVersion: HARNESS_VERSION,
      brainUrl,
      generationId,
      results,
    } satisfies LiveCheckpoint);
    await sleep(250);
  }
  return { generationId, results };
}

function summarize(retrieval: RetrievalEvalReport, live: NorthwindAnswerScore[] | null) {
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
  let live: { generationId: string; results: NorthwindAnswerScore[] } | null = null;
  if (args.live) {
    live = await runLiveLayer(questions, args.brainUrl, args.resume);
    writeJson(LIVE_SUMMARY, live);
  }
  const findings = summarize(retrieval, live?.results ?? null);
  writeJson(FINDINGS, findings);
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
