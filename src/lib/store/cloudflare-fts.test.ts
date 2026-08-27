import { describe, expect, it } from "vitest";

import { aclSqlAndParams, keywordSearchSql } from "../acl/access";

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
    expect(query).toMatch(/json_each\(c.allowed_departments\)/);
    expect(query).toMatch(/json_type\(c.metadata, '\$\.owner_user_id'\) = 'text'/);
    expect(query).not.toMatch(/INSERT\s+OR\s+REPLACE/i);
    expect(params.at(-1)).toBe("eng_ic");
  });
});
