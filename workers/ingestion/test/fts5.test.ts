import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { UPSERT_CHUNK_SQL } from "../../../src/lib/store/generations";
import { aclSqlAndParams, fts5MatchQuery, keywordSearchSql } from "../../../src/lib/acl/access";

describe("external-content FTS5", () => {
  it("uses AUTOINCREMENT rowids, ON CONFLICT DO UPDATE, and ACL-constrained MATCH", async () => {
    expect(UPSERT_CHUNK_SQL).toMatch(/ON CONFLICT\(chunk_id\) DO UPDATE/);
    expect(UPSERT_CHUNK_SQL).not.toMatch(/INSERT\s+OR\s+REPLACE/i);
    await env.CORPUS_DB.prepare(
      "INSERT INTO corpus_generations (id, state, created_at, updated_at) VALUES (?, 'draft', ?, ?)",
    )
      .bind("gen-fts", 1, 1)
      .run();
    const now = 2;
    const aclGroup = "a".repeat(32);
    await env.CORPUS_DB.prepare(UPSERT_CHUNK_SQL).bind(
      "doc__body__000",
      "doc",
      "ver-1",
      "gen-fts",
      "Body",
      0,
      "refund policy RF-75",
      0,
      18,
      "d".repeat(64),
      "v".repeat(40),
      aclGroup,
      "public",
      "[]",
      "[]",
      "{}",
      now,
    ).run();
    const first = await env.CORPUS_DB.prepare(
      "SELECT id, content FROM chunks WHERE chunk_id = ?",
    )
      .bind("doc__body__000")
      .first<{ id: number; content: string }>();
    expect(first?.id).toBe(1);
    await env.CORPUS_DB.prepare(UPSERT_CHUNK_SQL).bind(
      "doc__body__000",
      "doc",
      "ver-1",
      "gen-fts",
      "Body",
      0,
      "updated RF-75 refund",
      0,
      20,
      "e".repeat(64),
      "v".repeat(40),
      aclGroup,
      "public",
      "[]",
      "[]",
      "{}",
      now,
    ).run();
    const updated = await env.CORPUS_DB.prepare(
      "SELECT id, content FROM chunks WHERE chunk_id = ?",
    )
      .bind("doc__body__000")
      .first<{ id: number; content: string }>();
    expect(updated?.id).toBe(1);
    expect(updated?.content).toMatch(/updated/);
    const { sql, params } = aclSqlAndParams({ userId: "eng_ic", roles: ["standard"], departments: ["engineering"] });
    const rows = await env.CORPUS_DB.prepare(keywordSearchSql(sql))
      .bind("refund", "gen-fts", ...params, 6)
      .all<{ chunk_id: string }>();
    expect(rows.results.map((row) => row.chunk_id)).toEqual(["doc__body__000"]);
    const literal = await env.CORPUS_DB.prepare(keywordSearchSql(sql))
      .bind(fts5MatchQuery("RF-75"), "gen-fts", ...params, 6)
      .all<{ chunk_id: string; rank: number }>();
    expect(literal.results.map((row) => row.chunk_id)).toEqual(["doc__body__000"]);
    const allowedRank = literal.results[0]?.rank;
    await env.CORPUS_DB.prepare(UPSERT_CHUNK_SQL).bind(
      "private__body__000",
      "private",
      "ver-private",
      "gen-fts",
      "Restricted",
      0,
      "RF-75 RF-75 RF-75 restricted",
      0,
      31,
      "f".repeat(64),
      "w".repeat(40),
      "b".repeat(32),
      "private",
      "[]",
      "[]",
      JSON.stringify({ owner_user_id: "other-user" }),
      now,
    ).run();
    const afterDeniedInsert = await env.CORPUS_DB.prepare(keywordSearchSql(sql))
      .bind(fts5MatchQuery("RF-75"), "gen-fts", ...params, 6)
      .all<{ chunk_id: string; rank: number }>();
    expect(afterDeniedInsert.results.map((row) => row.chunk_id)).toEqual(["doc__body__000"]);
    expect(afterDeniedInsert.results[0]?.rank).toBe(allowedRank);
  });

  it("selects stronger BM25 matches before the chunk-id window and hides the store rank", async () => {
    await env.CORPUS_DB.prepare(
      "INSERT INTO corpus_generations (id, state, created_at, updated_at) VALUES (?, 'draft', ?, ?)",
    )
      .bind("gen-fts-order", 1, 1)
      .run();
    const { sql, params } = aclSqlAndParams({
      userId: "eng_ic",
      roles: ["standard"],
      departments: ["engineering"],
    });
    const now = 3;
    const weakIds = ["chunk-aaa", "chunk-bbb", "chunk-ccc", "chunk-ddd", "chunk-eee"];
    for (const [index, chunkId] of weakIds.entries()) {
      await env.CORPUS_DB.prepare(UPSERT_CHUNK_SQL).bind(
        chunkId,
        "doc-order",
        "ver-1",
        "gen-fts-order",
        "Body",
        index,
        "refund",
        0,
        6,
        `${"d".repeat(62)}o${index}`,
        `${"v".repeat(38)}o${index}`,
        "a".repeat(32),
        "public",
        "[]",
        "[]",
        "{}",
        now,
      ).run();
    }
    await env.CORPUS_DB.prepare(UPSERT_CHUNK_SQL).bind(
      "chunk-zzz",
      "doc-order",
      "ver-1",
      "gen-fts-order",
      "Body",
      9,
      "refund refund refund refund refund refund refund refund",
      0,
      55,
      "e".repeat(63) + "z",
      "w".repeat(39) + "z",
      "a".repeat(32),
      "public",
      "[]",
      "[]",
      "{}",
      now,
    ).run();
    const rows = await env.CORPUS_DB.prepare(keywordSearchSql(sql))
      .bind(fts5MatchQuery("refund"), "gen-fts-order", ...params, 3)
      .all<{ chunk_id: string; rank: number }>();
    expect(rows.results.map((row) => row.chunk_id)).toContain("chunk-zzz");
    expect(rows.results[0]?.chunk_id).toBe("chunk-zzz");
    expect(rows.results.every((row) => row.rank === 0)).toBe(true);
  });

  it("keeps natural-language questions on refund content without requiring question words", async () => {
    await env.CORPUS_DB.prepare(
      "INSERT INTO corpus_generations (id, state, created_at, updated_at) VALUES (?, 'draft', ?, ?)",
    )
      .bind("gen-fts-nl", 1, 1)
      .run();
    await env.CORPUS_DB.prepare(UPSERT_CHUNK_SQL).bind(
      "refund__body__000",
      "refund",
      "ver-1",
      "gen-fts-nl",
      "Returns",
      0,
      "Customers may request a refund within 30 days.",
      0,
      47,
      "f".repeat(64),
      "x".repeat(40),
      "a".repeat(32),
      "public",
      "[]",
      "[]",
      "{}",
      4,
    ).run();
    const { sql, params } = aclSqlAndParams({
      userId: "eng_ic",
      roles: ["standard"],
      departments: ["engineering"],
    });
    const rows = await env.CORPUS_DB.prepare(keywordSearchSql(sql))
      .bind(fts5MatchQuery("What is the refund window?"), "gen-fts-nl", ...params, 6)
      .all<{ chunk_id: string; rank: number }>();
    expect(rows.results.map((row) => row.chunk_id)).toEqual(["refund__body__000"]);
    expect(rows.results[0]?.rank).toBe(0);
  });
});
