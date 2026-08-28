import { describe, expect, it } from "vitest";

import { aclSqlAndParams, fts5MatchQuery, ftsCandidateFetchLimit, keywordSearchSql } from "../acl/access";

describe("D1 FTS SQL", () => {
  it("requires MATCH plus the ACL predicate and never uses INSERT OR REPLACE", () => {
    const { sql, params } = aclSqlAndParams({
      userId: "eng_ic",
      roles: ["standard"],
      departments: ["engineering"],
    });
    const query = keywordSearchSql(sql);
    expect(query).toMatch(/chunks_fts MATCH \?/);
    expect(query).toMatch(/c\.generation_id = \?/);
    expect(query).toMatch(/0\.0 AS rank/);
    expect(query).toMatch(/ORDER BY bm25\(chunks_fts\), c\.chunk_id LIMIT \?/);
    expect(query).not.toMatch(/ORDER BY c\.chunk_id LIMIT/);
    expect(query).toMatch(/json_each\(c.allowed_departments\)/);
    expect(query).toMatch(/json_type\(c.metadata, '\$\.owner_user_id'\) = 'text'/);
    expect(query).not.toMatch(/INSERT\s+OR\s+REPLACE/i);
    expect(params.at(-1)).toBe("eng_ic");
  });

  it("overfetches FTS candidates before the local candidate limit", () => {
    expect(ftsCandidateFetchLimit(3)).toBe(12);
    expect(ftsCandidateFetchLimit(60)).toBe(200);
  });

  it("drops question stopwords, ORs remaining terms, and quotes identifiers", () => {
    expect(fts5MatchQuery("What is the refund window?")).toBe('"refund" OR "window"');
    expect(fts5MatchQuery("RF-75")).toBe('"RF-75"');
    expect(fts5MatchQuery("refund RF-75")).toBe('"RF-75" OR "refund"');
    expect(fts5MatchQuery('NEAR(refund, AND) OR "drop"')).toBe('"NEAR" OR "refund" OR "drop"');
    expect(() => fts5MatchQuery("???")).toThrow(/no searchable terms/);
  });
});
