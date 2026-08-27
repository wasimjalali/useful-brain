import { describe, expect, it } from "vitest";

import { bm25Over, rescoreLocally } from "./keyword-score";
import type { ChunkRecord } from "./types";

function chunk(chunkId: string, heading: string, content: string): ChunkRecord {
  return {
    chunkId,
    documentId: chunkId,
    title: chunkId,
    sourceName: chunkId,
    sourcePath: `${chunkId}.md`,
    sectionHeading: heading,
    content,
    chunkIndex: 0,
    charStart: 0,
    charEnd: content.length,
    accessScope: "public",
    allowedRoles: [],
    allowedDepartments: [],
    ownerUserId: "",
    embedding: null,
  };
}

describe("local keyword rescore", () => {
  it("scores the section heading together with the body", () => {
    const headed = chunk("carry", "Carryover and Expiry", "unused leave is forfeited after the window closes.");
    const bodyOnly = chunk("body", "Other", "unused leave is forfeited after the window closes.");
    const hits = [
      { chunkId: headed.chunkId, score: 1 },
      { chunkId: bodyOnly.chunkId, score: 1 },
    ];
    const rescored = rescoreLocally("Carryover and Expiry", hits, [headed, bodyOnly]);
    const byId = Object.fromEntries(rescored.map((hit) => [hit.chunkId, hit.score]));
    expect(byId.carry).toBeGreaterThan(byId.body);
  });

  it("keeps a store hit that locally scores zero", () => {
    const allowed = chunk("keep", "Body", "payroll calendar");
    const hits = [{ chunkId: "keep", score: 4.2 }];
    expect(rescoreLocally("zephyr", hits, [allowed])).toEqual([{ chunkId: "keep", score: 0 }]);
  });

  it("drops a hit whose chunk is missing from the allowed set", () => {
    const allowed = chunk("keep", "Body", "payroll calendar");
    const hits = [
      { chunkId: "keep", score: 1 },
      { chunkId: "gone", score: 9 },
    ];
    expect(rescoreLocally("payroll", hits, [allowed]).map((hit) => hit.chunkId)).toEqual(["keep"]);
  });

  it("uses allowed passages as the idf background", () => {
    const scores = bm25Over(
      "zephyr",
      { a: "zephyr allowance" },
      { a: "zephyr allowance", b: "standard allowance" },
    );
    expect(scores.a).toBeGreaterThan(0);
  });
});
