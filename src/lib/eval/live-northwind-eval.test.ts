import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EVAL_OUTPUT_DIR,
  harnessProvenance,
  brainJson,
  liveTurn,
  loadTuningQuestions,
  outputPaths,
  parseArgs,
} from "./live-northwind-eval";
import { loadDocuments, loadQuestions } from "./northwind-loader";

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

  it("records the harness commit beside each run", () => {
    const provenance = harnessProvenance();
    expect(provenance.harnessGitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof provenance.harnessDirty).toBe("boolean");
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
