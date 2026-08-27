import { describe, expect, it } from "vitest";

import {
  applyRelevanceFloor,
  FakeReranker,
  rerankWithHeading,
} from "./rerank";
import {
  fitQuery,
  parseWorkersAiRerankResponse,
  RerankError,
  workersAiRerankRequest,
} from "./workers-ai-rerank";
import type { ChunkRecord, ScoredChunk } from "./types";

function scored(chunkId: string, rerankScore: number): ScoredChunk {
  const chunk: ChunkRecord = {
    chunkId,
    documentId: chunkId,
    title: chunkId,
    sourceName: chunkId,
    sourcePath: `${chunkId}.md`,
    sectionHeading: "Body",
    content: chunkId,
    chunkIndex: 0,
    charStart: 0,
    charEnd: 1,
    accessScope: "public",
    allowedRoles: [],
    allowedDepartments: [],
    ownerUserId: "",
    embedding: null,
  };
  return { chunk, vectorScore: 1, keywordScore: 1, mergedScore: 1, rerankScore };
}

describe("rerank", () => {
  it("prefixes the section heading for the cross-encoder", () => {
    expect(rerankWithHeading("Carryover and Expiry", "unused leave")).toBe(
      "Carryover and Expiry\n\nunused leave",
    );
    expect(rerankWithHeading("", "unused leave")).toBe("unused leave");
  });

  it("drops candidates below the locked 0.05 floor", () => {
    const kept = applyRelevanceFloor([scored("high", 0.99), scored("low", 0.049)], 0.05);
    expect(kept.map((item) => item.chunk.chunkId)).toEqual(["high"]);
  });

  it("scores fake overlap in input order", () => {
    const reranker = new FakeReranker();
    expect(reranker.rerank("refund policy", ["payroll calendar", "refund policy RF-75"])).toEqual([0, 1]);
  });

  it("cuts a long query so a passage still fits the 512-token pair budget", () => {
    const query = "refund ".repeat(200);
    const fitted = fitQuery(query);
    expect(fitted.length).toBeLessThan(query.length);
    const request = workersAiRerankRequest(fitted, ["RF-75 refund window"]);
    expect(request.contexts).toHaveLength(1);
    expect(request.query.length).toBeGreaterThan(0);
  });

  it("maps Workers AI scores by integer id and fails closed on duplicates or gaps", () => {
    expect(
      parseWorkersAiRerankResponse(
        { success: true, result: { response: [{ id: 1, score: 0.2 }, { id: 0, score: 0.9 }] } },
        2,
      ),
    ).toEqual([0.9, 0.2]);
    expect(() =>
      parseWorkersAiRerankResponse(
        { success: true, result: { response: [{ id: 0, score: 0.1 }, { id: 0, score: 0.2 }] } },
        2,
      ),
    ).toThrow(RerankError);
    expect(() =>
      parseWorkersAiRerankResponse({ success: true, result: { response: [{ id: 0, score: Number.NaN }] } }, 1),
    ).toThrow(/non-finite/);
    expect(() => parseWorkersAiRerankResponse({ success: false, errors: [{ message: "nope" }] }, 1)).toThrow(/rejected/);
  });
});
