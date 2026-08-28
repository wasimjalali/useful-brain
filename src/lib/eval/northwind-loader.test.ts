import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { EvalCorpusError, loadQuestions } from "./northwind-loader";

describe("eval loader", () => {
  it("rejects duplicate question keys", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ub-eval-"));
    const file = path.join(dir, "questions.json");
    writeFileSync(
      file,
      JSON.stringify({
        principals: { eng_ic: { user_id: "eng_ic", roles: ["standard"], departments: ["engineering"] } },
        questions: [
          { id: "q001", category: "factual", query: "a", principal: "eng_ic", expected_document_ids: [] },
          { id: "q001", category: "factual", query: "b", principal: "eng_ic", expected_document_ids: [] },
        ],
      }),
    );
    expect(() => loadQuestions(file, [])).toThrow(EvalCorpusError);
    expect(() => loadQuestions(file, [])).toThrow(/duplicate eval key/);
  });
});
