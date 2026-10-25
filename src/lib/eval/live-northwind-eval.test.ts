import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EVAL_OUTPUT_DIR,
  harnessProvenance,
  BrainTurnUnavailable,
  brainJson,
  liveTurn,
  loadTuningQuestions,
  outputPaths,
  parseArgs,
  runLiveLayer,
  unavailableNotice,
  unavailableScore,
} from "./live-northwind-eval";
import { CHAT_MODEL_ID } from "../models/selection";
import { ABSTENTION_CATEGORIES, loadDocuments, loadNorthwindCorpus, loadQuestions } from "./northwind-loader";

// Ways a tuning run could be mistaken for the locked battery:
// 1. a dangling --questions silently falls back to questions.json;
// 2. --questions names the locked file itself and records it as tuning;
// 3. tuning outputs land on the locked checkpoint/summary/findings paths,
//    so a later --resume of the locked run picks tuning rows up;
// 4. a per-model tuning run overwrites another model's tuning run;
// 5. the tuning file fails to load against the corpus (unknown principal,
//    missing document) and the run proceeds with zero questions.
describe("live Northwind eval --questions", () => {
  it("fails closed on a dangling --questions", () => {
    expect(() => parseArgs(["--questions"])).toThrow(/requires a question file/);
    expect(() => parseArgs(["--questions", "--live", "http://x"])).toThrow(
      /requires a question file/,
    );
  });

  it("refuses the locked question file", () => {
    expect(() => parseArgs(["--questions", "content/northwind/questions.json"])).toThrow(
      /tuning sets/,
    );
  });

  it("resolves the tuning file and keeps the locked run without it", () => {
    expect(parseArgs(["--questions", "content/northwind/tuning-questions.json"]).questionsFile).toBe(
      path.resolve("content/northwind/tuning-questions.json"),
    );
    expect(parseArgs([]).questionsFile).toBeUndefined();
  });

  it("writes tuning outputs apart from the locked outputs", () => {
    const locked = outputPaths(undefined);
    const tuning = outputPaths(undefined, "content/northwind/tuning-questions.json");
    for (const key of ["checkpoint", "summary", "findings", "retrievalReport"] as const) {
      expect(tuning[key]).not.toBe(locked[key]);
      expect(tuning[key].startsWith(path.join(EVAL_OUTPUT_DIR, "tuning", "tuning-questions"))).toBe(
        true,
      );
    }
    expect(outputPaths("@cf/zai-org/glm-5.3", "tuning-questions.json").findings).not.toBe(
      tuning.findings,
    );
  });

  it("loads the checked-in tuning set against the corpus", () => {
    const root = path.join(process.cwd(), "content/northwind");
    const questions = loadTuningQuestions(path.join(root, "tuning-questions.json"), loadDocuments(root));
    expect(questions.length).toBeGreaterThanOrEqual(10);
    expect(questions.every((question) => question.questionId.startsWith("tu"))).toBe(true);
  });

  it("loads the checked-in abstention guard against the corpus", () => {
    const root = path.join(process.cwd(), "content/northwind");
    const questions = loadTuningQuestions(
      path.join(root, "tuning-abstention-questions.json"),
      loadDocuments(root),
    );
    expect(questions.length).toBeGreaterThanOrEqual(3);
    expect(questions.every((question) => question.category === "unanswerable")).toBe(true);
  });

  it("fails closed on a question file with zero questions", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tuning-"));
    const file = path.join(dir, "empty.json");
    // A misspelled key loads as zero questions, which must never pass as a run.
    writeFileSync(file, JSON.stringify({ principals: {}, question: [] }));
    expect(() => loadTuningQuestions(file, [])).toThrow(/no questions/);
  });

  it("records the harness commit beside each run, or null outside a git checkout", () => {
    const provenance = harnessProvenance();
    if (provenance.harnessGitSha === null) {
      // A source export without .git (or without git installed) records
      // an explicit null rather than failing the run.
      expect(provenance.harnessDirty).toBeNull();
    } else {
      expect(provenance.harnessGitSha).toMatch(/^[0-9a-f]{40}$/);
      expect(typeof provenance.harnessDirty).toBe("boolean");
    }
  });

  it("records null provenance outside a git checkout, quietly", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "no-git-"));
    const stderr = vi.spyOn(process.stderr, "write");
    expect(harnessProvenance(dir)).toEqual({ harnessGitSha: null, harnessDirty: null });
    // git's own "not a git repository" message must not leak into the run log.
    expect(stderr).not.toHaveBeenCalled();
    stderr.mockRestore();
  });

  it("refuses the locked file through another spelling of its path", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tuning-"));
    const link = path.join(dir, "linked.json");
    symlinkSync(path.resolve("content/northwind/questions.json"), link);
    expect(() => parseArgs(["--questions", link])).toThrow(/tuning sets/);
    expect(() => parseArgs(["--questions", "content/northwind/QUESTIONS.json"])).toThrow(/tuning sets/);
    expect(() => parseArgs(["--questions", "content/northwind/../northwind/questions.json"])).toThrow(
      /tuning sets/,
    );
  });
});

// A tuning set that repeats locked facts tunes on the locked baseline by
// another name. Ways that could slip in:
// 1. a tuning question asks a locked question's fact (same gold document and
//    the same expected section);
// 2. a tuning id equals a locked id, so a merged report mixes the two;
// 3. a tuning file repeats an id within itself (the loader rejects this).
// Scope: the guard compares gold document plus expected section only. It
// does not catch a tuning question that asks a locked fact from a different
// section of the same document, or a partial overlap inside one section
// (tu05's 30-day deletion also appears in locked q090's gold); those are
// reviewed by hand and disclosed in the write-up.
describe("tuning sets stay apart from the locked battery", () => {
  const root = path.join(process.cwd(), "content/northwind");
  const documents = loadDocuments(root);
  const locked = loadQuestions(path.join(root, "questions.json"), documents).questions;
  const lockedPairs = new Set(
    locked.flatMap((question) =>
      question.expectedDocumentIds.flatMap((documentId) =>
        question.expectedSections.map((section) => `${documentId}#${section}`),
      ),
    ),
  );
  for (const file of ["tuning-questions.json", "tuning-abstention-questions.json"]) {
    it(`${file} shares no gold document and section with a locked question`, () => {
      const tuning = loadTuningQuestions(path.join(root, file), documents);
      const overlaps = tuning.flatMap((question) =>
        question.expectedDocumentIds.flatMap((documentId) =>
          question.expectedSections
            .filter((section) => lockedPairs.has(`${documentId}#${section}`))
            .map((section) => `${question.questionId}: ${documentId} / ${section}`),
        ),
      );
      expect(overlaps).toEqual([]);
    });

    it(`${file} ids never collide with locked ids`, () => {
      const lockedIds = new Set(locked.map((question) => question.questionId));
      const tuning = loadTuningQuestions(path.join(root, file), documents);
      expect(tuning.filter((question) => lockedIds.has(question.questionId))).toEqual([]);
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const unavailable = () =>
  Response.json(
    {
      code: "UNAVAILABLE",
      message: "The knowledge base is unavailable. Try the question again in a new turn.",
      retryable: true,
    },
    { status: 503 },
  );

/** Settle-tracking wrapper so a test can see whether a rejection already landed. */
function track<T>(promise: Promise<T>) {
  const state: { settled: boolean; error?: unknown } = { settled: false };
  promise.then(
    () => {
      state.settled = true;
    },
    (error) => {
      state.settled = true;
      state.error = error;
    },
  );
  return state;
}

describe("live Northwind harness availability", () => {
  it("stops loudly on a turn the Brain keeps reporting unavailable, naming the question", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(async () => unavailable());
    vi.stubGlobal("fetch", fetchMock);

    const state = track(liveTurn("http://brain.test", "q042", { method: "POST", body: "{}" }));
    // Backoff after attempts 1-3 only: 1s + 2s + 4s. No sleep follows the
    // final attempt, so the error lands without waiting another 8s.
    await vi.advanceTimersByTimeAsync(7_000);

    expect(state.settled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const message = (state.error as Error).message;
    expect(message).toMatch(/^q042: /);
    expect(message).toContain("statuses 503, 503, 503, 503");
    expect(message).toContain("the question was not scored");
  });

  it("reports every attempt's status and no scoring claim outside /turns", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json({}, { status: 429 }))
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(Response.json({}, { status: 500 }))
      .mockResolvedValueOnce(unavailable());
    vi.stubGlobal("fetch", fetchMock);

    const state = track(brainJson("http://brain.test", "/knowledge"));
    await vi.advanceTimersByTimeAsync(7_000);

    expect(state.settled).toBe(true);
    const message = (state.error as Error).message;
    expect(message).toContain("statuses 429, 503, 500, 503");
    expect(message).not.toContain("not scored");
  });

  it("returns the payload once a retried turn succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(unavailable())
      .mockResolvedValueOnce(Response.json({ answer: "ok" }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const turn = brainJson<{ answer: string }>("http://brain.test", "/turns");
    await vi.runAllTimersAsync();
    await expect(turn).resolves.toEqual({ answer: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("names the question on a non-retryable Brain error too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ code: "CANCELLED", message: "The answer was stopped." }, { status: 409 })),
    );

    await expect(liveTurn("http://brain.test", "q007", { method: "POST", body: "{}" })).rejects.toThrow(
      "q007: The answer was stopped.",
    );
  });
});

describe("live Northwind harness unavailable turns", () => {
  const platform503 = () => new Response("<html>Service Unavailable</html>", { status: 503 });

  it("raises BrainTurnUnavailable when every /turns attempt is the Brain's own 503", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => unavailable()));
    const state = track(brainJson("http://brain.test", "/turns"));
    await vi.advanceTimersByTimeAsync(7_000);
    expect(state.error).toBeInstanceOf(BrainTurnUnavailable);
  });

  it("raises a plain Error when the statuses are mixed 429, 503 and 500", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({}, { status: 429 }))
        .mockResolvedValueOnce(unavailable())
        .mockResolvedValueOnce(Response.json({}, { status: 500 }))
        .mockResolvedValueOnce(unavailable()),
    );
    const state = track(brainJson("http://brain.test", "/turns"));
    await vi.advanceTimersByTimeAsync(7_000);
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error).not.toBeInstanceOf(BrainTurnUnavailable);
  });

  it("never raises BrainTurnUnavailable for a path other than /turns", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => unavailable()));
    const state = track(brainJson("http://brain.test", "/knowledge"));
    await vi.advanceTimersByTimeAsync(7_000);
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error).not.toBeInstanceOf(BrainTurnUnavailable);
  });

  it("raises a plain Error when the 503 is a platform page, not the Brain's body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => platform503()));
    const state = track(brainJson("http://brain.test", "/turns"));
    await vi.advanceTimersByTimeAsync(7_000);
    expect(state.error).toBeInstanceOf(Error);
    expect(state.error).not.toBeInstanceOf(BrainTurnUnavailable);
  });

  it("prints one notice naming the unavailable questions, and nothing when there are none", () => {
    const { questions } = loadNorthwindCorpus();
    expect(unavailableNotice([])).toBeNull();
    expect(unavailableNotice([unavailableScore(questions[3]), unavailableScore(questions[7])])).toBe(
      `warning: 2 unavailable turn(s) scored as failures (--score-unavailable): ${questions[3].questionId}, ${questions[7].questionId}\n`,
    );
  });

  it("scores recall like the scorer: null for abstention or no expected documents", () => {
    const { questions } = loadNorthwindCorpus();
    const abstention = questions.find((question) => ABSTENTION_CATEGORIES.has(question.category));
    const answerable = questions.find(
      (question) => !ABSTENTION_CATEGORIES.has(question.category) && question.expectedDocumentIds.length > 0,
    );
    expect(unavailableScore(abstention!).liveRecall).toBeNull();
    expect(unavailableScore(answerable!).liveRecall).toBe(0);
    expect(unavailableScore({ ...answerable!, expectedDocumentIds: [] }).liveRecall).toBeNull();
  });
});

describe("runLiveLayer with unavailable turns", () => {
  const { questions: allQuestions } = loadNorthwindCorpus();
  const questions = allQuestions.filter((question) => question.category === "unanswerable").slice(0, 2);
  const questionsFile = path.join(tmpdir(), `unavailable-run-${process.pid}-${Date.now()}.json`);
  const paths = outputPaths(undefined, questionsFile);
  const turnLog: string[] = [];
  let unavailableFor = new Set<string>();

  function brainMock() {
    return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/knowledge")) {
        return Response.json({ embeddingStorageStatus: { activeVersionId: "gen1" } });
      }
      const body = JSON.parse(String(init?.body));
      const question = questions.find((candidate) => candidate.query === body.question)!;
      turnLog.push(question.questionId);
      if (unavailableFor.has(question.questionId)) {
        return unavailable();
      }
      return Response.json({
        answer: "No evidence.",
        structuredAnswer: { answerType: "insufficient_evidence", paragraphs: [] },
        retrieval: { results: [] },
        vectorDegradedCount: 0,
        assumedPrincipal: { userId: question.principal.userId },
        answerModel: CHAT_MODEL_ID,
        promptVersion: "test",
        retrievalConfigVersion: "test",
      });
    });
  }

  function run(flag: boolean, resume: boolean) {
    // Backoff and pacing sleeps run instantly; the fetch mock is the clock.
    vi.stubGlobal("setTimeout", (fn: () => void) => {
      fn();
      return 0;
    });
    return runLiveLayer(questions, "http://brain.test", resume, undefined, questionsFile, flag);
  }

  afterEach(() => {
    turnLog.length = 0;
    unavailableFor = new Set();
    rmSync(path.dirname(paths.checkpoint), { recursive: true, force: true });
  });

  it("rethrows an unavailable turn when the flag is off", async () => {
    unavailableFor = new Set([questions[0].questionId]);
    vi.stubGlobal("fetch", brainMock());
    await expect(run(false, false)).rejects.toBeInstanceOf(BrainTurnUnavailable);
  });

  it("writes the failed row and the checkpoint when the flag is on", async () => {
    unavailableFor = new Set([questions[0].questionId]);
    vi.stubGlobal("fetch", brainMock());
    const { results, latenciesMs } = await run(true, false);
    expect(results.map((result) => [result.questionId, result.answerType, result.status])).toEqual([
      [questions[0].questionId, "unavailable", "fail"],
      [questions[1].questionId, "insufficient_evidence", "pass"],
    ]);
    expect(Object.keys(latenciesMs)).toEqual([questions[1].questionId]);
    const checkpoint = JSON.parse(readFileSync(paths.checkpoint, "utf8"));
    expect(checkpoint.scoreUnavailable).toBe(true);
    expect(checkpoint.results).toHaveLength(2);
  });

  it("refuses to resume a checkpoint written with a different flag value", async () => {
    unavailableFor = new Set([questions[0].questionId]);
    vi.stubGlobal("fetch", brainMock());
    await run(true, false);
    turnLog.length = 0;
    unavailableFor = new Set();
    const { results } = await run(false, true);
    // Nothing was reused: both questions were asked again.
    expect(turnLog).toEqual(questions.map((question) => question.questionId));
    expect(results.every((result) => result.answerType === "insufficient_evidence")).toBe(true);
  });

  it("asks unavailable rows again on a resume with the same flag", async () => {
    unavailableFor = new Set([questions[0].questionId]);
    vi.stubGlobal("fetch", brainMock());
    await run(true, false);
    turnLog.length = 0;
    unavailableFor = new Set();
    const { results } = await run(true, true);
    expect(turnLog).toEqual([questions[0].questionId]);
    expect(results.map((result) => result.answerType)).toEqual([
      "insufficient_evidence",
      "insufficient_evidence",
    ]);
  });
});
