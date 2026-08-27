import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { UPSERT_CHUNK_SQL } from "../../../src/lib/store/generations";
import { aclSqlAndParams, keywordSearchSql } from "../../../src/lib/acl/access";

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
  });
});
